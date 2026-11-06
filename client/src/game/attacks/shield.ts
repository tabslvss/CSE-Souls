import type { AttackKey, ItemPose, Pose, RollPose, Vec3, WeaponMoves } from './types';

/*
 * Mace and shield: a compact, shield-first fighter. The left shoulder sits behind the shield with the
 * left foot forward, and the mace waits cocked by the right shoulder. The shield stays up through both
 * attacks and only opens a little as the mace comes through, the way a real guard gives room to the swing.
 */

const FOOT_L: Vec3 = [-0.16, 0.2, 0];
// Well behind the body, so that the back leg can straighten and drive through a strike.
const FOOT_R: Vec3 = [0.17, -0.26, 0.015];

const MACE_IDLE: Pose = {
  grip: [0.29, -0.1, 0.1],
  head: [0.12, 0.85, -0.3],
  edge: [0, 0.33, 0.94],
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
  // Further back than the idle's, because the walk clip tips the chest forward, and that takes the mace with it.
  head: [0.12, 0.72, -0.66],
  edge: [0, 0.68, 0.73],
  hips: [0, 0.05, 0.01],
  turn: 0.22,
  lean: 0.1,
  headFollow: 0,
  // The same tip of the chest would have him watching the floor.
  headPitch: -0.4,
};

const MACE_RUN: Pose = {
  grip: [0.3, -0.24, 0.16],
  head: [0.2, 0.8, -0.45],
  edge: [0, 0.45, 0.8],
  hips: [0, 0.05, 0.05],
  hipTilt: 0.18,
  turn: 0.12,
  lean: 0.44,
  headFollow: 0.8,
};

/** Forearm across the body, the shield's face turned out to the front, the eyes just over its rim. */
const SHIELD_GUARD: ItemPose = { grip: [-0.14, -0.12, 0.34], head: [0, 1, 0.05], edge: [0.78, 0, 0.62] };
/** Tipped back a little against the walk's lean, and clear of the front thigh. */
const SHIELD_WALK: ItemPose = { grip: [-0.14, -0.1, 0.36], head: [0, 0.95, -0.3], edge: [0.78, 0, 0.62] };
/** Nearly upright against the run's forward lean, so that the shield stays a wall and not a tray, and out past the knee. */
const SHIELD_RUN: ItemPose = { grip: [-0.23, -0.12, 0.26], head: [0, 0.97, -0.2], edge: [0.7, 0, 0.7] };
/** Pushed forward with the left shoulder as the body coils behind it. */
const SHIELD_COIL: ItemPose = { grip: [-0.07, -0.07, 0.38], head: [0, 1, 0.08], edge: [0.76, 0, 0.65] };
/** A third of the way open: the guard starts to give before the strike, so it never pops. */
const SHIELD_GIVE: ItemPose = { grip: [-0.13, -0.08, 0.35], head: [-0.02, 1, 0.07], edge: [0.73, 0, 0.68] };
/** Lifted out of the way of the knee, while the front foot steps back. */
const SHIELD_STEP: ItemPose = { grip: [-0.17, -0.05, 0.37], head: [-0.02, 1, 0.07], edge: [0.72, 0, 0.69] };
/** Two thirds open, on the frame of the hit. */
const SHIELD_GIVING: ItemPose = { grip: [-0.19, -0.12, 0.33], head: [-0.03, 1, 0.06], edge: [0.7, 0, 0.71] };
/** Opened a little to the left, as the mace comes through. Still a guard, so the chest stays half covered. */
const SHIELD_OPEN: ItemPose = { grip: [-0.25, -0.13, 0.3], head: [-0.05, 1, 0.05], edge: [0.68, 0, 0.73] };
/** Drawn back further when the hook carries the mace all the way across, so the two don't meet. */
const SHIELD_WIDE: ItemPose = { grip: [-0.32, -0.12, 0.18], head: [-0.06, 1, 0.02], edge: [0.6, 0, 0.8] };
/** On the way back from wide to the guard, once the mace has risen clear of the rim. */
const SHIELD_CLOSING: ItemPose = { grip: [-0.22, -0.06, 0.3], head: [-0.03, 1, 0.04], edge: [0.7, 0, 0.71] };

/**
 * The attacks chain, so each one ends still moving towards the next one's wind-up and close enough to the stance
 * that an attack with nothing after it just settles. The chop's rise carries on out to the right, into the hook.
 */
const CHOP_LINK: AttackKey = {
  at: 1,
  ease: 'linear',
  grip: [0.35, -0.06, 0.18],
  head: [0.3, 0.85, -0.08],
  edge: [0, 0.09, 1],
  turn: 0.36,
  hipTurn: 0.24,
  lean: 0.13,
  hipTilt: 0.08,
  hips: [0.01, 0.11, 0.01],
  footL: FOOT_L,
  footR: FOOT_R,
  toeL: 0.1,
  toeR: 0.5,
  off: SHIELD_GUARD,
};

/** The hook's return comes over the head and is still rising here, into the chop's raised mace. */
const HOOK_LINK: AttackKey = {
  at: 1,
  ease: 'linear',
  grip: [0.31, 0.12, 0.08],
  head: [0.12, 0.86, -0.35],
  edge: [0, 0.38, 0.93],
  turn: 0.36,
  hipTurn: 0.24,
  lean: 0.1,
  hipTilt: 0.08,
  hips: [0.01, 0.11, 0.01],
  footL: FOOT_L,
  footR: FOOT_R,
  toeL: 0.1,
  toeR: 0.5,
  off: SHIELD_GUARD,
};

/**
 * Overhand downward chop, out past the right hip so that it stays in view from behind. Weight rocks back and the
 * front foot comes off the floor, then the hips fire first and the shoulder comes over them as the foot stamps.
 * The strike speeds up all the way into the hit. The pelvis lands short of where it's going, so the weight of the
 * blow drags it on over the bent front knee after the mace has stopped. The recovery is a real step back.
 * Nearly every key is linear, and the spacing between keys does the easing, because an eased key would stop every
 * part of the body on the same frame.
 */
const CHOP: AttackKey[] = [
  // Linear from the start, so that a chained attack keeps the speed the last one ended with.
  { at: 0.2, ease: 'linear', grip: [0.4, 0.49, -0.17], head: [0.12, 0.52, -0.85], edge: [0, 0.85, 0.52],
    turn: 0.66, hipTurn: 0.38, lean: -0.02, hipTilt: -0.03, hips: [0.05, 0.085, -0.07],
    footL: [-0.16, 0.2, 0.06], footR: [0.17, -0.26, 0], off: SHIELD_COIL },
  { at: 0.225, ease: 'easeOut', grip: [0.4, 0.52, -0.2], head: [0.12, 0.48, -0.87], edge: [0, 0.87, 0.48],
    turn: 0.7, hipTurn: 0.38, lean: -0.04, hipTilt: -0.04, hips: [0.05, 0.08, -0.08], footL: [-0.16, 0.22, 0.09] },
  // The hold at the top. The hips have already begun to turn back while the shoulders wait.
  { at: 0.25, ease: 'linear', grip: [0.4, 0.54, -0.18], head: [0.1, 0.56, -0.82], edge: [0, 0.82, 0.56],
    turn: 0.72, hipTurn: 0.3, hips: [0.04, 0.08, -0.06], footL: [-0.16, 0.25, 0.12] },
  // Each step of the strike covers more of the arc than the last, so the mace is at its fastest on the hit.
  { at: 0.3, ease: 'linear', grip: [0.39, 0.5, -0.06], head: [0.1, 0.88, -0.47], edge: [0, 0.47, 0.88],
    turn: 0.56, hipTurn: 0.14, lean: 0.04, hipTilt: 0.01, hips: [0.025, 0.09, 0.01],
    footL: [-0.165, 0.3, 0.12], footR: [0.18, -0.26, 0.015] },
  { at: 0.345, ease: 'linear', grip: [0.37, 0.38, 0.16], head: [0.09, 0.98, 0.17], edge: [0, -0.17, 0.98],
    turn: 0.28, hipTurn: -0.04, lean: 0.14, hipTilt: 0.06, hips: [0.005, 0.115, 0.09],
    footL: [-0.17, 0.37, 0.11], footR: [0.18, -0.26, 0.03], off: SHIELD_GIVE },
  { at: 0.385, ease: 'linear', grip: [0.34, 0.2, 0.42], head: [0.13, 0.62, 0.79], edge: [0, -0.79, 0.62],
    turn: 0, hipTurn: -0.12, lean: 0.38, hipTilt: 0.13, hips: [-0.015, 0.15, 0.2],
    footL: [-0.17, 0.43, 0.07], footR: [0.18, -0.26, 0.055] },
  // The back leg straightens through the hit and the weight goes out over the front foot as it stamps down.
  { at: 0.42, ease: 'linear', impact: true, grip: [0.31, -0.02, 0.74], head: [0.22, -0.1, 0.99], edge: [0, -0.99, -0.1],
    turn: -0.3, hipTurn: -0.2, lean: 0.6, hipTilt: 0.2, hips: [-0.03, 0.185, 0.33],
    footL: [-0.17, 0.46, 0], footR: [0.18, -0.26, 0.08], toeR: 0.4, off: SHIELD_GIVING },
  { at: 0.46, ease: 'linear', grip: [0.305, -0.18, 0.69], head: [0.18, -0.44, 0.9], edge: [0, -0.9, -0.44],
    turn: -0.34, hipTurn: -0.21, lean: 0.62, hipTilt: 0.22, hips: [-0.035, 0.205, 0.365], footR: [0.18, -0.26, 0.095] },
  { at: 0.52, ease: 'linear', grip: [0.3, -0.31, 0.6], head: [0.15, -0.58, 0.8], edge: [0, -0.8, -0.58],
    turn: -0.38, hipTurn: -0.22, lean: 0.64, hipTilt: 0.24, hips: [-0.04, 0.235, 0.405], off: SHIELD_OPEN },
  // The mace stops first, and only drifts from here.
  { at: 0.56, ease: 'linear', grip: [0.3, -0.34, 0.56], head: [0.14, -0.62, 0.77], edge: [0, -0.77, -0.62],
    turn: -0.4, hipTurn: -0.23, lean: 0.64, hipTilt: 0.25, hips: [-0.045, 0.245, 0.415] },
  // Then the shoulders.
  { at: 0.6, ease: 'linear', grip: [0.3, -0.34, 0.53], head: [0.14, -0.6, 0.79], edge: [0, -0.79, -0.6],
    turn: -0.41, hipTurn: -0.23, lean: 0.64, hips: [-0.05, 0.255, 0.415] },
  // And the pelvis last, still sinking over the front leg as the arm has begun to lift.
  { at: 0.65, ease: 'linear', grip: [0.3, -0.32, 0.49], head: [0.14, -0.53, 0.84], edge: [0, -0.84, -0.53],
    turn: -0.38, hipTurn: -0.2, lean: 0.6, hips: [-0.05, 0.265, 0.37], footR: [0.18, -0.26, 0.08] },
  // The recovery peaks early and then slows. The weight comes back first, so the front foot is free to step.
  { at: 0.7, ease: 'linear', grip: [0.3, -0.29, 0.43], head: [0.14, -0.37, 0.92], edge: [0, -0.92, -0.37],
    turn: -0.26, hipTurn: -0.13, lean: 0.5, hipTilt: 0.2, hips: [-0.035, 0.235, 0.27],
    footL: [-0.17, 0.46, 0], footR: [0.18, -0.26, 0.06], off: SHIELD_GIVING },
  { at: 0.76, ease: 'linear', grip: [0.31, -0.225, 0.365], head: [0.2, 0.12, 0.97], edge: [0, -0.97, 0.12],
    turn: -0.07, hipTurn: -0.02, lean: 0.35, hipTilt: 0.15, hips: [-0.015, 0.175, 0.14],
    footL: [-0.17, 0.42, 0.11], footR: [0.175, -0.26, 0.04], toeR: 0.45, off: SHIELD_STEP },
  { at: 0.82, ease: 'linear', grip: [0.32, -0.175, 0.3], head: [0.23, 0.46, 0.75], edge: [0, -0.75, 0.46],
    turn: 0.1, hipTurn: 0.07, lean: 0.26, hipTilt: 0.12, hips: [-0.005, 0.145, 0.08],
    footL: [-0.165, 0.32, 0.135], footR: [0.175, -0.26, 0.03], toeR: 0.47, off: SHIELD_STEP },
  { at: 0.87, ease: 'linear', grip: [0.33, -0.135, 0.255], head: [0.25, 0.7, 0.48], edge: [0, -0.55, 0.83],
    turn: 0.22, hipTurn: 0.14, lean: 0.2, hipTilt: 0.1, hips: [0, 0.125, 0.05],
    footL: [-0.16, 0.24, 0.07], footR: [0.17, -0.26, 0.02], toeR: 0.48, off: SHIELD_GIVE },
  // Down at home, and it doesn't move again.
  { at: 0.9, ease: 'linear', grip: [0.335, -0.115, 0.23], head: [0.26, 0.77, 0.32], edge: [0, -0.4, 0.91],
    turn: 0.27, hipTurn: 0.18, lean: 0.17, hipTilt: 0.09, hips: [0.005, 0.12, 0.035],
    footL: FOOT_L, footR: FOOT_R },
  CHOP_LINK,
];

/**
 * Sideways hook from right to left, in a plane that rises a little as it goes, so that the mace head stays in sight over the shoulder. The body rocks back with the arm out wide, then
 * the hips drive it around and the hand comes before the mace head. After the hit the hand stops first, then the
 * shoulders, while the swing drags the hips on over the front knee. Then the return swings up over the left
 * shoulder and over the head, and the front foot steps back underneath it.
 */
const HOOK: AttackKey[] = [
  { at: 0.2, ease: 'linear', grip: [0.5, 0.12, -0.13], head: [0.68, 0.4, -0.61], edge: [0.63, 0, 0.77],
    turn: 0.76, hipTurn: 0.44, lean: 0, hips: [0.065, 0.11, -0.07],
    footL: [-0.16, 0.2, 0.06], footR: [0.17, -0.26, 0], off: SHIELD_COIL },
  { at: 0.225, ease: 'easeOut', grip: [0.52, 0.14, -0.16], head: [0.72, 0.35, -0.6], edge: [0.6, 0, 0.8],
    turn: 0.82, hipTurn: 0.45, lean: -0.02, hips: [0.07, 0.11, -0.08], footL: [-0.16, 0.22, 0.09] },
  { at: 0.25, ease: 'linear', grip: [0.54, 0.14, -0.14], head: [0.78, 0.3, -0.55], edge: [0.55, 0, 0.83],
    turn: 0.84, hipTurn: 0.36, hips: [0.06, 0.11, -0.06], footL: [-0.17, 0.25, 0.12] },
  { at: 0.3, ease: 'linear', grip: [0.53, 0.13, -0.02], head: [0.93, 0.27, -0.23], edge: [0.24, 0, 0.97],
    turn: 0.72, hipTurn: 0.2, lean: 0.03, hipTilt: 0.01, hips: [0.045, 0.112, 0.01],
    footL: [-0.175, 0.3, 0.12], footR: [0.17, -0.26, 0.015], toeR: 0.45 },
  { at: 0.345, ease: 'linear', grip: [0.48, 0.1, 0.2], head: [0.93, 0.22, 0.21], edge: [-0.22, 0, 0.97],
    turn: 0.42, hipTurn: 0, lean: 0.12, hipTilt: 0.05, hips: [0.02, 0.122, 0.09],
    footL: [-0.185, 0.37, 0.11], footR: [0.17, -0.26, 0.03], toeR: 0.42, off: SHIELD_GIVE },
  { at: 0.385, ease: 'linear', grip: [0.38, 0.06, 0.46], head: [0.64, 0.17, 0.74], edge: [-0.75, 0, 0.66],
    turn: 0.06, hipTurn: -0.12, lean: 0.36, hipTilt: 0.1, hips: [-0.015, 0.15, 0.2],
    footL: [-0.195, 0.43, 0.07], footR: [0.17, -0.26, 0.05], toeR: 0.37 },
  { at: 0.42, ease: 'linear', impact: true, grip: [0.2, 0.02, 0.75], head: [-0.05, 0.13, 0.99], edge: [-1, -0.05, -0.05],
    turn: -0.34, hipTurn: -0.24, lean: 0.56, hipTilt: 0.15, hips: [-0.05, 0.185, 0.32],
    footL: [-0.2, 0.46, 0], footR: [0.17, -0.26, 0.08], toeL: 0.2, toeR: 0.3, off: SHIELD_GIVING },
  { at: 0.46, ease: 'linear', grip: [0.09, 0.01, 0.7], head: [-0.42, 0.2, 0.88], edge: [-0.9, -0.05, -0.42],
    turn: -0.52, hipTurn: -0.33, lean: 0.57, hipTilt: 0.15, hips: [-0.065, 0.195, 0.35], footR: [0.17, -0.26, 0.095], off: SHIELD_OPEN },
  { at: 0.52, ease: 'linear', grip: [0.015, 0, 0.6], head: [-0.63, 0.26, 0.74], edge: [-0.77, -0.05, -0.63],
    turn: -0.64, hipTurn: -0.4, lean: 0.54, hipTilt: 0.15, hips: [-0.078, 0.21, 0.385] },
  // The hand gets to the end of the swing first.
  { at: 0.56, ease: 'linear', grip: [-0.03, -0.02, 0.55], head: [-0.7, 0.27, 0.66], edge: [-0.71, -0.05, -0.7],
    turn: -0.69, hipTurn: -0.44, lean: 0.5, hipTilt: 0.15, hips: [-0.085, 0.215, 0.39], off: SHIELD_WIDE },
  { at: 0.62, ease: 'linear', grip: [-0.04, -0.02, 0.52], head: [-0.72, 0.27, 0.64], edge: [-0.69, -0.05, -0.72],
    turn: -0.72, hipTurn: -0.48, lean: 0.44, hips: [-0.09, 0.22, 0.37] },
  // The end of the overshoot: the shoulders are already on the way back, and the hips arrive last of all.
  { at: 0.67, ease: 'linear', grip: [-0.03, 0, 0.47], head: [-0.7, 0.36, 0.62], edge: [-0.67, -0.15, -0.72],
    turn: -0.68, hipTurn: -0.5, lean: 0.37, hips: [-0.095, 0.22, 0.31], footL: [-0.2, 0.46, 0], footR: [0.17, -0.26, 0.08] },
  // Up over the left shoulder. The shield only closes once the mace is above it, or the handle would pass through.
  { at: 0.72, ease: 'linear', grip: [0, 0.07, 0.41], head: [-0.66, 0.55, 0.51], edge: [-0.62, -0.3, -0.72],
    turn: -0.5, hipTurn: -0.37, lean: 0.3, hipTilt: 0.13, hips: [-0.07, 0.195, 0.22],
    footL: [-0.2, 0.46, 0], footR: [0.17, -0.26, 0.055] },
  { at: 0.78, ease: 'linear', grip: [0.05, 0.15, 0.34], head: [-0.46, 0.8, 0.38], edge: [-0.82, -0.35, -0.35],
    turn: -0.27, hipTurn: -0.18, lean: 0.25, hipTilt: 0.11, hips: [-0.04, 0.16, 0.12],
    footL: [-0.195, 0.41, 0.1], footR: [0.17, -0.26, 0.035], toeL: 0.15, toeR: 0.4, off: SHIELD_CLOSING },
  { at: 0.83, ease: 'linear', grip: [0.12, 0.21, 0.26], head: [-0.25, 0.94, 0.22], edge: [-0.78, -0.25, 0.3],
    turn: -0.08, hipTurn: -0.05, lean: 0.2, hipTilt: 0.1, hips: [-0.02, 0.135, 0.07],
    footL: [-0.18, 0.31, 0.12], footR: [0.17, -0.26, 0.025], toeL: 0.12, toeR: 0.44 },
  { at: 0.88, ease: 'linear', grip: [0.2, 0.22, 0.2], head: [-0.08, 0.98, 0.1], edge: [-0.7, -0.13, 0.72],
    turn: 0.06, hipTurn: 0.03, lean: 0.17, hipTilt: 0.09, hips: [-0.01, 0.125, 0.04],
    footL: [-0.165, 0.235, 0.07], footR: [0.17, -0.26, 0.02], toeL: 0.11, toeR: 0.46, off: SHIELD_GIVE },
  // Down at home, and it doesn't move again.
  { at: 0.91, ease: 'linear', grip: [0.24, 0.2, 0.16], head: [0, 0.97, -0.05], edge: [-0.45, 0.03, 0.87],
    turn: 0.16, hipTurn: 0.09, lean: 0.145, hipTilt: 0.085, hips: [-0.005, 0.118, 0.03],
    footL: FOOT_L, footR: FOOT_R, toeL: 0.1, toeR: 0.5 },
  { at: 0.95, ease: 'linear', grip: [0.28, 0.17, 0.12], head: [0.06, 0.94, -0.18], edge: [-0.25, 0.18, 0.95],
    turn: 0.26, hipTurn: 0.15, lean: 0.12, hipTilt: 0.08, hips: [0, 0.11, 0.02] },
  HOOK_LINK,
];

/** Rolling, the mace lies along the forearm with its head tucked, and the shield is pressed flat to the back of the arm. */
const ROLL: RollPose = {
  main: { grip: [0.2, -0.16, 0.2], head: [-0.25, 0.75, 0.6], edge: [0, -0.6, 0.75] },
  off: { grip: [-0.24, -0.08, 0.14], head: [0.1, 1, 0.15], edge: [0.9, 0, 0.4] },
  lift: 0.15,
  curl: 0.5,
};

export const MACE_AND_SHIELD: WeaponMoves = {
  idleClip: 'Idle_Shield_Loop',
  runClip: 'Jog_Fwd_Loop',
  // The clip's stride covers 6.3 m/s with long floating leaps. Steps of 50% at 1.55 times the rate cover the
  // class's 4.9 m/s, so the planted foot doesn't skate, and short quick steps read as heavy.
  runRate: 1.55,
  life: { sink: 0.03, shift: 0.03, drift: 0.14, handLag: 0.9, offLag: 0.5, runBob: 0.2, runStride: 0.5, runLift: 0.22, runHeadLevel: 0.85, runSteady: 0.68, gaitSwing: 0.2 },
  stance: { idle: MACE_IDLE, walk: MACE_WALK, run: MACE_RUN },
  offStance: { idle: SHIELD_GUARD, walk: SHIELD_WALK, run: SHIELD_RUN },
  roll: ROLL,
  attacks: [{ keys: CHOP }, { keys: HOOK }],
};
