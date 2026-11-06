/** Messages sent over the game's WebSocket. */
import type { Appearance, ClassId, Stats } from './classes.js';
import type { SimState } from './sim.js';

export interface PlayerInfo {
  id: number;
  username: string;
  avatarUrl: string | null;
  classId: ClassId;
  appearance: Appearance;
  level: number;
  stats: Stats;
}

/**
 * One player inside a snapshot, as a compact array:
 * id, x, z, yaw, stamina, moving, dodgeTime, attackTime, attackCount, dodgeX, dodgeZ, regenDelay,
 * health, magic, staggerTime, knockX, knockZ, deadTime, potions, drinkTime, jumpTime
 */
export type PlayerSnapshot = [
  id: number,
  x: number,
  z: number,
  yaw: number,
  stamina: number,
  moving: number,
  dodgeTime: number,
  attackTime: number,
  attackCount: number,
  dodgeX: number,
  dodgeZ: number,
  regenDelay: number,
  health: number,
  magic: number,
  staggerTime: number,
  knockX: number,
  knockZ: number,
  deadTime: number,
  potions: number,
  drinkTime: number,
  jumpTime: number,
];

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Packs a player's state for sending. The one place that knows this order, along with applySnapshot. */
export function packSnapshot(id: number, s: SimState): PlayerSnapshot {
  return [
    id,
    round(s.x),
    round(s.z),
    round(s.yaw),
    round(s.stamina),
    s.moving,
    round(s.dodgeTime),
    round(s.attackTime),
    s.attackCount,
    round(s.dodgeX),
    round(s.dodgeZ),
    round(s.regenDelay),
    round(s.health),
    round(s.magic),
    round(s.staggerTime),
    round(s.knockX),
    round(s.knockZ),
    round(s.deadTime),
    s.potions,
    round(s.drinkTime),
    round(s.jumpTime),
  ];
}

export function applySnapshot(entry: PlayerSnapshot, state: SimState): void {
  [, state.x, state.z, state.yaw, state.stamina, state.moving, state.dodgeTime, state.attackTime, state.attackCount,
    state.dodgeX, state.dodgeZ, state.regenDelay, state.health, state.magic, state.staggerTime, state.knockX,
    state.knockZ, state.deadTime, state.potions, state.drinkTime, state.jumpTime] = entry;
}

/** One creature inside a snapshot: id, kind (index into CREATURES), x, z, yaw, state (CreatureState), health percent. */
export type CreatureSnapshot = [number, number, number, number, number, number, number];

/** Index into WEAPON_STYLES. */
export type StyleIndex = number;

/**
 * Things that just happened, for effects and sound. Sent only to players close enough to see them.
 * The server decides all of these, and nothing in them is trusted by the server.
 */
export type GameEvent =
  /** A player's hit landed on a creature. dmg is the damage dealt, and kill is 1 if that killed it. */
  | { k: 'hit'; by: number; c: number; x: number; z: number; dmg: number; style: StyleIndex; kill: 0 | 1; stagger: 0 | 1 }
  /** A player's swing landed on nothing, so effects can still play at its hit moment. */
  | { k: 'swing'; by: number; x: number; z: number; yaw: number; style: StyleIndex }
  /** A creature bit a player. */
  | { k: 'bite'; c: number; v: number; x: number; z: number; dmg: number }
  /** A projectile set off. The browser moves it on its own until the matching 'shotEnd'. */
  | { k: 'shot'; id: number; by: number; x: number; z: number; yaw: number; speed: number; range: number; style: StyleIndex }
  /** A projectile hit something, or fizzled out if hit is 0. splash is its area in meters. */
  | { k: 'shotEnd'; id: number; x: number; z: number; hit: 0 | 1; splash: number; style: StyleIndex }
  /** Red Binary Dust bursts out of a corpse and flies to the player who earned it. */
  | { k: 'dust'; x: number; z: number; n: number; to: number }
  | { k: 'death'; v: number }
  | { k: 'respawn'; v: number }
  | { k: 'drink'; v: number };

export type ServerMessage =
  | {
      t: 'welcome';
      you: number;
      players: PlayerInfo[];
      snapshot: PlayerSnapshot[];
      binaryDust: number;
      /** Chest ids this account has already opened. */
      chests: number[];
      mapVersion: number;
    }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  /** a is the newest input of yours the server has applied. c and e are limited to what's near you. */
  | { t: 's'; a: number; p: PlayerSnapshot[]; c: CreatureSnapshot[]; e?: GameEvent[] }
  /** Your own totals changed. */
  | { t: 'self'; dust: number; kills: number }
  /** You opened a chest. Other players still see it closed. */
  | { t: 'chest'; id: number; dust: number; potion: 0 | 1 }
  /** An achievement was earned. */
  | { t: 'unlock'; achievement: string }
  /** The account has no character yet. */
  | { t: 'no_character' };

export type ClientMessage = {
  t: 'i';
  /** seq, mx, mz, yaw, flags */
  d: [number, number, number, number, number];
};

export const FLAG_RUN = 1;
export const FLAG_DODGE = 2;
export const FLAG_ATTACK = 4;
export const FLAG_POTION = 8;
export const FLAG_INTERACT = 16;
export const FLAG_JUMP = 32;
export const MAX_FLAGS = FLAG_RUN | FLAG_DODGE | FLAG_ATTACK | FLAG_POTION | FLAG_INTERACT | FLAG_JUMP;

export const WS_CLOSE_REPLACED = 4003;
export const WS_CLOSE_EXPIRED = 4001;
export const WS_CLOSE_ABUSE = 4008;
