/** Game rules used by both the server and the browser. */

export const STAT_KEYS = ['strength', 'dexterity', 'arcane', 'speed', 'stamina', 'health'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { label: string; effect: string }> = {
  strength: { label: 'Strength', effect: 'Heavy weapon damage' },
  dexterity: { label: 'Dexterity', effect: 'Sword and bow damage' },
  arcane: { label: 'Arcane', effect: 'Spell damage and maximum magic' },
  speed: { label: 'Speed', effect: 'Movement and attack speed' },
  stamina: { label: 'Stamina', effect: 'How long you can run, dodge and attack' },
  health: { label: 'Health', effect: 'How much damage you can take' },
};

export type ClassId = 'juggernaut' | 'duelist' | 'arcanist' | 'ranger';

export interface ClassDefinition {
  id: ClassId;
  name: string;
  weaponType: string;
  summary: string;
  baseStats: Stats;
}

export const CLASSES: readonly ClassDefinition[] = [
  {
    id: 'juggernaut',
    name: 'Juggernaut',
    weaponType: 'Heavy axe or hammer',
    summary: 'Slow, tough and hits very hard. Big swings can knock a group of enemies off balance.',
    baseStats: { strength: 18, dexterity: 7, arcane: 5, speed: 7, stamina: 13, health: 16 },
  },
  {
    id: 'duelist',
    name: 'Duelist',
    weaponType: 'Sword or katana',
    summary: 'Fast, precise close-range fighter. Chains quick attacks and dodges.',
    baseStats: { strength: 11, dexterity: 16, arcane: 6, speed: 14, stamina: 12, health: 10 },
  },
  {
    id: 'arcanist',
    name: 'Mage',
    weaponType: 'Staff and spells',
    summary: 'Deals huge magic damage from far away, but dies quickly if enemies reach it.',
    baseStats: { strength: 5, dexterity: 9, arcane: 19, speed: 10, stamina: 10, health: 8 },
  },
  {
    id: 'ranger',
    name: 'Ranger',
    weaponType: 'Bow',
    summary: 'Fights from a distance and keeps moving. The fastest class in the game.',
    baseStats: { strength: 8, dexterity: 17, arcane: 7, speed: 16, stamina: 11, health: 9 },
  },
];

export function findClass(id: unknown): ClassDefinition | undefined {
  return CLASSES.find((item) => item.id === id);
}

/** Choices are small integers into fixed lists, so nothing free-form ever reaches other players. */
export interface Appearance {
  /** 0 is male, 1 is female. */
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  /** 0 is none, 1 is a beard. */
  beard: number;
  /** Clothing color. */
  cloth: number;
  /** Leather and armor color. */
  armor: number;
  /** 0 is off, 1 is worn. */
  headgear: number;
  /** 0 is off, 1 is worn. */
  shoulders: number;
  /** Which starting weapon. */
  variant: number;
}

export const APPEARANCE_LIMITS: Record<keyof Appearance, number> = {
  body: 2,
  skin: 6,
  hair: 4,
  hairColor: 6,
  beard: 2,
  cloth: 8,
  armor: 8,
  headgear: 2,
  shoulders: 2,
  variant: 3,
};

export const DEFAULT_APPEARANCE: Appearance = {
  body: 0,
  skin: 1,
  hair: 1,
  hairColor: 0,
  beard: 0,
  cloth: 0,
  armor: 0,
  headgear: 0,
  shoulders: 1,
  variant: 0,
};

export function sanitizeAppearance(value: unknown): Appearance | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const clean = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(APPEARANCE_LIMITS) as Array<keyof Appearance>) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) >= APPEARANCE_LIMITS[key]) return null;
    clean[key] = raw as number;
  }
  return clean;
}
