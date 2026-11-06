/**
 * Combat rules, run directly against the world with no sockets and no database, so each case can
 * stage exactly the positions it needs. Staging only works from here: the server builds its world
 * from the real map, and nothing a client sends can reach these fields.
 * Run with `node --import tsx --test test/world.test.ts`. It needs no running stack.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';
import { CLASSES, DEFAULT_APPEARANCE, type ClassId } from '../../shared/classes.js';
import { collide, segmentBlocked } from '../../shared/collision.js';
import { attackDamage, CHEST_REWARD_DUST, INTERACT_RANGE, RESPAWN_SECONDS, weaponFor } from '../../shared/combat.js';
import { CORPSE_SECONDS, CREATURE_BY_ID, CreatureState, MAX_ATTACKERS_PER_PLAYER } from '../../shared/creatures.js';
import { MAP } from '../../shared/mapData.js';
import type { MapBonfire, MapCamp, MapChest } from '../../shared/mapTypes.js';
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
} from '../../shared/protocol.js';
import {
  deriveStats,
  isInvulnerable,
  MAX_POTIONS,
  PLAYER_RADIUS,
  STAGGER_SECONDS,
  STARTING_POTIONS,
  TICK_RATE,
} from '../../shared/sim.js';
import { parseInput, withLoadTestCreatures, World, type ServerInput, type WorldPlayer } from '../src/app/combat.js';
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
  join(classId: ClassId, variant?: number, chests?: number[]): WorldPlayer;
  moveTo(thing: { state: { x: number; z: number } }, dx: number, dz: number): void;
  place(creature: Creature, dx: number, dz: number): void;
  camps: (kind: string, count: number) => MapCamp;
}

function stage(options: { camps?: MapCamp[]; chests?: MapChest[]; bonfires?: MapBonfire[]; rollHigh?: boolean } = {}): Staged {
  const staged: Staged = {
    sent: [],
    credits: [],
    chestCalls: [],
    chestAnswer: async () => true,
    unlocks: [],
    events: [],
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
    join(classId, variant = 0, chests = []) {
      const baseStats = CLASSES.find((item) => item.id === classId)!.baseStats;
      const player = world.addPlayer({
        userId: `user-${classId}-${Math.random()}`,
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
    },
    {
      spawn: { x: OPEN.x, z: OPEN.z, radius: 2 },
      camps: options.camps ?? [],
      chests: options.chests ?? [],
      bonfires: options.bonfires ?? [],
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
    if (events.some((event) => event.k === 'hit' || event.k === 'swing' || event.k === 'shot')) return { events, ticks };
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

  it('splashes up to its target limit around the impact', () => {
    const staged = stage({ camps: [staged_camp('bull', 5)] });
    const player = staged.join('arcanist', 0);
    const creatures = staged.world.field.creatures;
    // Held in place, or they'd charge and push each other apart before the shot arrives.
    const hold = () => creatures.forEach((creature, index) => staged.place(creature, index * 0.2, 6 + index * 0.1));
    hold();
    swingUntilHit(staged, player);
    const flight: GameEvent[] = [];
    for (let index = 0; index < 15; index += 1) {
      hold();
      flight.push(...staged.tick());
    }
    const { maxTargets } = weaponFor('arcanist', 0).projectile!;
    assert.ok(creatures.length > maxTargets);
    assert.equal(ofKind(flight, 'hit').length, maxTargets);
    const [end] = ofKind(flight, 'shotEnd');
    assert.equal(end.splash, weaponFor('arcanist', 0).projectile!.splash);
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
    const bonfire = { id: 1, x: OPEN.x + 70, z: OPEN.z };
    const staged = stage({ camps: [staged_camp('wolf')], bonfires: [bonfire] });
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
    assert.ok(Math.hypot(player.state.x - bonfire.x, player.state.z - bonfire.z) < 5, 'back at the bonfire');
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

  it('keeps out of the circle around a bonfire and gives up on a player standing in one', () => {
    const bonfire = { id: 1, x: OPEN.x, z: OPEN.z };
    const staged = stage({ camps: [{ ...staged_camp('wolf'), x: OPEN.x, z: OPEN.z + 14 }], bonfires: [bonfire] });
    const player = staged.join('ranger', 0);
    const wolf = staged.world.field.creatures[0];
    wolf.x = OPEN.x;
    wolf.z = OPEN.z + 11;
    for (let ticks = 0; ticks < TICK_RATE * 10; ticks += 1) {
      staged.tick();
      assert.ok(Math.hypot(wolf.x - bonfire.x, wolf.z - bonfire.z) >= 9.99, 'it should stay out of the circle');
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
    });
    for (let index = 0; index < 50; index += 1) {
      const player = world.addPlayer({
        userId: String(index),
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
    assert.equal(snapshot.p[0].length, 20);
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
    store.add('a', { dust: 3, enemies: 1 });
    store.add('a', { dust: 2 });
    store.add('b', { animals: 1, deaths: 1 });
    await store.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [['a', 'b'], [5, 0], [1, 0], [0, 1], [0, 1]]);
    assert.ok(!calls[0].text.includes("'a'"), 'values only ever travel as parameters');
    await store.flush();
    assert.equal(calls.length, 1, 'already saved');
  });

  it('keeps what failed to save for the next batch, and never loses or doubles it', async () => {
    const { store, calls, control } = fake(true);
    store.add('a', { dust: 5 });
    await store.flush();
    assert.equal(store.unsaved('a')?.dust, 5, 'still held in memory');
    store.add('a', { dust: 1 });
    control.fail = false;
    await store.flush();
    assert.deepEqual(calls[1].params[1], [6]);
    assert.equal(store.unsaved('a'), undefined);
  });

  it('never rejects into the game loop when the database fails', async () => {
    const { store } = fake(true);
    store.add('a', { dust: 1 });
    await store.flush();
    await store.flushUser('a');
    await store.settle();
    assert.equal(store.unsaved('a')?.dust, 1);
  });

  it('saves one player at once when they leave, without touching the others', async () => {
    const { store, calls } = fake();
    store.add('a', { dust: 1 });
    store.add('b', { dust: 2 });
    await store.flushUser('a');
    assert.deepEqual(calls[0].params[0], ['a']);
    assert.equal(store.unsaved('b')?.dust, 2);
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
    store.add('a', { dust: 1 });
    const first = store.flush();
    store.add('b', { dust: 1 });
    await store.flush();
    assert.equal(count, 1);
    finish();
    await first;
    assert.equal(store.unsaved('b')?.dust, 1, 'picked up by the next one');
  });

  it('reports a chest as new only if the database row was new', async () => {
    let rowCount = 1;
    const store = new ProgressStore(async () => ({ rows: [], rowCount }));
    assert.equal(await store.openChest('a', 1, 40), true);
    rowCount = 0;
    assert.equal(await store.openChest('a', 1, 40), false);
    assert.equal(await store.unlock('a', 'first_blood'), false);
  });
});

describe('performance', () => {
  it('only adds load test creatures when asked with a sensible number', () => {
    const base = { spawn: { x: 0, z: 0, radius: 1 }, camps: [{ kind: 'wolf', x: 0, z: 0, count: 2, radius: 1 }], chests: [], bonfires: [] };
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
