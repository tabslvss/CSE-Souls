import * as THREE from 'three';
import { snapUniform } from '../psxRenderer';
import type { AtlasSprite } from './atlas';

/*
 * One pool of billboards, drawn in one instanced call. Motion lives in the vertex shader as a
 * function of (time - birth), so the CPU writes a particle once and never touches it again: a
 * full pool costs about the same per frame as an empty one. A ring buffer reuses the oldest slot.
 *
 * Additive and alpha particles share the draw call through premultiplied blending: a particle's
 * output alpha decides whether it covers what is behind it (alpha) or just adds light (additive).
 */

/** How a quad faces. */
export const FACE_CAMERA = 0;
/** Lies flat on the ground, for rings and stains. */
export const FACE_GROUND = 1;
/** Long side follows its screen-space velocity, for sparks, droplets and wind lines. */
export const FACE_VELOCITY = 2;
/** A pixel-font 1 or 0 from binary.png that flips and twitches. */
export const FACE_DIGIT = 3;
/** Faces the camera and pivots around the bottom edge, for light rays. */
export const FACE_BASE = 4;
/** A digit like FACE_DIGIT, except that its color is only the tint, so spells can have gold and blue ones. */
export const FACE_DIGIT_TINT = 5;

/** Velocity, gravity, drag and sideways wander. */
export const MOVE_BALLISTIC = 0;
/** The Binary Dust path: burst out, hang, then curve to a moving collector (plan section 4.8). */
export const MOVE_COLLECT = 1;
/** Circles the origin while drifting along its velocity. */
export const MOVE_ORBIT = 2;

/** Filled in by the caller and read by emit(). One shared object, so emitting allocates nothing. */
export interface ParticleSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds. */
  life: number;
  /** Seconds before it appears, for staggering a burst without any timers. */
  delay: number;
  /** Meters per second squared, downward. Negative rises. */
  gravity: number;
  /** Per second. Higher stops sooner. */
  drag: number;
  /** World height in meters at birth and at death. */
  size: number;
  endSize: number;
  /** Width over height. */
  aspect: number;
  rotation: number;
  spin: number;
  sprite: AtlasSprite;
  /** Linear color at birth, then at death. */
  r: number; g: number; b: number;
  r2: number; g2: number; b2: number;
  alpha: number;
  /** 0 covers what is behind it, 1 only adds light. */
  additive: number;
  face: number;
  move: number;
  /** MOVE_COLLECT: which collector to fly to. */
  slot: number;
  /** Share of life spent fading in, and share at which fading out starts. */
  fadeIn: number;
  fadeOut: number;
  /** Smallest height on screen in low-res pixels, so far things don't vanish. */
  minPixels: number;
  /** MOVE_BALLISTIC: wander in meters. MOVE_ORBIT: starting radius in meters. */
  extra: number;
  /** Ignored by fog, for things that should stay visible in the dark, like Binary Dust. */
  ignoreFog: boolean;
}

const FLOATS = 24;
const BYTES = 8;
export const COLLECTOR_SLOTS = 8;

const VERTEX = /* glsl */ `
  attribute vec4 iOriginBirth;
  attribute vec4 iVelocityLife;
  attribute vec4 iPhysics; // gravity, drag, size, endSize
  attribute vec4 iUv;
  attribute vec4 iSpin;    // rotation, spin, aspect, seed
  attribute vec4 iMode;    // face + 8 * move + 32 * slot, fades, minPixels, extra
  attribute vec4 iColor;   // square-root encoded rgb, alpha
  attribute vec4 iColor2;  // square-root encoded rgb, additive

  uniform float uTime;
  uniform float uTwitch;
  uniform vec2 uSnap;
  uniform vec3 uCollect[${COLLECTOR_SLOTS}];
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying vec4 vColor;
  varying float vAdditive;
  varying float vDigit;
  varying float vGray;

  void main() {
    float age = uTime - iOriginBirth.w;
    float life = iVelocityLife.w;
    float t = age / life;
    if (age < 0.0 || t >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float seed = iSpin.w;
    float modeValue = floor(iMode.x);
    float skipFog = fract(iMode.x);
    float face = mod(modeValue, 8.0);
    float move = mod(floor(modeValue / 8.0), 4.0);
    int slot = int(floor(modeValue / 32.0));
    float drag = iPhysics.y;
    vec3 velocity0 = iVelocityLife.xyz;
    vec3 origin = iOriginBirth.xyz;
    vec3 worldPos;
    vec3 worldVel;

    if (move < 0.5) {
      float lost = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
      float keep = drag > 0.001 ? exp(-drag * age) : 1.0;
      worldPos = origin + velocity0 * lost;
      worldPos.y -= 0.5 * iPhysics.x * age * age;
      worldVel = velocity0 * keep;
      worldVel.y -= iPhysics.x * age;
      float wander = iMode.w;
      if (wander > 0.0) {
        float phase = seed * 37.0;
        worldPos.x += sin(age * 1.7 + phase) * wander * t;
        worldPos.z += cos(age * 1.3 + phase * 1.7) * wander * t;
      }
    } else if (move < 1.5) {
      // Each digit runs through the same three phases on its own slightly different clock.
      float clock = age / life * 1.35;
      float burst = 1.0 - exp(-6.0 * min(clock, 0.75));
      vec3 loose = origin + velocity0 * burst / 6.0 * 1.6;
      float hang = smoothstep(0.3, 0.75, clock);
      loose.y += hang * 0.28 + sin(clock * 5.0 + seed * 40.0) * 0.05 * hang;
      float pull = smoothstep(0.75, 1.32, clock);
      vec3 target = uCollect[slot];
      worldPos = mix(loose, target, pull * pull);
      // A sideways bow, so they curve in rather than fly a straight line.
      worldPos.xz += vec2(sin(seed * 91.0), cos(seed * 57.0)) * sin(pull * 3.14159) * 0.55;
      worldPos.y += sin(pull * 3.14159) * 0.3;
      worldVel = vec3(0.0);
    } else {
      float angle = iSpin.x + iSpin.y * age;
      float radius = iMode.w * (1.0 - 0.55 * t * t);
      worldPos = origin + velocity0 * age + vec3(cos(angle) * radius, 0.0, sin(angle) * radius);
      worldVel = velocity0;
    }

    float size = mix(iPhysics.z, iPhysics.w, t);
    vec4 viewPos = viewMatrix * vec4(worldPos, 1.0);
    float pixelsPerMeter = projectionMatrix[1][1] * uSnap.y / max(0.05, -viewPos.z);
    size = max(size, iMode.z / pixelsPerMeter);
    float aspect = iSpin.z;
    vec2 corner = position.xy;
    vUv = mix(iUv.xy, iUv.zw, corner + 0.5);
    vDigit = -1.0;
    vGray = step(4.5, face);

    if (face < 0.5 || (face > 3.5 && face < 4.5)) {
      float angle = iSpin.x + iSpin.y * age;
      vec2 local = corner;
      if (face > 3.5) local.y += 0.5; // Pivot on the bottom edge.
      local *= vec2(size * aspect, size);
      viewPos.xy += vec2(cos(angle) * local.x - sin(angle) * local.y, sin(angle) * local.x + cos(angle) * local.y);
    } else if (face < 1.5) {
      float angle = iSpin.x + iSpin.y * age;
      vec2 local = corner * vec2(size * aspect, size);
      vec3 flat3 = vec3(cos(angle) * local.x - sin(angle) * local.y, 0.0, sin(angle) * local.x + cos(angle) * local.y);
      viewPos = viewMatrix * vec4(worldPos + flat3, 1.0);
    } else if (face < 2.5) {
      vec3 viewVel = (viewMatrix * vec4(worldVel, 0.0)).xyz;
      float screenSpeed = length(viewVel.xy);
      vec2 along = screenSpeed > 1e-4 ? viewVel.xy / screenSpeed : vec2(1.0, 0.0);
      // Foreshortened when flying at the camera, and shorter as it slows, the way a spark does.
      float foreshorten = screenSpeed / max(length(viewVel), 1e-4);
      float slowed = length(velocity0) > 1e-3 ? clamp(length(worldVel) / length(velocity0), 0.3, 1.0) : 1.0;
      float len = size * aspect * max(0.25, foreshorten) * slowed;
      viewPos.xy += along * corner.x * len + vec2(-along.y, along.x) * corner.y * size;
    } else {
      // Digits flip 8 to 14 times a second and jump by a pixel on the same tick.
      float tick = floor(uTime * (8.0 + fract(seed * 7.0) * 6.0) * uTwitch);
      vDigit = step(0.5, fract(sin(seed * 91.7 + tick) * 43758.5));
      viewPos.xy += corner * size;
      vUv = corner + 0.5;
    }

    gl_Position = projectionMatrix * viewPos;

    // The same coarse vertex snap as every other PSX material, so effects sit in the same world.
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    if (vDigit >= 0.0) {
      float tick = floor(uTime * (8.0 + fract(seed * 7.0) * 6.0) * uTwitch);
      vec2 jump = floor(vec2(fract(sin(seed * 11.0 + tick) * 917.3), fract(sin(seed * 23.0 + tick) * 431.9)) * 3.0) - 1.0;
      ndc.xy += jump * step(0.5, uTwitch) / uSnap;
    }
    ndc.xy = floor(ndc.xy * uSnap + 0.5) / uSnap;
    gl_Position.xyz = ndc * gl_Position.w;

    float fadeOut = floor(iMode.y) / 255.0;
    float fadeIn = fract(iMode.y);
    float alpha = iColor.a * (fadeIn > 0.0 ? smoothstep(0.0, fadeIn, t) : 1.0);
    alpha *= 1.0 - smoothstep(fadeOut, 1.0, t);
    vec3 start = iColor.rgb * iColor.rgb;
    vec3 end = iColor2.rgb * iColor2.rgb;
    vec3 tint = mix(start, end, t);
    vAdditive = iColor2.a;

    // Fog matches the world's: additive light dies off, and solid particles take the fog's color.
    if (uFogFar > 0.0 && skipFog < 0.25) {
      float keepFog = 1.0 - smoothstep(uFogNear, uFogFar, -viewPos.z);
      tint = vAdditive > 0.5 ? tint * keepFog : mix(uFogColor, tint, keepFog);
    }
    vColor = vec4(tint, alpha);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tAtlas;
  uniform sampler2D tDigits;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vAdditive;
  varying float vDigit;
  varying float vGray;

  void main() {
    vec4 tex = vDigit >= 0.0 ? texture2D(tDigits, vec2((vUv.x + vDigit) * 0.5, vUv.y)) : texture2D(tAtlas, vUv);
    float alpha = tex.a * vColor.a;
    if (alpha < 0.004) discard;
    // The digit art has its own color, which a blue tint would turn black.
    vec3 base = vGray > 0.5 ? vec3(max(tex.r, max(tex.g, tex.b))) : tex.rgb;
    gl_FragColor = vec4(base * vColor.rgb * alpha, alpha * (1.0 - vAdditive));
  }
`;

function encode(linear: number): number {
  return Math.min(255, Math.sqrt(Math.max(0, linear)) * 255 + 0.5) | 0;
}

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  /** The one spec to fill before calling emit(). Reset with reset(). */
  readonly spec: ParticleSpec;
  private readonly floats: Float32Array;
  private readonly bytes: Uint8Array;
  private readonly floatBuffer: THREE.InstancedInterleavedBuffer;
  private readonly byteBuffer: THREE.InstancedInterleavedBuffer;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly collectors: THREE.Vector3[] = [];
  private head = 0;
  private used = 0;
  private dirtyStart = -1;
  private dirtyCount = 0;
  private time = 0;

  constructor(atlas: THREE.Texture, digits: THREE.Texture, capacity: number, spriteDefault: AtlasSprite) {
    this.capacity = capacity;
    this.spec = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, gravity: 0, drag: 0, size: 1, endSize: 1, aspect: 1,
      rotation: 0, spin: 0, sprite: spriteDefault, r: 1, g: 1, b: 1, r2: 1, g2: 1, b2: 1, alpha: 1, additive: 0,
      face: FACE_CAMERA, move: MOVE_BALLISTIC, slot: 0, fadeIn: 0, fadeOut: 0.5, minPixels: 0, extra: 0, ignoreFog: false,
    };
    this.floats = new Float32Array(capacity * FLOATS);
    this.bytes = new Uint8Array(capacity * BYTES);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.floatBuffer = new THREE.InstancedInterleavedBuffer(this.floats, FLOATS, 1);
    this.floatBuffer.setUsage(THREE.DynamicDrawUsage);
    this.byteBuffer = new THREE.InstancedInterleavedBuffer(this.bytes, BYTES, 1);
    this.byteBuffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iOriginBirth', new THREE.InterleavedBufferAttribute(this.floatBuffer, 4, 0));
    geometry.setAttribute('iVelocityLife', new THREE.InterleavedBufferAttribute(this.floatBuffer, 4, 4));
    geometry.setAttribute('iPhysics', new THREE.InterleavedBufferAttribute(this.floatBuffer, 4, 8));
    geometry.setAttribute('iUv', new THREE.InterleavedBufferAttribute(this.floatBuffer, 4, 12));
    geometry.setAttribute('iSpin', new THREE.InterleavedBufferAttribute(this.floatBuffer, 4, 16));
    geometry.setAttribute('iMode', new THREE.InterleavedBufferAttribute(this.floatBuffer, 4, 20));
    geometry.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.byteBuffer, 4, 0, true));
    geometry.setAttribute('iColor2', new THREE.InterleavedBufferAttribute(this.byteBuffer, 4, 4, true));
    geometry.instanceCount = 0;
    this.geometry = geometry;

    for (let i = 0; i < COLLECTOR_SLOTS; i += 1) this.collectors.push(new THREE.Vector3());
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        tAtlas: { value: atlas },
        tDigits: { value: digits },
        uTime: { value: 0 },
        uTwitch: { value: reducedMotion ? 0 : 1 },
        uSnap: snapUniform,
        uCollect: { value: this.collectors },
        uFogNear: { value: 0 },
        uFogFar: { value: 0 },
        uFogColor: { value: new THREE.Color(0, 0, 0) },
      },
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  /** Back to plain defaults, so one effect's settings can't leak into the next. */
  reset(): ParticleSpec {
    const s = this.spec;
    s.vx = s.vy = s.vz = 0;
    s.life = 1;
    s.delay = 0;
    s.gravity = 0;
    s.drag = 0;
    s.size = s.endSize = 1;
    s.aspect = 1;
    s.rotation = s.spin = 0;
    s.alpha = 1;
    s.additive = 0;
    s.face = FACE_CAMERA;
    s.move = MOVE_BALLISTIC;
    s.slot = 0;
    s.fadeIn = 0;
    s.fadeOut = 0.5;
    s.minPixels = 0;
    s.extra = 0;
    s.ignoreFog = false;
    return s;
  }

  /** Writes spec into the next slot. Overwrites the oldest particle when the pool is full. */
  emit(): void {
    const s = this.spec;
    const index = this.head;
    const f = this.floats;
    const b = this.bytes;
    let o = index * FLOATS;
    f[o++] = s.x; f[o++] = s.y; f[o++] = s.z; f[o++] = this.time + s.delay;
    f[o++] = s.vx; f[o++] = s.vy; f[o++] = s.vz; f[o++] = s.life;
    f[o++] = s.gravity; f[o++] = s.drag; f[o++] = s.size; f[o++] = s.endSize;
    f[o++] = s.sprite.u0; f[o++] = s.sprite.v0; f[o++] = s.sprite.u1; f[o++] = s.sprite.v1;
    f[o++] = s.rotation; f[o++] = s.spin; f[o++] = s.aspect; f[o++] = Math.random();
    // A fractional part on the mode says "skip fog", and the fades share a float: whole part out, fraction in.
    f[o++] = s.face + 8 * s.move + 32 * s.slot + (s.ignoreFog ? 0.5 : 0);
    f[o++] = Math.floor(Math.min(1, s.fadeOut) * 255) + Math.min(0.99, s.fadeIn);
    f[o++] = s.minPixels; f[o++] = s.extra;
    let p = index * BYTES;
    b[p++] = encode(s.r); b[p++] = encode(s.g); b[p++] = encode(s.b); b[p++] = Math.min(255, s.alpha * 255) | 0;
    b[p++] = encode(s.r2); b[p++] = encode(s.g2); b[p++] = encode(s.b2); b[p++] = Math.min(255, s.additive * 255) | 0;

    this.markDirty(index);
    this.head = (index + 1) % this.capacity;
    if (this.used < this.capacity) {
      this.used += 1;
      this.geometry.instanceCount = this.used;
    }
  }

  private markDirty(index: number): void {
    if (this.dirtyStart < 0) {
      this.dirtyStart = index;
      this.dirtyCount = 1;
      return;
    }
    // Emits run in order, so the range only grows, and it wraps at most once a frame unless the pool overflows.
    if (index === 0) {
      this.flushRange();
      this.dirtyStart = 0;
      this.dirtyCount = 1;
    } else {
      this.dirtyCount += 1;
    }
  }

  private flushRange(): void {
    if (this.dirtyStart < 0) return;
    this.floatBuffer.addUpdateRange(this.dirtyStart * FLOATS, this.dirtyCount * FLOATS);
    this.byteBuffer.addUpdateRange(this.dirtyStart * BYTES, this.dirtyCount * BYTES);
    this.floatBuffer.needsUpdate = true;
    this.byteBuffer.needsUpdate = true;
    this.dirtyStart = -1;
    this.dirtyCount = 0;
  }

  /** Advances particle time. Pass game seconds with hitstop already applied. */
  update(seconds: number): void {
    this.time += seconds;
    (this.material.uniforms.uTime as THREE.IUniform<number>).value = this.time;
    this.flushRange();
  }

  get now(): number {
    return this.time;
  }

  setCollector(slot: number, x: number, y: number, z: number): void {
    this.collectors[slot].set(x, y, z);
  }

  /** Pass far = 0 for no fog. */
  setFog(near: number, far: number, color: THREE.Color): void {
    (this.material.uniforms.uFogNear as THREE.IUniform<number>).value = near;
    (this.material.uniforms.uFogFar as THREE.IUniform<number>).value = far;
    (this.material.uniforms.uFogColor.value as THREE.Color).copy(color);
  }

  /** Counts living particles by scanning, so it is for reports and not for every frame. */
  aliveCount(): number {
    let alive = 0;
    for (let i = 0; i < this.used; i += 1) {
      const o = i * FLOATS;
      if (this.time - this.floats[o + 3] < this.floats[o + 7]) alive += 1;
    }
    return alive;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
