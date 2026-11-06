/**
 * Animals and what they decide to do. Decisions run 10 times a second, in three groups so they
 * spread across ticks, and movement runs every tick. A creature with no player anywhere near is
 * asleep and costs almost nothing. docs/GAME_PLAN.md section 3 has the states this follows.
 */
import { collide, segmentBlocked } from '../../../shared/collision.js';
import type { MapBonfire, MapCamp } from '../../../shared/mapTypes.js';
import {
  CORPSE_SECONDS,
  CREATURE_BY_ID,
  CreatureState,
  MAX_ATTACKERS_PER_PLAYER,
  type CreatureKind,
  type CreatureStateId,
} from '../../../shared/creatures.js';
import { PLAYER_RADIUS, TICK_DT, TICK_RATE, type Derived, type SimState } from '../../../shared/sim.js';

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
/** Enemies keep out of this circle around a bonfire. */
const BONFIRE_WARD = 10;
// shared/collision.ts only promises to find colliders for circles up to this wide.
const LARGEST_COLLISION_RADIUS = 1;

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

  constructor(
    readonly id: number,
    readonly kindIndex: number,
    readonly kind: CreatureKind,
    readonly camp: Camp,
  ) {
    this.health = kind.health;
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

function reachOf(kind: CreatureKind): number {
  return kind.biteRange + PLAYER_RADIUS;
}

/** Bulls commit to a charge and take a while to turn, which is what makes them possible to dodge. */
function turnRate(kind: CreatureKind): number {
  return kind.id === 'bull' ? 2.5 : 9;
}

export class CreatureField {
  readonly creatures: Creature[] = [];
  private time = 0;

  constructor(
    camps: readonly MapCamp[],
    private bonfires: readonly MapBonfire[],
    private host: CreatureHost,
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
        this.placeInCamp(creature);
      }
    }
  }

  private placeInCamp(c: Creature): void {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * c.camp.radius;
    c.x = c.camp.x + Math.cos(angle) * distance;
    c.z = c.camp.z + Math.sin(angle) * distance;
    this.settle(c);
    c.wanderX = c.x;
    c.wanderZ = c.z;
    c.checkX = c.x;
    c.checkZ = c.z;
  }

  /** Slides along whatever it walked into, and out of a bonfire's circle. */
  private settle(c: Creature): void {
    collide(c, Math.min(c.kind.radius, LARGEST_COLLISION_RADIUS));
    if (c.kind.behavior !== 'hunter') return;
    for (const bonfire of this.bonfires) {
      const dx = c.x - bonfire.x;
      const dz = c.z - bonfire.z;
      const squared = dx * dx + dz * dz;
      if (squared >= BONFIRE_WARD * BONFIRE_WARD) continue;
      const distance = Math.sqrt(squared) || 1;
      c.x = bonfire.x + (dx / distance) * BONFIRE_WARD;
      c.z = bonfire.z + (dz / distance) * BONFIRE_WARD;
      collide(c, Math.min(c.kind.radius, LARGEST_COLLISION_RADIUS));
    }
  }

  private isWarded(state: SimState): boolean {
    for (const bonfire of this.bonfires) {
      const dx = state.x - bonfire.x;
      const dz = state.z - bonfire.z;
      if (dx * dx + dz * dz < BONFIRE_WARD * BONFIRE_WARD) return true;
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
      if (c.kind.behavior === 'hunter' && this.isWarded(player.state)) continue;
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
    const wanted = Math.atan2(c.target.state.x - c.x, c.target.state.z - c.z);
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
    this.setTarget(c, null);
    c.mode = Mode.Dead;
    c.visual = CreatureState.Dead;
    c.timer = CORPSE_SECONDS;
    c.health = 0;
  }
}
