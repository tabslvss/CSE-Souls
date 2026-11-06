import type { AttackKey, ItemPose, Pose, Vec3, WeaponMoves } from './types';

/*
 * Mace and shield: a compact, shield-first fighter. The left shoulder sits behind the shield with the
 * left foot forward, and the mace waits cocked by the right shoulder. The shield stays up through both
 * attacks and only opens a little as the mace comes through, the way a real guard gives room to the swing.
 */

const FOOT_L: Vec3 = [-0.16, 0.2, 0];
const FOOT_R: Vec3 = [0.17, -0.18, 0.015];

const MACE_IDLE: Pose = {
  grip: [0.29, -0.1, 0.1],
  head: [0.12, 0.85, -0.4],
  edge: [0, 0.4, 0.85],
  hips: [0, 0.1, 0.01],
  hipTurn: 0.22,
  hipTilt: 0.08,
  turn: 0.32,
  lean: 0.12,
  headFollow: 0,
  footL: FOOT_L,
  footR: FOOT_R,
  toeL: 0.1,
  toeR: 0.5,
};

const MACE_WALK: Pose = {
  grip: [0.29, -0.12, 0.1],
  head: [0.12, 0.85, -0.4],
  edge: [0, 0.4, 0.85],
  hips: [0, 0.05, 0.01],
  turn: 0.22,
  lean: 0.1,
  headFollow: 0,
};

const MACE_RUN: Pose = {
  grip: [0.3, -0.2, 0.08],
  head: [0.2, 0.8, -0.45],
  edge: [0, 0.45, 0.8],
  hips: [0, 0.05, 0.03],
  turn: 0.12,
  lean: 0.2,
  headFollow: 0,
};

/** Forearm across the body, the shield's face turned out to the front, the eyes just over its rim. */
const SHIELD_GUARD: ItemPose = { grip: [-0.14, -0.12, 0.34], head: [0, 1, 0.05], edge: [0.85, 0, 0.5] };
/** Tipped back a little against the walk's lean, and clear of the front thigh. */
const SHIELD_WALK: ItemPose = { grip: [-0.14, -0.1, 0.36], head: [0, 0.95, -0.3], edge: [0.85, 0, 0.5] };
/** Tipped back against the run's forward lean, so that the shield stays a wall and not a tray. */
const SHIELD_RUN: ItemPose = { grip: [-0.2, -0.12, 0.26], head: [0, 0.88, -0.48], edge: [0.7, 0, 0.7] };
/** Pushed forward with the left shoulder as the body coils behind it. */
const SHIELD_COIL: ItemPose = { grip: [-0.07, -0.1, 0.38], head: [0, 1, 0.08], edge: [0.8, 0, 0.6] };
/** Opened a little to the left, as the mace comes through. Still a guard, so the chest stays half covered. */
const SHIELD_OPEN: ItemPose = { grip: [-0.25, -0.13, 0.3], head: [-0.05, 1, 0.05], edge: [0.68, 0, 0.73] };
/** Drawn back further when the hook carries the mace all the way across, so the two don't meet. */
const SHIELD_WIDE: ItemPose = { grip: [-0.4, -0.12, 0.08], head: [-0.08, 1, 0], edge: [0.45, 0, 0.89] };

/** Where the chop ends and the hook begins: mace back by the right shoulder, body still turned to the left foot. */
const LINK: AttackKey = {
  at: 1,
  grip: [0.32, -0.1, 0.12],
  head: [0.35, 0.8, -0.45],
  edge: [0.15, 0.45, 0.85],
  turn: 0.3,
  hipTurn: 0.2,
  lean: 0.14,
  hipTilt: 0.08,
  hips: [0.01, 0.11, 0.02],
  footL: FOOT_L,
  footR: FOOT_R,
  toeL: 0.1,
  toeR: 0.5,
  off: SHIELD_GUARD,
};

/** Overhand downward chop, a little to the mace's side so it stays in view past the body. Weight rocks back and the front foot goes light, then the hips fire first and the shoulder comes over them as the foot stamps. */
const CHOP: AttackKey[] = [
  { at: 0.12, grip: [0.31, 0.02, 0.03], head: [0.14, 0.72, -0.68], edge: [0, 0.68, 0.72],
    turn: 0.46, hipTurn: 0.3, lean: 0.06, hips: [0.02, 0.11, -0.02], off: SHIELD_GUARD },
  { at: 0.26, grip: [0.29, 0.34, -0.05], head: [0.12, 0.48, -0.87], edge: [0, 0.87, 0.48],
    turn: 0.7, hipTurn: 0.4, lean: -0.1, hipTilt: -0.04, hips: [0.05, 0.08, -0.08],
    footL: [-0.16, 0.2, 0.06], footR: [0.17, -0.18, 0], off: SHIELD_COIL },
  // The hold at the top. The hips have already begun to turn back while the shoulders wait.
  { at: 0.31, ease: 'linear', grip: [0.29, 0.36, -0.04], head: [0.1, 0.56, -0.82], edge: [0, 0.82, 0.56],
    turn: 0.72, hipTurn: 0.3, hips: [0.04, 0.08, -0.06], footL: [-0.16, 0.23, 0.11], off: SHIELD_COIL },
  { at: 0.37, ease: 'linear', grip: [0.22, 0.18, 0.3], head: [0.03, 0.82, 0.57], edge: [0, -0.57, 0.82],
    turn: 0.26, hipTurn: -0.04, lean: 0.2, hipTilt: 0.08, hips: [0, 0.16, 0.09],
    footL: [-0.17, 0.29, 0.05], footR: [0.18, -0.18, 0.04] },
  { at: 0.42, ease: 'easeIn', impact: true, grip: [0.2, -0.13, 0.5], head: [0.05, -0.1, 0.99], edge: [0, -1, -0.1],
    turn: -0.24, hipTurn: -0.18, lean: 0.46, hipTilt: 0.2, hips: [-0.03, 0.22, 0.17],
    footL: [-0.17, 0.3, 0], footR: [0.18, -0.18, 0.07], toeR: 0.4, off: SHIELD_OPEN },
  { at: 0.5, ease: 'easeOut', grip: [0.17, -0.32, 0.4], head: [0, -0.68, 0.73], edge: [0, -0.73, -0.68],
    turn: -0.36, hipTurn: -0.2, lean: 0.56, hipTilt: 0.24, hips: [-0.04, 0.26, 0.2] },
  { at: 0.66, grip: [0.19, -0.32, 0.34], head: [0.04, -0.78, 0.62], edge: [0, -0.62, -0.78],
    turn: -0.28, hipTurn: -0.16, lean: 0.5, hipTilt: 0.2, hips: [-0.03, 0.24, 0.17] },
  // The recovery is a real small step back, so the front foot lifts instead of sliding home.
  { at: 0.84, grip: [0.24, -0.1, 0.3], head: [0.18, 0.75, 0.62], edge: [0, -0.62, 0.75],
    turn: 0.06, hipTurn: 0.04, lean: 0.26, hipTilt: 0.12, hips: [-0.01, 0.15, 0.08],
    footL: [-0.165, 0.25, 0.09], footR: [0.175, -0.18, 0.03], toeR: 0.45, off: SHIELD_GUARD },
  LINK,
];

/** Sideways hook from right to left, in a plane that falls slightly. The hips drive it around and the hand comes before the mace head. */
const HOOK: AttackKey[] = [
  { at: 0.14, grip: [0.36, -0.02, 0.05], head: [0.5, 0.62, -0.6], edge: [0.5, 0.2, 0.84],
    turn: 0.56, hipTurn: 0.34, lean: 0.1, hips: [0.04, 0.11, -0.02], off: SHIELD_GUARD },
  { at: 0.26, grip: [0.42, 0.06, -0.04], head: [0.72, 0.35, -0.6], edge: [0.6, 0, 0.8],
    turn: 0.82, hipTurn: 0.46, lean: 0.06, hips: [0.07, 0.11, -0.05],
    footL: [-0.16, 0.2, 0.06], footR: [0.17, -0.18, 0], off: SHIELD_COIL },
  { at: 0.32, ease: 'linear', grip: [0.43, 0.06, -0.02], head: [0.78, 0.3, -0.55], edge: [0.55, 0, 0.83],
    turn: 0.84, hipTurn: 0.36, hips: [0.06, 0.11, -0.04], footL: [-0.17, 0.23, 0.11], off: SHIELD_COIL },
  { at: 0.375, ease: 'linear', grip: [0.4, 0, 0.28], head: [0.72, 0.17, 0.67], edge: [-0.67, 0, 0.74],
    turn: 0.34, hipTurn: 0.04, lean: 0.16, hipTilt: 0.06, hips: [0.01, 0.15, 0.05],
    footL: [-0.19, 0.28, 0.05], footR: [0.17, -0.18, 0.04], toeR: 0.4 },
  { at: 0.42, ease: 'easeIn', impact: true, grip: [0.2, -0.1, 0.5], head: [-0.05, 0.06, 1], edge: [-1, -0.05, -0.05],
    turn: -0.3, hipTurn: -0.24, lean: 0.24, hipTilt: 0.12, hips: [-0.05, 0.18, 0.13],
    footL: [-0.2, 0.3, 0], footR: [0.17, -0.18, 0.07], toeL: 0.2, toeR: 0.3, off: SHIELD_OPEN },
  { at: 0.52, ease: 'easeOut', grip: [-0.06, -0.14, 0.5], head: [-0.8, -0.1, 0.6], edge: [-0.6, -0.05, -0.8],
    turn: -0.78, hipTurn: -0.48, lean: 0.28, hipTilt: 0.14, hips: [-0.09, 0.2, 0.14], off: SHIELD_WIDE },
  { at: 0.68, grip: [-0.1, -0.18, 0.44], head: [-0.92, -0.18, 0.36], edge: [-0.38, -0.05, -0.92],
    turn: -0.7, hipTurn: -0.42, lean: 0.26, hips: [-0.08, 0.19, 0.13] },
  // The shield only closes once the mace has come back over it, or the handle would pass through.
  { at: 0.84, grip: [0.14, -0.12, 0.32], head: [-0.25, 0.8, 0.5], edge: [-0.1, -0.5, 0.85],
    turn: -0.1, hipTurn: -0.04, lean: 0.2, hipTilt: 0.1, hips: [-0.02, 0.14, 0.07],
    footL: [-0.18, 0.25, 0.09], footR: [0.17, -0.18, 0.03], toeL: 0.15, toeR: 0.4, off: SHIELD_WIDE },
  { ...LINK, grip: MACE_IDLE.grip, head: MACE_IDLE.head, edge: MACE_IDLE.edge, turn: 0.32, hipTurn: 0.22,
    lean: 0.12, hips: [0, 0.1, 0.01] },
];

export const MACE_AND_SHIELD: WeaponMoves = {
  idleClip: 'Idle_Shield_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: MACE_IDLE, walk: MACE_WALK, run: MACE_RUN },
  offStance: { idle: SHIELD_GUARD, walk: SHIELD_WALK, run: SHIELD_RUN },
  attacks: [{ keys: CHOP }, { keys: HOOK }],
};
