/**
 * The world's rules: applies players' inputs, lands their attacks, moves projectiles and runs
 * creatures, all from the server's own state. Clients send only intent (a move, a facing and
 * buttons) and nothing here reads damage, targets or positions from them. It knows nothing about
 * sockets or the database, which come in through WorldHooks.
 */
import { collide, segmentBlocked } from '../../../shared/collision.js';
import {
  attackDamage,
  inMeleeArc,
  staggerPower,
  RESPAWN_SECONDS,
  INTERACT_RANGE,
  WEAPON_STYLES,
  weaponFor,
  type ProjectileShape,
  type WeaponStats,
} from '../../../shared/combat.js';
import { MAP } from '../../../shared/mapData.js';
import type { MapBonfire, MapCamp, MapChest } from '../../../shared/mapTypes.js';
import {
  FLAG_ATTACK,
  FLAG_DODGE,
  FLAG_INTERACT,
  FLAG_POTION,
  FLAG_RUN,
  MAX_FLAGS,
  packSnapshot,
  type GameEvent,
  type PlayerInfo,
  type ServerMessage,
} from '../../../shared/protocol.js';
import {
  attackHitThisStep,
  createState,
  deriveStats,
  isInvulnerable,
  MAX_POTIONS,
  PLAYER_RADIUS,
  STAGGER_SECONDS,
  STARTING_POTIONS,
  stepPlayer,
  TICK_DT,
  type Derived,
  type SimInput,
  type SimState,
} from '../../../shared/sim.js';
import { Creature, CreatureField, Mode, type CreatureTarget } from './creatures.js';

export const MAX_QUEUED_INPUTS = 30;
// A client may run slightly ahead to catch up after lag, but can't move faster over time.
export const MAX_INPUT_BUDGET = 8;
// Far above anything a real client sends, and small enough that the maths can't overflow.
const MAX_INPUT_AXIS = 8;
const MAX_INPUT_YAW = 1000;
/**
 * Timers run only as inputs arrive, so stopping sending in the middle of a dodge would freeze its
 * safe frames for good. Past this many ticks behind, the server steps a busy player by itself.
 */
const MAX_TICKS_BEHIND = 6;

const POISE_RESET_SECONDS = 3;
/** Your hit earns you a share of the loot if it's this recent. */
const LOOT_WINDOW_SECONDS = 20;
const PROJECTILE_RADIUS = 0.25;
const RESPAWN_SCATTER = 3;
const CHEST_RETRY_SECONDS = 2;
const CREATURES_PER_SNAPSHOT = 40;
const CREATURE_VIEW_RADIUS = 90;
const EVENT_VIEW_RADIUS = 70;
const EVENTS_PER_SNAPSHOT = 32;
const FIRST_BLOOD_KILLS = 1;
const BEAST_HUNTER_KILLS = 10;

/** SimInput plus the one button that isn't part of movement prediction. */
export interface ServerInput extends SimInput {
  interact: boolean;
}

/** Stands in for an input that didn't come. A NaN yaw leaves the facing alone. */
const NO_INPUT: ServerInput = {
  seq: 0,
  mx: 0,
  mz: 0,
  yaw: Number.NaN,
  run: false,
  dodge: false,
  attack: false,
  potion: false,
  interact: false,
};

export function parseInput(raw: unknown): ServerInput | null {
  if (typeof raw !== 'string') return null;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = (message as { t?: unknown; d?: unknown } | null)?.d;
  if ((message as { t?: unknown } | null)?.t !== 'i' || !Array.isArray(data) || data.length !== 5) return null;
  const [seq, mx, mz, yaw, flags] = data as number[];
  if (![seq, mx, mz, yaw, flags].every(Number.isFinite)) return null;
  // Finite isn't enough: values like 1e308 overflow to NaN inside the simulation.
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  if (Math.abs(mx) > MAX_INPUT_AXIS || Math.abs(mz) > MAX_INPUT_AXIS || Math.abs(yaw) > MAX_INPUT_YAW) return null;
  if (!Number.isInteger(flags) || flags < 0 || flags > MAX_FLAGS) return null;
  return {
    seq,
    mx,
    mz,
    yaw,
    run: (flags & FLAG_RUN) !== 0,
    dodge: (flags & FLAG_DODGE) !== 0,
    attack: (flags & FLAG_ATTACK) !== 0,
    potion: (flags & FLAG_POTION) !== 0,
    interact: (flags & FLAG_INTERACT) !== 0,
  };
}

export interface PlayerSetup {
  /** The account, from the verified session. Only ever used as a key on the server. */
  userId: string;
  info: PlayerInfo;
  dust: number;
  enemies: number;
  animals: number;
  chests: readonly number[];
  achievements: readonly string[];
}

export interface WorldPlayer extends CreatureTarget {
  userId: string;
  info: PlayerInfo;
  state: SimState;
  derived: Derived;
  weapon: WeaponStats;
  styleIndex: number;
  damage: number;
  stagger: number;
  inputs: ServerInput[];
  budget: number;
  ticksBehind: number;
  lastSeq: number;
  newestSeq: number;
  dust: number;
  enemies: number;
  animals: number;
  /** Opened, or being opened right now. */
  chests: Set<number>;
  chestRetryAt: number;
  achievements: Set<string>;
  selfChanged: boolean;
}

/** How the world reaches everything outside it. */
export interface WorldHooks {
  /** Sends to this player only. */
  send(player: WorldPlayer, message: ServerMessage): void;
  /** Adds to saved totals. Doesn't wait. */
  credit(player: WorldPlayer, delta: { dust?: number; enemies?: number; animals?: number; deaths?: number }): void;
  /** Resolves true if this account hadn't opened it before. */
  openChest(player: WorldPlayer, chest: MapChest): Promise<boolean>;
  /** Resolves true if the achievement is new. */
  unlock(player: WorldPlayer, achievement: string): Promise<boolean>;
}

/** The parts of the map the rules read. Tests can stage their own, and it can't be set from outside. */
export interface WorldConfig {
  spawn: { x: number; z: number; radius: number };
  camps: readonly MapCamp[];
  chests: readonly MapChest[];
  bonfires: readonly MapBonfire[];
  random?: () => number;
}

const LOAD_TEST_KINDS = ['wolf', 'deer', 'stag', 'fox', 'bull'];
const LOAD_TEST_CAMP_SIZE = 5;
const LOAD_TEST_RING = 40;
const LOAD_TEST_MAX_CREATURES = 1000;

/**
 * For server/loadtest.cjs only, since the map has far fewer creatures than the server must handle.
 * Adds camps in a ring around the spawn until the world has this many. Any bad value adds nothing.
 */
export function withLoadTestCreatures(config: WorldConfig, total: number): WorldConfig {
  if (!Number.isInteger(total) || total > LOAD_TEST_MAX_CREATURES) return config;
  let missing = total - config.camps.reduce((sum, camp) => sum + camp.count, 0);
  if (missing <= 0) return config;
  const camps = [...config.camps];
  const added = Math.ceil(missing / LOAD_TEST_CAMP_SIZE);
  for (let index = 0; index < added; index += 1) {
    const angle = (index / added) * Math.PI * 2;
    camps.push({
      kind: LOAD_TEST_KINDS[index % LOAD_TEST_KINDS.length],
      x: config.spawn.x + Math.cos(angle) * LOAD_TEST_RING,
      z: config.spawn.z + Math.sin(angle) * LOAD_TEST_RING,
      count: Math.min(missing, LOAD_TEST_CAMP_SIZE),
      radius: 8,
    });
    missing -= LOAD_TEST_CAMP_SIZE;
  }
  return { ...config, camps };
}

interface Projectile {
  id: number;
  owner: WorldPlayer;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  remaining: number;
  shape: ProjectileShape;
  damage: number;
  stagger: number;
  styleIndex: number;
}

interface QueuedEvent {
  text: string;
  x: number;
  z: number;
  /** The player it's about, who always gets it wherever they are. 0 for no one. */
  about: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class World {
  readonly players: WorldPlayer[] = [];
  readonly field: CreatureField;
  readonly projectiles: Projectile[] = [];
  time = 0;
  tickNumber = 0;

  private random: () => number;
  private nextPlayerId = 1;
  private nextProjectileId = 1;
  private events: QueuedEvent[] = [];
  private snapshotList = '[]';
  private snapshotStamp = 0;
  private scratch: Creature[] = [];
  private scratchDistance = new Map<Creature, number>();

  constructor(
    private hooks: WorldHooks,
    private config: WorldConfig = MAP,
  ) {
    this.random = config.random ?? Math.random;
    this.field = new CreatureField(config.camps, config.bonfires, {
      players: this.players,
      bite: (creature, target) => this.bite(creature, target as WorldPlayer),
    });
  }

  addPlayer(setup: PlayerSetup): WorldPlayer {
    const { classId, appearance, stats } = setup.info;
    const weapon = weaponFor(classId, appearance.variant);
    const derived = deriveStats(stats, weapon);
    const { spawn } = this.config;
    const angle = this.random() * Math.PI * 2;
    const distance = Math.sqrt(this.random()) * spawn.radius;
    const state = createState(spawn.x + Math.cos(angle) * distance, spawn.z + Math.sin(angle) * distance, derived);
    collide(state, PLAYER_RADIUS);
    const id = this.nextPlayerId++;
    const player: WorldPlayer = {
      id,
      userId: setup.userId,
      info: { ...setup.info, id },
      state,
      derived,
      weapon,
      styleIndex: WEAPON_STYLES.indexOf(weapon.style),
      damage: attackDamage(weapon, stats),
      stagger: staggerPower(weapon, stats),
      inputs: [],
      budget: MAX_INPUT_BUDGET,
      ticksBehind: 0,
      lastSeq: 0,
      newestSeq: 0,
      dust: setup.dust,
      enemies: setup.enemies,
      animals: setup.animals,
      chests: new Set(setup.chests),
      chestRetryAt: 0,
      achievements: new Set(setup.achievements),
      selfChanged: false,
      gone: false,
      attackers: 0,
    };
    this.players.push(player);
    return player;
  }

  removePlayer(player: WorldPlayer): void {
    player.gone = true;
    const index = this.players.indexOf(player);
    if (index >= 0) this.players.splice(index, 1);
  }

  queueInput(player: WorldPlayer, input: ServerInput): void {
    if (input.seq <= player.newestSeq) return;
    player.newestSeq = input.seq;
    if (player.inputs.length >= MAX_QUEUED_INPUTS) player.inputs.shift();
    player.inputs.push(input);
  }

  tick(): void {
    this.time += TICK_DT;
    this.tickNumber += 1;
    for (const player of this.players) this.runPlayer(player);
    this.moveProjectiles();
    this.field.step(this.tickNumber);
    for (const player of this.players) {
      if (!player.selfChanged) continue;
      player.selfChanged = false;
      this.hooks.send(player, { t: 'self', dust: player.dust, kills: player.enemies + player.animals });
    }
  }

  /* Players. */

  private runPlayer(player: WorldPlayer): void {
    player.budget = Math.min(MAX_INPUT_BUDGET, player.budget + 1);
    player.ticksBehind += 1;
    while (player.budget >= 1 && player.inputs.length > 0) {
      const input = player.inputs.shift()!;
      player.budget -= 1;
      // Coming back after a pause while nothing was running owes nothing.
      if (player.ticksBehind > MAX_TICKS_BEHIND && !this.isBusy(player)) player.ticksBehind = 0;
      this.stepOnce(player, input);
      player.lastSeq = input.seq;
      player.ticksBehind = Math.max(0, player.ticksBehind - 1);
    }
    if (player.ticksBehind > MAX_TICKS_BEHIND) {
      if (this.isBusy(player)) {
        while (player.ticksBehind > MAX_TICKS_BEHIND) {
          this.stepOnce(player, NO_INPUT);
          player.ticksBehind -= 1;
        }
      } else {
        // No inputs are coming, so other players shouldn't see this one walking on the spot.
        player.state.moving = 0;
        player.ticksBehind = MAX_TICKS_BEHIND + 1;
      }
    }
    // These run with or without inputs, so a hidden browser tab still dies and comes back.
    const { state } = player;
    if (state.deadTime > 0) {
      state.deadTime -= TICK_DT;
      if (state.deadTime <= 0) this.respawn(player);
    }
  }

  private isBusy({ state }: WorldPlayer): boolean {
    return state.dodgeTime > 0 || state.attackTime > 0 || state.staggerTime > 0 || state.drinkTime > 0;
  }

  /** One step of the shared movement rules, firing the attack at the exact step it reaches its hit moment. */
  private stepOnce(player: WorldPlayer, input: ServerInput): void {
    const { state, derived } = player;
    const attackBefore = state.attackTime;
    const potionsBefore = state.potions;
    stepPlayer(state, input, derived);
    if (state.potions < potionsBefore) {
      this.emit({ k: 'drink', v: player.id }, state.x, state.z, player.id);
    }
    if (attackHitThisStep(attackBefore, state.attackTime, derived) && state.deadTime <= 0) this.fireAttack(player);
    if (input.interact && state.deadTime <= 0) this.tryOpenChest(player);
  }

  private respawn(player: WorldPlayer): void {
    const { state, derived } = player;
    const { bonfires, spawn } = this.config;
    let homeX = spawn.x;
    let homeZ = spawn.z;
    let best = Infinity;
    for (const bonfire of bonfires) {
      const squared = (bonfire.x - state.x) ** 2 + (bonfire.z - state.z) ** 2;
      if (squared < best) {
        best = squared;
        homeX = bonfire.x;
        homeZ = bonfire.z;
      }
    }
    const angle = this.random() * Math.PI * 2;
    state.x = homeX + Math.cos(angle) * RESPAWN_SCATTER;
    state.z = homeZ + Math.sin(angle) * RESPAWN_SCATTER;
    collide(state, PLAYER_RADIUS);
    state.health = derived.maxHealth;
    state.stamina = derived.maxStamina;
    state.magic = derived.maxMagic;
    state.potions = Math.max(state.potions, STARTING_POTIONS);
    state.deadTime = 0;
    state.regenDelay = 0;
    this.emit({ k: 'respawn', v: player.id }, state.x, state.z, player.id);
  }

  private kill(player: WorldPlayer): void {
    const { state } = player;
    state.health = 0;
    state.deadTime = RESPAWN_SECONDS;
    state.attackTime = 0;
    state.dodgeTime = 0;
    state.drinkTime = 0;
    state.staggerTime = 0;
    state.knockX = 0;
    state.knockZ = 0;
    state.moving = 0;
    this.hooks.credit(player, { deaths: 1 });
    this.emit({ k: 'death', v: player.id }, state.x, state.z, player.id);
  }

  /** A creature's strike connected, if the player isn't dead or in the safe frames of a dodge. */
  private bite(creature: Creature, player: WorldPlayer): void {
    const { state, derived } = player;
    if (state.deadTime > 0 || isInvulnerable(state, derived)) return;
    const damage = creature.kind.damage;
    state.health = Math.max(0, state.health - damage);
    this.emit(
      { k: 'bite', c: creature.id, v: player.id, x: round2(state.x), z: round2(state.z), dmg: damage },
      state.x,
      state.z,
      player.id,
    );
    if (state.health <= 0) {
      this.kill(player);
      return;
    }
    const dx = state.x - creature.x;
    const dz = state.z - creature.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    state.knockX = distance > 0 ? dx / distance : Math.sin(creature.yaw);
    state.knockZ = distance > 0 ? dz / distance : Math.cos(creature.yaw);
    state.staggerTime = STAGGER_SECONDS;
    // Being knocked off balance interrupts a swing or a roll already under way.
    state.attackTime = 0;
    state.dodgeTime = 0;
  }

  /* Attacks. */

  private fireAttack(player: WorldPlayer): void {
    const { weapon, state } = player;
    if (weapon.melee) {
      const { melee } = weapon;
      const targets = this.scratch;
      const distances = this.scratchDistance;
      targets.length = 0;
      distances.clear();
      for (const creature of this.field.creatures) {
        if (!creature.alive) continue;
        const dx = creature.x - state.x;
        const dz = creature.z - state.z;
        if (!inMeleeArc(dx, dz, state.yaw, melee, creature.kind.radius)) continue;
        targets.push(creature);
        distances.set(creature, dx * dx + dz * dz);
      }
      targets.sort((a, b) => distances.get(a)! - distances.get(b)!);
      let hits = 0;
      for (const creature of targets) {
        if (hits >= melee.maxTargets) break;
        // Weapons don't go through walls.
        if (segmentBlocked(state.x, state.z, creature.x, creature.z)) continue;
        this.hitCreature(creature, player, player.damage, player.stagger, player.styleIndex);
        hits += 1;
      }
      if (hits === 0) {
        this.emit(
          { k: 'swing', by: player.id, x: round2(state.x), z: round2(state.z), yaw: round2(state.yaw), style: player.styleIndex },
          state.x,
          state.z,
          player.id,
        );
      }
    } else if (weapon.projectile) {
      const shape = weapon.projectile;
      const id = this.nextProjectileId++;
      this.projectiles.push({
        id,
        owner: player,
        x: state.x,
        z: state.z,
        dirX: Math.sin(state.yaw),
        dirZ: Math.cos(state.yaw),
        remaining: shape.range,
        shape,
        damage: player.damage,
        stagger: player.stagger,
        styleIndex: player.styleIndex,
      });
      this.emit(
        {
          k: 'shot',
          id,
          by: player.id,
          x: round2(state.x),
          z: round2(state.z),
          yaw: round2(state.yaw),
          speed: shape.speed,
          range: shape.range,
          style: player.styleIndex,
        },
        state.x,
        state.z,
        player.id,
      );
    }
  }

  private moveProjectiles(): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const shot = this.projectiles[index];
      if (this.moveProjectile(shot)) {
        this.projectiles[index] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
      }
    }
  }

  /** Moves one projectile along this tick's segment. True when it has finished. */
  private moveProjectile(shot: Projectile): boolean {
    const travel = Math.min(shot.shape.speed * TICK_DT, shot.remaining);
    let reach = travel;
    let struck: Creature | null = null;
    for (const creature of this.field.creatures) {
      if (!creature.alive) continue;
      const toX = creature.x - shot.x;
      const toZ = creature.z - shot.z;
      const along = Math.max(0, Math.min(reach, toX * shot.dirX + toZ * shot.dirZ));
      const offX = toX - shot.dirX * along;
      const offZ = toZ - shot.dirZ * along;
      const limit = creature.kind.radius + PROJECTILE_RADIUS;
      if (offX * offX + offZ * offZ <= limit * limit) {
        struck = creature;
        reach = along;
      }
    }
    const endX = shot.x + shot.dirX * reach;
    const endZ = shot.z + shot.dirZ * reach;
    if (segmentBlocked(shot.x, shot.z, endX, endZ)) {
      this.stopAtWall(shot, reach);
      this.finishShot(shot, null, true);
      return true;
    }
    shot.x = endX;
    shot.z = endZ;
    shot.remaining -= reach;
    if (struck) {
      this.finishShot(shot, struck, true);
      return true;
    }
    if (shot.remaining <= 1e-6) {
      this.finishShot(shot, null, false);
      return true;
    }
    return false;
  }

  /** Puts the projectile at the last open spot before the wall, so its splash stays on this side. */
  private stopAtWall(shot: Projectile, reach: number): void {
    const stepSize = 0.25;
    let walked = 0;
    while (walked + stepSize < reach) {
      const nextX = shot.x + shot.dirX * stepSize;
      const nextZ = shot.z + shot.dirZ * stepSize;
      if (segmentBlocked(shot.x, shot.z, nextX, nextZ)) return;
      shot.x = nextX;
      shot.z = nextZ;
      walked += stepSize;
    }
  }

  private finishShot(shot: Projectile, struck: Creature | null, hit: boolean): void {
    const { owner, shape } = shot;
    let hits = 0;
    if (struck) {
      this.hitCreature(struck, owner, shot.damage, shot.stagger, shot.styleIndex);
      hits += 1;
    }
    if (hit && shape.splash > 0) {
      const targets = this.scratch;
      const distances = this.scratchDistance;
      targets.length = 0;
      distances.clear();
      for (const creature of this.field.creatures) {
        if (!creature.alive || creature === struck) continue;
        const dx = creature.x - shot.x;
        const dz = creature.z - shot.z;
        const squared = dx * dx + dz * dz;
        const limit = shape.splash + creature.kind.radius;
        if (squared > limit * limit) continue;
        targets.push(creature);
        distances.set(creature, squared);
      }
      targets.sort((a, b) => distances.get(a)! - distances.get(b)!);
      for (const creature of targets) {
        if (hits >= shape.maxTargets) break;
        if (segmentBlocked(shot.x, shot.z, creature.x, creature.z)) continue;
        this.hitCreature(creature, owner, shot.damage, shot.stagger, shot.styleIndex);
        hits += 1;
      }
    }
    this.emit(
      {
        k: 'shotEnd',
        id: shot.id,
        x: round2(shot.x),
        z: round2(shot.z),
        hit: hit ? 1 : 0,
        splash: shape.splash,
        style: shot.styleIndex,
      },
      shot.x,
      shot.z,
      owner.id,
    );
  }

  private hitCreature(creature: Creature, attacker: WorldPlayer, damage: number, power: number, styleIndex: number): void {
    const { kind } = creature;
    creature.health = Math.max(0, creature.health - damage);
    creature.hitters.set(attacker, this.time);

    if (this.time - creature.lastPoiseHit > POISE_RESET_SECONDS) creature.poise = 0;
    creature.lastPoiseHit = this.time;
    creature.poise += power;
    const poiseBroke = creature.health > 0 && creature.poise >= kind.poise;
    if (poiseBroke) creature.poise = 0;

    const killed = creature.health <= 0;
    this.emit(
      {
        k: 'hit',
        by: attacker.id,
        c: creature.id,
        x: round2(creature.x),
        z: round2(creature.z),
        dmg: damage,
        style: styleIndex,
        kill: killed ? 1 : 0,
        stagger: poiseBroke ? 1 : 0,
      },
      creature.x,
      creature.z,
      attacker.id,
    );
    if (killed) {
      this.field.onDeath(creature);
      this.reward(creature);
    } else {
      this.field.onHit(creature, attacker, poiseBroke);
    }
  }

  /** Loot is personal: everyone who helped recently gets a full roll of their own. */
  private reward(creature: Creature): void {
    const { kind } = creature;
    for (const [target, hitAt] of creature.hitters) {
      const player = target as WorldPlayer;
      if (player.gone || this.time - hitAt > LOOT_WINDOW_SECONDS) continue;
      // Wolves and bulls count as enemies, the rest as animals. The leaderboard adds the two together.
      const isEnemy = kind.behavior === 'hunter';
      if (isEnemy) player.enemies += 1;
      else player.animals += 1;
      let dust = 0;
      if (this.random() < kind.dustChance) {
        dust = kind.dustMin + Math.floor(this.random() * (kind.dustMax - kind.dustMin + 1));
        player.dust += dust;
        this.emit(
          { k: 'dust', x: round2(creature.x), z: round2(creature.z), n: dust, to: player.id },
          creature.x,
          creature.z,
          player.id,
        );
      }
      this.hooks.credit(player, { dust, enemies: isEnemy ? 1 : 0, animals: isEnemy ? 0 : 1 });
      player.selfChanged = true;
      if (player.enemies >= FIRST_BLOOD_KILLS) this.grant(player, 'first_blood');
      if (player.animals >= BEAST_HUNTER_KILLS) this.grant(player, 'beast_hunter');
    }
    creature.hitters.clear();
  }

  private grant(player: WorldPlayer, achievement: string): void {
    if (player.achievements.has(achievement)) return;
    player.achievements.add(achievement);
    this.hooks.unlock(player, achievement).then(
      (isNew) => {
        if (isNew && !player.gone) this.hooks.send(player, { t: 'unlock', achievement });
      },
      // The next kill tries again.
      () => player.achievements.delete(achievement),
    );
  }

  /* Chests. */

  private tryOpenChest(player: WorldPlayer): void {
    if (this.time < player.chestRetryAt) return;
    const { state } = player;
    for (const chest of this.config.chests) {
      if (player.chests.has(chest.id)) continue;
      const dx = chest.x - state.x;
      const dz = chest.z - state.z;
      if (dx * dx + dz * dz > INTERACT_RANGE * INTERACT_RANGE) continue;
      // Marked before the database answers, so holding the button can't ask twice.
      player.chests.add(chest.id);
      this.hooks.openChest(player, chest).then(
        (opened) => {
          if (!opened || player.gone) return;
          const potion = state.potions < MAX_POTIONS ? 1 : 0;
          state.potions += potion;
          player.dust += chest.dust;
          player.selfChanged = true;
          this.hooks.send(player, { t: 'chest', id: chest.id, dust: chest.dust, potion });
        },
        () => {
          // Nothing was saved, so nothing was given. It can be tried again shortly.
          player.chests.delete(chest.id);
          player.chestRetryAt = this.time + CHEST_RETRY_SECONDS;
        },
      );
      return;
    }
  }

  /* Snapshots. */

  private emit(event: GameEvent, x: number, z: number, about: number): void {
    this.events.push({ text: JSON.stringify(event), x, z, about });
  }

  /** Call before a round of snapshotFor: what's the same for everyone is built only once. */
  beginSnapshots(): void {
    this.snapshotStamp += 1;
    const list = this.players.map((player) => packSnapshot(player.id, player.state));
    this.snapshotList = JSON.stringify(list);
  }

  /** Call after a round of snapshotFor. */
  endSnapshots(): void {
    this.events.length = 0;
  }

  snapshotFor(player: WorldPlayer): string {
    const { state } = player;
    let text = `{"t":"s","a":${player.lastSeq},"p":${this.snapshotList},"c":[${this.nearbyCreatures(state).join(',')}]`;
    const events = this.eventsFor(player);
    if (events.length > 0) text += `,"e":[${events.join(',')}]`;
    return `${text}}`;
  }

  private packCreature(c: Creature): string {
    if (c.packedAt !== this.snapshotStamp) {
      c.packedAt = this.snapshotStamp;
      // The health bar shows at least 1% for anything that's still alive.
      const percent = c.alive ? Math.max(1, Math.ceil((c.health / c.kind.health) * 100)) : 0;
      c.packed = `[${c.id},${c.kindIndex},${round2(c.x)},${round2(c.z)},${round2(c.yaw)},${c.visual},${percent}]`;
    }
    return c.packed;
  }

  private nearbyCreatures(state: SimState): string[] {
    const near: { c: Creature; d: number }[] = [];
    const limit = CREATURE_VIEW_RADIUS * CREATURE_VIEW_RADIUS;
    for (const c of this.field.creatures) {
      if (c.mode === Mode.Gone) continue;
      const dx = c.x - state.x;
      const dz = c.z - state.z;
      const d = dx * dx + dz * dz;
      if (d <= limit) near.push({ c, d });
    }
    if (near.length > CREATURES_PER_SNAPSHOT) {
      near.sort((a, b) => a.d - b.d);
      near.length = CREATURES_PER_SNAPSHOT;
    }
    return near.map((entry) => this.packCreature(entry.c));
  }

  private eventsFor(player: WorldPlayer): string[] {
    const chosen: string[] = [];
    // Your own come first, so a crowd's effects can't push out what happened to you.
    for (const event of this.events) {
      if (event.about !== player.id) continue;
      if (chosen.length >= EVENTS_PER_SNAPSHOT) return chosen;
      chosen.push(event.text);
    }
    const limit = EVENT_VIEW_RADIUS * EVENT_VIEW_RADIUS;
    for (const event of this.events) {
      if (event.about === player.id) continue;
      const dx = event.x - player.state.x;
      const dz = event.z - player.state.z;
      if (dx * dx + dz * dz > limit) continue;
      if (chosen.length >= EVENTS_PER_SNAPSHOT) return chosen;
      chosen.push(event.text);
    }
    return chosen;
  }
}
