/**
 * Weapon numbers and damage rules, used by the server to decide what happens and by the browser
 * to predict costs and timing. Tune the game here. See docs/GAME_PLAN.md section 1 for the reasoning.
 */
import type { ClassId, Stats } from './classes.js';

/** Decides how a hit looks and sounds, so that heavy weapons feel different from a dagger-quick cut. */
export type WeaponStyle = 'heavy' | 'blade' | 'thrust' | 'magic' | 'arrow';
export const WEAPON_STYLES: readonly WeaponStyle[] = ['heavy', 'blade', 'thrust', 'magic', 'arrow'];

export interface MeleeShape {
  /** Meters from the player's center. */
  reach: number;
  /** Full width of the swing in degrees. */
  arcDegrees: number;
  maxTargets: number;
}

export interface ProjectileShape {
  /** Meters per second. */
  speed: number;
  /** Meters before it fizzles out. */
  range: number;
  /** Meters of area damage around the impact. 0 hits one target. */
  splash: number;
  maxTargets: number;
}

export interface WeaponStats {
  label: string;
  style: WeaponStyle;
  governing: 'strength' | 'dexterity' | 'arcane';
  damage: number;
  /** Seconds for the whole attack at Speed 10. */
  attackSeconds: number;
  /** When the hit lands, as a share of the attack. Lines up with the strike pose in client/src/game/armory.ts. */
  hitAt: number;
  /** Stamina, or magic when usesMagic is set. */
  cost: number;
  usesMagic: boolean;
  /** How hard it breaks a creature's balance. */
  stagger: number;
  /** Walking speed multiplier while attacking. */
  attackMoveMultiplier: number;
  melee?: MeleeShape;
  projectile?: ProjectileShape;
}

/** Order matches the weapon setups in client/src/game/armory.ts, selected by appearance.variant. */
export const WEAPONS: Record<ClassId, readonly [WeaponStats, WeaponStats, WeaponStats]> = {
  juggernaut: [
    { label: 'War hammer', style: 'heavy', governing: 'strength', damage: 46, attackSeconds: 1.25, hitAt: 0.5, cost: 30, usesMagic: false, stagger: 60, attackMoveMultiplier: 0.2, melee: { reach: 2.8, arcDegrees: 110, maxTargets: 4 } },
    { label: 'Double axe', style: 'heavy', governing: 'strength', damage: 40, attackSeconds: 1.1, hitAt: 0.5, cost: 24, usesMagic: false, stagger: 40, attackMoveMultiplier: 0.2, melee: { reach: 3, arcDegrees: 140, maxTargets: 5 } },
    { label: 'Mace and shield', style: 'heavy', governing: 'strength', damage: 28, attackSeconds: 0.8, hitAt: 0.42, cost: 16, usesMagic: false, stagger: 34, attackMoveMultiplier: 0.3, melee: { reach: 2.3, arcDegrees: 100, maxTargets: 3 } },
  ],
  duelist: [
    { label: 'Katana', style: 'blade', governing: 'dexterity', damage: 20, attackSeconds: 0.6, hitAt: 0.46, cost: 10, usesMagic: false, stagger: 12, attackMoveMultiplier: 0.3, melee: { reach: 2.6, arcDegrees: 90, maxTargets: 2 } },
    { label: 'Longsword', style: 'blade', governing: 'dexterity', damage: 24, attackSeconds: 0.68, hitAt: 0.42, cost: 12, usesMagic: false, stagger: 16, attackMoveMultiplier: 0.3, melee: { reach: 2.6, arcDegrees: 100, maxTargets: 3 } },
    { label: 'Zweihander', style: 'heavy', governing: 'dexterity', damage: 42, attackSeconds: 1.15, hitAt: 0.5, cost: 24, usesMagic: false, stagger: 48, attackMoveMultiplier: 0.2, melee: { reach: 3.2, arcDegrees: 120, maxTargets: 4 } },
  ],
  arcanist: [
    { label: 'Magic staff', style: 'magic', governing: 'arcane', damage: 30, attackSeconds: 0.9, hitAt: 0.5, cost: 12, usesMagic: true, stagger: 15, attackMoveMultiplier: 0.4, projectile: { speed: 16, range: 24, splash: 1.8, maxTargets: 3 } },
    { label: 'Wand and tome', style: 'magic', governing: 'arcane', damage: 17, attackSeconds: 0.55, hitAt: 0.5, cost: 7, usesMagic: true, stagger: 6, attackMoveMultiplier: 0.5, projectile: { speed: 22, range: 26, splash: 0, maxTargets: 1 } },
    { label: 'Quarterstaff', style: 'magic', governing: 'arcane', damage: 26, attackSeconds: 0.8, hitAt: 0.5, cost: 8, usesMagic: true, stagger: 24, attackMoveMultiplier: 0.3, melee: { reach: 3, arcDegrees: 120, maxTargets: 3 } },
  ],
  ranger: [
    { label: 'Longbow', style: 'arrow', governing: 'dexterity', damage: 34, attackSeconds: 1.05, hitAt: 0.58, cost: 12, usesMagic: false, stagger: 10, attackMoveMultiplier: 0.45, projectile: { speed: 34, range: 38, splash: 0, maxTargets: 1 } },
    { label: 'Shortbow', style: 'arrow', governing: 'dexterity', damage: 20, attackSeconds: 0.68, hitAt: 0.58, cost: 8, usesMagic: false, stagger: 6, attackMoveMultiplier: 0.6, projectile: { speed: 30, range: 28, splash: 0, maxTargets: 1 } },
    { label: 'Spear', style: 'thrust', governing: 'dexterity', damage: 26, attackSeconds: 0.8, hitAt: 0.48, cost: 12, usesMagic: false, stagger: 18, attackMoveMultiplier: 0.3, melee: { reach: 3.8, arcDegrees: 45, maxTargets: 3 } },
  ],
};

export function weaponFor(classId: ClassId, variant: number): WeaponStats {
  return WEAPONS[classId][variant] ?? WEAPONS[classId][0];
}

/** Extra reach on melee hits, to make up for network delay. */
export const MELEE_TOLERANCE = 0.5;
const DAMAGE_PER_STAT_POINT = 0.015;
const MIN_STAT_BONUS = 0.7;

export function attackDamage(weapon: WeaponStats, stats: Stats): number {
  const bonus = Math.max(MIN_STAT_BONUS, 1 + (stats[weapon.governing] - 10) * DAMAGE_PER_STAT_POINT);
  return Math.max(1, Math.round(weapon.damage * bonus));
}

export function staggerPower(weapon: WeaponStats, stats: Stats): number {
  return weapon.stagger * (1 + 0.01 * (stats.strength - 10));
}

/** True when a target at this offset is inside the swing. Deliberately uses only sqrt and atan2-free maths. */
export function inMeleeArc(
  dx: number,
  dz: number,
  yaw: number,
  melee: MeleeShape,
  targetRadius: number,
): boolean {
  const reach = melee.reach + targetRadius + MELEE_TOLERANCE;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared > reach * reach) return false;
  // Something standing right on top of the player always counts.
  if (distanceSquared < 0.25) return true;
  const distance = Math.sqrt(distanceSquared);
  const facing = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance;
  return facing >= Math.cos((melee.arcDegrees * Math.PI) / 360);
}

/* Binary Dust and levels. */

export function upgradeCost(level: number): number {
  const steps = level - 1;
  return Math.round(12 + 6 * steps + 0.6 * steps * steps);
}

/* Chests give one account one reward each. */
export const CHEST_REWARD_DUST = 40;
export const INTERACT_RANGE = 3;

/** How long the "you died" state lasts before respawning. */
export const RESPAWN_SECONDS = 5;
