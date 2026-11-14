import * as THREE from 'three';
import { BOSS_STANCE, bossMoveName, inCritWindow } from '../../../shared/boss';
import { findClass, STAT_INFO, type StatKey } from '../../../shared/classes';
import { CRITICAL_IMPACT_AT, CRITICAL_SECONDS, INTERACT_RANGE, WEAPON_STYLES, weaponFor, type WeaponStats, type WeaponStyle } from '../../../shared/combat';
import { CREATURES } from '../../../shared/creatures';
import { findGrace, GRACE_REST_RANGE } from '../../../shared/graces';
import { MAP } from '../../../shared/mapData';
import type { MapGrace } from '../../../shared/mapTypes';
import type { BossSnapshot, CreatureSnapshot, GameEvent, PlayerInfo, RefusalReason } from '../../../shared/protocol';
import { DRINK_HEAL_TIME, JUMP_SECONDS, animationFor, jumpHeight, type AnimationId } from '../../../shared/sim';
import { bossMusic, sound, type FootSurface, type GameSfxName, type ImpactKind, type LoopHandle } from '../sound';
import { ARMORY } from './armory';
import { createCharacter, releaseSharedAssets, type CharacterModel } from './characters';
import { CreatureField } from './creatures';
import { CameraFx } from './fx/camera';
import { CriticalFx, criticalFamily, type CriticalFamily } from './fx/critical';
import { GameFx } from './fx/effects';
import { FootTrail, landHit, takeHit, type FeelParts, type MoveKind } from './fx/feel';
import { GamepadInput, type MenuNav, type PadAction } from './gamepad';
import { GraceField } from './graces';
import { LockOn } from './lockOn';
import { meteorBlast } from './fx/feel';
import { ImpactSequencer } from './impactFrames';
import { GameConnection, type ConnectionStatus, type FrameInput, type NetPlayer } from './net';
import { PsxRenderer } from './psxRenderer';
import { createWorld } from './world';

const MOUSE_SENSITIVITY = 0.0023;
const MIN_PITCH = -0.15;
const MAX_PITCH = 1.05;
const DEFAULT_PITCH = 0.32;
/** Radians per second for a right stick pushed all the way. */
const STICK_YAW_SPEED = 3.2;
const STICK_PITCH_SPEED = 2;
/** How quickly the camera follows a lock-on target, and how it tilts to keep you both in frame. */
const LOCK_TURN_RATE = 7;
const LOCK_PITCH = 0.26;
const LOCK_MAX_PITCH = 0.7;
const LOCK_PITCH_FOLLOW = 0.6;
const LOCK_MIN_DISTANCE = 0.6;
const LOOK_RAISE_RATE = 5;
const LOOK_RAISE_MAX = 1;
const LOOK_RAISE_SHARE = 0.35;
const RECENTER_RATE = 8;
const RECENTER_DONE = 0.01;
/** The height the camera circles around, above your feet. */
const CAMERA_PIVOT_HEIGHT = 1.3;
const MIN_DISTANCE = 2.6;
const MAX_DISTANCE = 9;
const TURN_SPEED = 13;
/** How long a roll pressed while busy waits to come out. */
const DODGE_BUFFER_SECONDS = 0.35;
/** How long an attack pressed by a stunned boss's head waits to become a critical while you finish a swing. */
const CRIT_BUFFER_SECONDS = 0.7;
const NAMEPLATE_HEIGHT = 1.98;
const NAMEPLATE_MAX_DISTANCE = 45;
const HUD_INTERVAL_MS = 100;
const MODEL_RETRY_MS = 3000;
const EFFECT_HEIGHT = 1.2;

/** The camera stops this far short of a wall, and looks for walls this wide around its path. */
const CAMERA_PROBE_RADIUS = 0.35;
const CAMERA_CLOSEST = 0.9;
const CAMERA_EASE_OUT = 3.5;
/**
 * Posts, trunks and standing stones thinner than this only stop the camera from ending up inside them. Looking
 * past one for a moment is fine; being pulled in against your back by every stone in the boss's ring is not.
 */
const CAMERA_THIN_RADIUS = 1.6;

/** Locked on to something huge, the camera rises and backs off until the whole animal fits in the picture. */
const BIG_LOCK_REACH = 1.5;
const BIG_LOCK_DISTANCE = 8.5;
const BIG_LOCK_PITCH = 0.3;
const BIG_LOCK_PIVOT_RAISE = 0.7;
const BIG_LOCK_LOOK_RAISE = 1.4;
const BIG_LOCK_RATE = 3;

/** Your own critical's camera eases in this fast, and back out to the normal view this slowly. */
const CRIT_CAMERA_IN_SECONDS = 0.3;
const CRIT_CAMERA_OUT_SECONDS = 0.6;
/** Someone else's critical this close still gets a short light impact frame on your screen. */
const CRIT_NEAR_METERS = 14;
const CRIT_NUMBER_MS = 1800;
/** A late start catches the animation up to the server's clock, but never by more than this. */
const CRIT_MAX_CATCH_UP = 0.6;

/** The sound of each weapon's critical blow, under its impact frame. */
const CRIT_IMPACT_SOUND: Record<CriticalFamily, ImpactKind> = {
  heavy: 'heavy', mace: 'heavy', zweihander: 'heavy', spear: 'heavy',
  katana: 'blade', longsword: 'blade',
  bow: 'arrow',
  staff: 'magic', wand: 'magic', quarterstaff: 'magic',
};

/**
 * The sounds leading up to each critical's blow, as shares of its length (the blow is at 0.6). mark names one
 * of the animation's own beats, which wins over at when the weapon has it. A riser of length L that should
 * end on the blow starts at 0.6 - L / 2.8.
 */
interface CritCue {
  at: number;
  mark?: string;
  name: GameSfxName;
  volume?: number;
  pitch?: number;
}
const CRIT_CUES: Record<CriticalFamily, readonly CritCue[]> = {
  heavy: [
    { at: 0.2, mark: 'plant', name: 'footstep-stone' },
    { at: 0.243, name: 'crit-charge' },
    { at: 0.314, name: 'wind-heavy', pitch: 0.8 },
    { at: 0.81, mark: 'free', name: 'crit-debris', volume: 0.5 },
  ],
  mace: [
    { at: 0.08, name: 'dodge-roll', volume: 0.5 },
    { at: 0.243, name: 'crit-charge' },
    { at: 0.25, mark: 'bash', name: 'hit-metal' },
    { at: 0.25, mark: 'bash', name: 'hit-heavy', volume: 0.7 },
    { at: 0.4, mark: 'wind', name: 'swing-heavy' },
    { at: 0.5, mark: 'leap', name: 'wind-heavy', pitch: 0.9, volume: 0.7 },
  ],
  zweihander: [
    { at: 0.095, mark: 'drag', name: 'swing-heavy', pitch: 0.7, volume: 0.6 },
    { at: 0.243, name: 'crit-charge' },
    { at: 0.3, mark: 'spin', name: 'swing-heavy' },
    { at: 0.72, mark: 'rest', name: 'crit-debris', volume: 0.4 },
  ],
  katana: [
    { at: 0.063, name: 'crit-charge' },
    { at: 0.42, mark: 'dash', name: 'crit-blade-dash' },
    // Its click comes 0.42 s in, which lands it on the blow.
    { at: 0.45, name: 'crit-blade-sheath' },
  ],
  longsword: [
    { at: 0.243, name: 'crit-charge' },
    { at: 0.3, name: 'swing-light' },
    { at: 0.38, name: 'swing-light' },
    { at: 0.46, name: 'swing-light' },
  ],
  bow: [
    { at: 0.2, mark: 'nock', name: 'bow-draw' },
    { at: 0.3, mark: 'land', name: 'dodge-roll', volume: 0.5 },
    { at: 0.25, mark: 'slowmo', name: 'crit-bow-slowmo' },
    { at: 0.43, mark: 'release', name: 'crit-bow-release' },
    { at: 0.43, mark: 'release', name: 'crit-arrow-fly' },
  ],
  spear: [
    { at: 0.12, mark: 'stamp', name: 'footstep-stone' },
    { at: 0.243, name: 'crit-charge' },
    { at: 0.28, mark: 'takeoff', name: 'swing-heavy' },
    { at: 0.45, mark: 'apex', name: 'crit-bow-slowmo', volume: 0.6 },
    { at: 0.77, mark: 'wrench', name: 'swing-light' },
  ],
  staff: [
    { at: 0.171, name: 'crit-magic-gather' },
    { at: 0.2, mark: 'rise', name: 'cast-magic', pitch: 0.6 },
  ],
  wand: [
    { at: 0.171, name: 'crit-magic-gather' },
    { at: 0.22, mark: 'circle', name: 'cast-magic', pitch: 0.8 },
  ],
  quarterstaff: [
    { at: 0.171, name: 'crit-magic-gather' },
    { at: 0.2, mark: 'spin', name: 'swing-light' },
    { at: 0.32, name: 'swing-light' },
    { at: 0.47, mark: 'catch', name: 'swing-heavy', pitch: 0.8 },
  ],
};

/** Seconds from the blow's start of the part of a swing that draws a trail, around the hit moment. */
const TRAIL_LEAD: Record<WeaponStyle, number> = { heavy: 0.2, blade: 0.13, thrust: 0.12, magic: 0.14, arrow: 0 };
const TRAIL_FOLLOW = 0.09;
/** How much light a spell gathers and lets go of. The meteor's cast has to look like it costs something. */
const SPELL_POWER_METEOR = 2.4;
const SPELL_POWER_BOLT = 1;
const SPELL_POWER_CRESCENT = 0.8;
/** The heavy sound is a long rush of air that should peak as the weapon lands. */
const WIND_LEAD_SECONDS = 0.8;
const WIND_POWER: Partial<Record<string, number>> = { 'War hammer': 1.4, 'Double axe': 1.2, Zweihander: 1.2, 'Mace and shield': 0.7 };
/** Only bosses and tough enemies get the banner, so it stays special. Normal animals don't. */
const BANNER_MIN_HEALTH = 200;
/** The boss bar fades this long after its news stops arriving or the boss falls, and is gone a little after. */
const BOSS_BAR_FADE_MS = 2500;
const BOSS_BAR_GONE_MS = 4000;
const BOSS_STUN_SECONDS = BOSS_STANCE.stunSeconds;
/** How far away a boss's landing can still be felt. */
const BOSS_FEEL_METERS = 36;
/** A blow on something huge still sparks where a sword reaches, not up at its chest. */
const HIT_MAX_HEIGHT = 2.4;
/** How long your dust may stay out of the counter, if its flight is ever cut short. */
const DUST_SETTLE_MS = 2500;
/** Your body burns away with this much of the wait left, so that it's gone just before the respawn. */
const BODY_BURN_AT = 2.4;
const BODY_BURN_SECONDS = 1.7;
const ZONE_SURFACES: Record<string, FootSurface> = {
  "Pilgrim's Rest": 'grass',
  'Pale Meadow': 'grass',
  'Cursed Forest': 'forest',
  'Sunken Graveyard': 'forest',
  'Fallen Citadel': 'stone',
  'Throne of Ash': 'stone',
};
const ROAD_STEP_WIDTH = 3;
const FLASH_DECAY = 10;
/** A faint light carried with you, so that you and what's biting you can still be seen in a dark forest. */
const LANTERN_COLOR = 0xffdcb0;
const LANTERN_POWER = 9;
const LANTERN_RANGE = 18;
const LANTERN_HEIGHT = 3;

/** The view while sitting: from behind and to one side, low, with the grace in the middle of the picture. */
const REST_CAMERA_SIDE = 0.6;
const REST_CAMERA_PITCH = 0.2;
const REST_CAMERA_DISTANCE = 4.4;
const REST_CAMERA_PIVOT = 0.95;
const REST_CAMERA_RATE = 2.2;
const SITTING_PLATE_DROP = 0.75;

const ACHIEVEMENT_NAMES: Record<string, string> = {
  first_blood: 'First Blood',
  beast_hunter: 'Beast Hunter',
  first_grace: 'Warm Light',
  first_upgrade: 'Stronger Code',
  bull_slayer: 'Horn Breaker',
};

/** The server only ever sends one of these fixed words, so no text from the network reaches the screen here. */
const REFUSAL_TEXT: Record<RefusalReason, string> = {
  enemies_near: 'Enemies are too close to rest there.',
  interrupted: 'Something disturbed your rest.',
  grace_full: 'Every seat at that Binary Grace is taken.',
  not_resting: 'You need to be resting at a Binary Grace to do that.',
  too_far: 'You are too far from the Binary Grace.',
  no_dust: 'You do not have enough Binary Dust.',
  stat_maxed: 'That stat is already at its highest.',
  not_discovered: 'You have not found that Binary Grace yet.',
  try_again: 'That did not go through. Please try again.',
};

/** What the world map needs to know, read fresh for every picture it draws. */
export interface MapView {
  me: { x: number; z: number; yaw: number } | null;
  others: Array<{ x: number; z: number; name: string }>;
}

export interface HudState {
  health: number;
  maxHealth: number;
  magic: number;
  maxMagic: number;
  stamina: number;
  maxStamina: number;
  potions: number;
  online: number;
  ping: number;
  names: string[];
  /** Above 0 while dead: seconds until you come back. */
  deadSeconds: number;
  /** Shown near the middle of the screen, for example near a chest. */
  prompt: string | null;
  /** You, as the server last described you. */
  me: PlayerInfo | null;
  /** Your Binary Dust by the server's count, which is what spending goes by. */
  dust: number;
  /** Binary Graces lit on this save. */
  graces: number[];
  /** The boss you're fighting, while the server says you're near it, and for a moment after. */
  boss: BossHud | null;
}

export interface BossHud {
  name: string;
  /** Health left, 0 to 100. */
  share: number;
  fading: boolean;
  /** How close its stance is to breaking, 0 to 100. */
  stance: number;
  /** Down after a stance break. */
  stunned: boolean;
  /** While stunned: how much of the stun is left, 0 to 100. */
  stun: number;
  /** Counts stance breaks, so the bar can flash on each new one. */
  breaks: number;
  /** Stunned, and you stand where an attack becomes a critical hit. */
  critReady: boolean;
}

interface BossBarState {
  id: number;
  name: string;
  hp: number;
  max: number;
  /** 0 to 1 of the stance meter. */
  stance: number;
  /** Seconds of stun left, by the server's last word. */
  stunLeft: number;
  breaks: number;
  seenAt: number;
  /** When it fell, or 0. */
  deadAt: number;
}

/** A critical hit someone is doing, as this browser draws it. */
interface AvatarCritical {
  on: boolean;
  /** Where it started, which the animation's own dash or leap is added to. */
  originX: number;
  originZ: number;
  yaw: number;
  /** The boss it's on, or 0 if this browser never heard which. */
  boss: number;
  /** The effects' handle, or -1. */
  handle: number;
  family: CriticalFamily;
  travel: number;
  marks: Readonly<Record<string, number>> | null;
  /** The animation's phase last frame, so each beat plays once. */
  last: number;
  impactDone: boolean;
  mine: boolean;
}

export interface GameCallbacks {
  onStatus: (status: ConnectionStatus) => void;
  onHud: (hud: HudState) => void;
  onPointerLock: (locked: boolean) => void;
  /** pulse is true when dust just arrived, so the counter can react. */
  onBinaryDust: (amount: number, pulse: boolean) => void;
  /** The big gold line over a kill. */
  onBanner: (title: string, detail: string) => void;
  /** A short message, like a chest's reward. */
  onNotice: (text: string) => void;
  /** A controller moving around a menu, or Esc while one of the game's own menus is open. */
  onMenu: (nav: MenuNav) => void;
  /** The server sat you down at this grace, moved you to another, or got you up (0). */
  onRest: (grace: number) => void;
  /** The map button, wherever you are. */
  onMapKey: () => void;
}

interface Avatar {
  id: number;
  info: PlayerInfo;
  model: CharacterModel | null;
  plate: HTMLDivElement;
  plateDetail: HTMLElement;
  /** Raised stats can load a new model, and only the newest one may end up on screen. */
  modelLoad: number;
  weapon: WeaponStats;
  isBow: boolean;
  trail: FootTrail;
  x: number;
  z: number;
  yaw: number;
  lastAttackCount: number;
  /** Which moments of the current attack have already played. */
  swingStarted: boolean;
  trailOn: boolean;
  impactDone: boolean;
  burning: boolean;
  flash: number;
  flashMaterials: THREE.MeshLambertMaterial[] | null;
  flashBases: THREE.Color[];
  flashIntensities: number[];
  collector: () => { x: number; y: number; z: number };
  feet: { x: number; y: number; z: number };
  jumpWas: number;
  drinkWas: number;
  crit: AvatarCritical;
  /** The boss named by this player's last 'crit' event, until their critical starts drawing. */
  critBoss: number;
  /** Getters for the critical's effects. They must not allocate, so each writes into its own spot. */
  critOrigin: () => { x: number; y: number; z: number };
  critTarget: () => { x: number; y: number; z: number };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function moveKindFor(animation: AnimationId): MoveKind {
  if (animation === 'dodge') return 'roll';
  if (animation === 'run') return 'run';
  if (animation === 'walk') return 'walk';
  return 'still';
}

/** True on the paved road. Half its width plus a little, so the edge doesn't flicker between sounds. */
function onRoad(x: number, z: number): boolean {
  const { road } = MAP;
  for (let i = 0; i + 3 < road.length; i += 2) {
    const ax = road[i];
    const az = road[i + 1];
    const dx = road[i + 2] - ax;
    const dz = road[i + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(0.001, dx * dx + dz * dz)));
    const ox = x - (ax + dx * t);
    const oz = z - (az + dz * t);
    if (ox * ox + oz * oz < ROAD_STEP_WIDTH * ROAD_STEP_WIDTH) return true;
  }
  return false;
}

function surfaceAt(x: number, z: number): FootSurface {
  if (onRoad(x, z)) return 'stone';
  for (const zone of MAP.zones) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      return ZONE_SURFACES[zone.name] ?? 'dirt';
    }
  }
  return 'dirt';
}

/**
 * How far along the ground, from x, z in direction dirX, dirZ, the camera can go before something solid is in
 * the way, up to wanted. Thick things stop it in front of them; thin ones only if it would end up inside one.
 * One pass over the map's colliders a frame, with no allocation.
 */
function cameraClearance(fromX: number, fromZ: number, dirX: number, dirZ: number, wanted: number): number {
  let clear = wanted;
  const colliders = MAP.colliders;
  for (let i = 0; i < colliders.length; i += 1) {
    const collider = colliders[i];
    const ox = fromX - collider.x;
    const oz = fromZ - collider.z;
    let enter: number;
    let exit: number;
    let thin: boolean;
    if (collider.t === 'c') {
      const radius = collider.r + CAMERA_PROBE_RADIUS;
      const reach = wanted + radius;
      const squared = ox * ox + oz * oz;
      if (squared > reach * reach) continue;
      const along = ox * dirX + oz * dirZ;
      const disc = along * along - (squared - radius * radius);
      if (disc <= 0) continue;
      const root = Math.sqrt(disc);
      enter = -along - root;
      exit = -along + root;
      thin = collider.r < CAMERA_THIN_RADIUS;
    } else {
      const halfX = collider.hw + CAMERA_PROBE_RADIUS;
      const halfZ = collider.hd + CAMERA_PROBE_RADIUS;
      const reach = wanted + halfX + halfZ;
      if (ox * ox + oz * oz > reach * reach) continue;
      // Into the rectangle's own axes, the same way shared/collision.ts does it.
      const localX = ox * collider.cos - oz * collider.sin;
      const localZ = ox * collider.sin + oz * collider.cos;
      const stepX = dirX * collider.cos - dirZ * collider.sin;
      const stepZ = dirX * collider.sin + dirZ * collider.cos;
      enter = -Infinity;
      exit = Infinity;
      if (Math.abs(stepX) < 1e-6) {
        if (Math.abs(localX) > halfX) continue;
      } else {
        const a = (-halfX - localX) / stepX;
        const b = (halfX - localX) / stepX;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
      if (Math.abs(stepZ) < 1e-6) {
        if (Math.abs(localZ) > halfZ) continue;
      } else {
        const a = (-halfZ - localZ) / stepZ;
        const b = (halfZ - localZ) / stepZ;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
      if (enter > exit) continue;
      thin = Math.max(collider.hw, collider.hd) < CAMERA_THIN_RADIUS;
    }
    if (exit <= 0 || enter >= clear) continue;
    if (thin && exit <= wanted) continue;
    clear = Math.min(clear, Math.max(0, enter - 0.1));
  }
  return clear;
}

export class GameClient {
  private readonly psx: PsxRenderer;
  private readonly world = createWorld();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000);
  private readonly connection: GameConnection;
  private readonly avatars = new Map<number, Avatar>();
  private readonly keys = new Set<string>();
  private readonly cameraTarget = new THREE.Vector3(0, 1.3, 0);
  private readonly projected = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly tipBase = new THREE.Vector3();
  private readonly fx: GameFx;
  private readonly cameraFx = new CameraFx();
  private readonly parts: FeelParts;
  private readonly creatures: CreatureField;
  private readonly openedChests = new Set<number>();
  private readonly litGraces = new Set<number>();
  private readonly graces: GraceField;
  /** The grace the server says you're sitting at, which also drives the camera. */
  private restGrace: MapGrace | null = null;
  /** A menu of the game's own is up. The pause menu isn't one of these. */
  private overlayOpen = false;
  private resumeWithPad = false;
  private readonly lantern = new THREE.PointLight(LANTERN_COLOR, LANTERN_POWER, LANTERN_RANGE, 1.5);
  private readonly lockOn: LockOn;
  private readonly critFx: CriticalFx;
  private bossBar: BossBarState | null = null;
  /** The boss music is playing for you: from the bar first showing until a win, a death or leaving. */
  private musicOn = false;
  /** The critical and impact-frame shaders were compiled ahead of the first stance break. */
  private critWarmed = false;
  /** The boss lying stunned, or 0, with its dazed drone. */
  private stunnedBoss = 0;
  private stunLoop: LoopHandle | null = null;
  private stunnedAt = 0;
  private readonly weakSpot = { x: 0, y: 0, z: 0 };
  private readonly weakPointAt = () => {
    this.creatures.copyBossHead(this.stunnedBoss, this.weakSpot);
    return this.weakSpot;
  };
  /** Your own critical: how far the cinematic camera has taken over, 0 to 1, and where it is. */
  private critCamWeight = 0;
  private critCamFresh = true;
  private readonly critCamPos = new THREE.Vector3();
  private readonly critCamLook = new THREE.Vector3();
  private readonly critCamGoal = new THREE.Vector3();
  private readonly critCamGoalLook = new THREE.Vector3();
  private readonly critOffset = new THREE.Vector3();
  private readonly critSpot = { x: 0, y: 0, z: 0 };
  private readonly impactFocus = { x: 0.5, y: 0.5 };
  private readonly critNumbers = new Map<number, HTMLElement>();
  /** 0 to 1: how far the camera has backed off for a huge lock-on target. */
  private bigLock = 0;
  private readonly pivotGoal = new THREE.Vector3();
  /** The lock-on the server was last told about, so that it's only told when it changes. */
  private sentAim = 0;
  private readonly pad: GamepadInput;
  private readonly lookPoint = new THREE.Vector3();
  private lookRaise = 0;
  private recentering = false;
  /** Playing with a controller, which needs no pointer lock. */
  private padPlaying = false;
  private frameId = 0;
  private lastTime = 0;
  private lastHud = 0;
  private yaw = 0;
  private pitch = DEFAULT_PITCH;
  private distance = 5;
  private cameraReach = 5;
  private faceYaw = 0;
  private dodgeQueued = false;
  /** Seconds a roll pressed while busy is kept waiting, so it comes out the moment a swing or drink ends. */
  private dodgeBuffer = 0;
  /** The same for an attack pressed by a stunned boss's head while still busy: it becomes the critical. */
  private critBuffer = 0;
  private attackQueued = false;
  private potionQueued = false;
  private jumpQueued = false;
  private interactQueued = false;
  private disposed = false;
  private shownDust = 0;
  private dustSettleTimer = 0;
  private serverDust = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly plateLayer: HTMLElement,
    private readonly callbacks: GameCallbacks,
  ) {
    this.psx = new PsxRenderer(canvas);
    this.fx = new GameFx(this.world.scene, this.camera);
    this.parts = { fx: this.fx, camera: this.cameraFx, vhs: this.psx.vhs };
    this.creatures = new CreatureField(this.world.scene, this.fx, this.camera, canvas, plateLayer);
    this.fx.arcane.findTarget = (id, out) => this.creatures.copyLivingChest(id, out);
    this.creatures.onBossImpact = (x, z, power) => this.bossShake(x, z, power);
    this.world.scene.add(this.lantern);
    this.graces = new GraceField(this.world.scene, this.world.graces);
    this.lockOn = new LockOn(this.world.scene, this.camera, this.creatures);
    this.critFx = new CriticalFx({ scene: this.world.scene, camera: this.camera, fx: this.fx, cameraFx: this.cameraFx, psx: this.psx });
    this.pad = new GamepadInput({
      onAction: (action) => this.onPadAction(action),
      onMenu: callbacks.onMenu,
      onFlick: (x, y) => this.lockOn.flick(x, y),
      onLost: () => {
        if (this.padPlaying) this.pause();
      },
    });
    this.connection = new GameConnection({
      onStatus: (status) => {
        // Reconnecting brings back a different world state, so nothing from the old one is kept.
        if (status !== 'open') this.lockOn.release();
        callbacks.onStatus(status);
      },
      onWelcome: (myId, players, dust, chests, graces) => this.onWelcome(myId, players, dust, chests, graces),
      onJoin: (player) => this.addAvatar(player),
      onLeave: (id) => this.removeAvatar(id),
      onCreatures: (list: CreatureSnapshot[]) => this.creatures.applySnapshot(list),
      onBoss: (boss) => this.onBoss(boss),
      onGameEvents: (events) => this.onGameEvents(events),
      onSelf: (dust) => this.onSelf(dust),
      onChest: (id, dust, potion) => this.onChest(id, dust, potion),
      onUnlock: (achievement) => this.onUnlock(achievement),
      onGrace: (id) => this.onGrace(id),
      onResting: (grace) => this.onResting(grace),
      onInfo: (player) => this.onInfo(player),
      onUpgraded: (stat) => this.onUpgraded(stat),
      onRefused: (reason) => this.onRefused(reason),
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });

    this.frameId = requestAnimationFrame(this.frame);
  }

  requestPointerLock(): void {
    // This always runs inside a click, the only moment browsers allow sound to start.
    sound.enableForGame();
    // Browsers refuse this for a moment after Esc. The game just stays paused until the next click.
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => undefined);
  }

  /** Starts playing from a controller. Browsers don't allow pointer lock without a click, and it isn't needed. */
  playWithController(): void {
    if (this.playing) return;
    sound.enableForGame();
    this.padPlaying = true;
    this.callbacks.onPointerLock(true);
  }

  private pause(): void {
    if (document.pointerLockElement === this.canvas) {
      // The pointerlockchange event finishes the job.
      document.exitPointerLock();
      return;
    }
    if (!this.padPlaying) return;
    this.padPlaying = false;
    this.keys.clear();
    this.callbacks.onPointerLock(false);
  }

  /** Hands the mouse and controller over to a menu. The world goes on running behind it. */
  openOverlay(): void {
    if (this.overlayOpen) return;
    this.overlayOpen = true;
    this.resumeWithPad = this.padPlaying;
    this.keys.clear();
    this.pause();
  }

  /** resume goes straight back to playing. Browsers can refuse the pointer lock, which just leaves the pause menu up. */
  closeOverlay(resume: boolean): void {
    if (!this.overlayOpen) return;
    this.overlayOpen = false;
    if (!resume) return;
    if (this.resumeWithPad) this.playWithController();
    else this.requestPointerLock();
  }

  /* What the menus can ask for. The server checks every one of these again. */

  standUp(): void {
    this.connection.send({ t: 'stand' });
  }

  upgradeStat(stat: StatKey): void {
    this.connection.send({ t: 'upgrade', stat });
  }

  travelTo(grace: number): void {
    this.connection.send({ t: 'travel', grace });
  }

  mapView(): MapView {
    const others: MapView['others'] = [];
    for (const avatar of this.avatars.values()) {
      if (avatar.id !== this.connection.myId) others.push({ x: avatar.x, z: avatar.z, name: avatar.info.username });
    }
    return { me: this.connection.localPosition(), others };
  }

  get vhsOn(): boolean {
    return this.psx.vhs.enabled;
  }

  setVhs(on: boolean): void {
    this.psx.vhs.enabled = on;
  }

  get reduceShake(): boolean {
    return this.cameraFx.reduceShake;
  }

  setReduceShake(on: boolean): void {
    this.cameraFx.setReduceShake(on);
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.psx.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private get playing(): boolean {
    return this.padPlaying || document.pointerLockElement === this.canvas;
  }

  private get inMyCritical(): boolean {
    return this.avatars.get(this.connection.myId)?.crit.on ?? false;
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    this.keys.add(event.code);
    // Both of these also work with the game paused or a menu open.
    if (event.code === 'KeyM' && this.connection.state) {
      this.callbacks.onMapKey();
      return;
    }
    if (event.code === 'Escape' && this.overlayOpen) {
      this.callbacks.onMenu('back');
      return;
    }
    if (!this.playing) return;
    // With pointer lock, the browser takes Esc for itself and pauses that way.
    if (event.code === 'Escape') this.pause();
    if (event.code === 'KeyC') {
      this.dodgeQueued = true;
    } else if (event.code === 'Space') {
      // Or the browser scrolls the page.
      event.preventDefault();
      this.jumpQueued = true;
    } else if (event.code === 'Digit1' || event.code === 'Numpad1') {
      this.potionQueued = true;
    } else if (event.code === 'KeyE') {
      this.interactQueued = true;
    } else if (event.code === 'KeyQ') {
      this.pressLock();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = () => {
    this.keys.clear();
    // Pointer lock ends by itself when the window loses focus. This keeps a controller the same.
    if (this.padPlaying) this.pause();
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    // Your critical has the camera. The view you had comes back as it ends.
    if (this.inMyCritical) return;
    if (this.lockOn.locked) {
      this.lockOn.addMouseFlick(event.movementX, event.movementY);
      return;
    }
    this.recentering = false;
    this.yaw -= event.movementX * MOUSE_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + event.movementY * MOUSE_SENSITIVITY, MIN_PITCH, MAX_PITCH);
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    // Or the middle button starts the browser's autoscroll.
    if (event.button === 1) event.preventDefault();
    if (this.overlayOpen) return;
    if (document.pointerLockElement !== this.canvas) {
      this.requestPointerLock();
    } else if (event.button === 0) {
      this.attackQueued = true;
    } else if (event.button === 1) {
      this.pressLock();
    }
  };

  private pressLock(): void {
    const state = this.connection.state;
    if (!state || state.deadTime > 0) return;
    if (this.lockOn.locked) {
      this.lockOn.release();
      return;
    }
    this.recentering = !this.lockOn.acquire(state.x, state.z);
  }

  private onPadAction(action: PadAction): void {
    if (action === 'attack') this.attackQueued = true;
    else if (action === 'lock') this.pressLock();
    else if (action === 'roll') this.dodgeQueued = true;
    else if (action === 'jump') this.jumpQueued = true;
    else if (action === 'potion') this.potionQueued = true;
    else if (action === 'interact') this.interactQueued = true;
    else if (action === 'map') this.callbacks.onMapKey();
    else this.pause();
  }

  private readonly onWheel = (event: WheelEvent) => {
    this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.005, MIN_DISTANCE, MAX_DISTANCE);
  };

  private readonly onPointerLockChange = () => {
    // A click took over from the controller.
    if (document.pointerLockElement === this.canvas) this.padPlaying = false;
    if (!this.playing) this.keys.clear();
    this.callbacks.onPointerLock(this.playing);
  };

  private onWelcome(myId: number, players: PlayerInfo[], dust: number, chests: number[], graces: number[]): void {
    // Ids restart when the server does, so an old id may now belong to someone else entirely.
    this.lockOn.release();
    this.recentering = false;
    this.endStun();
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    for (const player of players) this.addAvatar(player);
    const mine = this.connection.state;
    if (mine) {
      // Start out looking the way the character faces, toward the middle of the map.
      this.faceYaw = Math.atan2(-mine.x, -mine.z);
      this.yaw = this.faceYaw;
      this.cameraTarget.set(mine.x, CAMERA_PIVOT_HEIGHT, mine.z);
    }
    this.avatars.get(myId)?.plate.classList.add('nameplate--self');
    this.serverDust = dust;
    this.shownDust = dust;
    this.callbacks.onBinaryDust(dust, false);
    // Yours stay open from the first frame, with no animation. Other players see their own.
    this.openedChests.clear();
    for (const id of chests) {
      this.openedChests.add(id);
      this.world.setChestOpen(id, true, false);
    }
    this.litGraces.clear();
    for (const grace of this.world.graces) this.graces.setLit(grace.id, false, false);
    for (const id of graces) {
      this.litGraces.add(id);
      this.graces.setLit(id, true, false);
    }
  }

  private addAvatar(player: PlayerInfo): void {
    const plate = document.createElement('div');
    plate.className = 'nameplate';
    if (player.avatarUrl) {
      const picture = document.createElement('img');
      picture.src = player.avatarUrl;
      picture.alt = '';
      plate.append(picture);
    }
    const text = document.createElement('span');
    const name = document.createElement('strong');
    // textContent, so a username can never be read as HTML.
    name.textContent = player.username;
    const detail = document.createElement('small');
    detail.textContent = `Level ${player.level} ${findClass(player.classId)?.name ?? ''}`;
    text.append(name, detail);
    plate.append(text);
    this.plateLayer.append(plate);

    const weapon = weaponFor(player.classId, player.appearance.variant);
    const setup = ARMORY[player.classId][player.appearance.variant] ?? ARMORY[player.classId][0];
    const feet = { x: 0, y: 0, z: 0 };
    const critFeet = { x: 0, y: 0, z: 0 };
    const critBossFeet = { x: 0, y: 0, z: 0 };
    const avatar: Avatar = {
      id: player.id,
      info: player,
      model: null,
      plate,
      plateDetail: detail,
      modelLoad: 0,
      weapon,
      isBow: !!setup.bow,
      trail: new FootTrail(this.parts, player.id === this.connection.myId),
      x: 0,
      z: 0,
      yaw: 0,
      lastAttackCount: -1,
      swingStarted: false,
      trailOn: false,
      impactDone: false,
      burning: false,
      flash: 0,
      flashMaterials: null,
      flashBases: [],
      flashIntensities: [],
      feet,
      jumpWas: 0,
      drinkWas: 0,
      // Read every frame by the dust in flight, so it mustn't allocate.
      collector: () => feet,
      crit: {
        on: false, originX: 0, originZ: 0, yaw: 0, boss: 0, handle: -1, family: 'heavy', travel: 0, marks: null,
        last: -1, impactDone: false, mine: false,
      },
      critBoss: 0,
      critOrigin: () => critFeet,
      // Keeps the last place it knew if the boss drops out of view.
      critTarget: () => {
        this.creatures.copyFeet(avatar.crit.boss, critBossFeet);
        return critBossFeet;
      },
    };
    this.avatars.set(player.id, avatar);
    this.loadAvatarModel(player, avatar);
  }

  private loadAvatarModel(player: PlayerInfo, avatar: Avatar): void {
    avatar.modelLoad += 1;
    const load = avatar.modelLoad;
    // The real stats, so the swing lasts exactly as long as the server's attack timer.
    createCharacter(player.classId, player.appearance, player.stats).then(
      (model) => {
        if (this.disposed || this.avatars.get(player.id) !== avatar || avatar.modelLoad !== load) {
          model.dispose();
          return;
        }
        const old = avatar.model;
        if (old) {
          this.fx.undissolve(old.root);
          this.world.scene.remove(old.root);
          old.dispose();
          // They belonged to the old model.
          avatar.flashMaterials = null;
        }
        avatar.model = model;
        this.world.scene.add(model.root);
      },
      () => {
        // A failed download shouldn't leave this player invisible, so it tries again.
        window.setTimeout(() => {
          if (!this.disposed && this.avatars.get(player.id) === avatar && avatar.modelLoad === load) {
            this.loadAvatarModel(player, avatar);
          }
        }, MODEL_RETRY_MS);
      },
    );
  }

  private removeAvatar(id: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    avatar.plate.remove();
    this.endCritical(avatar, true);
    this.fx.healEnd(id);
    if (avatar.trailOn) this.fx.endTrail(id);
    if (avatar.model) {
      this.fx.undissolve(avatar.model.root);
      this.world.scene.remove(avatar.model.root);
      avatar.model.dispose();
    }
    this.avatars.delete(id);
  }

  private readInput(frameSeconds: number): FrameInput {
    const forward = THREE.MathUtils.clamp(
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) + this.pad.move.y,
      -1,
      1,
    );
    const strafe = THREE.MathUtils.clamp(
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.pad.move.x,
      -1,
      1,
    );

    const { state, derived } = this.connection;
    if (state && state.criticalTime > 0) {
      // The critical plays out on its own, and the server ignores input through it anyway.
      this.faceYaw = state.yaw;
      this.dodgeQueued = this.attackQueued = this.potionQueued = this.jumpQueued = this.interactQueued = false;
      return { mx: 0, mz: 0, yaw: state.yaw, run: false, dodge: false, attack: false, potion: false, jump: false, interact: false };
    }
    // While locked, forward means toward the target and sideways circles around it.
    const aimYaw = state ? this.lockOn.aimYaw(state.x, state.z) : null;
    const moveYaw = aimYaw ?? this.yaw;
    const sin = Math.sin(moveYaw);
    const cos = Math.cos(moveYaw);
    const mx = forward * sin - strafe * cos;
    const mz = forward * cos + strafe * sin;

    // Input buffering, as in Elden Ring: a roll pressed during a swing, a drink or a landing is held for a moment
    // and comes out on the first frame it can. It's dropped once the roll starts, or if it never can.
    if (this.dodgeQueued) this.dodgeBuffer = DODGE_BUFFER_SECONDS;
    else this.dodgeBuffer = Math.max(0, this.dodgeBuffer - frameSeconds);
    if (state && state.dodgeTime > 0 && !this.dodgeQueued) this.dodgeBuffer = 0;
    const critReady = !!state && this.critReady(state.x, state.z);
    if (this.attackQueued && critReady) this.critBuffer = CRIT_BUFFER_SECONDS;
    else this.critBuffer = critReady ? Math.max(0, this.critBuffer - frameSeconds) : 0;
    const attack = this.attackQueued || this.critBuffer > 0;
    // Until the blow lands you can still steer it with the mouse, or a moving wolf could never be hit.
    const windingUp = !!state && !!derived && state.attackTime > derived.attackSeconds * (1 - derived.hitAt);
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.pad.run;
    const runningFree = run && (mx !== 0 || mz !== 0);
    let targetYaw = this.faceYaw;
    if (aimYaw !== null && (attack || windingUp || !runningFree)) targetYaw = aimYaw;
    // As in Elden Ring, a swing goes where the character faces, not where the camera looks. Holding a direction
    // as you attack (or during the windup) turns the swing that way instead.
    else if (mx !== 0 || mz !== 0) targetYaw = Math.atan2(mx, mz);
    const delta = wrapAngle(targetYaw - this.faceYaw);
    this.faceYaw = wrapAngle(this.faceYaw + delta * Math.min(1, TURN_SPEED * frameSeconds));
    if (attack) this.faceYaw = targetYaw;

    const input: FrameInput = {
      mx,
      mz,
      yaw: this.faceYaw,
      run,
      dodge: this.dodgeBuffer > 0 && !attack,
      attack,
      potion: this.potionQueued,
      jump: this.jumpQueued,
      interact: this.interactQueued,
      // In front of a stunned boss the server may make this a critical, so no swing is guessed at here.
      holdAttack: attack && critReady,
    };
    this.dodgeQueued = false;
    this.attackQueued = false;
    this.potionQueued = false;
    this.jumpQueued = false;
    this.interactQueued = false;
    return input;
  }

  /** Turns the view: with the right stick, toward a lock-on target, or back behind you. Walls are handled after this. */
  private steerCamera(seconds: number, playerX: number, playerZ: number): void {
    const { look } = this.pad;
    const aim = this.lockOn.aim;
    const big = aim !== null && this.lockOn.reach > BIG_LOCK_REACH;
    this.bigLock += ((big ? 1 : 0) - this.bigLock) * (1 - Math.exp(-seconds * BIG_LOCK_RATE));
    // Your critical has the camera, and the view and lock wait where they were until it's over.
    if (this.inMyCritical) return;
    if (this.restGrace) {
      const blend = 1 - Math.exp(-seconds * REST_CAMERA_RATE);
      const towardGrace = Math.atan2(this.restGrace.x - playerX, this.restGrace.z - playerZ);
      this.yaw = wrapAngle(this.yaw + wrapAngle(towardGrace + REST_CAMERA_SIDE - this.yaw) * blend);
      this.pitch += (REST_CAMERA_PITCH - this.pitch) * blend;
      this.recentering = false;
    } else if (aim) {
      this.recentering = false;
      const dx = aim.x - playerX;
      const dz = aim.z - playerZ;
      const distance = Math.hypot(dx, dz);
      const blend = 1 - Math.exp(-seconds * LOCK_TURN_RATE);
      if (distance > LOCK_MIN_DISTANCE) this.yaw = wrapAngle(this.yaw + wrapAngle(Math.atan2(dx, dz) - this.yaw) * blend);
      const follow = LOCK_PITCH + Math.atan2(CAMERA_PIVOT_HEIGHT - aim.y, Math.max(distance, LOCK_MIN_DISTANCE)) * LOCK_PITCH_FOLLOW;
      // Looking up at a huge chest would drop the camera to your heels, so a boss is seen from above instead.
      const tilt = follow + (BIG_LOCK_PITCH - follow) * this.bigLock;
      this.pitch += (THREE.MathUtils.clamp(tilt, MIN_PITCH, LOCK_MAX_PITCH) - this.pitch) * blend;
    } else if (this.playing && (look.x !== 0 || look.y !== 0)) {
      this.recentering = false;
      this.yaw -= look.x * STICK_YAW_SPEED * seconds;
      this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * STICK_PITCH_SPEED * seconds, MIN_PITCH, MAX_PITCH);
    } else if (this.recentering) {
      const blend = 1 - Math.exp(-seconds * RECENTER_RATE);
      const yawLeft = wrapAngle(this.faceYaw - this.yaw);
      this.yaw = wrapAngle(this.yaw + yawLeft * blend);
      this.pitch += (DEFAULT_PITCH - this.pitch) * blend;
      if (Math.abs(yawLeft) < RECENTER_DONE && Math.abs(DEFAULT_PITCH - this.pitch) < RECENTER_DONE) this.recentering = false;
    }
    const usual = aim ? THREE.MathUtils.clamp((aim.y - CAMERA_PIVOT_HEIGHT) * LOOK_RAISE_SHARE, 0, LOOK_RAISE_MAX) : 0;
    const raise = usual + (BIG_LOCK_LOOK_RAISE - usual) * this.bigLock;
    this.lookRaise += (raise - this.lookRaise) * (1 - Math.exp(-seconds * LOOK_RAISE_RATE));
  }

  /** Stops short of walls and trunks, so the view never ends up inside one. Works on the same grid as movement. */
  private placeCamera(seconds: number): void {
    const horizontal = Math.cos(this.pitch);
    const directionX = -Math.sin(this.yaw);
    const directionZ = -Math.cos(this.yaw);
    const usual = this.restGrace ? REST_CAMERA_DISTANCE : this.distance;
    const wanted = usual + (Math.max(usual, BIG_LOCK_DISTANCE) - usual) * this.bigLock;
    // Measured along the ground, then turned back into a distance along the tilted view.
    const flat = cameraClearance(this.cameraTarget.x, this.cameraTarget.z, directionX, directionZ, wanted * horizontal);
    const clear = Math.max(CAMERA_CLOSEST, Math.min(wanted, flat / Math.max(0.2, horizontal)));
    // Snaps in at once, or you'd see through the wall. Eases back out, or it would jump around in a forest.
    this.cameraReach = clear < this.cameraReach
      ? clear
      : this.cameraReach + (clear - this.cameraReach) * (1 - Math.exp(-seconds * CAMERA_EASE_OUT));
    const reach = this.cameraReach;
    this.camera.position.set(
      this.cameraTarget.x + directionX * horizontal * reach,
      Math.max(0.25, this.cameraTarget.y + Math.sin(this.pitch) * reach),
      this.cameraTarget.z + directionZ * horizontal * reach,
    );
    // A tall target raises the view a little, easing back down after it's gone, so nothing snaps.
    this.lookPoint.copy(this.cameraTarget);
    this.lookPoint.y += this.lookRaise;
    this.camera.lookAt(this.lookPoint);
  }

  private updateAvatar(
    avatar: Avatar,
    x: number,
    z: number,
    yaw: number,
    animation: AnimationId,
    attackCount: number,
    deadTime: number,
    moving: number,
    drinkTime: number,
    jumpTime: number,
    criticalTime: number,
    animSeconds: number,
    fxSeconds: number,
    realSeconds: number,
  ): void {
    const crit = avatar.crit;
    if (criticalTime > 0 && !crit.on && deadTime <= 0) this.startCritical(avatar, x, z, yaw, criticalTime);
    else if (criticalTime <= 0 && crit.on) this.endCritical(avatar, false);
    let lift = 0;
    if (crit.on) {
      // Drawn from where it began plus the animation's own dash or leap. The server moves the player by the
      // whole travel in one go at the end, so until then the drawing, not the position, carries it.
      yaw = crit.yaw;
      const model = avatar.model;
      if (model && model.criticalPhase() >= 0) {
        model.root.rotation.y = yaw;
        model.criticalRootOffset(this.critOffset);
        x = crit.originX + this.critOffset.x;
        z = crit.originZ + this.critOffset.z;
        lift = this.critOffset.y;
      } else if (crit.marks) {
        // The animation finished a moment before the server's clock: hold its last spot.
        x = crit.originX + Math.sin(yaw) * crit.travel;
        z = crit.originZ + Math.cos(yaw) * crit.travel;
        animation = 'idle';
      } else {
        // Its model was still loading when the critical began, so it just stands there.
        x = crit.originX;
        z = crit.originZ;
        animation = 'idle';
      }
    }
    avatar.x = x;
    avatar.z = z;
    avatar.yaw = yaw;
    avatar.feet.x = x;
    avatar.feet.z = z;
    const height = jumpHeight(jumpTime);
    avatar.feet.y = height;
    // A new jump straight after the last one never passes through 0.
    const jumpedAgain = avatar.jumpWas > 0 && jumpTime > avatar.jumpWas + JUMP_SECONDS / 2;
    if (avatar.model) {
      avatar.model.root.position.set(x, height + lift, z);
      avatar.model.root.rotation.y = yaw;
      const restart = avatar.lastAttackCount >= 0 && attackCount !== avatar.lastAttackCount && animation === 'attack';
      avatar.lastAttackCount = attackCount;
      avatar.model.play(animation, restart || (jumpedAgain && animation === 'jump'));
      avatar.model.setDrinkWalking(moving > 0);
      if (restart) this.startAttack(avatar);
      // A critical keeps real time: its slow parts are written into it, and the server times the blow in real time.
      avatar.model.update(crit.on ? realSeconds : animSeconds);
      if (crit.on) this.driveCritical(avatar);
      this.driveAttack(avatar, animation);
      this.driveDeath(avatar, deadTime, x, z);
      this.driveFlash(avatar, realSeconds);
    }
    const moveKind = moveKindFor(animation);
    avatar.trail.update(fxSeconds, avatar.feet, moveKind);
    if (avatar.model && avatar.model.takeFootfalls() > 0 && height === 0) {
      avatar.trail.step(avatar.feet, moveKind, surfaceAt(x, z));
    }
    this.driveJump(avatar, jumpTime, jumpedAgain, deadTime);
    this.driveHeal(avatar, drinkTime);

    // Nameplates are real page text, so they stay sharp above the low-res picture.
    const plateHeight = NAMEPLATE_HEIGHT + height - (animation === 'rest' ? SITTING_PLATE_DROP : 0);
    this.projected.set(x, plateHeight, z).project(this.camera);
    const distance = this.camera.position.distanceTo(new THREE.Vector3(x, plateHeight, z));
    const visible = this.projected.z < 1 && distance < NAMEPLATE_MAX_DISTANCE;
    avatar.plate.style.display = visible ? 'flex' : 'none';
    if (visible) {
      const left = (this.projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
      const top = (-this.projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
      avatar.plate.style.transform = `translate(-50%, -100%) translate(${left | 0}px, ${top | 0}px)`;
      avatar.plate.style.opacity = String(Math.min(1, (NAMEPLATE_MAX_DISTANCE - distance) / 12));
    }
  }

  /** A critical begins drawing: the animation, caught up to the server's clock, and its effects on the boss. */
  private startCritical(avatar: Avatar, x: number, z: number, yaw: number, criticalTime: number): void {
    const crit = avatar.crit;
    const mine = avatar.id === this.connection.myId;
    crit.on = true;
    crit.originX = x;
    crit.originZ = z;
    crit.yaw = yaw;
    crit.boss = avatar.critBoss || (this.bossBar?.id ?? 0);
    avatar.critBoss = 0;
    crit.family = criticalFamily(avatar.info.classId, avatar.info.appearance.variant);
    crit.mine = mine;
    crit.handle = -1;
    crit.marks = null;
    crit.last = -1;
    crit.impactDone = false;
    const origin = avatar.critOrigin();
    origin.x = x;
    origin.z = z;
    if (avatar.trailOn) {
      this.fx.endTrail(avatar.id);
      avatar.trailOn = false;
    }
    if (mine) {
      this.lockOn.setHidden(true);
      this.recentering = false;
    }
    const model = avatar.model;
    crit.travel = model ? model.criticalTravel : avatar.weapon.criticalTravel ?? 0;
    if (!model) return;
    model.root.rotation.y = yaw;
    model.playCritical();
    const behind = CRITICAL_SECONDS - criticalTime;
    if (behind > 0.02) model.update(Math.min(behind, CRIT_MAX_CATCH_UP));
    crit.marks = model.criticalMarks();
    // Beats already behind it stay quiet rather than all firing at once.
    crit.last = model.criticalPhase();
    if (crit.boss > 0) {
      crit.handle = this.critFx.start({
        classId: avatar.info.classId,
        variant: avatar.info.appearance.variant,
        attacker: { position: avatar.critOrigin, yaw, model },
        target: { position: avatar.critTarget, radius: this.creatures.radiusOf(crit.boss), height: this.creatures.bossSize(crit.boss) },
        mine,
      });
    }
  }

  /** cancelEffects cuts the effects off at once, for a disconnect; otherwise they finish on their own. */
  private endCritical(avatar: Avatar, cancelEffects: boolean): void {
    const crit = avatar.crit;
    if (!crit.on) return;
    crit.on = false;
    if (avatar.model && avatar.model.criticalPhase() >= 0) avatar.model.cancelCritical();
    if (cancelEffects && crit.handle >= 0) this.critFx.cancel(crit.handle);
    crit.handle = -1;
    if (crit.mine) this.lockOn.setHidden(false);
  }

  /** The critical's sounds, each on its beat of the animation, and the blow itself. */
  private driveCritical(avatar: Avatar): void {
    const { crit, model } = avatar;
    if (!model) return;
    const phase = model.criticalPhase();
    if (phase < 0) return;
    const marks = crit.marks;
    const cues = CRIT_CUES[crit.family];
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      const at = (cue.mark && marks ? marks[cue.mark] : undefined) ?? cue.at;
      if (crit.last < at && phase >= at) {
        sound.playGame(cue.name, crit.mine ? { volume: cue.volume, pitch: cue.pitch } : { x: avatar.x, z: avatar.z, volume: cue.volume, pitch: cue.pitch });
      }
    }
    if (!crit.impactDone && phase >= CRITICAL_IMPACT_AT) {
      crit.impactDone = true;
      sound.impactSound(CRIT_IMPACT_SOUND[crit.family], crit.mine ? {} : { x: avatar.x, z: avatar.z });
      // Someone else's: a short light frame if it's close, never the full sequence, and never over your own.
      if (!crit.mine && !this.inMyCritical && !this.psx.impact.active && crit.boss > 0 && this.creatures.copyBossHead(crit.boss, this.critSpot)) {
        const dx = this.camera.position.x - this.critSpot.x;
        const dz = this.camera.position.z - this.critSpot.z;
        if (dx * dx + dz * dz < CRIT_NEAR_METERS * CRIT_NEAR_METERS) {
          if (!ImpactSequencer.screenFocus(this.critSpot, this.camera, this.impactFocus)) {
            this.impactFocus.x = 0.5;
            this.impactFocus.y = 0.5;
          }
          this.psx.impact.play('light', { focus: this.impactFocus });
        }
      }
    }
    crit.last = phase;
  }

  /**
   * Your own critical's camera: pulled back and to the side so you and the boss are both in the picture, framed
   * for the weapon. It eases in over the normal view and back out of it, which is never changed underneath.
   */
  private driveCriticalCamera(seconds: number): void {
    const avatar = this.avatars.get(this.connection.myId);
    const on = !!avatar && avatar.crit.on;
    this.critCamWeight = on
      ? Math.min(1, this.critCamWeight + seconds / CRIT_CAMERA_IN_SECONDS)
      : Math.max(0, this.critCamWeight - seconds / CRIT_CAMERA_OUT_SECONDS);
    if (this.critCamWeight <= 0) {
      this.critCamFresh = true;
      return;
    }
    let rate = 4;
    if (on && avatar) {
      const { crit } = avatar;
      const phase = avatar.model ? avatar.model.criticalPhase() : -1;
      const fx = Math.sin(crit.yaw);
      const fz = Math.cos(crit.yaw);
      // Right of the way the attacker faces.
      const rx = fz;
      const rz = -fx;
      const sx = crit.originX;
      const sz = crit.originZ;
      let bx = sx + fx * 5;
      let bz = sz + fz * 5;
      if (crit.boss > 0 && this.creatures.copyFeet(crit.boss, this.critSpot)) {
        bx = this.critSpot.x;
        bz = this.critSpot.z;
      }
      const gap = Math.hypot(bx - sx, bz - sz);
      const mx = (sx + bx) / 2;
      const mz = (sz + bz) / 2;
      const goal = this.critCamGoal;
      const look = this.critCamGoalLook;
      switch (crit.family) {
        case 'katana': {
          const travel = crit.travel || 9;
          if (phase >= 0 && phase < 0.42) {
            // Side on, with the crouch and the boss both in the shot.
            const cx = sx + fx * gap * 0.5;
            const cz = sz + fz * gap * 0.5;
            goal.set(cx + rx * 7.5, 1.2, cz + rz * 7.5);
            look.set(cx, 1.3, cz);
          } else if (phase >= 0 && phase < 0.52) {
            // Tracking the dash.
            goal.set(avatar.x + rx * 7 + fx * 1.5, 1.2, avatar.z + rz * 7 + fz * 1.5);
            look.set(avatar.x, 1.1, avatar.z);
            rate = 16;
          } else {
            // Holding on the still figure, with the boss behind it.
            const ex = sx + fx * travel;
            const ez = sz + fz * travel;
            goal.set(ex + fx * 4.2 + rx * 1.6, 1.5, ez + fz * 4.2 + rz * 1.6);
            look.set(ex - fx * 1.5, 1.4, ez - fz * 1.5);
            rate = 6;
          }
          break;
        }
        case 'bow':
          // Over the shoulder, toward the boss. The effects turn it to follow the arrow.
          goal.set(sx - fx * 2.4 + rx * 1.1, 1.9, sz - fz * 2.4 + rz * 1.1);
          look.set(bx, 2.7, bz);
          break;
        case 'staff':
        case 'wand':
        case 'quarterstaff': {
          // High and far, for the size of the spell.
          const back = gap * 0.5 + 7;
          goal.set(mx - fx * back + rx * 6, 8.5, mz - fz * back + rz * 6);
          look.set(mx, 2, mz);
          break;
        }
        default: {
          // Low and wide, side on: the raise, the slam and the crater all in one shot.
          const side = gap * 0.5 + 6;
          const tall = crit.family === 'spear';
          goal.set(mx + rx * side - fx * 1.5, tall ? 1.7 : 1, mz + rz * side - fz * 1.5);
          look.set(mx, tall ? 2.6 : 2, mz);
        }
      }
      goal.y = Math.max(0.4, goal.y);
      // Brought in front of any arena rock or wall between the shot and what it looks at, as the normal camera is.
      const awayX = goal.x - look.x;
      const awayZ = goal.z - look.z;
      const flat = Math.hypot(awayX, awayZ);
      if (goal.y < 5 && flat > 2) {
        const clear = Math.max(2, cameraClearance(look.x, look.z, awayX / flat, awayZ / flat, flat));
        if (clear < flat) {
          goal.x = look.x + (awayX / flat) * clear;
          goal.z = look.z + (awayZ / flat) * clear;
        }
      }
      if (this.critCamFresh) {
        this.critCamFresh = false;
        this.critCamPos.copy(goal);
        this.critCamLook.copy(look);
      } else {
        const blend = 1 - Math.exp(-seconds * rate);
        this.critCamPos.lerp(goal, blend);
        this.critCamLook.lerp(look, blend);
      }
    }
    const t = this.critCamWeight;
    const k = t * t * (3 - 2 * t);
    this.camera.position.lerp(this.critCamPos, k);
    this.lookPoint.lerp(this.critCamLook, k);
    this.camera.lookAt(this.lookPoint);
  }

  private startAttack(avatar: Avatar): void {
    if (avatar.trailOn) this.fx.endTrail(avatar.id);
    avatar.trailOn = false;
    avatar.swingStarted = false;
    avatar.impactDone = false;
    const { weapon, x, z } = avatar;
    const hitSeconds = (avatar.model?.attackSeconds ?? weapon.attackSeconds) * weapon.hitAt;
    if (weapon.style === 'heavy') {
      // Starts early so its peak lands on the blow. Fast heavies cut in partway, which sounds fine.
      sound.playGame('wind-heavy', { x, z, delay: Math.max(0, hitSeconds - WIND_LEAD_SECONDS), volume: 0.8 });
    } else if (avatar.isBow) {
      sound.playGame('bow-draw', { x, z });
    }
  }

  /** Runs the moments of a swing off its own animation, so sound and trail match what you see, for everyone. */
  private driveAttack(avatar: Avatar, animation: AnimationId): void {
    const { model, weapon, id, x, z } = avatar;
    if (!model) return;
    const phase = animation === 'attack' ? model.attackPhase() : -1;
    if (phase < 0) {
      if (avatar.trailOn) {
        this.fx.endTrail(id);
        avatar.trailOn = false;
      }
      return;
    }
    const style = weapon.style;
    const seconds = model.attackSeconds;
    const start = weapon.hitAt - TRAIL_LEAD[style] / seconds;
    const end = weapon.hitAt + TRAIL_FOLLOW / seconds;

    const spellPower = weapon.meteor ? SPELL_POWER_METEOR : weapon.crescent ? SPELL_POWER_CRESCENT : SPELL_POWER_BOLT;
    if (style === 'magic' && phase < weapon.hitAt) {
      model.weaponTip(this.tip);
      this.fx.castMagic(this.tip, style, spellPower);
    }
    if (!avatar.swingStarted && phase >= start) {
      avatar.swingStarted = true;
      // A bow's sound is its release, and magic's is its cast. Both belong at the hit moment instead.
      if (style !== 'arrow' && style !== 'magic') sound.swing(style, { x, z });
      if (!avatar.isBow) {
        this.fx.beginTrail(id, style);
        avatar.trailOn = true;
      }
    }
    if (avatar.trailOn) {
      model.weaponTip(this.tip, this.tipBase);
      this.fx.pushTrail(id, this.tip, this.tipBase);
      if (phase >= end) {
        this.fx.endTrail(id);
        avatar.trailOn = false;
      }
    }
    if (!avatar.impactDone && phase >= weapon.hitAt) {
      avatar.impactDone = true;
      if (style === 'arrow') sound.swing(style, { x, z });
      if (style === 'magic') {
        sound.spellCast(weapon.meteor ? 'meteor' : weapon.crescent ? 'crescent' : 'bolt', { x, z });
        model.weaponTip(this.tip);
        this.fx.arcane.release(this.tip, spellPower);
      }
      if (style === 'heavy') {
        const power = WIND_POWER[weapon.label] ?? 1;
        this.tip.set(x + Math.sin(avatar.yaw) * 1.4, 0, z + Math.cos(avatar.yaw) * 1.4);
        this.fx.wind(this.tip, avatar.yaw, power);
      }
    }
  }

  /** A fallen player stays down for a moment, then burns away, and only comes back with the respawn. */
  private driveDeath(avatar: Avatar, deadTime: number, x: number, z: number): void {
    const { model } = avatar;
    if (!model) return;
    if (deadTime > 0 && !avatar.burning && deadTime < BODY_BURN_AT) {
      avatar.burning = true;
      this.fx.deathMist({ x, y: 0, z });
      this.fx.dissolve(model.root, BODY_BURN_SECONDS);
    } else if (deadTime <= 0 && avatar.burning) {
      // Read from the player's state, not the respawn event: that one only reaches people near the bonfire,
      // and anyone else would never see this player's body again.
      avatar.burning = false;
      this.fx.undissolve(model.root);
      model.root.visible = true;
    }
  }

  private flashAvatar(avatar: Avatar): void {
    const { model } = avatar;
    if (!model) return;
    if (!avatar.flashMaterials) {
      const found = new Set<THREE.MeshLambertMaterial>();
      model.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if ((material as THREE.MeshLambertMaterial).emissive) found.add(material as THREE.MeshLambertMaterial);
        }
      });
      avatar.flashMaterials = [...found];
      avatar.flashBases = avatar.flashMaterials.map((material) => material.emissive.clone());
      avatar.flashIntensities = avatar.flashMaterials.map((material) => material.emissiveIntensity);
    }
    avatar.flash = 1;
  }

  private driveFlash(avatar: Avatar, seconds: number): void {
    if (avatar.flash <= 0 || !avatar.flashMaterials) return;
    avatar.flash *= Math.exp(-seconds * FLASH_DECAY);
    if (avatar.flash < 0.01) avatar.flash = 0;
    const amount = avatar.flash;
    avatar.flashMaterials.forEach((material, index) => {
      if (amount === 0) {
        material.emissive.copy(avatar.flashBases[index]);
        material.emissiveIntensity = avatar.flashIntensities[index];
      } else {
        material.emissive.setRGB(1, 0.16, 0.1);
        material.emissiveIntensity = amount * 0.9;
      }
    });
  }

  /** Reduce camera shake turns this off too, as it's for the same people. */
  private rumble(strong: number, weak: number, milliseconds: number): void {
    if (!this.cameraFx.reduceShake) this.pad.rumble(strong, weak, milliseconds);
  }

  private onGameEvents(events: GameEvent[]): void {
    for (const event of events) this.onGameEvent(event);
  }

  private onGameEvent(event: GameEvent): void {
    const myId = this.connection.myId;
    switch (event.k) {
      case 'hit': {
        const mine = event.by === myId;
        const attacker = this.avatars.get(event.by);
        // The way the blow was travelling, which is where the blood goes.
        const dirYaw = attacker ? Math.atan2(event.x - attacker.x, event.z - attacker.z) : 0;
        const height = Math.min(HIT_MAX_HEIGHT, this.creatures.chestHeight(event.c));
        const kind = this.creatures.kindOf(event.c);
        landHit(this.parts, { x: event.x, y: height, z: event.z }, dirYaw, event.style, { kill: event.kill === 1, mine });
        this.creatures.onHit(event.c, event.dmg, dirYaw, mine, event.kill === 1);
        if (mine) {
          if (event.kill === 1) this.rumble(0.7, 0.9, 220);
          else this.rumble(0.25, 0.45, 90);
        }
        // A boss falling is everyone's win, so everyone near it gets the banner.
        if (event.kill === 1 && kind && kind.health >= BANNER_MIN_HEALTH && (mine || kind.behavior === 'boss')) {
          this.callbacks.onBanner('SLAIN', kind.name);
        }
        if (event.kill === 1 && kind?.behavior === 'boss') this.onBossFell(event.c);
        break;
      }
      case 'bossTell': {
        const move = bossMoveName(event.m);
        if (!move) break;
        this.creatures.bossTell(event.c, event.m, event.x, event.z, event.yaw, event.tx, event.tz, event.t);
        this.fx.boss.tell(event.c, move, event.x, event.z, event.yaw, event.tx, event.tz, event.t);
        sound.bossTell(move, { x: event.x, z: event.z });
        break;
      }
      case 'bossHit': {
        const move = bossMoveName(event.m);
        if (!move) break;
        const at = { x: event.x, z: event.z };
        this.creatures.bossHit(event.c, event.m, event.x, event.z, event.yaw);
        this.fx.boss.hit(event.c, move, event.x, event.z, event.yaw, this.creatures.bossSize(event.c));
        if (move === 'swipe') {
          sound.bossSwipe(at);
          this.bossShake(event.x, event.z, 0.25);
        } else if (move === 'charge') {
          // The gallop's rumble is a loop that runs with the charge, from creatures.ts.
          sound.playGame('wind-heavy', { ...at, pitch: 0.5 });
          this.bossShake(event.x, event.z, 0.3);
        } else if (move === 'leap') {
          sound.bossLand(at, 1);
          this.bossShake(event.x, event.z, 1);
        } else if (move === 'fireballs') {
          sound.bossFireLaunch(at);
        } else {
          sound.bossLand(at, 0.8);
          this.bossShake(event.x, event.z, 0.75);
        }
        break;
      }
      case 'bossBreak':
        this.onBossBreak(event.c, event.x, event.z);
        break;
      case 'bossRise':
        this.onBossRise(event.c);
        break;
      case 'crit': {
        // Drawing starts when this player's own snapshot shows the critical, so it lines up with their position.
        const attacker = this.avatars.get(event.by);
        if (attacker) attacker.critBoss = event.c;
        if (event.by === myId) this.rumble(0.3, 0.5, 160);
        break;
      }
      case 'critHit':
        this.onCritHit(event.by, event.c, event.dmg, event.kill === 1);
        break;
      case 'bossShot':
        this.fx.boss.shot(event.id, event.x, event.z, event.yaw, event.speed, event.range, event.r);
        break;
      case 'bossShotEnd':
        this.fx.boss.shotEnd(event.id, event.x, event.z);
        sound.bossFireImpact({ x: event.x, z: event.z });
        break;
      case 'bossDmg': {
        const victim = this.avatars.get(event.v);
        const boss = this.creatures.chestOf(event.c);
        // The way the blow travelled: from the boss to whoever it hit.
        const fromYaw = victim && boss ? Math.atan2(victim.x - boss.x, victim.z - boss.z) : (this.creatures.yawOf(event.c) ?? 0);
        if (victim) {
          this.flashAvatar(victim);
          this.fx.hit({ x: victim.x, y: EFFECT_HEIGHT, z: victim.z }, fromYaw, 'heavy', {});
        }
        if (event.v === myId) {
          const max = this.connection.derived?.maxHealth ?? 100;
          takeHit(this.parts, fromYaw, Math.min(1, event.dmg / max));
          this.rumble(0.9, 0.6, 220);
        } else if (victim) {
          sound.playGame('hit-player', { x: victim.x, z: victim.z, volume: 0.7 });
        }
        break;
      }
      case 'swing':
        // A swing that hit nothing. Its trail, sound and wind already played from the animation.
        break;
      case 'bite': {
        const position = { x: event.x, y: EFFECT_HEIGHT, z: event.z };
        const creatureYaw = this.creatures.yawOf(event.c) ?? 0;
        this.fx.hit(position, creatureYaw, 'blade', {});
        const victim = this.avatars.get(event.v);
        if (victim) this.flashAvatar(victim);
        if (event.v === myId) {
          const max = this.connection.derived?.maxHealth ?? 100;
          takeHit(this.parts, creatureYaw, Math.min(1, event.dmg / max));
          this.rumble(0.8, 0.5, 180);
        } else {
          sound.playGame('hit-player', { x: event.x, z: event.z, volume: 0.7 });
        }
        break;
      }
      case 'shot': {
        if (event.form === 'homing') {
          const shooter = this.avatars.get(event.by)?.model;
          // It should leave the wand, though it flies the server's path from the body.
          if (shooter) shooter.weaponTip(this.tip);
          else this.tip.set(event.x, EFFECT_HEIGHT, event.z);
          this.fx.arcane.bolt(event.id, event.x, event.z, this.tip, event.yaw, event.speed, event.range, event.target ?? 0, event.turn ?? 0);
        } else if (event.form === 'crescent') {
          this.fx.arcane.crescent(event.id, event.x, event.z, event.yaw, event.speed, event.range, event.width ?? 1);
        } else {
          const style = WEAPON_STYLES[event.style] ?? 'arrow';
          this.fx.spawnProjectile(event.id, { x: event.x, y: EFFECT_HEIGHT, z: event.z }, event.yaw, event.speed, event.range, style);
        }
        break;
      }
      case 'meteor': {
        const caster = this.avatars.get(event.by);
        this.fx.arcane.meteorCast(event.id, event.x, event.z, event.delay, event.radius, caster?.x ?? event.x, caster?.z ?? event.z);
        sound.meteorFalling({ x: event.x, z: event.z }, event.delay);
        if (event.by === myId) this.rumble(0.15, 0.3, 140);
        break;
      }
      case 'meteorEnd': {
        const me = this.connection.state;
        const distance = me ? Math.hypot(me.x - event.x, me.z - event.z) : Infinity;
        meteorBlast(this.parts, event.id, event.x, event.z, event.radius, distance, event.by === myId);
        if (distance < event.radius * 4) this.rumble(1, 0.8, 380);
        break;
      }
      case 'shotEnd':
        this.fx.endProjectile(event.id, { x: event.x, y: EFFECT_HEIGHT, z: event.z }, event.hit === 1, event.style);
        // On a hit, the hit event has its own sound. This is the bolt bursting against nothing.
        if (event.hit === 0 && WEAPON_STYLES[event.style] === 'magic') {
          sound.playGame('magic-impact', { x: event.x, z: event.z, volume: 0.6 });
        }
        break;
      case 'dust': {
        const earner = this.avatars.get(event.to);
        const position = { x: event.x, y: 0.8, z: event.z };
        const mine = event.to === myId;
        const count = Math.min(90, 14 + event.n * 8);
        const amount = event.n;
        this.fx.dustBurst(position, count, earner ? earner.collector : null, () => {
          if (mine) {
            sound.playGame('dust-collect');
            this.addShownDust(amount);
          }
        });
        break;
      }
      case 'death':
        this.onPlayerDeath(event.v);
        break;
      case 'respawn':
        this.onPlayerRespawn(event.v);
        break;
      case 'drink': {
        const drinker = this.avatars.get(event.v);
        if (drinker) {
          const at = event.v === myId ? {} : { x: drinker.x, z: drinker.z };
          sound.playGame('potion-drink', at);
          // A warm swell under the gulp, quiet enough that it doesn't read as coming back to life.
          sound.playGame('respawn', { ...at, volume: 0.3 });
        }
        break;
      }
    }
  }

  /** A boss move that shakes the ground. Everyone near feels it, less the further away they are. */
  private bossShake(x: number, z: number, power: number): void {
    const me = this.connection.state;
    if (!me) return;
    const near = Math.max(0, 1 - Math.hypot(me.x - x, me.z - z) / BOSS_FEEL_METERS) * power;
    if (near <= 0.02) return;
    this.cameraFx.shake(0.15 + near * 0.6);
    this.cameraFx.fovKick(near * 2.5);
    this.psx.vhs.glitch(0.15 + near * 0.55);
    this.psx.vhs.echo(near * 0.4);
    this.psx.vhs.impact(near);
    this.rumble(near, near * 0.7, 160 + near * 260);
  }

  /** The boss bar's numbers, checked: a broken entry is ignored rather than drawn. */
  private onBoss(boss: BossSnapshot | undefined): void {
    if (!Array.isArray(boss) || boss.length < 4) return;
    const [id, kindIndex, hp, max, stance, stunLeft] = boss;
    if (!Number.isFinite(id) || !Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return;
    const kind = CREATURES[kindIndex];
    if (!kind) return;
    const now = performance.now();
    let bar = this.bossBar;
    if (!bar || bar.id !== id || (bar.deadAt > 0 && hp > 0)) {
      bar = { id, name: kind.name, hp: max, max, stance: 0, stunLeft: 0, breaks: 0, seenAt: now, deadAt: 0 };
      this.bossBar = bar;
      // The fight is starting: build the shaders a stance break and a critical need now, not mid-fight.
      if (!this.critWarmed) {
        this.critWarmed = true;
        this.critFx.prewarm(this.psx.renderer);
        this.psx.prewarm();
      }
    }
    bar.max = max;
    bar.hp = Math.max(0, Math.min(max, hp));
    bar.stance = Number.isFinite(stance) ? Math.max(0, Math.min(1, stance / 255)) : 0;
    bar.stunLeft = Number.isFinite(stunLeft) ? Math.max(0, Math.min(60, stunLeft / 10)) : 0;
    bar.seenAt = now;
    if (bar.hp === 0 && bar.deadAt === 0) bar.deadAt = now;
    if (bar.deadAt > 0) return;
    // The bar only comes once it has noticed someone, which is when the fight, and its music, begin.
    const me = this.connection.state;
    if (!this.musicOn && me && me.deadTime <= 0) {
      this.musicOn = true;
      sound.preloadGroup('boss');
      bossMusic.begin();
      const at = this.creatures.chestOf(id);
      if (at) sound.playGame('boss-roar', { x: at.x, z: at.z, duck: 0.4 });
    }
    bossMusic.setIntensity(1 - bar.hp / bar.max);
  }

  private bossHud(now: number, myX: number, myZ: number, free: boolean): BossHud | null {
    const bar = this.bossBar;
    if (!bar) return null;
    const since = now - (bar.deadAt > 0 ? bar.deadAt : bar.seenAt);
    if (since > BOSS_BAR_GONE_MS) {
      this.bossBar = null;
      // Gone without a death: you left, it gave up, or it reset. The music fades and the usual comes back.
      if (bar.deadAt === 0 && this.musicOn) {
        this.musicOn = false;
        bossMusic.abandon();
      }
      return null;
    }
    const stunned = bar.stunLeft > 0 && bar.deadAt === 0;
    return {
      name: bar.name,
      share: (bar.hp / bar.max) * 100,
      fading: since > BOSS_BAR_FADE_MS,
      stance: bar.stance * 100,
      stunned,
      stun: stunned ? Math.min(100, (bar.stunLeft / BOSS_STUN_SECONDS) * 100) : 0,
      breaks: bar.breaks,
      critReady: stunned && free && this.critReady(myX, myZ),
    };
  }

  /** True while an attack from here would be a critical: the boss is down and you're by its head. The server decides. */
  private critReady(x: number, z: number): boolean {
    const bar = this.bossBar;
    if (!bar || bar.stunLeft <= 0 || bar.deadAt > 0) return false;
    if (!this.creatures.copyFeet(bar.id, this.critSpot)) return false;
    return inCritWindow(this.critSpot.x, this.critSpot.z, this.creatures.yawOf(bar.id) ?? 0, x, z);
  }

  /** The stance broke: it shatters, the boss collapses, the music drops away and the weak point lights. */
  private onBossBreak(id: number, x: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.creatures.bossBreak(id);
    this.fx.boss.clear(id);
    this.critSpot.x = x;
    this.critSpot.y = 0;
    this.critSpot.z = z;
    this.critFx.bossBreak(this.critSpot, this.creatures.bossSize(id));
    sound.playGame('boss-stance-break', { x, z, duck: 0.8 });
    this.bossShake(x, z, 0.5);
    this.stunLoop?.stop(0.2);
    this.stunLoop = sound.startLoop('boss-stunned-loop', { x, z });
    this.stunnedBoss = id;
    this.stunnedAt = performance.now();
    this.critFx.weakPoint.show(this.weakPointAt);
    if (this.bossBar?.id === id) this.bossBar.breaks += 1;
    if (this.musicOn) bossMusic.stanceBroken();
  }

  private onBossRise(id: number): void {
    // A critical still short of its blow has nothing left to hit.
    for (const avatar of this.avatars.values()) {
      const { crit } = avatar;
      if (crit.on && crit.boss === id && !crit.impactDone && crit.handle >= 0) {
        this.critFx.cancel(crit.handle);
        crit.handle = -1;
      }
    }
    this.creatures.bossRise(id);
    if (this.stunnedBoss === id) this.endStun();
  }

  /** The dazed drone and the weak point go, and the music comes back. */
  private endStun(): void {
    if (this.stunnedBoss === 0) return;
    this.stunnedBoss = 0;
    this.stunLoop?.stop(0.8);
    this.stunLoop = null;
    this.critFx.weakPoint.hide();
    if (this.musicOn) bossMusic.stunOver();
  }

  /** In case the boss's 'bossRise' or death never reaches us, as when it drops out of view. */
  private checkStun(): void {
    const id = this.stunnedBoss;
    if (id === 0) return;
    const bar = this.bossBar;
    const standing = !!bar && bar.id === id && bar.stunLeft <= 0 && performance.now() - this.stunnedAt > 500;
    if (standing || !this.creatures.isLiving(id)) this.endStun();
  }

  /** A critical's blow landed: the number, the music's swell, and for the attacker, the controller and a freeze. */
  private onCritHit(by: number, id: number, damage: number, kill: boolean): void {
    const mine = by === this.connection.myId;
    const attacker = this.avatars.get(by);
    const dirYaw = attacker?.crit.on ? attacker.crit.yaw : (attacker?.yaw ?? 0);
    const dealt = Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0;
    this.creatures.onHit(id, dealt, dirYaw, mine, kill);
    if (this.musicOn) bossMusic.criticalImpact();
    this.critNumber(id, dealt, mine);
    if (mine) {
      this.rumble(1, 1, 520);
      this.cameraFx.hitstop(0.08);
    }
    if (kill) {
      const kind = this.creatures.kindOf(id);
      this.callbacks.onBanner('SLAIN', kind?.name ?? 'The boss');
      this.onBossFell(id);
    }
  }

  /** The boss is dead: everything about its fight ends, and the music plays its victory. */
  private onBossFell(id: number): void {
    if (this.bossBar?.id === id && this.bossBar.deadAt === 0) {
      this.bossBar.hp = 0;
      this.bossBar.deadAt = performance.now();
    }
    if (this.stunnedBoss === id) this.endStun();
    if (this.musicOn) {
      this.musicOn = false;
      bossMusic.victory();
    }
  }

  /** A critical's damage, big and gold over the boss's head. Page text, so it stays sharp above the dither. */
  private critNumber(id: number, damage: number, mine: boolean): void {
    if (damage <= 0 || !this.creatures.copyBossHead(id, this.critSpot)) return;
    this.projected.set(this.critSpot.x, this.critSpot.y + 0.8, this.critSpot.z).project(this.camera);
    if (this.projected.z >= 1) return;
    const element = document.createElement('div');
    element.className = mine ? 'crit-number crit-number--mine' : 'crit-number';
    // A number from the server, and textContent, so nothing can be read as HTML.
    element.textContent = String(damage);
    element.style.left = `${((this.projected.x * 0.5 + 0.5) * this.canvas.clientWidth) | 0}px`;
    element.style.top = `${((-this.projected.y * 0.5 + 0.5) * this.canvas.clientHeight) | 0}px`;
    this.plateLayer.append(element);
    const timer = window.setTimeout(() => {
      element.remove();
      this.critNumbers.delete(timer);
    }, CRIT_NUMBER_MS);
    this.critNumbers.set(timer, element);
  }

  private onPlayerDeath(id: number): void {
    const avatar = this.avatars.get(id);
    if (avatar) this.endCritical(avatar, true);
    if (id === this.connection.myId) {
      // Falling ends the fight for you, and its music. It starts again if you come back to it.
      if (this.musicOn) {
        this.musicOn = false;
        bossMusic.abandon();
      }
      // A freeze or slow motion mustn't carry on into the death screen.
      this.cameraFx.clear();
      this.psx.vhs.glitch(1);
      this.psx.vhs.damageFlash(1);
      sound.playGame('player-death', { duck: 1 });
    } else if (avatar) {
      sound.playGame('player-death', { x: avatar.x, z: avatar.z, volume: 0.6 });
    }
  }

  private onPlayerRespawn(id: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    // Another player is drawn a moment in the past, still at the corpse, so their newest snapshot says where they came back.
    const newest = this.connection.players.get(id)?.frames.at(-1);
    const entry = id === this.connection.myId ? this.connection.state : newest;
    const x = entry ? entry.x : avatar.x;
    const z = entry ? entry.z : avatar.z;
    this.fx.respawn({ x, y: 0, z });
    sound.playGame('respawn', id === this.connection.myId ? {} : { x, z });
  }

  /** The counter climbs as your dust arrives, not when the server says so, or it would give the ending away. */
  private addShownDust(amount: number): void {
    this.shownDust = Math.min(this.serverDust, this.shownDust + amount);
    this.callbacks.onBinaryDust(this.shownDust, true);
  }

  private onSelf(dust: number): void {
    this.serverDust = dust;
    // Spending shows at once. Only dust flying toward you waits for its flight to finish.
    if (dust < this.shownDust) {
      this.shownDust = dust;
      this.callbacks.onBinaryDust(dust, false);
    }
    // Dust whose flight was cut short, or that came from elsewhere, still has to show up.
    window.clearTimeout(this.dustSettleTimer);
    this.dustSettleTimer = window.setTimeout(() => {
      if (this.disposed || this.shownDust === this.serverDust) return;
      this.shownDust = this.serverDust;
      this.callbacks.onBinaryDust(this.shownDust, true);
    }, DUST_SETTLE_MS);
  }

  private onChest(id: number, dust: number, potion: boolean): void {
    this.openedChests.add(id);
    this.world.setChestOpen(id, true, true);
    const position = this.world.chestPosition(id);
    if (position) {
      this.fx.chestOpen({ x: position.x, y: 0, z: position.z });
      sound.playGame('chest-open', position);
      sound.playGame('loot-gold', { ...position, delay: 0.35 });
    }
    // The server's new total comes in its own message just after this one.
    this.serverDust = Math.max(this.serverDust, this.shownDust + dust);
    this.addShownDust(dust);
    this.callbacks.onNotice(potion ? `Found ${dust} Binary Dust and a healing potion` : `Found ${dust} Binary Dust`);
  }

  private onUnlock(achievement: string): void {
    sound.play('unlock');
    const name = ACHIEVEMENT_NAMES[achievement];
    this.callbacks.onNotice(name ? `Achievement earned: ${name}` : 'Achievement earned');
  }

  private onGrace(id: number): void {
    this.litGraces.add(id);
    this.graces.setLit(id, true, true);
    const grace = findGrace(this.world.graces, id);
    if (grace) {
      this.fx.respawn({ x: grace.x, y: 0, z: grace.z });
      this.callbacks.onNotice(`Binary Grace lit: ${grace.name}`);
    }
    sound.play('ignite');
  }

  private onResting(id: number): void {
    const grace = id > 0 ? findGrace(this.world.graces, id) ?? null : null;
    const moved = this.restGrace !== null && grace !== null && grace !== this.restGrace;
    this.restGrace = grace;
    const mine = this.connection.state;
    if (grace && mine) {
      // Standing up should start out from the way the character is sitting.
      this.faceYaw = mine.yaw;
      this.graces.flare(grace.id);
      // Travelling is instant, so the camera goes along with no flight across the map.
      if (moved) {
        this.cameraTarget.set((mine.x + grace.x) / 2, REST_CAMERA_PIVOT, (mine.z + grace.z) / 2);
        this.yaw = wrapAngle(Math.atan2(grace.x - mine.x, grace.z - mine.z) + REST_CAMERA_SIDE);
      } else {
        sound.play('ignite');
      }
    }
    this.callbacks.onRest(grace ? grace.id : 0);
  }

  private onInfo(player: PlayerInfo): void {
    const avatar = this.avatars.get(player.id);
    if (!avatar) return;
    const swingChanged = avatar.info.stats.speed !== player.stats.speed;
    avatar.info = player;
    avatar.plateDetail.textContent = `Level ${player.level} ${findClass(player.classId)?.name ?? ''}`;
    // A model's swing is built for one Speed, and has to match the server's attack timer.
    if (swingChanged) this.loadAvatarModel(player, avatar);
  }

  private onUpgraded(stat: StatKey): void {
    sound.play('confirm');
    const avatar = this.avatars.get(this.connection.myId);
    if (avatar) {
      this.fx.chestOpen(avatar.feet);
      this.callbacks.onNotice(`${STAT_INFO[stat].label} raised to ${avatar.info.stats[stat]}`);
    }
  }

  private onRefused(reason: RefusalReason): void {
    sound.play('error');
    this.callbacks.onNotice(REFUSAL_TEXT[reason]);
  }

  /** What E would do where you're standing. A chest comes first, the same as on the server, which checks it all again. */
  private interactPrompt(x: number, z: number): string | null {
    for (const chest of MAP.chests) {
      if (this.openedChests.has(chest.id)) continue;
      if (Math.hypot(chest.x - x, chest.z - z) <= INTERACT_RANGE) return 'to open';
    }
    for (const grace of this.world.graces) {
      if (Math.hypot(grace.x - x, grace.z - z) <= GRACE_REST_RANGE) return 'to rest';
    }
    return null;
  }

  private driveJump(avatar: Avatar, jumpTime: number, jumpedAgain: boolean, deadTime: number): void {
    const { feet } = avatar;
    const surface = surfaceAt(feet.x, feet.z);
    const landed = avatar.jumpWas > 0 && (jumpTime <= 0 || jumpedAgain);
    if (landed && deadTime <= 0) {
      this.fx.footDust(feet, 'land');
      sound.footstep(surface, { x: feet.x, z: feet.z, running: true });
      sound.playGame('dodge-roll', { x: feet.x, z: feet.z, volume: 0.4 });
    }
    if (jumpTime > 0 && (avatar.jumpWas <= 0 || jumpedAgain)) sound.footstep(surface, { x: feet.x, z: feet.z });
    avatar.jumpWas = jumpTime;
  }

  /** Runs on what everyone's drinkTime says, so other players get the same effect and it stops if the drink is spilled. */
  private driveHeal(avatar: Avatar, drinkTime: number): void {
    const was = avatar.drinkWas;
    if (drinkTime > 0 && was <= 0) this.fx.healStart(avatar.id, avatar.feet);
    if (was > DRINK_HEAL_TIME && drinkTime <= DRINK_HEAL_TIME && drinkTime > 0) this.fx.healPulse(avatar.id, avatar.feet);
    if (drinkTime <= 0 && was > 0) this.fx.healEnd(avatar.id);
    avatar.drinkWas = drinkTime;
  }

  private readonly frame = (time: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const frameSeconds = Math.min(0.1, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;

    // Input and network stay on real time. A hit freeze is only for the eyes.
    const paused = !this.playing;
    this.pad.poll(frameSeconds, paused);
    // Everything the lock needs to let go of it for. Polling above may have just paused the game.
    const mine = this.connection.state;
    if (!this.playing || !mine || mine.deadTime > 0) this.lockOn.release();
    else this.lockOn.update(frameSeconds, mine.x, mine.z);
    const aimAt = this.lockOn.targetCreature;
    if (aimAt !== this.sentAim) {
      this.sentAim = aimAt;
      this.connection.send({ t: 'aim', c: aimAt });
    }

    this.connection.advance(frameSeconds, () => {
      const input = this.readInput(frameSeconds);
      if (paused) {
        input.mx = 0;
        input.mz = 0;
        input.run = false;
      }
      return input;
    });

    const local = this.connection.localPosition();
    if (local) {
      // Sitting, the view drifts to look between you and the grace, and comes down to your height.
      const rest = this.restGrace;
      if (rest) this.pivotGoal.set((local.x + rest.x) / 2, REST_CAMERA_PIVOT, (local.z + rest.z) / 2);
      else this.pivotGoal.set(local.x, CAMERA_PIVOT_HEIGHT + this.bigLock * BIG_LOCK_PIVOT_RAISE, local.z);
      this.cameraTarget.lerp(this.pivotGoal, 1 - Math.exp(-frameSeconds * (rest ? REST_CAMERA_RATE : 14)));
      this.steerCamera(frameSeconds, local.x, local.z);
    }
    this.placeCamera(frameSeconds);
    this.driveCriticalCamera(frameSeconds);
    this.critFx.steerCamera(this.camera);
    const animScale = this.cameraFx.apply(this.camera, frameSeconds);
    this.camera.updateMatrixWorld();
    // Your own critical can slow the world around you. Your own body, the network and input stay on real time.
    const worldScale = this.critFx.wantedTimeScale();
    const animSeconds = frameSeconds * animScale * worldScale;
    const fxSeconds = frameSeconds * this.cameraFx.fxTimeScale * worldScale;

    for (const [id, player] of this.connection.players) {
      const avatar = this.avatars.get(id);
      if (!avatar) continue;
      if (id === this.connection.myId) {
        const state = this.connection.state;
        if (local && state) {
          this.updateAvatar(
            avatar, local.x, local.z, local.yaw, animationFor(state), state.attackCount, state.deadTime,
            state.moving, state.drinkTime, this.connection.localJumpTime(), state.criticalTime,
            animSeconds, fxSeconds, frameSeconds,
          );
        }
      } else {
        this.updateRemote(avatar, player, animSeconds, fxSeconds, frameSeconds);
      }
    }
    this.creatures.update(frameSeconds * worldScale, animSeconds, frameSeconds);
    this.lockOn.placeMarker();

    // After every model has moved, so a critical's beats read this frame's pose.
    this.critFx.update(frameSeconds, fxSeconds);
    if (this.bossBar) {
      const bossYaw = this.creatures.yawOf(this.bossBar.id);
      if (bossYaw !== null) this.fx.boss.aim(this.bossBar.id, bossYaw);
    }
    this.fx.update(fxSeconds);
    this.graces.update(frameSeconds, local ? local.x : this.cameraTarget.x, local ? local.z : this.cameraTarget.z);
    sound.setListener(this.camera.position.x, this.camera.position.z, this.yaw);
    if (local) this.lantern.position.set(local.x, LANTERN_HEIGHT, local.z);
    if (local) this.world.update(local.x, local.z);
    else this.world.update();
    this.psx.impact.update(frameSeconds);
    this.psx.render(this.world.scene, this.camera);

    if (time - this.lastHud > HUD_INTERVAL_MS) {
      this.lastHud = time;
      const { state, derived, players, pingMs } = this.connection;
      this.checkStun();
      if (state && derived) {
        this.callbacks.onHud({
          health: state.health,
          maxHealth: derived.maxHealth,
          magic: state.magic,
          maxMagic: derived.maxMagic,
          stamina: state.stamina,
          maxStamina: derived.maxStamina,
          potions: state.potions,
          online: players.size,
          ping: Math.round(pingMs),
          names: [...players.values()].map((player) => player.info.username),
          deadSeconds: state.deadTime,
          prompt: state.deadTime > 0 || state.resting > 0 ? null : this.interactPrompt(state.x, state.z),
          me: players.get(this.connection.myId)?.info ?? null,
          dust: this.serverDust,
          graces: [...this.litGraces],
          boss: this.bossHud(performance.now(), state.x, state.z, state.deadTime <= 0 && state.criticalTime <= 0),
        });
      }
    }
  };

  private updateRemote(avatar: Avatar, player: NetPlayer, animSeconds: number, fxSeconds: number, realSeconds: number): void {
    const frame = this.connection.remoteFrame(player);
    if (!frame) return;
    this.updateAvatar(
      avatar, frame.x, frame.z, frame.yaw, animationFor(frame), frame.attackCount, frame.deadTime,
      frame.moving, frame.drinkTime, frame.jumpTime, frame.criticalTime,
      animSeconds, fxSeconds, realSeconds,
    );
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.dustSettleTimer);
    this.lockOn.dispose();
    this.graces.dispose();
    this.pad.dispose();
    this.connection.dispose();
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    for (const [timer, element] of this.critNumbers) {
      window.clearTimeout(timer);
      element.remove();
    }
    this.critNumbers.clear();
    this.stunLoop = null;
    sound.stopLoops();
    bossMusic.dispose();
    this.musicOn = false;
    this.critFx.dispose();
    this.creatures.dispose();
    this.fx.dispose();
    this.world.dispose();
    releaseSharedAssets();
    this.psx.dispose();
  }
}
