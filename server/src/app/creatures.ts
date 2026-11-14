/**
 * Animals and what they decide to do. Decisions run 10 times a second, in three groups so they
 * spread across ticks, and movement runs every tick. A creature with no player anywhere near is
 * asleep and costs almost nothing. docs/GAME_PLAN.md section 3 has the states this follows.
 */
import { BOSS_MOVE_NAMES, BOSS_MOVES, BOSS_STANCE, BossMove, type BossMoveId } from '../../../shared/boss.js';
import { CRITICAL_SECONDS } from '../../../shared/combat.js';
import { collide, segmentBlocked } from '../../../shared/collision.js';
import type { MapCamp, MapGrace } from '../../../shared/mapTypes.js';
import {
  CORPSE_SECONDS,
  CREATURE_BY_ID,
  CreatureState,
  isHostile,
  MAX_ATTACKERS_PER_PLAYER,
  type CreatureKind,
  type CreatureStateId,
} from '../../../shared/creatures.js';
import type { GameEvent } from '../../../shared/protocol.js';
import { jumpHeight, PLAYER_RADIUS, TICK_DT, TICK_RATE, type Derived, type SimState } from '../../../shared/sim.js';

export const Mode = {
  Sleep: 0,
  Idle: 1,
  Alert: 2,
  Chase: 3,
  Circle: 4,
  Windup: 5,
  Strike: 6,
  Recover: 7,
  Stagger: 8,
  Return: 9,
  Flee: 10,
  Dead: 11,
  Gone: 12,
} as const;
export type ModeId = (typeof Mode)[keyof typeof Mode];

const SLEEP_RADIUS = 60;
// A little wider than the wake distance, so a player at the edge doesn't flip it back and forth.
const STAY_AWAKE_RADIUS = 66;
const SLEEP_CHECK_TICKS = TICK_RATE / 2;
const ALERT_SECONDS = 0.4;
const STAGGER_CREATURE_SECONDS = 0.8;
// Long enough to be seen in a snapshot, which go out every other tick.
const STRIKE_SECONDS = 0.1;
const STRIKE_LUNGE_SPEED = 7;
const FACING_LOCK_SECONDS = 0.25;
const FLEE_SECONDS = 4;
/** Prey only notices a walking or standing player at this share of its usual distance. */
const QUIET_SHARE = 0.45;
const RETURN_HEAL_PER_SECOND = 0.2;
const CIRCLE_RADIUS = 4;
const PACK_RADIUS = 25;
/** A wolf pack sends one attacker at a time. */
const PACK_ATTACK_GAP_SECONDS = 1.2;
const TOKEN_SECONDS = 2.5;
/** No more than this much in a bite's range past the bite itself, for network delay. */
const BITE_TOLERANCE = 0.3;
const BITE_FACING_COS = 0.5;
const SEPARATION_NEIGHBORS = 4;
const SEPARATION_SPEED = 2;
const WANDER_PAUSE_MIN = 2;
const WANDER_PAUSE_MAX = 6;
const STUCK_CHECK_SECONDS = 1;
const STUCK_MIN_PROGRESS = 0.5;
const STUCK_LIMIT = 3;
/** Enemies keep out of this circle around a Binary Grace. */
const GRACE_WARD = 10;
// shared/collision.ts only promises to find colliders for circles up to this wide.
const LARGEST_COLLISION_RADIUS = 1;

/* The boss. Its moves and their numbers are in shared/boss.ts, so the browser's warnings match. */
const BOSS_MOVE_COUNT = BOSS_MOVE_NAMES.length;
/** The moves by wire id, so a move can be looked up without building a name each time. */
const BOSS_MOVE_LIST = BOSS_MOVE_NAMES.map((name) => BOSS_MOVES[name]);
/** Slow on purpose: walking around it is how a player gets behind it. */
const BOSS_TURN_RATE = 3;
/** Stops turning this long before a hit, so a late step to the side is what dodges it. */
const BOSS_ALERT_SECONDS = 0.8;
/** How fast it turns to follow its target during a windup. */
const BOSS_TRACK_DEGREES_PER_SECOND = 150;
/** It stops turning this long before the hit, so a late sidestep works and the warning has settled. */
const BOSS_COMMIT_SECONDS = 0.35;
const BOSS_STAGGER_SECONDS = 1.2;
/** With no living player inside its leash for this long, it goes home and heals. */
const BOSS_GIVE_UP_SECONDS = 6;
/** Beyond this it runs to close the gap instead of walking. */
const BOSS_RUN_DISTANCE = 12;
/** It stops walking in once the target is this deep in its swipe's reach. */
const BOSS_CLOSE_SHARE = 0.7;
/** A jump clears the leap's landing and the stomp's ring once the player is this high, in meters. */
const JUMP_CLEAR_HEIGHT = 0.3;
// Floating-point timers can end a hair above zero, which would put a hit one tick late.
const TIMER_EPSILON = 1e-6;
/** After a stun ends with no critical, it stands still this long before acting. */
const BOSS_RISE_SECONDS = 1;

/** The player fields creatures need. The world's players satisfy this. */
export interface CreatureTarget {
  id: number;
  state: SimState;
  derived: Derived;
  gone: boolean;
  /** Creatures currently allowed to attack this player. */
  attackers: number;
}

export interface CreatureHost {
  players: readonly CreatureTarget[];
  /** A strike connected. Damage rules live with the rest of combat. */
  bite(creature: Creature, target: CreatureTarget): void;
  /**
   * A boss move reached a player, with knockback away from fromX, fromZ. Goes through the same damage
   * rules as a bite. False if it didn't land, because they were dead or in a roll's safe frames.
   */
  bossHurt(boss: Creature, target: CreatureTarget, move: BossMoveId, damage: number, fromX: number, fromZ: number): boolean;
  /** Fires one boss fireball from x, z along yaw. Combat moves it with the other projectiles. */
  bossFireball(boss: Creature, x: number, z: number, yaw: number): void;
  /** Tells players near x, z what the boss is doing. */
  emit(event: GameEvent, x: number, z: number, about: number): void;
}

/** What only a boss needs. Made once per boss, so a fight allocates nothing. */
export class BossState {
  /** The move being wound up or carried out, or -1. */
  move = -1;
  lastMove = -1;
  /** How many times in a row lastMove has been used. */
  repeats = 0;
  /** World time each move may next be picked, by wire id. */
  readyAt = new Float64Array(BOSS_MOVE_COUNT);
  /** Where the move aims: the leap's landing point, or the target's spot when the windup began. */
  aimX = 0;
  aimZ = 0;
  /** Where the boss stood when the windup began, for the leap's flight. */
  fromX = 0;
  fromZ = 0;
  chargeLeft = 0;
  chargeLanded = false;
  /** Players this charge has already reached, so each is hit once. */
  charged = new Set<CreatureTarget>();
  ringActive = false;
  ringX = 0;
  ringZ = 0;
  ringRadius = 0;
  /** Players the stomp's ring has already passed. */
  ringed = new Set<CreatureTarget>();
  /** Seconds with no living player inside the leash. */
  lonely = 0;
  /** It has noticed someone, so nearby players are sent its health bar. */
  engaged = false;
  /** Filled by players' hits; at BOSS_STANCE.max it breaks. */
  stance = 0;
  /** World time of the last hit that added stance, for its decay. */
  stanceHitAt = -Infinity;
  /** Collapsed after a stance break. Its mode is Stagger and its timer the seconds left. */
  stunned = false;
  /** The player doing a critical on it right now, if any. Only one at a time. */
  critBy: CreatureTarget | null = null;
  /** A critical's blow already landed on this break, so no second one may follow it. */
  critLanded = false;
  /** Seconds left in which hits add no stance, so it can't be kept down. */
  immuneLeft = 0;

  reset(): void {
    this.move = -1;
    this.lastMove = -1;
    this.repeats = 0;
    this.readyAt.fill(0);
    this.chargeLeft = 0;
    this.chargeLanded = false;
    this.charged.clear();
    this.ringActive = false;
    this.ringed.clear();
    this.lonely = 0;
    this.engaged = false;
    this.clearStance();
  }

  clearStance(): void {
    this.stance = 0;
    this.stanceHitAt = -Infinity;
    this.stunned = false;
    this.critBy = null;
    this.critLanded = false;
    this.immuneLeft = 0;
  }
}

interface Camp {
  x: number;
  z: number;
  radius: number;
  members: Creature[];
  nextAttackAt: number;
}

function isQuiet(state: { moving: number; dodgeTime: number }): boolean {
  return state.moving < 2 && state.dodgeTime <= 0;
}

export class Creature {
  x = 0;
  z = 0;
  yaw = Math.random() * Math.PI * 2;
  health: number;
  mode: ModeId = Mode.Sleep;
  /** What the browser is told it's doing. */
  visual: CreatureStateId = CreatureState.Idle;
  timer = 0;
  target: CreatureTarget | null = null;
  hasToken = false;
  tokenTimer = 0;
  wanderX = 0;
  wanderZ = 0;
  walking = false;
  pushX = 0;
  pushZ = 0;
  poise = 0;
  lastPoiseHit = -Infinity;
  /** Who hit it, and when, for shared loot. */
  hitters = new Map<CreatureTarget, number>();
  threatX = 0;
  threatZ = 0;
  fleeAngle = 0;
  checkX = 0;
  checkZ = 0;
  checkTimer = STUCK_CHECK_SECONDS;
  stuck = 0;
  detourTimer = 0;
  detourSign = 1;
  circleSign = Math.random() < 0.5 ? 1 : -1;
  packedAt = -1;
  packed = '';
  /** Only set for a boss. */
  readonly boss: BossState | null;

  constructor(
    readonly id: number,
    readonly kindIndex: number,
    readonly kind: CreatureKind,
    readonly camp: Camp,
  ) {
    this.health = kind.health;
    this.boss = kind.behavior === 'boss' ? new BossState() : null;
  }

  get alive(): boolean {
    return this.mode < Mode.Dead;
  }
}

function isValidTarget(target: CreatureTarget | null): target is CreatureTarget {
  return target !== null && !target.gone && target.state.deadTime <= 0;
}

function angleBetween(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  else if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Squared distance from a point to the segment from a to b. */
function segmentDistanceSquared(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abX = bx - ax;
  const abZ = bz - az;
  const lengthSquared = abX * abX + abZ * abZ;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * abX + (pz - az) * abZ) / lengthSquared)) : 0;
  const dx = px - (ax + abX * t);
  const dz = pz - (az + abZ * t);
  return dx * dx + dz * dz;
}

/** High enough in a jump to clear the leap's landing and the stomp's ring. */
function isAirborne(state: SimState): boolean {
  return state.jumpTime > 0 && jumpHeight(state.jumpTime) >= JUMP_CLEAR_HEIGHT;
}

function reachOf(kind: CreatureKind): number {
  return kind.biteRange + PLAYER_RADIUS;
}

/** Bulls commit to a charge and take a while to turn, which is what makes them possible to dodge. */
function turnRate(kind: CreatureKind): number {
  if (kind.behavior === 'boss') return BOSS_TURN_RATE;
  return kind.id === 'bull' ? 2.5 : 9;
}

export class CreatureField {
  readonly creatures: Creature[] = [];
  /** The bosses among them, usually one, so a snapshot needn't look through every creature. */
  readonly bosses: Creature[] = [];
  private time = 0;
  private moveChoices: number[] = [];
  private spot = { x: 0, z: 0 };

  constructor(
    camps: readonly MapCamp[],
    private graces: readonly MapGrace[],
    private host: CreatureHost,
    private random: () => number = Math.random,
  ) {
    let nextId = 1;
    for (const source of camps) {
      const entry = CREATURE_BY_ID.get(source.kind);
      if (!entry) continue;
      const camp: Camp = { x: source.x, z: source.z, radius: source.radius, members: [], nextAttackAt: 0 };
      for (let index = 0; index < source.count; index += 1) {
        const creature = new Creature(nextId++, entry.index, entry.kind, camp);
        camp.members.push(creature);
        this.creatures.push(creature);
        if (creature.boss) this.bosses.push(creature);
        this.placeInCamp(creature);
      }
    }
  }

  private placeInCamp(c: Creature): void {
    const angle = Math.random() * Math.PI * 2;
    // A boss waits in the middle of its arena.
    const distance = c.boss ? 0 : Math.sqrt(Math.random()) * c.camp.radius;
    c.x = c.camp.x + Math.cos(angle) * distance;
    c.z = c.camp.z + Math.sin(angle) * distance;
    this.settle(c);
    c.wanderX = c.x;
    c.wanderZ = c.z;
    c.checkX = c.x;
    c.checkZ = c.z;
  }

  /** Slides along whatever it walked into, and out of a grace's circle. */
  private settle(c: Creature): void {
    collide(c, Math.min(c.kind.radius, LARGEST_COLLISION_RADIUS));
    if (!isHostile(c.kind)) return;
    for (const grace of this.graces) {
      const dx = c.x - grace.x;
      const dz = c.z - grace.z;
      const squared = dx * dx + dz * dz;
      if (squared >= GRACE_WARD * GRACE_WARD) continue;
      const distance = Math.sqrt(squared) || 1;
      c.x = grace.x + (dx / distance) * GRACE_WARD;
      c.z = grace.z + (dz / distance) * GRACE_WARD;
      collide(c, Math.min(c.kind.radius, LARGEST_COLLISION_RADIUS));
    }
  }

  private isWarded(state: SimState): boolean {
    for (const grace of this.graces) {
      const dx = state.x - grace.x;
      const dz = state.z - grace.z;
      if (dx * dx + dz * dz < GRACE_WARD * GRACE_WARD) return true;
    }
    return false;
  }

  /** True if a hunter that's awake is this close. A sleeping one hasn't noticed anyone, so it doesn't count. */
  huntersNear(x: number, z: number, radius: number): boolean {
    for (const c of this.creatures) {
      if (!c.alive || !isHostile(c.kind) || c.mode === Mode.Sleep) continue;
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz <= radius * radius) return true;
    }
    return false;
  }

  step(tickNumber: number): void {
    this.time += TICK_DT;
    const group = tickNumber % 3;
    const sleepGroup = tickNumber % SLEEP_CHECK_TICKS;
    for (const c of this.creatures) {
      if (c.mode === Mode.Gone) {
        c.timer -= TICK_DT;
        if (c.timer <= 0) this.respawn(c);
        continue;
      }
      if (c.mode === Mode.Dead) {
        c.timer -= TICK_DT;
        if (c.timer <= 0) {
          c.mode = Mode.Gone;
          c.timer = Math.max(0, c.kind.respawnSeconds - CORPSE_SECONDS);
        }
        continue;
      }
      if (c.mode === Mode.Sleep) {
        if (c.id % SLEEP_CHECK_TICKS === sleepGroup && this.anyPlayerWithin(c, SLEEP_RADIUS)) this.startIdle(c);
        continue;
      }
      // One boss is cheap, so it thinks every tick: its moves are timed to the tick.
      if (c.boss) {
        this.runBoss(c, c.boss);
        continue;
      }
      if (c.id % 3 === group) {
        this.separate(c);
        if (c.kind.behavior === 'hunter') this.decideHunter(c);
        else this.decidePrey(c);
      }
      this.act(c);
    }
  }

  private respawn(c: Creature): void {
    c.health = c.kind.health;
    c.mode = Mode.Sleep;
    c.visual = CreatureState.Idle;
    c.target = null;
    c.hasToken = false;
    c.poise = 0;
    c.stuck = 0;
    c.pushX = 0;
    c.pushZ = 0;
    c.hitters.clear();
    c.boss?.reset();
    this.placeInCamp(c);
  }

  private anyPlayerWithin(c: Creature, range: number): boolean {
    const squared = range * range;
    for (const player of this.host.players) {
      const dx = player.state.x - c.x;
      const dz = player.state.z - c.z;
      if (dx * dx + dz * dz <= squared) return true;
    }
    return false;
  }

  private nearestLivingPlayer(c: Creature, range: number): CreatureTarget | null {
    let best: CreatureTarget | null = null;
    let bestSquared = range * range;
    for (const player of this.host.players) {
      if (player.state.deadTime > 0) continue;
      const dx = player.state.x - c.x;
      const dz = player.state.z - c.z;
      const squared = dx * dx + dz * dz;
      if (squared > bestSquared) continue;
      if (isHostile(c.kind) && this.isWarded(player.state)) continue;
      // Prey outruns any player, so a careful walk is how a melee weapon ever gets close enough.
      if (c.kind.behavior === 'prey' && isQuiet(player.state) && squared > range * range * QUIET_SHARE * QUIET_SHARE) continue;
      best = player;
      bestSquared = squared;
    }
    return best;
  }

  /** Pushes apart from a few close neighbors. Only worked out on decision ticks. */
  private separate(c: Creature): void {
    let pushX = 0;
    let pushZ = 0;
    let found = 0;
    for (const other of this.creatures) {
      if (other === c || !other.alive) continue;
      const limit = c.kind.radius + other.kind.radius + 0.3;
      const dx = c.x - other.x;
      const dz = c.z - other.z;
      if (dx > limit || dx < -limit || dz > limit || dz < -limit) continue;
      const squared = dx * dx + dz * dz;
      if (squared >= limit * limit) continue;
      const distance = Math.sqrt(squared) || 0.01;
      pushX += (dx || 0.01) / distance;
      pushZ += dz / distance;
      found += 1;
      if (found >= SEPARATION_NEIGHBORS) break;
    }
    c.pushX = pushX * SEPARATION_SPEED;
    c.pushZ = pushZ * SEPARATION_SPEED;
  }

  private releaseToken(c: Creature): void {
    if (c.hasToken && c.target) c.target.attackers = Math.max(0, c.target.attackers - 1);
    c.hasToken = false;
  }

  private setTarget(c: Creature, target: CreatureTarget | null): void {
    if (c.target !== target) this.releaseToken(c);
    c.target = target;
  }

  private tryToken(c: Creature, target: CreatureTarget): boolean {
    if (c.hasToken) return true;
    if (target.attackers >= MAX_ATTACKERS_PER_PLAYER) return false;
    if (this.time < c.camp.nextAttackAt) return false;
    for (const mate of c.camp.members) {
      if (mate.hasToken) return false;
    }
    target.attackers += 1;
    c.hasToken = true;
    c.tokenTimer = TOKEN_SECONDS;
    return true;
  }

  private startIdle(c: Creature): void {
    this.setTarget(c, null);
    c.mode = Mode.Idle;
    c.walking = false;
    c.timer = WANDER_PAUSE_MIN * Math.random();
    c.stuck = 0;
  }

  private startAlert(c: Creature, target: CreatureTarget): void {
    this.setTarget(c, target);
    c.mode = Mode.Alert;
    c.timer = ALERT_SECONDS;
    this.resetProgress(c);
  }

  private alertPack(c: Creature, target: CreatureTarget): void {
    for (const mate of c.camp.members) {
      if (mate === c || (mate.mode !== Mode.Idle && mate.mode !== Mode.Sleep)) continue;
      const dx = mate.x - c.x;
      const dz = mate.z - c.z;
      if (dx * dx + dz * dz <= PACK_RADIUS * PACK_RADIUS) this.startAlert(mate, target);
    }
  }

  private startReturn(c: Creature): void {
    this.setTarget(c, null);
    c.mode = Mode.Return;
    c.hitters.clear();
    this.resetProgress(c);
  }

  private startFlee(c: Creature, fromX: number, fromZ: number): void {
    if (c.mode === Mode.Stagger) {
      c.threatX = fromX;
      c.threatZ = fromZ;
      return;
    }
    c.mode = Mode.Flee;
    c.timer = FLEE_SECONDS;
    c.threatX = fromX;
    c.threatZ = fromZ;
    c.fleeAngle = (Math.random() - 0.5) * 1;
    this.resetProgress(c);
  }

  private fleeHerd(c: Creature, fromX: number, fromZ: number): void {
    this.startFlee(c, fromX, fromZ);
    for (const mate of c.camp.members) {
      if (mate === c || !mate.alive) continue;
      const dx = mate.x - c.x;
      const dz = mate.z - c.z;
      if (dx * dx + dz * dz <= PACK_RADIUS * PACK_RADIUS) this.startFlee(mate, fromX, fromZ);
    }
  }

  private homeDistanceSquared(c: Creature): number {
    const dx = c.x - c.camp.x;
    const dz = c.z - c.camp.z;
    return dx * dx + dz * dz;
  }

  private decideHunter(c: Creature): void {
    const { kind } = c;
    switch (c.mode) {
      case Mode.Idle: {
        const target = this.nearestLivingPlayer(c, kind.aggro);
        if (target && !segmentBlocked(c.x, c.z, target.state.x, target.state.z)) {
          this.startAlert(c, target);
          this.alertPack(c, target);
        } else if (!this.anyPlayerWithin(c, STAY_AWAKE_RADIUS)) {
          c.mode = Mode.Sleep;
          c.visual = CreatureState.Idle;
        }
        break;
      }
      case Mode.Chase:
      case Mode.Circle: {
        if (!isValidTarget(c.target) || this.isWarded(c.target.state)) {
          const next = this.nearestLivingPlayer(c, kind.aggro);
          if (next) this.setTarget(c, next);
          else {
            this.startReturn(c);
            break;
          }
        }
        if (this.homeDistanceSquared(c) > kind.leash * kind.leash) {
          this.startReturn(c);
          break;
        }
        const target = c.target!;
        const dx = target.state.x - c.x;
        const dz = target.state.z - c.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const isPack = kind.id === 'wolf';
        const engageAt = isPack ? CIRCLE_RADIUS + 1 : reachOf(kind) + 1;
        if (c.hasToken) {
          c.tokenTimer -= TICK_DT * 3;
          if (c.tokenTimer <= 0) this.releaseToken(c);
        } else if (distance <= engageAt) {
          this.tryToken(c, target);
        }
        if (c.hasToken) c.mode = Mode.Chase;
        else if (isPack && distance <= engageAt) c.mode = Mode.Circle;
        else if (c.mode === Mode.Circle && distance > CIRCLE_RADIUS + 3) c.mode = Mode.Chase;
        break;
      }
      case Mode.Windup:
      case Mode.Recover:
        if (!isValidTarget(c.target)) this.startReturn(c);
        break;
      default:
        break;
    }
  }

  private decidePrey(c: Creature): void {
    const { kind } = c;
    if (c.mode === Mode.Idle) {
      const threat = this.nearestLivingPlayer(c, kind.aggro);
      if (threat) this.fleeHerd(c, threat.state.x, threat.state.z);
      else if (!this.anyPlayerWithin(c, STAY_AWAKE_RADIUS)) {
        c.mode = Mode.Sleep;
        c.visual = CreatureState.Idle;
      }
    } else if (c.mode === Mode.Flee) {
      if (this.homeDistanceSquared(c) > kind.leash * kind.leash) {
        this.startReturn(c);
        return;
      }
      const threat = this.nearestLivingPlayer(c, kind.aggro * 1.5);
      if (threat) {
        c.threatX = threat.state.x;
        c.threatZ = threat.state.z;
        c.timer = FLEE_SECONDS;
      }
    }
  }

  private act(c: Creature): void {
    switch (c.mode) {
      case Mode.Idle:
        this.actIdle(c);
        break;
      case Mode.Alert:
        c.visual = CreatureState.Idle;
        this.faceTarget(c);
        c.timer -= TICK_DT;
        if (c.timer <= 0) {
          c.mode = Mode.Chase;
          this.resetProgress(c);
        }
        break;
      case Mode.Chase:
        this.actChase(c);
        break;
      case Mode.Circle:
        this.actCircle(c);
        break;
      case Mode.Windup:
        c.visual = CreatureState.Windup;
        c.timer -= TICK_DT;
        if (c.timer > Math.min(FACING_LOCK_SECONDS, c.kind.windup / 2)) this.faceTarget(c);
        if (c.timer <= 0) this.strike(c);
        break;
      case Mode.Strike:
        c.visual = CreatureState.Strike;
        c.timer -= TICK_DT;
        c.x += Math.sin(c.yaw) * STRIKE_LUNGE_SPEED * TICK_DT;
        c.z += Math.cos(c.yaw) * STRIKE_LUNGE_SPEED * TICK_DT;
        this.settle(c);
        if (c.timer <= 0) {
          this.releaseToken(c);
          c.mode = Mode.Recover;
          c.timer = c.kind.recovery;
        }
        return;
      case Mode.Recover:
        c.visual = CreatureState.Recover;
        c.timer -= TICK_DT;
        if (c.timer <= 0) {
          c.mode = Mode.Chase;
          this.resetProgress(c);
        }
        break;
      case Mode.Stagger:
        c.visual = CreatureState.Stagger;
        c.timer -= TICK_DT;
        if (c.timer <= 0) this.endStagger(c);
        break;
      case Mode.Return:
        this.actReturn(c);
        break;
      case Mode.Flee:
        this.actFlee(c);
        break;
      default:
        return;
    }
    if (c.mode !== Mode.Windup && (c.pushX !== 0 || c.pushZ !== 0)) {
      c.x += c.pushX * TICK_DT;
      c.z += c.pushZ * TICK_DT;
      this.settle(c);
    }
  }

  private endStagger(c: Creature): void {
    if (c.kind.behavior === 'prey') {
      c.mode = Mode.Flee;
      c.timer = FLEE_SECONDS;
      this.resetProgress(c);
    } else if (isValidTarget(c.target)) {
      c.mode = Mode.Chase;
      this.resetProgress(c);
    } else {
      this.startReturn(c);
    }
  }

  private actIdle(c: Creature): void {
    c.timer -= TICK_DT;
    if (c.walking) {
      const dx = c.wanderX - c.x;
      const dz = c.wanderZ - c.z;
      // A spot behind a tree is never reached, so walking also gives up when the timer runs out.
      if (dx * dx + dz * dz < 0.25 || c.timer <= 0) {
        c.walking = false;
        c.timer = WANDER_PAUSE_MIN + Math.random() * (WANDER_PAUSE_MAX - WANDER_PAUSE_MIN);
        c.visual = CreatureState.Idle;
      } else {
        this.steer(c, dx, dz, c.kind.walkSpeed);
        c.visual = CreatureState.Walk;
      }
    } else if (c.timer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * c.camp.radius;
      c.wanderX = c.camp.x + Math.cos(angle) * distance;
      c.wanderZ = c.camp.z + Math.sin(angle) * distance;
      c.walking = true;
      c.timer = 6;
    } else {
      c.visual = CreatureState.Idle;
    }
  }

  private actChase(c: Creature): void {
    const target = c.target;
    if (!isValidTarget(target)) {
      c.visual = CreatureState.Idle;
      return;
    }
    const dx = target.state.x - c.x;
    const dz = target.state.z - c.z;
    const squared = dx * dx + dz * dz;
    const reach = reachOf(c.kind);
    if (c.hasToken && squared <= (reach * 0.9) ** 2) {
      c.mode = Mode.Windup;
      c.timer = c.kind.windup;
      c.visual = CreatureState.Windup;
      c.camp.nextAttackAt = this.time + PACK_ATTACK_GAP_SECONDS;
      return;
    }
    if (squared <= (reach * 0.75) ** 2) {
      // Waiting its turn right next to the player.
      this.faceTarget(c);
      c.visual = CreatureState.Idle;
      this.resetProgress(c);
      return;
    }
    this.travel(c, dx, dz, c.kind.runSpeed);
    c.visual = CreatureState.Run;
    this.watchProgress(c);
  }

  private actCircle(c: Creature): void {
    const target = c.target;
    if (!isValidTarget(target)) {
      c.visual = CreatureState.Idle;
      return;
    }
    const dx = target.state.x - c.x;
    const dz = target.state.z - c.z;
    const distance = Math.sqrt(dx * dx + dz * dz) || 0.01;
    // Around the player, drifting back to the circle's edge.
    const toEdge = (distance - CIRCLE_RADIUS) * 0.5;
    const moveX = (dx / distance) * toEdge - (dz / distance) * c.circleSign;
    const moveZ = (dz / distance) * toEdge + (dx / distance) * c.circleSign;
    const length = Math.sqrt(moveX * moveX + moveZ * moveZ) || 1;
    c.x += (moveX / length) * c.kind.walkSpeed * 1.4 * TICK_DT;
    c.z += (moveZ / length) * c.kind.walkSpeed * 1.4 * TICK_DT;
    this.settle(c);
    this.faceTarget(c);
    c.visual = CreatureState.Walk;
    if (Math.random() < TICK_DT / 4) c.circleSign = -c.circleSign;
  }

  private actReturn(c: Creature): void {
    const dx = c.camp.x - c.x;
    const dz = c.camp.z - c.z;
    c.health = Math.min(c.kind.health, c.health + c.kind.health * RETURN_HEAL_PER_SECOND * TICK_DT);
    if (dx * dx + dz * dz <= Math.max(1, c.camp.radius) ** 2) {
      this.startIdle(c);
      return;
    }
    this.travel(c, dx, dz, Math.max(c.kind.walkSpeed, c.kind.runSpeed * 0.5));
    c.visual = CreatureState.Walk;
    this.watchProgress(c);
  }

  private actFlee(c: Creature): void {
    c.timer -= TICK_DT;
    if (c.timer <= 0) {
      this.startIdle(c);
      return;
    }
    const dx = c.x - c.threatX;
    const dz = c.z - c.threatZ;
    const away = Math.atan2(dx, dz) + c.fleeAngle;
    this.travel(c, Math.sin(away), Math.cos(away), c.kind.runSpeed);
    c.visual = CreatureState.Run;
    this.watchProgress(c);
  }

  /** Turns toward a heading, trying a side step while stuck, and moves the way it's facing. */
  private travel(c: Creature, dx: number, dz: number, speed: number): void {
    if (c.detourTimer > 0) {
      c.detourTimer -= TICK_DT;
      const cos = Math.SQRT1_2;
      const sin = Math.SQRT1_2 * c.detourSign;
      const rotatedX = dx * cos + dz * sin;
      dz = -dx * sin + dz * cos;
      dx = rotatedX;
    }
    this.steer(c, dx, dz, speed);
  }

  private steer(c: Creature, dx: number, dz: number, speed: number): void {
    const wanted = Math.atan2(dx, dz);
    const maxTurn = turnRate(c.kind) * TICK_DT;
    const diff = angleBetween(c.yaw, wanted);
    c.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    c.x += Math.sin(c.yaw) * speed * TICK_DT;
    c.z += Math.cos(c.yaw) * speed * TICK_DT;
    this.settle(c);
  }

  private faceTarget(c: Creature): void {
    if (!c.target) return;
    this.facePoint(c, c.target.state.x, c.target.state.z);
  }

  private facePoint(c: Creature, x: number, z: number): void {
    if (x === c.x && z === c.z) return;
    const wanted = Math.atan2(x - c.x, z - c.z);
    const maxTurn = turnRate(c.kind) * TICK_DT;
    const diff = angleBetween(c.yaw, wanted);
    c.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  private resetProgress(c: Creature): void {
    c.checkX = c.x;
    c.checkZ = c.z;
    c.checkTimer = STUCK_CHECK_SECONDS;
  }

  /** There is no pathfinding: a creature that isn't getting anywhere tries a side step, then gives up. */
  private watchProgress(c: Creature): void {
    c.checkTimer -= TICK_DT;
    if (c.checkTimer > 0) return;
    const dx = c.x - c.checkX;
    const dz = c.z - c.checkZ;
    this.resetProgress(c);
    if (dx * dx + dz * dz >= STUCK_MIN_PROGRESS * STUCK_MIN_PROGRESS) {
      c.stuck = 0;
      return;
    }
    c.stuck += 1;
    // A cornered animal keeps trying: going home would heal it and forget who hit it.
    if (c.stuck < STUCK_LIMIT || c.mode === Mode.Flee) {
      c.detourTimer = STUCK_CHECK_SECONDS;
      c.detourSign = Math.random() < 0.5 ? 1 : -1;
    } else if (c.mode === Mode.Return) {
      this.startIdle(c);
    } else {
      this.startReturn(c);
    }
  }

  private strike(c: Creature): void {
    c.mode = Mode.Strike;
    c.timer = STRIKE_SECONDS;
    c.visual = CreatureState.Strike;
    const target = c.target;
    if (!isValidTarget(target)) return;
    const dx = target.state.x - c.x;
    const dz = target.state.z - c.z;
    const squared = dx * dx + dz * dz;
    const reach = reachOf(c.kind) + BITE_TOLERANCE;
    if (squared > reach * reach) return;
    if (squared > 1) {
      const distance = Math.sqrt(squared);
      const facing = (dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)) / distance;
      if (facing < BITE_FACING_COS) return;
    }
    this.host.bite(c, target);
  }

  /** A player's hit landed and it survived. */
  onHit(c: Creature, attacker: CreatureTarget, poiseBroke: boolean): void {
    if (c.boss) {
      this.bossOnHit(c, c.boss, attacker, poiseBroke);
      return;
    }
    if (c.kind.behavior === 'prey') {
      if (poiseBroke) {
        c.mode = Mode.Stagger;
        c.timer = STAGGER_CREATURE_SECONDS;
      }
      this.fleeHerd(c, attacker.state.x, attacker.state.z);
      return;
    }
    if (poiseBroke) {
      this.releaseToken(c);
      if (!isValidTarget(c.target)) this.setTarget(c, attacker);
      c.mode = Mode.Stagger;
      c.timer = STAGGER_CREATURE_SECONDS;
      return;
    }
    if (c.mode === Mode.Sleep || c.mode === Mode.Idle) {
      this.startAlert(c, attacker);
      this.alertPack(c, attacker);
    } else if (c.mode === Mode.Return) {
      // Going home heals it, so being shot from past its leash doesn't bring it back out.
      const dx = attacker.state.x - c.camp.x;
      const dz = attacker.state.z - c.camp.z;
      if (dx * dx + dz * dz <= c.kind.leash * c.kind.leash) this.startAlert(c, attacker);
    }
  }

  onDeath(c: Creature): void {
    if (c.boss) {
      c.boss.move = -1;
      c.boss.ringActive = false;
      c.boss.engaged = false;
      c.boss.clearStance();
    }
    this.setTarget(c, null);
    c.mode = Mode.Dead;
    c.visual = CreatureState.Dead;
    c.timer = CORPSE_SECONDS;
    c.health = 0;
  }

  /*
   * The boss runs its own loop: notice someone, pick a move that fits the distance, wind it up where everyone
   * can see, strike, then stand still for a moment. That last pause is what makes it an easy first boss.
   */

  private homeDistanceSquaredOf(c: Creature, x: number, z: number): number {
    const dx = x - c.camp.x;
    const dz = z - c.camp.z;
    return dx * dx + dz * dz;
  }

  /** The nearest living player inside its leash. Measured from home, so it can't be pulled out of its arena. */
  private bossTarget(c: Creature): CreatureTarget | null {
    const leash = c.kind.leash * c.kind.leash;
    let best: CreatureTarget | null = null;
    let bestSquared = Infinity;
    for (const player of this.host.players) {
      if (!isValidTarget(player)) continue;
      if (this.homeDistanceSquaredOf(c, player.state.x, player.state.z) > leash) continue;
      if (this.isWarded(player.state)) continue;
      const dx = player.state.x - c.x;
      const dz = player.state.z - c.z;
      const squared = dx * dx + dz * dz;
      if (squared >= bestSquared) continue;
      best = player;
      bestSquared = squared;
    }
    return best;
  }

  private runBoss(c: Creature, b: BossState): void {
    if (b.stunned) {
      this.bossStunned(c, b);
      return;
    }
    if (b.immuneLeft > 0) b.immuneLeft = Math.max(0, b.immuneLeft - TICK_DT);
    if (b.stance > 0 && this.time - b.stanceHitAt > BOSS_STANCE.decayDelaySeconds) {
      b.stance = Math.max(0, b.stance - BOSS_STANCE.decayPerSecond * TICK_DT);
    }
    if (b.ringActive) this.stepRing(c, b);
    if (b.engaged) {
      b.lonely = this.bossTarget(c) ? 0 : b.lonely + TICK_DT;
      if (b.lonely >= BOSS_GIVE_UP_SECONDS) this.bossGiveUp(c, b);
    }
    switch (c.mode) {
      case Mode.Idle:
        this.bossIdle(c, b);
        break;
      case Mode.Alert:
        c.visual = CreatureState.Idle;
        this.faceTarget(c);
        c.timer -= TICK_DT;
        if (c.timer <= TIMER_EPSILON) this.bossResume(c);
        break;
      case Mode.Chase:
        this.bossChase(c, b);
        break;
      case Mode.Windup:
        this.bossWindup(c, b);
        break;
      case Mode.Strike:
        this.bossCharge(c, b);
        break;
      case Mode.Recover:
      case Mode.Stagger:
        // No turning here: this is the window for hitting it.
        c.timer -= TICK_DT;
        if (c.timer <= TIMER_EPSILON) this.bossResume(c);
        break;
      case Mode.Return:
        this.bossReturn(c);
        break;
      default:
        break;
    }
  }

  private bossIdle(c: Creature, b: BossState): void {
    c.visual = CreatureState.Idle;
    const target = this.bossTarget(c);
    if (target) {
      const dx = target.state.x - c.x;
      const dz = target.state.z - c.z;
      if (dx * dx + dz * dz <= c.kind.aggro * c.kind.aggro && !segmentBlocked(c.x, c.z, target.state.x, target.state.z)) {
        this.bossEngage(c, b, target);
        return;
      }
    }
    if (!this.anyPlayerWithin(c, STAY_AWAKE_RADIUS)) c.mode = Mode.Sleep;
  }

  private bossEngage(c: Creature, b: BossState, target: CreatureTarget): void {
    this.setTarget(c, target);
    c.mode = Mode.Alert;
    c.timer = BOSS_ALERT_SECONDS;
    c.visual = CreatureState.Idle;
    b.engaged = true;
    b.lonely = 0;
    this.resetProgress(c);
  }

  /** After each move it picks the nearest player again, so a group shares its attention. */
  private bossResume(c: Creature): void {
    this.setTarget(c, this.bossTarget(c));
    c.mode = Mode.Chase;
    this.resetProgress(c);
  }

  private bossChase(c: Creature, b: BossState): void {
    const leash = c.kind.leash * c.kind.leash;
    if (!isValidTarget(c.target) || this.homeDistanceSquaredOf(c, c.target.state.x, c.target.state.z) > leash) {
      this.setTarget(c, this.bossTarget(c));
    }
    const target = c.target;
    if (!target) {
      c.visual = CreatureState.Idle;
      return;
    }
    const dx = target.state.x - c.x;
    const dz = target.state.z - c.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const move = this.chooseMove(c, b, distance);
    if (move >= 0) {
      this.startBossMove(c, b, move as BossMoveId, target);
      return;
    }
    if (distance <= BOSS_MOVES.swipe.reach * BOSS_CLOSE_SHARE) {
      this.faceTarget(c);
      c.visual = CreatureState.Idle;
      return;
    }
    const oldX = c.x;
    const oldZ = c.z;
    const fast = distance > BOSS_RUN_DISTANCE;
    this.steer(c, dx, dz, fast ? c.kind.runSpeed : c.kind.walkSpeed);
    // It holds its arena: a player can't drag it out past its leash.
    if (this.homeDistanceSquared(c) > leash) {
      c.x = oldX;
      c.z = oldZ;
      c.visual = CreatureState.Idle;
      return;
    }
    c.visual = fast ? CreatureState.Run : CreatureState.Walk;
  }

  /** A move that fits the distance and is off cooldown, never a third time running. -1 if none. */
  private chooseMove(c: Creature, b: BossState, distance: number): number {
    const healthShare = c.health / c.kind.health;
    let count = 0;
    for (let id = 0; id < BOSS_MOVE_COUNT; id += 1) {
      const move = BOSS_MOVE_LIST[id];
      if (this.time < b.readyAt[id]) continue;
      if (distance < move.minRange || distance > move.maxRange) continue;
      if (id === b.lastMove && b.repeats >= 2) continue;
      if (id === BossMove.Stomp && healthShare > BOSS_MOVES.stomp.belowHealthShare) continue;
      this.moveChoices[count] = id;
      count += 1;
    }
    if (count === 0) return -1;
    return this.moveChoices[Math.min(count - 1, Math.floor(this.random() * count))];
  }

  private startBossMove(c: Creature, b: BossState, id: BossMoveId, target: CreatureTarget): void {
    const move = BOSS_MOVE_LIST[id];
    b.move = id;
    b.repeats = id === b.lastMove ? b.repeats + 1 : 1;
    b.lastMove = id;
    b.readyAt[id] = this.time + move.cooldownSeconds;
    b.fromX = c.x;
    b.fromZ = c.z;
    let aimX = target.state.x;
    let aimZ = target.state.z;
    if (id === BossMove.Leap) {
      // Picked now, so moving away during the crouch is how to dodge it.
      const { maxDistance } = BOSS_MOVES.leap;
      const dx = aimX - c.x;
      const dz = aimZ - c.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > maxDistance) {
        aimX = c.x + (dx / distance) * maxDistance;
        aimZ = c.z + (dz / distance) * maxDistance;
      }
      // It never lands outside its arena, or inside a wall.
      const hx = aimX - c.camp.x;
      const hz = aimZ - c.camp.z;
      const fromHome = Math.sqrt(hx * hx + hz * hz);
      if (fromHome > c.kind.leash) {
        aimX = c.camp.x + (hx / fromHome) * c.kind.leash;
        aimZ = c.camp.z + (hz / fromHome) * c.kind.leash;
      }
      this.spot.x = aimX;
      this.spot.z = aimZ;
      collide(this.spot, LARGEST_COLLISION_RADIUS);
      aimX = this.spot.x;
      aimZ = this.spot.z;
      if (aimX !== c.x || aimZ !== c.z) c.yaw = Math.atan2(aimX - c.x, aimZ - c.z);
    } else if (aimX !== c.x || aimZ !== c.z) {
      // It squares up to the target at once, then keeps tracking it through the windup (bossWindup) until it
      // commits. Browsers turn the warning with it, so the warning stays where the hit will land.
      c.yaw = Math.atan2(aimX - c.x, aimZ - c.z);
    }
    b.aimX = aimX;
    b.aimZ = aimZ;
    c.mode = Mode.Windup;
    c.timer = move.windupSeconds;
    c.visual = CreatureState.Windup;
    this.host.emit(
      {
        k: 'bossTell',
        c: c.id,
        m: id,
        x: round2(c.x),
        z: round2(c.z),
        yaw: round2(c.yaw),
        tx: round2(aimX),
        tz: round2(aimZ),
        t: move.windupSeconds,
      },
      c.x,
      c.z,
      0,
    );
  }

  private bossWindup(c: Creature, b: BossState): void {
    c.visual = CreatureState.Windup;
    c.timer -= TICK_DT;
    if (b.move === BossMove.Leap) {
      const { airSeconds } = BOSS_MOVES.leap;
      if (c.timer < airSeconds) {
        // In the air, straight from where it crouched to where it lands. It sails over anything between.
        const through = 1 - Math.max(0, c.timer) / airSeconds;
        c.x = b.fromX + (b.aimX - b.fromX) * through;
        c.z = b.fromZ + (b.aimZ - b.fromZ) * through;
      }
    } else if (b.move !== BossMove.Stomp && c.timer > BOSS_COMMIT_SECONDS && c.target && isValidTarget(c.target)) {
      // Tracks the target like a real fighter, but only so fast, and not at all in the last moment: a late
      // sidestep or a roll is how to beat it. The warning on the ground follows this yaw.
      const wanted = Math.atan2(c.target.state.x - c.x, c.target.state.z - c.z);
      const diff = angleBetween(c.yaw, wanted);
      const maxTurn = ((BOSS_TRACK_DEGREES_PER_SECOND * Math.PI) / 180) * TICK_DT;
      c.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }
    if (c.timer <= TIMER_EPSILON) this.bossStrike(c, b);
  }

  /** The hit moment. The event goes first, so the effect is already on screen when the damage shows. */
  private bossStrike(c: Creature, b: BossState): void {
    const id = b.move;
    if (id === BossMove.Leap) {
      c.x = b.aimX;
      c.z = b.aimZ;
      this.settle(c);
    }
    this.host.emit({ k: 'bossHit', c: c.id, m: id, x: round2(c.x), z: round2(c.z), yaw: round2(c.yaw) }, c.x, c.z, 0);
    switch (id) {
      case BossMove.Swipe:
        this.bossSwipe(c);
        break;
      case BossMove.Charge:
        c.mode = Mode.Strike;
        c.visual = CreatureState.Run;
        b.chargeLeft = BOSS_MOVES.charge.length;
        b.chargeLanded = false;
        b.charged.clear();
        return;
      case BossMove.Leap:
        this.bossLand(c);
        break;
      case BossMove.Fireballs:
        this.bossFireballs(c);
        break;
      case BossMove.Stomp:
        b.ringActive = true;
        b.ringX = c.x;
        b.ringZ = c.z;
        b.ringRadius = 0;
        b.ringed.clear();
        break;
      default:
        break;
    }
    this.bossRecover(c, b, BOSS_MOVE_LIST[id].recoverSeconds, false);
  }

  private bossRecover(c: Creature, b: BossState, seconds: number, dazed: boolean): void {
    b.move = -1;
    c.mode = Mode.Recover;
    c.timer = seconds;
    c.visual = dazed ? CreatureState.Stagger : CreatureState.Recover;
  }

  private bossSwipe(c: Creature): void {
    const { reach, arcDegrees, damage } = BOSS_MOVES.swipe;
    const limit = reach + PLAYER_RADIUS;
    const edge = Math.cos((arcDegrees * Math.PI) / 360);
    const sin = Math.sin(c.yaw);
    const cos = Math.cos(c.yaw);
    for (const player of this.host.players) {
      if (!isValidTarget(player)) continue;
      const dx = player.state.x - c.x;
      const dz = player.state.z - c.z;
      const squared = dx * dx + dz * dz;
      if (squared > limit * limit) continue;
      // Right up against its chest counts as in front.
      if (squared > 1 && (dx * sin + dz * cos) / Math.sqrt(squared) < edge) continue;
      if (segmentBlocked(c.x, c.z, player.state.x, player.state.z)) continue;
      this.host.bossHurt(c, player, BossMove.Swipe, damage, c.x, c.z);
    }
  }

  private bossLand(c: Creature): void {
    const { landingRadius, damage } = BOSS_MOVES.leap;
    const limit = landingRadius + PLAYER_RADIUS;
    for (const player of this.host.players) {
      if (!isValidTarget(player)) continue;
      const dx = player.state.x - c.x;
      const dz = player.state.z - c.z;
      if (dx * dx + dz * dz > limit * limit) continue;
      if (isAirborne(player.state)) continue;
      if (segmentBlocked(c.x, c.z, player.state.x, player.state.z)) continue;
      this.host.bossHurt(c, player, BossMove.Leap, damage, c.x, c.z);
    }
  }

  private bossFireballs(c: Creature): void {
    const { count, spreadDegrees } = BOSS_MOVES.fireballs;
    const spread = (spreadDegrees * Math.PI) / 180;
    // From its mouth rather than its middle, where they'd seem to come out of its back.
    const x = c.x + Math.sin(c.yaw) * c.kind.radius * 0.8;
    const z = c.z + Math.cos(c.yaw) * c.kind.radius * 0.8;
    for (let index = 0; index < count; index += 1) {
      this.host.bossFireball(c, x, z, c.yaw + (index - (count - 1) / 2) * spread);
    }
  }

  /** One tick of running down the locked line. Stops at a wall or its leash. */
  private bossCharge(c: Creature, b: BossState): void {
    const { speed, width, damage, recoverSeconds, missStunSeconds } = BOSS_MOVES.charge;
    c.visual = CreatureState.Run;
    const step = Math.min(speed * TICK_DT, b.chargeLeft);
    const nextX = c.x + Math.sin(c.yaw) * step;
    const nextZ = c.z + Math.cos(c.yaw) * step;
    const leash = c.kind.leash * c.kind.leash;
    const stopped = segmentBlocked(c.x, c.z, nextX, nextZ) || this.homeDistanceSquaredOf(c, nextX, nextZ) > leash;
    if (!stopped) {
      const limit = width / 2 + PLAYER_RADIUS;
      for (const player of this.host.players) {
        if (!isValidTarget(player) || b.charged.has(player)) continue;
        if (segmentDistanceSquared(player.state.x, player.state.z, c.x, c.z, nextX, nextZ) > limit * limit) continue;
        // Reached once whether or not it lands: rolling through the bull is a dodge, not a delay.
        b.charged.add(player);
        if (this.host.bossHurt(c, player, BossMove.Charge, damage, c.x, c.z)) b.chargeLanded = true;
      }
      c.x = nextX;
      c.z = nextZ;
      b.chargeLeft -= step;
    }
    if (stopped || b.chargeLeft <= TIMER_EPSILON) {
      this.settle(c);
      b.charged.clear();
      // A miss leaves it dazed, the easiest opening of the fight.
      this.bossRecover(c, b, b.chargeLanded ? recoverSeconds : missStunSeconds, !b.chargeLanded);
    }
  }

  /** The stomp's ring grows; each player is checked once, as the front of its band reaches them. */
  private stepRing(c: Creature, b: BossState): void {
    const { ringMaxRadius, ringSpeed, ringThickness, damage } = BOSS_MOVES.stomp;
    b.ringRadius = Math.min(ringMaxRadius, b.ringRadius + ringSpeed * TICK_DT);
    for (const player of this.host.players) {
      if (!isValidTarget(player) || b.ringed.has(player)) continue;
      const dx = player.state.x - b.ringX;
      const dz = player.state.z - b.ringZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance - PLAYER_RADIUS > b.ringRadius) continue;
      b.ringed.add(player);
      // Someone who got inside behind the band is past it.
      if (distance + PLAYER_RADIUS < b.ringRadius - ringThickness) continue;
      // In the air, or in a roll's safe frames (checked with the damage), it passes under them.
      if (isAirborne(player.state)) continue;
      if (segmentBlocked(b.ringX, b.ringZ, player.state.x, player.state.z)) continue;
      this.host.bossHurt(c, player, BossMove.Stomp, damage, b.ringX, b.ringZ);
    }
    if (b.ringRadius >= ringMaxRadius) {
      b.ringActive = false;
      b.ringed.clear();
    }
  }

  /** Nobody left in its arena: it heals at once and walks home, and the fight starts over. */
  private bossGiveUp(c: Creature, b: BossState): void {
    this.setTarget(c, null);
    b.reset();
    c.health = c.kind.health;
    c.poise = 0;
    c.hitters.clear();
    c.mode = Mode.Return;
    c.visual = CreatureState.Walk;
    this.resetProgress(c);
  }

  private bossReturn(c: Creature): void {
    const dx = c.camp.x - c.x;
    const dz = c.camp.z - c.z;
    if (dx * dx + dz * dz <= 1) {
      c.mode = Mode.Idle;
      c.visual = CreatureState.Idle;
      return;
    }
    this.travel(c, dx, dz, Math.max(c.kind.walkSpeed, c.kind.runSpeed * 0.5));
    c.visual = CreatureState.Walk;
    this.watchProgress(c);
  }

  /*
   * Stance and criticals. World calls addStance with each hit's stagger power, then breakStance if it filled.
   * A critical is started and landed by World; the boss only keeps who claimed it and stays down meanwhile.
   */

  /** Adds a hit's stance. True if that filled it, and World should call breakStance after the hit's event. */
  addStance(c: Creature, power: number): boolean {
    const b = c.boss;
    if (!b || !c.alive || b.stunned || b.immuneLeft > 0) return false;
    b.stance = Math.min(BOSS_STANCE.max, b.stance + Math.max(0, power));
    b.stanceHitAt = this.time;
    return b.stance >= BOSS_STANCE.max;
  }

  /** It collapses at once, whatever it was doing: a windup, a charge or a leap in the air all stop here. */
  breakStance(c: Creature): void {
    const b = c.boss;
    if (!b || !c.alive || b.stunned) return;
    b.move = -1;
    b.chargeLeft = 0;
    b.charged.clear();
    b.ringActive = false;
    b.ringed.clear();
    b.stance = 0;
    b.stunned = true;
    b.critBy = null;
    b.critLanded = false;
    b.engaged = true;
    b.lonely = 0;
    // Cut off mid-leap it drops where it is, so it mustn't end up inside a wall.
    this.settle(c);
    c.mode = Mode.Stagger;
    c.timer = BOSS_STANCE.stunSeconds;
    c.visual = CreatureState.Stagger;
    this.host.emit({ k: 'bossBreak', c: c.id, x: round2(c.x), z: round2(c.z) }, c.x, c.z, 0);
  }

  /** True if a critical may start on it now: stunned, alive and nobody else already doing one. */
  canBeCritted(c: Creature): boolean {
    const b = c.boss;
    return b !== null && c.alive && b.stunned && b.critBy === null && !b.critLanded;
  }

  /** The stun lasts at least as long as the critical, so it can't get up halfway through the animation. */
  claimCritical(c: Creature, player: CreatureTarget): void {
    const b = c.boss;
    if (!b || !this.canBeCritted(c)) return;
    b.critBy = player;
    c.timer = Math.max(c.timer, CRITICAL_SECONDS);
  }

  isCritBy(c: Creature, player: CreatureTarget): boolean {
    return c.boss !== null && c.boss.critBy === player;
  }

  /** The critical's blow landed: one per break, so nobody can take a second one if the first player leaves. */
  markCritLanded(c: Creature): void {
    if (c.boss) c.boss.critLanded = true;
  }

  /** Stunned: no moving, turning or attacking. It ends on its timer, or when the critical on it ends. */
  private bossStunned(c: Creature, b: BossState): void {
    c.visual = CreatureState.Stagger;
    c.timer = Math.max(0, c.timer - TICK_DT);
    const by = b.critBy;
    if (by) {
      // Gone mid-critical: before the blow the claim is freed so someone else can take it; after it the
      // boss gets up as if the critical had ended, since one break gives one critical.
      if (by.gone || by.state.deadTime > 0) {
        if (b.critLanded) {
          this.bossRise(c, b, BOSS_STANCE.afterCritRecoverSeconds);
          return;
        }
        b.critBy = null;
      } else if (by.state.criticalTime <= 0) {
        this.bossRise(c, b, BOSS_STANCE.afterCritRecoverSeconds);
        return;
      } else {
        return;
      }
    }
    if (c.timer <= TIMER_EPSILON) this.bossRise(c, b, BOSS_RISE_SECONDS);
  }

  private bossRise(c: Creature, b: BossState, recoverSeconds: number): void {
    b.stunned = false;
    b.critBy = null;
    b.stance = 0;
    b.immuneLeft = BOSS_STANCE.immuneSeconds;
    this.host.emit({ k: 'bossRise', c: c.id }, c.x, c.z, 0);
    this.bossRecover(c, b, recoverSeconds, false);
  }

  private bossOnHit(c: Creature, b: BossState, attacker: CreatureTarget, poiseBroke: boolean): void {
    // Already down: hits do normal damage and nothing else.
    if (b.stunned) return;
    if (c.mode === Mode.Idle || c.mode === Mode.Sleep || c.mode === Mode.Return) {
      // Shot from past its leash it stays put, since it would only have to give up again.
      if (this.homeDistanceSquaredOf(c, attacker.state.x, attacker.state.z) <= c.kind.leash * c.kind.leash) {
        this.bossEngage(c, b, attacker);
      }
      return;
    }
    // Only between moves: a move already shown to players always finishes.
    if (poiseBroke && (c.mode === Mode.Chase || c.mode === Mode.Alert || c.mode === Mode.Recover)) {
      c.mode = Mode.Stagger;
      c.timer = BOSS_STAGGER_SECONDS;
      c.visual = CreatureState.Stagger;
    }
  }
}
