import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DODGE_SECONDS, type AnimationId } from '../../../shared/sim';
import type { AttackKey, AxisName, Ease, HeldItem, ItemPose, Pose, Vec3, WeaponSetup } from './attacks/types';
import { animateOpenBook, createOpenBook } from './openBook';
import { createQuiver } from './quiver';
import { createShieldStraps } from './shieldStraps';

/*
 * Runs after the animation clips each frame. The clips give a starting point, then this moves the
 * hips and spine, plants the feet, places the weapon relative to the chest, bends the limbs to reach
 * all of that (two-bone inverse kinematics), and closes the fingers around the handle.
 *
 * Authored poses become Frames: flat lists of numbers. Everything that moves is sampled and blended
 * in that one shape, so a new field is a new channel. Switching between animations never jumps,
 * because the difference at the switch is carried along and faded out instead of low-passing the
 * pose, which would also blur the strikes.
 */

type Hand = 'r' | 'l';

/** How far the palm's center is from the wrist bone, as a share of the distance to the knuckles. */
const PALM_ALONG_HAND = 0.68;
const PALM_DEPTH = 0.03;
const DEFAULT_TILT_DEGREES = 20;
/** How far apart the clip's knees are, in meters, at a full stride. */
const GAIT_FULL_STRIDE = 0.45;
/** How far the hands move for each radian the shoulders swing while walking or running. */
const GAIT_HAND_SWING = 0.3;
const GAIT_OFF_SWING = 0.07;
/** How far a carried weapon's head rocks for each radian of that swing. */
const GAIT_ROCK = 0.6;

/** How much of the wrist's roll the forearm takes, so that the wrist doesn't look wrung out. */
const FOREARM_ROLL_SHARE = 0.5;
const ELBOW_FOLLOWS_WRIST = 0.5;
const FOREARM_TWIST_RATE = 30;
/** Arrow length in meters, and how far back the string pulls. */
const ARROW_LENGTH = 0.85;
const DRAW_LENGTH = 0.32;
const ARROW_FILE_AXIS: AxisName = '+y';
const ARROW_UP = new THREE.Vector3(0, 1, 0);
const ARROW_FORWARD = new THREE.Vector3(0, 0, 1);
/** How far down the shaft the fingers hold an arrow coming out of the quiver, so that its tip is still inside. */
const ARROW_HELD_AT = 0.4;
/** How far toward the string an arrow has come by the time it has left the quiver's line. */
const ARROW_FREE_AT = 0.15;
/** How much the limbs bend at full draw: the tips come back this share of the string's depth, and closer by this share. */
const BOW_FLEX_DEPTH = 0.75;
const BOW_FLEX_HEIGHT = 0.07;
/** The limbs are a stiff spring: they follow the string, then shiver on the release. */
const BOW_FLEX_STIFFNESS = 1500;
const BOW_FLEX_DAMPING = 13;
/** How high the free hand has to be, from the chest, for an archer's elbow to be all the way up. */
const BOW_ELBOW_UP_HEIGHT = 0.2;
/** How far the drawing hand rolls around its own length at full draw. */
const BOW_DRAW_HAND_ROLL = -1;
/** Where the quiver is worn, as [left, up, forward] from the origin. Tipped back and out, clear of the swinging arm. */
const QUIVER_AT: readonly [number, number, number] = [-0.25, 1.07, -0.22];
const QUIVER_TIP_BACK = -0.25;
const QUIVER_TIP_OUT = -0.04;
/** A bow worn on the back, as [right, up, forward] from the chest: top over the right shoulder, grip pointing away from the body. */
const BOW_BACK_HEAD: Vec3 = [0.5, 0.86, 0];
const BOW_BACK_EDGE: Vec3 = [0, 0, -1];
const BOW_BACK_HEIGHT = -0.02;
/** How far behind the chest bone the string lies, which puts it against the back and not inside it. */
const BOW_BACK_CLEARANCE = 0.17;
/** Stays in hand this long after the last shot, so that quick repeat shots don't send it back and forth. */
const BOW_READY_SECONDS = 1.2;
const BOW_STOW_SECONDS = 0.35;
/** The share of an attack in which the bow goes from back to hand. It leaves once the right hand has reached it. */
const BOW_TAKE_FROM = 0.045;
const BOW_TAKE_UNTIL = 0.13;
/** The right hand is at the quiver by the shot's first key, so the reach behind the shoulder has to be over by then. */
const BOW_REACH_UNTIL = 0.1;
const BOW_REACH_AT: Vec3 = [0.14, 0.2, -0.16];
/** How far the bow swings left and up on the way, so that it goes around the torso and not through it. */
const BOW_ARC_OUT = 0.2;
const BOW_ARC_UP = 0.08;
const RELAXED_FINGERS = 0.3;
/**
 * Sitting on the ground at a Binary Grace. The library's only sit clip is for a chair, so this is authored:
 * the pelvis drops close to the ground, the feet come in with the soles toward each other, and the knees fall out.
 */
const SIT_HIPS_DOWN = 0.74;
const SIT_FOOT_OUT = 0.13;
const SIT_FOOT_FORWARD = 0.42;
const SIT_TOE_OUT = 0.9;
const SIT_LEAN = 0.22;
/** Where a palm rests on its knee, from the chest: [out to the side, up, forward]. */
const SIT_HAND: Vec3 = [0.3, -0.2, 0.3];
const SIT_FINGERS = 0.45;
const SIT_SECONDS = 0.7;
/** The knee aims this way while sitting, as [out to the side, up, forward]. A forward aim would be in line with the leg. */
const SIT_KNEE_OUT = 0.9;
const SIT_KNEE_UP = 0.75;
const SIT_KNEE_FORWARD = 0.25;
const SIT_BLEND_RATE = 7;

const SPINE_NAMES = ['spine_01', 'spine_02', 'spine_03'];
const SPINE_SHARE = [0.25, 0.35, 0.4];
const DEFAULT_HEAD_FOLLOW = 0.2;
/** How much of the clip's upper-body twist a posed attack removes, when a clip is still playing. */
const STEADY_WITH_CLIP = 0.85;
const DEFAULT_TOE_OUT = 0.15;
const STANDING_FOOT = 0.114;
const DEFAULT_FREE_FINGERS = 0.3;
/** A foot's heel rises this far per meter of lift, up to this angle, with the toes planted. */
const MAX_HEEL_PITCH = 0.7;
const FOOT_FLAT_FROM = 0.1;
const FOOT_FLAT_BY = 0.2;
/** The knee points forward and this much outward. */
const KNEE_OUTWARD = 0.35;

const CLAVICLE_MAX_ANGLE = 0.42;

const TRANSITION_SECONDS = 0.2;
const ATTACK_TRANSITION_SECONDS = 0.1;
/** Going back to the stance after an attack is a slow recovery, long enough for the feet to step home. */
const RECOVER_TRANSITION_SECONDS = 0.36;
/** Long enough for a raised weapon to drop in an arc into the run instead of snapping there. */
const RUN_TRANSITION_SECONDS = 0.3;
const DEATH_TRANSITION_SECONDS = 0.3;
const HIT_TRANSITION_SECONDS = 0.1;
const SECOND_HAND_RATE = 22;
/** How fast `draw` has to fall, per second, to count as letting go of the string. */
const BOW_RELEASE_RATE = 8;

const BREATH_RATE = 1.75;
const BREATH_CHEST = 0.014;
const BREATH_RISE = 0.006;
const BREATH_HIPS = 0.004;
/** A planted foot further than this from where it's going lifts and steps there. */
const STEP_MIN_DISTANCE = 0.05;
const STEP_FULL_DISTANCE = 0.1;
const STEP_LIFT = 0.14;
/** When two feet step, the second one leaves at this share of the way through the first one's move. */
const STEP_SECOND_FOOT_AT = 0.42;
/** The slow movements a StanceLife adds, in radians per second: about 3 and 6 seconds to the loop. */
const LIFE_SINK_RATE = 2.1;
const LIFE_SHIFT_RATE = 1.05;
const LIFE_RESETTLE_RATE = 0.8;
/** How far the weapon's drift comes after the chest's, in radians of that loop. */
const LIFE_DRIFT_DELAY = 0.9;
/** How slowly a carried hand follows the body's rise and fall, and how much it rocks the weapon with it. */
const LAG_SECONDS = 0.16;
const LAG_ROCK = 1.5;
const BOB_AVERAGE_SECONDS = 1;
const GAIT_BLEND_RATE = 8;
/** Where the run clip's steps are centered, front to back, in the model. */
const RUN_STRIDE_MIDDLE = -0.1;
/** How high the ankle gets with the toes still on the floor. */
const RUN_HEEL_LIFT = 0.1;
/** Where the head looks when a stance asks it to stay steady through a run, upward from level, in radians. */
const RUN_HEAD_GAZE = 0.12;

/** Where the free hand raises a drink, from the chest. It lines up with the mouth. */
const MOUTH: Vec3 = [0, 0.31, 0.26];
const DRINK_HEAD_BACK = -0.65;
const DRINK_LEAN_BACK = -0.07;
/** How far the flask tips over at the lips, in radians. Past level, so the last of it runs out. */
const FLASK_TIP = -1.95;
const DRINK_WEAPON: ItemPose = { grip: [0.3, -0.36, 0.12], head: [0.25, 0.3, 0.92], edge: [0, -0.95, 0.3] };

const X_AXIS = new THREE.Vector3(1, 0, 0);

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const v6 = new THREE.Vector3();
const v7 = new THREE.Vector3();
const v8 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const q4 = new THREE.Quaternion();
const q5 = new THREE.Quaternion();
const q6 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const unusedScale = new THREE.Vector3();
const unusedPosition = new THREE.Vector3();

/** Reads a bone's rotation without walking up its parents. The world matrices must be current. */
function worldRotation(object: THREE.Object3D, to: THREE.Quaternion): THREE.Quaternion {
  object.matrixWorld.decompose(unusedPosition, to, unusedScale);
  return to;
}

function worldPosition(object: THREE.Object3D, to: THREE.Vector3): THREE.Vector3 {
  return to.setFromMatrixPosition(object.matrixWorld);
}

/** Poses use [right, up, forward]. The models face +Z with their right side toward -X. */
function toModel(from: Vec3, to: THREE.Vector3): THREE.Vector3 {
  return to.set(-from[0], from[1], from[2]);
}

function axisVector(axis: AxisName): THREE.Vector3 {
  const v = new THREE.Vector3();
  v[axis[1] as 'x' | 'y' | 'z'] = axis[0] === '+' ? 1 : -1;
  return v;
}

/** The rotation whose Y axis points along head, and Z axis points along edge. */
function basisQuaternion(head: THREE.Vector3, edge: THREE.Vector3, to: THREE.Quaternion): THREE.Quaternion {
  const y = v5.copy(head).normalize();
  const z = v6.copy(edge).addScaledVector(y, -edge.dot(y)).normalize();
  const x = v7.crossVectors(y, z);
  m1.makeBasis(x, y, z);
  return to.setFromRotationMatrix(m1);
}

/** The rotation whose Y axis is dir (a unit vector) and X axis is the hinge, straightened to be square to it. */
function hingeFrame(dir: THREE.Vector3, hinge: THREE.Vector3, to: THREE.Quaternion): THREE.Quaternion {
  const x = v5.copy(hinge).addScaledVector(dir, -hinge.dot(dir)).normalize();
  const z = v6.crossVectors(x, dir);
  m1.makeBasis(x, dir, z);
  return to.setFromRotationMatrix(m1);
}

/* Frames. */

const enum C {
  // In model space: x is the character's left. These hold three numbers each.
  GRIP = 0,
  OFF = 3,
  FREE = 6,
  HIPS = 9,
  HIP_TURN = 12,
  HIP_TILT = 13,
  HIP_ROLL = 14,
  TURN = 15,
  LEAN = 16,
  HEAD = 17,
  REACH = 18,
  DRAW = 19,
  // Each foot is x, z, lift, toe, weight.
  FOOT_L = 20,
  FOOT_R = 25,
  FREE_WEIGHT = 30,
  FREE_FINGERS = 31,
  MAIN_WEIGHT = 32,
  OFF_WEIGHT = 33,
  SECOND_HAND = 34,
  STEADY = 35,
  BREATH = 36,
  // Bow only: above 0 an arrow is in the drawing hand, and at 1 it's on the string.
  NOCK = 37,
  HEAD_PITCH = 38,
  COUNT = 39,
}

/** Channels that travel along a spline: [first channel, how many make up one point]. */
const SPLINED: readonly (readonly [number, number])[] = [
  [C.GRIP, 3],
  [C.OFF, 3],
  [C.FREE, 3],
  [C.HIPS, 3],
  [C.HIP_TURN, 1],
  [C.TURN, 1],
  [C.LEAN, 1],
];

interface Frame {
  ch: Float32Array;
  main: THREE.Quaternion;
  off: THREE.Quaternion;
  at: number;
  ease: Ease;
}

function makeFrame(): Frame {
  return { ch: new Float32Array(C.COUNT), main: new THREE.Quaternion(), off: new THREE.Quaternion(), at: 0, ease: 'smooth' };
}

function copyFrame(from: Frame, to: Frame): Frame {
  to.ch.set(from.ch);
  to.main.copy(from.main);
  to.off.copy(from.off);
  return to;
}

function setItemPose(frame: Frame, channel: number, rotation: THREE.Quaternion, pose: ItemPose): void {
  frame.ch[channel] = -pose.grip[0];
  frame.ch[channel + 1] = pose.grip[1];
  frame.ch[channel + 2] = pose.grip[2];
  basisQuaternion(toModel(pose.head, v1), toModel(pose.edge, v2), rotation);
}

/** Writes the fields that a pose sets. Whatever it leaves out stays as the frame already has it. */
function applyFields(frame: Frame, pose: Partial<Pose>, secondHand: number): void {
  const { ch } = frame;
  if (pose.grip && pose.head && pose.edge) setItemPose(frame, C.GRIP, frame.main, pose as ItemPose);
  else {
    if (pose.grip) {
      ch[C.GRIP] = -pose.grip[0];
      ch[C.GRIP + 1] = pose.grip[1];
      ch[C.GRIP + 2] = pose.grip[2];
    }
    if (pose.head || pose.edge) {
      // Only one of the two changed, so the other is read back from the rotation so far.
      const head = pose.head ? toModel(pose.head, v1) : v1.set(0, 1, 0).applyQuaternion(frame.main);
      const edge = pose.edge ? toModel(pose.edge, v2) : v2.set(0, 0, 1).applyQuaternion(frame.main);
      basisQuaternion(head, edge, frame.main);
    }
  }
  if (pose.hips) {
    ch[C.HIPS] = -pose.hips[0];
    ch[C.HIPS + 1] = -pose.hips[1];
    ch[C.HIPS + 2] = pose.hips[2];
  }
  if (pose.hipTurn !== undefined) ch[C.HIP_TURN] = pose.hipTurn;
  if (pose.hipTilt !== undefined) ch[C.HIP_TILT] = pose.hipTilt;
  if (pose.hipRoll !== undefined) ch[C.HIP_ROLL] = pose.hipRoll;
  if (pose.turn !== undefined) ch[C.TURN] = pose.turn;
  if (pose.lean !== undefined) ch[C.LEAN] = pose.lean;
  if (pose.headFollow !== undefined) ch[C.HEAD] = pose.headFollow;
  if (pose.headPitch !== undefined) ch[C.HEAD_PITCH] = pose.headPitch;
  if (pose.reach !== undefined) ch[C.REACH] = pose.reach;
  if (pose.draw !== undefined) ch[C.DRAW] = pose.draw;
  if (pose.nock !== undefined) ch[C.NOCK] = pose.nock;
  if (pose.footL) setFoot(ch, C.FOOT_L, pose.footL);
  if (pose.footR) setFoot(ch, C.FOOT_R, pose.footR);
  if (pose.toeL !== undefined) ch[C.FOOT_L + 3] = pose.toeL;
  if (pose.toeR !== undefined) ch[C.FOOT_R + 3] = pose.toeR;
  if (pose.freeHand) {
    ch[C.FREE] = -pose.freeHand.position[0];
    ch[C.FREE + 1] = pose.freeHand.position[1];
    ch[C.FREE + 2] = pose.freeHand.position[2];
    ch[C.FREE_FINGERS] = pose.freeHand.fingers ?? DEFAULT_FREE_FINGERS;
    ch[C.FREE_WEIGHT] = 1;
  }
  if (pose.oneHand !== undefined) ch[C.SECOND_HAND] = pose.oneHand ? 0 : secondHand !== 0 ? 1 : 0;
}

function setFoot(ch: Float32Array, channel: number, foot: Vec3): void {
  ch[channel] = -foot[0];
  ch[channel + 1] = foot[1];
  ch[channel + 2] = foot[2];
  ch[channel + 4] = 1;
}

/** The standing pose under everything, so that a pose only needs to say what differs. */
function baseFrame(setup: WeaponSetup): Frame {
  const frame = makeFrame();
  const { ch } = frame;
  ch[C.HEAD] = DEFAULT_HEAD_FOLLOW;
  ch[C.REACH] = setup.secondHand ?? 0;
  ch[C.FOOT_L] = STANDING_FOOT;
  ch[C.FOOT_L + 3] = DEFAULT_TOE_OUT;
  ch[C.FOOT_R] = -STANDING_FOOT;
  ch[C.FOOT_R + 3] = DEFAULT_TOE_OUT;
  ch[C.FREE_FINGERS] = DEFAULT_FREE_FINGERS;
  ch[C.SECOND_HAND] = setup.secondHand ? 1 : 0;
  return frame;
}

function stanceFrame(setup: WeaponSetup, pose: Pose | undefined, off: ItemPose | undefined, breath: number): Frame {
  const frame = baseFrame(setup);
  if (pose) {
    applyFields(frame, pose, setup.secondHand ?? 0);
    frame.ch[C.MAIN_WEIGHT] = 1;
  }
  if (off) {
    setItemPose(frame, C.OFF, frame.off, off);
    frame.ch[C.OFF_WEIGHT] = 1;
  }
  frame.ch[C.BREATH] = breath;
  // Planted feet mean the keys are in charge of the body, as in an attack.
  if (frame.ch[C.FOOT_L + 4] || frame.ch[C.FOOT_R + 4]) frame.ch[C.STEADY] = 1;
  return frame;
}

interface CompiledAttack {
  /** Null when the clip moves the arms too. */
  frames: Frame[] | null;
  impactAt: number;
}

interface CompiledSetup {
  idle: Frame;
  walk: Frame;
  run: Frame;
  /** The stance, but with the legs and hips left to the clips: for rolling and flinching. */
  dodge: Frame;
  hit: Frame;
  drink: Frame;
  /** Legs and hips left to the clips, and the weapon held as it is standing. */
  jump: Frame;
  /** Every limb goes limp to the clip. */
  death: Frame;
  /** A bow on the back: the clips move the whole body, and the hands hold nothing. */
  slung: Frame;
  /** Sitting on the ground, with nothing in the hands. */
  rest: Frame;
  attacks: CompiledAttack[];
}

function clearBody(frame: Frame): Frame {
  const { ch } = frame;
  ch.fill(0, C.HIPS, C.HIP_ROLL + 1);
  ch[C.LEAN] = 0;
  ch[C.FOOT_L + 4] = 0;
  ch[C.FOOT_R + 4] = 0;
  ch[C.BREATH] = 0;
  ch[C.STEADY] = 0;
  return frame;
}

/** The items' place during a roll, for a weapon that names one. */
function rollFrame(setup: WeaponSetup, frame: Frame): Frame {
  if (setup.roll) {
    setItemPose(frame, C.GRIP, frame.main, setup.roll.main);
    if (setup.roll.off) setItemPose(frame, C.OFF, frame.off, setup.roll.off);
  }
  return frame;
}

function compileAttackKeys(keys: AttackKey[], clipped: boolean, setup: WeaponSetup, idle: Frame): Frame[] {
  const frames: Frame[] = [];
  const running = copyFrame(idle, makeFrame());
  running.ch[C.BREATH] = 0;
  running.ch[C.STEADY] = clipped ? STEADY_WITH_CLIP : 1;
  running.ch[C.MAIN_WEIGHT] = 1;
  // A foot first mentioned part way through was standing there all along.
  const firstFootL = keys.find((key) => key.footL)?.footL;
  const firstFootR = keys.find((key) => key.footR)?.footR;
  if (firstFootL && !running.ch[C.FOOT_L + 4]) setFoot(running.ch, C.FOOT_L, firstFootL);
  if (firstFootR && !running.ch[C.FOOT_R + 4]) setFoot(running.ch, C.FOOT_R, firstFootR);
  for (const key of keys) {
    if (key.ease !== 'hold') {
      applyFields(running, key, setup.secondHand ?? 0);
      if (key.off) setItemPose(running, C.OFF, running.off, key.off);
    }
    const frame = copyFrame(running, makeFrame());
    frame.at = key.at;
    frame.ease = key.ease ?? 'smooth';
    frames.push(frame);
  }
  return frames;
}

const compiledSetups = new WeakMap<WeaponSetup, CompiledSetup>();

/** All characters with the same weapon share one copy of this. */
function compileSetup(setup: WeaponSetup): CompiledSetup {
  const existing = compiledSetups.get(setup);
  if (existing) return existing;
  const { stance, offStance } = setup;
  const idle = stanceFrame(setup, stance.idle, offStance?.idle, 1);
  const walk = stanceFrame(setup, stance.walk, offStance?.walk ?? offStance?.idle, 0.3);
  const run = stanceFrame(setup, stance.run ?? stance.idle, offStance?.run ?? offStance?.idle, 0);
  if (setup.life?.runSteady !== undefined) run.ch[C.STEADY] = setup.life.runSteady;
  const hasOff = setup.items.length > 1;
  const drink = clearBody(copyFrame(idle, makeFrame()));
  // With both hands full the weapon hand puts its weapon away for the sip. Otherwise the other hand is free.
  if (hasOff) drink.ch[C.MAIN_WEIGHT] = 0;
  else {
    // The weapon comes down and out of the way, in the hand that's left.
    const side = setup.items[0].hand === 'r' ? 1 : -1;
    setItemPose(drink, C.GRIP, drink.main, {
      grip: [side * DRINK_WEAPON.grip[0], DRINK_WEAPON.grip[1], DRINK_WEAPON.grip[2]],
      head: [side * DRINK_WEAPON.head[0], DRINK_WEAPON.head[1], DRINK_WEAPON.head[2]],
      edge: DRINK_WEAPON.edge,
    });
  }
  // A bow stays on the back for the drink, so the other arm stays with the clip.
  if (setup.bow) drink.ch[C.MAIN_WEIGHT] = 0;
  drink.ch[C.SECOND_HAND] = 0;
  drink.ch[C.TURN] = 0;
  drink.ch[C.FREE_WEIGHT] = 1;
  drink.ch[C.FREE_FINGERS] = 0.7;
  const death = clearBody(copyFrame(idle, makeFrame()));
  death.ch[C.TURN] = 0;
  death.ch[C.MAIN_WEIGHT] = 0;
  death.ch[C.OFF_WEIGHT] = 0;
  death.ch[C.SECOND_HAND] = 0;
  death.ch[C.FREE_WEIGHT] = 0;
  // Keeps the stance's hand positions under weights of 0, so that a shot's hands rise from there as the weights come up.
  const slung = clearBody(copyFrame(idle, makeFrame()));
  slung.ch[C.TURN] = 0;
  slung.ch[C.HEAD_PITCH] = 0;
  slung.ch[C.MAIN_WEIGHT] = 0;
  slung.ch[C.SECOND_HAND] = 0;
  slung.ch[C.FREE_WEIGHT] = 0;
  const rest = copyFrame(death, makeFrame());
  rest.ch[C.HIPS + 1] = -SIT_HIPS_DOWN;
  rest.ch[C.LEAN] = SIT_LEAN;
  rest.ch[C.STEADY] = 1;
  rest.ch[C.BREATH] = 0.6;
  rest.ch[C.HEAD] = 1;
  setFoot(rest.ch, C.FOOT_L, [-SIT_FOOT_OUT, 0, SIT_FOOT_FORWARD]);
  setFoot(rest.ch, C.FOOT_R, [SIT_FOOT_OUT, 0, SIT_FOOT_FORWARD]);
  rest.ch[C.FOOT_L + 3] = SIT_TOE_OUT;
  rest.ch[C.FOOT_R + 3] = SIT_TOE_OUT;
  const compiled: CompiledSetup = {
    idle,
    walk,
    run,
    dodge: rollFrame(setup, clearBody(copyFrame(run, makeFrame()))),
    hit: clearBody(copyFrame(idle, makeFrame())),
    drink,
    jump: clearBody(copyFrame(idle, makeFrame())),
    death,
    slung,
    rest,
    attacks: setup.attacks.map((attack) => {
      const keys = attack.keys;
      return {
        frames: keys ? compileAttackKeys(keys, attack.clip !== undefined, setup, idle) : null,
        impactAt: keys?.find((key) => key.impact)?.at ?? 0.5,
      };
    }),
  };
  compiledSetups.set(setup, compiled);
  return compiled;
}

function easeAmount(ease: Ease, u: number): number {
  switch (ease) {
    case 'linear':
      return u;
    case 'easeIn':
      return u * u * u;
    case 'easeOut': {
      const left = 1 - u;
      return 1 - left * left * left;
    }
    case 'hold':
      return 0;
    default:
      return u * u * (3 - 2 * u);
  }
}

/** Centripetal Catmull-Rom through p1 and p2, for `size` channels at `start`. It can't loop or overshoot wildly. */
function splineInto(
  to: Float32Array,
  start: number,
  size: number,
  a: Float32Array,
  b: Float32Array,
  c: Float32Array,
  d: Float32Array,
  u: number,
): void {
  let ab = 0;
  let bc = 0;
  let cd = 0;
  for (let i = start; i < start + size; i += 1) {
    ab += (b[i] - a[i]) * (b[i] - a[i]);
    bc += (c[i] - b[i]) * (c[i] - b[i]);
    cd += (d[i] - c[i]) * (d[i] - c[i]);
  }
  // The square root of a distance is the centripetal knot spacing, and these hold squared distances.
  let dt0 = Math.sqrt(Math.sqrt(ab));
  let dt1 = Math.sqrt(Math.sqrt(bc));
  let dt2 = Math.sqrt(Math.sqrt(cd));
  // A key that repeats the last one is a hold, and the curve has nowhere to go.
  if (dt1 < 1e-4) {
    for (let i = start; i < start + size; i += 1) to[i] = b[i];
    return;
  }
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  const u2 = u * u;
  const u3 = u2 * u;
  for (let i = start; i < start + size; i += 1) {
    const m1v = ((b[i] - a[i]) / dt0 - (c[i] - a[i]) / (dt0 + dt1) + (c[i] - b[i]) / dt1) * dt1;
    const m2v = ((c[i] - b[i]) / dt1 - (d[i] - b[i]) / (dt1 + dt2) + (d[i] - c[i]) / dt2) * dt1;
    to[i] =
      (2 * u3 - 3 * u2 + 1) * b[i] + (u3 - 2 * u2 + u) * m1v + (-2 * u3 + 3 * u2) * c[i] + (u3 - u2) * m2v;
  }
}

/** A spline through rotations, by treating them as four-number points and normalizing. */
function splineRotation(
  to: THREE.Quaternion,
  a: THREE.Quaternion,
  b: THREE.Quaternion,
  c: THREE.Quaternion,
  d: THREE.Quaternion,
  u: number,
): void {
  // q and -q are the same rotation, and the path has to go the short way.
  const sa = a.dot(b) < 0 ? -1 : 1;
  const sc = c.dot(b) < 0 ? -1 : 1;
  const sd = d.dot(c) * sc < 0 ? -1 : 1;
  // Spaced by distance like the points are: evenly spaced, a huge strike after a hold makes the hold twitch.
  const ax = a.x * sa, ay = a.y * sa, az = a.z * sa, aw = a.w * sa;
  const cx = c.x * sc, cy = c.y * sc, cz = c.z * sc, cw = c.w * sc;
  const dx = d.x * sd, dy = d.y * sd, dz = d.z * sd, dw = d.w * sd;
  let dt0 = Math.sqrt(Math.hypot(b.x - ax, b.y - ay, b.z - az, b.w - aw));
  let dt1 = Math.sqrt(Math.hypot(cx - b.x, cy - b.y, cz - b.z, cw - b.w));
  let dt2 = Math.sqrt(Math.hypot(dx - cx, dy - cy, dz - cz, dw - cw));
  if (dt1 < 1e-4) {
    to.copy(b);
    return;
  }
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  const u2 = u * u;
  const u3 = u2 * u;
  const h0 = 2 * u3 - 3 * u2 + 1;
  const h1 = (u3 - 2 * u2 + u) * dt1;
  const h2 = -2 * u3 + 3 * u2;
  const h3 = (u3 - u2) * dt1;
  const along = (pa: number, pb: number, pc: number, pd: number) =>
    h0 * pb +
    h1 * ((pb - pa) / dt0 - (pc - pa) / (dt0 + dt1) + (pc - pb) / dt1) +
    h2 * pc +
    h3 * ((pc - pb) / dt1 - (pd - pb) / (dt1 + dt2) + (pd - pc) / dt2);
  to.set(along(ax, b.x, cx, dx), along(ay, b.y, cy, dy), along(az, b.z, cz, dz), along(aw, b.w, cw, dw)).normalize();
}

/* Limbs. */

/** How far the forearm's twist moves this frame. Set once a frame by the rig. */
let twistBlend = 1;

interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  /** Turns the hinge frames below into the bones' own rotations. */
  upperFromFrame: THREE.Quaternion;
  lowerFromFrame: THREE.Quaternion;
  /** The end bone's rotation relative to the lower bone, when the limb is straight and relaxed. */
  endRest: THREE.Quaternion;
  /** The last sideways direction used, for when the pole is straight along the limb. */
  side: THREE.Vector3;
  /** The wrist roll asked for last, from -pi to pi. */
  roll: number;
  /** How much of that the lower bone is taking. */
  twist: number;
}

function makeLimb(model: THREE.Object3D, upperName: string, lowerName: string, endName: string, restPole: Vec3): Limb | null {
  const upper = model.getObjectByName(upperName);
  const lower = model.getObjectByName(lowerName);
  const end = model.getObjectByName(endName);
  if (!upper || !lower || !end) return null;
  const upperAt = upper.getWorldPosition(new THREE.Vector3());
  const lowerAt = lower.getWorldPosition(new THREE.Vector3());
  const endAt = end.getWorldPosition(new THREE.Vector3());
  const upperRotation = upper.getWorldQuaternion(new THREE.Quaternion());
  const lowerRotation = lower.getWorldQuaternion(new THREE.Quaternion());
  const endRotation = end.getWorldQuaternion(new THREE.Quaternion());
  const whole = endAt.clone().sub(upperAt).normalize();
  // Which way this limb's joint folds, in its T-pose or standing rest pose.
  const hinge = whole.clone().cross(new THREE.Vector3(...restPole)).normalize();
  const upperDir = lowerAt.clone().sub(upperAt).normalize();
  const lowerDir = endAt.clone().sub(lowerAt).normalize();
  return {
    upper,
    lower,
    end,
    upperLength: upperAt.distanceTo(lowerAt),
    lowerLength: lowerAt.distanceTo(endAt),
    upperFromFrame: hingeFrame(upperDir, hinge, new THREE.Quaternion()).invert().multiply(upperRotation),
    lowerFromFrame: hingeFrame(lowerDir, hinge, new THREE.Quaternion()).invert().multiply(lowerRotation),
    endRest: lowerRotation.clone().invert().multiply(endRotation),
    side: new THREE.Vector3(...restPole),
    roll: 0,
    twist: 0,
  };
}

/**
 * Bends a limb so its end bone reaches the target. pole is the way the joint should point. The
 * bones' rotations are worked out from the rest pose, so the clip's twist can't leak in.
 * endRotation of null lets the end bone follow the limb. rollShare is how much of the end bone's
 * roll the lower bone takes. weight 1 follows fully, and 0 leaves the current pose alone.
 * The parent of the upper bone must have a current world matrix. Returns distance over length.
 */
function solveLimb(
  limb: Limb,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  endRotation: THREE.Quaternion | null,
  rollShare: number,
  weight: number,
): number {
  const { upper, lower, end, upperLength, lowerLength } = limb;
  const parent = upper.parent!;
  upper.updateMatrix();
  m1.multiplyMatrices(parent.matrixWorld, upper.matrix);
  const start = v1.setFromMatrixPosition(m1);

  const dir = v2.copy(target).sub(start);
  const distance = dir.length();
  dir.divideScalar(Math.max(distance, 0.0001));
  const length = upperLength + lowerLength;
  const clamped = Math.min(Math.max(distance, Math.abs(upperLength - lowerLength) + 0.001), length * 0.999);

  // The joint lies on the circle where the two bones' reaches meet.
  const along = (upperLength * upperLength - lowerLength * lowerLength + clamped * clamped) / (2 * clamped);
  const out = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const side = v3.copy(pole);
  if (endRotation && rollShare > 0) {
    // Where the elbow would need to be for no wrist roll at all, as a say in where it goes. A wrist
    // turned far over brings the elbow up with it, which is what keeps real forearms from wringing.
    q4.copy(endRotation).multiply(q5.copy(limb.endRest).invert()).multiply(q6.copy(limb.lowerFromFrame).invert());
    v4.set(1, 0, 0).applyQuaternion(q4).cross(dir);
    side.normalize().multiplyScalar(1 - ELBOW_FOLLOWS_WRIST).addScaledVector(v4, ELBOW_FOLLOWS_WRIST);
  }
  side.addScaledVector(dir, -side.dot(dir));
  if (side.lengthSq() < 0.0004) side.copy(limb.side).addScaledVector(dir, -limb.side.dot(dir));
  side.normalize();
  limb.side.copy(side);
  const hinge = v4.crossVectors(dir, side);

  const upperDir = v7.copy(dir).multiplyScalar(along).addScaledVector(side, out).divideScalar(upperLength);
  const lowerDir = v8
    .copy(dir)
    .multiplyScalar(clamped - along)
    .addScaledVector(side, -out)
    .divideScalar(lowerLength);

  const upperWorld = hingeFrame(upperDir, hinge, q1).multiply(limb.upperFromFrame);
  const lowerWorld = hingeFrame(lowerDir, hinge, q2).multiply(limb.lowerFromFrame);
  const endWorld = endRotation ? q3.copy(endRotation) : q3.copy(lowerWorld).multiply(limb.endRest);

  if (endRotation && rollShare > 0) {
    // Twist of the end bone around the forearm's length, unwound to stay close to the last frame's.
    const relative = q4.copy(lowerWorld).invert().multiply(endWorld).multiply(q5.copy(limb.endRest).invert());
    let roll = 2 * Math.atan2(relative.y, relative.w);
    if (roll > Math.PI) roll -= Math.PI * 2;
    else if (roll < -Math.PI) roll += Math.PI * 2;
    // Weighted, so that a hand that has nearly let go doesn't read as a wrung wrist.
    limb.roll = roll * weight;
    // The hand is always exact, so the forearm can follow softly, and past half a turn it goes around.
    limb.twist += (roll * rollShare - limb.twist) * twistBlend;
    q4.set(0, Math.sin(limb.twist / 2), 0, Math.cos(limb.twist / 2));
    lowerWorld.multiply(q4);
  } else {
    // A hand with nothing to line up has no wrist roll, and the reading shouldn't stay at its last value.
    limb.roll = 0;
  }

  // Into each bone's own parent frame, blended with what the clip had.
  worldRotation(parent, q5);
  q6.copy(q5).invert().multiply(upperWorld);
  if (weight >= 0.999) upper.quaternion.copy(q6);
  else upper.quaternion.slerp(q6, weight);
  q5.multiply(upper.quaternion);
  q6.copy(q5).invert().multiply(lowerWorld);
  if (weight >= 0.999) lower.quaternion.copy(q6);
  else lower.quaternion.slerp(q6, weight);
  q5.multiply(lower.quaternion);
  q6.copy(q5).invert().multiply(endWorld);
  if (weight >= 0.999) end.quaternion.copy(q6);
  else end.quaternion.slerp(q6, weight);
  upper.updateWorldMatrix(false, true);
  return distance / length;
}

/* Arms and legs. */

interface Arm {
  hand: Hand;
  limb: Limb;
  clavicle: THREE.Object3D | null;
  palm: THREE.Vector3;
  fingers: { bone: THREE.Object3D; rest: THREE.Quaternion; axis: THREE.Vector3; angle: number }[];
}

interface Leg {
  limb: Limb;
  ball: THREE.Object3D | null;
  /** +1 on the left, whose outside is +X. */
  side: number;
  channel: number;
  /** In the model's frame, when standing straight. */
  footRest: THREE.Quaternion;
  ballRest: THREE.Quaternion;
  ballAt: THREE.Vector3;
  /** From the ball of the foot to the ankle, when the sole is flat. */
  ankleAbove: number;
  ankleBehind: number;
  // What the clip wanted this frame, in world space.
  clipAnkle: THREE.Vector3;
  clipBall: THREE.Vector3;
  clipKnee: THREE.Vector3;
  clipHip: THREE.Vector3;
  clipThigh: THREE.Quaternion;
  clipFoot: THREE.Quaternion;
}

interface MountedItem {
  spec: HeldItem;
  holder: THREE.Group;
  /** Turns the item's frame into the hand's frame. */
  gripRotation: THREE.Quaternion;
  gripInverse: THREE.Quaternion;
  /** Along the holder's Y axis, the far ends of the item. */
  tip: number;
  butt: number;
  /** Whether this rig made the item's geometry, so it should free it. */
  built: boolean;
}

export interface WeaponRig {
  /** Call right after the animation clips have been applied. */
  apply: (seconds: number, animation: AnimationId) => void;
  /** Restores what the clips last set, because clips only write values that changed. */
  beforeClips: () => void;
  afterClips: () => void;
  startAttack: (index: number) => void;
  /** How far the last frame's targets were beyond the arms' reach. Above 1, a hand can't get there. */
  stretch: () => number;
  /** The same for the legs. Above 1, a foot can't get to the ground where it should be. */
  legStretch: () => number;
  /** The largest wrist roll being asked for, in radians. Well past 1.8, a forearm looks wrung out. */
  wristRoll: () => number;
  /** Writes the world position of the main item's far end, and optionally its near end. */
  weaponTip: (target: THREE.Vector3, base?: THREE.Vector3) => void;
  /** From 0 to 1 during an attack, and -1 otherwise. */
  attackPhase: () => number;
  /** The share of the attack at which this one in the list lands its hit. */
  impactKeyAt: (index: number) => number;
  dispose: () => void;
}

// Every character holding the same weapon shares one reshaped copy, and it stays for the life of the page.
const reshapedGeometry = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Gives a model a bigger head and a different handle. The head grows down the handle, so its length stays the same. */
function applyReshape(object: THREE.Object3D, spec: HeldItem): void {
  const shape = spec.reshape!;
  const head = axisVector(spec.head);
  const edge = axisVector(spec.edge);
  const side = new THREE.Vector3().crossVectors(head, edge);
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry = reshapedGeometry.get(mesh.geometry);
    if (!geometry) {
      geometry = mesh.geometry.clone();
      const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
      const point = new THREE.Vector3();
      let butt = Infinity;
      let tip = -Infinity;
      for (let i = 0; i < positions.count; i += 1) {
        const along = point.fromBufferAttribute(positions, i).dot(head);
        butt = Math.min(butt, along);
        tip = Math.max(tip, along);
      }
      const headStart = butt + shape.headFrom * (tip - butt);
      for (let i = 0; i < positions.count; i += 1) {
        point.fromBufferAttribute(positions, i);
        const along = point.dot(head);
        const across = point.dot(side);
        const toEdge = point.dot(edge);
        // The handle runs up through the head. Keeping that part thin stops the handle flaring out to meet the head.
        const isHead = along >= headStart && Math.abs(toEdge) > shape.neck;
        point
          .copy(head)
          .multiplyScalar(along >= headStart ? tip + (along - tip) * shape.head[1] : along)
          .addScaledVector(side, across * (isHead ? shape.head[0] : shape.handle))
          .addScaledVector(edge, toEdge * (isHead ? shape.head[2] : shape.handle));
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      reshapedGeometry.set(mesh.geometry, geometry);
    }
    mesh.geometry = geometry;
  });
}

/** Builds an item, sized and turned so its grip point sits in the palm. */
function makeItem(
  file: GLTF,
  spec: HeldItem,
  palm: THREE.Vector3,
  adopt: (mesh: THREE.Mesh) => void,
): MountedItem | null {
  const built = spec.build === 'open-book';
  const source = built ? createOpenBook() : file.scene.getObjectByName(spec.id);
  if (!source) return null;
  const object = built ? source : source.clone(true);
  if (spec.reshape) applyReshape(object, spec);
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) adopt(child as THREE.Mesh);
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = spec.length / Math.max(size.x, size.y, size.z);

  // In the item's frame, +Y runs toward the head, +Z along the edge, and the origin is the grip.
  const head = axisVector(spec.head);
  const edge = axisVector(spec.edge);
  const toItem = basisQuaternion(head, edge, new THREE.Quaternion()).invert();
  const headSize = Math.abs(head.dot(size));
  const gripPoint = center.clone().addScaledVector(head, (spec.grip - 0.5) * headSize);
  if (spec.edgeAt !== undefined) {
    const axis = spec.edge[1] as 'x' | 'y' | 'z';
    gripPoint[axis] = box.min[axis] + spec.edgeAt * size[axis];
  }
  const thickness = scale * (spec.girth ?? 1);
  const along = new THREE.Vector3(Math.abs(head.x), Math.abs(head.y), Math.abs(head.z));
  object.quaternion.copy(toItem);
  object.scale.setScalar(thickness).addScaledVector(along, scale - thickness);
  if (spec.flat) {
    // Widens the thin side, so a blade seen edge-on doesn't vanish at the game's low resolution.
    const side = new THREE.Vector3().crossVectors(head, edge);
    object.scale.addScaledVector(side.set(Math.abs(side.x), Math.abs(side.y), Math.abs(side.z)), scale * (spec.flat - 1));
  }
  object.position.copy(gripPoint).multiply(object.scale).applyQuaternion(toItem).negate();
  if (spec.nudge) object.position.add(new THREE.Vector3(...spec.nudge));

  // Thumbs run along +Y, knuckles along +Z, and the head leans a little toward the knuckles.
  const tilt = THREE.MathUtils.degToRad(spec.tilt ?? DEFAULT_TILT_DEGREES);
  const gripRotation = new THREE.Quaternion().setFromRotationMatrix(
    m1.makeBasis(
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt)),
      new THREE.Vector3(0, Math.cos(tilt), -Math.sin(tilt)),
    ),
  );
  const holder = new THREE.Group();
  holder.add(object);
  if (spec.straps) holder.add(createShieldStraps(adopt));
  holder.quaternion.copy(gripRotation);
  holder.position.copy(palm);
  const headLength = headSize * scale;
  const nudged = spec.nudge?.[1] ?? 0;
  return {
    spec,
    holder,
    gripRotation,
    gripInverse: gripRotation.clone().invert(),
    tip: headLength * (1 - spec.grip) + nudged,
    butt: -headLength * spec.grip + nudged,
    built,
  };
}

function makeArm(model: THREE.Object3D, hand: Hand): Arm | null {
  // With the arm straight out, the elbow's point faces backward.
  const limb = makeLimb(model, `upperarm_${hand}`, `lowerarm_${hand}`, `hand_${hand}`, [0, 0, -1]);
  const knuckle = model.getObjectByName(`middle_01_${hand}`);
  if (!limb || !knuckle) return null;

  // The bones' Y axes run along the fingers. Palms face -X on the right hand and +X on the left.
  const palmSide = hand === 'r' ? -1 : 1;
  const palm = new THREE.Vector3(palmSide * PALM_DEPTH, knuckle.position.y * PALM_ALONG_HAND, 0);

  const fingers: Arm['fingers'] = [];
  const handRest = limb.end.getWorldQuaternion(new THREE.Quaternion());
  for (const finger of ['index', 'middle', 'ring', 'pinky']) {
    [68, 82, 52].forEach((angle, joint) => {
      const bone = model.getObjectByName(`${finger}_0${joint + 1}_${hand}`);
      if (!bone) return;
      fingers.push({ bone, rest: bone.quaternion.clone(), axis: X_AXIS.clone(), angle: THREE.MathUtils.degToRad(angle) });
    });
  }
  // The thumb swings across the palm first, then its tip closes over the fingers. The left hand's bones
  // mirror the right's across X, and mirroring a turn keeps its axis's X and flips the other two.
  const mirror = hand === 'r' ? 1 : -1;
  const thumbAxes: [Vec3, number][] = [
    [[0.2, 0.75 * mirror, 0.6 * mirror], 42],
    [[-1, 0, 0], 45],
    [[-1, 0, 0], 55],
  ];
  thumbAxes.forEach(([axis, angle], joint) => {
    const bone = model.getObjectByName(`thumb_0${joint + 1}_${hand}`);
    if (!bone) return;
    const inHand = new THREE.Vector3(...axis).normalize();
    // Written in the hand's frame, then expressed in the thumb bone's own frame.
    const boneRest = bone.getWorldQuaternion(new THREE.Quaternion());
    const local = inHand.applyQuaternion(handRest).applyQuaternion(boneRest.invert());
    fingers.push({ bone, rest: bone.quaternion.clone(), axis: local, angle: THREE.MathUtils.degToRad(angle) });
  });

  return { hand, limb, clavicle: model.getObjectByName(`clavicle_${hand}`) ?? null, palm, fingers };
}

function makeLeg(model: THREE.Object3D, hand: Hand): Leg | null {
  // Standing straight, the knee's point faces forward.
  const limb = makeLimb(model, `thigh_${hand}`, `calf_${hand}`, `foot_${hand}`, [0, 0, 1]);
  const ball = model.getObjectByName(`ball_${hand}`) ?? null;
  if (!limb) return null;
  const ankleAt = limb.end.getWorldPosition(new THREE.Vector3());
  const ballAt = ball ? ball.getWorldPosition(new THREE.Vector3()) : ankleAt.clone().add(new THREE.Vector3(0, -0.07, 0.14));
  return {
    limb,
    ball,
    side: hand === 'l' ? 1 : -1,
    channel: hand === 'l' ? C.FOOT_L : C.FOOT_R,
    footRest: limb.end.getWorldQuaternion(new THREE.Quaternion()),
    ballRest: ball ? ball.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
    ballAt,
    ankleAbove: ankleAt.y - ballAt.y,
    ankleBehind: ballAt.z - ankleAt.z,
    clipAnkle: new THREE.Vector3(),
    clipBall: new THREE.Vector3(),
    clipKnee: new THREE.Vector3(),
    clipHip: new THREE.Vector3(),
    clipThigh: new THREE.Quaternion(),
    clipFoot: new THREE.Quaternion(),
  };
}

const smoothStep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The rotation in the body's frame, turned right, then bent forward, then rolled. */
function bodyTurn(turnRight: number, forward: number, roll: number, body: THREE.Quaternion, to: THREE.Quaternion) {
  euler.set(forward, -turnRight, roll);
  to.setFromEuler(euler).premultiply(body).multiply(q6.copy(body).invert());
  return to;
}

/** How far the flask and head are tipped back, through the drink from 0 to 1. The health arrives in the middle of this. */
function drinkTipAt(d: number): number {
  return smoothStep(0.28, 0.45, d) * (1 - smoothStep(0.68, 0.84, d));
}

/** A small stoppered flask. Its origin is where the hand holds it, and its neck is along +Y. */
function createFlask(adopt: (mesh: THREE.Mesh) => void): THREE.Group {
  const group = new THREE.Group();
  const outline = [
    [0.001, -0.055],
    [0.032, -0.052],
    [0.045, -0.022],
    [0.04, 0.012],
    [0.016, 0.038],
    [0.014, 0.068],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const parts: [THREE.BufferGeometry, number][] = [
    [new THREE.LatheGeometry(outline, 6), 0xc8892c],
    [new THREE.CylinderGeometry(0.018, 0.015, 0.026, 6).translate(0, 0.08, 0), 0x6e4e2e],
  ];
  for (const [geometry, color] of parts) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    adopt(mesh);
    group.add(mesh);
  }
  return group;
}

export function createWeaponRig(
  model: THREE.Object3D,
  setup: WeaponSetup,
  file: GLTF,
  adopt: (mesh: THREE.Mesh) => void,
  extraMaterial: (material: THREE.Material) => void,
  attackSeconds: number,
  drinkSeconds: number,
): WeaponRig {
  model.updateWorldMatrix(true, true);
  const compiled = compileSetup(setup);
  const modelInverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  const pelvis = model.getObjectByName('pelvis')!;
  const chest = model.getObjectByName('spine_03')!;
  const neck = model.getObjectByName('neck_01');
  const head = model.getObjectByName('Head');
  const pelvisAtRest = pelvis.getWorldQuaternion(new THREE.Quaternion()).premultiply(modelInverse);
  const pelvisPlace = model.worldToLocal(pelvis.getWorldPosition(new THREE.Vector3()));
  const chestAtRest = chest.getWorldQuaternion(new THREE.Quaternion()).premultiply(modelInverse);
  const chestRest = chestAtRest.clone().invert();
  const spineBones = SPINE_NAMES.map((name) => model.getObjectByName(name)).filter((bone) => !!bone);
  const headBones = [neck, head].filter((bone) => !!bone);
  const arms = { r: makeArm(model, 'r'), l: makeArm(model, 'l') };
  const legs = [makeLeg(model, 'l'), makeLeg(model, 'r')].filter((leg) => !!leg);

  const mounted: MountedItem[] = [];
  for (const spec of setup.items) {
    const arm = arms[spec.hand];
    if (!arm) continue;
    const item = makeItem(file, spec, arm.palm, adopt);
    if (!item) continue;
    const scale = arm.limb.end.getWorldScale(new THREE.Vector3());
    item.holder.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
    arm.limb.end.add(item.holder);
    mounted.push(item);
  }
  const mainItem = mounted[0];
  const offItem = mounted[1];
  const mainArm = arms[setup.items[0].hand];
  const otherHand: Hand = setup.items[0].hand === 'r' ? 'l' : 'r';
  const otherArm = arms[otherHand];
  const drinkHand: Hand = offItem ? setup.items[0].hand : otherHand;
  const drinkArm = arms[drinkHand];

  let flask: THREE.Group | null = null;
  const flaskScale = new THREE.Vector3(1, 1, 1);
  if (drinkArm) {
    flask = createFlask(adopt);
    const handScale = drinkArm.limb.end.getWorldScale(new THREE.Vector3());
    flaskScale.set(1 / handScale.x, 1 / handScale.y, 1 / handScale.z);
    flask.position.copy(drinkArm.palm);
    flask.visible = false;
    drinkArm.limb.end.add(flask);
  }

  // Bow extras: the string, drawn as a line so it stays one pixel wide, and the nocked arrow.
  let bowString: THREE.Line | null = null;
  let arrow: THREE.Object3D | null = null;
  let bowLimbs: THREE.Group | null = null;
  let quiver: THREE.Group | null = null;
  // Where the bow is worn, from the chest with its rest rotation taken out, so that these stay in the model's axes.
  const bowBackAt = new THREE.Vector3();
  const bowBackTurn = new THREE.Quaternion();
  let braceDepth = 0;
  let bowTip = 0;
  if (setup.bow && mainItem) {
    const object = mainItem.holder.children[0];
    object.updateMatrix();
    // The limbs' tips sweep back toward the archer, and the string runs between them.
    const local = new THREE.Box3();
    const point = new THREE.Vector3();
    mainItem.holder.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(mainItem.holder.matrixWorld).invert();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 1) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        local.expandByPoint(point);
      }
    });
    braceDepth = -local.min.z - 0.03;
    bowTip = local.max.y - 0.015;
    toModel([0, BOW_BACK_HEIGHT, -(BOW_BACK_CLEARANCE + braceDepth)], bowBackAt);
    basisQuaternion(toModel(BOW_BACK_HEAD, v1), toModel(BOW_BACK_EDGE, v2), bowBackTurn);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, bowTip, -braceDepth),
      new THREE.Vector3(0, 0, -braceDepth),
      new THREE.Vector3(0, -bowTip, -braceDepth),
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0xcbbfa6 });
    extraMaterial(material);
    bowString = new THREE.Line(geometry, material);
    bowString.frustumCulled = false;
    mainItem.holder.add(bowString);

    // A wrapper around the grip, so that the limbs can bend without touching the string or the hand.
    bowLimbs = new THREE.Group();
    mainItem.holder.add(bowLimbs);
    bowLimbs.add(object);

    // Placed from the model's frame into the pelvis's, so that it rides on the hips from then on.
    quiver = createQuiver(adopt);
    quiver.position.set(...QUIVER_AT);
    quiver.rotation.set(QUIVER_TIP_BACK, 0, QUIVER_TIP_OUT);
    model.updateWorldMatrix(true, true);
    quiver.updateMatrix();
    quiver.applyMatrix4(new THREE.Matrix4().copy(pelvis.matrixWorld).invert().multiply(model.matrixWorld));
    pelvis.add(quiver);

    const arrowItem = makeItem(
      file,
      { id: 'arrow', hand: otherHand, length: ARROW_LENGTH, grip: 0, head: ARROW_FILE_AXIS, edge: '+x' },
      new THREE.Vector3(),
      adopt,
    );
    if (arrowItem) {
      arrow = arrowItem.holder.children[0];
      // Lay it along the shot direction, with its tail at the holder's origin.
      const pivot = new THREE.Group();
      pivot.rotation.x = Math.PI / 2;
      pivot.add(arrow);
      mainItem.holder.add(pivot);
      arrow = pivot;
      pivot.visible = false;
    }
  }

  // Everything this rig changes, so it can start from the clips' pose each frame.
  const touched: THREE.Object3D[] = [pelvis, ...spineBones, ...headBones];
  for (const arm of [arms.r, arms.l]) {
    if (!arm) continue;
    if (arm.clavicle) touched.push(arm.clavicle);
    touched.push(arm.limb.upper, arm.limb.lower, arm.limb.end, ...arm.fingers.map((finger) => finger.bone));
  }
  for (const leg of legs) {
    touched.push(leg.limb.upper, leg.limb.lower, leg.limb.end);
    if (leg.ball) touched.push(leg.ball);
  }
  const clipPose = touched.map((bone) => bone.quaternion.clone());
  const pelvisClipPlace = pelvis.position.clone();

  // The pose being shown, and how it's put together.
  const firstFrame = setup.bow ? compiled.slung : compiled.idle;
  const output = copyFrame(firstFrame, makeFrame());
  const sampled = makeFrame();
  const entry = copyFrame(firstFrame, makeFrame());
  const carried = new Float32Array(C.COUNT);
  const carriedMain = new THREE.Quaternion();
  const carriedOff = new THREE.Quaternion();
  let carryAge = 1;
  let carrySeconds = TRANSITION_SECONDS;
  const stepFrom = new Float32Array(C.COUNT);
  let carryIsStep = false;
  let source: AnimationId | null = 'idle';
  let needsCarry = false;

  let attackClock = 0;
  let attackIndex = 0;
  let attacking = false;
  let drinkClock = 0;
  let dodgeClock = 0;
  let gaitTurn = 0;
  let bowHands = 0;
  let handDraw = 0;
  let lastDraw = 0;
  let bowFlex = 0;
  let bowFlexSpeed = 0;
  let arrowDrawn = false;
  // A bow's place: whether the body has let go of it, and from 0 on the back to 1 in the hand.
  let bowSlung = !!setup.bow;
  let sitBlend = 0;
  let weaponsPutAway = false;
  let bowReadyLeft = 0;
  let bowInHand = 0;
  let bowFromBack = false;
  let stretch = 0;
  let legStretch = 0;
  let clock = 0;
  const breathPhase = Math.random() * Math.PI * 2;
  const life = setup.life;
  // Walking and running: how far along each is, and the averages that the rise and fall are measured from.
  let gaitBlend = 0;
  let runBlend = 0;
  let pelvisAverage = -1;
  let chestAverage = -1;
  let carryLag = 0;
  let frameSeconds = 0;

  // Scratch space for the body pass. The limb solver has its own at the top of this file.
  const modelRotation = new THREE.Quaternion();
  const bodyRotation = new THREE.Quaternion();
  const bodyBend = new THREE.Quaternion();
  const drawHand = new THREE.Quaternion();
  const chestAt = new THREE.Vector3();
  const pelvisAt = new THREE.Vector3();
  const pelvisRotation = new THREE.Quaternion();
  const running = new THREE.Quaternion();
  const part = new THREE.Quaternion();
  const scratchQ = new THREE.Quaternion();
  const scratchQ2 = new THREE.Quaternion();
  const scratchV = new THREE.Vector3();
  const scratchV2 = new THREE.Vector3();
  const gripAt = new THREE.Vector3();
  const limbTarget = new THREE.Vector3();
  const limbPole = new THREE.Vector3();
  const limbRotation = new THREE.Quaternion();
  const bowPlace = new THREE.Vector3();
  const bowHandPlace = new THREE.Vector3();
  const bowTurn = new THREE.Quaternion();
  const bowHandTurn = new THREE.Quaternion();
  const bowChestTurn = new THREE.Quaternion();

  /**
   * Feet moved a long way by a blend would slide across the floor. This lifts them instead, the one
   * with further to go first, so that the blend reads as a step or two. `to` holds the blend so far.
   */
  const stepFeet = (to: Float32Array, from: Float32Array, target: Float32Array, u: number) => {
    const farL = Math.hypot(from[C.FOOT_L] - target[C.FOOT_L], from[C.FOOT_L + 1] - target[C.FOOT_L + 1]);
    const farR = Math.hypot(from[C.FOOT_R] - target[C.FOOT_R], from[C.FOOT_R + 1] - target[C.FOOT_R + 1]);
    const bothStep = farL >= STEP_MIN_DISTANCE && farR >= STEP_MIN_DISTANCE;
    for (let side = 0; side < 2; side += 1) {
      const foot = side === 0 ? C.FOOT_L : C.FOOT_R;
      const far = side === 0 ? farL : farR;
      if (far < STEP_MIN_DISTANCE || target[foot + 4] < 0.5 || from[foot + 4] < 0.5) continue;
      const second = bothStep && (side === 0 ? farL < farR : farR <= farL);
      const part = !bothStep ? u : second ? (u - STEP_SECOND_FOOT_AT) / (1 - STEP_SECOND_FOOT_AT) : u / (1 - STEP_SECOND_FOOT_AT);
      const v = Math.min(1, Math.max(0, part));
      const moved = v * v * (3 - 2 * v);
      to[foot] = from[foot] + (target[foot] - from[foot]) * moved;
      to[foot + 1] = from[foot + 1] + (target[foot + 1] - from[foot + 1]) * moved;
      // A back foot already on its toes doesn't need to climb any higher than a flat one.
      to[foot + 2] = Math.max(to[foot + 2], STEP_LIFT * smoothStep(STEP_MIN_DISTANCE, STEP_FULL_DISTANCE, far) * Math.sin(v * Math.PI));
    }
  };

  const sampleAttack = () => {
    const frames = compiled.attacks[attackIndex % compiled.attacks.length].frames;
    if (!frames) {
      copyFrame(compiled.dodge, sampled);
      sampled.ch[C.MAIN_WEIGHT] = 0;
      return;
    }
    const t = Math.min(1, attackClock / attackSeconds);
    const count = frames.length;
    let next = 0;
    while (next < count && frames[next].at <= t) next += 1;
    const from = next > 0 ? frames[next - 1].at : 0;
    const to = next < count ? frames[next].at : 1;
    // A last key at 1 holds to the very end, so the next attack chains from it and not from the stance.
    const eased = easeAmount(next < count ? frames[next].ease : 'smooth', to > from ? (t - from) / (to - from) : 0);

    const p0 = next >= 2 ? frames[next - 2] : entry;
    const p1 = next >= 1 ? frames[next - 1] : entry;
    const p2 = next < count ? frames[next] : compiled.idle;
    const p3 = next + 1 < count ? frames[next + 1] : compiled.idle;
    const { ch } = sampled;
    for (let i = 0; i < C.COUNT; i += 1) ch[i] = p1.ch[i] + (p2.ch[i] - p1.ch[i]) * eased;
    const steppingIn = next === 0 && count > 0;
    for (let i = 0; i < SPLINED.length; i += 1) {
      splineInto(ch, SPLINED[i][0], SPLINED[i][1], p0.ch, p1.ch, p2.ch, p3.ch, eased);
    }
    // The recovery heads for the stance, but the attack's clip is still playing, so the steadying stays.
    if (next >= count) ch[C.STEADY] = p1.ch[C.STEADY];
    if (steppingIn) stepFeet(ch, entry.ch, p2.ch, to > from ? (t - from) / (to - from) : 1);
    splineRotation(sampled.main, p0.main, p1.main, p2.main, p3.main, eased);
    splineRotation(sampled.off, p0.off, p1.off, p2.off, p3.off, eased);
  };

  /** The tuck peaks halfway through the roll and is gone at both ends, so it never pops. */
  const sampleDodge = () => {
    copyFrame(compiled.dodge, sampled);
    const tuck = setup.roll;
    if (!tuck) return;
    const bell = Math.sin(Math.min(1, dodgeClock / DODGE_SECONDS) * Math.PI) ** 2;
    sampled.ch[C.HIPS + 1] += (tuck.lift ?? 0) * bell;
    sampled.ch[C.LEAN] += (tuck.curl ?? 0) * bell;
  };

  const sampleDrink = () => {
    copyFrame(compiled.drink, sampled);
    const d = drinkClock / drinkSeconds;
    const raised = smoothStep(0.05, 0.3, d) * (1 - smoothStep(0.78, 1, d));
    const outside = drinkHand === 'l' ? 0.2 : -0.2;
    sampled.ch[C.HEAD_PITCH] += DRINK_HEAD_BACK * drinkTipAt(d);
    sampled.ch[C.LEAN] += DRINK_LEAN_BACK * drinkTipAt(d);
    sampled.ch[C.FREE] = outside + (-MOUTH[0] - outside) * raised;
    sampled.ch[C.FREE + 1] = -0.32 + (MOUTH[1] + 0.32) * raised;
    sampled.ch[C.FREE + 2] = 0.1 + (MOUTH[2] - 0.1) * raised;
  };

  /** Slow shifts of weight on top of the stance. They only add to the frame, so a stance's shape stays as authored. */
  const sampleIdle = () => {
    copyFrame(compiled.idle, sampled);
    if (!life) return;
    const t = clock + breathPhase;
    const { ch } = sampled;
    const rise = Math.sin(t * LIFE_SINK_RATE);
    const shift = Math.sin(t * LIFE_SHIFT_RATE);
    ch[C.HIPS] += (shift * (life.shift ?? 0)) / 2;
    ch[C.HIPS + 1] += (rise * (life.sink ?? 0)) / 2;
    ch[C.HIP_ROLL] -= shift * (life.shift ?? 0);
    ch[C.LEAN] -= rise * (life.sink ?? 0);
    if (life.drift && mainItem) {
      // Turned by the angle that moves the head that far, a beat behind the chest.
      const angle = (Math.sin(t * LIFE_SINK_RATE - LIFE_DRIFT_DELAY) * life.drift) / 2 / mainItem.tip;
      sampled.main.premultiply(scratchQ.setFromAxisAngle(X_AXIS, angle));
    }
    if (life.resettle) {
      // A short lift once a loop, so that the hands look like they are taking a better hold.
      const lift = Math.max(0, Math.sin(t * LIFE_RESETTLE_RATE));
      ch[C.GRIP + 1] += life.resettle * lift ** 12;
    }
  };

  const sample = (animation: AnimationId) => {
    if (animation === 'rest') {
      copyFrame(compiled.rest, sampled);
      return;
    }
    if (bowSlung && animation !== 'drink') {
      copyFrame(compiled.slung, sampled);
      return;
    }
    switch (animation) {
      case 'attack':
        sampleAttack();
        break;
      case 'idle':
        sampleIdle();
        break;
      case 'drink':
        sampleDrink();
        break;
      case 'dodge':
        sampleDodge();
        break;
      default:
        copyFrame(compiled[animation], sampled);
    }
  };

  /** Lands on the sampled pose, plus what's left of the difference from the last animation. */
  const composeOutput = () => {
    if (needsCarry) {
      for (let i = 0; i < C.COUNT; i += 1) carried[i] = output.ch[i] - sampled.ch[i];
      if (carryIsStep) stepFrom.set(output.ch);
      // Feet stepping into an attack start from where they are, and fading in the first frame's move would flatten the step.
      if (source === 'attack') {
        for (const foot of [C.FOOT_L, C.FOOT_R]) carried.fill(0, foot, foot + 3);
      }
      carriedMain.copy(output.main).multiply(scratchQ.copy(sampled.main).invert());
      carriedOff.copy(output.off).multiply(scratchQ.copy(sampled.off).invert());
      carryAge = 0;
      needsCarry = false;
    }
    if (carryAge >= 1) {
      copyFrame(sampled, output);
      return;
    }
    const left = (1 - carryAge) * (1 - carryAge) * (1 + 2 * carryAge);
    for (let i = 0; i < C.COUNT; i += 1) output.ch[i] = sampled.ch[i] + carried[i] * left;
    if (carryIsStep) stepFeet(output.ch, stepFrom, sampled.ch, carryAge);
    output.main.identity().slerp(carriedMain, left).multiply(sampled.main);
    output.off.identity().slerp(carriedOff, left).multiply(sampled.off);
  };

  /** Decides where the bow belongs this frame. Running and rolling put it away at once, whatever the delay has left. */
  const updateBowCarry = (seconds: number, animation: AnimationId) => {
    if (animation === 'attack') bowReadyLeft = BOW_READY_SECONDS;
    else if (animation === 'idle' || animation === 'walk' || animation === 'hit') bowReadyLeft = Math.max(0, bowReadyLeft - seconds);
    else bowReadyLeft = 0;
    const wasSlung = bowSlung;
    bowSlung = animation !== 'attack' && animation !== 'death' && bowReadyLeft <= 0;
    if (bowSlung && !wasSlung) {
      // Letting go is a blend like any other, so the arms ease back to the clips without a pop.
      needsCarry = true;
      carryIsStep = false;
      carrySeconds = BOW_STOW_SECONDS;
    }
    if (animation === 'attack') {
      const taken = (attackClock / attackSeconds - BOW_TAKE_FROM) / (BOW_TAKE_UNTIL - BOW_TAKE_FROM);
      bowInHand = Math.max(bowInHand, Math.min(1, taken));
    } else if (animation !== 'death') {
      // Dead hands stay as they were: a bow in hand falls with the hand.
      bowInHand = Math.min(1, Math.max(0, bowInHand + ((bowSlung ? -1 : 1) * seconds) / BOW_STOW_SECONDS));
    }
  };

  /** A shot that starts from the back sends the right hand behind the shoulder first. The bell is gone by the shot's first key, which then plays as authored. */
  const reachForBow = () => {
    const u = attackClock / (attackSeconds * BOW_REACH_UNTIL);
    if (u >= 1) return;
    const { ch } = output;
    const bell = Math.sin(u * Math.PI) ** 2;
    ch[C.FREE] += (-BOW_REACH_AT[0] - ch[C.FREE]) * bell;
    ch[C.FREE + 1] += (BOW_REACH_AT[1] - ch[C.FREE + 1]) * bell;
    ch[C.FREE + 2] += (BOW_REACH_AT[2] - ch[C.FREE + 2]) * bell;
    ch[C.FREE_WEIGHT] = Math.max(ch[C.FREE_WEIGHT], smoothStep(0, 0.4, u));
  };

  /**
   * The bow stays a child of the hand, so the string and arrow need nothing new. This runs last and turns the
   * chest's mount into the hand's frame. Everything is relative, so the bow rides on spine_03 when fully on the back.
   */
  const placeBow = () => {
    if (!mainItem || !mainArm) return;
    const u = smoothStep(0, 1, bowInHand);
    if (u >= 0.999) return;
    const hand = mainArm.limb.end;
    worldRotation(chest, bowChestTurn).multiply(chestRest);
    worldPosition(chest, bowPlace).add(scratchV.copy(bowBackAt).applyQuaternion(bowChestTurn));
    bowTurn.copy(bowChestTurn).multiply(bowBackTurn);
    worldRotation(hand, scratchQ);
    if (u > 0.001) {
      hand.localToWorld(bowHandPlace.copy(mainArm.palm));
      bowHandTurn.copy(scratchQ).multiply(mainItem.gripRotation);
      bowPlace.lerp(bowHandPlace, u);
      const arc = Math.sin(u * Math.PI);
      bowPlace.add(scratchV.set(BOW_ARC_OUT * arc, BOW_ARC_UP * arc, 0).applyQuaternion(bowChestTurn));
      bowTurn.slerp(bowHandTurn, u);
    }
    mainItem.holder.position.copy(hand.worldToLocal(bowPlace));
    mainItem.holder.quaternion.copy(scratchQ.invert()).multiply(bowTurn);
    mainItem.holder.updateWorldMatrix(false, true);
  };

  /** Both hands come to rest on the knees. Each uses the free hand's reach in turn, with its side mirrored. */
  const restHands = () => {
    const { ch } = output;
    for (const arm of [arms.l, arms.r]) {
      if (!arm) continue;
      ch[C.FREE] = (arm.hand === 'l' ? 1 : -1) * SIT_HAND[0];
      ch[C.FREE + 1] = SIT_HAND[1];
      ch[C.FREE + 2] = SIT_HAND[2];
      reachFree(arm, 0, sitBlend);
      closeHand(arm, SIT_FINGERS, sitBlend);
    }
  };

  /** Lets the shoulder come forward and up with the arm when it needs the extra reach. */
  const reachClavicle = (arm: Arm, goal: THREE.Vector3, weight: number) => {
    const { clavicle, limb } = arm;
    if (!clavicle) return;
    const base = worldPosition(clavicle, scratchV);
    const shoulder = worldPosition(limb.upper, scratchV2);
    const armLength = limb.upperLength + limb.lowerLength;
    let share = 0.08 + 0.38 * smoothStep(0.55, 1.1, goal.distanceTo(shoulder) / armLength);
    shoulder.sub(base).normalize();
    base.subVectors(goal, base).normalize();
    scratchQ.setFromUnitVectors(shoulder, base);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(scratchQ.w)));
    if (angle * share > CLAVICLE_MAX_ANGLE) share = CLAVICLE_MAX_ANGLE / angle;
    scratchQ2.identity().slerp(scratchQ, share * weight);
    worldRotation(clavicle, scratchQ);
    scratchQ.premultiply(scratchQ2);
    worldRotation(clavicle.parent!, scratchQ2).invert();
    clavicle.quaternion.copy(scratchQ2.multiply(scratchQ));
    clavicle.updateWorldMatrix(false, true);
  };

  const elbowPole = (hand: Hand, raised: number, back = 0) =>
    limbPole.set(hand === 'r' ? -0.65 : 0.65, -0.72 + raised, -0.25 - back).applyQuaternion(bodyRotation);

  /** Puts a hand on an item: `position` is the grip point in world space, and `rotation` the item's. */
  const reachWithItem = (
    arm: Arm,
    position: THREE.Vector3,
    itemRotation: THREE.Quaternion,
    gripInverse: THREE.Quaternion,
    raised: number,
    weight: number,
    back = 0,
  ) => {
    limbRotation.copy(itemRotation).multiply(gripInverse);
    limbTarget.copy(position).sub(scratchV.copy(arm.palm).applyQuaternion(limbRotation));
    reachClavicle(arm, limbTarget, weight);
    const reached = solveLimb(arm.limb, limbTarget, elbowPole(arm.hand, raised, back), limbRotation, FOREARM_ROLL_SHARE, weight);
    // A hand that has nearly let go isn't really reaching for this, so it doesn't count.
    if (weight > 0.5) stretch = Math.max(stretch, reached);
  };

  const closeHand = (arm: Arm, amount: number, weight: number, thumb?: Vec3) => {
    const firstThumbJoint = arm.fingers.length - 3;
    for (let i = 0; i < arm.fingers.length; i += 1) {
      const { bone, rest, axis, angle } = arm.fingers[i];
      const turn = thumb && i >= firstThumbJoint ? THREE.MathUtils.degToRad(thumb[i - firstThumbJoint]) : angle * amount;
      q1.setFromAxisAngle(axis, turn);
      q2.copy(rest).multiply(q1);
      bone.quaternion.slerp(q2, weight);
    }
  };

  const captureLeg = (leg: Leg) => {
    worldPosition(leg.limb.upper, leg.clipHip);
    worldPosition(leg.limb.lower, leg.clipKnee);
    worldPosition(leg.limb.end, leg.clipAnkle);
    if (leg.ball) worldPosition(leg.ball, leg.clipBall);
    worldRotation(leg.limb.upper, leg.clipThigh);
    worldRotation(leg.limb.end, leg.clipFoot);
  };

  const solveLeg = (leg: Leg, body: number) => {
    const { ch } = output;
    const { limb, channel, side } = leg;
    const weight = Math.min(1, Math.max(0, ch[channel + 4]));
    // Even a clip's legs need bending when the pelvis moved away from them.
    const solveWeight = Math.max(weight, body);
    if (solveWeight < 0.002) return;

    limbTarget.copy(leg.clipAnkle);
    const walking = gaitBlend - runBlend;
    if (life?.walkWidth && walking > 0.002) {
      // The walk clip puts the feet in one line, and a fighter on guard keeps them apart.
      model.worldToLocal(limbTarget);
      limbTarget.x += side * life.walkWidth * walking;
      model.localToWorld(limbTarget);
    }
    if (life?.runStride !== undefined && runBlend > 0.002) {
      // Shorter, lower steps than the clip's, with the feet still landing under the body.
      model.worldToLocal(limbTarget);
      const scale = 1 + (life.runStride - 1) * runBlend;
      limbTarget.z = RUN_STRIDE_MIDDLE + (limbTarget.z - RUN_STRIDE_MIDDLE) * scale;
      // Only the swing comes down: a heel lifted off the floor stays where it is, or the toes would sink.
      if (life.runLift !== undefined && leg.ball) {
        // Measured at the ball of the foot, so that the toes come down towards the floor but never through it.
        const ballAbove = model.worldToLocal(scratchV.copy(leg.clipBall)).y - leg.ballAt.y;
        if (ballAbove > 0) limbTarget.y -= ballAbove * (1 - life.runLift) * runBlend;
      } else {
        const swing = limbTarget.y - leg.ankleAbove - leg.ballAt.y - RUN_HEEL_LIFT;
        if (swing > 0) limbTarget.y -= swing * (1 - Math.sqrt(scale));
      }
      model.localToWorld(limbTarget);
    }
    limbRotation.copy(leg.clipFoot);
    limbPole.copy(leg.clipKnee).sub(leg.clipHip);
    if (life?.runLift !== undefined && runBlend > 0.002) {
      // The foot is now further under the hip than the clip's, so a knee still aimed behind the body would bend backward.
      limbPole.normalize().add(scratchV.set(0, 0, 1.5 * runBlend).applyQuaternion(modelRotation));
    }
    if (weight > 0.002) {
      const lift = Math.max(0, ch[channel + 2]);
      const yaw = ch[channel + 3] * side;
      const pitch = Math.min(lift / leg.ankleBehind, MAX_HEEL_PITCH) * (1 - smoothStep(FOOT_FLAT_FROM, FOOT_FLAT_BY, lift));
      const cos = Math.cos(pitch);
      const sin = Math.sin(pitch);
      const above = leg.ankleAbove * cos + leg.ankleBehind * sin;
      const behind = leg.ankleBehind * cos - leg.ankleAbove * sin;
      const ballLift = Math.max(0, lift - (above - leg.ankleAbove));
      const forward = leg.ballAt.z - behind;
      const yawSin = Math.sin(yaw);
      const yawCos = Math.cos(yaw);
      // The ankle, measured around the middle of the foot, in the model's frame.
      scratchV.set(ch[channel] + forward * yawSin, leg.ballAt.y + ballLift + above, ch[channel + 1] + forward * yawCos);
      model.localToWorld(scratchV);
      limbTarget.lerp(scratchV, weight);

      euler.set(pitch, yaw, 0);
      scratchQ.setFromEuler(euler);
      scratchQ.premultiply(modelRotation).multiply(leg.footRest);
      limbRotation.slerp(scratchQ, weight);

      const length = limbPole.length();
      scratchV.set(yawSin + side * KNEE_OUTWARD, 0, yawCos).applyQuaternion(modelRotation);
      limbPole.divideScalar(Math.max(length, 0.0001)).lerp(scratchV, weight);
    }
    if (sitBlend > 0.002) {
      scratchV.set(side * SIT_KNEE_OUT, SIT_KNEE_UP, SIT_KNEE_FORWARD).applyQuaternion(modelRotation);
      limbPole.normalize().lerp(scratchV, sitBlend);
    }

    legStretch = Math.max(legStretch, solveLimb(limb, limbTarget, limbPole, limbRotation, 0, solveWeight));

    if (leg.ball && weight > 0.002) {
      // The toes stay level with the ground, whatever the heel does.
      euler.set(0, ch[channel + 3] * side, 0);
      scratchQ.setFromEuler(euler).premultiply(modelRotation).multiply(leg.ballRest);
      worldRotation(limb.end, scratchQ2).invert().multiply(scratchQ);
      leg.ball.quaternion.slerp(scratchQ2, weight);
      leg.ball.updateWorldMatrix(false, false);
    }
  };

  const moveBody = () => {
    const { ch } = output;
    const steady = ch[C.STEADY];
    const breath = ch[C.BREATH] > 0 ? Math.sin(clock * BREATH_RATE + breathPhase) * ch[C.BREATH] : 0;
    const planted = Math.min(ch[C.FOOT_L + 4], ch[C.FOOT_R + 4]);

    worldRotation(model, modelRotation);
    for (const leg of legs) captureLeg(leg);

    // Straighten what the clip twisted, starting at the pelvis.
    const parent = pelvis.parent!;
    worldPosition(pelvis, pelvisAt);
    worldRotation(pelvis, pelvisRotation);
    if (steady > 0.002) {
      // The clip's pelvis height goes with the clip's legs, so only authored feet can replace it.
      model.localToWorld(scratchV.copy(pelvisPlace));
      pelvisAt.lerp(scratchV, steady * planted);
      scratchQ.copy(modelRotation).multiply(pelvisAtRest);
      pelvisRotation.slerp(scratchQ, steady);
    }
    if (life?.runBob !== undefined && frameSeconds > 0) {
      // Keeps less of the run clip's rise and fall, and the legs take up the difference.
      const height = pelvisAt.y - model.matrixWorld.elements[13];
      if (pelvisAverage < 0) pelvisAverage = height;
      pelvisAverage += (height - pelvisAverage) * (1 - Math.exp(-frameSeconds / BOB_AVERAGE_SECONDS));
      pelvisAt.y -= (height - pelvisAverage) * (1 - life.runBob) * runBlend;
    } else if (life?.runBob !== undefined && pelvisAverage >= 0) {
      const height = pelvisAt.y - model.matrixWorld.elements[13];
      pelvisAt.y -= (height - pelvisAverage) * (1 - life.runBob) * runBlend;
    }
    const hipsY = ch[C.HIPS + 1] + breath * BREATH_HIPS * planted;
    scratchV.set(ch[C.HIPS], hipsY, ch[C.HIPS + 2]).applyQuaternion(modelRotation);
    pelvisAt.add(scratchV);

    if (steady > 0.002) {
      running.copy(pelvisRotation);
      for (const bone of spineBones) running.multiply(bone.quaternion);
      scratchQ.copy(modelRotation).multiply(chestAtRest).multiply(running.invert());
      part.identity().slerp(scratchQ, steady / spineBones.length);
      running.copy(pelvisRotation);
      for (const bone of spineBones) {
        scratchQ.copy(running).multiply(bone.quaternion).premultiply(part);
        bone.quaternion.copy(running.invert().multiply(scratchQ));
        running.copy(scratchQ);
      }
    }

    // The frame that grips are measured in: where the chest would be with no extra bending.
    chestAt.copy(pelvisAt);
    running.copy(pelvisRotation);
    for (const bone of spineBones) {
      chestAt.add(scratchV.copy(bone.position).applyQuaternion(running));
      running.multiply(bone.quaternion);
    }
    bodyRotation.copy(running).multiply(chestRest);

    if (life?.handLag !== undefined || life?.offLag !== undefined) {
      const height = chestAt.y - model.matrixWorld.elements[13];
      if (chestAverage < 0) chestAverage = height;
      chestAverage += (height - chestAverage) * (1 - Math.exp(-frameSeconds / LAG_SECONDS));
      carryLag = (chestAverage - height) * gaitBlend;
    }

    gaitTurn = 0;
    if (life?.gaitSwing && gaitBlend > 0.002 && legs.length === 2) {
      // The stride is read from the clip's knees, so the swing stays in step whatever the clip's speed is. Left leg forward, right shoulder forward.
      scratchV.copy(legs[0].clipKnee).sub(legs[1].clipKnee);
      scratchV2.set(0, 0, 1).applyQuaternion(modelRotation);
      const leftAhead = scratchV.dot(scratchV2) * (legs[0].limb.upper.name.endsWith('_l') ? 1 : -1);
      gaitTurn = -life.gaitSwing * Math.max(-1, Math.min(1, leftAhead / GAIT_FULL_STRIDE)) * gaitBlend;
      ch[C.TURN] += gaitTurn;
    }

    // Now the authored bending: hips, then the spine makes up the rest of the way to the shoulders.
    const hipTurn = ch[C.HIP_TURN];
    const hipTilt = ch[C.HIP_TILT];
    const hipRoll = ch[C.HIP_ROLL];
    const turn = ch[C.TURN] - hipTurn;
    const lean = ch[C.LEAN] - hipTilt - breath * BREATH_CHEST;
    pelvisRotation.premultiply(bodyTurn(hipTurn, hipTilt, hipRoll, bodyRotation, scratchQ));
    bodyBend.copy(scratchQ);
    running.copy(pelvisRotation);
    for (let i = 0; i < spineBones.length; i += 1) {
      const share = SPINE_SHARE[i];
      const bone = spineBones[i];
      bodyTurn(turn * share, lean * share, -hipRoll * share, bodyRotation, scratchQ2);
      bodyBend.premultiply(scratchQ2);
      scratchQ.copy(running).multiply(bone.quaternion).premultiply(scratchQ2);
      bone.quaternion.copy(running.invert().multiply(scratchQ));
      running.copy(scratchQ);
    }

    // The head makes up most of that again, so that the eyes stay on the target.
    const unfollow = (1 - ch[C.HEAD]) / 2;
    if (setup.levelHead) {
      // Exactly undoes the bend of the hips and spine, so that a turned and leaning fighter's head doesn't roll.
      part.identity().slerp(bodyBend.invert(), unfollow);
      part.premultiply(bodyTurn(0, ch[C.HEAD_PITCH] / 2, 0, bodyRotation, scratchQ2));
    } else {
      bodyTurn(-ch[C.TURN] * unfollow, (ch[C.HEAD_PITCH] / 2) - ch[C.LEAN] * unfollow, 0, bodyRotation, part);
    }
    for (let i = 0; i < headBones.length; i += 1) {
      const bone = headBones[i];
      scratchQ.copy(running).multiply(bone.quaternion).premultiply(part);
      bone.quaternion.copy(running.invert().multiply(scratchQ));
      running.copy(scratchQ);
    }
    if (life?.runHeadLevel && runBlend > 0.002 && headBones.length > 0) {
      // The run clip nods and swings the head on every step. Steadying the body leaves the head doing that alone, so
      // this turns the last head bone back towards a steady gaze straight ahead.
      const amount = life.runHeadLevel * runBlend;
      scratchV.set(0, 0, 1).applyQuaternion(running).applyQuaternion(scratchQ2.copy(modelRotation).invert());
      const nod = (Math.asin(Math.min(1, Math.max(-1, scratchV.y))) - RUN_HEAD_GAZE) * amount;
      const swing = -Math.atan2(scratchV.x, scratchV.z) * amount;
      scratchV.set(1, 0, 0).applyQuaternion(modelRotation);
      scratchQ.setFromAxisAngle(scratchV, nod);
      scratchV.set(0, 1, 0).applyQuaternion(modelRotation);
      scratchQ.premultiply(scratchQ2.setFromAxisAngle(scratchV, swing));
      headBones[headBones.length - 1].quaternion.multiply(scratchQ2.copy(running).invert().multiply(scratchQ).multiply(running));
    }

    // Put it all on the bones. Legs keep what the clip wanted, until they're solved below.
    worldRotation(parent, scratchQ).invert();
    pelvis.quaternion.copy(scratchQ).multiply(pelvisRotation);
    pelvis.position.copy(pelvisAt);
    parent.worldToLocal(pelvis.position);
    scratchQ.copy(pelvisRotation).invert();
    for (const leg of legs) leg.limb.upper.quaternion.copy(scratchQ).multiply(leg.clipThigh);
    pelvis.updateWorldMatrix(false, true);

    const moved = Math.abs(ch[C.HIPS]) + Math.abs(ch[C.HIPS + 1]) + Math.abs(ch[C.HIPS + 2]);
    const body = Math.max(steady, Math.min(1, moved * 50), life?.runBob !== undefined ? runBlend : 0);
    for (const leg of legs) solveLeg(leg, body);
  };

  /** A hand holding no item, sent to the point in the FREE channels. */
  const reachFree = (arm: Arm, breath: number, freeWeight: number) => {
    const { ch } = output;
    chestOffset(C.FREE, breath, limbTarget);
    // The position given is the palm's, which sits a little past the wrist.
    worldPosition(arm.limb.upper, scratchV2);
    scratchV2.sub(limbTarget).setLength(arm.palm.y);
    limbTarget.add(scratchV2);
    reachClavicle(arm, limbTarget, Math.min(1, freeWeight));
    // An archer's hand up by the jaw has just let go of the string, so its elbow stays up behind the arrow's line.
    const elbowUp = setup.bow ? Math.max(0, Math.min(1, ch[C.FREE + 1] / BOW_ELBOW_UP_HEIGHT)) : 0;
    const reached = solveLimb(arm.limb, limbTarget, elbowPole(arm.hand, 0.7 * elbowUp, 1 * elbowUp), null, 0, Math.min(1, freeWeight));
    stretch = Math.max(stretch, reached);
  };

  const moveArms = () => {
    const { ch } = output;
    const breath = ch[C.BREATH] > 0 ? Math.sin(clock * BREATH_RATE + breathPhase) * ch[C.BREATH] * BREATH_RISE : 0;

    const mainWeight = ch[C.MAIN_WEIGHT];
    if (mainArm && mainItem && mainWeight > 0.002) {
      scratchQ2.copy(bodyRotation).multiply(output.main);
      chestOffset(C.GRIP, breath, gripAt);
      if (life?.handLag && carryLag !== 0) {
        // The weapon's weight trails the step, so the hand drops late and the head rocks with it.
        const trail = carryLag * life.handLag;
        gripAt.y += trail;
        scratchV.set(1, 0, 0).applyQuaternion(bodyRotation);
        scratchQ2.premultiply(scratchQ.setFromAxisAngle(scratchV, trail * LAG_ROCK));
      }
      if (gaitTurn !== 0) {
        // The hand goes with its shoulder, and the head of the weapon rocks a little with the hand.
        gripAt.add(scratchV.set(0, 0, -gaitTurn * GAIT_HAND_SWING).applyQuaternion(bodyRotation));
        scratchV.set(1, 0, 0).applyQuaternion(bodyRotation);
        scratchQ2.premultiply(scratchQ.setFromAxisAngle(scratchV, -gaitTurn * GAIT_ROCK));
      }
      reachWithItem(mainArm, gripAt, scratchQ2, mainItem.gripInverse, 0, Math.min(1, mainWeight));
    }

    if (otherArm && offItem) {
      const offWeight = ch[C.OFF_WEIGHT];
      if (offWeight > 0.002) {
        scratchQ2.copy(bodyRotation).multiply(output.off);
        chestOffset(C.OFF, breath, gripAt);
        if (life?.offLag) gripAt.y += carryLag * life.offLag;
        // Much less than the main hand: this is a guard, and it stays in front.
        if (gaitTurn !== 0) gripAt.add(scratchV.set(0, 0, gaitTurn * GAIT_OFF_SWING).applyQuaternion(bodyRotation));
        reachWithItem(otherArm, gripAt, scratchQ2, offItem.gripInverse, 0, Math.min(1, offWeight));
      }
      // The weapon hand has let go of its weapon, to drink.
      if (mainArm && ch[C.FREE_WEIGHT] > 0.002 && mainWeight < 0.998) reachFree(mainArm, breath, ch[C.FREE_WEIGHT]);
    } else if (otherArm) {
      const freeWeight = ch[C.FREE_WEIGHT];
      if (freeWeight > 0.002) reachFree(otherArm, breath, freeWeight);

      // The second hand goes wherever the weapon now is, so it stays on the handle.
      const together = setup.bow ? bowHands : ch[C.SECOND_HAND];
      if (mainItem && together > 0.002) {
        worldRotation(mainItem.holder, scratchQ2);
        // A hand further along a long shaft comes at it from a different side than the main hand does.
        if (setup.secondHandRoll) scratchQ2.multiply(scratchQ.setFromAxisAngle(ARROW_UP, setup.secondHandRoll));
        if (setup.bow) gripAt.set(0, 0, -braceDepth * (1 + BOW_FLEX_DEPTH * Math.min(1, handDraw)) - handDraw * DRAW_LENGTH);
        else gripAt.set(0, -ch[C.REACH], 0);
        mainItem.holder.localToWorld(gripAt);
        // The further the string comes back, the higher and further behind the drawing elbow rides.
        const drawn = setup.bow ? Math.min(1, handDraw) : 0;
        // The drawing hand isn't holding the bow's frame: it rolls over, back of the hand out, as an archer's elbow rises.
        drawHand.setFromAxisAngle(ARROW_UP, BOW_DRAW_HAND_ROLL * drawn).premultiply(mainItem.gripInverse);
        reachWithItem(otherArm, gripAt, scratchQ2, setup.bow ? drawHand : mainItem.gripInverse, setup.bow ? 0.75 + 1.6 * drawn : 0, Math.min(1, together), setup.bow ? 0.9 * drawn : -(setup.secondElbowForward ?? 0));
      }
    }

    // A bow's hands are empty until they take hold, and the weights below blend from this into the grip.
    if (setup.bow) {
      if (mainArm) closeHand(mainArm, RELAXED_FINGERS, 1);
      if (otherArm) closeHand(otherArm, RELAXED_FINGERS, 1);
    }
    if (mainArm) closeHand(mainArm, mainItem?.spec.curl ?? 1, setup.bow ? Math.min(1, mainWeight) : 1, mainItem?.spec.thumb);
    if (otherArm) {
      if (offItem) closeHand(otherArm, offItem.spec.curl ?? 1, 1);
      else {
        const freeWeight = ch[C.FREE_WEIGHT];
        const together = Math.min(1, setup.bow ? bowHands : ch[C.SECOND_HAND]);
        if (freeWeight > 0.01) closeHand(otherArm, ch[C.FREE_FINGERS], Math.min(1, freeWeight));
        if (together > 0.01) closeHand(otherArm, setup.bow ? 0.7 : 1, together, setup.bow ? undefined : mainItem?.spec.thumb);
      }
    }
  };

  /** A channel's point, in the chest's frame, as a world position. Rises a little with each breath. */
  const chestOffset = (channel: number, rise: number, to: THREE.Vector3) => {
    const { ch } = output;
    return to.set(ch[channel], ch[channel + 1] + rise, ch[channel + 2]).applyQuaternion(bodyRotation).add(chestAt);
  };

  return {
    beforeClips() {
      touched.forEach((bone, i) => bone.quaternion.copy(clipPose[i]));
      pelvis.position.copy(pelvisClipPlace);
    },

    afterClips() {
      touched.forEach((bone, i) => clipPose[i].copy(bone.quaternion));
      pelvisClipPlace.copy(pelvis.position);
    },

    apply(seconds, animation) {
      clock += seconds;
      frameSeconds = seconds;
      const gaitStep = 1 - Math.exp(-seconds * GAIT_BLEND_RATE);
      gaitBlend += ((animation === 'walk' || animation === 'run' ? 1 : 0) - gaitBlend) * gaitStep;
      runBlend += ((animation === 'run' ? 1 : 0) - runBlend) * gaitStep;
      if (animation === 'attack') attackClock += seconds;
      else attacking = false;
      if (attacking && attackClock >= attackSeconds) attacking = false;
      if (animation !== source) {
        carryIsStep = source === 'attack' && animation === 'idle';
        const leavingRun = source === 'run';
        const leavingRest = source === 'rest';
        source = animation;
        needsCarry = true;
        carrySeconds =
          animation === 'attack'
            ? ATTACK_TRANSITION_SECONDS
            : animation === 'death'
              ? DEATH_TRANSITION_SECONDS
              : animation === 'hit'
                ? HIT_TRANSITION_SECONDS
                : animation === 'run' || (leavingRun && life?.runBlendSeconds !== undefined)
                  ? (life?.runBlendSeconds ?? RUN_TRANSITION_SECONDS)
                  : carryIsStep
                    ? RECOVER_TRANSITION_SECONDS
                    : TRANSITION_SECONDS;
        if (animation === 'rest' || leavingRest) carrySeconds = SIT_SECONDS;
        if (animation === 'drink') drinkClock = 0;
        if (animation === 'dodge') dodgeClock = 0;
      }
      if (animation === 'drink') drinkClock += seconds;
      if (animation === 'dodge') dodgeClock += seconds;
      if (setup.bow) updateBowCarry(seconds, animation);

      sample(animation);
      carryAge = Math.min(1, carryAge + seconds / carrySeconds);
      composeOutput();
      if (bowFromBack && animation === 'attack') reachForBow();
      const { ch } = output;
      const wantsBowHand = ch[C.DRAW] > 0.01 ? 1 : 0;
      bowHands += (wantsBowHand - bowHands) * (1 - Math.exp(-seconds * SECOND_HAND_RATE));
      // On a release the string snaps forward, but the hand that let go of it does not.
      const released = lastDraw - ch[C.DRAW] > seconds * BOW_RELEASE_RATE;
      if (wantsBowHand && !released) handDraw = ch[C.DRAW];
      lastDraw = ch[C.DRAW];

      stretch = 0;
      legStretch = 0;
      twistBlend = 1 - Math.exp(-seconds * FOREARM_TWIST_RATE);
      // Back in the hand's grip for the arms' pass, because the drawing hand reaches for the string through it.
      if (setup.bow && mainItem && mainArm) {
        mainItem.holder.position.copy(mainArm.palm);
        mainItem.holder.quaternion.copy(mainItem.gripRotation);
      }
      model.updateWorldMatrix(true, true);
      moveBody();
      moveArms();
      sitBlend += ((animation === 'rest' ? 1 : 0) - sitBlend) * (1 - Math.exp(-seconds * SIT_BLEND_RATE));
      if (sitBlend > 0.002) restHands();
      if (setup.bow) placeBow();
      if (flask && drinkArm) {
        const d = animation === 'drink' ? drinkClock / drinkSeconds : -1;
        const shown = d < 0 ? 0 : smoothStep(0, 0.1, d) * (1 - smoothStep(0.9, 1, d));
        flask.visible = shown > 0.01;
        if (flask.visible) {
          // Turned from the chest and not the hand, so that it stays upright until it tips at the lips.
          worldRotation(drinkArm.limb.end, scratchQ).invert();
          scratchQ2.setFromAxisAngle(X_AXIS, FLASK_TIP * drinkTipAt(d));
          flask.quaternion.copy(scratchQ).multiply(bodyRotation).multiply(scratchQ2);
          flask.scale.copy(flaskScale).multiplyScalar(shown);
        }
        if (offItem && mainItem) mainItem.holder.visible = animation !== 'drink';
      }
      // Everything carried is put away while sitting, and comes back in the same frame the player stands.
      if (animation === 'rest' || weaponsPutAway) {
        weaponsPutAway = animation === 'rest';
        for (const item of mounted) item.holder.visible = !weaponsPutAway;
        if (quiver) quiver.visible = !weaponsPutAway;
      }
      if (offItem?.built) {
        animateOpenBook(offItem.holder.children[0], clock, attacking ? Math.min(1, attackClock / attackSeconds) : -1);
      }

      if (bowString) {
        if (seconds > 0) {
          const step = Math.min(seconds, 0.05) / 4;
          const bent = Math.min(1, ch[C.DRAW]);
          for (let i = 0; i < 4; i += 1) {
            bowFlexSpeed += (BOW_FLEX_STIFFNESS * (bent - bowFlex) - BOW_FLEX_DAMPING * bowFlexSpeed) * step;
            bowFlex += bowFlexSpeed * step;
          }
        }
        const depth = braceDepth * (1 + BOW_FLEX_DEPTH * bowFlex);
        const tipAt = bowTip * (1 - BOW_FLEX_HEIGHT * bowFlex);
        bowLimbs?.scale.set(1, 1 - BOW_FLEX_HEIGHT * bowFlex, 1 + BOW_FLEX_DEPTH * bowFlex);
        const back = -depth - ch[C.DRAW] * DRAW_LENGTH;
        const positions = bowString.geometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, 0, tipAt, -depth);
        positions.setZ(1, back);
        positions.setXYZ(2, 0, -tipAt, -depth);
        positions.needsUpdate = true;
        if (arrow && mainItem && otherArm && quiver) {
          // Once the string has been pulled and let go, this arrow is gone until the next attack.
          if (ch[C.DRAW] > 0.5) arrowDrawn = true;
          const nock = Math.min(1, ch[C.NOCK]);
          arrow.visible = animation === 'attack' && nock > 0.01 && !(arrowDrawn && ch[C.DRAW] < 0.3);
          if (arrow.visible) {
            arrow.position.set(0, 0, back);
            arrow.quaternion.setFromUnitVectors(ARROW_UP, ARROW_FORWARD);
            if (nock < 0.995) {
              // In the hand: from pointing down into the quiver, to lying along the shot.
              mainItem.holder.getWorldQuaternion(scratchQ).invert();
              quiver.getWorldQuaternion(scratchQ2);
              scratchV.set(0, -1, 0).applyQuaternion(scratchQ2).applyQuaternion(scratchQ);
              scratchQ2.setFromUnitVectors(ARROW_UP, scratchV);
              arrow.quaternion.slerp(scratchQ2, 1 - nock);
              scratchV.set(0, ARROW_HELD_AT, 0).applyQuaternion(arrow.quaternion);
              otherArm.limb.end.localToWorld(scratchV2.copy(otherArm.palm));
              mainItem.holder.worldToLocal(scratchV2).addScaledVector(scratchV, nock - 1);
              arrow.position.lerp(scratchV2, 1 - nock);
              // Just drawn, it's still in line with the quiver, however close the hand got to its mouth.
              if (nock < ARROW_FREE_AT) {
                quiver.localToWorld(scratchV2.set(0, ARROW_LENGTH - ARROW_HELD_AT, 0));
                mainItem.holder.worldToLocal(scratchV2);
                arrow.position.lerp(scratchV2, 1 - nock / ARROW_FREE_AT);
              }
            }
          }
        }
      }
    },

    startAttack(index) {
      attackIndex = index;
      attackClock = 0;
      attacking = true;
      arrowDrawn = false;
      bowFromBack = bowInHand < 0.5;
      copyFrame(output, entry);
      if (source === 'attack') {
        // A new attack straight after another: the entry pose already covers the switch.
        needsCarry = true;
        carrySeconds = ATTACK_TRANSITION_SECONDS;
      }
    },

    stretch: () => stretch,
    legStretch: () => legStretch,
    wristRoll: () => Math.max(Math.abs(arms.r?.limb.roll ?? 0), Math.abs(arms.l?.limb.roll ?? 0)),

    weaponTip(target, base) {
      if (!mainItem) return;
      mainItem.holder.updateWorldMatrix(false, false);
      mainItem.holder.localToWorld(target.set(0, mainItem.tip, 0));
      if (base) mainItem.holder.localToWorld(base.set(0, mainItem.butt, 0));
    },

    attackPhase: () => (attacking ? Math.min(1, attackClock / attackSeconds) : -1),
    impactKeyAt: (index) => compiled.attacks[index % compiled.attacks.length].impactAt,

    dispose() {
      bowString?.geometry.dispose();
      flask?.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
      quiver?.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
      for (const item of mounted) {
        if (!item.built) continue;
        item.holder.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
      }
    },
  };
}
