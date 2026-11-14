/**
 * Combat rules, run directly against the world with no sockets and no database, so each case can
 * stage exactly the positions it needs. Staging only works from here: the server builds its world
 * from the real map, and nothing a client sends can reach these fields.
 * Run with `node --import tsx --test test/world.test.ts`. It needs no running stack.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';
import {
  BOSS_MOVES,
  BOSS_STANCE,
  BossMove,
  CRITICAL_DAMAGE_MULTIPLIER,
  criticalDamage,
  inCritWindow,
  packStance,
  packStunLeft,
} from '../../shared/boss.js';
import { CLASSES, DEFAULT_APPEARANCE, MAX_STAT, type ClassId } from '../../shared/classes.js';
import { collide, segmentBlocked } from '../../shared/collision.js';
import {
  attackDamage,
  CHEST_REWARD_DUST,
  CRITICAL_IMPACT_TIME,
  CRITICAL_SECONDS,
  INTERACT_RANGE,
  RESPAWN_SECONDS,
  staggerPower,
  upgradeCost,
  weaponFor,
} from '../../shared/combat.js';
import { CORPSE_SECONDS, CREATURE_BY_ID, CreatureState, MAX_ATTACKERS_PER_PLAYER } from '../../shared/creatures.js';
import { MAP } from '../../shared/mapData.js';
import { GRACE_DISCOVER_RADIUS, GRACE_SEATS } from '../../shared/graces.js';
import type { MapCamp, MapChest, MapGrace } from '../../shared/mapTypes.js';
import {
  FLAG_ATTACK,
  FLAG_DODGE,
  FLAG_INTERACT,
  FLAG_JUMP,
  FLAG_POTION,
  FLAG_RUN,
  MAX_FLAGS,
  type GameEvent,
  type ServerMessage,
  packSnapshot,
} from '../../shared/protocol.js';
import {
  deriveStats,
  DODGE_SECONDS,
  isInvulnerable,
  JUMP_SECONDS,
  MAX_POTIONS,
  PLAYER_RADIUS,
  STAGGER_SECONDS,
  STARTING_POTIONS,
  TICK_RATE,
} from '../../shared/sim.js';
import { parseAction, parseInput, withLoadTestCreatures, World, type ServerInput, type WorldPlayer } from '../src/app/combat.js';
import { Mode, type Creature } from '../src/app/creatures.js';
import { ProgressStore } from '../src/app/progress.js';

const clearance = (x: number, z: number): number => {
  let nearest = Math.min(x - MAP.bounds.minX, MAP.bounds.maxX - x, z - MAP.bounds.minZ, MAP.bounds.maxZ - z);
  for (const collider of MAP.colliders) {
    const reach = collider.t === 'c' ? collider.r : Math.hypot(collider.hw, collider.hd);
    nearest = Math.min(nearest, Math.hypot(collider.x - x, collider.z - z) - reach);
  }
  return nearest;
};

/** The most open spot on the map, so the cases work on any map, with or without real colliders. */
const OPEN = (() => {
  let best = { x: 0, z: 0, room: -Infinity };
  for (let x = MAP.bounds.minX + 10; x < MAP.bounds.maxX; x += 8) {
    for (let z = MAP.bounds.minZ + 10; z < MAP.bounds.maxZ; z += 8) {
      const room = clearance(x, z);
      if (room > best.room) best = { x, z, room };
    }
  }
  return best;
})();

interface Staged {
  world: World;
  sent: Array<{ player: WorldPlayer; message: ServerMessage }>;
  credits: Array<{ player: WorldPlayer; delta: Record<string, number | undefined> }>;
  chestCalls: MapChest[];
  chestAnswer: () => Promise<boolean>;
  unlocks: string[];
  events: GameEvent[];
  /** Advances one tick and collects the events the first player would be sent. */
  tick(count?: number): GameEvent[];
  discovered: number[];
  respawns: number[];
  upgrades: Array<{ stat: string; cost: number }>;
  upgradeAnswer: () => Promise<boolean>;
  join(classId: ClassId, variant?: number, chests?: number[], graces?: number[]): WorldPlayer;
  moveTo(thing: { state: { x: number; z: number } }, dx: number, dz: number): void;
  place(creature: Creature, dx: number, dz: number): void;
  camps: (kind: string, count: number) => MapCamp;
}

function stage(options: { camps?: MapCamp[]; chests?: MapChest[]; graces?: MapGrace[]; rollHigh?: boolean } = {}): Staged {
  const staged: Staged = {
    sent: [],
    credits: [],
    chestCalls: [],
    chestAnswer: async () => true,
    unlocks: [],
    events: [],
    discovered: [],
    respawns: [],
    upgrades: [],
    upgradeAnswer: async () => true,
    tick(count = 1) {
      const collected: GameEvent[] = [];
      for (let index = 0; index < count; index += 1) {
        world.tick();
        world.beginSnapshots();
        const anyone = world.players[0];
        if (anyone) {
          const snapshot = JSON.parse(world.snapshotFor(anyone)) as { e?: GameEvent[] };
          collected.push(...(snapshot.e ?? []));
        }
        world.endSnapshots();
      }
      staged.events.push(...collected);
      return collected;
    },
    join(classId, variant = 0, chests = [], graces = []) {
      const baseStats = CLASSES.find((item) => item.id === classId)!.baseStats;
      const player = world.addPlayer({
        userId: `user-${classId}-${Math.random()}`,
        slot: 1,
        info: {
          id: 0,
          username: 'test',
          avatarUrl: null,
          classId,
          appearance: { ...DEFAULT_APPEARANCE, variant },
          level: 1,
          stats: baseStats,
        },
        dust: 0,
        enemies: 0,
        animals: 0,
        chests,
        graces,
        respawnGrace: null,
        achievements: [],
      });
      staged.moveTo(player, 0, 0);
      return player;
    },
    moveTo(thing, dx, dz) {
      thing.state.x = OPEN.x + dx;
      thing.state.z = OPEN.z + dz;
    },
    place(creature, dx, dz) {
      creature.x = OPEN.x + dx;
      creature.z = OPEN.z + dz;
      creature.wanderX = creature.x;
      creature.wanderZ = creature.z;
    },
    camps: (kind, count) => ({ kind, x: OPEN.x, z: OPEN.z, count, radius: 1 }),
  };
  const world: World = new World(
    {
      send: (player, message) => staged.sent.push({ player, message }),
      credit: (player, delta) => staged.credits.push({ player, delta }),
      openChest: (_player, chest) => {
        staged.chestCalls.push(chest);
        return staged.chestAnswer();
      },
      unlock: async (_player, achievement) => {
        staged.unlocks.push(achievement);
        return true;
      },
      discoverGrace: async (_player, grace) => {
        staged.discovered.push(grace.id);
      },
      saveRespawn: async (_player, grace) => {
        staged.respawns.push(grace.id);
      },
      upgradeStat: (_player, stat, cost) => {
        staged.upgrades.push({ stat, cost });
        return staged.upgradeAnswer();
      },
    },
    {
      spawn: { x: OPEN.x, z: OPEN.z, radius: 2 },
      camps: options.camps ?? [],
      chests: options.chests ?? [],
      graces: options.graces ?? [],
      // Rolling low means every chance succeeds, and the lowest amount comes out.
      random: options.rollHigh ? () => 0.999 : () => 0,
    },
  );
  staged.world = world;
  return staged;
}

let seq = 0;
function input(partial: Partial<ServerInput> = {}): ServerInput {
  seq += 1;
  return { seq, mx: 0, mz: 0, yaw: 0, run: false, dodge: false, attack: false, potion: false, jump: false, interact: false, ...partial };
}

function ofKind<K extends GameEvent['k']>(events: GameEvent[], kind: K): Array<Extract<GameEvent, { k: K }>> {
  return events.filter((event): event is Extract<GameEvent, { k: K }> => event.k === kind);
}

/** Runs with inputs at the normal one per tick until the swing lands. */
function swingUntilHit(staged: Staged, player: WorldPlayer, yaw = 0): { events: GameEvent[]; ticks: number } {
  staged.world.queueInput(player, input({ attack: true, yaw }));
  for (let ticks = 1; ticks < 90; ticks += 1) {
    const events = staged.tick();
    if (events.some((event) => event.k === 'hit' || event.k === 'swing' || event.k === 'shot' || event.k === 'meteor')) return { events, ticks };
    staged.world.queueInput(player, input({ yaw }));
  }
  throw new Error('the swing never landed');
}

/** How many one-per-tick steps pass before an attack reaches its hit moment. */
function stepsToHit(classId: ClassId, variant: number): number {
  const stats = CLASSES.find((item) => item.id === classId)!.baseStats;
  const derived = deriveStats(stats, weaponFor(classId, variant));
  const moment = derived.attackSeconds * (1 - derived.hitAt);
  let time = derived.attackSeconds;
  let steps = 1;
  while (time > moment) {
    time = Math.max(0, time - 1 / TICK_RATE);
    steps += 1;
  }
  return steps;
}

describe('melee', () => {
  it('kills a wolf in two hammer blows, each at the exact step of its hit moment, with the right damage', () => {
    const staged = stage({ camps: [{ kind: 'wolf', x: OPEN.x, z: OPEN.z, count: 1, radius: 1 }] });
    const player = staged.join('juggernaut', 0);
    const wolf = staged.world.field.creatures[0];
    staged.place(wolf, 0, 2);
    const stats = player.info.stats;
    const damage = attackDamage(weaponFor('juggernaut', 0), stats);
    assert.equal(damage, 52, 'a hammer of 46 at Strength 18');
    const expectedSteps = stepsToHit('juggernaut', 0);

    const first = swingUntilHit(staged, player);
    assert.equal(first.ticks, expectedSteps, 'the hit should land on the step the shared rules say');
    const [hit] = ofKind(first.events, 'hit');
    assert.equal(hit.c, wolf.id);
    assert.equal(hit.by, player.id);
    assert.equal(hit.dmg, damage);
    assert.equal(hit.kill, 0);
    assert.equal(hit.stagger, 1, 'a hammer breaks a wolf’s balance');
    assert.equal(wolf.health, 85 - damage);
    assert.equal(wolf.mode, Mode.Stagger);

    // Wait out the rest of the swing.
    while (player.state.attackTime > 0) {
      staged.world.queueInput(player, input());
      staged.tick();
    }
    staged.place(wolf, 0, 2);
    const second = swingUntilHit(staged, player);
    const [killing] = ofKind(second.events, 'hit');
    assert.equal(killing.kill, 1);
    assert.equal(wolf.mode, Mode.Dead);
    const [dust] = ofKind(second.events, 'dust');
    assert.equal(dust.to, player.id);
    assert.equal(dust.n, 4, 'a low roll gives the fewest dust a wolf can drop');
    assert.equal(player.dust, 4);
    assert.equal(player.enemies, 1);
    assert.deepEqual(staged.credits.at(-1)?.delta, { dust: 4, enemies: 1, animals: 0 });

    const self = staged.sent.filter((entry) => entry.message.t === 'self').at(-1)?.message;
    assert.deepEqual(self, { t: 'self', dust: 4, kills: 1 });
    assert.deepEqual(staged.unlocks, ['first_blood']);
  });

  it('lands a burst of inputs on the input that reaches the hit moment, using the facing at that step', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const player = staged.join('duelist', 0);
    const bull = staged.world.field.creatures[0];
    staged.place(bull, 0, 2);
    const steps = stepsToHit('duelist', 0);
    assert.ok(steps > 8 && steps < 16, `the katana should hit after more than one burst, got ${steps}`);

    // Faces away until the very step it hits. Sent all at once, as a client catching up does.
    for (let step = 1; step <= steps; step += 1) {
      staged.world.queueInput(player, input({ attack: step === 1, yaw: step === steps ? 0 : Math.PI }));
    }
    const events = staged.tick(2);
    assert.equal(ofKind(events, 'hit').length, 1, 'eight inputs in the first tick and the rest in the next');
    assert.equal(bull.health, 320 - attackDamage(weaponFor('duelist', 0), player.info.stats));
  });

  it('shows a swing that hits nothing, and leaves what is behind or out of reach alone', () => {
    const staged = stage({ camps: [staged_camp('bull', 2)] });
    const player = staged.join('duelist', 0);
    const [behind, far] = staged.world.field.creatures;
    staged.place(behind, 0, -2);
    staged.place(far, 0, 8);
    const { events } = swingUntilHit(staged, player);
    const [swing] = ofKind(events, 'swing');
    assert.equal(swing.by, player.id);
    assert.equal(ofKind(events, 'hit').length, 0);
    assert.equal(behind.health, 320);
    assert.equal(far.health, 320);
  });

  it('hits no more than the weapon allows, nearest first', () => {
    const staged = stage({ camps: [staged_camp('bull', 4)] });
    const player = staged.join('duelist', 0);
    const creatures = staged.world.field.creatures;
    creatures.forEach((creature, index) => staged.place(creature, 0.1 * index, 1 + index * 0.3));
    const { events } = swingUntilHit(staged, player);
    assert.deepEqual(ofKind(events, 'hit').map((hit) => hit.c), [creatures[0].id, creatures[1].id], 'a katana hits two');
  });

  it('every weapon of every class does its own damage or fires its own shot', () => {
    for (const definition of CLASSES) {
      for (const variant of [0, 1, 2]) {
        const staged = stage({ camps: [staged_camp('bull')] });
        const player = staged.join(definition.id, variant);
        const bull = staged.world.field.creatures[0];
        staged.place(bull, 0, 2);
        const weapon = weaponFor(definition.id, variant);
        const { events, ticks } = swingUntilHit(staged, player);
        assert.equal(ticks, stepsToHit(definition.id, variant), `${weapon.label} timing`);
        const expected = attackDamage(weapon, player.info.stats);
        if (weapon.melee) {
          assert.equal(ofKind(events, 'hit')[0]?.dmg, expected, weapon.label);
        } else if (weapon.meteor) {
          assert.equal(ofKind(events, 'meteor').length, 1, weapon.label);
          const later = staged.tick(Math.round(weapon.meteor.delaySeconds * TICK_RATE));
          assert.equal(ofKind(later, 'hit')[0]?.dmg, expected, weapon.label);
        } else {
          const [shot] = ofKind(events, 'shot');
          assert.equal(shot.speed, weapon.projectile!.speed, weapon.label);
          const later = staged.tick(3);
          assert.equal(ofKind([...events, ...later], 'hit')[0]?.dmg, expected, weapon.label);
        }
        if (weapon.usesMagic) assert.ok(player.state.magic < player.derived.maxMagic, `${weapon.label} uses magic`);
        else assert.ok(player.state.stamina < player.derived.maxStamina, `${weapon.label} uses stamina`);
      }
    }
  });
});

describe('magic weapons', () => {
  /** Holds creatures at these offsets for some ticks, since otherwise they'd charge and shove each other. */
  const heldTicks = (staged: Staged, spots: Array<[number, number]>, count: number): GameEvent[] => {
    const collected: GameEvent[] = [];
    for (let index = 0; index < count; index += 1) {
      staged.world.field.creatures.forEach((creature, at) => staged.place(creature, spots[at][0], spots[at][1]));
      collected.push(...staged.tick());
    }
    return collected;
  };
  const place = (staged: Staged, spots: Array<[number, number]>) =>
    staged.world.field.creatures.forEach((creature, at) => staged.place(creature, spots[at][0], spots[at][1]));
  /** Like swingUntilHit, but the creatures can't close in or interrupt it during the windup. */
  const heldSwing = (staged: Staged, player: WorldPlayer, spots: Array<[number, number]>): { events: GameEvent[] } => {
    staged.world.queueInput(player, input({ attack: true }));
    for (let ticks = 1; ticks < 90; ticks += 1) {
      place(staged, spots);
      const events = staged.tick();
      if (events.some((event) => event.k === 'hit' || event.k === 'swing' || event.k === 'shot' || event.k === 'meteor')) return { events };
      staged.world.queueInput(player, input());
    }
    throw new Error('the swing never landed');
  };

  describe('homing bolts', () => {
    it('curves onto a target that a straight shot would miss', () => {
      const staged = stage({ camps: [staged_camp('bull')] });
      const player = staged.join('arcanist', 1);
      const spots: Array<[number, number]> = [[4, 12]];
      const bull = staged.world.field.creatures[0];
      const { events } = heldSwing(staged, player, spots);
      const [shot] = ofKind(events, 'shot');
      assert.equal(shot.form, 'homing');
      assert.equal(shot.target, bull.id);
      const flight = heldTicks(staged, spots, 30);
      assert.equal(ofKind(flight, 'hit')[0]?.c, bull.id);
      assert.equal(ofKind(flight, 'shotEnd')[0]?.id, shot.id);
    });

    it('turns no faster than its limit', () => {
      const staged = stage({ camps: [staged_camp('bull')] });
      const player = staged.join('arcanist', 1);
      heldSwing(staged, player, [[0, 20]]);
      const [bolt] = staged.world.projectiles;
      assert.ok(Math.abs(bolt.dirX) < 0.001, 'it starts out straight');
      place(staged, [[20, bolt.z - OPEN.z]]);
      staged.tick();
      const limit = (weaponFor('arcanist', 1).projectile!.homing!.turnDegreesPerSecond * Math.PI) / 180 / TICK_RATE;
      assert.ok(Math.abs(Math.atan2(bolt.dirX, bolt.dirZ) - limit) < 0.01, 'one tick should turn it by exactly the limit');
    });

    it('flies straight on if its target dies', () => {
      const staged = stage({ camps: [staged_camp('bull')] });
      const player = staged.join('arcanist', 1);
      const bull = staged.world.field.creatures[0];
      heldSwing(staged, player, [[3, 18]]);
      const [bolt] = staged.world.projectiles;
      bull.health = 0;
      bull.mode = Mode.Dead;
      const { dirX, dirZ } = bolt;
      staged.tick();
      assert.equal(bolt.target, null);
      assert.equal(bolt.dirX, dirX);
      assert.equal(bolt.dirZ, dirZ);
    });

    it('prefers the lock-on target over a nearer one', () => {
      const staged = stage({ camps: [staged_camp('bull', 2)] });
      const player = staged.join('arcanist', 1);
      const far = staged.world.field.creatures[1];
      staged.world.handleAction(player, { t: 'aim', c: far.id });
      assert.equal(ofKind(heldSwing(staged, player, [[0, 6], [3, 16]]).events, 'shot')[0].target, far.id);
    });

    it('will not follow a lock-on target that is behind the caster', () => {
      const staged = stage({ camps: [staged_camp('bull', 2)] });
      const player = staged.join('arcanist', 1);
      const [front, behind] = staged.world.field.creatures;
      staged.world.handleAction(player, { t: 'aim', c: behind.id });
      assert.equal(ofKind(heldSwing(staged, player, [[0, 6], [0, -6]]).events, 'shot')[0].target, front.id);
    });

    it('ignores a lock-on id that matches nothing', () => {
      const staged = stage({ camps: [staged_camp('bull')] });
      const player = staged.join('arcanist', 1);
      const bull = staged.world.field.creatures[0];
      staged.world.handleAction(player, { t: 'aim', c: 999_999 });
      assert.equal(ofKind(heldSwing(staged, player, [[0, 8]]).events, 'shot')[0].target, bull.id);
    });
  });

  describe('meteors', () => {
    const staff = weaponFor('arcanist', 0);
    const meteor = staff.meteor!;
    const delayTicks = Math.round(meteor.delaySeconds * TICK_RATE);

    it('lands only after its delay, and damages all around the impact but nothing beyond it', () => {
      const staged = stage({ camps: [staged_camp('bull', 4)] });
      const player = staged.join('arcanist', 0);
      const creatures = staged.world.field.creatures;
      const reach = meteor.radius + creatures[0].kind.radius;
      const spots: Array<[number, number]> = [[0, 10], [reach - 1, 10], [0, 10 + reach - 1], [0, 10 + reach + 4]];
      const { events } = heldSwing(staged, player, spots);
      const [cast] = ofKind(events, 'meteor');
      assert.equal(cast.by, player.id);
      assert.ok(Math.abs(cast.z - (OPEN.z + 10)) < 0.1, 'it should come down on the target');
      assert.equal(cast.radius, meteor.radius);

      const before = heldTicks(staged, spots, delayTicks - 1);
      assert.equal(ofKind(before, 'hit').length, 0, 'nothing is hurt before it lands');
      assert.equal(ofKind(before, 'meteorEnd').length, 0);
      assert.equal(creatures[0].health, 320);

      const landing = heldTicks(staged, spots, 1);
      assert.equal(ofKind(landing, 'meteorEnd')[0]?.id, cast.id);
      const hit = ofKind(landing, 'hit');
      assert.deepEqual(hit.map((item) => item.c).sort((a, b) => a - b), [creatures[0].id, creatures[1].id, creatures[2].id].sort((a, b) => a - b));
      assert.equal(hit[0].dmg, attackDamage(staff, player.info.stats));
      assert.equal(creatures[3].health, 320, 'the one outside the area is untouched');
      assert.equal(staged.world.meteors.length, 0);
    });

    it('hits its target limit and no more', () => {
      const count = meteor.maxTargets + 3;
      const staged = stage({ camps: [staged_camp('bull', count)] });
      const player = staged.join('arcanist', 0);
      const spots = Array.from({ length: count }, (_, index): [number, number] => [index * 0.2, 10 + index * 0.1]);
      heldSwing(staged, player, spots);
      assert.equal(ofKind(heldTicks(staged, spots, delayTicks), 'hit').length, meteor.maxTargets);
    });

    it('lands a set distance ahead with nothing to aim at, and a creature can walk out of it', () => {
      const staged = stage({ camps: [staged_camp('bull')] });
      const player = staged.join('arcanist', 0);
      const spots: Array<[number, number]> = [[0, -60]];
      const { events } = heldSwing(staged, player, spots);
      const [cast] = ofKind(events, 'meteor');
      if (clearance(OPEN.x, OPEN.z) > meteor.aheadDistance + 1) {
        assert.ok(Math.abs(cast.z - (OPEN.z + meteor.aheadDistance)) < 0.1, 'it should land straight ahead');
      }
      const landing = heldTicks(staged, spots, delayTicks);
      assert.equal(ofKind(landing, 'meteorEnd').length, 1);
      assert.equal(ofKind(landing, 'hit').length, 0);
    });

    it('costs more magic than the other spells and never hurts other players', () => {
      assert.ok(staff.cost > weaponFor('arcanist', 1).cost && staff.cost > weaponFor('arcanist', 2).cost);
      // A deer, because a bull would bite the friend and hide what this is checking.
      const staged = stage({ camps: [staged_camp('deer')] });
      const player = staged.join('arcanist', 0);
      const friend = staged.join('juggernaut', 0);
      const spots: Array<[number, number]> = [[0, 10]];
      staged.moveTo(friend, 0, 10);
      const health = friend.state.health;
      heldSwing(staged, player, spots);
      heldTicks(staged, spots, delayTicks);
      assert.equal(friend.state.health, health);
    });
  });

  describe('crescents', () => {
    const quarterstaff = weaponFor('arcanist', 2);
    const crescent = quarterstaff.crescent!;
    const flightTicks = Math.ceil((crescent.range / crescent.speed) * TICK_RATE) + 1;

    it('cuts through a line of creatures up to its limit, once each', () => {
      const count = crescent.maxTargets + 1;
      const staged = stage({ camps: [staged_camp('bull', count)] });
      const player = staged.join('arcanist', 2);
      const spots = Array.from({ length: count }, (_, index): [number, number] => [0, 5 + index * 1.2]);
      const { events } = heldSwing(staged, player, spots);
      const [shot] = ofKind(events, 'shot');
      assert.equal(shot.form, 'crescent');
      assert.equal(shot.width, crescent.width);
      const flight = [...events, ...heldTicks(staged, spots, flightTicks)];
      const hits = ofKind(flight, 'hit');
      assert.equal(hits.length, crescent.maxTargets);
      assert.equal(new Set(hits.map((hit) => hit.c)).size, crescent.maxTargets, 'never the same one twice');
      assert.equal(hits[0].dmg, Math.round(attackDamage(quarterstaff, player.info.stats) * crescent.damageShare));
      assert.equal(staged.world.field.creatures[count - 1].health, 320, 'the last one was past its limit');
      assert.equal(ofKind(flight, 'shotEnd')[0]?.id, shot.id);
      assert.equal(staged.world.projectiles.length, 0);
    });

    it('reaches to its sides, but not beyond its width and not behind the caster', () => {
      const staged = stage({ camps: [staged_camp('bull', 3)] });
      const player = staged.join('arcanist', 2);
      const [wide, outside, behind] = staged.world.field.creatures;
      const { radius } = wide.kind;
      const spots: Array<[number, number]> = [[crescent.width / 2 + radius - 0.5, 6], [crescent.width / 2 + radius + 2, 6], [0, -(radius + 2)]];
      heldSwing(staged, player, spots);
      heldTicks(staged, spots, flightTicks);
      assert.ok(wide.health < 320, 'its tip should reach this one');
      assert.equal(outside.health, 320);
      assert.equal(behind.health, 320);
    });

    it('does not hit a creature the swing itself just hit', () => {
      const staged = stage({ camps: [staged_camp('bull')] });
      const player = staged.join('arcanist', 2);
      const spots: Array<[number, number]> = [[0, 2]];
      const { events } = heldSwing(staged, player, spots);
      const flight = [...events, ...heldTicks(staged, spots, flightTicks)];
      const hits = ofKind(flight, 'hit');
      assert.equal(hits.length, 1);
      assert.equal(hits[0].dmg, attackDamage(quarterstaff, player.info.stats));
    });
  });
});

function staged_camp(kind: string, count = 1): MapCamp {
  return { kind, x: OPEN.x, z: OPEN.z, count, radius: 1 };
}

describe('projectiles', () => {
  it('flies at its own speed and hits the first creature in line', () => {
    const staged = stage({ camps: [staged_camp('bull', 2)] });
    const player = staged.join('ranger', 0);
    const [near, behindIt] = staged.world.field.creatures;
    staged.place(near, 0, 10);
    staged.place(behindIt, 0, 14);
    const { events } = swingUntilHit(staged, player);
    const [shot] = ofKind(events, 'shot');
    assert.equal(shot.by, player.id);
    assert.equal(near.health, 320, 'an arrow takes time to arrive');

    const flight = staged.tick(12);
    const [hit] = ofKind(flight, 'hit');
    const [end] = ofKind(flight, 'shotEnd');
    assert.equal(hit.c, near.id);
    assert.equal(hit.dmg, attackDamage(weaponFor('ranger', 0), player.info.stats));
    assert.equal(end.id, shot.id);
    assert.equal(end.hit, 1);
    assert.equal(behindIt.health, 320, 'the arrow should stop at the first target');
    assert.equal(staged.world.projectiles.length, 0);
  });

  it('fizzles out at its range', () => {
    const staged = stage();
    const player = staged.join('ranger', 1);
    const { events } = swingUntilHit(staged, player);
    const [shot] = ofKind(events, 'shot');
    let end: Extract<GameEvent, { k: 'shotEnd' }> | undefined;
    for (let ticks = 0; ticks < 60 && !end; ticks += 1) end = ofKind(staged.tick(), 'shotEnd')[0];
    assert.ok(end, 'the shot should end');
    assert.equal(end.id, shot.id);
    if (clearance(OPEN.x, OPEN.z) > weaponFor('ranger', 1).projectile!.range) {
      assert.equal(end.hit, 0);
      assert.ok(Math.abs(end.z - shot.z - shot.range) < 0.1, 'it should end at its range');
    }
  });

  it('passes through other players and never hurts them', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const shooter = staged.join('ranger', 0);
    const friend = staged.join('juggernaut', 0);
    const bull = staged.world.field.creatures[0];
    staged.moveTo(friend, 0, 3);
    staged.place(bull, 0, 16);
    const friendHealth = friend.state.health;
    swingUntilHit(staged, shooter);
    staged.tick(15);
    assert.equal(friend.state.health, friendHealth, 'no player-versus-player damage');
    assert.ok(bull.health < 320, 'the arrow should reach the bull behind the friend');
  });

  it('does no damage to a friend with a melee weapon either', () => {
    const staged = stage();
    const attacker = staged.join('juggernaut', 0);
    const friend = staged.join('ranger', 0);
    staged.moveTo(friend, 0, 1.5);
    const health = friend.state.health;
    const { events } = swingUntilHit(staged, attacker);
    assert.equal(ofKind(events, 'swing').length, 1);
    assert.equal(friend.state.health, health);
  });

  it('stops at the map’s colliders', (t) => {
    const collider = MAP.colliders.find((item) => item.t === 'c' && clearance(item.x, item.z + item.r + 12) > 0);
    if (!collider || collider.t !== 'c') {
      t.skip('this map has no colliders');
      return;
    }
    const staged = stage({ camps: [staged_camp('bull')] });
    const player = staged.join('ranger', 0);
    player.state.x = collider.x;
    player.state.z = collider.z + collider.r + 3;
    collide(player.state, PLAYER_RADIUS);
    const bull = staged.world.field.creatures[0];
    bull.x = collider.x;
    bull.z = collider.z - collider.r - 2;
    collide(bull, 1);
    assert.ok(segmentBlocked(player.state.x, player.state.z, bull.x, bull.z), 'the collider should be between them');
    // Facing the collider, which is the -z direction.
    swingUntilHit(staged, player, Math.PI);
    const flight = staged.tick(20);
    const [end] = ofKind(flight, 'shotEnd');
    assert.equal(end.hit, 1, 'stopping at a wall still counts as hitting something');
    assert.ok(end.z >= collider.z + collider.r - 0.5, `it should stop at the collider, stopped at ${end.z}`);
    assert.equal(bull.health, 320);
  });
});

describe('creatures attacking players', () => {
  it('a wolf finds and bites a stationary player who sends no inputs, who then dies and respawns', () => {
    const grace = { id: 1, x: OPEN.x + 70, z: OPEN.z, name: 'Test Grace' };
    const staged = stage({ camps: [staged_camp('wolf')], graces: [grace] });
    const player = staged.join('ranger', 0);
    const wolf = staged.world.field.creatures[0];
    staged.place(wolf, -5, 0);
    player.state.potions = 1;
    const maxHealth = player.derived.maxHealth;

    let firstBite: Extract<GameEvent, { k: 'bite' }> | undefined;
    for (let ticks = 0; ticks < TICK_RATE * 10 && !firstBite; ticks += 1) firstBite = ofKind(staged.tick(), 'bite')[0];
    assert.ok(firstBite, 'the wolf should have bitten within 10 seconds');
    assert.equal(firstBite.dmg, 12);
    assert.equal(firstBite.v, player.id);
    assert.equal(firstBite.c, wolf.id);
    assert.equal(player.state.health, maxHealth - 12);
    assert.equal(player.state.staggerTime, STAGGER_SECONDS);
    assert.ok(Math.hypot(player.state.knockX, player.state.knockZ) > 0.99, 'the bite should knock back');

    // With no inputs, the server has to run the stagger out by itself.
    const position = { x: player.state.x, z: player.state.z };
    staged.tick(TICK_RATE);
    assert.ok(player.state.staggerTime < STAGGER_SECONDS, 'the stagger should run down with no inputs');
    assert.ok(position.x !== player.state.x || position.z !== player.state.z, 'the knockback should move the player');

    let death: GameEvent | undefined;
    for (let ticks = 0; ticks < TICK_RATE * 60 && !death; ticks += 1) death = ofKind(staged.tick(), 'death')[0];
    assert.ok(death, 'a player who just stands there should die');
    assert.equal(player.state.health, 0);
    assert.equal(player.state.deadTime > 0, true);
    assert.deepEqual(staged.credits.at(-1)?.delta, { deaths: 1 });

    const healthAtDeath = player.state.health;
    staged.tick();
    assert.equal(player.state.health, healthAtDeath, 'the dead aren’t bitten');

    let respawn: GameEvent | undefined;
    let ticksDead = 1;
    for (; ticksDead < TICK_RATE * (RESPAWN_SECONDS + 1) && !respawn; ticksDead += 1) {
      respawn = ofKind(staged.tick(), 'respawn')[0];
    }
    assert.ok(respawn, 'the player should come back with no inputs');
    assert.ok(Math.abs(ticksDead / TICK_RATE - RESPAWN_SECONDS) < 0.2, `respawned after ${ticksDead / TICK_RATE} s`);
    assert.equal(player.state.health, maxHealth);
    assert.equal(player.state.stamina, player.derived.maxStamina);
    assert.equal(player.state.potions, STARTING_POTIONS);
    assert.equal(player.state.deadTime, 0);
    assert.ok(Math.hypot(player.state.x - grace.x, player.state.z - grace.z) < 5, 'back at the grace');
  });

  it('keeps a higher potion count through a respawn', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const player = staged.join('ranger', 0);
    player.state.potions = MAX_POTIONS;
    player.state.health = 1;
    const bull = staged.world.field.creatures[0];
    staged.place(bull, 2, 0);
    for (let ticks = 0; ticks < TICK_RATE * 20 && player.state.deadTime <= 0; ticks += 1) staged.tick();
    assert.ok(player.state.deadTime > 0, 'the bull should have killed the player');
    staged.tick(TICK_RATE * (RESPAWN_SECONDS + 1));
    assert.equal(player.state.potions, MAX_POTIONS);
  });

  function windingUp(staged: Staged, player: WorldPlayer, kind = 0): Creature {
    const creature = staged.world.field.creatures[kind];
    staged.place(creature, 0, 1.2);
    creature.yaw = Math.PI;
    creature.mode = Mode.Windup;
    creature.timer = 0.05;
    creature.target = player;
    return creature;
  }

  it('misses a player in the safe frames of a dodge, and hits one past them', () => {
    const safe = stage({ camps: [staged_camp('wolf')] });
    const dodger = safe.join('duelist', 0);
    dodger.state.dodgeTime = 0.5;
    assert.ok(isInvulnerable(dodger.state, dodger.derived), 'the start of a dodge is safe');
    windingUp(safe, dodger);
    const health = dodger.state.health;
    safe.tick(3);
    assert.equal(dodger.state.health, health, 'the bite should miss during the safe frames');
    assert.deepEqual(ofKind(safe.events, 'bite'), []);

    const late = stage({ camps: [staged_camp('wolf')] });
    const slow = late.join('duelist', 0);
    slow.state.dodgeTime = 0.05;
    assert.ok(!isInvulnerable(slow.state, slow.derived), 'the end of a dodge is not safe');
    windingUp(late, slow);
    late.tick(3);
    assert.equal(ofKind(late.events, 'bite').length, 1);
    assert.equal(slow.state.dodgeTime, 0, 'being knocked off balance ends the roll');
  });

  it('can’t keep a dodge’s safe frames going by no longer sending inputs', () => {
    const staged = stage();
    const player = staged.join('duelist', 0);
    staged.world.queueInput(player, input({ dodge: true }));
    staged.tick();
    assert.ok(isInvulnerable(player.state, player.derived), 'just started dodging');
    staged.tick(TICK_RATE);
    assert.equal(player.state.dodgeTime, 0, 'the dodge should have run out on the server’s clock');
    assert.ok(!isInvulnerable(player.state, player.derived));
  });

  it('can’t slow a dodge down by sending inputs slowly', () => {
    const staged = stage();
    const player = staged.join('duelist', 0);
    staged.world.queueInput(player, input({ dodge: true }));
    staged.tick();
    for (let tick = 0; tick < 25; tick += 1) {
      if (tick % 5 === 0) staged.world.queueInput(player, input());
      staged.tick();
    }
    assert.equal(player.state.dodgeTime, 0, 'one input every five ticks shouldn’t stretch the dodge');
  });

  it('lets a strike miss a player who walked out of range or out of its locked-in facing', () => {
    const staged = stage({ camps: [staged_camp('wolf')] });
    const player = staged.join('duelist', 0);
    const wolf = windingUp(staged, player);
    staged.moveTo(player, 0, 8);
    staged.tick(2);
    assert.equal(ofKind(staged.events, 'bite').length, 0, 'out of range');

    const side = stage({ camps: [staged_camp('wolf')] });
    const dodger = side.join('duelist', 0);
    const biter = windingUp(side, dodger);
    biter.yaw = 0;
    side.tick(2);
    assert.equal(ofKind(side.events, 'bite').length, 0, 'behind where it locked its facing');
    assert.ok(wolf.mode === Mode.Strike || wolf.mode === Mode.Recover);
  });

  it('never lets more than the limit wind up on one player', () => {
    const camps = [0, 1, 2, 3, 4, 5, 6, 7].map(() => staged_camp('wolf'));
    const staged = stage({ camps });
    const player = staged.join('juggernaut', 0);
    const creatures = staged.world.field.creatures;
    creatures.forEach((creature, index) => {
      const angle = (index / creatures.length) * Math.PI * 2;
      staged.place(creature, Math.cos(angle) * 5, Math.sin(angle) * 5);
    });
    player.state.health = 1e6;
    let mostAtOnce = 0;
    let everCircled = false;
    for (let ticks = 0; ticks < TICK_RATE * 15; ticks += 1) {
      staged.tick();
      const attacking = creatures.filter((creature) => creature.mode === Mode.Windup || creature.mode === Mode.Strike);
      mostAtOnce = Math.max(mostAtOnce, attacking.length);
      if (creatures.some((creature) => creature.mode === Mode.Circle)) everCircled = true;
    }
    assert.ok(mostAtOnce >= 2, `several should get a turn, most at once was ${mostAtOnce}`);
    assert.ok(mostAtOnce <= MAX_ATTACKERS_PER_PLAYER, `${mostAtOnce} attacked at once`);
    assert.ok(everCircled, 'the rest should circle');
  });

  it('sends one wolf of a pack at a time', () => {
    const staged = stage({ camps: [{ ...staged_camp('wolf', 4), radius: 3 }] });
    const player = staged.join('juggernaut', 0);
    player.state.health = 1e6;
    const creatures = staged.world.field.creatures;
    creatures.forEach((creature, index) => staged.place(creature, index * 2 - 3, 5));
    let starts = 0;
    const was = new Set<Creature>();
    let lastStart = -Infinity;
    let closest = Infinity;
    for (let ticks = 0; ticks < TICK_RATE * 15; ticks += 1) {
      staged.tick();
      for (const creature of creatures) {
        const winding = creature.mode === Mode.Windup;
        if (winding && !was.has(creature)) {
          if (starts > 0) closest = Math.min(closest, ticks - lastStart);
          starts += 1;
          lastStart = ticks;
        }
        if (winding) was.add(creature);
        else was.delete(creature);
      }
    }
    assert.ok(starts >= 3, `the pack should keep attacking, got ${starts}`);
    assert.ok(closest >= TICK_RATE, `two started only ${closest} ticks apart`);
  });
});

describe('creature behavior', () => {
  it('sleeps with no player near, and wakes when one comes', () => {
    const staged = stage({ camps: [staged_camp('wolf')] });
    const player = staged.join('ranger', 0);
    staged.moveTo(player, 200, 200);
    player.state.x = OPEN.x + 500;
    const wolf = staged.world.field.creatures[0];
    const position = [wolf.x, wolf.z];
    staged.tick(TICK_RATE * 2);
    assert.equal(wolf.mode, Mode.Sleep);
    assert.deepEqual([wolf.x, wolf.z], position, 'asleep means not moving at all');

    staged.moveTo(player, 50, 0);
    staged.tick(TICK_RATE);
    assert.equal(wolf.mode, Mode.Idle);

    player.state.x = OPEN.x + 500;
    staged.tick(TICK_RATE);
    assert.equal(wolf.mode, Mode.Sleep, 'goes back to sleep');
  });

  it('wanders within its camp', () => {
    const camp = { ...staged_camp('wolf'), radius: 4 };
    const staged = stage({ camps: [camp], rollHigh: true });
    const player = staged.join('ranger', 0);
    staged.moveTo(player, 40, 0);
    const wolf = staged.world.field.creatures[0];
    let moved = 0;
    let farthest = 0;
    let last = [wolf.x, wolf.z];
    for (let ticks = 0; ticks < TICK_RATE * 30; ticks += 1) {
      staged.tick();
      moved += Math.hypot(wolf.x - last[0], wolf.z - last[1]);
      last = [wolf.x, wolf.z];
      farthest = Math.max(farthest, Math.hypot(wolf.x - camp.x, wolf.z - camp.z));
    }
    assert.ok(moved > 1, `it should have wandered, moved ${moved}`);
    assert.ok(farthest < camp.radius + 2, `it should stay near its camp, got ${farthest}`);
  });

  it('gives chase, goes home past its leash, heals on the way and forgets who hit it', () => {
    const staged = stage({ camps: [staged_camp('wolf')] });
    const player = staged.join('ranger', 0);
    const wolf = staged.world.field.creatures[0];
    staged.place(wolf, 0, 2);
    swingUntilHit(staged, player);
    staged.tick(10);
    assert.ok(wolf.health < 85, 'the arrow should have hit');
    assert.ok(wolf.hitters.has(player));
    assert.ok([Mode.Alert, Mode.Chase, Mode.Circle, Mode.Windup, Mode.Strike, Mode.Recover].includes(wolf.mode as never));

    wolf.mode = Mode.Chase;
    wolf.target = player;
    staged.place(wolf, 45, 0);
    staged.moveTo(player, 60, 0);
    staged.tick(3);
    assert.equal(wolf.mode, Mode.Return);
    assert.equal(wolf.hitters.size, 0, 'loot credit clears when it gives up');
    const healthThen = wolf.health;
    staged.tick(TICK_RATE);
    assert.ok(wolf.health > healthThen, 'it heals on the way home');
  });

  it('staggers when its balance breaks, and that resets 3 seconds after the last hit', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const player = staged.join('duelist', 0);
    const bull = staged.world.field.creatures[0];
    staged.place(bull, 0, 2);
    const power = player.stagger;
    assert.ok(power < 90, 'one katana cut shouldn’t stagger a bull');
    swingUntilHit(staged, player);
    assert.ok(Math.abs(bull.poise - power) < 1e-6);
    assert.notEqual(bull.mode, Mode.Stagger);

    // Most of the way to breaking, but the last hit is too old to count.
    bull.poise = 89;
    bull.lastPoiseHit = staged.world.time - 3.5;
    staged.tick(30);
    staged.place(bull, 0, 2);
    // Calm again, so that it can't bite the player out of the swing.
    bull.mode = Mode.Sleep;
    swingUntilHit(staged, player);
    assert.ok(bull.poise < 89 && bull.mode !== Mode.Stagger, 'old poise damage should be gone');

    while (player.state.attackTime > 0) {
      staged.world.queueInput(player, input());
      staged.tick();
    }
    bull.mode = Mode.Sleep;
    staged.place(bull, 0, 2);
    bull.poise = 89;
    bull.lastPoiseHit = staged.world.time;
    const { events } = swingUntilHit(staged, player);
    assert.equal(ofKind(events, 'hit')[0].stagger, 1);
    assert.equal(bull.mode, Mode.Stagger);
  });

  it('prey runs as a herd from a player or from a hit on one of them', () => {
    const camp = { ...staged_camp('deer', 4), radius: 3 };
    const staged = stage({ camps: [camp] });
    const player = staged.join('ranger', 0);
    staged.moveTo(player, 30, 0);
    const herd = staged.world.field.creatures;
    herd.forEach((deer, index) => staged.place(deer, index, 0));
    staged.tick(TICK_RATE);
    assert.ok(herd.every((deer) => deer.mode === Mode.Idle), 'grazing, with the player far off');

    staged.moveTo(player, herd[0].x - OPEN.x - 3, 0);
    staged.tick(4);
    assert.ok(herd.every((deer) => deer.mode === Mode.Flee), 'one seeing the player sets them all off');
    const startDistance = Math.hypot(herd[0].x - player.state.x, herd[0].z - player.state.z);
    staged.tick(TICK_RATE);
    assert.equal(herd[0].visual, CreatureState.Run);
    assert.ok(Math.hypot(herd[0].x - player.state.x, herd[0].z - player.state.z) > startDistance + 3, 'running away');
  });

  it('prey hears a runner from farther off than a careful walker', () => {
    const staged = stage({ camps: [staged_camp('deer')] });
    const player = staged.join('ranger', 0);
    const deer = staged.world.field.creatures[0];
    staged.place(deer, 0, 0);
    // Inside its usual 8 m, but outside the shorter distance for someone walking.
    staged.moveTo(player, -6, 0);
    for (let index = 0; index < TICK_RATE; index += 1) {
      staged.place(deer, 0, 0);
      staged.world.tick();
    }
    assert.equal(deer.mode, Mode.Idle, 'a walker at 6 m goes unnoticed');
    for (let index = 0; index < 6; index += 1) {
      staged.world.queueInput(player, { seq: 1000 + index, mx: 0, mz: 1, yaw: 0, run: true, dodge: false, attack: false, potion: false, jump: false, interact: false });
      staged.place(deer, 0, 0);
      staged.world.tick();
    }
    assert.equal(deer.mode, Mode.Flee, 'a runner at the same spot sets it off');
  });

  it('a cornered animal keeps running instead of going home to heal and forgetting who hit it', () => {
    const staged = stage({ camps: [staged_camp('deer')] });
    const player = staged.join('ranger', 0);
    const deer = staged.world.field.creatures[0];
    deer.mode = Mode.Idle;
    deer.hitters.set(player, 0);
    deer.health = 10;
    staged.tick(3);
    assert.equal(deer.mode, Mode.Flee);
    // Held in place, as if pressed into a corner, for far longer than a hunter would keep trying.
    for (let index = 0; index < TICK_RATE * 8; index += 1) {
      staged.place(deer, 0, 3);
      staged.world.tick();
      assert.equal(deer.mode, Mode.Flee);
    }
    assert.equal(deer.hitters.size, 1);
    assert.equal(deer.health, 10);
  });

  it('prey hears a runner from farther off than a walker, so a careful walk can get close', () => {
    const staged = stage({ camps: [staged_camp('deer')] });
    const player = staged.join('ranger', 0);
    const deer = staged.world.field.creatures[0];
    staged.moveTo(player, 30, 0);
    staged.place(deer, 0, 0);
    staged.tick(TICK_RATE);
    assert.equal(deer.mode, Mode.Idle);
    // 6 m is inside the deer's usual 8, but outside the 3.6 it notices a walker at.
    staged.moveTo(player, deer.x - OPEN.x - 6, 0);
    player.state.moving = 1;
    staged.tick(4);
    assert.equal(deer.mode, Mode.Idle, 'a walker goes unnoticed');
    player.state.moving = 2;
    staged.world.queueInput(player, { seq: player.newestSeq + 1, mx: 0, mz: 0, yaw: 0, run: true, dodge: true, attack: false, potion: false, jump: false, interact: false });
    staged.tick(4);
    assert.equal(deer.mode, Mode.Flee, 'a dodge roll is loud');
  });

  it('a hit from far off sets a herd running', () => {
    const staged = stage({ camps: [{ ...staged_camp('stag', 3), radius: 3 }] });
    const player = staged.join('ranger', 0);
    const herd = staged.world.field.creatures;
    // Held in place until the arrow lands, since a wandering stag can step out of its line.
    const hold = () => herd.forEach((stag, index) => staged.place(stag, index, 25));
    hold();
    staged.tick(TICK_RATE);
    hold();
    swingUntilHit(staged, player);
    for (let index = 0; index < TICK_RATE && ofKind(staged.events, 'hit').length === 0; index += 1) {
      hold();
      staged.tick();
    }
    assert.ok(ofKind(staged.events, 'hit').length > 0, 'the arrow should have landed');
    staged.tick(3);
    assert.ok(herd.every((stag) => stag.mode === Mode.Flee || stag.mode === Mode.Stagger), 'the whole herd reacts');
  });

  it('a bull ignores players until they get close, then charges', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const player = staged.join('ranger', 0);
    const bull = staged.world.field.creatures[0];
    staged.place(bull, 0, 15);
    staged.tick(TICK_RATE * 2);
    assert.equal(bull.mode, Mode.Idle, '15 away is too far to care');

    staged.place(bull, 0, 6);
    staged.tick(TICK_RATE);
    assert.equal(bull.visual, CreatureState.Run);
  });

  it('keeps out of the circle around a grace and gives up on a player standing in one', () => {
    const grace = { id: 1, x: OPEN.x, z: OPEN.z, name: 'Test Grace' };
    const staged = stage({ camps: [{ ...staged_camp('wolf'), x: OPEN.x, z: OPEN.z + 14 }], graces: [grace] });
    const player = staged.join('ranger', 0);
    const wolf = staged.world.field.creatures[0];
    wolf.x = OPEN.x;
    wolf.z = OPEN.z + 11;
    for (let ticks = 0; ticks < TICK_RATE * 10; ticks += 1) {
      staged.tick();
      assert.ok(Math.hypot(wolf.x - grace.x, wolf.z - grace.z) >= 9.99, 'it should stay out of the circle');
    }
    assert.equal(ofKind(staged.events, 'bite').length, 0);
    assert.ok(player.state.health > 0);
  });

  it('pushes apart from others in the same spot', () => {
    const staged = stage({ camps: [staged_camp('deer', 2)] });
    const player = staged.join('ranger', 0);
    staged.moveTo(player, 30, 0);
    const [first, second] = staged.world.field.creatures;
    staged.place(first, 0, 0);
    staged.place(second, 0.05, 0);
    staged.tick(TICK_RATE * 2);
    assert.ok(Math.hypot(first.x - second.x, first.z - second.z) > 1, 'they should have spread out');
  });

  it('leaves a corpse, then comes back at its camp with full health after its respawn time', () => {
    const staged = stage({ camps: [staged_camp('fox')] });
    const player = staged.join('juggernaut', 0);
    const fox = staged.world.field.creatures[0];
    staged.place(fox, 0, 2);
    hold(fox);
    const { events } = swingUntilHit(staged, player);
    assert.equal(ofKind(events, 'hit')[0].kill, 1);
    assert.equal(player.animals, 1);
    assert.equal(fox.visual, CreatureState.Dead);

    const before = JSON.parse(snapshotText(staged, player)) as { c: number[][] };
    assert.equal(before.c[0][5], CreatureState.Dead, 'the corpse is still shown');
    staged.tick(TICK_RATE * (CORPSE_SECONDS + 1));
    const after = JSON.parse(snapshotText(staged, player)) as { c: number[][] };
    assert.deepEqual(after.c, [], 'then removed');
    const respawnSeconds = CREATURE_BY_ID.get('fox')!.kind.respawnSeconds;
    staged.tick(TICK_RATE * (respawnSeconds - CORPSE_SECONDS));
    assert.ok(fox.alive, 'it should be back');
    assert.equal(fox.health, 20);
    assert.ok(Math.hypot(fox.x - OPEN.x, fox.z - OPEN.z) < 15, 'at its camp, even if it ran a little since');
  });
});

/** Keeps prey from running off before a slow swing lands. */
function hold(creature: Creature): void {
  creature.mode = Mode.Stagger;
  creature.timer = 5;
}

function snapshotText(staged: Staged, player: WorldPlayer): string {
  staged.world.beginSnapshots();
  const text = staged.world.snapshotFor(player);
  staged.world.endSnapshots();
  return text;
}

describe('loot and credit', () => {
  it('gives everyone who hit in the last 20 seconds their own full roll, and nothing to anyone else', () => {
    const staged = stage({ camps: [staged_camp('stag')] });
    const killer = staged.join('juggernaut', 0);
    const helper = staged.join('duelist', 0);
    const late = staged.join('duelist', 0);
    const bystander = staged.join('duelist', 0);
    const stag = staged.world.field.creatures[0];
    stag.health = 30;
    stag.hitters.set(helper, staged.world.time - 19);
    stag.hitters.set(late, staged.world.time - 21);
    staged.place(stag, 0, 2);
    hold(stag);

    const { events } = swingUntilHit(staged, killer);
    const dust = ofKind(events, 'dust');
    assert.deepEqual(dust.map((item) => item.to).sort(), [killer.id, helper.id].sort());
    for (const item of dust) assert.equal(item.n, 6, 'each gets a full amount, not a split');
    assert.equal(killer.dust, 6);
    assert.equal(helper.dust, 6);
    assert.equal(late.dust, 0);
    assert.equal(bystander.dust, 0);
    assert.equal(killer.animals, 1);
    assert.equal(helper.animals, 1);
    assert.equal(late.animals, 0);
    const credited = staged.credits.map((item) => item.player);
    assert.ok(credited.includes(killer) && credited.includes(helper));
    assert.ok(!credited.includes(late));

    // Totals go only to the player who earned them.
    const selfTo = staged.sent.filter((entry) => entry.message.t === 'self').map((entry) => entry.player);
    assert.deepEqual(new Set(selfTo), new Set([killer, helper]));
  });

  it('can roll no dust, and still counts the kill', () => {
    const staged = stage({ camps: [staged_camp('fox')], rollHigh: true });
    const player = staged.join('juggernaut', 0);
    const fox = staged.world.field.creatures[0];
    staged.place(fox, 0, 2);
    hold(fox);
    const { events } = swingUntilHit(staged, player);
    assert.equal(ofKind(events, 'dust').length, 0);
    assert.equal(player.animals, 1);
    assert.deepEqual(staged.credits.at(-1)?.delta, { dust: 0, enemies: 0, animals: 1 });
  });

  it('awards the hunting achievement at ten animals and only once', async () => {
    const staged = stage({ camps: [staged_camp('fox')] });
    const player = staged.join('juggernaut', 0);
    player.animals = 9;
    const fox = staged.world.field.creatures[0];
    staged.place(fox, 0, 2);
    hold(fox);
    swingUntilHit(staged, player);
    await Promise.resolve();
    assert.deepEqual(staged.unlocks, ['beast_hunter'], 'a fox is an animal, not an enemy');
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(staged.sent.some((entry) => entry.player === player && entry.message.t === 'unlock'));
    assert.ok(player.achievements.has('beast_hunter'));
  });
});

describe('chests', () => {
  const chest: MapChest = { id: 7, x: OPEN.x, z: OPEN.z + 2, yaw: 0, dust: CHEST_REWARD_DUST };

  it('opens once within range, however long the button is held', async () => {
    const staged = stage({ chests: [chest] });
    const player = staged.join('ranger', 0);
    player.state.potions = 1;
    for (let index = 0; index < 8; index += 1) staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(staged.chestCalls.length, 1, 'only one request, even before the database answers');
    await new Promise((resolve) => setImmediate(resolve));
    staged.tick();
    const message = staged.sent.find((entry) => entry.message.t === 'chest');
    assert.equal(message?.player, player);
    assert.deepEqual(message?.message, { t: 'chest', id: 7, dust: CHEST_REWARD_DUST, potion: 1 });
    assert.equal(player.dust, CHEST_REWARD_DUST);
    assert.equal(player.state.potions, 2);
    assert.ok(staged.sent.some((entry) => entry.message.t === 'self'), 'the new total should follow');
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(staged.chestCalls.length, 1);
  });

  it('gives no potion past the limit, and no chest without being asked, out of range, or when dead', async () => {
    const staged = stage({ chests: [chest] });
    const player = staged.join('ranger', 0);
    player.state.potions = MAX_POTIONS;

    staged.world.queueInput(player, input());
    staged.tick();
    assert.equal(staged.chestCalls.length, 0, 'standing next to it does nothing');

    staged.moveTo(player, 0, chest.z - OPEN.z - INTERACT_RANGE - 0.1);
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(staged.chestCalls.length, 0, 'just past the range');

    staged.moveTo(player, 0, 0);
    player.state.deadTime = 2;
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(staged.chestCalls.length, 0, 'the dead open nothing');

    player.state.deadTime = 0;
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(staged.sent.find((entry) => entry.message.t === 'chest')?.message, {
      t: 'chest',
      id: 7,
      dust: CHEST_REWARD_DUST,
      potion: 0,
    });
    assert.equal(player.state.potions, MAX_POTIONS);
  });

  it('stays shut for an account that already opened it, after reconnecting', () => {
    const staged = stage({ chests: [chest] });
    const player = staged.join('ranger', 0, [chest.id]);
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(staged.chestCalls.length, 0);
  });

  it('gives nothing if the database says this account already opened it', async () => {
    const staged = stage({ chests: [chest] });
    staged.chestAnswer = async () => false;
    const player = staged.join('ranger', 0);
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(player.dust, 0);
    assert.equal(staged.sent.filter((entry) => entry.message.t === 'chest').length, 0);
  });

  it('gives nothing while the database is down, keeps running, and can be tried again later', async () => {
    const staged = stage({ chests: [chest] });
    staged.chestAnswer = () => Promise.reject(new Error('database down'));
    const player = staged.join('ranger', 0);
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(player.dust, 0);
    assert.ok(!player.chests.has(chest.id));

    // Holding the button doesn't keep hammering a database that's having trouble.
    staged.chestCalls.length = 0;
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(staged.chestCalls.length, 0);

    staged.chestAnswer = async () => true;
    staged.tick(TICK_RATE * 3);
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(player.dust, CHEST_REWARD_DUST);
  });
});

describe('inputs', () => {
  const message = (d: unknown) => JSON.stringify({ t: 'i', d });

  it('accepts every flag in the contract, as the right buttons', () => {
    const all = parseInput(message([1, 0, 0, 0, MAX_FLAGS]));
    assert.deepEqual(
      [all?.run, all?.dodge, all?.attack, all?.potion, all?.interact, all?.jump],
      [true, true, true, true, true, true],
    );
    const flags = [FLAG_RUN, FLAG_DODGE, FLAG_ATTACK, FLAG_POTION, FLAG_INTERACT, FLAG_JUMP];
    const names = ['run', 'dodge', 'attack', 'potion', 'interact', 'jump'] as const;
    flags.forEach((flag, index) => {
      const parsed = parseInput(message([1, 0, 0, 0, flag]));
      for (const [other, name] of names.entries()) assert.equal(parsed?.[name], other === index, `${name} for flag ${flag}`);
    });
  });

  it('refuses flags outside the contract, and anything that isn’t a whole number', () => {
    for (const flags of [MAX_FLAGS + 1, 64, 1024, -1, 1.5, '1', null, true, [1], 1e308]) {
      assert.equal(parseInput(message([1, 0, 0, 0, flags])), null, `flags ${JSON.stringify(flags)}`);
    }
  });

  it('refuses input that’s out of range or the wrong shape', () => {
    for (const bad of [[1.5, 0, 0, 0, 0], [-1, 0, 0, 0, 0], [1, 9, 0, 0, 0], [1, 0, -9, 0, 0], [1, 0, 0, 1001, 0], [1, 0, 0, 0], [1, 0, 0, 0, 0, 0], 'x', null]) {
      assert.equal(parseInput(message(bad)), null, JSON.stringify(bad));
    }
    for (const raw of ['{', '[]', 'null', '{"t":"x","d":[1,0,0,0,0]}', '{"t":"hit","c":1,"dmg":9999}', '{"t":"chest","id":1}', 5, null]) {
      assert.equal(parseInput(raw), null, String(raw));
    }
  });

  it('throws away everything but the five input values, so a message can name no target or damage', () => {
    const parsed = parseInput(JSON.stringify({ t: 'i', d: [1, 0, 0, 0, FLAG_ATTACK], dmg: 99999, target: 1, x: 5, z: 5, health: 99999, dust: 99999 }));
    assert.deepEqual(Object.keys(parsed!).sort(), ['attack', 'dodge', 'interact', 'jump', 'mx', 'mz', 'potion', 'run', 'seq', 'yaw']);
  });

  it('deals no damage without a swing, and no more damage than swings allow however fast the button is sent', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const player = staged.join('juggernaut', 0);
    player.state.stamina = 1e6;
    const bull = staged.world.field.creatures[0];
    bull.health = 1e6;
    const pin = () => staged.place(bull, 0, 1.5);
    pin();

    // Every message a client could make that isn't an attack, sitting right beside a creature.
    for (let index = 0; index < 60; index += 1) {
      staged.world.queueInput(player, input({ yaw: 0, run: true, potion: true, interact: true }));
      staged.tick();
      pin();
    }
    assert.equal(bull.health, 1e6);

    // A flood of attack presses, far faster than the real rate, for three seconds.
    const seconds = 3;
    for (let index = 0; index < TICK_RATE * seconds; index += 1) {
      for (let burst = 0; burst < 10; burst += 1) staged.world.queueInput(player, input({ yaw: 0, attack: true }));
      staged.tick();
      pin();
      player.state.health = player.derived.maxHealth;
      player.state.staggerTime = 0;
    }
    const hits = ofKind(staged.events, 'hit').length;
    const most = Math.ceil(seconds / player.derived.attackSeconds) + 1;
    assert.ok(hits >= 1 && hits <= most, `${hits} hits in ${seconds} seconds, at most ${most} allowed`);
    assert.equal(bull.health, 1e6 - hits * player.damage);
  });

  it('drops an input that isn’t newer than one already queued', () => {
    const staged = stage();
    const player = staged.join('ranger', 0);
    const newest = input();
    staged.world.queueInput(player, newest);
    staged.world.queueInput(player, { ...newest });
    staged.world.queueInput(player, { ...newest, seq: newest.seq - 1 });
    assert.equal(player.inputs.length, 1);
  });

  it('keeps the input rate limit: a burst moves no faster than the budget allows', () => {
    const staged = stage();
    const player = staged.join('ranger', 0);
    const start = player.state.z;
    for (let index = 0; index < 30; index += 1) staged.world.queueInput(player, input({ mz: 1 }));
    staged.tick();
    assert.equal(player.inputs.length, 22, 'eight inputs of budget in the first tick');
    staged.tick();
    assert.equal(player.inputs.length, 21, 'then one per tick');
    const moved = player.state.z - start;
    const legal = player.derived.moveSpeed * (9 / TICK_RATE);
    assert.ok(Math.abs(moved - legal) < 1e-6 || clearance(OPEN.x, OPEN.z) < 2, `moved ${moved}, legal ${legal}`);
  });

  it('stops showing a player as walking once their inputs stop', () => {
    const staged = stage();
    const player = staged.join('ranger', 0);
    staged.world.queueInput(player, input({ mz: 1 }));
    staged.tick();
    assert.equal(player.state.moving, 1);
    staged.tick(10);
    assert.equal(player.state.moving, 0);
  });

  it('drinks a potion and tells everyone nearby', () => {
    const staged = stage();
    const player = staged.join('ranger', 0);
    player.state.health = 10;
    staged.world.queueInput(player, input({ potion: true }));
    const events = staged.tick();
    assert.deepEqual(ofKind(events, 'drink'), [{ k: 'drink', v: player.id }]);
    assert.equal(player.state.health, 10, 'the health arrives part way through the drink');
    for (let index = 0; index < TICK_RATE; index += 1) {
      staged.world.queueInput(player, input({}));
      staged.tick();
    }
    assert.ok(player.state.health > 10);
  });
});

describe('spawning', () => {
  it('starts players around the spawn point and outside anything solid, on the real map', () => {
    const world = new World({
      send: () => undefined,
      credit: () => undefined,
      openChest: async () => false,
      unlock: async () => false,
      discoverGrace: async () => undefined,
      saveRespawn: async () => undefined,
      upgradeStat: async () => false,
    });
    for (let index = 0; index < 50; index += 1) {
      const player = world.addPlayer({
        userId: String(index),
        slot: 1,
        graces: [],
        respawnGrace: null,
        info: {
          id: 0,
          username: 'test',
          avatarUrl: null,
          classId: 'ranger',
          appearance: DEFAULT_APPEARANCE,
          level: 1,
          stats: CLASSES[3].baseStats,
        },
        dust: 0,
        enemies: 0,
        animals: 0,
        chests: [],
        achievements: [],
      });
      const { x, z } = player.state;
      const probe = { x, z };
      collide(probe, PLAYER_RADIUS);
      assert.deepEqual(probe, { x, z }, 'a spawn point should not be inside anything');
      assert.ok(Math.hypot(x - MAP.spawn.x, z - MAP.spawn.z) < MAP.spawn.radius + 4, 'near the spawn');
    }
  });

  it('builds creatures from every camp on the map, inside the map, ignoring unknown kinds', () => {
    const world = new World({
      send: () => undefined,
      credit: () => undefined,
      openChest: async () => false,
      unlock: async () => false,
      discoverGrace: async () => undefined,
      saveRespawn: async () => undefined,
      upgradeStat: async () => false,
    });
    const expected = MAP.camps.reduce((sum, camp) => sum + (CREATURE_BY_ID.has(camp.kind) ? camp.count : 0), 0);
    assert.equal(world.field.creatures.length, expected);
    for (const creature of world.field.creatures) {
      assert.ok(creature.x >= MAP.bounds.minX && creature.x <= MAP.bounds.maxX, 'inside the map');
      assert.ok(creature.z >= MAP.bounds.minZ && creature.z <= MAP.bounds.maxZ, 'inside the map');
    }
    const staged = stage({ camps: [{ ...staged_camp('wolf', 2) }, { ...staged_camp('dragon', 2) }] });
    assert.equal(staged.world.field.creatures.length, 2);
  });
});

describe('snapshots', () => {
  it('lists every player, with only the nearest 40 creatures within 90 meters', () => {
    const staged = stage({ camps: [staged_camp('deer', 60)] });
    const player = staged.join('ranger', 0);
    const other = staged.join('ranger', 0);
    other.state.x = OPEN.x + 400;
    const creatures = staged.world.field.creatures;
    creatures.forEach((creature, index) => {
      creature.x = OPEN.x + (index < 50 ? 10 + index : 95);
      creature.z = OPEN.z;
    });
    const snapshot = JSON.parse(snapshotText(staged, player)) as { a: number; p: number[][]; c: number[][] };
    assert.deepEqual(snapshot.p.map((entry) => entry[0]).sort(), [player.id, other.id].sort());
    assert.equal(snapshot.p[0].length, packSnapshot(player.id, player.state).length);
    assert.equal(snapshot.c.length, 40);
    const shown = new Set(snapshot.c.map((entry) => entry[0]));
    for (let index = 0; index < 40; index += 1) assert.ok(shown.has(creatures[index].id), `nearest ${index} is shown`);
    assert.equal(snapshot.c[0].length, 7);
    const deerIndex = CREATURE_BY_ID.get('deer')!.index;
    assert.equal(snapshot.c.find((entry) => entry[0] === creatures[0].id)?.[1], deerIndex);
    const far = JSON.parse(snapshotText(staged, other)) as { c: number[][] };
    assert.deepEqual(far.c, [], 'a player 400 away sees none of them');
  });

  it('shows events within 70 meters, and your own from anywhere', () => {
    const staged = stage({ camps: [staged_camp('bull')] });
    const attacker = staged.join('juggernaut', 0);
    const near = staged.join('ranger', 0);
    const far = staged.join('ranger', 0);
    const bull = staged.world.field.creatures[0];
    staged.place(bull, 0, 2);
    staged.moveTo(near, 60, 0);
    far.state.x = OPEN.x + 300;

    staged.world.queueInput(attacker, input({ attack: true }));
    for (let ticks = 0; ticks < 90; ticks += 1) {
      staged.world.tick();
      staged.world.beginSnapshots();
      const seen = [attacker, near, far].map((player) => (JSON.parse(staged.world.snapshotFor(player)) as { e?: GameEvent[] }).e ?? []);
      staged.world.endSnapshots();
      if (seen[0].length === 0) {
        staged.world.queueInput(attacker, input());
        continue;
      }
      assert.equal(seen[0][0].k, 'hit');
      assert.equal(seen[1][0]?.k, 'hit', 'someone 60 away sees it');
      assert.deepEqual(seen[2], [], 'someone 300 away doesn’t');
      return;
    }
    assert.fail('the swing never landed');
  });

  it('caps events per snapshot, always keeping your own', () => {
    const staged = stage();
    const others = Array.from({ length: 40 }, () => staged.join('juggernaut', 0));
    const me = staged.join('juggernaut', 0);
    staged.moveTo(me, 0, 0);
    me.state.health = 10;
    for (const other of others) {
      other.state.health = 10;
      staged.world.queueInput(other, input({ potion: true }));
    }
    staged.world.queueInput(me, input({ potion: true }));
    staged.world.tick();
    staged.world.beginSnapshots();
    const snapshot = JSON.parse(staged.world.snapshotFor(me)) as { e: GameEvent[] };
    staged.world.endSnapshots();
    assert.equal(snapshot.e.length, 32);
    assert.deepEqual(snapshot.e[0], { k: 'drink', v: me.id }, 'your own come first');
  });

  it('never sends an account id or anything else private', () => {
    const staged = stage({ camps: [staged_camp('wolf')] });
    const player = staged.join('ranger', 0);
    assert.ok(!snapshotText(staged, player).includes(player.userId));
  });
});

describe('saving progress', () => {
  function fake(fail = false) {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const control = { fail };
    const store = new ProgressStore(async (text, params) => {
      calls.push({ text, params });
      if (control.fail) throw new Error('database down');
      return { rows: [], rowCount: 1 };
    });
    return { store, calls, control };
  }

  it('batches everyone into one statement with parameters, and saves nothing when nothing changed', async () => {
    const { store, calls } = fake();
    await store.flush();
    assert.equal(calls.length, 0);
    store.add('a', 1, { dust: 3, enemies: 1 });
    store.add('a', 1, { dust: 2 });
    store.add('b', 1, { animals: 1, deaths: 1 });
    await store.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [['a', 'b'], [1, 1], [5, 0], [1, 0], [0, 1], [0, 1], [0, 0], [0, 0]]);
    assert.ok(!calls[0].text.includes("'a'"), 'values only ever travel as parameters');
    await store.flush();
    assert.equal(calls.length, 1, 'already saved');
  });

  it('keeps what failed to save for the next batch, and never loses or doubles it', async () => {
    const { store, calls, control } = fake(true);
    store.add('a', 1, { dust: 5 });
    await store.flush();
    assert.equal(store.unsaved('a', 1)?.dust, 5, 'still held in memory');
    store.add('a', 1, { dust: 1 });
    control.fail = false;
    await store.flush();
    assert.deepEqual(calls[1].params[2], [6]);
    assert.equal(store.unsaved('a', 1), undefined);
  });

  it('never rejects into the game loop when the database fails', async () => {
    const { store } = fake(true);
    store.add('a', 1, { dust: 1 });
    await store.flush();
    await store.flushUser('a');
    await store.settle();
    assert.equal(store.unsaved('a', 1)?.dust, 1);
  });

  it('saves one player at once when they leave, without touching the others', async () => {
    const { store, calls } = fake();
    store.add('a', 1, { dust: 1 });
    store.add('b', 1, { dust: 2 });
    await store.flushUser('a');
    assert.deepEqual(calls[0].params[0], ['a']);
    assert.equal(store.unsaved('b', 1)?.dust, 2);
  });

  it('doesn’t start a second batch while one is running', async () => {
    let finish!: () => void;
    let count = 0;
    const store = new ProgressStore(() => {
      count += 1;
      return new Promise((resolve) => {
        finish = () => resolve({ rows: [], rowCount: 1 });
      });
    });
    store.add('a', 1, { dust: 1 });
    const first = store.flush();
    store.add('b', 1, { dust: 1 });
    await store.flush();
    assert.equal(count, 1);
    finish();
    await first;
    assert.equal(store.unsaved('b', 1)?.dust, 1, 'picked up by the next one');
  });

  it('reports a chest as new only if the database row was new', async () => {
    let rowCount = 1;
    const store = new ProgressStore(async () => ({ rows: [], rowCount }));
    assert.equal(await store.openChest('a', 1, 1, 40), true);
    rowCount = 0;
    assert.equal(await store.openChest('a', 1, 1, 40), false);
    assert.equal(await store.unlock('a', 'first_blood'), false);
  });
});

describe('Binary Graces', () => {
  const grace: MapGrace = { id: 7, x: OPEN.x, z: OPEN.z, name: 'Near Grace' };
  const distant: MapGrace = { id: 8, x: OPEN.x + 70, z: OPEN.z, name: 'Distant Grace' };
  /** Long enough for the checks the world only makes every so often to have run. */
  const CHECK_TICKS = 40;

  const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

  function refusals(staged: Staged, player: WorldPlayer): string[] {
    return staged.sent.flatMap(({ player: to, message }) => (to === player && message.t === 'refused' ? [message.reason] : []));
  }

  /** Beside the grace, and sat down by pressing E like anyone else. */
  function seated(staged: Staged, classId: ClassId = 'duelist', lit: number[] = [grace.id]): WorldPlayer {
    const player = staged.join(classId, 0, [], lit);
    staged.moveTo(player, 0, 2.5);
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(player.state.resting, grace.id, 'should be sitting');
    return player;
  }

  it('lights once when walked near, and only for the one who walked there', () => {
    const staged = stage({ graces: [grace] });
    const walker = staged.join('duelist');
    staged.moveTo(walker, 0, GRACE_DISCOVER_RADIUS - 0.5);
    const faraway = staged.join('ranger');
    staged.moveTo(faraway, 0, GRACE_DISCOVER_RADIUS + 30);
    staged.tick(CHECK_TICKS);
    assert.deepEqual(staged.discovered, [grace.id], 'saved once, for one player');
    assert.ok(walker.graces.has(grace.id));
    assert.ok(!faraway.graces.has(grace.id));
    assert.equal(staged.sent.filter(({ message }) => message.t === 'grace').length, 1);
    assert.ok(staged.unlocks.includes('first_grace'));
  });

  it('refills everything and saves the way back, in separate seats, and stands up on moving', () => {
    const staged = stage({ graces: [grace] });
    const first = seated(staged);
    first.state.health = 1;
    first.state.potions = 0;
    const second = seated(staged);
    assert.equal(second.state.health, second.derived.maxHealth);
    assert.deepEqual(staged.respawns, [grace.id, grace.id]);
    assert.notEqual(first.seat, second.seat, 'no two people on one seat');
    assert.ok(Math.hypot(first.state.x - second.state.x, first.state.z - second.state.z) > 1);

    staged.world.queueInput(second, input({ mx: 0, mz: 1 }));
    staged.tick();
    assert.equal(second.state.resting, 0, 'moving stands you up');
    assert.equal(first.state.resting, grace.id, 'and only you');
  });

  it('turns the next person away when every seat is taken', () => {
    const staged = stage({ graces: [grace] });
    for (let seat = 0; seat < GRACE_SEATS; seat += 1) seated(staged);
    const late = staged.join('duelist', 0, [], [grace.id]);
    staged.moveTo(late, 0, 2.5);
    staged.world.queueInput(late, input({ interact: true }));
    staged.tick();
    assert.equal(late.state.resting, 0);
    assert.deepEqual(refusals(staged, late), ['grace_full']);
  });

  it('won’t let you sit with a hunter awake nearby, and a hunter arriving interrupts', () => {
    const staged = stage({ graces: [grace], camps: [{ kind: 'wolf', x: OPEN.x, z: OPEN.z + 40, count: 1, radius: 1 }] });
    const player = seated(staged);
    const wolf = staged.world.field.creatures[0];
    staged.place(wolf, 0, 11);
    wolf.mode = Mode.Chase;
    staged.tick(CHECK_TICKS);
    assert.equal(player.state.resting, 0, 'interrupted');
    assert.deepEqual(refusals(staged, player), ['interrupted']);

    staged.moveTo(player, 0, 2.5);
    staged.place(wolf, 0, 11);
    wolf.mode = Mode.Chase;
    staged.world.queueInput(player, input({ interact: true }));
    staged.tick();
    assert.equal(player.state.resting, 0);
    assert.ok(refusals(staged, player).includes('enemies_near'));
  });

  it('only raises a stat for someone resting, with enough dust, and under the cap', async () => {
    const staged = stage({ graces: [grace] });
    const standing = staged.join('duelist', 0, [], [grace.id]);
    standing.dust = 10_000;
    staged.world.handleAction(standing, { t: 'upgrade', stat: 'health' });
    assert.deepEqual(refusals(staged, standing), ['not_resting']);

    const poor = seated(staged);
    poor.dust = upgradeCost(poor.info.level) - 1;
    staged.world.handleAction(poor, { t: 'upgrade', stat: 'health' });
    assert.deepEqual(refusals(staged, poor), ['no_dust']);

    const capped = seated(staged);
    capped.dust = 10_000;
    capped.info = { ...capped.info, stats: { ...capped.info.stats, health: MAX_STAT } };
    staged.world.handleAction(capped, { t: 'upgrade', stat: 'health' });
    assert.deepEqual(refusals(staged, capped), ['stat_maxed']);

    await flushPromises();
    assert.deepEqual(staged.upgrades, [], 'none of these reached the database');
  });

  it('spends the server’s own price, once, and updates derived stats only after the database agrees', async () => {
    const staged = stage({ graces: [grace] });
    const player = seated(staged);
    const cost = upgradeCost(player.info.level);
    player.dust = cost * 2 + 3;
    const healthBefore = player.info.stats.health;
    const maxBefore = player.derived.maxHealth;

    staged.world.handleAction(player, { t: 'upgrade', stat: 'health' });
    // A second click while the first is on its way must not be a second purchase.
    staged.world.handleAction(player, { t: 'upgrade', stat: 'health' });
    assert.equal(player.info.stats.health, healthBefore, 'nothing changes until the database answers');
    await flushPromises();

    assert.deepEqual(staged.upgrades, [{ stat: 'health', cost }]);
    assert.equal(player.dust, cost + 3);
    assert.equal(player.info.stats.health, healthBefore + 1);
    assert.equal(player.info.level, 2);
    assert.ok(player.derived.maxHealth > maxBefore);
    assert.equal(player.state.health, player.derived.maxHealth, 'still shown full while resting');
    assert.ok(staged.unlocks.includes('first_upgrade'));
    const shown = staged.sent.filter(({ message }) => message.t === 'info').length;
    assert.ok(shown >= 1, 'other players hear about it');
  });

  it('changes nothing when the database says no or fails', async () => {
    const staged = stage({ graces: [grace] });
    const player = seated(staged);
    player.dust = 1000;
    staged.upgradeAnswer = async () => false;
    staged.world.handleAction(player, { t: 'upgrade', stat: 'speed' });
    await flushPromises();
    staged.upgradeAnswer = async () => {
      throw new Error('database down');
    };
    staged.world.handleAction(player, { t: 'upgrade', stat: 'speed' });
    await flushPromises();
    assert.equal(player.dust, 1000);
    assert.equal(player.info.level, 1);
    assert.deepEqual(refusals(staged, player), ['try_again', 'try_again']);
  });

  it('only travels from resting, and only to graces this save has lit', () => {
    const staged = stage({ graces: [grace, distant] });
    const standing = staged.join('duelist', 0, [], [grace.id, distant.id]);
    staged.world.handleAction(standing, { t: 'travel', grace: distant.id });
    assert.deepEqual(refusals(staged, standing), ['not_resting']);

    const player = seated(staged);
    const { x, z } = player.state;
    staged.world.handleAction(player, { t: 'travel', grace: distant.id });
    staged.world.handleAction(player, { t: 'travel', grace: 999 });
    assert.deepEqual(refusals(staged, player), ['not_discovered', 'not_discovered']);
    assert.deepEqual([player.state.x, player.state.z], [x, z], 'stayed put');
    assert.equal(player.state.resting, grace.id);

    player.graces.add(distant.id);
    staged.world.handleAction(player, { t: 'travel', grace: distant.id });
    assert.equal(player.state.resting, distant.id);
    assert.ok(Math.hypot(player.state.x - distant.x, player.state.z - distant.z) < 5);
    assert.deepEqual(staged.respawns.at(-1), distant.id);
  });

  it('reads nothing but the fixed fields from a request, and turns away anything else', () => {
    const bad = [
      'nonsense',
      '[]',
      'null',
      '{}',
      '{"t":"upgrade"}',
      '{"t":"upgrade","stat":"__proto__"}',
      '{"t":"upgrade","stat":"constructor"}',
      '{"t":"upgrade","stat":["health"]}',
      '{"t":"upgrade","stat":"HEALTH"}',
      '{"t":"travel"}',
      '{"t":"travel","grace":"1"}',
      '{"t":"travel","grace":-1}',
      '{"t":"travel","grace":0}',
      '{"t":"travel","grace":1.5}',
      '{"t":"travel","grace":1e400}',
      '{"t":"rest"}',
    ];
    for (const text of bad) assert.equal(parseAction(text), null, text);
    assert.equal(parseAction(7), null);
    assert.deepEqual(parseAction('{"t":"upgrade","stat":"health","cost":0,"level":99}'), { t: 'upgrade', stat: 'health' });
    assert.deepEqual(parseAction('{"t":"travel","grace":3,"x":0}'), { t: 'travel', grace: 3 });
    assert.deepEqual(parseAction('{"t":"stand"}'), { t: 'stand' });
    assert.deepEqual(parseAction('{"t":"aim","c":4,"x":0}'), { t: 'aim', c: 4 });
    assert.deepEqual(parseAction('{"t":"aim","c":0}'), { t: 'aim', c: 0 });
    for (const text of ['{"t":"aim"}', '{"t":"aim","c":-1}', '{"t":"aim","c":1.5}', '{"t":"aim","c":"3"}', '{"t":"aim","c":1e400}']) {
      assert.equal(parseAction(text), null, text);
    }
  });

  it('keeps unsaved dust apart for each save, and passes the slot to every query', async () => {
    const calls: Array<{ params: unknown[] }> = [];
    const store = new ProgressStore(async (_text, params) => {
      calls.push({ params });
      return { rows: [], rowCount: 1 };
    });
    store.add('a', 1, { dust: 5 });
    store.add('a', 2, { dust: 7 });
    assert.equal(store.unsaved('a', 1)?.dust, 5);
    assert.equal(store.unsaved('a', 2)?.dust, 7);
    assert.equal(store.unsaved('b', 1), undefined);
    await store.flush();
    calls.length = 0;
    assert.equal(await store.upgradeStat('a', 2, 'health', 12, 1), true);
    assert.deepEqual(calls.at(-1)?.params, ['a', 2, 12, 1, MAX_STAT]);
    await store.discoverGrace('a', 3, 9);
    assert.deepEqual(calls.at(-1)?.params, ['a', 3, 9]);
  });
});

describe('performance', () => {
  it('only adds load test creatures when asked with a sensible number', () => {
    const base = { spawn: { x: 0, z: 0, radius: 1 }, camps: [{ kind: 'wolf', x: 0, z: 0, count: 2, radius: 1 }], chests: [], graces: [] };
    const count = (config: typeof base) => config.camps.reduce((sum, camp) => sum + camp.count, 0);
    for (const unset of [0, 1, Number.NaN, 2000, 1.5, -5]) assert.equal(withLoadTestCreatures(base, unset), base, String(unset));
    assert.equal(count(withLoadTestCreatures(base, 200)), 200);
    assert.equal(count(withLoadTestCreatures(base, 203)), 203);
  });

  it('runs 200 creatures and 60 players, all awake and all near each other, well under budget', () => {
    const camps: MapCamp[] = [];
    for (let index = 0; index < 40; index += 1) {
      const kind = ['wolf', 'deer', 'stag', 'fox', 'bull'][index % 5];
      const angle = (index / 40) * Math.PI * 2;
      camps.push({ kind, x: OPEN.x + Math.cos(angle) * 40, z: OPEN.z + Math.sin(angle) * 40, count: 5, radius: 8 });
    }
    const staged = stage({ camps });
    assert.equal(staged.world.field.creatures.length, 200);
    const players: WorldPlayer[] = [];
    const classes: ClassId[] = ['juggernaut', 'duelist', 'arcanist', 'ranger'];
    for (let index = 0; index < 60; index += 1) {
      const player = staged.join(classes[index % 4], index % 3);
      player.state.health = 1e9;
      const angle = (index / 60) * Math.PI * 2;
      staged.moveTo(player, Math.cos(angle) * 35, Math.sin(angle) * 35);
      players.push(player);
    }
    const durations: number[] = [];
    const ticks = TICK_RATE * 20;
    const cpuAtStart = process.cpuUsage();
    for (let tick = 0; tick < ticks; tick += 1) {
      const startedAt = performance.now();
      for (const player of players) {
        staged.world.queueInput(player, input({ mx: Math.sin(tick * 0.02), mz: Math.cos(tick * 0.02), yaw: tick * 0.1, attack: tick % 30 === 0, run: true }));
      }
      staged.world.tick();
      if (tick % 2 === 0) {
        staged.world.beginSnapshots();
        for (const player of players) staged.world.snapshotFor(player);
        staged.world.endSnapshots();
      }
      durations.push(performance.now() - startedAt);
    }
    // Time this process actually ran, which stays honest on a machine busy with other work.
    const cpu = process.cpuUsage(cpuAtStart);
    const cpuPerTick = (cpu.user + cpu.system) / 1000 / ticks;
    durations.sort((a, b) => a - b);
    const p50 = durations[durations.length >> 1];
    const p99 = durations[Math.floor(durations.length * 0.99)];
    const awake = staged.world.field.creatures.filter((creature) => creature.mode !== Mode.Sleep).length;
    console.log(`world step without sockets: cpu ${cpuPerTick.toFixed(2)} ms per tick, p50 ${p50.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, max ${durations.at(-1)!.toFixed(2)} ms, awake ${awake}`);
    // Only a rough check, since other work on this machine shows up here too. server/loadtest.cjs is the real measure.
    assert.ok(cpuPerTick < 5, `${cpuPerTick.toFixed(2)} ms of CPU per tick`);
  });
});

/* The Great Bull boss. Each case leaves one move off cooldown and skips the wake-up, so it sees exactly one move. */

const BOSS_ENTRY = CREATURE_BY_ID.get('bull_boss')!;

function bossFight(): { staged: Staged; boss: Creature } {
  const staged = stage({ camps: [staged_camp('bull_boss')] });
  const boss = staged.world.field.creatures[0];
  staged.place(boss, 0, 0);
  return { staged, boss };
}

/** Only this move can be picked. Any id outside the list leaves it with none. */
function onlyMove(boss: Creature, id: number): void {
  const { readyAt } = boss.boss!;
  for (let index = 0; index < readyAt.length; index += 1) readyAt[index] = index === id ? 0 : Infinity;
}

/** As if it had just noticed this player, facing them. */
function engage(boss: Creature, player: WorldPlayer): void {
  boss.mode = Mode.Chase;
  boss.target = player;
  boss.boss!.engaged = true;
  boss.yaw = Math.atan2(player.state.x - boss.x, player.state.z - boss.z);
}

function ticksOf(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}

function untilTell(staged: Staged, limit = 10): Extract<GameEvent, { k: 'bossTell' }> {
  for (let ticks = 0; ticks < limit; ticks += 1) {
    const [tell] = ofKind(staged.tick(), 'bossTell');
    if (tell) return tell;
  }
  throw new Error('the boss never began a move');
}

/** A roll that's in its safe frames and goes nowhere, so the player stays where the case put them. */
function roll(player: WorldPlayer): void {
  player.state.dodgeTime = DODGE_SECONDS;
  player.state.dodgeX = 0;
  player.state.dodgeZ = 0;
}

function jump(player: WorldPlayer): void {
  player.state.jumpTime = JUMP_SECONDS / 2;
}

describe('the Great Bull boss', () => {
  it('is in the kinds list at the end, four times a bull, and waits in the middle of its arena', () => {
    assert.equal(BOSS_ENTRY.kind.behavior, 'boss');
    assert.equal(BOSS_ENTRY.index, CREATURE_BY_ID.size - 1);
    const staged = stage({ camps: [{ kind: 'bull_boss', x: OPEN.x, z: OPEN.z, count: 1, radius: 2 }] });
    const [boss] = staged.world.field.creatures;
    assert.ok(boss.boss, 'it gets boss state');
    assert.deepEqual(staged.world.field.bosses, [boss]);
    assert.ok(Math.hypot(boss.x - OPEN.x, boss.z - OPEN.z) < 0.01);
    assert.equal(boss.mode, Mode.Sleep);
    assert.equal(stage().world.field.bosses.length, 0, 'a map without its camp has no boss and nothing breaks');
  });

  it('wakes for a player in reach and tells its first move only after a pause', () => {
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 5);
    onlyMove(boss, BossMove.Swipe);
    staged.tick(TICK_RATE);
    assert.ok(boss.boss!.engaged, 'it noticed the player');
    assert.equal(boss.target, player);
    staged.tick(TICK_RATE);
    assert.equal(ofKind(staged.events, 'bossTell').length, 1, 'it starts a move after the pause');
  });

  it('swipe: hits in front only at the end of its windup, and a roll or a step back avoids it', () => {
    const { swipe } = BOSS_MOVES;
    for (const dodge of ['none', 'roll', 'step'] as const) {
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 4);
      onlyMove(boss, BossMove.Swipe);
      engage(boss, player);
      const health = player.state.health;
      const tell = untilTell(staged);
      assert.equal(tell.m, BossMove.Swipe);
      assert.equal(tell.c, boss.id);
      assert.equal(tell.t, swipe.windupSeconds);
      staged.tick(ticksOf(swipe.windupSeconds) - 1);
      assert.equal(player.state.health, health, 'nothing lands during the windup');
      assert.equal(ofKind(staged.events, 'bossHit').length, 0);
      if (dodge === 'roll') roll(player);
      if (dodge === 'step') staged.moveTo(player, 0, 12);
      const events = staged.tick();
      assert.equal(ofKind(events, 'bossHit').length, 1, `${dodge}: the hit comes exactly at the end of the windup`);
      const hurt = ofKind(events, 'bossDmg');
      if (dodge === 'none') {
        assert.equal(hurt.length, 1);
        assert.deepEqual(hurt[0], { k: 'bossDmg', c: boss.id, m: BossMove.Swipe, v: player.id, dmg: swipe.damage });
        assert.equal(player.state.health, health - swipe.damage);
        assert.equal(player.state.staggerTime, STAGGER_SECONDS, 'the same stagger as a bite');
        assert.ok(Math.hypot(player.state.knockX, player.state.knockZ) > 0.99, 'and the same knockback');
      } else {
        assert.equal(hurt.length, 0, `${dodge} should avoid it`);
        assert.equal(player.state.health, health);
      }
      assert.equal(boss.mode, Mode.Recover, 'then it stands still, open to hits');
      assert.ok(Math.abs(boss.timer - swipe.recoverSeconds) < 1e-6);
    }
  });

  it('tracks a player through the windup, then commits: an early sidestep is followed, a late one escapes', () => {
    const { swipe } = BOSS_MOVES;
    for (const late of [false, true]) {
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 4);
      onlyMove(boss, BossMove.Swipe);
      engage(boss, player);
      const tell = untilTell(staged);
      const health = player.state.health;
      const windupTicks = ticksOf(swipe.windupSeconds);
      // 0.1 s before it commits, or 0.1 s after (it commits 0.35 s before the hit).
      const waitTicks = late ? windupTicks - ticksOf(0.25) : windupTicks - ticksOf(0.75);
      staged.tick(waitTicks);
      // Out to its side, about 77 degrees off the aim it started with: outside the 120 degree swing.
      staged.moveTo(player, 4.5, 1);
      staged.tick(windupTicks - waitTicks + 1);
      const hurt = ofKind(staged.events, 'bossDmg').length;
      if (late) {
        assert.equal(hurt, 0, 'a sidestep after it commits escapes');
        assert.equal(player.state.health, health);
      } else {
        assert.ok(Math.abs(boss.yaw - tell.yaw) > 0.3, 'it turned to follow the player');
        assert.equal(hurt, 1, 'an early sidestep is tracked and hit');
      }
    }
  });

  it('swipe: misses a player behind it once its facing has locked', () => {
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 4);
    onlyMove(boss, BossMove.Swipe);
    engage(boss, player);
    untilTell(staged);
    staged.tick(ticksOf(BOSS_MOVES.swipe.windupSeconds) - 2);
    staged.moveTo(player, 0, -4);
    staged.tick(2);
    assert.equal(ofKind(staged.events, 'bossHit').length, 1);
    assert.equal(ofKind(staged.events, 'bossDmg').length, 0);
  });

  it('charge: runs the locked line after its windup and hits each player in the lane once', () => {
    const { charge } = BOSS_MOVES;
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 12);
    onlyMove(boss, BossMove.Charge);
    engage(boss, player);
    const health = player.state.health;
    assert.equal(untilTell(staged).m, BossMove.Charge);
    staged.tick(ticksOf(charge.windupSeconds) - 1);
    assert.equal(player.state.health, health, 'nothing lands during the windup');
    assert.ok(Math.hypot(boss.x - OPEN.x, boss.z - OPEN.z) < 0.01, 'it stands still while winding up');
    assert.equal(ofKind(staged.tick(), 'bossHit').length, 1, 'the run starts at the end of the windup');
    let hurt: Array<Extract<GameEvent, { k: 'bossDmg' }>> = [];
    for (let ticks = 0; ticks < TICK_RATE * 2 && hurt.length === 0; ticks += 1) hurt = ofKind(staged.tick(), 'bossDmg');
    assert.equal(hurt.length, 1);
    assert.equal(hurt[0].m, BossMove.Charge);
    assert.equal(hurt[0].dmg, charge.damage);
    assert.equal(player.state.health, health - charge.damage);
    staged.tick(TICK_RATE * 2);
    assert.equal(ofKind(staged.events, 'bossDmg').length, 1, 'once per charge');
    assert.ok(boss.z - OPEN.z > 10, 'it ran down the lane');
    assert.ok(boss.z - OPEN.z <= charge.length + 0.01, 'and no farther than its length');
  });

  it('charge: a sidestep after the facing locks makes it miss, and a miss leaves it dazed', () => {
    const { charge } = BOSS_MOVES;
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 12);
    onlyMove(boss, BossMove.Charge);
    engage(boss, player);
    untilTell(staged);
    staged.tick(ticksOf(charge.windupSeconds) - 2);
    staged.moveTo(player, 8, 12);
    staged.tick(2);
    assert.equal(ofKind(staged.events, 'bossHit').length, 1);
    let ticks = 0;
    while (boss.mode === Mode.Strike && ticks < TICK_RATE * 3) {
      staged.tick();
      ticks += 1;
    }
    assert.equal(ofKind(staged.events, 'bossDmg').length, 0);
    assert.equal(boss.mode, Mode.Recover);
    assert.equal(boss.visual, CreatureState.Stagger, 'shown dazed');
    assert.ok(boss.timer > charge.recoverSeconds, 'dazed for longer than a normal recovery');
    let dazed = 0;
    while (boss.mode === Mode.Recover && dazed < TICK_RATE * 5) {
      staged.tick();
      dazed += 1;
    }
    assert.ok(Math.abs(dazed - ticksOf(charge.missStunSeconds)) <= 1, `dazed for ${dazed / TICK_RATE} s`);
  });

  it('charge: a roll as it arrives lets it pass through', () => {
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 12);
    onlyMove(boss, BossMove.Charge);
    engage(boss, player);
    untilTell(staged);
    staged.tick(ticksOf(BOSS_MOVES.charge.windupSeconds));
    const limit = BOSS_MOVES.charge.width / 2 + PLAYER_RADIUS;
    // Roll the tick before its lane reaches the player.
    for (let ticks = 0; ticks < TICK_RATE * 2 && boss.mode === Mode.Strike; ticks += 1) {
      if (player.state.z - boss.z - BOSS_MOVES.charge.speed / TICK_RATE <= limit && player.state.dodgeTime === 0) roll(player);
      staged.tick();
    }
    assert.equal(ofKind(staged.events, 'bossDmg').length, 0);
  });

  it('leap: lands on where the target stood when it crouched, so moving away or jumping avoids it', () => {
    const { leap } = BOSS_MOVES;
    for (const dodge of ['none', 'away', 'jump', 'roll'] as const) {
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 10);
      onlyMove(boss, BossMove.Leap);
      engage(boss, player);
      const health = player.state.health;
      const tell = untilTell(staged);
      assert.equal(tell.m, BossMove.Leap);
      assert.ok(Math.hypot(tell.tx - player.state.x, tell.tz - player.state.z) < 1.1, 'aimed at where the player stood');
      if (dodge === 'away') staged.moveTo(player, 0, 20);
      staged.tick(ticksOf(leap.windupSeconds) - 1);
      assert.equal(player.state.health, health, 'nothing lands while it crouches and flies');
      if (dodge === 'jump') jump(player);
      if (dodge === 'roll') roll(player);
      const events = staged.tick();
      assert.equal(ofKind(events, 'bossHit').length, 1, `${dodge}: it lands at the end of the windup`);
      assert.ok(Math.hypot(boss.x - tell.tx, boss.z - tell.tz) < 1.1, 'on the marked spot');
      const hurt = ofKind(events, 'bossDmg');
      if (dodge === 'none') {
        assert.equal(hurt.length, 1);
        assert.equal(hurt[0].m, BossMove.Leap);
        assert.equal(player.state.health, health - leap.damage);
      } else {
        assert.equal(hurt.length, 0, `${dodge} should avoid it`);
      }
    }
  });

  it('fireballs: a fan of slow shots after the windup, the one in line hits, and a sidestep avoids them', () => {
    const { fireballs } = BOSS_MOVES;
    for (const dodge of ['none', 'step'] as const) {
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 15);
      onlyMove(boss, BossMove.Fireballs);
      engage(boss, player);
      const health = player.state.health;
      assert.equal(untilTell(staged).m, BossMove.Fireballs);
      staged.tick(ticksOf(fireballs.windupSeconds) - 1);
      assert.equal(ofKind(staged.events, 'bossShot').length, 0, 'nothing flies during the windup');
      const fired = staged.tick();
      assert.equal(ofKind(fired, 'bossHit').length, 1);
      const shots = ofKind(fired, 'bossShot');
      assert.equal(shots.length, fireballs.count);
      for (const shot of shots) {
        assert.equal(shot.c, boss.id);
        assert.equal(shot.speed, fireballs.speed);
        assert.equal(shot.range, fireballs.range);
        assert.equal(shot.r, fireballs.radius);
      }
      assert.equal(new Set(shots.map((shot) => shot.id)).size, fireballs.count, 'each has its own id');
      assert.equal(player.state.health, health, 'they take time to arrive');
      if (dodge === 'step') staged.moveTo(player, 9, 15);
      staged.tick(ticksOf(fireballs.range / fireballs.speed) + 5);
      const ends = ofKind(staged.events, 'bossShotEnd');
      assert.equal(ends.length, fireballs.count, 'every shot ends');
      assert.equal(staged.world.bossShots.length, 0);
      const hits = ends.filter((end) => end.hit === 1);
      const hurt = ofKind(staged.events, 'bossDmg');
      if (dodge === 'none') {
        assert.equal(hits.length, 1, 'only the middle one is in line');
        assert.equal(hits[0].v, player.id);
        assert.equal(hurt.length, 1);
        assert.equal(hurt[0].m, BossMove.Fireballs);
        assert.equal(player.state.health, health - fireballs.damage);
      } else {
        assert.equal(hits.length, 0);
        assert.equal(hurt.length, 0);
      }
    }
  });

  it('fireballs: pass through a player in a roll', () => {
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 15);
    onlyMove(boss, BossMove.Fireballs);
    engage(boss, player);
    untilTell(staged);
    staged.tick(ticksOf(BOSS_MOVES.fireballs.windupSeconds));
    const reach = BOSS_MOVES.fireballs.radius + PLAYER_RADIUS + BOSS_MOVES.fireballs.speed / TICK_RATE;
    for (let ticks = 0; ticks < TICK_RATE * 4 && staged.world.bossShots.length > 0; ticks += 1) {
      const near = staged.world.bossShots.some((shot) => Math.hypot(shot.x - player.state.x, shot.z - player.state.z) <= reach);
      // The player's turn runs before the shots move, so roll again if the safe frames end during this tick.
      const safeNextTick = player.state.dodgeTime - 1 / TICK_RATE > DODGE_SECONDS - player.derived.dodgeInvulnerable;
      if (near && !safeNextTick) roll(player);
      staged.tick();
    }
    assert.equal(ofKind(staged.events, 'bossDmg').length, 0);
  });

  it('stomp: only below half health, then a ring that a jump or a roll lets pass and anyone else takes', () => {
    const { stomp } = BOSS_MOVES;
    const { staged, boss } = bossFight();
    const standing = staged.join('duelist', 0);
    const jumper = staged.join('duelist', 0);
    const roller = staged.join('duelist', 0);
    staged.moveTo(standing, 0, 5);
    staged.moveTo(jumper, 8, 0);
    staged.moveTo(roller, -8, 0);
    onlyMove(boss, BossMove.Stomp);
    engage(boss, standing);
    boss.health = boss.kind.health * 0.6;
    staged.tick(TICK_RATE * 2);
    assert.equal(ofKind(staged.events, 'bossTell').length, 0, 'not above half health');

    boss.health = boss.kind.health * stomp.belowHealthShare;
    staged.place(boss, 0, 0);
    staged.moveTo(standing, 0, 5);
    engage(boss, standing);
    assert.equal(untilTell(staged).m, BossMove.Stomp);
    staged.tick(ticksOf(stomp.windupSeconds) - 1);
    assert.equal(ofKind(staged.events, 'bossDmg').length, 0, 'nothing during the windup');
    assert.equal(ofKind(staged.tick(), 'bossHit').length, 1);
    const ring = boss.boss!;
    const reachAt = 8 - PLAYER_RADIUS;
    let dodged = false;
    for (let ticks = 0; ticks < TICK_RATE * 3 && ring.ringActive; ticks += 1) {
      if (!dodged && ring.ringRadius + stomp.ringSpeed / TICK_RATE >= reachAt) {
        jump(jumper);
        roll(roller);
        dodged = true;
      }
      staged.tick();
    }
    assert.ok(dodged && !ring.ringActive, 'the ring grew out to its full size');
    const hurt = ofKind(staged.events, 'bossDmg');
    assert.deepEqual(hurt.map((item) => item.v), [standing.id], 'only the one standing still is hit, once');
    assert.equal(hurt[0].m, BossMove.Stomp);
    assert.equal(hurt[0].dmg, stomp.damage);
  });

  it('never uses one move three times running', () => {
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    staged.moveTo(player, 0, 4);
    engage(boss, player);
    // Swipe has no cooldown here, and nothing else fits at this distance.
    onlyMove(boss, BossMove.Swipe);
    const moves: number[] = [];
    for (let ticks = 0; ticks < TICK_RATE * 30 && moves.length < 6; ticks += 1) {
      boss.boss!.readyAt[BossMove.Swipe] = 0;
      for (const tell of ofKind(staged.tick(), 'bossTell')) moves.push(tell.m);
      player.state.health = player.derived.maxHealth;
    }
    assert.deepEqual(moves.slice(0, 2), [BossMove.Swipe, BossMove.Swipe]);
    assert.equal(moves.length, 2, 'with only that move left, it waits rather than use it a third time');
  });

  it('gives up after 6 seconds with nobody in its arena: goes home, heals to full and forgets who hit it', () => {
    const { staged, boss } = bossFight();
    const player = staged.join('duelist', 0);
    const far = staged.join('duelist', 0);
    staged.moveTo(player, 0, 15);
    staged.moveTo(far, 0, -55);
    onlyMove(boss, -1);
    engage(boss, player);
    boss.health = 400;
    boss.hitters.set(player, staged.world.time);
    staged.tick();
    assert.ok(snapshotText(staged, player).includes(`"b":[${boss.id},${BOSS_ENTRY.index},400,${boss.kind.health},0,0]`), 'the health bar nearby');
    assert.ok(!snapshotText(staged, far).includes('"b":'), 'and not far away');

    staged.moveTo(player, 0, 45);
    staged.tick(ticksOf(6) - 2);
    assert.equal(boss.health, 400, 'it waits a while first');
    assert.ok(boss.boss!.engaged);
    // Off its spot, so the walk home can be seen (at home it goes straight to Idle).
    staged.place(boss, 0, 8);
    staged.tick(4);
    assert.equal(boss.mode, Mode.Return);
    assert.equal(boss.health, boss.kind.health, 'healed to full');
    assert.equal(boss.hitters.size, 0, 'loot credit is forgotten');
    assert.ok(!boss.boss!.engaged);
    staged.moveTo(player, 0, 35);
    assert.ok(!snapshotText(staged, player).includes('"b":'), 'no bar once it has given up');
    staged.tick(TICK_RATE * 15);
    assert.equal(boss.mode, Mode.Idle);
    assert.ok(Math.hypot(boss.x - OPEN.x, boss.z - OPEN.z) <= 1.5, 'back home');
  });

  it('gives everyone who hit it in the last minute their own roll, a boss kill and the achievement', () => {
    const { staged, boss } = bossFight();
    const killer = staged.join('juggernaut', 0);
    const helper = staged.join('duelist', 0);
    const late = staged.join('duelist', 0);
    staged.moveTo(helper, 30, 0);
    staged.moveTo(late, -30, 0);
    staged.place(boss, 0, 3.5);
    // Standing still the whole time, so the swing is all that happens.
    onlyMove(boss, -1);
    boss.mode = Mode.Recover;
    boss.timer = 100;
    boss.health = 1;
    boss.hitters.set(helper, staged.world.time - 50);
    boss.hitters.set(late, staged.world.time - 61);

    const { events } = swingUntilHit(staged, killer);
    assert.equal(ofKind(events, 'hit')[0].kill, 1);
    const dust = ofKind(events, 'dust');
    assert.deepEqual(dust.map((item) => item.to).sort(), [killer.id, helper.id].sort());
    for (const item of dust) assert.equal(item.n, BOSS_ENTRY.kind.dustMin, 'each gets a full amount');
    assert.equal(late.dust, 0);
    assert.equal(killer.enemies, 1);
    assert.equal(helper.enemies, 1);
    const kills = staged.credits.filter((item) => item.delta.bossKills === 1);
    assert.deepEqual(new Set(kills.map((item) => item.player)), new Set([killer, helper]));
    for (const item of kills) assert.deepEqual(item.delta, { dust: BOSS_ENTRY.kind.dustMin, enemies: 1, animals: 0, bossKills: 1 });
    const damage = staged.credits.filter((item) => item.delta.bossDamage !== undefined);
    assert.deepEqual(damage.map((item) => [item.player, item.delta.bossDamage]), [[killer, 1]], 'only the health it really lost');
    assert.equal(staged.unlocks.filter((id) => id === 'bull_slayer').length, 2);
    assert.equal(boss.mode, Mode.Dead);
    assert.ok(!snapshotText(staged, killer).includes('"b":'), 'no bar for a dead boss');
  });

  it('comes back after its respawn time, full and asleep in the middle of its arena', () => {
    const { staged, boss } = bossFight();
    staged.join('duelist', 0);
    staged.world.field.onDeath(boss);
    staged.tick(ticksOf(BOSS_ENTRY.kind.respawnSeconds) + 2);
    assert.ok(boss.alive);
    assert.equal(boss.health, boss.kind.health);
    assert.ok(Math.hypot(boss.x - OPEN.x, boss.z - OPEN.z) < 1.5);
  });

  it('runs on its own clock: nothing a client sends can start, pick, speed up or skip a move', () => {
    for (const forged of [
      { t: 'boss', m: BossMove.Leap },
      { t: 'bossTell', c: 1, m: BossMove.Stomp },
      { t: 'bossHit', c: 1, m: 0 },
      { t: 'stomp' },
      { k: 'bossDmg', c: 1, v: 1, dmg: 0 },
    ]) {
      assert.equal(parseAction(JSON.stringify(forged)), null);
      assert.equal(parseInput(JSON.stringify(forged)), null);
    }
    assert.deepEqual(parseAction(JSON.stringify({ t: 'aim', c: 1, m: BossMove.Leap, skip: true })), { t: 'aim', c: 1 });

    const timeline = (noisy: boolean): string[] => {
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 4);
      onlyMove(boss, BossMove.Swipe);
      engage(boss, player);
      const seen: string[] = [];
      // Long enough for one whole move, before knockback timing could make the two worlds drift apart.
      for (let ticks = 0; ticks < TICK_RATE * 2; ticks += 1) {
        if (noisy) {
          staged.world.queueInput(player, input({ interact: true, potion: true }));
          staged.world.handleAction(player, parseAction(JSON.stringify({ t: 'aim', c: boss.id }))!);
          staged.world.handleAction(player, { t: 'stand' });
        }
        for (const event of staged.tick()) {
          if (event.k === 'bossTell' || event.k === 'bossHit') seen.push(`${ticks}:${event.k}:${event.m}`);
        }
      }
      return seen;
    };
    const quiet = timeline(false);
    assert.ok(quiet.some((entry) => entry.includes('bossHit')));
    assert.deepEqual(timeline(true), quiet);
  });
});

/* Stance breaks and criticals. Every case stages the boss standing still with no moves, so only these rules run. */

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** One-per-tick steps from the start of a critical to its impact, and to its end. The first step starts it. */
function criticalSteps(until: number): number {
  let time = CRITICAL_SECONDS;
  let steps = 0;
  while (time > until) {
    time = Math.max(0, time - 1 / TICK_RATE);
    steps += 1;
  }
  return steps;
}
const IMPACT_STEP = criticalSteps(CRITICAL_IMPACT_TIME);
const END_STEP = criticalSteps(0);

/** A boss at the open spot facing +z, with no moves and holding still. */
function quietBoss(): { staged: Staged; boss: Creature } {
  const fight = bossFight();
  onlyMove(fight.boss, -1);
  fight.boss.yaw = 0;
  fight.boss.mode = Mode.Recover;
  fight.boss.timer = 100;
  fight.boss.boss!.engaged = true;
  return fight;
}

/** A player in the boss's window, knocked down boss, the player's critical under way after one step. */
function startCritical(classId: ClassId, variant: number): { staged: Staged; boss: Creature; player: WorldPlayer; events: GameEvent[] } {
  const { staged, boss } = quietBoss();
  const player = staged.join(classId, variant);
  staged.moveTo(player, 0, 4);
  staged.world.field.breakStance(boss);
  staged.world.queueInput(player, input({ attack: true, yaw: 0 }));
  const events = staged.tick();
  assert.equal(ofKind(events, 'crit').length, 1, 'the critical started');
  return { staged, boss, player, events };
}

/** Ticks with an idle input each tick, so the player steps once per tick. A NaN yaw leaves the facing alone. */
function idle(staged: Staged, player: WorldPlayer, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let index = 0; index < ticks; index += 1) {
    staged.world.queueInput(player, input({ yaw: Number.NaN }));
    events.push(...staged.tick());
  }
  return events;
}

type Hurts = { hurt(creature: Creature, player: WorldPlayer, damage: number, fromX: number, fromZ: number, move: number): boolean };

const isClear = (x: number, z: number, radius = PLAYER_RADIUS): boolean => {
  const probe = { x, z };
  collide(probe, radius);
  return probe.x === x && probe.z === z;
};

/** A small round collider on the real map and a direction that fits the case, or null if the map has none. */
function roundWall(fits: (x: number, z: number, r: number, dx: number, dz: number) => boolean) {
  for (const collider of MAP.colliders) {
    if (collider.t !== 'c' || collider.r < 0.5 || collider.r > 1.6) continue;
    for (let index = 0; index < 8; index += 1) {
      const angle = (index * Math.PI) / 4;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      if (fits(collider.x, collider.z, collider.r, dx, dz)) return { x: collider.x, z: collider.z, r: collider.r, dx, dz };
    }
  }
  return null;
}

describe('boss stance and criticals', () => {
  it("fills by each hit's stagger power, breaks at max in place of a stagger, then rises and is immune for a while", () => {
    const { staged, boss } = quietBoss();
    const b = boss.boss!;
    const player = staged.join('juggernaut', 0);
    staged.place(boss, 0, 3.5);
    const rest = () => {
      staged.tick(TICK_RATE * 2);
      player.state.stamina = player.derived.maxStamina;
      if (!b.stunned) {
        boss.mode = Mode.Recover;
        boss.timer = 100;
      }
    };

    swingUntilHit(staged, player);
    assert.equal(player.stagger, staggerPower(player.weapon, player.info.stats));
    assert.equal(b.stance, player.stagger, 'one hit adds its stagger power');
    rest();

    b.stance = BOSS_STANCE.max - 1;
    b.stanceHitAt = staged.world.time;
    boss.poise = boss.kind.poise;
    boss.lastPoiseHit = staged.world.time;
    const { events } = swingUntilHit(staged, player);
    const hitAt = events.findIndex((event) => event.k === 'hit');
    const breakAt = events.findIndex((event) => event.k === 'bossBreak');
    assert.ok(hitAt >= 0 && breakAt > hitAt, 'the hit, then the break');
    assert.equal(ofKind(events, 'hit')[0].stagger, 0, 'the usual poise stagger does not also happen');
    assert.deepEqual(ofKind(events, 'bossBreak'), [{ k: 'bossBreak', c: boss.id, x: round2(boss.x), z: round2(boss.z) }]);
    assert.ok(b.stunned);
    assert.equal(boss.mode, Mode.Stagger);
    assert.ok(Math.abs(boss.timer - (BOSS_STANCE.stunSeconds - 1 / TICK_RATE)) < 1e-6);
    assert.ok(
      snapshotText(staged, player).includes(
        `"b":[${boss.id},${BOSS_ENTRY.index},${Math.ceil(boss.health)},${boss.kind.health},${packStance(b.stance)},${packStunLeft(boss.timer)}]`,
      ),
      'the bar carries stance and stun time',
    );

    rest();
    const health = boss.health;
    const { events: downHit } = swingUntilHit(staged, player);
    assert.equal(boss.health, health - player.damage, 'normal damage while down');
    assert.equal(ofKind(downHit, 'hit')[0].stagger, 0);
    assert.equal(b.stance, 0, 'no stance while down');
    assert.equal(boss.mode, Mode.Stagger);

    let rise = -1;
    for (let ticks = 0; ticks < ticksOf(BOSS_STANCE.stunSeconds) + 5 && rise < 0; ticks += 1) {
      if (ofKind(staged.tick(), 'bossRise').length > 0) rise = ticks;
    }
    assert.ok(rise >= 0, 'it gets up on its own');
    assert.ok(!b.stunned);
    assert.equal(boss.mode, Mode.Recover);
    assert.ok(Math.abs(boss.timer - 1) < 1e-6, 'and stands still for a second');
    assert.equal(b.immuneLeft, BOSS_STANCE.immuneSeconds);

    rest();
    swingUntilHit(staged, player);
    assert.equal(b.stance, 0, 'immune: hits add no stance');
    b.immuneLeft = 0;
    rest();
    swingUntilHit(staged, player);
    assert.equal(b.stance, player.stagger, 'it builds again once immunity is over');
  });

  it('decays after a few quiet seconds', () => {
    const { staged, boss } = quietBoss();
    staged.join('duelist', 0);
    const b = boss.boss!;
    b.stance = 100;
    b.stanceHitAt = staged.world.time;
    staged.tick(ticksOf(BOSS_STANCE.decayDelaySeconds) - 1);
    assert.equal(b.stance, 100, 'nothing lost before the delay');
    staged.tick(TICK_RATE + 1);
    assert.ok(b.stance < 100 - BOSS_STANCE.decayPerSecond * 0.9 && b.stance > 100 - BOSS_STANCE.decayPerSecond * 1.2, `${b.stance}`);
    staged.tick(TICK_RATE * 20);
    assert.equal(b.stance, 0, 'down to nothing, and no lower');
  });

  it('cuts off a charge and a leap in the air at once, along with a stomp ring', () => {
    {
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 15);
      onlyMove(boss, BossMove.Charge);
      engage(boss, player);
      untilTell(staged);
      staged.tick(ticksOf(BOSS_MOVES.charge.windupSeconds) + 3);
      assert.equal(boss.mode, Mode.Strike, 'charging');
      boss.boss!.ringActive = true;
      staged.world.field.breakStance(boss);
      assert.equal(boss.mode, Mode.Stagger);
      assert.equal(boss.boss!.move, -1);
      assert.ok(!boss.boss!.ringActive, 'the ring is gone too');
      const x = boss.x;
      const z = boss.z;
      staged.tick(TICK_RATE * 2);
      assert.equal(boss.x, x);
      assert.equal(boss.z, z, 'it stopped where it broke');
      assert.equal(ofKind(staged.events, 'bossDmg').length, 0);
    }
    {
      const { leap } = BOSS_MOVES;
      const { staged, boss } = bossFight();
      const player = staged.join('duelist', 0);
      staged.moveTo(player, 0, 12);
      onlyMove(boss, BossMove.Leap);
      engage(boss, player);
      untilTell(staged);
      staged.tick(ticksOf(leap.windupSeconds - leap.airSeconds / 2));
      assert.ok(boss.z - OPEN.z > 1, 'in the air');
      const hits = ofKind(staged.events, 'bossHit').length;
      staged.world.field.breakStance(boss);
      const x = boss.x;
      const z = boss.z;
      staged.tick(TICK_RATE * 2);
      assert.equal(ofKind(staged.events, 'bossHit').length, hits, 'it never lands the leap');
      assert.equal(ofKind(staged.events, 'bossDmg').length, 0);
      assert.equal(boss.x, x);
      assert.equal(boss.z, z);
      assert.equal(boss.mode, Mode.Stagger);
    }
  });

  it('starts a critical only on a stunned boss, from its front window, for one player at a time', () => {
    const { staged, boss } = quietBoss();
    const b = boss.boss!;
    const front = staged.join('juggernaut', 2);
    const behind = staged.join('duelist', 0);
    const far = staged.join('duelist', 0);
    const second = staged.join('ranger', 2);
    staged.moveTo(front, 0, 4);
    staged.moveTo(behind, 0, -4);
    staged.moveTo(far, 0, BOSS_STANCE.critWindowRange + 1);
    staged.moveTo(second, 2, 3.5);
    assert.ok(inCritWindow(boss.x, boss.z, boss.yaw, front.state.x, front.state.z));
    assert.ok(!inCritWindow(boss.x, boss.z, boss.yaw, behind.state.x, behind.state.z));
    assert.ok(!inCritWindow(boss.x, boss.z, boss.yaw, far.state.x, far.state.z));
    const everyone = [front, behind, far, second];
    const attack = (players: WorldPlayer[]): GameEvent[] => {
      for (const player of players) staged.world.queueInput(player, input({ attack: true, yaw: Math.PI }));
      const events = staged.tick();
      for (const player of players) {
        if (player.state.criticalTime > 0) continue;
        player.state.attackTime = 0;
        player.state.stamina = player.derived.maxStamina;
      }
      return events;
    };

    assert.equal(ofKind(attack(everyone), 'crit').length, 0, 'not while it stands');
    for (const player of everyone) assert.equal(player.state.criticalTime, 0);

    staged.world.field.breakStance(boss);
    for (const player of [behind, far]) {
      staged.world.queueInput(player, input({ attack: true, yaw: Math.PI }));
    }
    const missed = staged.tick();
    assert.equal(ofKind(missed, 'crit').length, 0, 'not from behind or out of range');
    assert.ok(behind.state.attackTime > 0 && far.state.attackTime > 0, 'they swing normally instead');
    behind.state.attackTime = 0;
    far.state.attackTime = 0;

    const stamina = front.state.stamina;
    const events = attack([front, second]);
    assert.deepEqual(ofKind(events, 'crit'), [
      {
        k: 'crit',
        by: front.id,
        c: boss.id,
        x: round2(front.state.x),
        z: round2(front.state.z),
        yaw: round2(Math.PI),
        w: 2,
        cls: CLASSES.findIndex((item) => item.id === 'juggernaut'),
      },
    ]);
    assert.ok(Math.abs(front.state.criticalTime - (CRITICAL_SECONDS - 1 / TICK_RATE)) < 1e-9);
    assert.ok(Math.abs(front.state.yaw - Math.PI) < 1e-9, 'turned to face the boss');
    assert.equal(front.state.stamina, stamina, 'it costs nothing');
    assert.equal(second.state.criticalTime, 0, 'one at a time');
    assert.equal(b.critBy, front);

    // Gone halfway through: the claim is freed and the stun carries on, so someone else can still take it.
    staged.world.removePlayer(front);
    staged.tick();
    assert.equal(b.critBy, null);
    assert.ok(b.stunned);
    assert.equal(ofKind(attack([second]), 'crit').length, 1);
    assert.equal(b.critBy, second);
  });

  it('needs a clear line to the boss', (t) => {
    const wall = roundWall((x, z, r, dx, dz) => {
      const px = x - dx * (r + 1);
      const pz = z - dz * (r + 1);
      const bx = x + dx * (r + 0.3);
      const bz = z + dz * (r + 0.3);
      return isClear(px, pz) && isClear(bx, bz, 0.05) && segmentBlocked(px, pz, bx, bz);
    });
    if (!wall) {
      t.skip('this map has no small round collider to stand behind');
      return;
    }
    const { staged, boss } = quietBoss();
    const player = staged.join('duelist', 0);
    staged.world.field.breakStance(boss);
    player.state.x = wall.x - wall.dx * (wall.r + 1);
    player.state.z = wall.z - wall.dz * (wall.r + 1);
    boss.x = wall.x + wall.dx * (wall.r + 0.3);
    boss.z = wall.z + wall.dz * (wall.r + 0.3);
    boss.yaw = Math.atan2(-wall.dx, -wall.dz);
    assert.ok(inCritWindow(boss.x, boss.z, boss.yaw, player.state.x, player.state.z));
    staged.world.queueInput(player, input({ attack: true, yaw: Math.atan2(wall.dx, wall.dz) }));
    assert.equal(ofKind(staged.tick(), 'crit').length, 0);
    assert.equal(player.state.criticalTime, 0);
  });

  it('lands once at 60% for six times the attack, keeps the boss down meanwhile, and the player is untouchable', () => {
    const { staged, boss } = quietBoss();
    const b = boss.boss!;
    const player = staged.join('juggernaut', 2);
    staged.moveTo(player, 0, 4);
    staged.world.field.breakStance(boss);
    boss.timer = 0.5;
    const world = staged.world as unknown as Hurts;
    const health = boss.health;
    const expected = criticalDamage(player.weapon, player.info.stats);
    assert.equal(expected, attackDamage(player.weapon, player.info.stats) * CRITICAL_DAMAGE_MULTIPLIER);
    let impactAt = -1;
    for (let step = 1; step <= END_STEP; step += 1) {
      // Inputs during a critical are ignored, whatever they ask.
      staged.world.queueInput(player, input({ attack: true, yaw: 0, mx: 1, run: true }));
      const events = staged.tick();
      const hits = ofKind(events, 'critHit');
      if (hits.length > 0) {
        assert.equal(impactAt, -1, 'only once');
        impactAt = step;
        assert.deepEqual(hits, [{ k: 'critHit', by: player.id, c: boss.id, x: round2(boss.x), z: round2(boss.z), dmg: expected, kill: 0 }]);
        assert.equal(boss.health, health - expected);
      }
      if (step < END_STEP) {
        assert.ok(player.state.criticalTime > 0);
        assert.ok(isInvulnerable(player.state, player.derived));
        for (const move of [-1, BossMove.Swipe, BossMove.Charge, BossMove.Leap, BossMove.Fireballs, BossMove.Stomp]) {
          assert.equal(world.hurt(boss, player, 50, boss.x, boss.z, move), false, 'bites and boss moves pass through');
        }
        assert.ok(Math.abs(player.state.yaw - Math.PI) < 1e-9, 'facing stays locked');
        assert.ok(b.stunned && ofKind(events, 'bossRise').length === 0, 'it can not get up mid-critical');
      } else {
        assert.equal(player.state.criticalTime, 0);
        assert.equal(player.critTarget, null);
        assert.equal(ofKind(events, 'bossRise').length, 1, 'it gets up as the critical ends');
      }
    }
    assert.equal(impactAt, IMPACT_STEP);
    assert.equal(player.state.health, player.derived.maxHealth);
    assert.ok(boss.hitters.has(player), 'loot credit');
    assert.ok(staged.credits.some((item) => item.player === player && item.delta.bossDamage === Math.round(expected)));
    assert.ok(!b.stunned);
    assert.equal(b.critBy, null);
    assert.equal(boss.mode, Mode.Recover);
    assert.ok(Math.abs(boss.timer - BOSS_STANCE.afterCritRecoverSeconds) < 1e-6);
    assert.equal(b.immuneLeft, BOSS_STANCE.immuneSeconds);

    staged.world.queueInput(player, input({ attack: true, yaw: Math.PI }));
    assert.equal(ofKind(staged.tick(), 'crit').length, 0, 'no second critical once it is up');
  });

  it('can finish the boss, which pays out like any kill', () => {
    const { staged, boss, player } = startCritical('duelist', 1);
    boss.health = 1;
    idle(staged, player, IMPACT_STEP - 1);
    const [hit] = ofKind(staged.events, 'critHit');
    assert.equal(hit.kill, 1);
    assert.equal(boss.mode, Mode.Dead);
    assert.ok(staged.credits.some((item) => item.player === player && item.delta.bossKills === 1));
    assert.ok(staged.unlocks.includes('bull_slayer'));
  });

  it("ends with the weapon's travel through collide(), and the server moves the player no further", () => {
    const katana = startCritical('duelist', 0);
    const { state } = katana.player;
    const start = { x: state.x, z: state.z };
    idle(katana.staged, katana.player, END_STEP - 2);
    assert.equal(state.x, start.x);
    assert.equal(state.z, start.z, 'it stays put while the critical plays');
    idle(katana.staged, katana.player, 2);
    const travel = katana.player.weapon.criticalTravel!;
    assert.equal(travel, 9);
    const end = { x: start.x + Math.sin(state.yaw) * travel, z: start.z + Math.cos(state.yaw) * travel };
    collide(end, PLAYER_RADIUS);
    assert.ok(Math.abs(state.x - end.x) < 1e-9 && Math.abs(state.z - end.z) < 1e-9, 'right through the boss');
    idle(katana.staged, katana.player, TICK_RATE);
    assert.ok(Math.abs(state.x - end.x) < 1e-9 && Math.abs(state.z - end.z) < 1e-9, 'and no more after');

    const hammer = startCritical('juggernaut', 0);
    const before = { x: hammer.player.state.x, z: hammer.player.state.z };
    idle(hammer.staged, hammer.player, END_STEP + 2);
    assert.deepEqual({ x: hammer.player.state.x, z: hammer.player.state.z }, before, 'a weapon with no travel stays put');
  });

  it('stops the travel at a wall', (t) => {
    const travel = weaponFor('duelist', 0).criticalTravel!;
    const wall = roundWall((x, z, r, dx, dz) => {
      const px = x - dx * (r * 0.5 + travel);
      const pz = z - dz * (r * 0.5 + travel);
      return isClear(px, pz) && isClear(px + dx * 3, pz + dz * 3, 1) && !segmentBlocked(px, pz, px + dx * 3, pz + dz * 3);
    });
    if (!wall) {
      t.skip('this map has no small round collider in the open');
      return;
    }
    const { staged, boss } = quietBoss();
    const player = staged.join('duelist', 0);
    staged.world.field.breakStance(boss);
    const px = wall.x - wall.dx * (wall.r * 0.5 + travel);
    const pz = wall.z - wall.dz * (wall.r * 0.5 + travel);
    player.state.x = px;
    player.state.z = pz;
    boss.x = px + wall.dx * 3;
    boss.z = pz + wall.dz * 3;
    boss.yaw = Math.atan2(-wall.dx, -wall.dz);
    staged.world.queueInput(player, input({ attack: true }));
    assert.equal(ofKind(staged.tick(), 'crit').length, 1);
    const yaw = player.state.yaw;
    idle(staged, player, END_STEP);
    const end = { x: px + Math.sin(yaw) * travel, z: pz + Math.cos(yaw) * travel };
    assert.ok(Math.hypot(end.x - wall.x, end.z - wall.z) < wall.r, 'the dash alone would end inside the collider');
    assert.ok(Math.hypot(player.state.x - wall.x, player.state.z - wall.z) >= wall.r + PLAYER_RADIUS - 1e-6, 'pushed out of it');
    const along = (player.state.x - wall.x) * Math.sin(yaw) + (player.state.z - wall.z) * Math.cos(yaw);
    assert.ok(along < 0, 'it stops on the near side, short of the collider');
  });

  it('does not dash through a small collider in its path', (t) => {
    const travel = weaponFor('duelist', 0).criticalTravel!;
    // The collider sits halfway along the dash, with open ground on both sides of it.
    const wall = roundWall((x, z, r, dx, dz) => {
      const px = x - dx * (travel / 2);
      const pz = z - dz * (travel / 2);
      const ex = x + dx * (travel / 2);
      const ez = z + dz * (travel / 2);
      return (
        travel / 2 > r + PLAYER_RADIUS + 0.5 &&
        isClear(px, pz) &&
        isClear(ex, ez) &&
        isClear(px + dx * 3, pz + dz * 3, 1) &&
        !segmentBlocked(px, pz, px + dx * 3, pz + dz * 3)
      );
    });
    if (!wall) {
      t.skip('this map has no small round collider with open ground around it');
      return;
    }
    const { staged, boss } = quietBoss();
    const player = staged.join('duelist', 0);
    staged.world.field.breakStance(boss);
    const px = wall.x - wall.dx * (travel / 2);
    const pz = wall.z - wall.dz * (travel / 2);
    player.state.x = px;
    player.state.z = pz;
    boss.x = px + wall.dx * 3;
    boss.z = pz + wall.dz * 3;
    boss.yaw = Math.atan2(-wall.dx, -wall.dz);
    staged.world.queueInput(player, input({ attack: true }));
    assert.equal(ofKind(staged.tick(), 'crit').length, 1);
    const yaw = player.state.yaw;
    const end = { x: px + Math.sin(yaw) * travel, z: pz + Math.cos(yaw) * travel };
    assert.ok(isClear(end.x, end.z), 'one jump would land clear on the far side');
    idle(staged, player, END_STEP);
    const along = (player.state.x - wall.x) * Math.sin(yaw) + (player.state.z - wall.z) * Math.cos(yaw);
    assert.ok(along < 0, 'it stays on the near side of the collider');
  });

  it('gives one critical per break, even if its player leaves after the blow', () => {
    const { staged, boss, player } = startCritical('juggernaut', 0);
    const b = boss.boss!;
    const second = staged.join('juggernaut', 0);
    staged.moveTo(second, 1, 3.5);
    const hits = idle(staged, player, IMPACT_STEP);
    assert.equal(ofKind(hits, 'critHit').length, 1, 'the first blow landed');
    assert.ok(b.stunned);
    staged.world.removePlayer(player);
    const health = boss.health;
    const events: GameEvent[] = [];
    for (let index = 0; index < 10; index += 1) {
      staged.world.queueInput(second, input({ attack: true, yaw: Math.PI }));
      events.push(...staged.tick());
      second.state.attackTime = 0;
      second.state.stamina = second.derived.maxStamina;
    }
    assert.equal(ofKind(events, 'crit').length, 0, 'no second critical');
    assert.equal(second.state.criticalTime, 0);
    assert.ok(!b.stunned, 'it gets up as if the critical had ended');
    assert.ok(boss.health >= health - second.damage * 10, 'only ordinary hits at most');
  });

  it('ends a critical if its player dies during it', () => {
    const { staged, player } = startCritical('juggernaut', 0);
    (staged.world as unknown as { kill(p: WorldPlayer): void }).kill(player);
    assert.equal(player.state.criticalTime, 0);
    assert.equal(player.critTarget, null);
  });

  it('can not be started or faked by anything a client sends', () => {
    for (const forged of [
      { t: 'crit', c: 1 },
      { t: 'critical' },
      { t: 'bossBreak', c: 1 },
      { k: 'crit', by: 1, c: 1, x: 0, z: 0, yaw: 0, w: 0, cls: 0 },
      { k: 'critHit', by: 1, c: 1, x: 0, z: 0, dmg: 9999, kill: 1 },
      { t: 'i', d: [1, 0, 0, 0, MAX_FLAGS + 1] },
      { t: 'i', d: [1, 0, 0, 0, FLAG_ATTACK, CRITICAL_SECONDS] },
    ]) {
      assert.equal(parseAction(JSON.stringify(forged)), null);
      assert.equal(parseInput(JSON.stringify(forged)), null);
    }
    const extra = parseInput(JSON.stringify({ t: 'i', d: [1, 0, 0, 0, FLAG_ATTACK], criticalTime: CRITICAL_SECONDS, crit: 1 }));
    assert.ok(extra && !('criticalTime' in extra) && !('crit' in extra), 'unknown fields are dropped');
    assert.deepEqual(parseAction(JSON.stringify({ t: 'aim', c: 1, crit: true })), { t: 'aim', c: 1 });

    // Every flag combination, aimed at the boss, from just outside its window.
    const { staged, boss } = quietBoss();
    const player = staged.join('ranger', 0);
    staged.moveTo(player, 0, BOSS_STANCE.critWindowRange + 0.5);
    staged.world.field.breakStance(boss);
    for (let flags = 0; flags <= MAX_FLAGS; flags += 1) {
      staged.world.handleAction(player, { t: 'aim', c: boss.id });
      const raw = parseInput(JSON.stringify({ t: 'i', d: [seq + 1000 + flags, 0, 0, Math.PI, flags] }))!;
      staged.world.queueInput(player, raw);
      staged.tick();
      player.state.stamina = player.derived.maxStamina;
    }
    assert.equal(ofKind(staged.events, 'crit').length, 0);
    assert.equal(ofKind(staged.events, 'critHit').length, 0);
    assert.equal(player.state.criticalTime, 0);
    assert.equal(boss.boss!.critBy, null);
    assert.ok(boss.boss!.stunned);
  });
});
