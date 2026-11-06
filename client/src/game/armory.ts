import type { ClassId } from '../../../shared/classes';
import { LONGBOW, SHORTBOW, SPEAR } from './attacks/ranged';
import { MAGIC_STAFF, QUARTERSTAFF, WAND_AND_BOOK } from './attacks/arcane';
import { KATANA, LONGSWORD } from './attacks/blade';
import { ZWEIHANDER } from './attacks/greatsword';
import { DOUBLE_AXE, WAR_HAMMER } from './attacks/heavy';
import { MACE_AND_SHIELD } from './attacks/shield';
import type { WeaponMoves, WeaponSetup } from './attacks/types';

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

const bow = (label: string, id: string, length: number, moves: WeaponMoves): WeaponSetup => ({
  ...moves,
  label,
  bow: true,
  items: [{ id, hand: 'l', length, grip: 0.5, head: '+y', edge: '-x', tilt: 5, edgeAt: 0.14 }],
});

export const ARMORY: Record<ClassId, WeaponSetup[]> = {
  juggernaut: [
    {
      ...WAR_HAMMER,
      label: 'War hammer',
      // Hands low on the handle, so that nearly all of its length is out in front of them.
      items: [{ id: 'war_hammer', reshape: { headFrom: 0.9, neck: 0.065, head: [4.5, 2.4, 1.2], handle: 0.6 }, hand: 'r', length: 2.2, grip: 0.12, head: '+y', edge: '+z' }],
      secondHand: 0.2,
      secondHandRoll: -0.8,
      secondElbowForward: 1,
    },
    {
      ...DOUBLE_AXE,
      label: 'Double axe',
      items: [{ id: 'double_axe', reshape: { headFrom: 0.7, neck: 0.06, head: [2.5, 1, 1], handle: 0.68 }, hand: 'r', length: 2.2, grip: 0.12, head: '+y', edge: '+z' }],
      secondHand: 0.2,
      secondHandRoll: -0.8,
      secondElbowForward: 1,
    },
    {
      ...MACE_AND_SHIELD,
      label: 'Mace and shield',
      items: [
        // A slimmer handle and a folded thumb, so that the hand closes around the shaft.
        { id: 'mace', reshape: { headFrom: 0.8, neck: 0.05, head: [1.5, 1.2, 1.5], handle: 1 }, hand: 'r', length: 1.2, grip: 0.14, head: '+y', edge: '+z', girth: 0.7, thumb: [-25, 70, 70] },
        { id: 'shield', hand: 'l', length: 0.8, grip: 0.5, head: '+y', edge: '-z', tilt: 0, nudge: [0.125, 0, -0.12], straps: true },
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
      items: [{ id: 'zweinhander', flat: 2.5, hand: 'r', length: 2.1, grip: 0.175, head: '+y', edge: '+z', girth: 0.8 }],
      secondHand: 0.24,
    },
  ],
  arcanist: [
    {
      ...MAGIC_STAFF,
      label: 'Magic staff',
      items: [{ id: 'magic_staff', hand: 'r', length: 1.7, grip: 0.65, head: '+y', edge: '+x', tilt: 8, girth: 0.6, thumb: [-25, 70, 70] }],
      // Most of its moves are one-handed, and each pose says so. This is for the slam: the left hand above the right.
      secondHand: -0.2,
    },
    {
      ...WAND_AND_BOOK,
      label: 'Wand and tome',
      items: [
        // The thumb lies along the handle and presses it, as with a fencer's grip.
        { id: 'magic_wand', hand: 'r', length: 0.5, grip: 0.2, head: '+y', edge: '+x', thumb: [0, 40, 25] },
        // Thumb toward the left page and fingers fanned under the spine, so the pose names the book's own axes. The tilt turns the palm in under the spine, so the wrist neither bends back like a waiter's nor wrings.
        { id: 'open-book', build: 'open-book', hand: 'l', length: 0.36, grip: 0.5, head: '-x', edge: '+y', tilt: -105, nudge: [-0.056, 0.07, 0], curl: 0.18 },
      ],
    },
    {
      ...QUARTERSTAFF,
      label: 'Quarterstaff',
      // Thin enough for the fingers to close around it, with the thumb folded down over the shaft on both hands.
      items: [{ id: 'bo_staff', hand: 'r', length: 2.05, grip: 0.29, head: '+y', edge: '+x', tilt: 10, girth: 0.57, thumb: [-25, 70, 70] }],
      secondHand: QUARTERSTAFF_REACH,
      // The lead palm meets the shaft from below and the side, not from on top of it.
      secondHandRoll: -1.2,
    },
  ],
  ranger: [
    bow('Longbow', 'longbow', 1.45, LONGBOW),
    bow('Shortbow', 'shortbow', 1.05, SHORTBOW),
    {
      ...SPEAR,
      label: 'Spear',
      // Long enough to look like it covers the reach in shared/combat.ts, with the shaft kept to the hand's size.
      items: [{ id: 'spear', hand: 'r', length: 3, grip: 0.11, head: '+y', edge: '+z', tilt: 10, girth: 0.76 }],
      secondHand: -0.34,
    },
  ],
};
