/**
 * Player movement rules. The server runs this to decide what really happens, and the browser
 * runs the same code to predict the result right away, so movement feels instant while the
 * server stays in charge. It must stay deterministic: same state and input, same result.
 */
import type { Stats } from './classes.js';
import { collide } from './collision.js';
import { CRITICAL_IMPACT_TIME, type WeaponStats } from './combat.js';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 2;
/** Players are circles this wide for collision with the world. */
export const PLAYER_RADIUS = 0.45;

const RUN_MULTIPLIER = 1.75;
const DODGE_SPEED = 9;
export const DODGE_SECONDS = 0.5;
/** Seconds of a roll, from its start, in which nothing hurts. The last 0.1 s of the roll is open. */
export const DODGE_INVULNERABLE_SECONDS = 0.4;
const DODGE_COST = 20;
/** How long a drink lasts. The health arrives part way through, so a hit before then loses it. */
export const DRINK_SECONDS = 1.4;
const DRINK_HEAL_AT = 0.55;
/** The value of drinkTime at the moment the health arrives. */
export const DRINK_HEAL_TIME = DRINK_SECONDS * (1 - DRINK_HEAL_AT);
const POTION_HEAL_SHARE = 0.45;
/** A jump is only a timer and a picture: nothing in the rules knows about height. */
export const JUMP_SECONDS = 0.7;
const JUMP_COST = 15;
const JUMP_HEIGHT = 0.85;
export const STAGGER_SECONDS = 0.35;
const KNOCKBACK_SPEED = 5;
/** A critical's forward travel is applied in steps this long, each one pushed out of whatever it hits. */
const CRITICAL_TRAVEL_STEP = 0.4;
export const STARTING_POTIONS = 3;
export const MAX_POTIONS = 5;
const DEFAULT_ATTACK = { attackSeconds: 0.75, hitAt: 0.5, attackCost: 14, usesMagic: false, attackMoveMultiplier: 0.2 };
const RUN_COST_PER_SECOND = 12;
const REGEN_PER_SECOND = 22;
const REGEN_DELAY_SECONDS = 0.7;
const DRINK_MOVE_MULTIPLIER = 0.4;

export interface SimInput {
  seq: number;
  /** Desired movement in world space. Length is capped at 1. */
  mx: number;
  mz: number;
  /** Where the character faces. */
  yaw: number;
  run: boolean;
  dodge: boolean;
  attack: boolean;
  /** Drink a healing potion. */
  potion: boolean;
  jump: boolean;
}

export interface SimState {
  x: number;
  z: number;
  yaw: number;
  stamina: number;
  regenDelay: number;
  dodgeTime: number;
  dodgeX: number;
  dodgeZ: number;
  attackTime: number;
  /** Counts attacks, so other players can tell two swings in a row apart. */
  attackCount: number;
  moving: number;
  health: number;
  magic: number;
  /** Knocked off balance: can't act, and slides along the knock direction. Set by the server. */
  staggerTime: number;
  knockX: number;
  knockZ: number;
  /** Above 0 while dead. Set and counted down by the server. */
  deadTime: number;
  potions: number;
  drinkTime: number;
  /** Above 0 while in the air. Keeps counting through a stagger or a death, so the body still comes down. */
  jumpTime: number;
  /** The id of the Binary Grace this player is sitting at, or 0. Only the server sits a player down. */
  resting: number;
  /**
   * Above 0 during a critical hit, counting down from CRITICAL_SECONDS. Only the server starts one (it sets this,
   * yaw toward the boss, and clears attackTime, dodgeTime, drinkTime and staggerTime); the browser just receives it.
   * While above 0 the player ignores input, can't be hit, and keeps its yaw. criticalTravel is applied at 0.
   */
  criticalTime: number;
}

export interface Derived {
  moveSpeed: number;
  maxStamina: number;
  maxHealth: number;
  maxMagic: number;
  staminaRegen: number;
  magicRegen: number;
  /** Seconds of a dodge, counted from its start, that can't be hit. */
  dodgeInvulnerable: number;
  attackSeconds: number;
  /** Share of the attack when the hit lands. */
  hitAt: number;
  attackCost: number;
  usesMagic: boolean;
  attackMoveMultiplier: number;
  /** Meters moved forward when a critical ends (WeaponStats.criticalTravel). */
  criticalTravel: number;
}

/** weapon is left out only where attacks don't matter, like tests of plain movement. */
export function deriveStats(stats: Stats, weapon?: WeaponStats): Derived {
  return {
    moveSpeed: 3 + (stats.speed - 10) * 0.07,
    maxStamina: 70 + stats.stamina * 3,
    maxHealth: 60 + stats.health * 6,
    maxMagic: 40 + stats.arcane * 4,
    staminaRegen: REGEN_PER_SECOND + 0.3 * (stats.stamina - 10),
    magicRegen: 3 + 0.2 * stats.arcane,
    // Like an Elden Ring roll: safe from the first frame for about 13 animation frames at 30 fps, the same for
    // every build, then a short open tail as the roll ends. Stats change nothing here.
    dodgeInvulnerable: DODGE_INVULNERABLE_SECONDS,
    attackSeconds: (weapon?.attackSeconds ?? DEFAULT_ATTACK.attackSeconds) / (1 + 0.01 * (stats.speed - 10)),
    hitAt: weapon?.hitAt ?? DEFAULT_ATTACK.hitAt,
    attackCost: weapon?.cost ?? DEFAULT_ATTACK.attackCost,
    usesMagic: weapon?.usesMagic ?? DEFAULT_ATTACK.usesMagic,
    attackMoveMultiplier: weapon?.attackMoveMultiplier ?? DEFAULT_ATTACK.attackMoveMultiplier,
    criticalTravel: weapon?.criticalTravel ?? 0,
  };
}

export function createState(x: number, z: number, derived: Derived): SimState {
  return {
    x,
    z,
    yaw: 0,
    stamina: derived.maxStamina,
    regenDelay: 0,
    dodgeTime: 0,
    dodgeX: 0,
    dodgeZ: 1,
    attackTime: 0,
    attackCount: 0,
    moving: 0,
    health: derived.maxHealth,
    magic: derived.maxMagic,
    staggerTime: 0,
    knockX: 0,
    knockZ: 0,
    deadTime: 0,
    potions: STARTING_POTIONS,
    drinkTime: 0,
    jumpTime: 0,
    resting: 0,
    criticalTime: 0,
  };
}

export function stepPlayer(state: SimState, input: SimInput, derived: Derived, dt: number = TICK_DT): void {
  state.dodgeTime = Math.max(0, state.dodgeTime - dt);
  state.attackTime = Math.max(0, state.attackTime - dt);
  state.regenDelay = Math.max(0, state.regenDelay - dt);
  const drinkBefore = state.drinkTime;
  state.drinkTime = Math.max(0, state.drinkTime - dt);
  state.jumpTime = Math.max(0, state.jumpTime - dt);
  state.magic = Math.min(derived.maxMagic, state.magic + derived.magicRegen * dt);

  // Dead players stay put, and the server decides when they come back.
  if (state.deadTime > 0) {
    state.moving = 0;
    state.drinkTime = 0;
    return;
  }

  // A critical plays out on its own. Its forward travel lands in one go at the end, where the animation
  // drops its root offset, so prediction and the server move the player on the same step.
  if (state.criticalTime > 0) {
    state.criticalTime = Math.max(0, state.criticalTime - dt);
    state.moving = 0;
    if (state.criticalTime === 0 && derived.criticalTravel > 0) {
      // In short steps, so a long dash stops at a tree or rock instead of jumping through it.
      const steps = Math.ceil(derived.criticalTravel / CRITICAL_TRAVEL_STEP);
      const stepX = (Math.sin(state.yaw) * derived.criticalTravel) / steps;
      const stepZ = (Math.cos(state.yaw) * derived.criticalTravel) / steps;
      for (let i = 0; i < steps; i++) {
        state.x += stepX;
        state.z += stepZ;
        collide(state, PLAYER_RADIUS);
      }
    }
    return;
  }

  // Knocked off balance: no control until it passes.
  if (state.staggerTime > 0) {
    state.staggerTime = Math.max(0, state.staggerTime - dt);
    // The drink is spilled, along with any health that hadn't arrived yet.
    state.drinkTime = 0;
    state.x += state.knockX * KNOCKBACK_SPEED * dt;
    state.z += state.knockZ * KNOCKBACK_SPEED * dt;
    state.moving = 0;
    collide(state, PLAYER_RADIUS);
    return;
  }

  const length = Math.hypot(input.mx, input.mz);
  const scale = length > 1 ? 1 / length : 1;
  const mx = input.mx * scale;
  const mz = input.mz * scale;
  const wantsToMove = length > 0.01;

  // Sitting holds still until the player does anything at all, which stands them up in the same step.
  if (state.resting > 0) {
    if (!wantsToMove && !input.dodge && !input.attack && !input.potion && !input.jump) {
      state.moving = 0;
      return;
    }
    state.resting = 0;
  }

  if (drinkBefore > DRINK_HEAL_TIME && state.drinkTime <= DRINK_HEAL_TIME) {
    state.health = Math.min(derived.maxHealth, state.health + derived.maxHealth * POTION_HEAL_SHARE);
  }

  const isBusy = state.dodgeTime > 0 || state.attackTime > 0 || state.drinkTime > 0 || state.jumpTime > 0;
  const attackPool = derived.usesMagic ? state.magic : state.stamina;
  if (input.dodge && !isBusy && state.stamina >= DODGE_COST) {
    state.stamina -= DODGE_COST;
    state.regenDelay = REGEN_DELAY_SECONDS;
    state.dodgeTime = DODGE_SECONDS;
    if (wantsToMove) {
      const inverse = 1 / (length * scale);
      state.dodgeX = mx * inverse;
      state.dodgeZ = mz * inverse;
    } else {
      // No direction held: roll backward from where the character is facing.
      state.dodgeX = -Math.sin(state.yaw);
      state.dodgeZ = -Math.cos(state.yaw);
    }
  } else if (input.attack && !isBusy && attackPool >= derived.attackCost) {
    if (derived.usesMagic) {
      state.magic -= derived.attackCost;
    } else {
      state.stamina -= derived.attackCost;
      state.regenDelay = REGEN_DELAY_SECONDS;
    }
    state.attackTime = derived.attackSeconds;
    state.attackCount = (state.attackCount + 1) % 1024;
  } else if (input.potion && !isBusy && state.potions > 0 && state.health < derived.maxHealth) {
    state.potions -= 1;
    state.drinkTime = DRINK_SECONDS;
  } else if (input.jump && !isBusy && state.stamina >= JUMP_COST) {
    state.stamina -= JUMP_COST;
    state.regenDelay = REGEN_DELAY_SECONDS;
    state.jumpTime = JUMP_SECONDS;
  }

  let moved = 0;
  if (state.dodgeTime > 0) {
    state.x += state.dodgeX * DODGE_SPEED * dt;
    state.z += state.dodgeZ * DODGE_SPEED * dt;
    state.yaw = Math.atan2(state.dodgeX, state.dodgeZ);
  } else {
    const busy = state.attackTime > 0 || state.drinkTime > 0;
    const running = input.run && wantsToMove && !busy && state.stamina > 0;
    let speed = derived.moveSpeed;
    if (running) speed *= RUN_MULTIPLIER;
    if (state.attackTime > 0) speed *= derived.attackMoveMultiplier;
    else if (state.drinkTime > 0) speed *= DRINK_MOVE_MULTIPLIER;
    state.x += mx * speed * dt;
    state.z += mz * speed * dt;
    moved = wantsToMove ? (running ? 2 : 1) : 0;

    if (running) {
      state.stamina = Math.max(0, state.stamina - RUN_COST_PER_SECOND * dt);
      state.regenDelay = REGEN_DELAY_SECONDS;
    } else if (state.regenDelay <= 0) {
      state.stamina = Math.min(derived.maxStamina, state.stamina + derived.staminaRegen * dt);
    }
    if (Number.isFinite(input.yaw)) state.yaw = input.yaw;
  }
  state.moving = moved;

  collide(state, PLAYER_RADIUS);
}

/** True for the step in which a critical reaches its impact. before is criticalTime before the step. */
export function criticalImpactThisStep(before: number, after: number): boolean {
  return before > CRITICAL_IMPACT_TIME && after <= CRITICAL_IMPACT_TIME;
}

/** True for the step in which an attack reaches its hit moment. before is attackTime before the step. */
export function attackHitThisStep(before: number, after: number, derived: Derived): boolean {
  const moment = derived.attackSeconds * (1 - derived.hitAt);
  return before > moment && after <= moment;
}

/** True during the part of a dodge that can't be hit, and through a whole critical. */
export function isInvulnerable(state: SimState, derived: Derived): boolean {
  return state.deadTime > 0 || state.criticalTime > 0 || (state.dodgeTime > 0 && state.dodgeTime > DODGE_SECONDS - derived.dodgeInvulnerable);
}

/** How high to draw a player, in meters, from jumpTime. Only for the picture. */
export function jumpHeight(jumpTime: number): number {
  if (jumpTime <= 0) return 0;
  const through = Math.min(1, Math.max(0, 1 - jumpTime / JUMP_SECONDS));
  return JUMP_HEIGHT * 4 * through * (1 - through);
}

export type AnimationId = 'idle' | 'walk' | 'run' | 'dodge' | 'attack' | 'hit' | 'death' | 'drink' | 'jump' | 'rest' | 'critical';

export function animationFor(
  // criticalTime is optional so frames that don't carry it yet still type-check; they just never show 'critical'.
  state: Pick<SimState, 'dodgeTime' | 'attackTime' | 'moving' | 'deadTime' | 'staggerTime' | 'drinkTime' | 'jumpTime' | 'resting'> & { criticalTime?: number },
): AnimationId {
  if (state.deadTime > 0) return 'death';
  if ((state.criticalTime ?? 0) > 0) return 'critical';
  if (state.staggerTime > 0) return 'hit';
  if (state.resting > 0) return 'rest';
  if (state.dodgeTime > 0) return 'dodge';
  if (state.attackTime > 0) return 'attack';
  if (state.drinkTime > 0) return 'drink';
  if (state.jumpTime > 0) return 'jump';
  if (state.moving === 2) return 'run';
  if (state.moving === 1) return 'walk';
  return 'idle';
}
