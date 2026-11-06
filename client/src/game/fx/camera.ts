import type * as THREE from 'three';

/*
 * The camera's reaction to hits. The game places the camera as usual each frame, then apply()
 * nudges it, so these effects never fight the follow camera and vanish on their own.
 *
 * Shake uses "trauma": hits add trauma, trauma drains over time, and the motion is trauma squared
 * times smooth noise. Small hits barely move the camera, big ones really do, and the shake dies
 * down smoothly rather than cutting off. Noise instead of random keeps it heavy, not buzzy.
 */

const SHAKE_KEY = 'cse-souls-reduce-shake';
/** Most trauma a stack of hits can reach, so a crowd fight doesn't turn the stomach. */
const TRAUMA_CAP = 0.85;
const TRAUMA_DRAIN = 1.5;
const MAX_OFFSET = 0.2;
const MAX_ROTATION = 0.045;
const NOISE_SPEED = 19;
const REDUCED_SHAKE_SCALE = 0.3;
const MAX_HITSTOP = 0.17;
/** Freeze is nearly total, but not quite, so the game never reads as hung. */
const HITSTOP_SCALE = 0.04;
const HITSTOP_FX_SCALE = 0.4;

/** Smooth 1D noise: fixed random values at whole numbers, with soft blends in between. */
const NOISE = new Float32Array(256);
for (let i = 0; i < NOISE.length; i += 1) NOISE[i] = Math.random() * 2 - 1;
function noise1(x: number): number {
  const whole = Math.floor(x);
  const part = x - whole;
  const smooth = part * part * (3 - 2 * part);
  const a = NOISE[whole & 255];
  const b = NOISE[(whole + 1) & 255];
  return a + (b - a) * smooth;
}

const SPRING_STIFFNESS = 170;
const SPRING_DAMPING = 20;
const SPRING_STEP = 1 / 120;

export class CameraFx {
  /** A settings flag: cuts shake and sway to about a third. Saved in the browser. */
  reduceShake: boolean;
  /** The time scale from the most recent apply(), for character animation. */
  timeScale = 1;
  /**
   * The time scale for effects, from the same apply(). Effects slow during a hitstop but don't stop:
   * bodies freezing while sparks and blood leave them is what makes the freeze read as weight.
   */
  fxTimeScale = 1;

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private trauma = 0;
  private clock = Math.random() * 100;
  private hitstopLeft = 0;
  private slowLeft = 0;
  private slowTotal = 0;
  private slowScale = 1;
  private fov = 0;
  private fovVelocity = 0;
  private push = 0;
  private pushVelocity = 0;
  private recoilX = 0;
  private recoilZ = 0;
  private recoilVX = 0;
  private recoilVZ = 0;
  private baseFov = 0;
  private appliedFov = 0;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem(SHAKE_KEY) === '1';
    } catch {
      // Private browsing can refuse storage.
    }
    this.reduceShake = saved;
  }

  setReduceShake(on: boolean): void {
    this.reduceShake = on;
    try {
      localStorage.setItem(SHAKE_KEY, on ? '1' : '0');
    } catch {
      // The choice still lasts for this page.
    }
  }

  /** Adds trauma from 0 to 1. Stacking gets weaker near the cap instead of adding up forever. */
  shake(trauma: number): void {
    const room = Math.max(0, TRAUMA_CAP - this.trauma);
    this.trauma = Math.min(TRAUMA_CAP, this.trauma + Math.min(room, trauma * (1 - this.trauma * 0.6)));
  }

  /** A short freeze for your own hits: 0.055 light, 0.1 heavy, 0.15 kill. Returns the current time scale. */
  hitstop(seconds: number): number {
    // The longest pending freeze wins. They don't add up, or a multi-hit would stall the game.
    // Reduced motion keeps a shorter freeze: it's a pause, not movement, and it tells you that you hit.
    const wanted = this.reducedMotion.matches ? seconds * 0.5 : seconds;
    this.hitstopLeft = Math.min(MAX_HITSTOP, Math.max(this.hitstopLeft, wanted));
    this.timeScale = HITSTOP_SCALE;
    this.fxTimeScale = HITSTOP_FX_SCALE;
    return this.timeScale;
  }

  /** Slow motion that eases back to full speed by the end. For kills with heavy weapons. */
  slowMo(seconds: number, scale: number): void {
    if (this.reducedMotion.matches) return;
    this.slowLeft = seconds;
    this.slowTotal = seconds;
    this.slowScale = scale;
  }

  /** Widens the view for a moment, in degrees. */
  fovKick(degrees: number): void {
    this.fovVelocity += degrees * 26;
  }

  /** Dollies toward the view direction for a moment, in meters. */
  pushIn(meters: number): void {
    this.pushVelocity += meters * 18;
  }

  /** Knocks the camera along a world direction, for example the way a blow traveled. */
  recoil(dirX: number, dirZ: number, meters: number): void {
    this.recoilVX += dirX * meters * 22;
    this.recoilVZ += dirZ * meters * 22;
  }

  /** The usual reaction to a hit that you landed, so every caller gets the same weight. */
  yourHit(dirYaw: number, { heavy = false, kill = false }: { heavy?: boolean; kill?: boolean }): void {
    this.hitstop(kill ? 0.15 : heavy ? 0.1 : 0.055);
    this.shake(kill ? (heavy ? 0.66 : 0.52) : heavy ? 0.44 : 0.24);
    this.recoil(Math.sin(dirYaw), Math.cos(dirYaw), kill ? 0.1 : heavy ? 0.07 : 0.03);
    if (heavy || kill) this.pushIn(kill ? 0.18 : 0.09);
    if (kill) this.fovKick(heavy ? -3.4 : -1.8);
    else if (heavy) this.fovKick(-0.9);
    if (kill && heavy) this.slowMo(0.6, 0.3);
  }

  /** A hit taken by you. Harder than hits you land, with no freeze: losing control would feel unfair. */
  yourHurt(fromYaw: number, amount: number): void {
    this.shake(0.3 + 0.35 * Math.min(1, amount));
    this.recoil(Math.sin(fromYaw), Math.cos(fromYaw), 0.07);
    this.fovKick(1.4);
  }

  /** Forgets everything in progress, for example on death or scene change. */
  clear(): void {
    this.trauma = 0;
    this.hitstopLeft = this.slowLeft = 0;
    this.fov = this.fovVelocity = 0;
    this.push = this.pushVelocity = 0;
    this.recoilX = this.recoilZ = this.recoilVX = this.recoilVZ = 0;
    this.timeScale = 1;
    this.fxTimeScale = 1;
  }

  /**
   * Call once a frame after placing the camera and before rendering, with real frame seconds.
   * Returns the time scale for animation; read fxTimeScale for GameFx.update. Never apply either
   * to input or network time, which keep running in real time.
   */
  apply(camera: THREE.PerspectiveCamera, frameSeconds: number): number {
    const seconds = Math.min(0.1, frameSeconds);
    this.updateTime(seconds);

    const noMotion = this.reducedMotion.matches;
    const scale = noMotion ? 0 : this.reduceShake ? REDUCED_SHAKE_SCALE : 1;

    this.clock += seconds * NOISE_SPEED;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DRAIN * seconds * (0.6 + this.trauma * 0.5));
    const shake = this.trauma * this.trauma * scale;

    this.stepSprings(seconds);

    if (scale > 0) {
      camera.translateZ(-this.push * scale);
      camera.position.x += this.recoilX * scale;
      camera.position.z += this.recoilZ * scale;
      if (shake > 0.0001) {
        camera.translateX(shake * MAX_OFFSET * noise1(this.clock));
        camera.translateY(shake * MAX_OFFSET * noise1(this.clock + 57));
        camera.rotateX(shake * MAX_ROTATION * noise1(this.clock + 113));
        camera.rotateY(shake * MAX_ROTATION * noise1(this.clock + 171));
        camera.rotateZ(shake * MAX_ROTATION * 1.3 * noise1(this.clock + 229));
      }
    }

    // Anyone can change the lens between frames, so a difference from what was applied means a new base.
    if (this.baseFov === 0 || camera.fov !== this.appliedFov) this.baseFov = camera.fov;
    const nextFov = this.baseFov + this.fov * scale;
    if (nextFov !== camera.fov) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
    this.appliedFov = camera.fov;
    return this.timeScale;
  }

  private updateTime(seconds: number): void {
    let scale = 1;
    if (this.slowLeft > 0) {
      this.slowLeft = Math.max(0, this.slowLeft - seconds);
      const eased = 1 - this.slowLeft / Math.max(0.001, this.slowTotal);
      scale = this.slowScale + (1 - this.slowScale) * eased * eased;
    }
    if (this.hitstopLeft > 0) {
      this.hitstopLeft = Math.max(0, this.hitstopLeft - seconds);
      this.timeScale = HITSTOP_SCALE;
      this.fxTimeScale = HITSTOP_FX_SCALE;
      return;
    }
    this.timeScale = scale;
    this.fxTimeScale = scale;
  }

  /** Stiff damped springs, so each kick snaps out and settles back without any bookkeeping. */
  private stepSprings(seconds: number): void {
    // Small fixed steps: one long step on a slow frame makes these springs blow up and throws the camera away.
    let left = seconds;
    while (left > 0) {
      const step = Math.min(left, SPRING_STEP);
      left -= step;
      this.fovVelocity += (-SPRING_STIFFNESS * this.fov - SPRING_DAMPING * this.fovVelocity) * step;
      this.fov += this.fovVelocity * step;
      this.pushVelocity += (-SPRING_STIFFNESS * this.push - SPRING_DAMPING * this.pushVelocity) * step;
      this.push += this.pushVelocity * step;
      this.recoilVX += (-SPRING_STIFFNESS * this.recoilX - SPRING_DAMPING * this.recoilVX) * step;
      this.recoilX += this.recoilVX * step;
      this.recoilVZ += (-SPRING_STIFFNESS * this.recoilZ - SPRING_DAMPING * this.recoilVZ) * step;
      this.recoilZ += this.recoilVZ * step;
    }
  }
}
