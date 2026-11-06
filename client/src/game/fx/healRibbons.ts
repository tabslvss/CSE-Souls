import * as THREE from 'three';
import { snapUniform } from '../psxRenderer';
import { FACE_DIGIT, type ParticlePool } from './particles';

/*
 * The light around someone drinking: ribbons along chains of bezier curves that spiral up the
 * body, a soft glow on the ground, and tiny Binary Dust digits riding the ribbons. The curves are
 * built once and shared. Light flows along them in the shader, and each ribbon set just follows
 * its player around, so nothing here allocates per frame.
 */

const MAX_AURAS = 8;
const RIBBONS = 3;
const SPANS = 4;
const STEPS_PER_SPAN = 10;
const POINTS = SPANS * STEPS_PER_SPAN + 1;
const SPIRAL_TURNS = 1.45;
const BOTTOM_RADIUS = 0.62;
const TOP_RADIUS = 0.26;
const BOTTOM_HEIGHT = 0.06;
const TOP_HEIGHT = 2.05;
/** Each joint between curves sits a little in or out, so the spiral breathes and isn't a perfect coil. */
const JOINT_WOBBLE = 0.2;
/** Trips of the light up a ribbon per second. */
const FLOW_RATE = 0.62;
const TURN_RATE = 0.75;
const FADE_IN_RATE = 5;
const FADE_OUT_RATE = 7;
const PULSE_DECAY = 3.5;
const DIGITS_PER_SECOND = 26;
const GROUND_SIZE = 2.8;
const GROUND_LIFT = 0.05;
/** Longer than any drink, in case the end of one is never reported. */
const LONGEST_SECONDS = 4;

const DIGIT_GOLD = new THREE.Color('#ffd98a');
const DIGIT_CRIMSON = new THREE.Color('#d8402a');
const DIGIT_DARK = new THREE.Color('#8a4a18');

const RIBBON_VERTEX = /* glsl */ `
  attribute vec3 aTangent;
  attribute vec3 aInfo; // side (-1 or 1), along (0 to 1), phase

  uniform float uClock;
  uniform float uPulse;
  uniform vec2 uSnap;
  varying float vSide;
  varying float vAlong;
  varying float vPhase;
  varying float vBright;

  void main() {
    float along = aInfo.y;
    float behind = fract(uClock * ${FLOW_RATE.toFixed(3)} + aInfo.z - along);
    float bright = smoothstep(0.0, 0.04, behind) * pow(1.0 - behind, 2.5);
    float ends = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.84, 1.0, along));
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vec3 tangent = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz);
    // Always turned to face the camera, like a stroke of light and not a strip of paper.
    vec3 across = normalize(cross(tangent, normalize(-view.xyz)));
    view.xyz += across * aInfo.x * (0.016 + 0.05 * bright + 0.03 * uPulse) * ends;
    gl_Position = projectionMatrix * view;
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    ndc.xy = floor(ndc.xy * uSnap + 0.5) / uSnap;
    gl_Position.xyz = ndc * gl_Position.w;
    vSide = aInfo.x;
    vAlong = along;
    vPhase = aInfo.z;
    vBright = bright * ends;
  }
`;

const RIBBON_FRAGMENT = /* glsl */ `
  uniform float uClock;
  uniform float uFade;
  uniform float uPulse;
  varying float vSide;
  varying float vAlong;
  varying float vPhase;
  varying float vBright;

  void main() {
    float soft = 1.0 - vSide * vSide;
    // Crimson runs through the gold in thin veins.
    float vein = smoothstep(0.62, 0.95, 0.5 + 0.5 * sin(vAlong * 21.0 + uClock * 2.4 + vPhase * 6.283));
    vec3 color = mix(vec3(0.89, 0.6, 0.2), vec3(0.62, 0.06, 0.05), vein * 0.75);
    color = mix(color, vec3(1.0, 0.86, 0.56), vBright * vBright * (1.0 - vein * 0.6));
    float ends = smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.84, 1.0, vAlong));
    float alpha = soft * ends * (0.14 + 0.86 * vBright) * uFade * (1.0 + 0.6 * uPulse);
    gl_FragColor = vec4(color, min(1.0, alpha));
  }
`;

const GROUND_VERTEX = /* glsl */ `
  varying vec2 vPlace;

  void main() {
    vPlace = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  uniform float uClock;
  uniform float uFade;
  uniform float uPulse;
  varying vec2 vPlace;

  void main() {
    float r = length(vPlace);
    float glow = 1.0 - smoothstep(0.0, 1.0, r);
    vec3 color = mix(vec3(0.89, 0.6, 0.2), vec3(0.6, 0.09, 0.06), smoothstep(0.45, 0.9, r) * 0.6);
    float breathe = 0.85 + 0.15 * sin(uClock * 3.0);
    gl_FragColor = vec4(color, glow * glow * 0.34 * uFade * breathe * (1.0 + 0.9 * uPulse));
  }
`;

/** A point on the spiral, s from 0 to 1. */
function spiralAt(ribbon: number, s: number, out: number, to: THREE.Vector3): THREE.Vector3 {
  const angle = (ribbon / RIBBONS) * Math.PI * 2 + s * Math.PI * 2 * SPIRAL_TURNS;
  const radius = (BOTTOM_RADIUS + (TOP_RADIUS - BOTTOM_RADIUS) * s) * (1 + out);
  return to.set(Math.sin(angle) * radius, BOTTOM_HEIGHT + (TOP_HEIGHT - BOTTOM_HEIGHT) * s, Math.cos(angle) * radius);
}

/** Points along one ribbon, three numbers each, then the direction it runs at each of them. */
function buildCurve(ribbon: number): { points: Float32Array; tangents: Float32Array } {
  const points = new Float32Array(POINTS * 3);
  const tangents = new Float32Array(POINTS * 3);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const span = 1 / SPANS;
  const nudge = 0.001;

  /** The way the spiral runs at s, scaled to a third of a span: the bezier handle that follows it. */
  const handle = (s: number, to: THREE.Vector3) => {
    spiralAt(ribbon, s - nudge, 0, before);
    spiralAt(ribbon, s + nudge, 0, after);
    return to.subVectors(after, before).multiplyScalar(span / (3 * 2 * nudge));
  };

  // Shared joints and shared directions, so the chain of curves has no corners.
  const wobble = (joint: number) => (joint === 0 || joint === SPANS ? 0 : joint % 2 === 0 ? JOINT_WOBBLE : -JOINT_WOBBLE);
  let cursor = 0;
  for (let index = 0; index < SPANS; index += 1) {
    const start = index * span;
    const end = start + span;
    spiralAt(ribbon, start, wobble(index), p0);
    spiralAt(ribbon, end, wobble(index + 1), p3);
    p1.copy(p0).add(handle(start, tangent));
    p2.copy(p3).sub(handle(end, tangent));
    for (let step = index === 0 ? 0 : 1; step <= STEPS_PER_SPAN; step += 1) {
      const t = step / STEPS_PER_SPAN;
      curve.getPoint(t, point);
      curve.getTangent(t, tangent);
      points.set([point.x, point.y, point.z], cursor * 3);
      tangents.set([tangent.x, tangent.y, tangent.z], cursor * 3);
      cursor += 1;
    }
  }
  return { points, tangents };
}

function buildRibbonGeometry(curves: readonly { points: Float32Array; tangents: Float32Array }[]): THREE.BufferGeometry {
  const count = RIBBONS * POINTS * 2;
  const positions = new Float32Array(count * 3);
  const tangents = new Float32Array(count * 3);
  const info = new Float32Array(count * 3);
  const indices: number[] = [];
  let vertex = 0;
  curves.forEach(({ points, tangents: along }, ribbon) => {
    for (let i = 0; i < POINTS; i += 1) {
      for (const side of [-1, 1]) {
        positions.set(points.subarray(i * 3, i * 3 + 3), vertex * 3);
        tangents.set(along.subarray(i * 3, i * 3 + 3), vertex * 3);
        info.set([side, i / (POINTS - 1), ribbon / RIBBONS], vertex * 3);
        vertex += 1;
      }
      if (i < POINTS - 1) {
        const a = vertex - 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
  geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface Feet {
  x: number;
  y: number;
  z: number;
}

interface Aura {
  id: number;
  active: boolean;
  ending: boolean;
  feet: Feet | null;
  clock: number;
  emit: number;
  ribbons: THREE.Mesh;
  ground: THREE.Mesh;
  uClock: { value: number };
  uFade: { value: number };
  uPulse: { value: number };
}

export class HealRibbons {
  private readonly curves = Array.from({ length: RIBBONS }, (_, ribbon) => buildCurve(ribbon));
  private readonly ribbonGeometry = buildRibbonGeometry(this.curves);
  private readonly groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2);
  private readonly auras: Aura[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pool: ParticlePool,
  ) {
    for (let i = 0; i < MAX_AURAS; i += 1) {
      const uClock = { value: 0 };
      const uFade = { value: 0 };
      const uPulse = { value: 0 };
      const look = {
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      };
      const ribbons = new THREE.Mesh(
        this.ribbonGeometry,
        new THREE.ShaderMaterial({
          ...look,
          side: THREE.DoubleSide,
          vertexShader: RIBBON_VERTEX,
          fragmentShader: RIBBON_FRAGMENT,
          uniforms: { uClock, uFade, uPulse, uSnap: snapUniform },
        }),
      );
      const ground = new THREE.Mesh(
        this.groundGeometry,
        new THREE.ShaderMaterial({
          ...look,
          vertexShader: GROUND_VERTEX,
          fragmentShader: GROUND_FRAGMENT,
          uniforms: { uClock, uFade, uPulse },
        }),
      );
      ribbons.frustumCulled = false;
      ground.frustumCulled = false;
      ribbons.visible = false;
      ground.visible = false;
      scene.add(ribbons, ground);
      this.auras.push({ id: -1, active: false, ending: false, feet: null, clock: 0, emit: 0, ribbons, ground, uClock, uFade, uPulse });
    }
  }

  /** feet is read every frame, so the light goes where its player goes. */
  start(id: number, feet: Feet): void {
    let aura = this.find(id);
    if (!aura) {
      aura = this.auras.find((candidate) => !candidate.active);
      // A crowd all drinking at once: the rest do without. Their health still arrives.
      if (!aura) return;
      aura.clock = 0;
      aura.emit = 0;
      aura.uFade.value = 0;
      aura.uPulse.value = 0;
    }
    aura.id = id;
    aura.active = true;
    aura.ending = false;
    aura.feet = feet;
    aura.ribbons.visible = true;
    aura.ground.visible = true;
  }

  pulse(id: number): void {
    const aura = this.find(id);
    if (aura) aura.uPulse.value = 1;
  }

  end(id: number): void {
    const aura = this.find(id);
    if (aura) aura.ending = true;
  }

  private find(id: number): Aura | undefined {
    for (const aura of this.auras) {
      if (aura.active && aura.id === id) return aura;
    }
    return undefined;
  }

  update(seconds: number): void {
    for (const aura of this.auras) {
      if (!aura.active || !aura.feet) continue;
      aura.clock += seconds;
      aura.uClock.value = aura.clock;
      if (aura.clock > LONGEST_SECONDS) aura.ending = true;
      const fade = aura.uFade.value;
      if (aura.ending) {
        aura.uFade.value = fade * Math.exp(-seconds * FADE_OUT_RATE);
        if (aura.uFade.value < 0.02) {
          aura.active = false;
          aura.feet = null;
          aura.ribbons.visible = false;
          aura.ground.visible = false;
          continue;
        }
      } else {
        aura.uFade.value = fade + (1 - fade) * (1 - Math.exp(-seconds * FADE_IN_RATE));
      }
      aura.uPulse.value *= Math.exp(-seconds * PULSE_DECAY);
      const { x, y, z } = aura.feet;
      const turn = -aura.clock * TURN_RATE;
      aura.ribbons.position.set(x, y, z);
      aura.ribbons.rotation.y = turn;
      aura.ground.position.set(x, GROUND_LIFT, z);
      if (aura.ending) continue;
      aura.emit += seconds * DIGITS_PER_SECOND;
      while (aura.emit >= 1) {
        aura.emit -= 1;
        this.digit(aura, x, y, z, turn);
      }
    }
  }

  /** One digit, born on the bright part of a ribbon. */
  private digit(aura: Aura, x: number, y: number, z: number, turn: number): void {
    const ribbon = Math.floor(Math.random() * RIBBONS);
    const head = (aura.clock * FLOW_RATE + ribbon / RIBBONS) % 1;
    const along = Math.max(0.03, head - Math.random() * 0.14);
    const index = Math.round(along * (POINTS - 1)) * 3;
    const { points } = this.curves[ribbon];
    const localX = points[index];
    const localZ = points[index + 2];
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const s = this.pool.reset();
    s.face = FACE_DIGIT;
    s.ignoreFog = true;
    s.additive = 0.7;
    s.minPixels = 4;
    s.fadeOut = 0.45;
    s.x = x + localX * cos + localZ * sin;
    s.y = y + points[index + 1];
    s.z = z - localX * sin + localZ * cos;
    s.vy = 0.45;
    s.size = s.endSize = 0.055 + Math.random() * 0.025;
    s.life = 0.28 + Math.random() * 0.27;
    s.alpha = 0.95;
    const from = Math.random() < 0.25 ? DIGIT_CRIMSON : DIGIT_GOLD;
    s.r = from.r; s.g = from.g; s.b = from.b;
    s.r2 = DIGIT_DARK.r; s.g2 = DIGIT_DARK.g; s.b2 = DIGIT_DARK.b;
    this.pool.emit();
  }

  dispose(): void {
    for (const aura of this.auras) {
      this.scene.remove(aura.ribbons, aura.ground);
      (aura.ribbons.material as THREE.Material).dispose();
      (aura.ground.material as THREE.Material).dispose();
    }
    this.ribbonGeometry.dispose();
    this.groundGeometry.dispose();
  }
}
