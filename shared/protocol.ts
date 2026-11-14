/** Messages sent over the game's WebSocket. */
import type { Appearance, ClassId, StatKey, Stats } from './classes.js';
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
 * health, magic, staggerTime, knockX, knockZ, deadTime, potions, drinkTime, jumpTime, resting, criticalTime
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
  resting: number,
  criticalTime: number,
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
    s.resting,
    round(s.criticalTime),
  ];
}

export function applySnapshot(entry: PlayerSnapshot, state: SimState): void {
  [, state.x, state.z, state.yaw, state.stamina, state.moving, state.dodgeTime, state.attackTime, state.attackCount,
    state.dodgeX, state.dodgeZ, state.regenDelay, state.health, state.magic, state.staggerTime, state.knockX,
    state.knockZ, state.deadTime, state.potions, state.drinkTime, state.jumpTime, state.resting,
    state.criticalTime] = entry;
}

/** One creature inside a snapshot: id, kind (index into CREATURES), x, z, yaw, state (CreatureState), health percent. */
export type CreatureSnapshot = [number, number, number, number, number, number, number];

/**
 * The boss health bar, sent in each snapshot only to players within BOSS_BAR_RANGE of the arena while the boss
 * is alive and has noticed someone. Cheaper than a separate message, and it fixes itself if one is lost.
 * creature id, kind (index into CREATURES, for the name), health, max health, stance (0..255 of BOSS_STANCE.max,
 * see packStance), and stun seconds left in tenths (0 while standing, see packStunLeft).
 */
export type BossSnapshot = [c: number, kind: number, hp: number, max: number, stance: number, stunLeft: number];

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
  /**
   * A projectile set off. The browser moves it on its own until the matching 'shotEnd'. form is left
   * out of a plain arrow. target is a creature id, or 0 for none, and turn is radians per second:
   * together they let the browser curve a homing bolt the way the server does. width is a crescent's.
   */
  | {
      k: 'shot';
      id: number;
      by: number;
      x: number;
      z: number;
      yaw: number;
      speed: number;
      range: number;
      style: StyleIndex;
      form?: 'homing' | 'crescent';
      target?: number;
      turn?: number;
      width?: number;
    }
  /** A projectile hit something, or fizzled out if hit is 0. splash is its area in meters. */
  | { k: 'shotEnd'; id: number; x: number; z: number; hit: 0 | 1; splash: number; style: StyleIndex }
  /** A meteor was called down on this spot and lands in delay seconds. radius is its area in meters. */
  | { k: 'meteor'; id: number; by: number; x: number; z: number; delay: number; radius: number; style: StyleIndex }
  /** A meteor landed. Each creature it damaged gets its own 'hit'. */
  | { k: 'meteorEnd'; id: number; by: number; x: number; z: number; radius: number; style: StyleIndex }
  /** Red Binary Dust bursts out of a corpse and flies to the player who earned it. */
  | { k: 'dust'; x: number; z: number; n: number; to: number }
  /**
   * A boss move's windup began. m is a BossMove id (shared/boss.ts), x, z, yaw where the boss stands, t the
   * windup seconds. tx, tz is the landing point for a leap and the aim point for every other move.
   * There are no extra CreatureState values: the browser poses the boss from this event.
   */
  | { k: 'bossTell'; c: number; m: number; x: number; z: number; yaw: number; tx: number; tz: number; t: number }
  /** A boss move's hit moment: swipe lands, charge starts running, leap lands, fireballs fly, stomp ring starts. */
  | { k: 'bossHit'; c: number; m: number; x: number; z: number; yaw: number }
  /**
   * A boss fireball set off. Its own event, not 'shot', because 'shot' carries a player id and a player weapon
   * style. Flies straight from x, z along yaw until the matching 'bossShotEnd'. r is its hit radius.
   */
  | { k: 'bossShot'; id: number; c: number; x: number; z: number; yaw: number; speed: number; range: number; r: number }
  /** A boss fireball hit a player (hit 1, v is that player) or burned out (hit 0, v is 0). */
  | { k: 'bossShotEnd'; id: number; x: number; z: number; hit: 0 | 1; v: number }
  /** A boss move hit a player for dmg. The player's own snapshot shows the knockback. */
  | { k: 'bossDmg'; c: number; m: number; v: number; dmg: number }
  /** The boss's stance broke at x, z: it collapses stunned for BOSS_STANCE.stunSeconds. */
  | { k: 'bossBreak'; c: number; x: number; z: number }
  /**
   * Player by started a critical on boss c, standing at x, z facing yaw. w is the weapon variant (0..2) and cls the
   * class's index in CLASSES (shared/classes.ts), so effects need no PlayerInfo lookup. The damage lands CRITICAL_IMPACT_TIME later.
   */
  | { k: 'crit'; by: number; c: number; x: number; z: number; yaw: number; w: number; cls: number }
  /** A critical's impact: dmg dealt to boss c at x, z (the boss's position), kill 1 if it died. */
  | { k: 'critHit'; by: number; c: number; x: number; z: number; dmg: number; kill: 0 | 1 }
  /** Boss c got up: its stun is over. */
  | { k: 'bossRise'; c: number }
  | { k: 'death'; v: number }
  | { k: 'respawn'; v: number }
  | { k: 'drink'; v: number };

/** Why the server said no to something. Only ever one of these fixed words, which the browser turns into text. */
export type RefusalReason =
  | 'enemies_near'
  | 'interrupted'
  | 'grace_full'
  | 'not_resting'
  | 'too_far'
  | 'no_dust'
  | 'stat_maxed'
  | 'not_discovered'
  | 'try_again';

export type ServerMessage =
  | {
      t: 'welcome';
      you: number;
      players: PlayerInfo[];
      snapshot: PlayerSnapshot[];
      binaryDust: number;
      /** Chest ids this save has already opened. */
      chests: number[];
      /** Binary Grace ids this save has already lit. */
      graces: number[];
      mapVersion: number;
    }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  /** a is the newest input of yours the server has applied. c and e are limited to what's near you, and b is left out away from the boss. */
  | { t: 's'; a: number; p: PlayerSnapshot[]; c: CreatureSnapshot[]; e?: GameEvent[]; b?: BossSnapshot }
  /** Your own totals changed. */
  | { t: 'self'; dust: number; kills: number }
  /** You opened a chest. Other players still see it closed. */
  | { t: 'chest'; id: number; dust: number; potion: 0 | 1 }
  /** You lit a Binary Grace for the first time on this save. */
  | { t: 'grace'; id: number }
  /** A player's public details changed, as when they raise a stat. */
  | { t: 'info'; player: PlayerInfo }
  /** The stat you asked for went up. */
  | { t: 'upgraded'; stat: StatKey }
  /** The server said no, or stopped you resting. */
  | { t: 'refused'; reason: RefusalReason }
  /** An achievement was earned. */
  | { t: 'unlock'; achievement: string }
  /** The account has no character yet. */
  | { t: 'no_character' };

export type ClientMessage =
  | {
      t: 'i';
      /** seq, mx, mz, yaw, flags */
      d: [number, number, number, number, number];
    }
  /** Asks to raise one stat by one. The server works out the cost for itself. */
  | { t: 'upgrade'; stat: StatKey }
  /** Asks to travel to a grace you have lit. */
  | { t: 'travel'; grace: number }
  /** Stand up from resting. */
  | { t: 'stand' }
  /** Which creature you're locked on to, or 0. A preference only: the server checks it each time you cast. */
  | { t: 'aim'; c: number };

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
