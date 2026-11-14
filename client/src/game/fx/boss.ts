import * as THREE from 'three';
import { BOSS_MOVES, BOSS_RADIUS, type BossMoveName } from '../../../../shared/boss';
import { sound, type LoopHandle } from '../../sound';
import { ATLAS } from './atlas';
import { FACE_CAMERA, FACE_GROUND, FACE_VELOCITY, type ParticlePool, type ParticleSpec } from './particles';

/*
 * The Great Bull's warnings and effects. A warning is a flat ember shape on the ground that fills in from the
 * bull outward, and the move lands as the fill reaches its edge. Every shape has a thick soft border and a soft
 * fill, because thin lines vanish into the dither at the game's low resolution.
 * Everything comes from fixed pools. Nothing allocates per frame.
 */

function rgb(hex: string): readonly [number, number, number] {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

const WHITE_HOT = rgb('#fff1cf');
const EMBER_HOT = rgb('#ffd27a');
const EMBER = rgb('#ff7a26');
const EMBER_DEEP = rgb('#7a1e06');
const COAL = rgb('#8c2a0c');
const SMOKE = rgb('#2c2622');
const SMOKE_LIGHT = rgb('#5a5048');
const DUST = rgb('#7a6850');
const DUST_DARK = rgb('#4a3e30');
const LIGHT_EMBER = new THREE.Color('#ff8a3a');

const SPRITE = {
  glow: ATLAS.glow,
  embers: [ATLAS['ember-1'], ATLAS['ember-2'], ATLAS['ember-3']],
  smoke: [ATLAS['smoke-1'], ATLAS['smoke-2'], ATLAS['smoke-3'], ATLAS['smoke-4']],
  dust: [ATLAS['dust-1'], ATLAS['dust-2']],
  grit: ATLAS['dust-3'],
  streak: ATLAS['spark-streak'],
  line: ATLAS['slash-line'],
  wind: ATLAS['wind-streak'],
  shock: ATLAS.shockwave,
  ring: ATLAS.ring,
  smokeRing: ATLAS['smoke-ring'],
  crack: ATLAS.crack,
  impact: ATLAS['impact-1'],
};

const MAX_DECALS = 6;
const MAX_FIREBALLS = 12;
/** Warnings sit just above the ground, drawn over grass and props, since they are the warning. */
const DECAL_Y = 0.07;
const DECAL_FADE_SECONDS = 0.28;
/** A warning whose hit never arrives, as when the event is lost, gives up after this. */
const DECAL_PATIENCE = 2.5;
const FIREBALL_LOW = 1.3;
const FIREBALL_DROP = 1.8;
/** A fireball past its range with no end event from the server bursts on its own after this. */
const FIREBALL_PATIENCE = 0.4;

const SHAPE_STRIP = 0;
const SHAPE_DISC = 1;
const SHAPE_LANES = 2;
const SHAPE_RING = 3;
const SHAPE_SECTOR = 4;

function rand(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

function pick<T>(list: readonly T[]): T {
  return list[(Math.random() * list.length) | 0];
}

function paint(s: ParticleSpec, from: readonly number[], to: readonly number[]): void {
  s.r = from[0]; s.g = from[1]; s.b = from[2];
  s.r2 = to[0]; s.g2 = to[1]; s.b2 = to[2];
}

const DECAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// p is in meters with +y pointing the way the bull faces. e is how far inside the shape a point is, and along
// how far out from the bull it is, 0 to 1, which the fill compares with the progress of the windup.
const DECAL_FRAGMENT = /* glsl */ `
  uniform float uShape;
  uniform vec2 uSize;
  uniform vec4 uExtra;
  uniform float uProgress;
  uniform float uFade;
  uniform float uTime;
  varying vec2 vUv;
  const float BORDER = 0.55;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uSize;
    float e = -1.0;
    float along = 0.0;
    if (uShape < 0.5) {
      vec2 d = uSize - abs(p);
      e = min(d.x, d.y);
      along = (p.y + uSize.y) / (2.0 * uSize.y);
    } else if (uShape < 1.5) {
      float r = length(p);
      e = uSize.x - r;
      along = r / uSize.x;
    } else if (uShape < 2.5) {
      for (int k = -1; k <= 1; k++) {
        float a = float(k) * uExtra.x;
        vec2 dir = vec2(sin(a), cos(a));
        float forward = dot(p, dir);
        float side = abs(p.x * dir.y - p.y * dir.x);
        float inside = min(uExtra.y - side, min(forward, uSize.x - forward));
        if (inside > e) {
          e = inside;
          along = forward / uSize.x;
        }
      }
    } else if (uShape < 3.5) {
      float r = length(p);
      e = uSize.x - r;
      along = r / uSize.x;
      if (uExtra.z > 0.5) {
        // Racing outward: only the dangerous band, bright, over a faint memory of the edge.
        if (e < 0.0) discard;
        float band = 1.0 - smoothstep(uExtra.y * 0.55, uExtra.y, abs(r - uExtra.x));
        float rim = 1.0 - smoothstep(BORDER * 0.4, BORDER, e);
        vec3 hot = vec3(1.6, 0.75, 0.22);
        gl_FragColor = vec4(hot * (band * 1.25 + rim * 0.18) * uFade, 1.0);
        return;
      }
    } else {
      float r = length(p);
      float angle = abs(atan(p.x, p.y));
      e = min(uSize.x - r, (uExtra.x - angle) * max(r, 0.5));
      along = r / uSize.x;
    }
    if (e < 0.0) discard;
    float edge = 1.0 - smoothstep(BORDER * 0.45, BORDER, e);
    float filled = 1.0 - smoothstep(uProgress - 0.015, uProgress, along);
    float front = 1.0 - smoothstep(0.0, 0.05, abs(along - uProgress));
    float beat = 0.8 + 0.2 * sin(uTime * (6.0 + uProgress * 18.0));
    vec3 color = mix(vec3(1.0, 0.32, 0.06), vec3(1.6, 0.78, 0.25), uProgress);
    float light = edge * 0.95 + 0.07 + filled * 0.2 + front * 0.55 * step(uProgress, 0.995);
    gl_FragColor = vec4(color * light * beat * uFade, 1.0);
  }
`;

interface DecalUniforms {
  uShape: { value: number };
  uSize: { value: THREE.Vector2 };
  uExtra: { value: THREE.Vector4 };
  uProgress: { value: number };
  uFade: { value: number };
  uTime: { value: number };
}

interface Decal {
  active: boolean;
  owner: number;
  move: BossMoveName;
  age: number;
  windup: number;
  /** Seconds since the move's hit, or negative before it. */
  sinceHit: number;
  /** How long it stays once the move has hit. */
  holdSeconds: number;
  closing: number;
  /** Where the boss stood at the tell; swipe, charge and fireball warnings turn around this as it tracks. */
  originX: number;
  originZ: number;
  mesh: THREE.Mesh;
  uniforms: DecalUniforms;
}

interface Fireball {
  active: boolean;
  id: number;
  x: number; z: number;
  dirX: number; dirZ: number;
  speed: number;
  left: number;
  traveled: number;
  radius: number;
  trail: number;
  overdue: number;
  /** Its hiss in flight, which follows it until it bursts. */
  loop: LoopHandle | null;
}

export type LightAt = (x: number, y: number, z: number, color: THREE.Color, intensity: number, decay: number) => void;

export class BossFx {
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly decals: Decal[] = [];
  private readonly fireballs: Fireball[] = [];
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pool: ParticlePool,
    private readonly lightAt: LightAt,
  ) {
    for (let i = 0; i < MAX_DECALS; i += 1) {
      const uniforms: DecalUniforms = {
        uShape: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) },
        uExtra: { value: new THREE.Vector4() },
        uProgress: { value: 0 },
        uFade: { value: 0 },
        uTime: { value: 0 },
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: DECAL_VERTEX,
        fragmentShader: DECAL_FRAGMENT,
        uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      // Flattened first, then turned to the bull's facing, so the shader's +y is the way it looks.
      mesh.rotation.order = 'YXZ';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 17;
      scene.add(mesh);
      this.materials.push(material);
      this.decals.push({ active: false, owner: 0, move: 'swipe', age: 0, windup: 1, sinceHit: -1, holdSeconds: 0, closing: -1, originX: 0, originZ: 0, mesh, uniforms });
    }
    for (let i = 0; i < MAX_FIREBALLS; i += 1) {
      this.fireballs.push({ active: false, id: -1, x: 0, z: 0, dirX: 0, dirZ: 1, speed: 0, left: 0, traveled: 0, radius: 1, trail: 0, overdue: 0, loop: null });
    }
  }

  /* ---------- Warnings ---------- */

  /** A windup began: lays down the warning for this move. tx, tz is the landing point of a leap. */
  tell(owner: number, move: BossMoveName, x: number, z: number, yaw: number, tx: number, tz: number, windup: number): void {
    this.clear(owner);
    const decal = this.freeDecal();
    if (!decal) return;
    decal.active = true;
    decal.owner = owner;
    decal.move = move;
    decal.age = 0;
    decal.windup = Math.max(0.1, windup);
    decal.sinceHit = -1;
    decal.closing = -1;
    decal.originX = x;
    decal.originZ = z;
    const { mesh, uniforms } = decal;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    uniforms.uProgress.value = 0;
    uniforms.uFade.value = 1;
    uniforms.uExtra.value.set(0, 0, 0, 0);
    mesh.rotation.set(-Math.PI / 2, yaw + Math.PI, 0);
    let cx = x;
    let cz = z;
    let halfX = 1;
    let halfY = 1;
    if (move === 'charge') {
      const { length, width, speed } = BOSS_MOVES.charge;
      uniforms.uShape.value = SHAPE_STRIP;
      halfX = width / 2;
      halfY = length / 2;
      cx = x + forwardX * halfY;
      cz = z + forwardZ * halfY;
      decal.holdSeconds = length / speed;
    } else if (move === 'leap') {
      uniforms.uShape.value = SHAPE_DISC;
      halfX = halfY = BOSS_MOVES.leap.landingRadius;
      cx = tx;
      cz = tz;
      decal.holdSeconds = 0;
    } else if (move === 'fireballs') {
      const { range, spreadDegrees, radius } = BOSS_MOVES.fireballs;
      uniforms.uShape.value = SHAPE_LANES;
      halfX = halfY = range;
      uniforms.uExtra.value.set(THREE.MathUtils.degToRad(spreadDegrees), radius, 0, 0);
      // The server fires them from its mouth, 0.8 of its radius ahead, so the lanes fan out from there too.
      cx = x + forwardX * BOSS_RADIUS * 0.8;
      cz = z + forwardZ * BOSS_RADIUS * 0.8;
      decal.holdSeconds = 0.15;
    } else if (move === 'stomp') {
      const { ringMaxRadius, ringThickness, ringSpeed } = BOSS_MOVES.stomp;
      uniforms.uShape.value = SHAPE_RING;
      halfX = halfY = ringMaxRadius + ringThickness;
      uniforms.uExtra.value.set(0, ringThickness / 2, 0, 0);
      decal.holdSeconds = ringMaxRadius / ringSpeed;
    } else {
      const { reach, arcDegrees } = BOSS_MOVES.swipe;
      uniforms.uShape.value = SHAPE_SECTOR;
      halfX = halfY = reach;
      uniforms.uExtra.value.set(THREE.MathUtils.degToRad(arcDegrees / 2), 0, 0, 0);
      decal.holdSeconds = 0;
    }
    uniforms.uSize.value.set(halfX, halfY);
    mesh.scale.set(halfX, halfY, 1);
    mesh.position.set(cx, DECAL_Y, cz);
    mesh.visible = true;
  }

  /**
   * Turns this boss's aimed warning (swipe, charge, fireballs) to its current yaw. The server tracks the target
   * during a windup and stops just before the hit, so following the drawn body keeps the warning honest.
   */
  aim(owner: number, yaw: number): void {
    for (const decal of this.decals) {
      if (!decal.active || decal.owner !== owner || decal.sinceHit >= 0 || decal.closing >= 0) continue;
      if (decal.move !== 'swipe' && decal.move !== 'charge' && decal.move !== 'fireballs') continue;
      const forwardX = Math.sin(yaw);
      const forwardZ = Math.cos(yaw);
      const ahead = decal.move === 'charge' ? BOSS_MOVES.charge.length / 2 : decal.move === 'fireballs' ? BOSS_RADIUS * 0.8 : 0;
      decal.mesh.rotation.set(-Math.PI / 2, yaw + Math.PI, 0);
      decal.mesh.position.set(decal.originX + forwardX * ahead, DECAL_Y, decal.originZ + forwardZ * ahead);
    }
  }

  /** Fades out every warning of this boss, as when it dies or a reconnect forgets it. */
  clear(owner: number): void {
    for (const decal of this.decals) {
      if (decal.active && decal.owner === owner && decal.closing < 0) decal.closing = 0;
    }
  }

  /* ---------- Moves landing ---------- */

  /** A move's hit moment. Closes its warning and plays the burst of particles that goes with it. */
  hit(owner: number, move: BossMoveName, x: number, z: number, yaw: number, size: number): void {
    for (const decal of this.decals) {
      if (decal.active && decal.owner === owner && decal.move === move && decal.sinceHit < 0 && decal.closing < 0) {
        decal.sinceHit = 0;
        decal.uniforms.uProgress.value = 1;
        if (move === 'stomp') decal.uniforms.uExtra.value.z = 1;
      }
    }
    if (move === 'swipe') this.swipe(x, z, yaw, size);
    else if (move === 'charge') this.chargeStart(x, z, yaw, size);
    else if (move === 'leap') this.landing(x, z, size);
    else if (move === 'stomp') this.stomp(x, z, size);
  }

  /** A wide burning arc in front of it, swept across, with dust kicked off the ground under it. */
  private swipe(x: number, z: number, yaw: number, size: number): void {
    const { reach, arcDegrees } = BOSS_MOVES.swipe;
    const half = THREE.MathUtils.degToRad(arcDegrees / 2);
    const s = this.pool.reset();
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.line;
    s.additive = 1;
    s.ignoreFog = true;
    s.fadeOut = 0.3;
    const count = 18;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      // Right to left across its face, in order, so it reads as one sweep.
      const angle = yaw + half - t * half * 2;
      const radius = reach * rand(0.62, 0.82);
      s.x = x + Math.sin(angle) * radius;
      s.z = z + Math.cos(angle) * radius;
      s.y = size * rand(0.32, 0.5);
      // Along the arc, the way the horns travel.
      s.vx = -Math.cos(angle) * 9;
      s.vz = Math.sin(angle) * 9;
      s.vy = 0;
      s.drag = 6;
      s.delay = t * 0.12;
      s.size = 0.5;
      s.endSize = 0.25;
      s.aspect = 7;
      s.life = 0.26;
      s.alpha = 0.95;
      paint(s, EMBER_HOT, EMBER_DEEP);
      this.pool.emit();
      s.size = 0.9;
      s.endSize = 0.5;
      s.aspect = 4;
      s.life = 0.42;
      s.alpha = 0.4;
      paint(s, EMBER, COAL);
      this.pool.emit();
    }
    this.embers(x + Math.sin(yaw) * reach * 0.6, z + Math.cos(yaw) * reach * 0.6, reach * 0.6, size * 0.4, 18);
    this.dustRing(x + Math.sin(yaw) * reach * 0.55, z + Math.cos(yaw) * reach * 0.55, reach * 0.5, 10, 1.6, 2.2);
    this.lightAt(x + Math.sin(yaw) * reach * 0.6, size * 0.45, z + Math.cos(yaw) * reach * 0.6, LIGHT_EMBER, 9, 9);
  }

  /** It breaks into a run: a cloud thrown back from its hooves. */
  private chargeStart(x: number, z: number, yaw: number, size: number): void {
    this.dustRing(x - Math.sin(yaw) * size * 0.4, z - Math.cos(yaw) * size * 0.4, size * 0.5, 14, 2.8, 2.6);
    this.shockRing(x, z, size * 0.5, size * 2.2, 0.35, 0.5);
  }

  /** Call every frame while it charges: a dust wake, wind past its flanks and sparks off its hooves. */
  chargeTrail(x: number, z: number, yaw: number, size: number, everyHalf: boolean): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const sideX = forwardZ;
    const sideZ = -forwardX;
    const s = this.pool.reset();
    s.fadeIn = 0.08;
    s.fadeOut = 0.3;
    s.drag = 2.6;
    s.gravity = -0.2;
    for (let i = 0; i < 2; i += 1) {
      const side = rand(-0.45, 0.45) * size;
      s.sprite = pick(SPRITE.dust);
      s.x = x - forwardX * size * 0.45 + sideX * side;
      s.z = z - forwardZ * size * 0.45 + sideZ * side;
      s.y = rand(0.3, 0.8);
      s.vx = -forwardX * rand(1, 3) + sideX * side * 0.4;
      s.vz = -forwardZ * rand(1, 3) + sideZ * side * 0.4;
      s.vy = rand(0.3, 1);
      s.size = rand(1.2, 1.9);
      s.endSize = s.size * 2.6;
      s.rotation = rand(0, 6.28);
      s.life = rand(0.9, 1.5);
      s.alpha = rand(0.28, 0.42);
      paint(s, DUST, DUST_DARK);
      this.pool.emit();
    }
    if (!everyHalf) return;
    // Streaks of air sliding back along both flanks.
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.wind;
    s.additive = 1;
    s.gravity = 0;
    s.drag = 1;
    s.fadeIn = 0.1;
    s.fadeOut = 0.4;
    for (let i = 0; i < 2; i += 1) {
      const side = (i === 0 ? 1 : -1) * size * rand(0.35, 0.6);
      s.x = x + forwardX * size * 0.3 + sideX * side;
      s.z = z + forwardZ * size * 0.3 + sideZ * side;
      s.y = size * rand(0.2, 0.55);
      s.vx = -forwardX * 14;
      s.vz = -forwardZ * 14;
      s.vy = 0;
      s.size = 0.16;
      s.endSize = 0.1;
      s.aspect = 14;
      s.life = 0.28;
      s.alpha = 0.35;
      paint(s, SMOKE_LIGHT, SMOKE);
      this.pool.emit();
    }
    // Sparks where the hooves strike.
    s.sprite = SPRITE.streak;
    s.ignoreFog = true;
    s.gravity = 9;
    s.drag = 2.4;
    s.fadeIn = 0;
    s.fadeOut = 0.45;
    s.minPixels = 1;
    for (let i = 0; i < 3; i += 1) {
      const side = rand(-0.35, 0.35) * size;
      s.x = x + forwardX * size * rand(-0.3, 0.3) + sideX * side;
      s.z = z + forwardZ * size * rand(-0.3, 0.3) + sideZ * side;
      s.y = 0.15;
      s.vx = -forwardX * rand(2, 5) + rand(-1.5, 1.5);
      s.vz = -forwardZ * rand(2, 5) + rand(-1.5, 1.5);
      s.vy = rand(1.5, 4);
      s.size = 0.06;
      s.endSize = 0.03;
      s.aspect = 7;
      s.life = rand(0.25, 0.5);
      s.alpha = 1;
      paint(s, EMBER_HOT, COAL);
      this.pool.emit();
    }
  }

  /** The charge ran into something solid. */
  wallBurst(x: number, z: number, yaw: number, size: number): void {
    const fx = x + Math.sin(yaw) * size * 0.5;
    const fz = z + Math.cos(yaw) * size * 0.5;
    this.dustRing(fx, fz, size * 0.4, 16, 4, 3);
    this.debris(fx, fz, size * 0.3, 18, 6);
    this.sparkBurst(fx, size * 0.35, fz, 22, 9);
    this.flash(fx, size * 0.35, fz, size * 0.6, 0.12);
    this.lightAt(fx, size * 0.4, fz, LIGHT_EMBER, 12, 6);
  }

  /** It leaves the ground for a leap. */
  takeOff(x: number, z: number, size: number): void {
    this.dustRing(x, z, size * 0.5, 16, 3.4, 2.8);
    this.debris(x, z, size * 0.4, 8, 4);
  }

  /** It comes down from a leap: the biggest thing it does. */
  private landing(x: number, z: number, size: number): void {
    const radius = BOSS_MOVES.leap.landingRadius;
    this.flash(x, 1.2, z, radius * 1.2, 0.16);
    this.shockRing(x, z, radius * 0.3, radius * 2.6, 0.45, 1);
    this.shockRing(x, z, radius * 0.2, radius * 3.4, 0.6, 0.55);
    this.scorch(x, z, radius * 1.5, 3.4);
    this.dustRing(x, z, radius * 0.7, 26, 6.5, 3.4);
    this.debris(x, z, radius * 0.6, 34, 9);
    this.embers(x, z, radius, 0.2, 46);
    this.sparkBurst(x, 0.4, z, 26, 10);
    this.lightAt(x, size * 0.5, z, LIGHT_EMBER, 22, 3);
  }

  /** The stomp's ring, as fire and dust running outward at exactly the speed of the dangerous band. */
  private stomp(x: number, z: number, size: number): void {
    const { ringMaxRadius, ringSpeed } = BOSS_MOVES.stomp;
    const life = ringMaxRadius / ringSpeed;
    this.flash(x, 1, z, size * 0.8, 0.14);
    this.scorch(x, z, size * 1.1, 2.6);
    this.shockRing(x, z, size * 0.3, size * 1.6, 0.4, 0.8);
    const s = this.pool.reset();
    const count = 44;
    s.fadeIn = 0.05;
    s.fadeOut = 0.6;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * 6.283 + rand(-0.05, 0.05);
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      // Fire on the band.
      s.sprite = i % 3 === 0 ? SPRITE.glow : pick(SPRITE.embers);
      s.additive = 1;
      s.ignoreFog = true;
      s.x = x + dirX * 0.8;
      s.z = z + dirZ * 0.8;
      s.y = rand(0.25, 0.7);
      s.vx = dirX * ringSpeed;
      s.vz = dirZ * ringSpeed;
      s.vy = rand(0, 0.3);
      s.drag = 0;
      s.gravity = 0;
      s.size = rand(0.7, 1.1);
      s.endSize = 0.35;
      s.rotation = rand(0, 6.28);
      s.life = life;
      s.alpha = 0.9;
      paint(s, EMBER_HOT, EMBER_DEEP);
      this.pool.emit();
      // Dust thrown up behind it, which covers rather than glows.
      if (i % 2 === 0) {
        s.sprite = pick(SPRITE.dust);
        s.additive = 0;
        s.ignoreFog = false;
        s.y = rand(0.4, 1);
        s.vx = dirX * ringSpeed * 0.94;
        s.vz = dirZ * ringSpeed * 0.94;
        s.vy = rand(0.2, 0.8);
        s.size = rand(1.1, 1.6);
        s.endSize = s.size * 1.8;
        s.alpha = 0.34;
        paint(s, DUST, DUST_DARK);
        this.pool.emit();
      }
    }
    this.lightAt(x, size * 0.4, z, LIGHT_EMBER, 16, 3);
  }

  /** The snort before the fireballs fly: a puff of fire and smoke from the nose. */
  snort(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.flash(x, y, z, 1.6, 0.1);
    const s = this.pool.reset();
    s.fadeIn = 0.04;
    s.fadeOut = 0.4;
    s.drag = 2.4;
    for (let i = 0; i < 10; i += 1) {
      s.sprite = i < 5 ? pick(SPRITE.embers) : pick(SPRITE.smoke);
      s.additive = i < 5 ? 1 : 0;
      s.ignoreFog = i < 5;
      s.x = x; s.y = y; s.z = z;
      s.vx = dirX * rand(3, 7) + rand(-1, 1);
      s.vz = dirZ * rand(3, 7) + rand(-1, 1);
      s.vy = rand(0.2, 1.4);
      s.gravity = i < 5 ? 1.5 : -0.4;
      s.size = i < 5 ? rand(0.2, 0.35) : rand(0.8, 1.2);
      s.endSize = i < 5 ? 0.05 : s.size * 2.4;
      s.rotation = rand(0, 6.28);
      s.life = i < 5 ? rand(0.4, 0.8) : rand(0.9, 1.5);
      s.alpha = i < 5 ? 1 : 0.4;
      if (i < 5) paint(s, EMBER_HOT, COAL);
      else paint(s, SMOKE_LIGHT, SMOKE);
      this.pool.emit();
    }
    this.lightAt(x, y, z, LIGHT_EMBER, 8, 8);
  }

  /* ---------- Fireballs ---------- */

  shot(id: number, x: number, z: number, yaw: number, speed: number, range: number, radius: number): void {
    let slot: Fireball | null = null;
    for (const fireball of this.fireballs) {
      if (!fireball.active) {
        slot = fireball;
        break;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.id = id;
    slot.x = x;
    slot.z = z;
    slot.dirX = Math.sin(yaw);
    slot.dirZ = Math.cos(yaw);
    slot.speed = speed;
    slot.left = range;
    slot.traveled = 0;
    slot.radius = radius;
    slot.trail = 0;
    slot.overdue = 0;
    slot.loop?.stop(0.05);
    slot.loop = sound.startLoop('boss-fireball-fly', { x, z });
  }

  /** Puts a fireball out: its hiss fades quickly, under the burst. */
  private endFireball(f: Fireball): void {
    f.active = false;
    f.loop?.stop(0.12);
    f.loop = null;
  }

  /** The server says where it ended, which wins over where it was drawn. */
  shotEnd(id: number, x: number, z: number): void {
    for (const fireball of this.fireballs) {
      if (fireball.active && fireball.id === id) {
        this.endFireball(fireball);
        this.burst(x, this.fireballHeight(fireball.traveled), z, fireball.radius);
        return;
      }
    }
    this.burst(x, FIREBALL_LOW, z, 1);
  }

  private fireballHeight(traveled: number): number {
    // Leaves the mouth high and sinks to body height, where it can hit someone.
    return FIREBALL_LOW + FIREBALL_DROP * Math.exp(-traveled / 3);
  }

  private stepFireball(f: Fireball, seconds: number): void {
    if (f.left > 0) {
      const step = Math.min(f.left, f.speed * seconds);
      f.x += f.dirX * step;
      f.z += f.dirZ * step;
      f.left -= step;
      f.traveled += step;
    } else {
      f.overdue += seconds;
      if (f.overdue > FIREBALL_PATIENCE) {
        this.endFireball(f);
        this.burst(f.x, this.fireballHeight(f.traveled), f.z, f.radius);
        return;
      }
    }
    f.loop?.setPosition(f.x, f.z);
    const y = this.fireballHeight(f.traveled);
    const size = f.radius;
    const s = this.pool.reset();
    s.x = f.x; s.y = y; s.z = f.z;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 3;
    // The core: drawn fresh each frame and gone by the next, so it moves without being tracked.
    s.sprite = SPRITE.glow;
    s.size = size * 1.5;
    s.endSize = size * 1.3;
    s.life = 0.06;
    s.fadeOut = 0.5;
    s.alpha = 1;
    paint(s, WHITE_HOT, EMBER);
    this.pool.emit();
    s.size = size * 2.6;
    s.endSize = size * 2.2;
    s.alpha = 0.35;
    paint(s, EMBER, EMBER_DEEP);
    this.pool.emit();
    f.trail -= seconds;
    if (f.trail > 0) return;
    f.trail = 0.035;
    s.minPixels = 1;
    s.sprite = pick(SPRITE.embers);
    s.x = f.x + rand(-0.3, 0.3) * size; s.y = y + rand(-0.3, 0.3) * size; s.z = f.z + rand(-0.3, 0.3) * size;
    s.vx = -f.dirX * rand(0.5, 2) + rand(-0.6, 0.6);
    s.vz = -f.dirZ * rand(0.5, 2) + rand(-0.6, 0.6);
    s.vy = rand(0.2, 1.2);
    s.gravity = -0.4;
    s.drag = 1.5;
    s.size = rand(0.12, 0.24);
    s.endSize = 0.03;
    s.rotation = rand(0, 6.28);
    s.life = rand(0.5, 0.9);
    s.alpha = 1;
    paint(s, EMBER_HOT, COAL);
    this.pool.emit();
    s.sprite = pick(SPRITE.smoke);
    s.additive = 0;
    s.ignoreFog = false;
    s.x = f.x - f.dirX * size * 0.6; s.y = y; s.z = f.z - f.dirZ * size * 0.6;
    s.vx = rand(-0.3, 0.3);
    s.vz = rand(-0.3, 0.3);
    s.vy = rand(0.3, 0.8);
    s.gravity = -0.3;
    s.drag = 1.2;
    s.size = size * rand(0.7, 1);
    s.endSize = s.size * 2.4;
    s.life = rand(0.8, 1.3);
    s.alpha = 0.3;
    s.fadeIn = 0.08;
    paint(s, SMOKE_LIGHT, SMOKE);
    this.pool.emit();
  }

  /** A fireball bursting, with a scorch left glowing on the ground under it. */
  private burst(x: number, y: number, z: number, radius: number): void {
    this.flash(x, y, z, radius * 2.4, 0.12);
    const s = this.pool.reset();
    s.x = x; s.y = y; s.z = z;
    s.sprite = SPRITE.impact;
    s.additive = 1;
    s.ignoreFog = true;
    s.size = radius * 1.2;
    s.endSize = radius * 3;
    s.rotation = rand(0, 6.28);
    s.life = 0.16;
    s.alpha = 0.8;
    paint(s, EMBER_HOT, COAL);
    this.pool.emit();
    this.sparkBurst(x, y, z, 18, 8);
    this.embers(x, z, radius * 1.2, y - 0.5, 14);
    this.scorch(x, z, radius * 1.6, 2.2);
    s.sprite = pick(SPRITE.smoke);
    s.additive = 0;
    s.ignoreFog = false;
    s.fadeIn = 0.06;
    s.fadeOut = 0.4;
    s.gravity = -0.4;
    s.drag = 1.4;
    for (let i = 0; i < 5; i += 1) {
      s.x = x + rand(-0.5, 0.5); s.y = y + rand(-0.2, 0.4); s.z = z + rand(-0.5, 0.5);
      s.vx = rand(-0.8, 0.8);
      s.vz = rand(-0.8, 0.8);
      s.vy = rand(0.4, 1.2);
      s.size = radius * rand(0.9, 1.3);
      s.endSize = s.size * 2.2;
      s.rotation = rand(0, 6.28);
      s.life = rand(1, 1.7);
      s.alpha = 0.32;
      paint(s, SMOKE_LIGHT, SMOKE);
      this.pool.emit();
    }
    this.lightAt(x, y, z, LIGHT_EMBER, 10, 7);
  }

  /* ---------- While it lives and dies ---------- */

  /** Smoke and a spark or two from the nostrils. */
  breath(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const s = this.pool.reset();
    s.fadeIn = 0.1;
    s.fadeOut = 0.35;
    s.drag = 2;
    s.gravity = -0.35;
    for (let i = 0; i < 2; i += 1) {
      s.sprite = pick(SPRITE.smoke);
      s.x = x + rand(-0.15, 0.15); s.y = y; s.z = z + rand(-0.15, 0.15);
      s.vx = dirX * rand(0.8, 1.6);
      s.vz = dirZ * rand(0.8, 1.6);
      s.vy = rand(-0.2, 0.2);
      s.size = rand(0.35, 0.55);
      s.endSize = s.size * 3;
      s.rotation = rand(0, 6.28);
      s.life = rand(0.9, 1.4);
      s.alpha = 0.26;
      paint(s, SMOKE_LIGHT, SMOKE);
      this.pool.emit();
    }
    s.sprite = pick(SPRITE.embers);
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.vx = dirX * rand(1, 2);
    s.vz = dirZ * rand(1, 2);
    s.vy = rand(0.2, 0.8);
    s.size = rand(0.07, 0.12);
    s.endSize = 0.02;
    s.life = rand(0.6, 1.1);
    s.alpha = 1;
    paint(s, EMBER_HOT, COAL);
    this.pool.emit();
  }

  /** One heavy hoof coming down. */
  hoof(x: number, z: number, size: number): void {
    const s = this.pool.reset();
    s.fadeIn = 0.08;
    s.fadeOut = 0.25;
    s.drag = 3;
    s.gravity = -0.12;
    for (let i = 0; i < 3; i += 1) {
      const angle = rand(0, 6.283);
      s.sprite = pick(SPRITE.dust);
      s.x = x + Math.sin(angle) * 0.2; s.y = rand(0.15, 0.35); s.z = z + Math.cos(angle) * 0.2;
      s.vx = Math.sin(angle) * rand(0.6, 1.4);
      s.vz = Math.cos(angle) * rand(0.6, 1.4);
      s.vy = rand(0.1, 0.4);
      s.size = rand(0.5, 0.8) * size * 0.3;
      s.endSize = s.size * 2.4;
      s.rotation = rand(0, 6.28);
      s.life = rand(0.8, 1.3);
      s.alpha = 0.3;
      paint(s, DUST, DUST_DARK);
      this.pool.emit();
    }
  }

  /** Embers lifting off the body as it goes down. Called a few times over the collapse. */
  dying(x: number, z: number, size: number): void {
    this.embers(x, z, size * 0.7, size * 0.25, 10);
  }

  /** As the body burns away. */
  deathBurst(x: number, z: number, size: number): void {
    this.dustRing(x, z, size * 0.6, 18, 2.4, 3.2);
    this.embers(x, z, size, 0.3, 40);
  }

  /* ---------- Pieces ---------- */

  private flash(x: number, y: number, z: number, size: number, life: number): void {
    const s = this.pool.reset();
    s.x = x; s.y = y; s.z = z;
    s.sprite = SPRITE.glow;
    s.additive = 1;
    s.ignoreFog = true;
    s.size = size * 0.5;
    s.endSize = size;
    s.life = life;
    s.fadeOut = 0.2;
    s.alpha = 1;
    paint(s, WHITE_HOT, EMBER);
    this.pool.emit();
  }

  /** Flat rings racing out along the ground. */
  private shockRing(x: number, z: number, from: number, to: number, life: number, alpha: number): void {
    const s = this.pool.reset();
    s.face = FACE_GROUND;
    s.sprite = SPRITE.shock;
    s.additive = 1;
    s.ignoreFog = true;
    s.x = x; s.y = 0.12; s.z = z;
    s.size = from;
    s.endSize = to;
    s.life = life;
    s.fadeOut = 0.2;
    s.alpha = alpha;
    paint(s, EMBER_HOT, EMBER_DEEP);
    this.pool.emit();
    // A darker bank of dust under the light, or the light has nothing to stand out against.
    s.sprite = SPRITE.smokeRing;
    s.additive = 0;
    s.ignoreFog = false;
    s.y = 0.3;
    s.size = from * 1.2;
    s.endSize = to * 1.1;
    s.life = life * 3;
    s.fadeIn = 0.04;
    s.fadeOut = 0.3;
    s.alpha = alpha * 0.45;
    paint(s, DUST, DUST_DARK);
    this.pool.emit();
  }

  private scorch(x: number, z: number, size: number, life: number): void {
    const s = this.pool.reset();
    s.face = FACE_GROUND;
    s.sprite = SPRITE.crack;
    s.additive = 1;
    s.x = x; s.y = 0.06; s.z = z;
    s.size = s.endSize = size;
    s.rotation = rand(0, 6.283);
    s.life = life;
    s.fadeOut = 0.3;
    s.alpha = 0.8;
    paint(s, EMBER_HOT, EMBER_DEEP);
    this.pool.emit();
    s.sprite = SPRITE.glow;
    s.size = size * 1.3;
    s.endSize = size * 0.8;
    s.alpha = 0.35;
    paint(s, EMBER, COAL);
    this.pool.emit();
  }

  private dustRing(x: number, z: number, radius: number, count: number, speed: number, scale: number): void {
    const s = this.pool.reset();
    s.fadeIn = 0.06;
    s.fadeOut = 0.3;
    s.drag = 2.2;
    s.gravity = -0.15;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * 6.283 + rand(-0.2, 0.2);
      s.sprite = pick(SPRITE.dust);
      s.x = x + Math.cos(angle) * radius * 0.4;
      s.y = rand(0.3, 0.9);
      s.z = z + Math.sin(angle) * radius * 0.4;
      s.vx = Math.cos(angle) * speed * rand(0.6, 1.1);
      s.vz = Math.sin(angle) * speed * rand(0.6, 1.1);
      s.vy = rand(0.2, 1);
      s.size = rand(0.6, 0.9) * scale * 0.5;
      s.endSize = s.size * rand(2, 2.8);
      s.rotation = rand(0, 6.28);
      s.life = rand(1.1, 1.9);
      s.alpha = rand(0.28, 0.4);
      paint(s, DUST, DUST_DARK);
      this.pool.emit();
    }
  }

  /** Clods of earth thrown up and falling back. */
  private debris(x: number, z: number, radius: number, count: number, speed: number): void {
    const s = this.pool.reset();
    s.sprite = SPRITE.grit;
    s.gravity = 16;
    s.drag = 0.6;
    s.fadeOut = 0.7;
    s.minPixels = 1;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      s.x = x + Math.cos(angle) * radius * rand(0, 1);
      s.y = rand(0.2, 0.6);
      s.z = z + Math.sin(angle) * radius * rand(0, 1);
      s.vx = Math.cos(angle) * speed * rand(0.3, 1);
      s.vz = Math.sin(angle) * speed * rand(0.3, 1);
      s.vy = rand(4, 9);
      s.size = rand(0.18, 0.4);
      s.endSize = s.size * 0.8;
      s.rotation = rand(0, 6.28);
      s.spin = rand(-6, 6);
      s.life = rand(0.8, 1.3);
      s.alpha = 1;
      paint(s, DUST_DARK, SMOKE);
      this.pool.emit();
    }
  }

  private sparkBurst(x: number, y: number, z: number, count: number, speed: number): void {
    const s = this.pool.reset();
    s.face = FACE_VELOCITY;
    s.sprite = SPRITE.streak;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.gravity = 9;
    s.drag = 2.4;
    s.fadeOut = 0.45;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      const pace = rand(0.4, 1) * speed;
      s.x = x; s.y = y; s.z = z;
      s.vx = Math.cos(angle) * pace;
      s.vz = Math.sin(angle) * pace;
      s.vy = rand(1, 5);
      s.size = rand(0.05, 0.09);
      s.endSize = s.size * 0.5;
      s.aspect = rand(5, 9);
      s.life = rand(0.3, 0.7);
      s.alpha = 1;
      paint(s, EMBER_HOT, COAL);
      this.pool.emit();
    }
  }

  /** Slow rising sparks over an area, which outlast everything else. */
  private embers(x: number, z: number, radius: number, ground: number, count: number): void {
    const s = this.pool.reset();
    s.face = FACE_CAMERA;
    s.additive = 1;
    s.ignoreFog = true;
    s.minPixels = 1;
    s.fadeIn = 0.06;
    s.fadeOut = 0.55;
    s.gravity = -0.4;
    s.drag = 1.1;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, 6.283);
      const far = Math.sqrt(Math.random()) * radius;
      s.sprite = pick(SPRITE.embers);
      s.x = x + Math.cos(angle) * far;
      s.y = ground + rand(0.1, 1.2);
      s.z = z + Math.sin(angle) * far;
      s.vx = Math.cos(angle) * rand(0, 1.6);
      s.vy = rand(0.4, 2.2);
      s.vz = Math.sin(angle) * rand(0, 1.6);
      s.size = rand(0.07, 0.14);
      s.endSize = 0.02;
      s.extra = rand(0.2, 0.6);
      s.rotation = rand(0, 6.283);
      s.life = rand(1.4, 3.2);
      s.alpha = 1;
      paint(s, Math.random() < 0.35 ? EMBER_HOT : EMBER, COAL);
      this.pool.emit();
    }
  }

  private freeDecal(): Decal | null {
    for (const decal of this.decals) if (!decal.active) return decal;
    return null;
  }

  private closeDecal(decal: Decal): void {
    decal.active = false;
    decal.mesh.visible = false;
    decal.uniforms.uFade.value = 0;
  }

  private stepDecal(decal: Decal, seconds: number): void {
    const { uniforms } = decal;
    decal.age += seconds;
    uniforms.uTime.value = this.clock;
    if (decal.closing >= 0) {
      decal.closing += seconds;
      uniforms.uFade.value = Math.max(0, 1 - decal.closing / DECAL_FADE_SECONDS);
      if (decal.closing >= DECAL_FADE_SECONDS) this.closeDecal(decal);
      return;
    }
    if (decal.sinceHit < 0) {
      uniforms.uProgress.value = Math.min(1, decal.age / decal.windup);
      if (decal.age > decal.windup + DECAL_PATIENCE) decal.closing = 0;
      return;
    }
    decal.sinceHit += seconds;
    if (decal.move === 'stomp') {
      const { ringSpeed, ringMaxRadius } = BOSS_MOVES.stomp;
      uniforms.uExtra.value.x = Math.min(ringMaxRadius, ringSpeed * decal.sinceHit);
    }
    if (decal.sinceHit >= decal.holdSeconds) decal.closing = 0;
  }

  update(seconds: number): void {
    this.clock += seconds;
    for (const decal of this.decals) if (decal.active) this.stepDecal(decal, seconds);
    for (const fireball of this.fireballs) if (fireball.active) this.stepFireball(fireball, seconds);
  }

  dispose(): void {
    for (const fireball of this.fireballs) if (fireball.active) this.endFireball(fireball);
    for (const decal of this.decals) this.scene.remove(decal.mesh);
    for (const material of this.materials) material.dispose();
    this.geometry.dispose();
  }
}
