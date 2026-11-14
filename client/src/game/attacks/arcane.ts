import type { Attack, AttackKey, CriticalMoves, ItemPose, Pose, Vec3, WeaponMoves } from './types';

/*
 * The arcanist's three weapons. The list order matches shared/combat.ts. Hit times: all three land at 0.5.
 * Lengths: staff 1.5 s, wand 0.55 s, quarterstaff 0.8 s. The staff is a long cast, so its keys play slowly.
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


/** The part of `ref` square to `head`, for knuckles that keep pointing one way while the item turns. */
const square = (head: Vec3, ref: Vec3): Vec3 => {
  const size = Math.hypot(head[0], head[1], head[2]);
  const [x, y, z] = [head[0] / size, head[1] / size, head[2] / size];
  const dot = ref[0] * x + ref[1] * y + ref[2] * z;
  return [ref[0] - dot * x, ref[1] - dot * y, ref[2] - dot * z];
};

/*
 * MAGIC STAFF CRITICAL (2.8 s, impact 0.6). The caster rises off the ground with the staff held level overhead,
 * the spell gathering above, then hurls the staff down to point at the boss and drops into a kneel on it.
 *   0.00-0.10  knees load, the free hand rises open beside the staff.
 *   0.20       'rise': the free hand takes the shaft, the body starts to lift (rootPath up 0.5 m by 0.35).
 *   0.20-0.30  the staff swings up to lie level overhead in both hands, the head tips back, the feet hang together.
 *   0.35       'gather': fully up, arms high, energy collecting above the staff. Held, breathing, to 0.55.
 *   0.55-0.60  the staff is hurled down to point at the target as the body snaps forward.
 *   0.60       'burst' (impact): staff level at the boss, still 0.42 m up.
 *   0.69       'land': the drop ends, feet hit the ground split for the kneel.
 *   0.76-0.86  kneeling on the right knee, leaning on the planted staff.
 *   0.86-1.00  stands, back foot then front foot step home to the idle stance.
 */
const STAFF_OVERHEAD = { grip: [0.28, 0.56, 0.05] as Vec3, head: [1, 0.02, 0.04] as Vec3, edge: [0, 0.3, 0.95] as Vec3 };
// Lifted heels with the toes still 'planted' on the risen root: legs hang nearly straight, toes pointing down.
const STAFF_DANGLE = { footL: [-0.08, 0.02, 0.07] as Vec3, footR: [0.08, 0.06, 0.08] as Vec3, toeL: 0, toeR: 0.05 };
const STAFF_CRITICAL: CriticalMoves = {
  travel: 0,
  marks: { rise: 0.2, gather: 0.35, burst: 0.6, land: 0.69 },
  rootPath: [
    { at: 0.2, forward: 0, up: 0 },
    { at: 0.35, forward: 0, up: 0.5, ease: 'easeOut' },
    { at: 0.55, forward: 0, up: 0.47 },
    { at: 0.6, forward: 0, up: 0.42 },
    { at: 0.69, forward: 0, up: 0, ease: 'easeIn' },
  ],
  keys: [
    // Commit: the knees load and the open hand comes up beside the staff.
    {
      at: 0.1,
      ease: 'smooth',
      grip: [0.28, -0.1, 0.24],
      head: [0.03, 1, 0.04],
      edge: [-0.15, -0.05, 1],
      hips: [0, 0.16, 0],
      hipTurn: 0.1,
      turn: 0.22,
      lean: 0.1,
      headPitch: 0,
      freeHand: { position: [-0.3, 0.12, 0.28], fingers: 0 },
    },
    // 'rise': both hands on the shaft, the left below the right.
    {
      at: 0.2,
      ease: 'smooth',
      oneHand: false,
      grip: [0.24, 0.12, 0.26],
      head: [0.08, 1, 0.02],
      edge: [-0.1, -0.02, 1],
      reach: 0.16,
      hips: [0, 0.12, 0],
      hipTurn: 0.08,
      turn: 0.28,
      lean: 0,
      headPitch: -0.1,
    },
    // Lifting: the staff swings level overhead, the feet leave the ground and hang together.
    {
      at: 0.3,
      ease: 'smooth',
      grip: [0.28, 0.5, 0.08],
      head: [0.96, 0.25, 0.05],
      edge: [0, 0.2, 1],
      reach: 0.5,
      hips: [0, 0.04, -0.02],
      hipTurn: 0,
      hipTilt: -0.05,
      turn: 0.04,
      lean: -0.18,
      headPitch: -0.3,
      headFollow: 0,
      ...STAFF_DANGLE,
    },
    // 'gather': fully up and arched back under the staff. The hold breathes and trembles a little.
    { at: 0.35, ease: 'easeOut', ...STAFF_OVERHEAD, reach: 0.55, hips: [0, 0.03, -0.03], hipTilt: -0.08, turn: 0, lean: -0.26, headPitch: -0.38 },
    { at: 0.45, ease: 'smooth', grip: [0.285, 0.58, 0.04], head: [1, 0, 0.05], hips: [0, 0.035, -0.035], lean: -0.29, headPitch: -0.4 },
    { at: 0.55, ease: 'smooth', grip: [0.275, 0.59, 0.03], head: [1, 0.03, 0.03], hips: [0, 0.03, -0.04], lean: -0.31, headPitch: -0.4 },
    // 'burst': hurled down to point at the boss, the body snapping forward over it.
    {
      at: 0.6,
      ease: 'easeIn',
      impact: true,
      grip: [0.2, 0.02, 0.5],
      head: [-0.16, 0.2, 0.97],
      edge: [-0.1, -0.97, 0.2],
      reach: 0.3,
      hips: [0, 0.1, 0.08],
      hipTilt: 0.18,
      hipTurn: 0.1,
      turn: 0.22,
      lean: 0.42,
      headPitch: -0.1,
      footL: [-0.1, 0.12, 0.08],
      footR: [0.1, -0.06, 0.1],
    },
    // Still falling: the staff's weight carries the tip on down and the legs reach for the ground, split.
    {
      at: 0.65,
      ease: 'easeOut',
      grip: [0.22, -0.04, 0.48],
      head: [-0.16, 0.02, 0.99],
      edge: [-0.1, -0.99, 0.02],
      hips: [0, 0.14, 0.06],
      lean: 0.4,
      footL: [-0.13, 0.26, 0.12],
      footR: [0.13, -0.24, 0.14],
    },
    // 'land': the shock goes into the legs, and the free hand lets go to swing the staff upright.
    {
      at: 0.69,
      ease: 'easeIn',
      oneHand: true,
      grip: [0.28, 0.1, 0.4],
      head: [-0.05, 0.85, 0.5],
      edge: [-0.1, -0.5, 0.85],
      hips: [0, 0.32, 0.05],
      hipTilt: 0.12,
      turn: 0.18,
      lean: 0.32,
      headPitch: 0,
      footL: [-0.13, 0.28, 0],
      footR: [0.13, -0.3, 0.07],
      toeL: 0.1,
      toeR: 0.2,
      freeHand: { position: [-0.24, -0.3, 0.3], fingers: 0.3 },
    },
    // Down on the right knee, the staff planted ahead of it, the left hand on the left knee.
    {
      at: 0.76,
      ease: 'easeOut',
      grip: [0.3, 0.25, 0.32],
      head: [-0.05, 1, 0.08],
      edge: [-0.15, -0.08, 1],
      hips: [0, 0.45, 0.02],
      hipTilt: 0.15,
      turn: 0.14,
      lean: 0.34,
      headPitch: -0.12,
      freeHand: { position: [-0.17, -0.42, 0.3], fingers: 0.5 },
    },
    { at: 0.86, ease: 'smooth', grip: [0.3, 0.23, 0.31], hips: [0, 0.44, 0.03], lean: 0.32 },
    // Stands up on the staff, and the back foot steps home first.
    {
      at: 0.92,
      ease: 'smooth',
      grip: [0.3, 0.0, 0.27],
      head: [0, 1, 0.06],
      hips: [0, 0.2, 0.02],
      hipTilt: 0.05,
      turn: 0.14,
      lean: 0.14,
      headPitch: 0.04,
      footR: [0.13, -0.1, 0.1],
      freeHand: { position: [-0.22, -0.44, 0.08], fingers: 0.4 },
    },
    {
      at: 0.96,
      ease: 'smooth',
      grip: [0.3, -0.1, 0.24],
      hips: [0, 0.12, 0.01],
      lean: 0.07,
      footR: [0.13, -0.07, 0],
      footL: [-0.13, 0.16, 0.08],
    },
    { at: 1, ease: 'smooth', ...STAFF_IDLE, hipTilt: 0, headFollow: 0.2 },
  ],
};

export const MAGIC_STAFF: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  // The steady run keeps the clip's twist out of the chest, or the long staff would wag across the legs.
  life: { sink: 0.012, shift: 0.016, drift: 0.02, runSteady: 0.8, runHeadLevel: 0.85 },
  stance: { idle: STAFF_IDLE, walk: STAFF_WALK, run: STAFF_RUN },
  attacks: [STAFF_THRUST, STAFF_SLAM],
  critical: STAFF_CRITICAL,
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


/*
 * WAND AND TOME CRITICAL (2.8 s, impact 0.6). The tome comes up open in front of the chest, the wand draws a
 * wide circle in the air before it, is drawn back, then stabs through the circle's middle.
 *   0.00-0.10  knees load, the tome starts up, the wand dips and draws in.
 *   0.20       'book': the tome is up and wide open in front of the chest, left of center.
 *   0.22-0.46  'circle': the wand tip draws one full clockwise circle (caster's view), center about 0.29 above
 *              the chest and 0.42 ahead (tip circle about 0.9 m across), starting and ending at the top.
 *   0.46-0.55  drawn back to the right cheek, aimed at the circle's middle, held with a slight tremble.
 *   0.55-0.60  the stab, the front foot landing a long step in.
 *   0.60       'burst' (impact): arm out through the circle's center, tip at the boss.
 *   0.75       'close': the tome drops back to the reading hand (the open-book model can't fold; effects close it).
 *   0.75-1.00  the front foot steps home and the body settles to the fencer's stance.
 */
const WAND_CIRCLE = { center: [0.1, 0.29, 0.42] as Vec3, radius: 0.19 };
const wandOnCircle = (degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  const head: Vec3 = [0.55 * Math.sin(a), 0.3 + 0.55 * Math.cos(a), 1];
  return {
    grip: [WAND_CIRCLE.center[0] + WAND_CIRCLE.radius * Math.sin(a), WAND_CIRCLE.center[1] + WAND_CIRCLE.radius * Math.cos(a), WAND_CIRCLE.center[2]] as Vec3,
    head,
    edge: square(head, [0, -1, 0]),
  };
};
const BOOK_OPEN: ItemPose = { grip: [-0.2, 0.08, 0.35], head: [-0.98, 0, 0.18], edge: [0.12, 0.6, 0.79] };
const WAND_CIRCLE_KEYS: AttackKey[] = Array.from({ length: 8 }, (_, k) => ({
  at: Math.round((0.25 + k * 0.03) * 100) / 100,
  ease: 'linear' as const,
  ...wandOnCircle((k + 1) * 45),
  // The shoulders breathe with the circle, a touch further round at its far side.
  turn: -0.3 - 0.04 * Math.sin(((k + 1) * Math.PI) / 4),
}));
const WAND_CRITICAL: CriticalMoves = {
  travel: 0,
  marks: { book: 0.2, circle: 0.22, burst: 0.6, close: 0.75 },
  keys: [
    {
      at: 0.1,
      ease: 'smooth',
      grip: [0.28, -0.08, 0.26],
      head: [0, 0.5, 0.86],
      edge: [0, -0.86, 0.5],
      hips: [-0.01, 0.13, -0.01],
      hipTurn: -0.18,
      turn: -0.26,
      lean: 0.04,
      off: { grip: [-0.19, 0.0, 0.33], head: [-0.97, 0, 0.24], edge: [0.18, 0.62, 0.76] },
    },
    // 'book': up and open in front of the chest; the wand rises to just short of the circle's top.
    {
      at: 0.2,
      ease: 'smooth',
      ...wandOnCircle(-30),
      hips: [-0.01, 0.12, 0.04],
      hipTurn: -0.2,
      turn: -0.3,
      lean: 0.08,
      headPitch: 0,
      off: BOOK_OPEN,
    },
    { at: 0.22, ease: 'smooth', ...wandOnCircle(0) },
    // 'circle': one full turn, at an even speed.
    ...WAND_CIRCLE_KEYS,
    // Drawn back to the cheek and aimed through the middle; the front foot comes up to step.
    {
      at: 0.5,
      ease: 'smooth',
      grip: [0.22, 0.3, 0.2],
      head: [-0.06, 0.12, 1],
      edge: [0, -1, 0.12],
      hips: [0, 0.12, -0.04],
      hipTurn: -0.12,
      turn: -0.16,
      lean: 0.02,
      footR: [0.11, 0.29, 0.1],
      off: { grip: [-0.2, 0.1, 0.36], head: [-0.98, 0, 0.18], edge: [0.12, 0.62, 0.78] },
    },
    { at: 0.55, ease: 'smooth', grip: [0.225, 0.31, 0.19], head: [-0.06, 0.13, 1], hips: [0, 0.125, -0.05], turn: -0.15, footR: [0.11, 0.3, 0.1] },
    // 'burst': the stab through the circle's middle, the long step landing.
    {
      at: 0.6,
      ease: 'easeIn',
      impact: true,
      grip: [0.14, 0.24, 0.56],
      head: [-0.06, 0.12, 1],
      edge: [-0.1, -1, 0.12],
      hips: [-0.03, 0.18, 0.15],
      hipTurn: -0.36,
      hipTilt: 0.08,
      turn: -0.6,
      lean: 0.2,
      footR: [0.11, 0.44, 0],
      footL: [-0.12, -0.26, 0.05],
      headFollow: 0,
      off: { grip: [-0.22, 0.06, 0.34], head: [-0.98, 0, 0.18], edge: [0.12, 0.6, 0.79] },
    },
    // The arm stays out, sinking a little, while the spell goes.
    { at: 0.7, ease: 'easeOut', grip: [0.13, 0.18, 0.55], head: [-0.08, 0.04, 1], edge: [-0.1, -1, 0.04], hips: [-0.04, 0.2, 0.17], lean: 0.24, turn: -0.62 },
    // 'close': the tome snaps back down into the reading hand.
    { at: 0.75, ease: 'easeIn', off: BOOK_POSE, grip: [0.15, 0.12, 0.53], head: [-0.15, 0.06, 0.99], edge: [-0.1, -0.99, 0.06] },
    {
      at: 0.85,
      ease: 'smooth',
      grip: [0.22, -0.06, 0.42],
      head: [-0.3, 0.25, 0.92],
      edge: [-0.2, -0.95, 0.15],
      hips: [-0.02, 0.13, 0.06],
      hipTurn: -0.3,
      hipTilt: 0.03,
      turn: -0.44,
      lean: 0.12,
      footR: [0.11, 0.35, 0.1],
      footL: [-0.12, -0.26, 0],
    },
    {
      at: 0.93,
      ease: 'smooth',
      grip: [0.28, -0.11, 0.36],
      head: [-0.18, 0.4, 0.9],
      edge: [0, -0.9, 0.4],
      hips: [-0.01, 0.11, 0.01],
      hipTurn: -0.22,
      hipTilt: 0,
      turn: -0.3,
      lean: 0.07,
      footR: [0.11, 0.26, 0],
    },
    { at: 1, ease: 'smooth', ...WAND_IDLE },
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
  critical: WAND_CRITICAL,
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


/*
 * QUARTERSTAFF CRITICAL (2.8 s, impact 0.6). Two propeller spins in front, caught and drawn back side-on like a
 * spear, then a two-handed thrust that throws the caster back on the recoil.
 *   0.00-0.20  knees load, the staff comes up in front, the lead hand lets go.
 *   0.20       'spin': the right hand spins the staff in the plane in front of the chest, clockwise from the
 *              caster's view, a quarter turn every 0.03 (two full turns by 0.44). The free hand crosses over the
 *              right forearm and back each half turn.
 *   0.47       'catch': both hands on it, drawn back side-on like a spear, front foot up. Held, trembling, to 0.55.
 *   0.55-0.60  the thrust, hips first, the front foot landing a long step in.
 *   0.60       'burst' (impact): arms out, the staff's tip at the boss.
 *   0.60-0.68  recoil: the whole body skids 0.6 m back (rootPath), the staff kicking up.
 *   0.72-0.95  two shuffle steps forward bring it back to where it started (rootPath back to 0); the idle stance by 1.
 */
const SPIN_CENTER: Vec3 = [0.2, 0.3, 0.34];
const spinAt = (degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  const head: Vec3 = [Math.sin(a), Math.cos(a), 0.15];
  return { grip: SPIN_CENTER, head, edge: square(head, [0, 0, 1]) };
};
const SPIN_KEYS: AttackKey[] = Array.from({ length: 8 }, (_, k) => ({
  at: Math.round((0.23 + k * 0.03) * 100) / 100,
  ease: 'linear' as const,
  ...spinAt((k + 1) * 90),
  // Every half turn the free hand crosses over the right forearm and back.
  freeHand: { position: (k % 2 === 0 ? [0.08, 0.4, 0.26] : [-0.36, 0.16, 0.24]) as Vec3, fingers: 0.1 },
  hipTurn: 0.1 + (k % 2 === 0 ? 0.04 : -0.04),
}));
const QUARTERSTAFF_CRITICAL: CriticalMoves = {
  travel: 0,
  marks: { spin: 0.2, catch: 0.47, burst: 0.6 },
  rootPath: [
    { at: 0.6, forward: 0 },
    { at: 0.68, forward: -0.6, ease: 'easeOut' },
    { at: 0.72, forward: -0.6 },
    { at: 0.83, forward: -0.3 },
    { at: 0.95, forward: 0 },
  ],
  keys: [
    {
      at: 0.1,
      ease: 'smooth',
      ...staffAt([0.22, -0.05, 0.18], [-0.35, 0.8, 0.45]),
      reach: -0.3,
      hips: [0.01, 0.13, 0],
      hipTurn: 0.24,
      turn: 0.3,
      lean: 0.04,
    },
    // 'spin': the lead hand lets go, the staff stands up in front of the chest.
    {
      at: 0.2,
      ease: 'smooth',
      oneHand: true,
      ...spinAt(0),
      hips: [0.01, 0.08, 0],
      hipTurn: 0.1,
      turn: 0.06,
      lean: 0,
      headPitch: 0.04,
      freeHand: { position: [-0.36, 0.16, 0.24], fingers: 0.1 },
    },
    ...SPIN_KEYS,
    // 'catch': both hands on it, drawn back side-on like a spear, the front foot up.
    {
      at: 0.47,
      ease: 'smooth',
      oneHand: false,
      ...staffAt([0.3, -0.22, -0.16], [-0.3, 0.2, 0.93]),
      reach: -0.5,
      hips: [0.04, 0.18, -0.14],
      hipTurn: 0.7,
      turn: 1.1,
      lean: 0.06,
      headPitch: 0.08,
      footL: [-0.12, 0.3, 0.1],
      toeL: 0.05,
    },
    { at: 0.51, ease: 'smooth', ...staffAt([0.3, -0.24, -0.18], [-0.3, 0.17, 0.94]), hips: [0.04, 0.2, -0.16], hipTurn: 0.74, turn: 1.15, footL: [-0.12, 0.32, 0.11] },
    { at: 0.55, ease: 'smooth', ...staffAt([0.305, -0.25, -0.19], [-0.31, 0.16, 0.94]), hips: [0.045, 0.2, -0.165], turn: 1.17, footL: [-0.12, 0.33, 0.1] },
    // 'burst': driven straight out with both hands, hips first, the front foot landing well ahead.
    {
      at: 0.6,
      ease: 'easeIn',
      impact: true,
      ...staffAt([0.24, -0.08, 0.44], [-0.1, 0.12, 0.99]),
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
    // Recoil: thrown back 0.6 m, the staff kicking up and the chest rocking back.
    {
      at: 0.68,
      ease: 'easeOut',
      ...staffAt([0.25, -0.04, 0.34], [-0.12, 0.42, 0.9]),
      reach: -0.2,
      hips: [0.01, 0.22, 0.12],
      hipTilt: 0.08,
      turn: 0.52,
      lean: 0.14,
      footR: [0.16, -0.2, 0],
    },
    // Shuffle 1 (root -0.6 to -0.3): the left foot stays on the ground, the right steps up beside it.
    { at: 0.72, ease: 'smooth', hips: [0.01, 0.2, 0.1], lean: 0.16, footL: [-0.13, 0.54, 0], footR: [0.16, -0.2, 0] },
    { at: 0.775, ease: 'smooth', footL: [-0.12, 0.39, 0], footR: [0.15, -0.05, 0.12] },
    {
      at: 0.83,
      ease: 'smooth',
      ...staffAt([0.25, -0.16, 0.12], [-0.3, 0.32, 0.9]),
      reach: -0.4,
      hips: [0.01, 0.15, 0.05],
      hipTilt: 0.03,
      hipTurn: 0.3,
      turn: 0.5,
      lean: 0.1,
      footL: [-0.11, 0.24, 0],
      footR: [0.16, 0.1, 0],
    },
    // Shuffle 2 (root -0.3 to 0): the right foot stays on the ground, the left steps on to its place.
    { at: 0.89, ease: 'smooth', footL: [-0.11, 0.22, 0.12], footR: [0.16, -0.05, 0] },
    { at: 0.95, ease: 'smooth', ...staffAt([0.26, -0.2, 0.04], [-0.36, 0.4, 0.84]), reach: -0.5, hips: [0.01, 0.11, 0], hipTilt: 0, footL: [-0.11, 0.2, 0], footR: [0.16, -0.2, 0], toeL: -0.15 },
    { at: 1, ease: 'smooth', ...QUARTERSTAFF_IDLE },
  ],
};

export const QUARTERSTAFF: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  // The steady run keeps the clip's twist out of the chest, or this long a shaft would sweep across the body.
  life: { sink: 0.012, shift: 0.025, drift: 0.02, runSteady: 0.8, runHeadLevel: 0.85 },
  stance: { idle: QUARTERSTAFF_IDLE, walk: QUARTERSTAFF_WALK, run: QUARTERSTAFF_RUN },
  attacks: [QUARTERSTAFF_SIDE, QUARTERSTAFF_OVERHEAD, QUARTERSTAFF_POKE],
  critical: QUARTERSTAFF_CRITICAL,
};
