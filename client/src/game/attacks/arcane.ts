import type { Attack, ItemPose, Pose, Vec3, WeaponMoves } from './types';

/*
 * The arcanist's three weapons. The list order matches shared/combat.ts. Hit times: all three land at 0.5.
 * Lengths: staff 0.9 s, wand 0.55 s, quarterstaff 0.8 s, so a strike of 2 to 4 frames at 30 fps is about
 * 0.09 to 0.15 of the staves' attacks, and 0.12 to 0.2 of the wand's.
 *
 * Edges follow the head: seen from the side, the edge points 90 degrees ahead of the head in the direction
 * of travel, so that the knuckles lead the swing. A planted foot stays where it is: a foot only moves on keys
 * where it is lifted, or on the way back to the stance.
 */

/* Magic staff: a pilgrim's staff, planted beside the body with the hand at the height of the lower ribs. */

const STAFF_IDLE: Pose = {
  oneHand: true,
  grip: [0.3, -0.13, 0.22],
  head: [0.03, 1, 0.05],
  edge: [-0.15, -0.05, 1],
  hips: [0.01, 0.07, 0],
  hipTurn: 0.08,
  turn: 0.16,
  lean: 0.05,
  footL: [-0.13, 0.11, 0],
  footR: [0.13, -0.07, 0],
  toeL: 0.1,
  toeR: 0.35,
  freeHand: { position: [-0.25, -0.41, 0.09], fingers: 0.45 },
};
const STAFF_WALK: Pose = {
  oneHand: true,
  grip: [0.3, -0.12, 0.2],
  head: [0.05, 1, 0.14],
  edge: [-0.15, -0.14, 1],
  turn: 0.1,
  lean: 0.05,
};
// The run clip pitches the chest well forward and these are measured from it, so they read much flatter than written.
const STAFF_RUN: Pose = {
  oneHand: true,
  grip: [0.28, -0.2, 0.16],
  head: [0.08, 0.95, 0.3],
  edge: [-0.1, -0.3, 0.95],
  turn: 0.1,
  lean: 0.14,
};

/** Rears the staff back with the free palm raised, then drives its head at the target, stepping in. */
const STAFF_THRUST: Attack = {
  keys: [
    { at: 0.14, ease: 'smooth', grip: [0.3, -0.04, 0.2], head: [0.05, 1, -0.05], edge: [-0.1, 0.05, 1], hips: [0.02, 0.08, -0.02], turn: 0.28, hipTurn: 0.14 },
    {
      at: 0.34,
      ease: 'smooth',
      grip: [0.28, 0.22, 0.1],
      head: [0.1, 0.92, -0.38],
      edge: [-0.1, 0.38, 0.92],
      hips: [0.03, 0.08, -0.07],
      hipTurn: 0.3,
      turn: 0.56,
      lean: -0.1,
      footL: [-0.13, 0.15, 0.11],
      freeHand: { position: [-0.3, 0.02, 0.32], fingers: 0.1 },
    },
    { at: 0.41, ease: 'linear', grip: [0.28, 0.25, 0.08], head: [0.1, 0.9, -0.42], edge: [-0.1, 0.42, 0.9], turn: 0.6, lean: -0.12 },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.24, 0.07, 0.5],
      head: [-0.09, 0.3, 0.95],
      edge: [0, -0.95, 0.3],
      hips: [-0.02, 0.17, 0.17],
      hipTurn: -0.22,
      hipTilt: 0.16,
      turn: -0.3,
      lean: 0.32,
      footL: [-0.14, 0.4, 0],
      footR: [0.13, -0.07, 0.05],
      toeL: 0.05,
      headFollow: 0.05,
      freeHand: { position: [-0.3, 0.1, 0.22], fingers: 0.05 },
    },
    // The staff's weight carries the body on past the strike, and the head dips.
    {
      at: 0.64,
      ease: 'easeOut',
      grip: [0.23, -0.01, 0.54],
      head: [-0.09, 0.12, 0.99],
      edge: [0, -0.99, 0.12],
      hips: [-0.03, 0.2, 0.19],
      hipTurn: -0.28,
      turn: -0.4,
      lean: 0.38,
      freeHand: { position: [-0.32, -0.02, 0.14], fingers: 0.1 },
    },
    {
      at: 0.82,
      ease: 'smooth',
      grip: [0.26, -0.07, 0.4],
      head: [-0.02, 0.6, 0.8],
      edge: [0, -0.8, 0.6],
      hips: [-0.01, 0.14, 0.08],
      hipTurn: -0.08,
      hipTilt: 0.06,
      turn: -0.08,
      lean: 0.2,
      footL: [-0.14, 0.32, 0.1],
      footR: [0.13, -0.07, 0],
      freeHand: { position: [-0.3, -0.2, 0.16], fingers: 0.25 },
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.28, -0.1, 0.28],
      head: [0.02, 0.96, 0.26],
      edge: [-0.12, -0.26, 0.96],
      hips: [0.01, 0.09, 0.02],
      hipTurn: 0.04,
      hipTilt: 0,
      turn: 0.08,
      lean: 0.08,
      footL: [-0.13, 0.13, 0],
      toeL: 0.1,
      freeHand: { position: [-0.25, -0.41, 0.09], fingers: 0.45 },
    },
  ],
};

/*
 * The butt of the staff is 1.1 m below the right hand and the chest stands at 1.3 m, so the butt is on the
 * ground when the grip's height is about -0.245 plus how far the hips have dropped.
 */

/** The second hand joins above the first, the staff and the knee go up, and both come down at once. */
const STAFF_SLAM: Attack = {
  keys: [
    {
      at: 0.16,
      ease: 'smooth',
      oneHand: false,
      grip: [0.16, 0, 0.3],
      head: [0.05, 1, 0.04],
      edge: [-0.1, -0.04, 1],
      hips: [0.01, 0.1, 0],
      turn: 0.16,
      hipTurn: 0.08,
      lean: 0.06,
      footL: [-0.13, 0.13, 0.03],
    },
    {
      at: 0.36,
      ease: 'smooth',
      grip: [0.12, 0.27, 0.28],
      head: [0.07, 0.98, -0.14],
      edge: [-0.05, 0.14, 1],
      hips: [0.02, 0.07, -0.05],
      turn: 0.38,
      hipTurn: 0.2,
      lean: -0.1,
      footL: [-0.13, 0.2, 0.18],
      toeL: 0.1,
    },
    { at: 0.42, ease: 'linear', grip: [0.12, 0.29, 0.27], head: [0.07, 0.98, -0.18], edge: [-0.05, 0.18, 1], lean: -0.12 },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.1, -0.02, 0.44],
      head: [0.03, 0.96, -0.27],
      edge: [-0.03, 0.27, 0.96],
      hips: [-0.01, 0.23, 0.12],
      hipTurn: -0.12,
      hipTilt: 0.2,
      turn: -0.16,
      lean: 0.34,
      footL: [-0.16, 0.42, 0],
      footR: [0.13, -0.07, 0.06],
      toeL: 0.15,
      headFollow: 0.05,
    },
    // The ground stops the staff, so the hands stay while the body sinks onto them.
    { at: 0.62, ease: 'easeOut', grip: [0.1, 0.02, 0.44], head: [0.03, 0.97, -0.24], edge: [-0.03, 0.24, 0.97], hips: [-0.01, 0.27, 0.13], lean: 0.4 },
    {
      at: 0.82,
      ease: 'smooth',
      grip: [0.18, -0.08, 0.36],
      head: [0.03, 1, -0.06],
      edge: [-0.08, 0.06, 1],
      hips: [0, 0.15, 0.08],
      hipTilt: 0.05,
      hipTurn: 0,
      turn: 0.04,
      lean: 0.14,
      footL: [-0.15, 0.3, 0.1],
      footR: [0.13, -0.07, 0],
    },
    {
      at: 1,
      ease: 'smooth',
      oneHand: true,
      grip: [0.29, -0.13, 0.24],
      head: [0.03, 1, 0.05],
      edge: [-0.15, -0.05, 1],
      hips: [0.01, 0.075, 0],
      hipTilt: 0,
      hipTurn: 0.08,
      turn: 0.15,
      lean: 0.05,
      footL: [-0.13, 0.11, 0],
      toeL: 0.1,
      freeHand: { position: [-0.25, -0.41, 0.09], fingers: 0.45 },
    },
  ],
};

export const MAGIC_STAFF: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: STAFF_IDLE, walk: STAFF_WALK, run: STAFF_RUN },
  attacks: [STAFF_THRUST, STAFF_SLAM],
};

/* Wand and book: a fencer's slightly side-on stance, with the wand low and the book held to read from. */

// Feet out under the knees: this is a narrow stance, and any narrower bows the legs.
const WAND_FEET = { footR: [0.16, 0.17, 0] as Vec3, footL: [-0.17, -0.18, 0] as Vec3, toeL: 0.55, toeR: 0.1 };
const WAND_IDLE: Pose = {
  grip: [0.3, -0.13, 0.33],
  head: [-0.14, 0.42, 0.9],
  edge: [0, -0.9, 0.42],
  hips: [-0.01, 0.075, 0],
  hipTurn: -0.2,
  turn: -0.28,
  lean: 0.06,
  headFollow: 0,
  ...WAND_FEET,
};
const WAND_WALK: Pose = { grip: [0.29, -0.13, 0.32], head: [-0.12, 0.5, 0.86], edge: [0, -0.86, 0.5], turn: -0.16, lean: 0.05 };
const WAND_RUN: Pose = { grip: [0.28, -0.17, 0.26], head: [-0.05, 0.3, 0.95], edge: [0, -0.95, 0.3], turn: -0.08, lean: 0.14 };

/**
 * The left palm is open under the spine, the forearm level at the bottom of the ribs and out past the body, so
 * that it still shows from behind. The book tips up about 40 degrees and turns in a little, so the pages face
 * the eyes. The axes are the book's: head points across to its left page, edge up its spine.
 */
const BOOK_POSE: ItemPose = { grip: [-0.25, -0.05, 0.25], head: [-0.96, 0, 0.28], edge: [0.21, 0.64, 0.74] };
const BOOK_RUN: ItemPose = { grip: [-0.25, -0.08, 0.22], head: [-0.96, 0, 0.28], edge: [0.13, 0.88, 0.45] };
const BOOK_RAISED: ItemPose = { grip: [-0.25, -0.02, 0.26], head: [-0.96, 0, 0.28], edge: [0.2, 0.68, 0.7] };
const BOOK_LIFTED: ItemPose = { grip: [-0.26, 0.0, 0.28], head: [-0.96, 0, 0.28], edge: [0.19, 0.72, 0.66] };

/** Draws the elbow in and cocks the wrist with the tip up, then a small advance and a snap at the target. */
const WAND_FLICK: Attack = {
  keys: [
    {
      at: 0.34,
      ease: 'smooth',
      grip: [0.33, 0.0, 0.14],
      head: [0.24, 0.95, -0.14],
      edge: [0.05, 0.14, 1],
      hips: [0.01, 0.08, -0.05],
      hipTurn: -0.08,
      turn: -0.06,
      lean: 0,
      footR: [0.16, 0.2, 0.1],
      off: BOOK_RAISED,
    },
    { at: 0.41, ease: 'linear', grip: [0.33, 0.02, 0.13], head: [0.26, 0.94, -0.18], edge: [0.05, 0.18, 1], turn: -0.04 },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.2, 0.04, 0.52],
      head: [-0.08, 0.02, 1],
      edge: [-0.4, -0.9, 0.02],
      hips: [-0.03, 0.12, 0.12],
      hipTurn: -0.36,
      hipTilt: 0.08,
      turn: -0.56,
      lean: 0.18,
      footR: [0.16, 0.34, 0],
      footL: [-0.17, -0.18, 0.04],
      headFollow: 0,
      off: BOOK_LIFTED,
    },
    // The tip overshoots low and across, and then the wrist brings it back up.
    {
      at: 0.62,
      ease: 'easeOut',
      grip: [0.15, -0.02, 0.54],
      head: [-0.32, -0.16, 0.93],
      edge: [-0.45, -0.85, -0.3],
      hips: [-0.04, 0.13, 0.13],
      hipTurn: -0.38,
      turn: -0.6,
      lean: 0.2,
    },
    {
      at: 0.84,
      ease: 'smooth',
      grip: [0.2, -0.08, 0.44],
      head: [-0.36, 0.2, 0.9],
      edge: [-0.3, -0.92, 0.0],
      hips: [-0.02, 0.1, 0.06],
      hipTurn: -0.3,
      hipTilt: 0.03,
      turn: -0.44,
      lean: 0.11,
      footR: [0.16, 0.27, 0.1],
      footL: [-0.17, -0.18, 0],
      off: BOOK_POSE,
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.2, -0.08, 0.4],
      head: [-0.5, 0.2, 0.84],
      edge: [-0.3, -0.92, -0.1],
      hips: [-0.01, 0.08, 0.02],
      hipTurn: -0.28,
      turn: -0.42,
      lean: 0.08,
      footR: [0.16, 0.17, 0],
    },
  ],
};

/** Carries on from the last flick: the wrist cocks across the body, then sweeps out the other way. */
const WAND_SWEEP: Attack = {
  keys: [
    {
      at: 0.36,
      ease: 'smooth',
      grip: [0.12, 0, 0.36],
      head: [-0.72, 0.42, 0.55],
      edge: [-0.35, -0.9, -0.2],
      hips: [-0.01, 0.08, 0.0],
      hipTurn: -0.36,
      turn: -0.66,
      lean: 0.06,
      footR: [0.16, 0.2, 0.1],
      off: BOOK_RAISED,
    },
    { at: 0.42, ease: 'linear', grip: [0.11, 0.01, 0.35], head: [-0.75, 0.44, 0.5], turn: -0.7 },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.27, 0.03, 0.5],
      head: [0.08, 0.08, 1],
      edge: [0.5, -0.86, 0.04],
      hips: [0.01, 0.11, 0.11],
      hipTurn: -0.12,
      hipTilt: 0.07,
      turn: -0.14,
      lean: 0.16,
      footR: [0.16, 0.34, 0],
      footL: [-0.17, -0.18, 0.04],
      headFollow: 0,
      off: BOOK_LIFTED,
    },
    {
      at: 0.64,
      ease: 'easeOut',
      grip: [0.38, 0.05, 0.42],
      head: [0.52, 0.18, 0.84],
      edge: [0.55, -0.82, -0.14],
      hips: [0.02, 0.12, 0.1],
      hipTurn: -0.02,
      turn: 0.04,
      lean: 0.14,
    },
    {
      at: 0.84,
      ease: 'smooth',
      grip: [0.34, -0.06, 0.36],
      head: [0.14, 0.34, 0.93],
      edge: [0.3, -0.9, 0.3],
      hips: [0, 0.09, 0.05],
      hipTurn: -0.12,
      hipTilt: 0.02,
      turn: -0.14,
      lean: 0.1,
      footR: [0.16, 0.27, 0.1],
      footL: [-0.17, -0.18, 0],
      off: BOOK_POSE,
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.3, -0.12, 0.33],
      head: [-0.1, 0.42, 0.9],
      edge: [0.03, -0.9, 0.42],
      hips: [-0.01, 0.075, 0],
      hipTurn: -0.2,
      hipTilt: 0,
      turn: -0.27,
      lean: 0.06,
      footR: [0.16, 0.17, 0],
    },
  ],
};

export const WAND_AND_BOOK: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: WAND_IDLE, walk: WAND_WALK, run: WAND_RUN },
  offStance: { idle: BOOK_POSE, run: BOOK_RUN },
  attacks: [WAND_FLICK, WAND_SWEEP],
};

/*
 * Quarterstaff: the right hand stays low by the ribs and the left is out ahead of it, up the shaft. The short
 * end behind the right hand runs back under the arm, so that the staff never crosses the body.
 */

/** Knuckles under the shaft, as with any hand held low. */
const under = (head: Vec3): Vec3 => {
  const size = Math.hypot(head[0], head[1], head[2]);
  const [x, y, z] = [head[0] / size, head[1] / size, head[2] / size];
  // The part of "down and slightly out" that's square to the shaft.
  const dot = 0.1 * x - y;
  return [0.1 - dot * x, -1 - dot * y, -dot * z];
};
const staffAt = (grip: Vec3, head: Vec3) => ({ grip, head, edge: under(head) });

const QUARTERSTAFF_FEET = {
  footL: [-0.11, 0.2, 0] as Vec3,
  footR: [0.16, -0.2, 0] as Vec3,
  toeL: -0.15,
  toeR: 0.8,
};
const QUARTERSTAFF_IDLE: Pose = {
  ...staffAt([0.26, -0.2, 0.02], [-0.38, 0.42, 0.82]),
  reach: -0.52,
  hips: [0.01, 0.1, -0.01],
  hipTurn: 0.34,
  turn: 0.5,
  lean: 0.07,
  headFollow: 0,
  ...QUARTERSTAFF_FEET,
};
const QUARTERSTAFF_WALK: Pose = { ...staffAt([0.26, -0.2, 0.04], [-0.36, 0.66, 0.66]), reach: -0.5, turn: 0.4, lean: 0.06 };
const QUARTERSTAFF_RUN: Pose = { ...staffAt([0.24, -0.2, 0.04], [-0.42, 0.8, 0.42]), reach: -0.48, turn: 0.3, lean: 0.14 };

/** Coils right with the striking end trailing behind, then the hips whip it around from right to left. */
const QUARTERSTAFF_SIDE: Attack = {
  keys: [
    {
      at: 0.16,
      ease: 'smooth',
      ...staffAt([0.14, -0.05, 0.16], [0.42, 0.5, 0.76]),
      reach: -0.34,
      hips: [0.03, 0.1, -0.03],
      hipTurn: 0.5,
      turn: 0.8,
      lean: 0.04,
      footL: [-0.11, 0.2, 0.03],
    },
    {
      at: 0.33,
      ease: 'smooth',
      ...staffAt([0.06, 0.05, 0.2], [0.72, 0.25, -0.65]),
      reach: -0.3,
      hips: [0.05, 0.11, -0.05],
      hipTurn: 0.68,
      turn: 1.05,
      lean: 0.02,
      footL: [-0.11, 0.2, 0.09],
      toeL: 0.05,
    },
    { at: 0.4, ease: 'linear', ...staffAt([0.06, 0.06, 0.19], [0.7, 0.27, -0.66]), reach: -0.3, turn: 1.08, hipTurn: 0.62 },
    // The hips have already gone and the shoulders are only now following.
    {
      at: 0.45,
      ease: 'easeIn',
      ...staffAt([0.06, -0.03, 0.2], [0.85, 0.12, 0.5]),
      reach: -0.26,
      hips: [0.02, 0.14, 0.06],
      hipTurn: 0.1,
      turn: 0.72,
      lean: 0.12,
      footL: [-0.12, 0.3, 0.06],
    },
    {
      at: 0.5,
      ease: 'linear',
      impact: true,
      ...staffAt([0.25, -0.1, 0.03], [-0.34, 0.06, 0.94]),
      reach: -0.46,
      hips: [-0.02, 0.18, 0.14],
      hipTurn: -0.22,
      hipTilt: 0.12,
      turn: 0.16,
      lean: 0.26,
      footL: [-0.12, 0.38, 0],
      footR: [0.16, -0.2, 0.04],
      toeL: -0.05,
      toeR: 0.8,
    },
    // The weight of the staff drags the shoulders on around.
    {
      at: 0.64,
      ease: 'easeOut',
      ...staffAt([0.1, -0.11, 0.14], [-0.86, 0.02, 0.5]),
      reach: -0.42,
      hips: [-0.04, 0.2, 0.16],
      hipTurn: -0.4,
      hipTilt: 0.16,
      turn: -0.34,
      lean: 0.3,
    },
    {
      at: 0.82,
      ease: 'smooth',
      ...staffAt([0.14, -0.13, 0.1], [-0.72, 0.28, 0.63]),
      reach: -0.44,
      hips: [-0.02, 0.16, 0.08],
      hipTurn: -0.14,
      hipTilt: 0.08,
      turn: -0.02,
      lean: 0.18,
      footR: [0.16, -0.2, 0],
    },
    {
      at: 1,
      ease: 'smooth',
      ...staffAt([0.2, -0.13, 0.06], [-0.55, 0.45, 0.7]),
      reach: -0.46,
      hips: [0, 0.14, 0.05],
      hipTurn: 0.06,
      hipTilt: 0.04,
      turn: 0.22,
      lean: 0.13,
      footL: [-0.12, 0.34, 0],
    },
  ],
};

/** Carries on from the side strike: the staff wheels up on the right and comes straight down, the hips dropping under it. */
const QUARTERSTAFF_OVERHEAD: Attack = {
  keys: [
    {
      at: 0.18,
      ease: 'smooth',
      ...staffAt([0.14, -0.04, 0.2], [0.02, 0.86, 0.5]),
      reach: -0.34,
      hips: [0.02, 0.1, 0.0],
      hipTurn: 0.3,
      turn: 0.56,
      lean: 0.02,
    },
    {
      at: 0.35,
      ease: 'smooth',
      ...staffAt([0.16, 0.03, 0.22], [0.05, 0.9, -0.42]),
      reach: -0.32,
      hips: [0.04, 0.08, -0.05],
      hipTurn: 0.44,
      turn: 0.72,
      lean: -0.1,
      footL: [-0.12, 0.34, 0.1],
    },
    { at: 0.41, ease: 'linear', ...staffAt([0.16, 0.04, 0.21], [0.05, 0.88, -0.46]), reach: -0.32, lean: -0.12 },
    {
      at: 0.46,
      ease: 'easeIn',
      ...staffAt([0.2, -0.08, 0.16], [0.0, 0.84, 0.54]),
      reach: -0.34,
      hips: [0.01, 0.14, 0.06],
      hipTurn: 0.14,
      turn: 0.52,
      lean: 0.14,
    },
    {
      at: 0.5,
      ease: 'linear',
      impact: true,
      ...staffAt([0.22, -0.24, 0.06], [-0.2, 0.2, 0.96]),
      reach: -0.36,
      hips: [-0.01, 0.24, 0.17],
      hipTurn: 0.02,
      hipTilt: 0.24,
      turn: 0.16,
      lean: 0.42,
      footL: [-0.13, 0.46, 0],
      footR: [0.16, -0.2, 0.05],
      toeL: -0.05,
      headFollow: 0,
    },
    // The staff keeps going down and takes the shoulders with it.
    {
      at: 0.64,
      ease: 'easeOut',
      ...staffAt([0.2, -0.3, 0.08], [-0.18, -0.12, 0.98]),
      reach: -0.36,
      hips: [-0.01, 0.27, 0.18],
      hipTilt: 0.28,
      turn: 0.12,
      lean: 0.5,
    },
    {
      at: 0.84,
      ease: 'smooth',
      ...staffAt([0.24, -0.26, 0.04], [-0.26, 0.14, 0.95]),
      reach: -0.44,
      hips: [0, 0.2, 0.1],
      hipTurn: 0.14,
      hipTilt: 0.12,
      turn: 0.3,
      lean: 0.26,
      footR: [0.16, -0.2, 0],
    },
    {
      at: 1,
      ease: 'smooth',
      ...staffAt([0.27, -0.22, -0.05], [-0.14, 0.2, 0.97]),
      reach: -0.56,
      hips: [0.01, 0.16, 0.05],
      hipTurn: 0.3,
      hipTilt: 0.06,
      turn: 0.5,
      lean: 0.14,
      footL: [-0.12, 0.36, 0],
    },
  ],
};

/** The right hand draws the shaft back through the left, then drives it through for all the reach it has. */
const QUARTERSTAFF_POKE: Attack = {
  keys: [
    {
      at: 0.2,
      ease: 'smooth',
      ...staffAt([0.27, -0.17, -0.16], [-0.1, 0.1, 0.99]),
      reach: -0.62,
      hips: [0.03, 0.15, -0.06],
      hipTurn: 0.5,
      turn: 0.78,
      lean: 0.08,
      footL: [-0.12, 0.26, 0.03],
      headFollow: 0,
    },
    {
      at: 0.36,
      ease: 'smooth',
      ...staffAt([0.28, -0.16, -0.24], [-0.1, 0.1, 0.99]),
      reach: -0.68,
      hips: [0.04, 0.17, -0.1],
      hipTurn: 0.58,
      turn: 0.92,
      lean: 0.06,
      footL: [-0.12, 0.26, 0.11],
      toeL: 0.05,
    },
    { at: 0.42, ease: 'linear', ...staffAt([0.28, -0.16, -0.25], [-0.1, 0.1, 0.99]), reach: -0.69, turn: 0.95 },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      ...staffAt([0.24, -0.1, 0.34], [-0.1, 0.05, 0.99]),
      reach: -0.14,
      hips: [0, 0.2, 0.24],
      hipTurn: 0.22,
      hipTilt: 0.16,
      turn: 0.62,
      lean: 0.3,
      footL: [-0.13, 0.54, 0],
      footR: [0.16, -0.2, 0.06],
      toeL: -0.1,
      headFollow: 0,
    },
    { at: 0.62, ease: 'easeOut', ...staffAt([0.23, -0.12, 0.36], [-0.1, 0.02, 0.99]), reach: -0.12, hips: [0, 0.22, 0.26], lean: 0.34, turn: 0.58 },
    // Draws the shaft back through the lead hand, and the front foot comes home.
    {
      at: 0.8,
      ease: 'smooth',
      ...staffAt([0.26, -0.18, 0.1], [-0.24, 0.26, 0.93]),
      reach: -0.34,
      hips: [0.01, 0.16, 0.1],
      hipTurn: 0.26,
      hipTilt: 0.06,
      turn: 0.48,
      lean: 0.16,
      footL: [-0.12, 0.38, 0.1],
      footR: [0.16, -0.2, 0],
    },
    {
      at: 1,
      ease: 'smooth',
      ...staffAt([0.26, -0.2, 0.03], [-0.36, 0.4, 0.84]),
      reach: -0.5,
      hips: [0.01, 0.11, 0],
      hipTurn: 0.34,
      hipTilt: 0,
      turn: 0.5,
      lean: 0.08,
      footL: [-0.11, 0.2, 0],
      toeL: -0.15,
    },
  ],
};

export const QUARTERSTAFF: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: QUARTERSTAFF_IDLE, walk: QUARTERSTAFF_WALK, run: QUARTERSTAFF_RUN },
  attacks: [QUARTERSTAFF_SIDE, QUARTERSTAFF_OVERHEAD, QUARTERSTAFF_POKE],
};
