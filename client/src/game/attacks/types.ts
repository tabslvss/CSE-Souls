/*
 * The vocabulary for authoring stances and attacks. weaponRig.ts turns these into motion.
 *
 * All directions use the character's own frame: "right" is their right hand side, and "forward" is
 * where they face. Every angle is in radians. For scale:
 *
 *   Height of the pelvis 0.95   chest 1.31   shoulders 1.455   head 1.60   (male body; female is 2% smaller)
 *   Upper arm 0.25 + forearm 0.24 = 0.49 from shoulder to wrist; the palm adds about 0.07.
 *   Thigh 0.43 + shin 0.46 = 0.89 from hip to ankle. Hips sit ±0.114 apart from the middle line.
 *   Shoulders from the chest: [±0.21, 0.145, -0.07].
 */

export type Vec3 = readonly [number, number, number];

/** How a segment moves from the previous key to this one. */
export type Ease =
  /** Starts and ends at rest. The default. */
  | 'smooth'
  /** Constant speed: use this to pass through a key without slowing down. */
  | 'linear'
  /** Slow start and a snap at the end: for strikes. */
  | 'easeIn'
  /** Fast start and a slow settle: for follow-through. */
  | 'easeOut'
  /** Stays on the previous key's pose until this key's time. The other fields of this key are ignored. */
  | 'hold';

/** Where a held item is. Thumbs point along `head`, and knuckles along `edge`. */
export interface ItemPose {
  /** The point on the item that the hand holds, as [right, up, forward] from the chest. */
  grip: Vec3;
  /** The way the striking end points, as [right, up, forward]. Needs no normalizing. */
  head: Vec3;
  /** The way the blade or hammer face points. Knuckles line up with this, as on a real sword. */
  edge: Vec3;
}

/** The arm that holds nothing, swinging as a counterbalance. */
export interface FreeHand {
  /** Where the palm goes, as [right, up, forward] from the chest, like grip. */
  position: Vec3;
  /** How closed the fingers are, from 0 (open) to 1 (fist). Defaults to 0.3. */
  fingers?: number;
}

export interface BodyPose {
  /**
   * Moves the pelvis as [right, down, forward] in meters, from where it is standing straight up. Without
   * feet, it's from where the clip put it instead, and the clip's feet stay put. The chest and arms go with it,
   * because grips are measured from the chest. Standing straight, the legs are almost locked, so a
   * ready stance needs at least 0.05 down.
   */
  hips?: Vec3;
  /** Turns the pelvis to the character's right. Negative turns left. */
  hipTurn?: number;
  /** Tips the pelvis forward. */
  hipTilt?: number;
  /** Drops the right hip and raises the left. Negative does the reverse. */
  hipRoll?: number;
  /**
   * Plants a foot, as [right, forward, lift] in meters from the character's origin on the ground.
   * This is the middle of the foot, so standing straight is footL [-0.114, 0, 0], footR [0.114, 0, 0].
   * The left foot's `right` is negative. Up to about 0.08 of lift raises the heel, with the toes staying
   * planted, like a back foot pushing off. Above 0.15 the whole foot is off the ground and level.
   * Leaving feet out of a stance leaves the legs to the clip.
   */
  footL?: Vec3;
  footR?: Vec3;
  /** Turns the toes outward. Negative is pigeon-toed. Defaults to 0.15. */
  toeL?: number;
  toeR?: number;
  /** Turns the shoulders to the character's right. Measured from the facing direction, not from the hips. */
  turn?: number;
  /** Bends the upper body forward. Measured from upright, not from the hips. */
  lean?: number;
  /** How much the head turns with the shoulders. 0 stays on target, 1 goes along. Defaults to 0.2. */
  headFollow?: number;
  /** Nods the head forward on top of that, for a gaze that the clip leaves too high. */
  headPitch?: number;
  /** The arm holding nothing. On a two-handed weapon, set oneHand as well. */
  freeHand?: FreeHand;
  /** Lets go of a two-handed weapon with the second hand. */
  oneHand?: boolean;
}

export interface Pose extends ItemPose, BodyPose {
  /** How far along the handle the second hand sits from the main hand. */
  reach?: number;
  /** Bow only: how far the string is pulled, from 0 to 1. The right hand is on it above 0. */
  draw?: number;
  /** Bow only: above 0 an arrow is in the free hand, drawn from the quiver. At 1 it's on the string. */
  nock?: number;
}

/**
 * One moment of an attack. Anything left out carries over from the previous key, and the first key
 * carries over from the idle stance. So a planted foot only needs saying once.
 */
export interface AttackKey extends Partial<Pose> {
  /** When this pose is reached, from 0 at the start of the attack to 1 at the end. */
  at: number;
  /** How the segment arriving at this key moves. */
  ease?: Ease;
  /** Marks the strike. Exactly one key per attack, with `at` equal to the weapon's hitAt in shared/combat.ts. */
  impact?: boolean;
  /** Moves the second item, such as a shield or a book, instead of leaving it at its stance. */
  off?: ItemPose;
}

export interface Attack {
  /**
   * The clip that moves whatever keys don't. Leave it out for a neutral body: the character stands
   * still and the keys are fully in charge. Without keys at all, the clip moves the arms too.
   */
  clip?: string;
  keys?: AttackKey[];
}

/** Small movements on top of a stance, so that someone standing or walking looks alive. Lengths are in meters. */
export interface StanceLife {
  /** How far the pelvis sinks and rises while standing, on a loop of about 3 seconds. */
  sink?: number;
  /** How far the weight moves from side to side while standing, on a loop of about 6 seconds. */
  shift?: number;
  /** How far the weapon's head drifts while standing, a little after the chest moves. */
  drift?: number;
  /** Now and then the hands shift on a heavy handle, by this many meters. */
  resettle?: number;
  /** While walking or running, how much the main hand trails the body's rise and fall. 1 is all of it. */
  handLag?: number;
  /** The same for the second item. Negative answers the other way. */
  offLag?: number;
  /** How much of the run clip's rise and fall to keep, from 0 to 1. Lower reads as heavier. */
  runBob?: number;
  /** While walking, how much further out each foot goes than the clip puts it, in meters. */
  walkWidth?: number;
  /** How long the run's steps are next to the clip's, from 0 to 1. Shorter steps need a higher runRate to cover the same ground. */
  runStride?: number;
  /** How much of the run clip's foot lift to keep, from 0 to 1. Leave it out and shorter steps lower the feet a little on their own. */
  runLift?: number;
  /** How much of the run clip's head nod and swing to take out, from 0 to 1, so that the eyes stay level and on target. */
  runHeadLevel?: number;
  /** How much of the run clip's twist to take out of the spine and pelvis, from 0 to 1, so a guard stays in front. */
  runSteady?: number;
  /** While walking or running, how far the shoulders turn against the legs at full stride, in radians. The hands swing with them. */
  gaitSwing?: number;
  /** Seconds to get into and out of the run, for a huge weapon whose carry is a long way from its guard. */
  runBlendSeconds?: number;
}

/** How a weapon rolls, on top of the roll clip. Grips here turn along with the chest, as the body goes over. */
export interface RollPose {
  main: ItemPose;
  off?: ItemPose;
  /** How far the pelvis is held up at the middle of the roll, in meters, so that it reads as a tuck and not a fall. */
  lift?: number;
  /** How much further the spine curls forward at the middle of the roll. */
  curl?: number;
}

/** Everything that moves for one weapon. Lives in a file per weapon family, and armory.ts adds the items. */
export interface WeaponMoves {
  idleClip: string;
  runClip: string;
  /** How fast the run clip plays. Match this to run speed, so that the planted foot doesn't skate. Defaults to 1. */
  runRate?: number;
  life?: StanceLife;
  /** Poses for the main item. Where one is left out, the animation clip moves that arm freely. */
  stance: { idle?: Pose; walk?: Pose; run?: Pose };
  /** Poses for the second item. */
  offStance?: { idle: ItemPose; walk?: ItemPose; run?: ItemPose };
  /** Keeps the head exactly level however far the body turns and leans, for a weapon that keeps its eyes on the target. */
  levelHead?: boolean;
  /** Holds the items tight during a roll, for ones long or wide enough to go through the floor otherwise. */
  roll?: RollPose;
  /** Attacks take turns through this list. Each one should start where the one before it ended. */
  attacks: Attack[];
}

export type AxisName = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** Heads that are too small for how heavy the weapon should look, and handles that are too thick. */
export interface ItemReshape {
  /** Where the head starts, from 0 at the butt to 1 at the tip. Anything below this is handle. */
  headFrom: number;
  /** How far from the handle, along the edge in the model's own units, the head still counts as handle. */
  neck: number;
  /** How many times bigger to make the head, as [across its flat side, along the handle, along its edge]. */
  head: Vec3;
  /** How many times thicker to make the handle. */
  handle: number;
}

export interface HeldItem {
  /** The object's name in weapons.glb, or just a name when `build` makes the item. */
  id: string;
  /** Makes the item in code instead of taking it from weapons.glb. */
  build?: 'open-book';
  hand: 'r' | 'l';
  /** Finished length in meters along the item's long side. */
  length: number;
  /** Where the hand holds it, from 0 at the butt to 1 at the head. */
  grip: number;
  /** Which way the head and edge point in the model file. */
  head: AxisName;
  edge: AxisName;
  /** How far the head leans forward of straight across the palm, in degrees. A real grip runs diagonally. */
  tilt?: number;
  /** Shifts the item from the palm, as [across the palm, along its length, along its edge]. */
  nudge?: Vec3;
  /** Makes it thinner or thicker without changing its length, so a hand can close around it. */
  girth?: number;
  /** How many times thicker to make a thin blade or head across its flat side. */
  flat?: number;
  /** Where the grip is across the item, along the edge axis from 0 to 1. Defaults to the middle. */
  edgeAt?: number;
  /** Changes the proportions of a model: a bigger head on a slimmer handle. */
  reshape?: ItemReshape;
  /** How closed the fingers are, from 0 to 1. */
  curl?: number;
  /** Bends the thumb's three joints by these degrees, for grips where it doesn't wrap with the fingers. */
  thumb?: Vec3;
  /** Adds the forearm strap and hand grip to the back of a shield. */
  straps?: boolean;
}

export interface WeaponSetup extends WeaponMoves {
  label: string;
  /** The first item is the main one. A second item goes in the other hand. */
  items: HeldItem[];
  /** Holding with both hands: how far along the handle the second hand sits from the main hand. */
  secondHand?: number;
  /** Turns the second hand around the handle by this many radians, so its palm meets the shaft from another side. */
  secondHandRoll?: number;
  /** Swings the second elbow forward from its usual place, for a hand held close to the body that would otherwise put the elbow through the torso. */
  secondElbowForward?: number;
  bow?: boolean;
}
