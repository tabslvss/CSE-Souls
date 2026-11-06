import * as THREE from 'three';
import type { PlayerInfo } from '../../../shared/protocol';
import { animationFor, type SimInput } from '../../../shared/sim';
import { findClass } from '../../../shared/classes';
import { createCharacter, releaseSharedAssets, type CharacterModel } from './characters';
import { GameConnection, type ConnectionStatus, type NetPlayer } from './net';
import { PsxRenderer } from './psxRenderer';
import { createWorld } from './world';

const MOUSE_SENSITIVITY = 0.0023;
const MIN_PITCH = -0.15;
const MAX_PITCH = 1.05;
const MIN_DISTANCE = 2.6;
const MAX_DISTANCE = 9;
const TURN_SPEED = 13;
const NAMEPLATE_HEIGHT = 1.98;
const NAMEPLATE_MAX_DISTANCE = 45;
const HUD_INTERVAL_MS = 100;
const MODEL_RETRY_MS = 3000;

export interface HudState {
  stamina: number;
  maxStamina: number;
  maxHealth: number;
  online: number;
  ping: number;
  names: string[];
}

export interface GameCallbacks {
  onStatus: (status: ConnectionStatus) => void;
  onHud: (hud: HudState) => void;
  onPointerLock: (locked: boolean) => void;
  onBinaryDust: (amount: number) => void;
}

interface Avatar {
  model: CharacterModel | null;
  plate: HTMLDivElement;
  lastAttackCount: number;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
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
  private frameId = 0;
  private lastTime = 0;
  private lastHud = 0;
  private yaw = 0;
  private pitch = 0.32;
  private distance = 5;
  private faceYaw = 0;
  private dodgeQueued = false;
  private attackQueued = false;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly plateLayer: HTMLElement,
    private readonly callbacks: GameCallbacks,
  ) {
    this.psx = new PsxRenderer(canvas);
    this.connection = new GameConnection({
      onStatus: callbacks.onStatus,
      onWelcome: (myId, players, dust) => this.onWelcome(myId, players, dust),
      onJoin: (player) => this.addAvatar(player),
      onLeave: (id) => this.removeAvatar(id),
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
    // Browsers refuse this for a moment after Esc. The game just stays paused until the next click.
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => undefined);
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.psx.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    this.keys.add(event.code);
    if (event.code === 'Space') {
      this.dodgeQueued = true;
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = () => {
    this.keys.clear();
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * MOUSE_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + event.movementY * MOUSE_SENSITIVITY, MIN_PITCH, MAX_PITCH);
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) {
      this.requestPointerLock();
    } else if (event.button === 0) {
      this.attackQueued = true;
    }
  };

  private readonly onWheel = (event: WheelEvent) => {
    this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.005, MIN_DISTANCE, MAX_DISTANCE);
  };

  private readonly onPointerLockChange = () => {
    this.callbacks.onPointerLock(document.pointerLockElement === this.canvas);
  };

  private onWelcome(myId: number, players: PlayerInfo[], dust: number): void {
    // Ids restart when the server does, so an old id may now belong to someone else entirely.
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    for (const player of players) this.addAvatar(player);
    const mine = this.connection.state;
    if (mine) {
      // Start out looking the way the character faces, toward the middle of the map.
      this.faceYaw = Math.atan2(-mine.x, -mine.z);
      this.yaw = this.faceYaw;
      this.cameraTarget.set(mine.x, 1.3, mine.z);
    }
    this.avatars.get(myId)?.plate.classList.add('nameplate--self');
    this.callbacks.onBinaryDust(dust);
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

    const avatar: Avatar = { model: null, plate, lastAttackCount: 0 };
    this.avatars.set(player.id, avatar);
    this.loadAvatarModel(player, avatar);
  }

  private loadAvatarModel(player: PlayerInfo, avatar: Avatar): void {
    createCharacter(player.classId, player.appearance).then(
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
    if (avatar.model) {
      this.world.scene.remove(avatar.model.root);
      avatar.model.dispose();
    }
    this.avatars.delete(id);
  }

  private readInput(frameSeconds: number): Omit<SimInput, 'seq'> {
    const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const mx = forward * sin - strafe * cos;
    const mz = forward * cos + strafe * sin;

    const attack = this.attackQueued;
    let targetYaw = this.faceYaw;
    if (attack) targetYaw = wrapAngle(this.yaw);
    else if (mx !== 0 || mz !== 0) targetYaw = Math.atan2(mx, mz);
    const delta = wrapAngle(targetYaw - this.faceYaw);
    this.faceYaw = wrapAngle(this.faceYaw + delta * Math.min(1, TURN_SPEED * frameSeconds));
    if (attack) this.faceYaw = targetYaw;

    const input = {
      mx,
      mz,
      yaw: this.faceYaw,
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      dodge: this.dodgeQueued,
      attack,
      potion: false,
    };
    this.dodgeQueued = false;
    this.attackQueued = false;
    return input;
  }

  private updateAvatar(
    avatar: Avatar,
    x: number,
    z: number,
    yaw: number,
    animation: ReturnType<typeof animationFor>,
    attackCount: number,
    frameSeconds: number,
  ): void {
    if (avatar.model) {
      avatar.model.root.position.set(x, 0, z);
      avatar.model.root.rotation.y = yaw;
      const restart = attackCount !== avatar.lastAttackCount;
      avatar.lastAttackCount = attackCount;
      avatar.model.play(animation, restart);
      avatar.model.update(frameSeconds);
    }

    // Nameplates are real page text, so they stay sharp above the low-res picture.
    this.projected.set(x, NAMEPLATE_HEIGHT, z).project(this.camera);
    const distance = this.camera.position.distanceTo(new THREE.Vector3(x, NAMEPLATE_HEIGHT, z));
    const visible = this.projected.z < 1 && distance < NAMEPLATE_MAX_DISTANCE;
    avatar.plate.style.display = visible ? 'flex' : 'none';
    if (visible) {
      const left = (this.projected.x * 0.5 + 0.5) * this.canvas.clientWidth;
      const top = (-this.projected.y * 0.5 + 0.5) * this.canvas.clientHeight;
      avatar.plate.style.transform = `translate(-50%, -100%) translate(${left | 0}px, ${top | 0}px)`;
      avatar.plate.style.opacity = String(Math.min(1, (NAMEPLATE_MAX_DISTANCE - distance) / 12));
    }
  }

  private readonly frame = (time: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const frameSeconds = Math.min(0.1, (time - this.lastTime) / 1000 || 0);
    this.lastTime = time;

    this.connection.advance(frameSeconds, () => this.readInput(frameSeconds));

    const local = this.connection.localPosition();
    if (local) {
      this.cameraTarget.lerp(
        new THREE.Vector3(local.x, 1.3, local.z),
        1 - Math.exp(-frameSeconds * 14),
      );
    }
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.cameraTarget.x - Math.sin(this.yaw) * horizontal,
      Math.max(0.25, this.cameraTarget.y + Math.sin(this.pitch) * this.distance),
      this.cameraTarget.z - Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateMatrixWorld();

    for (const [id, player] of this.connection.players) {
      const avatar = this.avatars.get(id);
      if (!avatar) continue;
      if (id === this.connection.myId) {
        const state = this.connection.state;
        if (local && state) {
          this.updateAvatar(avatar, local.x, local.z, local.yaw, animationFor(state), state.attackCount, frameSeconds);
        }
      } else {
        this.updateRemote(avatar, player, frameSeconds);
      }
    }

    this.world.update();
    this.psx.render(this.world.scene, this.camera);

    if (time - this.lastHud > HUD_INTERVAL_MS) {
      this.lastHud = time;
      const { state, derived, players, pingMs } = this.connection;
      if (state && derived) {
        this.callbacks.onHud({
          stamina: state.stamina,
          maxStamina: derived.maxStamina,
          maxHealth: derived.maxHealth,
          online: players.size,
          ping: Math.round(pingMs),
          names: [...players.values()].map((player) => player.info.username),
        });
      }
    }
  };

  private updateRemote(avatar: Avatar, player: NetPlayer, frameSeconds: number): void {
    const frame = this.connection.remoteFrame(player);
    if (!frame) return;
    this.updateAvatar(avatar, frame.x, frame.z, frame.yaw, animationFor(frame), frame.attackCount, frameSeconds);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
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
    this.world.dispose();
    releaseSharedAssets();
    this.psx.dispose();
  }
}
