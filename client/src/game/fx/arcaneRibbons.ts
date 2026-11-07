import * as THREE from 'three';

/*
 * Long camera-facing streaks that remember where their head has been, so a turning bolt leaves a
 * real curve. Particles can't do this: a line of them looks like beads. Every ribbon shares one
 * draw call, and the buffers are only ever rewritten in place.
 */

const MAX_RIBBONS = 36;
const POINTS = 28;
const VERTICES = POINTS * 2;
const FADE_SECONDS = 0.45;

interface Ribbon {
  active: boolean;
  /** Whether a head is still moving it. A released ribbon only fades. */
  live: boolean;
  points: Float32Array;
  head: number;
  count: number;
  /** Half the width at its widest, in meters. */
  width: number;
  /** 0 is blue and 1 is gold. */
  hue: number;
  fade: number;
  /** Meters between remembered points, which sets how long it gets. */
  spacing: number;
}

const VERTEX = /* glsl */ `
  attribute vec4 aData; // across, along, hue, fade
  varying vec4 vData;
  void main() {
    vData = aData;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec4 vData;
  void main() {
    float across = abs(vData.x);
    float along = vData.y;
    vec3 tint = mix(vec3(0.16, 0.42, 1.25), vec3(1.35, 0.78, 0.2), vData.z);
    // A soft glow around a thin bright core, both from one quad, so a trail costs one layer to draw.
    float core = exp(-across * across * 38.0);
    float glow = exp(-across * across * 3.5) * (1.0 - across);
    float life = pow(1.0 - along, 1.4) * vData.w;
    vec3 color = tint * glow * 0.55 + mix(tint, vec3(1.15, 1.12, 1.05), 0.7) * core * 1.6;
    gl_FragColor = vec4(color * life, 1.0);
  }
`;

export class ArcaneRibbons {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly positions = new Float32Array(MAX_RIBBONS * VERTICES * 3);
  private readonly data = new Float32Array(MAX_RIBBONS * VERTICES * 4);
  private readonly positionBuffer: THREE.BufferAttribute;
  private readonly dataBuffer: THREE.BufferAttribute;
  private readonly ribbons: Ribbon[] = [];
  private readonly eye = new THREE.Vector3();
  private needsClear = false;

  constructor(private readonly camera: THREE.Camera) {
    for (let i = 0; i < MAX_RIBBONS; i += 1) {
      this.ribbons.push({ active: false, live: false, points: new Float32Array(POINTS * 3), head: 0, count: 0, width: 0, hue: 0, fade: 0, spacing: 1 });
    }
    this.positionBuffer = new THREE.BufferAttribute(this.positions, 3);
    this.positionBuffer.setUsage(THREE.DynamicDrawUsage);
    this.dataBuffer = new THREE.BufferAttribute(this.data, 4);
    this.dataBuffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionBuffer);
    this.geometry.setAttribute('aData', this.dataBuffer);
    const indices = new Uint16Array(MAX_RIBBONS * (POINTS - 1) * 6);
    let o = 0;
    for (let r = 0; r < MAX_RIBBONS; r += 1) {
      for (let i = 0; i < POINTS - 1; i += 1) {
        const a = r * VERTICES + i * 2;
        indices[o++] = a; indices[o++] = a + 1; indices[o++] = a + 2;
        indices[o++] = a + 1; indices[o++] = a + 3; indices[o++] = a + 2;
      }
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
    this.mesh.visible = false;
  }

  /** Starts a ribbon at a point and returns its handle, or -1 if they're all in use, which every other call accepts. */
  open(x: number, y: number, z: number, hue: number, width: number, spacing: number): number {
    for (let i = 0; i < MAX_RIBBONS; i += 1) {
      const ribbon = this.ribbons[i];
      if (ribbon.active) continue;
      ribbon.active = true;
      ribbon.live = true;
      ribbon.hue = hue;
      ribbon.width = width;
      ribbon.spacing = spacing;
      ribbon.fade = 1;
      ribbon.head = 0;
      ribbon.count = 1;
      ribbon.points[0] = x; ribbon.points[1] = y; ribbon.points[2] = z;
      return i;
    }
    return -1;
  }

  /** Moves the head. It leaves a new point behind only once it has gone far enough from the last one. */
  move(handle: number, x: number, y: number, z: number): void {
    if (handle < 0) return;
    const ribbon = this.ribbons[handle];
    if (!ribbon.live) return;
    const { points } = ribbon;
    if (ribbon.count < 2) {
      this.advance(ribbon);
    } else {
      const last = ((ribbon.head - 1 + POINTS) % POINTS) * 3;
      const dx = x - points[last];
      const dy = y - points[last + 1];
      const dz = z - points[last + 2];
      if (dx * dx + dy * dy + dz * dz >= ribbon.spacing * ribbon.spacing) this.advance(ribbon);
    }
    const at = ribbon.head * 3;
    points[at] = x; points[at + 1] = y; points[at + 2] = z;
  }

  private advance(ribbon: Ribbon): void {
    ribbon.head = (ribbon.head + 1) % POINTS;
    ribbon.count = Math.min(POINTS, ribbon.count + 1);
  }

  /** The head has gone. What's left of the streak fades where it lies. */
  release(handle: number): void {
    if (handle >= 0) this.ribbons[handle].live = false;
  }

  update(seconds: number): void {
    let any = false;
    this.eye.setFromMatrixPosition(this.camera.matrixWorld);
    for (let i = 0; i < MAX_RIBBONS; i += 1) {
      const ribbon = this.ribbons[i];
      if (!ribbon.active) continue;
      if (!ribbon.live) {
        ribbon.fade -= seconds / FADE_SECONDS;
        if (ribbon.fade <= 0) {
          ribbon.active = false;
          // Collapses it, since nothing else would stop its last shape from being drawn.
          this.positions.fill(0, i * VERTICES * 3, (i + 1) * VERTICES * 3);
          this.needsClear = true;
          continue;
        }
      }
      any = true;
      this.write(i, ribbon);
    }
    if (any || this.needsClear) {
      this.positionBuffer.needsUpdate = true;
      this.dataBuffer.needsUpdate = true;
      this.needsClear = false;
    }
    this.mesh.visible = any;
  }

  private write(index: number, ribbon: Ribbon): void {
    const { points, head, count, width, hue, fade } = ribbon;
    const positions = this.positions;
    const data = this.data;
    const eye = this.eye;
    let p = index * VERTICES * 3;
    let d = index * VERTICES * 4;
    for (let i = 0; i < POINTS; i += 1) {
      const step = Math.min(i, count - 1);
      const at = ((head - step + POINTS) % POINTS) * 3;
      const near = ((head - Math.max(0, step - 1) + POINTS) % POINTS) * 3;
      const far = ((head - Math.min(count - 1, step + 1) + POINTS) % POINTS) * 3;
      const x = points[at];
      const y = points[at + 1];
      const z = points[at + 2];
      const tx = points[near] - points[far];
      const ty = points[near + 1] - points[far + 1];
      const tz = points[near + 2] - points[far + 2];
      const vx = eye.x - x;
      const vy = eye.y - y;
      const vz = eye.z - z;
      // Sideways across the trail as the camera sees it, so it's never seen edge-on.
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (length > 1e-5) {
        sx /= length; sy /= length; sz /= length;
      } else {
        sx = 0; sy = 1; sz = 0;
      }
      const along = i / (POINTS - 1);
      // Points past the ones it remembers collapse onto the last, which hides them.
      const half = i < count ? width * Math.pow(1 - along, 0.65) : 0;
      positions[p++] = x + sx * half; positions[p++] = y + sy * half; positions[p++] = z + sz * half;
      positions[p++] = x - sx * half; positions[p++] = y - sy * half; positions[p++] = z - sz * half;
      data[d++] = -1; data[d++] = along; data[d++] = hue; data[d++] = fade;
      data[d++] = 1; data[d++] = along; data[d++] = hue; data[d++] = fade;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
