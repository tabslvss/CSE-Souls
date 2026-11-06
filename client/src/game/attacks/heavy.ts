import type { AttackKey, Pose, Vec3, WeaponMoves } from './types';

/*
 * Heavy weapons: both hands low on a very long haft, swung with the whole body. The weapon is the heavy
 * thing here and the body works around it. A steady hoist, a short hang at the top, a strike over in a few
 * frames, then the weight carries everything past the target and has to be hauled back.
 *
 * Every strike lunges: the hips start early and travel evenly, and the chest goes out over the front knee, so
 * that the head arrives about as far away as the rules say it hits. Only the weapon snaps. There's about 1.9 m
 * of weapon past the right hand, so the head also has to stay clear of the floor on anything that swings low.
 *
 * The left hand sits near the butt, so it's the one that's close to the body. The hands stay out in front of
 * the belly, and that's what keeps the left arm from having to go through the torso to reach them.
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

/** How far ahead of the middle of the foot its ball is. A foot's toe angle turns it around the middle. */
const BALL_AHEAD = 0.055;
/** The back foot's ball in the fighting stance: right, forward. */
const BACK_BALL = [0.221, -0.175] as const;

/**
 * The back foot pushing or pivoting without sliding: the ball stays where it is, and the foot turns and lifts
 * its heel around it. Lift goes up to about 0.08 with the toes still on the floor.
 */
const pivot = (toe: number, lift: number): Pick<Pose, 'footR' | 'toeR'> => ({
  footR: [BACK_BALL[0] - BALL_AHEAD * Math.sin(toe), BACK_BALL[1] - BALL_AHEAD * Math.cos(toe), lift],
  toeR: toe,
});

/** The double axe rides on the right shoulder for running, the left hand low on the haft in front. */
const SHOULDER_CARRY: Pose = {
  grip: [0.18, 0.06, 0.23],
  head: [0.4, 0.42, -0.82],
  edge: pitched([0.4, 0.42, -0.82]),
  turn: 0.32,
  lean: 0.16,
};

const HAMMER_LOW: Vec3 = [-0.12, -0.27, 0.95];

/** The hammer is too heavy to hold up for long: side-on and sunk at the knees, hands out in front of the belly, the head resting on the floor. */
const HAMMER_IDLE: Pose = {
  grip: [0.1, -0.2, 0.38],
  head: HAMMER_LOW,
  edge: pitched(HAMMER_LOW),
  turn: 0.42,
  lean: 0.34,
  hipTurn: 0.3,
  hipTilt: 0.06,
  hipRoll: 0,
  hips: [0.03, 0.2, 0],
  footL: [-0.16, 0.16, 0],
  footR: [0.19, -0.22, 0],
  toeL: 0.05,
  toeR: 0.6,
};

// The jog and walk clips pitch the chest well forward, and poses go with it, so these look high on paper.
const HAMMER_PORT: Vec3 = [-0.4, 0.78, 0.48];
const HAMMER_WALK_LOW: Vec3 = [-0.14, 0.36, 0.92];

const HAMMER_WALK: Pose = { ...HAMMER_IDLE, grip: [0.06, 0.06, 0.5], head: HAMMER_WALK_LOW, edge: pitched(HAMMER_WALK_LOW), turn: 0.26, hips: undefined, hipTurn: undefined, hipTilt: undefined, footL: undefined, footR: undefined, toeL: undefined, toeR: undefined };

/**
 * Running with it across the body, the head out in front and to the left. It's the same side as the idle, so
 * starting to run only lifts the head. A shoulder carry would have to swing it round under the legs.
 */
const HAMMER_RUN: Pose = {
  grip: [0.02, 0.24, 0.52],
  head: HAMMER_PORT,
  edge: pitched(HAMMER_PORT),
  turn: 0.2,
  lean: 0.3,
};

const GATHER: Vec3 = [0.02, 0.16, 0.99];
const HOISTING: Vec3 = [0.14, 0.9, 0.36];
const HOIST_PAST: Vec3 = [0.22, 0.95, -0.08];
const HOIST: Vec3 = [0.25, 0.82, -0.45];
const HOIST_TOP: Vec3 = [0.25, 0.8, -0.5];
const OVERHEAD: Vec3 = [0.22, 0.88, -0.35];
const FLOORED: Vec3 = [-0.2, -0.1, 0.97];
const REBOUND: Vec3 = [-0.2, -0.06, 0.98];
const SUNK: Vec3 = [-0.2, -0.08, 0.97];
const LEVERED: Vec3 = [-0.16, -0.14, 0.96];
const LETTING_GO: Vec3 = [-0.14, -0.22, 0.95];

/** The overhead slam: hoisted behind the right shoulder, driven into the floor, then dragged back up. */
const HAMMER_SLAM: AttackKey[] = [
  // Gathering: the hands start up first, with the head still low behind them, and the knees loading.
  {
    at: 0.1,
    grip: [0.14, -0.14, 0.38],
    head: GATHER,
    edge: pitched(GATHER),
    turn: 0.7,
    lean: 0.28,
    hipTurn: 0.38,
    hips: [0.05, 0.24, -0.02],
  },
  // The lift is one steady heave, with the knees still loading.
  {
    at: 0.25,
    ease: 'linear',
    grip: [0.18, 0.1, 0.32],
    head: HOISTING,
    edge: pitched(HOISTING),
    turn: 0.72,
    lean: -0.08,
    hipTurn: 0.4,
    hips: [0.06, 0.2, -0.06],
    footL: [-0.16, 0.17, 0.02],
  },
  // Over the right shoulder, the back arching furthest here, before the hammer has even finished rising.
  { at: 0.33, ease: 'linear', grip: [0.22, 0.24, 0.2], head: HOIST_PAST, edge: pitched(HOIST_PAST), turn: 0.76, lean: -0.5, hipTurn: 0.42, hipTilt: -0.12, hips: [0.07, 0.1, -0.09], footL: [-0.16, 0.19, 0.05] },
  {
    at: 0.385,
    ease: 'linear',
    grip: [0.24, 0.3, 0.02],
    head: HOIST,
    edge: pitched(HOIST),
    turn: 0.74,
    lean: -0.3,
    hipTurn: 0.38,
    hipTilt: -0.08,
    hips: [0.065, 0.1, -0.04],
    footL: [-0.16, 0.24, 0.1],
  },
  // The hang at the top. The hammer waits, but the hips have already started forward under it.
  { at: 0.42, ease: 'linear', grip: [0.24, 0.31, -0.06], head: HOIST_TOP, edge: pitched(HOIST_TOP), turn: 0.6, lean: -0.02, hipTurn: 0.22, hipTilt: 0, hips: [0.05, 0.13, 0.06], footL: [-0.16, 0.36, 0.16] },
  // Hips first: they have come round by the time the hammer passes overhead.
  {
    at: 0.45,
    ease: 'linear',
    grip: [0.18, 0.3, 0.2],
    head: OVERHEAD,
    edge: pitched(OVERHEAD),
    turn: 0.3,
    lean: 0.34,
    hipTurn: 0.02,
    hipTilt: 0.12,
    hips: [0.03, 0.18, 0.2],
    footL: [-0.15, 0.66, 0.16],
    ...pivot(0.5, 0.05),
  },
  // Impact: the front foot stamps far out, the chest goes over it, and the head of the hammer lands on the floor.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.04, -0.38, 0.5],
    head: FLOORED,
    edge: pitched(FLOORED),
    turn: -0.06,
    lean: 0.94,
    hipTurn: -0.14,
    hipTilt: 0.34,
    hips: [-0.02, 0.36, 0.44],
    footL: [-0.14, 0.76, 0],
    ...pivot(0.3, 0.08),
    toeL: 0.1,
  },
  // The hammer bounces a little on the floor while momentum carries the body down after it.
  { at: 0.54, ease: 'easeOut', grip: [0.04, -0.36, 0.5], head: REBOUND, edge: pitched(REBOUND), turn: -0.1, lean: 1.04, hips: [-0.03, 0.43, 0.46] },
  { at: 0.6, grip: [0.04, -0.32, 0.48], head: SUNK, edge: pitched(SUNK), turn: -0.1, lean: 1.06, hips: [-0.03, 0.46, 0.45] },
  // The chest heaves up, and it doesn't stop until the hammer has come with it.
  { at: 0.68, grip: [0.05, -0.31, 0.47], head: SUNK, edge: pitched(SUNK), turn: -0.04, lean: 0.92, hips: [-0.03, 0.4, 0.42] },
  // The effort: the body straightens first while the hammer stays down, levered up by the butt.
  {
    at: 0.8,
    grip: [0.1, -0.3, 0.42],
    head: LEVERED,
    edge: pitched(LEVERED),
    turn: 0.2,
    lean: 0.66,
    hipTurn: 0.04,
    hipTilt: 0.2,
    hips: [0, 0.32, 0.3],
    footL: [-0.14, 0.76, 0.08],
    ...pivot(0.4, 0.03),
  },
  // Only then does the front foot let go and step back under the body.
  {
    at: 0.9,
    ease: 'linear',
    grip: [0.1, -0.27, 0.4],
    head: LETTING_GO,
    edge: pitched(LETTING_GO),
    turn: 0.46,
    lean: 0.48,
    hipTurn: 0.2,
    hipTilt: 0.1,
    hips: [0.02, 0.26, 0.12],
    footL: [-0.16, 0.4, 0.14],
    ...pivot(0.6, 0),
    toeL: 0.08,
  },
  { at: 0.955, ease: 'linear', grip: [0.1, -0.22, 0.38], head: [-0.13, -0.23, 0.96], edge: pitched([-0.13, -0.23, 0.96]), turn: 0.44, lean: 0.4, hipTurn: 0.26, hipTilt: 0.08, hips: [0.025, 0.23, 0.05], footL: [-0.16, 0.2, 0.1] },
  // Ends with the head back on the floor: where the rising swing begins.
  { ...HAMMER_IDLE, at: 1, ease: 'linear' },
];

const DRAGGING: Vec3 = [0.5, -0.25, 0.83];
const DRAGGED_WIDE: Vec3 = [0.92, -0.2, 0.2];
const TRAILING: Vec3 = [0.75, -0.16, -0.55];
const TRAILING_DEEP: Vec3 = [0.72, -0.13, -0.62];
// Rolled down a little from where a flat swing would put it, so that the right wrist isn't wrung while it waits.
const TRAILING_EDGE: Vec3 = [0.3, -0.6, 0.72];
const SCYTHING: Vec3 = [0.9, -0.2, -0.1];
const RISING: Vec3 = [-0.25, 0.22, 0.94];
const RISING_EDGE: Vec3 = [-0.7, -0.4, 0.15];
const CARRIED: Vec3 = [-0.68, 0.62, -0.25];
const CARRIED_HANG: Vec3 = [-0.66, 0.6, -0.3];
const LETTING_FALL: Vec3 = [-0.72, 0.6, 0.16];
const DROPPING: Vec3 = [-0.46, 0.1, 0.88];
const FALLING: Vec3 = [-0.19, -0.24, 0.95];

/** The rising haymaker: from low in front, dragged back past the right leg, then swung up through the middle. */
const HAMMER_HAYMAKER: AttackKey[] = [
  // Dragged out wide past the right side, the head skimming the floor, and the torso coiling low over the back foot.
  { at: 0.12, ease: 'smooth', grip: [0.26, -0.24, 0.32], head: DRAGGING, edge: [-0.2, -0.75, 0.3], turn: 0.72, lean: 0.36, hipTurn: 0.42, hips: [0.05, 0.22, -0.01] },
  { at: 0.24, ease: 'linear', grip: [0.36, -0.24, 0.26], head: DRAGGED_WIDE, edge: [-0.05, -0.55, 0.8], turn: 0.86, lean: 0.38, hipTurn: 0.5, hips: [0.08, 0.26, -0.04] },
  {
    at: 0.36,
    ease: 'linear',
    grip: [0.44, -0.22, 0.18],
    head: TRAILING,
    edge: TRAILING_EDGE,
    turn: 1.02,
    lean: 0.4,
    hipTurn: 0.58,
    hipTilt: 0.08,
    hipRoll: 0.06,
    hips: [0.1, 0.3, -0.06],
    footL: [-0.16, 0.18, 0.05],
  },
  { at: 0.41, ease: 'linear', grip: [0.44, -0.22, 0.18], head: TRAILING_DEEP, edge: TRAILING_EDGE, turn: 1.04, lean: 0.4, hipTurn: 0.56, hips: [0.09, 0.32, 0.02], footL: [-0.16, 0.24, 0.07] },
  // The back foot drives, the hips rise and fire, and the left foot reaches out, while the head scythes round low on the right.
  {
    at: 0.45,
    ease: 'linear',
    grip: [0.31, -0.25, 0.36],
    head: SCYTHING,
    edge: [0.05, -0.5, 0.85],
    turn: 0.5,
    lean: 0.42,
    hipTurn: 0.04,
    hipRoll: 0.02,
    hips: [0.04, 0.27, 0.22],
    footL: [-0.17, 0.56, 0.14],
    ...pivot(0.5, 0.05),
  },
  // Impact: rising through the middle at chest height, arms long, the whole body climbing off the back foot.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.08, -0.14, 0.52],
    head: RISING,
    edge: RISING_EDGE,
    turn: -0.02,
    lean: 0.72,
    hipTurn: -0.36,
    hipTilt: 0.3,
    hipRoll: -0.06,
    hips: [-0.02, 0.24, 0.38],
    footL: [-0.16, 0.66, 0],
    ...pivot(0.3, 0.08),
  },
  // Follow-through: carried on up behind the left shoulder, the hips still climbing and the back foot turning on its ball.
  {
    at: 0.66,
    ease: 'smooth',
    grip: [-0.24, 0.2, 0.32],
    head: CARRIED,
    edge: pitched(CARRIED),
    turn: -0.8,
    lean: 0.12,
    hipTurn: -0.72,
    hipTilt: 0.06,
    hipRoll: -0.1,
    hips: [-0.08, 0.18, 0.28],
    ...pivot(-0.15, 0.08),
  },
  // It hangs up there for an instant before the weight wins.
  { at: 0.705, ease: 'linear', grip: [-0.2, 0.19, 0.3], head: CARRIED_HANG, edge: pitched(CARRIED_HANG), turn: -0.78, lean: 0.12, hipTurn: -0.7, hips: [-0.08, 0.18, 0.27] },
  // Then one long slow fall in front, with no key stopping it, and the front foot coming home underneath.
  { at: 0.77, ease: 'linear', grip: [-0.28, 0.1, 0.45], head: LETTING_FALL, edge: pitched(LETTING_FALL), turn: -0.56, lean: 0.14, hipTurn: -0.56, hips: [-0.06, 0.18, 0.25], footL: [-0.16, 0.66, 0.08], ...pivot(-0.05, 0.06) },
  { at: 0.88, ease: 'linear', grip: [-0.14, -0.08, 0.44], head: DROPPING, edge: [-0.5, -0.2, 0.55], turn: -0.1, lean: 0.24, hipTurn: -0.1, hipRoll: -0.04, hips: [-0.02, 0.17, 0.17], footL: [-0.17, 0.5, 0.1], ...pivot(0.3, 0.03) },
  {
    at: 0.955,
    ease: 'linear',
    grip: [0.02, -0.18, 0.42],
    head: FALLING,
    edge: pitched(FALLING),
    turn: 0.5,
    lean: 0.3,
    hipTurn: 0.26,
    hipRoll: 0,
    hips: [0.02, 0.19, 0.03],
    footL: [-0.16, 0.24, 0.08],
    ...pivot(0.55, 0),
  },
  { ...HAMMER_IDLE, at: 1, ease: 'linear' },
];

export const WAR_HAMMER: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  life: { sink: 0.03, shift: 0.05, drift: 0.09, resettle: 0.025 },
  stance: { idle: HAMMER_IDLE, walk: HAMMER_WALK, run: HAMMER_RUN },
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

const AXE_RUN_ANGLE: Vec3 = [0.42, 0.22, -0.88];

/** Flatter than the walk, because the jog pitches the chest forward and would swing the butt into the front leg. */
const AXE_RUN: Pose = { ...SHOULDER_CARRY, grip: [0.2, 0.2, 0.24], head: AXE_RUN_ANGLE, edge: pitched(AXE_RUN_ANGLE) };

/**
 * Where each axe swing ends: hauled back to a low guard in front, not all the way onto the shoulder. There's no
 * time left in an attack to swing 2 m of axe that far without it looking weightless, so the shoulder comes
 * later: slowly inside the next wind-up, or in the walk back to the stance when the combo is over.
 */
const AXE_GUARD: Vec3 = [0.28, 0.42, 0.86];
const AXE_GUARD_POSE: Pose = { ...AXE_IDLE, grip: [0.14, -0.08, 0.36], head: AXE_GUARD, edge: pitched(AXE_GUARD), turn: 0.3, lean: 0.2, hips: [0.02, 0.17, 0] };

const COILED: Vec3 = [0.78, 0.14, -0.6];
const COILED_DEEP: Vec3 = [0.68, 0.08, -0.72];
const AXE_RIGHT: Vec3 = [0.9, -0.1, -0.4];
const AXE_AHEAD: Vec3 = [0.1, -0.12, 0.99];
const AXE_LEFT: Vec3 = [-0.84, -0.1, 0.53];
const AXE_LIFT_OFF: Vec3 = [-0.8, 0.02, 0.6];
const AXE_BEGIN_LIFT: Vec3 = [-0.55, 0.24, 0.8];
const AXE_LIFT: Vec3 = [-0.14, 0.38, 0.91];

/**
 * The wide sweep: coiled far to the right, then thrown across at waist height. The shoulders stay ahead of
 * the axe head the whole way, which is what makes the head feel like it's being dragged round.
 */
const AXE_SWEEP: AttackKey[] = [
  // Off the shoulder and out behind, the torso winding up, with the hands wide of the hip.
  { at: 0.18, ease: 'linear', grip: [0.3, -0.08, 0.3], head: [0.78, 0.3, 0.25], edge: swept([0.78, 0.3, 0.25]), turn: 0.7, lean: 0.2, hipTurn: 0.38, hips: [0.06, 0.2, -0.02] },
  {
    at: 0.33,
    ease: 'linear',
    grip: [0.42, -0.08, 0.2],
    head: COILED,
    edge: swept(COILED),
    turn: 1.05,
    lean: 0.2,
    hipTurn: 0.55,
    hipRoll: 0.06,
    hips: [0.1, 0.2, -0.05],
    footL: [-0.16, 0.17, 0.02],
    toeR: 0.7,
  },
  { at: 0.41, ease: 'linear', grip: [0.42, -0.1, 0.2], head: COILED_DEEP, edge: swept(COILED_DEEP), turn: 1.18, lean: 0.24, hipTurn: 0.58, hips: [0.1, 0.22, -0.03], footL: [-0.18, 0.22, 0.03], toeL: 0.2 },
  // The hips snap round first, the left foot skating out low and wide. The hands lead across and the head trails out to the right.
  {
    at: 0.45,
    ease: 'linear',
    grip: [0.18, -0.18, 0.46],
    head: AXE_RIGHT,
    edge: [0.3, -0.2, 0.9],
    turn: 0.2,
    lean: 0.4,
    hipTurn: -0.16,
    hipRoll: 0,
    hips: [0.02, 0.26, 0.24],
    footL: [-0.25, 0.46, 0.04],
    toeL: 0.45,
    ...pivot(0.5, 0.05),
  },
  // Impact: dead ahead at waist height with the arms long, the chest over the front knee, and the hips already well past it.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [-0.14, -0.14, 0.52],
    head: AXE_AHEAD,
    edge: swept(AXE_AHEAD),
    turn: -0.5,
    lean: 0.8,
    hipTurn: -0.7,
    hipTilt: 0.34,
    hipRoll: -0.05,
    hips: [-0.05, 0.34, 0.44],
    footL: [-0.3, 0.68, 0],
    toeL: 0.7,
    ...pivot(0.2, 0.08),
  },
  // Follow-through: momentum takes the hips and head round after it, well past the target, the back foot dragged along.
  { at: 0.56, ease: 'linear', grip: [-0.3, -0.12, 0.46], turn: -1, lean: 0.84, hipTurn: -1.05, hips: [-0.13, 0.37, 0.52], footR: [0.17, -0.12, 0.14], toeR: -0.1 },
  {
    at: 0.64,
    ease: 'easeOut',
    grip: [-0.4, -0.1, 0.36],
    head: AXE_LEFT,
    edge: swept(AXE_LEFT),
    turn: -1.3,
    lean: 0.82,
    hipTurn: -1.35,
    hipRoll: -0.08,
    hips: [-0.2, 0.38, 0.54],
    footR: [0.11, 0.0, 0.07],
    toeR: -0.5,
  },
  // One long haul up the low road in front, the hips unwinding and the torso sagging and rising under it. No key here stops.
  { at: 0.72, ease: 'smooth', grip: [-0.38, -0.1, 0.35], head: AXE_LIFT_OFF, edge: swept(AXE_LIFT_OFF), turn: -1.16, lean: 0.68, hipTurn: -1.22, hipTilt: 0.26, hips: [-0.18, 0.37, 0.5], toeR: -0.4 },
  { at: 0.79, ease: 'linear', grip: [-0.26, -0.06, 0.38], head: AXE_BEGIN_LIFT, edge: [-0.4, -0.39, -0.15], turn: -0.66, lean: 0.42, hipTurn: -0.72, hipTilt: 0.1, hips: [-0.12, 0.33, 0.4], footL: [-0.3, 0.68, 0.08], toeR: -0.2 },
  { at: 0.87, ease: 'linear', grip: [-0.02, -0.08, 0.46], head: AXE_LIFT, edge: pitched(AXE_LIFT), turn: -0.3, lean: 0.38, hipTurn: -0.34, hipTilt: 0.08, hips: [-0.04, 0.26, 0.24], footL: [-0.24, 0.48, 0.14], footR: [0.17, -0.12, 0.13], toeR: 0.15, toeL: 0.35 },
  { at: 0.95, ease: 'linear', grip: [0.08, -0.08, 0.37], head: [0.14, 0.42, 0.9], edge: pitched([0.14, 0.42, 0.9]), turn: 0.2, lean: 0.22, hipTurn: 0.16, hipTilt: 0, hipRoll: 0, hips: [0.01, 0.19, 0.04], footL: [-0.18, 0.24, 0.1], footR: [0.19, -0.22, 0.02], toeR: 0.45, toeL: 0.1 },
  // The low guard: where the chop begins.
  { ...AXE_GUARD_POSE, at: 1 },
];

const CHOP_HIGH: Vec3 = [0.5, 0.74, -0.44];
const CHOP_TOP: Vec3 = [0.5, 0.7, -0.52];
const CHOP_FALLING: Vec3 = [0.05, 0.96, 0.25];
const CHOP_HIT: Vec3 = [-0.12, -0.17, 0.97];
const CHOP_PAST: Vec3 = [-0.72, -0.13, 0.66];
const CHOP_LIFT_OFF: Vec3 = [-0.7, 0.0, 0.7];
// The wrist turns the blade over as it drops, because pulling it straight through would wring the forearm.
const CHOP_PAST_EDGE: Vec3 = [0.35, -0.85, -0.25];
const CHOP_LIFT: Vec3 = [-0.5, 0.24, 0.83];
const CHOP_HAUL: Vec3 = [-0.1, 0.38, 0.92];

/** The diagonal chop: from high on the right, down across the body to the left hip. */
const AXE_CHOP: AttackKey[] = [
  // The axe goes up over the right shoulder, the chest opening and the weight going back.
  {
    at: 0.3,
    grip: [0.25, 0.24, 0.14],
    head: CHOP_HIGH,
    edge: pitched(CHOP_HIGH),
    turn: 0.82,
    lean: -0.36,
    hipTurn: 0.48,
    hipRoll: 0.06,
    hips: [0.07, 0.11, -0.05],
    footL: [-0.16, 0.18, 0.05],
  },
  { at: 0.39, ease: 'linear', grip: [0.25, 0.28, 0.13], head: CHOP_TOP, edge: pitched(CHOP_TOP), turn: 0.84, lean: -0.22, hips: [0.07, 0.13, 0.0], footL: [-0.16, 0.28, 0.14] },
  // Hips first, then the arms come over with the head still high.
  {
    at: 0.45,
    ease: 'linear',
    grip: [0.2, 0.2, 0.42],
    head: CHOP_FALLING,
    edge: pitched(CHOP_FALLING),
    turn: 0.34,
    lean: 0.34,
    hipTurn: 0.02,
    hipRoll: 0,
    hips: [0.01, 0.2, 0.24],
    footL: [-0.17, 0.66, 0.15],
    ...pivot(0.5, 0.05),
  },
  // Impact: the edge stays on the swing's plane until the blow has landed. The wrist only turns afterward.
  {
    at: 0.5,
    ease: 'linear',
    impact: true,
    grip: [0.08, -0.1, 0.58],
    head: CHOP_HIT,
    edge: pitched(CHOP_HIT),
    turn: 0.02,
    lean: 0.92,
    hipTurn: -0.14,
    hipTilt: 0.28,
    hipRoll: -0.04,
    hips: [-0.03, 0.36, 0.46],
    footL: [-0.2, 0.76, 0],
    ...pivot(0.3, 0.08),
    toeL: 0.2,
  },
  // Carried on down past the left knee, the back heel staying up as the body is pulled after it.
  {
    at: 0.6,
    ease: 'easeOut',
    grip: [-0.06, -0.14, 0.64],
    head: CHOP_PAST,
    edge: CHOP_PAST_EDGE,
    turn: -0.24,
    lean: 1,
    hipTurn: -0.34,
    hipRoll: -0.08,
    hips: [-0.08, 0.42, 0.46],
    ...pivot(0.1, 0.08),
  },
  // One long haul up in front, with no key stopping it. The foot only lets go once the weight is coming up.
  { at: 0.68, ease: 'smooth', grip: [-0.08, -0.12, 0.64], head: CHOP_LIFT_OFF, edge: [0.2, -0.75, -0.25], turn: -0.2, lean: 0.92, hipTurn: -0.3, hips: [-0.07, 0.4, 0.44] },
  { at: 0.76, ease: 'linear', grip: [-0.06, -0.1, 0.6], head: CHOP_LIFT, edge: pitched(CHOP_LIFT), turn: -0.1, lean: 0.68, hipTurn: -0.16, hipTilt: 0.16, hips: [-0.05, 0.33, 0.34], footL: [-0.2, 0.76, 0.08], ...pivot(0.2, 0.05) },
  {
    at: 0.86,
    ease: 'linear',
    grip: [0.02, -0.09, 0.5],
    head: CHOP_HAUL,
    edge: pitched(CHOP_HAUL),
    turn: 0.1,
    lean: 0.4,
    hipTurn: 0.04,
    hipTilt: 0.05,
    hipRoll: 0,
    hips: [0, 0.25, 0.2],
    footL: [-0.18, 0.5, 0.1],
    ...pivot(0.45, 0.02),
  },
  { at: 0.95, ease: 'linear', grip: [0.12, -0.08, 0.37], head: [0.14, 0.42, 0.9], edge: pitched([0.14, 0.42, 0.9]), turn: 0.24, lean: 0.26, hipTurn: 0.18, hips: [0.01, 0.19, 0.05], footL: [-0.16, 0.24, 0.1], ...pivot(0.55, 0) },
  { ...AXE_GUARD_POSE, at: 1 },
];

export const DOUBLE_AXE: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Jog_Fwd_Loop',
  life: { sink: 0.025, shift: 0.05, drift: 0.08 },
  stance: { idle: AXE_IDLE, walk: AXE_WALK, run: AXE_RUN },
  attacks: [{ keys: AXE_SWEEP }, { keys: AXE_CHOP }],
};
