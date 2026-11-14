import * as THREE from 'three';
import type { ClassId } from '../../../../shared/classes';
import { CRITICAL_IMPACT_AT, CRITICAL_SECONDS } from '../attacks/types';
import type { CharacterModel } from '../characters';
import { ImpactSequencer, type ImpactFrame, type ImpactPresetName } from '../impactFrames';
import type { VhsControls } from '../psxRenderer';
import { ArcaneRibbons } from './arcaneRibbons';
import { ATLAS } from './atlas';
import type { CameraFx } from './camera';
import {
  BLUE, BLUE_HOT, BONE, Beams, DECAL_CRATER, DECAL_FISSURE, DECAL_WARNING, DUST, DUST_DARK, DUST_LIGHT, Debris, Domes,
  EMBER, EMBER_DEEP, EMBER_HOT, GOLD, GOLD_HOT, GroundDecals, NIGHT_BLUE, RingWaves, SIGIL_CRESCENT, SIGIL_DIAMOND,
  SIGIL_GALAXY, SIGIL_RUNE, SIGIL_STAR, Sigils, WHITE_HOT, pick, rand, type Rgb,
} from './criticalParts';
import type { GameFx, Position } from './effects';
import {
  FACE_BASE, FACE_CAMERA, FACE_DIGIT, FACE_DIGIT_TINT, FACE_GROUND, FACE_VELOCITY, MOVE_ORBIT, ParticlePool, type ParticleSpec,
} from './particles';

/*
 * The critical hit on a stunned boss, one look per weapon. The beats follow the attacker's own
 * animation: every frame this reads model.criticalPhase() and fires each beat as the phase crosses
 * that weapon's named mark (criticalMarks()), so effects land on the pose at any frame rate.
 *
 * It also says how fast the rest of the world should run (wantedTimeScale): the slow holds, the
 * time stop on a slam, the bow's slow-motion arrow. The attacker's own animation keeps real time,
 * because the slow parts are already written into it and the server times the hit in real time.
 *
 * Everything is pooled: a particle pool of its own, and fixed meshes from criticalParts.ts.
 */

export type CriticalFamily = 'heavy' | 'mace' | 'zweihander' | 'katana' | 'longsword' | 'bow' | 'spear' | 'staff' | 'wand' | 'quarterstaff';

/** Which look a weapon gets. The variant order matches armory.ts. */
export function criticalFamily(classId: ClassId, variant: number): CriticalFamily {
  switch (classId) {
    case 'juggernaut': return variant === 2 ? 'mace' : 'heavy';
    case 'duelist': return variant === 1 ? 'longsword' : variant === 2 ? 'zweihander' : 'katana';
    case 'arcanist': return variant === 1 ? 'wand' : variant === 2 ? 'quarterstaff' : 'staff';
    default: return variant === 2 ? 'spear' : 'bow';
  }
}

export interface CriticalParts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  fx: GameFx;
  cameraFx: CameraFx;
  psx: { impact: ImpactSequencer; vhs: VhsControls };
}

export interface CriticalStart {
  classId: ClassId;
  variant: number;
  /** position() is the player's feet. yaw faces the boss. */
  attacker: { position: () => Position; yaw: number; model: CharacterModel };
  /** position() is the boss's feet; radius and height in meters. */
  target: { position: () => Position; radius: number; height: number };
  /** The local player's own critical: only then does it play impact frames, tape effects and slow motion. */
  mine: boolean;
}

const SPRITE = {
  glow: ATLAS.glow,
  embers: [ATLAS['ember-1'], ATLAS['ember-2'], ATLAS['ember-3']],
  ash: [ATLAS['ash-1'], ATLAS['ash-2'], ATLAS['ash-3']],
  smoke: [ATLAS['smoke-1'], ATLAS['smoke-2'], ATLAS['smoke-3'], ATLAS['smoke-4']],
  dust: [ATLAS['dust-1'], ATLAS['dust-2']],
  grit: ATLAS['dust-3'],
  impacts: [ATLAS['impact-1'], ATLAS['impact-2']],
  line: ATLAS['slash-line'],
  streak: ATLAS['spark-streak'],
  wind: ATLAS['wind-streak'],
  wisps: [ATLAS['wind-wisp'], ATLAS['wind-wisp-2']],
  ring: ATLAS.ring,
  ray: ATLAS.ray,
};

const MAX_CRITS = 4;
const MAX_BOLTS = 32;
/** Extra dashes across the boss in the katana's blitz, after the first long one. */
const KATANA_DASHES = 6;
/** The bow's arrow: the share of the flight spent crawling with time held, and the share of the distance it covers then. */
const ARROW_CRAWL = 0.82;
const ARROW_CRAWL_SHARE = 0.4;
const CAPACITY_DESKTOP = 3200;
const CAPACITY_PHONE = 1300;
/** The world never fully stops, so nothing reads as hung. */
const STOPPED = 0.02;
const LIGHT_EMBER = new THREE.Color('#ff8a3a');
const LIGHT_ARCANE = new THREE.Color('#9ab8ff');
const LIGHT_WHITE = new THREE.Color('#fff2dc');
/** The slam's three shockwaves, each wider and slower than the last. */
const SLAM_RING_RADII = [6.5, 10, 14];
const SLAM_RING_SECONDS = [0.42, 0.7, 1.05];
const SLAM_RING_COLORS: readonly Rgb[] = [EMBER_HOT, BONE, DUST_LIGHT];

interface Crit {
  active: boolean;
  id: number;
  family: CriticalFamily;
  mine: boolean;
  model: CharacterModel | null;
  attackerAt: (() => Position) | null;
  targetAt: (() => Position) | null;
  radius: number;
  height: number;
  marks: Readonly<Record<string, number>>;
  yaw: number;
  /** Forward and right along the ground. */
  fx: number; fz: number; rx: number; rz: number;
  /** Feet when it started. */
  sx: number; sy: number; sz: number;
  /** Boss feet, refreshed each frame. */
  tx: number; ty: number; tz: number;
  travel: number;
  last: number;
  real: number;
  carry: number;
  carry2: number;
  stopLeft: number;
  rampLeft: number;
  rampTotal: number;
  rampFrom: number;
  rumbleLeft: number;
  trail: number;
  trail2: number;
  ribbonA: number;
  ribbonB: number;
  ribbonY: number;
  sigil: number;
  sigil2: number;
  beam: number;
  beam2: number;
  decal: number;
  /** Something the effect itself moves: the arrow, the quarterstaff wave, the collapsing rune circle. */
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  dx: number; dy: number; dz: number;
  moveLeft: number;
  moveTotal: number;
  rings: number;
  images: number;
  /** The rune circle's center, averaged from where the wand tip has been. */
  cx: number; cy: number; cz: number; cn: number;
  volley: number;
  steerX: number; steerY: number; steerZ: number;
  steer: number;
  steerWant: number;
}

interface Bolt {
  active: boolean;
  owner: number;
  age: number;
  delay: number;
  flight: number;
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  hue: number;
}

function paint(s: ParticleSpec, from: Rgb, to: Rgb): void {
  s.r = from[0]; s.g = from[1]; s.b = from[2];
  s.r2 = to[0]; s.g2 = to[1]; s.b2 = to[2];
}

function mark(marks: Readonly<Record<string, number>>, name: string, fallback: number): number {
  const value = marks[name];
  return typeof value === 'number' ? value : fallback;
}

function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/** A slow-motion window that eases in and out over `ease` of phase, 1 outside it. */
function windowScale(phase: number, from: number, to: number, scale: number, ease: number): number {
  if (phase < from || phase > to) return 1;
  const k = Math.min(smooth((phase - from) / ease), smooth((to - phase) / ease));
  return 1 - (1 - scale) * k;
}

/** The pulsing marker on the stunned boss's head. */
class WeakPoint {
  private sigil = -1;
  private getter: (() => Position) | null = null;
  private clock = 0;
  private emberCarry = 0;

  constructor(private readonly sigils: Sigils, private readonly pool: ParticlePool) {}

  /** getter returns the world point to mark, usually the boss's head. */
  show(getter: () => Position): void {
    this.getter = getter;
    if (this.sigil < 0) {
      const p = getter();
      this.sigil = this.sigils.open(SIGIL_DIAMOND, p.x, p.y, p.z, 0.75, true, EMBER_HOT, EMBER);
    }
  }

  hide(): void {
    this.getter = null;
    this.sigils.close(this.sigil, 0.3);
    this.sigil = -1;
  }

  update(realSeconds: number): void {
    if (!this.getter || this.sigil < 0) return;
    this.clock += realSeconds;
    const p = this.getter();
    this.sigils.place(this.sigil, p.x, p.y, p.z);
    this.sigils.size(this.sigil, 0.75 + Math.sin(this.clock * 4.5) * 0.06);
    // A few sparks rising off it, so it reads as alive even when small on screen.
    this.emberCarry += realSeconds * 7;
    while (this.emberCarry >= 1) {
      this.emberCarry -= 1;
      const s = this.pool.reset();
      s.sprite = pick(SPRITE.embers);
      s.x = p.x + rand(-0.25, 0.25); s.y = p.y + rand(-0.2, 0.2); s.z = p.z + rand(-0.25, 0.25);
      s.vx = rand(-0.2, 0.2); s.vy = rand(0.6, 1.3); s.vz = rand(-0.2, 0.2);
      s.drag = 1;
      s.size = rand(0.05, 0.09);
      s.endSize = 0.02;
      s.life = rand(0.6, 1);
      s.additive = 1;
      s.minPixels = 1;
      s.ignoreFog = true;
      paint(s, EMBER_HOT, EMBER);
      this.pool.emit();
    }
  }
}

export class CriticalFx {
  /** The pulsing weak point on a stunned boss: weakPoint.show(headGetter) when it breaks, hide() when it rises. */
  readonly weakPoint: WeakPoint;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly fx: GameFx;
  private readonly cameraFx: CameraFx;
  private readonly psx: { impact: ImpactSequencer; vhs: VhsControls };
  private readonly atlas: THREE.Texture;
  private readonly digitTexture: THREE.Texture;
  private readonly pool: ParticlePool;
  private readonly quad = new THREE.PlaneGeometry(2, 2);
  private readonly decals: GroundDecals;
  private readonly rings: RingWaves;
  private readonly beams: Beams;
  private readonly domes: Domes;
  private readonly sigils: Sigils;
  private readonly debris: Debris;
  private readonly ribbons: ArcaneRibbons;
  private readonly light = new THREE.PointLight(0xffffff, 0, 30, 1.4);
  private lightDecay = 1;
  private readonly crits: Crit[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly spend: number;
  private serial = 0;
  private scale = 1;
  private readonly tip = new THREE.Vector3();
  private readonly base = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly focus = { x: 0.5, y: 0.5 };
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly lookQuat = new THREE.Quaternion();
  private readonly lookTarget = new THREE.Vector3();
  /** Reused for the slight desaturated hush before a katana dash or during the bow's slow motion. */
  private readonly hush: ImpactFrame[] = [{ look: 'dim', seconds: 1 }];
  private warmRenderer: THREE.WebGLRenderer | null = null;

  constructor(parts: CriticalParts) {
    this.scene = parts.scene;
    this.camera = parts.camera;
    this.fx = parts.fx;
    this.cameraFx = parts.cameraFx;
    this.psx = parts.psx;
    const loader = new THREE.TextureLoader();
    // A texture still loading when prewarm() ran is uploaded the moment it arrives instead.
    const upload = (texture: THREE.Texture) => this.warmRenderer?.initTexture(texture);
    this.atlas = loader.load('/fx/atlas.png', upload);
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.digitTexture = loader.load('/fx/binary.png', upload);
    this.digitTexture.minFilter = THREE.NearestFilter;
    this.digitTexture.magFilter = THREE.NearestFilter;
    this.digitTexture.generateMipmaps = false;
    const phone = window.matchMedia('(pointer: coarse)').matches;
    this.pool = new ParticlePool(this.atlas, this.digitTexture, phone ? CAPACITY_PHONE : CAPACITY_DESKTOP, SPRITE.glow);
    this.spend = phone ? 0.5 : 1;
    this.scene.add(this.pool.mesh);
    this.decals = new GroundDecals(this.scene, this.quad);
    this.rings = new RingWaves(this.scene, this.quad);
    this.beams = new Beams(this.scene);
    this.domes = new Domes(this.scene);
    this.sigils = new Sigils(this.scene, this.quad, this.camera);
    this.debris = new Debris(this.scene);
    this.ribbons = new ArcaneRibbons(this.camera);
    this.scene.add(this.ribbons.mesh);
    // Always in the scene and only dimmed: adding a light later would recompile every material.
    this.scene.add(this.light);
    this.weakPoint = new WeakPoint(this.sigils, this.pool);
    for (let i = 0; i < MAX_CRITS; i += 1) this.crits.push(this.blankCrit());
    for (let i = 0; i < MAX_BOLTS; i += 1) {
      this.bolts.push({ active: false, owner: -1, age: 0, delay: 0, flight: 0.3, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0, hue: 0 });
    }
  }

  private blankCrit(): Crit {
    return {
      active: false, id: -1, family: 'heavy', mine: false, model: null, attackerAt: null, targetAt: null, radius: 1, height: 2, marks: {},
      yaw: 0, fx: 0, fz: 1, rx: 1, rz: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, travel: 0, last: -1, real: 0, carry: 0, carry2: 0,
      stopLeft: 0, rampLeft: 0, rampTotal: 1, rampFrom: 1, rumbleLeft: 0, trail: 0, trail2: 0, ribbonA: -1, ribbonB: -1, ribbonY: 0,
      sigil: -1, sigil2: -1, beam: -1, beam2: -1, decal: -1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, dx: 0, dy: 0, dz: 1,
      moveLeft: 0, moveTotal: 1, rings: 0, images: 0, cx: 0, cy: 0, cz: 0, cn: 0, volley: 0, steerX: 0, steerY: 0, steerZ: 0, steer: 0, steerWant: 0,
    };
  }

  /* ---------- The API ---------- */

  /** Starts a critical's effects. Call it in the same frame as model.playCritical(). Returns a handle for cancel(). */
  start(opts: CriticalStart): number {
    let slot = -1;
    for (let i = 0; i < MAX_CRITS; i += 1) if (!this.crits[i].active) { slot = i; break; }
    if (slot < 0) {
      slot = 0;
      this.finish(this.crits[0], true);
    }
    const c = this.crits[slot];
    Object.assign(c, this.blankCrit());
    this.serial += 1;
    c.id = slot + MAX_CRITS * this.serial;
    c.active = true;
    c.family = criticalFamily(opts.classId, opts.variant);
    c.mine = opts.mine;
    c.model = opts.attacker.model;
    c.attackerAt = opts.attacker.position;
    c.targetAt = opts.target.position;
    c.radius = Math.max(0.3, opts.target.radius);
    c.height = Math.max(0.5, opts.target.height);
    c.marks = opts.attacker.model.criticalMarks();
    c.travel = opts.attacker.model.criticalTravel;
    c.yaw = opts.attacker.yaw;
    c.fx = Math.sin(c.yaw);
    c.fz = Math.cos(c.yaw);
    c.rx = -c.fz;
    c.rz = c.fx;
    const a = opts.attacker.position();
    c.sx = a.x; c.sy = a.y; c.sz = a.z;
    const t = opts.target.position();
    c.tx = t.x; c.ty = t.y; c.tz = t.z;
    // A distinct pair of trail ids per slot, well away from any player id.
    c.trail = -9000 - slot * 2;
    c.trail2 = -9001 - slot * 2;
    return c.id;
  }

  /** Stops a critical's effects at once, for a death, a disconnect or a lost boss. */
  cancel(handle: number): void {
    for (const c of this.crits) if (c.active && c.id === handle) this.finish(c, true);
  }

  /** How fast the world should run, 0.02 to 1: multiply animation (but not the attacker's own) and effect time by it. */
  wantedTimeScale(): number {
    return this.scale;
  }

  /**
   * Call once a frame with real seconds and game seconds (real times the world's time scale, hitstop
   * included). Call it after the attacker's model has updated, so the phase is this frame's.
   */
  update(realSeconds: number, gameSeconds: number): void {
    const real = Math.min(0.1, Math.max(0, realSeconds));
    const game = Math.min(0.1, Math.max(0, gameSeconds));
    let scale = 1;
    for (let i = 0; i < MAX_CRITS; i += 1) {
      const c = this.crits[i];
      if (!c.active) continue;
      const wanted = this.step(c, real, game);
      if (c.mine) scale = Math.min(scale, wanted);
    }
    this.scale = scale;

    this.pool.update(game);
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) this.pool.setFog(fog.near, fog.far, fog.color);
    this.decals.update(game);
    this.rings.update(game);
    this.beams.update(game);
    this.domes.update(game);
    this.sigils.update(game);
    this.debris.update(game);
    this.ribbons.update(game);
    this.updateBolts(game);
    this.weakPoint.update(real);
    if (this.light.intensity > 0.01) this.light.intensity *= Math.exp(-this.lightDecay * game);
    else this.light.intensity = 0;
  }

  /**
   * Turns the camera part way toward what the critical wants seen, such as the arrow in flight.
   * Call after placing the camera and before cameraFx.apply(). Only your own critical steers.
   */
  steerCamera(camera: THREE.PerspectiveCamera): void {
    let best: Crit | null = null;
    for (const c of this.crits) if (c.active && c.mine && c.steer > 0.001 && (!best || c.steer > best.steer)) best = c;
    if (!best) return;
    this.lookTarget.set(best.steerX, best.steerY, best.steerZ);
    this.lookMatrix.lookAt(camera.position, this.lookTarget, camera.up);
    this.lookQuat.setFromRotationMatrix(this.lookMatrix);
    camera.quaternion.slerp(this.lookQuat, best.steer);
    camera.updateMatrixWorld();
  }

  /** The stance break: glassy shards, a white ring and a short impact frame. position is the boss's feet. */
  bossBreak(position: Position, height: number): void {
    const x = position.x;
    const y = position.y + height * 0.6;
    const z = position.z;
    const s = this.pool.reset();
    const count = (46 * this.spend) | 0;
    for (let i = 0; i < count; i += 1) {
      const u = Math.random() * 2 - 1;
      const angle = Math.random() * Math.PI * 2;
      const flat = Math.sqrt(1 - u * u);
      const speed = rand(6, 15);
      s.x = x; s.y = y; s.z = z;
      s.vx = Math.cos(angle) * flat * speed; s.vy = u * speed * 0.7 + 3; s.vz = Math.sin(angle) * flat * speed;
      s.gravity = 11;
      s.drag = 1.2;
      s.life = rand(0.5, 1.1);
      s.delay = 0;
      s.additive = 1;
      s.minPixels = 1.5;
      s.alpha = 1;
      s.fadeIn = 0;
      s.fadeOut = 0.5;
      if (i % 2 === 0) {
        s.face = FACE_VELOCITY;
        s.sprite = SPRITE.streak;
        s.size = rand(0.07, 0.12);
        s.endSize = s.size * 0.6;
        s.aspect = 4;
        s.rotation = s.spin = 0;
        paint(s, WHITE_HOT, BLUE_HOT);
      } else {
        // Flat spinning flakes catch the light like broken glass.
        s.face = FACE_CAMERA;
        s.sprite = pick(SPRITE.ash);
        s.size = rand(0.16, 0.3);
        s.endSize = s.size * 0.5;
        s.aspect = 1;
        s.rotation = Math.random() * 6;
        s.spin = rand(-14, 14);
        paint(s, WHITE_HOT, BLUE_HOT);
      }
      this.pool.emit();
    }
    this.flash(x, y, z, 3.2, WHITE_HOT, 0.16);
    this.cameraNormal(x, y, z);
    this.rings.spawn(x, y, z, this.v.x, this.v.y, this.v.z, 5, 0.45, 0.55, BONE);
    this.rings.spawn(x, position.y + 0.1, z, 0, 1, 0, 7.5, 0.7, 0.45, BONE, 0.04);
    this.lightAt(x, y, z, LIGHT_WHITE, 9, 6);
    this.at.x = x; this.at.y = y; this.at.z = z;
    this.impactFrame('light', this.at);
    this.psx.vhs.glitch(0.45);
    this.cameraFx.shake(0.4);
  }

  /**
   * Compiles every shader the criticals and bossBreak() use and uploads their textures, so the first
   * critical in a fight does not stall on it. Call once after the scene's lights and fog are in place,
   * for example while the arena loads. Safe to call again; it only costs time.
   */
  prewarm(renderer: THREE.WebGLRenderer): void {
    this.warmRenderer = renderer;
    const parts: THREE.Object3D[] = [this.pool.mesh, this.ribbons.mesh, this.debris.mesh];
    this.decals.meshes(parts);
    this.rings.meshes(parts);
    this.beams.meshes(parts);
    this.domes.meshes(parts);
    this.sigils.meshes(parts);
    // Every pooled part, shown for a moment in a throwaway scene. Lights and fog come from the real
    // scene, so the programs built here are the ones the game will ask for.
    const holder = new THREE.Scene();
    holder.fog = this.scene.fog;
    const parents: (THREE.Object3D | null)[] = [];
    const shown: boolean[] = [];
    const culled: boolean[] = [];
    for (const part of parts) {
      parents.push(part.parent);
      shown.push(part.visible);
      culled.push(part.frustumCulled);
      holder.add(part);
      part.visible = true;
      part.frustumCulled = false;
    }
    holder.updateMatrixWorld(true);
    // Drawn into an offscreen target, as the PS1 renderer draws the scene, so tone mapping and color
    // space match and no second program is needed on the first real frame.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    const before = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.compile(holder, this.camera, this.scene);
      // One tiny real draw of everything: drivers finish compiling only when a program is first used,
      // and this also uploads the geometry and the textures.
      if (this.atlas.image) renderer.initTexture(this.atlas);
      if (this.digitTexture.image) renderer.initTexture(this.digitTexture);
      renderer.render(holder, this.camera);
      // The lit debris program built by compile() was not the one drawn above (the throwaway scene has
      // no lights): asking every program for its uniforms makes the driver finish linking them all now.
      const programs = renderer.info.programs;
      if (programs) for (const program of programs) program.getUniforms();
    } finally {
      renderer.setRenderTarget(before);
      for (let i = 0; i < parts.length; i += 1) {
        const parent = parents[i] ?? this.scene;
        parent.add(parts[i]);
        parts[i].visible = shown[i];
        parts[i].frustumCulled = culled[i];
      }
      target.dispose();
    }
  }

  dispose(): void {
    for (const c of this.crits) if (c.active) this.finish(c, true);
    this.scene.remove(this.pool.mesh, this.ribbons.mesh, this.light);
    this.pool.dispose();
    this.decals.dispose();
    this.rings.dispose();
    this.beams.dispose();
    this.domes.dispose();
    this.sigils.dispose();
    this.debris.dispose();
    this.ribbons.dispose();
    this.quad.dispose();
    this.atlas.dispose();
    this.digitTexture.dispose();
    this.light.dispose();
  }

  /* ---------- One critical ---------- */

  private step(c: Crit, real: number, game: number): number {
    c.real += real;
    const model = c.model;
    const phase = model ? model.criticalPhase() : -1;
    if (phase < 0) {
      // Over, or never started: give a late playCritical() a moment before giving up.
      if (c.last >= 0 || c.real > 0.5) this.finish(c, false);
      return 1;
    }
    if (c.targetAt) {
      const t = c.targetAt();
      c.tx = t.x; c.ty = t.y; c.tz = t.z;
    }
    let wanted = 1;
    switch (c.family) {
      case 'heavy': wanted = this.heavy(c, phase, real, game); break;
      case 'mace': wanted = this.mace(c, phase, real, game); break;
      case 'zweihander': wanted = this.zweihander(c, phase, real); break;
      case 'katana': wanted = this.katana(c, phase); break;
      case 'longsword': wanted = this.longsword(c, phase, real); break;
      case 'bow': wanted = this.bow(c, phase, real); break;
      case 'spear': wanted = this.spear(c, phase, real); break;
      case 'staff': wanted = this.staff(c, phase, real); break;
      case 'wand': wanted = this.wand(c, phase, real); break;
      case 'quarterstaff': wanted = this.quarterstaff(c, phase, real, game); break;
    }
    c.last = phase;

    // The time stop after a slam, then a ramp back up to full speed.
    if (c.stopLeft > 0) {
      c.stopLeft -= real;
      wanted = Math.min(wanted, STOPPED);
    } else if (c.rampLeft > 0) {
      c.rampLeft = Math.max(0, c.rampLeft - real);
      const k = 1 - c.rampLeft / c.rampTotal;
      wanted = Math.min(wanted, c.rampFrom + (1 - c.rampFrom) * k * k);
    }
    if (c.rumbleLeft > 0) {
      c.rumbleLeft -= real;
      if (c.mine) this.cameraFx.shake(1.6 * real * Math.max(0, c.rumbleLeft / 0.3));
    }
    c.steer += (c.steerWant - c.steer) * Math.min(1, real * 5);
    return wanted;
  }

  private finish(c: Crit, now: boolean): void {
    if (!c.active) return;
    c.active = false;
    this.fx.endTrail(c.trail);
    this.fx.endTrail(c.trail2);
    this.ribbons.release(c.ribbonA);
    this.ribbons.release(c.ribbonB);
    if (now) {
      this.sigils.free(c.sigil);
      this.sigils.free(c.sigil2);
      this.beams.kill(c.beam);
      this.beams.kill(c.beam2);
      for (const bolt of this.bolts) if (bolt.owner === c.id) bolt.active = false;
      if (c.mine) this.psx.impact.cancel();
    } else {
      this.sigils.close(c.sigil, 0.2);
      this.sigils.close(c.sigil2, 0.2);
      this.beams.release(c.beam, 0.15);
      this.beams.release(c.beam2, 0.15);
    }
    this.decals.release(c.decal, 0.2);
    c.sigil = c.sigil2 = c.beam = c.beam2 = c.decal = c.ribbonA = c.ribbonB = -1;
    c.model = null;
    c.attackerAt = c.targetAt = null;
  }

  private cross(c: Crit, phase: number, name: string, fallback: number): boolean {
    const at = mark(c.marks, name, fallback);
    return c.last < at && phase >= at;
  }

  /** The attacker's feet this frame, with the critical's dash or leap added. Written into this.at. */
  private feet(c: Crit): Position {
    const a = c.attackerAt ? c.attackerAt() : null;
    this.at.x = a ? a.x : c.sx;
    this.at.y = a ? a.y : c.sy;
    this.at.z = a ? a.z : c.sz;
    if (c.model) {
      c.model.criticalRootOffset(this.offset);
      this.at.x += this.offset.x; this.at.y += this.offset.y; this.at.z += this.offset.z;
    }
    return this.at;
  }

  /** The weapon's far end into this.tip and near end into this.base. */
  private weapon(c: Crit): void {
    if (c.model) c.model.weaponTip(this.tip, this.base);
  }

  /** Where the boss's front meets a line from the attacker, at a share of its height. Written into this.at. */
  private entry(c: Crit, share: number): Position {
    this.at.x = c.tx - c.fx * c.radius;
    this.at.y = c.ty + c.height * share;
    this.at.z = c.tz - c.fz * c.radius;
    return this.at;
  }

  /** The direction from the point to the camera into this.v. */
  private cameraNormal(x: number, y: number, z: number): void {
    this.v.set(this.camera.position.x - x, this.camera.position.y - y, this.camera.position.z - z).normalize();
  }

  private near(x: number, y: number, z: number): number {
    const dx = this.camera.position.x - x;
    const dy = this.camera.position.y - y;
    const dz = this.camera.position.z - z;
    return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / 45);
  }

  private impactFrame(name: ImpactPresetName, at: Position): void {
    this.camera.updateMatrixWorld();
    if (!ImpactSequencer.screenFocus(at, this.camera, this.focus)) {
      this.focus.x = 0.5;
      this.focus.y = 0.5;
    }
    this.psx.impact.play(name, { focus: this.focus });
  }

  /** Impact frame, tape and camera for a big blow: full for your own, a distant shake for anyone else's. */
  private blow(c: Crit, x: number, y: number, z: number, preset: ImpactPresetName, power: number): void {
    if (c.mine) {
      this.at.x = x; this.at.y = y; this.at.z = z;
      this.impactFrame(preset, this.at);
      this.psx.vhs.glitch(0.5 + power * 0.4);
      this.psx.vhs.impact(Math.min(1, 0.4 + power * 0.6));
      this.psx.vhs.echo(0.5);
      if (power > 0.8) this.psx.vhs.lens(this.focus.x, this.focus.y, power);
      this.cameraFx.shake(0.45 + power * 0.4);
      this.cameraFx.fovKick(2 + power * 4.5);
      this.cameraFx.recoil(c.fx, c.fz, 0.05 + power * 0.07);
    } else {
      this.cameraFx.shake((0.15 + power * 0.25) * this.near(x, y, z));
    }
  }

  /** A time stop of seconds, then an ease from `from` back to 1 over ramp seconds. Your own only. */
  private freeze(c: Crit, seconds: number, from: number, ramp: number): void {
    c.stopLeft = seconds;
    c.rampLeft = c.rampTotal = ramp;
    c.rampFrom = from;
  }

  private lightAt(x: number, y: number, z: number, color: THREE.Color, intensity: number, decay: number): void {
    this.light.position.set(x, y, z);
    this.light.color.copy(color);
    this.light.intensity = Math.max(this.light.intensity, intensity);
    this.lightDecay = decay;
  }

  /* ---------- Heavy: war hammer and double axe ---------- */

  private heavy(c: Crit, phase: number, real: number, game: number): number {
    const plant = mark(c.marks, 'plant', 0.2);
    const peak = mark(c.marks, 'peak', 0.4);
    const slam = mark(c.marks, 'slam', CRITICAL_IMPACT_AT);
    if (phase >= plant && phase < slam) this.hoist(c, real, game);
    if (this.cross(c, phase, 'peak', 0.4)) this.runGlint(c);
    if (this.cross(c, phase, 'slam', CRITICAL_IMPACT_AT)) {
      this.weapon(c);
      this.slam(c, this.tip.x, this.tip.z, 1, 3, true, 'heavy');
    }
    if (this.cross(c, phase, 'buried', 0.625)) this.settle(c);
    if (this.cross(c, phase, 'free', 0.81)) {
      this.weapon(c);
      this.puffs(this.tip.x, c.sy + 0.2, this.tip.z, 8, 1.2, 0.5, DUST_LIGHT);
    }
    return windowScale(phase, peak, slam - 0.01, 0.5, 0.03);
  }

  /** Dust drawn up off the ground toward the raised weapon, and a low wind ring climbing round the feet. */
  private hoist(c: Crit, real: number, game: number): void {
    const feet = this.feet(c);
    const fx = feet.x;
    const fy = feet.y;
    const fz = feet.z;
    this.weapon(c);
    c.carry += real * 60 * this.spend;
    while (c.carry >= 1) {
      c.carry -= 1;
      const angle = Math.random() * Math.PI * 2;
      const r = rand(1.2, 3.4);
      const px = fx + Math.cos(angle) * r;
      const pz = fz + Math.sin(angle) * r;
      const s = this.pool.reset();
      const life = rand(0.7, 1);
      // With drag 1.2 a particle covers about 0.55 of its starting speed times life, so this lands it near the head.
      const k = 0.85 / (life * 0.55);
      s.x = px; s.y = fy + 0.05; s.z = pz;
      s.vx = (this.tip.x - px) * k; s.vy = (this.tip.y - fy) * k; s.vz = (this.tip.z - pz) * k;
      s.drag = 1.2;
      s.life = life;
      s.fadeIn = 0.15;
      s.fadeOut = 0.6;
      if (Math.random() < 0.35) {
        s.face = FACE_VELOCITY;
        s.sprite = SPRITE.streak;
        s.size = 0.05;
        s.endSize = 0.03;
        s.aspect = 6;
        s.additive = 1;
        s.alpha = 0.8;
        s.minPixels = 1;
        paint(s, BONE, EMBER_HOT);
      } else {
        s.sprite = pick(SPRITE.dust);
        s.size = rand(0.35, 0.6);
        s.endSize = 0.1;
        s.rotation = Math.random() * 6;
        s.spin = rand(-2, 2);
        s.alpha = 0.55;
        s.additive = 0.25;
        paint(s, DUST_LIGHT, BONE);
      }
      this.pool.emit();
    }
    c.carry2 += game * 5;
    while (c.carry2 >= 1) {
      c.carry2 -= 1;
      this.windRing(fx, fy + 0.15, fz, 1.7, (14 * this.spend) | 0, 1.1);
    }
  }

  /** A ring of dust circling a point and rising. */
  private windRing(x: number, y: number, z: number, radius: number, count: number, rise: number): void {
    const s = this.pool.reset();
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      s.move = MOVE_ORBIT;
      s.face = FACE_CAMERA;
      s.sprite = pick(SPRITE.dust);
      s.x = x; s.y = y; s.z = z;
      s.vx = 0; s.vy = rise; s.vz = 0;
      s.extra = radius * rand(0.9, 1.1);
      s.rotation = start + (i / count) * Math.PI * 2;
      s.spin = 5.5;
      s.size = rand(0.3, 0.45);
      s.endSize = 0.6;
      s.life = rand(0.8, 1.1);
      s.alpha = 0.45;
      s.additive = 0.3;
      s.fadeIn = 0.2;
      s.fadeOut = 0.5;
      paint(s, BONE, DUST_LIGHT);
      this.pool.emit();
    }
  }

  /** A glint running from the hands to the head of the weapon. */
  private runGlint(c: Crit): void {
    this.weapon(c);
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      this.glint(
        this.base.x + (this.tip.x - this.base.x) * t,
        this.base.y + (this.tip.y - this.base.y) * t,
        this.base.z + (this.tip.z - this.base.z) * t,
        0.35 + t * 0.55, k * 0.035,
      );
    }
    this.lightAt(this.tip.x, this.tip.y, this.tip.z, LIGHT_WHITE, 2.5, 6);
  }

  /** A four-point twinkle: two crossing razor lines and a glow. */
  private glint(x: number, y: number, z: number, size: number, delay: number): void {
    const s = this.pool.reset();
    for (let k = 0; k < 3; k += 1) {
      s.x = x; s.y = y; s.z = z;
      s.delay = delay;
      s.additive = 1;
      s.ignoreFog = true;
      s.fadeIn = 0.15;
      s.fadeOut = 0.35;
      s.life = 0.32;
      if (k < 2) {
        s.sprite = SPRITE.line;
        s.aspect = 9;
        s.size = size * 0.18;
        s.endSize = size * 0.05;
        s.rotation = k === 0 ? 0.15 : 0.15 + Math.PI / 2;
        s.spin = 1.2;
        s.minPixels = 1;
        paint(s, WHITE_HOT, GOLD_HOT);
      } else {
        s.sprite = SPRITE.glow;
        s.aspect = 1;
        s.size = size * 0.7;
        s.endSize = size * 0.2;
        s.rotation = 0;
        s.spin = 0;
        s.alpha = 0.8;
        paint(s, GOLD_HOT, GOLD);
      }
      this.pool.emit();
    }
  }

  /**
   * The ground blow every heavy critical ends in. power 1 is the war hammer; rings is how many
   * shockwaves; crater false leaves the ground to the caller (the zweihander's fissure).
   */
  private slam(c: Crit, x: number, z: number, power: number, rings: number, crater: boolean, preset: ImpactPresetName): void {
    // A weapon too far from the attacker means the pose isn't the one expected: fall back to the boss's front.
    const ddx = x - c.sx;
    const ddz = z - c.sz;
    if (!(ddx * ddx + ddz * ddz < 49)) {
      const e = this.entry(c, 0);
      x = e.x;
      z = e.z;
    }
    const y = c.sy;
    if (crater) this.decals.place(DECAL_CRATER, x, y, z, c.yaw, 3.6 * power, 3.6 * power, 8, 2.5);
    for (let i = 0; i < rings && i < 3; i += 1) {
      this.rings.spawn(x, y + 0.1, z, 0, 1, 0, SLAM_RING_RADII[i] * power * 1.25, SLAM_RING_SECONDS[i], 1 - i * 0.18, SLAM_RING_COLORS[i], i * 0.06);
    }
    // A dome of shoved air bursting out of the blow, and a hot flat shock front racing along the ground.
    this.domes.spawn(x, y, z, 6.5 * power, 0.55, BONE);
    this.groundShock(x, y, z, 15 * power, 0.75, EMBER_HOT);
    this.groundShock(x, y, z, 9 * power, 0.5, WHITE_HOT);
    this.flash(x, y + 0.6, z, 4.5 * power, WHITE_HOT, 0.14);
    this.dustColumn(x, y, z, power);
    this.dustWall(x, y, z, power);
    this.debris.burst(x, y + 0.3, z, y, Math.round((24 + 22 * power) * this.spend), 6.5 * power + 2, 9 * power + 3, 0.12, 0.34 * Math.max(0.6, power), 0, 0, 0, 0.18);
    this.embers(x, y + 0.3, z, (44 * power * this.spend) | 0, 7 * power + 2);
    this.redDigits(x, y + 0.5, z, 6);
    this.lightAt(x, y + 1.2, z, LIGHT_EMBER, 14 * power, 3);
    const e = this.entry(c, 0.45);
    this.fx.hit(e, c.yaw, 'heavy', { heavy: true });
    this.blow(c, x, y + 0.3, z, preset, power);
    if (c.mine) {
      this.freeze(c, 0.12 * Math.min(1, power + 0.2), 0.3, 0.45);
      c.rumbleLeft = 0.3;
      this.cameraFx.shake(0.85);
      this.cameraFx.pushIn(0.2 * power);
    }
  }

  private flash(x: number, y: number, z: number, size: number, color: Rgb, life: number): void {
    const s = this.pool.reset();
    s.x = x; s.y = y; s.z = z;
    s.sprite = pick(SPRITE.impacts);
    s.size = size * 0.6;
    s.endSize = size;
    s.rotation = Math.random() * 6;
    s.life = life;
    s.additive = 1;
    s.ignoreFog = true;
    s.fadeOut = 0.3;
    paint(s, color, EMBER);
    this.pool.emit();
    s.sprite = SPRITE.glow;
    s.size = size * 1.2;
    s.endSize = size * 1.6;
    s.life = life * 1.8;
    s.alpha = 0.7;
    paint(s, color, color);
    this.pool.emit();
  }

  /** A flat bright ring sprite on the ground growing to radius meters. */
  private groundShock(x: number, y: number, z: number, radius: number, life: number, color: Rgb): void {
    const s = this.pool.reset();
    s.face = FACE_GROUND;
    s.sprite = SPRITE.ring;
    s.x = x; s.y = y + 0.06; s.z = z;
    s.size = radius * 0.15;
    s.endSize = radius * 2;
    s.life = life;
    s.alpha = 1;
    s.additive = 1;
    s.ignoreFog = true;
    s.fadeOut = 0.25;
    paint(s, color, DUST);
    this.pool.emit();
  }

  /** A fan of light rays standing up out of a point, spread across the view. */
  private rayCrown(x: number, y: number, z: number, count: number, height: number, life: number, hot: Rgb, cool: Rgb, delay: number): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      s.face = FACE_BASE;
      s.sprite = SPRITE.ray;
      s.x = x; s.y = y; s.z = z;
      s.size = height * rand(0.25, 0.45);
      s.endSize = height * rand(0.8, 1.15);
      s.aspect = rand(0.1, 0.22);
      s.rotation = ((i + 0.5) / count - 0.5) * 2.6 + rand(-0.08, 0.08);
      s.life = life * rand(0.8, 1.1);
      s.delay = delay + rand(0, 0.04);
      s.alpha = 1;
      s.additive = 1;
      s.ignoreFog = true;
      s.fadeOut = 0.35;
      paint(s, hot, cool);
      this.pool.emit();
    }
  }

  /** A column of dust thrown straight up from the blow. */
  private dustColumn(x: number, y: number, z: number, power: number): void {
    const s = this.pool.reset();
    const count = (18 * this.spend) | 0;
    for (let i = 0; i < count; i += 1) {
      s.sprite = pick(SPRITE.smoke);
      s.x = x + rand(-0.5, 0.5); s.y = y + 0.2; s.z = z + rand(-0.5, 0.5);
      s.vx = rand(-0.6, 0.6); s.vy = rand(4, 11) * power; s.vz = rand(-0.6, 0.6);
      s.drag = 1.6;
      s.gravity = -0.3;
      s.size = rand(0.9, 1.5) * power;
      s.endSize = rand(2.6, 4) * power;
      s.rotation = Math.random() * 6;
      s.spin = rand(-0.8, 0.8);
      s.life = rand(1.4, 2.2);
      s.alpha = 0.8;
      s.additive = 0;
      s.fadeIn = 0.04;
      s.fadeOut = 0.4;
      paint(s, DUST_LIGHT, DUST_DARK);
      this.pool.emit();
    }
    // A hot core at the base for the first instant.
    s.sprite = SPRITE.ray;
    s.face = FACE_BASE;
    s.x = x; s.y = y; s.z = z;
    s.vx = s.vy = s.vz = 0;
    s.drag = 0;
    s.gravity = 0;
    s.size = 5 * power;
    s.endSize = 7 * power;
    s.aspect = 0.45;
    s.rotation = 0;
    s.spin = 0;
    s.life = 0.35;
    s.alpha = 1;
    s.additive = 1;
    s.fadeIn = 0;
    s.fadeOut = 0.2;
    paint(s, WHITE_HOT, EMBER);
    this.pool.emit();
  }

  /** A low wall of dust rolling outward along the ground. */
  private dustWall(x: number, y: number, z: number, power: number): void {
    const s = this.pool.reset();
    const count = (40 * this.spend) | 0;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + rand(-0.08, 0.08);
      const speed = rand(7, 10.5) * power + 2;
      s.sprite = pick(SPRITE.dust);
      s.x = x + Math.cos(angle) * 1.2; s.y = y + 0.4; s.z = z + Math.sin(angle) * 1.2;
      s.vx = Math.cos(angle) * speed; s.vy = rand(0.3, 1.1); s.vz = Math.sin(angle) * speed;
      s.drag = 2.4;
      s.size = rand(0.9, 1.3) * power + 0.3;
      s.endSize = rand(2.4, 3.4) * power + 0.5;
      s.rotation = Math.random() * 6;
      s.spin = rand(-1, 1);
      s.life = rand(1.3, 1.9);
      s.alpha = 0.75;
      s.additive = 0;
      s.fadeIn = 0.05;
      s.fadeOut = 0.35;
      paint(s, DUST_LIGHT, DUST);
      this.pool.emit();
    }
  }

  private embers(x: number, y: number, z: number, count: number, speed: number): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const out = rand(0.3, 1) * speed;
      s.sprite = pick(SPRITE.embers);
      s.x = x; s.y = y; s.z = z;
      s.vx = Math.cos(angle) * out; s.vy = rand(0.5, 1.4) * speed; s.vz = Math.sin(angle) * out;
      s.gravity = 6;
      s.drag = 1.3;
      s.size = rand(0.05, 0.1);
      s.endSize = 0.03;
      s.life = rand(0.8, 1.6);
      s.additive = 1;
      s.minPixels = 1;
      s.extra = 0.3;
      s.fadeOut = 0.5;
      paint(s, EMBER_HOT, EMBER_DEEP);
      this.pool.emit();
    }
  }

  /** A few tiny red binary digits: the game's own mark, kept to an accent. */
  private redDigits(x: number, y: number, z: number, count: number): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      s.face = FACE_DIGIT;
      s.x = x + rand(-0.6, 0.6); s.y = y + rand(0, 0.6); s.z = z + rand(-0.6, 0.6);
      s.vx = rand(-2, 2); s.vy = rand(2, 4.5); s.vz = rand(-2, 2);
      s.gravity = 3;
      s.drag = 1.5;
      s.size = s.endSize = 0.12;
      s.life = rand(0.9, 1.4);
      s.additive = 1;
      s.minPixels = 3;
      s.fadeOut = 0.6;
      paint(s, EMBER, EMBER_DEEP);
      this.pool.emit();
    }
  }

  /** Pebbles and grit settling in the crater. */
  private settle(c: Crit): void {
    this.weapon(c);
    const ground = c.sy;
    this.debris.burst(this.tip.x, ground + 0.3, this.tip.z, ground, (10 * this.spend) | 0, 1.6, 2.5, 0.05, 0.11);
    this.puffs(this.tip.x, ground + 0.15, this.tip.z, 10, 1.8, 0.4, DUST);
  }

  /** Soft low dust puffs around a point. */
  private puffs(x: number, y: number, z: number, count: number, radius: number, speed: number, color: Rgb): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      s.sprite = pick(SPRITE.dust);
      s.x = x + Math.cos(angle) * r; s.y = y; s.z = z + Math.sin(angle) * r;
      s.vx = Math.cos(angle) * speed; s.vy = rand(0.2, 0.6); s.vz = Math.sin(angle) * speed;
      s.drag = 1.5;
      s.size = rand(0.4, 0.7);
      s.endSize = rand(1, 1.5);
      s.rotation = Math.random() * 6;
      s.life = rand(0.8, 1.3);
      s.alpha = 0.5;
      s.fadeIn = 0.1;
      paint(s, color, DUST_DARK);
      this.pool.emit();
    }
  }

  /** Dust blown straight out from a point along the ground, the kick of a crouch or a launch. */
  private dustRing(x: number, y: number, z: number, count: number, speed: number, size: number): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + rand(-0.1, 0.1);
      s.sprite = pick(SPRITE.dust);
      s.x = x + Math.cos(angle) * 0.3; s.y = y + 0.12; s.z = z + Math.sin(angle) * 0.3;
      s.vx = Math.cos(angle) * speed * rand(0.8, 1.2); s.vy = rand(0.1, 0.4); s.vz = Math.sin(angle) * speed * rand(0.8, 1.2);
      s.drag = 3.5;
      s.size = size;
      s.endSize = size * 2.2;
      s.rotation = Math.random() * 6;
      s.life = rand(0.6, 0.9);
      s.alpha = 0.6;
      s.additive = 0.1;
      s.fadeOut = 0.4;
      paint(s, DUST_LIGHT, DUST);
      this.pool.emit();
    }
  }

  /** Sparks from a point in a cone around (dx, dy, dz); spread 0 is a line, 1 a hemisphere. */
  private sparks(x: number, y: number, z: number, dx: number, dy: number, dz: number, spread: number, count: number, speed: number, hot: Rgb, cool: Rgb): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      const sp = rand(0.4, 1) * speed;
      s.face = FACE_VELOCITY;
      s.sprite = SPRITE.streak;
      s.x = x; s.y = y; s.z = z;
      s.vx = (dx + rand(-spread, spread)) * sp;
      s.vy = (dy + rand(-spread, spread)) * sp;
      s.vz = (dz + rand(-spread, spread)) * sp;
      s.gravity = 7;
      s.drag = 2;
      s.size = rand(0.05, 0.09);
      s.endSize = 0.03;
      s.aspect = 6;
      s.life = rand(0.3, 0.6);
      s.additive = 1;
      s.minPixels = 1;
      s.fadeOut = 0.4;
      paint(s, hot, cool);
      this.pool.emit();
    }
  }

  /* ---------- Mace and shield ---------- */

  private mace(c: Crit, phase: number, real: number, game: number): number {
    const leap = mark(c.marks, 'leap', 0.5);
    const slam = mark(c.marks, 'slam', CRITICAL_IMPACT_AT);
    if (this.cross(c, phase, 'bash', 0.25)) {
      const e = this.entry(c, 0.55);
      this.flash(e.x, e.y, e.z, 1.8, WHITE_HOT, 0.12);
      this.sparks(e.x, e.y, e.z, -c.fx, 0.3, -c.fz, 0.9, (22 * this.spend) | 0, 9, WHITE_HOT, EMBER);
      this.cameraNormal(e.x, e.y, e.z);
      this.rings.spawn(e.x, e.y, e.z, this.v.x, this.v.y, this.v.z, 1.8, 0.3, 0.3, BONE);
      if (c.mine) {
        this.cameraFx.shake(0.35);
        this.psx.vhs.glitch(0.3);
      }
    }
    // The mace's full circle before the leap leaves a heavy trail.
    const wind = mark(c.marks, 'wind', 0.4);
    if (phase >= wind - 0.1 && phase < slam) {
      this.weapon(c);
      if (c.last < wind - 0.1) this.fx.beginTrail(c.trail, 'heavy');
      this.fx.pushTrail(c.trail, this.tip, this.base);
    }
    if (this.cross(c, phase, 'wind', 0.4)) {
      const f = this.feet(c);
      this.windRing(f.x, f.y + 0.15, f.z, 1.6, (16 * this.spend) | 0, 1.2);
    }
    if (this.cross(c, phase, 'leap', 0.5)) {
      const f = this.feet(c);
      this.dustRing(f.x, f.y, f.z, (20 * this.spend) | 0, 4, 0.35);
    }
    if (phase >= leap && phase < slam) this.hoist(c, real * 0.5, game);
    if (this.cross(c, phase, 'slam', CRITICAL_IMPACT_AT)) {
      this.fx.endTrail(c.trail);
      this.weapon(c);
      this.slam(c, this.tip.x, this.tip.z, 0.9, 3, true, 'heavy');
    }
    return windowScale(phase, leap, slam - 0.01, 0.55, 0.02);
  }

  /* ---------- Zweihander ---------- */

  private zweihander(c: Crit, phase: number, real: number): number {
    const drag = mark(c.marks, 'drag', 0.095);
    const spin = mark(c.marks, 'spin', 0.3);
    const peak = mark(c.marks, 'peak', 0.45);
    const slam = mark(c.marks, 'slam', CRITICAL_IMPACT_AT);
    this.weapon(c);
    // The point dragged along the ground throws sparks and grit.
    if (phase >= drag && phase < spin + 0.05 && this.tip.y < c.sy + 0.45) {
      c.carry += real * 45 * this.spend;
      while (c.carry >= 1) {
        c.carry -= 1;
        this.sparks(this.tip.x, c.sy + 0.05, this.tip.z, -c.fx * 0.4, 0.8, -c.fz * 0.4, 0.6, 1, 4, EMBER_HOT, EMBER_DEEP);
        if (Math.random() < 0.4) this.puffs(this.tip.x, c.sy + 0.1, this.tip.z, 1, 0.2, 0.3, DUST_LIGHT);
      }
    }
    // The full sweep: a heavy trail and wind lines whipping round the body.
    const from = spin - 0.06;
    const to = peak - 0.02;
    if (phase >= from && phase < to) {
      if (c.last < from) this.fx.beginTrail(c.trail, 'heavy');
      this.fx.pushTrail(c.trail, this.tip, this.base);
      c.carry2 += real * 40 * this.spend;
      const f = this.feet(c);
      while (c.carry2 >= 1) {
        c.carry2 -= 1;
        const s = this.pool.reset();
        const ox = this.tip.x - f.x;
        const oz = this.tip.z - f.z;
        const len = Math.max(0.1, Math.sqrt(ox * ox + oz * oz));
        s.face = FACE_VELOCITY;
        s.sprite = pick(SPRITE.wisps);
        s.x = this.tip.x + rand(-0.3, 0.3); s.y = this.tip.y + rand(-0.3, 0.3); s.z = this.tip.z + rand(-0.3, 0.3);
        // Along the circle, the way the blade is going round.
        s.vx = (-oz / len) * 9; s.vy = rand(-0.5, 0.5); s.vz = (ox / len) * 9;
        s.drag = 3;
        s.size = rand(0.14, 0.24);
        s.endSize = s.size * 1.4;
        s.aspect = 7;
        s.life = rand(0.25, 0.4);
        s.alpha = 0.5;
        s.additive = 1;
        s.fadeOut = 0.3;
        paint(s, BONE, DUST_LIGHT);
        this.pool.emit();
      }
    } else if (c.last >= from && c.last < to) {
      this.fx.endTrail(c.trail);
    }
    if (this.cross(c, phase, 'spin', 0.3)) {
      const f = this.feet(c);
      this.windRing(f.x, f.y + 0.2, f.z, 2.2, (18 * this.spend) | 0, 0.6);
    }
    if (this.cross(c, phase, 'peak', 0.45)) this.glint(this.tip.x, this.tip.y, this.tip.z, 1, 0);
    if (this.cross(c, phase, 'slam', CRITICAL_IMPACT_AT)) {
      let x = this.tip.x;
      let z = this.tip.z;
      const ddx = x - c.sx;
      const ddz = z - c.sz;
      if (!(ddx * ddx + ddz * ddz < 49)) {
        const e = this.entry(c, 0);
        x = e.x;
        z = e.z;
      }
      // A tall white crescent left by the blade, standing in the plane of the cut: its arc runs from
      // over the head down to the ground at the blow, bulging up and forward the way the edge went.
      const crescent = this.sigils.open(SIGIL_CRESCENT, x - c.fx * 1.3, c.sy + 1.7, z - c.fz * 1.3, 2.6, false, WHITE_HOT, EMBER_HOT);
      this.sigils.orient(crescent, c.fx * 0.62, -0.78, c.fz * 0.62, c.fx * 0.78, 0.62, c.fz * 0.78);
      this.sigils.size(crescent, 2.6, 2.4);
      this.sigils.close(crescent, 0.6);
      this.rayCrown(x, c.sy, z, 9, 6, 0.5, WHITE_HOT, EMBER, 0);
      this.decals.place(DECAL_FISSURE, x + c.fx * 4, c.sy, z + c.fz * 4, c.yaw, 1.1, 4.2, 8, 2.5);
      this.slam(c, x, z, 0.8, 2, false, 'heavy');
    }
    if (this.cross(c, phase, 'rest', 0.72)) this.settle(c);
    return windowScale(phase, peak, slam - 0.01, 0.5, 0.03);
  }

  /* ---------- Katana ---------- */

  private katana(c: Crit, phase: number): number {
    const crouch = mark(c.marks, 'crouch', 0.15);
    const dash = mark(c.marks, 'dash', 0.42);
    const through = mark(c.marks, 'through', 0.5);
    const sheath = mark(c.marks, 'sheath', CRITICAL_IMPACT_AT);
    const travel = c.travel > 0.5 ? c.travel : 6;
    const groundY = c.sy;
    if (this.cross(c, phase, 'crouch', 0.15)) {
      this.dustRing(c.sx, groundY, c.sz, (26 * this.spend) | 0, 4.5, 0.3);
      this.weapon(c);
      this.glint(this.base.x, this.base.y, this.base.z, 0.7, 0);
      if (c.mine) {
        this.hush[0].seconds = Math.max(0.2, (dash - crouch) * CRITICAL_SECONDS);
        this.psx.impact.play(this.hush);
      }
    }
    if (this.cross(c, phase, 'dash', 0.42)) {
      // Air blown back off the launch.
      this.dustRing(c.sx, groundY, c.sz, (18 * this.spend) | 0, 3.5, 0.4);
      this.sparks(c.sx, groundY + 0.2, c.sz, -c.fx, 0.2, -c.fz, 0.4, (12 * this.spend) | 0, 6, BONE, DUST_LIGHT);
      c.images = 0;
    }
    // Afterimages: a row of dark leaning silhouettes left along the path as the body passes.
    if (phase >= dash && c.images < 5) {
      const f = this.feet(c);
      const moved = (f.x - c.sx) * c.fx + (f.z - c.sz) * c.fz;
      while (c.images < 5 && moved >= (travel * (c.images + 1)) / 6) {
        c.images += 1;
        const along = (travel * c.images) / 6;
        this.afterimage(c, c.sx + c.fx * along, groundY, c.sz + c.fz * along);
      }
    }
    if (this.cross(c, phase, 'cut', 0.47)) {
      // One razor line along the whole path, through the boss, held through the stillness.
      const y = groundY + 1.15;
      const ax = c.sx + c.fx * 0.4;
      const az = c.sz + c.fz * 0.4;
      const bx = c.sx + c.fx * travel;
      const bz = c.sz + c.fz * travel;
      c.beam = this.beams.spawn(ax, y, az, bx, y, bz, 0.045, 0, WHITE_HOT);
      c.beam2 = this.beams.spawn(ax, y, az, bx, y, bz, 0.11, 0, BLUE);
      const e = this.entry(c, 0.35);
      this.sparks(e.x, y, e.z, c.fx, 0.1, c.fz, 0.5, (16 * this.spend) | 0, 12, WHITE_HOT, BLUE_HOT);
      if (c.mine) this.psx.vhs.echo(0.8);
    }
    // The blitz: in the stillness after the first cut, more dashes cross the boss from every side,
    // each a razor line through it with a dark afterimage where it landed.
    const cut = mark(c.marks, 'cut', 0.47);
    if (phase >= cut && c.volley < KATANA_DASHES) {
      while (c.volley < KATANA_DASHES && phase >= cut + ((sheath - 0.012 - cut) * (c.volley + 1)) / KATANA_DASHES) {
        c.volley += 1;
        this.blitzDash(c, c.volley, sheath - phase);
      }
    }
    if (this.cross(c, phase, 'through', 0.5)) {
      // A dust slit along the ground under the line.
      this.decals.place(DECAL_FISSURE, c.sx + c.fx * travel * 0.5, groundY, c.sz + c.fz * travel * 0.5, c.yaw, 0.32, travel * 0.5, 6, 2);
      const s = this.pool.reset();
      const count = (22 * this.spend) | 0;
      for (let i = 0; i < count; i += 1) {
        const along = rand(0.5, travel);
        s.sprite = pick(SPRITE.dust);
        s.x = c.sx + c.fx * along + c.rx * rand(-0.3, 0.3); s.y = groundY + 0.15; s.z = c.sz + c.fz * along + c.rz * rand(-0.3, 0.3);
        s.vx = c.rx * rand(-1.5, 1.5); s.vy = rand(0.4, 1.2); s.vz = c.rz * rand(-1.5, 1.5);
        s.drag = 2;
        s.size = rand(0.3, 0.5);
        s.endSize = rand(0.9, 1.3);
        s.rotation = Math.random() * 6;
        s.life = rand(1.4, 2);
        s.alpha = 0.55;
        s.additive = 0.1;
        s.fadeOut = 0.5;
        paint(s, DUST_LIGHT, DUST);
        this.pool.emit();
      }
    }
    if (this.cross(c, phase, 'sheath', CRITICAL_IMPACT_AT)) {
      // On the boss's near side toward the camera, or its own body would hide the cuts.
      this.cameraNormal(c.tx, c.ty + c.height * 0.5, c.tz);
      const cx = c.tx + this.v.x * (c.radius + 0.4);
      const cy = c.ty + c.height * 0.5;
      const cz = c.tz + this.v.z * (c.radius + 0.4);
      this.blow(c, cx, cy, cz, 'blade', 0.8);
      this.beams.release(c.beam, 0.2);
      this.beams.release(c.beam2, 0.2);
      c.beam = c.beam2 = -1;
      // The cuts arrive on the release of the blade's still frame, one after another.
      const wait = c.mine ? 0.3 : 0.04;
      this.slashes(cx, cy, cz, Math.min(2.8, c.radius + 1), 14, wait);
      this.rayCrown(cx, c.ty, cz, 7, c.height * 1.6, 0.45, WHITE_HOT, BLUE, wait);
      this.groundShock(c.tx, c.ty, c.tz, 9, 0.6, BLUE_HOT);
      this.cameraNormal(cx, cy, cz);
      this.rings.spawn(cx, cy, cz, this.v.x, this.v.y, this.v.z, 4.5, 0.5, 0.45, BONE, wait);
      this.fx.hit(this.entry(c, 0.5), c.yaw, 'blade', { heavy: true });
      this.redDigits(cx, cy, cz, 5);
      this.lightAt(cx, cy, cz, LIGHT_WHITE, 8, 4);
    }
    // The crouch hold slows the world; the dash runs fast; between the cut and the sheath it all but stops.
    if (phase >= crouch && phase < dash) return windowScale(phase, crouch, dash, 0.35, 0.04);
    if (phase >= through && phase < sheath) return 0.15;
    return 1;
  }

  /** One dash of the katana's blitz: a razor line right through the boss at a new angle, and an afterimage where it ends. */
  private blitzDash(c: Crit, n: number, phaseLeft: number): void {
    const cy = c.ty + c.height * (0.3 + ((n * 0.37) % 0.45));
    const angle = c.yaw + n * 2.39996 + rand(-0.2, 0.2);
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const reach = c.radius + 2.8;
    const tilt = (n % 2 === 0 ? 1 : -1) * rand(0.4, 1.1);
    const ax = c.tx - dx * reach;
    const az = c.tz - dz * reach;
    const bx = c.tx + dx * reach;
    const bz = c.tz + dz * reach;
    // Held through the stillness (the world runs at 0.15 until the sheath), then gone with the cuts.
    const life = 0.06 + Math.max(0, phaseLeft) * CRITICAL_SECONDS * (c.mine ? 0.15 : 1);
    this.beams.spawn(ax, cy - tilt, az, bx, cy + tilt, bz, 0.05, life, WHITE_HOT);
    this.afterimage(c, bx, c.ty, bz);
    this.sparks(c.tx - dx * c.radius, cy, c.tz - dz * c.radius, dx, 0.2, dz, 0.6, (8 * this.spend) | 0, 9, WHITE_HOT, BLUE_HOT);
    this.flash(c.tx - dx * c.radius, cy, c.tz - dz * c.radius, 0.9, WHITE_HOT, 0.08);
    if (c.mine) this.psx.vhs.glitch(0.15);
  }

  /** A dark-blue leaning streak where the body was: cheaper than a copy of the pose, and reads as one. */
  private afterimage(c: Crit, x: number, y: number, z: number): void {
    this.v.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const side = this.v.x * c.fx + this.v.z * c.fz >= 0 ? 1 : -1;
    const s = this.pool.reset();
    s.sprite = SPRITE.glow;
    s.x = x; s.y = y + 0.85; s.z = z;
    s.size = 1.9;
    s.endSize = 1.6;
    s.aspect = 0.34;
    // Top tipped the way the body was going, as it leans flat into the dash.
    s.rotation = -side * 0.5;
    s.life = 1.1;
    s.alpha = 0.9;
    s.additive = 0;
    s.fadeOut = 0.25;
    paint(s, NIGHT_BLUE, NIGHT_BLUE);
    this.pool.emit();
    // A cold rim of light round the dark body, so it reads against a dark arena.
    s.size = 2.1;
    s.endSize = 1.7;
    s.aspect = 0.42;
    s.alpha = 0.85;
    s.additive = 1;
    paint(s, BLUE_HOT, BLUE);
    this.pool.emit();
    // A low speed line trailing each one.
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.wind;
    s.y = y + rand(0.4, 1.2);
    s.vx = c.fx * 3; s.vy = 0; s.vz = c.fz * 3;
    s.drag = 4;
    s.size = 0.12;
    s.endSize = 0.1;
    s.aspect = 14;
    s.rotation = 0;
    s.life = 0.8;
    s.alpha = 0.7;
    paint(s, BLUE_HOT, BLUE);
    this.pool.emit();
  }

  /** Crossing white cuts over a point, one after another, each with a few sparks. */
  private slashes(x: number, y: number, z: number, radius: number, count: number, wait: number): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      const delay = wait + i * 0.032;
      const ox = rand(-0.4, 0.4) * radius;
      const oy = rand(-0.5, 0.5) * radius;
      s.face = FACE_CAMERA;
      s.sprite = SPRITE.line;
      s.x = x + ox * 0.5; s.y = y + oy * 0.5; s.z = z;
      s.vx = s.vy = s.vz = 0;
      s.drag = 0;
      s.gravity = 0;
      s.delay = delay;
      s.size = 0.5;
      s.endSize = 0.05;
      s.aspect = 14;
      s.rotation = Math.random() * Math.PI;
      s.spin = 0;
      s.life = 0.25;
      s.alpha = 1;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 1;
      s.fadeIn = 0;
      s.fadeOut = 0.4;
      paint(s, WHITE_HOT, BLUE_HOT);
      this.pool.emit();
      for (let k = 0; k < 4; k += 1) {
        s.face = FACE_VELOCITY;
        s.sprite = SPRITE.streak;
        s.vx = rand(-6, 6); s.vy = rand(-3, 6); s.vz = rand(-6, 6);
        s.gravity = 8;
        s.drag = 2;
        s.size = 0.06;
        s.endSize = 0.02;
        s.aspect = 5;
        s.life = rand(0.25, 0.45);
        paint(s, WHITE_HOT, EMBER);
        this.pool.emit();
      }
    }
  }

  /* ---------- Longsword ---------- */

  private longsword(c: Crit, phase: number, real: number): number {
    const cock = mark(c.marks, 'cock', 0.48);
    const thrust = mark(c.marks, 'thrust', CRITICAL_IMPACT_AT);
    if (this.cross(c, phase, 'jab1', 0.3)) this.pierce(c, 0.55, -0.3);
    if (this.cross(c, phase, 'jab2', 0.38)) this.pierce(c, 0.65, 0.3);
    if (this.cross(c, phase, 'jab3', 0.46)) this.pierce(c, 0.45, 0);
    if (this.cross(c, phase, 'cock', 0.48)) {
      this.weapon(c);
      this.glint(this.tip.x, this.tip.y, this.tip.z, 0.9, 0);
      c.sigil = this.sigils.open(SIGIL_STAR, this.tip.x, this.tip.y, this.tip.z, 0.3, true, GOLD_HOT, GOLD);
    }
    if (phase >= cock && phase < thrust) {
      // The blade drinks in light while it is drawn back: gold lines converging on the point, a star growing on it.
      this.weapon(c);
      const k = (phase - cock) / Math.max(0.01, thrust - cock);
      this.sigils.place(c.sigil, this.tip.x, this.tip.y, this.tip.z);
      this.sigils.size(c.sigil, 0.3 + k * 1.1);
      this.converge(c, this.tip.x, this.tip.y, this.tip.z, real, 70, 2.4, GOLD_HOT, GOLD);
    }
    if (this.cross(c, phase, 'thrust', CRITICAL_IMPACT_AT)) {
      this.sigils.close(c.sigil, 0.1);
      c.sigil = -1;
      const e = this.entry(c, 0.5);
      // Out on the near face toward the camera, so the burst is not swallowed by the boss's body.
      this.cameraNormal(e.x, e.y, e.z);
      const ex = e.x + this.v.x * 0.5;
      const ey = e.y;
      const ez = e.z + this.v.z * 0.5;
      const far = c.radius * 2 + 7;
      // The thrust goes clean through and out the back.
      this.beams.spawn(ex - c.fx * 2.5, ey, ez - c.fz * 2.5, ex + c.fx * far, ey, ez + c.fz * far, 0.2, 0.6, WHITE_HOT);
      this.beams.spawn(ex - c.fx * 2, ey, ez - c.fz * 2, ex + c.fx * far, ey, ez + c.fz * far, 0.6, 0.45, GOLD);
      // The longsword's mark: a towering gold cross of light burned on the boss where the point went in.
      this.beams.spawn(ex, ey - 2.4, ez, ex, ey + 3.4, ez, 0.22, 0.9, GOLD_HOT);
      this.beams.spawn(ex - c.rx * 2.6, ey + 0.5, ez - c.rz * 2.6, ex + c.rx * 2.6, ey + 0.5, ez + c.rz * 2.6, 0.22, 0.9, GOLD_HOT);
      const star = this.sigils.open(SIGIL_STAR, ex, ey + 0.5, ez, 3.6, true, GOLD_HOT, WHITE_HOT);
      this.sigils.close(star, 0.7);
      // Sonic rings peeling back along the line of the lunge.
      for (let k = 0; k < 4; k += 1) {
        this.rings.spawn(ex - c.fx * k * 0.9, ey, ez - c.fz * k * 0.9, c.fx, 0, c.fz, 1.6 + k * 1.1, 0.35 + k * 0.08, 0.35, k === 0 ? WHITE_HOT : GOLD_HOT, k * 0.04);
      }
      this.cameraNormal(ex, ey, ez);
      this.rings.spawn(ex, ey + 0.5, ez, this.v.x, this.v.y, this.v.z, 5.5, 0.55, 0.6, GOLD);
      this.groundShock(ex, c.ty, ez, 10, 0.6, GOLD_HOT);
      // Gold spraying back out of the wound toward the attacker, and out of the far side.
      this.sparks(ex, ey, ez, -c.fx, 0.35, -c.fz, 0.7, (40 * this.spend) | 0, 16, WHITE_HOT, GOLD);
      const bx = e.x + c.fx * c.radius * 2;
      const bz = e.z + c.fz * c.radius * 2;
      this.sparks(bx, ey, bz, c.fx, 0.15, c.fz, 0.35, (36 * this.spend) | 0, 22, WHITE_HOT, GOLD);
      this.flash(ex, ey, ez, 3.4, WHITE_HOT, 0.16);
      this.fx.hit(e, c.yaw, 'thrust', { heavy: true });
      this.lightAt(ex, ey, ez, LIGHT_WHITE, 12, 3);
      this.blow(c, ex, ey, ez, 'blade', 0.9);
      if (c.mine) this.freeze(c, 0.08, 0.35, 0.35);
    }
    if (this.cross(c, phase, 'wrench', 0.7)) {
      // The blade torn free: the cross bursts in a last ring of gold.
      const e = this.entry(c, 0.5);
      this.cameraNormal(e.x, e.y, e.z);
      const ex = e.x + this.v.x * 0.5;
      const ez = e.z + this.v.z * 0.5;
      this.flash(ex, e.y + 0.5, ez, 2.2, GOLD_HOT, 0.12);
      this.rings.spawn(ex, e.y + 0.5, ez, this.v.x, this.v.y, this.v.z, 3.5, 0.4, 0.4, GOLD_HOT);
      this.sparks(ex, e.y, ez, -c.fx, 0.6, -c.fz, 0.9, (24 * this.spend) | 0, 10, GOLD_HOT, EMBER);
      this.embers(ex, e.y, ez, (18 * this.spend) | 0, 4);
      if (c.mine) this.cameraFx.shake(0.3);
    }
    return windowScale(phase, cock, thrust - 0.005, 0.45, 0.02);
  }

  /** Thin bright lines drawn in to a point from a shell of radius meters, rate per second. Uses c.carry. */
  private converge(c: Crit, x: number, y: number, z: number, real: number, rate: number, radius: number, hot: Rgb, cool: Rgb): void {
    c.carry += real * rate * this.spend;
    while (c.carry >= 1) {
      c.carry -= 1;
      const s = this.pool.reset();
      const u = Math.random() * 2 - 1;
      const angle = Math.random() * Math.PI * 2;
      const flat = Math.sqrt(1 - u * u);
      const r = radius * rand(0.65, 1);
      const ox = Math.cos(angle) * flat * r;
      const oy = u * r;
      const oz = Math.sin(angle) * flat * r;
      const life = 0.3;
      s.face = FACE_VELOCITY;
      s.sprite = SPRITE.streak;
      s.x = x + ox; s.y = y + oy; s.z = z + oz;
      s.vx = -ox / life; s.vy = -oy / life; s.vz = -oz / life;
      s.size = 0.04;
      s.endSize = 0.02;
      s.aspect = 9;
      s.life = life;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 1;
      s.fadeIn = 0.3;
      s.fadeOut = 0.7;
      paint(s, hot, cool);
      this.pool.emit();
    }
  }

  /** A small pierce flash on the boss's front, for each quick jab. */
  private pierce(c: Crit, share: number, side: number): void {
    const e = this.entry(c, share);
    const x = e.x + c.rx * side;
    const y = e.y;
    const z = e.z + c.rz * side;
    this.flash(x, y, z, 1, WHITE_HOT, 0.09);
    this.sparks(x, y, z, -c.fx, 0.3, -c.fz, 0.8, (10 * this.spend) | 0, 7, WHITE_HOT, GOLD);
    this.rings.spawn(x, y, z, c.fx, 0, c.fz, 1.1, 0.22, 0.2, BONE);
    this.fx.hit(e, c.yaw, 'thrust');
    if (c.mine) {
      this.cameraFx.shake(0.2);
      this.psx.vhs.glitch(0.2);
    }
  }

  /* ---------- Bows ---------- */

  private bow(c: Crit, phase: number, real: number): number {
    const drawn = mark(c.marks, 'drawn', 0.4);
    const slowmo = mark(c.marks, 'slowmo', drawn);
    const release = mark(c.marks, 'release', 0.52);
    const impact = mark(c.marks, 'impact', CRITICAL_IMPACT_AT);
    const f = this.feet(c);
    const hx = f.x + c.fx * 0.8;
    const hy = f.y + 1.45;
    const hz = f.z + c.fz * 0.8;
    if (this.cross(c, phase, 'drawn', 0.4)) {
      c.sigil = this.sigils.open(SIGIL_STAR, hx, hy, hz, 0.25, true, GOLD, GOLD);
    }
    if (phase >= drawn && phase < release) {
      // Gold gathering on the arrowhead: the star grows and thin lines converge on it.
      const k = (phase - drawn) / Math.max(0.01, release - drawn);
      this.sigils.place(c.sigil, hx, hy, hz);
      this.sigils.size(c.sigil, 0.25 + k * 0.5);
      c.carry += real * 45 * this.spend;
      while (c.carry >= 1) {
        c.carry -= 1;
        const s = this.pool.reset();
        const u = Math.random() * 2 - 1;
        const angle = Math.random() * Math.PI * 2;
        const flat = Math.sqrt(1 - u * u);
        const r = rand(1.4, 2.2);
        const ox = Math.cos(angle) * flat * r;
        const oy = u * r;
        const oz = Math.sin(angle) * flat * r;
        const life = 0.32;
        s.face = FACE_VELOCITY;
        s.sprite = SPRITE.streak;
        s.x = hx + ox; s.y = hy + oy; s.z = hz + oz;
        s.vx = -ox / life; s.vy = -oy / life; s.vz = -oz / life;
        s.size = 0.035;
        s.endSize = 0.02;
        s.aspect = 9;
        s.life = life;
        s.additive = 1;
        s.ignoreFog = true;
        s.minPixels = 1;
        s.fadeIn = 0.3;
        s.fadeOut = 0.7;
        paint(s, GOLD_HOT, GOLD);
        this.pool.emit();
      }
    }
    if (this.cross(c, phase, 'slowmo', drawn) && c.mine) {
      this.hush[0].seconds = Math.max(0.3, (impact - slowmo) * CRITICAL_SECONDS);
      this.psx.impact.play(this.hush);
    }
    if (phase >= slowmo && phase < impact) {
      // Long faint air lines streaming past: the feel of time dragging.
      c.carry2 += real * 30 * this.spend;
      while (c.carry2 >= 1) {
        c.carry2 -= 1;
        const s = this.pool.reset();
        const along = Math.random();
        const lateral = rand(-3, 3);
        s.face = FACE_VELOCITY;
        s.sprite = SPRITE.wind;
        s.x = hx + (c.tx - hx) * along + c.rx * lateral; s.y = hy + rand(-1.5, 2); s.z = hz + (c.tz - hz) * along + c.rz * lateral;
        s.vx = c.fx * 8; s.vy = 0; s.vz = c.fz * 8;
        s.size = 0.06;
        s.endSize = 0.06;
        s.aspect = 22;
        s.life = 0.5;
        s.alpha = 0.3;
        s.additive = 1;
        s.fadeIn = 0.3;
        paint(s, BONE, BONE);
        this.pool.emit();
      }
    }
    if (this.cross(c, phase, 'release', 0.52)) {
      // The arrow is now the effect's own bolt, flown straight to the boss.
      c.ax = hx; c.ay = hy; c.az = hz;
      c.bx = c.tx - c.fx * c.radius * 0.3;
      c.by = c.ty + c.height * 0.55;
      c.bz = c.tz - c.fz * c.radius * 0.3;
      this.v.set(c.bx - c.ax, c.by - c.ay, c.bz - c.az);
      c.moveTotal = Math.max(0.5, this.v.length());
      this.v.multiplyScalar(1 / c.moveTotal);
      c.dx = this.v.x; c.dy = this.v.y; c.dz = this.v.z;
      c.rings = 0;
      this.sigils.size(c.sigil, 0.32);
      c.beam = this.beams.spawn(hx - c.dx * 0.05, hy - c.dy * 0.05, hz - c.dz * 0.05, hx, hy, hz, 0.035, 0, GOLD_HOT);
      this.rings.spawn(hx, hy, hz, c.dx, c.dy, c.dz, 1.1, 0.5, 0.25, BONE);
      if (c.mine) this.cameraFx.shake(0.2);
    }
    if (phase >= release && phase < impact) this.flyArrow(c, (phase - release) / Math.max(0.01, impact - release));
    if (this.cross(c, phase, 'impact', CRITICAL_IMPACT_AT)) {
      this.sigils.close(c.sigil, 0.08);
      this.beams.release(c.beam, 0.25);
      c.sigil = c.beam = -1;
      c.steerWant = 0;
      const x = c.bx;
      const y = c.by;
      const z = c.bz;
      // Time snaps back: the hit lands on the near face, toward the camera, where it can be seen.
      this.cameraNormal(x, y, z);
      const nx = x + this.v.x * 0.6;
      const ny = y + this.v.y * 0.6;
      const nz = z + this.v.z * 0.6;
      this.blow(c, nx, ny, nz, 'arrow', 0.9);
      this.beams.spawn(x - c.dx * 1.4, y - c.dy * 1.4, z - c.dz * 1.4, x + c.dx * 9, y + c.dy * 9, z + c.dz * 9, 0.2, 0.4, WHITE_HOT);
      this.beams.spawn(x - c.dx, y - c.dy, z - c.dz, x + c.dx * 7, y + c.dy * 7, z + c.dz * 7, 0.6, 0.35, GOLD);
      const star = this.sigils.open(SIGIL_STAR, nx, ny, nz, 3, true, WHITE_HOT, GOLD_HOT);
      this.sigils.close(star, 0.45);
      this.rings.spawn(nx, ny, nz, this.v.x, this.v.y, this.v.z, 4.5, 0.45, 0.6, GOLD_HOT);
      this.rings.spawn(x, y, z, c.dx, c.dy, c.dz, 3.4, 0.5, 0.45, BONE, 0.04);
      // The air the arrow dragged with it slamming in behind: a cone of streaks blown back along its path.
      this.sparks(nx, ny, nz, -c.dx, -c.dy + 0.2, -c.dz, 0.55, (34 * this.spend) | 0, 14, WHITE_HOT, GOLD);
      const bx = x + c.dx * c.radius * 1.6;
      const by = y + c.dy * c.radius * 1.6;
      const bz = z + c.dz * c.radius * 1.6;
      this.sparks(bx, by, bz, c.dx, c.dy + 0.15, c.dz, 0.4, (40 * this.spend) | 0, 18, WHITE_HOT, GOLD);
      this.debris.burst(bx, by, bz, c.sy, (14 * this.spend) | 0, 2, 4, 0.06, 0.16, c.dx, c.dz, 9);
      this.flash(nx, ny, nz, 3.4, WHITE_HOT, 0.16);
      this.groundShock(x, c.ty, z, 8, 0.5, GOLD_HOT);
      this.fx.hit({ x, y, z }, c.yaw, 'arrow', { heavy: true });
      this.lightAt(nx, ny, nz, LIGHT_WHITE, 12, 3);
      if (c.mine) this.freeze(c, 0.06, 0.45, 0.25);
    }
    if (phase >= slowmo && phase < release) return windowScale(phase, slowmo, 2, 0.12, 0.04);
    if (phase >= release && phase < impact) {
      // Time all but stopped while the arrow crawls, then a snap back to full speed into the hit.
      const u = (phase - release) / Math.max(0.01, impact - release);
      const k = Math.max(0, (u - ARROW_CRAWL) / (1 - ARROW_CRAWL));
      return 0.04 + 0.96 * k * k;
    }
    return 1;
  }

  /** u is the share of the flight from release to impact. */
  private flyArrow(c: Crit, u: number): void {
    // Creeps the first stretch with the world held still, then covers the rest in a rush.
    const travelled = u < ARROW_CRAWL
      ? (u / ARROW_CRAWL) * ARROW_CRAWL_SHARE
      : ARROW_CRAWL_SHARE + (1 - ARROW_CRAWL_SHARE) * Math.pow((u - ARROW_CRAWL) / (1 - ARROW_CRAWL), 1.3);
    const dist = travelled * c.moveTotal;
    const x = c.ax + c.dx * dist;
    const y = c.ay + c.dy * dist;
    const z = c.az + c.dz * dist;
    this.sigils.place(c.sigil, x, y, z);
    // A gold contrail held from the bow all the way to the arrowhead.
    this.beams.move(c.beam, c.ax, c.ay, c.az, x, y, z);
    // Air rings peel off behind it every half meter, and hang there while time is stopped.
    while (c.rings * 0.3 + 0.3 <= dist && c.rings < 16) {
      c.rings += 1;
      const at = c.rings * 0.3;
      this.rings.spawn(c.ax + c.dx * at, c.ay + c.dy * at, c.az + c.dz * at, c.dx, c.dy, c.dz, 0.35 + (c.rings % 3) * 0.1, 0.5, 0.08, c.rings % 2 === 0 ? GOLD_HOT : BONE);
    }
    // A thin spiral wound round the flight line.
    const s = this.pool.reset();
    const upX = -c.dx * c.dy;
    const upY = 1 - c.dy * c.dy;
    const upZ = -c.dz * c.dy;
    for (let k = 0; k < 2; k += 1) {
      const angle = dist * 7 + k * Math.PI;
      const cos = Math.cos(angle) * 0.16;
      const sin = Math.sin(angle) * 0.16;
      s.sprite = SPRITE.glow;
      s.x = x + c.rx * cos + upX * sin; s.y = y + upY * sin; s.z = z + c.rz * cos + upZ * sin;
      s.size = 0.06;
      s.endSize = 0.02;
      s.life = 0.07;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 1;
      s.fadeOut = 0.4;
      paint(s, GOLD_HOT, GOLD);
      this.pool.emit();
    }
    // The arrow itself as a white-hot needle along the line of flight, a faint wake left hanging behind it.
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.streak;
    s.x = x - c.dx * 0.35; s.y = y - c.dy * 0.35; s.z = z - c.dz * 0.35;
    s.vx = c.dx * 0.01; s.vy = c.dy * 0.01; s.vz = c.dz * 0.01;
    s.size = 0.07;
    s.endSize = 0.05;
    s.aspect = 12;
    s.life = 0.03;
    s.alpha = 1;
    s.minPixels = 1.5;
    s.fadeOut = 0.6;
    paint(s, WHITE_HOT, GOLD_HOT);
    this.pool.emit();
    c.steerX = x; c.steerY = y; c.steerZ = z;
    c.steerWant = 0.55;
  }

  /* ---------- Spear ---------- */

  private spear(c: Crit, phase: number, real: number): number {
    const takeoff = mark(c.marks, 'takeoff', 0.28);
    const apex = mark(c.marks, 'apex', 0.45);
    const fall = mark(c.marks, 'fall', 0.53);
    if (this.cross(c, phase, 'takeoff', 0.28)) {
      const f = this.feet(c);
      this.dustRing(f.x, f.y, f.z, (24 * this.spend) | 0, 5, 0.4);
      this.rings.spawn(f.x, f.y + 0.1, f.z, 0, 1, 0, 3.2, 0.4, 0.4, BONE);
      // The cone of air pushed down and out under the leap.
      const s = this.pool.reset();
      const count = (18 * this.spend) | 0;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        s.face = FACE_VELOCITY;
        s.sprite = pick(SPRITE.wisps);
        s.x = f.x + Math.cos(angle) * 0.3; s.y = f.y + 0.9; s.z = f.z + Math.sin(angle) * 0.3;
        s.vx = Math.cos(angle) * 5; s.vy = -3.5; s.vz = Math.sin(angle) * 5;
        s.drag = 2.5;
        s.size = 0.2;
        s.endSize = 0.3;
        s.aspect = 6;
        s.life = 0.45;
        s.alpha = 0.6;
        s.additive = 1;
        paint(s, BONE, DUST_LIGHT);
        this.pool.emit();
      }
    }
    if (phase >= takeoff && phase < apex) {
      const f = this.feet(c);
      c.carry += real * 30 * this.spend;
      while (c.carry >= 1) {
        c.carry -= 1;
        const s = this.pool.reset();
        const angle = Math.random() * Math.PI * 2;
        s.face = FACE_VELOCITY;
        s.sprite = SPRITE.wind;
        s.x = f.x + Math.cos(angle) * 0.7; s.y = f.y + rand(0, 1.8); s.z = f.z + Math.sin(angle) * 0.7;
        s.vx = 0; s.vy = -7; s.vz = 0;
        s.size = 0.07;
        s.endSize = 0.05;
        s.aspect = 12;
        s.life = 0.3;
        s.alpha = 0.5;
        s.additive = 1;
        paint(s, BONE, BONE);
        this.pool.emit();
      }
    }
    if (this.cross(c, phase, 'apex', 0.45)) {
      this.weapon(c);
      this.glint(this.tip.x, this.tip.y, this.tip.z, 1.1, 0);
    }
    if (this.cross(c, phase, 'fall', 0.53)) {
      this.weapon(c);
      const gx = this.tip.x + c.fx * 0.6;
      const gz = this.tip.z + c.fz * 0.6;
      this.beams.spawn(gx, this.tip.y + 1.5, gz, gx, c.sy, gz, 0.15, 0.45, WHITE_HOT);
      this.beams.spawn(gx, this.tip.y + 1.5, gz, gx, c.sy, gz, 0.45, 0.35, EMBER_HOT);
    }
    if (phase >= apex && phase < mark(c.marks, 'plunge', CRITICAL_IMPACT_AT)) {
      // White light pulled down the shaft into the point as it comes down.
      this.weapon(c);
      this.converge(c, this.tip.x, this.tip.y, this.tip.z, real, 60, 2, WHITE_HOT, BLUE_HOT);
    }
    if (this.cross(c, phase, 'plunge', CRITICAL_IMPACT_AT)) {
      this.weapon(c);
      let x = this.tip.x;
      let z = this.tip.z;
      const ddx = x - c.sx;
      const ddz = z - c.sz;
      if (!(ddx * ddx + ddz * ddz < 49)) {
        const e = this.entry(c, 0);
        x = e.x;
        z = e.z;
      }
      // Kept on the near side of the boss's front, or its body would swallow the burst.
      const along = (x - c.sx) * c.fx + (z - c.sz) * c.fz;
      const front = (c.tx - c.sx) * c.fx + (c.tz - c.sz) * c.fz - c.radius - 0.4;
      if (along > front) {
        x -= c.fx * (along - front);
        z -= c.fz * (along - front);
      }
      const y = c.sy;
      // The spear's mark: a lance of white light driven down from the sky through the point, and a
      // crown of rays bursting up out of the ground round it, with a star-shaped crack beneath.
      this.beams.spawn(x, y + 30, z, x, y - 0.2, z, 0.35, 0.55, WHITE_HOT);
      this.beams.spawn(x, y + 30, z, x, y - 0.2, z, 1.1, 0.45, BLUE_HOT);
      this.rayCrown(x, y, z, 13, 7.5, 0.6, WHITE_HOT, BLUE, 0);
      this.rayCrown(x, y, z, 7, 4.5, 0.8, GOLD_HOT, EMBER, 0.08);
      this.decals.place(DECAL_CRATER, x, y, z, c.yaw, 2.4, 2.4, 7, 2.5);
      for (let k = 0; k < 3; k += 1) {
        const a = c.yaw + (k / 3) * Math.PI * 2 + 0.5;
        this.decals.place(DECAL_FISSURE, x + Math.sin(a) * 3, y, z + Math.cos(a) * 3, a, 0.7, 3, 6, 2);
      }
      this.rings.spawn(x, y + 0.1, z, 0, 1, 0, 11, 0.5, 0.8, WHITE_HOT);
      this.rings.spawn(x, y + 0.1, z, 0, 1, 0, 16, 0.85, 0.6, BLUE_HOT, 0.06);
      this.groundShock(x, y, z, 13, 0.7, BLUE_HOT);
      this.domes.spawn(x, y, z, 5, 0.5, BLUE_HOT);
      this.flash(x, y + 0.8, z, 5, WHITE_HOT, 0.16);
      this.dustWall(x, y, z, 0.75);
      this.debris.burst(x, y + 0.3, z, y, (30 * this.spend) | 0, 6, 11, 0.1, 0.28, 0, 0, 0, 0.1);
      this.sparks(x, y + 0.3, z, 0, 1, 0, 0.7, (40 * this.spend) | 0, 16, WHITE_HOT, BLUE_HOT);
      this.lightAt(x, y + 1.5, z, LIGHT_WHITE, 16, 2.5);
      const e = this.entry(c, 0.45);
      this.fx.hit(e, c.yaw, 'thrust', { heavy: true });
      this.blow(c, x, y + 0.5, z, 'heavy', 0.9);
      if (c.mine) {
        this.freeze(c, 0.1, 0.3, 0.4);
        c.rumbleLeft = 0.3;
        this.cameraFx.pushIn(0.15);
      }
    }
    if (this.cross(c, phase, 'land', 0.65)) {
      const f = this.feet(c);
      this.dustRing(f.x, f.y, f.z, (14 * this.spend) | 0, 3, 0.35);
    }
    if (phase >= apex - 0.03 && phase < fall) return windowScale(phase, apex - 0.03, fall, 0.3, 0.03);
    return 1;
  }

  /* ---------- Magic staff ---------- */

  private staff(c: Crit, phase: number, real: number): number {
    const rise = mark(c.marks, 'rise', 0.2);
    const gather = mark(c.marks, 'gather', 0.35);
    const burst = mark(c.marks, 'burst', CRITICAL_IMPACT_AT);
    const groundY = c.sy;
    const skyY = groundY + 9;
    if (phase >= rise && phase < burst) {
      // Gold and blue ribbons winding up round the floating caster, and motes pulled in.
      const f = this.feet(c);
      c.ribbonY += real * 2.2;
      if (c.ribbonA < 0 || c.ribbonY > 3.2) {
        this.ribbons.release(c.ribbonA);
        this.ribbons.release(c.ribbonB);
        c.ribbonY = 0;
        c.ribbonA = this.ribbons.open(f.x, f.y, f.z, 1, 0.09, 0.12);
        c.ribbonB = this.ribbons.open(f.x, f.y, f.z, 0, 0.09, 0.12);
      }
      const angle = c.real * 7;
      const radius = 0.95 - c.ribbonY * 0.12;
      const y = f.y + 0.1 + c.ribbonY;
      this.ribbons.move(c.ribbonA, f.x + Math.cos(angle) * radius, y, f.z + Math.sin(angle) * radius);
      this.ribbons.move(c.ribbonB, f.x - Math.cos(angle) * radius, y, f.z - Math.sin(angle) * radius);
      c.carry += real * 50 * this.spend;
      while (c.carry >= 1) {
        c.carry -= 1;
        const s = this.pool.reset();
        const a = Math.random() * Math.PI * 2;
        const r = rand(3, 6);
        const ox = Math.cos(a) * r;
        const oy = rand(-0.5, 3);
        const oz = Math.sin(a) * r;
        const life = rand(0.6, 0.9);
        s.sprite = SPRITE.glow;
        s.x = f.x + ox; s.y = f.y + 1.3 + oy; s.z = f.z + oz;
        s.vx = -ox / life; s.vy = -oy / life; s.vz = -oz / life;
        s.size = rand(0.08, 0.15);
        s.endSize = 0.05;
        s.life = life;
        s.additive = 1;
        s.ignoreFog = true;
        s.minPixels = 1.5;
        s.fadeIn = 0.3;
        if (Math.random() < 0.5) paint(s, GOLD_HOT, GOLD);
        else paint(s, BLUE_HOT, BLUE);
        this.pool.emit();
      }
    }
    if (this.cross(c, phase, 'gather', 0.35)) {
      c.sigil = this.sigils.open(SIGIL_GALAXY, c.tx, skyY, c.tz, 1, false, GOLD, BLUE);
      this.sigils.orient(c.sigil, 1, 0, 0, 0, 0, 1);
      c.sigil2 = this.sigils.open(SIGIL_STAR, c.tx, skyY, c.tz, 1, true, WHITE_HOT, GOLD);
      c.decal = this.decals.place(DECAL_WARNING, c.tx, c.ty, c.tz, c.yaw, 3.4, 3.4, 0, 0.3);
      this.weapon(c);
      c.beam = this.beams.spawn(this.tip.x, this.tip.y, this.tip.z, c.tx, skyY, c.tz, 0.06, 0, BLUE_HOT);
      this.lightAt(c.tx, skyY, c.tz, LIGHT_ARCANE, 4, 0.5);
    }
    if (phase >= gather && phase < burst) {
      const k = (phase - gather) / Math.max(0.01, burst - gather);
      this.sigils.size(c.sigil, 1.5 + k * 6);
      this.sigils.progress(c.sigil, k);
      this.sigils.size(c.sigil2, 0.8 + k * k * 3.2);
      this.decals.setProgress(c.decal, k);
      this.weapon(c);
      this.beams.move(c.beam, this.tip.x, this.tip.y, this.tip.z, c.tx, skyY, c.tz);
      // Look up toward the gathering sky without losing the boss.
      c.steerX = c.tx; c.steerY = groundY + 4.5; c.steerZ = c.tz;
      c.steerWant = 0.45;
    }
    if (this.cross(c, phase, 'burst', CRITICAL_IMPACT_AT)) this.staffBurst(c, groundY);
    if (this.cross(c, phase, 'land', 0.69)) {
      const f = this.feet(c);
      this.dustRing(f.x, f.y, f.z, (16 * this.spend) | 0, 3, 0.35);
    }
    return 1;
  }

  private staffBurst(c: Crit, groundY: number): void {
    const x = c.tx;
    const z = c.tz;
    this.sigils.close(c.sigil, 0.2);
    this.sigils.close(c.sigil2, 0.12);
    this.beams.release(c.beam, 0.1);
    this.decals.release(c.decal, 0.2);
    c.sigil = c.sigil2 = c.beam = c.decal = -1;
    c.steerWant = 0;
    // The pillar: a wide blue column with a white core, sky to ground.
    this.beams.spawn(x, groundY + 40, z, x, groundY - 0.2, z, 3, 1.1, BLUE);
    this.beams.spawn(x, groundY + 40, z, x, groundY - 0.2, z, 1.2, 0.8, GOLD_HOT);
    this.rings.spawn(x, groundY + 0.1, z, 0, 1, 0, 9, 0.5, 0.7, GOLD_HOT);
    this.rings.spawn(x, groundY + 0.1, z, 0, 1, 0, 13, 0.8, 0.55, BLUE_HOT, 0.06);
    this.rings.spawn(x, groundY + 0.1, z, 0, 1, 0, 18, 1.15, 0.45, BONE, 0.14);
    this.domes.spawn(x, groundY, z, 7, 0.9, BLUE);
    this.flash(x, groundY + 1.5, z, 6, WHITE_HOT, 0.2);
    this.lightAt(x, groundY + 3, z, LIGHT_ARCANE, 18, 1.5);
    // A ring of smaller star strikes landing round it.
    const s = this.pool.reset();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(5, 8);
      const px = x + Math.cos(angle) * r;
      const pz = z + Math.sin(angle) * r;
      const delay = rand(0.12, 0.6);
      s.x = px; s.y = groundY + 0.4; s.z = pz;
      s.delay = delay;
      s.sprite = pick(SPRITE.impacts);
      s.face = FACE_CAMERA;
      s.size = 1;
      s.endSize = 2.2;
      s.rotation = Math.random() * 6;
      s.life = 0.2;
      s.additive = 1;
      s.ignoreFog = true;
      s.fadeOut = 0.3;
      paint(s, WHITE_HOT, GOLD);
      this.pool.emit();
      s.face = FACE_GROUND;
      s.sprite = SPRITE.ring;
      s.y = groundY + 0.08;
      s.size = 0.4;
      s.endSize = 3.2;
      s.life = 0.45;
      s.alpha = 0.9;
      paint(s, BLUE_HOT, BLUE);
      this.pool.emit();
      s.face = FACE_BASE;
      s.sprite = SPRITE.ray;
      s.y = groundY;
      s.size = 3.2;
      s.endSize = 4;
      s.aspect = 0.3;
      s.rotation = 0;
      s.life = 0.3;
      s.alpha = 1;
      paint(s, GOLD_HOT, BLUE);
      this.pool.emit();
      s.aspect = 1;
    }
    // Embers and tiny blue and gold digits left hanging in the air for a few seconds.
    const count = (46 * this.spend) | 0;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 5;
      s.face = i % 5 === 0 ? FACE_DIGIT_TINT : FACE_CAMERA;
      s.sprite = SPRITE.glow;
      s.x = x + Math.cos(angle) * r; s.y = groundY + rand(0.3, 3.5); s.z = z + Math.sin(angle) * r;
      s.vx = rand(-0.4, 0.4); s.vy = rand(0.2, 0.8); s.vz = rand(-0.4, 0.4);
      s.delay = rand(0, 0.5);
      s.drag = 0.8;
      s.gravity = 0;
      s.size = s.face === FACE_DIGIT_TINT ? 0.13 : rand(0.06, 0.11);
      s.endSize = s.size * 0.6;
      s.rotation = 0;
      s.life = rand(2.4, 3.2);
      s.additive = 1;
      s.alpha = 1;
      s.extra = 0.5;
      s.minPixels = s.face === FACE_DIGIT_TINT ? 3 : 1;
      s.ignoreFog = true;
      s.fadeIn = 0.1;
      s.fadeOut = 0.6;
      if (i % 2 === 0) paint(s, GOLD_HOT, GOLD);
      else paint(s, BLUE_HOT, BLUE);
      this.pool.emit();
    }
    this.debris.burst(x, groundY + 0.3, z, groundY, (14 * this.spend) | 0, 5, 7, 0.1, 0.24);
    const e = this.entry(c, 0.5);
    this.fx.hit(e, c.yaw, 'magic', { heavy: true });
    this.blow(c, x, groundY + 1.5, z, 'magic', 1);
    if (c.mine) {
      this.freeze(c, 0.1, 0.35, 0.4);
      c.rumbleLeft = 0.3;
    }
  }

  /* ---------- Wand and tome ---------- */

  private wand(c: Crit, phase: number, real: number): number {
    const circle = mark(c.marks, 'circle', 0.22);
    const burst = mark(c.marks, 'burst', CRITICAL_IMPACT_AT);
    const drawEnd = Math.min(burst - 0.1, circle + 0.24);
    const f = this.feet(c);
    // The tome, held open in front of the chest on the left.
    const bookX = f.x + c.fx * 0.45 - c.rx * 0.2;
    const bookY = f.y + 1.25;
    const bookZ = f.z + c.fz * 0.45 - c.rz * 0.2;
    if (this.cross(c, phase, 'book', 0.2)) {
      const s = this.pool.reset();
      const count = (12 * this.spend + 2) | 0;
      for (let i = 0; i < count; i += 1) {
        const fan = (i / Math.max(1, count - 1) - 0.5) * 2.4;
        s.sprite = SPRITE.glow;
        s.x = bookX; s.y = bookY + 0.1; s.z = bookZ;
        s.vx = (c.rx * Math.sin(fan) + c.fx * 0.3) * 2.6; s.vy = Math.cos(fan) * 2.4; s.vz = (c.rz * Math.sin(fan) + c.fz * 0.3) * 2.6;
        s.drag = 2.6;
        s.size = 0.26;
        s.endSize = 0.16;
        s.aspect = 0.72;
        s.rotation = fan;
        s.spin = rand(-1.5, 1.5);
        s.life = rand(1.3, 1.8);
        s.additive = 1;
        s.ignoreFog = true;
        s.fadeIn = 0.1;
        s.fadeOut = 0.55;
        paint(s, GOLD_HOT, GOLD);
        this.pool.emit();
      }
      this.flash(bookX, bookY, bookZ, 0.8, GOLD_HOT, 0.2);
    }
    if (this.cross(c, phase, 'circle', 0.22)) {
      c.cx = f.x + c.fx * 0.8; c.cy = f.y + 1.45; c.cz = f.z + c.fz * 0.8;
      c.cn = 0;
      c.sigil = this.sigils.open(SIGIL_RUNE, c.cx, c.cy, c.cz, 0.65, false, GOLD, BLUE);
      this.sigils.orient(c.sigil, c.rx, 0, c.rz, 0, 1, 0);
    }
    if (phase >= circle && phase < burst) {
      this.weapon(c);
      if (phase < drawEnd) {
        // The circle follows where the tip actually went, and gold hangs where it passed.
        c.cn += 1;
        const blend = 1 / c.cn;
        c.cx += (this.tip.x - c.cx) * blend;
        c.cy += (this.tip.y - c.cy) * blend;
        c.cz += (this.tip.z - c.cz) * blend;
        const s = this.pool.reset();
        s.sprite = SPRITE.glow;
        s.x = this.tip.x; s.y = this.tip.y; s.z = this.tip.z;
        s.size = 0.12;
        s.endSize = 0.05;
        s.life = 0.6;
        s.additive = 1;
        s.ignoreFog = true;
        s.minPixels = 1.5;
        paint(s, GOLD_HOT, GOLD);
        this.pool.emit();
      }
      const k = Math.min(1, (phase - circle) / Math.max(0.01, drawEnd - circle));
      this.sigils.progress(c.sigil, k);
      // Once drawn, the circle swells and is pushed out toward the boss, charging for the beam.
      const swell = smooth((phase - drawEnd) / Math.max(0.01, burst - drawEnd));
      const px = c.cx + c.fx * swell * 0.8;
      const py = c.cy + swell * 0.35;
      const pz = c.cz + c.fz * swell * 0.8;
      this.sigils.place(c.sigil, px, py, pz);
      this.sigils.size(c.sigil, 0.65 + swell * 1.9);
      if (phase >= drawEnd) {
        const blue = swell > 0.5;
        this.converge(c, px, py, pz, real, 90, 3 + swell * 2, blue ? BLUE_HOT : GOLD_HOT, blue ? BLUE : GOLD);
      }
    }
    // The barrage: bolts loosed while the circle finishes, all of them landing before the beam.
    const barrage = Math.min(burst - 0.12, circle + 0.1);
    if (this.cross(c, phase, 'barrage', barrage)) this.launchBolts(c, (burst - barrage) * CRITICAL_SECONDS);
    if (this.cross(c, phase, 'burst', CRITICAL_IMPACT_AT)) {
      this.sigils.progress(c.sigil, 1);
      c.cx += c.fx * 0.8; c.cy += 0.35; c.cz += c.fz * 0.8;
      this.sigils.place(c.sigil, c.cx, c.cy, c.cz);
      this.wandBurst(c);
    }
    if (this.cross(c, phase, 'close', 0.75)) {
      c.moveTotal = c.moveLeft = 0.25;
      c.ax = c.cx; c.ay = c.cy; c.az = c.cz;
    }
    if (c.moveLeft > 0 && c.sigil >= 0) {
      // The circle folds back into the tome.
      c.moveLeft = Math.max(0, c.moveLeft - real);
      const k = smooth(1 - c.moveLeft / c.moveTotal);
      this.sigils.place(c.sigil, c.ax + (bookX - c.ax) * k, c.ay + (bookY - c.ay) * k, c.az + (bookZ - c.az) * k);
      this.sigils.size(c.sigil, 2.55 * (1 - k) + 0.02);
      if (c.moveLeft === 0) {
        this.sigils.free(c.sigil);
        c.sigil = -1;
        this.flash(bookX, bookY, bookZ, 0.9, GOLD_HOT, 0.18);
        this.sparks(bookX, bookY, bookZ, 0, 1, 0, 0.8, 8, 2.5, GOLD_HOT, GOLD);
      }
    }
    return 1;
  }

  /** Fires the wand's barrage so that the last bolt lands within `window` seconds. */
  private launchBolts(c: Crit, window: number): void {
    const count = 16;
    c.volley = 0;
    const spread = Math.max(0.05, window - 0.34);
    for (let i = 0; i < count; i += 1) {
      let bolt: Bolt | null = null;
      for (const b of this.bolts) if (!b.active) { bolt = b; break; }
      if (!bolt) break;
      const angle = (i / count) * Math.PI * 2 * 3;
      bolt.active = true;
      bolt.owner = c.id;
      bolt.age = 0;
      bolt.delay = (i / (count - 1)) * spread;
      bolt.flight = rand(0.24, 0.32);
      bolt.hue = i % 2;
      bolt.x0 = c.cx + c.rx * Math.cos(angle) * 0.55; bolt.y0 = c.cy + Math.sin(angle) * 0.55; bolt.z0 = c.cz + c.rz * Math.cos(angle) * 0.55;
      // A bend out to the side, so the storm fans out before it homes in.
      const side = rand(-3, 3);
      bolt.x1 = bolt.x0 + c.fx * 2 + c.rx * side; bolt.y1 = bolt.y0 + rand(-0.4, 2.6); bolt.z1 = bolt.z0 + c.fz * 2 + c.rz * side;
      bolt.x2 = c.tx - c.fx * c.radius * 0.8 + rand(-0.7, 0.7); bolt.y2 = c.ty + c.height * rand(0.3, 0.75); bolt.z2 = c.tz - c.fz * c.radius * 0.8 + rand(-0.7, 0.7);
      c.volley += 1;
    }
  }

  private updateBolts(seconds: number): void {
    for (let i = 0; i < MAX_BOLTS; i += 1) {
      const b = this.bolts[i];
      if (!b.active) continue;
      b.age += seconds;
      const t = (b.age - b.delay) / b.flight;
      if (t < 0) continue;
      const k = Math.min(1, t);
      const m = 1 - k;
      const x = m * m * b.x0 + 2 * m * k * b.x1 + k * k * b.x2;
      const y = m * m * b.y0 + 2 * m * k * b.y1 + k * k * b.y2;
      const z = m * m * b.z0 + 2 * m * k * b.z1 + k * k * b.z2;
      const hot = b.hue === 0 ? GOLD_HOT : BLUE_HOT;
      const cool = b.hue === 0 ? GOLD : BLUE;
      const s = this.pool.reset();
      s.sprite = SPRITE.glow;
      s.x = x; s.y = y; s.z = z;
      s.size = 0.4;
      s.endSize = 0.12;
      s.life = 0.07;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 2;
      paint(s, WHITE_HOT, hot);
      this.pool.emit();
      s.size = 0.18;
      s.endSize = 0.02;
      s.life = 0.4;
      s.minPixels = 1;
      paint(s, hot, cool);
      this.pool.emit();
      if (t < 1) continue;
      b.active = false;
      this.sparks(x, y, z, 0, 0.3, 0, 1, 6, 6, hot, cool);
      this.flash(x, y, z, 1.1, hot, 0.1);
      const owner = this.crits[b.owner % MAX_CRITS];
      if (owner.id !== b.owner) continue;
      owner.volley -= 1;
      if (owner.mine) this.cameraFx.shake(0.08);
    }
  }

  /** The wand's finisher: the swollen rune circle fires one enormous gold and blue beam through the boss. */
  private wandBurst(c: Crit): void {
    const sx = c.cx;
    const sy = c.cy;
    const sz = c.cz;
    const e = this.entry(c, 0.5);
    const ex = e.x;
    const ey = e.y;
    const ez = e.z;
    const fx = c.tx + c.fx * (c.radius + 9);
    const fz = c.tz + c.fz * (c.radius + 9);
    const fy = ey + (ey - sy) * 0.4;
    this.beams.spawn(sx, sy, sz, fx, fy, fz, 1.7, 0.85, BLUE);
    this.beams.spawn(sx, sy, sz, fx, fy, fz, 0.8, 0.75, GOLD_HOT);
    this.beams.spawn(sx, sy, sz, fx, fy, fz, 0.25, 0.65, WHITE_HOT);
    // Rings thrown off the muzzle and down the beam.
    for (let k = 0; k < 4; k += 1) {
      const t = k / 4;
      this.rings.spawn(sx + (ex - sx) * t, sy + (ey - sy) * t, sz + (ez - sz) * t, c.fx, 0, c.fz, 2.6 + k * 0.7, 0.45, 0.4, k % 2 === 0 ? GOLD_HOT : BLUE_HOT, k * 0.04);
    }
    this.flash(sx, sy, sz, 3, WHITE_HOT, 0.14);
    // The blast where it meets the boss, out on the near face so the body does not hide it.
    this.cameraNormal(ex, ey, ez);
    const nx = ex + this.v.x * 0.8;
    const ny = ey;
    const nz = ez + this.v.z * 0.8;
    const galaxy = this.sigils.open(SIGIL_GALAXY, nx, ny, nz, 4.5, true, GOLD, BLUE);
    this.sigils.progress(galaxy, 1);
    this.sigils.close(galaxy, 0.9);
    this.flash(nx, ny, nz, 6, WHITE_HOT, 0.2);
    this.rings.spawn(nx, ny, nz, this.v.x, this.v.y, this.v.z, 8, 0.55, 0.7, GOLD_HOT);
    this.rings.spawn(c.tx, c.ty + 0.1, c.tz, 0, 1, 0, 14, 0.8, 0.6, BLUE_HOT, 0.05);
    this.groundShock(c.tx, c.ty, c.tz, 14, 0.7, GOLD_HOT);
    this.domes.spawn(c.tx, c.ty, c.tz, 7.5, 0.8, BLUE);
    this.domes.spawn(c.tx, c.ty, c.tz, 4.5, 0.55, GOLD);
    this.rayCrown(c.tx, c.ty, c.tz, 11, 9, 0.7, GOLD_HOT, BLUE, 0);
    this.sparks(nx, ny, nz, -c.fx, 0.5, -c.fz, 1, (50 * this.spend) | 0, 14, GOLD_HOT, BLUE);
    this.arcaneMotes(c.tx, c.ty, c.tz, 5, (40 * this.spend) | 0);
    this.fx.hit(e, c.yaw, 'magic', { heavy: true });
    this.lightAt(nx, ny, nz, LIGHT_ARCANE, 18, 1.8);
    this.blow(c, nx, ny, nz, 'magic', 1);
    if (c.mine) {
      this.freeze(c, 0.1, 0.35, 0.4);
      c.rumbleLeft = 0.35;
    }
  }

  /** Gold and blue embers hanging in the air round a point, with only a few small matching digits among them. */
  private arcaneMotes(x: number, groundY: number, z: number, radius: number, count: number): void {
    const s = this.pool.reset();
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const digit = i % 5 === 0;
      s.face = digit ? FACE_DIGIT_TINT : FACE_CAMERA;
      s.sprite = SPRITE.glow;
      s.x = x + Math.cos(angle) * r; s.y = groundY + rand(0.3, 4); s.z = z + Math.sin(angle) * r;
      s.vx = rand(-0.5, 0.5); s.vy = rand(0.2, 1); s.vz = rand(-0.5, 0.5);
      s.delay = rand(0, 0.4);
      s.drag = 0.8;
      s.size = digit ? 0.11 : rand(0.07, 0.13);
      s.endSize = s.size * 0.6;
      s.life = rand(2, 3);
      s.additive = 1;
      s.extra = 0.5;
      s.minPixels = digit ? 3 : 1;
      s.ignoreFog = true;
      s.fadeIn = 0.1;
      s.fadeOut = 0.6;
      if (i % 2 === 0) paint(s, GOLD_HOT, GOLD);
      else paint(s, BLUE_HOT, BLUE);
      this.pool.emit();
    }
  }

  /* ---------- Quarterstaff ---------- */

  private quarterstaff(c: Crit, phase: number, real: number, game: number): number {
    const spin = mark(c.marks, 'spin', 0.2);
    const caught = mark(c.marks, 'catch', 0.47);
    const burst = mark(c.marks, 'burst', CRITICAL_IMPACT_AT);
    if (phase >= spin && phase < caught) {
      // Both ends of the staff trace their own ring of light.
      this.weapon(c);
      if (c.last < spin) {
        this.fx.beginTrail(c.trail, 'magic');
        this.fx.beginTrail(c.trail2, 'magic');
      }
      const mx = (this.tip.x + this.base.x) * 0.5;
      const my = (this.tip.y + this.base.y) * 0.5;
      const mz = (this.tip.z + this.base.z) * 0.5;
      this.v.set(this.tip.x + (mx - this.tip.x) * 0.2, this.tip.y + (my - this.tip.y) * 0.2, this.tip.z + (mz - this.tip.z) * 0.2);
      this.fx.pushTrail(c.trail, this.tip, this.v);
      this.offset.set(this.base.x + (mx - this.base.x) * 0.2, this.base.y + (my - this.base.y) * 0.2, this.base.z + (mz - this.base.z) * 0.2);
      this.fx.pushTrail(c.trail2, this.base, this.offset);
      // Gold off one end and blue off the other, flung out by the spin.
      c.carry += real * 50 * this.spend;
      while (c.carry >= 1) {
        c.carry -= 1;
        const gold = Math.random() < 0.5;
        const s = this.pool.reset();
        s.sprite = SPRITE.glow;
        s.x = gold ? this.tip.x : this.base.x; s.y = gold ? this.tip.y : this.base.y; s.z = gold ? this.tip.z : this.base.z;
        s.vx = rand(-1.5, 1.5); s.vy = rand(-0.5, 1.5); s.vz = rand(-1.5, 1.5);
        s.drag = 2;
        s.size = rand(0.1, 0.18);
        s.endSize = 0.03;
        s.life = rand(0.4, 0.7);
        s.additive = 1;
        s.ignoreFog = true;
        s.minPixels = 1.5;
        if (gold) paint(s, GOLD_HOT, GOLD);
        else paint(s, BLUE_HOT, BLUE);
        this.pool.emit();
      }
    } else if (c.last >= spin && c.last < caught) {
      this.fx.endTrail(c.trail);
      this.fx.endTrail(c.trail2);
    }
    if (this.cross(c, phase, 'catch', 0.47)) {
      this.weapon(c);
      this.glint(this.tip.x, this.tip.y, this.tip.z, 0.9, 0);
    }
    if (this.cross(c, phase, 'burst', CRITICAL_IMPACT_AT)) {
      // A wide flat crescent of blue-gold light sweeping through the boss and on past it.
      const y = c.sy + 1.1;
      c.ax = c.sx + c.fx * 1.2; c.ay = y; c.az = c.sz + c.fz * 1.2;
      const dx = c.tx - c.sx;
      const dz = c.tz - c.sz;
      c.moveTotal = Math.sqrt(dx * dx + dz * dz) + c.radius + 15;
      c.moveLeft = 0.6;
      // Two wide flat crescents, gold then blue, sweeping through the boss and on past it.
      c.sigil = this.sigils.open(SIGIL_CRESCENT, c.ax, y, c.az, 7, false, GOLD_HOT, BLUE);
      // Standing up across the line of the swing and tilted like the stroke, so a camera behind sees the whole arc.
      this.sigils.orient(c.sigil, c.rx * 0.94, 0.34, c.rz * 0.94, -c.rx * 0.34, 0.94, -c.rz * 0.34);
      this.sigils.size(c.sigil, 7.5, 4.2);
      c.sigil2 = this.sigils.open(SIGIL_CRESCENT, c.ax, y + 0.9, c.az, 5, false, BLUE_HOT, GOLD);
      this.sigils.orient(c.sigil2, c.rx * 0.94, -0.34, c.rz * 0.94, c.rx * 0.34, 0.94, c.rz * 0.34);
      this.sigils.size(c.sigil2, 6, 3.4);
      const e = this.entry(c, 0.45);
      this.cameraNormal(e.x, e.y, e.z);
      const nx = e.x + this.v.x * 0.7;
      const ny = e.y;
      const nz = e.z + this.v.z * 0.7;
      const galaxy = this.sigils.open(SIGIL_GALAXY, nx, ny, nz, 4, true, GOLD, BLUE);
      this.sigils.progress(galaxy, 1);
      this.sigils.close(galaxy, 0.8);
      this.flash(nx, ny, nz, 5, WHITE_HOT, 0.18);
      this.sparks(nx, ny, nz, c.fx, 0.3, c.fz, 0.8, (44 * this.spend) | 0, 16, GOLD_HOT, BLUE);
      this.rings.spawn(nx, ny, nz, this.v.x, this.v.y, this.v.z, 7, 0.5, 0.65, BLUE_HOT);
      this.rings.spawn(c.tx, c.ty + 0.1, c.tz, 0, 1, 0, 13, 0.75, 0.6, GOLD_HOT, 0.05);
      this.groundShock(c.tx, c.ty, c.tz, 13, 0.7, BLUE_HOT);
      this.domes.spawn(c.tx, c.ty, c.tz, 6.5, 0.7, BLUE);
      this.rayCrown(c.tx, c.ty, c.tz, 9, 8, 0.6, GOLD_HOT, BLUE, 0.03);
      this.arcaneMotes(c.tx, c.ty, c.tz, 5, (34 * this.spend) | 0);
      this.fx.hit(e, c.yaw, 'magic', { heavy: true });
      this.lightAt(nx, ny, nz, LIGHT_ARCANE, 16, 2);
      this.blow(c, nx, ny, nz, 'magic', 1);
      if (c.mine) {
        this.freeze(c, 0.08, 0.4, 0.35);
        c.rumbleLeft = 0.3;
      }
    }
    if (c.moveLeft > 0 && c.sigil >= 0) {
      c.moveLeft = Math.max(0, c.moveLeft - game);
      const k = 1 - c.moveLeft / 0.6;
      const along = c.moveTotal * (1 - (1 - k) * (1 - k) * 0.4 - 0.6 * (1 - k));
      const x = c.ax + c.fx * along;
      const z = c.az + c.fz * along;
      this.sigils.place(c.sigil, x, c.ay, z);
      this.sigils.setFade(c.sigil, k < 0.65 ? 1 : (1 - k) / 0.35);
      // The blue one a step behind.
      const lag = Math.max(0, along - 2.2);
      this.sigils.place(c.sigil2, c.ax + c.fx * lag, c.ay + 0.9, c.az + c.fz * lag);
      this.sigils.setFade(c.sigil2, k < 0.6 ? Math.min(1, k * 6) : Math.max(0, (1 - k) / 0.4));
      // A wake of dust kicked up along the ground under it.
      const s = this.pool.reset();
      for (let i = 0; i < 3; i += 1) {
        const lateral = rand(-4.5, 4.5);
        s.sprite = pick(SPRITE.dust);
        s.x = x + c.rx * lateral; s.y = c.sy + 0.15; s.z = z + c.rz * lateral;
        s.vx = c.fx * 2; s.vy = rand(0.5, 1.4); s.vz = c.fz * 2;
        s.drag = 2;
        s.size = rand(0.5, 0.8);
        s.endSize = rand(1.4, 2);
        s.rotation = Math.random() * 6;
        s.life = rand(1, 1.5);
        s.alpha = 0.55;
        s.additive = 0.1;
        s.fadeOut = 0.45;
        paint(s, DUST_LIGHT, DUST);
        this.pool.emit();
      }
      if (c.moveLeft === 0) {
        this.sigils.free(c.sigil);
        this.sigils.free(c.sigil2);
        c.sigil = c.sigil2 = -1;
      }
    }
    return windowScale(phase, caught, burst - 0.005, 0.5, 0.02);
  }
}

/** For the lab: every family once, with the class and variant that plays it. */
export const CRITICAL_SAMPLES: readonly { name: string; classId: ClassId; variant: number }[] = [
  { name: 'hammer', classId: 'juggernaut', variant: 0 },
  { name: 'axe', classId: 'juggernaut', variant: 1 },
  { name: 'mace', classId: 'juggernaut', variant: 2 },
  { name: 'katana', classId: 'duelist', variant: 0 },
  { name: 'longsword', classId: 'duelist', variant: 1 },
  { name: 'zweihander', classId: 'duelist', variant: 2 },
  { name: 'staff', classId: 'arcanist', variant: 0 },
  { name: 'wand', classId: 'arcanist', variant: 1 },
  { name: 'quarterstaff', classId: 'arcanist', variant: 2 },
  { name: 'longbow', classId: 'ranger', variant: 0 },
  { name: 'shortbow', classId: 'ranger', variant: 1 },
  { name: 'spear', classId: 'ranger', variant: 2 },
];

