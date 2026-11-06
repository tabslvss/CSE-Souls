import type { AttackKey, Pose, Vec3, WeaponMoves } from './types';

/*
 * Heavy weapons: both hands on the haft, swung with the whole body. The weapon is the heavy thing here and
 * the body works around it. Slow hoist, a short hang at the top, a strike over in a few frames, then the
 * weight carries everything past the target and has to be hauled back.
 *
 * The hands hold these hafts near the middle, so a long butt sticks out behind them. Every pose keeps that
 * butt clear of the body: past the right hip on overhead and rising swings, past the left hip on the wide
 * sweep, where the shoulders stay ahead of the head of the axe.
 *
 * Attacks chain: each one ends where the next begins, so the pairs read as a single combo.
 */

/**
 * Which way the knuckles point when the wrist only pitches the weapon up and down, with the forearm in its
 * neutral roll: head forward means knuckles down, head up means knuckles forward. Overhead swings stay
 * on this plane, and it's what keeps the wrists from wringing.
 */
const pitched = (head: Vec3): Vec3 => [0, -head[2], head[1]];

/** The edge leads when the head travels flat, from the character's right to their left. */
const swept = (head: Vec3): Vec3 => [-head[2], 0.02, head[0]];

/** Both weapons ride on the right shoulder for running, the left hand low on the haft in front. */
const SHOULDER_CARRY: Pose = {
  grip: [0.18, 0.08, 0.24],
  head: [0.42, 0.6, -0.68],
  edge: pitched([0.42, 0.6, -0.68]),
  turn: 0.32,
  lean: 0.16,
};

const HAMMER_LOW: Vec3 = [-0.12, -0.42, 0.9];

/** The hammer is too heavy to hold up for long: side-on, butt past the right hip, head hanging out in front. */
const HAMMER_IDLE: Pose = {
  grip: [0.18, -0.29, 0.33],
  head: HAMMER_LOW,
  edge: pitched(HAMMER_LOW),
  turn: 0.64,
  lean: 0.2,
  hipTurn: 0.34,
  hipTilt: 0.04,
  hipRoll: 0,
  hips: [0.03, 0.15, 0],
  footL: [-0.16, 0.16, 0],
  footR: [0.19, -0.22, 0],
  toeL: 0.05,
  toeR: 0.6,
};

const HAMMER_WALK: Pose = { ...HAMMER_IDLE, hips: undefined, hipTurn: undefined, hipTilt: undefined, footL: undefined, footR: undefined, toeL: undefined, toeR: undefined };

const GATHER: Vec3 = [0.02, 0.28, 0.96];
const HOIST: Vec3 = [0.25, 0.6, -0.76];
const HOIST_TOP: Vec3 = [0.22, 0.55, -0.8];
const OVERHEAD: Vec3 = [0.1, 0.95, 0.2];
const FLOORED: Vec3 = [-0.3, -0.55, 0.78];
const SUNK: Vec3 = [-0.28, -0.62, 0.73];
const LEVERED: Vec3 = [-0.2, -0.6, 0.77];

/** The overhead slam: hoisted behind the right shoulder, driven into the floor, then dragged back up. */
const HAMMER_SLAM: AttackKey[] = [
  // Gathering: the head comes up off the low position, the knees loading.
  {
    at: 0.16,
    grip: [0.27, -0.16, 0.34],
    head: GATHER,
    edge: pitched(GATHER),
    turn: 0.62,
    lean: 0.14,
    hipTurn: 0.38,
    hips: [0.05, 0.19, -0.02],
  },
  // The hoist: over the right shoulder, the back arching and the weight going onto the back foot.
  {
    at: 0.34,
    grip: [0.24, 0.28, 0.02],
    head: HOIST,
    edge: pitched(HOIST),
    turn: 0.66,
    lean: -0.22,
    hipTurn: 0.4,
    hipTilt: -0.1,
    hips: [0.07, 0.07, -0.08],
    footL: [-0.16, 0.18, 0.05],
  },
  // The hang at the top, still rising a little while the front foot comes off the floor.
  { at: 0.4, ease: 'linear', grip: [0.24, 0.32, 0.01], head: HOIST_TOP, edge: pitched(HOIST_TOP), turn: 0.7, lean: -0.26, footL: [-0.17, 0.26, 0.14] },
  // Hips first: they have already come round by the time the hammer passes overhead.
  {
    at: 0.46,
    ease: 'easeIn',
    grip: [0.16, 0.3, 0.4],
    head: OVERHEAD,
    edge: pitched(OVERHEAD),
    turn: 0.3,
    lean: 0.1,
    hipTurn: 0,
    hipTilt: 0.06,
    hips: [0.03, 0.2, 0.1],
    footL: [-0.19, 0.44, 0.08],
  },
  // Impact: the front foot stamps, the knees give, the head of the hammer stops just off the floor.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.12, -0.38, 0.38],
    head: FLOORED,
    edge: pitched(FLOORED),
    turn: -0.1,
    lean: 0.86,
    hipTurn: -0.14,
    hipTilt: 0.34,
    hips: [-0.03, 0.42, 0.22],
    footL: [-0.2, 0.54, 0],
    footR: [0.19, -0.22, 0.07],
    toeL: 0.1,
  },
  // Momentum carries on: the body sinks after the weapon has stopped.
  { at: 0.58, ease: 'easeOut', grip: [0.12, -0.4, 0.36], head: SUNK, edge: pitched(SUNK), turn: -0.16, lean: 0.96, hips: [-0.04, 0.47, 0.24] },
  { at: 0.68, grip: [0.12, -0.39, 0.37], head: SUNK, edge: pitched(SUNK), turn: -0.14, lean: 0.92, hips: [-0.04, 0.46, 0.23] },
  // The effort: the body straightens first while the hammer stays down, levered up by the butt.
  {
    at: 0.8,
    grip: [0.17, -0.36, 0.36],
    head: LEVERED,
    edge: pitched(LEVERED),
    turn: 0.12,
    lean: 0.58,
    hipTurn: 0.04,
    hipTilt: 0.2,
    hips: [0, 0.36, 0.16],
    footR: [0.19, -0.22, 0.03],
    toeR: 0.5,
  },
  // Only then does the front foot let go and step back under the body.
  {
    at: 0.9,
    grip: [0.2, -0.34, 0.34],
    head: [-0.16, -0.5, 0.85],
    edge: pitched([-0.16, -0.5, 0.85]),
    turn: 0.36,
    lean: 0.36,
    hipTurn: 0.2,
    hipTilt: 0.1,
    hips: [0.02, 0.24, 0.07],
    footL: [-0.18, 0.34, 0.12],
    footR: [0.19, -0.22, 0],
    toeL: 0.08,
  },
  // Ends down at the right with the head low: where the rising swing begins.
  { ...HAMMER_IDLE, at: 1, ease: 'easeOut' },
];

const TRAILING: Vec3 = [0.52, -0.42, -0.74];
const SCRAPING: Vec3 = [0.12, -0.98, 0.1];
const RISING: Vec3 = [-0.38, 0.3, 0.87];
const OVER_LEFT: Vec3 = [-0.7, 0.62, 0.34];
const CARRIED: Vec3 = [-0.72, 0.68, -0.14];
const FALLING: Vec3 = [-0.4, -0.72, 0.56];

/** The rising haymaker: from low in front, dragged back past the right leg, then swung up through the middle. */
const HAMMER_HAYMAKER: AttackKey[] = [
  // Dragged back past the right hip, the head skimming the floor, and the torso coiling over the back foot.
  {
    at: 0.28,
    grip: [0.34, -0.24, 0.1],
    head: TRAILING,
    edge: pitched(TRAILING),
    turn: 0.95,
    lean: 0.26,
    hipTurn: 0.58,
    hipTilt: 0.08,
    hipRoll: 0.06,
    hips: [0.1, 0.22, -0.06],
    footL: [-0.16, 0.18, 0.05],
  },
  { at: 0.38, ease: 'linear', grip: [0.34, -0.22, 0.09], head: [0.5, -0.36, -0.78], edge: pitched([0.5, -0.36, -0.78]), turn: 1.02, lean: 0.28, hipTurn: 0.6 },
  // The hips fire and the left foot goes down to brace, while the head scythes under the right hand.
  {
    at: 0.45,
    ease: 'easeIn',
    grip: [0.31, -0.34, 0.26],
    head: SCRAPING,
    edge: pitched(SCRAPING),
    turn: 0.5,
    lean: 0.3,
    hipTurn: 0.02,
    hipRoll: 0.02,
    hips: [0.04, 0.27, 0.08],
    footL: [-0.2, 0.44, 0],
  },
  // Impact: rising through the middle at chest height, arms long.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.16, -0.12, 0.44],
    head: RISING,
    edge: pitched(RISING),
    turn: -0.02,
    lean: 0.04,
    hipTurn: -0.36,
    hipRoll: -0.06,
    hips: [-0.02, 0.2, 0.14],
    footL: [-0.2, 0.46, 0],
    footR: [0.19, -0.22, 0.07],
    toeR: 0.25,
  },
  // Follow-through: carried up and round to the left, the back foot dragged onto its toes.
  {
    at: 0.6,
    ease: 'easeOut',
    grip: [-0.08, 0.04, 0.36],
    head: OVER_LEFT,
    edge: pitched(OVER_LEFT),
    turn: -0.58,
    lean: -0.06,
    hipTurn: -0.62,
    hipRoll: -0.1,
    hips: [-0.08, 0.15, 0.16],
    footR: [0.17, -0.2, 0.08],
    toeR: -0.1,
  },
  { at: 0.72, ease: 'easeOut', grip: [-0.16, 0.12, 0.24], head: CARRIED, edge: pitched(CARRIED), turn: -0.74, lean: -0.08, hipTurn: -0.7 },
  // Letting the weight drop in front and hauling it back down to the right.
  {
    at: 0.86,
    grip: [0.06, -0.2, 0.5],
    head: FALLING,
    edge: pitched(FALLING),
    turn: -0.05,
    lean: 0.28,
    hipTurn: -0.12,
    hipRoll: 0,
    hips: [0, 0.22, 0.1],
    footL: [-0.19, 0.38, 0],
    footR: [0.19, -0.22, 0.02],
    toeR: 0.4,
  },
  { ...HAMMER_IDLE, at: 1 },
];

export const WAR_HAMMER: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: HAMMER_IDLE, walk: HAMMER_WALK, run: SHOULDER_CARRY },
  attacks: [{ keys: HAMMER_SLAM }, { keys: HAMMER_HAYMAKER }],
};

/** The double axe rides on the shoulder, ready to come off it into a sweep. */
const AXE_IDLE: Pose = {
  ...SHOULDER_CARRY,
  turn: 0.36,
  lean: 0.12,
  hipTurn: 0.24,
  hipTilt: 0,
  hipRoll: 0,
  hips: [0.02, 0.13, 0],
  footL: [-0.16, 0.16, 0],
  footR: [0.19, -0.22, 0],
  toeL: 0.05,
  toeR: 0.55,
};

const AXE_WALK: Pose = { ...SHOULDER_CARRY, turn: 0.3, lean: 0.12 };

const COILED: Vec3 = [0.6, 0.12, -0.79];
const COILED_DEEP: Vec3 = [0.5, 0.08, -0.86];
const AXE_RIGHT: Vec3 = [0.98, -0.1, 0.16];
const AXE_AHEAD: Vec3 = [0.1, -0.12, 0.99];
const AXE_PAST: Vec3 = [-0.7, -0.08, 0.7];
const AXE_LEFT: Vec3 = [-0.94, 0, 0.34];
const AXE_RISING: Vec3 = [-0.45, 0.88, 0.1];

/**
 * The wide sweep: coiled far to the right, then thrown across at waist height. The shoulders stay ahead of
 * the axe head the whole way, which is what makes the head feel like it's being dragged round.
 */
const AXE_SWEEP: AttackKey[] = [
  // Off the shoulder and out behind, the torso winding up.
  {
    at: 0.24,
    grip: [0.36, -0.08, 0.12],
    head: COILED,
    edge: swept(COILED),
    turn: 1.05,
    lean: 0.1,
    hipTurn: 0.55,
    hipRoll: 0.06,
    hips: [0.1, 0.18, -0.05],
    footL: [-0.16, 0.18, 0.04],
    toeR: 0.7,
  },
  { at: 0.38, grip: [0.36, -0.1, 0.08], head: COILED_DEEP, edge: swept(COILED_DEEP), turn: 1.2, lean: 0.12, hipTurn: 0.62, hips: [0.11, 0.2, -0.07] },
  // The hips snap round first. The hands lead across the belly and the head trails out to the right.
  {
    at: 0.45,
    ease: 'easeIn',
    grip: [0.1, -0.2, 0.42],
    head: AXE_RIGHT,
    edge: swept(AXE_RIGHT),
    turn: 0.08,
    lean: 0.16,
    hipTurn: -0.35,
    hipRoll: 0,
    hips: [0.02, 0.24, 0.08],
    footL: [-0.2, 0.42, 0.02],
    toeL: 0.25,
  },
  // Impact: dead ahead at waist height with the arms long, and the hips already well past it.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [-0.22, -0.2, 0.42],
    head: AXE_AHEAD,
    edge: swept(AXE_AHEAD),
    turn: -0.7,
    lean: 0.18,
    hipTurn: -0.9,
    hipRoll: -0.05,
    hips: [-0.04, 0.26, 0.14],
    footL: [-0.2, 0.46, 0],
    footR: [0.19, -0.22, 0.07],
    toeL: 0.45,
    toeR: 0.05,
  },
  // Follow-through: momentum takes the hips round further, the back foot pivoting on its toes.
  {
    at: 0.6,
    ease: 'easeOut',
    grip: [-0.36, -0.18, 0.24],
    head: AXE_PAST,
    edge: swept(AXE_PAST),
    turn: -1.2,
    lean: 0.16,
    hipTurn: -1.1,
    hipRoll: -0.08,
    hips: [-0.09, 0.26, 0.17],
    footR: [0.17, -0.2, 0.08],
    toeR: -0.35,
  },
  { at: 0.72, ease: 'easeOut', grip: [-0.34, -0.12, 0.28], head: AXE_LEFT, edge: swept(AXE_LEFT), turn: -1.22, lean: 0.12, hipTurn: -1.1, hips: [-0.1, 0.25, 0.17] },
  // Hauling the weight up in front of the face and across, the hips unwinding under it.
  {
    at: 0.88,
    grip: [-0.02, 0.06, 0.4],
    head: AXE_RISING,
    edge: pitched(AXE_RISING),
    turn: -0.3,
    lean: 0.06,
    hipTurn: -0.3,
    hipRoll: 0,
    hips: [-0.02, 0.2, 0.08],
    footL: [-0.18, 0.32, 0.12],
    footR: [0.19, -0.22, 0.02],
    toeL: 0.15,
    toeR: 0.4,
  },
  // Back on the shoulder: where the chop begins.
  { ...AXE_IDLE, at: 1, ease: 'easeOut' },
];

const CHOP_HIGH: Vec3 = [0.5, 0.72, -0.48];
const CHOP_TOP: Vec3 = [0.46, 0.7, -0.55];
const CHOP_FALLING: Vec3 = [0.05, 0.96, 0.25];
const CHOP_HIT: Vec3 = [-0.42, -0.32, 0.85];
const CHOP_PAST: Vec3 = [-0.75, -0.55, 0.36];
const CHOP_HAUL: Vec3 = [-0.1, 0.92, 0.3];

/** The diagonal chop: from high on the right, down across the body to the left hip. */
const AXE_CHOP: AttackKey[] = [
  // The axe lifts off the shoulder, the chest opening and the weight going back.
  {
    at: 0.3,
    grip: [0.25, 0.24, 0.14],
    head: CHOP_HIGH,
    edge: pitched(CHOP_HIGH),
    turn: 0.82,
    lean: -0.14,
    hipTurn: 0.48,
    hipRoll: 0.06,
    hips: [0.07, 0.11, -0.05],
    footL: [-0.16, 0.18, 0.05],
  },
  { at: 0.4, ease: 'linear', grip: [0.25, 0.28, 0.13], head: CHOP_TOP, edge: pitched(CHOP_TOP), turn: 0.9, lean: -0.18, footL: [-0.17, 0.26, 0.12] },
  // Hips first, then the arms come over with the head still high.
  {
    at: 0.46,
    ease: 'easeIn',
    grip: [0.18, 0.2, 0.42],
    head: CHOP_FALLING,
    edge: pitched(CHOP_FALLING),
    turn: 0.3,
    lean: 0.1,
    hipTurn: -0.05,
    hipRoll: 0,
    hips: [0, 0.2, 0.1],
    footL: [-0.2, 0.44, 0.06],
  },
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.16, -0.14, 0.44],
    head: CHOP_HIT,
    edge: [-0.72, -0.64, -0.11],
    turn: -0.12,
    lean: 0.42,
    hipTurn: -0.28,
    hipTilt: 0.14,
    hipRoll: -0.04,
    hips: [-0.03, 0.3, 0.16],
    footL: [-0.2, 0.5, 0],
    footR: [0.19, -0.22, 0.06],
    toeL: 0.2,
  },
  // Carried on down past the left knee, the back heel coming up as the body is pulled after it.
  {
    at: 0.6,
    ease: 'easeOut',
    grip: [-0.14, -0.36, 0.38],
    head: CHOP_PAST,
    edge: [-0.55, 0.75, -0.0],
    turn: -0.62,
    lean: 0.56,
    hipTurn: -0.55,
    hipRoll: -0.08,
    hips: [-0.08, 0.36, 0.18],
    footR: [0.18, -0.22, 0.08],
    toeR: 0.1,
  },
  { at: 0.72, grip: [-0.14, -0.36, 0.38], head: CHOP_PAST, edge: [-0.55, 0.75, -0.0], turn: -0.58, lean: 0.52, hips: [-0.08, 0.34, 0.17] },
  // Hauled up and back onto the shoulder.
  {
    at: 0.88,
    grip: [0.1, 0.02, 0.4],
    head: CHOP_HAUL,
    edge: pitched(CHOP_HAUL),
    turn: 0.05,
    lean: 0.2,
    hipTurn: 0,
    hipTilt: 0.05,
    hipRoll: 0,
    hips: [0, 0.22, 0.08],
    footL: [-0.18, 0.32, 0.12],
    footR: [0.19, -0.22, 0.02],
    toeR: 0.4,
  },
  { ...AXE_IDLE, at: 1, ease: 'easeOut' },
];

export const DOUBLE_AXE: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  stance: { idle: AXE_IDLE, walk: AXE_WALK, run: SHOULDER_CARRY },
  attacks: [{ keys: AXE_SWEEP }, { keys: AXE_CHOP }],
};
