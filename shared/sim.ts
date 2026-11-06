/**
 * Player movement rules. The server runs this to decide what really happens, and the browser
 * runs the same code to predict the result right away, so movement feels instant while the
 * server stays in charge. It must stay deterministic: same state and input, same result.
 */
import type { Stats } from './classes.js';
import { collide } from './collision.js';
import type { WeaponStats } from './combat.js';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 2;
/** Players are circles this wide for collision with the world. */
export const PLAYER_RADIUS = 0.45;

const RUN_MULTIPLIER = 1.75;
const DODGE_SPEED = 9;
export const DODGE_SECONDS = 0.5;
const DODGE_COST = 20;
const POTION_SECONDS = 0.9;
const POTION_HEAL_SHARE = 0.45;
export const STAGGER_SECONDS = 0.35;
const KNOCKBACK_SPEED = 5;
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
    dodgeInvulnerable: 0.22 + 0.004 * stats.dexterity,
    attackSeconds: (weapon?.attackSeconds ?? DEFAULT_ATTACK.attackSeconds) / (1 + 0.01 * (stats.speed - 10)),
    hitAt: weapon?.hitAt ?? DEFAULT_ATTACK.hitAt,
    attackCost: weapon?.cost ?? DEFAULT_ATTACK.attackCost,
    usesMagic: weapon?.usesMagic ?? DEFAULT_ATTACK.usesMagic,
    attackMoveMultiplier: weapon?.attackMoveMultiplier ?? DEFAULT_ATTACK.attackMoveMultiplier,
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
  };
}

export function stepPlayer(state: SimState, input: SimInput, derived: Derived, dt: number = TICK_DT): void {
  state.dodgeTime = Math.max(0, state.dodgeTime - dt);
  state.attackTime = Math.max(0, state.attackTime - dt);
  state.regenDelay = Math.max(0, state.regenDelay - dt);
  state.drinkTime = Math.max(0, state.drinkTime - dt);
  state.magic = Math.min(derived.maxMagic, state.magic + derived.magicRegen * dt);

  // Dead players stay put, and the server decides when they come back.
  if (state.deadTime > 0) {
    state.moving = 0;
    return;
  }

  // Knocked off balance: no control until it passes.
  if (state.staggerTime > 0) {
    state.staggerTime = Math.max(0, state.staggerTime - dt);
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

  const isBusy = state.dodgeTime > 0 || state.attackTime > 0 || state.drinkTime > 0;
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
    state.drinkTime = POTION_SECONDS;
    state.health = Math.min(derived.maxHealth, state.health + derived.maxHealth * POTION_HEAL_SHARE);
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

/** True for the step in which an attack reaches its hit moment. before is attackTime before the step. */
export function attackHitThisStep(before: number, after: number, derived: Derived): boolean {
  const moment = derived.attackSeconds * (1 - derived.hitAt);
  return before > moment && after <= moment;
}

/** True during the part of a dodge that can't be hit. */
export function isInvulnerable(state: SimState, derived: Derived): boolean {
  return state.deadTime > 0 || (state.dodgeTime > 0 && state.dodgeTime > DODGE_SECONDS - derived.dodgeInvulnerable);
}

export type AnimationId = 'idle' | 'walk' | 'run' | 'dodge' | 'attack' | 'hit' | 'death' | 'drink';

export function animationFor(
  state: Pick<SimState, 'dodgeTime' | 'attackTime' | 'moving' | 'deadTime' | 'staggerTime' | 'drinkTime'>,
): AnimationId {
  if (state.deadTime > 0) return 'death';
  if (state.staggerTime > 0) return 'hit';
  if (state.dodgeTime > 0) return 'dodge';
  if (state.attackTime > 0) return 'attack';
  if (state.drinkTime > 0) return 'drink';
  if (state.moving === 2) return 'run';
  if (state.moving === 1) return 'walk';
  return 'idle';
}
