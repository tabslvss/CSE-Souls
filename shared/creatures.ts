/** Numbers for animals and other creatures. The server runs them; the browser only draws them. */

export type CreatureBehavior = 'hunter' | 'prey';

export interface CreatureKind {
  id: string;
  name: string;
  behavior: CreatureBehavior;
  health: number;
  /** Damage per bite. 0 for animals that only run away. */
  damage: number;
  /** Seconds of warning before a bite lands, and of recovery afterward. */
  windup: number;
  recovery: number;
  walkSpeed: number;
  runSpeed: number;
  /** Notices players, or flees from them, within this distance. */
  aggro: number;
  /** Gives up and goes home past this distance from its camp. */
  leash: number;
  biteRange: number;
  radius: number;
  /** A hit this hard, in total within 3 seconds, makes it stumble. */
  poise: number;
  dustChance: number;
  dustMin: number;
  dustMax: number;
  respawnSeconds: number;
}

/** The position in this list is what goes in a snapshot, so only ever add to the end. */
export const CREATURES: readonly CreatureKind[] = [
  { id: 'wolf', name: 'Wolf', behavior: 'hunter', health: 85, damage: 12, windup: 0.45, recovery: 0.7, walkSpeed: 1.8, runSpeed: 5.5, aggro: 18, leash: 40, biteRange: 1.7, radius: 0.7, poise: 20, dustChance: 0.9, dustMin: 4, dustMax: 6, respawnSeconds: 45 },
  { id: 'deer', name: 'Deer', behavior: 'prey', health: 40, damage: 0, windup: 0, recovery: 0, walkSpeed: 1.2, runSpeed: 6.5, aggro: 8, leash: 60, biteRange: 0, radius: 0.7, poise: 1, dustChance: 0.8, dustMin: 2, dustMax: 3, respawnSeconds: 40 },
  { id: 'stag', name: 'Stag', behavior: 'prey', health: 90, damage: 0, windup: 0, recovery: 0, walkSpeed: 1.3, runSpeed: 7, aggro: 10, leash: 60, biteRange: 0, radius: 0.8, poise: 20, dustChance: 1, dustMin: 6, dustMax: 9, respawnSeconds: 60 },
  { id: 'fox', name: 'Fox', behavior: 'prey', health: 20, damage: 0, windup: 0, recovery: 0, walkSpeed: 1.1, runSpeed: 7, aggro: 7, leash: 50, biteRange: 0, radius: 0.4, poise: 1, dustChance: 0.7, dustMin: 1, dustMax: 2, respawnSeconds: 30 },
  { id: 'bull', name: 'Black Aurochs', behavior: 'hunter', health: 320, damage: 30, windup: 0.8, recovery: 1.2, walkSpeed: 1.5, runSpeed: 6, aggro: 9, leash: 30, biteRange: 2.4, radius: 1.2, poise: 90, dustChance: 1, dustMin: 20, dustMax: 30, respawnSeconds: 90 },
];

export const CREATURE_BY_ID = new Map(CREATURES.map((kind, index) => [kind.id, { kind, index }]));

/** What a creature is doing, for the browser to pick an animation. Part of the wire format. */
export const CreatureState = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  Windup: 3,
  Strike: 4,
  Recover: 5,
  Stagger: 6,
  Dead: 7,
} as const;
export type CreatureStateId = (typeof CreatureState)[keyof typeof CreatureState];

/** Seconds a corpse stays before it's removed. */
export const CORPSE_SECONDS = 4;
/** At most this many creatures can be winding up on one player at once. */
export const MAX_ATTACKERS_PER_PLAYER = 3;
