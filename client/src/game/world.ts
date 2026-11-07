import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP } from '../../../shared/mapData';
import type { MapGrace } from '../../../shared/mapTypes';
import { citadelPath, ridgePath, seededRandom, type Rgb } from '../scene/psx';
import { skyAt, worldPhase } from '../scene/worldClock';
import { ATLAS, type AtlasSprite } from './fx/atlas';
import { applyVertexSnap, makeTextureCrunchy } from './psxRenderer';

/*
 * The world's picture. Nothing here affects play: walls and chests that block or reward live in
 * shared/mapData.ts and the server. The heavy parts (models, ground mask) load after the first
 * frame, and `ready` says when they are done.
 */

const WHITE = new THREE.Color(0xffffff);
const SKY_RADIUS = 400;
const CHUNK = 16;
/** Pieces inside this rectangle are the citadel. Past their reach, the simple core stands in for them. */
const CASTLE_REACH = 100;
const CASTLE_UPPER_REACH = 55;
const CASTLE_RECT = { minX: -112, maxX: 112, minZ: -200, maxZ: -88 };
const LIGHT_COUNT = 3;
const LIGHT_REACH = 30;

function toColor(rgb: Rgb): THREE.Color {
  return new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Hard pixels for a texture still loading, which must not be marked as ready to upload yet. */
function setCrunchy(texture: THREE.Texture): void {
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
}

/* ---------- Materials ---------- */

/** Uniforms every world material shares, so a single write updates them all. */
const windTime = { value: 0 };

interface LookOptions {
  /** Meters of sway per meter of height. 0 means it doesn't move. */
  wind?: number;
  /** Lights both sides of a leaf the same, which removes black undersides on foliage. */
  sameBothSides?: boolean;
  /** Fog never quite hides this, so distant landmarks stay as hazy silhouettes. */
  fogCap?: { value: number };
}

function applyLook(material: THREE.Material, { wind = 0, sameBothSides = false, fogCap }: LookOptions): void {
  applyVertexSnap(material);
  const snap = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    snap.call(material, shader, renderer);
    if (wind > 0) {
      shader.uniforms.uTime = windTime;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float windSeed = instanceMatrix[3][0] * 0.13 + instanceMatrix[3][2] * 0.17;
         #else
           float windSeed = 0.0;
         #endif
         float windBend = position.y * ${wind.toFixed(4)};
         transformed.x += (sin(uTime * 1.3 + windSeed + position.y * 0.5) + 0.4 * sin(uTime * 3.1 + position.x * 2.0)) * windBend;
         transformed.z += cos(uTime * 1.05 + windSeed * 1.3 + position.z * 1.5) * windBend * 0.7;`,
      );
    }
    if (sameBothSides) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = 1.0;
         vec3 normal = normalize(vNormal);
         vec3 nonPerturbedNormal = normal;`,
      );
    }
    if (fogCap) {
      shader.uniforms.uFogCap = fogCap;
      shader.fragmentShader = `uniform float uFogCap;\n${shader.fragmentShader}`.replace(
        '#include <fog_fragment>',
        `gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, min(uFogCap, smoothstep(fogNear, fogFar, vFogDepth)));`,
      );
    }
  };
  material.customProgramCacheKey = () => `world-${wind}-${sameBothSides}-${fogCap ? 1 : 0}`;
}

/** Foliage cards light as a round mass, not as flat cards, or half of them go black. */
function roundFoliageNormals(geometry: THREE.BufferGeometry, upward: number): void {
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    n.set(position.getX(i) - center.x, (position.getY(i) - center.y) * 0.6, position.getZ(i) - center.z).normalize();
    n.y += upward;
    n.normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
}

/** Material colors kept close to the textures, but graded toward the world's mood by name. */
const GRADE: Record<string, [number, number, number]> = {
  stone: [1.25, 1.18, 1.05],
  statue: [1.05, 1, 0.92],
  banner_gold: [0.72, 0.62, 0.42],
  banner_crimson: [1.05, 0.8, 0.75],
  gold: [1.5, 1.3, 0.9],
  leaf_moss: [0.82, 0.86, 0.62],
  leaf_pine: [0.8, 0.86, 0.72],
  leaf_blood: [1, 0.72, 0.6],
  bark_gradient: [1.1, 1, 0.9],
  bark_twisted: [1, 0.95, 0.85],
  bark_normal: [0.9, 0.85, 0.78],
  rock: [1.35, 1.3, 1.2],
  grass: [1, 1, 1],
};
const FOLIAGE = new Set(['leaf_moss', 'leaf_blood', 'leaf_pine']);
const LOW_PLANT = new Set(['grass', 'leaf_plant', 'plant_psx_fern', 'plant_psx_small']);

function convertMaterial(source: THREE.MeshStandardMaterial, fogCap: { value: number } | undefined): THREE.MeshLambertMaterial {
  const name = source.name;
  const foliage = FOLIAGE.has(name);
  const plant = LOW_PLANT.has(name);
  const material = new THREE.MeshLambertMaterial({
    map: source.map,
    color: source.color.clone(),
    alphaTest: source.alphaTest,
    side: foliage || plant || source.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = name;
  const grade = GRADE[name];
  if (grade) material.color.multiply(new THREE.Color(grade[0], grade[1], grade[2]));
  if (material.map) makeTextureCrunchy(material.map);
  if (name === 'ember') {
    material.emissive.copy(source.emissive);
    material.emissiveIntensity = source.emissiveIntensity;
  }
  // Instance colors tint plants by zone, so their base color stays neutral.
  applyLook(material, {
    wind: foliage ? 0.009 : plant ? 0.09 : 0,
    sameBothSides: foliage || plant || name.startsWith('banner'),
    fogCap,
  });
  return material;
}

/* ---------- Instanced, culled props ---------- */

interface PropChunk {
  start: number;
  count: number;
  sphere: THREE.Sphere;
}

/** Every copy of one model, sorted by map chunk so the visible ones can be copied out as ranges. */
interface PropSet {
  meshes: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>[];
  matrices: Float32Array;
  colors: Float32Array;
  chunks: PropChunk[];
  reach: number;
  /** Castle pieces are drawn past the fog's limit, as silhouettes in the haze. */
  castle: boolean;
  /** Which chunks went into the buffers last time, so an unchanged view uploads nothing. */
  shown: Int32Array;
  shownCount: number;
}

/** Past this distance a small thing just isn't drawn, whatever the fog is doing. */
function reachOf(node: string, castle: boolean, upper: boolean): number {
  if (castle) return upper ? CASTLE_UPPER_REACH : CASTLE_REACH;
  if (/^(grass|mushroom|rock_small)/.test(node)) return 38;
  if (/^(fern|plant|rocks_|skull)/.test(node)) return 58;
  if (/^(bush|barrel|crate|rubble|candle|torch|log|stump)/.test(node)) return 76;
  return 140;
}

/** Tints plants by where they grow, with some scatter so a field isn't one flat color. */
function plantTint(node: string, x: number, z: number, target: THREE.Color, random: () => number): void {
  const jitter = 0.82 + random() * 0.36;
  const isPlant = /^(grass|fern|plant)/.test(node);
  if (!isPlant) {
    const tree = /^(tree|bush)/.test(node);
    // The two blood trees are landmarks, and at full strength they read as a cheerful autumn.
    const value = node === 'tree_twisted_blood' ? 0.5 : tree ? 0.8 + random() * 0.4 : 0.9 + random() * 0.2;
    target.setRGB(value, value * (0.97 + random() * 0.05), value * (0.92 + random() * 0.08));
    return;
  }
  if (z > 112) {
    // Dead gold, in drifting patches.
    const patch = 0.5 + 0.5 * Math.sin(x * 0.09 + Math.sin(z * 0.07) * 2);
    target.setRGB(4.1 + patch * 0.9, 2.95 + patch * 0.6, 1.25 + patch * 0.25).multiplyScalar(jitter);
  } else if (x > 60) {
    target.setRGB(0.62, 0.74, 0.5).multiplyScalar(jitter);
  } else {
    target.setRGB(1.05, 0.92, 0.62).multiplyScalar(jitter);
  }
}

/** Solid walls whose bricks have gaps that the bright haze shines through. Ones with real windows aren't here. */
const BACKED_WALLS = new Set(['wall', 'wall_crenel', 'wall_3m', 'wall_ruin', 'wall_ruin_low']);

/**
 * A strip of quads down the middle of a wall, following its broken top. It sits inside the bricks,
 * so all it does is turn glowing cracks into dark mortar, for a few triangles per wall.
 */
function buildWallBacking(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const box = new THREE.Box3();
  for (const part of parts) {
    part.computeBoundingBox();
    box.union(part.boundingBox!);
  }
  const count = Math.max(1, Math.round((box.max.x - box.min.x) / 0.5));
  const width = (box.max.x - box.min.x) / count;
  const tops = new Float32Array(count).fill(box.min.y);
  for (const part of parts) {
    const position = part.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const column = Math.min(count - 1, Math.floor((position.getX(i) - box.min.x) / width));
      tops[column] = Math.max(tops[column], position.getY(i));
    }
  }
  const middle = (box.min.z + box.max.z) / 2;
  const points: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < count; i += 1) {
    // The lowest of its neighbors, and a little under that, so it never pokes out of a jagged edge.
    const top = Math.min(tops[i], tops[Math.max(0, i - 1)], tops[Math.min(count - 1, i + 1)]) - 0.2;
    if (top <= box.min.y) continue;
    const left = box.min.x + i * width + 0.04;
    const right = left + width - 0.08 + (i < count - 1 ? 0.08 : 0);
    const bottom = box.min.y;
    points.push(left, bottom, middle, right, bottom, middle, right, top, middle, left, bottom, middle, right, top, middle, left, top, middle);
    for (let n = 0; n < 6; n += 1) normals.push(0, 0, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function buildPropSets(
  files: Record<string, THREE.Group>,
  parent: THREE.Object3D,
  materials: (source: THREE.MeshStandardMaterial, castle: boolean) => THREE.MeshLambertMaterial,
  owned: { geometries: THREE.BufferGeometry[] },
  mortar: THREE.Material,
): PropSet[] {
  type Instance = { x: number; z: number; matrix: THREE.Matrix4 };
  const byModel = new Map<string, { file: string; node: string; castle: boolean; upper: boolean; list: Instance[] }>();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const yawTurn = new THREE.Quaternion();
  const tiltTurn = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const FORWARD = new THREE.Vector3(0, 0, 1);
  const inCastle = (x: number, z: number) => x > CASTLE_RECT.minX && x < CASTLE_RECT.maxX && z > CASTLE_RECT.minZ && z < CASTLE_RECT.maxZ;

  for (const batch of MAP.props) {
    for (let i = 0; i + 3 < batch.items.length; i += 4) {
      const x = batch.items[i];
      const z = batch.items[i + 1];
      const castle = batch.file === 'castle' && inCastle(x, z);
      const raised = (batch.y ?? 0) > 1;
      // High tower sections are the core's plain textured cylinders, at a hundredth of the triangles.
      if (castle && raised && batch.node.startsWith('tower_')) continue;
      const upper = castle && raised && batch.node.startsWith('wall');
      const key = `${batch.file}/${batch.node}/${castle ? 1 : 0}/${upper ? 1 : 0}`;
      let model = byModel.get(key);
      if (!model) byModel.set(key, (model = { file: batch.file, node: batch.node, castle, upper, list: [] }));
      yawTurn.setFromAxisAngle(UP, batch.items[i + 2]);
      // Tips toward the model's own +X, which is the side the map's collider expects.
      tiltTurn.setFromAxisAngle(FORWARD, -(batch.tilt ?? 0));
      rotation.multiplyQuaternions(yawTurn, tiltTurn);
      position.set(x, batch.y ?? 0, z);
      size.setScalar(batch.items[i + 3]);
      model.list.push({ x, z, matrix: new THREE.Matrix4().compose(position, rotation, size) });
    }
  }

  const sets: PropSet[] = [];
  const random = seededRandom(77);
  const color = new THREE.Color();
  for (const { file, node, castle, upper, list } of byModel.values()) {
    const root = files[file]?.getObjectByName(node);
    if (!root) continue;
    const parts: THREE.Mesh[] = [];
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Opaque cartoon flames: billboards replace them.
      if ((mesh.material as THREE.Material).name === 'fire') return;
      parts.push(mesh);
    });
    if (parts.length === 0) continue;

    const chunkOf = (item: Instance) => Math.floor((item.z + 512) / CHUNK) * 1024 + Math.floor((item.x + 512) / CHUNK);
    list.sort((a, b) => chunkOf(a) - chunkOf(b));
    const matrices = new Float32Array(list.length * 16);
    const colors = new Float32Array(list.length * 3);
    const chunks: PropChunk[] = [];
    let radius = 0;
    const geometries = parts.map((part) => {
      const geometry = part.geometry.clone();
      geometry.applyMatrix4(part.matrixWorld.clone().premultiply(root.matrixWorld.clone().invert()));
      const name = (part.material as THREE.Material).name;
      if (FOLIAGE.has(name)) roundFoliageNormals(geometry, name === 'leaf_pine' ? 0.9 : 0.6);
      owned.geometries.push(geometry);
      geometry.computeBoundingSphere();
      radius = Math.max(radius, geometry.boundingSphere!.center.length() + geometry.boundingSphere!.radius);
      return geometry;
    });
    list.forEach((item, index) => {
      item.matrix.toArray(matrices, index * 16);
      plantTint(node, item.x, item.z, color, random);
      color.toArray(colors, index * 3);
      const key = chunkOf(item);
      const last = chunks[chunks.length - 1];
      const scale = item.matrix.getMaxScaleOnAxis();
      if (last && chunkOf(list[last.start]) === key) {
        last.count += 1;
        last.sphere.radius = Math.max(last.sphere.radius, radius * scale + CHUNK * 0.71);
      } else {
        const cx = (Math.floor((item.x + 512) / CHUNK) + 0.5) * CHUNK - 512;
        const cz = (Math.floor((item.z + 512) / CHUNK) + 0.5) * CHUNK - 512;
        const y = new THREE.Vector3().setFromMatrixPosition(item.matrix).y;
        chunks.push({ start: index, count: 1, sphere: new THREE.Sphere(new THREE.Vector3(cx, y, cz), radius * scale + CHUNK * 0.71) });
      }
    });

    const instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(matrices.length), 16);
    instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors.length), 3);
    instanceColor.setUsage(THREE.DynamicDrawUsage);
    const meshes = parts.map((part, index) => {
      const material: THREE.Material = materials(part.material as THREE.MeshStandardMaterial, castle);
      const mesh = new THREE.InstancedMesh(geometries[index], material, 0);
      // The buffers are shared by a model's parts, and only hold what the chunk culling lets through.
      mesh.instanceMatrix = instanceMatrix;
      mesh.instanceColor = instanceColor;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.name = node;
      parent.add(mesh);
      return mesh;
    });
    // The citadel's walls have the core behind them already.
    if (!castle && BACKED_WALLS.has(node)) {
      const backing = buildWallBacking(geometries);
      owned.geometries.push(backing);
      const mesh = new THREE.InstancedMesh(backing, mortar, 0);
      mesh.instanceMatrix = instanceMatrix;
      mesh.instanceColor = instanceColor;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.name = `${node}_backing`;
      parent.add(mesh);
      meshes.push(mesh);
    }
    sets.push({
      meshes,
      matrices,
      colors,
      chunks,
      reach: reachOf(node, castle, upper),
      castle,
      shown: new Int32Array(chunks.length),
      shownCount: -1,
    });
  }
  return sets;
}

function cullProps(sets: PropSet[], frustum: THREE.Frustum, cameraPosition: THREE.Vector3, fogFar: number, everything = false): void {
  const next = new Int32Array(1024);
  for (const set of sets) {
    const limit = everything ? Infinity : set.castle ? set.reach : Math.min(set.reach, fogFar + 6);
    let visible = 0;
    let scratch = set.chunks.length > next.length ? new Int32Array(set.chunks.length) : next;
    for (let c = 0; c < set.chunks.length; c += 1) {
      const chunk = set.chunks[c];
      if (chunk.sphere.center.distanceTo(cameraPosition) - CHUNK * 0.71 > limit) continue;
      if (!everything && !frustum.intersectsSphere(chunk.sphere)) continue;
      scratch[visible] = c;
      visible += 1;
    }
    let same = visible === set.shownCount;
    for (let i = 0; same && i < visible; i += 1) same = set.shown[i] === scratch[i];
    if (same) continue;
    set.shownCount = visible;
    set.shown.set(scratch.subarray(0, visible));
    scratch = next;

    const matrixAttribute = set.meshes[0].instanceMatrix;
    const colorAttribute = set.meshes[0].instanceColor!;
    const matrixArray = matrixAttribute.array as Float32Array;
    const colorArray = colorAttribute.array as Float32Array;
    let written = 0;
    for (let i = 0; i < visible; i += 1) {
      const chunk = set.chunks[set.shown[i]];
      matrixArray.set(set.matrices.subarray(chunk.start * 16, (chunk.start + chunk.count) * 16), written * 16);
      colorArray.set(set.colors.subarray(chunk.start * 3, (chunk.start + chunk.count) * 3), written * 3);
      written += chunk.count;
    }
    matrixAttribute.clearUpdateRanges();
    matrixAttribute.addUpdateRange(0, written * 16);
    matrixAttribute.needsUpdate = true;
    colorAttribute.clearUpdateRanges();
    colorAttribute.addUpdateRange(0, written * 3);
    colorAttribute.needsUpdate = true;
    for (const mesh of set.meshes) {
      mesh.count = written;
      mesh.visible = written > 0;
    }
  }
}

/** Overlapping rows of old reeds. The cone's texture runs around it, so the streaks point up its slope. */
function makeThatchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const random = seededRandom(11);
  context.fillStyle = '#1b130b';
  context.fillRect(0, 0, 128, 64);
  for (let row = 0; row < 6; row += 1) {
    for (let x = 0; x < 128; x += 2) {
      const value = 26 + random() * 44;
      context.fillStyle = `rgb(${value}, ${value * 0.72}, ${value * 0.42})`;
      const top = row * 10 + random() * 3;
      context.fillRect(x, top, 2, 11 + random() * 3);
    }
    // The shadow under each row is what makes it read as layers.
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(0, row * 10 + 11, 128, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 2);
  setCrunchy(texture);
  return texture;
}

/* ---------- The castle's core ---------- */

/**
 * The whole citadel in a few thousand textured triangles, always drawn. Far off it is the castle's
 * silhouette; up close it sits just inside the real pieces, where it hides the mesh's pinholes, and
 * it is the upper tower sections, which nobody can get close enough to tell apart.
 */
function buildCastleCore(material: THREE.Material): THREE.Mesh | null {
  const BRICK_TILE = 3;
  const pieces: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, width: number, height: number) => {
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * width) / BRICK_TILE, (uv.getY(i) * height) / BRICK_TILE);
    geometry.rotateY(yaw);
    geometry.translate(x, y, z);
    // Mixed primitives only merge once they're all unindexed.
    pieces.push(geometry.toNonIndexed());
    geometry.dispose();
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, yaw: number) => add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, yaw, w, h);

  // Which tower sections are the top of their stack, so only those get battlements.
  const topOf = new Map<string, number>();
  for (const batch of MAP.props) {
    if (batch.file !== 'castle' || !batch.node.startsWith('tower_')) continue;
    for (let i = 0; i + 3 < batch.items.length; i += 4) {
      const key = `${batch.items[i]},${batch.items[i + 1]}`;
      topOf.set(key, Math.max(topOf.get(key) ?? 0, batch.y ?? 0));
    }
  }

  for (const batch of MAP.props) {
    if (batch.file !== 'castle') continue;
    const y = batch.y ?? 0;
    for (let i = 0; i + 3 < batch.items.length; i += 4) {
      const x = batch.items[i];
      const z = batch.items[i + 1];
      if (x < CASTLE_RECT.minX || x > CASTLE_RECT.maxX || z < CASTLE_RECT.minZ || z > CASTLE_RECT.maxZ) continue;
      const yaw = batch.items[i + 2];
      const s = batch.items[i + 3];
      const isTop = (topOf.get(`${x},${z}`) ?? -1) === y;
      if (batch.node === 'tower_round') {
        const raised = y > 1;
        const radius = (raised ? 3.62 : 3.2) * s;
        const height = 9 * s;
        add(new THREE.CylinderGeometry(radius, radius, height, 12, 1, !raised), x, y + height / 2, z, 0, radius * 6.28, height);
        if (raised && isTop) {
          for (let m = 0; m < 12; m += 1) {
            const a = (m / 12) * Math.PI * 2;
            box(1.25 * s, 1.15 * s, 0.5 * s, x + Math.cos(a) * radius, y + height, z + Math.sin(a) * radius, -a + Math.PI / 2);
          }
        }
      } else if (batch.node === 'tower_square' || (batch.node === 'tower_square_gate' && y > 1)) {
        const raised = y > 1;
        const width = (raised ? 6.5 : 5.7) * s;
        const height = 9 * s;
        box(width, height, width, x, y, z, yaw);
        if (raised && isTop) {
          for (const side of [-1, 1]) {
            for (let m = -2; m <= 2; m += 1) {
              const along = m * width * 0.21;
              box(0.9 * s, 1.15 * s, 0.5 * s, x + along, y + height, z + (side * width) / 2, 0);
              box(0.5 * s, 1.15 * s, 0.9 * s, x + (side * width) / 2, y + height, z + along, 0);
            }
          }
        }
      } else if (batch.node === 'wall') {
        box(5.95 * s, 6 * s, 0.26 * s, x, y, z, yaw);
      } else if (batch.node === 'wall_crenel') {
        box(5.95 * s, 4.85 * s, 0.26 * s, x, y, z, yaw);
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        for (const along of [-2.1, -0.7, 0.7, 2.1]) {
          box(0.8 * s, 1.1 * s, 0.26 * s, x + along * s * cos, y + 4.85 * s, z - along * s * sin, yaw);
        }
      } else if (batch.node === 'wall_ruin' && y > 1) {
        box(5.6 * s, 2.5 * s, 0.26 * s, x, y, z, yaw);
      }
    }
  }
  if (pieces.length === 0) return null;
  const merged = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  mesh.name = 'castle_core';
  return mesh;
}

/* ---------- Sky ---------- */

function makeSilhouetteTexture(): THREE.CanvasTexture {
  // Red, green and blue each carry one layer of the horizon, so the sky shader can color them by
  // time of day without repainting a canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 2048, 256);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#ff0000';
  ctx.fill(ridgePath(2048, 256, 196, 46, 3));
  ctx.fillStyle = '#00ff00';
  // The impossible distant fortress, off to the left of the real one, half in the haze.
  ctx.fill(citadelPath(880, 226, 0.95, 4));
  ctx.fill(citadelPath(1360, 234, 0.34, 12));
  ctx.fillStyle = '#0000ff';
  ctx.fill(ridgePath(2048, 256, 226, 26, 8));
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeSkyMaterial(silhouettes: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uUpper: { value: new THREE.Color() },
      uLower: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uFar: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3(-0.18, 0.1, -0.98).normalize() },
      uGold: { value: 1 },
      uDark: { value: 0 },
      uTime: windTime,
      uSilhouettes: { value: silhouettes },
    },
    // Rotated with the camera but never moved by it, so the sky is always infinitely far away.
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        vec4 projected = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = projected.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uUpper, uLower, uHorizon, uFog, uFar, uSun;
      uniform float uGold, uDark, uTime;
      uniform sampler2D uSilhouettes;
      varying vec3 vDirection;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }

      void main() {
        vec3 d = normalize(vDirection);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 color = mix(uHorizon, uLower, smoothstep(0.02, 0.14, h));
        color = mix(color, uUpper, smoothstep(0.12, 0.32, h));
        color = mix(color, uTop, smoothstep(0.3, 0.7, h));

        // Long banks of cloud, lit from below near the sun.
        float sunAmount = max(dot(d, uSun), 0.0);
        vec2 cloudUv = vec2(atan(d.x, -d.z) * 3.2 + uTime * 0.004, h * 26.0 / (0.2 + h * 1.6));
        float cloud = noise(cloudUv * vec2(1.0, 0.8)) * 0.6 + noise(cloudUv * vec2(2.6, 2.1) + 7.0) * 0.4;
        cloud = smoothstep(0.46, 0.8, cloud) * smoothstep(0.04, 0.16, h) * (1.0 - smoothstep(0.45, 0.8, h));
        vec3 cloudLit = mix(uUpper * 0.55, uHorizon * 1.05, pow(sunAmount, 5.0));
        color = mix(color, cloudLit, cloud * 0.75);

        // A low, swollen sun behind the haze, and the great golden wash around it.
        color += uHorizon * pow(sunAmount, 3.0) * 0.42 * uGold * (1.0 - uDark * 0.55);
        color += vec3(1.0, 0.72, 0.34) * pow(sunAmount, 26.0) * 0.8 * uGold * (1.0 - uDark * 0.8);
        color += vec3(1.0, 0.84, 0.56) * smoothstep(0.9988, 0.9995, sunAmount) * uGold * (1.0 - uDark * 0.9);

        // Horizon layers, far to near. Haze pulls each one toward the color of the fog.
        float u = atan(d.x, -d.z) / 6.28318 + 0.5;
        float v = d.y / max(sqrt(1.0 - d.y * d.y), 0.01) * 1.25;
        if (v > 0.0 && v < 1.0) {
          vec3 masks = texture2D(uSilhouettes, vec2(u, v)).rgb;
          vec3 hazeTint = mix(uFog, uHorizon, 0.45);
          if (masks.r > 0.5) color = mix(uFar, hazeTint, 0.72);
          if (masks.g > 0.5) color = mix(uFar * 0.82, hazeTint, 0.52 + 0.14 * smoothstep(0.0, 0.25, v));
          if (masks.b > 0.5) color = mix(uFar, hazeTint, 0.55);
        }
        // Seamless into the fog at the ground line.
        color = mix(uFog, color, smoothstep(0.0, 0.035, d.y));
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
}

/* ---------- Ground ---------- */

/** Open land the player can stand on; mountains rise from everything outside it. */
function outsideDistance(x: number, z: number): number {
  const outOf = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    const dx = Math.max(minX - x, 0, x - maxX);
    const dz = Math.max(minZ - z, 0, z - maxZ);
    return Math.hypot(dx, dz);
  };
  return Math.min(outOf(-240, 240, -92, 210), outOf(-94, 94, -292, -92));
}

function terrainHash(x: number, z: number): number {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function terrainNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const top = terrainHash(ix, iz) + (terrainHash(ix + 1, iz) - terrainHash(ix, iz)) * fx;
  const bottom = terrainHash(ix, iz + 1) + (terrainHash(ix + 1, iz + 1) - terrainHash(ix, iz + 1)) * fx;
  return top + (bottom - top) * fz;
}
/** Ridged noise: sharp crests, which read as mountains rather than hills. */
function ridges(x: number, z: number, frequency: number): number {
  let total = 0;
  let amplitude = 0.55;
  let f = frequency;
  for (let i = 0; i < 4; i += 1) {
    const n = 1 - Math.abs(terrainNoise(x * f + i * 17, z * f - i * 9) * 2 - 1);
    total += n * n * amplitude;
    amplitude *= 0.5;
    f *= 2.1;
  }
  return total;
}
function terrainHeight(x: number, z: number): number {
  const d = outsideDistance(x, z);
  if (d < 3) return 0;
  // Leave a saddle in the far north, so the sky behind the castle stays open.
  const saddle = z < -100 ? 1 - 0.72 * Math.exp(-(x * x) / (150 * 150)) : 1;
  const near = smooth(3, 46, d) * (10 + 48 * ridges(x, z, 0.018));
  const far = smooth(30, 900, d) * (70 + 300 * ridges(x, z, 0.0042)) * saddle;
  return near * (0.55 + 0.45 * saddle) + far;
}

function makeGroundGeometry(): THREE.BufferGeometry {
  // Fine near the play area and coarse out on the horizon.
  const lines = (center: number) => {
    const out: number[] = [];
    for (let v = -290; v <= 290; v += 10) out.push(center + v);
    let step = 10;
    let edge = 290;
    while (edge < 900) {
      step *= 1.22;
      edge += step;
      out.push(center + edge);
      out.unshift(center - edge);
    }
    return out;
  };
  const xs = lines(0);
  const zs = lines(-40);
  const positions = new Float32Array(xs.length * zs.length * 3);
  const heights = new Float32Array(xs.length * zs.length);
  let write = 0;
  zs.forEach((z) => {
    xs.forEach((x) => {
      const y = terrainHeight(x, z);
      positions[write * 3] = x;
      positions[write * 3 + 1] = y;
      positions[write * 3 + 2] = z;
      heights[write] = y;
      write += 1;
    });
  });
  const indices: number[] = [];
  for (let row = 0; row + 1 < zs.length; row += 1) {
    for (let column = 0; column + 1 < xs.length; column += 1) {
      const a = row * xs.length + column;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function distToLine(line: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i];
    const az = line[i + 1];
    const dx = line[i + 2] - ax;
    const dz = line[i + 3] - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * Bakes which ground texture goes where into two small images, once, at load: a is road, dirt,
 * forest floor, paving; b is meadow, a large-scale light and dark, ash, and baked shade under props.
 */
function bakeGroundMasks(): { a: THREE.DataTexture; b: THREE.DataTexture } {
  const size = 512;
  const { minX, maxX, minZ, maxZ } = MAP.bounds;
  const a = new Uint8Array(size * size * 4);
  const b = new Uint8Array(size * size * 4);
  const shade = new Float32Array(size * size);
  const sx = (maxX - minX) / size;
  const sz = (maxZ - minZ) / size;

  // Shade first: a soft dark blob under everything solid, so nothing floats on the ground.
  const paint = (cx: number, cz: number, reach: number, strength: number, inside: (x: number, z: number) => number) => {
    const left = Math.max(0, Math.floor((cx - reach - minX) / sx));
    const right = Math.min(size - 1, Math.ceil((cx + reach - minX) / sx));
    const top = Math.max(0, Math.floor((cz - reach - minZ) / sz));
    const bottom = Math.min(size - 1, Math.ceil((cz + reach - minZ) / sz));
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const value = inside(minX + (column + 0.5) * sx, minZ + (row + 0.5) * sz) * strength;
        const key = row * size + column;
        shade[key] = 1 - (1 - shade[key]) * (1 - value);
      }
    }
  };
  for (const collider of MAP.colliders) {
    if (collider.t === 'c') {
      const reach = collider.r + 2.6;
      paint(collider.x, collider.z, reach, 0.7, (x, z) => 1 - smooth(collider.r * 0.6, reach, Math.hypot(x - collider.x, z - collider.z)));
    } else {
      if (collider.hw > 80) continue; // the mountain blocks
      const reach = Math.hypot(collider.hw, collider.hd) + 2.5;
      paint(collider.x, collider.z, reach, 0.62, (x, z) => {
        const dx = x - collider.x;
        const dz = z - collider.z;
        const lx = Math.abs(dx * collider.cos - dz * collider.sin) - collider.hw;
        const lz = Math.abs(dx * collider.sin + dz * collider.cos) - collider.hd;
        return 1 - smooth(0, 2.4, Math.hypot(Math.max(lx, 0), Math.max(lz, 0)));
      });
    }
  }

  const trails = MAP.trails ?? [];
  const zoneEdge = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) =>
    Math.min(x - x0, x1 - x, z - z0, z1 - z);
  for (let row = 0; row < size; row += 1) {
    const z = minZ + (row + 0.5) * sz;
    for (let column = 0; column < size; column += 1) {
      const x = minX + (column + 0.5) * sx;
      const wobble = terrainNoise(x * 0.11, z * 0.11) * 2 - 1;
      const fine = terrainNoise(x * 0.5, z * 0.5) * 2 - 1;
      const road = distToLine(MAP.road, x, z);
      let trail = Infinity;
      for (const line of trails) trail = Math.min(trail, distToLine(line, x, z));

      const roadAmount = 1 - smooth(1.6, 3.6, road + fine * 1.2 + wobble * 0.6);
      let dirt = Math.max(1 - smooth(2.6, 6.5, road + wobble * 2.4), 1 - smooth(0.9, 3.4, trail + wobble * 1.4 + fine * 0.5));
      const forestAmount = smooth(-6, 12, zoneEdge(x, z, 60, 300, -120, 112) + wobble * 9);
      const clearing = 1 - smooth(11, 22, Math.hypot(x - 150, z - 10) + wobble * 3);
      const village = smooth(-4, 6, zoneEdge(x, z, -60, 60, 30, 110) + wobble * 5);
      dirt = Math.max(dirt, village * (0.55 + wobble * 0.35));
      const yard = smooth(-2, 3, zoneEdge(x, z, -90, 90, -190, -100));
      const shrine = 1 - smooth(9, 17, Math.hypot(x, z - 180) + wobble * 3);
      const apron = 1 - smooth(5, 15, Math.hypot(x, z + 94) + wobble * 3);
      const paved = Math.max(yard * (0.72 + fine * 0.28), shrine * 0.75, apron * 0.7);
      const meadow = smooth(-6, 7, z - 112 + wobble * 7) * (1 - shrine);
      const ash = smooth(-5, 8, zoneEdge(x, z, -300, 60, -120, 30) + wobble * 6) * (1 - yard);

      const index = (row * size + column) * 4;
      a[index] = roadAmount * 255;
      a[index + 1] = Math.min(1, dirt) * 255;
      a[index + 2] = Math.max(0, forestAmount - clearing * 0.45) * 255;
      a[index + 3] = Math.min(1, paved) * 255;
      b[index] = meadow * 255;
      b[index + 1] = (0.5 + wobble * 0.3 + fine * 0.12) * 255;
      b[index + 2] = ash * 255;
      b[index + 3] = (1 - shade[row * size + column]) * 255;
    }
  }
  const make = (data: Uint8Array) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  return { a: make(a), b: make(b) };
}

function loadGroundTexture(loader: THREE.TextureLoader, name: string): THREE.Texture {
  const texture = loader.load(`/textures/ground-${name}.png`);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  setCrunchy(texture);
  return texture;
}

function makeGroundMaterial(textures: THREE.Texture[], hazeOpen: { value: number }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const masks = bakeGroundMasks();
  textures.push(masks.a, masks.b);
  const [earth, moss, rubble, forest, dirt, stone, road] = textures;
  const { minX, maxX, minZ, maxZ } = MAP.bounds;
  applyVertexSnap(material);
  const snap = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    snap.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uMaskA: { value: masks.a },
      uMaskB: { value: masks.b },
      uEarth: { value: earth },
      uMoss: { value: moss },
      uRubble: { value: rubble },
      uForest: { value: forest },
      uDirt: { value: dirt },
      uStone: { value: stone },
      uRoad: { value: road },
      uHazeOpen: hazeOpen,
      uMaskOrigin: { value: new THREE.Vector2(minX, minZ) },
      uMaskSize: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
    });
    shader.vertexShader = `attribute float aHeight;\nvarying vec2 vGroundXz;\nvarying float vGroundHeight;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vGroundXz = position.xz;
       vGroundHeight = aHeight;`,
    );
    shader.fragmentShader = `
      uniform sampler2D uMaskA, uMaskB, uEarth, uMoss, uRubble, uForest, uDirt, uStone, uRoad;
      uniform vec2 uMaskOrigin, uMaskSize;
      uniform float uHazeOpen;
      varying vec2 vGroundXz;
      varying float vGroundHeight;
      ${shader.fragmentShader}`.replace(
      '#include <map_fragment>',
      `vec2 maskUv = (vGroundXz - uMaskOrigin) / uMaskSize;
       vec4 maskA = texture2D(uMaskA, maskUv);
       vec4 maskB = texture2D(uMaskB, maskUv);
       vec2 tile = vGroundXz / 7.0;
       vec3 ground = texture2D(uEarth, tile).rgb * vec3(1.25, 1.12, 0.92);
       ground = mix(ground, texture2D(uMoss, tile * 0.7).rgb * vec3(2.6, 2.2, 1.25), maskB.r);
       // The dirt texture has big pale stones. Two rotated layers, keeping the darker, leave few of them,
       // and no tiling, where one layer looks like a trail of stepping stones.
       vec3 dirtFar = min(texture2D(uDirt, tile * 0.6).rgb, texture2D(uDirt, vec2(tile.y, -tile.x) * 0.23 + 0.31).rgb) * 1.3;
       vec3 dirtNear = min(texture2D(uDirt, tile * 1.2).rgb, texture2D(uDirt, vec2(-tile.y, tile.x) * 0.47 + 0.17).rgb) * 1.3;
       ground = mix(ground, dirtFar * vec3(0.9, 0.84, 0.78), maskB.b);
       ground = mix(ground, texture2D(uForest, tile).rgb * vec3(0.72, 0.85, 0.62), maskA.b);
       ground = mix(ground, dirtNear * vec3(1.2, 1.05, 0.85), maskA.g);
       ground = mix(ground, texture2D(uRubble, tile * 0.8).rgb * vec3(1.05, 1.05, 1.0), maskA.a * 0.45);
       ground = mix(ground, texture2D(uStone, tile * 0.9).rgb * vec3(1.15, 1.08, 0.98), maskA.a * 0.65);
       ground = mix(ground, texture2D(uRoad, tile * 1.4).rgb * vec3(1.35, 1.25, 1.1), maskA.r);
       ground *= 3.0 * (0.72 + 0.56 * maskB.g) * mix(maskB.a, 1.0, 0.1);
       float cliff = smoothstep(0.5, 6.0, vGroundHeight);
       vec3 rock = texture2D(uStone, vGroundXz / 19.0).rgb * vec3(1.0, 0.93, 0.84);
       ground = mix(ground, rock * (0.75 + 0.5 * smoothstep(20.0, 160.0, vGroundHeight)), cliff);
       diffuseColor.rgb *= ground;`,
    ).replace(
      '#include <fog_fragment>',
      // Mountains get their own far longer haze, so ridges layer from dark and near to pale and far.
      `float groundFog = smoothstep(fogNear, fogFar, vFogDepth);
       float ridgeFog = 0.42 + 0.56 * smoothstep(60.0, 900.0, vFogDepth);
       float ridgeAmount = smoothstep(0.5, 9.0, vGroundHeight) * uHazeOpen;
       gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, mix(groundFog, min(groundFog, ridgeFog), ridgeAmount));`,
    );
  };
  material.customProgramCacheKey = () => 'world-ground';
  return material;
}

function makeStageGroundTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const random = seededRandom(9);
  // Blotches of dead grass and packed dirt, wrapped so the texture tiles without seams.
  const blotches = Array.from({ length: 34 }, () => ({
    x: random() * size,
    y: random() * size,
    r: 6 + random() * 18,
    tone: random() - 0.5,
  }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let tone = 0;
      for (const blotch of blotches) {
        const dx = Math.min(Math.abs(x - blotch.x), size - Math.abs(x - blotch.x));
        const dy = Math.min(Math.abs(y - blotch.y), size - Math.abs(y - blotch.y));
        tone += blotch.tone * Math.max(0, 1 - Math.hypot(dx, dy) / blotch.r);
      }
      const value = 0.5 + tone * 0.5 + (random() - 0.5) * 0.3;
      const index = (y * size + x) * 4;
      image.data[index] = 44 + value * 46;
      image.data[index + 1] = 38 + value * 38;
      image.data[index + 2] = 26 + value * 22;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  makeTextureCrunchy(texture);
  return texture;
}

/* ---------- Billboards: flames, embers, motes, mist, and shafts of light ---------- */

const spriteVec4 = (sprite: AtlasSprite) => new THREE.Vector4(sprite.u0, sprite.v0, sprite.u1 - sprite.u0, sprite.v1 - sprite.v0);

/** Uniforms every billboard shares. */
interface BillboardShared {
  uTime: { value: number };
  uAtlas: { value: THREE.Texture };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uFogColor: { value: THREE.Color };
  uCamera: { value: THREE.Vector3 };
}

function quadGeometry(count: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  return geometry;
}

const BILLBOARD_VERTEX_COMMON = /* glsl */ `
  uniform float uTime, uFogNear, uFogFar;
  uniform vec3 uCamera;
  varying vec2 vUv;
  varying float vFade;
  // A quad that turns to face the camera around the vertical, for things that stand up.
  vec4 standing(vec3 center, vec2 size) {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    right = normalize(vec3(right.x, 0.0, right.z));
    vec3 world = center + right * position.x * size.x + vec3(0.0, position.y * size.y, 0.0);
    return projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
  float fogHide(vec3 world) {
    return 1.0 - smoothstep(uFogNear, uFogFar, distance(world, uCamera));
  }`;

function buildFires(shared: BillboardShared, fires: number[]): { group: THREE.Group; materials: THREE.ShaderMaterial[] } {
  const count = fires.length / 4;
  const group = new THREE.Group();
  const materials: THREE.ShaderMaterial[] = [];
  if (count === 0) return { group, materials };
  const random = seededRandom(13);

  const make = (perFire: number, mode: 0 | 1 | 2, sprite: AtlasSprite) => {
    const geometry = quadGeometry(count * perFire);
    const center = new Float32Array(count * perFire * 4);
    const seeds = new Float32Array(count * perFire * 2);
    for (let f = 0; f < count; f += 1) {
      for (let j = 0; j < perFire; j += 1) {
        const k = f * perFire + j;
        center.set([fires[f * 4], fires[f * 4 + 1], fires[f * 4 + 2], fires[f * 4 + 3]], k * 4);
        seeds[k * 2] = random();
        seeds[k * 2 + 1] = j / perFire;
      }
    }
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 4));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { ...shared, uSprite: { value: spriteVec4(sprite) } },
      defines: { MODE: mode },
      vertexShader: /* glsl */ `
        attribute vec4 aCenter;
        attribute vec2 aSeed;
        uniform vec4 uSprite;
        varying float vHeat;
        ${BILLBOARD_VERTEX_COMMON}
        void main() {
          vec3 center = aCenter.xyz;
          float size = aCenter.w;
          vec2 local = position.xy;
          // Stepped time gives the choppy, hand-drawn flicker of an old console's sprite flames.
          float step12 = floor(uTime * 11.0 + aSeed.x * 40.0);
          float flick = fract(sin(step12 * 12.9898 + aSeed.x * 78.233) * 43758.5453);
          vec2 extent;
          vHeat = 1.0;
          #if MODE == 0
            extent = vec2(0.9 + flick * 0.24, 1.75 + flick * 0.75) * size * (1.0 - aSeed.y * 0.28);
            center.xz += (aSeed.y - 0.25) * size * vec2(0.34 * sin(aSeed.x * 40.0), 0.34 * cos(aSeed.x * 40.0));
            if (flick > 0.5) local.x = -local.x;
            vHeat = 0.65 + flick * 0.35;
          #elif MODE == 1
            float breathe = 3.6 + sin(uTime * 3.0 + aSeed.x * 6.0) * 0.28 + flick * 0.22;
            extent = vec2(breathe, breathe) * size;
            center.y += size * (0.5 - breathe * 0.5);
            vHeat = 0.8 + flick * 0.2;
          #else
            float life = fract(uTime * (0.22 + aSeed.x * 0.2) + aSeed.y + aSeed.x * 3.0);
            center.y += life * life * size * 4.2 + size * 0.5;
            center.x += sin(life * 7.0 + aSeed.x * 30.0) * (0.2 + life * 0.5) * size;
            center.z += cos(life * 6.0 + aSeed.x * 21.0) * (0.2 + life * 0.5) * size;
            extent = vec2(0.09 + 0.05 * size);
            vHeat = (1.0 - life) * (0.6 + flick * 0.4);
          #endif
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          #if MODE == 0
            right = normalize(vec3(right.x, 0.0, right.z));
            vec3 up = vec3(0.0, 1.0, 0.0);
            // The flame leans in the wind, more at the tip.
            center += vec3(sin(uTime * 2.3 + aSeed.x * 9.0) * 0.12 * local.y * size, 0.0, 0.0);
          #else
            vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          #endif
          vec3 world = center + right * local.x * extent.x + up * local.y * extent.y;
          vUv = uSprite.xy + vec2(position.x + 0.5, position.y) * uSprite.zw;
          vFade = fogHide(world);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying float vFade;
        varying float vHeat;
        void main() {
          vec4 tex = texture2D(uAtlas, vUv);
          float value = tex.a * max(tex.r, 0.0);
          #if MODE == 0
            vec3 color = mix(vec3(1.6, 0.42, 0.06), vec3(2.3, 1.6, 0.6), smoothstep(0.25, 0.95, value));
            gl_FragColor = vec4(color * value * vHeat * (0.25 + vFade * 0.75), 1.0);
          #elif MODE == 1
            gl_FragColor = vec4(vec3(0.85, 0.38, 0.1) * value * 0.42 * vHeat * (0.2 + vFade * 0.8), 1.0);
          #else
            gl_FragColor = vec4(vec3(2.2, 0.95, 0.25) * value * vHeat * vFade, 1.0);
          #endif
        }`,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    // Drawn after the opaque world, and in this order so the glow sits behind the flame.
    mesh.renderOrder = 10 + mode;
    group.add(mesh);
  };
  make(1, 1, ATLAS.glow);
  make(2, 0, ATLAS['flame-3']);
  make(5, 2, ATLAS.glow);
  return { group, materials };
}

/** Drifting gold specks in a box that wraps around the camera, so they're always nearby. */
function buildMotes(shared: BillboardShared, count: number): THREE.Mesh {
  const geometry = quadGeometry(count);
  const random = seededRandom(31);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i += 1) seeds[i] = random();
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uSprite: { value: spriteVec4(ATLAS.glow) }, uStrength: { value: 1 }, uTint: { value: new THREE.Color(1, 0.72, 0.3) } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform vec4 uSprite;
      ${BILLBOARD_VERTEX_COMMON}
      void main() {
        const vec3 box = vec3(48.0, 14.0, 48.0);
        vec3 p = aSeed.xyz * box;
        p += vec3(sin(uTime * 0.12 + aSeed.w * 30.0) * 2.2 + uTime * 0.25, sin(uTime * 0.2 + aSeed.x * 40.0) * 1.5 + uTime * 0.12, cos(uTime * 0.09 + aSeed.y * 30.0) * 2.2);
        p = mod(p - uCamera + box * 0.5, box) + uCamera - box * 0.5;
        p.y = max(p.y, 0.15);
        float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + aSeed.w) + aSeed.z * 50.0);
        float distanceToCamera = distance(p, uCamera);
        vFade = twinkle * twinkle * (1.0 - smoothstep(12.0, 24.0, distanceToCamera)) * smoothstep(0.5, 2.0, distanceToCamera);
        float size = 0.09 + aSeed.w * 0.1;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = p + (right * position.x + up * (position.y - 0.5)) * size;
        vUv = uSprite.xy + vec2(position.x + 0.5, position.y) * uSprite.zw;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uStrength;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vec4 tex = texture2D(uAtlas, vUv);
        gl_FragColor = vec4(uTint * 2.4 * tex.a * tex.r * vFade * uStrength, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 13;
  return mesh;
}

/** Big faint cards of ground mist, in a box wrapping around the camera. */
function buildMist(shared: BillboardShared, count: number): THREE.Mesh {
  const geometry = quadGeometry(count);
  const random = seededRandom(47);
  const seeds = new Float32Array(count * 4);
  const sprites = new Float32Array(count * 4);
  const names = ['smoke-1', 'smoke-2', 'smoke-3', 'smoke-4'];
  for (let i = 0; i < count; i += 1) {
    seeds.set([random(), random(), random(), random()], i * 4);
    const sprite = ATLAS[names[i % names.length]] ?? ATLAS.glow;
    sprites.set([sprite.u0, sprite.v0, sprite.u1 - sprite.u0, sprite.v1 - sprite.v0], i * 4);
  }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.setAttribute('aSprite', new THREE.InstancedBufferAttribute(sprites, 4));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...shared, uStrength: { value: 1 }, uTint: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      attribute vec4 aSprite;
      ${BILLBOARD_VERTEX_COMMON}
      void main() {
        const vec3 box = vec3(130.0, 1.0, 130.0);
        vec3 p = vec3(aSeed.x, 0.0, aSeed.y) * box;
        p.x += uTime * (0.25 + aSeed.w * 0.35);
        p.z += sin(uTime * 0.05 + aSeed.z * 20.0) * 3.0;
        p = mod(p - uCamera + box * 0.5, box) + uCamera - box * 0.5;
        p.y = -0.6 - aSeed.w * 0.6;
        float d = distance(p.xz, uCamera.xz);
        vFade = smoothstep(5.0, 22.0, d) * (1.0 - smoothstep(min(uFogFar, 62.0) * 0.8, 64.0, d));
        vec2 size = vec2(20.0 + aSeed.z * 22.0, 4.5 + aSeed.w * 4.0);
        vUv = aSprite.xy + vec2(position.x + 0.5, position.y) * aSprite.zw;
        gl_Position = standing(p, size);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uStrength;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vec4 tex = texture2D(uAtlas, vUv);
        gl_FragColor = vec4(uTint, tex.a * vFade * uStrength);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return mesh;
}

/** Tall slanted cards of light falling into open places, which sell the golden haze. */
function buildShafts(shared: BillboardShared, spots: number[]): THREE.Mesh {
  const count = spots.length / 4;
  const geometry = quadGeometry(count);
  geometry.setAttribute('aSpot', new THREE.InstancedBufferAttribute(new Float32Array(spots), 4));
  const random = seededRandom(5);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) seeds[i] = random();
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uStrength: { value: 1 }, uTint: { value: new THREE.Color(1, 0.72, 0.36) } },
    vertexShader: /* glsl */ `
      attribute vec4 aSpot;
      attribute float aSeed;
      varying float vShimmer;
      ${BILLBOARD_VERTEX_COMMON}
      void main() {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        right = normalize(vec3(right.x, 0.0, right.z));
        vec3 base = aSpot.xyz;
        // The whole shaft leans away from the low sun.
        vec3 world = base + right * position.x * aSpot.w + vec3(0.32, 1.0, 0.1) * position.y * 34.0;
        vUv = vec2(position.x + 0.5, position.y);
        vShimmer = 0.75 + 0.25 * sin(uTime * 0.4 + aSeed * 20.0);
        vFade = 1.0 - smoothstep(uFogFar * 0.7, uFogFar * 1.1, distance(base, uCamera));
        vFade *= smoothstep(1.0, 9.0, distance(base.xz, uCamera.xz));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vFade;
      varying float vShimmer;
      void main() {
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float along = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
        gl_FragColor = vec4(uTint * across * across * along * vFade * vShimmer * uStrength * 0.2, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return mesh;
}

/* ---------- Zone moods ---------- */

interface ZoneMood {
  /** Fog color, and how strongly it replaces the sky's golden fog. */
  tint: [number, number, number];
  tintAmount: number;
  /** Multiplies sun and sky light. Under a forest roof it's dark at noon. */
  light: number;
  motes: number;
  mist: number;
  shafts: number;
}
const DEFAULT_MOOD: ZoneMood = { tint: [0, 0, 0], tintAmount: 0, light: 1, motes: 0.9, mist: 0.55, shafts: 1 };
const MOODS: Record<string, Partial<ZoneMood>> = {
  "Pilgrim's Rest": { motes: 1.4, mist: 0.5, light: 1.1 },
  'Pale Meadow': { motes: 1.1, mist: 0.55, light: 1.25 },
  'Forsaken Village': { tint: [90, 66, 48], tintAmount: 0.35, light: 0.9, motes: 0.5, mist: 0.6 },
  'Ash Flats': { tint: [132, 104, 76], tintAmount: 0.3, light: 0.95, motes: 0.5, mist: 0.65 },
  'Cursed Forest': { tint: [38, 46, 34], tintAmount: 0.86, light: 0.62, motes: 0.55, mist: 1.25, shafts: 0.85 },
  'Sunken Graveyard': { tint: [52, 58, 62], tintAmount: 0.7, light: 0.7, motes: 0.3, mist: 1 },
  'Fallen Citadel': { tint: [120, 86, 58], tintAmount: 0.22, light: 1, motes: 1, mist: 0.5 },
  'Throne of Ash': { tint: [70, 40, 30], tintAmount: 0.4, light: 0.9, motes: 0.8, mist: 0.4 },
};

/* ---------- The world ---------- */

export interface WorldChest {
  id: number;
  x: number;
  z: number;
  distance: number;
}

export interface WorldScene {
  scene: THREE.Scene;
  /** Moves the sky, fog and sun to the current time, and the fog to the player's zone. */
  update: (playerX?: number, playerZ?: number) => void;
  dispose: () => void;
  /** Done when the models are in. The world can be drawn before this, with only ground and sky. */
  ready: Promise<void>;
  setChestOpen: (id: number, open: boolean, animate: boolean) => void;
  chestPosition: (id: number) => { x: number; z: number } | null;
  nearestChest: (x: number, z: number) => WorldChest | null;
  graces: readonly MapGrace[];
  /** Only for tools/build-world-map.mjs, through the map lab. Never called by the game. */
  prepareTopDown: (sunDirection: THREE.Vector3) => { ground: THREE.Object3D | null; sun: THREE.DirectionalLight };
}

export interface WorldOptions {
  /** False draws the plain stage behind the character screen: sky and ground only, nothing loaded. */
  withRocks?: boolean;
  /** Freezes the time of day, for the map lab's screenshots. */
  fixedPhase?: number;
}

interface ChestState {
  id: number;
  x: number;
  z: number;
  open: boolean;
  angle: number;
  lid: THREE.Object3D | null;
  glint: THREE.Sprite | null;
}

const LID_OPEN = -1.4;

export function createWorld({ withRocks = true, fixedPhase }: WorldOptions = {}): WorldScene {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 18, 150);
  const fog = scene.fog as THREE.Fog;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x2a2015, 1.2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe2a8, 2.1);
  scene.add(sun);

  const silhouettes = makeSilhouetteTexture();
  const skyMaterial = makeSkyMaterial(silhouettes);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 16), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const textures: THREE.Texture[] = [silhouettes];
  const atlas = new THREE.TextureLoader().load('/fx/atlas.png');
  atlas.colorSpace = THREE.NoColorSpace;
  setCrunchy(atlas);
  textures.push(atlas);

  const shared: BillboardShared = {
    uTime: windTime,
    uAtlas: { value: atlas },
    uFogNear: { value: 18 },
    uFogFar: { value: 150 },
    uFogColor: { value: fog.color },
    uCamera: { value: new THREE.Vector3() },
  };

  const motes = buildMotes(shared, withRocks ? 260 : 60);
  scene.add(motes);
  const moteUniforms = (motes.material as THREE.ShaderMaterial).uniforms;

  let mist: THREE.Mesh | null = null;
  let shafts: THREE.Mesh | null = null;
  let fireGroup: THREE.Object3D | null = null;
  let groundMesh: THREE.Object3D | null = null;
  /** Set for the map bake: update() stops touching the scene, and nothing is culled. */
  let topDown = false;
  const fireMaterials: THREE.ShaderMaterial[] = [];
  const fireLights: THREE.PointLight[] = [];
  const fires = MAP.fires ?? [];
  const chests = new Map<number, ChestState>();
  const castleFogCap = { value: 1 };
  /** 1 where the sky is open and mountains show through the haze, 0 under thick forest fog. */
  const hazeOpen = { value: 1 };
  let propSets: PropSet[] = [];
  const owned = { geometries: [] as THREE.BufferGeometry[] };
  let disposed = false;

  // Where the player was last told to be, so that update() with no arguments still works.
  let playerX: number = MAP.spawn.x;
  let playerZ: number = MAP.spawn.z;
  const mood = { fogNear: 22, fogFar: 85, r: 0, g: 0, b: 0, tintAmount: 0, light: 1, motes: 1, mist: 0.5, shafts: 1 };
  let moodStarted = false;

  let ready: Promise<void> = Promise.resolve();
  if (!withRocks) {
    const stageGround = makeStageGroundTexture();
    stageGround.repeat.set(70, 70);
    textures.push(stageGround);
    const material = new THREE.MeshLambertMaterial({ map: stageGround });
    applyVertexSnap(material);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(340, 64), material);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
  } else {
    const groundTextures = ['earth', 'moss', 'rubble', 'forest', 'dirt', 'stone', 'road'].map((name) =>
      loadGroundTexture(new THREE.TextureLoader(), name),
    );
    const ground = new THREE.Mesh(makeGroundGeometry(), makeGroundMaterial(groundTextures, hazeOpen));
    textures.push(...groundTextures);
    ground.frustumCulled = false;
    scene.add(ground);
    groundMesh = ground;

    mist = buildMist(shared, 64);
    scene.add(mist);
    shafts = buildShafts(shared, [
      // Clearing, shrine and yard: x, y, z, width.
      150, 0, 10, 7, 144, 0, 2, 5, 158, 0, 18, 5, 141, 0, 15, 4,
      4, 0, 182, 5, -7, 0, 170, 6, 10, 0, 164, 4,
      -8, 0, -124, 8, 10, 0, -132, 7, -3, 0, -146, 6, 26, 0, -118, 6, -28, 0, -150, 7,
      -12, 0, 62, 5, 22, 0, 76, 5,
    ]);
    scene.add(shafts);
    const fireField = buildFires(shared, fires);
    scene.add(fireField.group);
    fireGroup = fireField.group;
    fireMaterials.push(...fireField.materials);
    // A fixed number of lights, because adding one recompiles every shader in the scene.
    for (let i = 0; i < LIGHT_COUNT; i += 1) {
      const light = new THREE.PointLight(0xff9a48, 0, LIGHT_REACH, 1.5);
      scene.add(light);
      fireLights.push(light);
    }

    for (const chest of MAP.chests) chests.set(chest.id, { id: chest.id, x: chest.x, z: chest.z, open: false, angle: 0, lid: null, glint: null });

    const propsRoot = new THREE.Group();
    scene.add(propsRoot);

    const load = async () => {
      const loader = new GLTFLoader();
      const [forest, castleFile, propsFile] = await Promise.all(
        ['forest', 'castle', 'props'].map((name) => loader.loadAsync(`/models/world/${name}.glb`)),
      );
      if (disposed) {
        for (const gltf of [forest, castleFile, propsFile]) {
          gltf.scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            mesh.geometry?.dispose();
            const material = mesh.material as THREE.MeshStandardMaterial | undefined;
            material?.map?.dispose();
            material?.dispose();
          });
        }
        return;
      }
      const converted = new Map<string, THREE.MeshLambertMaterial>();
      const materialFor = (source: THREE.MeshStandardMaterial, castle: boolean) => {
        const key = `${source.uuid}/${castle ? 1 : 0}`;
        let material = converted.get(key);
        if (!material) converted.set(key, (material = convertMaterial(source, castle ? castleFogCap : undefined)));
        return material;
      };
      const chestLook = new Map<string, THREE.MeshLambertMaterial>();
      const chestMaterial = (source: THREE.MeshStandardMaterial) => {
        let material = chestLook.get(source.uuid);
        if (!material) {
          material = convertMaterial(source, undefined);
          material.color.multiplyScalar(2);
          if (source.name === 'gold') material.emissive.setRGB(0.35, 0.22, 0.05);
          chestLook.set(source.uuid, material);
        }
        return material;
      };
      const files = { forest: forest.scene, castle: castleFile.scene, props: propsFile.scene };
      const mortar = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.035, 0.03, 0.026), side: THREE.DoubleSide });
      applyLook(mortar, {});
      propSets = buildPropSets(files, propsRoot, materialFor, owned, mortar);

      let stone: THREE.MeshStandardMaterial | null = null;
      castleFile.scene.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (material?.name === 'stone') stone = material;
      });
      const core = stone ? buildCastleCore(materialFor(stone, true)) : null;
      if (core) scene.add(core);

      const spireData = MAP.spires ?? [];
      if (spireData.length) {
        const cone = new THREE.ConeGeometry(1, 1, 8, 1, true);
        cone.translate(0, 0.5, 0);
        const slate = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.075, 0.075, 0.09), side: THREE.DoubleSide });
        applyLook(slate, { fogCap: castleFogCap });
        // Roofs outside the citadel are old thatch, and the fog is allowed to swallow them whole.
        const thatchTexture = makeThatchTexture();
        textures.push(thatchTexture);
        const thatch = new THREE.MeshLambertMaterial({ map: thatchTexture, side: THREE.DoubleSide });
        applyLook(thatch, {});
        const inside: THREE.Matrix4[] = [];
        const outside: THREE.Matrix4[] = [];
        for (let i = 0; i < spireData.length / 5; i += 1) {
          const [x, y, z, radius, height] = spireData.slice(i * 5, i * 5 + 5);
          const inCitadel = x > CASTLE_RECT.minX && x < CASTLE_RECT.maxX && z > CASTLE_RECT.minZ && z < CASTLE_RECT.maxZ;
          (inCitadel ? inside : outside).push(new THREE.Matrix4().makeScale(radius, height, radius).setPosition(x, y, z));
        }
        for (const [matrices, material] of [[inside, slate], [outside, thatch]] as const) {
          if (matrices.length === 0) continue;
          const spires = new THREE.InstancedMesh(cone, material, matrices.length);
          matrices.forEach((matrix, index) => spires.setMatrixAt(index, matrix));
          spires.frustumCulled = false;
          scene.add(spires);
        }
      }

      // Chests are single objects, because each one's lid moves on its own.
      for (const data of MAP.chests) {
        const state = chests.get(data.id)!;
        const source = propsFile.scene.getObjectByName(data.model ?? 'chest');
        if (!source) continue;
        const chest = source.clone(true);
        chest.position.set(data.x, 0, data.z);
        chest.rotation.y = data.yaw;
        // Larger and brighter than the crates around it, because finding it is the reward.
        chest.scale.setScalar(1.2);
        chest.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) mesh.material = chestMaterial(mesh.material as THREE.MeshStandardMaterial);
          if (object.name.endsWith('_lid')) state.lid = object;
        });
        if (state.lid) state.lid.rotation.x = state.angle;
        scene.add(chest);

        const glintMaterial = new THREE.SpriteMaterial({
          map: spriteTexture(atlas, ATLAS.glow, textures),
          color: new THREE.Color(1.5, 1.05, 0.42),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        });
        const glint = new THREE.Sprite(glintMaterial);
        glint.position.set(data.x, 0.75, data.z);
        glint.scale.setScalar(1);
        glint.visible = !state.open;
        scene.add(glint);
        state.glint = glint;
      }

      // Every material made from the files is in `converted`; the originals are done with.
      for (const gltf of [forest, castleFile, propsFile]) {
        gltf.scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          (mesh.material as THREE.Material).dispose?.();
        });
      }
      for (const material of [...converted.values(), ...chestLook.values()]) if (material.map && !textures.includes(material.map)) textures.push(material.map);
    };
    ready = load();
  }

  // Runs once per render, with the real camera, so callers never pass it in. It has to come
  // before three.js gathers what to draw, which is why it hooks the scene and not the update.
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const cameraPosition = new THREE.Vector3();
  scene.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(cameraPosition);
    shared.uCamera.value.copy(cameraPosition);
    if (propSets.length === 0) return;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    cullProps(propSets, frustum, cameraPosition, mood.fogFar, topDown);
  };

  const fogTarget = new THREE.Color();
  const tintColor = new THREE.Color();
  let lastTime = performance.now();
  let nextLightCheck = 0;
  const nearestFires: number[] = [];

  const updateMood = (dt: number) => {
    // Every zone pulls on the mood by how close the player is to it, so edges blend.
    let total = 0;
    const sum = { near: 0, far: 0, r: 0, g: 0, b: 0, tintAmount: 0, light: 0, motes: 0, mist: 0, shafts: 0 };
    for (const zone of MAP.zones) {
      const outside = Math.hypot(Math.max(zone.minX - playerX, 0, playerX - zone.maxX), Math.max(zone.minZ - playerZ, 0, playerZ - zone.maxZ));
      const inside = Math.min(playerX - zone.minX, zone.maxX - playerX, playerZ - zone.minZ, zone.maxZ - playerZ);
      const weight = outside > 0 ? Math.max(0, 1 - outside / 14) * 0.5 : 0.5 + Math.min(1, inside / 14) * 0.5;
      if (weight <= 0) continue;
      const m = { ...DEFAULT_MOOD, ...MOODS[zone.name] };
      total += weight;
      sum.near += zone.fogNear * weight;
      sum.far += zone.fogFar * weight;
      sum.r += m.tint[0] * weight;
      sum.g += m.tint[1] * weight;
      sum.b += m.tint[2] * weight;
      sum.tintAmount += m.tintAmount * weight;
      sum.light += m.light * weight;
      sum.motes += m.motes * weight;
      sum.mist += m.mist * weight;
      sum.shafts += m.shafts * weight;
    }
    if (total <= 0) return;
    const blend = moodStarted ? 1 - Math.exp(-dt * 1.6) : 1;
    moodStarted = true;
    mood.fogNear += (sum.near / total - mood.fogNear) * blend;
    mood.fogFar += (sum.far / total - mood.fogFar) * blend;
    mood.r += (sum.r / total - mood.r) * blend;
    mood.g += (sum.g / total - mood.g) * blend;
    mood.b += (sum.b / total - mood.b) * blend;
    mood.tintAmount += (sum.tintAmount / total - mood.tintAmount) * blend;
    mood.light += (sum.light / total - mood.light) * blend;
    mood.motes += (sum.motes / total - mood.motes) * blend;
    mood.mist += (sum.mist / total - mood.mist) * blend;
    mood.shafts += (sum.shafts / total - mood.shafts) * blend;
  };

  const updateFireLights = (time: number) => {
    if (time >= nextLightCheck) {
      nextLightCheck = time + 0.3;
      nearestFires.length = 0;
      const count = fires.length / 4;
      const distances: Array<[number, number]> = [];
      for (let i = 0; i < count; i += 1) {
        const d = Math.hypot(fires[i * 4] - playerX, fires[i * 4 + 2] - playerZ);
        if (d < LIGHT_REACH + 6) distances.push([d, i]);
      }
      distances.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < Math.min(LIGHT_COUNT, distances.length); i += 1) nearestFires.push(distances[i][1]);
    }
    fireLights.forEach((light, slot) => {
      const index = nearestFires[slot];
      if (index === undefined) {
        light.intensity = 0;
        return;
      }
      const size = fires[index * 4 + 3];
      light.position.set(fires[index * 4], fires[index * 4 + 1] + size * 1.2, fires[index * 4 + 2]);
      const d = Math.hypot(light.position.x - playerX, light.position.z - playerZ);
      const flicker = 0.84 + 0.1 * Math.sin(time * 9.3 + index * 2.1) + 0.06 * Math.sin(time * 23 + index);
      // Fades out as the fire leaves the short list, so lights don't pop.
      light.intensity = (14 + size * 22) * flicker * (1 - smooth(LIGHT_REACH * 0.7, LIGHT_REACH + 4, d));
    });
  };

  const update = (x?: number, z?: number) => {
    if (topDown) return;
    if (x !== undefined && z !== undefined) {
      playerX = x;
      playerZ = z;
    }
    const nowMs = performance.now();
    const dt = Math.min(0.25, (nowMs - lastTime) / 1000);
    lastTime = nowMs;
    const time = (nowMs / 1000) % 3600;
    windTime.value = time;

    const phase = fixedPhase ?? worldPhase();
    const look = skyAt(phase);
    const uniforms = skyMaterial.uniforms;
    (uniforms.uTop.value as THREE.Color).copy(toColor(look.sky[0]));
    (uniforms.uUpper.value as THREE.Color).copy(toColor(look.sky[1]));
    (uniforms.uLower.value as THREE.Color).copy(toColor(look.sky[2]));
    (uniforms.uHorizon.value as THREE.Color).copy(toColor(look.sky[3]));
    (uniforms.uFar.value as THREE.Color).copy(toColor(look.far));
    uniforms.uGold.value = look.gold;
    uniforms.uDark.value = look.darkness;

    if (withRocks) updateMood(dt);
    const brightness = 1 - look.darkness * 0.28;
    // Golden fog in the open, somewhere between the sky's two lowest colors.
    fogTarget.copy(toColor(look.sky[2])).lerp(toColor(look.sky[3]), 0.42).multiplyScalar(0.8);
    if (withRocks) {
      tintColor.copy(toColor([mood.r, mood.g, mood.b])).multiplyScalar(brightness * (1 - look.darkness * 0.35));
      fogTarget.lerp(tintColor, mood.tintAmount);
      fog.near = mood.fogNear;
      fog.far = mood.fogFar;
    }
    fog.color.copy(fogTarget);
    (uniforms.uFog.value as THREE.Color).copy(fogTarget);
    shared.uFogNear.value = fog.near;
    shared.uFogFar.value = fog.far;
    // Deep in thick fog the castle shouldn't ghost through the trees.
    hazeOpen.value = smooth(55, 76, fog.far);
    castleFogCap.value = 1 - 0.3 * hazeOpen.value;

    // The low sun stays in the north-west and sets behind the citadel, so long light rakes the walls.
    const angle = phase * Math.PI * 2;
    sun.position.set(-90 + Math.cos(angle) * 30, 46 + Math.sin(angle) * 26, -60 + Math.sin(angle) * 20);
    const light = 1 - look.darkness;
    // Light colors stay close to white, so outfits keep their colors instead of turning gold.
    sun.intensity = (0.65 + light * 1.05) * mood.light;
    sun.color.copy(toColor(look.sky[3])).lerp(WHITE, 0.35);
    hemisphere.intensity = (withRocks ? 0.85 + light * 0.45 : 0.5 + light * 0.45) * mood.light;
    hemisphere.color.copy(toColor(look.sky[2])).lerp(WHITE, 0.55);

    moteUniforms.uStrength.value = withRocks ? mood.motes : 0.6;
    if (mist) {
      const mistUniforms = (mist.material as THREE.ShaderMaterial).uniforms;
      mistUniforms.uStrength.value = 0.24 * mood.mist;
      (mistUniforms.uTint.value as THREE.Color).copy(fogTarget).multiplyScalar(1.08);
    }
    if (shafts) {
      const shaftUniforms = (shafts.material as THREE.ShaderMaterial).uniforms;
      shaftUniforms.uStrength.value = mood.shafts * (1 - look.darkness * 0.75);
    }

    if (withRocks) updateFireLights(time);

    for (const chest of chests.values()) {
      const target = chest.open ? LID_OPEN : 0;
      if (chest.angle !== target) {
        const step = dt * 2.2;
        chest.angle = chest.angle > target ? Math.max(target, chest.angle - step) : Math.min(target, chest.angle + step);
        if (chest.lid) chest.lid.rotation.x = chest.angle;
      }
      if (chest.glint) {
        chest.glint.visible = !chest.open;
        // A slow pulse with a quick catch of light, so the eye finds it without a marker.
        const catchLight = Math.pow(Math.max(0, Math.sin(time * 0.9 + chest.id * 2)), 16);
        chest.glint.material.opacity = 0.22 + 0.12 * Math.sin(time * 1.7) + catchLight * 0.75;
        chest.glint.scale.setScalar(0.9 + catchLight * 1.1);
      }
    }
  };
  update();

  // The map is a view from straight above in plain daylight, so everything that exists for the
  // view from the ground goes, and textures stop being crunchy, which would alias into noise.
  const prepareTopDown = (sunDirection: THREE.Vector3) => {
    topDown = true;
    for (const object of [sky, motes, mist, shafts, fireGroup]) if (object) object.visible = false;
    for (const chest of chests.values()) if (chest.glint) chest.glint.visible = false;
    windTime.value = 0;
    fog.near = 1e5;
    fog.far = 2e5;
    hazeOpen.value = 0;
    castleFogCap.value = 0;
    sun.position.copy(sunDirection).setLength(900);
    sun.color.setRGB(1, 0.86, 0.66);
    sun.intensity = 3.1;
    hemisphere.color.setRGB(0.86, 0.84, 0.82);
    hemisphere.groundColor.setRGB(0.3, 0.24, 0.17);
    hemisphere.intensity = 0.95;
    for (const light of fireLights) light.intensity = 0;
    for (const texture of textures) {
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
    return { ground: groundMesh, sun };
  };

  const setChestOpen = (id: number, open: boolean, animate: boolean) => {
    const chest = chests.get(id);
    if (!chest) return;
    chest.open = open;
    if (!animate) {
      chest.angle = open ? LID_OPEN : 0;
      if (chest.lid) chest.lid.rotation.x = chest.angle;
    }
    if (chest.glint) chest.glint.visible = !open;
  };

  return {
    scene,
    update,
    ready,
    setChestOpen,
    chestPosition: (id) => {
      const chest = chests.get(id);
      return chest ? { x: chest.x, z: chest.z } : null;
    },
    nearestChest: (x, z) => {
      let best: WorldChest | null = null;
      for (const chest of chests.values()) {
        const distance = Math.hypot(chest.x - x, chest.z - z);
        if (!best || distance < best.distance) best = { id: chest.id, x: chest.x, z: chest.z, distance };
      }
      return best;
    },
    graces: withRocks ? MAP.graces : [],
    prepareTopDown,
    dispose: () => {
      disposed = true;
      scene.onBeforeRender = () => {};
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => material.dispose());
        if ((object as THREE.PointLight).isLight) (object as THREE.Light).dispose();
      });
      owned.geometries.forEach((geometry) => geometry.dispose());
      textures.forEach((texture) => texture.dispose());
    },
  };
}

/** A one-sprite view of the atlas, for a THREE.Sprite. Shares the image, not the settings. */
function spriteTexture(atlas: THREE.Texture, sprite: AtlasSprite, owned: THREE.Texture[]): THREE.Texture {
  const texture = atlas.clone();
  texture.source = atlas.source;
  texture.offset.set(sprite.u0, sprite.v0);
  texture.repeat.set(sprite.u1 - sprite.u0, sprite.v1 - sprite.v0);
  texture.needsUpdate = true;
  owned.push(texture);
  return texture;
}
