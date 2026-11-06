import type { Attack, AttackKey, Pose, Vec3, WeaponMoves } from './types';

/*
 * Archery: a right-handed archer holds the bow in the left hand and draws with the right. `edge` is
 * the way the arrow flies. The arrow lies along the bow's own forward line, so the draw hand ends up
 * at the jaw only when `draw` is long enough to bring the string back there from the bow hand.
 *
 * The shot turns the whole body side-on: the left shoulder and left foot go toward the target, and both
 * feet end up across the line of the shot. The release is the impact key.
 */

const BOW_IDLE: Pose = {
  grip: [-0.26, -0.36, 0.17],
  head: [-0.2, 0.62, 0.76],
  edge: [0.1, -0.76, 0.62],
  hips: [0.01, 0.09, 0],
  hipTurn: 0.22,
  hipRoll: 0.03,
  turn: 0.34,
  lean: 0.08,
  footL: [-0.13, 0.13, 0],
  footR: [0.15, -0.11, 0],
  toeL: 0.05,
  toeR: 0.5,
  headFollow: 0,
  freeHand: { position: [0.25, -0.36, 0.06], fingers: 0.35 },
};
/* The walk and run clips pitch the chest well forward, so the carry is set steeper than it looks. */
const BOW_WALK: Pose = {
  grip: [-0.26, -0.36, 0.17],
  head: [-0.15, 0.9, 0.42],
  edge: [0.05, -0.42, 0.9],
  hips: [0, 0.04, 0],
  turn: 0.14,
  lean: 0.04,
};
const BOW_RUN: Pose = {
  grip: [-0.3, -0.24, 0.16],
  head: [-0.1, 0.97, 0.2],
  edge: [0.05, -0.2, 0.97],
  lean: 0.12,
};

/* The longbow is drawn high and brought down to the anchor, with a long stride and an upright back. */
const LONGBOW_SHOT: AttackKey[] = [
  // Reaches back to the quiver at the right hip, while the weight sinks and the shoulders start round.
  { at: 0.1, grip: [-0.24, -0.27, 0.27], head: [-0.2, 0.74, 0.6], edge: [0.1, -0.6, 0.74],
    draw: 0, hips: [0.03, 0.1, -0.03], hipTurn: 0.34, turn: 0.42, lean: 0.1, headFollow: 0,
    footL: [-0.13, 0.15, 0.03], footR: [0.13, -0.15, 0], toeR: 0.75,
    freeHand: { position: [0.26, -0.24, -0.25], fingers: 0.75 } },
  // The arrow comes up to the string as the left foot steps across, the bow rising in front of the belt.
  { at: 0.22, grip: [-0.12, -0.05, 0.47], head: [-0.32, 0.92, 0.2], edge: [0.05, -0.1, 1],
    draw: 0.04, hips: [0.02, 0.11, 0.0], hipTurn: 0.72, turn: 0.86, lean: 0.06,
    footL: [-0.06, 0.25, 0.09], footR: [0.07, -0.2, 0], toeL: -0.3, toeR: 1.15,
    freeHand: { position: [0.1, 0.0, 0.1], fingers: 0.75 } },
  // Bow high, the draw starting from above: the big readable wind-up.
  { at: 0.34, grip: [0.04, 0.4, 0.6], head: [-0.1, 0.98, -0.16], edge: [0, 0.2, 1],
    draw: 0.6, hips: [0, 0.1, -0.01], hipTurn: 1.0, turn: 1.22, lean: -0.08,
    footL: [-0.03, 0.27, 0], footR: [0.05, -0.22, 0], toeL: -0.72, toeR: 1.38 },
  // Down to the anchor: draw hand at the jaw with the elbow high, bow arm straight at the target.
  { at: 0.47, grip: [0.08, 0.25, 0.65], head: [-0.08, 1, 0], edge: [0, 0, 1],
    draw: 1.06, hips: [0, 0.09, 0], hipTurn: 1.08, turn: 1.32, lean: -0.05 },
  // The tense hold: nothing moves but a last creep of the string and the shoulder blades closing.
  { at: 0.565, grip: [0.08, 0.255, 0.655], draw: 1.1, turn: 1.36, lean: -0.07,
    freeHand: { position: [0.14, 0.3, -0.2], fingers: 0.05 } },
  { at: 0.58, ease: 'linear', impact: true, draw: 0 },
  // The draw hand has flown back past the ear, and the bow arm kicks out and down from the shock.
  { at: 0.65, ease: 'easeOut', grip: [-0.02, 0.26, 0.66], head: [-0.28, 0.96, 0.02], edge: [-0.1, 0.05, 1],
    turn: 1.46, lean: -0.1, hipTurn: 1.14, hips: [0, 0.1, -0.02],
    freeHand: { position: [0.2, 0.3, -0.34], fingers: 0.02 } },
  // Holds there a moment, watching the arrow go.
  { at: 0.76, grip: [-0.04, 0.23, 0.65], head: [-0.3, 0.95, 0.06], turn: 1.42, lean: -0.07,
    freeHand: { position: [0.28, 0.16, -0.3], fingers: 0.12 } },
  // Lowers the bow while turning back, without hurrying, and the spent hand falls to the side.
  { at: 0.92, grip: [-0.2, -0.16, 0.42], head: [-0.2, 0.8, 0.5], edge: [0.1, -0.5, 0.8],
    turn: 0.8, hipTurn: 0.62, hips: [0.01, 0.09, 0], lean: 0.02,
    footL: [-0.09, 0.2, 0], footR: [0.11, -0.16, 0], toeL: -0.2, toeR: 0.9,
    freeHand: { position: [0.28, -0.3, -0.06], fingers: 0.3 } },
];

export const LONGBOW: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Sprint_Loop',
  stance: { idle: BOW_IDLE, walk: BOW_WALK, run: BOW_RUN },
  attacks: [{ keys: LONGBOW_SHOT }],
};

/* The shortbow is snapped up from low, in a crouch with the bow canted across the body. */
const SHORTBOW_IDLE: Pose = {
  ...BOW_IDLE,
  grip: [-0.24, -0.3, 0.26],
  head: [-0.12, 0.74, 0.66],
  edge: [0.1, -0.66, 0.74],
  hips: [0.01, 0.11, 0.02],
  lean: 0.14,
};
const SHORTBOW_WALK: Pose = {
  ...BOW_WALK,
  grip: [-0.24, -0.3, 0.26],
  hips: [0, 0.07, 0],
  lean: 0.1,
};

const SHORTBOW_SHOT: AttackKey[] = [
  { at: 0.12, grip: [-0.2, -0.2, 0.36], head: [-0.1, 0.82, 0.54], edge: [0.1, -0.54, 0.82],
    draw: 0, hips: [0.02, 0.15, 0], hipTurn: 0.42, turn: 0.5, lean: 0.2, headFollow: 0,
    footL: [-0.12, 0.2, 0.05], footR: [0.13, -0.14, 0], toeR: 0.8,
    freeHand: { position: [0.26, -0.2, -0.2], fingers: 0.7 } },
  // Nocked on the way up, the bow already leaning over.
  { at: 0.26, grip: [-0.08, 0.0, 0.5], head: [0.2, 0.95, 0.2], edge: [-0.1, -0.1, 1],
    draw: 0.1, hips: [0.01, 0.17, 0.06], hipTurn: 0.72, turn: 0.82, lean: 0.22,
    footL: [-0.09, 0.3, 0], footR: [0.1, -0.17, 0.02], toeL: -0.2, toeR: 1.05,
    freeHand: { position: [0.1, 0.02, 0.15], fingers: 0.7 } },
  // Anchored at the chin, low and forward, the top of the bow canted over to the right.
  { at: 0.42, ease: 'easeOut', grip: [0.08, 0.23, 0.66], head: [0.26, 0.96, 0.08], edge: [-0.03, -0.08, 1],
    draw: 1.23, hips: [0, 0.18, 0.09], hipTurn: 0.84, turn: 1.02, lean: 0.2, footR: [0.1, -0.17, 0.04] },
  { at: 0.565, grip: [0.08, 0.235, 0.67], draw: 1.28, turn: 1.06,
    freeHand: { position: [0.14, 0.22, -0.14], fingers: 0.05 } },
  { at: 0.58, ease: 'linear', impact: true, draw: 0 },
  // A flick rather than a heave, and it's ready again sooner.
  { at: 0.66, ease: 'easeOut', grip: [-0.02, 0.24, 0.67], head: [0.2, 0.97, 0.1], edge: [-0.12, -0.03, 1],
    turn: 1.12, hips: [0, 0.17, 0.06],
    freeHand: { position: [0.2, 0.2, -0.28], fingers: 0.05 } },
  { at: 0.84, grip: [-0.2, -0.18, 0.4], head: [-0.06, 0.82, 0.54], edge: [0.1, -0.54, 0.82],
    turn: 0.55, hipTurn: 0.42, lean: 0.17, hips: [0.01, 0.13, 0.03],
    footL: [-0.12, 0.2, 0], footR: [0.13, -0.13, 0], toeL: 0, toeR: 0.7,
    freeHand: { position: [0.26, -0.32, 0], fingers: 0.3 } },
];

export const SHORTBOW: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Sprint_Loop',
  stance: { idle: SHORTBOW_IDLE, walk: SHORTBOW_WALK, run: BOW_RUN },
  attacks: [{ keys: SHORTBOW_SHOT }],
};

/** Until the armory picks a bow for each, both use this one. */
export const BOW = LONGBOW;

/*
 * Spear: rear hand at the hip, lead hand out along the shaft, shoulders turned side-on. `reach` is how
 * far up the shaft the left hand is from the right, as a negative number. Hands slide on the shaft: the
 * rear hand pulls back on the wind-up and catches up with the lead hand in the thrust.
 */

/** From the right hand to the point on the 1.9 m shaft. */
const SPEAR_LENGTH = 1.33;
/** Where the chest is when standing, as [right, up, forward]. */
const CHEST = [0, 1.305, -0.038] as const;

/**
 * The way the shaft points so that its point is at this sideways position and height on the ground's
 * frame. Used on each key of a thrust, so that the point runs along a line while the body moves under it.
 */
const pointAt = (grip: Vec3, hips: Vec3, right: number, up: number): Vec3 => {
  const x = right - (CHEST[0] + hips[0] + grip[0]);
  const y = up - (CHEST[1] - hips[1] + grip[1]);
  return [x, y, Math.sqrt(Math.max(0.01, SPEAR_LENGTH * SPEAR_LENGTH - x * x - y * y))];
};

/** Knuckles down the shaft's underside, for a hand held low. */
const underEdge = (head: Vec3): Vec3 => {
  const size = Math.hypot(head[0], head[1], head[2]);
  const [x, y, z] = [head[0] / size, head[1] / size, head[2] / size];
  // The part of "down and slightly out" that's square to the shaft.
  const dot = 0.1 * x - y;
  return [0.1 - dot * x, -1 - dot * y, -dot * z];
};

/** A key with the shaft worked out from the grip and the hips, aiming the point at [right, up]. */
const shaft = (grip: Vec3, hips: Vec3, tip: readonly [number, number]) => {
  const head = pointAt(grip, hips, tip[0], tip[1]);
  return { grip, hips, head, edge: underEdge(head) };
};

/* The point rides at chest height, low hand at the hip. */
const SPEAR_GUARD_HIPS: Vec3 = [0.02, 0.13, -0.02];
const SPEAR_IDLE: Pose = {
  ...shaft([0.2, -0.2, 0], SPEAR_GUARD_HIPS, [-0.06, 1.3]),
  reach: -0.52,
  hipTurn: 0.62,
  hipRoll: 0.04,
  turn: 0.82,
  lean: 0.08,
  footL: [-0.1, 0.24, 0],
  footR: [0.13, -0.24, 0],
  toeL: -0.25,
  toeR: 0.95,
  headFollow: 0,
};
const SPEAR_WALK: Pose = {
  grip: [0.2, -0.2, 0],
  hips: [0, 0.07, 0],
  head: [-0.1, 0.83, 0.55],
  edge: [0.1, -0.55, 0.83],
  reach: -0.52,
  turn: 0.55,
  lean: 0.08,
};
const SPEAR_RUN: Pose = {
  grip: [0.16, -0.2, 0.1],
  head: [-0.1, 0.95, 0.3],
  edge: [0.1, -0.3, 0.95],
  reach: -0.52,
  turn: 0.35,
  lean: 0.14,
};

/* Where the first attack ends and the second begins: pulled back from the lunge, but still far forward. */
const SPEAR_CHAIN_HIPS: Vec3 = [0.02, 0.15, 0.12];
const SPEAR_CHAIN: AttackKey = {
  at: 1,
  ...shaft([0.2, -0.17, 0], SPEAR_CHAIN_HIPS, [-0.04, 1.32]),
  reach: -0.5,
  hipTurn: 0.6,
  turn: 0.78,
  lean: 0.1,
  footL: [-0.1, 0.42, 0],
  footR: [0.13, -0.14, 0],
  toeL: -0.25,
  toeR: 0.95,
};

const THRUST_LINE = [-0.02, 1.2] as const;
const SPEAR_THRUST: AttackKey[] = [
  // Sinks back over the rear foot, and the rear hand draws the shaft back through the lead hand.
  { at: 0.14, ...shaft([0.28, -0.16, -0.24], [0.05, 0.19, -0.14], THRUST_LINE),
    reach: -0.72, hipTurn: 0.86, hipTilt: 0.02, turn: 1.14, lean: 0.03, headFollow: 0,
    footL: [-0.1, 0.27, 0.01], footR: [0.15, -0.28, 0], toeL: -0.3, toeR: 1.05 },
  // Held, with the front foot just unweighting: all the tension before the drive.
  { at: 0.3, ...shaft([0.29, -0.16, -0.27], [0.05, 0.2, -0.16], THRUST_LINE),
    reach: -0.74, hipTurn: 0.9, turn: 1.2, lean: 0.02,
    footL: [-0.1, 0.29, 0.05] },
  // The stride opens and the hips go first, while the shoulders are still back.
  { at: 0.4, ease: 'easeIn', ...shaft([0.25, -0.15, -0.14], [0.02, 0.19, 0.1], THRUST_LINE),
    reach: -0.66, hipTurn: 0.5, turn: 1.04, lean: 0.1,
    footL: [-0.1, 0.6, 0.12], footR: [0.14, -0.28, 0.04], toeL: -0.15 },
  // Foot down, shoulders through, arms out, and the rear hand runs up the shaft.
  { at: 0.48, ease: 'easeIn', impact: true, ...shaft([0.03, -0.04, 0.48], [-0.02, 0.27, 0.5], THRUST_LINE),
    reach: -0.17, hipTurn: 0.1, hipTilt: 0.26, turn: 0.38, lean: 0.52,
    footL: [-0.11, 0.98, 0], footR: [0.15, -0.2, 0.08], toeL: 0, toeR: 0.75 },
  // Momentum carries it a little further, and the back foot drags up behind.
  { at: 0.57, ease: 'easeOut', ...shaft([0.03, -0.05, 0.5], [-0.02, 0.29, 0.55], THRUST_LINE),
    reach: -0.16, hipTurn: 0.06, hipTilt: 0.28, turn: 0.32, lean: 0.56,
    footR: [0.15, -0.08, 0.03] },
  { at: 0.68, ...shaft([0.09, -0.08, 0.36], [-0.01, 0.26, 0.48], [-0.02, 1.18]),
    reach: -0.26, hipTurn: 0.14, turn: 0.46, lean: 0.42 },
  // Hauls it back: the shaft slides through the lead hand and the front foot pulls in.
  { at: 0.86, ...shaft([0.18, -0.15, 0.08], [0.01, 0.18, 0.22], [-0.04, 1.28]),
    reach: -0.44, hipTurn: 0.46, hipTilt: 0.08, turn: 0.68, lean: 0.14,
    footL: [-0.1, 0.62, 0.02], footR: [0.13, -0.08, 0] },
  SPEAR_CHAIN,
];

/* The second thrust rises: it coils low with the shaft tipped up, and drives upward at head height. */
const HIGH_LINE = [0.0, 1.62] as const;

const SPEAR_HIGH: AttackKey[] = [
  // Drops the rear hand and sits down on the back leg, which tips the point up.
  { at: 0.14, ...shaft([0.28, -0.14, -0.14], [0.04, 0.2, 0.0], [0, 1.5]),
    reach: -0.62, hipTurn: 0.74, turn: 1.04, lean: 0.04, headFollow: 0,
    footL: [-0.1, 0.42, 0.03], footR: [0.13, -0.16, 0], toeR: 1.0 },
  // The coil: lowest, furthest back, and the point up on the line of the jab.
  { at: 0.3, ...shaft([0.25, -0.06, -0.22], [0.05, 0.22, -0.08], [0, 1.56]),
    reach: -0.7, hipTurn: 0.9, turn: 1.2, lean: -0.02,
    footL: [-0.1, 0.44, 0.05] },
  { at: 0.39, ease: 'easeIn', ...shaft([0.25, 0.0, -0.12], [0.03, 0.17, 0.1], HIGH_LINE),
    reach: -0.6, hipTurn: 0.5, turn: 1.02, lean: 0.04,
    footL: [-0.1, 0.62, 0.08], footR: [0.13, -0.15, 0.05] },
  // Rising up through the legs, the back heel coming off the ground and both arms out at head height.
  { at: 0.48, ease: 'easeIn', impact: true, ...shaft([0.05, 0.11, 0.42], [-0.02, 0.1, 0.32], HIGH_LINE),
    reach: -0.18, hipTurn: 0.08, hipTilt: 0.1, turn: 0.34, lean: 0.2,
    footL: [-0.1, 0.72, 0], footR: [0.14, -0.1, 0.08], toeL: 0, toeR: 0.8 },
  // The point keeps going, dropping as the weight comes off it.
  { at: 0.58, ease: 'easeOut', ...shaft([0.05, 0.07, 0.43], [-0.02, 0.14, 0.36], [0, 1.5]),
    reach: -0.17, hipTurn: 0.05, turn: 0.3, lean: 0.25,
    footR: [0.14, -0.02, 0.03] },
  // Comes back to guard.
  { at: 0.78, ...shaft([0.17, -0.1, 0.18], [0, 0.17, 0.2], [-0.03, 1.32]),
    reach: -0.38, hipTurn: 0.4, hipTilt: 0.06, turn: 0.62, lean: 0.14,
    footL: [-0.1, 0.5, 0], footR: [0.13, -0.14, 0] },
  { at: 1, ...shaft([0.2, -0.2, 0], SPEAR_GUARD_HIPS, [-0.06, 1.3]),
    reach: -0.52, hipTurn: 0.62, hipTilt: 0, turn: 0.82, lean: 0.08,
    footL: [-0.1, 0.24, 0], footR: [0.13, -0.24, 0], toeL: -0.25, toeR: 0.95 },
];

const SPEAR_ATTACKS: Attack[] = [{ keys: SPEAR_THRUST }, { keys: SPEAR_HIGH }];

export const SPEAR: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Sprint_Loop',
  stance: { idle: SPEAR_IDLE, walk: SPEAR_WALK, run: SPEAR_RUN },
  attacks: SPEAR_ATTACKS,
};
