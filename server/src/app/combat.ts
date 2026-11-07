/**
 * The world's rules: applies players' inputs, lands their attacks, moves projectiles and runs
 * creatures, all from the server's own state. Clients send only intent (a move, a facing and
 * buttons) and nothing here reads damage, targets or positions from them. It knows nothing about
 * sockets or the database, which come in through WorldHooks.
 */
import { isStatKey, MAX_STAT, type StatKey } from '../../../shared/classes.js';
import { collide, segmentBlocked } from '../../../shared/collision.js';
import {
  attackDamage,
  inMeleeArc,
  staggerPower,
  RESPAWN_SECONDS,
  INTERACT_RANGE,
  WEAPON_STYLES,
  weaponFor,
  upgradeCost,
  type CrescentShape,
  type MeteorShape,
  type ProjectileShape,
  steerToward,
  type WeaponStats,
} from '../../../shared/combat.js';
import {
  findGrace,
  GRACE_DISCOVER_RADIUS,
  GRACE_REST_RANGE,
  GRACE_SEATS,
  graceSeat,
  REST_DANGER_RADIUS,
} from '../../../shared/graces.js';
import { MAP } from '../../../shared/mapData.js';
import type { MapCamp, MapChest, MapGrace } from '../../../shared/mapTypes.js';
import {
  FLAG_ATTACK,
  FLAG_DODGE,
  FLAG_INTERACT,
  FLAG_JUMP,
  FLAG_POTION,
  FLAG_RUN,
  MAX_FLAGS,
  packSnapshot,
  type GameEvent,
  type PlayerInfo,
  type RefusalReason,
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
/** So a meteor can't land inside a wall, where nothing could be reached from the impact. */
const METEOR_CLEARANCE = 0.3;
const RESPAWN_SCATTER = 3;
const CHEST_RETRY_SECONDS = 2;
const CREATURES_PER_SNAPSHOT = 40;
const CREATURE_VIEW_RADIUS = 90;
const EVENT_VIEW_RADIUS = 70;
const EVENTS_PER_SNAPSHOT = 32;
/** These only matter for someone standing still, so checking a few times a second is plenty. */
const DISCOVER_CHECK_TICKS = 6;
const DANGER_CHECK_TICKS = 15;
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
  jump: false,
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
    jump: (flags & FLAG_JUMP) !== 0,
    interact: (flags & FLAG_INTERACT) !== 0,
  };
}

/** Something a player asked for that isn't movement. Everything is checked again when it's carried out. */
export type PlayerAction = { t: 'upgrade'; stat: StatKey } | { t: 'travel'; grace: number } | { t: 'stand' } | { t: 'aim'; c: number };

/** Null for anything that isn't exactly one of these. Only the fixed fields are read. */
export function parseAction(raw: unknown): PlayerAction | null {
  if (typeof raw !== 'string') return null;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
  const { t, stat, grace, c } = message as { t?: unknown; stat?: unknown; grace?: unknown; c?: unknown };
  if (t === 'upgrade') return isStatKey(stat) ? { t, stat } : null;
  if (t === 'travel') return Number.isSafeInteger(grace) && (grace as number) > 0 ? { t, grace: grace as number } : null;
  if (t === 'stand') return { t };
  if (t === 'aim') return Number.isSafeInteger(c) && (c as number) >= 0 ? { t, c: c as number } : null;
  return null;
}

export interface PlayerSetup {
  /** The account, from the verified session. Only ever used as a key on the server. */
  userId: string;
  /** Which of the account's saves this player is. Read from the database, never from the browser. */
  slot: number;
  info: PlayerInfo;
  dust: number;
  enemies: number;
  animals: number;
  chests: readonly number[];
  /** Graces this save has lit. */
  graces: readonly number[];
  /** Where this save last rested, if anywhere. */
  respawnGrace: number | null;
  achievements: readonly string[];
}

export interface WorldPlayer extends CreatureTarget {
  /** The creature the browser says it's locked on to, or 0. Checked again at every cast. */
  aimCreature: number;
  userId: string;
  slot: number;
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
  graces: Set<number>;
  respawnGrace: number | null;
  /** Which seat at the grace, while state.resting says they're sitting. */
  seat: number;
  /** An upgrade is on its way to the database, so another can't be priced until it's back. */
  upgrading: boolean;
  achievements: Set<string>;
  selfChanged: boolean;
  eventsSeen: number;
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
  /** Saves a newly lit grace on this player's save. */
  discoverGrace(player: WorldPlayer, grace: MapGrace): Promise<void>;
  /** Saves where this save comes back after dying. */
  saveRespawn(player: WorldPlayer, grace: MapGrace): Promise<void>;
  /** Spends the dust and raises the stat in one statement. Resolves false if the database says it can't be done. */
  upgradeStat(player: WorldPlayer, stat: StatKey, cost: number): Promise<boolean>;
}

/** The parts of the map the rules read. Tests can stage their own, and it can't be set from outside. */
export interface WorldConfig {
  spawn: { x: number; z: number; radius: number };
  camps: readonly MapCamp[];
  chests: readonly MapChest[];
  graces: readonly MapGrace[];
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
  /** A homing shot's quarry. Null once it's dead, and the shot flies straight from there. */
  target: Creature | null;
  /** Radians a homing shot may turn each tick. */
  turnPerTick: number;
  crescent: CrescentShape | null;
  /** Creatures a crescent has already cut, or that the swing behind it already hit. */
  cut: Set<Creature> | null;
  hits: number;
}

interface Meteor {
  id: number;
  owner: WorldPlayer;
  x: number;
  z: number;
  landsAtTick: number;
  shape: MeteorShape;
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
  /** Counts up, so each player gets each event once whenever their snapshot goes out. */
  order: number;
  tick: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class World {
  readonly players: WorldPlayer[] = [];
  readonly field: CreatureField;
  readonly projectiles: Projectile[] = [];
  readonly meteors: Meteor[] = [];
  time = 0;
  tickNumber = 0;

  private random: () => number;
  private nextPlayerId = 1;
  private nextProjectileId = 1;
  private events: QueuedEvent[] = [];
  private eventCount = 0;
  private snapshotList = '[]';
  private snapshotStamp = 0;
  private scratch: Creature[] = [];
  private readonly steered = { x: 0, z: 1 };
  private scratchDistance = new Map<Creature, number>();
  private nearCreatures: Creature[] = [];
  private nearDistances: number[] = [];

  constructor(
    private hooks: WorldHooks,
    private config: WorldConfig = MAP,
  ) {
    this.random = config.random ?? Math.random;
    this.field = new CreatureField(config.camps, config.graces, {
      players: this.players,
      bite: (creature, target) => this.bite(creature, target as WorldPlayer),
    });
  }

  addPlayer(setup: PlayerSetup): WorldPlayer {
    const { classId, appearance, stats } = setup.info;
    const weapon = weaponFor(classId, appearance.variant);
    const derived = deriveStats(stats, weapon);
    // A save that has rested somewhere starts there. The save holds an id, so a stale one just means the spawn.
    const rested = setup.respawnGrace === null ? undefined : findGrace(this.config.graces, setup.respawnGrace);
    const home = rested ? { x: rested.x, z: rested.z, radius: RESPAWN_SCATTER } : this.config.spawn;
    const angle = this.random() * Math.PI * 2;
    const distance = Math.sqrt(this.random()) * home.radius;
    const state = createState(home.x + Math.cos(angle) * distance, home.z + Math.sin(angle) * distance, derived);
    collide(state, PLAYER_RADIUS);
    const id = this.nextPlayerId++;
    const player: WorldPlayer = {
      id,
      userId: setup.userId,
      slot: setup.slot,
      info: { ...setup.info, id },
      state,
      derived,
      weapon,
      styleIndex: WEAPON_STYLES.indexOf(weapon.style),
      damage: attackDamage(weapon, stats),
      stagger: staggerPower(weapon, stats),
      aimCreature: 0,
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
      graces: new Set(setup.graces),
      respawnGrace: rested ? rested.id : null,
      seat: 0,
      upgrading: false,
      achievements: new Set(setup.achievements),
      selfChanged: false,
      eventsSeen: this.eventCount,
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
    for (const player of this.players) {
      this.runPlayer(player);
      if (this.tickNumber % DISCOVER_CHECK_TICKS === 0) this.discoverNearby(player);
      if (this.tickNumber % DANGER_CHECK_TICKS === 0) this.checkRestDanger(player);
    }
    this.moveProjectiles();
    this.landMeteors();
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
    return state.dodgeTime > 0 || state.attackTime > 0 || state.staggerTime > 0 || state.drinkTime > 0 || state.jumpTime > 0;
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
    // A chest in reach comes first, so that resting nearby can't get in the way of opening it.
    if (input.interact && state.deadTime <= 0 && !this.tryOpenChest(player)) this.tryRest(player);
  }

  private respawn(player: WorldPlayer): void {
    const { state, derived } = player;
    const home = this.homeFor(player);
    const homeX = home.x;
    const homeZ = home.z;
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

  /** The last grace rested at, then the nearest one this save has lit, then the nearest of all, then the spawn. */
  private homeFor(player: WorldPlayer): { x: number; z: number } {
    const { graces, spawn } = this.config;
    const { state } = player;
    const rested = player.respawnGrace === null ? undefined : findGrace(graces, player.respawnGrace);
    if (rested) return rested;
    const lit = graces.filter((grace) => player.graces.has(grace.id));
    let home: { x: number; z: number } = spawn;
    let best = Infinity;
    for (const grace of lit.length > 0 ? lit : graces) {
      const squared = (grace.x - state.x) ** 2 + (grace.z - state.z) ** 2;
      if (squared < best) {
        best = squared;
        home = grace;
      }
    }
    return home;
  }

  private kill(player: WorldPlayer): void {
    const { state } = player;
    state.resting = 0;
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
    // A blow always stands you up. The menu closes with it, on the player's own screen.
    if (state.resting > 0) this.interruptRest(player);
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
      // A crescent starts where the swing ends, so it mustn't hit the same creature a second time.
      const swung = weapon.crescent ? new Set<Creature>() : null;
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
        swung?.add(creature);
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
      if (weapon.crescent) this.launchCrescent(player, weapon.crescent, swung);
    } else if (weapon.meteor) {
      this.castMeteor(player, weapon.meteor);
    } else if (weapon.projectile) {
      this.launchShot(player, weapon.projectile);
    }
  }

  private launchShot(player: WorldPlayer, shape: ProjectileShape): void {
    const { state } = player;
    const { homing } = shape;
    const target = homing ? this.aimTarget(player, homing.coneDegrees, homing.acquireRange, true) : null;
    const turn = homing ? (homing.turnDegreesPerSecond * Math.PI) / 180 : 0;
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
      target,
      turnPerTick: turn * TICK_DT,
      crescent: null,
      cut: null,
      hits: 0,
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
        ...(homing ? { form: 'homing' as const, target: target?.id ?? 0, turn: Math.round(turn * 1000) / 1000 } : {}),
      },
      state.x,
      state.z,
      player.id,
    );
  }

  private launchCrescent(player: WorldPlayer, shape: CrescentShape, swung: Set<Creature> | null): void {
    const { state } = player;
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
      damage: Math.max(1, Math.round(player.damage * shape.damageShare)),
      stagger: player.stagger * shape.staggerShare,
      styleIndex: player.styleIndex,
      target: null,
      turnPerTick: 0,
      crescent: shape,
      cut: swung ?? new Set<Creature>(),
      hits: 0,
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
        form: 'crescent',
        width: shape.width,
      },
      state.x,
      state.z,
      player.id,
    );
  }

  private castMeteor(player: WorldPlayer, shape: MeteorShape): void {
    const { state } = player;
    // It comes from above, so a tree between you and the target doesn't stop you aiming at it.
    const target = this.aimTarget(player, shape.coneDegrees, shape.castRange, false);
    const spot = target
      ? { x: target.x, z: target.z }
      : { x: state.x + Math.sin(state.yaw) * shape.aheadDistance, z: state.z + Math.cos(state.yaw) * shape.aheadDistance };
    collide(spot, METEOR_CLEARANCE);
    const id = this.nextProjectileId++;
    this.meteors.push({
      id,
      owner: player,
      x: spot.x,
      z: spot.z,
      landsAtTick: this.tickNumber + Math.max(1, Math.round(shape.delaySeconds / TICK_DT)),
      shape,
      damage: player.damage,
      stagger: player.stagger,
      styleIndex: player.styleIndex,
    });
    this.emit(
      {
        k: 'meteor',
        id,
        by: player.id,
        x: round2(spot.x),
        z: round2(spot.z),
        delay: shape.delaySeconds,
        radius: shape.radius,
        style: player.styleIndex,
      },
      spot.x,
      spot.z,
      player.id,
    );
  }

  /**
   * What a spell should go for: the creature the player has said they're locked on to if it really
   * is in front of them and in range, or else the nearest one that is. The browser only ever names
   * a preference, so a made-up id or a target behind you gets you exactly what no lock would.
   */
  private aimTarget(player: WorldPlayer, coneDegrees: number, range: number, needsClearLine: boolean): Creature | null {
    const { state, aimCreature } = player;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const edge = Math.cos((coneDegrees * Math.PI) / 360);
    let best: Creature | null = null;
    let bestSquared = Infinity;
    for (const creature of this.field.creatures) {
      if (!creature.alive) continue;
      const dx = creature.x - state.x;
      const dz = creature.z - state.z;
      const squared = dx * dx + dz * dz;
      const reach = range + creature.kind.radius;
      if (squared > reach * reach) continue;
      const locked = aimCreature !== 0 && creature.id === aimCreature;
      if (!locked && squared >= bestSquared) continue;
      if (squared > 0.01 && (dx * sin + dz * cos) / Math.sqrt(squared) < edge) continue;
      // Looked at last, because it's the expensive check.
      if (needsClearLine && segmentBlocked(state.x, state.z, creature.x, creature.z)) continue;
      if (locked) return creature;
      best = creature;
      bestSquared = squared;
    }
    return best;
  }

  private landMeteors(): void {
    for (let index = this.meteors.length - 1; index >= 0; index -= 1) {
      const meteor = this.meteors[index];
      if (meteor.landsAtTick > this.tickNumber) continue;
      this.meteors[index] = this.meteors[this.meteors.length - 1];
      this.meteors.pop();
      this.landMeteor(meteor);
    }
  }

  private landMeteor(meteor: Meteor): void {
    const { owner, shape } = meteor;
    // Before its hits, so the blast is already on screen when the creatures react to it.
    this.emit(
      {
        k: 'meteorEnd',
        id: meteor.id,
        by: owner.id,
        x: round2(meteor.x),
        z: round2(meteor.z),
        radius: shape.radius,
        style: meteor.styleIndex,
      },
      meteor.x,
      meteor.z,
      owner.id,
    );
    const targets = this.scratch;
    const distances = this.scratchDistance;
    targets.length = 0;
    distances.clear();
    for (const creature of this.field.creatures) {
      if (!creature.alive) continue;
      const dx = creature.x - meteor.x;
      const dz = creature.z - meteor.z;
      const squared = dx * dx + dz * dz;
      const limit = shape.radius + creature.kind.radius;
      if (squared > limit * limit) continue;
      targets.push(creature);
      distances.set(creature, squared);
    }
    targets.sort((a, b) => distances.get(a)! - distances.get(b)!);
    let hits = 0;
    for (const creature of targets) {
      if (hits >= shape.maxTargets) break;
      // A wall still shelters whatever is behind it from the blast.
      if (segmentBlocked(meteor.x, meteor.z, creature.x, creature.z)) continue;
      this.hitCreature(creature, owner, meteor.damage, meteor.stagger, meteor.styleIndex);
      hits += 1;
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
    if (shot.crescent) return this.moveCrescent(shot, shot.crescent);
    if (shot.target) {
      if (shot.target.alive) {
        const toX = shot.target.x - shot.x;
        const toZ = shot.target.z - shot.z;
        steerToward(shot.dirX, shot.dirZ, toX, toZ, shot.turnPerTick, this.steered);
        shot.dirX = this.steered.x;
        shot.dirZ = this.steered.z;
      } else {
        shot.target = null;
      }
    }
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

  /** A crescent sweeps a wide band instead of a line, and passes through what it cuts until it's spent. */
  private moveCrescent(shot: Projectile, shape: CrescentShape): boolean {
    const startX = shot.x;
    const startZ = shot.z;
    const travel = Math.min(shape.speed * TICK_DT, shot.remaining);
    const blocked = segmentBlocked(startX, startZ, startX + shot.dirX * travel, startZ + shot.dirZ * travel);
    if (blocked) {
      this.stopAtWall(shot, travel);
    } else {
      shot.x += shot.dirX * travel;
      shot.z += shot.dirZ * travel;
    }
    const reach = blocked ? Math.hypot(shot.x - startX, shot.z - startZ) : travel;
    shot.remaining -= travel;

    const targets = this.scratch;
    const distances = this.scratchDistance;
    targets.length = 0;
    distances.clear();
    for (const creature of this.field.creatures) {
      if (!creature.alive || shot.cut?.has(creature)) continue;
      const toX = creature.x - startX;
      const toZ = creature.z - startZ;
      const { radius } = creature.kind;
      const along = toX * shot.dirX + toZ * shot.dirZ;
      if (along < -radius || along > reach + radius) continue;
      const sideways = Math.abs(toX * shot.dirZ - toZ * shot.dirX);
      if (sideways > shape.width / 2 + radius) continue;
      targets.push(creature);
      distances.set(creature, along);
    }
    targets.sort((a, b) => distances.get(a)! - distances.get(b)!);
    for (const creature of targets) {
      if (shot.hits >= shape.maxTargets) break;
      // Its tips can reach around a wall that the middle of it missed.
      const along = Math.max(0, distances.get(creature)!);
      if (segmentBlocked(startX + shot.dirX * along, startZ + shot.dirZ * along, creature.x, creature.z)) continue;
      shot.cut?.add(creature);
      shot.hits += 1;
      this.hitCreature(creature, shot.owner, shot.damage, shot.stagger, shot.styleIndex);
    }

    if (blocked || shot.hits >= shape.maxTargets) {
      this.finishShot(shot, null, true);
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

  /* Binary Graces. */

  /** Takes a player's word for nothing: every action below reads only the server's own state. */
  handleAction(player: WorldPlayer, action: PlayerAction): void {
    if (action.t === 'aim') {
      player.aimCreature = action.c;
      return;
    }
    if (player.state.deadTime > 0) return;
    if (action.t === 'stand') player.state.resting = 0;
    else if (action.t === 'upgrade') this.tryUpgrade(player, action.stat);
    else this.tryTravel(player, action.grace);
  }

  private refuse(player: WorldPlayer, reason: RefusalReason): void {
    this.hooks.send(player, { t: 'refused', reason });
  }

  private discoverNearby(player: WorldPlayer): void {
    const { state } = player;
    if (state.deadTime > 0) return;
    for (const grace of this.config.graces) {
      if (player.graces.has(grace.id)) continue;
      const dx = grace.x - state.x;
      const dz = grace.z - state.z;
      if (dx * dx + dz * dz <= GRACE_DISCOVER_RADIUS * GRACE_DISCOVER_RADIUS) this.discover(player, grace);
    }
  }

  private discover(player: WorldPlayer, grace: MapGrace): void {
    // Marked before the database answers, so it's only asked once.
    player.graces.add(grace.id);
    this.hooks.send(player, { t: 'grace', id: grace.id });
    this.grant(player, 'first_grace');
    // If this didn't save, it can be lit again on the next visit, because the next login won't list it.
    void this.hooks.discoverGrace(player, grace).catch(() => undefined);
  }

  private tryRest(player: WorldPlayer): void {
    const { state } = player;
    if (state.resting > 0 || this.isBusy(player)) return;
    const grace = this.graceInReach(state);
    if (!grace) return;
    if (this.field.huntersNear(state.x, state.z, REST_DANGER_RADIUS)) {
      this.refuse(player, 'enemies_near');
      return;
    }
    if (!player.graces.has(grace.id)) this.discover(player, grace);
    const seat = this.freeSeat(grace, player);
    if (seat === null) {
      this.refuse(player, 'grace_full');
      return;
    }
    this.sitAt(player, grace, seat);
  }

  private graceInReach(state: SimState): MapGrace | null {
    for (const grace of this.config.graces) {
      const dx = grace.x - state.x;
      const dz = grace.z - state.z;
      if (dx * dx + dz * dz <= GRACE_REST_RANGE * GRACE_REST_RANGE) return grace;
    }
    return null;
  }

  /** The open seat nearest the player, so they sit down where they already are. Null when all are taken. */
  private freeSeat(grace: MapGrace, player: WorldPlayer): number | null {
    const taken = new Set<number>();
    for (const other of this.players) {
      if (other !== player && other.state.resting === grace.id) taken.add(other.seat);
    }
    const { state } = player;
    let best: number | null = null;
    let bestDistance = Infinity;
    for (let seat = 0; seat < GRACE_SEATS; seat += 1) {
      if (taken.has(seat)) continue;
      const spot = graceSeat(grace, seat);
      const squared = (spot.x - state.x) ** 2 + (spot.z - state.z) ** 2;
      if (squared < bestDistance) {
        bestDistance = squared;
        best = seat;
      }
    }
    return best;
  }

  /** Puts the player on the seat, refills everything and makes this grace their way back. */
  private sitAt(player: WorldPlayer, grace: MapGrace, seat: number): void {
    const { state, derived } = player;
    const spot = graceSeat(grace, seat);
    state.x = spot.x;
    state.z = spot.z;
    state.yaw = spot.yaw;
    collide(state, PLAYER_RADIUS);
    state.moving = 0;
    state.resting = grace.id;
    player.seat = seat;
    state.health = derived.maxHealth;
    state.stamina = derived.maxStamina;
    state.magic = derived.maxMagic;
    state.potions = Math.max(state.potions, STARTING_POTIONS);
    state.regenDelay = 0;
    player.respawnGrace = grace.id;
    // Coming back here is a comfort, not a promise: losing this write only means the old spot next login.
    void this.hooks.saveRespawn(player, grace).catch(() => undefined);
  }

  private interruptRest(player: WorldPlayer): void {
    player.state.resting = 0;
    this.refuse(player, 'interrupted');
  }

  /** The ward keeps hunters from reaching a grace, so one getting this close is what ends a rest, and not a free kill. */
  private checkRestDanger(player: WorldPlayer): void {
    const { state } = player;
    if (state.resting > 0 && this.field.huntersNear(state.x, state.z, REST_DANGER_RADIUS)) this.interruptRest(player);
  }

  /** Resting is what the menu needs, and resting always means being at that grace, but this is checked again regardless. */
  private restingGrace(player: WorldPlayer): MapGrace | null {
    const { state } = player;
    if (state.resting <= 0) {
      this.refuse(player, 'not_resting');
      return null;
    }
    const grace = findGrace(this.config.graces, state.resting);
    if (!grace || Math.hypot(grace.x - state.x, grace.z - state.z) > GRACE_REST_RANGE) {
      this.refuse(player, 'too_far');
      return null;
    }
    return grace;
  }

  private tryUpgrade(player: WorldPlayer, stat: StatKey): void {
    if (player.upgrading || !this.restingGrace(player)) return;
    const { info } = player;
    if (info.stats[stat] >= MAX_STAT) {
      this.refuse(player, 'stat_maxed');
      return;
    }
    const cost = upgradeCost(info.level);
    if (player.dust < cost) {
      this.refuse(player, 'no_dust');
      return;
    }
    player.upgrading = true;
    this.hooks.upgradeStat(player, stat, cost).then(
      (done) => {
        player.upgrading = false;
        if (player.gone) return;
        if (done) this.applyUpgrade(player, stat, cost);
        else this.refuse(player, 'try_again');
      },
      () => {
        // Nothing was saved, so nothing was spent.
        player.upgrading = false;
        if (!player.gone) this.refuse(player, 'try_again');
      },
    );
  }

  /** Only after the database agreed: memory follows the save, never the other way around. */
  private applyUpgrade(player: WorldPlayer, stat: StatKey, cost: number): void {
    const { state, weapon } = player;
    player.dust -= cost;
    const stats = { ...player.info.stats, [stat]: player.info.stats[stat] + 1 };
    player.info = { ...player.info, stats, level: player.info.level + 1 };
    player.derived = deriveStats(stats, weapon);
    player.damage = attackDamage(weapon, stats);
    player.stagger = staggerPower(weapon, stats);
    // Resting already means full, and a raised maximum should still look full.
    if (state.resting > 0) {
      state.health = player.derived.maxHealth;
      state.stamina = player.derived.maxStamina;
      state.magic = player.derived.maxMagic;
    }
    player.selfChanged = true;
    this.grant(player, 'first_upgrade');
    // Everyone needs it: nameplates show the level, and Speed changes how long this player's swing lasts.
    for (const other of this.players) this.hooks.send(other, { t: 'info', player: player.info });
    this.hooks.send(player, { t: 'upgraded', stat });
  }

  private tryTravel(player: WorldPlayer, id: number): void {
    const here = this.restingGrace(player);
    if (!here) return;
    const grace = findGrace(this.config.graces, id);
    if (!grace || !player.graces.has(grace.id)) {
      this.refuse(player, 'not_discovered');
      return;
    }
    if (grace === here) return;
    // Hunters nearby would make the seat a trap, so it's the same check as sitting down.
    if (this.field.huntersNear(grace.x, grace.z, REST_DANGER_RADIUS)) {
      this.refuse(player, 'enemies_near');
      return;
    }
    const seat = this.freeSeat(grace, player);
    if (seat === null) {
      this.refuse(player, 'grace_full');
      return;
    }
    this.sitAt(player, grace, seat);
    const { state } = player;
    this.emit({ k: 'respawn', v: player.id }, state.x, state.z, player.id);
  }

  /* Chests. */

  /** True if there was a closed chest in reach, which is then being opened. */
  private tryOpenChest(player: WorldPlayer): boolean {
    if (this.time < player.chestRetryAt) return false;
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
      return true;
    }
    return false;
  }

  /* Snapshots. */

  private emit(event: GameEvent, x: number, z: number, about: number): void {
    this.eventCount += 1;
    this.events.push({ text: JSON.stringify(event), x, z, about, order: this.eventCount, tick: this.tickNumber });
  }

  /** Call before a round of snapshotFor: what's the same for everyone is built only once. */
  beginSnapshots(): void {
    this.snapshotStamp += 1;
    const list = this.players.map((player) => packSnapshot(player.id, player.state));
    this.snapshotList = JSON.stringify(list);
  }

  /**
   * Call after a round of snapshotFor. Players take turns between ticks, so this tick's events stay
   * for the ones whose snapshot goes out next tick. Anything older has reached everyone by now.
   */
  endSnapshots(): void {
    const { events, tickNumber } = this;
    let kept = 0;
    for (const event of events) {
      if (event.tick === tickNumber) events[kept++] = event;
    }
    events.length = kept;
  }

  snapshotFor(player: WorldPlayer): string {
    const { state } = player;
    let text = `{"t":"s","a":${player.lastSeq},"p":${this.snapshotList},"c":[${this.nearbyCreatures(state)}]`;
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

  private nearbyCreatures(state: SimState): string {
    // This runs for every player in every snapshot, so it keeps a short sorted list as it goes
    // instead of sorting everything in view, and reuses the same two arrays.
    const near = this.nearCreatures;
    const distances = this.nearDistances;
    let count = 0;
    const limit = CREATURE_VIEW_RADIUS * CREATURE_VIEW_RADIUS;
    for (const c of this.field.creatures) {
      if (c.mode === Mode.Gone) continue;
      const dx = c.x - state.x;
      const dz = c.z - state.z;
      const d = dx * dx + dz * dz;
      if (d > limit) continue;
      if (count === CREATURES_PER_SNAPSHOT) {
        if (d >= distances[count - 1]) continue;
        count -= 1;
      }
      let spot = count;
      while (spot > 0 && distances[spot - 1] > d) {
        near[spot] = near[spot - 1];
        distances[spot] = distances[spot - 1];
        spot -= 1;
      }
      near[spot] = c;
      distances[spot] = d;
      count += 1;
    }
    let text = '';
    for (let index = 0; index < count; index += 1) {
      text += index === 0 ? this.packCreature(near[index]) : `,${this.packCreature(near[index])}`;
    }
    return text;
  }

  private eventsFor(player: WorldPlayer): string[] {
    const chosen: string[] = [];
    const seen = player.eventsSeen;
    player.eventsSeen = this.eventCount;
    // Your own come first, so a crowd's effects can't push out what happened to you.
    for (const event of this.events) {
      if (event.order <= seen || event.about !== player.id) continue;
      if (chosen.length >= EVENTS_PER_SNAPSHOT) return chosen;
      chosen.push(event.text);
    }
    const limit = EVENT_VIEW_RADIUS * EVENT_VIEW_RADIUS;
    for (const event of this.events) {
      if (event.order <= seen || event.about === player.id) continue;
      const dx = event.x - player.state.x;
      const dz = event.z - player.state.z;
      if (dx * dx + dz * dz > limit) continue;
      if (chosen.length >= EVENTS_PER_SNAPSHOT) return chosen;
      chosen.push(event.text);
    }
    return chosen;
  }
}
