import * as THREE from 'three';
import type { MapGrace } from '../../../shared/mapTypes';
import { snapUniform } from './psxRenderer';

/**
 * How a Binary Grace looks: a slender gold light standing in its ring of stones, a soft pool of light on
 * the ground, and golden digits drifting up and away. It's all additive light, so nothing here is a solid
 * flame, and the dither in the PS1 pass turns the soft falloffs into its own kind of glow. The digits
 * work out where they are in the vertex shader, so a grace costs nothing on the CPU to keep alive.
 */

const DIGITS_PER_GRACE = 90;
const CORE_WIDTH = 3.4;
const CORE_HEIGHT = 5.6;
const CORE_CENTER = 1.9;
const GROUND_SIZE = 13;
/** Above the ground by enough that the two don't fight at the depth buffer's low precision. */
const GROUND_LIFT = 0.06;
const LIGHT_COLOR = 0xffc35a;
const LIGHT_POWER = 20;
const LIGHT_RANGE = 15;
const LIGHT_HEIGHT = 1.7;
const LIGHT_MAX_DISTANCE = 40;
/** Far enough to be seen as a beacon, and then gone, so that far-off ones aren't drawn at all. */
const FADE_FROM = 95;
const FADE_TO = 170;
const LIGHT_UP_RATE = 1.4;
const PULSE_DECAY = 1.5;

const GOLD = 'vec3(1.0, 0.68, 0.2)';
const HOT = 'vec3(1.0, 0.86, 0.52)';

/** The same coarse vertex snap as every other PSX material. */
const SNAP = /* glsl */ `
  vec3 ndc = gl_Position.xyz / gl_Position.w;
  ndc.xy = floor(ndc.xy * uSnap + 0.5) / uSnap;
  gl_Position.xyz = ndc * gl_Position.w;
`;

const CORE_VERTEX = /* glsl */ `
  uniform vec2 uSnap;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 view = modelViewMatrix * vec4(0.0, ${CORE_CENTER.toFixed(2)}, 0.0, 1.0);
    view.xy += position.xy * vec2(${CORE_WIDTH.toFixed(2)}, ${CORE_HEIGHT.toFixed(2)});
    gl_Position = projectionMatrix * view;
    ${SNAP}
  }
`;

const CORE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uLevel;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    // A slow lean, stronger higher up. Slow enough that it reads as a light and not as a flame.
    float x = p.x + sin(p.y * 2.6 + uTime * 0.8 + uSeed) * 0.05 * (p.y + 1.0);
    float column = exp(-x * x * 90.0) * smoothstep(1.0, -0.35, p.y) * smoothstep(-0.78, -0.6, p.y);
    float halo = exp(-(x * x * 7.0 + (p.y + 0.3) * (p.y + 0.3) * 4.5));
    float heart = exp(-(x * x * 130.0 + (p.y + 0.5) * (p.y + 0.5) * 60.0));
    float breath = 0.86 + 0.14 * sin(uTime * 1.3 + uSeed);
    // Everything falls to nothing before the edge of the quad, so no edge can show.
    float edge = smoothstep(1.0, 0.72, max(abs(p.x), abs(p.y)));
    vec3 color = ${GOLD} * (halo * 0.42 * breath + column * 0.8) + ${HOT} * heart * 1.2;
    gl_FragColor = vec4(color * uLevel * edge, 1.0);
  }
`;

const GROUND_VERTEX = /* glsl */ `
  uniform vec2 uSnap;
  varying vec2 vPos;
  void main() {
    vPos = position.xy * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${SNAP}
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uLevel;
  varying vec2 vPos;
  void main() {
    float d = length(vPos);
    float breath = 0.88 + 0.12 * sin(uTime * 1.3 + uSeed);
    float pool = exp(-d * d * 7.0) * 0.5 * breath;
    gl_FragColor = vec4(${GOLD} * pool * smoothstep(1.0, 0.8, d) * uLevel, 1.0);
  }
`;

const DIGIT_VERTEX = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uLit;
  uniform float uFade;
  uniform vec2 uSnap;
  varying float vDigit;
  varying float vAlpha;
  void main() {
    float cycle = fract(uTime * (0.06 + 0.06 * aSeed.x) + aSeed.y);
    float turn = (0.2 + 0.3 * aSeed.x) * (aSeed.w > 0.5 ? 1.0 : -1.0);
    float angle = aSeed.z * 6.283 + uTime * turn + cycle * 1.8;
    float radius = mix(0.15, 0.7 + aSeed.w * 1.1, pow(cycle, 0.75));
    vec3 local = vec3(cos(angle) * radius, 0.2 + cycle * (3.0 + aSeed.x * 2.2), sin(angle) * radius);
    local.x += sin(uTime * 0.55 + aSeed.y * 20.0) * 0.12;
    vec4 view = modelViewMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * view;
    ${SNAP}
    float meters = 0.09 + 0.06 * aSeed.x;
    gl_PointSize = clamp(meters * projectionMatrix[1][1] * uSnap.y / max(0.1, -view.z), 2.0, 13.0);
    // They flip a few times a second, slower than a burst of dust, because this light is calm.
    vDigit = step(0.5, fract(sin(aSeed.y * 91.7 + floor(uTime * (1.2 + aSeed.z * 2.5))) * 43758.5));
    // An unlit grace only lets out a few.
    float shown = step(aSeed.w, mix(0.18, 1.0, uLit));
    vAlpha = smoothstep(0.0, 0.14, cycle) * (1.0 - smoothstep(0.6, 1.0, cycle)) * shown * uFade;
  }
`;

const DIGIT_FRAGMENT = /* glsl */ `
  uniform sampler2D tDigits;
  uniform float uLevel;
  varying float vDigit;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(tDigits, vec2((gl_PointCoord.x + vDigit) * 0.5, 1.0 - gl_PointCoord.y));
    float alpha = tex.a * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(tex.rgb * ${HOT} * alpha * (0.8 + uLevel * 0.7), 1.0);
  }
`;

interface GraceLook {
  id: number;
  x: number;
  z: number;
  group: THREE.Group;
  lit: boolean;
  /** Uniforms, shared by all three of this grace's materials. */
  uLit: { value: number };
  uLevel: { value: number };
  uFade: { value: number };
  pulse: number;
}

export class GraceField {
  private readonly looks: GraceLook[] = [];
  private readonly light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE, 1.5);
  private readonly uTime = { value: 0 };
  private readonly digits: THREE.Texture;
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private readonly digitGeometry = new THREE.BufferGeometry();
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    graces: readonly MapGrace[],
  ) {
    this.digits = new THREE.TextureLoader().load('/fx/binary.png');
    this.digits.minFilter = THREE.NearestFilter;
    this.digits.magFilter = THREE.NearestFilter;
    this.digits.generateMipmaps = false;

    const seeds = new Float32Array(DIGITS_PER_GRACE * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = Math.random();
    this.digitGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DIGITS_PER_GRACE * 3), 3));
    this.digitGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    // One light moves to whichever is nearest. A light for each would make every material in the world pay for all of them.
    this.light.position.y = LIGHT_HEIGHT;
    scene.add(this.light);
    for (const grace of graces) this.looks.push(this.build(grace));
  }

  private material(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...uniforms, uTime: this.uTime, uSnap: snapUniform },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(material);
    return material;
  }

  private build(grace: MapGrace): GraceLook {
    const uLit = { value: 0 };
    const uLevel = { value: 0 };
    const uFade = { value: 1 };
    const uSeed = { value: grace.id * 1.7 };
    const group = new THREE.Group();
    group.position.set(grace.x, 0, grace.z);

    const core = new THREE.Mesh(this.quad, this.material(CORE_VERTEX, CORE_FRAGMENT, { uLevel, uSeed }));
    const ground = new THREE.Mesh(this.quad, this.material(GROUND_VERTEX, GROUND_FRAGMENT, { uLevel, uSeed }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_LIFT;
    ground.scale.setScalar(GROUND_SIZE);
    const digits = new THREE.Points(
      this.digitGeometry,
      this.material(DIGIT_VERTEX, DIGIT_FRAGMENT, { uLevel, uLit, uFade, tDigits: { value: this.digits } }),
    );
    // Their shaders put them somewhere else than their geometry says.
    core.frustumCulled = false;
    digits.frustumCulled = false;
    group.add(ground, core, digits);
    this.scene.add(group);
    return { id: grace.id, x: grace.x, z: grace.z, group, lit: false, uLit, uLevel, uFade, pulse: 0 };
  }

  /** animate is for the moment you light one. Graces you found earlier are simply lit when you arrive. */
  setLit(id: number, lit: boolean, animate: boolean): void {
    const look = this.looks.find((item) => item.id === id);
    if (!look) return;
    look.lit = lit;
    if (animate) look.pulse = 1;
    else look.uLit.value = lit ? 1 : 0;
  }

  /** A brief swell, for someone sitting down at it. */
  flare(id: number): void {
    const look = this.looks.find((item) => item.id === id);
    if (look) look.pulse = Math.max(look.pulse, 0.6);
  }

  update(seconds: number, playerX: number, playerZ: number): void {
    this.uTime.value += seconds;
    let nearest: GraceLook | null = null;
    let nearestDistance = LIGHT_MAX_DISTANCE;
    for (const look of this.looks) {
      const distance = Math.hypot(look.x - playerX, look.z - playerZ);
      look.group.visible = distance < FADE_TO;
      if (!look.group.visible) continue;
      const target = look.lit ? 1 : 0;
      look.uLit.value += (target - look.uLit.value) * (1 - Math.exp(-seconds * LIGHT_UP_RATE));
      look.pulse *= Math.exp(-seconds * PULSE_DECAY);
      const fade = 1 - THREE.MathUtils.smoothstep(distance, FADE_FROM, FADE_TO);
      look.uFade.value = fade;
      // Unlit ones stay faintly visible, so that there's something to walk toward.
      look.uLevel.value = (0.2 + 0.8 * look.uLit.value + look.pulse * 1.4) * fade;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = look;
      }
    }
    if (nearest) {
      const breath = 0.9 + 0.1 * Math.sin(this.uTime.value * 1.3 + nearest.id);
      this.light.position.x = nearest.x;
      this.light.position.z = nearest.z;
      this.light.intensity = LIGHT_POWER * (0.15 + 0.85 * nearest.uLit.value + nearest.pulse) * breath;
    } else {
      this.light.intensity = 0;
    }
  }

  dispose(): void {
    for (const look of this.looks) this.scene.remove(look.group);
    this.scene.remove(this.light);
    for (const material of this.materials) material.dispose();
    this.quad.dispose();
    this.digitGeometry.dispose();
    this.digits.dispose();
  }
}
