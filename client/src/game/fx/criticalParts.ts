import * as THREE from 'three';
import { applyVertexSnap } from '../psxRenderer';

/*
 * The pieces the critical hits are built from: ground decals (crater, fissure, warning circle),
 * expanding rings, beams of light, domes, sigils (rune circle, galaxy, star, weak point, crescent)
 * and thrown rock chunks. Each is a small fixed pool of meshes made once; spawning only rewrites
 * uniforms and transforms, so nothing here allocates per frame.
 *
 * The picture is about 300 lines tall and dithered, so every shape is drawn bold: thick bands,
 * hot white cores, and few colors (ember and bone for blows, blue and gold for spells).
 */

export type Rgb = readonly [number, number, number];

/** Linear red, green, blue from a page color. */
export function rgb(hex: string): Rgb {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

export const BONE = rgb('#f4ead4');
export const WHITE_HOT = rgb('#fff8ea');
export const EMBER_HOT = rgb('#ffc46e');
export const EMBER = rgb('#ff7424');
export const EMBER_DEEP = rgb('#6e1a05');
export const DUST_LIGHT = rgb('#b09c7e');
export const DUST = rgb('#7a6850');
export const DUST_DARK = rgb('#3a3027');
export const GOLD_HOT = rgb('#ffe3a0');
export const GOLD = rgb('#f2b44a');
export const BLUE = rgb('#3f8cff');
export const BLUE_HOT = rgb('#b4d2ff');
export const NIGHT_BLUE = rgb('#101c46');

export function rand(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

export function pick<T>(list: readonly T[]): T {
  return list[(Math.random() * list.length) | 0];
}

const PLAIN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HASH = /* glsl */ `
  float hash1(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** Covers what is behind by its alpha and adds light where alpha is 0, like the particle pool. */
const PREMULTIPLIED: THREE.ShaderMaterialParameters = {
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
};

const ADDITIVE: THREE.ShaderMaterialParameters = {
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
};

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/* ---------- Ground decals ---------- */

export const DECAL_CRATER = 0;
export const DECAL_FISSURE = 1;
export const DECAL_WARNING = 2;

const DECAL_FRAGMENT = /* glsl */ `
  uniform float uKind;
  uniform vec2 uSize;
  uniform float uFade;
  uniform float uHeat;
  uniform float uProgress;
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  ${HASH}
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uSize;
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    if (uKind < 0.5) {
      // Crater: a dark bowl, a pale broken lip, and cracks running out past it that glow at first.
      float bowl = uSize.x * 0.7;
      float r = length(p);
      float a = atan(p.y, p.x);
      float sectors = 13.0;
      float s = floor((a / 6.28318 + 0.5) * sectors);
      float mid = (s + 0.5 + (hash1(s + uSeed) - 0.5) * 0.55) / sectors * 6.28318 - 3.14159;
      float wiggle = sin(r * 3.3 + s * 7.0) * 0.07 + sin(r * 8.1 + s * 2.0) * 0.03;
      float across = abs(a - mid + wiggle) * r;
      float reach = uSize.x * (0.62 + hash1(s * 3.7 + uSeed) * 0.38);
      float width = 0.16 * max(0.0, 1.0 - r / reach) + 0.02;
      float crack = step(r, reach) * (1.0 - smoothstep(width * 0.45, width, across)) * smoothstep(bowl * 0.15, bowl * 0.4, r);
      float inside = 1.0 - smoothstep(bowl * 0.86, bowl, r);
      float lip = exp(-pow((r - bowl * 0.97) / (bowl * 0.16), 2.0));
      // A pale dust skirt round the lip, so the dark cracks have something light to cut across.
      float skirt = smoothstep(bowl * 0.9, bowl * 1.05, r) * (1.0 - smoothstep(bowl * 1.05, uSize.x, r)) * 0.45;
      float grain = hash2(floor(p * 5.0 + uSeed));
      vec3 dark = vec3(0.03, 0.025, 0.02) * (0.7 + grain * 0.6);
      vec3 pale = vec3(0.34, 0.29, 0.22) * (0.75 + grain * 0.5);
      vec3 base = mix(mix(dark, pale, max(lip * (1.0 - inside * 0.6), skirt * 1.4)), vec3(0.0), crack);
      alpha = max(max(max(inside * 0.9, lip * 0.75), skirt), crack * 0.95) * uFade;
      float heat = crack * uHeat * (1.0 - r / (reach + 0.01)) + inside * uHeat * 0.35 * max(0.0, 1.0 - r / bowl);
      color = base * alpha + vec3(1.6, 0.55, 0.12) * heat * 1.4 * uFade;
      if (alpha < 0.01) discard;
    } else if (uKind < 1.5) {
      // Fissure: one jagged dark split along +y, wide at the hit end, with a faint dust halo.
      float along = (p.y + uSize.y) / (2.0 * uSize.y);
      float center = sin(p.y * 2.3 + uSeed) * 0.13 + sin(p.y * 6.1 + uSeed * 2.0) * 0.05;
      float d = abs(p.x - center);
      float w = uSize.x * 0.32 * (1.0 - along * 0.75) + 0.035;
      float split = 1.0 - smoothstep(w * 0.5, w, d);
      float halo = (1.0 - smoothstep(w, uSize.x, d)) * 0.5;
      float tail = 1.0 - smoothstep(0.82, 1.0, along);
      float head = smoothstep(0.0, 0.04, along);
      float grain = hash2(floor(p * 5.0 + uSeed));
      vec3 base = mix(vec3(0.3, 0.25, 0.19) * (0.7 + grain * 0.5), vec3(0.02, 0.016, 0.012), split);
      alpha = max(split * 0.95, halo) * tail * head * uFade;
      color = base * alpha + vec3(1.6, 0.55, 0.12) * split * tail * uHeat * (1.0 - along * 0.7) * 1.3 * uFade;
      if (alpha < 0.01) discard;
    } else {
      // Warning circle: a bold gold rim, ticks that turn, and an inner line closing in as the spell gathers.
      float r = length(p) / uSize.x;
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      float rim = 1.0 - smoothstep(0.03, 0.06, abs(r - 0.93));
      float ticks = step(0.7, fract(a * 3.8197 + uTime * 0.5)) * (1.0 - smoothstep(0.04, 0.07, abs(r - 0.82)));
      float closing = 1.0 - smoothstep(0.02, 0.05, abs(r - (1.0 - uProgress) * 0.93));
      float fill = (0.08 + uProgress * 0.18) * (1.0 - r * 0.5);
      vec3 gold = vec3(1.5, 0.85, 0.25);
      vec3 blue = vec3(0.2, 0.5, 1.4);
      color = gold * (rim * 1.2 + ticks * 0.7) + mix(blue, gold, uProgress) * (closing * 0.9 + fill);
      color *= uFade * (0.8 + 0.2 * sin(uTime * (6.0 + uProgress * 18.0)));
      alpha = 0.0;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

interface Decal {
  mesh: THREE.Mesh;
  u: { uKind: { value: number }; uSize: { value: THREE.Vector2 }; uFade: { value: number }; uHeat: { value: number }; uProgress: { value: number }; uTime: { value: number }; uSeed: { value: number } };
  active: boolean;
  age: number;
  life: number;
  fadeSeconds: number;
  /** Held decals stay at full strength until release(). */
  held: boolean;
}

const MAX_DECALS = 6;

export class GroundDecals {
  private readonly decals: Decal[] = [];
  private next = 0;

  constructor(private readonly scene: THREE.Scene, geometry: THREE.BufferGeometry) {
    for (let i = 0; i < MAX_DECALS; i += 1) {
      const u = {
        uKind: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) }, uFade: { value: 0 }, uHeat: { value: 0 },
        uProgress: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 0 },
      };
      const material = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: DECAL_FRAGMENT, uniforms: u, ...PREMULTIPLIED, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.order = 'YXZ';
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.decals.push({ mesh, u, active: false, age: 0, life: 1, fadeSeconds: 1, held: false });
    }
  }

  /**
   * Lays a decal centered at x, z with its length along yaw. halfWidth and halfLength are meters.
   * Pass life 0 to hold it until release(). Returns its index; the oldest is reused when all are in use.
   */
  place(kind: number, x: number, y: number, z: number, yaw: number, halfWidth: number, halfLength: number, life: number, fadeSeconds: number): number {
    let index = -1;
    for (let i = 0; i < MAX_DECALS; i += 1) if (!this.decals[i].active) { index = i; break; }
    if (index < 0) { index = this.next; this.next = (this.next + 1) % MAX_DECALS; }
    const d = this.decals[index];
    d.active = true;
    d.age = 0;
    d.held = life <= 0;
    d.life = life;
    d.fadeSeconds = fadeSeconds;
    d.u.uKind.value = kind;
    d.u.uSize.value.set(halfWidth, halfLength);
    d.u.uFade.value = 1;
    d.u.uHeat.value = kind === DECAL_WARNING ? 0 : 1;
    d.u.uProgress.value = 0;
    d.u.uSeed.value = Math.random() * 50;
    // Stacked a hair apart so two decals never fight over the same depth.
    d.mesh.position.set(x, y + 0.035 + index * 0.004, z);
    d.mesh.rotation.set(-Math.PI / 2, yaw + Math.PI, 0);
    d.mesh.scale.set(halfWidth, halfLength, 1);
    d.mesh.visible = true;
    return index;
  }

  setProgress(index: number, progress: number): void {
    if (index >= 0) this.decals[index].u.uProgress.value = progress;
  }

  /** Lets a held decal fade out over this many seconds. */
  release(index: number, fadeSeconds: number): void {
    if (index < 0) return;
    const d = this.decals[index];
    if (!d.active || !d.held) return;
    d.held = false;
    d.fadeSeconds = Math.max(0.01, fadeSeconds);
    d.life = d.age + d.fadeSeconds;
  }

  update(seconds: number): void {
    for (let i = 0; i < MAX_DECALS; i += 1) {
      const d = this.decals[i];
      if (!d.active) continue;
      d.age += seconds;
      d.u.uTime.value = d.age;
      // A faint glow stays in the cracks, so they still read on dark ground through the dither.
      if (d.u.uKind.value !== DECAL_WARNING) d.u.uHeat.value = 0.18 + 0.82 * Math.exp(-d.age * 1.1);
      if (d.held) continue;
      const left = d.life - d.age;
      d.u.uFade.value = Math.min(1, Math.max(0, left / d.fadeSeconds));
      if (left <= 0) {
        d.active = false;
        d.mesh.visible = false;
      }
    }
  }

  /** Every mesh this pool owns, for warming up shaders before first use. */
  meshes(out: THREE.Object3D[]): void {
    for (const d of this.decals) out.push(d.mesh);
  }

  clear(): void {
    for (const d of this.decals) {
      d.active = false;
      d.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const d of this.decals) {
      this.scene.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
    }
  }
}

/* ---------- Expanding rings ---------- */

const RING_FRAGMENT = /* glsl */ `
  uniform float uRadius;
  uniform float uWidth;
  uniform float uFade;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length(vUv * 2.0 - 1.0);
    if (r > 1.0) discard;
    float band = exp(-pow((r - uRadius) / uWidth, 2.0));
    // A faint wash inside the front, so the ring reads as a wave pushing air and not a thin line.
    float wash = step(r, uRadius) * smoothstep(uRadius - uWidth * 5.0, uRadius, r) * 0.22;
    vec3 color = mix(uColor, vec3(1.25, 1.2, 1.1), band * band * band) * (band * 1.7 + wash);
    gl_FragColor = vec4(color * uFade, 0.0);
  }
`;

interface Ring {
  mesh: THREE.Mesh;
  u: { uRadius: { value: number }; uWidth: { value: number }; uFade: { value: number }; uColor: { value: THREE.Color } };
  active: boolean;
  age: number;
  delay: number;
  life: number;
  size: number;
  width: number;
}

const MAX_RINGS = 20;

export class RingWaves {
  private readonly rings: Ring[] = [];
  private next = 0;
  private readonly normal = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, geometry: THREE.BufferGeometry) {
    for (let i = 0; i < MAX_RINGS; i += 1) {
      const u = { uRadius: { value: 0 }, uWidth: { value: 0.1 }, uFade: { value: 0 }, uColor: { value: new THREE.Color() } };
      const material = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: RING_FRAGMENT, uniforms: u, ...ADDITIVE });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 21;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.rings.push({ mesh, u, active: false, age: 0, delay: 0, life: 1, size: 1, width: 0.3 });
    }
  }

  /**
   * A ring growing from a point to radius meters over seconds, in the plane whose normal is (nx, ny, nz):
   * (0, 1, 0) lies on the ground. width is the band's thickness in meters.
   */
  spawn(x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, seconds: number, width: number, color: Rgb, delay = 0): void {
    const ring = this.rings[this.next];
    this.next = (this.next + 1) % MAX_RINGS;
    ring.active = true;
    ring.age = 0;
    ring.delay = delay;
    ring.life = seconds;
    ring.size = radius;
    ring.width = width;
    ring.u.uColor.value.setRGB(color[0], color[1], color[2]);
    ring.u.uFade.value = 0;
    ring.mesh.position.set(x, y, z);
    this.normal.set(nx, ny, nz).normalize();
    ring.mesh.quaternion.setFromUnitVectors(Z_AXIS, this.normal);
    ring.mesh.scale.setScalar(radius);
    ring.mesh.visible = false;
  }

  update(seconds: number): void {
    for (let i = 0; i < MAX_RINGS; i += 1) {
      const ring = this.rings[i];
      if (!ring.active) continue;
      ring.age += seconds;
      const t = (ring.age - ring.delay) / ring.life;
      if (t < 0) continue;
      if (t >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }
      ring.mesh.visible = true;
      const out = 1 - (1 - t) * (1 - t) * (1 - t);
      ring.u.uRadius.value = 0.04 + out * 0.9;
      ring.u.uWidth.value = Math.max(0.01, (ring.width / ring.size) * (1 - 0.55 * t));
      ring.u.uFade.value = Math.pow(1 - t, 1.4);
    }
  }

  /** Every mesh this pool owns, for warming up shaders before first use. */
  meshes(out: THREE.Object3D[]): void {
    for (const ring of this.rings) out.push(ring.mesh);
  }

  clear(): void {
    for (const ring of this.rings) {
      ring.active = false;
      ring.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
  }
}

/* ---------- Beams of light ---------- */

const BEAM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-view.xyz)));
    gl_Position = projectionMatrix * view;
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  uniform float uTime;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float core = pow(vFacing, 4.0);
    float flow = 0.8 + 0.2 * sin(vUv.y * 40.0 - uTime * 30.0 + vUv.x * 6.28318);
    float ends = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
    vec3 color = mix(uColor, vec3(1.3, 1.26, 1.18), core) * (vFacing * 0.9 + core * 1.4) * flow;
    gl_FragColor = vec4(color * uFade * ends, 1.0);
  }
`;

interface Beam {
  mesh: THREE.Mesh;
  u: { uColor: { value: THREE.Color }; uFade: { value: number }; uTime: { value: number } };
  active: boolean;
  held: boolean;
  age: number;
  life: number;
  fadeFrom: number;
  radius: number;
  length: number;
}

const MAX_BEAMS = 12;

export class Beams {
  private readonly beams: Beam[] = [];
  private readonly geometry: THREE.CylinderGeometry;
  private readonly from = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private next = 0;

  constructor(private readonly scene: THREE.Scene) {
    // A unit tube from y = 0 to y = 1, so placing it is a position, a turn and a scale.
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    this.geometry.translate(0, 0.5, 0);
    for (let i = 0; i < MAX_BEAMS; i += 1) {
      const u = { uColor: { value: new THREE.Color() }, uFade: { value: 0 }, uTime: { value: 0 } };
      const material = new THREE.ShaderMaterial({ vertexShader: BEAM_VERTEX, fragmentShader: BEAM_FRAGMENT, uniforms: u, ...ADDITIVE });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 22;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.beams.push({ mesh, u, active: false, held: false, age: 0, life: 1, fadeFrom: 0, radius: 0.1, length: 1 });
    }
  }

  /** A beam from a to b, radius meters thick. seconds 0 holds it until release(). Returns its index. */
  spawn(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, seconds: number, color: Rgb): number {
    const index = this.next;
    this.next = (this.next + 1) % MAX_BEAMS;
    const beam = this.beams[index];
    beam.active = true;
    beam.held = seconds <= 0;
    beam.age = 0;
    beam.life = Math.max(0.05, seconds);
    beam.fadeFrom = 0;
    beam.radius = radius;
    beam.u.uColor.value.setRGB(color[0], color[1], color[2]);
    beam.mesh.visible = true;
    this.move(index, ax, ay, az, bx, by, bz);
    this.shape(beam);
    return index;
  }

  move(index: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    if (index < 0) return;
    const beam = this.beams[index];
    this.from.set(ax, ay, az);
    this.dir.set(bx - ax, by - ay, bz - az);
    beam.length = Math.max(0.001, this.dir.length());
    this.dir.multiplyScalar(1 / beam.length);
    beam.mesh.position.copy(this.from);
    beam.mesh.quaternion.setFromUnitVectors(Y_AXIS, this.dir);
  }

  release(index: number, seconds: number): void {
    if (index < 0) return;
    const beam = this.beams[index];
    if (!beam.active || !beam.held) return;
    beam.held = false;
    beam.fadeFrom = beam.age;
    beam.life = beam.age + Math.max(0.02, seconds);
  }

  /** Gone at once, for a cancel. */
  kill(index: number): void {
    if (index < 0) return;
    this.beams[index].active = false;
    this.beams[index].mesh.visible = false;
  }

  private shape(beam: Beam): void {
    // A quick swell in, then held, or thinning while it fades.
    const appear = Math.min(1, beam.age / 0.05);
    let width = appear;
    let fade = appear;
    if (!beam.held) {
      const t = Math.min(1, (beam.age - beam.fadeFrom) / Math.max(0.001, beam.life - beam.fadeFrom));
      width *= 1 - 0.75 * t;
      fade *= Math.pow(1 - t, 1.5);
    }
    beam.u.uFade.value = fade;
    beam.mesh.scale.set(beam.radius * Math.max(0.05, width), beam.length, beam.radius * Math.max(0.05, width));
  }

  update(seconds: number): void {
    for (let i = 0; i < MAX_BEAMS; i += 1) {
      const beam = this.beams[i];
      if (!beam.active) continue;
      beam.age += seconds;
      beam.u.uTime.value = beam.age;
      if (!beam.held && beam.age >= beam.life) {
        beam.active = false;
        beam.mesh.visible = false;
        continue;
      }
      this.shape(beam);
    }
  }

  /** Every mesh this pool owns, for warming up shaders before first use. */
  meshes(out: THREE.Object3D[]): void {
    for (const beam of this.beams) out.push(beam.mesh);
  }

  clear(): void {
    for (const beam of this.beams) {
      beam.active = false;
      beam.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const beam of this.beams) {
      this.scene.remove(beam.mesh);
      (beam.mesh.material as THREE.Material).dispose();
    }
    this.geometry.dispose();
  }
}

/* ---------- Domes of light ---------- */

const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  varying float vFacing;
  void main() {
    float rim = 1.0 - vFacing;
    vec3 color = mix(uColor, vec3(1.3, 1.25, 1.15), rim * rim) * (rim * rim * 1.6 + 0.1);
    gl_FragColor = vec4(color * uFade, 1.0);
  }
`;

interface Dome {
  mesh: THREE.Mesh;
  u: { uColor: { value: THREE.Color }; uFade: { value: number } };
  active: boolean;
  age: number;
  life: number;
  size: number;
}

const MAX_DOMES = 3;

export class Domes {
  private readonly domes: Dome[] = [];
  private readonly geometry = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  private next = 0;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < MAX_DOMES; i += 1) {
      const u = { uColor: { value: new THREE.Color() }, uFade: { value: 0 } };
      const material = new THREE.ShaderMaterial({ vertexShader: BEAM_VERTEX, fragmentShader: DOME_FRAGMENT, uniforms: u, ...ADDITIVE });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 21;
      scene.add(mesh);
      this.domes.push({ mesh, u, active: false, age: 0, life: 1, size: 1 });
    }
  }

  spawn(x: number, y: number, z: number, radius: number, seconds: number, color: Rgb): void {
    const dome = this.domes[this.next];
    this.next = (this.next + 1) % MAX_DOMES;
    dome.active = true;
    dome.age = 0;
    dome.life = seconds;
    dome.size = radius;
    dome.u.uColor.value.setRGB(color[0], color[1], color[2]);
    dome.mesh.position.set(x, y, z);
    dome.mesh.scale.setScalar(0.01);
    dome.mesh.visible = true;
  }

  update(seconds: number): void {
    for (const dome of this.domes) {
      if (!dome.active) continue;
      dome.age += seconds;
      const t = dome.age / dome.life;
      if (t >= 1) {
        dome.active = false;
        dome.mesh.visible = false;
        continue;
      }
      const out = 1 - (1 - t) * (1 - t) * (1 - t);
      dome.mesh.scale.set(dome.size * out, dome.size * out * 0.8, dome.size * out);
      dome.u.uFade.value = (1 - t) * (1 - t);
    }
  }

  /** Every mesh this pool owns, for warming up shaders before first use. */
  meshes(out: THREE.Object3D[]): void {
    for (const dome of this.domes) out.push(dome.mesh);
  }

  clear(): void {
    for (const dome of this.domes) {
      dome.active = false;
      dome.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const dome of this.domes) {
      this.scene.remove(dome.mesh);
      (dome.mesh.material as THREE.Material).dispose();
    }
    this.geometry.dispose();
  }
}

/* ---------- Sigils ---------- */

export const SIGIL_RUNE = 0;
export const SIGIL_GALAXY = 1;
export const SIGIL_STAR = 2;
export const SIGIL_DIAMOND = 3;
export const SIGIL_CRESCENT = 4;

const SIGIL_FRAGMENT = /* glsl */ `
  uniform float uKind;
  uniform float uTime;
  uniform float uFade;
  uniform float uProgress;
  uniform vec3 uColor;
  uniform vec3 uColor2;
  varying vec2 vUv;
  ${HASH}
  float ringLine(float r, float at, float w) { return 1.0 - smoothstep(w * 0.5, w, abs(r - at)); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    vec3 color = vec3(0.0);
    if (uKind < 0.5) {
      // Rune circle, drawn clockwise from the top as uProgress goes 0 to 1.
      if (r > 1.0) discard;
      float drawn = step(fract(atan(p.x, p.y) / 6.28318 + 1.0), uProgress);
      float outer = ringLine(r, 0.93, 0.07) + ringLine(r, 0.8, 0.04);
      float ticks = step(0.62, fract(a * 5.7296 + uTime * 0.4)) * (1.0 - smoothstep(0.035, 0.06, abs(r - 0.865)));
      float inner1 = ringLine(r, 0.62, 0.05) * step(0.35, fract(a * 0.9549 + uTime * 0.9));
      float inner2 = ringLine(r, 0.45, 0.05) * step(0.3, fract(a * 0.7958 - uTime * 1.4));
      float inner3 = ringLine(r, 0.28, 0.05) * step(0.4, fract(a * 0.4775 + uTime * 2.1));
      float star = (1.0 - smoothstep(0.02, 0.05, abs(abs(p.x) + abs(p.y) - 0.18))) * step(r, 0.3);
      float line = (outer + ticks) * drawn + (inner1 + inner2 + inner3 + star) * smoothstep(0.6, 1.0, uProgress);
      float glow = exp(-pow((r - 0.9) * 6.0, 2.0)) * 0.25 * drawn;
      color = uColor * line * 1.4 + uColor2 * glow + vec3(1.2, 1.15, 1.0) * line * 0.35;
    } else if (uKind < 1.5) {
      // Galaxy: two arms winding into a core that grows sun-bright with uProgress.
      float mask = smoothstep(1.0, 0.55, r);
      float wind = a * 2.0 + log(r + 0.04) * 5.0 - uTime * 3.0;
      float arms = pow(0.5 + 0.5 * cos(wind), 3.0);
      float cell = hash2(floor(vec2(wind * 5.0, r * 24.0)));
      float stars = step(0.92, cell) * smoothstep(0.08, 0.3, r);
      float falloff = exp(-r * 2.4);
      color = uColor2 * arms * falloff * 2.2;
      color += uColor * arms * falloff * falloff * 1.8;
      color += vec3(1.5, 1.3, 0.9) * exp(-r * r * (40.0 - uProgress * 28.0)) * (1.0 + uProgress * 3.0);
      color += vec3(1.1, 1.1, 1.3) * stars * mask;
      color *= mask;
    } else if (uKind < 2.5) {
      // Star: a round glow with four long points.
      float glow = exp(-r * r * 9.0);
      float spikes = exp(-abs(p.x) * 28.0) * exp(-abs(p.y) * 2.6) + exp(-abs(p.y) * 28.0) * exp(-abs(p.x) * 2.6);
      color = uColor * glow * 1.2 + mix(uColor, vec3(1.3), 0.6) * spikes * 1.3 + vec3(1.4) * exp(-r * r * 60.0);
    } else if (uKind < 3.5) {
      // Weak point: a solid diamond that throbs, an outline around it, and a halo that slowly spreads.
      float d = abs(p.x) * 1.35 + abs(p.y);
      float beat = 0.5 + 0.5 * sin(uTime * 4.5);
      float core = 1.0 - smoothstep(0.2, 0.25, d);
      float outline = 1.0 - smoothstep(0.03, 0.06, abs(d - 0.38 - beat * 0.04));
      float spread = fract(uTime * 0.55);
      float halo = (1.0 - smoothstep(0.03, 0.09, abs(r - 0.3 - spread * 0.65))) * (1.0 - spread);
      float glow = exp(-r * r * 7.0) * 0.45;
      color = vec3(1.4, 1.35, 1.25) * core * (1.0 + beat * 0.5) + uColor * (outline * 1.3 + halo * 1.1 + glow);
    } else {
      // Crescent: a bright leading arc across the top with the body fading back from it. x runs tip to tip.
      vec2 c = vec2(0.0, -1.2);
      float d = length(p - c) - 1.9;
      float tips = clamp(1.0 - p.x * p.x, 0.0, 1.0);
      float w = 0.42 * pow(tips, 0.7) + 0.001;
      float body = smoothstep(-w, 0.0, d) * (1.0 - smoothstep(0.0, 0.04, d)) * step(-w, d);
      float edge = exp(-pow(d / 0.035, 2.0)) * pow(tips, 0.4);
      float grain = 0.75 + 0.25 * sin(p.x * 22.0 - uTime * 20.0) * sin(p.x * 7.0 + uTime * 9.0);
      color = mix(uColor2, uColor, smoothstep(-w, 0.0, d)) * body * grain * 0.9 + vec3(1.3, 1.25, 1.15) * edge * 1.6;
    }
    gl_FragColor = vec4(color * uFade, 1.0);
  }
`;

interface Sigil {
  mesh: THREE.Mesh;
  u: { uKind: { value: number }; uTime: { value: number }; uFade: { value: number }; uProgress: { value: number }; uColor: { value: THREE.Color }; uColor2: { value: THREE.Color } };
  active: boolean;
  billboard: boolean;
  /** Seconds left of a close, or 0 when open. */
  closing: number;
  closeTotal: number;
  fade: number;
}

const MAX_SIGILS = 10;

export class Sigils {
  private readonly sigils: Sigil[] = [];
  private readonly xAxis = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();

  constructor(private readonly scene: THREE.Scene, geometry: THREE.BufferGeometry, private readonly camera: THREE.Camera) {
    for (let i = 0; i < MAX_SIGILS; i += 1) {
      const u = {
        uKind: { value: 0 }, uTime: { value: 0 }, uFade: { value: 0 }, uProgress: { value: 0 },
        uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() },
      };
      const material = new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: SIGIL_FRAGMENT, uniforms: u, ...ADDITIVE });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 23;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.sigils.push({ mesh, u, active: false, billboard: false, closing: 0, closeTotal: 1, fade: 1 });
    }
  }

  /** Opens a sigil size meters across its half width. Returns -1 when all are in use, which every other call accepts. */
  open(kind: number, x: number, y: number, z: number, size: number, billboard: boolean, color: Rgb, color2: Rgb): number {
    for (let i = 0; i < MAX_SIGILS; i += 1) {
      const s = this.sigils[i];
      if (s.active) continue;
      s.active = true;
      s.billboard = billboard;
      s.closing = 0;
      s.fade = 1;
      s.u.uKind.value = kind;
      s.u.uTime.value = Math.random() * 10;
      s.u.uFade.value = 1;
      s.u.uProgress.value = 0;
      s.u.uColor.value.setRGB(color[0], color[1], color[2]);
      s.u.uColor2.value.setRGB(color2[0], color2[1], color2[2]);
      s.mesh.position.set(x, y, z);
      s.mesh.scale.set(size, size, 1);
      s.mesh.quaternion.identity();
      s.mesh.visible = true;
      return i;
    }
    return -1;
  }

  place(index: number, x: number, y: number, z: number): void {
    if (index >= 0) this.sigils[index].mesh.position.set(x, y, z);
  }

  size(index: number, width: number, height = width): void {
    if (index >= 0) this.sigils[index].mesh.scale.set(width, height, 1);
  }

  /** Lays the sigil's x axis along (ax, ay, az) and its y axis along (bx, by, bz). They should be at right angles. */
  orient(index: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    if (index < 0) return;
    this.xAxis.set(ax, ay, az).normalize();
    this.yAxis.set(bx, by, bz).normalize();
    this.zAxis.crossVectors(this.xAxis, this.yAxis);
    this.basis.makeBasis(this.xAxis, this.yAxis, this.zAxis);
    this.sigils[index].mesh.quaternion.setFromRotationMatrix(this.basis);
  }

  progress(index: number, value: number): void {
    if (index >= 0) this.sigils[index].u.uProgress.value = value;
  }

  setFade(index: number, value: number): void {
    if (index >= 0) this.sigils[index].fade = value;
  }

  /** Fades out over seconds, then frees itself. */
  close(index: number, seconds: number): void {
    if (index < 0) return;
    const s = this.sigils[index];
    if (!s.active || s.closing > 0) return;
    s.closeTotal = Math.max(0.01, seconds);
    s.closing = s.closeTotal;
  }

  free(index: number): void {
    if (index < 0) return;
    this.sigils[index].active = false;
    this.sigils[index].mesh.visible = false;
  }

  update(seconds: number): void {
    for (let i = 0; i < MAX_SIGILS; i += 1) {
      const s = this.sigils[i];
      if (!s.active) continue;
      s.u.uTime.value += seconds;
      let fade = s.fade;
      if (s.closing > 0) {
        s.closing -= seconds;
        if (s.closing <= 0) {
          this.free(i);
          continue;
        }
        fade *= s.closing / s.closeTotal;
      }
      s.u.uFade.value = fade;
      if (s.billboard) s.mesh.quaternion.copy(this.camera.quaternion);
    }
  }

  /** Every mesh this pool owns, for warming up shaders before first use. */
  meshes(out: THREE.Object3D[]): void {
    for (const s of this.sigils) out.push(s.mesh);
  }

  clear(): void {
    for (let i = 0; i < MAX_SIGILS; i += 1) this.free(i);
  }

  dispose(): void {
    for (const s of this.sigils) {
      this.scene.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
  }
}

/* ---------- Thrown rock ---------- */

const MAX_CHUNKS = 72;
const CHUNK_GRAVITY = 16;
const ROCK_COLORS = [new THREE.Color('#2b241e'), new THREE.Color('#3d342b'), new THREE.Color('#57493b'), new THREE.Color('#1c1814')];
const HOT_ROCK = new THREE.Color('#c0501c');

/** Small dark boxes on ballistic arcs that bounce once, settle and sink away. */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly x = new Float32Array(MAX_CHUNKS);
  private readonly y = new Float32Array(MAX_CHUNKS);
  private readonly z = new Float32Array(MAX_CHUNKS);
  private readonly vx = new Float32Array(MAX_CHUNKS);
  private readonly vy = new Float32Array(MAX_CHUNKS);
  private readonly vz = new Float32Array(MAX_CHUNKS);
  private readonly rx = new Float32Array(MAX_CHUNKS);
  private readonly ry = new Float32Array(MAX_CHUNKS);
  private readonly spin = new Float32Array(MAX_CHUNKS);
  private readonly sizes = new Float32Array(MAX_CHUNKS);
  private readonly age = new Float32Array(MAX_CHUNKS);
  private readonly life = new Float32Array(MAX_CHUNKS);
  private readonly ground = new Float32Array(MAX_CHUNKS);
  private readonly bounces = new Uint8Array(MAX_CHUNKS);
  private readonly alive = new Uint8Array(MAX_CHUNKS);
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private next = 0;
  private live = 0;

  constructor(private readonly scene: THREE.Scene) {
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    applyVertexSnap(material);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.7, 0.85), material, MAX_CHUNKS);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX_CHUNKS; i += 1) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, ROCK_COLORS[0]);
    }
    scene.add(this.mesh);
  }

  /**
   * Throws count chunks from a point: speed meters per second outward, up for the upward part, and
   * (dirX, dirZ) times push added to every chunk, for a cone out of one side.
   */
  burst(x: number, y: number, z: number, groundY: number, count: number, speed: number, up: number, sizeLow: number, sizeHigh: number, dirX = 0, dirZ = 0, push = 0, hot = 0): void {
    for (let n = 0; n < count; n += 1) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_CHUNKS;
      const angle = Math.random() * Math.PI * 2;
      const out = speed * rand(0.35, 1);
      this.x[i] = x + Math.cos(angle) * 0.4;
      this.y[i] = y;
      this.z[i] = z + Math.sin(angle) * 0.4;
      this.vx[i] = Math.cos(angle) * out + dirX * push * rand(0.6, 1.2);
      this.vy[i] = up * rand(0.45, 1.1);
      this.vz[i] = Math.sin(angle) * out + dirZ * push * rand(0.6, 1.2);
      this.rx[i] = Math.random() * 6;
      this.ry[i] = Math.random() * 6;
      this.spin[i] = rand(-14, 14);
      this.sizes[i] = rand(sizeLow, sizeHigh);
      this.age[i] = 0;
      this.life[i] = rand(2.2, 3.4);
      this.ground[i] = groundY;
      this.bounces[i] = 0;
      if (!this.alive[i]) this.live += 1;
      this.alive[i] = 1;
      this.mesh.setColorAt(i, Math.random() < hot ? HOT_ROCK : pick(ROCK_COLORS));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(seconds: number): void {
    if (this.live === 0) return;
    for (let i = 0; i < MAX_CHUNKS; i += 1) {
      if (!this.alive[i]) continue;
      this.age[i] += seconds;
      const size = this.sizes[i];
      if (this.age[i] >= this.life[i]) {
        this.alive[i] = 0;
        this.live -= 1;
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      const floor = this.ground[i] + size * 0.3;
      if (this.bounces[i] < 2) {
        this.vy[i] -= CHUNK_GRAVITY * seconds;
        this.x[i] += this.vx[i] * seconds;
        this.y[i] += this.vy[i] * seconds;
        this.z[i] += this.vz[i] * seconds;
        this.rx[i] += this.spin[i] * seconds;
        this.ry[i] += this.spin[i] * 0.7 * seconds;
        if (this.y[i] < floor && this.vy[i] < 0) {
          this.y[i] = floor;
          if (this.bounces[i] === 0) {
            // One real bounce, then it stays down.
            this.vy[i] *= -0.32;
            this.vx[i] *= 0.45;
            this.vz[i] *= 0.45;
            this.spin[i] *= 0.4;
            this.bounces[i] = 1;
          } else {
            this.bounces[i] = 2;
          }
        }
      }
      // Sinks into the ground over its last half second rather than popping out of sight.
      const left = this.life[i] - this.age[i];
      const sink = left < 0.5 ? left / 0.5 : 1;
      this.position.set(this.x[i], this.y[i] - (1 - sink) * size * 0.6, this.z[i]);
      this.rotation.setFromEuler(this.euler.set(this.rx[i], this.ry[i], 0));
      this.scale.setScalar(size * (0.4 + 0.6 * sink));
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < MAX_CHUNKS; i += 1) {
      this.alive[i] = 0;
      this.mesh.setMatrixAt(i, this.hidden);
    }
    this.live = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
