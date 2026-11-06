import * as THREE from 'three';
import { segmentBlocked } from '../../../shared/collision';

/**
 * Lock-on is only ever about aiming on this computer. The server still receives nothing but a facing and
 * a movement direction, so it gives no one an advantage the mouse couldn't.
 */

/** How far away a target can be picked, and how far it can get before the lock lets go. */
const ACQUIRE_RANGE = 25;
const RELEASE_RANGE = 30;
/** Half of the width of the cone in front of the camera. */
const ACQUIRE_CONE_COS = Math.cos(THREE.MathUtils.degToRad(50));
/** Picking cares a bit more about the middle of the screen than about being close. */
const SCORE_CENTER = 0.6;
const SCORE_DISTANCE = 0.4;
const SIGHT_CHECK_SECONDS = 0.2;
const OUT_OF_SIGHT_SECONDS = 2;
const FLICK_PIXELS = 70;
const FLICK_DECAY = 10;
const FLICK_COOLDOWN = 0.35;
/** Another target must be within about 60 degrees of the direction of the flick. */
const FLICK_MIN_ALIGNMENT = 0.5;
const SCREEN_EDGE = 1.3;
/** Standing nearly on top of the target, its direction would spin wildly. */
const TOO_CLOSE = 0.4;
const MARKER_COLOR = 0xf4e6bf;
const MARKER_OPACITY = 0.85;
const MARKER_SIZE = 0.014;
const MARKER_MIN_SIZE = 0.07;

export interface LockTarget {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface LockSource {
  /** Every creature alive right now. */
  livingTargets(): LockTarget[];
  /** Writes where this creature's chest is. False if it's dead or gone. */
  copyLivingChest(id: number, out: THREE.Vector3): boolean;
}

export class LockOn {
  private readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly chest = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly screen = new THREE.Vector3();
  private targetId: number | null = null;
  private playerX = 0;
  private playerZ = 0;
  private sightWait = 0;
  private unseen = 0;
  private flickX = 0;
  private flickY = 0;
  private cooldown = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly source: LockSource,
  ) {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1, 24),
      new THREE.MeshBasicMaterial({
        color: MARKER_COLOR,
        transparent: true,
        opacity: MARKER_OPACITY,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.marker.renderOrder = 999;
    this.marker.frustumCulled = false;
  }

  get locked(): boolean {
    return this.targetId !== null;
  }

  /** Where the target's chest is, or null with no target. */
  get aim(): THREE.Vector3 | null {
    return this.targetId === null ? null : this.chest;
  }

  /** The facing from this spot toward the target, or null if there's none to go by. */
  aimYaw(fromX: number, fromZ: number): number | null {
    if (this.targetId === null) return null;
    const dx = this.chest.x - fromX;
    const dz = this.chest.z - fromZ;
    if (Math.hypot(dx, dz) < TOO_CLOSE) return null;
    return Math.atan2(dx, dz);
  }

  /** Picks the best creature. False if none qualifies. */
  acquire(playerX: number, playerZ: number): boolean {
    this.playerX = playerX;
    this.playerZ = playerZ;
    this.camera.getWorldDirection(this.forward);
    const scored: Array<{ target: LockTarget; score: number }> = [];
    for (const target of this.source.livingTargets()) {
      const distance = Math.hypot(target.x - playerX, target.z - playerZ);
      if (distance > ACQUIRE_RANGE) continue;
      this.toTarget.set(target.x, target.y, target.z).sub(this.camera.position).normalize();
      if (this.toTarget.dot(this.forward) < ACQUIRE_CONE_COS) continue;
      this.screen.set(target.x, target.y, target.z).project(this.camera);
      const center = Math.hypot(this.screen.x, this.screen.y);
      scored.push({ target, score: center * SCORE_CENTER + (distance / ACQUIRE_RANGE) * SCORE_DISTANCE });
    }
    return this.lockBest(scored);
  }

  /** Mouse movement while locked. Enough of it, quickly enough, is a flick. x is right and y is down. */
  addMouseFlick(x: number, y: number): void {
    this.flickX += x;
    this.flickY += y;
    if (Math.hypot(this.flickX, this.flickY) < FLICK_PIXELS) return;
    this.flick(this.flickX, this.flickY);
    this.flickX = 0;
    this.flickY = 0;
  }

  /** Moves the lock to the next creature in this direction on screen. x is right and y is down. */
  flick(x: number, y: number): void {
    if (this.targetId === null || this.cooldown > 0) return;
    const size = Math.hypot(x, y);
    if (size === 0) return;
    this.cooldown = FLICK_COOLDOWN;
    const directionX = x / size;
    // The screen's y points up here.
    const directionY = -y / size;
    this.screen.copy(this.chest).project(this.camera);
    const fromX = this.screen.x;
    const fromY = this.screen.y;
    const scored: Array<{ target: LockTarget; score: number }> = [];
    for (const target of this.source.livingTargets()) {
      if (target.id === this.targetId) continue;
      if (Math.hypot(target.x - this.playerX, target.z - this.playerZ) > ACQUIRE_RANGE) continue;
      this.screen.set(target.x, target.y, target.z).project(this.camera);
      if (this.screen.z > 1 || Math.abs(this.screen.x) > SCREEN_EDGE || Math.abs(this.screen.y) > SCREEN_EDGE) continue;
      const offsetX = this.screen.x - fromX;
      const offsetY = this.screen.y - fromY;
      const gap = Math.hypot(offsetX, offsetY);
      if (gap < 0.001) continue;
      const alignment = (offsetX * directionX + offsetY * directionY) / gap;
      if (alignment < FLICK_MIN_ALIGNMENT) continue;
      scored.push({ target, score: gap / alignment });
    }
    this.lockBest(scored);
  }

  /** Call once per frame, before the camera moves. Lets go by itself when the target can't be followed. */
  update(seconds: number, playerX: number, playerZ: number): void {
    this.playerX = playerX;
    this.playerZ = playerZ;
    this.cooldown = Math.max(0, this.cooldown - seconds);
    const decay = Math.exp(-seconds * FLICK_DECAY);
    this.flickX *= decay;
    this.flickY *= decay;
    if (this.targetId === null) return;
    if (!this.source.copyLivingChest(this.targetId, this.chest)) {
      this.release();
      return;
    }
    if (Math.hypot(this.chest.x - playerX, this.chest.z - playerZ) > RELEASE_RANGE) {
      this.release();
      return;
    }
    this.sightWait -= seconds;
    if (this.sightWait <= 0) {
      // The elapsed time is added all at once, so it's right no matter how long the frames were.
      const elapsed = SIGHT_CHECK_SECONDS - this.sightWait;
      this.sightWait = SIGHT_CHECK_SECONDS;
      this.unseen = segmentBlocked(playerX, playerZ, this.chest.x, this.chest.z) ? this.unseen + elapsed : 0;
      if (this.unseen >= OUT_OF_SIGHT_SECONDS) this.release();
    }
  }

  /** Call once per frame, after the camera and the creatures have moved. */
  placeMarker(): void {
    if (this.targetId === null) return;
    if (!this.source.copyLivingChest(this.targetId, this.chest)) return;
    this.marker.position.copy(this.chest);
    this.marker.quaternion.copy(this.camera.quaternion);
    const size = Math.max(MARKER_MIN_SIZE, this.camera.position.distanceTo(this.chest) * MARKER_SIZE);
    this.marker.scale.setScalar(size);
  }

  /** Takes off the marker and forgets the target. The camera eases back by itself as it stops being steered. */
  release(): void {
    this.targetId = null;
    this.unseen = 0;
    this.flickX = 0;
    this.flickY = 0;
    this.scene.remove(this.marker);
  }

  dispose(): void {
    this.release();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
  }

  /** The lowest score that can be seen. Sight is the costly check, so it goes in order and stops at the first. */
  private lockBest(scored: Array<{ target: LockTarget; score: number }>): boolean {
    scored.sort((a, b) => a.score - b.score);
    for (const { target } of scored) {
      if (segmentBlocked(this.playerX, this.playerZ, target.x, target.z)) continue;
      this.targetId = target.id;
      this.chest.set(target.x, target.y, target.z);
      this.unseen = 0;
      this.sightWait = SIGHT_CHECK_SECONDS;
      this.scene.add(this.marker);
      this.placeMarker();
      return true;
    }
    return false;
  }
}
