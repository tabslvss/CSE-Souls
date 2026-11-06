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

// The free arm hangs straight down with only a slight bend, ready to cast. Any closer and the elbow flares out.
const STAFF_FREE_HAND = { position: [-0.22, -0.48, 0.04] as Vec3, fingers: 0.4 };
const STAFF_IDLE: Pose = {
  oneHand: true,
  grip: [0.3, -0.13, 0.22],
  head: [0.03, 1, 0.05],
  edge: [-0.15, -0.05, 1],
  hips: [0, 0.1, 0],
  hipTurn: 0.06,
  turn: 0.12,
  lean: 0.05,
  headPitch: 0.08,
  footL: [-0.13, 0.11, 0],
  footR: [0.13, -0.07, 0],
  toeL: 0.1,
  toeR: 0.2,
  freeHand: STAFF_FREE_HAND,
};
const STAFF_WALK: Pose = {
  oneHand: true,
  grip: [0.32, -0.12, 0.2],
  head: [-0.02, 1, 0.12],
  edge: [-0.15, -0.14, 1],
  turn: 0.1,
  lean: 0.05,
};
// The run clip pitches the chest well forward and these are measured from it, so they read much flatter than
// written. The head leans in so that the butt stays out on the right, clear of the hips and legs.
const STAFF_RUN: Pose = {
  oneHand: true,
  grip: [0.34, -0.2, 0.16],
  head: [-0.1, 0.95, 0.3],
  edge: [-0.1, -0.3, 0.95],
  turn: 0.1,
  lean: 0.14,
};

/** Rears the staff back with the free palm raised, then drives its head at the target, stepping in. */
const STAFF_THRUST: Attack = {
  keys: [
    { at: 0.14, ease: 'smooth', grip: [0.3, -0.04, 0.2], head: [0.05, 1, -0.05], edge: [-0.1, 0.05, 1], hips: [0.02, 0.08, -0.02], turn: 0.28, hipTurn: 0.14 },
    {
      at: 0.32,
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
    { at: 0.41, ease: 'hold' },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.22, 0.09, 0.56],
      head: [-0.09, 0.3, 0.95],
      edge: [0, -0.95, 0.3],
      hips: [-0.02, 0.17, 0.22],
      hipTurn: -0.22,
      hipTilt: 0.16,
      turn: -0.3,
      lean: 0.4,
      footL: [-0.14, 0.4, 0],
      footR: [0.13, -0.07, 0.05],
      toeL: 0.05,
      headFollow: 0.05,
      freeHand: { position: [-0.28, -0.38, -0.14], fingers: 0.3 },
    },
    // The staff's weight carries the body on past the strike, the head dips and the free arm swings back to balance it.
    {
      at: 0.64,
      ease: 'easeOut',
      grip: [0.2, -0.14, 0.58],
      head: [-0.13, -0.3, 0.95],
      edge: [0, -0.95, -0.3],
      hips: [-0.04, 0.23, 0.31],
      hipTurn: -0.3,
      turn: -0.44,
      lean: 0.54,
      freeHand: { position: [-0.28, -0.36, -0.14], fingers: 0.4 },
    },
    // The foot lifts first, and lands well before the end so that the last moments are calm.
    {
      at: 0.74,
      ease: 'smooth',
      grip: [0.22, -0.12, 0.52],
      head: [-0.09, 0.06, 0.77],
      edge: [0, -0.77, 0.06],
      hips: [-0.026, 0.19, 0.22],
      hipTurn: -0.2,
      hipTilt: 0.115,
      turn: -0.3,
      lean: 0.32,
      footL: [-0.14, 0.38, 0.12],
      footR: [0.13, -0.07, 0],
      freeHand: { position: [-0.26, -0.42, -0.08], fingers: 0.4 },
    },
    {
      at: 0.86,
      ease: 'smooth',
      grip: [0.25, -0.09, 0.44],
      head: [-0.04, 0.52, 0.54],
      edge: [0, -0.54, 0.52],
      hips: [-0.01, 0.128, 0.11],
      hipTurn: -0.09,
      hipTilt: 0.06,
      turn: -0.12,
      lean: 0.2,
      footL: [-0.13, 0.135, 0.1],
      freeHand: { position: [-0.24, -0.46, 0], fingers: 0.4 },
    },
    {
      at: 0.92,
      ease: 'smooth',
      grip: [0.28, -0.1, 0.32],
      head: [-0.01, 0.8, 0.36],
      edge: [-0.08, -0.42, 0.71],
      hips: [0, 0.107, 0.07],
      hipTurn: -0.04,
      hipTilt: 0.03,
      turn: -0.03,
      lean: 0.13,
      footL: [-0.13, 0.13, 0],
      toeL: 0.1,
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.3, -0.11, 0.24],
      head: [0.02, 0.99, 0.12],
      edge: [-0.14, -0.12, 0.98],
      hips: [0.01, 0.09, 0.02],
      hipTurn: 0.04,
      hipTilt: 0,
      turn: 0.08,
      lean: 0.08,
      freeHand: STAFF_FREE_HAND,
    },
  ],
};

/*
 * The butt of the staff is 1.1 m below the right hand and the chest stands at 1.3 m, so the butt is on the
 * ground when the grip's height is about -0.245 plus how far the hips have dropped.
 */

/**
 * The second hand comes up to join the first, the staff and the knee go up, and both come down at once. The
 * butt lands out past the right foot with the head leaning in, so the shaft never runs between the legs.
 */
const STAFF_SLAM: Attack = {
  keys: [
    // The hand travels to the shaft on its own first, so that taking hold doesn't look like a snap.
    {
      at: 0.1,
      ease: 'smooth',
      grip: [0.26, -0.08, 0.27],
      head: [0.04, 1, 0.05],
      edge: [-0.12, -0.05, 1],
      hips: [0.01, 0.1, 0],
      turn: 0.2,
      hipTurn: 0.08,
      lean: 0.06,
      freeHand: { position: [0.02, -0.02, 0.32], fingers: 0.45 },
    },
    {
      at: 0.22,
      ease: 'smooth',
      oneHand: false,
      grip: [0.22, 0.12, 0.3],
      head: [0.05, 0.98, -0.1],
      edge: [-0.08, 0.1, 1],
      hips: [0.02, 0.09, -0.02],
      turn: 0.3,
      hipTurn: 0.14,
      lean: 0,
      reach: -0.13,
      footL: [-0.13, 0.13, 0.03],
    },
    {
      at: 0.32,
      ease: 'smooth',
      grip: [0.2, 0.38, 0.32],
      head: [0.07, 0.9, -0.42],
      edge: [-0.05, 0.42, 0.9],
      hips: [0.02, 0.07, -0.05],
      turn: 0.38,
      hipTurn: 0.2,
      lean: -0.1,
      footL: [-0.13, 0.2, 0.18],
      toeL: 0.1,
    },
    { at: 0.42, ease: 'hold' },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.23, -0.13, 0.51],
      head: [-0.2, 0.82, 0.44],
      edge: [-0.03, -0.46, 0.82],
      hips: [-0.01, 0.23, 0.16],
      hipTurn: 0.1,
      hipTilt: 0.2,
      turn: 0.5,
      reach: -0.1,
      lean: 0.34,
      footL: [-0.16, 0.42, 0],
      footR: [0.13, -0.07, 0.06],
      toeL: 0.15,
      headFollow: 0.05,
    },
    // The ground stops the staff, so the hands stay while the body sinks onto them.
    { at: 0.62, ease: 'easeOut', grip: [0.23, -0.13, 0.53], head: [-0.2, 0.79, 0.48], edge: [-0.03, -0.5, 0.79], hips: [-0.01, 0.27, 0.18], lean: 0.4 },
    // Rising again, the slowest part: the foot lifts, and the second hand starts to let go.
    {
      at: 0.72,
      ease: 'smooth',
      oneHand: false,
      grip: [0.25, -0.135, 0.48],
      head: [-0.15, 0.84, 0.4],
      edge: [-0.05, -0.4, 0.84],
      reach: -0.13,
      hips: [0, 0.22, 0.135],
      hipTilt: 0.15,
      hipTurn: 0.09,
      turn: 0.42,
      lean: 0.31,
      footL: [-0.16, 0.4, 0.12],
      footR: [0.13, -0.07, 0],
      freeHand: { position: [0.1, -0.05, 0.42], fingers: 0.45 },
    },
    {
      at: 0.84,
      ease: 'smooth',
      oneHand: true,
      grip: [0.27, -0.14, 0.4],
      head: [-0.05, 0.91, 0.27],
      edge: [-0.08, -0.27, 0.91],
      hips: [0, 0.16, 0.08],
      hipTilt: 0.08,
      hipTurn: 0.07,
      turn: 0.26,
      lean: 0.19,
      footL: [-0.13, 0.115, 0.1],
      freeHand: { position: [-0.04, -0.14, 0.28], fingers: 0.42 },
    },
    {
      at: 0.92,
      ease: 'smooth',
      grip: [0.28, -0.135, 0.32],
      head: [-0.01, 0.96, 0.16],
      edge: [-0.12, -0.16, 0.96],
      hips: [0.01, 0.11, 0.04],
      hipTilt: 0.04,
      hipTurn: 0.08,
      turn: 0.2,
      lean: 0.11,
      footL: [-0.13, 0.11, 0],
      toeL: 0.1,
      freeHand: { position: [-0.16, -0.25, 0.2], fingers: 0.4 },
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.29, -0.13, 0.24],
      head: [0.03, 1, 0.05],
      edge: [-0.15, -0.05, 1],
      hips: [0.01, 0.075, 0],
      hipTilt: 0,
      hipTurn: 0.08,
      turn: 0.15,
      lean: 0.05,
      freeHand: STAFF_FREE_HAND,
    },
  ],
};

export const MAGIC_STAFF: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  // The steady run keeps the clip's twist out of the chest, or the long staff would wag across the legs.
  life: { sink: 0.012, shift: 0.016, drift: 0.02, runSteady: 0.8, runHeadLevel: 0.85 },
  stance: { idle: STAFF_IDLE, walk: STAFF_WALK, run: STAFF_RUN },
  attacks: [STAFF_THRUST, STAFF_SLAM],
};

/* Wand and book: a fencer's slightly side-on stance, with the wand low and the book held to read from. */

// Long front to back and narrow, with the hips low enough that the knees track over the toes.
const WAND_FEET = { footR: [0.11, 0.26, 0] as Vec3, footL: [-0.12, -0.26, 0] as Vec3, toeL: 0.7, toeR: 0.1 };
const WAND_IDLE: Pose = {
  grip: [0.3, -0.13, 0.33],
  head: [-0.14, 0.42, 0.9],
  edge: [0, -0.9, 0.42],
  hips: [-0.01, 0.1, 0],
  hipTurn: -0.2,
  turn: -0.28,
  lean: 0.06,
  headFollow: 0,
  headPitch: 0.08,
  ...WAND_FEET,
};
const WAND_WALK: Pose = { grip: [0.29, -0.13, 0.32], head: [-0.12, 0.5, 0.86], edge: [0, -0.86, 0.5], turn: -0.16, lean: 0.05 };
const WAND_RUN: Pose = { grip: [0.28, -0.17, 0.26], head: [-0.05, 0.3, 0.95], edge: [0, -0.95, 0.3], turn: -0.08, lean: 0.58 };

/**
 * The left palm is open under the spine, the forearm level at the bottom of the ribs and out past the body, so
 * that it still shows from behind. The book tips up about 40 degrees and turns in a little, so the pages face
 * the eyes. The axes are the book's: head points across to its left page, edge up its spine.
 */
const BOOK_POSE: ItemPose = { grip: [-0.18, -0.05, 0.31], head: [-0.96, 0, 0.28], edge: [0.21, 0.64, 0.74] };
// The clips pitch the chest forward and these are measured from it, so these lift the book and stand it up to
// keep the pages about 40 degrees toward the face. Measured on the character, not read off these numbers.
const BOOK_WALK: ItemPose = { grip: [-0.18, 0.08, 0.31], head: [-0.96, 0, 0.28], edge: [0.12, 0.95, 0.3] };
const BOOK_RUN: ItemPose = { grip: [-0.18, -0.02, 0.28], head: [-0.96, 0, 0.28], edge: [0.17, 0.72, 0.68] };
const BOOK_RAISED: ItemPose = { grip: [-0.18, -0.02, 0.32], head: [-0.96, 0, 0.28], edge: [0.2, 0.68, 0.7] };
const BOOK_LIFTED: ItemPose = { grip: [-0.19, 0.0, 0.34], head: [-0.96, 0, 0.28], edge: [0.19, 0.72, 0.66] };

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
      footR: [0.11, 0.29, 0.1],
      off: BOOK_RAISED,
    },
    { at: 0.41, ease: 'hold' },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.2, 0.04, 0.6],
      head: [-0.08, 0.02, 1],
      edge: [-0.4, -0.9, 0.02],
      hips: [-0.03, 0.17, 0.14],
      hipTurn: -0.36,
      hipTilt: 0.08,
      turn: -0.56,
      lean: 0.18,
      footR: [0.11, 0.42, 0],
      footL: [-0.12, -0.26, 0.04],
      headFollow: 0,
      off: BOOK_LIFTED,
    },
    // The tip stops close to the target with only a small rebound. The body sinks and the arm drops instead.
    {
      at: 0.68,
      ease: 'easeOut',
      grip: [0.18, -0.07, 0.5],
      head: [-0.28, -0.08, 0.95],
      edge: [-0.25, -0.95, -0.05],
      hips: [-0.04, 0.185, 0.15],
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
      hips: [-0.02, 0.12, 0.06],
      hipTurn: -0.3,
      hipTilt: 0.03,
      turn: -0.44,
      lean: 0.11,
      footR: [0.11, 0.35, 0.1],
      footL: [-0.12, -0.26, 0],
      off: BOOK_POSE,
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.2, -0.08, 0.4],
      head: [-0.5, 0.2, 0.84],
      edge: [-0.3, -0.92, -0.1],
      hips: [-0.01, 0.1, 0.02],
      hipTurn: -0.28,
      turn: -0.42,
      lean: 0.08,
      footR: [0.11, 0.26, 0],
    },
  ],
};

/** Carries on from the last flick: the wrist cocks across the body, then sweeps out the other way. */
const WAND_SWEEP: Attack = {
  keys: [
    {
      at: 0.36,
      ease: 'smooth',
      grip: [0.12, 0.14, 0.44],
      head: [-0.6, 0.5, 0.62],
      edge: [-0.35, -0.85, -0.2],
      hips: [-0.01, 0.1, 0.0],
      hipTurn: -0.36,
      turn: -0.66,
      lean: 0.06,
      footR: [0.11, 0.29, 0.1],
      off: BOOK_RAISED,
    },
    { at: 0.42, ease: 'hold' },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      grip: [0.2, 0.06, 0.5],
      head: [-0.16, 0.08, 0.98],
      edge: [0.42, -0.9, 0.08],
      hips: [0.01, 0.13, 0.11],
      hipTurn: -0.12,
      hipTilt: 0.07,
      turn: -0.14,
      lean: 0.16,
      footR: [0.11, 0.42, 0],
      footL: [-0.12, -0.26, 0.04],
      headFollow: 0,
      off: BOOK_LIFTED,
    },
    {
      at: 0.68,
      ease: 'easeOut',
      grip: [0.5, 0.13, 0.38],
      head: [0.72, 0.24, 0.65],
      edge: [0.55, -0.82, -0.2],
      hips: [0.02, 0.14, 0.1],
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
      hips: [0, 0.11, 0.05],
      hipTurn: -0.12,
      hipTilt: 0.02,
      turn: -0.14,
      lean: 0.1,
      footR: [0.11, 0.35, 0.1],
      footL: [-0.12, -0.26, 0],
      off: BOOK_POSE,
    },
    {
      at: 1,
      ease: 'smooth',
      grip: [0.3, -0.12, 0.33],
      head: [-0.1, 0.42, 0.9],
      edge: [0.03, -0.9, 0.42],
      hips: [-0.01, 0.1, 0],
      hipTurn: -0.2,
      hipTilt: 0,
      turn: -0.27,
      lean: 0.06,
      footR: [0.11, 0.26, 0],
    },
  ],
};

export const WAND_AND_BOOK: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  // The steady run keeps the clip's twist out of the chest, or the book would roll with it from side to side.
  life: { sink: 0.012, shift: 0.022, drift: 0.015, runSteady: 0.8, runHeadLevel: 0.85 },
  stance: { idle: WAND_IDLE, walk: WAND_WALK, run: WAND_RUN },
  offStance: { idle: BOOK_POSE, walk: BOOK_WALK, run: BOOK_RUN },
  attacks: [WAND_FLICK, WAND_SWEEP],
};

/*
 * Quarterstaff: the right hand stays low by the ribs and the left is out ahead of it, up the shaft. The short
 * end behind the right hand runs back under the arm, or out to the right when the staff lies across the front.
 */

/** Knuckles under the shaft, as with any hand held low. */
const under = (head: Vec3): Vec3 => {
  const size = Math.hypot(head[0], head[1], head[2]);
  const [x, y, z] = [head[0] / size, head[1] / size, head[2] / size];
  // The part of "down and slightly in" that's square to the shaft, so the wrist sits above and outside it.
  const dot = -0.4 * x - y;
  return [-0.4 - dot * x, -1 - dot * y, -dot * z];
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
  headPitch: 0.08,
  ...QUARTERSTAFF_FEET,
};
const QUARTERSTAFF_WALK: Pose = { ...staffAt([0.26, -0.2, 0.04], [-0.36, 0.66, 0.66]), reach: -0.5, turn: 0.4, lean: 0.06 };
// Forward and low, because this close to a chest the clip has pitched forward, the elbow rides up beside the head.
const QUARTERSTAFF_RUN: Pose = { ...staffAt([0.26, -0.3, 0.2], [-0.42, 0.8, 0.42]), reach: -0.4, turn: 0.3, lean: 0.14 };

/**
 * Coils left with the striking end trailing behind the left shoulder, then the hips whip it around to the right.
 * It goes this way because a swing from the right would have to pull the short end through the ribs: with the
 * hand in front of the body, the short end is longer than the gap, and here it stays out on the right side.
 */
const QUARTERSTAFF_SIDE: Attack = {
  keys: [
    {
      at: 0.16,
      ease: 'smooth',
      grip: [0.26, -0.1, 0.22],
      head: [-0.62, 0.48, 0.62],
      edge: [0.2, -0.65, 0.73],
      reach: -0.46,
      hips: [-0.02, 0.11, -0.02],
      hipTurn: 0.14,
      turn: 0.16,
      lean: 0.05,
      footL: [-0.11, 0.2, 0],
    },
    {
      at: 0.26,
      ease: 'linear',
      grip: [0.24, -0.08, 0.32],
      head: [-0.9, 0.28, 0.2],
      edge: [0.2, -0.3, 0.92],
      reach: -0.44,
      hips: [-0.03, 0.115, -0.04],
      hipTurn: -0.02,
      turn: -0.1,
      lean: 0.03,
      footL: [-0.11, 0.2, 0.05],
    },
    {
      at: 0.33,
      ease: 'smooth',
      grip: [0.22, -0.06, 0.32],
      head: [-0.84, 0.32, -0.3],
      edge: [0.25, -0.2, 0.95],
      reach: -0.42,
      hips: [-0.04, 0.12, -0.06],
      hipTurn: -0.14,
      turn: -0.34,
      lean: 0.02,
      footL: [-0.11, 0.2, 0.09],
      toeL: 0.05,
    },
    { at: 0.41, ease: 'hold' },
    {
      at: 0.44,
      ease: 'easeIn',
      grip: [0.22, -0.08, 0.33],
      head: [-0.88, 0.3, -0.08],
      edge: [0.2, -0.3, 0.92],
      reach: -0.44,
      hips: [-0.03, 0.13, -0.01],
      hipTurn: 0.06,
      turn: -0.26,
      lean: 0.08,
      footL: [-0.12, 0.27, 0.07],
    },
    // The hips have already gone and the shoulders are only now following.
    {
      at: 0.47,
      ease: 'linear',
      grip: [0.2, -0.1, 0.34],
      head: [-0.62, 0.2, 0.48],
      edge: [0.1, -0.7, 0.68],
      reach: -0.34,
      hips: [-0.01, 0.155, 0.09],
      hipTurn: 0.3,
      turn: 0.1,
      lean: 0.18,
      footL: [-0.12, 0.34, 0.03],
    },
    {
      at: 0.5,
      ease: 'linear',
      impact: true,
      ...staffAt([0.15, -0.12, 0.41], [-0.3, 0.0, 0.95]),
      reach: -0.25,
      hips: [0.01, 0.18, 0.18],
      hipTurn: 0.5,
      hipTilt: 0.12,
      turn: 0.56,
      lean: 0.26,
      footL: [-0.12, 0.44, 0],
      footR: [0.16, -0.2, 0.04],
      toeL: -0.05,
      toeR: 0.8,
    },
    // The weight of the staff drags the shoulders on around, as far as the short end will let it.
    {
      at: 0.64,
      ease: 'easeOut',
      ...staffAt([0.3, -0.14, 0.0], [0.72, -0.05, 0.68]),
      reach: -0.22,
      hips: [0.03, 0.2, 0.16],
      hipTurn: 0.72,
      hipTilt: 0.16,
      turn: 1.1,
      lean: 0.3,
    },
    {
      at: 0.82,
      ease: 'smooth',
      ...staffAt([0.26, -0.1, 0.12], [0.45, 0.22, 0.86]),
      reach: -0.26,
      hips: [0.02, 0.16, 0.08],
      hipTurn: 0.56,
      hipTilt: 0.08,
      turn: 0.92,
      lean: 0.18,
      footR: [0.16, -0.2, 0],
    },
    // The lead foot stays where it landed, and the next attack starts from here.
    {
      at: 1,
      ease: 'smooth',
      ...staffAt([0.22, -0.06, 0.22], [0.12, 0.5, 0.86]),
      reach: -0.32,
      hips: [0.01, 0.14, 0.05],
      hipTurn: 0.4,
      hipTilt: 0.04,
      turn: 0.7,
      lean: 0.13,
    },
  ],
};

/**
 * Carries on from the side strike: the staff wheels up on the right and comes straight down, the hips dropping
 * under it. The knuckles lead the swing by hand all the way over, because the shaft stands straight up on the way,
 * and there "under" has no stable answer.
 */
const QUARTERSTAFF_OVERHEAD: Attack = {
  keys: [
    {
      at: 0.18,
      ease: 'smooth',
      grip: [0.28, 0.1, 0.24],
      head: [0.1, 0.75, 0.6],
      edge: [-0.1, -0.6, 0.75],
      reach: -0.2,
      hips: [0.02, 0.1, 0.0],
      hipTurn: 0.3,
      turn: 0.56,
      lean: 0.02,
      // Up off the ground before it travels, so that it doesn't skate into the wind-up.
      footL: [-0.12, 0.38, 0.12],
    },
    {
      at: 0.32,
      ease: 'smooth',
      grip: [0.34, 0.24, 0.24],
      head: [0.05, 0.72, -0.7],
      edge: [0.17, 0.68, 0.72],
      reach: -0.18,
      hips: [0.04, 0.08, -0.05],
      hipTurn: 0.42,
      turn: 0.62,
      lean: -0.04,
      footL: [-0.12, 0.38, 0.12],
    },
    { at: 0.41, ease: 'hold' },
    {
      at: 0.44,
      ease: 'easeIn',
      grip: [0.34, 0.2, 0.24],
      head: [0.04, 0.9, -0.42],
      edge: [0.17, 0.42, 0.89],
      hips: [0.03, 0.1, -0.01],
      hipTurn: 0.36,
      turn: 0.56,
      lean: -0.02,
    },
    {
      at: 0.47,
      ease: 'linear',
      grip: [0.26, 0.04, 0.3],
      head: [-0.1, 0.8, 0.6],
      edge: [0.05, -0.6, 0.8],
      reach: -0.26,
      hips: [0.01, 0.16, 0.08],
      hipTurn: 0.14,
      turn: 0.46,
      lean: 0.18,
      footL: [-0.12, 0.43, 0.04],
    },
    {
      at: 0.5,
      ease: 'linear',
      impact: true,
      ...staffAt([0.22, -0.14, 0.3], [-0.2, 0.2, 0.96]),
      reach: -0.2,
      hips: [-0.01, 0.24, 0.2],
      hipTurn: 0.02,
      hipTilt: 0.24,
      turn: 0.16,
      lean: 0.42,
      footL: [-0.13, 0.52, 0],
      footR: [0.16, -0.2, 0.05],
      toeL: -0.05,
      headFollow: 0,
    },
    // The staff keeps going down and takes the shoulders with it.
    {
      at: 0.64,
      ease: 'easeOut',
      ...staffAt([0.2, -0.24, 0.25], [-0.18, -0.12, 0.98]),
      reach: -0.22,
      hips: [-0.01, 0.27, 0.22],
      hipTilt: 0.28,
      turn: 0.12,
      lean: 0.5,
    },
    {
      at: 0.84,
      ease: 'smooth',
      ...staffAt([0.24, -0.26, 0.09], [-0.26, 0.14, 0.95]),
      reach: -0.36,
      hips: [0, 0.2, 0.1],
      hipTurn: 0.14,
      hipTilt: 0.12,
      turn: 0.3,
      lean: 0.26,
      // A real step back, up off the ground and finished early, so that the planted foot doesn't skate.
      footL: [-0.12, 0.38, 0.12],
      footR: [0.16, -0.2, 0],
    },
    {
      at: 0.92,
      ease: 'smooth',
      ...staffAt([0.255, -0.24, 0], [-0.2, 0.17, 0.96]),
      reach: -0.5,
      hips: [0.005, 0.18, 0.075],
      hipTurn: 0.22,
      hipTilt: 0.09,
      turn: 0.4,
      lean: 0.2,
      footL: [-0.12, 0.36, 0],
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
    },
  ],
};

/** The right hand draws the shaft back through the left, then drives it through for all the reach it has. */
const QUARTERSTAFF_POKE: Attack = {
  keys: [
    // The shoulders and hips do the drawing, and the front foot stays down until the last moment.
    {
      at: 0.22,
      ease: 'smooth',
      ...staffAt([0.28, -0.22, -0.08], [-0.14, 0.12, 0.98]),
      reach: -0.5,
      hips: [0.03, 0.16, -0.06],
      hipTurn: 0.5,
      turn: 0.8,
      lean: 0.08,
      headFollow: 0,
      footL: [-0.12, 0.36, 0],
    },
    {
      at: 0.34,
      ease: 'smooth',
      ...staffAt([0.3, -0.25, -0.18], [-0.3, 0.16, 0.94]),
      reach: -0.5,
      hips: [0.04, 0.2, -0.16],
      hipTurn: 0.74,
      turn: 1.15,
      lean: 0.08,
      footL: [-0.12, 0.38, 0.1],
      toeL: 0.05,
    },
    { at: 0.42, ease: 'hold' },
    {
      at: 0.5,
      ease: 'easeIn',
      impact: true,
      ...staffAt([0.24, -0.1, 0.44], [-0.1, 0.05, 0.99]),
      reach: -0.14,
      hips: [0, 0.2, 0.24],
      hipTurn: 0.2,
      hipTilt: 0.16,
      turn: 0.5,
      lean: 0.32,
      footL: [-0.13, 0.54, 0],
      footR: [0.16, -0.2, 0.06],
      toeL: -0.1,
      headFollow: 0,
    },
    { at: 0.62, ease: 'easeOut', ...staffAt([0.23, -0.14, 0.45], [-0.1, 0.0, 0.99]), reach: -0.12, hips: [0, 0.22, 0.3], lean: 0.38, turn: 0.5 },
    // Draws the shaft back through the lead hand. The front foot lifts, comes home and lands well before the end.
    {
      at: 0.74,
      ease: 'smooth',
      ...staffAt([0.24, -0.16, 0.28], [-0.18, 0.13, 0.94]),
      reach: -0.24,
      hips: [0.003, 0.185, 0.19],
      hipTurn: 0.26,
      hipTilt: 0.1,
      turn: 0.54,
      lean: 0.27,
      footL: [-0.13, 0.52, 0.12],
      footR: [0.16, -0.2, 0],
    },
    {
      at: 0.86,
      ease: 'smooth',
      ...staffAt([0.25, -0.18, 0.16], [-0.27, 0.25, 0.89]),
      reach: -0.36,
      hips: [0.006, 0.15, 0.1],
      hipTurn: 0.3,
      hipTilt: 0.06,
      turn: 0.52,
      lean: 0.18,
      footL: [-0.11, 0.21, 0.1],
    },
    {
      at: 0.92,
      ease: 'smooth',
      ...staffAt([0.255, -0.19, 0.09], [-0.31, 0.32, 0.87]),
      reach: -0.42,
      hips: [0.008, 0.13, 0.05],
      hipTurn: 0.32,
      hipTilt: 0.03,
      turn: 0.51,
      lean: 0.13,
      footL: [-0.11, 0.2, 0],
      toeL: -0.15,
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
    },
  ],
};

export const QUARTERSTAFF: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  // The steady run keeps the clip's twist out of the chest, or this long a shaft would sweep across the body.
  life: { sink: 0.012, shift: 0.025, drift: 0.02, runSteady: 0.8, runHeadLevel: 0.85 },
  stance: { idle: QUARTERSTAFF_IDLE, walk: QUARTERSTAFF_WALK, run: QUARTERSTAFF_RUN },
  attacks: [QUARTERSTAFF_SIDE, QUARTERSTAFF_OVERHEAD, QUARTERSTAFF_POKE],
};
