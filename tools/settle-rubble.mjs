/**
 * Drops loose bricks and rocks down until they rest on the ground or on another piece. The ruin and
 * rubble models are made of separate bricks, and removing some of them left others hanging in the air.
 *
 * Needs: npm i @gltf-transform/core @gltf-transform/extensions
 * Run:   node tools/settle-rubble.mjs <castle.glb> [--dry]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , file, flag] = process.argv;
const dry = flag === '--dry';
// Loose heaps drop any distance and sink into each other, so that no dark slits show between bricks.
// Broken walls only close small gaps: a brick far above the next is part of the wall's shape.
// Standing walls and arches are left alone, because their bricks are held up from the side.
const RULES = [
  { nodes: /^(rubble_|rocks_)/, maxGap: Infinity, sink: 0.12 },
  { nodes: /^wall_ruin/, maxGap: 0.25, sink: 0.01 },
];
const CONTACT_GAP = 0.03;
// Pieces must overlap this much sideways to hold each other up.
const OVERLAP = 0.03;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);

function piecesOf(prim) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const parent = new Map();
  const key = (v) => v.map((n) => n.toFixed(3)).join(',');
  const find = (a) => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)));
      a = parent.get(a);
    }
    return a;
  };
  const keys = [];
  for (let i = 0; i < pos.getCount(); i += 1) {
    const k = key(pos.getElement(i, []));
    keys.push(k);
    if (!parent.has(k)) parent.set(k, k);
  }
  const count = idx ? idx.getCount() : pos.getCount();
  for (let i = 0; i + 2 < count; i += 3) {
    const a = find(keys[idx ? idx.getScalar(i) : i]);
    for (const j of [1, 2]) parent.set(find(keys[idx ? idx.getScalar(i + j) : i + j]), a);
  }
  const pieces = new Map();
  for (let i = 0; i < pos.getCount(); i += 1) {
    const root = find(keys[i]);
    const v = pos.getElement(i, []);
    const p = pieces.get(root) ?? { prim, verts: [], lo: [...v], hi: [...v] };
    p.verts.push(i);
    for (let a = 0; a < 3; a += 1) {
      p.lo[a] = Math.min(p.lo[a], v[a]);
      p.hi[a] = Math.max(p.hi[a], v[a]);
    }
    pieces.set(root, p);
  }
  return [...pieces.values()];
}

function restingHeight(piece, below) {
  let height = 0;
  for (const other of below) {
    const overlaps =
      Math.min(piece.hi[0], other.hi[0]) - Math.max(piece.lo[0], other.lo[0]) > OVERLAP &&
      Math.min(piece.hi[2], other.hi[2]) - Math.max(piece.lo[2], other.lo[2]) > OVERLAP;
    if (overlaps) height = Math.max(height, other.hi[1]);
  }
  return height;
}

for (const top of doc.getRoot().listScenes()[0].listChildren()) {
  const rule = RULES.find(({ nodes }) => nodes.test(top.getName()));
  if (!rule) continue;
  const mesh = top.getMesh();
  if (!mesh) continue;
  const pieces = mesh.listPrimitives().flatMap(piecesOf).sort((a, b) => a.lo[1] - b.lo[1]);
  const settled = [];
  let moved = 0;
  let worst = 0;
  for (const piece of pieces) {
    const rest = restingHeight(piece, settled);
    const onGround = rest === 0;
    const gap = piece.lo[1] - rest + (onGround ? 0 : rule.sink);
    if (gap > CONTACT_GAP && gap <= rule.maxGap) {
      moved += 1;
      worst = Math.max(worst, gap);
      if (!dry) {
        const pos = piece.prim.getAttribute('POSITION');
        for (const i of piece.verts) {
          const v = pos.getElement(i, []);
          v[1] -= gap;
          pos.setElement(i, v);
        }
      }
      piece.lo[1] -= gap;
      piece.hi[1] -= gap;
    }
    settled.push(piece);
  }
  console.log(`${top.getName().padEnd(20)} pieces ${String(pieces.length).padStart(3)} floating ${String(moved).padStart(3)} worst gap ${worst.toFixed(2)} m`);
}
if (!dry) await io.write(file, doc);
