import type { Attack, AttackKey, FreeHand, Pose, StanceLife, Vec3, WeaponMoves } from './types';

/*
 * Archery: a right-handed archer holds the bow in the left hand and draws with the right. `edge` is
 * the way the arrow flies. The arrow lies along the bow's own forward line, so the draw hand ends up
 * at the jaw only when `draw` is long enough to bring the string back there from the bow hand.
 *
 * The shot turns the whole body side-on: the left shoulder and left foot go toward the target, and both
 * feet end up across the line of the shot. The release is the impact key.
 *
 * These stances are the ready poses, held only for a moment around a shot. The rest of the time the rig
 * wears the bow on the back and leaves the body to the clips.
 */

/** The idle clip holds the chin a little high, and a fighter looks level at what's ahead. */
const HEAD_LEVEL = 0.16;

const BOW_IDLE: Pose = {
  grip: [-0.3, -0.37, 0.2],
  // The top of the bow leans outward a touch, so that the bottom swings in front of nothing but air.
  head: [0.05, 0.98, 0.08],
  edge: [0.06, -0.08, 0.99],
  hips: [0.01, 0.12, 0],
  hipTurn: 0.22,
  hipRoll: 0.03,
  turn: 0.34,
  lean: 0.08,
  footL: [-0.13, 0.13, 0],
  footR: [0.15, -0.11, 0],
  toeL: 0.05,
  toeR: 0.5,
  headFollow: 0,
  headPitch: HEAD_LEVEL,
  draw: 0,
  nock: 0,
  // The arm hangs ready with the fingers curled, not resting on the hip.
  freeHand: { position: [0.2, -0.44, 0.15], fingers: 0.5 },
};
/** The channels of a key that belong to the body and the shaft, which a footstep doesn't change. */
const BODY_CHANNELS = ['grip', 'head', 'edge', 'hips', 'reach', 'hipTurn', 'hipTilt', 'turn', 'lean', 'draw', 'nock', 'freeHand'] as const;

type Step = Pick<AttackKey, 'at' | 'footL' | 'footR' | 'toeL' | 'toeR'>;

/** Part of the way from one value of a channel to the next, whichever shape that channel has. */
const mix = (p: unknown, q: unknown, share: number): unknown => {
  if (typeof p === 'number') return p + ((q as number) - p) * share;
  if (Array.isArray(p)) return p.map((value: number, i) => value + (q as Vec3)[i] * share - value * share);
  const [from, to] = [p as FreeHand, q as FreeHand];
  return { position: mix(from.position, to.position, share), fingers: mix(from.fingers ?? 0.3, to.fingers ?? 0.3, share) };
};

/**
 * Lays footsteps over keys for the body. A foot needs many keys to lift, travel and land cleanly, and a key
 * that left the body alone would make it stop dead for a moment, so each step takes the body's pose from
 * the keys either side of it. The steps arrive linearly, so the body doesn't slow down at them either.
 */
const withSteps = (body: AttackKey[], steps: Step[]): AttackKey[] => {
  // Each key carries over what it leaves out, so fill that in first to have something to mix. Feet aren't
  // filled in, because those carry over by themselves from whichever key last set them.
  const keys: AttackKey[] = [];
  for (const key of body) {
    const before = keys[keys.length - 1];
    const filled: AttackKey = { ...key };
    for (const name of BODY_CHANNELS) {
      if (before && filled[name] === undefined) (filled as unknown as Record<string, unknown>)[name] = before[name];
    }
    keys.push(filled);
  }
  const bodyKeys = [...keys];
  for (const step of steps) {
    const exact = keys.find((key) => key.at === step.at);
    if (exact) {
      Object.assign(exact, step);
      continue;
    }
    const after = bodyKeys.findIndex((key) => key.at > step.at);
    const [from, to] = [bodyKeys[after - 1], bodyKeys[after]];
    const share = (step.at - from.at) / (to.at - from.at);
    const mixed: AttackKey = { ease: 'linear', ...step };
    const record = mixed as unknown as Record<string, unknown>;
    for (const name of BODY_CHANNELS) {
      const [p, q] = [from[name], to[name]];
      if (p === undefined || q === undefined) continue;
      record[name] = mix(p, q, share);
    }
    keys.push(mixed);
  }
  return keys.sort((p, q) => p.at - q.at);
};

/* The walk and run clips pitch the chest well forward, so the carry is set steeper than it looks. */
const BOW_WALK: Pose = {
  grip: [-0.3, -0.24, 0.17],
  head: [0.05, 0.85, -0.5],
  edge: [0.03, 0.5, 0.85],
  hips: [0, 0.04, 0],
  turn: 0.14,
  lean: 0.04,
};
/* Upright beside the leg while the body drives forward over it. */
const BOW_RUN: Pose = {
  grip: [-0.36, -0.27, 0.1],
  head: [0.12, 0.97, 0.1],
  edge: [0, -0.1, 0.97],
  hips: [0, 0.05, 0],
  lean: 0.42,
  headPitch: 0.2,
};

/* The long bow is too long to carry like the short one, so it stands nearer upright, clear out to the side of the stride. */
const LONGBOW_RUN: Pose = {
  ...BOW_RUN,
  grip: [-0.38, -0.2, 0.06],
  head: [0.14, 0.92, -0.36],
  edge: [0, 0.36, 0.92],
};

/* Takes out most of the run clip's shoulder rock, which on a long bow reads as a flapping tail. */
const BOW_LIFE: StanceLife = { runSteady: 0.6, sink: 0.015, shift: 0.015 };

/*
 * The longbow is drawn high and brought down to the anchor. Each foot takes one real step into the
 * stance and one out of it, so neither one slides. The hold is long, because this bow is heavy to draw.
 */
const LONGBOW_SHOT: AttackKey[] = withSteps([
  // Reaches back to the quiver at the right hip, while the weight sinks and the shoulders start round.
  { at: 0.1, ease: 'easeIn', grip: [-0.3, -0.31, 0.25], head: [0.05, 0.93, 0.32], edge: [0.05, -0.32, 0.93],
    draw: 0, nock: 0, hips: [0.03, 0.1, -0.03], hipTurn: 0.34, turn: 0.42, lean: 0.1, headFollow: 0,
    freeHand: { position: [0.2, -0.16, -0.24], fingers: 0.55 } },
  // Closes on an arrow, and from here to the anchor it is one long heave that never stops.
  { at: 0.15, ease: 'linear', grip: [-0.28, -0.16, 0.42], head: [0.05, 0.98, 0.12], edge: [0.05, -0.12, 0.98],
    nock: 0.02, hips: [0.03, 0.105, -0.02], hipTurn: 0.46, turn: 0.56, lean: 0.09,
    freeHand: { position: [0.2, -0.15, -0.25], fingers: 0.9 } },
  // The arrow comes up and across to the string in front of the belt.
  { at: 0.23, ease: 'linear', grip: [-0.2, 0.06, 0.52], head: [-0.1, 0.99, 0.02], edge: [0.03, 0, 1],
    nock: 1, hips: [0.02, 0.11, 0.0], hipTurn: 0.72, turn: 0.88, lean: 0.06,
    freeHand: { position: [-0.08, -0.03, 0.29], fingers: 0.8 } },
  // The bow rises as the body squares up behind the line of the shot.
  { at: 0.29, ease: 'linear', grip: [-0.04, 0.2, 0.53], head: [-0.22, 0.97, 0.04], edge: [0.02, 0.05, 1],
    draw: 0.22, hips: [0.01, 0.105, 0.0], hipTurn: 0.88, turn: 1.08, lean: 0.03 },
  // Bow high, the draw starting from above: the big readable wind-up.
  { at: 0.35, ease: 'linear', grip: [0.04, 0.4, 0.6], head: [-0.1, 0.98, -0.16], edge: [0, 0.2, 1],
    draw: 0.58, hips: [0, 0.1, 0.01], hipTurn: 1.0, turn: 1.22, lean: 0.01 },
  // Down to the anchor: draw hand at the jaw with the elbow high, bow arm straight at the target.
  { at: 0.385, ease: 'linear', grip: [0.06, 0.33, 0.7], head: [-0.09, 0.99, -0.07], edge: [0, 0.09, 1],
    draw: 0.78, hips: [0, 0.095, 0.025], hipTurn: 1.05, turn: 1.28, lean: 0.03 },
  { at: 0.43, ease: 'easeOut', grip: [0.08, 0.25, 0.78], head: [-0.08, 1, 0], edge: [0, 0, 1],
    draw: 0.9, hips: [0, 0.09, 0.04], hipTurn: 1.08, turn: 1.32, lean: 0.05 },
  // The tense hold: nothing moves but a last creep of the string and the shoulder blades closing.
  { at: 0.565, grip: [0.08, 0.255, 0.785], draw: 0.93, turn: 1.36, lean: 0.05,
    freeHand: { position: [0.1, 0.28, -0.22], fingers: 0.6 } },
  { at: 0.58, ease: 'linear', impact: true, draw: 0 },
  // The draw hand has run straight back along the arrow past the jaw, and the bow arm kicks out from the shock.
  { at: 0.65, ease: 'easeOut', grip: [-0.02, 0.26, 0.78], head: [-0.28, 0.96, 0.02], edge: [-0.1, 0.05, 1],
    nock: 0, turn: 1.55, lean: -0.02, hipTurn: 1.14, hips: [0, 0.12, -0.03],
    freeHand: { position: [0.12, 0.27, -0.3], fingers: 0.35 } },
  // Holds there a moment, watching the arrow go.
  { at: 0.76, grip: [-0.04, 0.23, 0.75], head: [-0.3, 0.95, 0.06], turn: 1.48, lean: 0.03, hips: [0, 0.1, 0.03],
    freeHand: { position: [0.16, 0.2, -0.3], fingers: 0.4 } },
  // Lowers the bow while turning back, without hurrying, and without a stop on the way down.
  { at: 0.85, ease: 'easeIn', grip: [-0.28, -0.02, 0.52], head: [0.05, 0.88, 0.4], edge: [0.05, -0.38, 0.9],
    turn: 1.02, hipTurn: 0.8, hips: [0.01, 0.095, 0.02], lean: 0.05,
    freeHand: { position: [0.22, -0.2, 0.05], fingers: 0.45 } },
  { at: 0.92, ease: 'linear', grip: [-0.3, -0.28, 0.28], head: [0.05, 0.93, 0.28], edge: [0.05, -0.28, 0.93],
    turn: 0.66, hipTurn: 0.46, hips: [0.01, 0.09, 0.01], lean: 0.07,
    freeHand: { position: [0.23, -0.36, 0.08], fingers: 0.5 } },
  { ...BOW_IDLE, at: 1, ease: 'easeOut' },
], [
  // One low step in for each foot. Each lifts where it stands, turns in the air, and is already over
  // its final spot before the weight comes on, so that nothing skates.
  { at: 0.1, footL: [-0.13, 0.13, 0.04], footR: [0.15, -0.11, 0], toeL: 0.05, toeR: 0.5 },
  { at: 0.13, footL: [-0.12, 0.15, 0.085], toeL: -0.1 },
  { at: 0.18, footL: [-0.07, 0.22, 0.1], toeL: -0.45 },
  { at: 0.215, footL: [-0.03, 0.27, 0.08], toeL: -0.72 },
  { at: 0.235, footL: [-0.03, 0.27, 0] },
  { at: 0.25, footR: [0.15, -0.11, 0.04] },
  { at: 0.27, footR: [0.14, -0.12, 0.085], toeR: 0.8 },
  { at: 0.31, footR: [0.09, -0.18, 0.1], toeR: 1.2 },
  { at: 0.335, footR: [0.05, -0.22, 0.08], toeR: 1.38 },
  { at: 0.35, footR: [0.05, -0.22, 0] },
  // And one low step out for each, front foot first.
  { at: 0.77, footL: [-0.03, 0.27, 0.04] },
  { at: 0.79, footL: [-0.04, 0.26, 0.085], toeL: -0.6 },
  { at: 0.83, footL: [-0.09, 0.19, 0.1], toeL: -0.25 },
  { at: 0.855, footL: [-0.13, 0.13, 0.08], toeL: 0.05 },
  { at: 0.875, footL: [-0.13, 0.13, 0], footR: [0.05, -0.22, 0.04] },
  { at: 0.895, footR: [0.06, -0.21, 0.085], toeR: 1.1 },
  { at: 0.93, footR: [0.12, -0.15, 0.09], toeR: 0.75 },
  { at: 0.95, footR: [0.15, -0.11, 0.07], toeR: 0.5 },
  { at: 0.97, footR: [0.15, -0.11, 0] },
]);

export const LONGBOW: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Sprint_Loop',
  levelHead: true,
  life: BOW_LIFE,
  stance: { idle: BOW_IDLE, walk: BOW_WALK, run: LONGBOW_RUN },
  attacks: [{ keys: LONGBOW_SHOT }],
};

/*
 * The shortbow is snapped up from low, in a crouch with the bow canted across the body. There's no time
 * for a big stance: the back foot stays where it is and only pivots a little.
 */
const SHORTBOW_IDLE: Pose = {
  ...BOW_IDLE,
  grip: [-0.3, -0.33, 0.24],
  head: [0.05, 0.9, 0.42],
  edge: [0.06, -0.42, 0.9],
  hips: [0.01, 0.14, 0.02],
  lean: 0.14,
  freeHand: { position: [0.2, -0.41, 0.17], fingers: 0.5 },
};
const SHORTBOW_WALK: Pose = {
  ...BOW_WALK,
  grip: [-0.3, -0.33, 0.24],
  hips: [0, 0.07, 0],
  lean: 0.1,
};

const SHORTBOW_SHOT: AttackKey[] = withSteps([
  // Down to the quiver in one move, the weight dropping.
  { at: 0.12, ease: 'easeIn', grip: [-0.3, -0.22, 0.34], head: [0.05, 0.82, 0.54], edge: [0.05, -0.54, 0.82],
    draw: 0, nock: 0.02, hips: [0.02, 0.15, 0], hipTurn: 0.42, turn: 0.5, lean: 0.2, headFollow: 0,
    freeHand: { position: [0.2, -0.17, -0.24], fingers: 0.9 } },
  // The arrow is already leaving, near level as it crosses the body, on a short step forward.
  { at: 0.18, ease: 'linear', grip: [-0.28, -0.1, 0.5], head: [0.05, 0.97, 0.18], edge: [0.05, -0.18, 0.97],
    nock: 0.3, hips: [0.015, 0.16, 0.02], hipTurn: 0.55, turn: 0.64, lean: 0.21,
    freeHand: { position: [0.05, 0.0, 0.12], fingers: 0.85 } },
  // Nocked on the way up, the bow already leaning over.
  { at: 0.27, ease: 'linear', grip: [-0.1, 0.08, 0.6], head: [0.2, 0.97, 0.04], edge: [-0.1, -0.02, 1],
    nock: 1, hips: [0.01, 0.15, 0.1], hipTurn: 0.72, turn: 0.82, lean: 0.22,
    freeHand: { position: [-0.05, 0.0, 0.3], fingers: 0.8 } },
  // Anchored at the chin, low and forward, the bow arm pushed out straight and the top canted over to the right.
  { at: 0.42, ease: 'easeOut', grip: [0.08, 0.23, 0.76], head: [0.26, 0.96, 0.08], edge: [-0.03, -0.08, 1],
    draw: 1.0, hips: [0, 0.15, 0.14], hipTurn: 0.84, turn: 1.02, lean: 0.2 },
  { at: 0.565, grip: [0.08, 0.235, 0.77], draw: 1.03, turn: 1.06,
    freeHand: { position: [0.1, 0.25, -0.18], fingers: 0.6 } },
  { at: 0.58, ease: 'linear', impact: true, draw: 0 },
  // A flick rather than a heave, and it's ready again sooner.
  { at: 0.66, ease: 'easeOut', grip: [-0.02, 0.24, 0.74], head: [0.2, 0.97, 0.1], edge: [-0.12, -0.03, 1],
    nock: 0, turn: 1.12, lean: 0.13, hips: [0, 0.15, 0.08],
    freeHand: { position: [0.13, 0.24, -0.26], fingers: 0.35 } },
  // The flick settles, then the bow comes down at one steady pace, with no stop and no lurch on the way.
  { at: 0.72, ease: 'easeIn', grip: [-0.05, 0.2, 0.71], head: [0.18, 0.96, 0.13], edge: [-0.1, -0.06, 1],
    turn: 1.06, lean: 0.14, hips: [0, 0.15, 0.08] },
  { at: 0.8, ease: 'linear', grip: [-0.2, 0.04, 0.58], head: [0.08, 0.92, 0.28], edge: [0.02, -0.28, 0.95],
    turn: 0.86, hipTurn: 0.66, lean: 0.17, hips: [0.005, 0.14, 0.06],
    freeHand: { position: [0.2, -0.18, 0.08], fingers: 0.45 } },
  { at: 0.93, ease: 'linear', grip: [-0.3, -0.27, 0.28], head: [0.05, 0.88, 0.46], edge: [0.05, -0.46, 0.88],
    turn: 0.5, hipTurn: 0.34, lean: 0.15, hips: [0.01, 0.13, 0.03],
    freeHand: { position: [0.23, -0.36, 0.13], fingers: 0.5 } },
  { ...SHORTBOW_IDLE, at: 1, ease: 'easeOut' },
], [
  // The front foot lifts where it stands, reaches forward low, and is over its spot before the weight lands.
  { at: 0.12, footL: [-0.13, 0.13, 0.05], footR: [0.15, -0.11, 0], toeL: 0.05, toeR: 0.55 },
  { at: 0.15, footL: [-0.125, 0.16, 0.09], toeL: -0.05 },
  { at: 0.2, footL: [-0.12, 0.32, 0.1], toeL: -0.15 },
  { at: 0.245, footL: [-0.12, 0.42, 0.08], toeL: -0.2 },
  { at: 0.27, footL: [-0.12, 0.42, 0], toeR: 0.7 },
  // The back foot only pivots on its ball.
  { at: 0.42, footR: [0.15, -0.11, 0.05], toeR: 0.8 },
  { at: 0.78, footL: [-0.12, 0.42, 0.05], footR: [0.15, -0.11, 0], toeR: 0.65 },
  { at: 0.81, footL: [-0.12, 0.38, 0.09], toeL: -0.12 },
  { at: 0.85, footL: [-0.125, 0.24, 0.1] },
  { at: 0.885, footL: [-0.13, 0.13, 0.08], toeL: 0.05 },
  { at: 0.905, footL: [-0.13, 0.13, 0], toeR: 0.5 },
]);

export const SHORTBOW: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Sprint_Loop',
  levelHead: true,
  life: BOW_LIFE,
  stance: { idle: SHORTBOW_IDLE, walk: SHORTBOW_WALK, run: BOW_RUN },
  attacks: [{ keys: SHORTBOW_SHOT }],
};

/*
 * Spear: rear hand near the butt, lead hand out along the shaft, shoulders turned side-on. `reach` is how
 * far up the shaft the left hand is from the right, as a negative number. Hands slide on the shaft: the
 * rear hand pulls back on the wind-up and catches up with the lead hand in the thrust.
 */

/** From the right hand to the point on the 3 m shaft. Almost all of it is ahead of the hand, so the butt stays out of the body. */
const SPEAR_LENGTH = 2.67;
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

/** The same, with the wrists turning the shaft around its own length, so that the point visibly bores in. */
const twistedShaft = (grip: Vec3, hips: Vec3, tip: readonly [number, number], twist: number) => {
  const { head, edge } = shaft(grip, hips, tip);
  const size = Math.hypot(head[0], head[1], head[2]);
  const [x, y, z] = [head[0] / size, head[1] / size, head[2] / size];
  // The edge is square to the shaft, so turning it only takes this cross product.
  const side: Vec3 = [y * edge[2] - z * edge[1], z * edge[0] - x * edge[2], x * edge[1] - y * edge[0]];
  const [c, s] = [Math.cos(twist), Math.sin(twist)];
  const turned: Vec3 = [edge[0] * c + side[0] * s, edge[1] * c + side[1] * s, edge[2] * c + side[2] * s];
  return { grip, hips, head, edge: turned };
};

/* The point rides at chest height, low hand at the hip, with the shoulders over the front knee. */
const SPEAR_GUARD_HIPS: Vec3 = [0.02, 0.13, 0.02];
const SPEAR_GUARD_LINE = [-0.06, 1.2] as const;
/* Both attacks start and end with the feet here, so that one that starts late never has to shuffle. */
const SPEAR_FRONT_FOOT: Vec3 = [-0.1, 0.24, 0];
const SPEAR_BACK_FOOT: Vec3 = [0.13, -0.24, 0];
const SPEAR_IDLE: Pose = {
  ...shaft([0.2, -0.2, 0], SPEAR_GUARD_HIPS, SPEAR_GUARD_LINE),
  reach: -0.52,
  hipTurn: 0.62,
  hipRoll: 0.04,
  turn: 0.82,
  lean: 0.2,
  footL: SPEAR_FRONT_FOOT,
  footR: SPEAR_BACK_FOOT,
  toeL: -0.25,
  toeR: 0.95,
  headFollow: 0,
  headPitch: HEAD_LEVEL,
};
/* The same guard as standing. The walk clip pitches the chest forward, so this is set steeper to come out level. */
const SPEAR_WALK_HEAD: Vec3 = [-0.08, 0.66, 0.95];
const SPEAR_WALK: Pose = {
  grip: [0.2, -0.2, 0],
  hips: [0, 0.07, 0],
  head: SPEAR_WALK_HEAD,
  edge: underEdge(SPEAR_WALK_HEAD),
  reach: -0.52,
  turn: 0.65,
  lean: 0.08,
};
/* A level charge held low at the hip, the body driving forward behind the point. */
const SPEAR_RUN: Pose = {
  grip: [0.2, -0.24, -0.02],
  head: [-0.08, 0.17, 0.98],
  edge: [0.1, -0.98, 0.17],
  hips: [0, 0.05, 0],
  reach: -0.52,
  turn: 0.35,
  lean: 0.42,
  headPitch: 0.36,
};

/* Where the first attack ends and the second begins: feet home, but the body still forward from the lunge. */
const SPEAR_CHAIN: AttackKey = {
  at: 1,
  ...shaft([0.2, -0.17, 0.04], [0.02, 0.14, 0.08], [-0.04, 1.32]),
  reach: -0.5,
  hipTurn: 0.6,
  turn: 0.78,
  lean: 0.14,
  footL: SPEAR_FRONT_FOOT,
  footR: SPEAR_BACK_FOOT,
  toeL: -0.25,
  toeR: 0.95,
};

const THRUST_LINE = [-0.02, 1.2] as const;
const SPEAR_THRUST: AttackKey[] = withSteps([
  // Sinks back over the rear foot, and the rear hand draws the shaft back through the lead hand. The feet don't move.
  { at: 0.14, ...shaft([0.28, -0.16, -0.24], [0.05, 0.19, -0.14], THRUST_LINE),
    reach: -0.72, hipTurn: 0.86, hipTilt: 0.02, turn: 1.14, lean: 0.12, headFollow: 0,
    footL: SPEAR_FRONT_FOOT, footR: SPEAR_BACK_FOOT, toeL: -0.25, toeR: 0.95 },
  // Held: all the tension before the drive.
  { at: 0.3, ...shaft([0.29, -0.16, -0.27], [0.05, 0.2, -0.16], THRUST_LINE),
    reach: -0.74, hipTurn: 0.9, turn: 1.2, lean: 0.12 },
  // The stride opens and the hips go first, while the shoulders are still back. From here on nothing
  // stops until the point has landed.
  { at: 0.4, ease: 'linear', ...shaft([0.25, -0.15, -0.14], [0.02, 0.19, 0.1], THRUST_LINE),
    reach: -0.66, hipTurn: 0.5, turn: 1.04, lean: 0.16 },
  { at: 0.455, ease: 'linear', ...shaft([0.17, -0.1, 0.26], [0, 0.24, 0.36], THRUST_LINE),
    reach: -0.4, hipTurn: 0.26, hipTilt: 0.14, turn: 0.62, lean: 0.32 },
  // Shoulders through, arms out, and the rear hand runs up the shaft, which passes outside the right ribs.
  { at: 0.48, ease: 'linear', impact: true, ...shaft([0.12, -0.04, 0.46], [-0.02, 0.27, 0.61], THRUST_LINE),
    reach: -0.17, hipTurn: 0.1, hipTilt: 0.22, turn: 0.1, lean: 0.46 },
  // Momentum drags the torso on over the front knee, and the point bleeds its last speed.
  { at: 0.57, ease: 'easeOut', ...shaft([0.12, -0.05, 0.475], [-0.02, 0.29, 0.695], THRUST_LINE),
    reach: -0.16, hipTurn: 0.06, hipTilt: 0.24, turn: 0.06, lean: 0.5 },
  // Hauls it back: the shaft slides through the lead hand as the feet walk home.
  { at: 0.66, ease: 'linear', ...shaft([0.14, -0.08, 0.42], [-0.01, 0.26, 0.5], [-0.02, 1.18]),
    reach: -0.26, hipTurn: 0.14, turn: 0.36, lean: 0.36 },
  { at: 0.76, ease: 'linear', ...shaft([0.16, -0.13, 0.18], [0, 0.2, 0.3], [-0.03, 1.24]),
    reach: -0.38, hipTurn: 0.36, hipTilt: 0.1, turn: 0.56, lean: 0.24 },
  { at: 0.87, ease: 'linear', ...shaft([0.19, -0.16, 0.08], [0.015, 0.16, 0.14], [-0.04, 1.3]),
    reach: -0.46, hipTurn: 0.52, hipTilt: 0.03, turn: 0.72, lean: 0.17 },
  { ...SPEAR_CHAIN, ease: 'easeOut' },
], [
  // The front foot unweights in the hold, then skims out on the long stride, coming down at the impact.
  { at: 0.3, footL: [-0.1, 0.24, 0.05] },
  { at: 0.34, footL: [-0.1, 0.25, 0.085], footR: SPEAR_BACK_FOOT },
  // The back foot is pulled up by the drive and plants on its toes just before the point lands, so the hit
  // has a driving leg under it. It can't stay at the back: the hips go further forward than the leg is long.
  { at: 0.36, footR: [0.13, -0.24, 0.07] },
  { at: 0.4, footL: [-0.1, 0.6, 0.1], toeL: -0.15, footR: [0.13, -0.19, 0.09] },
  { at: 0.455, footL: [-0.11, 0.92, 0.09], footR: [0.14, -0.04, 0.085] },
  { at: 0.47, footL: [-0.11, 0.98, 0.07], footR: [0.14, -0.02, 0.06] },
  { at: 0.48, footL: [-0.11, 0.98, 0], toeL: 0, footR: [0.14, -0.02, 0.08], toeR: 0.8 },
  // One long low slide home for the front foot, then one small step for the back, and all feet are down by 0.92.
  { at: 0.6, footL: [-0.11, 0.98, 0.04] },
  { at: 0.62, footL: [-0.11, 0.96, 0.075] },
  { at: 0.68, footL: [-0.1, 0.74, 0.085], toeL: -0.1 },
  { at: 0.75, footL: [-0.1, 0.44, 0.085], toeL: -0.2 },
  { at: 0.8, footL: [-0.1, 0.27, 0.08], toeL: -0.25 },
  { at: 0.83, footL: [-0.1, 0.24, 0.07], footR: [0.14, -0.02, 0.05] },
  { at: 0.85, footL: SPEAR_FRONT_FOOT, footR: [0.14, -0.03, 0.085] },
  { at: 0.88, footR: [0.135, -0.16, 0.09], toeR: 0.9 },
  { at: 0.905, footR: [0.13, -0.24, 0.075], toeR: 0.95 },
  { at: 0.92, footR: SPEAR_BACK_FOOT },
]);

/*
 * The second thrust answers the first: there's no pull back to the rear foot and no long hold. It
 * gathers from where the lunge left it, the back foot stepping up under the body, then snaps upward
 * at head height with the wrists turning the point as it goes in.
 */
const HIGH_LINE = [0.0, 1.62] as const;

const SPEAR_HIGH: AttackKey[] = withSteps([
  // The rear hand drops, which tips the point up.
  { at: 0.06, ease: 'linear', ...shaft([0.22, -0.13, 0], [0.03, 0.16, 0.07], [-0.02, 1.42]),
    reach: -0.55, hipTurn: 0.66, hipTilt: 0, turn: 0.88, lean: 0.13, headFollow: 0,
    footL: SPEAR_FRONT_FOOT, footR: SPEAR_BACK_FOOT, toeL: -0.25, toeR: 0.95 },
  // The coil, reached early: low, and the point up on the line of the jab.
  { at: 0.22, ease: 'easeOut', ...shaft([0.25, -0.05, -0.14], [0.04, 0.22, 0.0], [0, 1.58]),
    reach: -0.68, hipTurn: 0.88, turn: 1.16, lean: 0.12 },
  { at: 0.34, ...shaft([0.26, -0.04, -0.17], [0.04, 0.225, -0.02], [0, 1.6]),
    reach: -0.7, hipTurn: 0.9, turn: 1.2, lean: 0.12 },
  { at: 0.41, ease: 'linear', ...shaft([0.22, 0.02, -0.04], [0.02, 0.21, 0.16], HIGH_LINE),
    reach: -0.56, hipTurn: 0.46, turn: 0.96, lean: 0.16 },
  { at: 0.455, ease: 'linear', ...shaft([0.14, 0.07, 0.24], [0, 0.2, 0.38], HIGH_LINE),
    reach: -0.36, hipTurn: 0.24, hipTilt: 0.08, turn: 0.56, lean: 0.26 },
  // Drives up through the legs and over the planted front foot, back heel off the ground, arms out at head height.
  { at: 0.48, ease: 'linear', impact: true, ...twistedShaft([0.1, 0.1, 0.47], [-0.02, 0.22, 0.6], HIGH_LINE, 0.5),
    reach: -0.18, hipTurn: 0.08, hipTilt: 0.16, turn: 0.2, lean: 0.36 },
  // The point holds its height through the follow-through, the torso carried on over the front knee.
  { at: 0.58, ease: 'easeOut', ...twistedShaft([0.1, 0.08, 0.49], [-0.02, 0.24, 0.67], [0, 1.6], 0.5),
    reach: -0.17, hipTurn: 0.05, hipTilt: 0.18, turn: 0.16, lean: 0.38 },
  // Only now does the point fall, as the feet walk home.
  { at: 0.67, ease: 'linear', ...shaft([0.12, -0.01, 0.4], [-0.01, 0.2, 0.46], [-0.01, 1.48]),
    reach: -0.26, hipTurn: 0.2, hipTilt: 0.12, turn: 0.34, lean: 0.3 },
  { at: 0.76, ease: 'linear', ...shaft([0.17, -0.1, 0.18], [0, 0.17, 0.24], [-0.03, 1.32]),
    reach: -0.38, hipTurn: 0.4, hipTilt: 0.06, turn: 0.62, lean: 0.2 },
  { at: 0.88, ease: 'linear', ...shaft([0.19, -0.17, 0.06], [0.015, 0.15, 0.1], [-0.05, 1.25]),
    reach: -0.47, hipTurn: 0.54, hipTilt: 0.01, turn: 0.75, lean: 0.2 },
  { at: 1, ease: 'easeOut', ...shaft([0.2, -0.2, 0], SPEAR_GUARD_HIPS, SPEAR_GUARD_LINE),
    reach: -0.52, hipTurn: 0.62, hipTilt: 0, turn: 0.82, lean: 0.2 },
], [
  // The gathering step: the back foot comes up under the body while the hips settle.
  { at: 0.06, footR: [0.13, -0.24, 0.07] },
  { at: 0.09, footR: [0.13, -0.23, 0.09] },
  { at: 0.15, footR: [0.14, -0.11, 0.09] },
  { at: 0.19, footR: [0.14, -0.03, 0.075] },
  { at: 0.22, footR: [0.14, -0.03, 0] },
  // The front foot strides, landing as the point does, while the back heel comes up behind it.
  { at: 0.34, footL: [-0.1, 0.24, 0.05] },
  { at: 0.37, footL: [-0.1, 0.25, 0.085] },
  { at: 0.41, footL: [-0.1, 0.56, 0.1], toeL: -0.15, footR: [0.14, -0.03, 0.04] },
  { at: 0.455, footL: [-0.1, 0.84, 0.09] },
  { at: 0.47, footL: [-0.1, 0.88, 0.07] },
  { at: 0.48, footL: [-0.1, 0.88, 0], toeL: 0, footR: [0.14, -0.03, 0.08], toeR: 0.8 },
  // Goes home the same way the first thrust does.
  { at: 0.6, footL: [-0.1, 0.88, 0.04] },
  { at: 0.62, footL: [-0.1, 0.86, 0.075] },
  { at: 0.68, footL: [-0.1, 0.66, 0.085], toeL: -0.1 },
  { at: 0.75, footL: [-0.1, 0.4, 0.085], toeL: -0.2 },
  { at: 0.8, footL: [-0.1, 0.27, 0.08], toeL: -0.25 },
  { at: 0.83, footL: [-0.1, 0.24, 0.07], footR: [0.14, -0.03, 0.05] },
  { at: 0.85, footL: SPEAR_FRONT_FOOT, footR: [0.14, -0.03, 0.085] },
  { at: 0.88, footR: [0.135, -0.16, 0.09], toeR: 0.9 },
  { at: 0.905, footR: [0.13, -0.24, 0.075], toeR: 0.95 },
  { at: 0.92, footR: SPEAR_BACK_FOOT },
]);

const SPEAR_ATTACKS: Attack[] = [{ keys: SPEAR_THRUST }, { keys: SPEAR_HIGH }];

export const SPEAR: WeaponMoves = {
  idleClip: 'Idle_Loop',
  runClip: 'Sprint_Loop',
  levelHead: true,
  // Most of the run clip's shoulder rock is taken out, because on a shaft this long it swings the point wide.
  life: { runSteady: 0.85, sink: 0.015, shift: 0.012 },
  stance: { idle: SPEAR_IDLE, walk: SPEAR_WALK, run: SPEAR_RUN },
  attacks: SPEAR_ATTACKS,
};
