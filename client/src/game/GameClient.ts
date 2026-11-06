import * as THREE from 'three';
import { findClass } from '../../../shared/classes';
import { collide } from '../../../shared/collision';
import { INTERACT_RANGE, WEAPON_STYLES, weaponFor, type WeaponStats, type WeaponStyle } from '../../../shared/combat';
import { MAP } from '../../../shared/mapData';
import type { CreatureSnapshot, GameEvent, PlayerInfo } from '../../../shared/protocol';
import { DRINK_HEAL_TIME, JUMP_SECONDS, animationFor, jumpHeight, type AnimationId } from '../../../shared/sim';
import { sound, type FootSurface } from '../sound';
import { ARMORY } from './armory';
import { createCharacter, releaseSharedAssets, type CharacterModel } from './characters';
import { CreatureField } from './creatures';
import { CameraFx } from './fx/camera';
import { GameFx } from './fx/effects';
import { FootTrail, landHit, takeHit, type FeelParts, type MoveKind } from './fx/feel';
import { GamepadInput, type MenuNav, type PadAction } from './gamepad';
import { LockOn } from './lockOn';
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
const NAMEPLATE_HEIGHT = 1.98;
const NAMEPLATE_MAX_DISTANCE = 45;
const HUD_INTERVAL_MS = 100;
const MODEL_RETRY_MS = 3000;
const EFFECT_HEIGHT = 1.2;

/** The camera stops this far short of a wall, and looks for walls this wide around its path. */
const CAMERA_PROBE_RADIUS = 0.35;
const CAMERA_PROBE_STEP = 0.3;
const CAMERA_CLOSEST = 0.9;
const CAMERA_EASE_OUT = 3.5;

/** Seconds from the blow's start of the part of a swing that draws a trail, around the hit moment. */
const TRAIL_LEAD: Record<WeaponStyle, number> = { heavy: 0.2, blade: 0.13, thrust: 0.12, magic: 0.14, arrow: 0 };
const TRAIL_FOLLOW = 0.09;
/** The heavy sound is a long rush of air that should peak as the weapon lands. */
const WIND_LEAD_SECONDS = 0.8;
const WIND_POWER: Partial<Record<string, number>> = { 'War hammer': 1.4, 'Double axe': 1.2, Zweihander: 1.2, 'Mace and shield': 0.7 };
/** Only bosses and tough enemies get the banner, so it stays special. Normal animals don't. */
const BANNER_MIN_HEALTH = 200;
/** How long your dust may stay out of the counter, if its flight is ever cut short. */
const DUST_SETTLE_MS = 2500;
/** Your body burns away with this much of the wait left, so that it's gone just before the respawn. */
const BODY_BURN_AT = 2.4;
const BODY_BURN_SECONDS = 1.7;
const STONE_ZONES = new Set(['Fallen Citadel', 'Throne of Ash', 'Sunken Graveyard']);
const FLASH_DECAY = 10;
/** A faint light carried with you, so that you and what's biting you can still be seen in a dark forest. */
const LANTERN_COLOR = 0xffdcb0;
const LANTERN_POWER = 9;
const LANTERN_RANGE = 18;
const LANTERN_HEIGHT = 3;

const ACHIEVEMENT_NAMES: Record<string, string> = { first_blood: 'First Blood', beast_hunter: 'Beast Hunter' };

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
  /** A controller moving around the pause menu. */
  onMenu: (nav: MenuNav) => void;
}

interface Avatar {
  id: number;
  info: PlayerInfo;
  model: CharacterModel | null;
  plate: HTMLDivElement;
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

function surfaceAt(x: number, z: number): FootSurface {
  for (const zone of MAP.zones) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      return STONE_ZONES.has(zone.name) ? 'stone' : 'dirt';
    }
  }
  return 'dirt';
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
  private readonly lantern = new THREE.PointLight(LANTERN_COLOR, LANTERN_POWER, LANTERN_RANGE, 1.5);
  private readonly lockOn: LockOn;
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
    this.world.scene.add(this.lantern);
    this.lockOn = new LockOn(this.world.scene, this.camera, this.creatures);
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
      onWelcome: (myId, players, dust, chests) => this.onWelcome(myId, players, dust, chests),
      onJoin: (player) => this.addAvatar(player),
      onLeave: (id) => this.removeAvatar(id),
      onCreatures: (list: CreatureSnapshot[]) => this.creatures.applySnapshot(list),
      onGameEvents: (events) => this.onGameEvents(events),
      onSelf: (dust) => this.onSelf(dust),
      onChest: (id, dust, potion) => this.onChest(id, dust, potion),
      onUnlock: (achievement) => this.onUnlock(achievement),
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

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    this.keys.add(event.code);
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

  private onWelcome(myId: number, players: PlayerInfo[], dust: number, chests: number[]): void {
    // Ids restart when the server does, so an old id may now belong to someone else entirely.
    this.lockOn.release();
    this.recentering = false;
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
    const avatar: Avatar = {
      id: player.id,
      info: player,
      model: null,
      plate,
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
    };
    this.avatars.set(player.id, avatar);
    this.loadAvatarModel(player, avatar);
  }

  private loadAvatarModel(player: PlayerInfo, avatar: Avatar): void {
    // The real stats, so the swing lasts exactly as long as the server's attack timer.
    createCharacter(player.classId, player.appearance, player.stats).then(
      (model) => {
        if (this.disposed || this.avatars.get(player.id) !== avatar) {
          model.dispose();
          return;
        }
        avatar.model = model;
        this.world.scene.add(model.root);
      },
      () => {
        // A failed download shouldn't leave this player invisible, so it tries again.
        window.setTimeout(() => {
          if (!this.disposed && this.avatars.get(player.id) === avatar) this.loadAvatarModel(player, avatar);
        }, MODEL_RETRY_MS);
      },
    );
  }

  private removeAvatar(id: number): void {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    avatar.plate.remove();
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
    // While locked, forward means toward the target and sideways circles around it.
    const aimYaw = state ? this.lockOn.aimYaw(state.x, state.z) : null;
    const moveYaw = aimYaw ?? this.yaw;
    const sin = Math.sin(moveYaw);
    const cos = Math.cos(moveYaw);
    const mx = forward * sin - strafe * cos;
    const mz = forward * cos + strafe * sin;

    const attack = this.attackQueued;
    // Until the blow lands you can still steer it with the mouse, or a moving wolf could never be hit.
    const windingUp = !!state && !!derived && state.attackTime > derived.attackSeconds * (1 - derived.hitAt);
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.pad.run;
    const runningFree = run && (mx !== 0 || mz !== 0);
    let targetYaw = this.faceYaw;
    if (aimYaw !== null && (attack || windingUp || !runningFree)) targetYaw = aimYaw;
    else if (attack || windingUp) targetYaw = wrapAngle(this.yaw);
    else if (mx !== 0 || mz !== 0) targetYaw = Math.atan2(mx, mz);
    const delta = wrapAngle(targetYaw - this.faceYaw);
    this.faceYaw = wrapAngle(this.faceYaw + delta * Math.min(1, TURN_SPEED * frameSeconds));
    if (attack) this.faceYaw = targetYaw;

    const input: FrameInput = {
      mx,
      mz,
      yaw: this.faceYaw,
      run,
      dodge: this.dodgeQueued,
      attack,
      potion: this.potionQueued,
      jump: this.jumpQueued,
      interact: this.interactQueued,
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
    if (aim) {
      this.recentering = false;
      const dx = aim.x - playerX;
      const dz = aim.z - playerZ;
      const distance = Math.hypot(dx, dz);
      const blend = 1 - Math.exp(-seconds * LOCK_TURN_RATE);
      if (distance > LOCK_MIN_DISTANCE) this.yaw = wrapAngle(this.yaw + wrapAngle(Math.atan2(dx, dz) - this.yaw) * blend);
      const tilt = LOCK_PITCH + Math.atan2(CAMERA_PIVOT_HEIGHT - aim.y, Math.max(distance, LOCK_MIN_DISTANCE)) * LOCK_PITCH_FOLLOW;
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
    const raise = aim ? THREE.MathUtils.clamp((aim.y - CAMERA_PIVOT_HEIGHT) * LOOK_RAISE_SHARE, 0, LOOK_RAISE_MAX) : 0;
    this.lookRaise += (raise - this.lookRaise) * (1 - Math.exp(-seconds * LOOK_RAISE_RATE));
  }

  /** Stops short of walls and trunks, so the view never ends up inside one. Works on the same grid as movement. */
  private placeCamera(seconds: number): void {
    const horizontal = Math.cos(this.pitch);
    const directionX = -Math.sin(this.yaw);
    const directionZ = -Math.cos(this.yaw);
    const wanted = this.distance;
    let clear = wanted;
    const probe = { x: 0, z: 0 };
    for (let along = CAMERA_PROBE_STEP; along < wanted + CAMERA_PROBE_STEP; along += CAMERA_PROBE_STEP) {
      probe.x = this.cameraTarget.x + directionX * along * horizontal;
      probe.z = this.cameraTarget.z + directionZ * along * horizontal;
      const startX = probe.x;
      const startZ = probe.z;
      collide(probe, CAMERA_PROBE_RADIUS);
      if (probe.x !== startX || probe.z !== startZ) {
        clear = Math.max(CAMERA_CLOSEST, along - CAMERA_PROBE_STEP);
        break;
      }
    }
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
    animSeconds: number,
    fxSeconds: number,
    realSeconds: number,
  ): void {
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
      avatar.model.root.position.set(x, height, z);
      avatar.model.root.rotation.y = yaw;
      const restart = avatar.lastAttackCount >= 0 && attackCount !== avatar.lastAttackCount && animation === 'attack';
      avatar.lastAttackCount = attackCount;
      avatar.model.play(animation, restart || (jumpedAgain && animation === 'jump'));
      avatar.model.setDrinkWalking(moving > 0);
      if (restart) this.startAttack(avatar);
      avatar.model.update(animSeconds);
      this.driveAttack(avatar, animation);
      this.driveDeath(avatar, deadTime, x, z);
      this.driveFlash(avatar, realSeconds);
    }
    avatar.trail.update(fxSeconds, avatar.feet, moveKindFor(animation), surfaceAt(x, z));
    this.driveJump(avatar, jumpTime, jumpedAgain, deadTime);
    this.driveHeal(avatar, drinkTime);

    // Nameplates are real page text, so they stay sharp above the low-res picture.
    this.projected.set(x, NAMEPLATE_HEIGHT + height, z).project(this.camera);
    const distance = this.camera.position.distanceTo(new THREE.Vector3(x, NAMEPLATE_HEIGHT + height, z));
    const visible = this.projected.z < 1 && distance < NAMEPLATE_MAX_DISTANCE;
    avatar.plate.style.display = visible ? 'flex' : 'none';
    if (visible) {
      const left = (this.projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
      const top = (-this.projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
      avatar.plate.style.transform = `translate(-50%, -100%) translate(${left | 0}px, ${top | 0}px)`;
      avatar.plate.style.opacity = String(Math.min(1, (NAMEPLATE_MAX_DISTANCE - distance) / 12));
    }
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

    if (style === 'magic' && phase < weapon.hitAt) {
      model.weaponTip(this.tip);
      this.fx.castMagic(this.tip, style);
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
      if (style === 'arrow' || style === 'magic') sound.swing(style, { x, z });
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
        const height = this.creatures.chestHeight(event.c);
        const kind = this.creatures.kindOf(event.c);
        landHit(this.parts, { x: event.x, y: height, z: event.z }, dirYaw, event.style, { kill: event.kill === 1, mine });
        this.creatures.onHit(event.c, event.dmg, dirYaw, mine, event.kill === 1);
        if (mine) {
          if (event.kill === 1) this.rumble(0.7, 0.9, 220);
          else this.rumble(0.25, 0.45, 90);
        }
        if (mine && event.kill === 1 && kind && kind.health >= BANNER_MIN_HEALTH) {
          this.callbacks.onBanner('SLAIN', kind.name);
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
        const style = WEAPON_STYLES[event.style] ?? 'arrow';
        this.fx.spawnProjectile(event.id, { x: event.x, y: EFFECT_HEIGHT, z: event.z }, event.yaw, event.speed, event.range, style);
        break;
      }
      case 'shotEnd':
        this.fx.endProjectile(event.id, { x: event.x, y: EFFECT_HEIGHT, z: event.z }, event.hit === 1, event.splash);
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

  private onPlayerDeath(id: number): void {
    const avatar = this.avatars.get(id);
    if (id === this.connection.myId) {
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

  /** The chest you're close enough to open, if any. The server checks this again for itself. */
  private chestPrompt(x: number, z: number): string | null {
    for (const chest of MAP.chests) {
      if (this.openedChests.has(chest.id)) continue;
      if (Math.hypot(chest.x - x, chest.z - z) <= INTERACT_RANGE) return 'to open';
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
      this.cameraTarget.lerp(
        new THREE.Vector3(local.x, CAMERA_PIVOT_HEIGHT, local.z),
        1 - Math.exp(-frameSeconds * 14),
      );
      this.steerCamera(frameSeconds, local.x, local.z);
    }
    this.placeCamera(frameSeconds);
    const animScale = this.cameraFx.apply(this.camera, frameSeconds);
    this.camera.updateMatrixWorld();
    const animSeconds = frameSeconds * animScale;
    const fxSeconds = frameSeconds * this.cameraFx.fxTimeScale;

    for (const [id, player] of this.connection.players) {
      const avatar = this.avatars.get(id);
      if (!avatar) continue;
      if (id === this.connection.myId) {
        const state = this.connection.state;
        if (local && state) {
          this.updateAvatar(
            avatar, local.x, local.z, local.yaw, animationFor(state), state.attackCount, state.deadTime,
            state.moving, state.drinkTime, this.connection.localJumpTime(),
            animSeconds, fxSeconds, frameSeconds,
          );
        }
      } else {
        this.updateRemote(avatar, player, animSeconds, fxSeconds, frameSeconds);
      }
    }
    this.creatures.update(frameSeconds, animSeconds);
    this.lockOn.placeMarker();

    this.fx.update(fxSeconds);
    sound.setListener(this.camera.position.x, this.camera.position.z, this.yaw);
    if (local) this.lantern.position.set(local.x, LANTERN_HEIGHT, local.z);
    if (local) this.world.update(local.x, local.z);
    else this.world.update();
    this.psx.render(this.world.scene, this.camera);

    if (time - this.lastHud > HUD_INTERVAL_MS) {
      this.lastHud = time;
      const { state, derived, players, pingMs } = this.connection;
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
          prompt: state.deadTime > 0 ? null : this.chestPrompt(state.x, state.z),
        });
      }
    }
  };

  private updateRemote(avatar: Avatar, player: NetPlayer, animSeconds: number, fxSeconds: number, realSeconds: number): void {
    const frame = this.connection.remoteFrame(player);
    if (!frame) return;
    this.updateAvatar(
      avatar, frame.x, frame.z, frame.yaw, animationFor(frame), frame.attackCount, frame.deadTime,
      frame.moving, frame.drinkTime, frame.jumpTime,
      animSeconds, fxSeconds, realSeconds,
    );
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.dustSettleTimer);
    this.lockOn.dispose();
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
    this.creatures.dispose();
    this.fx.dispose();
    this.world.dispose();
    releaseSharedAssets();
    this.psx.dispose();
  }
}
