import * as THREE from 'three';
import { steerToward } from '../../../../shared/combat';
import { ATLAS } from './atlas';
import { ArcaneRibbons } from './arcaneRibbons';
import {
  FACE_BASE, FACE_CAMERA, FACE_DIGIT_TINT, FACE_GROUND, FACE_VELOCITY, MOVE_ORBIT, type ParticlePool,
} from './particles';

/*
 * Every spell: blue and gold light, a clean strike and a sudden burst travelling outward. Binary
 * Dust appears only as a few tiny flickering digits in the same colors. Red is left to the Binary
 * Dust that flies from kills, so it always means currency.
 * Everything here comes from fixed pools. Nothing allocates per frame.
 */

function rgb(hex: string): readonly [number, number, number] {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

export const ARCANE_BLUE = rgb('#3f8cff');
export const ARCANE_WHITE = rgb('#f4f8ff');
const BLUE_HOT = rgb('#b2dcff');
const BLUE_DEEP = rgb('#16358f');
const GOLD = rgb('#ffbe45');
const GOLD_HOT = rgb('#fff0bf');
const GOLD_DEEP = rgb('#8f5612');
const NIGHT = rgb('#10143a');

export const LIGHT_ARCANE_BLUE = new THREE.Color('#6aa8ff');
export const LIGHT_ARCANE_GOLD = new THREE.Color('#ffd27a');

const SPRITE = {
  glow: ATLAS.glow,
  ring: ATLAS.ring,
  shock: ATLAS.shockwave,
  streak: ATLAS['spark-streak'],
  smokeRing: ATLAS['smoke-ring'],
  crack: ATLAS.crack,
  ember: ATLAS['ember-1'],
};

const MAX_BOLTS = 16;
const MAX_CRESCENTS = 8;
const MAX_METEORS = 4;
/** Past this distance a spell's bits are too small to see, so most of them are skipped. */
const FAR_DISTANCE = 42;
/** How high in the air a meteor appears, and how far back toward the caster. */
const METEOR_HEIGHT = 30;
const METEOR_BACK = 14;
/** How long a meteor's light and swirl outlast its landing. */
const BLAST_SECONDS = 0.75;
/** A meteor whose landing never arrives, as when the caster walks out of range, stops waiting after this. */
const METEOR_PATIENCE = 1.5;
const BOLT_HEIGHT = 1.2;
const CRESCENT_HEIGHT = 1.15;

function rand(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

interface Bolt {
  active: boolean;
  id: number;
  x: number; y: number; z: number;
  /** How far the drawn bolt starts from the server's path: it leaves the weapon, not the body. */
  offX: number; offZ: number;
  dirX: number; dirZ: number;
  speed: number;
  left: number;
  target: number;
  turn: number;
  age: number;
  phase: number;
  emit: number;
  blue: number;
  gold: number;
}

interface Crescent {
  active: boolean;
  id: number;
  x: number; z: number;
  dirX: number; dirZ: number;
  speed: number;
  left: number;
  width: number;
  age: number;
  fade: number;
  fading: boolean;
  emit: number;
  tipA: number;
  tipB: number;
  mesh: THREE.Mesh;
  uniforms: { uTime: { value: number }; uFade: { value: number }; uSeed: { value: number } };
}

interface MeteorSlot {
  active: boolean;
  id: number;
  x: number; z: number;
  startX: number; startZ: number;
  radius: number;
  delay: number;
  age: number;
  /** Seconds since it landed, or negative while it's still falling. */
  blast: number;
  emit: number;
  ribbons: [number, number, number];
  circle: THREE.Mesh;
  circleUniforms: { uTime: { value: number }; uProgress: { value: number }; uFade: { value: number } };
  galaxy: THREE.Mesh;
  galaxyUniforms: { uTime: { value: number }; uFade: { value: number } };
  rock: THREE.Mesh;
  rockUniforms: { uTime: { value: number } };
}

const PLAIN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CRESCENT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    // x runs tip to tip, and y from the back of the blade to its leading edge.
    float x = vUv.x * 2.0 - 1.0;
    float y = vUv.y;
    float tips = 1.0 - x * x;
    float body = smoothstep(0.0, 0.75, y) * pow(tips, 0.7);
    float edge = exp(-pow((y - 0.84) * 9.0, 2.0)) * pow(tips, 0.45);
    float grain = 0.72 + 0.28 * sin(x * 24.0 + y * 9.0 - uTime * 16.0 + uSeed) * sin(x * 9.0 - uTime * 7.0 + uSeed * 2.0);
    vec3 blue = vec3(0.14, 0.42, 1.3);
    vec3 gold = vec3(1.4, 0.82, 0.22);
    vec3 color = mix(blue, gold, smoothstep(0.35, 0.8, y) * (0.55 + 0.45 * sin(x * 3.0 + uSeed))) * body * grain * 0.62;
    color += vec3(1.2, 1.14, 1.0) * edge * 1.5;
    gl_FragColor = vec4(color * uFade, 1.0);
  }
`;

const CIRCLE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    // The outer line is the real edge of the blast. The inner one closes in on it as the impact nears.
    float rim = smoothstep(0.03, 0.0, abs(r - 0.965));
    float closing = smoothstep(0.02, 0.0, abs(r - uProgress * 0.965));
    float marks = step(0.8, fract((a + uTime * 0.7) * 3.8197)) * smoothstep(0.012, 0.0, abs(r - 0.86) - 0.03);
    float spokes = step(0.96, fract((a - uTime * 0.35) * 1.9098)) * smoothstep(0.86, 0.5, r) * smoothstep(0.1, 0.3, r);
    float beat = 0.72 + 0.28 * sin(uTime * (7.0 + uProgress * 22.0));
    vec3 color = mix(vec3(0.2, 0.5, 1.3), vec3(1.5, 0.82, 0.25), uProgress * uProgress);
    float light = rim * 1.1 + closing * 0.9 + marks * 0.65 + spokes * 0.25 + uProgress * 0.12 * (1.0 - r * 0.5);
    gl_FragColor = vec4(color * light * beat * uFade, 1.0);
  }
`;

const GALAXY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  varying vec2 vUv;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Tipped, so that it reads as a disc seen at an angle and not as a flat sticker.
    p = vec2(p.x * 0.86 + p.y * 0.5, (p.y * 0.86 - p.x * 0.5) * 1.75);
    float r = length(p);
    float a = atan(p.y, p.x);
    float mask = smoothstep(1.0, 0.45, r);
    float wind = a * 2.0 + log(r + 0.04) * 5.5 - uTime * 5.0;
    float arms = pow(0.5 + 0.5 * cos(wind), 3.0);
    float cell = hash(floor(vec2(wind * 5.0, r * 26.0)));
    float stars = step(0.93, cell) * smoothstep(0.08, 0.3, r);
    float falloff = exp(-r * 2.6);
    vec3 color = vec3(0.14, 0.38, 1.3) * arms * falloff * 2.0;
    color += vec3(1.4, 0.82, 0.28) * arms * pow(falloff, 2.0) * 1.6;
    color += vec3(1.5, 1.2, 0.75) * exp(-r * r * 34.0) * 2.6;
    color += vec3(1.1, 1.1, 1.3) * stars * mask * 0.9;
    gl_FragColor = vec4(color * mask * uFade, 1.0);
  }
`;

const ROCK_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-view.xyz);
    gl_Position = projectionMatrix * view;
  }
`;

const ROCK_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Dark stone split by molten gold, under a rim of blue fire.
    float crack = sin(vLocal.x * 9.0 + uTime * 2.0) * sin(vLocal.y * 11.0 - uTime * 1.5) * sin(vLocal.z * 8.0 + uTime);
    float molten = smoothstep(0.05, 0.3, crack);
    float rim = pow(1.0 - max(0.0, dot(normalize(vNormal), normalize(vView))), 2.0);
    vec3 color = vec3(0.03, 0.035, 0.09) + vec3(1.5, 0.85, 0.25) * molten + vec3(0.35, 0.7, 1.6) * rim * 1.5;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** A curved blade with its tips at x = -1 and 1. It's a band standing up, so it reads from behind the player. */
function crescentGeometry(): THREE.BufferGeometry {
  const columns = 28;
  const rows = 6;
  const spread = (72 * Math.PI) / 180;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let c = 0; c <= columns; c += 1) {
    const u = c / columns;
    const angle = (u * 2 - 1) * spread;
    const tips = 1 - (u * 2 - 1) ** 2;
    for (let r = 0; r <= rows; r += 1) {
      const v = r / rows;
      const across = (v - 0.84) * 0.8 * Math.pow(tips, 0.6);
      const radius = 1 / Math.sin(spread);
      positions.push(Math.sin(angle) * radius, across, (Math.cos(angle) - Math.cos(spread)) * radius - 0.35);
      uvs.push(u, v);
    }
  }
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const a = c * (rows + 1) + r;
      const b = a + rows + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export class ArcaneFx {
  /** Finds a creature's chest from its id. False when it's gone. Set once by whoever owns the creatures. */
  findTarget: ((id: number, out: THREE.Vector3) => boolean) | null = null;
  groundY = 0;

  private readonly ribbons: ArcaneRibbons;
  private readonly bolts: Bolt[] = [];
  private readonly crescents: Crescent[] = [];
  private readonly meteors: MeteorSlot[] = [];
  private readonly crescentGeometry = crescentGeometry();
  private readonly planeGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly materials: THREE.Material[] = [];
  /** Wide enough to light a whole blast. Always in the scene and only dimmed, as adding one would recompile every material. */
  private readonly bigLight = new THREE.PointLight(0xffffff, 0, 28, 1.3);
  private bigLightDecay = 0;
  private readonly aim = new THREE.Vector3();
  private readonly steered = { x: 0, z: 1 };
  private readonly eye = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  /** Fewer particles on phones, whose pool is smaller and overwrites sooner. */
  private readonly spend: number;
  private clock = 0;
  private chargeLast = -10;
  private chargeCarry = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly pool: ParticlePool,
    private readonly light: (x: number, y: number, z: number, color: THREE.Color, intensity: number, decay: number) => void,
  ) {
    this.spend = pool.capacity < 2000 ? 0.45 : 1;
    this.ribbons = new ArcaneRibbons(camera);
    scene.add(this.ribbons.mesh, this.bigLight);

    for (let i = 0; i < MAX_BOLTS; i += 1) {
      this.bolts.push({
        active: false, id: -1, x: 0, y: 0, z: 0, offX: 0, offZ: 0, dirX: 0, dirZ: 1, speed: 0, left: 0, target: 0, turn: 0, age: 0, phase: 0, emit: 0, blue: -1, gold: -1,
      });
    }

    const additive = { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending } as const;
    for (let i = 0; i < MAX_CRESCENTS; i += 1) {
      const uniforms = { uTime: { value: 0 }, uFade: { value: 0 }, uSeed: { value: 0 } };
      const material = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: CRESCENT_FRAGMENT, uniforms, ...additive });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.crescentGeometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 18;
      mesh.rotation.order = 'YXZ';
      scene.add(mesh);
      this.crescents.push({
        active: false, id: -1, x: 0, z: 0, dirX: 0, dirZ: 1, speed: 0, left: 0, width: 1, age: 0, fade: 1, fading: false, emit: 0, tipA: -1, tipB: -1, mesh, uniforms,
      });
    }

    for (let i = 0; i < MAX_METEORS; i += 1) {
      const circleUniforms = { uTime: { value: 0 }, uProgress: { value: 0 }, uFade: { value: 0 } };
      // Must be seen even where the ground rises above the circle: it's the warning.
      const circleMaterial = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: CIRCLE_FRAGMENT, uniforms: circleUniforms, ...additive, depthTest: false });
      const circle = new THREE.Mesh(this.planeGeometry, circleMaterial);
      circle.rotation.x = -Math.PI / 2;
      circle.visible = false;
      circle.renderOrder = 17;
      const galaxyUniforms = { uTime: { value: 0 }, uFade: { value: 0 } };
      const galaxyMaterial = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: GALAXY_FRAGMENT, uniforms: galaxyUniforms, ...additive });
      const galaxy = new THREE.Mesh(this.planeGeometry, galaxyMaterial);
      galaxy.visible = false;
      galaxy.renderOrder = 18;
      const rockUniforms = { uTime: { value: 0 } };
      const rockMaterial = new THREE.ShaderMaterial({ vertexShader: ROCK_VERTEX, fragmentShader: ROCK_FRAGMENT, uniforms: rockUniforms });
      const rock = new THREE.Mesh(this.rockGeometry, rockMaterial);
      rock.visible = false;
      this.materials.push(circleMaterial, galaxyMaterial, rockMaterial);
      scene.add(circle, galaxy, rock);
      this.meteors.push({
        active: false, id: -1, x: 0, z: 0, startX: 0, startZ: 0, radius: 1, delay: 1, age: 0, blast: -1, emit: 0, ribbons: [-1, -1, -1], circle, circleUniforms, galaxy, galaxyUniforms, rock, rockUniforms,
      });
    }
  }

  /* ---------- The frame ---------- */

  update(seconds: number): void {
    this.clock += seconds;
    this.eye.setFromMatrixPosition(this.camera.matrixWorld);
    for (let i = 0; i < MAX_BOLTS; i += 1) {
      if (this.bolts[i].active) this.stepBolt(this.bolts[i], seconds);
    }
    for (let i = 0; i < MAX_CRESCENTS; i += 1) {
      if (this.crescents[i].active) this.stepCrescent(this.crescents[i], seconds);
    }
    if (this.bigLight.intensity > 0.01) this.bigLight.intensity *= Math.exp(-this.bigLightDecay * seconds);
    else this.bigLight.intensity = 0;
    for (let i = 0; i < MAX_METEORS; i += 1) {
      if (this.meteors[i].active) this.stepMeteor(this.meteors[i], seconds);
    }
    this.ribbons.update(seconds);
  }

  dispose(): void {
    this.scene.remove(this.ribbons.mesh, this.bigLight);
    this.ribbons.dispose();
    for (const crescent of this.crescents) this.scene.remove(crescent.mesh);
    for (const meteor of this.meteors) this.scene.remove(meteor.circle, meteor.galaxy, meteor.rock);
    for (const material of this.materials) material.dispose();
    this.crescentGeometry.dispose();
    this.planeGeometry.dispose();
    this.rockGeometry.dispose();
  }

  /** Where a world point lands on screen, from 0 to 1 on each side. False if it's behind the camera. */
  screenSpot(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.projected.set(x, y, z).project(this.camera);
    if (this.projected.z > 1 || this.projected.z < -1) return false;
    out.x = this.projected.x * 0.5 + 0.5;
    out.y = this.projected.y * 0.5 + 0.5;
    return true;
  }

  private isFar(x: number, y: number, z: number): boolean {
    const dx = x - this.eye.x;
    const dy = y - this.eye.y;
    const dz = z - this.eye.z;
    return dx * dx + dy * dy + dz * dz > FAR_DISTANCE * FAR_DISTANCE;
  }

  /* ---------- Small shared pieces ---------- */

  /** One tiny 1 or 0 in gold or blue. The dust is a seasoning here, so keep the counts low. */
  private digit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const s = this.pool.reset();
    s.face = FACE_DIGIT_TINT;
    s.ignoreFog = true;
    s.additive = 0.85;
    s.minPixels = 5;
    s.fadeOut = 0.4;
    s.x = x; s.y = y; s.z = z;
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.drag = 3;
    s.gravity = -0.2;
    s.size = s.endSize = rand(0.05, 0.08);
    s.life = life;
    this.tint(s, Math.random() < 0.5);
    this.pool.emit();
  }

  private tint(s: ReturnType<ParticlePool['reset']>, blue: boolean): void {
    const from = blue ? BLUE_HOT : GOLD_HOT;
    const to = blue ? BLUE_DEEP : GOLD_DEEP;
    s.r = from[0]; s.g = from[1]; s.b = from[2];
    s.r2 = to[0]; s.g2 = to[1]; s.b2 = to[2];
  }

  private paint(s: ReturnType<ParticlePool['reset']>, from: readonly number[], to: readonly number[]): void {
    s.r = from[0]; s.g = from[1]; s.b = from[2];
    s.r2 = to[0]; s.g2 = to[1]; s.b2 = to[2];
  }

  /** A soft light on a spot of ground, which is cheaper than a real light and needs no shadow of its own. */
  private groundGlow(x: number, z: number, size: number, life: number, alpha: number, color: readonly number[]): void {
    const s = this.pool.reset();
    s.face = FACE_GROUND;
    s.sprite = SPRITE.glow;
    s.additive = 1;
    s.ignoreFog = true;
    s.x = x; s.y = this.groundY + 0.07; s.z = z;
    s.size = size;
    s.endSize = size * 1.15;
    s.life = life;
    s.alpha = alpha;
    s.fadeOut = 0.2;
    this.paint(s, color, color);
    this.pool.emit();
  }

  private glow(x: number, y: number, z: number, size: number, endSize: number, life: number, alpha: number, from: readonly number[], to: readonly number[]): void {
    const s = this.pool.reset();
    s.sprite = SPRITE.glow;
    s.additive = 1;
    s.ignoreFog = true;
    s.x = x; s.y = y; s.z = z;
    s.size = size;
    s.endSize = endSize;
    s.life = life;
    s.alpha = alpha;
    s.fadeOut = 0.1;
    this.paint(s, from, to);
    this.pool.emit();
  }

  /** A shaft of light going straight up, as a soft bright line inside a wide faint one. */
  private beam(x: number, y: number, z: number, height: number, width: number, life: number, blue: boolean): void {
    const s = this.pool.reset();
    s.face = FACE_BASE;
    s.sprite = SPRITE.glow;
    s.additive = 1;
    s.ignoreFog = true;
    s.x = x; s.y = y; s.z = z;
    s.size = s.endSize = height;
    s.aspect = (width * 3.5) / height;
    s.life = life * 1.3;
    s.alpha = 0.35;
    s.fadeOut = 0.15;
    this.tint(s, blue);
    this.pool.emit();
    s.aspect = width / height;
    s.life = life;
    s.alpha = 1;
    this.paint(s, ARCANE_WHITE, blue ? BLUE_HOT : GOLD_HOT);
    this.pool.emit();
  }

  /* ---------- Charging up ---------- */

  /**
   * Light gathering on a weapon, called every frame of the windup. power scales it, from about 1 for
   * a wand to more than 2 for the staff. Motes fall inward, so it reads as power being drawn in.
   */
  charge(pos: { x: number; y: number; z: number }, power: number): void {
    const now = this.clock;
    const fresh = now - this.chargeLast > 0.25;
    this.chargeCarry = fresh ? 3 : this.chargeCarry + (now - this.chargeLast) * 60 * power * this.spend;
    this.chargeLast = now;
    const count = Math.min(10, this.chargeCarry | 0);
    this.chargeCarry -= count;
    const s = this.pool.reset();
    s.sprite = SPRITE.glow;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.fadeIn = 0.25;
    s.fadeOut = 0.6;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      const up = rand(-0.8, 0.8);
      const flat = Math.sqrt(1 - up * up);
      const far = rand(0.3, 0.55) * Math.sqrt(power);
      const life = rand(0.2, 0.36);
      s.x = pos.x + Math.cos(angle) * flat * far;
      s.y = pos.y + up * far;
      s.z = pos.z + Math.sin(angle) * flat * far;
      s.vx = (pos.x - s.x) / life;
      s.vy = (pos.y - s.y) / life;
      s.vz = (pos.z - s.z) / life;
      s.size = rand(0.035, 0.07);
      s.endSize = 0.02;
      s.life = life;
      s.alpha = 1;
      this.tint(s, Math.random() < 0.5);
      this.pool.emit();
    }
    if (count > 0) {
      const size = 0.32 * Math.sqrt(power);
      this.glow(pos.x, pos.y, pos.z, size * rand(0.85, 1.15), size * 1.25, 0.09, 0.5, BLUE_HOT, GOLD);
      this.glow(pos.x, pos.y, pos.z, size * 0.3, size * 0.4, 0.07, 0.9, ARCANE_WHITE, GOLD_HOT);
      if (Math.random() < 0.05) {
        this.digit(pos.x + rand(-0.2, 0.2), pos.y + rand(-0.15, 0.2), pos.z + rand(-0.2, 0.2), 0, rand(0.1, 0.5), 0, rand(0.25, 0.45));
      }
    }
  }

  /** The moment a spell leaves the weapon: a hard flash, and a line of light for the bigger ones. */
  release(pos: { x: number; y: number; z: number }, power: number): void {
    const size = 0.5 * Math.sqrt(power);
    this.glow(pos.x, pos.y, pos.z, size * 2.2, size * 3, 0.16, 0.55, BLUE_HOT, ARCANE_BLUE);
    this.glow(pos.x, pos.y, pos.z, size, size * 1.3, 0.09, 1, ARCANE_WHITE, GOLD_HOT);
    this.light(pos.x, pos.y, pos.z, power > 1.5 ? LIGHT_ARCANE_GOLD : LIGHT_ARCANE_BLUE, 4 + power * 3, 11);
    this.streaks(pos.x, pos.y, pos.z, (6 * power * this.spend) | 0, 3.5 * Math.sqrt(power), 0.22, 0.03);
  }

  /** Thin lines of light thrown outward from one spot. */
  private streaks(x: number, y: number, z: number, count: number, speed: number, life: number, size: number): void {
    const s = this.pool.reset();
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.streak;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.aspect = 14;
    s.drag = 2.6;
    s.gravity = 0.6;
    s.fadeOut = 0.25;
    s.x = x; s.y = y; s.z = z;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      const up = rand(-0.45, 0.85);
      const flat = Math.sqrt(1 - up * up);
      const pace = rand(0.45, 1) * speed;
      s.vx = Math.cos(angle) * flat * pace;
      s.vy = up * pace;
      s.vz = Math.sin(angle) * flat * pace;
      s.size = size * rand(0.7, 1.3);
      s.endSize = s.size * 0.3;
      s.life = life * rand(0.7, 1.3);
      s.alpha = 1;
      this.tint(s, Math.random() < 0.55);
      this.pool.emit();
    }
  }

  /* ---------- Bolts ---------- */

  /** A bolt seeking a creature, or flying straight if target is 0. from is where it visibly leaves, usually the weapon tip. */
  bolt(id: number, x: number, z: number, from: { x: number; y: number; z: number }, yaw: number, speed: number, range: number, target: number, turn: number): void {
    let slot: Bolt | null = null;
    for (let i = 0; i < MAX_BOLTS; i += 1) {
      if (!this.bolts[i].active) {
        slot = this.bolts[i];
        break;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.id = id;
    slot.x = x; slot.z = z;
    slot.y = from.y;
    slot.offX = from.x - x;
    slot.offZ = from.z - z;
    slot.dirX = Math.sin(yaw);
    slot.dirZ = Math.cos(yaw);
    slot.speed = speed;
    slot.left = range;
    slot.target = target;
    slot.turn = turn;
    slot.age = 0;
    slot.phase = rand(0, 6.283);
    slot.emit = 0;
    slot.blue = this.ribbons.open(from.x, from.y, from.z, 0, 0.11, 0.42);
    slot.gold = this.ribbons.open(from.x, from.y, from.z, 1, 0.085, 0.42);
  }

  private stepBolt(p: Bolt, seconds: number): void {
    p.age += seconds;
    let wantedY = BOLT_HEIGHT;
    if (p.target !== 0) {
      if (this.findTarget?.(p.target, this.aim)) {
        // The same rule the server flies it by, so what you see is what the bolt is really doing.
        steerToward(p.dirX, p.dirZ, this.aim.x - p.x, this.aim.z - p.z, p.turn * seconds, this.steered);
        p.dirX = this.steered.x;
        p.dirZ = this.steered.z;
        wantedY = this.aim.y;
      } else {
        p.target = 0;
      }
    }
    const step = Math.min(p.left, p.speed * seconds);
    p.x += p.dirX * step;
    p.z += p.dirZ * step;
    p.left -= step;
    p.y += (wantedY - p.y) * (1 - Math.exp(-seconds * 7));
    if (p.left <= 0) {
      // Ran out before the server's end message. It stops here rather than overshoot.
      this.closeBolt(p);
      return;
    }

    const settle = Math.exp(-p.age * 7);
    const x = p.x + p.offX * settle;
    const z = p.z + p.offZ * settle;
    // Blue and gold wind around each other, which makes a thin bolt look alive even flying straight.
    const twist = p.phase + p.age * 21;
    const reach = 0.13 * (1 - settle * 0.8);
    const sideX = p.dirZ * Math.cos(twist) * reach;
    const sideZ = -p.dirX * Math.cos(twist) * reach;
    const lift = Math.sin(twist) * reach;
    this.ribbons.move(p.blue, x + sideX, p.y + lift, z + sideZ);
    this.ribbons.move(p.gold, x - sideX, p.y - lift, z - sideZ);

    p.emit += seconds;
    let budget = 3;
    while (p.emit >= 0.022 && budget > 0) {
      p.emit -= 0.022;
      budget -= 1;
      this.boltBits(p, x, z);
    }
    if (budget === 0) p.emit = 0;
  }

  private boltBits(p: Bolt, x: number, z: number): void {
    const vx = p.dirX * p.speed;
    const vz = p.dirZ * p.speed;
    // The head: gone in a moment and replaced, so it stays with the bolt through a turn.
    const s = this.pool.reset();
    s.sprite = SPRITE.glow;
    s.additive = 1;
    s.ignoreFog = true;
    s.x = x; s.y = p.y; s.z = z;
    s.vx = vx; s.vz = vz;
    s.size = 0.62;
    s.endSize = 0.45;
    s.life = 0.05;
    s.alpha = 0.42;
    s.fadeOut = 0.5;
    this.paint(s, BLUE_HOT, ARCANE_BLUE);
    this.pool.emit();
    s.size = 0.18;
    s.endSize = 0.14;
    s.alpha = 1;
    this.paint(s, ARCANE_WHITE, GOLD_HOT);
    this.pool.emit();

    if (this.spend < 1 && Math.random() < 0.5) return;
    if (Math.random() < 0.3) {
      // Stars left behind on the path.
      s.vx = rand(-0.5, 0.5); s.vy = rand(-0.3, 0.6); s.vz = rand(-0.5, 0.5);
      s.x = x + rand(-0.14, 0.14); s.y = p.y + rand(-0.14, 0.14); s.z = z + rand(-0.14, 0.14);
      s.drag = 1.6;
      s.minPixels = 1;
      s.size = rand(0.03, 0.06);
      s.endSize = 0.012;
      s.life = rand(0.3, 0.7);
      s.alpha = 1;
      s.fadeOut = 0.4;
      this.tint(s, Math.random() < 0.5);
      this.pool.emit();
    }
    if (Math.random() < 0.035) this.digit(x, p.y, z, rand(-0.4, 0.4), rand(0, 0.5), rand(-0.4, 0.4), rand(0.25, 0.5));
    if (Math.random() < 0.2) this.groundGlow(x, z, 1.5, 0.13, 0.2, ARCANE_BLUE);
  }

  private closeBolt(p: Bolt): void {
    p.active = false;
    this.ribbons.release(p.blue);
    this.ribbons.release(p.gold);
    p.blue = p.gold = -1;
  }

  /* ---------- Crescents ---------- */

  crescent(id: number, x: number, z: number, yaw: number, speed: number, range: number, width: number): void {
    let slot: Crescent | null = null;
    for (let i = 0; i < MAX_CRESCENTS; i += 1) {
      if (!this.crescents[i].active) {
        slot = this.crescents[i];
        break;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.id = id;
    slot.x = x; slot.z = z;
    slot.dirX = Math.sin(yaw);
    slot.dirZ = Math.cos(yaw);
    slot.speed = speed;
    slot.left = range;
    slot.width = width;
    slot.age = 0;
    slot.fade = 1;
    slot.fading = false;
    slot.emit = 0;
    const halfX = slot.dirZ * width * 0.5;
    const halfZ = -slot.dirX * width * 0.5;
    slot.tipA = this.ribbons.open(x + halfX, CRESCENT_HEIGHT, z + halfZ, 0, 0.09, 0.4);
    slot.tipB = this.ribbons.open(x - halfX, CRESCENT_HEIGHT, z - halfZ, 1, 0.09, 0.4);
    slot.mesh.visible = true;
    // Forward so it's seen from a camera above and behind, and rolled so it's a cut and not a wall.
    slot.mesh.rotation.set(0.55, yaw, rand(-0.32, 0.32));
    slot.uniforms.uSeed.value = rand(0, 100);
    this.placeCrescent(slot);
  }

  private placeCrescent(p: Crescent): void {
    p.mesh.position.set(p.x, CRESCENT_HEIGHT, p.z);
    // Unfolds as it leaves the swing, which is most of what makes it feel thrown.
    const open = 0.5 + 0.5 * (1 - Math.exp(-p.age * 13));
    const half = p.width * 0.5 * open;
    p.mesh.scale.set(half, half * 0.8, half);
    p.uniforms.uTime.value = this.clock;
    p.uniforms.uFade.value = p.fade;
  }

  private stepCrescent(p: Crescent, seconds: number): void {
    p.age += seconds;
    const step = Math.min(p.left, p.speed * seconds);
    p.x += p.dirX * step;
    p.z += p.dirZ * step;
    p.left -= step;
    if (p.fading || p.left <= 0) {
      p.fading = true;
      p.fade -= seconds * 4.5;
      if (p.fade <= 0) {
        this.closeCrescent(p);
        return;
      }
    } else if (p.left < 2) {
      p.fade = Math.max(0.35, p.left / 2);
    }
    this.placeCrescent(p);

    const half = p.width * 0.5 * (0.5 + 0.5 * (1 - Math.exp(-p.age * 13)));
    const sideX = p.dirZ * half;
    const sideZ = -p.dirX * half;
    this.ribbons.move(p.tipA, p.x + sideX - p.dirX * 0.35, CRESCENT_HEIGHT, p.z + sideZ - p.dirZ * 0.35);
    this.ribbons.move(p.tipB, p.x - sideX - p.dirX * 0.35, CRESCENT_HEIGHT, p.z - sideZ - p.dirZ * 0.35);

    p.emit += seconds;
    let budget = 3;
    while (p.emit >= 0.03 && budget > 0) {
      p.emit -= 0.03;
      budget -= 1;
      if (this.spend < 1 && Math.random() < 0.5) continue;
      const across = rand(-1, 1);
      const bow = (1 - across * across) * half * 0.5;
      const x = p.x + sideX * across + p.dirX * bow;
      const z = p.z + sideZ * across + p.dirZ * bow;
      const y = CRESCENT_HEIGHT + rand(-0.25, 0.25);
      const s = this.pool.reset();
      s.sprite = SPRITE.glow;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 1;
      s.x = x; s.y = y; s.z = z;
      s.vx = p.dirX * p.speed * 0.25 + rand(-0.4, 0.4);
      s.vy = rand(-0.2, 0.7);
      s.vz = p.dirZ * p.speed * 0.25 + rand(-0.4, 0.4);
      s.drag = 2.4;
      s.size = rand(0.03, 0.07);
      s.endSize = 0.015;
      s.life = rand(0.25, 0.6);
      s.fadeOut = 0.4;
      this.tint(s, Math.random() < 0.5);
      this.pool.emit();
      if (Math.random() < 0.05) this.digit(x, y, z, p.dirX * 2, rand(0, 0.5), p.dirZ * 2, rand(0.2, 0.4));
      if (Math.random() < 0.34) this.groundGlow(p.x, p.z, p.width * 0.9, 0.16, 0.14 * p.fade, ARCANE_BLUE);
    }
    if (budget === 0) p.emit = 0;
  }

  private closeCrescent(p: Crescent): void {
    p.active = false;
    p.mesh.visible = false;
    this.ribbons.release(p.tipA);
    this.ribbons.release(p.tipB);
    p.tipA = p.tipB = -1;
  }

  /* ---------- A shot ending ---------- */

  /** A bolt or crescent ended where the server says it did. hit is false when it just ran out of range. */
  endShot(id: number, pos: { x: number; y: number; z: number }, hit: boolean): void {
    for (let i = 0; i < MAX_CRESCENTS; i += 1) {
      const crescent = this.crescents[i];
      if (!crescent.active || crescent.id !== id) continue;
      crescent.id = -1;
      // Spent, so it dissolves on the spot. Its hits and any wall already made their own light.
      crescent.fading = true;
      crescent.left = 0;
      if (hit) this.smallBurst(crescent.x, CRESCENT_HEIGHT, crescent.z);
      return;
    }
    let y = pos.y;
    for (let i = 0; i < MAX_BOLTS; i += 1) {
      const bolt = this.bolts[i];
      if (!bolt.active || bolt.id !== id) continue;
      y = bolt.y;
      this.closeBolt(bolt);
      break;
    }
    if (hit) {
      this.smallBurst(pos.x, y, pos.z);
    } else {
      // Fizzling out is meant to feel like nothing much.
      this.glow(pos.x, y, pos.z, 0.35, 0.6, 0.18, 0.4, BLUE_HOT, ARCANE_BLUE);
      this.streaks(pos.x, y, pos.z, (5 * this.spend) | 0, 1.6, 0.25, 0.02);
    }
  }

  private smallBurst(x: number, y: number, z: number): void {
    this.glow(x, y, z, 0.5, 1.2, 0.15, 0.6, ARCANE_WHITE, ARCANE_BLUE);
    this.streaks(x, y, z, (10 * this.spend) | 0, 3.2, 0.3, 0.025);
    this.light(x, y, z, LIGHT_ARCANE_BLUE, 5, 11);
  }

  /** A spell striking a creature. power is about 1, and more for a kill. */
  impact(pos: { x: number; y: number; z: number }, power: number, far: boolean): void {
    const { x, y, z } = pos;
    this.glow(x, y, z, 0.6 * power, 1.2 * power, 0.1, 1, ARCANE_WHITE, GOLD_HOT);
    this.glow(x, y, z, 1.1 * power, 2.5 * power, 0.26, 0.55, BLUE_HOT, BLUE_DEEP);
    const ring = this.pool.reset();
    ring.sprite = SPRITE.ring;
    ring.additive = 1;
    ring.ignoreFog = true;
    ring.x = x; ring.y = y; ring.z = z;
    ring.size = 0.3 * power;
    ring.endSize = 2.8 * power;
    ring.life = 0.24;
    ring.alpha = 0.75;
    ring.fadeOut = 0.15;
    this.paint(ring, GOLD_HOT, BLUE_DEEP);
    this.pool.emit();
    if (far) return;

    const scale = power * this.spend;
    this.streaks(x, y, z, (16 * scale) | 0, 6.5, 0.36, 0.035);
    const s = this.pool.reset();
    s.sprite = SPRITE.glow;
    s.move = MOVE_ORBIT;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.fadeOut = 0.4;
    for (let i = 0; i < ((10 * scale) | 0); i += 1) {
      // A small swirl left turning in the air, the arcane cousin of a spark shower.
      s.x = x; s.y = y + rand(-0.5, 0.5); s.z = z;
      s.vx = 0; s.vy = rand(0, 0.5); s.vz = 0;
      s.rotation = rand(0, 6.283);
      s.spin = rand(3, 7);
      s.extra = rand(0.2, 0.75) * power;
      s.size = rand(0.04, 0.08);
      s.endSize = 0.015;
      s.life = rand(0.45, 0.85);
      s.alpha = 1;
      this.tint(s, Math.random() < 0.5);
      this.pool.emit();
    }
    for (let i = 0; i < 3; i += 1) {
      this.digit(x, y, z, rand(-2.2, 2.2), rand(0, 2), rand(-2.2, 2.2), rand(0.3, 0.6));
    }
    this.groundGlow(x, z, 2.6 * power, 0.28, 0.32, ARCANE_BLUE);
  }

  /** The bits off a magic weapon's swing. moved is how far its tip went since the last call. */
  swingSpark(x: number, y: number, z: number, moved: number): void {
    if (Math.random() < moved * 7 * this.spend) {
      const s = this.pool.reset();
      s.sprite = SPRITE.glow;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 1;
      s.x = x + rand(-0.06, 0.06); s.y = y + rand(-0.06, 0.06); s.z = z + rand(-0.06, 0.06);
      s.vx = rand(-0.6, 0.6); s.vy = rand(0, 0.9); s.vz = rand(-0.6, 0.6);
      s.drag = 2.5;
      s.size = rand(0.03, 0.06);
      s.endSize = 0.012;
      s.life = rand(0.3, 0.6);
      s.fadeOut = 0.4;
      this.tint(s, Math.random() < 0.5);
      this.pool.emit();
    }
    if (Math.random() < moved * 0.5) this.digit(x, y, z, rand(-0.5, 0.5), rand(0.1, 0.8), rand(-0.5, 0.5), rand(0.25, 0.5));
  }

  /* ---------- Meteors ---------- */

  /** The warning: a circle on the ground, and the mass already on its way down. */
  meteorCast(id: number, x: number, z: number, delay: number, radius: number, casterX: number, casterZ: number): void {
    let slot: MeteorSlot | null = null;
    for (let i = 0; i < MAX_METEORS; i += 1) {
      if (!this.meteors[i].active) {
        slot = this.meteors[i];
        break;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.id = id;
    slot.x = x; slot.z = z;
    slot.radius = radius;
    slot.delay = delay;
    slot.age = 0;
    slot.blast = -1;
    slot.emit = 0;
    // It comes in over the caster's shoulder, so it's in view for the whole fall.
    const backX = casterX - x;
    const backZ = casterZ - z;
    const length = Math.hypot(backX, backZ);
    slot.startX = x + (length > 0.1 ? backX / length : 0) * METEOR_BACK;
    slot.startZ = z + (length > 0.1 ? backZ / length : 1) * METEOR_BACK;
    const size = radius * 0.2;
    slot.ribbons[0] = this.ribbons.open(slot.startX, METEOR_HEIGHT, slot.startZ, 0, size * 2.2, 1.4);
    slot.ribbons[1] = this.ribbons.open(slot.startX, METEOR_HEIGHT, slot.startZ, 1, size * 1.3, 1.4);
    slot.ribbons[2] = this.ribbons.open(slot.startX, METEOR_HEIGHT, slot.startZ, 0.5, size * 0.7, 1.4);
    slot.circle.visible = true;
    slot.circle.position.set(x, this.groundY + 0.08, z);
    slot.circle.scale.setScalar(radius);
    slot.galaxy.visible = true;
    slot.rock.visible = true;
    slot.rock.scale.setScalar(size);
    slot.galaxyUniforms.uFade.value = 1;
    slot.circleUniforms.uFade.value = 1;
    this.beam(x, this.groundY, z, 34, 0.4, 0.4, true);
    this.beam(casterX, this.groundY, casterZ, 26, 0.22, 0.32, false);
    this.groundGlow(x, z, radius * 2.2, delay, 0.16, ARCANE_BLUE);
    this.bigLight.position.set(x, 5, z);
    this.bigLight.color.copy(LIGHT_ARCANE_BLUE);
    this.placeMeteor(slot);
  }

  private meteorHead(m: MeteorSlot, out: THREE.Vector3): void {
    const share = Math.min(1, m.age / m.delay);
    // It falls faster the lower it gets.
    const fall = share * share;
    out.set(m.startX + (m.x - m.startX) * fall, METEOR_HEIGHT + (this.groundY + 0.5 - METEOR_HEIGHT) * fall, m.startZ + (m.z - m.startZ) * fall);
  }

  private placeMeteor(m: MeteorSlot): void {
    this.meteorHead(m, this.aim);
    m.rock.position.copy(this.aim);
    m.rock.rotation.set(this.clock * 1.3, this.clock * 2.1, 0);
    m.galaxy.position.copy(this.aim);
    m.galaxy.quaternion.copy(this.camera.quaternion);
    m.galaxy.scale.setScalar(m.radius * 0.72);
    m.galaxyUniforms.uTime.value = this.clock;
    m.circleUniforms.uTime.value = this.clock;
    m.circleUniforms.uProgress.value = Math.min(1, m.age / m.delay);
    m.rockUniforms.uTime.value = this.clock;
  }

  private stepMeteor(m: MeteorSlot, seconds: number): void {
    if (m.blast >= 0) {
      m.blast += seconds;
      const share = m.blast / BLAST_SECONDS;
      if (share >= 1) {
        m.active = false;
        m.galaxy.visible = false;
        return;
      }
      // The swirl at the heart of the blast flies open and burns out.
      m.galaxy.position.set(m.x, this.groundY + m.radius * 0.26, m.z);
      m.galaxy.quaternion.copy(this.camera.quaternion);
      m.galaxy.scale.setScalar(m.radius * (0.8 + (1 - (1 - share) * (1 - share)) * 1.3));
      m.galaxyUniforms.uTime.value = this.clock;
      m.galaxyUniforms.uFade.value = (1 - share) * (1 - share);
      return;
    }
    m.age += seconds;
    if (m.age > m.delay + METEOR_PATIENCE) {
      this.closeMeteor(m);
      m.active = false;
      m.galaxy.visible = false;
      this.bigLightDecay = 6;
      return;
    }
    this.placeMeteor(m);
    const head = this.aim;
    this.ribbons.move(m.ribbons[0], head.x, head.y, head.z);
    this.ribbons.move(m.ribbons[1], head.x, head.y + m.radius * 0.05, head.z);
    this.ribbons.move(m.ribbons[2], head.x, head.y - m.radius * 0.05, head.z);
    // The light grows as it gets closer, so the ground brightens under it before it lands.
    const share = Math.min(1, m.age / m.delay);
    if (this.bigLight.intensity < 26 * share * share) this.bigLight.intensity = 26 * share * share;
    this.bigLightDecay = 0;

    m.emit += seconds;
    let budget = 5;
    while (m.emit >= 0.012 && budget > 0) {
      m.emit -= 0.012;
      budget -= 1;
      if (this.spend < 1 && Math.random() < 0.5) continue;
      const s = this.pool.reset();
      const spread = m.radius * 0.17;
      s.sprite = Math.random() < 0.25 ? SPRITE.ember : SPRITE.glow;
      s.additive = 1;
      s.ignoreFog = true;
      s.minPixels = 1;
      s.x = head.x + rand(-spread, spread);
      s.y = head.y + rand(-spread, spread);
      s.z = head.z + rand(-spread, spread);
      s.vx = rand(-1.6, 1.6); s.vy = rand(0.5, 5); s.vz = rand(-1.6, 1.6);
      s.drag = 1.8;
      s.size = rand(0.06, 0.17);
      s.endSize = 0.02;
      s.life = rand(0.35, 0.8);
      s.fadeOut = 0.35;
      this.tint(s, Math.random() < 0.55);
      this.pool.emit();
      if (Math.random() < 0.012) this.digit(s.x, s.y, s.z, rand(-1, 1), rand(0, 1.5), rand(-1, 1), rand(0.3, 0.6));
    }
    if (budget === 0) m.emit = 0;
  }

  private closeMeteor(m: MeteorSlot): void {
    m.circle.visible = false;
    m.rock.visible = false;
    for (let i = 0; i < 3; i += 1) {
      this.ribbons.release(m.ribbons[i]);
      m.ribbons[i] = -1;
    }
  }

  /** It lands. Everything here is one moment's worth of particles: they run on their own after this. */
  meteorEnd(id: number, x: number, z: number, radius: number): void {
    for (let i = 0; i < MAX_METEORS; i += 1) {
      const m = this.meteors[i];
      if (!m.active || m.id !== id || m.blast >= 0) continue;
      this.closeMeteor(m);
      m.blast = 0;
      m.galaxy.visible = true;
      m.galaxyUniforms.uFade.value = 1;
      break;
    }
    this.bigLight.position.set(x, 4, z);
    this.bigLight.color.copy(LIGHT_ARCANE_GOLD);
    this.bigLight.intensity = 60;
    this.bigLightDecay = 2.4;

    const ground = this.groundY;
    const heart = ground + 1.1;
    this.glow(x, heart, z, radius * 1.1, radius * 2.8, 0.2, 1, ARCANE_WHITE, GOLD_HOT);
    this.glow(x, heart, z, radius * 2.4, radius * 4.5, 0.55, 0.55, BLUE_HOT, BLUE_DEEP);
    this.beam(x, ground, z, 42, radius * 0.24, 0.5, false);
    this.groundGlow(x, z, radius * 3.3, 0.9, 0.7, GOLD);
    this.groundGlow(x, z, radius * 2.6, 2.4, 0.3, ARCANE_BLUE);

    const s = this.pool.reset();
    // A scorch of cooling cracks, which stays as the proof of where it hit.
    s.face = FACE_GROUND;
    s.sprite = SPRITE.crack;
    s.additive = 1;
    s.x = x; s.y = ground + 0.06; s.z = z;
    s.size = s.endSize = radius * 1.7;
    s.rotation = rand(0, 6.283);
    s.life = 3.2;
    s.alpha = 0.85;
    s.fadeOut = 0.25;
    this.paint(s, GOLD_HOT, BLUE_DEEP);
    this.pool.emit();

    // Three rings, the last ones held back a moment, so the shock is felt as travelling outward.
    s.sprite = SPRITE.shock;
    s.ignoreFog = true;
    s.y = ground + 0.1;
    s.rotation = 0;
    for (let i = 0; i < 3; i += 1) {
      s.delay = i * 0.07;
      s.size = radius * 0.3;
      s.endSize = radius * (2.7 + i * 0.5);
      s.life = 0.42 + i * 0.1;
      s.alpha = 1 - i * 0.25;
      s.fadeOut = 0.2;
      if (i === 1) this.paint(s, GOLD_HOT, GOLD_DEEP);
      else this.paint(s, BLUE_HOT, BLUE_DEEP);
      this.pool.emit();
    }

    // A dome of the same ring standing upright, facing the camera, since the ground ones flatten at low angles.
    s.face = FACE_CAMERA;
    s.sprite = SPRITE.ring;
    s.y = heart;
    s.delay = 0;
    s.size = radius * 0.4;
    s.endSize = radius * 3.8;
    s.life = 0.34;
    s.alpha = 0.8;
    this.paint(s, ARCANE_WHITE, BLUE_DEEP);
    this.pool.emit();

    // A slow dark bank behind the light, or the glow has nothing to stand out against.
    s.additive = 0;
    s.ignoreFog = false;
    s.sprite = SPRITE.smokeRing;
    s.face = FACE_GROUND;
    s.y = ground + 0.3;
    s.size = radius * 1.1;
    s.endSize = radius * 3.2;
    s.life = 1.4;
    s.alpha = 0.5;
    s.fadeIn = 0.04;
    s.fadeOut = 0.3;
    this.paint(s, NIGHT, NIGHT);
    this.pool.emit();

    const far = this.isFar(x, heart, z);
    const spend = this.spend * (far ? 0.3 : 1);
    this.streaks(x, heart, z, (70 * spend) | 0, radius * 3.4, 0.7, 0.08);
    this.pillars(x, ground, z, radius);
    this.galaxyStars(x, ground, z, radius, (90 * spend) | 0);
    this.embers(x, ground, z, radius, (60 * spend) | 0);
    for (let i = 0; i < (far ? 0 : 14); i += 1) {
      const angle = rand(0, 6.283);
      const pace = rand(1.5, radius * 1.1);
      this.digit(x + Math.cos(angle) * radius * 0.2, heart, z + Math.sin(angle) * radius * 0.2, Math.cos(angle) * pace, rand(0.4, 2.4), Math.sin(angle) * pace, rand(0.5, 1.1));
    }
  }

  /** Shafts of light standing around the impact, in a loose ring. */
  private pillars(x: number, ground: number, z: number, radius: number): void {
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * 6.283 + rand(-0.3, 0.3);
      const far = radius * rand(0.25, 0.8);
      this.beam(x + Math.cos(angle) * far, ground, z + Math.sin(angle) * far, rand(5, 11), rand(0.1, 0.22), rand(0.3, 0.55), i % 2 === 0);
    }
  }

  /** Stars left circling the crater like a flat galaxy. */
  private galaxyStars(x: number, ground: number, z: number, radius: number, count: number): void {
    const s = this.pool.reset();
    s.sprite = SPRITE.glow;
    s.move = MOVE_ORBIT;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.fadeIn = 0.05;
    s.fadeOut = 0.45;
    for (let i = 0; i < count; i += 1) {
      s.x = x; s.y = ground + rand(0.2, 1.7); s.z = z;
      s.vy = rand(0, 0.45);
      // Two arms, each a band of angle that winds outward with distance.
      const out = Math.sqrt(Math.random());
      s.extra = out * radius * 0.95;
      s.rotation = (i % 2) * Math.PI + out * 4.2 + rand(-0.4, 0.4);
      s.spin = 2.4 - out * 1.2;
      s.size = rand(0.05, 0.13);
      s.endSize = 0.02;
      s.life = rand(1, 2.1);
      s.alpha = 1;
      this.tint(s, out > 0.4 ? Math.random() < 0.75 : Math.random() < 0.2);
      this.pool.emit();
    }
  }

  /** What's still glowing after everything else has gone. They rise and wander, and take a few seconds to die. */
  private embers(x: number, ground: number, z: number, radius: number, count: number): void {
    const s = this.pool.reset();
    s.sprite = SPRITE.ember;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.fadeIn = 0.06;
    s.fadeOut = 0.55;
    s.gravity = -0.35;
    s.drag = 1.1;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      const far = Math.sqrt(Math.random()) * radius;
      s.x = x + Math.cos(angle) * far;
      s.y = ground + rand(0.1, 1.2);
      s.z = z + Math.sin(angle) * far;
      s.vx = Math.cos(angle) * rand(0, 2);
      s.vy = rand(0.4, 2.4);
      s.vz = Math.sin(angle) * rand(0, 2);
      s.size = rand(0.04, 0.09);
      s.endSize = 0.015;
      s.extra = rand(0.2, 0.6);
      s.rotation = rand(0, 6.283);
      s.life = rand(1.6, 4);
      s.alpha = 1;
      this.tint(s, Math.random() < 0.35);
      this.pool.emit();
    }
  }
}
