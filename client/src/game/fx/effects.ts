import * as THREE from 'three';
import { WEAPON_STYLES, type WeaponStyle } from '../../../../shared/combat';
import { ATLAS } from './atlas';
import { CorpseDissolver } from './dissolve';
import { HealRibbons } from './healRibbons';
import {
  COLLECTOR_SLOTS, FACE_BASE, FACE_CAMERA, FACE_DIGIT, FACE_GROUND, FACE_VELOCITY, MOVE_COLLECT, MOVE_ORBIT, ParticlePool,
  type ParticleSpec,
} from './particles';
import { TRAIL_GOLD, TRAIL_MAGIC, TRAIL_WIND, TrailPool } from './trails';

/*
 * Every effect in the game, called by name with a position. The look aims for weight rather than
 * spectacle: dark blood, thin gold cuts, coals that fall, and light that is over in a few frames.
 * Nothing here allocates per frame. The only garbage is what a caller's own closures make.
 */

export type HitMaterial = 'flesh' | 'metal';
export type FootDustKind = 'walk' | 'run' | 'roll' | 'land';
/** A style name, or the index the server sends (see WEAPON_STYLES). */
export type StyleRef = WeaponStyle | number;

export interface HitOptions {
  heavy?: boolean;
  kill?: boolean;
  material?: HitMaterial;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

/** Linear red, green, blue from a page color. */
function rgb(hex: string): readonly [number, number, number] {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

const WHITE_HOT = rgb('#fff6dc');
const GOLD_HOT = rgb('#ffe2a0');
const GOLD = rgb('#e4ac55');
const AMBER = rgb('#c67a26');
const COAL = rgb('#8c2a0c');
const CRIMSON = rgb('#b31a18');
const CRIMSON_HOT = rgb('#f2573c');
const BLOOD = rgb('#a01216');
const BLOOD_DARK = rgb('#420708');
const BLOOD_MIST = rgb('#3d0709');
const BLOOD_MIST_END = rgb('#170203');
const ASH = rgb('#a39b8e');
const ASH_DARK = rgb('#3c3935');
const DUST = rgb('#7a6850');
const DUST_DARK = rgb('#4a3e30');
const WIND = rgb('#c9c6b8');
const WIND_RIBBON = rgb('#a89c84');
const GRASS = rgb('#5e5c30');
const LEAF = rgb('#574423');
const HEAL = rgb('#e3c26a');
const HEAL_DEEP = rgb('#a3741e');
// Duller than the sprite's arcade red, so the digits belong to the same grim world as the blood.
const DIGITS = [rgb('#dc3522'), rgb('#b81d13'), rgb('#7a120c')] as const;

const LIGHT_GOLD = new THREE.Color('#ffc774');
const LIGHT_CRIMSON = new THREE.Color('#ff3a24');

const SPRITE = {
  embers: [ATLAS['ember-1'], ATLAS['ember-2'], ATLAS['ember-3']],
  ash: [ATLAS['ash-1'], ATLAS['ash-2'], ATLAS['ash-3']],
  mist: [ATLAS['blood-mist-1'], ATLAS['blood-mist-2']],
  splats: [ATLAS['blood-splat-1'], ATLAS['blood-splat-2']],
  impacts: [ATLAS['impact-1'], ATLAS['impact-2']],
  smoke: [ATLAS['smoke-1'], ATLAS['smoke-2'], ATLAS['smoke-3'], ATLAS['smoke-4']],
  dust: [ATLAS['dust-1'], ATLAS['dust-2']],
  wisps: [ATLAS['wind-wisp'], ATLAS['wind-wisp-2'], ATLAS['wind-streak']],
  glow: ATLAS.glow,
  drop: ATLAS['blood-drop'],
  spray: ATLAS['blood-spray'],
  line: ATLAS['slash-line'],
  streak: ATLAS['spark-streak'],
  ring: ATLAS.ring,
  shock: ATLAS.shockwave,
  smokeRing: ATLAS['smoke-ring'],
  grit: ATLAS['dust-3'],
  crack: ATLAS.crack,
  ray: ATLAS.ray,
  grass: ATLAS.grass,
  leaf: ATLAS.leaf,
};

const CAPACITY_DESKTOP = 4000;
const CAPACITY_PHONE = 1500;
const LIGHTS = 2;
const MAX_PROJECTILES = 48;
const MAX_ARROW_MESHES = 24;
const MAX_ARRIVALS = 16;
/** Plan section 4.8: dust past this rate is simply not drawn. */
const DUST_PER_SECOND = 1500;
/** Past this distance a hit is a few pixels wide, so it can spend far fewer particles. */
const FAR_DISTANCE = 42;

function rand(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

function pick<T>(list: readonly T[]): T {
  return list[(Math.random() * list.length) | 0];
}

function setColor(s: ParticleSpec, from: readonly number[], to: readonly number[]): void {
  s.r = from[0]; s.g = from[1]; s.b = from[2];
  s.r2 = to[0]; s.g2 = to[1]; s.b2 = to[2];
}

export function styleName(style: StyleRef): WeaponStyle {
  return typeof style === 'number' ? (WEAPON_STYLES[style] ?? 'blade') : style;
}

interface LightSlot {
  light: THREE.PointLight;
  decay: number;
}

interface Projectile {
  id: number;
  active: boolean;
  x: number; y: number; z: number;
  dirX: number; dirZ: number;
  speed: number;
  left: number;
  style: WeaponStyle;
  emit: number;
  mesh: THREE.Object3D | null;
  arrowIndex: number;
  yaw: number;
}

interface Collector {
  get: (() => Position | null) | null;
  until: number;
}

interface Arrival {
  active: boolean;
  time: number;
  slot: number;
  onArrive: (() => void) | null;
}

export class GameFx {
  /** Ground height for stains and rings. Set it if the ground isn't at 0. */
  groundY = 0;

  private readonly pool: ParticlePool;
  private readonly trails: TrailPool;
  private readonly corpses = new CorpseDissolver();
  private readonly healing: HealRibbons;
  private readonly atlas: THREE.Texture;
  private readonly digits: THREE.Texture;
  private readonly lights: LightSlot[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly collectors: Collector[] = [];
  private readonly arrivals: Arrival[] = [];
  private readonly arrows: THREE.InstancedMesh;
  private readonly arrowMatrix = new THREE.Matrix4();
  private readonly arrowPosition = new THREE.Vector3();
  private readonly arrowRotation = new THREE.Quaternion();
  private readonly arrowEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly arrowScale = new THREE.Vector3(1, 1, 1);
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private arrowCursor = 0;
  private arrowsDirty = false;
  private nextLight = 0;
  private dustWindow = 0;
  private dustSpent = 0;
  private lastCast = -10;
  private castCarry = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    const loader = new THREE.TextureLoader();
    this.atlas = loader.load('/fx/atlas.png');
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.digits = loader.load('/fx/binary.png');
    this.digits.minFilter = THREE.NearestFilter;
    this.digits.magFilter = THREE.NearestFilter;
    this.digits.generateMipmaps = false;

    const phone = window.matchMedia('(pointer: coarse)').matches;
    this.pool = new ParticlePool(this.atlas, this.digits, phone ? CAPACITY_PHONE : CAPACITY_DESKTOP, SPRITE.glow);
    scene.add(this.pool.mesh);
    this.healing = new HealRibbons(scene, this.pool);

    const color = (values: readonly [number, number, number]) => new THREE.Color(values[0], values[1], values[2]);
    this.trails = new TrailPool(
      [color(GOLD), color(CRIMSON), color(WIND_RIBBON)],
      [color(WHITE_HOT), color(CRIMSON_HOT), color(WHITE_HOT)],
    );
    scene.add(this.trails.mesh);

    // Always in the scene and only ever dimmed: adding a light later would recompile every material.
    for (let i = 0; i < LIGHTS; i += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 9, 1.6);
      scene.add(light);
      this.lights.push({ light, decay: 1 });
    }

    for (let i = 0; i < MAX_PROJECTILES; i += 1) {
      this.projectiles.push({
        id: -1, active: false, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, speed: 0, left: 0, style: 'magic', emit: 0, mesh: null, arrowIndex: -1, yaw: 0,
      });
    }
    for (let i = 0; i < COLLECTOR_SLOTS; i += 1) this.collectors.push({ get: null, until: -1 });
    for (let i = 0; i < MAX_ARRIVALS; i += 1) this.arrivals.push({ active: false, time: 0, slot: 0, onArrive: null });

    this.arrows = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.018, 0.018, 0.82),
      new THREE.MeshBasicMaterial({ color: 0xb3966a }),
      MAX_ARROW_MESHES,
    );
    this.arrows.frustumCulled = false;
    for (let i = 0; i < MAX_ARROW_MESHES; i += 1) this.arrows.setMatrixAt(i, this.hiddenMatrix);
    scene.add(this.arrows);
  }

  /* ---------- The frame ---------- */

  /** Call once a frame, before rendering, with animation seconds (real seconds times camFx time scale). */
  update(seconds: number): void {
    this.pool.update(seconds);
    this.trails.update(seconds);
    this.corpses.update(seconds);
    this.healing.update(seconds);
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) this.pool.setFog(fog.near, fog.far, fog.color);

    for (let i = 0; i < LIGHTS; i += 1) {
      const slot = this.lights[i];
      if (slot.light.intensity > 0.01) slot.light.intensity *= Math.exp(-slot.decay * seconds);
      else slot.light.intensity = 0;
    }

    for (let i = 0; i < MAX_PROJECTILES; i += 1) {
      if (this.projectiles[i].active) this.stepProjectile(this.projectiles[i], seconds);
    }
    if (this.arrowsDirty) {
      this.arrows.instanceMatrix.needsUpdate = true;
      this.arrowsDirty = false;
    }

    const now = this.pool.now;
    for (let i = 0; i < COLLECTOR_SLOTS; i += 1) {
      const slot = this.collectors[i];
      if (slot.until < now) continue;
      const position = slot.get?.();
      // A little above the feet, so digits sink into the body and not the ground.
      if (position) this.pool.setCollector(i, position.x, position.y + 0.95, position.z);
    }
    for (let i = 0; i < MAX_ARRIVALS; i += 1) {
      const arrival = this.arrivals[i];
      if (!arrival.active || arrival.time > now) continue;
      arrival.active = false;
      const position = this.collectors[arrival.slot].get?.();
      if (position) this.soulPulse(position.x, position.y + 0.95, position.z);
      arrival.onArrive?.();
      arrival.onArrive = null;
    }
  }

  stats(): { alive: number; capacity: number } {
    return { alive: this.pool.aliveCount(), capacity: this.pool.capacity };
  }

  dispose(): void {
    this.scene.remove(this.pool.mesh, this.trails.mesh, this.arrows);
    for (const slot of this.lights) this.scene.remove(slot.light);
    this.pool.dispose();
    this.trails.dispose();
    this.corpses.dispose();
    this.healing.dispose();
    this.atlas.dispose();
    this.digits.dispose();
    this.arrows.geometry.dispose();
    (this.arrows.material as THREE.Material).dispose();
    this.arrows.dispose();
  }

  /* ---------- Hits ---------- */

  /**
   * A blow landing. pos is where it connected, dirYaw the way the blow traveled (attacker's yaw).
   * heavy defaults to the heavy style.
   */
  hit(pos: Position, dirYaw: number, style: StyleRef, options: HitOptions = {}): void {
    const name = styleName(style);
    const heavy = options.heavy ?? name === 'heavy';
    const kill = options.kill ?? false;
    const metal = options.material === 'metal';
    const far = this.isFar(pos);
    const power = (heavy ? 1.45 : 1) * (kill ? 1.3 : 1);
    const dirX = Math.sin(dirYaw);
    const dirZ = Math.cos(dirYaw);

    this.flash(pos, name === 'magic' ? LIGHT_CRIMSON : LIGHT_GOLD, kill ? 16 : heavy ? 10 : 5, kill ? 7 : 14);
    if (name === 'magic') {
      this.magicImpact(pos, power, far);
    } else {
      this.impactFlash(pos, power, metal);
      this.cutLine(pos, dirX, dirZ, name, power);
      this.sparks(pos, dirX, dirZ, name, metal, power, far);
    }
    if (!metal && name !== 'magic') this.blood(pos, dirX, dirZ, name, power, kill, far);
    if (!metal && name === 'magic' && kill) this.blood(pos, dirX, dirZ, 'arrow', 0.8, true, far);
    if (heavy && !far) this.groundKick(pos.x, pos.z, dirYaw, power);
    if (kill) this.killFlourish(pos, far);
  }

  private impactFlash(pos: Position, power: number, metal: boolean): void {
    const s = this.pool.reset();
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.additive = 1;
    s.fadeOut = 0.1;
    s.ignoreFog = true;

    // White for two or three frames and then gone. Long flashes read as a camera flash, not a blow.
    s.sprite = SPRITE.glow;
    setColor(s, WHITE_HOT, GOLD);
    s.size = 0.34 * power;
    s.endSize = 0.62 * power;
    s.life = 0.055;
    s.alpha = 1;
    this.pool.emit();

    // Uneven torn light around it, shorter still.
    s.sprite = pick(SPRITE.impacts);
    setColor(s, GOLD_HOT, metal ? GOLD : COAL);
    s.size = 0.5 * power;
    s.endSize = 1.05 * power;
    s.life = 0.075;
    s.rotation = rand(0, 6.28);
    s.alpha = 0.7;
    this.pool.emit();

    s.sprite = SPRITE.glow;
    s.rotation = 0;
    setColor(s, AMBER, COAL);
    s.size = 0.6 * power;
    s.endSize = 1.05 * power;
    s.life = 0.14;
    s.alpha = 0.16;
    this.pool.emit();
  }

  /** The cut itself: a razor gold line on a wider crimson one that stays for a beat after it. */
  private cutLine(pos: Position, dirX: number, dirZ: number, style: WeaponStyle, power: number): void {
    const s = this.pool.reset();
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.face = FACE_VELOCITY;
    s.additive = 1;
    s.fadeOut = 0.15;
    s.ignoreFog = true;
    s.sprite = SPRITE.line;
    if (style === 'thrust' || style === 'arrow') {
      s.vx = dirX * 0.4; s.vz = dirZ * 0.4; s.vy = 0;
      s.size = 0.11;
      s.aspect = 12;
      s.life = 0.09;
    } else {
      // Always a diagonal on screen. A line across the blow in world space would turn into a
      // vertical spike whenever the camera looked along it, and read as a twinkle.
      const elements = this.camera.matrixWorld.elements;
      const angle = rand(0.45, 0.95) * (Math.random() < 0.5 ? 1 : -1);
      const across = Math.cos(angle) * 0.4;
      const up = Math.sin(angle) * 0.4;
      s.vx = elements[0] * across + elements[4] * up;
      s.vy = elements[1] * across + elements[5] * up;
      s.vz = elements[2] * across + elements[6] * up;
      s.size = 0.075 + 0.025 * power;
      // Length barely grows with power: a long line across the whole body is a sword flash from a poster.
      s.aspect = (0.95 + 0.3 * power) / s.size;
      s.life = style === 'heavy' ? 0.14 : 0.1;
    }
    const size = s.size;
    const life = s.life;
    const aspect = s.aspect;
    setColor(s, CRIMSON_HOT, BLOOD_DARK);
    s.size = size * 1.6;
    s.endSize = size;
    s.aspect = aspect * 0.5;
    s.life = life * 2.2;
    s.alpha = 0.5;
    this.pool.emit();
    s.aspect = aspect;
    setColor(s, WHITE_HOT, GOLD);
    s.size = size;
    s.endSize = size * 0.35;
    s.life = life;
    s.alpha = 1;
    this.pool.emit();
  }

  private sparks(pos: Position, dirX: number, dirZ: number, style: WeaponStyle, metal: boolean, power: number, far: boolean): void {
    let count = style === 'heavy' ? 15 : style === 'blade' ? 11 : style === 'thrust' ? 8 : 4;
    if (metal) count = (count * 2.2) | 0;
    if (far) count = (count / 3) | 0;
    const narrow = style === 'thrust' || style === 'arrow' ? 0.5 : 1.1;
    const s = this.pool.reset();
    s.face = FACE_VELOCITY;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.fadeOut = 0.45;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.atan2(dirX, dirZ) + rand(-narrow, narrow);
      const speed = rand(2.5, metal ? 11 : 8) * (0.8 + power * 0.25);
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.vx = Math.sin(angle) * speed;
      s.vz = Math.cos(angle) * speed;
      s.vy = rand(-1, 3.6);
      s.gravity = 9;
      s.drag = 2.6;
      s.sprite = SPRITE.streak;
      s.size = rand(0.03, 0.055);
      s.endSize = s.size * 0.6;
      s.aspect = rand(5, 10);
      s.life = rand(0.2, metal ? 0.65 : 0.5);
      s.alpha = 1;
      setColor(s, GOLD_HOT, COAL);
      this.pool.emit();
    }
    // A few slow coals that last after the flash, for the eye to follow down.
    if (far) return;
    s.face = FACE_CAMERA;
    s.minPixels = 1;
    s.fadeOut = 0.3;
    for (let i = 0; i < count / 3; i += 1) {
      s.x = pos.x + rand(-0.1, 0.1); s.y = pos.y + rand(-0.1, 0.1); s.z = pos.z + rand(-0.1, 0.1);
      s.vx = dirX * rand(0.3, 2) + rand(-1, 1);
      s.vz = dirZ * rand(0.3, 2) + rand(-1, 1);
      s.vy = rand(0.2, 1.8);
      s.gravity = 2.2;
      s.drag = 1.2;
      s.sprite = pick(SPRITE.embers);
      s.size = rand(0.03, 0.055);
      s.endSize = s.size * 0.5;
      s.aspect = 1;
      s.rotation = rand(0, 6.28);
      s.life = rand(0.6, 1.3);
      setColor(s, GOLD, COAL);
      this.pool.emit();
    }
  }

  private blood(pos: Position, dirX: number, dirZ: number, style: WeaponStyle, power: number, kill: boolean, far: boolean): void {
    const s = this.pool.reset();
    const heading = Math.atan2(dirX, dirZ);
    const narrow = style === 'thrust' || style === 'arrow' ? 0.4 : style === 'heavy' ? 1.15 : 0.85;

    // Layer one: a dark mist that hangs where the blow landed. It covers instead of glowing, so it
    // reads as blood in the air and not as a red light.
    if (!far) {
      s.minPixels = 0;
      s.fadeIn = 0.03;
      s.fadeOut = 0.2;
      s.gravity = 0.25;
      s.drag = 3;
      for (let i = 0; i < (kill ? 4 : 2); i += 1) {
        s.sprite = pick(SPRITE.mist);
        s.x = pos.x + dirX * 0.12;
        s.y = pos.y + rand(-0.15, 0.2);
        s.z = pos.z + dirZ * 0.12;
        s.vx = dirX * rand(0.4, 1.3) + rand(-0.3, 0.3);
        s.vz = dirZ * rand(0.4, 1.3) + rand(-0.3, 0.3);
        s.vy = rand(-0.1, 0.5);
        s.size = rand(0.45, 0.72) * power;
        s.endSize = s.size * 2;
        s.rotation = rand(0, 6.28);
        s.spin = rand(-0.5, 0.5);
        s.life = rand(0.45, 0.8);
        s.alpha = rand(0.7, 1);
        setColor(s, BLOOD_MIST, BLOOD_MIST_END);
        this.pool.emit();
      }

      // Layer two: the fan of fine spatter thrown along the blow, seen for only a moment.
      s.face = FACE_VELOCITY;
      s.sprite = SPRITE.spray;
      s.spin = 0;
      s.rotation = 0;
      s.fadeIn = 0;
      s.fadeOut = 0.35;
      s.drag = 3;
      s.gravity = 1.6;
      for (let i = 0; i < (kill ? 3 : 2); i += 1) {
        const angle = heading + rand(-0.5, 0.5) * narrow;
        const out = rand(0.3, 0.75);
        s.x = pos.x + Math.sin(angle) * out * power * 0.6;
        s.y = pos.y + rand(-0.1, 0.25);
        s.z = pos.z + Math.cos(angle) * out * power * 0.6;
        s.vx = Math.sin(angle) * 1.6;
        s.vz = Math.cos(angle) * 1.6;
        s.vy = rand(-0.2, 0.7);
        s.size = 0.5 * power;
        s.endSize = 0.95 * power;
        s.aspect = 2;
        s.life = rand(0.2, 0.32);
        s.alpha = 0.9;
        s.delay = i * 0.018;
        setColor(s, BLOOD, BLOOD_DARK);
        this.pool.emit();
      }
    }

    // Layer three: fat gouts with real mass, the part the eye follows down to the ground.
    s.delay = 0;
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.drop;
    s.minPixels = 2;
    s.fadeOut = 0.78;
    const gouts = ((style === 'arrow' ? 3 : style === 'thrust' ? 6 : 8) * power * (far ? 0.4 : 1)) | 0;
    for (let i = 0; i < gouts; i += 1) {
      const angle = heading + rand(-narrow, narrow) * 0.6;
      const speed = rand(3, 7) * (0.75 + power * 0.25);
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.vx = Math.sin(angle) * speed;
      s.vz = Math.cos(angle) * speed;
      s.vy = rand(0.6, 3.8);
      s.gravity = 11;
      s.drag = 0.7;
      s.size = rand(0.09, 0.15);
      s.endSize = s.size * 0.7;
      s.aspect = rand(3, 5);
      s.life = rand(0.45, 0.85);
      s.alpha = 1;
      setColor(s, BLOOD, BLOOD_DARK);
      this.pool.emit();
    }

    // Layer four: many small droplets on wider, faster paths.
    const drops = ((style === 'arrow' ? 8 : 18) * power * (far ? 0.3 : 1)) | 0;
    for (let i = 0; i < drops; i += 1) {
      const angle = heading + rand(-narrow, narrow) * 1.3;
      const speed = rand(1.2, 6.5) * (0.75 + power * 0.25);
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.vx = Math.sin(angle) * speed;
      s.vz = Math.cos(angle) * speed;
      s.vy = rand(-0.5, 3.2);
      s.gravity = 11;
      s.drag = 0.9;
      s.size = rand(0.03, 0.06);
      s.endSize = s.size;
      s.aspect = rand(2.5, 4.5);
      s.life = rand(0.35, 0.8);
      s.alpha = rand(0.75, 1);
      setColor(s, BLOOD, BLOOD_DARK);
      this.pool.emit();
    }

    // A thrust goes in one side and sprays back out of the other.
    if ((style === 'thrust' || kill) && !far) {
      for (let i = 0; i < 5; i += 1) {
        const angle = heading + Math.PI + rand(-0.5, 0.5);
        const speed = rand(1.5, 3.8);
        s.x = pos.x; s.y = pos.y; s.z = pos.z;
        s.vx = Math.sin(angle) * speed;
        s.vz = Math.cos(angle) * speed;
        s.vy = rand(0.5, 2.6);
        s.size = rand(0.05, 0.09);
        s.endSize = s.size * 0.7;
        s.aspect = rand(2.5, 4);
        s.life = rand(0.35, 0.65);
        s.alpha = 1;
        setColor(s, BLOOD, BLOOD_DARK);
        this.pool.emit();
      }
    }

    // A kill keeps pumping for a moment after the blow. This is what carries through the slow motion.
    if (kill && !far) {
      for (let i = 0; i < 16; i += 1) {
        const angle = heading + rand(-0.8, 0.8);
        const speed = rand(1.2, 3.6);
        s.x = pos.x + rand(-0.05, 0.05); s.y = pos.y + rand(0, 0.15); s.z = pos.z + rand(-0.05, 0.05);
        s.vx = Math.sin(angle) * speed;
        s.vz = Math.cos(angle) * speed;
        s.vy = rand(1.6, 4.2);
        s.size = rand(0.05, 0.11);
        s.endSize = s.size * 0.7;
        s.aspect = rand(2.5, 4);
        s.life = rand(0.5, 0.85);
        s.delay = 0.05 + (i % 4) * 0.075 + rand(0, 0.02);
        setColor(s, BLOOD, BLOOD_DARK);
        this.pool.emit();
      }
      s.delay = 0;
    }

    // A stain stays on the ground after a kill or a heavy blow, and outlasts the fight a little.
    if (!far && (kill || power > 1.3)) {
      s.face = FACE_GROUND;
      s.sprite = pick(SPRITE.splats);
      s.x = pos.x + dirX * rand(0.2, 0.7);
      s.y = this.groundY + 0.025;
      s.z = pos.z + dirZ * rand(0.2, 0.7);
      s.vx = s.vy = s.vz = 0;
      s.gravity = 0;
      s.drag = 0;
      s.minPixels = 0;
      s.aspect = 1;
      s.size = rand(1.4, 2.1) * power;
      s.endSize = s.size * 1.08;
      s.rotation = rand(0, 6.28);
      s.spin = 0;
      s.life = kill ? 11 : 7;
      s.fadeIn = 0.012;
      s.fadeOut = 0.72;
      s.alpha = 0.72;
      s.delay = 0.12;
      setColor(s, BLOOD_DARK, BLOOD_DARK);
      this.pool.emit();
    }
  }

  private magicImpact(pos: Position, power: number, far: boolean): void {
    const s = this.pool.reset();
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.additive = 1;
    s.ignoreFog = true;
    s.fadeOut = 0.1;
    s.sprite = SPRITE.glow;
    setColor(s, CRIMSON, DIGITS[2]);
    s.size = 0.7 * power;
    s.endSize = 1.25 * power;
    s.life = 0.16;
    s.alpha = 0.2;
    this.pool.emit();
    this.digitBurst(pos.x, pos.y, pos.z, far ? 8 : (22 * power) | 0, 4.4, 0.75);
  }

  /** Red digits thrown outward that slow, hang and go dark. Shared by magic hits, bolts and deaths. */
  private digitBurst(x: number, y: number, z: number, count: number, speed: number, life: number): void {
    const s = this.pool.reset();
    s.face = FACE_DIGIT;
    s.ignoreFog = true;
    s.additive = 0.7;
    s.minPixels = 7;
    s.fadeOut = 0.45;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      const up = rand(-0.3, 1);
      const pace = rand(0.35, 1) * speed;
      const flat = Math.sqrt(1 - up * up);
      // Born slightly apart. All on one point, the first frames are a solid red rectangle.
      s.x = x + Math.cos(angle) * flat * 0.14; s.y = y + up * 0.14; s.z = z + Math.sin(angle) * flat * 0.14;
      s.vx = Math.cos(angle) * flat * pace;
      s.vy = up * pace + 0.5;
      s.vz = Math.sin(angle) * flat * pace;
      s.drag = 4.2;
      s.gravity = -0.35;
      s.size = rand(0.11, 0.17);
      s.endSize = s.size;
      s.life = rand(0.55, 1.1) * life / 0.75;
      s.alpha = 1;
      const color = pick(DIGITS);
      setColor(s, CRIMSON_HOT, color);
      this.pool.emit();
    }
  }

  private killFlourish(pos: Position, far: boolean): void {
    const s = this.pool.reset();
    // The arc of light that says "that one's done", held just longer than a normal hit.
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.additive = 1;
    s.ignoreFog = true;
    s.sprite = SPRITE.glow;
    setColor(s, GOLD, COAL);
    s.size = 0.8;
    s.endSize = 1.4;
    s.life = 0.26;
    s.alpha = 0.14;
    s.fadeOut = 0.05;
    this.pool.emit();
    if (far) return;

    // One quick pale ring. Faint and brief: the art review is right that perfect circles turn into UI.
    s.sprite = SPRITE.ring;
    setColor(s, GOLD, CRIMSON);
    s.rotation = 0;
    s.aspect = 1;
    s.size = 0.5;
    s.endSize = 2.6;
    s.life = 0.18;
    s.alpha = 0.1;
    s.fadeOut = 0.1;
    this.pool.emit();

    // Coals drifting up off the body, slower than everything else, so the moment lingers.
    s.face = FACE_CAMERA;
    s.minPixels = 1;
    s.fadeIn = 0.1;
    s.fadeOut = 0.5;
    s.gravity = -0.5;
    s.drag = 1.1;
    for (let i = 0; i < 20; i += 1) {
      s.sprite = pick(SPRITE.embers);
      s.x = pos.x + rand(-0.35, 0.35);
      s.y = pos.y + rand(-0.6, 0.35);
      s.z = pos.z + rand(-0.35, 0.35);
      s.vx = rand(-0.8, 0.8);
      s.vz = rand(-0.8, 0.8);
      s.vy = rand(0.3, 1.5);
      s.size = rand(0.025, 0.05);
      s.endSize = s.size * 0.5;
      s.rotation = rand(0, 6.28);
      s.extra = rand(0.1, 0.4);
      s.life = rand(0.9, 2.2);
      s.alpha = 1;
      setColor(s, GOLD_HOT, COAL);
      this.pool.emit();
    }
  }

  /* ---------- Blade ribbons ---------- */

  /** Starts a ribbon, for example when an attack's active phase begins. Use any id, such as the player id. */
  beginTrail(id: number, style: StyleRef): void {
    const name = styleName(style);
    this.trails.begin(id, name === 'magic' ? TRAIL_MAGIC : name === 'heavy' ? TRAIL_WIND : TRAIL_GOLD);
  }

  /** Each frame of the swing: where the weapon's tip and its base are in the world. */
  pushTrail(id: number, tip: THREE.Vector3, base: THREE.Vector3): void {
    const moved = this.trails.push(id, tip, base);
    if (moved <= 0) return;
    const look = this.trails.lastLook;
    const s = this.pool.reset();
    if (look === TRAIL_MAGIC) {
      if (Math.random() < moved * 4.5) {
        s.face = FACE_DIGIT;
        s.ignoreFog = true;
        s.additive = 0.7;
        s.minPixels = 7;
        s.fadeOut = 0.4;
        s.x = tip.x + rand(-0.06, 0.06); s.y = tip.y + rand(-0.06, 0.06); s.z = tip.z + rand(-0.06, 0.06);
        s.vx = rand(-0.5, 0.5); s.vy = rand(0.1, 0.9); s.vz = rand(-0.5, 0.5);
        s.drag = 2.5;
        s.size = s.endSize = rand(0.1, 0.14);
        s.life = rand(0.35, 0.65);
        const color = pick(DIGITS);
        setColor(s, color, DIGITS[2]);
        this.pool.emit();
      }
    } else if (look === TRAIL_WIND) {
      if (Math.random() < moved * 1.1) {
        s.face = FACE_VELOCITY;
        s.additive = 1;
        s.sprite = pick(SPRITE.wisps);
        s.x = tip.x; s.y = tip.y; s.z = tip.z;
        s.vx = (tip.x - base.x) * 1.4 + rand(-0.4, 0.4);
        s.vy = (tip.y - base.y) * 1.4 + rand(-0.3, 0.3);
        s.vz = (tip.z - base.z) * 1.4 + rand(-0.4, 0.4);
        s.drag = 3;
        s.size = rand(0.1, 0.18);
        s.endSize = s.size * 1.5;
        s.aspect = 7;
        s.life = rand(0.18, 0.32);
        s.alpha = 0.22;
        s.fadeOut = 0.2;
        setColor(s, WIND, WIND);
        this.pool.emit();
      }
    } else if (Math.random() < moved * 1.6) {
      s.sprite = pick(SPRITE.embers);
      s.additive = 1;
      s.minPixels = 1;
      s.x = tip.x; s.y = tip.y; s.z = tip.z;
      s.vx = rand(-0.4, 0.4); s.vy = rand(-0.2, 0.5); s.vz = rand(-0.4, 0.4);
      s.gravity = 2.8;
      s.drag = 1.5;
      s.size = rand(0.02, 0.035);
      s.endSize = s.size * 0.5;
      s.life = rand(0.3, 0.7);
      s.fadeOut = 0.3;
      setColor(s, GOLD_HOT, COAL);
      this.pool.emit();
    }
  }

  /** Stops adding to the ribbon. What is already drawn fades on its own. */
  endTrail(id: number): void {
    this.trails.end(id);
  }

  /* ---------- Wind ---------- */

  /**
   * The air moved by a heavy weapon. pos is usually the ground in front of the attacker, at the
   * hit moment, whether or not the swing landed. power is about 0.5 to 1.5.
   */
  wind(pos: Position, yaw: number, power = 1): void {
    const s = this.pool.reset();
    const far = this.isFar(pos);

    // The fan of sheared air lines, leaving the blow in an arc.
    s.face = FACE_VELOCITY;
    s.additive = 1;
    s.fadeIn = 0.05;
    s.fadeOut = 0.25;
    s.drag = 2.8;
    const lines = ((far ? 4 : 13) * power) | 0;
    for (let i = 0; i < lines; i += 1) {
      const angle = yaw + rand(-1.05, 1.05);
      const speed = rand(5, 9.5) * power;
      s.sprite = pick(SPRITE.wisps);
      s.x = pos.x + Math.sin(angle) * rand(0.1, 0.7);
      s.y = this.groundY + rand(0.1, 1.5);
      s.z = pos.z + Math.cos(angle) * rand(0.1, 0.7);
      s.vx = Math.sin(angle) * speed;
      s.vz = Math.cos(angle) * speed;
      s.vy = rand(-0.2, 0.45);
      s.size = rand(0.09, 0.18) * power;
      s.endSize = s.size * 1.9;
      s.aspect = rand(7, 10);
      s.life = rand(0.2, 0.42);
      s.alpha = rand(0.14, 0.34);
      setColor(s, WIND, WIND);
      this.pool.emit();
    }
    if (!far) this.groundKick(pos.x, pos.z, yaw, power);
  }

  /** Dust ring, flattened grass and thrown leaves where the blow's air meets the ground. */
  private groundKick(x: number, z: number, yaw: number, power: number): void {
    const s = this.pool.reset();
    const ground = this.groundY;

    s.face = FACE_GROUND;
    s.sprite = SPRITE.smokeRing;
    s.x = x; s.y = ground + 0.06; s.z = z;
    setColor(s, DUST, DUST_DARK);
    s.size = 0.7 * power;
    s.endSize = 4.6 * power;
    s.life = 0.5;
    s.alpha = 0.2;
    s.fadeOut = 0.12;
    s.rotation = rand(0, 6.28);
    this.pool.emit();

    // Low puffs pushed outward in a ring, heavier in the direction of the blow.
    s.face = FACE_CAMERA;
    s.fadeIn = 0.05;
    s.fadeOut = 0.2;
    s.drag = 4.2;
    s.gravity = -0.12;
    for (let i = 0; i < 14; i += 1) {
      const angle = (i / 14) * 6.283 + rand(-0.2, 0.2);
      const along = Math.cos(angle - yaw);
      const speed = rand(2.2, 4.2) * power * (1 + 0.4 * Math.max(0, along));
      s.sprite = pick(SPRITE.dust);
      s.x = x + Math.sin(angle) * 0.3;
      s.y = ground + rand(0.2, 0.36);
      s.z = z + Math.cos(angle) * 0.3;
      s.vx = Math.sin(angle) * speed;
      s.vz = Math.cos(angle) * speed;
      s.vy = rand(0.05, 0.4);
      s.size = rand(0.42, 0.7) * power;
      s.endSize = s.size * 2.1;
      s.rotation = rand(0, 6.28);
      s.spin = rand(-0.8, 0.8);
      s.life = rand(0.55, 1);
      s.alpha = rand(0.12, 0.24);
      setColor(s, DUST_DARK, DUST_DARK);
      this.pool.emit();
    }

    // Grit and torn plant bits blown along the blow.
    s.spin = 0;
    s.fadeIn = 0;
    s.fadeOut = 0.55;
    s.minPixels = 1;
    s.gravity = 8;
    s.drag = 1.4;
    for (let i = 0; i < 14; i += 1) {
      const kind = i % 3;
      const angle = yaw + rand(-1.3, 1.3);
      const speed = rand(1.5, 5) * power;
      s.sprite = kind === 0 ? SPRITE.grass : kind === 1 ? SPRITE.leaf : pick(SPRITE.embers);
      s.x = x; s.y = ground + rand(0.05, 0.25); s.z = z;
      s.vx = Math.sin(angle) * speed;
      s.vz = Math.cos(angle) * speed;
      s.vy = rand(0.7, 2.8);
      s.size = kind === 0 ? rand(0.1, 0.17) : rand(0.04, 0.08);
      s.endSize = s.size;
      s.aspect = kind === 0 ? 0.5 : 1;
      s.rotation = rand(0, 6.28);
      s.spin = rand(-6, 6);
      s.life = rand(0.4, 0.8);
      s.alpha = 0.9;
      if (kind === 0) setColor(s, GRASS, GRASS);
      else if (kind === 1) setColor(s, LEAF, LEAF);
      else setColor(s, DUST_DARK, DUST_DARK);
      this.pool.emit();
    }

    // A faint crack in the ground under the heaviest blows.
    if (power > 1.2) {
      s.sprite = SPRITE.crack;
      s.face = FACE_GROUND;
      s.x = x; s.y = ground + 0.03; s.z = z;
      s.vx = s.vy = s.vz = 0;
      s.gravity = 0;
      s.drag = 0;
      s.size = 2.1 * power;
      s.endSize = s.size;
      s.aspect = 1;
      s.rotation = rand(0, 6.28);
      s.spin = 0;
      s.life = 3.2;
      s.fadeIn = 0.015;
      s.fadeOut = 0.5;
      s.alpha = 0.7;
      s.minPixels = 0;
      setColor(s, BLOOD_DARK, BLOOD_DARK);
      s.r = s.r2 = 0.012; s.g = s.g2 = 0.01; s.b = s.b2 = 0.008;
      this.pool.emit();
    }
  }

  /* ---------- Projectiles ---------- */

  /**
   * On a 'shot' event. Moves on its own until endProjectile or until range runs out. Magic is drawn
   * as Binary Dust. An arrow uses the mesh given, or a built-in shaft.
   */
  spawnProjectile(id: number, pos: Position, yaw: number, speed: number, range: number, style: StyleRef, mesh?: THREE.Object3D): void {
    let slot: Projectile | null = null;
    for (let i = 0; i < MAX_PROJECTILES; i += 1) {
      if (!this.projectiles[i].active) {
        slot = this.projectiles[i];
        break;
      }
    }
    if (!slot) return;
    slot.id = id;
    slot.active = true;
    slot.x = pos.x; slot.y = pos.y; slot.z = pos.z;
    slot.dirX = Math.sin(yaw);
    slot.dirZ = Math.cos(yaw);
    slot.yaw = yaw;
    slot.speed = speed;
    slot.left = range;
    slot.style = styleName(style);
    slot.emit = 0;
    slot.mesh = mesh ?? null;
    slot.arrowIndex = -1;
    if (slot.style === 'arrow' && !mesh) {
      slot.arrowIndex = this.arrowCursor;
      this.arrowCursor = (this.arrowCursor + 1) % MAX_ARROW_MESHES;
    }
    if (slot.style === 'magic') {
      this.flash(pos, LIGHT_CRIMSON, 3.5, 16);
      this.digitBurst(pos.x, pos.y, pos.z, 7, 2.2, 0.4);
    }
    this.placeProjectileMesh(slot);
  }

  private placeProjectileMesh(p: Projectile): void {
    if (p.mesh) {
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y = p.yaw;
    }
    if (p.arrowIndex >= 0) {
      this.arrowPosition.set(p.x, p.y, p.z);
      this.arrowEuler.set(0, p.yaw, 0);
      this.arrowRotation.setFromEuler(this.arrowEuler);
      this.arrowMatrix.compose(this.arrowPosition, this.arrowRotation, this.arrowScale);
      this.arrows.setMatrixAt(p.arrowIndex, this.arrowMatrix);
      this.arrowsDirty = true;
    }
  }

  private stepProjectile(p: Projectile, seconds: number): void {
    const step = Math.min(p.left, p.speed * seconds);
    p.x += p.dirX * step;
    p.z += p.dirZ * step;
    p.left -= step;
    if (p.left <= 0) {
      // Ran out of range before the server's end message arrived. Stops here so it doesn't overshoot.
      this.hideProjectileMesh(p);
      return;
    }
    this.placeProjectileMesh(p);
    p.emit += seconds;
    if (p.style === 'magic') {
      while (p.emit >= 0.014) {
        p.emit -= 0.014;
        this.boltDigit(p);
      }
    } else {
      while (p.emit >= 0.03) {
        p.emit -= 0.03;
        const s = this.pool.reset();
        s.face = FACE_VELOCITY;
        s.additive = 1;
        s.sprite = SPRITE.streak;
        s.x = p.x; s.y = p.y; s.z = p.z;
        s.vx = p.dirX * 0.6; s.vz = p.dirZ * 0.6;
        s.size = 0.035;
        s.endSize = 0.01;
        s.aspect = 22;
        s.minPixels = 1;
        s.life = 0.14;
        s.alpha = 0.5;
        s.fadeOut = 0.1;
        setColor(s, WIND, DUST);
        this.pool.emit();
      }
    }
  }

  /** The bolt is nothing but digits: a tight bright head, and a thin dying tail left where it was. */
  private boltDigit(p: Projectile): void {
    const s = this.pool.reset();
    s.face = FACE_DIGIT;
    s.ignoreFog = true;
    s.additive = 0.8;
    s.minPixels = 7;
    const inHead = Math.random() < 0.5;
    const spread = inHead ? 0.13 : 0.08;
    s.x = p.x + rand(-spread, spread) + (inHead ? p.dirX * p.speed * 0.012 : 0);
    s.y = p.y + rand(-spread, spread);
    s.z = p.z + rand(-spread, spread) + (inHead ? p.dirZ * p.speed * 0.012 : 0);
    s.vx = p.dirX * (inHead ? p.speed : 0.7) + rand(-0.3, 0.3);
    s.vy = rand(-0.2, 0.3);
    s.vz = p.dirZ * (inHead ? p.speed : 0.7) + rand(-0.3, 0.3);
    s.drag = inHead ? 0 : 1.5;
    s.size = s.endSize = inHead ? rand(0.12, 0.17) : rand(0.09, 0.13);
    s.life = inHead ? rand(0.05, 0.1) : rand(0.3, 0.6);
    s.fadeOut = inHead ? 0.7 : 0.25;
    const color = pick(DIGITS);
    setColor(s, inHead ? CRIMSON_HOT : color, inHead ? color : DIGITS[2]);
    this.pool.emit();

    // A faint red bloom under the head, so the bolt lights its digits from within.
    if (Math.random() < 0.3) {
      const g = this.pool.reset();
      g.sprite = SPRITE.glow;
      g.additive = 1;
      g.ignoreFog = true;
      g.x = p.x; g.y = p.y; g.z = p.z;
      g.vx = p.dirX * p.speed; g.vz = p.dirZ * p.speed;
      g.size = 0.8;
      g.endSize = 0.5;
      g.life = 0.07;
      g.alpha = 0.3;
      g.fadeOut = 0.5;
      setColor(g, CRIMSON, CRIMSON);
      this.pool.emit();
    }
  }

  private hideProjectileMesh(p: Projectile): void {
    if (p.arrowIndex >= 0) {
      this.arrows.setMatrixAt(p.arrowIndex, this.hiddenMatrix);
      this.arrowsDirty = true;
    }
  }

  /** On a 'shotEnd' event. pos is where the server says it ended. splash is the area in meters. */
  endProjectile(id: number, pos: Position, hit: boolean, splash = 0): void {
    let style: WeaponStyle = 'magic';
    for (let i = 0; i < MAX_PROJECTILES; i += 1) {
      const p = this.projectiles[i];
      if (!p.active || p.id !== id) continue;
      style = p.style;
      this.hideProjectileMesh(p);
      p.active = false;
      p.mesh = null;
      break;
    }
    if (style === 'magic') {
      this.flash(pos, LIGHT_CRIMSON, hit ? 10 : 3, 9);
      this.digitBurst(pos.x, pos.y, pos.z, hit ? 34 + ((splash * 12) | 0) : 12, hit ? 3 + splash * 0.9 : 1.6, hit ? 0.8 : 0.45);
      const s = this.pool.reset();
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.additive = 1;
      s.ignoreFog = true;
      s.sprite = SPRITE.glow;
      s.fadeOut = 0.1;
      setColor(s, CRIMSON, DIGITS[2]);
      s.size = hit ? 0.85 : 0.4;
      s.endSize = hit ? 1.6 : 0.7;
      s.life = 0.17;
      s.alpha = 0.22;
      this.pool.emit();
      if (splash > 0) {
        // Shows the real area of the blast: faint, brief, and digits around its edge.
        s.face = FACE_GROUND;
        s.sprite = SPRITE.shock;
        s.y = this.groundY + 0.06;
        s.size = splash * 0.6;
        s.endSize = splash * 2.5;
        s.life = 0.32;
        s.alpha = 0.42;
        setColor(s, CRIMSON, DIGITS[2]);
        this.pool.emit();
        const d = this.pool.reset();
        d.face = FACE_DIGIT;
        d.ignoreFog = true;
        d.additive = 0.7;
        d.minPixels = 7;
        d.fadeOut = 0.4;
        for (let i = 0; i < 24; i += 1) {
          const angle = (i / 24) * 6.283;
          d.x = pos.x + Math.cos(angle) * splash * 0.3;
          d.y = this.groundY + rand(0.1, 0.5);
          d.z = pos.z + Math.sin(angle) * splash * 0.3;
          d.vx = Math.cos(angle) * splash * 3.8;
          d.vz = Math.sin(angle) * splash * 3.8;
          d.vy = rand(0, 0.9);
          d.drag = 5.5;
          d.size = d.endSize = rand(0.1, 0.14);
          d.life = rand(0.45, 0.85);
          const color = pick(DIGITS);
          setColor(d, color, DIGITS[2]);
          this.pool.emit();
        }
      }
    } else {
      // An arrow only puffs where it stops. The 'hit' event on a creature handles blood.
      const s = this.pool.reset();
      s.sprite = pick(SPRITE.dust);
      s.x = pos.x; s.y = pos.y; s.z = pos.z;
      s.size = 0.16;
      s.endSize = 0.5;
      s.life = 0.35;
      s.alpha = 0.3;
      s.fadeOut = 0.1;
      setColor(s, DUST, DUST_DARK);
      this.pool.emit();
    }
  }

  /* ---------- Magic casting and Binary Dust ---------- */

  /**
   * Digits circling the hand or book. Call it once for a short swirl, or every frame of the windup
   * with the hand's current position to keep the swirl on the hand.
   */
  castMagic(handPos: Position, style: StyleRef = 'magic'): void {
    if (styleName(style) !== 'magic') return;
    const now = this.pool.now;
    const fresh = now - this.lastCast > 0.25;
    this.castCarry = fresh ? 20 : this.castCarry + (now - this.lastCast) * 70;
    this.lastCast = now;
    const count = Math.min(16, this.castCarry | 0);
    this.castCarry -= count;
    const s = this.pool.reset();
    s.face = FACE_DIGIT;
    s.move = MOVE_ORBIT;
    s.ignoreFog = true;
    s.additive = 0.75;
    s.minPixels = 7;
    s.fadeIn = 0.1;
    s.fadeOut = 0.55;
    for (let i = 0; i < count; i += 1) {
      s.x = handPos.x;
      s.y = handPos.y + rand(-0.22, 0.14);
      s.z = handPos.z;
      s.vx = 0;
      s.vy = rand(0.08, 0.5);
      s.vz = 0;
      s.rotation = rand(0, 6.283);
      s.spin = rand(4.5, 9) * (Math.random() < 0.8 ? 1 : -1);
      s.extra = rand(0.16, 0.42);
      s.size = s.endSize = rand(0.08, 0.12);
      s.life = rand(0.35, 0.65);
      s.alpha = 1;
      const color = pick(DIGITS);
      setColor(s, color, DIGITS[2]);
      this.pool.emit();
    }
    if (fresh || Math.random() < 0.2) {
      const g = this.pool.reset();
      g.sprite = SPRITE.glow;
      g.additive = 1;
      g.ignoreFog = true;
      g.x = handPos.x; g.y = handPos.y; g.z = handPos.z;
      g.size = 0.5;
      g.endSize = 0.8;
      g.life = 0.2;
      g.alpha = 0.3;
      g.fadeIn = 0.2;
      g.fadeOut = 0.3;
      setColor(g, CRIMSON, CRIMSON);
      this.pool.emit();
    }
  }

  /**
   * Binary Dust leaving a corpse and flying to whoever earned it. getCollector is read every frame
   * while the digits are in flight. Pass the same function for the same player so they share a
   * slot. It returns feet position, or null. onArrive runs when the first digits land, a good moment
   * for the 'dust-collect' sound.
   */
  dustBurst(pos: Position, count: number, getCollector: (() => Position | null) | null, onArrive?: () => void): void {
    const now = this.pool.now;
    if (now - this.dustWindow >= 1) {
      this.dustWindow = now;
      this.dustSpent = 0;
    }
    const allowed = Math.min(count, DUST_PER_SECOND - this.dustSpent);
    if (allowed <= 0) return;
    this.dustSpent += allowed;

    const slot = this.takeCollectorSlot(getCollector, now + 1.75, pos);
    const s = this.pool.reset();
    s.face = FACE_DIGIT;
    s.move = MOVE_COLLECT;
    s.slot = slot;
    s.ignoreFog = true;
    s.additive = 0.7;
    s.minPixels = 7;
    s.fadeIn = 0.02;
    s.fadeOut = 0.94;
    for (let i = 0; i < allowed; i += 1) {
      const angle = rand(0, 6.283);
      const up = rand(0.15, 1);
      const pace = rand(0.9, 2.8);
      const flat = Math.sqrt(1 - up * up);
      s.x = pos.x + rand(-0.2, 0.2);
      s.y = pos.y + rand(-0.3, 0.3);
      s.z = pos.z + rand(-0.2, 0.2);
      s.vx = Math.cos(angle) * flat * pace * 2.3;
      s.vy = up * pace * 2.3;
      s.vz = Math.sin(angle) * flat * pace * 2.3;
      s.size = s.endSize = rand(0.1, 0.15);
      s.life = rand(1.25, 1.65);
      s.delay = Math.random() * 0.08;
      s.alpha = 1;
      const color = pick(DIGITS);
      setColor(s, color, color);
      this.pool.emit();
    }

    if (getCollector || onArrive) {
      for (let i = 0; i < MAX_ARRIVALS; i += 1) {
        const arrival = this.arrivals[i];
        if (arrival.active) continue;
        arrival.active = true;
        arrival.time = now + 1.3;
        arrival.slot = slot;
        arrival.onArrive = onArrive ?? null;
        break;
      }
    }
  }

  private takeCollectorSlot(get: (() => Position | null) | null, until: number, origin: Position): number {
    let free = 0;
    let soonest = Infinity;
    for (let i = 0; i < COLLECTOR_SLOTS; i += 1) {
      const slot = this.collectors[i];
      if (get && slot.get === get && slot.until >= this.pool.now) {
        slot.until = until;
        return i;
      }
      if (slot.until < soonest) {
        soonest = slot.until;
        free = i;
      }
    }
    const slot = this.collectors[free];
    slot.get = get;
    slot.until = until;
    // With nobody to fly to, the digits just rise from the corpse and fade.
    this.pool.setCollector(free, origin.x, origin.y + 1.8, origin.z);
    const position = get?.();
    if (position) this.pool.setCollector(free, position.x, position.y + 0.95, position.z);
    return free;
  }

  /** The warm breath of light when dust reaches a body. Small on purpose: it happens often. */
  private soulPulse(x: number, y: number, z: number): void {
    const s = this.pool.reset();
    s.x = x; s.y = y; s.z = z;
    s.additive = 1;
    s.ignoreFog = true;
    s.sprite = SPRITE.glow;
    setColor(s, CRIMSON_HOT, CRIMSON);
    s.size = 0.8;
    s.endSize = 1.9;
    s.life = 0.42;
    s.alpha = 0.42;
    s.fadeIn = 0.12;
    s.fadeOut = 0.25;
    this.pool.emit();
    s.sprite = SPRITE.ring;
    s.face = FACE_CAMERA;
    s.size = 0.4;
    s.endSize = 1.7;
    s.life = 0.3;
    s.alpha = 0.16;
    s.fadeIn = 0;
    s.fadeOut = 0.1;
    this.pool.emit();
    this.lightAt(x, y, z, LIGHT_CRIMSON, 3, 7);
  }

  /* ---------- Movement dust ---------- */

  /** A puff at the feet. pos is the feet. Call on footfalls while running, at roll start and along the roll, and on landing. */
  footDust(pos: Position, kind: FootDustKind): void {
    if (this.isFar(pos)) return;
    const puffs = kind === 'walk' ? 1 : kind === 'run' ? 2 : kind === 'roll' ? 5 : 9;
    const scale = kind === 'walk' ? 0.55 : kind === 'run' ? 0.8 : kind === 'roll' ? 1.1 : 1;
    const speed = kind === 'land' ? 2.6 : kind === 'roll' ? 1.3 : 0.6;
    const s = this.pool.reset();
    s.fadeIn = 0.08;
    s.fadeOut = 0.22;
    s.drag = 3.4;
    s.gravity = -0.14;
    for (let i = 0; i < puffs; i += 1) {
      const angle = rand(0, 6.283);
      s.sprite = pick(SPRITE.dust);
      s.x = pos.x + Math.sin(angle) * 0.12;
      s.y = pos.y + rand(0.12, 0.26) * scale;
      s.z = pos.z + Math.cos(angle) * 0.12;
      s.vx = Math.sin(angle) * speed * rand(0.5, 1);
      s.vz = Math.cos(angle) * speed * rand(0.5, 1);
      s.vy = rand(0.1, 0.5);
      s.size = rand(0.38, 0.58) * scale;
      s.endSize = s.size * rand(2.2, 3);
      s.rotation = rand(0, 6.28);
      s.spin = rand(-0.7, 0.7);
      s.life = rand(0.55, 1) * (0.7 + scale * 0.4);
      // A roll puffs so often that the puffs overlap, so each one has to be fainter.
      s.alpha = rand(0.26, 0.42) * (kind === 'roll' ? 0.55 : 1);
      setColor(s, DUST, DUST_DARK);
      this.pool.emit();
    }
    if (kind === 'walk') return;
    s.sprite = SPRITE.grit;
    s.fadeIn = 0;
    s.fadeOut = 0.5;
    s.gravity = 8;
    s.drag = 1.5;
    s.spin = 0;
    s.minPixels = 1;
    for (let i = 0; i < puffs; i += 1) {
      const angle = rand(0, 6.283);
      s.x = pos.x; s.y = pos.y + 0.05; s.z = pos.z;
      s.vx = Math.sin(angle) * rand(0.5, 1.8);
      s.vz = Math.cos(angle) * rand(0.5, 1.8);
      s.vy = rand(0.8, 2);
      s.size = s.endSize = rand(0.1, 0.18);
      s.rotation = rand(0, 6.28);
      s.life = rand(0.25, 0.5);
      s.alpha = 0.55;
      setColor(s, DUST_DARK, DUST_DARK);
      this.pool.emit();
    }
  }

  /* ---------- Moments ---------- */

  /** Gold light fanning out of an opened chest. pos is the chest at ground level. */
  chestOpen(pos: Position): void {
    this.flash({ x: pos.x, y: pos.y + 0.9, z: pos.z }, LIGHT_GOLD, 9, 1.5);
    const s = this.pool.reset();
    s.face = FACE_BASE;
    s.sprite = SPRITE.ray;
    s.additive = 1;
    s.fadeIn = 0.06;
    s.fadeOut = 0.45;
    s.x = pos.x; s.y = pos.y + 0.35; s.z = pos.z;
    // Few, uneven shafts around a soft column. An even spread of rays reads as a peacock's tail.
    for (let i = 0; i < 6; i += 1) {
      const lean = i === 0 ? 0 : rand(-0.5, 0.5);
      s.rotation = lean;
      s.spin = -lean * 0.08;
      s.size = i === 0 ? 2.8 : rand(1.4, 3);
      s.endSize = s.size * 1.15;
      s.aspect = i === 0 ? 0.42 : rand(0.1, 0.2);
      s.life = rand(1.2, 2.1);
      s.alpha = i === 0 ? 0.24 : rand(0.1, 0.24);
      s.delay = rand(0, 0.12);
      setColor(s, GOLD_HOT, AMBER);
      this.pool.emit();
    }
    const g = this.pool.reset();
    g.sprite = SPRITE.glow;
    g.additive = 1;
    g.x = pos.x; g.y = pos.y + 0.45; g.z = pos.z;
    g.size = 0.7;
    g.endSize = 1.5;
    g.life = 1;
    g.alpha = 0.3;
    g.fadeIn = 0.06;
    g.fadeOut = 0.3;
    setColor(g, GOLD_HOT, AMBER);
    this.pool.emit();
    const m = this.pool.reset();
    m.additive = 1;
    m.minPixels = 1;
    m.fadeIn = 0.08;
    m.fadeOut = 0.55;
    m.drag = 0.9;
    m.gravity = -0.3;
    for (let i = 0; i < 70; i += 1) {
      m.sprite = pick(SPRITE.embers);
      m.x = pos.x + rand(-0.35, 0.35);
      m.y = pos.y + rand(0.25, 0.55);
      m.z = pos.z + rand(-0.25, 0.25);
      m.vx = rand(-0.7, 0.7);
      m.vz = rand(-0.7, 0.7);
      m.vy = rand(0.6, 2.2);
      m.extra = rand(0.1, 0.5);
      m.size = rand(0.035, 0.075);
      m.endSize = m.size * 0.5;
      m.rotation = rand(0, 6.28);
      m.life = rand(1, 2.6);
      m.delay = rand(0, 0.3);
      setColor(m, GOLD_HOT, AMBER);
      this.pool.emit();
    }
  }

  /** The air around a dying body: ash and rising digits. pos is the feet of the corpse. See also dissolve. */
  deathMist(pos: Position): void {
    const s = this.pool.reset();
    s.fadeIn = 0.1;
    s.fadeOut = 0.25;
    s.gravity = -0.25;
    s.drag = 1.2;
    for (let i = 0; i < 14; i += 1) {
      s.sprite = pick(SPRITE.smoke);
      s.x = pos.x + rand(-0.3, 0.3);
      s.y = pos.y + rand(0.2, 1.3);
      s.z = pos.z + rand(-0.3, 0.3);
      s.vx = rand(-0.2, 0.2);
      s.vz = rand(-0.2, 0.2);
      s.vy = rand(0.1, 0.45);
      s.size = rand(0.5, 0.85);
      s.endSize = s.size * 1.9;
      s.rotation = rand(0, 6.28);
      s.spin = rand(-0.4, 0.4);
      s.life = rand(1.1, 2.1);
      s.alpha = rand(0.14, 0.3);
      s.delay = rand(0, 0.5);
      setColor(s, ASH_DARK, ASH_DARK);
      this.pool.emit();
    }
    s.fadeIn = 0.06;
    s.fadeOut = 0.45;
    s.minPixels = 1;
    s.gravity = -0.45;
    s.drag = 0.6;
    for (let i = 0; i < 90; i += 1) {
      s.sprite = pick(SPRITE.ash);
      s.x = pos.x + rand(-0.35, 0.35);
      s.y = pos.y + rand(0.05, 1.5);
      s.z = pos.z + rand(-0.35, 0.35);
      s.vx = rand(-0.25, 0.25);
      s.vz = rand(-0.25, 0.25);
      s.vy = rand(0.1, 0.8);
      s.extra = rand(0.2, 0.7);
      s.size = rand(0.045, 0.1);
      s.endSize = s.size * 0.6;
      s.rotation = rand(0, 6.28);
      s.spin = rand(-3, 3);
      s.life = rand(1.3, 2.8);
      s.alpha = rand(0.6, 1);
      s.delay = rand(0, 0.7);
      setColor(s, ASH, ASH_DARK);
      this.pool.emit();
    }
    const d = this.pool.reset();
    d.face = FACE_DIGIT;
    d.ignoreFog = true;
    d.additive = 0.7;
    d.minPixels = 7;
    d.fadeIn = 0.1;
    d.fadeOut = 0.45;
    d.gravity = -0.5;
    d.drag = 0.8;
    for (let i = 0; i < 34; i += 1) {
      d.x = pos.x + rand(-0.32, 0.32);
      d.y = pos.y + rand(0.05, 1.5);
      d.z = pos.z + rand(-0.32, 0.32);
      d.vx = rand(-0.12, 0.12);
      d.vz = rand(-0.12, 0.12);
      d.vy = rand(0.2, 0.9);
      d.size = d.endSize = rand(0.09, 0.13);
      d.life = rand(1, 2.1);
      d.delay = rand(0, 0.7);
      const color = pick(DIGITS);
      setColor(d, color, DIGITS[2]);
      this.pool.emit();
    }
  }

  /**
   * Burns a body's meshes away in blocks. Call it with deathMist, a little after the killing blow.
   * At the end root is hidden and onDone runs. To show the body again, set root.visible = true.
   */
  dissolve(root: THREE.Object3D, seconds = 1.7, onDone?: () => void): void {
    this.corpses.start(root, seconds, onDone ?? null);
  }

  /** Stops a dissolve and restores the body, for someone respawning before it finished. */
  undissolve(root: THREE.Object3D): void {
    this.corpses.restore(root);
  }

  /** Coming back. Gold light rising around the spot. pos is the feet. */
  respawn(pos: Position): void {
    this.flash({ x: pos.x, y: pos.y + 1, z: pos.z }, LIGHT_GOLD, 12, 1.8);
    const s = this.pool.reset();
    s.face = FACE_BASE;
    s.sprite = SPRITE.ray;
    s.additive = 1;
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.fadeIn = 0.15;
    s.fadeOut = 0.4;
    for (let i = 0; i < 3; i += 1) {
      s.rotation = rand(-0.05, 0.05);
      s.size = rand(3, 3.7);
      s.endSize = s.size * 1.1;
      s.aspect = rand(0.32, 0.5);
      s.life = rand(1.1, 1.5);
      s.alpha = rand(0.16, 0.26);
      setColor(s, GOLD_HOT, AMBER);
      this.pool.emit();
    }
    const r = this.pool.reset();
    r.face = FACE_GROUND;
    r.sprite = SPRITE.shock;
    r.additive = 1;
    r.x = pos.x; r.y = pos.y + 0.05; r.z = pos.z;
    r.size = 2.2;
    r.endSize = 0.9;
    r.life = 0.7;
    r.alpha = 0.13;
    r.fadeIn = 0.2;
    r.fadeOut = 0.3;
    setColor(r, GOLD, AMBER);
    this.pool.emit();
    this.risingSwirl(pos, 50, 0.65, GOLD_HOT, AMBER, 1.8);
  }

  /** Drinking a flask. Amber motes winding up around the body. pos is the feet. */
  potion(pos: Position): void {
    this.flash({ x: pos.x, y: pos.y + 1, z: pos.z }, LIGHT_GOLD, 5, 2.5);
    this.risingSwirl(pos, 34, 0.5, HEAL, HEAL_DEEP, 1.25);
    const g = this.pool.reset();
    g.sprite = SPRITE.glow;
    g.additive = 1;
    g.x = pos.x; g.y = pos.y + 0.95; g.z = pos.z;
    g.size = 1.3;
    g.endSize = 2;
    g.life = 0.9;
    g.alpha = 0.2;
    g.fadeIn = 0.25;
    g.fadeOut = 0.3;
    setColor(g, HEAL, HEAL_DEEP);
    this.pool.emit();
  }

  /** Ribbons and a ground glow that stay with someone while they drink. feet is read every frame. */
  healStart(id: number, feet: Position): void {
    this.healing.start(id, feet);
  }

  /** The health has arrived. */
  healPulse(id: number, feet: Position): void {
    this.healing.pulse(id);
    this.potion(feet);
  }

  /** The drink is over, or was spilled. */
  healEnd(id: number): void {
    this.healing.end(id);
  }

  private risingSwirl(pos: Position, count: number, radius: number, from: readonly number[], to: readonly number[], life: number): void {
    const s = this.pool.reset();
    s.move = MOVE_ORBIT;
    s.additive = 1;
    s.minPixels = 1;
    s.fadeIn = 0.15;
    s.fadeOut = 0.55;
    for (let i = 0; i < count; i += 1) {
      s.sprite = pick(SPRITE.embers);
      s.x = pos.x; s.y = pos.y + rand(0, 0.5); s.z = pos.z;
      s.vy = rand(0.7, 1.7);
      s.rotation = rand(0, 6.283);
      s.spin = rand(2.5, 4.2);
      s.extra = rand(0.7, 1.15) * radius;
      s.size = rand(0.035, 0.07);
      s.endSize = s.size * 0.5;
      s.life = rand(0.8, 1) * life;
      s.delay = rand(0, 0.4);
      setColor(s, from, to);
      this.pool.emit();
    }
  }

  /* ---------- Small helpers ---------- */

  /** Lights the surroundings for a moment. The brightest thing a hit does to the rest of the picture. */
  private flash(pos: Position, color: THREE.Color, intensity: number, decay: number): void {
    this.lightAt(pos.x, pos.y, pos.z, color, intensity, decay);
  }

  private lightAt(x: number, y: number, z: number, color: THREE.Color, intensity: number, decay: number): void {
    // Prefer an idle light. If both are busy, the newest moment takes the dimmer one.
    let slot = this.lights[this.nextLight];
    for (let i = 0; i < LIGHTS; i += 1) {
      if (this.lights[i].light.intensity < slot.light.intensity) slot = this.lights[i];
    }
    if (slot.light.intensity > intensity) return;
    this.nextLight = (this.nextLight + 1) % LIGHTS;
    slot.light.position.set(x, y, z);
    slot.light.color.copy(color);
    slot.light.intensity = intensity;
    slot.decay = decay;
  }

  private isFar(pos: Position): boolean {
    const dx = pos.x - this.camera.position.x;
    const dz = pos.z - this.camera.position.z;
    return dx * dx + dz * dz > FAR_DISTANCE * FAR_DISTANCE;
  }
}
