/**
 * Rebuilds client/public/models/world/castle.glb and props.glb from CC0 downloads.
 *
 * The raw packs are large, so they stay out of the repo. Unzip them into one folder:
 *   qruins/glb/*.glb   Quaternius Ultimate Modular Ruins, https://quaternius.com/packs/ultimatemodularruins.html
 *                      It ships FBX only. Convert each file first in a browser page with Three:
 *                      new GLTFExporter().parseAsync(await new FBXLoader().loadAsync(file), { binary: true })
 *   qprops/x/...       Quaternius Fantasy Props MegaKit, https://quaternius.itch.io/fantasy-props-megakit
 *   qvillage/x/...     Quaternius Medieval Village MegaKit, https://quaternius.itch.io/medieval-village-megakit
 *   chilly/x/...       3D Retro Medieval Kit, textures only, https://chilly-durango.itch.io/medieval-building-parts
 *   kcastle/x/...      Kenney Castle Kit, https://kenney.nl/assets/castle-kit
 *
 * Every piece is baked to meters with an identity top-level node, so a node's origin is the
 * origin described in PIECES. The flat colors of the ruins are replaced by box-mapped dark stone
 * and wood textures. Nothing here uses meshopt or Draco, since the game's loader has no decoders.
 *
 * Needs: npm i @gltf-transform/core @gltf-transform/extensions meshoptimizer sharp
 * Run:   node tools/build-castle.mjs <folder with the unzipped packs> <output folder>
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , PACKS, OUT] = process.argv;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const RUINS = `${PACKS}/qruins/glb`;
const PROPS = `${PACKS}/qprops/x/Exports/glTF`;
const VILLAGE = `${PACKS}/qvillage/x/Medieval Village MegaKit[Standard]/glTF`;
const KENNEY = `${PACKS}/kcastle/x/Models/GLB format`;
const CHILLY = `${PACKS}/chilly/x/3D Retro Medieval Fantasy Kit/Textures`;
const PROP_TEX = `${PACKS}/qprops/x/Textures`;

/** Scale of the ruins kit: its 2 m wall becomes 3 m, so a two-by-two block is the 6 m module. */
const K = 1.5;
const MODULE = 6;
const TILE = 3; // Divides MODULE, so the stone texture continues across neighboring wall pieces.

// ---- Materials ----

/**
 * box: source texture box-mapped by position, with `tile` meters per repeat.
 * trim: source texture used through the model's own UVs.
 * Otherwise a flat color. Colors multiply the texture.
 */
const MATERIALS = {
  stone: { box: 'Brick-Large-Irregular', tile: TILE, color: [0.3, 0.295, 0.285], sat: 0.2 },
  statue: { box: 'Lime-Render', tile: 2, color: [0.3, 0.3, 0.31], sat: 0.2 },
  black: { color: [0.008, 0.008, 0.008] },
  wood: { box: 'Wood-Dark', tile: 1.5, color: [0.62, 0.55, 0.47], sat: 0.8 },
  wood_dark: { box: 'Wood-Dark', tile: 1.5, color: [0.3, 0.26, 0.22], sat: 0.8 },
  iron: { color: [0.035, 0.036, 0.042], metal: 0.7, rough: 0.6 },
  iron_light: { color: [0.08, 0.082, 0.09], metal: 0.7, rough: 0.55 },
  banner_gold: { box: 'Fabric-Cord', tile: 1.2, color: [0.42, 0.27, 0.07], sat: 0.2, twoSided: true },
  banner_crimson: { box: 'Fabric-Cord', tile: 1.2, color: [0.2, 0.025, 0.02], sat: 0.2, twoSided: true },
  fire: { color: [0.1, 0.03, 0.0], emissive: [1, 0.36, 0.05] },
  ember: { color: [0.25, 0.05, 0.01], emissive: [0.75, 0.16, 0.02] },
  candle: { color: [0.3, 0.26, 0.17] },
  clay: { box: 'Adobe', tile: 1, color: [0.3, 0.22, 0.17], sat: 0.6 },
  clay_band: { box: 'Adobe', tile: 1, color: [0.14, 0.05, 0.04], sat: 0.6 },
  bone: { color: [0.33, 0.28, 0.19] },
  gold: { color: [0.5, 0.33, 0.08], metal: 0.8, rough: 0.5 },
  paper: { color: [0.25, 0.2, 0.12] },
  book_red: { color: [0.08, 0.01, 0.01] },
  book_green: { color: [0.01, 0.03, 0.012] },
  book_blue: { color: [0.008, 0.012, 0.04] },
  furniture: { trim: `${PROP_TEX}/T_Trim_Furniture_BaseColor.png`, color: [0.26, 0.2, 0.17] },
  metal_trim: { trim: `${PROP_TEX}/T_Trim_Metal_BaseColor.png`, color: [0.55, 0.55, 0.58], metal: 0.5, rough: 0.6 },
  props_trim: { trim: `${PROP_TEX}/T_Trim_Props_BaseColor.png`, color: [0.55, 0.5, 0.45] },
  fence: { color: [0.03, 0.03, 0.036], metal: 0.7, rough: 0.6 },
};

/** Source material name to ours. Leaves and moss are dropped, so the ruins stay barren. */
const REMAP = {
  Main: 'stone', Main2: 'stone', Highlights: 'stone', Stone: 'statue', Black: 'black',
  Wood: 'wood', DarkWood: 'wood_dark', Metal: 'iron', Metal_Light: 'iron_light', DarkMetal: 'iron',
  Flag: 'banner_gold', Fire: 'fire', Light: 'ember', Candle: 'candle',
  Pot_Main: 'clay', Pot_Detail: 'clay_band', Bone: 'bone', Gold: 'gold', Pages: 'paper',
  Book: 'book_red', Book2: 'book_green', Book3: 'book_blue', Book4: 'book_blue',
  MI_Trim_Furniture: 'furniture', MI_Trim_Props_Vertex: 'candle', MI_Trim_Metal: 'metal_trim', MI_Trim_Props: 'props_trim',
};

// ---- Reading source files into triangle soups, one per source node and material ----

const multiply = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const point = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const direction = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scaling = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const rotationY = (deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const rotationX = (deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const rotationZ = (deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

const cache = new Map();
async function load(file) {
  if (cache.has(file)) return cache.get(file);
  const doc = await io.read(file);
  const soups = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // Skinned meshes are stored in bind pose, so their node transform does not apply.
    const world = node.getSkin() ? IDENTITY : [...node.getWorldMatrix()];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const soup = { node: node.getName(), material: prim.getMaterial()?.getName() ?? '', pos: [], nor: [], uv: uv ? [] : null };
      const a = [];
      for (let i = 0; i < count; i += 1) {
        const v = idx ? idx.getScalar(i) : i;
        soup.pos.push(...point(world, ...pos.getElement(v, a)));
        if (nor) soup.nor.push(...direction(world, ...nor.getElement(v, a)));
        if (uv) soup.uv.push(...uv.getElement(v, a));
      }
      soups.push(soup);
    }
  }
  cache.set(file, soups);
  return soups;
}

/** Returns copies of a file's soups moved by `place`. */
async function part(file, place, options = {}) {
  const { keepNode, keepMaterial, material } = options;
  const soups = await load(file);
  const out = [];
  for (const soup of soups) {
    if (keepMaterial && !keepMaterial(soup.material)) continue;
    const name = material?.[soup.material] ?? material?.['*'] ?? REMAP[soup.material];
    if (!name) { // Leaves and moss are meant to go. Anything else should be mapped.
      if (!/Leaf|Green|Leaves|Bark/.test(soup.material)) console.warn('unmapped material', soup.material, 'in', path.basename(file));
      continue;
    }
    const pos = []; const nor = [];
    for (let i = 0; i < soup.pos.length; i += 3) {
      pos.push(...point(place, soup.pos[i], soup.pos[i + 1], soup.pos[i + 2]));
      if (soup.nor.length) nor.push(...direction(place, soup.nor[i], soup.nor[i + 1], soup.nor[i + 2]));
    }
    if (keepNode) {
      let cx = 0; let cy = 0; let cz = 0;
      const n = pos.length / 3;
      for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
      if (!keepNode(cx / n, cy / n, cz / n, soup.node)) continue;
    }
    out.push({ material: name, pos, nor, uv: soup.uv });
  }
  return out;
}

const ruin = (name) => `${RUINS}/${name}.glb`;
const prop = (name) => `${PROPS}/${name}.gltf`;
const kenney = (name) => `${KENNEY}/${name}.glb`;
const village = (name) => `${VILLAGE}/${name}.gltf`;
/** Places a ruins file: x, y, z in meters, then yaw, at scale s of the file's centimeters. */
const at = (x, y, z, yaw = 0, s = K) => multiply(translation(x, y, z), multiply(rotationY(yaw), scaling(s * 0.01)));
/** Same for files already in meters. */
const atM = (x, y, z, yaw = 0, s = 1) => multiply(translation(x, y, z), multiply(rotationY(yaw), scaling(s)));

// ---- Baking soups into one mesh ----

const WELD = 1e-4;
function bakeBucket(tris, material, ratio) {
  const def = MATERIALS[material];
  const useTrim = Boolean(def.trim);
  // Weld by position so the simplifier can collapse across triangles.
  const map = new Map(); const verts = []; let indices = [];
  const uvs = useTrim ? [] : null; const nors = [];
  for (const soup of tris) {
    for (let i = 0; i < soup.pos.length; i += 3) {
      const x = soup.pos[i]; const y = soup.pos[i + 1]; const z = soup.pos[i + 2];
      let key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
      if (useTrim && soup.uv) key += `,${(soup.uv[(i / 3) * 2]).toFixed(3)},${(soup.uv[(i / 3) * 2 + 1]).toFixed(3)}`;
      let id = map.get(key);
      if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); if (useTrim) uvs.push(soup.uv[(i / 3) * 2], soup.uv[(i / 3) * 2 + 1]); }
      indices.push(id);
    }
  }
  // Drop triangles the weld collapsed.
  const clean = [];
  for (let i = 0; i < indices.length; i += 3) if (indices[i] !== indices[i + 1] && indices[i + 1] !== indices[i + 2] && indices[i] !== indices[i + 2]) clean.push(indices[i], indices[i + 1], indices[i + 2]);
  indices = clean;
  if (ratio < 1 && indices.length > 300) {
    const target = Math.floor(indices.length * ratio / 3) * 3;
    // UV seams split vertices in trim meshes, so their borders must stay put.
    const [out] = MeshoptSimplifier.simplify(new Uint32Array(indices), new Float32Array(verts), 3, target, 0.03, useTrim ? ['LockBorder'] : []);
    indices = [...out];
  }
  // Crease normals: a corner averages only the faces within 35 degrees of its own face.
  const faceNormal = (i) => {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const ux = verts[b * 3] - verts[a * 3]; const uy = verts[b * 3 + 1] - verts[a * 3 + 1]; const uz = verts[b * 3 + 2] - verts[a * 3 + 2];
    const vx = verts[c * 3] - verts[a * 3]; const vy = verts[c * 3 + 1] - verts[a * 3 + 1]; const vz = verts[c * 3 + 2] - verts[a * 3 + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l, l];
  };
  const faces = [];
  const touching = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const f = faceNormal(i); faces.push(f);
    for (let k = 0; k < 3; k += 1) { const v = indices[i + k]; if (!touching.has(v)) touching.set(v, []); touching.get(v).push(i / 3); }
  }
  const cos = Math.cos((35 * Math.PI) / 180);
  const outPos = []; const outNor = []; const outUv = []; const outIdx = [];
  const seen = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const f = faces[i / 3];
    const ax = Math.abs(f[0]); const ay = Math.abs(f[1]); const az = Math.abs(f[2]);
    for (let k = 0; k < 3; k += 1) {
      const v = indices[i + k];
      let nx = 0; let ny = 0; let nz = 0;
      for (const other of touching.get(v)) {
        const g = faces[other];
        if (g[0] * f[0] + g[1] * f[1] + g[2] * f[2] > cos) { nx += g[0] * g[3]; ny += g[1] * g[3]; nz += g[2] * g[3]; }
      }
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const x = verts[v * 3]; const y = verts[v * 3 + 1]; const z = verts[v * 3 + 2];
      let u = 0; let w = 0;
      if (useTrim) { u = uvs[v * 2]; w = uvs[v * 2 + 1]; } else if (def.box) {
        if (ay >= ax && ay >= az) { u = x / def.tile; w = z / def.tile; } else if (ax >= az) { u = z / def.tile; w = -y / def.tile; } else { u = x / def.tile; w = -y / def.tile; }
      }
      const key = `${v},${nx.toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)},${u.toFixed(3)},${w.toFixed(3)}`;
      let id = seen.get(key);
      if (id === undefined) { id = outPos.length / 3; seen.set(key, id); outPos.push(x, y, z); outNor.push(nx, ny, nz); outUv.push(u, w); }
      outIdx.push(id);
    }
  }
  return { pos: outPos, nor: outNor, uv: outUv, idx: outIdx };
}

class Output {
  constructor() {
    this.doc = new Document();
    this.buffer = this.doc.createBuffer();
    this.scene = this.doc.createScene('Scene');
    this.materials = new Map();
    this.textures = new Map();
    this.report = [];
  }

  async texture(file, sat) {
    const key = `${file}|${sat}`;
    if (this.textures.has(key)) return this.textures.get(key);
    const png = await sharp(file).resize(256, 256).modulate({ saturation: sat ?? 1 }).png({ compressionLevel: 9, palette: true, colors: 64 }).toBuffer();
    const tex = this.doc.createTexture(path.basename(file, '.png')).setImage(png).setMimeType('image/png');
    this.textures.set(key, tex);
    return tex;
  }

  async material(name) {
    if (this.materials.has(name)) return this.materials.get(name);
    const def = MATERIALS[name];
    const m = this.doc.createMaterial(name).setRoughnessFactor(def.rough ?? 1).setMetallicFactor(def.metal ?? 0).setDoubleSided(Boolean(def.twoSided));
    m.setBaseColorFactor([...def.color, 1]);
    if (def.box) m.setBaseColorTexture(await this.texture(`${CHILLY}/${def.box}.png`, def.sat));
    if (def.trim) m.setBaseColorTexture(await this.texture(def.trim, 0.8));
    if (def.emissive) m.setEmissiveFactor(def.emissive);
    this.materials.set(name, m);
    return m;
  }

  async mesh(name, soups, ratio) {
    const buckets = new Map();
    for (const s of soups) { if (!buckets.has(s.material)) buckets.set(s.material, []); buckets.get(s.material).push(s); }
    const mesh = this.doc.createMesh(name);
    let tris = 0;
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const [material, group] of buckets) {
      const b = bakeBucket(group, material, ratio);
      tris += b.idx.length / 3;
      for (let i = 0; i < b.pos.length; i += 3) for (let k = 0; k < 3; k += 1) { box.min[k] = Math.min(box.min[k], b.pos[i + k]); box.max[k] = Math.max(box.max[k], b.pos[i + k]); }
      const big = b.pos.length / 3 > 65000;
      const prim = this.doc.createPrimitive().setMaterial(await this.material(material))
        .setAttribute('POSITION', this.doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(this.buffer))
        .setAttribute('NORMAL', this.doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.nor)).setBuffer(this.buffer))
        .setIndices(this.doc.createAccessor().setType('SCALAR').setArray(big ? new Uint32Array(b.idx) : new Uint16Array(b.idx)).setBuffer(this.buffer));
      if (MATERIALS[material].box || MATERIALS[material].trim) prim.setAttribute('TEXCOORD_0', this.doc.createAccessor().setType('VEC2').setArray(new Float32Array(b.uv)).setBuffer(this.buffer));
      mesh.addPrimitive(prim);
    }
    return { mesh, tris, box };
  }

  /** One top-level node. */
  async add(name, soups, { kind, ratio = 1, note = '' } = {}) {
    const { mesh, tris, box } = await this.mesh(name, soups, ratio);
    this.scene.addChild(this.doc.createNode(name).setMesh(mesh));
    this.record(name, kind, tris, box, note);
  }

  /** A top-level node with no mesh and child parts, each child with its own origin. */
  async addGroup(name, children, { kind, note = '' } = {}) {
    const root = this.doc.createNode(name);
    let tris = 0;
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const child of children) {
      const { mesh, tris: t, box: b } = await this.mesh(child.name, child.soups, 1);
      tris += t;
      for (let k = 0; k < 3; k += 1) { box.min[k] = Math.min(box.min[k], b.min[k] + child.origin[k]); box.max[k] = Math.max(box.max[k], b.max[k] + child.origin[k]); }
      root.addChild(this.doc.createNode(child.name).setMesh(mesh).setTranslation(child.origin));
    }
    this.scene.addChild(root);
    this.record(name, kind, tris, box, note);
  }

  record(name, kind, tris, box, note) {
    const f = (v) => +v.toFixed(2);
    this.report.push({ name, kind, tris, min: box.min.map(f), max: box.max.map(f), size: box.max.map((v, k) => f(v - box.min[k])), note });
  }

  async write(file) {
    await io.write(file, this.doc);
    const kb = statSync(file).size / 1024;
    console.log(`${path.basename(file)}: ${this.report.length} pieces, ${kb.toFixed(0)} KB, ${this.textures.size} textures`);
    return this.report;
  }
}

/** Moves soups so a chosen point becomes the origin. */
const shift = (soups, dx, dy, dz) => soups.map((s) => {
  const pos = [];
  for (let i = 0; i < s.pos.length; i += 3) pos.push(s.pos[i] + dx, s.pos[i + 1] + dy, s.pos[i + 2] + dz);
  return { ...s, pos };
});
const boundsOf = (soups) => {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (const s of soups) for (let i = 0; i < s.pos.length; i += 3) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], s.pos[i + k]); max[k] = Math.max(max[k], s.pos[i + k]); }
  return { min, max };
};
/** Center in x and z, stand on y = 0. */
const centered = (soups) => {
  const { min, max } = boundsOf(soups);
  return shift(soups, -(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2);
};

/** Crenellating by brick leaves some bricks hanging, so this removes any with nothing beneath. */
function dropFloating(soups) {
  const blocks = soups.map((soup) => ({ soup, ...boundsOf([soup]) })).sort((a, b) => a.min[1] - b.min[1]);
  const base = blocks[0].min[1];
  const kept = [];
  const overlap = (a, b, k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]);
  for (const b of blocks) {
    if (b.min[1] < base + 0.05 || kept.some((o) => o.min[1] < b.min[1] && o.max[1] > b.min[1] - 0.08 && overlap(o, b, 0) > 0.04 && overlap(o, b, 2) > 0.04)) kept.push(b);
  }
  return kept.map((b) => b.soup);
}

// ---- Castle ----

// Curve_1 is an arc around (0, 0.18) m in its file, from straight -z to nearly straight -x.
const CURVE_CENTER_Z = 0.18;
const CURVE_FROM = -175; // Degrees of atan2(z, x) at the arc's far end.
/** Stretches an arc's angle so it runs from -180 to -90 degrees around the origin. */
function warpArc(soups) {
  return soups.map((s) => {
    const pos = [...s.pos];
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.hypot(pos[i], pos[i + 2]);
      let a = (Math.atan2(pos[i + 2], pos[i]) * 180) / Math.PI;
      if (a > 0) a -= 360;
      a = -90 + ((a + 90) * 90) / (-90 - CURVE_FROM);
      pos[i] = r * Math.cos((a * Math.PI) / 180);
      pos[i + 2] = r * Math.sin((a * Math.PI) / 180);
    }
    return { ...s, pos };
  });
}
function rotated(soups, yaw, y) {
  const m = rotationY(yaw);
  return soups.map((s) => {
    const pos = [];
    for (let i = 0; i < s.pos.length; i += 3) { const p = point(m, s.pos[i], s.pos[i + 1], s.pos[i + 2]); pos.push(p[0], p[1] + y, p[2]); }
    return { ...s, pos };
  });
}

// A ruins wall spans z -25.3..3.3 cm, so this centers its thickness on z = 0.
const WALL_Z = 0.165;
const STRAIGHT_RATIO = 0.3;

async function wallBlock(x, y, opts) { return part(ruin('Wall'), at(x, y, WALL_Z), opts); }
/** Keeps only every other 1.5 m column of the top course, which makes crenellations of real bricks. */
const crenel = (top) => (x, y) => y < top - 1.15 || Math.floor((x + 300) / 1.5) % 2 === 0;

async function buildCastle() {
  const o = new Output();
  const wallOpts = { kind: 'wall', ratio: STRAIGHT_RATIO };
  const W2 = MODULE / 4; // Offset of a 3 m block from the center of a 6 m module.

  await o.add('wall', [...await wallBlock(-W2, 0), ...await wallBlock(W2, 0), ...await wallBlock(-W2, 3), ...await wallBlock(W2, 3)], wallOpts);
  const c6 = { keepNode: crenel(6) };
  await o.add('wall_crenel', dropFloating([...await wallBlock(-W2, 0), ...await wallBlock(W2, 0), ...await wallBlock(-W2, 3, c6), ...await wallBlock(W2, 3, c6)]), wallOpts);
  await o.add('wall_3m', [...await wallBlock(0, 0), ...await wallBlock(0, 3)], wallOpts);
  await o.add('wall_3m_crenel', dropFloating([...await wallBlock(0, 0), ...await wallBlock(0, 3, c6)]), wallOpts);
  await o.add('wall_window', [...await part(ruin('Window_Open_Double'), at(-W2, 0, WALL_Z)), ...await part(ruin('Window_Open_Double'), at(W2, 0, WALL_Z))], wallOpts);
  await o.add('wall_gate_round', await part(ruin('Wall_ArchRound'), at(0, 0, WALL_Z)), { ...wallOpts, kind: 'wall_gate' });
  await o.add('wall_gate_gothic', await part(ruin('Wall_ArchGothic'), at(0, 0, WALL_Z)), { ...wallOpts, kind: 'wall_gate' });
  await o.add('wall_arch_broken', await part(ruin('Wall_ArchRound_Broken'), at(0, 0, WALL_Z)), { ...wallOpts, kind: 'wall_gate' });
  await o.add('wall_ruin', [
    ...await wallBlock(-W2, 0), ...await part(ruin('Wall_Broken'), at(-W2, 3, WALL_Z)), ...await part(ruin('Wall_Broken'), at(W2, 0, WALL_Z)),
  ], { ...wallOpts, kind: 'wall_ruin' });
  await o.add('wall_ruin_low', [...await part(ruin('Wall_Broken'), at(-W2, 0, WALL_Z)), ...await part(ruin('Wall_Broken'), at(W2, 0, WALL_Z))], { ...wallOpts, kind: 'wall_ruin' });

  // Doors are split left and right at x = 0, and each node's origin is its hinge. The kit's doors
  // are made for its smaller free-standing arch, so they are stretched to fill the wall gate.
  const DOOR_WIDE = 2.18 / 1.735; const DOOR_TALL = 1.18;
  const doorPlace = multiply([DOOR_WIDE, 0, 0, 0, 0, DOOR_TALL, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], at(0, 0, 0));
  for (const style of ['Round', 'Gothic']) {
    const file = ruin(`Doors_${style}Arch`);
    const { min, max } = boundsOf(await part(file, doorPlace));
    const side = (sign) => (x) => sign * x > 0;
    await o.add(`door_${style.toLowerCase()}_l`, shift(await part(file, doorPlace, { keepNode: side(-1) }), max[0], -min[1], 0), { kind: 'door' });
    await o.add(`door_${style.toLowerCase()}_r`, shift(await part(file, doorPlace, { keepNode: side(1) }), -max[0], -min[1], 0), { kind: 'door' });
  }

  // The curve kit's arc spans 85 degrees around CURVE_CENTER, so it is stretched to a full 90 to close a ring.
  const arc = async (y, yaw, opts) => rotated(warpArc(await part(ruin('Curve_1'), at(0, 0, -CURVE_CENTER_Z * K), opts)), yaw, y);
  const ring = async (y, opts) => [...await arc(y, 0, opts), ...await arc(y, 90, opts), ...await arc(y, 180, opts), ...await arc(y, 270, opts)];
  const merlons = { keepNode: (x, y, z) => y < 3 - 1.15 || Math.floor((Math.atan2(z, x) * 180) / Math.PI / 15 + 100) % 2 === 0 };
  // Buttresses cover the seams between arcs and the corners of the square tower.
  const buttress = async (x, z, yaw) => part(ruin('Support_Tall'), multiply(translation(x, 0, z), multiply(rotationY(yaw), scaling(K * 0.01 * 1.45))));
  const seams = [...await buttress(0, 3.38, 0), ...await buttress(3.38, 0, 90), ...await buttress(0, -3.38, 180), ...await buttress(-3.38, 0, 270)];
  await o.add('tower_round', [...dropFloating([...await ring(0), ...await ring(3), ...await ring(6, merlons)]), ...seams], { kind: 'tower', ratio: 0.28 });
  await o.add('corner_curve', [...await arc(0, 0), ...await arc(3, 0)], { kind: 'corner', ratio: 0.28 });

  const wallAt = (x, y, z, yaw, opts, name = 'Wall') => part(ruin(name), multiply(translation(x, y, z), multiply(rotationY(yaw), at(0, 0, WALL_Z))), opts);
  const towerFace = async (yaw, gate, levels) => {
    const r = multiply(rotationY(yaw), translation(0, 0, 3));
    const out = [];
    const place = (x, y) => multiply(r, multiply(translation(x, y, 0), at(0, 0, WALL_Z)));
    for (let y = 0; y < levels; y += 1) {
      const top = y === levels - 1;
      if (gate && y === 0) { out.push(...await part(ruin('Wall_ArchRound'), multiply(r, at(0, 0, WALL_Z)))); y += 1; continue; }
      const opts = top ? { keepNode: (x, yy, z) => yy < levels * 3 - 1.15 || Math.floor((x + z + 300) / 1.5) % 2 === 0 } : {};
      out.push(...await part(ruin('Wall'), place(-W2, y * 3), opts), ...await part(ruin('Wall'), place(W2, y * 3), opts));
    }
    return out;
  };
  const corners = [...await buttress(3, 3, 45), ...await buttress(-3, 3, -45), ...await buttress(3, -3, 135), ...await buttress(-3, -3, -135)];
  const square = async (gate) => [...await towerFace(0, gate, 3), ...await towerFace(90, false, 3), ...await towerFace(180, false, 3), ...await towerFace(270, false, 3), ...corners];
  await o.add('tower_square', dropFloating(await square(false)), { kind: 'tower', ratio: STRAIGHT_RATIO });
  await o.add('tower_square_gate', dropFloating(await square(true)), { kind: 'tower', ratio: STRAIGHT_RATIO });

  // L corner: arms run +X and +Z from the origin, with a buttress over the joint.
  await o.add('corner_l', [
    ...await wallAt(1.5, 0, 0, 0), ...await wallAt(1.5, 3, 0, 0),
    ...await wallAt(0, 0, 1.5, 90), ...await wallAt(0, 3, 1.5, 90),
    ...await part(ruin('Support_Tall'), at(0, 0, 0)),
  ], { kind: 'corner', ratio: STRAIGHT_RATIO });

  const free = async (name, kind, file, s = K, ratio = 0.45, note = '') => o.add(name, centered(await part(ruin(file), at(0, 0, 0, 0, s))), { kind, ratio, note });
  await free('arch_round', 'arch', 'Arch_Round');
  await free('arch_gothic', 'arch', 'Arch_Gothic');
  await free('arch_support', 'arch', 'Support_Center');
  await free('pillar_square', 'pillar', 'Column_Square');
  await free('pillar_round', 'pillar', 'Column_Round');
  await free('pillar_stump', 'pillar', 'Column_Round_Short');
  await free('pillar_buttress', 'pillar', 'Support_Tall');
  await free('stairs', 'stairs', 'Stairs', K, 0.35);
  await free('stairs_tall', 'stairs', 'Stairs_2', K, 0.35);
  await free('rail', 'rail', 'Rail_Straight', K, 0.6);
  await free('bridge_section', 'bridge', 'BridgeSection', K, 0.45);
  await free('bridge_support', 'bridge', 'Column_BridgeSupport', K, 0.5);
  await free('floor_squares', 'floor', 'Floor_SquareLarge', K, 1);
  await free('floor_cobble', 'floor', 'Floor_Standard', K, 0.3);
  await free('floor_diamond', 'floor', 'Floor_Diamond', K, 0.6);
  await free('statue_stag', 'statue', 'Statue_Stag', 1.2, 0.7);
  await free('statue_hound', 'statue', 'Statue_Fox', 1.2, 0.7);

  await free('rubble_small', 'rubble', 'Bricks', K, 0.7);
  await o.add('rubble_large', centered([
    ...await part(ruin('Bricks'), at(0, 0, 0)),
    ...await part(ruin('Bricks'), at(0.9, 0.05, 0.7, 120)),
    ...await part(ruin('Bricks'), at(-0.5, 0.4, 0.3, 215, 1.2)),
    ...await part(ruin('Wall_Double_Broken'), multiply(translation(-0.7, -0.75, -0.9), multiply(rotationX(-14), at(0, 0, 0, 25, 1)))),
  ].filter(Boolean)), { kind: 'rubble', ratio: 0.45 });
  await o.add('rocks_large', centered(await part(kenney('rocks-large'), atM(0, 0, 0, 0, 1.6), { material: { '*': 'stone' } })), { kind: 'rubble' });
  await o.add('rocks_small', centered(await part(kenney('rocks-small'), atM(0, 0, 0, 0, 1.6), { material: { '*': 'stone' } })), { kind: 'rubble' });

  await o.add('banner_gold', centered(await part(ruin('Flag_Wall2'), at(0, 0, 0))), { kind: 'banner' });
  await o.add('banner_crimson', centered(await part(ruin('Flag_Wall2'), at(0, 0, 0), { material: { Flag: 'banner_crimson', Wood: 'wood', Metal: 'iron' } })), { kind: 'banner' });
  await o.add('banner_torn_gold', centered(await part(ruin('Flag_Wall'), at(0, 0, 0))), { kind: 'banner' });
  await o.add('banner_torn_crimson', centered(await part(ruin('Flag_Wall'), at(0, 0, 0), { material: { Flag: 'banner_crimson' } })), { kind: 'banner' });
  await o.add('banner_over_arch', await part(ruin('Flag_RoundArch'), at(0, 0, 0), { material: { Flag: 'banner_crimson' } }), { kind: 'banner', note: 'origin is the gate origin' });

  await o.add('fence_iron', centered(await part(village('Prop_MetalFence_Ornament'), atM(0, 0, 0, 0, 1.5), { material: { '*': 'fence' } })), { kind: 'fence', ratio: 0.5 });

  const report = await o.write(`${OUT}/castle.glb`);
  return report;
}

// ---- Props ----

const CHEST_SCALE = 0.85;
/** The ruins chest has a separate lid node. Its hinge is the back bottom edge of the lid. */
async function chest(o, name, metal) {
  const material = { DarkWood: 'wood_dark', Wood: 'wood', Metal: metal };
  const place = at(0, 0.002, 0, 0, CHEST_SCALE);
  const base = await part(ruin('Chest'), place, { keepNode: (x, y, z, node) => node === 'Chest_Base', material });
  const lid = await part(ruin('Chest'), place, { keepNode: (x, y, z, node) => node === 'Chest_Top', material });
  const box = boundsOf(lid);
  const hinge = [0, box.min[1], box.min[2]];
  await o.addGroup(name, [
    { name: `${name}_base`, soups: base, origin: [0, 0, 0] },
    { name: `${name}_lid`, soups: shift(lid, 0, -hinge[1], -hinge[2]), origin: hinge },
  ], { kind: 'chest', note: `hinge ${hinge.map((v) => v.toFixed(3))}` });
}

async function buildProps() {
  const o = new Output();
  await chest(o, 'chest', 'iron');
  await chest(o, 'chest_gilded', 'gold');

  const fromProps = async (name, kind, file, s = 1, ratio = 0.5) => o.add(name, centered(await part(prop(file), atM(0, 0, 0, 0, s))), { kind, ratio });
  const fromRuins = async (name, kind, file, s = 1, ratio = 0.6, note = '') => o.add(name, centered(await part(ruin(file), at(0, 0, 0, 0, s))), { kind, ratio, note });

  await fromRuins('barrel', 'prop', 'Barrel', 1, 0.5);
  await fromRuins('crate', 'prop', 'Crate', 1, 0.6);
  await o.add('crate_stack', centered([
    ...await part(ruin('Crate'), at(0, 0, 0, 0, 1)),
    ...await part(ruin('Crate'), at(0.95, 0, 0.1, 15, 1)),
    ...await part(ruin('Crate'), at(0.35, 0.82, 0.05, 40, 1)),
  ]), { kind: 'prop', ratio: 0.6 });
  await fromProps('crate_iron', 'prop', 'Crate_Metal', 0.9);
  await fromRuins('pot_a', 'prop', 'Pot1', 1, 0.5);
  await fromRuins('pot_b', 'prop', 'Pot3', 1, 0.5);
  await fromRuins('pot_broken', 'prop', 'Pot1_Broken', 1, 0.7);
  await fromRuins('skull', 'prop', 'Skull', 0.55, 1);
  await fromRuins('candles', 'light', 'Candles_2', 0.8, 0.5);
  await fromRuins('bookcase', 'prop', 'Bookcase_Full', 1, 0.5);
  await fromRuins('cart', 'prop', 'Cart', 1, 0.7);
  await fromRuins('bear_trap', 'prop', 'BearTrap_Open', 0.8, 1);
  await fromProps('cage', 'prop', 'Cage_Small', 1.2);
  await fromProps('chain_coil', 'prop', 'Chain_Coil', 1);
  await fromProps('weapon_stand', 'prop', 'WeaponStand', 1);
  await o.add('coin_pile', centered(await part(prop('Coin_Pile'), atM(0, 0, 0, 0, 2), { material: { '*': 'gold' } })), { kind: 'prop' });

  // A wall torch points away from the wall along +Z. Origin: where the bracket meets the wall.
  const wallTorch = await part(ruin('Torch'), at(0, 0, 0, 0, 1));
  const tb = boundsOf(wallTorch);
  await o.add('torch_wall', shift(wallTorch, 0, -(tb.min[1] + tb.max[1]) / 2, -tb.min[2]), { kind: 'light', ratio: 1, note: `flame material 'fire'` });
  await fromProps('torch_iron', 'light', 'Torch_Metal', 1.2);
  await fromProps('candle_stand', 'light', 'CandleStick_Stand', 1.3);
  await fromProps('chandelier', 'light', 'Chandelier', 1.3);

  const flame = async (x, y, z, s) => part(ruin('Torch'), multiply(translation(x, y, z), multiply(scaling(s * 0.01), translation(0, 0, 0))), { keepMaterial: (m) => m === 'Fire' });
  const flameBounds = boundsOf(await flame(0, 0, 0, 1));
  const flameAt = async (x, y, z, s) => flame(x - ((flameBounds.min[0] + flameBounds.max[0]) / 2) * s, y - flameBounds.min[1] * s, z - ((flameBounds.min[2] + flameBounds.max[2]) / 2) * s, s);

  // Brazier: the iron cauldron on a stone stump, with embers and a flame.
  const stump = centered(await part(ruin('Column_Round_Short'), at(0, 0, 0, 0, 0.62)));
  const stumpTop = boundsOf(stump).max[1];
  const bowl = await part(prop('Cauldron'), atM(0, stumpTop, 0, 0, 0.62), { material: { '*': 'iron' } });
  const bowlTop = boundsOf(bowl).max[1];
  await o.add('brazier', [
    ...stump, ...bowl,
    ...centeredAt(await part(ruin('Bricks'), at(0, 0, 0, 0, 0.3), { material: { '*': 'ember' } }), 0, bowlTop - 0.2, 0),
    ...await flameAt(0, bowlTop - 0.15, 0, 1.5),
  ], { kind: 'light', ratio: 0.8, note: `flame material 'fire'` });
  await o.add('brazier_unlit', [
    ...stump, ...bowl,
    ...centeredAt(await part(ruin('Bricks'), at(0, 0, 0, 0, 0.3), { material: { '*': 'black' } }), 0, bowlTop - 0.2, 0),
  ], { kind: 'light', ratio: 0.8 });

  // Bonfire: a stone ring, a pyre of logs, a rusted sword driven through it, and flames.
  const ring = [];
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * 360;
    const r = 0.72;
    ring.push(...await part(ruin('Brick'), multiply(translation(Math.cos((a * Math.PI) / 180) * r, 0, Math.sin((a * Math.PI) / 180) * r), multiply(rotationY(90 - a + (i * 37) % 17), scaling(0.012)))));
  }
  const pyre = [];
  for (let i = 0; i < 7; i += 1) {
    const yaw = (i / 7) * 360 + 11;
    // Each 1 m log leans from the ground at radius 0.56 up to the center at height 0.7.
    const log = multiply(rotationY(yaw), multiply(translation(0, 0.37, 0.28), rotationX(-128.5)));
    pyre.push(...await part(kenney('tree-log'), log, { material: { '*': 'wood_dark' } }));
  }
  const sword = await part(prop('Sword_Bronze'), multiply(translation(0, 1.06, 0.02), multiply(rotationX(176), multiply(rotationZ(8), scaling(1.15)))), { material: { '*': 'iron_light' } });
  const lit = [...ring, ...pyre, ...sword];
  const bonfireBase = -boundsOf(lit).min[1];
  await o.add('bonfire', shift([...lit, ...await flameAt(0.02, 0.1, 0, 2.6), ...await flameAt(-0.22, 0.05, 0.14, 1.6), ...await flameAt(0.22, 0.05, -0.12, 1.4)], 0, bonfireBase, 0), { kind: 'bonfire', ratio: 0.8, note: `flame material 'fire'` });
  await o.add('bonfire_unlit', shift(lit, 0, bonfireBase, 0), { kind: 'bonfire', ratio: 0.8 });

  return o.write(`${OUT}/props.glb`);
}

function centeredAt(soups, x, y, z) {
  const { min, max } = boundsOf(soups);
  return shift(soups, x - (min[0] + max[0]) / 2, y - min[1], z - (min[2] + max[2]) / 2);
}

// ---- Build ----

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const castle = await buildCastle();
const props = await buildProps();
for (const r of [...castle, ...props]) console.log(r.name.padEnd(22), String(r.kind).padEnd(10), String(r.tris).padStart(6), 'size', r.size.join(' x '), 'min', r.min.join(','), r.note);
