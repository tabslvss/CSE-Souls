import type { AttackKey, Pose, WeaponMoves } from './types';

/*
 * The zweihander: right hand at the guard, left at the pommel, left foot forward.
 *
 * A three-part combo. A long cut from high right to low left, a rising return from low left to high
 * right on a passing step, and a lunging thrust out of the shoulder. Each attack ends in the pose the next
 * one starts from. The blade has two edges, so the rising cut leads with the false edge and the wrists
 * never have to turn over.
 *
 * The character does not travel while the keys play, so every long step is paid back with a lifted step
 * during recovery. Otherwise the feet would have to slide home.
 */

const GUARD_BODY = {
  turn: 0.35,
  lean: 0.1,
  hipTurn: 0.3,
  hipTilt: 0.05,
  hips: [0.02, 0.14, -0.02],
} as const;

const GUARD_FEET = {
  footL: [-0.15, 0.18, 0],
  footR: [0.18, -0.22, 0],
  toeL: 0.1,
  toeR: 0.6,
} as const;

/** Middle guard: hands low by the right hip, the point up and forward at the opponent's throat. */
const ZWEIHANDER_GUARD: Pose = {
  grip: [0.08, -0.26, 0.3],
  head: [-0.12, 0.6, 0.78],
  edge: [0.02, -0.78, 0.6],
  ...GUARD_BODY,
  ...GUARD_FEET,
};

const ZWEIHANDER_WALK: Pose = {
  grip: [0.08, -0.22, 0.25],
  head: [-0.12, 0.8, 0.58],
  edge: [0.02, -0.58, 0.8],
  turn: 0.3,
  lean: 0.08,
};

/** The blade rests back on the right shoulder. The run clip pitches the chest forward, so it points well back here. */
const ZWEIHANDER_RUN: Pose = {
  grip: [0.16, 0.05, 0.16],
  head: [0.25, 0.02, -0.97],
  edge: [-0.1, 0.99, 0.05],
  turn: 0.25,
  lean: 0.14,
};

const HIGH_RIGHT_TO_LOW_LEFT: AttackKey[] = [
  // Settles onto the back leg while the blade starts up.
  {
    at: 0.18,
    grip: [0.24, 0.06, 0.2],
    head: [0.2, 0.95, 0.1],
    edge: [-0.25, -0.05, 1],
    turn: 0.7,
    lean: 0.02,
    hipTurn: 0.4,
    hips: [0.05, 0.12, -0.06],
  },
  // The peak: hands beside the head and clear of it, coiled, weight back, front heel light.
  {
    at: 0.34,
    grip: [0.34, 0.34, -0.02],
    head: [0.35, 0.8, -0.5],
    edge: [0.35, 0.35, 0.85],
    turn: 1.1,
    lean: -0.06,
    hipTurn: 0.5,
    hips: [0.07, 0.1, -0.09],
    footL: [-0.15, 0.18, 0.05],
  },
  // A short hold. The blade barely drifts, but the hips and front foot have already gone.
  {
    at: 0.39,
    ease: 'linear',
    grip: [0.35, 0.35, -0.03],
    head: [0.36, 0.78, -0.53],
    edge: [0.35, 0.37, 0.84],
    turn: 1.12,
    hipTurn: 0.28,
    hips: [0.05, 0.13, 0.0],
    footL: [-0.17, 0.32, 0.11],
  },
  // Shoulders whip after the hips.
  {
    at: 0.45,
    ease: 'easeIn',
    grip: [0.22, 0.2, 0.3],
    head: [0.42, 0.76, 0.5],
    edge: [-0.3, -0.45, 0.85],
    turn: 0.5,
    lean: 0.2,
    hipTurn: -0.05,
    hipTilt: 0.12,
    hips: [0, 0.19, 0.18],
    footL: [-0.19, 0.52, 0.03],
    footR: [0.18, -0.22, 0.04],
  },
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [-0.02, -0.1, 0.52],
    head: [-0.3, -0.12, 0.95],
    edge: [-0.65, -0.67, -0.28],
    turn: -0.2,
    lean: 0.38,
    hipTurn: -0.22,
    hipTilt: 0.2,
    hips: [-0.05, 0.24, 0.28],
    footL: [-0.2, 0.58, 0],
    footR: [0.19, -0.22, 0.07],
    toeL: 0.05,
  },
  // Momentum carries the blade past and drags the body round and down over the front knee.
  {
    at: 0.56,
    ease: 'easeOut',
    grip: [-0.2, -0.24, 0.38],
    head: [-0.72, -0.42, 0.55],
    edge: [-0.45, 0.1, -0.85],
    turn: -0.62,
    lean: 0.5,
    hipTurn: -0.42,
    hipTilt: 0.26,
    hips: [-0.09, 0.28, 0.31],
  },
  {
    at: 0.66,
    ease: 'easeOut',
    grip: [-0.27, -0.27, 0.2],
    head: [-0.86, -0.42, 0.12],
    edge: [-0.3, 0.3, -0.9],
    turn: -0.85,
    lean: 0.54,
    hipTurn: -0.5,
    hips: [-0.1, 0.3, 0.32],
  },
  // It takes effort to stop this much steel: the blade sags while the body catches itself.
  {
    at: 0.76,
    grip: [-0.26, -0.28, 0.21],
    head: [-0.85, -0.44, 0.16],
    edge: [-0.3, 0.3, -0.9],
    turn: -0.8,
    lean: 0.5,
    hips: [-0.1, 0.29, 0.3],
    footL: [-0.2, 0.58, 0.05],
    footR: [0.19, -0.22, 0.03],
  },
  // Hauls it back up to the low left and pulls the front foot home, ready to return.
  {
    at: 0.88,
    grip: [-0.23, -0.27, 0.26],
    head: [-0.72, -0.3, 0.55],
    edge: [0.27, -0.95, -0.16],
    turn: -0.6,
    lean: 0.36,
    hipTurn: -0.34,
    hipTilt: 0.15,
    hips: [-0.08, 0.22, 0.14],
    footL: [-0.18, 0.37, 0.1],
    footR: [0.2, -0.2, 0],
    toeL: 0.1,
  },
  {
    at: 1,
    grip: [-0.2, -0.26, 0.3],
    head: [-0.65, -0.15, 0.72],
    edge: [0.2, -0.95, -0.1],
    turn: -0.45,
    lean: 0.26,
    hipTurn: -0.28,
    hipTilt: 0.12,
    hips: [-0.06, 0.18, 0.06],
    footL: [-0.17, 0.3, 0],
    footR: [0.2, -0.2, 0],
  },
];

const RISING_RETURN: AttackKey[] = [
  // Drops under the blade with the front foot stepping back, so that the right leg has room to pass.
  {
    at: 0.16,
    grip: [-0.24, -0.26, 0.24],
    head: [-0.72, -0.4, 0.45],
    edge: [0.3, -0.85, -0.2],
    turn: -0.65,
    lean: 0.28,
    hipTurn: -0.38,
    hipTilt: 0.12,
    hips: [-0.08, 0.2, 0.0],
    footL: [-0.17, 0.17, 0.1],
  },
  // Coiled to the left, the point trailing behind the left hip.
  {
    at: 0.34,
    grip: [-0.26, -0.27, 0.19],
    head: [-0.82, -0.42, 0.25],
    edge: [0.37, -0.89, -0.28],
    turn: -0.9,
    lean: 0.32,
    hipTurn: -0.5,
    hipTilt: 0.15,
    hips: [-0.09, 0.24, -0.03],
    footL: [-0.17, 0.13, 0],
    footR: [0.2, -0.2, 0.05],
  },
  {
    at: 0.42,
    ease: 'linear',
    grip: [-0.27, -0.28, 0.18],
    head: [-0.84, -0.42, 0.22],
    edge: [0.37, -0.89, -0.28],
    turn: -0.94,
    hipTurn: -0.25,
    hips: [-0.05, 0.2, 0.04],
    footR: [0.19, 0.08, 0.14],
    toeR: 0.25,
  },
  {
    at: 0.465,
    ease: 'easeIn',
    grip: [-0.14, -0.16, 0.4],
    head: [-0.25, 0.02, 0.97],
    edge: [-0.5, -0.82, -0.12],
    turn: -0.3,
    lean: 0.24,
    hipTurn: 0.02,
    hipTilt: 0.1,
    hips: [0, 0.19, 0.18],
    footR: [0.2, 0.46, 0.06],
  },
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.06, -0.02, 0.5],
    head: [0.38, 0.3, 0.87],
    edge: [-0.6, -0.72, 0.3],
    turn: 0.25,
    lean: 0.22,
    hipTurn: 0.22,
    hipTilt: 0.1,
    hips: [0.05, 0.22, 0.28],
    footR: [0.2, 0.52, 0],
    footL: [-0.18, 0.13, 0.06],
    toeR: 0.1,
    toeL: 0.45,
  },
  // Rises through the cut onto the front toes, the blade swinging high and back over the right shoulder.
  {
    at: 0.62,
    ease: 'easeOut',
    grip: [0.26, 0.28, 0.16],
    head: [0.72, 0.62, -0.1],
    edge: [-0.45, 0.5, 0.75],
    turn: 0.82,
    lean: -0.08,
    hipTurn: 0.45,
    hipTilt: 0,
    hips: [0.08, 0.1, 0.26],
  },
  {
    at: 0.72,
    grip: [0.27, 0.26, 0.16],
    head: [0.7, 0.66, -0.12],
    edge: [-0.45, 0.48, 0.75],
    turn: 0.8,
    lean: -0.04,
    hips: [0.08, 0.13, 0.24],
  },
  // Steps back into the fencing stance, the left foot forward again.
  {
    at: 0.86,
    grip: [0.24, 0.16, 0.2],
    head: [0.5, 0.8, -0.1],
    edge: [-0.4, 0.2, 0.9],
    turn: 0.72,
    lean: 0,
    hipTurn: 0.42,
    hips: [0.06, 0.13, 0.06],
    footR: [0.19, -0.08, 0.14],
    footL: [-0.17, 0.13, 0],
    toeR: 0.4,
    toeL: 0.2,
  },
  {
    at: 1,
    grip: [0.22, 0.1, 0.22],
    head: [0.4, 0.85, -0.1],
    edge: [-0.4, 0.05, 0.9],
    turn: 0.7,
    lean: 0.02,
    hipTurn: 0.4,
    hips: [0.05, 0.13, -0.02],
    footR: [0.18, -0.22, 0],
    footL: [-0.15, 0.18, 0],
    toeR: 0.6,
    toeL: 0.1,
  },
];

const LUNGING_THRUST: AttackKey[] = [
  // Draws back: hands to the right chest, the point levelled, everything loaded on the back leg.
  {
    at: 0.36,
    grip: [0.22, -0.05, 0.1],
    head: [-0.1, 0.1, 1],
    edge: [0.05, -1, 0.1],
    turn: 1.0,
    lean: 0,
    hipTurn: 0.6,
    hips: [0.08, 0.16, -0.1],
    footL: [-0.15, 0.2, 0.04],
    footR: [0.18, -0.22, 0],
    toeL: 0.1,
    toeR: 0.7,
  },
  {
    at: 0.43,
    ease: 'linear',
    grip: [0.23, -0.05, 0.08],
    head: [-0.1, 0.1, 1],
    edge: [0.05, -1, 0.1],
    turn: 1.02,
    hipTurn: 0.35,
    hips: [0.05, 0.16, -0.02],
    footL: [-0.16, 0.34, 0.12],
  },
  {
    at: 0.5,
    ease: 'easeIn',
    impact: true,
    grip: [0.02, -0.04, 0.68],
    head: [-0.02, 0.02, 1],
    edge: [-0.3, -0.95, 0],
    turn: -0.35,
    lean: 0.42,
    hipTurn: -0.2,
    hipTilt: 0.22,
    hips: [-0.03, 0.26, 0.26],
    footL: [-0.18, 0.62, 0],
    footR: [0.2, -0.24, 0.07],
    toeL: 0.05,
  },
  // The weight of the blade dips the point, and the body sinks onto the front knee.
  {
    at: 0.6,
    ease: 'easeOut',
    grip: [0, -0.1, 0.69],
    head: [-0.04, -0.12, 1],
    edge: [-0.3, -0.95, -0.1],
    turn: -0.42,
    lean: 0.48,
    hips: [-0.03, 0.29, 0.29],
  },
  {
    at: 0.72,
    grip: [0, -0.14, 0.64],
    head: [-0.05, -0.08, 1],
    edge: [-0.25, -0.95, -0.1],
    turn: -0.3,
    lean: 0.44,
    hips: [-0.03, 0.27, 0.26],
    footL: [-0.18, 0.62, 0.05],
    footR: [0.2, -0.24, 0],
  },
  // Pulls the front foot home and lifts the point back to guard.
  {
    at: 0.88,
    grip: [0.05, -0.22, 0.42],
    head: [-0.1, 0.35, 0.92],
    edge: [0, -0.9, 0.35],
    turn: 0.1,
    lean: 0.2,
    hipTurn: 0.1,
    hipTilt: 0.1,
    hips: [0, 0.18, 0.08],
    footL: [-0.17, 0.4, 0.1],
  },
  {
    at: 1,
    ...ZWEIHANDER_GUARD,
  },
];

export const ZWEIHANDER: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: ZWEIHANDER_GUARD, walk: ZWEIHANDER_WALK, run: ZWEIHANDER_RUN },
  attacks: [{ keys: HIGH_RIGHT_TO_LOW_LEFT }, { keys: RISING_RETURN }, { keys: LUNGING_THRUST }],
};
