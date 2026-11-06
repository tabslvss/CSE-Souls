/**
 * Builds client/public/models/world/forest.glb and client/public/textures/ground-*.png from free downloads.
 *
 * The raw packs stay out of the repo. Download and unzip each pack into <packs>/<folder>/x:
 *   q-nature       CC0    https://quaternius.itch.io/stylized-nature-megakit (Standard tier)
 *   kenney-nature  CC0    https://kenney.nl/assets/nature-kit
 *   deadtrees      CC BY  https://godgoldfear.itch.io/low-poly-dead-trees
 *   psxforest      CC BY  https://ju5t1nj.itch.io/psx-plus-forest-pack
 *   tinytex        CC0    https://screamingbrainstudios.itch.io/tiny-texture-pack (128x128)
 *   kenney-retro   CC0    https://kenney.nl/assets/retro-textures-fantasy
 *
 * The two FBX packs must be converted to GLB first, into <converted>/dead_1..5.glb and
 * <converted>/psx_<mesh name>.glb. Load each FBX with Three's FBXLoader in a browser, keep the
 * material names, and export with GLTFExporter (the same route as the weapons in build-models.mjs).
 * Their textures must also be saved as PNG into <converted>/tex/, as psx_<name>.png and dead_Texture.png.
 *
 * Every prop is one top-level node with no children and no transform, ground level at y = 0, trunk at
 * the origin, in meters. So each one can be instanced as is. Materials and textures are shared.
 * Rocks reach a little below y = 0 so that their undercut base is buried.
 *
 * Needs: npm i @gltf-transform/core @gltf-transform/extensions meshoptimizer sharp
 * Run:   node tools/build-forest.mjs <packs> <converted> <client/public>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , PACKS, CONVERTED, PUBLIC] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

const Q = `${PACKS}/q-nature/x/glTF`;
const K = `${PACKS}/kenney-nature/x/Models/GLTF format`;
const TEX = {
  qBarkDead: `${Q}/Bark_DeadTree.png`,
  qBarkTwisted: `${Q}/Bark_TwistedTree.png`,
  qBarkNormal: `${Q}/Bark_NormalTree.png`,
  qLeafWhite: `${Q}/Leaves_TwistedTree.png`,
  qLeafRed: `${Q}/Leaves_TwistedTree_C.png`,
  qLeafPine: `${Q}/Leaf_Pine_C.png`,
  qLeaves: `${Q}/Leaves.png`,
  qGrass: `${Q}/Grass.png`,
  qRock: `${Q}/Rocks_Diffuse.png`,
  qMushroom: `${Q}/Mushrooms.png`,
  deadGradient: `${CONVERTED}/tex/dead_Texture.png`,
  psxBarkDark: `${CONVERTED}/tex/psx_tree_bark_dark.png`,
  psxBarkPine: `${CONVERTED}/tex/psx_tree_bark_pine.png`,
  psxBarkLight: `${CONVERTED}/tex/psx_tree_bark_light.png`,
  psxLeafOak: `${CONVERTED}/tex/psx_leaves_oak.png`,
  psxLeafPine: `${CONVERTED}/tex/psx_leaves_pine.png`,
  psxLeafBirch: `${CONVERTED}/tex/psx_leaves_birch.png`,
  psxFern: `${CONVERTED}/tex/psx_fern.png`,
  psxTallPlant: `${CONVERTED}/tex/psx_tall_plant.png`,
  psxSmallPlant: `${CONVERTED}/tex/psx_small_plant.png`,
  psxRock: `${CONVERTED}/tex/psx_rock.png`,
};

// One color grade per kind of surface, so that all the packs share a palette.
// sat pulls toward gray, val darkens, tint multiplies. Values are in sRGB.
const GRADES = {
  bark: { sat: 0.55, val: 0.62, tint: [1.0, 0.95, 0.88] },
  barkDead: { sat: 0.35, val: 0.72, tint: [1.0, 0.97, 0.94] },
  // The Quaternius twisted leaf mask is plain white, so this tint is its whole color.
  leafMoss: { sat: 1, val: 1, tint: [0.2, 0.235, 0.13] },
  leafBlood: { sat: 0.7, val: 0.5, tint: [1.0, 0.8, 0.75] },
  leaf: { sat: 0.5, val: 0.5, tint: [0.86, 0.95, 0.72] },
  pine: { sat: 0.5, val: 0.48, tint: [0.72, 0.9, 0.82] },
  undergrowth: { sat: 0.5, val: 0.55, tint: [0.92, 0.95, 0.68] },
  rock: { sat: 0.35, val: 0.62, tint: [0.97, 0.98, 1.0] },
  mushroom: { sat: 0.55, val: 0.7, tint: [1.0, 0.92, 0.82] },
  ground: { sat: 0.55, val: 0.55, tint: [1.0, 0.96, 0.82] },
  stone: { sat: 0.45, val: 0.6, tint: [1.0, 0.97, 0.9] },
};

// The shared output materials. name: [texture, grade, size, alpha].
const MATS = {
  bark_dead: ['qBarkDead', 'barkDead', 256, false],
  bark_twisted: ['qBarkTwisted', 'bark', 256, false],
  bark_normal: ['qBarkNormal', 'bark', 256, false],
  bark_gradient: ['deadGradient', 'barkDead', 128, false],
  bark_psx_dark: ['psxBarkDark', 'bark', 128, false],
  bark_psx_pine: ['psxBarkPine', 'bark', 128, false],
  bark_psx_light: ['psxBarkLight', 'bark', 128, false],
  leaf_moss: ['qLeafWhite', 'leafMoss', 256, true],
  leaf_blood: ['qLeafRed', 'leafBlood', 256, true],
  leaf_pine: ['qLeafPine', 'pine', 256, true],
  leaf_plant: ['qLeaves', 'undergrowth', 256, true],
  leaf_psx_oak: ['psxLeafOak', 'leaf', 64, true],
  leaf_psx_pine: ['psxLeafPine', 'pine', 64, true],
  leaf_psx_birch: ['psxLeafBirch', 'leaf', 64, true],
  plant_psx_fern: ['psxFern', 'undergrowth', 64, true],
  plant_psx_tall: ['psxTallPlant', 'undergrowth', 64, true],
  plant_psx_small: ['psxSmallPlant', 'undergrowth', 32, true],
  grass: ['qGrass', 'undergrowth', 64, false],
  rock: ['qRock', 'rock', 256, false],
  rock_psx: ['psxRock', 'rock', 128, false],
  mushroom: ['qMushroom', 'mushroom', 256, false],
};

/** Source material name to output material. */
const Q_MAT = {
  Bark_DeadTree: 'bark_dead', Bark_TwistedTree: 'bark_twisted', Bark_NormalTree: 'bark_normal',
  Leaves_TwistedTree: 'leaf_moss', Leaves_Pine: 'leaf_pine', Leaves: 'leaf_plant', Grass: 'grass',
  Rocks: 'rock', Mushrooms: 'mushroom',
};
const PSX_MAT = {
  tree_bark_dark: 'bark_psx_dark', tree_bark_pine: 'bark_psx_pine', tree_bark_light: 'bark_psx_light',
  leaves_oak: 'leaf_psx_oak', leaves_pine: 'leaf_psx_pine', leaves_birch: 'leaf_psx_birch', leaves_yellow: 'leaf_psx_birch',
  fern: 'plant_psx_fern', tall_plant: 'plant_psx_tall', small_plant: 'plant_psx_small', rock: 'rock_psx',
};
// Kenney models are flat colored. They get real textures through box projection, see boxUV.
// Bark that the player sees the cut end of, for stumps and logs made from tree trunks.
const CAP_MATERIAL = 'bark_psx_light';
// Crown materials stay double sided. Everything else that is thin gets a second, reversed set of
// triangles over the same vertices, with normals tipped upward, so no side of a plant renders black.
const DOUBLE_SIDED = new Set(['leaf_moss', 'leaf_blood', 'leaf_pine']);
const THIN = /^(leaf|plant|grass)/;

const K_MAT = { woodBark: 'bark_psx_dark', woodInner: 'bark_psx_light' };

const q = (file) => ({ file: `${Q}/${file}.gltf`, mats: Q_MAT });
const ps = (file) => ({ file: `${CONVERTED}/psx_${file}.glb`, mats: PSX_MAT, flipV: true });
const dead = (i) => ({ file: `${CONVERTED}/dead_${i}.glb`, mats: { DeadTreee: 'bark_gradient' }, flipV: true });
const k = (file, mats = K_MAT) => ({ file: `${K}/${file}.glb`, mats, box: true });

/**
 * The prop list. height is the size in meters baked into the file. barkTris and leafTris cap the
 * triangle count. blocks means the game should give it a collider, using the measured footprint.
 */
const PROPS = [
  // Dead and gnarled.
  { name: 'tree_dead_a', kind: 'tree', ...dead(1), height: 7.5, blocks: true },
  { name: 'tree_dead_b', kind: 'tree', ...dead(2), height: 8.5, blocks: true },
  { name: 'tree_dead_c', kind: 'tree', ...dead(3), height: 8, blocks: true },
  { name: 'tree_dead_d', kind: 'tree', ...dead(4), height: 7, blocks: true },
  { name: 'tree_dead_e', kind: 'tree', ...dead(5), height: 9, blocks: true },
  { name: 'tree_gnarled_a', kind: 'tree', ...q('DeadTree_1'), height: 10, barkTris: 1400, blocks: true },
  { name: 'tree_gnarled_b', kind: 'tree', ...q('DeadTree_3'), height: 12, barkTris: 1400, blocks: true },
  { name: 'tree_gnarled_c', kind: 'tree', ...q('DeadTree_5'), height: 14, barkTris: 1400, blocks: true },
  { name: 'tree_snag', kind: 'tree', ...ps('tree_dead'), height: 7, blocks: true },
  // Living but dark.
  { name: 'tree_twisted_a', kind: 'tree', ...q('TwistedTree_1'), height: 14, barkTris: 800, leafTris: 650, blocks: true },
  { name: 'tree_twisted_b', kind: 'tree', ...q('TwistedTree_3'), height: 13, barkTris: 800, leafTris: 650, blocks: true },
  { name: 'tree_twisted_blood', kind: 'tree', ...q('TwistedTree_4'), mats: { ...Q_MAT, Leaves_TwistedTree: 'leaf_blood' }, height: 13, barkTris: 800, leafTris: 650, blocks: true },
  { name: 'tree_pine_a', kind: 'tree', ...q('Pine_4'), height: 13, barkTris: 500, leafTris: 950, blocks: true },
  { name: 'tree_pine_b', kind: 'tree', ...q('Pine_5'), height: 11, barkTris: 500, leafTris: 950, blocks: true },
  { name: 'tree_pine_c', kind: 'tree', ...q('Pine_1'), height: 9, barkTris: 500, leafTris: 950, blocks: true },
  { name: 'tree_pine_psx', kind: 'tree', ...ps('tree_tall'), height: 12, blocks: true },
  { name: 'tree_oak_psx', kind: 'tree', ...ps('tree_big'), height: 10, blocks: true },
  { name: 'tree_birch_psx', kind: 'tree', ...ps('tree_med'), height: 8, blocks: true },
  { name: 'tree_sapling', kind: 'tree', ...ps('tree_sapling'), height: 3.2 },
  // Rocks and boulders.
  { name: 'boulder_a', kind: 'rock', ...q('Rock_Medium_1'), height: 2.6, sink: 0.14, blocks: true },
  { name: 'boulder_b', kind: 'rock', ...q('Rock_Medium_2'), height: 2.0, sink: 0.14, blocks: true },
  { name: 'boulder_c', kind: 'rock', ...q('Rock_Medium_3'), height: 3.4, sink: 0.14, blocks: true },
  { name: 'rock_spire', kind: 'rock', ...q('Rock_Medium_1'), tilt: 80, widen: 0.6, height: 4.2, sink: 0.08, blocks: true },
  { name: 'rock_slab', kind: 'rock', ...q('Rock_Medium_2'), widen: 1.5, height: 0.9, sink: 0.14, blocks: true },
  { name: 'rock_psx_a', kind: 'rock', ...ps('rock_1'), height: 1.2, sink: 0.2, blocks: true },
  { name: 'rock_small', kind: 'ground-detail', ...q('Rock_Medium_3'), height: 0.4, sink: 0.14, barkTris: 60 },
  // Undergrowth.
  { name: 'bush_a', kind: 'bush', ...q('Bush_Common'), height: 1.1, leafTris: 400 },
  { name: 'bush_blood', kind: 'bush', ...q('Bush_Common'), mats: { ...Q_MAT, Leaves_TwistedTree: 'leaf_blood' }, height: 0.9, leafTris: 400 },
  { name: 'bush_tall', kind: 'bush', ...ps('plant_tall'), height: 1.4 },
  { name: 'fern_a', kind: 'bush', ...q('Fern_1'), height: 0.7 },
  { name: 'fern_psx', kind: 'bush', ...ps('plant_fern'), height: 0.6 },
  { name: 'plant_broad', kind: 'bush', ...q('Plant_1'), height: 0.8 },
  { name: 'grass_short', kind: 'ground-detail', ...q('Grass_Common_Short'), height: 0.4, widen: 1.8, barkTris: 40 },
  { name: 'grass_tall', kind: 'ground-detail', ...q('Grass_Common_Tall'), height: 0.75, widen: 1.8, barkTris: 70 },
  { name: 'grass_wispy', kind: 'ground-detail', ...q('Grass_Wispy_Tall'), height: 0.6, widen: 1.5, barkTris: 90 },
  { name: 'grass_psx', kind: 'ground-detail', ...ps('plant_small'), height: 0.45 },
  { name: 'mushroom_a', kind: 'ground-detail', ...q('Mushroom_Common'), height: 0.3, barkTris: 200 },
  { name: 'mushroom_shelf', kind: 'ground-detail', ...q('Mushroom_Laetiporus'), height: 0.35, barkTris: 400 },
  // Logs and stumps. These are the real bottoms of the dead trees, cut and capped, so they match.
  { name: 'stump_a', kind: 'log', ...q('DeadTree_1'), cut: { lo: 0, hi: 0.13, jag: 0.012 }, height: 1.0, barkTris: 300, blocks: true },
  { name: 'stump_b', kind: 'log', ...q('DeadTree_4'), cut: { lo: 0, hi: 0.1, jag: 0.03 }, height: 1.5, barkTris: 300, blocks: true },
  { name: 'stump_c', kind: 'log', ...q('DeadTree_2'), cut: { lo: 0, hi: 0.07, jag: 0.004 }, height: 0.6, barkTris: 250, blocks: true },
  { name: 'log_a', kind: 'log', ...q('DeadTree_3'), cut: { lo: 0.1, hi: 0.42, jag: 0.012 }, lay: true, scale: 0.42, barkTris: 300, blocks: true },
  { name: 'log_b', kind: 'log', ...q('DeadTree_5'), cut: { lo: 0.05, hi: 0.3, jag: 0.012 }, lay: true, scale: 0.4, barkTris: 300, blocks: true },
  { name: 'log_pile', kind: 'log', ...k('log_stack'), height: 0.9, blocks: true },
];

// Ground textures: output name, source file, grade. Sources are CC0 only.
const GROUND = [
  ['forest', `tinytex/x/128x128/Grass/Grass_04-128x128.png`, 'ground'],
  ['moss', `tinytex/x/128x128/Grass/Grass_19-128x128.png`, 'ground'],
  ['earth', `tinytex/x/128x128/Grass/Grass_12-128x128.png`, 'ground'],
  ['rubble', `tinytex/x/128x128/Grass/Grass_07-128x128.png`, 'ground'],
  ['dirt', `kenney-retro/x/PNG/floor_ground_dirt.png`, 'stone'],
  ['road', `kenney-retro/x/PNG/floor_stone_pattern.png`, 'stone'],
  ['stone', `kenney-retro/x/PNG/wall_rock.png`, 'stone'],
];

function gradePixels(data, channels, grade) {
  const { sat, val, tint } = GRADES[grade];
  for (let i = 0; i < data.length; i += channels) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    for (let c = 0; c < 3; c += 1) {
      const v = (luma + (data[i + c] - luma) * sat) * val * tint[c];
      data[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
}

/** Spreads color into fully transparent pixels so that bilinear filtering does not draw dark fringes. */
function bleedAlpha(data, w, h, passes = 6) {
  let known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) known[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  for (let p = 0; p < passes; p += 1) {
    const next = known.slice();
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
          if (!known[j]) continue;
          r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; n += 1;
        }
        if (!n) continue;
        data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n;
        next[i] = 1;
      }
    }
    known = next;
  }
}

async function gradedImage(file, grade, size, alpha, format = 'webp') {
  const { data, info } = await sharp(readFileSync(file)).ensureAlpha()
    .resize(size, size, { fit: 'fill', kernel: size <= 128 ? 'lanczos2' : 'lanczos3' })
    .raw().toBuffer({ resolveWithObject: true });
  gradePixels(data, 4, grade);
  if (alpha) bleedAlpha(data, info.width, info.height);
  const image = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  return format === 'webp' ? image.webp({ quality: 88, alphaQuality: 95 }).toBuffer() : image.removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/** Reads every mesh of a source file into plain arrays, grouped by source material, in world space. */
async function readSource(file) {
  const doc = await io.read(file);
  const groups = new Map();
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      const nm = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? '_defaultMat';
        if (!groups.has(name)) groups.set(name, { pos: [], nor: [], uv: [], idx: [] });
        const g = groups.get(name);
        const base = g.pos.length / 3;
        const P = prim.getAttribute('POSITION');
        const N = prim.getAttribute('NORMAL');
        const T = prim.getAttribute('TEXCOORD_0');
        const [p, n, t] = [[0, 0, 0], [0, 1, 0], [0, 0]];
        for (let i = 0; i < P.getCount(); i += 1) {
          P.getElement(i, p);
          g.pos.push(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]);
          if (N) N.getElement(i, n);
          const nx = nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2];
          const ny = nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2];
          const nz = nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2];
          const len = Math.hypot(nx, ny, nz) || 1;
          g.nor.push(nx / len, ny / len, nz / len);
          if (T) T.getElement(i, t);
          g.uv.push(T ? t[0] : 0, T ? t[1] : 0);
        }
        const I = prim.getIndices();
        const count = I ? I.getCount() : P.getCount();
        for (let i = 0; i < count; i += 1) g.idx.push(base + (I ? I.getScalar(i) : i));
      }
    });
  }
  return groups;
}

function compact(g, indices) {
  const remap = new Map();
  const out = { pos: [], nor: [], uv: [], idx: [] };
  for (const v of indices) {
    if (!remap.has(v)) {
      remap.set(v, remap.size);
      out.pos.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
      out.nor.push(g.nor[v * 3], g.nor[v * 3 + 1], g.nor[v * 3 + 2]);
      out.uv.push(g.uv[v * 2], g.uv[v * 2 + 1]);
    }
    out.idx.push(remap.get(v));
  }
  return out;
}

/** Reduces solid geometry. meshoptimizer collapses along UV seams, so the bark mapping survives. */
function simplifySolid(g, maxTris) {
  if (g.idx.length / 3 <= maxTris) return g;
  const positions = new Float32Array(g.pos);
  const indices = new Uint32Array(g.idx);
  let [result] = MeshoptSimplifier.simplify(indices, positions, 3, maxTris * 3, 0.03, []);
  if (result.length / 3 > maxTris) [result] = MeshoptSimplifier.simplify(indices, positions, 3, maxTris * 3, 0.2, []);
  if (result.length / 3 > maxTris) [result] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, maxTris * 3, 1);
  return compact(g, result);
}

/** Reduces leaf cards by dropping whole cards and enlarging the rest, so the crown keeps its volume. */
function thinCards(g, maxTris) {
  const tris = g.idx.length / 3;
  if (tris <= maxTris) return g;
  const parent = new Int32Array(g.pos.length / 3).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < g.idx.length; i += 3) {
    parent[find(g.idx[i + 1])] = find(g.idx[i]);
    parent[find(g.idx[i + 2])] = find(g.idx[i]);
  }
  const islands = new Map();
  for (let i = 0; i < g.idx.length; i += 3) {
    const root = find(g.idx[i]);
    if (!islands.has(root)) islands.set(root, []);
    islands.get(root).push(g.idx[i], g.idx[i + 1], g.idx[i + 2]);
  }
  const list = [...islands.values()];
  // A fixed stride rather than chance, so that the result is the same on every build.
  const keep = maxTris / tris;
  const grow = Math.min(1.7, Math.sqrt(1 / keep) * 0.95);
  const pos = g.pos.slice();
  const kept = [];
  const moved = new Set();
  let debt = 0;
  for (const island of list) {
    debt += keep;
    if (debt < 1 && list.length > 1) continue;
    debt -= 1;
    if ((kept.length + island.length) / 3 > maxTris * 1.05) continue;
    kept.push(...island);
    const verts = [...new Set(island)];
    const c = [0, 0, 0];
    for (const v of verts) for (let a = 0; a < 3; a += 1) c[a] += g.pos[v * 3 + a] / verts.length;
    for (const v of verts) {
      if (moved.has(v)) continue;
      moved.add(v);
      for (let a = 0; a < 3; a += 1) pos[v * 3 + a] = c[a] + (g.pos[v * 3 + a] - c[a]) * grow;
    }
  }
  return compact({ ...g, pos }, kept);
}

/** Box-projected UVs for models without a usable mapping. Splits vertices per face. */
function boxUV(g, density) {
  const out = { pos: [], nor: [], uv: [], idx: [] };
  for (let i = 0; i < g.idx.length; i += 3) {
    const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
    const v = (n) => [g.pos[n * 3], g.pos[n * 3 + 1], g.pos[n * 3 + 2]];
    const [A, B, C] = [v(a), v(b), v(c)];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [Math.abs(u[1] * w[2] - u[2] * w[1]), Math.abs(u[2] * w[0] - u[0] * w[2]), Math.abs(u[0] * w[1] - u[1] * w[0])];
    const axis = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
    for (const vert of [a, b, c]) {
      const p = v(vert);
      out.idx.push(out.pos.length / 3);
      out.pos.push(...p);
      out.nor.push(g.nor[vert * 3], g.nor[vert * 3 + 1], g.nor[vert * 3 + 2]);
      if (axis === 0) out.uv.push(p[2] * density, p[1] * density);
      else if (axis === 1) out.uv.push(p[0] * density, p[2] * density);
      else out.uv.push(p[0] * density, p[1] * density);
    }
  }
  return out;
}

/**
 * Makes a stump or log from a tree: keeps one height band of the trunk and closes the cut ends.
 * Returns the trunk and the new end caps as separate parts. lo, hi and jag are fractions of the height.
 */
function cutTrunk(g, { lo, hi, jag }) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < g.pos.length; i += 3) { minY = Math.min(minY, g.pos[i]); maxY = Math.max(maxY, g.pos[i]); }
  const span = maxY - minY;
  const [loY, hiY] = [minY + lo * span, minY + hi * span];
  // Seams split vertices, so connectivity has to be worked out by position.
  const weld = new Map();
  const id = (v) => {
    const key = `${g.pos[v * 3].toFixed(4)},${g.pos[v * 3 + 1].toFixed(4)},${g.pos[v * 3 + 2].toFixed(4)}`;
    if (!weld.has(key)) weld.set(key, weld.size);
    return weld.get(key);
  };
  const kept = [];
  for (let i = 0; i < g.idx.length; i += 3) {
    const ys = [0, 1, 2].map((c) => g.pos[g.idx[i + c] * 3 + 1]);
    if (Math.max(...ys) >= loY && Math.min(...ys) <= hiY) kept.push(g.idx[i], g.idx[i + 1], g.idx[i + 2]);
  }
  // Keep only the largest connected piece: branches that merely cross the band are dropped.
  const parent = new Map();
  const find = (a) => { if (!parent.has(a)) parent.set(a, a); while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  for (let i = 0; i < kept.length; i += 3) { parent.set(find(id(kept[i + 1])), find(id(kept[i]))); parent.set(find(id(kept[i + 2])), find(id(kept[i]))); }
  const sizes = new Map();
  for (let i = 0; i < kept.length; i += 3) sizes.set(find(id(kept[i])), (sizes.get(find(id(kept[i]))) ?? 0) + 1);
  const biggest = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const trunk = [];
  for (let i = 0; i < kept.length; i += 3) if (find(id(kept[i])) === biggest) trunk.push(kept[i], kept[i + 1], kept[i + 2]);
  const out = compact(g, trunk);
  // Flatten the ends onto the cut planes, with a little noise so that a break looks broken.
  const noise = (x, z) => (Math.sin(x * 37.1 + z * 11.3) + Math.sin(x * 13.7 - z * 29.9)) * 0.5 * jag * span;
  const side = new Map();
  for (let v = 0; v < out.pos.length / 3; v += 1) {
    const [x, y, z] = [out.pos[v * 3], out.pos[v * 3 + 1], out.pos[v * 3 + 2]];
    if (y > hiY) { out.pos[v * 3 + 1] = hiY + noise(x, z); side.set(v, 1); }
    else if (y < loY && lo > 0) { out.pos[v * 3 + 1] = loY + noise(x, z); side.set(v, -1); }
  }
  // An edge used by one triangle is an open edge. Close each end with a fan.
  const edges = new Map();
  const key2 = (p, r) => `${p}|${r}`;
  const pid = (v) => `${out.pos[v * 3].toFixed(4)},${out.pos[v * 3 + 2].toFixed(4)},${side.get(v) ?? 0}`;
  for (let i = 0; i < out.idx.length; i += 3) {
    for (const [a, b] of [[out.idx[i], out.idx[i + 1]], [out.idx[i + 1], out.idx[i + 2]], [out.idx[i + 2], out.idx[i]]]) {
      if (!side.has(a) || side.get(a) !== side.get(b)) continue;
      const [pa, pb] = [pid(a), pid(b)];
      const k = pa < pb ? key2(pa, pb) : key2(pb, pa);
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push([a, b]);
    }
  }
  const caps = { pos: [], nor: [], uv: [], idx: [] };
  for (const s of [1, -1]) {
    const open = [...edges.values()].filter((e) => e.length === 1 && side.get(e[0][0]) === s).map((e) => e[0]);
    if (!open.length) continue;
    const c = [0, 0, 0];
    let weight = 0;
    let radius = 0;
    for (const [a] of open) { for (let n = 0; n < 3; n += 1) c[n] += out.pos[a * 3 + n]; weight += 1; }
    for (let n = 0; n < 3; n += 1) c[n] /= weight;
    for (const [a] of open) radius = Math.max(radius, Math.hypot(out.pos[a * 3] - c[0], out.pos[a * 3 + 2] - c[2]));
    const vertex = (x, y, z) => {
      caps.pos.push(x, y, z);
      caps.nor.push(0, s, 0);
      caps.uv.push(0.5 + ((x - c[0]) / radius) * 0.4, 0.5 + ((z - c[2]) / radius) * 0.4);
      return caps.pos.length / 3 - 1;
    };
    for (const [a, b] of open) {
      const [ax, ay, az] = [out.pos[a * 3], out.pos[a * 3 + 1], out.pos[a * 3 + 2]];
      const [bx, by, bz] = [out.pos[b * 3], out.pos[b * 3 + 1], out.pos[b * 3 + 2]];
      const up = (ax - c[0]) * (bz - c[2]) - (az - c[2]) * (bx - c[0]);
      // In glTF a counterclockwise triangle seen from above has a negative value here.
      const flip = s > 0 ? up > 0 : up < 0;
      const [ia, ib, ic] = [vertex(ax, ay, az), vertex(bx, by, bz), vertex(c[0], c[1] - s * jag * span, c[2])];
      caps.idx.push(...(flip ? [ib, ia, ic] : [ia, ib, ic]));
    }
  }
  return { trunk: out, caps };
}

/** Second set of triangles facing the other way, over the same vertices, with upward normals. */
function twoSided(g) {
  const nor = g.nor.slice();
  for (let i = 0; i < nor.length; i += 3) {
    const [x, y, z] = [nor[i] * 0.4, nor[i + 1] * 0.4 + 0.7, nor[i + 2] * 0.4];
    const len = Math.hypot(x, y, z) || 1;
    nor[i] = x / len; nor[i + 1] = y / len; nor[i + 2] = z / len;
  }
  const idx = g.idx.slice();
  for (let i = 0; i < g.idx.length; i += 3) idx.push(g.idx[i], g.idx[i + 2], g.idx[i + 1]);
  return { ...g, nor, idx };
}

/** Rotates all parts about the X axis. */
function rotateX(parts, degrees) {
  const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  for (const g of parts.values()) {
    for (const arr of [g.pos, g.nor]) {
      for (let i = 0; i < arr.length; i += 3) {
        const [y, z] = [arr[i + 1], arr[i + 2]];
        arr[i + 1] = y * c - z * s;
        arr[i + 2] = y * s + z * c;
      }
    }
  }
}

function percentile(values, q01) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q01))];
}

/** Scales the prop to its height, stands it on y = 0, and centers the trunk or base on the origin. */
function placeProp(parts, prop) {
  let min = Infinity, max = -Infinity;
  for (const g of parts.values()) for (let i = 1; i < g.pos.length; i += 3) { min = Math.min(min, g.pos[i]); max = Math.max(max, g.pos[i]); }
  const scale = prop.scale ?? prop.height / (max - min);
  const widen = prop.widen ?? 1;
  const height = (max - min) * scale;
  for (const g of parts.values()) {
    for (let i = 0; i < g.pos.length; i += 3) {
      g.pos[i] *= scale * widen;
      g.pos[i + 1] = (g.pos[i + 1] - min) * scale;
      g.pos[i + 2] *= scale * widen;
    }
  }
  // Measure from what is solid near the ground. Leaves, if any, do not count.
  const solid = [...parts.entries()].filter(([m]) => !/^(leaf|plant)/.test(m)).map(([, g]) => g);
  const pool = solid.length ? solid : [...parts.values()];
  // Slice the solid parts with a horizontal plane: 0.4 m up a tree, below any branch, or partway up anything else. Slicing
  // works on models with very long triangles, which may have no vertices near the ground at all.
  const sliceY = prop.kind === 'tree' ? 0.4 : height * 0.35;
  const xz = [];
  for (const g of pool) {
    for (let i = 0; i < g.idx.length; i += 3) {
      for (const [a, b] of [[g.idx[i], g.idx[i + 1]], [g.idx[i + 1], g.idx[i + 2]], [g.idx[i + 2], g.idx[i]]]) {
        const [ya, yb] = [g.pos[a * 3 + 1], g.pos[b * 3 + 1]];
        if ((ya < sliceY) === (yb < sliceY)) continue;
        const t = (sliceY - ya) / (yb - ya);
        xz.push([g.pos[a * 3] + (g.pos[b * 3] - g.pos[a * 3]) * t, g.pos[a * 3 + 2] + (g.pos[b * 3 + 2] - g.pos[a * 3 + 2]) * t]);
      }
    }
  }
  // A low branch can cross the plane too, so center on the medians and ignore far outliers.
  const cx = percentile(xz.map((p) => p[0]), 0.5);
  const cz = percentile(xz.map((p) => p[1]), 0.5);
  const distances = xz.map(([x, z]) => Math.hypot(x - cx, z - cz));
  const typical = percentile(distances, 0.5);
  const footprint = percentile(distances.filter((d) => d < typical * 2.5), 0.9);
  const sink = (prop.sink ?? 0) * height;
  for (const g of parts.values()) for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] -= cx; g.pos[i + 1] -= sink; g.pos[i + 2] -= cz; }
  return { scale, footprint: Math.round(footprint * 100) / 100 };
}

const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(false);
const buffer = doc.createBuffer();
const scene = doc.createScene('forest');
const materials = new Map();

async function materialFor(name) {
  if (materials.has(name)) return materials.get(name);
  const [texKey, grade, size, alpha] = MATS[name];
  const texture = doc.createTexture(texKey).setMimeType('image/webp').setImage(await gradedImage(TEX[texKey], grade, size, alpha)).setURI(`${texKey}.webp`);
  const material = doc.createMaterial(name).setBaseColorTexture(texture).setRoughnessFactor(1).setMetallicFactor(0);
  if (alpha) material.setAlphaMode('MASK').setAlphaCutoff(0.5);
  if (DOUBLE_SIDED.has(name)) material.setDoubleSided(true);
  materials.set(name, material);
  return material;
}

const report = [];
for (const prop of PROPS) {
  const source = await readSource(prop.file);
  const parts = new Map();
  for (const [sourceName, group] of source) {
    const matName = prop.mats[sourceName];
    if (!matName) throw new Error(`${prop.name}: no material mapping for "${sourceName}"`);
    let g = group;
    if (prop.flipV) for (let i = 1; i < g.uv.length; i += 2) g.uv[i] = 1 - g.uv[i];
    if (parts.has(matName)) {
      const into = parts.get(matName);
      const base = into.pos.length / 3;
      into.pos.push(...g.pos); into.nor.push(...g.nor); into.uv.push(...g.uv); into.idx.push(...g.idx.map((v) => v + base));
    } else parts.set(matName, g);
  }
  if (prop.cut) {
    const [[barkName, bark]] = parts;
    const { trunk, caps } = cutTrunk(bark, prop.cut);
    parts.set(barkName, trunk);
    parts.set(CAP_MATERIAL, caps);
  }
  if (prop.tilt) rotateX(parts, prop.tilt);
  if (prop.lay) {
    // Lie down, then turn so that the length runs along X.
    rotateX(parts, 90);
    for (const g of parts.values()) {
      for (const arr of [g.pos, g.nor]) {
        for (let i = 0; i < arr.length; i += 3) [arr[i], arr[i + 2]] = [arr[i + 2], -arr[i]];
      }
    }
  }
  const placed = placeProp(parts, prop);
  const mesh = doc.createMesh(prop.name);
  let tris = 0;
  let top = 0;
  for (const [matName, g0] of parts) {
    let g = g0;
    if (/^(leaf|plant)/.test(matName) && prop.leafTris) g = thinCards(g, prop.leafTris);
    else if (prop.barkTris) g = simplifySolid(g, prop.barkTris);
    if (THIN.test(matName) && !DOUBLE_SIDED.has(matName)) g = twoSided(g);
    if (prop.box) {
      // Texture repeats every 1.5 m, independent of the size of the prop.
      g = boxUV(g, 1 / 1.5);
    }
    const count = g.pos.length / 3;
    const IndexArray = count < 65535 ? Uint16Array : Uint32Array;
    const prim = doc.createPrimitive()
      .setMaterial(await materialFor(matName))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new IndexArray(g.idx)).setBuffer(buffer))
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.nor)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer));
    mesh.addPrimitive(prim);
    tris += g.idx.length / 3;
    for (let i = 1; i < g.pos.length; i += 3) top = Math.max(top, g.pos[i]);
  }
  scene.addChild(doc.createNode(prop.name).setMesh(mesh));
  report.push({ name: prop.name, kind: prop.kind, scale: 1, height: Math.round(top * 100) / 100, footprint: prop.blocks ? placed.footprint : 0, tris });
}

mkdirSync(`${PUBLIC}/models/world`, { recursive: true });
mkdirSync(`${PUBLIC}/textures`, { recursive: true });
await io.write(`${PUBLIC}/models/world/forest.glb`, doc);
for (const [name, source, grade] of GROUND) {
  writeFileSync(path.join(PUBLIC, 'textures', `ground-${name}.png`), await gradedImage(`${PACKS}/${source}`, grade, 128, false, 'png'));
}
console.log(JSON.stringify(report));
