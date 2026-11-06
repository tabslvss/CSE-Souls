import * as THREE from 'three';

/*
 * A dead body coming apart. Blocks of the mesh burn away with a hot edge, so the corpse leaves in
 * chunks of "data" instead of fading like a ghost. It works on a copy of each material, so other
 * characters sharing the original are not touched, and it adds to any PS1 patch already on them.
 * Starting one allocates a little, once. Running it only writes numbers.
 */

const VERTEX_HEAD = /* glsl */ `varying vec3 vDissolvePos;`;
const FRAGMENT_HEAD = /* glsl */ `
  uniform float uDissolve;
  uniform float uDissolveCells;
  varying vec3 vDissolvePos;
`;
const FRAGMENT_BODY = /* glsl */ `
  vec3 dissolveCell = floor(vDissolvePos * uDissolveCells);
  float dissolveEdge = fract(sin(dot(dissolveCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453) - uDissolve * 1.16;
  if (dissolveEdge < 0.0) discard;
  gl_FragColor.rgb *= 1.0 - uDissolve * 0.6;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.3, 0.34, 0.06), (1.0 - smoothstep(0.0, 0.13, dissolveEdge)) * step(0.001, uDissolve));
`;
const CELLS_ACROSS_MESH = 16;

interface Swap {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  copies: THREE.Material[];
}

interface Corpse {
  root: THREE.Object3D;
  swaps: Swap[];
  progress: { value: number };
  left: number;
  total: number;
  onDone: (() => void) | null;
}

function burning(source: THREE.Material, progress: { value: number }, cells: number): THREE.Material {
  const copy = source.clone();
  // clone() leaves these two behind, and without them the PS1 vertex snap would be lost.
  const previousCompile = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey();
  copy.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(source, shader, renderer);
    shader.uniforms.uDissolve = progress;
    shader.uniforms.uDissolveCells = { value: cells };
    shader.vertexShader = `${VERTEX_HEAD}\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvDissolvePos = position;',
    );
    shader.fragmentShader = `${FRAGMENT_HEAD}\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>\n${FRAGMENT_BODY}`,
    );
  };
  copy.customProgramCacheKey = () => `${previousKey}-dissolve`;
  return copy;
}

export class CorpseDissolver {
  private readonly corpses: Corpse[] = [];

  /** Starts burning root away over seconds. At the end root is hidden and onDone runs. */
  start(root: THREE.Object3D, seconds: number, onDone: (() => void) | null): void {
    this.restore(root);
    const progress = { value: 0 };
    const swaps: Swap[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      const longest = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z, 1e-3);
      const cells = CELLS_ACROSS_MESH / longest;
      const original = mesh.material;
      const list = Array.isArray(original) ? original : [original];
      const copies = list.map((material) => burning(material, progress, cells));
      mesh.material = Array.isArray(original) ? copies : copies[0];
      swaps.push({ mesh, original, copies });
    });
    this.corpses.push({ root, swaps, progress, left: seconds, total: Math.max(0.01, seconds), onDone });
  }

  /** Puts the real materials back and shows the body, for someone respawning partway through. */
  restore(root: THREE.Object3D): void {
    for (let i = this.corpses.length - 1; i >= 0; i -= 1) {
      if (this.corpses[i].root !== root) continue;
      this.finish(this.corpses[i]);
      this.corpses.splice(i, 1);
      root.visible = true;
    }
  }

  update(seconds: number): void {
    for (let i = this.corpses.length - 1; i >= 0; i -= 1) {
      const corpse = this.corpses[i];
      corpse.left -= seconds;
      corpse.progress.value = Math.min(1, 1 - corpse.left / corpse.total);
      if (corpse.left > 0) continue;
      this.corpses.splice(i, 1);
      this.finish(corpse);
      corpse.root.visible = false;
      corpse.onDone?.();
    }
  }

  dispose(): void {
    for (const corpse of this.corpses) this.finish(corpse);
    this.corpses.length = 0;
  }

  private finish(corpse: Corpse): void {
    for (const swap of corpse.swaps) {
      swap.mesh.material = swap.original;
      for (const copy of swap.copies) copy.dispose();
    }
  }
}
