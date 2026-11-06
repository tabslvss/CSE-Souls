import type { ClassId } from '../../../shared/classes';
import { BOW, SPEAR } from './attacks/ranged';
import { MAGIC_STAFF, QUARTERSTAFF, WAND_AND_BOOK } from './attacks/arcane';
import { KATANA, LONGSWORD } from './attacks/blade';
import { ZWEIHANDER } from './attacks/greatsword';
import { DOUBLE_AXE, WAR_HAMMER } from './attacks/heavy';
import { MACE_AND_SHIELD } from './attacks/shield';
import type { WeaponSetup } from './attacks/types';

export type * from './attacks/types';

/*
 * What every character can hold. Hands follow the weapon, not the other way round: each pose says
 * where the weapon is, relative to the character's chest, and inverse kinematics (weaponRig.ts)
 * bends the arms to reach it. That keeps both hands on the handle through every animation.
 *
 * The moves live in attacks/, with a file per weapon family. Order in each list matches
 * shared/combat.ts, selected by appearance.variant.
 */

// Negative, as on the spear: the left hand is ahead of the right, up the shaft toward the striking end.
const QUARTERSTAFF_REACH = -0.52;

const bow = (label: string, id: string, length: number): WeaponSetup => ({
  ...BOW,
  label,
  bow: true,
  items: [{ id, hand: 'l', length, grip: 0.5, head: '+y', edge: '-x', tilt: 5, edgeAt: 0.14 }],
});

export const ARMORY: Record<ClassId, WeaponSetup[]> = {
  juggernaut: [
    {
      ...WAR_HAMMER,
      label: 'War hammer',
      items: [{ id: 'war_hammer', flat: 2.5, hand: 'r', length: 1.25, grip: 0.58, head: '+y', edge: '+z' }],
      secondHand: 0.28,
    },
    {
      ...DOUBLE_AXE,
      label: 'Double axe',
      items: [{ id: 'double_axe', flat: 2.5, hand: 'r', length: 1.2, grip: 0.5, head: '+y', edge: '+z' }],
      secondHand: 0.28,
    },
    {
      ...MACE_AND_SHIELD,
      label: 'Mace and shield',
      items: [
        { id: 'mace', hand: 'r', length: 0.85, grip: 0.14, head: '+y', edge: '+z' },
        { id: 'shield', hand: 'l', length: 0.8, grip: 0.5, head: '+y', edge: '-z', tilt: 0, nudge: [0.07, 0, -0.12], curl: 0.85 },
      ],
    },
  ],
  duelist: [
    {
      ...KATANA,
      label: 'Katana',
      items: [{ id: 'katana', flat: 2.5, hand: 'r', length: 1.05, grip: 0.18, head: '+y', edge: '+z' }],
      secondHand: 0.15,
    },
    {
      ...LONGSWORD,
      label: 'Longsword',
      items: [{ id: 'longsword', flat: 2.5, hand: 'r', length: 1.1, grip: 0.1, head: '+y', edge: '+x' }],
    },
    {
      ...ZWEIHANDER,
      label: 'Zweihander',
      items: [{ id: 'zweinhander', flat: 2.5, hand: 'r', length: 1.55, grip: 0.175, head: '+y', edge: '+z' }],
      secondHand: 0.19,
    },
  ],
  arcanist: [
    {
      ...MAGIC_STAFF,
      label: 'Magic staff',
      items: [{ id: 'magic_staff', hand: 'r', length: 1.7, grip: 0.65, head: '+y', edge: '+x', tilt: 8, girth: 0.6 }],
      // Most of its moves are one-handed, and each pose says so. This is for the slam: the left hand above the right.
      secondHand: -0.2,
    },
    {
      ...WAND_AND_BOOK,
      label: 'Wand and tome',
      items: [
        { id: 'magic_wand', hand: 'r', length: 0.5, grip: 0.2, head: '+y', edge: '+x' },
        // Thumb toward the left page and fingers fanned under the spine, so the pose names the book's own axes.
        { id: 'open-book', build: 'open-book', hand: 'l', length: 0.36, grip: 0.5, head: '-x', edge: '+y', tilt: -32, nudge: [-0.056, 0, 0], curl: 0.18 },
      ],
    },
    {
      ...QUARTERSTAFF,
      label: 'Quarterstaff',
      items: [{ id: 'bo_staff', hand: 'r', length: 1.8, grip: 0.33, head: '+y', edge: '+x', tilt: 10 }],
      secondHand: QUARTERSTAFF_REACH,
    },
  ],
  ranger: [
    bow('Longbow', 'longbow', 1.45),
    bow('Shortbow', 'shortbow', 1.05),
    {
      ...SPEAR,
      label: 'Spear',
      items: [{ id: 'spear', hand: 'r', length: 1.9, grip: 0.3, head: '+y', edge: '+z', tilt: 10 }],
      secondHand: -0.34,
    },
  ],
};
