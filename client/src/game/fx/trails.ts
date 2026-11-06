import * as THREE from 'three';
import { snapUniform } from '../psxRenderer';

/*
 * Blade ribbons. A swing writes quads into one shared ring buffer, and the shader ages them, so a
 * finished ribbon fades by itself and any number of swings stay in one draw call.
 * Each new sample is smoothed into a few segments, so a fast swing at a low frame rate still
 * curves instead of showing straight facets.
 */

/** Ribbon looks, in the order of the uColor and uLife uniforms. */
export const TRAIL_GOLD = 0;
export const TRAIL_MAGIC = 1;
export const TRAIL_WIND = 2;

const SEGMENTS = 1536;
const SUBDIVISIONS = 4;
const STRIDE = 10;
const MAX_TRAILS = 32;
const MIN_MOVE_SQUARED = 0.0004;

const VERTEX = /* glsl */ `
  attribute vec3 aTip;
  attribute vec4 aInfo; // birth, side (0 base, 1 tip), look, along

  uniform float uTime;
  uniform float uLife[3];
  uniform vec2 uSnap;
  varying float vAge;
  varying float vSide;
  varying float vLook;
  varying float vAlong;

  void main() {
    int look = int(aInfo.z + 0.5);
    float age = (uTime - aInfo.x) / uLife[look];
    if (age >= 1.0 || age < 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // A crescent: no width at the leading point, widest just behind it, then closing to the tip
    // as it ages. A square-ended ribbon reads as a paper fan. A thin tapered one reads as speed.
    float reach = look == 2 ? 0.34 : look == 1 ? 0.5 : 0.3;
    float width = reach * smoothstep(0.0, 0.14, age) * (1.0 - age * age * 0.92);
    vec3 world = mix(aTip, position, width);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    ndc.xy = floor(ndc.xy * uSnap + 0.5) / uSnap;
    gl_Position.xyz = ndc * gl_Position.w;
    vAge = age;
    vSide = aInfo.y;
    vLook = aInfo.z;
    vAlong = aInfo.w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor[3];
  uniform vec3 uHot[3];
  varying float vAge;
  varying float vSide;
  varying float vLook;
  varying float vAlong;

  float hash(float n) { return fract(sin(n * 91.17) * 43758.5); }

  void main() {
    int look = int(vLook + 0.5);
    float fade = (1.0 - vAge);
    float side = vSide;
    float strength;
    if (look == 1) {
      // Digital: the ribbon breaks into blocks that drop out, like bad data.
      float column = floor(vAlong * 34.0);
      float row = floor(side * 5.0);
      float cell = hash(column * 3.0 + row * 17.0);
      if (cell < vAge * 0.9 + 0.12) discard;
      strength = pow(side, 1.6) * 1.2;
    } else if (look == 2) {
      // Heavy: one hot edge with torn air behind it. The lines keep it from reading as a solid sheet.
      float lines = 0.2 + 0.8 * step(0.45, hash(floor(side * 11.0) + 2.0));
      strength = pow(side, 16.0) * 0.8 + pow(side, 1.3) * 0.11 * lines;
    } else {
      // Gold: all the light sits in a thin line at the very edge of the blade.
      float lines = 0.8 + 0.2 * hash(floor(side * 21.0));
      strength = (pow(side, 14.0) * 1.7 + pow(side, 4.0) * 0.2) * lines;
    }
    float alpha = strength * fade * fade;
    if (alpha < 0.01) discard;
    vec3 tint = mix(uColor[look], uHot[look], clamp(pow(side, 24.0) * (1.25 - vAge), 0.0, 1.0));
    gl_FragColor = vec4(tint * alpha, 0.0);
  }
`;

interface TrailState {
  id: number;
  active: boolean;
  look: number;
  samples: number;
  /** The last three samples as tip xyz + base xyz. */
  history: Float32Array;
  lastBirth: number;
}

export class TrailPool {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly data = new Float32Array(SEGMENTS * 4 * STRIDE);
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly trails: TrailState[] = [];
  private head = 0;
  private dirtyFirst = -1;
  private dirtyLast = -1;
  private time = 0;
  private along = 0;
  /** The look of the trail most recently pushed, so effects can add matching bits. */
  lastLook = TRAIL_GOLD;

  constructor(colors: THREE.Color[], hots: THREE.Color[]) {
    for (let i = 0; i < MAX_TRAILS; i += 1) {
      this.trails.push({ id: -1, active: false, look: TRAIL_GOLD, samples: 0, history: new Float32Array(18), lastBirth: 0 });
    }
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    this.geometry.setAttribute('aTip', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    this.geometry.setAttribute('aInfo', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    const index = new Uint16Array(SEGMENTS * 6);
    for (let i = 0; i < SEGMENTS; i += 1) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: [0.24, 0.3, 0.34] },
        uSnap: snapUniform,
        uColor: { value: colors },
        uHot: { value: hots },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  begin(id: number, look: number): void {
    let trail = this.find(id);
    if (!trail) {
      trail = this.trails.find((candidate) => !candidate.active) ?? this.trails[0];
    }
    trail.id = id;
    trail.active = true;
    trail.look = look;
    trail.samples = 0;
    trail.lastBirth = this.time;
  }

  end(id: number): void {
    const trail = this.find(id);
    if (trail) {
      trail.active = false;
      trail.id = -1;
    }
  }

  private find(id: number): TrailState | null {
    for (let i = 0; i < MAX_TRAILS; i += 1) {
      if (this.trails[i].id === id && this.trails[i].active) return this.trails[i];
    }
    return null;
  }

  /** Returns how far the tip moved in meters since the last sample, or -1 if nothing was added. */
  push(id: number, tip: THREE.Vector3, base: THREE.Vector3): number {
    const trail = this.find(id);
    if (!trail) return -1;
    this.lastLook = trail.look;
    const h = trail.history;
    if (trail.samples > 0) {
      const dx = tip.x - h[0];
      const dy = tip.y - h[1];
      const dz = tip.z - h[2];
      const moved = dx * dx + dy * dy + dz * dz;
      if (moved < MIN_MOVE_SQUARED) return 0;
    }
    // Newest first: history holds samples 0 (newest), 1, 2.
    h.copyWithin(6, 0, 12);
    h[0] = tip.x; h[1] = tip.y; h[2] = tip.z;
    h[3] = base.x; h[4] = base.y; h[5] = base.z;
    trail.samples = Math.min(trail.samples + 1, 3);
    if (trail.samples < 2) {
      trail.lastBirth = this.time;
      return 0;
    }

    const birth0 = trail.lastBirth;
    trail.lastBirth = this.time;
    const hasBefore = trail.samples >= 3;
    let prevTx = h[6], prevTy = h[7], prevTz = h[8];
    let prevBx = h[9], prevBy = h[10], prevBz = h[11];
    for (let step = 1; step <= SUBDIVISIONS; step += 1) {
      const t = step / SUBDIVISIONS;
      // Catmull-Rom through the older sample, with the newest extrapolated for the far tangent.
      const tx = spline(hasBefore ? h[12] : h[6], h[6], h[0], 2 * h[0] - h[6], t);
      const ty = spline(hasBefore ? h[13] : h[7], h[7], h[1], 2 * h[1] - h[7], t);
      const tz = spline(hasBefore ? h[14] : h[8], h[8], h[2], 2 * h[2] - h[8], t);
      const bx = spline(hasBefore ? h[15] : h[9], h[9], h[3], 2 * h[3] - h[9], t);
      const by = spline(hasBefore ? h[16] : h[10], h[10], h[4], 2 * h[4] - h[10], t);
      const bz = spline(hasBefore ? h[17] : h[11], h[11], h[5], 2 * h[5] - h[11], t);
      const birthA = birth0 + (this.time - birth0) * (t - 1 / SUBDIVISIONS);
      const birthB = birth0 + (this.time - birth0) * t;
      this.writeSegment(prevTx, prevTy, prevTz, prevBx, prevBy, prevBz, tx, ty, tz, bx, by, bz, birthA, birthB, trail.look);
      prevTx = tx; prevTy = ty; prevTz = tz;
      prevBx = bx; prevBy = by; prevBz = bz;
    }
    return Math.hypot(h[0] - h[6], h[1] - h[7], h[2] - h[8]);
  }

  private writeSegment(
    tx0: number, ty0: number, tz0: number, bx0: number, by0: number, bz0: number,
    tx1: number, ty1: number, tz1: number, bx1: number, by1: number, bz1: number,
    birth0: number, birth1: number, look: number,
  ): void {
    const segment = this.head;
    this.head = (segment + 1) % SEGMENTS;
    const d = this.data;
    let o = segment * 4 * STRIDE;
    const along0 = this.along;
    this.along = (this.along + 0.03) % 1;
    const along1 = this.along < along0 ? 1 : this.along;
    // base 0, tip 0, base 1, tip 1
    d[o++] = bx0; d[o++] = by0; d[o++] = bz0; d[o++] = tx0; d[o++] = ty0; d[o++] = tz0; d[o++] = birth0; d[o++] = 0; d[o++] = look; d[o++] = along0;
    d[o++] = tx0; d[o++] = ty0; d[o++] = tz0; d[o++] = tx0; d[o++] = ty0; d[o++] = tz0; d[o++] = birth0; d[o++] = 1; d[o++] = look; d[o++] = along0;
    d[o++] = bx1; d[o++] = by1; d[o++] = bz1; d[o++] = tx1; d[o++] = ty1; d[o++] = tz1; d[o++] = birth1; d[o++] = 0; d[o++] = look; d[o++] = along1;
    d[o++] = tx1; d[o++] = ty1; d[o++] = tz1; d[o++] = tx1; d[o++] = ty1; d[o++] = tz1; d[o++] = birth1; d[o++] = 1; d[o++] = look; d[o++] = along1;
    if (segment === 0 && this.dirtyFirst >= 0) this.flush();
    if (this.dirtyFirst < 0) this.dirtyFirst = segment;
    this.dirtyLast = segment;
  }

  private flush(): void {
    if (this.dirtyFirst < 0) return;
    const start = this.dirtyFirst * 4 * STRIDE;
    const count = (this.dirtyLast - this.dirtyFirst + 1) * 4 * STRIDE;
    this.buffer.addUpdateRange(start, count);
    this.buffer.needsUpdate = true;
    this.dirtyFirst = -1;
    this.dirtyLast = -1;
  }

  update(seconds: number): void {
    this.time += seconds;
    (this.material.uniforms.uTime as THREE.IUniform<number>).value = this.time;
    this.flush();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function spline(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
}
