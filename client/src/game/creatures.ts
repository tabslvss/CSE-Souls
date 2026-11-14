import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BOSS_MOVES, bossMoveName, type BossMoveName } from '../../../shared/boss';
import { CORPSE_SECONDS, CREATURES, CreatureState, type CreatureKind } from '../../../shared/creatures';
import type { CreatureSnapshot } from '../../../shared/protocol';
import { sound, type GameSfxName, type LoopHandle } from '../sound';
import type { GameFx } from './fx/effects';
import type { LockSource, LockTarget } from './lockOn';
import { applyVertexSnap, makeTextureCrunchy } from './psxRenderer';

/*
 * Draws the animals the server tells us about. Nothing here decides anything: positions, states and
 * health all come from snapshots, and the browser only blends between them and dresses them up.
 */

const INTERPOLATION_DELAY_MS = 110;
const MAX_FRAMES_KEPT = 8;
/** A jump this long is a respawn, not movement, so it isn't blended. */
const TELEPORT_METERS = 8;
/** Missing from snapshots this long means out of view or removed. */
const MISSING_MS = 500;
const FADE_SECONDS = 0.16;
const DISSOLVE_SECONDS = 1.7;
/** Lying still for this long, then burning away, all before the server removes the corpse. */
const CORPSE_REST_SECONDS = CORPSE_SECONDS - DISSOLVE_SECONDS - 0.5;
const BAR_SHOW_MS = 5000;
const NUMBER_ADD_UP_MS = 1400;
const FAR_METERS = 34;
const BAR_MAX_METERS = 32;
const FLASH_DECAY = 11;
const DUST_RUN_SECONDS = 0.2;
const DUST_MAX_METERS = 30;
const CALL_MIN_SECONDS = 14;
const CALL_MAX_METERS = 26;
const STRIKE_SECONDS = 0.3;

/** A boss plays its clips this much slower than the animal it's drawn from, so that it feels heavy. */
const BOSS_ANIM_RATE = 0.7;
/** Darker than the aurochs it is drawn from, so its glowing eyes stand out. */
const BOSS_LIFT = 1.05;
const BOSS_EYE_COLOR = 0xff8a2a;
/** Where the eyes sit on the bull's Head bone, in that bone's own units, measured from the model's vertices. */
const BOSS_EYE_FORWARD = 0.8;
const BOSS_EYE_SIDE = 0.42;
const BOSS_EYE_UP = 0.12;
const BOSS_EYE_SIZE = 0.3;
/** The tip of the snout on the same bone, for its breath. */
const BOSS_SNOUT_FORWARD = 1.3;
/** How far from its middle its hooves stand, as a share of its radius. Rearing pivots on the back ones. */
const BOSS_HOOF_SHARE = 0.82;
const BOSS_LEAP_HEIGHT = 7;
const BOSS_REAR_RADIANS = THREE.MathUtils.degToRad(25);
const BOSS_STOMP_REAR_RADIANS = THREE.MathUtils.degToRad(30);
const BOSS_SLAM_SECONDS = 0.25;
/** It only breathes smoke for this long after its last move, so a quiet bull at rest looks calm. */
const BOSS_FIGHT_SECONDS = 20;
const BOSS_FX_METERS = 45;
const BOSS_DYING_SECONDS = 4;
/** After a leap, the drawn bull waits where it landed until the snapshots catch up, or this long. */
const BOSS_LAND_HOLD_SECONDS = 0.6;
/** Seconds each move's pose lasts after its hit, before the bull goes back to what the snapshots say. */
const BOSS_SETTLE: Record<BossMoveName, number> = { swipe: 0.7, charge: 0.4, leap: 0.8, fireballs: 0.8, stomp: 0.9 };
/*
 * Stunned, it collapses onto its front knees: the clips have nothing like it, so it is posed on the bones. The
 * body tips forward about its back hooves, the front legs fold at the shoulder and knee, and the neck hangs.
 */
/** How far the body tips forward when down, about its back hooves, which sit this share of its radius behind. */
const BOSS_KNEEL_PITCH = 0.2;
const BOSS_KNEEL_PIVOT_SHARE = 0.95;
/** Bends at full collapse, in radians about the body's side axis. Positive folds a leg back or drops the nose. */
const BOSS_KNEEL_UPPER_LEG = -0.15;
const BOSS_KNEEL_LOWER_LEG = 1.65;
// The neck is lifted against the tip, so the head hangs at about 3.7 m with its underside above 2 m where a
// player stands in the critical window: hung lower, it buries the player and the critical camera in the head.
const BOSS_KNEEL_NECK = [-0.2, -0.1, 0] as const;
const BOSS_KNEEL_HEAD = 0.15;
/** The break: a stagger first, then the legs give and it drops, landing with a small bounce. */
const BOSS_STAGGER_SECONDS = 0.3;
const BOSS_FALL_SECONDS = 0.5;
/** Halfway through the stun it tries to get up and can't. */
const BOSS_STRUGGLE_AT = 3;
const BOSS_STRUGGLE_SECONDS = 1.3;
/** Getting back up: one front leg, then the other, then the head. Slower than the fall, so it reads as heavy. */
const BOSS_RISE_SECONDS = 1.6;
/** A move that starts mid-rise hurries the rest of it this much. */
const BOSS_RISE_HURRY = 3;
const BOSS_DIM_EYES = 0.45;
const KNEEL_BONES = ['FrontUpperLeg.L', 'FrontLowerLeg.L', 'FrontUpperLeg.R', 'FrontLowerLeg.R', 'Neck1', 'Neck2', 'Neck3', 'Head'];

interface BodySpec {
  scale: number;
  /** Where blood and sparks come out. */
  chest: number;
  /** Where the health bar sits. */
  barHeight: number;
  attack: string;
  /** Brightens the fur. A wolf this dark would vanish into the forest, and you need to see what's biting you. */
  lift?: number;
  /** Plays now and then in place of standing still. */
  rest?: string;
  windupSound?: GameSfxName;
  strikeSound?: GameSfxName;
  hurtSound?: GameSfxName;
  deathSound: GameSfxName;
  callSound?: GameSfxName;
}

// Scales and clip names were measured from the model files, with tools/build-animals.mjs.
const BODIES: Record<string, BodySpec> = {
  wolf: {
    scale: 0.3753, chest: 0.62, barHeight: 1.25, attack: 'Attack', rest: 'Idle_2_HeadLow', lift: 1.9,
    windupSound: 'wolf-growl', strikeSound: 'wolf-attack', hurtSound: 'wolf-yelp', deathSound: 'wolf-death',
  },
  deer: { scale: 0.3174, chest: 0.78, barHeight: 1.55, attack: 'Attack_Headbutt', rest: 'Eating', deathSound: 'deer-death', callSound: 'deer-call' },
  stag: { scale: 0.3951, chest: 1.0, barHeight: 2.2, attack: 'Attack_Headbutt', rest: 'Eating', deathSound: 'deer-death', callSound: 'deer-call' },
  fox: { scale: 0.1745, chest: 0.3, barHeight: 0.72, attack: 'Attack', deathSound: 'deer-death' },
  bull: {
    scale: 0.331, chest: 1.05, barHeight: 1.9, attack: 'Attack_Headbutt', lift: 1.5,
    windupSound: 'wolf-growl', strikeSound: 'swing-heavy', hurtSound: 'hit-heavy', deathSound: 'kill-thud',
  },
};

const FALLBACK_BODY = BODIES.deer;

const loader = new GLTFLoader();
const files = new Map<string, Promise<{ scene: THREE.Group; clips: Map<string, THREE.AnimationClip> }>>();

function loadBody(id: string) {
  let file = files.get(id);
  if (!file) {
    file = loader.loadAsync(`/models/animals/${id}.glb`).then((gltf) => {
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of list) {
          const map = (material as THREE.MeshStandardMaterial).map;
          if (map) makeTextureCrunchy(map);
        }
      });
      return { scene: gltf.scene, clips: new Map(gltf.animations.map((clip) => [clip.name, clip])) };
    });
    // A failed download can be tried again by the next animal of that kind.
    file.catch(() => files.delete(id));
    files.set(id, file);
  }
  return file;
}

/** What a boss is doing between a 'bossTell' and the end of that move. The server only says when, never how. */
interface BossPose {
  move: BossMoveName | null;
  age: number;
  windup: number;
  /** Seconds since the move's hit, or negative before it. */
  sinceHit: number;
  startX: number;
  startZ: number;
  tx: number;
  tz: number;
  tookOff: boolean;
  /** Seconds the leap has been held at its landing point, or negative while it isn't. */
  landedFor: number;
  chargeLeft: number;
  lastX: number;
  lastZ: number;
  stalled: number;
  wallDone: boolean;
  /** Drawn lean, turn and sway, eased toward what the move wants. */
  pitch: number;
  pivot: number;
  twist: number;
  roll: number;
  stepWait: number;
  step: number;
  breathWait: number;
  sinceTell: number;
  dyingWait: number;
  /** Down after its stance broke, until 'bossRise'. */
  stunned: boolean;
  stunAge: number;
  /** How far into getting back up, or negative while it isn't. */
  riseAge: number;
  riseRate: number;
  /** The collapse as it was when the rise began, which the rise unwinds from. */
  riseFromBody: number;
  riseFromHead: number;
  /** Its knees reached the ground this collapse. */
  landed: boolean;
  /** A blow while it is down, fading. */
  jolt: number;
  /** The drawn collapse, 0 standing to 1 down: body, each front leg, head, and its sway and heave. */
  kneel: number;
  legL: number;
  legR: number;
  headDown: number;
  kneelRoll: number;
  kneelTwist: number;
  kneelLift: number;
  /** Bones it is posed on, with each one's pose from the clip before the collapse is added. */
  bones: { bone: THREE.Object3D; clean: THREE.Quaternion }[];
  /** The gallop's rumble, only while it charges. */
  rumble: LoopHandle | null;
  head: THREE.Object3D | null;
  eyes: THREE.Sprite[];
}

interface Frame {
  time: number;
  x: number;
  z: number;
  yaw: number;
  state: number;
  health: number;
}

interface HealthBar {
  root: HTMLDivElement;
  fill: HTMLElement;
  chip: HTMLElement;
  number: HTMLElement;
  /** Last share written to the page, so it isn't touched every frame. */
  shown: number;
}

interface Body {
  id: number;
  kind: CreatureKind;
  spec: BodySpec;
  root: THREE.Group;
  frames: Frame[];
  lastSeen: number;
  x: number;
  z: number;
  yaw: number;
  state: number;
  health: number;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  clips: Map<string, THREE.AnimationClip> | null;
  materials: THREE.MeshLambertMaterial[];
  action: THREE.AnimationAction | null;
  clipName: string;
  far: number;
  flash: number;
  /** Knocked back by the last blow: world meters, settling to nothing. */
  recoilX: number;
  recoilZ: number;
  /** Forward lean and lunge for bites, which the clips alone undersell. */
  lunge: number;
  dead: boolean;
  deadFor: number;
  burning: boolean;
  burned: boolean;
  dustWait: number;
  restLeft: number;
  callWait: number;
  bar: HealthBar | null;
  barUntil: number;
  added: number;
  addedAt: number;
  /** Clip speed on top of each clip's own. */
  animRate: number;
  boss: BossPose | null;
}

const projected = new THREE.Vector3();
const snout = new THREE.Vector3();
const headAt = new THREE.Vector3();

function stopRumble(pose: BossPose): void {
  pose.rumble?.stop(0.4);
  pose.rumble = null;
}

/** The animal's own numbers, grown by the kind's scale. A boss also gets its darker hide and loses the small sounds. */
function specFor(kind: CreatureKind): BodySpec {
  const base = BODIES[kind.model ?? kind.id] ?? FALLBACK_BODY;
  const scale = kind.scale ?? 1;
  if (scale === 1 && kind.behavior !== 'boss') return base;
  const spec: BodySpec = { ...base, scale: base.scale * scale, chest: base.chest * scale, barHeight: base.barHeight * scale };
  if (kind.behavior === 'boss') {
    // Its windup and strike have sounds of their own, played from the boss events.
    spec.lift = BOSS_LIFT;
    spec.windupSound = undefined;
    spec.strikeSound = undefined;
    spec.rest = undefined;
  }
  return spec;
}

function newPose(): BossPose {
  return {
    move: null, age: 0, windup: 1, sinceHit: -1, startX: 0, startZ: 0, tx: 0, tz: 0, tookOff: false, landedFor: -1,
    chargeLeft: 0, lastX: 0, lastZ: 0, stalled: 0, wallDone: false,
    pitch: 0, pivot: 0, twist: 0, roll: 0, stepWait: 0, step: 0, breathWait: 0, sinceTell: Infinity, dyingWait: 0,
    stunned: false, stunAge: 0, riseAge: -1, riseRate: 1, riseFromBody: 0, riseFromHead: 0, landed: false, jolt: 0,
    kneel: 0, legL: 0, legR: 0, headDown: 0, kneelRoll: 0, kneelTwist: 0, kneelLift: 0, bones: [],
    rumble: null, head: null, eyes: [],
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Begins getting up from however far down it is drawn. */
function startRise(pose: BossPose, rate: number): void {
  pose.stunned = false;
  pose.riseAge = 0;
  pose.riseRate = rate;
  pose.riseFromBody = pose.kneel;
  pose.riseFromHead = pose.headDown;
}

const sideAxis = new THREE.Vector3();
const parentTurn = new THREE.Quaternion();
const modelTurn = new THREE.Quaternion();
const bend = new THREE.Quaternion();

function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Goes by the newest snapshot, as the drawn body runs a moment behind it. */
function isAlive(body: Body): boolean {
  return !body.dead && body.frames[body.frames.length - 1]?.state !== CreatureState.Dead;
}

export class CreatureField implements LockSource {
  private readonly bodies = new Map<number, Body>();
  private disposed = false;
  private eyeTexture: THREE.Texture | null = null;
  private eyeMaterial: THREE.SpriteMaterial | null = null;
  /** A boss slammed into something hard enough to feel: where, and how hard from 0 to 1. */
  onBossImpact: ((x: number, z: number, power: number) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly fx: GameFx,
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLCanvasElement,
    private readonly layer: HTMLElement,
  ) {}

  /** A new snapshot. Bodies that stop being mentioned are cleaned up in update. */
  applySnapshot(list: CreatureSnapshot[]): void {
    const now = performance.now();
    for (const [id, kindIndex, x, z, yaw, state, health] of list) {
      const kind = CREATURES[kindIndex];
      if (!kind) continue;
      let body = this.bodies.get(id);
      if (!body) {
        body = this.createBody(id, kind, x, z, yaw, state, health);
        this.bodies.set(id, body);
      }
      const previous = body.frames[body.frames.length - 1];
      // It has come back to life at its camp: same id, new animal.
      if (body.dead && state !== CreatureState.Dead) this.revive(body);
      if (previous && Math.hypot(previous.x - x, previous.z - z) > TELEPORT_METERS) body.frames.length = 0;
      body.frames.push({ time: now, x, z, yaw, state, health });
      if (body.frames.length > MAX_FRAMES_KEPT) body.frames.shift();
      body.lastSeen = now;
    }
  }

  /** Where to aim effects on this creature, right now. */
  chestOf(id: number): { x: number; y: number; z: number } | null {
    const body = this.bodies.get(id);
    return body ? { x: body.x, y: body.spec.chest, z: body.z } : null;
  }

  livingTargets(): LockTarget[] {
    const list: LockTarget[] = [];
    for (const body of this.bodies.values()) {
      if (isAlive(body)) list.push({ id: body.id, x: body.x, y: body.spec.chest, z: body.z, reach: this.reachOf(body) });
    }
    return list;
  }

  /** How far a scaled-up body reaches from its middle, so locking on goes by its side and not its centre. */
  private reachOf(body: Body): number {
    return (body.kind.scale ?? 1) > 1 ? body.kind.radius : 0;
  }

  lockReach(id: number): number {
    const body = this.bodies.get(id);
    return body ? this.reachOf(body) : 0;
  }

  /** Writes where this creature stands, on the ground. False if it isn't known. */
  copyFeet(id: number, out: { x: number; y: number; z: number }): boolean {
    const body = this.bodies.get(id);
    if (!body) return false;
    out.x = body.x;
    out.y = 0;
    out.z = body.z;
    return true;
  }

  /** Writes where the boss's head is drawn right now, for the weak point. Falls back to above its chest. */
  copyBossHead(id: number, out: { x: number; y: number; z: number }): boolean {
    const body = this.bodies.get(id);
    if (!body) return false;
    const head = body.boss?.head;
    if (head && body.model) {
      // Brought up to date first, so it is where the head is drawn this frame, down on the ground or not.
      head.updateWorldMatrix(true, false);
      headAt.set(0, BOSS_EYE_FORWARD * 0.6, BOSS_EYE_UP);
      head.localToWorld(headAt);
      out.x = headAt.x;
      out.y = headAt.y;
      out.z = headAt.z;
    } else {
      out.x = body.x + Math.sin(body.yaw) * body.kind.radius;
      out.y = body.spec.chest;
      out.z = body.z + Math.cos(body.yaw) * body.kind.radius;
    }
    return true;
  }

  /** The body's radius in meters, as the rules have it. */
  radiusOf(id: number): number {
    return this.bodies.get(id)?.kind.radius ?? 1;
  }

  /** True while the boss is alive and drawn. */
  isLiving(id: number): boolean {
    const body = this.bodies.get(id);
    return !!body && isAlive(body);
  }

  /** Its stance broke: it staggers, its front legs give, and it crashes onto its knees until it rises or dies. */
  bossBreak(id: number): void {
    const body = this.bodies.get(id);
    const pose = body?.boss;
    if (!body || !pose || body.dead) return;
    stopRumble(pose);
    pose.move = null;
    pose.chargeLeft = 0;
    pose.landedFor = -1;
    pose.stunned = true;
    pose.stunAge = 0;
    pose.riseAge = -1;
    pose.landed = false;
    pose.jolt = 0;
    body.flash = 1;
    this.playClip(body, 'Idle_HitReact1', { once: true, seconds: BOSS_STAGGER_SECONDS + BOSS_FALL_SECONDS });
    for (const eye of pose.eyes) eye.scale.setScalar(BOSS_EYE_SIZE * BOSS_DIM_EYES);
  }

  /** The stun is over, or a critical ended it: it heaves itself back up, one leg at a time, with a bellow. */
  bossRise(id: number): void {
    const body = this.bodies.get(id);
    const pose = body?.boss;
    if (!body || !pose || body.dead || !pose.stunned) return;
    startRise(pose, 1);
    pose.sinceTell = 0;
    for (const eye of pose.eyes) eye.scale.setScalar(BOSS_EYE_SIZE);
    this.playClip(body, 'Idle');
    // As its head comes up.
    sound.playGame('boss-roar', { x: body.x, z: body.z, duck: 0.35, delay: BOSS_RISE_SECONDS * 0.6 });
  }

  /** Roughly how tall a boss stands, which sizes its effects. */
  bossSize(id: number): number {
    const body = this.bodies.get(id);
    return body ? body.spec.chest * 1.3 : 5.5;
  }

  copyLivingChest(id: number, out: THREE.Vector3): boolean {
    const body = this.bodies.get(id);
    if (!body || !isAlive(body)) return false;
    out.set(body.x, body.spec.chest, body.z);
    return true;
  }

  kindOf(id: number): CreatureKind | null {
    return this.bodies.get(id)?.kind ?? null;
  }

  yawOf(id: number): number | null {
    return this.bodies.get(id)?.yaw ?? null;
  }

  chestHeight(id: number): number {
    return this.bodies.get(id)?.spec.chest ?? 0.8;
  }

  /** A blow landed. The body flinches, flashes and, for your own hits, adds to its damage number. */
  onHit(id: number, damage: number, dirYaw: number, mine: boolean, kill: boolean): void {
    const body = this.bodies.get(id);
    if (!body) return;
    const push = kill ? 0.5 : 0.22;
    body.recoilX += Math.sin(dirYaw) * push;
    body.recoilZ += Math.cos(dirYaw) * push;
    body.flash = 1;
    if (body.spec.hurtSound && !kill) sound.playGame(body.spec.hurtSound, { x: body.x, z: body.z, volume: 0.7, pitch: body.boss ? 0.6 : undefined });
    if (body.boss) {
      // Down on its knees, a blow jars it rather than pushing it.
      if (body.boss.stunned) body.boss.jolt = 1;
      // The boss's health is on the screen's own bar, not over its head.
      if (kill) this.die(body);
      return;
    }
    const now = performance.now();
    this.showBar(body);
    body.barUntil = now + BAR_SHOW_MS;
    if (mine) {
      if (now - body.addedAt > NUMBER_ADD_UP_MS) body.added = 0;
      body.added += damage;
      body.addedAt = now;
      // Only ever a number from the server, and textContent keeps it from being read as HTML anyway.
      if (body.bar) {
        body.bar.number.textContent = String(body.added);
        body.bar.number.style.opacity = '1';
      }
    }
    if (kill) this.die(body);
  }

  private flashSeconds = 0;

  /**
   * Call once a frame. animSeconds stops during hitstop, realSeconds doesn't. flashSeconds is wall-clock time, so a
   * hit flash fades as fast during a critical's slow motion and doesn't hold the body as a flat white shape.
   */
  update(realSeconds: number, animSeconds: number, flashSeconds = realSeconds): void {
    this.flashSeconds = flashSeconds;
    const now = performance.now();
    const renderTime = now - INTERPOLATION_DELAY_MS;
    const cameraX = this.camera.position.x;
    const cameraZ = this.camera.position.z;
    for (const body of this.bodies.values()) {
      if (now - body.lastSeen > MISSING_MS) {
        // A corpse that started burning gets to finish. Anything else is just out of view.
        if (!body.burning || body.burned) {
          this.remove(body);
          continue;
        }
      }
      this.interpolate(body, renderTime, realSeconds);
      const distance = Math.hypot(body.x - cameraX, body.z - cameraZ);
      this.animate(body, realSeconds, animSeconds, distance);
      this.drawBar(body, now, distance);
    }
  }

  /** A boss move's windup began. Poses it; the warning on the ground is the effects' job. */
  bossTell(id: number, move: number, x: number, z: number, yaw: number, tx: number, tz: number, windup: number): void {
    const body = this.bodies.get(id);
    const name = bossMoveName(move);
    const pose = body?.boss;
    if (!body || !pose || !name || body.dead) return;
    // A move means it is up, even if its 'bossRise' never reached us, so whatever is left of getting up is hurried.
    if (pose.stunned) {
      startRise(pose, BOSS_RISE_HURRY);
      for (const eye of pose.eyes) eye.scale.setScalar(BOSS_EYE_SIZE);
    } else if (pose.riseAge >= 0) {
      pose.riseRate = BOSS_RISE_HURRY;
    }
    pose.move = name;
    pose.age = 0;
    pose.windup = Math.max(0.1, windup);
    pose.sinceHit = -1;
    pose.startX = x;
    pose.startZ = z;
    pose.tx = tx;
    pose.tz = tz;
    pose.tookOff = false;
    pose.landedFor = -1;
    pose.chargeLeft = 0;
    pose.sinceTell = 0;
    body.yaw = yaw;
    // Swipe holds the headbutt drawn back for the windup, like an ordinary bite.
    if (name === 'swipe') this.playClip(body, body.spec.attack, { once: true, seconds: pose.windup * 2.2 });
    else if (name === 'charge') this.playClip(body, 'Walk', { seconds: 1.6 });
    else this.playClip(body, 'Idle');
  }

  /** A boss move's hit moment. */
  bossHit(id: number, move: number, x: number, z: number, yaw: number): void {
    const body = this.bodies.get(id);
    const name = bossMoveName(move);
    const pose = body?.boss;
    if (!body || !pose || !name || body.dead) return;
    if (pose.move !== name) {
      // Its tell was missed: start the pose at its end.
      pose.move = name;
      pose.windup = 0.1;
      pose.age = 0.1;
      pose.startX = pose.tx = x;
      pose.startZ = pose.tz = z;
      pose.tookOff = true;
    }
    pose.sinceHit = 0;
    pose.sinceTell = 0;
    body.yaw = yaw;
    if (name === 'swipe') {
      // The windup left the headbutt drawn back, so the sweep carries on from there, fast.
      if (body.action && body.clipName === body.spec.attack) {
        body.action.timeScale = body.action.getClip().duration / 0.35 / body.animRate;
      } else {
        this.playClip(body, body.spec.attack, { once: true, seconds: 0.35 });
      }
    } else if (name === 'charge') {
      const { length, speed } = BOSS_MOVES.charge;
      pose.chargeLeft = length / speed;
      pose.lastX = body.x;
      pose.lastZ = body.z;
      pose.stalled = 0;
      pose.wallDone = false;
      this.playClip(body, 'Gallop');
    } else if (name === 'leap') {
      pose.tx = x;
      pose.tz = z;
      pose.landedFor = 0;
      this.playClip(body, 'Idle_HitReact1', { once: true, seconds: 0.7 });
    } else if (name === 'fireballs') {
      this.playClip(body, body.spec.attack, { once: true, seconds: 0.5 });
      if (pose.head && body.model) {
        snout.set(0, BOSS_SNOUT_FORWARD, 0);
        pose.head.localToWorld(snout);
        this.fx.boss.snort(snout.x, snout.y, snout.z, Math.sin(yaw), Math.cos(yaw));
      }
    } else {
      this.playClip(body, body.spec.attack, { once: true, seconds: 0.45 });
    }
  }

  private createBody(id: number, kind: CreatureKind, x: number, z: number, yaw: number, state: number, health: number): Body {
    const spec = specFor(kind);
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    this.scene.add(root);
    const body: Body = {
      id, kind, spec, root,
      frames: [],
      lastSeen: performance.now(),
      x, z, yaw, state, health,
      model: null, mixer: null, clips: null, materials: [], action: null, clipName: '',
      far: 0, flash: 0, recoilX: 0, recoilZ: 0, lunge: 0,
      dead: state === CreatureState.Dead, deadFor: state === CreatureState.Dead ? CORPSE_REST_SECONDS : 0,
      burning: false, burned: false,
      dustWait: 0, restLeft: 0,
      callWait: CALL_MIN_SECONDS * (1 + Math.random() * 3),
      bar: null, barUntil: 0, added: 0, addedAt: 0,
      animRate: kind.behavior === 'boss' ? BOSS_ANIM_RATE : 1,
      boss: kind.behavior === 'boss' ? newPose() : null,
    };
    if (body.boss) sound.preloadBoss();
    void this.loadModel(body);
    return body;
  }

  private async loadModel(body: Body, attempt = 0): Promise<void> {
    let file;
    try {
      file = await loadBody(body.kind.model ?? body.kind.id);
    } catch {
      if (attempt < 2 && !this.disposed && this.bodies.get(body.id) === body) await this.loadModel(body, attempt + 1);
      return;
    }
    if (this.disposed || this.bodies.get(body.id) !== body) return;
    const model = cloneSkinned(file.scene);
    model.scale.setScalar(body.spec.scale);
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const convert = (source: THREE.Material) => {
        const standard = source as THREE.MeshStandardMaterial;
        // Lambert like the characters, so they catch the same flat PS1 light. A copy per animal, for its own hit flash.
        const material = new THREE.MeshLambertMaterial({ map: standard.map, color: standard.color.clone().multiplyScalar(body.spec.lift ?? 1) });
        applyVertexSnap(material);
        body.materials.push(material);
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    });
    body.root.add(model);
    body.model = model;
    if (body.boss) {
      this.addEyes(body.boss, model);
      const bones = KNEEL_BONES.map((name) => model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)));
      if (bones.every((bone) => bone)) {
        body.boss.bones = bones.map((bone) => ({ bone: bone as THREE.Object3D, clean: (bone as THREE.Object3D).quaternion.clone() }));
      }
    }
    body.mixer = new THREE.AnimationMixer(model);
    body.clips = file.clips;
    // A random start, so a herd doesn't breathe in step.
    body.mixer.update(Math.random() * 3);
    if (body.dead) this.playClip(body, 'Death', { once: true, jumpToEnd: true });
  }

  /** Two small ember glows on the head bone. Sprites, so they cost two quads and follow every head movement. */
  private addEyes(pose: BossPose, model: THREE.Object3D): void {
    const head = model.getObjectByName('Head') ?? null;
    pose.head = head;
    if (!head) return;
    if (!this.eyeMaterial) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.35, 'rgba(255,255,255,0.75)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 32, 32);
      }
      this.eyeTexture = new THREE.CanvasTexture(canvas);
      this.eyeMaterial = new THREE.SpriteMaterial({
        map: this.eyeTexture,
        color: BOSS_EYE_COLOR,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
    }
    for (const side of [-1, 1]) {
      const eye = new THREE.Sprite(this.eyeMaterial);
      eye.position.set(side * BOSS_EYE_SIDE, BOSS_EYE_FORWARD, BOSS_EYE_UP);
      eye.scale.setScalar(BOSS_EYE_SIZE);
      head.add(eye);
      pose.eyes.push(eye);
    }
  }

  private interpolate(body: Body, renderTime: number, seconds: number): void {
    const { frames } = body;
    if (frames.length === 0) return;
    let x = frames[frames.length - 1].x;
    let z = frames[frames.length - 1].z;
    let yaw = frames[frames.length - 1].yaw;
    let current = frames[frames.length - 1];
    for (let i = frames.length - 1; i > 0; i -= 1) {
      const a = frames[i - 1];
      const b = frames[i];
      if (a.time <= renderTime && renderTime <= b.time) {
        const t = (renderTime - a.time) / Math.max(1, b.time - a.time);
        x = a.x + (b.x - a.x) * t;
        z = a.z + (b.z - a.z) * t;
        yaw = b.yaw;
        current = b;
        break;
      }
    }
    if (renderTime < frames[0].time) {
      x = frames[0].x;
      z = frames[0].z;
      yaw = frames[0].yaw;
      current = frames[0];
    }
    body.x = x;
    body.z = z;
    const delta = Math.atan2(Math.sin(yaw - body.yaw), Math.cos(yaw - body.yaw));
    body.yaw += delta * Math.min(1, seconds * 10);
    body.health = current.health;
    if (current.state !== body.state) this.changeState(body, current.state);
  }

  private changeState(body: Body, state: number): void {
    const { spec, x, z } = body;
    body.state = state;
    if (body.boss && state !== CreatureState.Dead) return;
    if (state === CreatureState.Windup && spec.windupSound) sound.playGame(spec.windupSound, { x, z });
    else if (state === CreatureState.Strike && spec.strikeSound) sound.playGame(spec.strikeSound, { x, z });
    else if (state === CreatureState.Dead) this.die(body);
    // The windup left the clip drawn back, so the bite carries on from there, fast.
    if (state === CreatureState.Strike && body.action && body.clipName === spec.attack) {
      body.action.timeScale = body.action.getClip().duration / STRIKE_SECONDS;
    }
  }

  private die(body: Body): void {
    if (body.dead) return;
    body.dead = true;
    body.deadFor = 0;
    if (body.boss) {
      sound.bossDeath({ x: body.x, z: body.z });
      this.fx.boss.clear(body.id);
      stopRumble(body.boss);
      // Killed on its knees, it goes down from there: the collapse fades into the death clip instead of snapping.
      body.boss.stunned = false;
      body.boss.riseAge = -1;
      body.boss.move = null;
      body.boss.chargeLeft = 0;
      body.boss.dyingWait = 0;
    } else {
      sound.playGame(body.spec.deathSound, { x: body.x, z: body.z });
    }
    this.playClip(body, 'Death', { once: true });
  }

  private revive(body: Body): void {
    body.dead = false;
    body.deadFor = 0;
    body.burning = false;
    body.burned = false;
    body.flash = 0;
    body.frames.length = 0;
    this.fx.undissolve(body.root);
    body.root.visible = true;
    body.clipName = '';
    body.added = 0;
    body.barUntil = 0;
    if (body.bar) body.bar.root.style.display = 'none';
    if (body.boss) {
      stopRumble(body.boss);
      const { head, eyes, bones } = body.boss;
      body.boss = { ...newPose(), head, eyes, bones };
      for (const eye of eyes) {
        eye.visible = true;
        eye.scale.setScalar(BOSS_EYE_SIZE);
      }
    }
  }

  private wantedClip(body: Body): { name: string; once?: boolean; seconds?: number } {
    const { kind, spec } = body;
    switch (body.state) {
      case CreatureState.Walk:
        return { name: 'Walk' };
      case CreatureState.Run:
        return { name: 'Gallop' };
      case CreatureState.Windup:
        // Held in the first part of the clip, drawn back, until the bite comes.
        return { name: spec.attack, once: true, seconds: kind.windup * 2.2 };
      case CreatureState.Strike:
        return { name: spec.attack, once: true, seconds: STRIKE_SECONDS };
      case CreatureState.Stagger:
        return { name: 'Idle_HitReact1', once: true, seconds: 0.45 };
      case CreatureState.Dead:
        return { name: 'Death', once: true };
      default:
        return { name: body.restLeft > 0 && spec.rest ? spec.rest : 'Idle' };
    }
  }

  private playClip(body: Body, name: string, options: { once?: boolean; seconds?: number; jumpToEnd?: boolean } = {}): void {
    if (!body.mixer || !body.clips) return;
    const clip = body.clips.get(name);
    if (!clip) return;
    const next = body.mixer.clipAction(clip);
    if (next !== body.action) {
      body.action?.fadeOut(FADE_SECONDS);
      next.reset().fadeIn(body.action ? FADE_SECONDS : 0).play();
    } else {
      next.reset().play();
    }
    next.setLoop(options.once ? THREE.LoopOnce : THREE.LoopRepeat, options.once ? 1 : Infinity);
    next.clampWhenFinished = !!options.once;
    // A clip given a length takes that many real seconds, whatever the body's own rate.
    next.timeScale = options.seconds ? clip.duration / options.seconds / body.animRate : 1;
    if (options.jumpToEnd) next.time = clip.duration;
    body.action = next;
    body.clipName = name;
  }

  private animate(body: Body, realSeconds: number, animSeconds: number, distance: number): void {
    const { spec, state } = body;
    if (body.dead) {
      body.deadFor += realSeconds;
      if (!body.burning && body.deadFor >= CORPSE_REST_SECONDS) {
        body.burning = true;
        this.fx.deathMist({ x: body.x, y: 0, z: body.z });
        if (body.boss) {
          this.fx.boss.deathBurst(body.x, body.z, body.spec.chest * 1.3);
          for (const eye of body.boss.eyes) eye.visible = false;
        }
        this.fx.dissolve(body.root, DISSOLVE_SECONDS, () => {
          body.burned = true;
        });
      }
      if (body.boss) this.bossDying(body, body.boss, realSeconds, distance);
    } else if (body.boss) {
      if (body.boss.move === null && !body.boss.stunned) {
        const wanted = this.wantedClip(body);
        if (wanted.name !== body.clipName) this.playClip(body, wanted.name, wanted);
      }
      this.bossAlive(body, body.boss, realSeconds, distance);
    } else {
      // Now and then a deer drops its head to graze, instead of all of them standing like statues.
      if (state === CreatureState.Idle) {
        body.restLeft -= realSeconds;
        if (spec.rest && body.restLeft < -6 && Math.random() < realSeconds * 0.12) body.restLeft = 4 + Math.random() * 5;
      } else {
        body.restLeft = 0;
      }
      const wanted = this.wantedClip(body);
      if (wanted.name !== body.clipName) this.playClip(body, wanted.name, wanted);
      this.feet(body, realSeconds, distance);
      this.call(body, realSeconds, distance);
    }

    // The collapse was added on top of last frame's clip pose: take it off before the clip moves the bones again.
    if (body.boss) for (const { bone, clean } of body.boss.bones) bone.quaternion.copy(clean);

    if (body.mixer) {
      // Far away the animation runs at a third of the rate, which nobody can see through the fog.
      body.far += animSeconds * body.animRate;
      if (distance < FAR_METERS || body.far > 0.05) {
        body.mixer.update(body.far);
        body.far = 0;
      }
    }

    if (body.boss) {
      if (body.dead) this.kneelFade(body.boss, animSeconds, 1.5);
      this.placeBoss(body, body.boss, animSeconds);
      this.bendBones(body, body.boss);
    } else {
      this.placeAnimal(body, animSeconds, realSeconds);
    }

    if (body.flash > 0.004) {
      body.flash *= Math.exp(-this.flashSeconds * FLASH_DECAY);
      this.writeFlash(body, body.flash);
    } else if (body.flash > 0) {
      body.flash = 0;
      this.writeFlash(body, 0);
    }
  }

  private placeAnimal(body: Body, animSeconds: number, realSeconds: number): void {
    const { spec, state } = body;
    const lungeTarget = state === CreatureState.Windup ? -1 : state === CreatureState.Strike ? 1 : 0;
    body.lunge += (lungeTarget - body.lunge) * Math.min(1, animSeconds * (state === CreatureState.Strike ? 22 : 7));
    const settle = Math.exp(-realSeconds * 9);
    body.recoilX *= settle;
    body.recoilZ *= settle;
    const reach = body.lunge * (body.lunge > 0 ? 0.55 : 0.16) * Math.max(0.6, spec.chest);
    body.root.position.set(
      body.x + body.recoilX + Math.sin(body.yaw) * reach,
      0,
      body.z + body.recoilZ + Math.cos(body.yaw) * reach,
    );
    body.root.rotation.y = body.yaw;
    if (body.model) body.model.rotation.x = body.lunge * 0.12;
  }

  /** Runs the boss's move: what it leans and turns toward, and where a leap carries it. */
  private bossAlive(body: Body, pose: BossPose, seconds: number, distance: number): void {
    pose.sinceTell += seconds;
    const move = pose.move;
    const size = body.spec.chest * 1.3;
    const near = distance < BOSS_FX_METERS;
    let pitch = 0;
    let pivot = 0;
    let twist = 0;
    let roll = 0;
    if (move !== 'charge' || pose.chargeLeft <= 0) stopRumble(pose);
    const kneeling = pose.stunned || pose.riseAge >= 0;
    if (pose.stunned) {
      this.collapse(body, pose, seconds, near, size);
      if (near) this.breathe(body, pose, seconds, 0.9);
    } else if (pose.riseAge >= 0) {
      this.getUp(body, pose, seconds, near, size);
    } else {
      this.kneelFade(pose, seconds);
    }
    if (move) {
      pose.age += seconds;
      if (pose.sinceHit >= 0) pose.sinceHit += seconds;
      const windup = pose.windup;
      const t = pose.age / windup;
      const hoof = body.kind.radius * BOSS_HOOF_SHARE;
      if (move === 'swipe') {
        pitch = 0.08;
        pivot = hoof;
        // Turns its head away to wind up, then sweeps it right across.
        twist = pose.sinceHit < 0 ? 0.35 * ease(t * 1.4) : pose.sinceHit < 0.3 ? 0.35 - (pose.sinceHit / 0.3) * 0.7 : 0;
      } else if (move === 'charge') {
        if (pose.sinceHit < 0) {
          // Head down and pawing at the ground.
          pitch = 0.14 + Math.sin(pose.age * 9) * 0.03;
          pivot = hoof;
          pose.stepWait -= seconds;
          if (near && pose.stepWait <= 0) {
            pose.stepWait = 0.32;
            const side = (pose.step++ & 1) === 0 ? 1 : -1;
            this.hoofAt(body, hoof, side, size, false);
          }
        } else if (pose.chargeLeft > 0) {
          pitch = 0.12;
          pivot = hoof;
          this.charging(body, pose, seconds, size);
        }
      } else if (move === 'leap') {
        const air = BOSS_MOVES.leap.airSeconds;
        const crouch = Math.max(0, windup - air);
        if (pose.sinceHit < 0 && pose.age < crouch) {
          pitch = -BOSS_REAR_RADIANS * ease(pose.age / Math.max(0.1, crouch));
          pivot = -hoof;
        } else if (pose.sinceHit < 0 && pose.age < windup) {
          if (!pose.tookOff) {
            pose.tookOff = true;
            if (near) this.fx.boss.takeOff(pose.startX, pose.startZ, size);
          }
          const flight = (pose.age - crouch) / air;
          pitch = -BOSS_REAR_RADIANS + flight * (BOSS_REAR_RADIANS + 0.26);
          pivot = -hoof * Math.max(0, 1 - flight * 3);
        }
      } else if (move === 'fireballs') {
        if (pose.sinceHit < 0) {
          // Head low, shaking harder as the fire builds.
          pitch = 0.16;
          pivot = hoof;
          roll = Math.sin(pose.age * 38) * 0.035 * Math.min(1, t * 1.5);
          if (near) this.breathe(body, pose, seconds, 0.25);
        } else {
          pitch = -0.06;
          pivot = hoof;
        }
      } else if (move === 'stomp') {
        const slamAt = Math.max(0.2, windup - BOSS_SLAM_SECONDS);
        if (pose.sinceHit < 0 && pose.age < slamAt) {
          pitch = -BOSS_STOMP_REAR_RADIANS * ease(pose.age / slamAt);
        } else if (pose.sinceHit < 0) {
          pitch = -BOSS_STOMP_REAR_RADIANS + ease((pose.age - slamAt) / BOSS_SLAM_SECONDS) * (BOSS_STOMP_REAR_RADIANS + 0.08);
        } else {
          pitch = 0.08 * Math.max(0, 1 - pose.sinceHit * 3);
        }
        pivot = -hoof;
      }
      const settle = move === 'charge' ? BOSS_SETTLE.charge + BOSS_MOVES.charge.length / BOSS_MOVES.charge.speed : BOSS_SETTLE[move];
      if (pose.sinceHit > settle || pose.age > windup + 4) {
        pose.move = null;
        pose.chargeLeft = 0;
        pose.landedFor = -1;
      }
    }
    // The leap and the stomp set their lean outright, as they're the move; everything else eases.
    if (kneeling) {
      // Down or getting up, the collapse is the whole pose, set outright; a move begun mid-rise waits for it.
      pose.pitch = pose.kneel * BOSS_KNEEL_PITCH;
      pose.pivot = -body.kind.radius * BOSS_KNEEL_PIVOT_SHARE;
      pose.twist = pose.kneelTwist;
      pose.roll = pose.kneelRoll;
    } else {
      const direct = (move === 'leap' && pose.tookOff && pose.sinceHit < 0) || (move === 'stomp' && pose.sinceHit < 0);
      const rate = direct ? 1 : Math.min(1, seconds * 9);
      pose.pitch += (pitch - pose.pitch) * rate;
      pose.pivot += (pivot - pose.pivot) * rate;
      pose.twist += (twist - pose.twist) * Math.min(1, seconds * 14);
      pose.roll += (roll - pose.roll) * Math.min(1, seconds * 20);
    }

    if (!near) return;
    // Heavy hooves, timed: the clips have no footfall marks.
    const moving = body.state === CreatureState.Walk || body.state === CreatureState.Run;
    if (moving && (!move || move === 'swipe')) {
      pose.stepWait -= seconds;
      if (pose.stepWait <= 0) {
        const running = body.state === CreatureState.Run;
        pose.stepWait = running ? 0.26 : 0.55;
        const side = (pose.step & 1) === 0 ? 1 : -1;
        const front = (pose.step & 2) === 0 ? 1 : -1;
        pose.step += 1;
        this.hoofAt(body, body.kind.radius * BOSS_HOOF_SHARE * front, side, size, running);
      }
    }
    if (pose.sinceTell < BOSS_FIGHT_SECONDS && !pose.stunned) this.breathe(body, pose, seconds, 1);
  }

  /**
   * Stunned: a stagger, then the front legs buckle (the left a moment first) and it drops onto its knees with a
   * bounce, the head following it down. There it heaves for breath and sways, tries once to get up and can't.
   */
  private collapse(body: Body, pose: BossPose, seconds: number, near: boolean, size: number): void {
    const before = pose.stunAge;
    pose.stunAge += seconds;
    const t = pose.stunAge;
    const down = BOSS_STAGGER_SECONDS + BOSS_FALL_SECONDS;
    if (t > down + 0.4 && body.clipName !== 'Idle') this.playClip(body, 'Idle', { seconds: 5 });
    let kneel = 0;
    let legL = 0;
    let legR = 0;
    let head = 0;
    let roll = 0;
    let twist = 0;
    let lift = 0;
    if (t < BOSS_STAGGER_SECONDS) {
      // Rocked back by the blow that broke it, head thrown up.
      const rock = Math.sin((Math.PI * t) / BOSS_STAGGER_SECONDS);
      kneel = -0.15 * rock;
      head = -0.3 * rock;
    } else if (t < down) {
      // The legs give and it drops, faster as it goes.
      const u = (t - BOSS_STAGGER_SECONDS) / BOSS_FALL_SECONDS;
      kneel = u * u;
      legL = clamp01(u * 1.4);
      legR = clamp01(u * 1.4 - 0.3);
      head = ease((t - BOSS_STAGGER_SECONDS - 0.15) / 0.75);
      roll = 0.1 * (legL - legR);
    } else {
      const v = t - down;
      if (!pose.landed) {
        pose.landed = true;
        if (near) this.kneesLand(body, size, 0.55);
      }
      // A heavy landing: it sinks a little past its knees, bounces up, and settles.
      const bounce = 0.1 * Math.exp(-5 * v) * Math.sin(v * 12);
      kneel = 1 + bounce;
      legL = legR = 1 + bounce * 0.5;
      head = ease((t - BOSS_STAGGER_SECONDS - 0.15) / 0.75) + 0.2 * Math.exp(-4 * v) * Math.sin(v * 9);
      // Laboured breathing: slow heaves that lift the body and nod the head, and a sway as if it might topple.
      const w = ease(v / 1.2);
      const breath = Math.sin(t * 3.3);
      lift = 0.07 * breath * w;
      kneel -= 0.025 * breath * w;
      head += 0.08 * Math.sin(t * 3.3 - 1) * w;
      roll += 0.05 * Math.sin(t * 1.05) * w;
      twist += 0.07 * Math.sin(t * 0.7) * w;
      // One go at getting up: it pushes on the left leg, shaking, then crashes back down.
      const s = (t - BOSS_STRUGGLE_AT) / BOSS_STRUGGLE_SECONDS;
      if (s > 0 && s < 1) {
        const effort = s < 0.65 ? ease(s / 0.65) : 1 - ((s - 0.65) / 0.35) ** 2;
        const shake = Math.sin(t * 31) * 0.03 * effort;
        kneel -= 0.22 * effort + shake;
        legL -= 0.55 * effort;
        legR -= 0.15 * effort;
        head -= 0.4 * effort;
        roll -= 0.07 * effort;
      }
      if (near && before < BOSS_STRUGGLE_AT + BOSS_STRUGGLE_SECONDS && t >= BOSS_STRUGGLE_AT + BOSS_STRUGGLE_SECONDS) {
        this.kneesLand(body, size, 0.3);
      }
    }
    // A blow while it is down jars its body and snaps its head.
    pose.jolt *= Math.exp(-seconds * 5);
    kneel += 0.08 * pose.jolt;
    head += 0.15 * pose.jolt;
    twist += 0.1 * pose.jolt * Math.sin(t * 25);
    pose.kneel = kneel;
    pose.legL = legL;
    pose.legR = legR;
    pose.headDown = head;
    pose.kneelRoll = roll;
    pose.kneelTwist = twist;
    pose.kneelLift = lift;
  }

  /** Getting up: a heave down to gather itself, the left leg planted, then the right, then the head comes up shaking. */
  private getUp(body: Body, pose: BossPose, seconds: number, near: boolean, size: number): void {
    const before = pose.riseAge / BOSS_RISE_SECONDS;
    pose.riseAge += seconds * pose.riseRate;
    const s = pose.riseAge / BOSS_RISE_SECONDS;
    const from = Math.max(0, pose.riseFromBody);
    const gather = Math.sin(Math.PI * clamp01(s / 0.2));
    const legL = from * (1 - ease((s - 0.15) / 0.35));
    const legR = from * (1 - ease((s - 0.4) / 0.35));
    pose.legL = legL;
    pose.legR = legR;
    pose.kneel = (legL + legR) / 2 + 0.08 * gather * from;
    // Leaning onto the side still down.
    pose.kneelRoll = 0.12 * (legL - legR);
    pose.headDown = pose.riseFromHead * (1 - ease((s - 0.6) / 0.35)) + 0.2 * gather * pose.riseFromHead;
    const shaking = (s - 0.8) * BOSS_RISE_SECONDS;
    pose.kneelTwist = shaking > 0 ? 0.12 * Math.sin(shaking * 20) * Math.exp(-shaking * 4) : 0;
    pose.kneelLift = 0;
    // Each front hoof stamps down as it takes the weight.
    if (near && from > 0.5) {
      const hoof = body.kind.radius * BOSS_HOOF_SHARE;
      if (before < 0.5 && s >= 0.5) this.hoofAt(body, hoof, 1, size, false);
      if (before < 0.75 && s >= 0.75) this.hoofAt(body, hoof, -1, size, false);
    }
    if (s >= 1) pose.riseAge = -1;
  }

  /** Not down: whatever is left of the collapse eases away. */
  private kneelFade(pose: BossPose, seconds: number, rate = 6): void {
    const keep = Math.exp(-seconds * rate);
    pose.kneel *= keep;
    pose.legL *= keep;
    pose.legR *= keep;
    pose.headDown *= keep;
    pose.kneelRoll *= keep;
    pose.kneelTwist *= keep;
    pose.kneelLift *= keep;
    pose.jolt = 0;
  }

  /** Both front knees hitting the ground: dust at each, a thud, and a shake for anyone near. */
  private kneesLand(body: Body, size: number, power: number): void {
    const along = body.kind.radius * 0.6;
    this.hoofAt(body, along, 1, size, false);
    this.hoofAt(body, along, -1, size, false);
    const x = body.x + Math.sin(body.yaw) * along;
    const z = body.z + Math.cos(body.yaw) * along;
    sound.bossLand({ x, z }, power);
    this.onBossImpact?.(x, z, power * 0.7);
  }

  /** Adds the collapse to the clip's pose: front legs folded at shoulder and knee, the neck and head hung. */
  private bendBones(body: Body, pose: BossPose): void {
    const model = body.model;
    const { bones } = pose;
    if (!model || bones.length !== KNEEL_BONES.length) return;
    for (const entry of bones) entry.clean.copy(entry.bone.quaternion);
    if (Math.abs(pose.legL) + Math.abs(pose.legR) + Math.abs(pose.headDown) < 1e-3) return;
    const head = pose.headDown;
    const angles = [
      BOSS_KNEEL_UPPER_LEG * pose.legL, BOSS_KNEEL_LOWER_LEG * pose.legL,
      BOSS_KNEEL_UPPER_LEG * pose.legR, BOSS_KNEEL_LOWER_LEG * pose.legR,
      BOSS_KNEEL_NECK[0] * head, BOSS_KNEEL_NECK[1] * head, BOSS_KNEEL_NECK[2] * head, BOSS_KNEEL_HEAD * head,
    ];
    // About the body's own side axis, so each joint folds in the plane the bull faces whatever its bones' axes are.
    model.getWorldQuaternion(modelTurn);
    for (let i = 0; i < bones.length; i += 1) {
      const { bone } = bones[i];
      if (!bone.parent || angles[i] === 0) continue;
      bone.parent.getWorldQuaternion(parentTurn);
      sideAxis.set(1, 0, 0).applyQuaternion(modelTurn).applyQuaternion(parentTurn.invert());
      bend.setFromAxisAngle(sideAxis, angles[i]);
      bone.quaternion.premultiply(bend);
    }
  }

  private charging(body: Body, pose: BossPose, seconds: number, size: number): void {
    pose.chargeLeft -= seconds;
    if (pose.rumble) pose.rumble.setPosition(body.x, body.z);
    else if (pose.chargeLeft > 0) pose.rumble = sound.startLoop('boss-charge-rumble', { x: body.x, z: body.z });
    pose.stepWait -= seconds;
    const half = pose.stepWait <= 0;
    if (half) {
      pose.stepWait = 0.16;
      sound.bossStep({ x: body.x, z: body.z }, true);
    }
    this.fx.boss.chargeTrail(body.x, body.z, body.yaw, size, half);
    // Stopping dead well short of the end of its run means it hit something solid.
    const moved = Math.hypot(body.x - pose.lastX, body.z - pose.lastZ);
    pose.lastX = body.x;
    pose.lastZ = body.z;
    const expected = BOSS_MOVES.charge.speed * seconds;
    if (pose.sinceHit > 0.3 && pose.chargeLeft > 0.2 && moved < expected * 0.15) pose.stalled += seconds;
    else pose.stalled = 0;
    if (!pose.wallDone && pose.stalled > 0.08) {
      pose.wallDone = true;
      pose.chargeLeft = 0;
      this.fx.boss.wallBurst(body.x, body.z, body.yaw, size);
      sound.bossLand({ x: body.x, z: body.z }, 0.6);
      this.onBossImpact?.(body.x, body.z, 0.6);
    }
  }

  private hoofAt(body: Body, along: number, side: number, size: number, running: boolean): void {
    const forwardX = Math.sin(body.yaw);
    const forwardZ = Math.cos(body.yaw);
    const out = body.kind.radius * 0.28 * side;
    const x = body.x + forwardX * along + forwardZ * out;
    const z = body.z + forwardZ * along - forwardX * out;
    this.fx.boss.hoof(x, z, size);
    sound.bossStep({ x, z }, running);
  }

  /** Smoke from the nostrils now and then. rate above 1 breathes faster. */
  private breathe(body: Body, pose: BossPose, seconds: number, every: number): void {
    pose.breathWait -= seconds;
    if (pose.breathWait > 0 || !pose.head) return;
    pose.breathWait = every * (0.7 + Math.random() * 0.6);
    snout.set(0, BOSS_SNOUT_FORWARD, 0);
    pose.head.localToWorld(snout);
    this.fx.boss.breath(snout.x, snout.y, snout.z, Math.sin(body.yaw), Math.cos(body.yaw));
  }

  /** Embers lifting off it through the long fall, before the usual burning away. */
  private bossDying(body: Body, pose: BossPose, seconds: number, distance: number): void {
    if (body.deadFor > BOSS_DYING_SECONDS || distance > BOSS_FX_METERS) return;
    pose.dyingWait -= seconds;
    if (pose.dyingWait > 0) return;
    pose.dyingWait = 0.35;
    this.fx.boss.dying(body.x, body.z, body.spec.chest * 1.3);
    if (body.deadFor > 1.5) for (const eye of pose.eyes) eye.visible = false;
  }

  /** Where the boss is drawn: the snapshots, except where a leap carries it, plus its lean around a hoof. */
  private placeBoss(body: Body, pose: BossPose, animSeconds: number): void {
    const settle = Math.exp(-animSeconds * 9);
    body.recoilX *= settle;
    body.recoilZ *= settle;
    let y = 0;
    if (body.dead) {
      // Whatever it was rearing into, it comes back down to fall.
      const rate = Math.min(1, animSeconds * 4);
      // Killed on its knees, the tip forward goes only as fast as the folded legs straighten.
      const kneeling = pose.kneel > 0.02;
      pose.pitch = kneeling ? pose.kneel * BOSS_KNEEL_PITCH : pose.pitch - pose.pitch * rate;
      if (!kneeling) pose.pivot -= pose.pivot * rate;
      pose.twist -= pose.twist * rate;
      pose.roll -= pose.roll * rate;
    }
    if (pose.move === 'leap' && !body.dead) {
      const air = BOSS_MOVES.leap.airSeconds;
      const crouch = Math.max(0, pose.windup - air);
      if (pose.sinceHit < 0 && pose.tookOff) {
        const flight = Math.min(1, (pose.age - crouch) / air);
        body.x = pose.startX + (pose.tx - pose.startX) * flight;
        body.z = pose.startZ + (pose.tz - pose.startZ) * flight;
        y = 4 * BOSS_LEAP_HEIGHT * flight * (1 - flight);
      } else if (pose.landedFor >= 0) {
        // The snapshots run a moment behind, so it stays where it landed until they get there.
        pose.landedFor += animSeconds;
        if (pose.landedFor < BOSS_LAND_HOLD_SECONDS && Math.hypot(body.x - pose.tx, body.z - pose.tz) > 2) {
          body.x = pose.tx;
          body.z = pose.tz;
        } else {
          pose.landedFor = -1;
        }
      }
    }
    body.root.position.set(body.x + body.recoilX * 0.3, y, body.z + body.recoilZ * 0.3);
    body.root.rotation.y = body.yaw;
    const model = body.model;
    if (!model) return;
    const pitch = pose.pitch;
    // Rotating about a hoof instead of its middle, so rearing lifts the front and keeps the back feet down.
    model.rotation.set(pitch, pose.twist, pose.roll);
    model.position.set(0, pose.pivot * Math.sin(pitch) + pose.kneelLift, pose.pivot * (1 - Math.cos(pitch)));
  }

  private writeFlash(body: Body, amount: number): void {
    for (const material of body.materials) {
      material.emissive.setRGB(1, 0.86, 0.72);
      material.emissiveIntensity = amount * 0.85;
    }
  }

  /** Kicked-up dust when they bolt. No footsteps, because a fleeing herd would drown out everything. */
  private feet(body: Body, seconds: number, distance: number): void {
    if (body.state !== CreatureState.Run || distance > DUST_MAX_METERS) return;
    body.dustWait -= seconds;
    if (body.dustWait > 0) return;
    body.dustWait = DUST_RUN_SECONDS;
    this.fx.footDust({ x: body.x, y: 0, z: body.z }, 'run');
  }

  private call(body: Body, seconds: number, distance: number): void {
    if (!body.spec.callSound) return;
    body.callWait -= seconds;
    if (body.callWait > 0) return;
    body.callWait = CALL_MIN_SECONDS * (1 + Math.random() * 3);
    if (distance < CALL_MAX_METERS) sound.playGame(body.spec.callSound, { x: body.x, z: body.z, volume: 0.6 });
  }

  private showBar(body: Body): void {
    if (body.bar) {
      body.bar.root.style.display = '';
      return;
    }
    const root = document.createElement('div');
    root.className = 'foe-bar';
    const number = document.createElement('span');
    number.className = 'foe-bar__number';
    const track = document.createElement('div');
    track.className = 'foe-bar__track';
    const chip = document.createElement('i');
    chip.className = 'foe-bar__chip';
    const fill = document.createElement('i');
    fill.className = 'foe-bar__fill';
    track.append(chip, fill);
    root.append(number, track);
    this.layer.append(root);
    body.bar = { root, fill, chip, number, shown: -1 };
  }

  private drawBar(body: Body, now: number, distance: number): void {
    const { bar } = body;
    if (!bar) return;
    const visible = now < body.barUntil && distance < BAR_MAX_METERS && !body.burning;
    projected.set(body.x, body.spec.barHeight, body.z).project(this.camera);
    if (!visible || projected.z >= 1) {
      bar.root.style.display = 'none';
      return;
    }
    bar.root.style.display = '';
    const left = (projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const top = (-projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
    bar.root.style.transform = `translate(-50%, -100%) translate(${left | 0}px, ${top | 0}px)`;
    const share = body.dead ? 0 : body.health;
    if (share !== bar.shown) {
      bar.shown = share;
      bar.fill.style.width = `${share}%`;
      bar.chip.style.width = `${share}%`;
    }
    if (now - body.addedAt > NUMBER_ADD_UP_MS + 800) bar.number.style.opacity = '0';
  }

  private remove(body: Body): void {
    this.bodies.delete(body.id);
    if (body.boss) {
      this.fx.boss.clear(body.id);
      stopRumble(body.boss);
    }
    this.fx.undissolve(body.root);
    this.scene.remove(body.root);
    body.bar?.root.remove();
    this.release(body);
  }

  private release(body: Body): void {
    body.mixer?.stopAllAction();
    if (body.model) {
      body.mixer?.uncacheRoot(body.model);
      body.model.traverse((object) => {
        const skinned = object as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
    }
    for (const material of body.materials) material.dispose();
    body.materials.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const body of [...this.bodies.values()]) this.remove(body);
    // The shared files hold textures on the GPU, and the next game loads them again.
    for (const file of files.values()) {
      void file.then(({ scene }) => {
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of list) {
            (material as THREE.MeshStandardMaterial).map?.dispose();
            material.dispose();
          }
        });
      }, () => undefined);
    }
    files.clear();
    this.eyeMaterial?.dispose();
    this.eyeTexture?.dispose();
    this.eyeMaterial = null;
    this.eyeTexture = null;
  }
}
