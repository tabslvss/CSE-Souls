/**
 * The Great Bull boss: where it lives and what each of its moves does. The server runs these numbers and the
 * browser reads the same ones to size its warnings, so a telegraph always matches the hit it warns about.
 */
import type { Stats } from './classes.js';
import { attackDamage, type WeaponStats } from './combat.js';

export const BOSS_KIND_ID = 'bull_boss';

/** The arena circle. Leash and "near the boss" checks measure from this centre, not from where it stands. */
export const BOSS_ARENA = { x: -150, z: 160, radius: 24 } as const;

/** Players this far from the arena centre get the boss health bar ('b' in the snapshot). */
export const BOSS_BAR_RANGE = 40;

/** Stable ids for the wire. Only ever add to the end. */
export const BossMove = {
  Swipe: 0,
  Charge: 1,
  Leap: 2,
  Fireballs: 3,
  Stomp: 4,
} as const;
export type BossMoveId = (typeof BossMove)[keyof typeof BossMove];
export type BossMoveName = 'swipe' | 'charge' | 'leap' | 'fireballs' | 'stomp';

interface MoveTiming {
  /** Seconds from 'bossTell' to the hit. Long on purpose: this is an easy first boss. */
  windupSeconds: number;
  /** Seconds it stands still after the move, open to hits. */
  recoverSeconds: number;
  /** Seconds before this move can be picked again. */
  cooldownSeconds: number;
  /** The move is only picked while the target is this far away, in meters, from the boss's centre. */
  minRange: number;
  maxRange: number;
  /** Damage to each player it hits (per fireball for fireballs). */
  damage: number;
}

/** A horn sweep in front of it. */
export interface SwipeMove extends MoveTiming {
  /** Meters from the boss's centre, and the full width of the arc in degrees. */
  reach: number;
  arcDegrees: number;
}

/** Lowers its head and runs in a straight line along its yaw at windup end. */
export interface ChargeMove extends MoveTiming {
  /** The lane it runs down: length from its start point, and full width. */
  length: number;
  width: number;
  /** Meters per second while charging. Hits each player at most once per charge. */
  speed: number;
  /** If the charge hit no one it stands dazed this long, in place of recoverSeconds. */
  missStunSeconds: number;
}

/** Jumps and lands on the target point picked when the tell starts (tx, tz). */
export interface LeapMove extends MoveTiming {
  /** Players within this distance of the landing point are hit. */
  landingRadius: number;
  /** Seconds in the air. The windup includes this: it crouches for windupSeconds - airSeconds, then flies. */
  airSeconds: number;
  /** Furthest it will leap; a farther target point is pulled in to this distance. */
  maxDistance: number;
}

/** Spits a fan of fireballs along its yaw. */
export interface FireballsMove extends MoveTiming {
  count: number;
  speed: number;
  range: number;
  /** Degrees between neighbouring fireballs, fanned evenly around its yaw. */
  spreadDegrees: number;
  /** Hit radius of each fireball, in meters. */
  radius: number;
}

/**
 * Slams the ground and sends out a ring that grows from its centre. A player is hit once when the ring's band
 * passes over them, unless they are mid-jump or mid-roll at that moment.
 */
export interface StompMove extends MoveTiming {
  ringMaxRadius: number;
  /** Meters per second the ring grows. */
  ringSpeed: number;
  /** Width of the dangerous band. */
  ringThickness: number;
  /** Only picked at or below this share of its health. */
  belowHealthShare: number;
}

export interface BossMoves {
  swipe: SwipeMove;
  charge: ChargeMove;
  leap: LeapMove;
  fireballs: FireballsMove;
  stomp: StompMove;
}

export const BOSS_MOVES: BossMoves = {
  swipe: { windupSeconds: 0.9, recoverSeconds: 1.2, cooldownSeconds: 2, minRange: 0, maxRange: 6.5, damage: 22, reach: 6.5, arcDegrees: 120 },
  charge: { windupSeconds: 1.3, recoverSeconds: 1.6, cooldownSeconds: 7, minRange: 8, maxRange: 22, damage: 30, length: 22, width: 4.5, speed: 16, missStunSeconds: 2.5 },
  leap: { windupSeconds: 1.4, recoverSeconds: 2, cooldownSeconds: 9, minRange: 7, maxRange: 20, damage: 34, landingRadius: 6, airSeconds: 0.8, maxDistance: 20 },
  fireballs: { windupSeconds: 1.2, recoverSeconds: 1.5, cooldownSeconds: 6, minRange: 9, maxRange: 30, damage: 16, count: 3, speed: 9, range: 30, spreadDegrees: 18, radius: 1.2 },
  stomp: { windupSeconds: 1.5, recoverSeconds: 2.2, cooldownSeconds: 10, minRange: 0, maxRange: 12, damage: 26, ringMaxRadius: 16, ringSpeed: 9, ringThickness: 1.6, belowHealthShare: 0.5 },
};

/** Move names in wire-id order, so BOSS_MOVES[BOSS_MOVE_NAMES[id]] finds a move from an event's m. */
export const BOSS_MOVE_NAMES: readonly BossMoveName[] = ['swipe', 'charge', 'leap', 'fireballs', 'stomp'];

/** The move for a wire id, or undefined for an id the browser doesn't know. */
export function bossMoveName(id: number): BossMoveName | undefined {
  return BOSS_MOVE_NAMES[id];
}

/* Stance break and critical hits. */

/**
 * The boss's stance. Each player hit on it adds that hit's staggerPower() (shared/combat.ts), so heavy weapons
 * break it in fewer hits. At max it collapses stunned with a glowing weak point; a player in the window who
 * attacks then does a critical instead of a normal swing. The server keeps all of this; browsers only see 'b'.
 */
export const BOSS_STANCE = {
  max: 200,
  /** Stance lost per second once decayDelaySeconds have passed without a hit. */
  decayPerSecond: 8,
  decayDelaySeconds: 4,
  /** How long it stays down. */
  stunSeconds: 8,
  /** Meters from the boss's centre (its radius is BOSS_RADIUS) a player can be to start a critical. */
  critWindowRange: 7.5,
  /** Full width of the arc, centred on the boss's yaw (its head), a player must be in. */
  critArcDegrees: 260,
  /** After a critical ends the stun, it gets up and stands still this long before acting. */
  afterCritRecoverSeconds: 2.5,
  /** After a stun ends, hits add no stance for this long, so it can't be kept down. */
  immuneSeconds: 12,
} as const;

/** The boss's body radius in meters, the same as its entry in shared/creatures.ts. */
export const BOSS_RADIUS = 3.2;

/** A critical deals this many times the weapon's attackDamage(), and ends the stun. */
export const CRITICAL_DAMAGE_MULTIPLIER = 6;

export function criticalDamage(weapon: WeaponStats, stats: Stats): number {
  return attackDamage(weapon, stats) * CRITICAL_DAMAGE_MULTIPLIER;
}

/**
 * True when a player at px, pz may start a critical on a boss at bx, bz facing bossYaw (forward is
 * sin(yaw), cos(yaw)). Only the distance and side are checked here; the server also checks the boss is stunned.
 */
export function inCritWindow(bx: number, bz: number, bossYaw: number, px: number, pz: number): boolean {
  const dx = px - bx;
  const dz = pz - bz;
  const squared = dx * dx + dz * dz;
  const range = BOSS_STANCE.critWindowRange;
  if (squared > range * range) return false;
  if (squared < 1e-6) return true;
  const facing = (dx * Math.sin(bossYaw) + dz * Math.cos(bossYaw)) / Math.sqrt(squared);
  return facing >= Math.cos((BOSS_STANCE.critArcDegrees * Math.PI) / 360);
}

/** Stance as sent in 'b': 0..255 of BOSS_STANCE.max. */
export function packStance(stance: number): number {
  return Math.max(0, Math.min(255, Math.round((stance / BOSS_STANCE.max) * 255)));
}

/** Stun seconds left as sent in 'b': tenths of a second, 0 when standing. */
export function packStunLeft(seconds: number): number {
  return Math.max(0, Math.ceil(seconds * 10));
}
