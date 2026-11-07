/**
 * Writes shared/mapData.ts: hand-placed landmarks plus seeded scatter, so that every build gets the
 * same world. Colliders store their sine and cosine here because Math.sin may round differently
 * between browsers, and the client and server must agree on collision.
 *
 * Run: node tools/build-map.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shared', 'mapData.ts');
const BOUNDS = { minX: -240, maxX: 240, minZ: -290, maxZ: 210 };
const SPAWN = { x: 0, z: 175, radius: 8 };

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (value, places = 100) => Math.round(value * places) / places;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ---------- Output buffers ---------- */

const colliders = [];
const batches = new Map();
const fires = [];
const spires = [];

function prop(file, node, x, z, yaw = 0, scale = 1, { y = 0, tilt = 0 } = {}) {
  const key = `${file}|${node}|${round(y)}|${round(tilt)}`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { file, node, items: [] };
    if (y) batch.y = round(y);
    if (tilt) batch.tilt = round(tilt);
    batches.set(key, batch);
  }
  batch.items.push(round(x), round(z), round(yaw), round(scale));
}
const circle = (x, z, r) => colliders.push({ t: 'c', x: round(x), z: round(z), r: round(r) });
/** Same rotation as a prop with this yaw, so a rectangle lines up with the mesh it stands for. */
function rect(x, z, hw, hd, yaw = 0) {
  colliders.push({
    t: 'r',
    x: round(x),
    z: round(z),
    hw: round(hw),
    hd: round(hd),
    sin: round(Math.sin(yaw), 100000),
    cos: round(Math.cos(yaw), 100000),
  });
}
const fire = (x, y, z, size) => fires.push(round(x), round(y), round(z), round(size));
const spire = (x, y, z, radius, height) => spires.push(round(x), round(y), round(z), round(radius), round(height));
function castle(node, x, z, yaw = 0, scale = 1, options) {
  // The large rubble model is bricks stacked with overhangs, which look like they're floating.
  // A low spread of small piles, all flat on the ground, reads better as a heap.
  if (node === 'rubble_large') {
    const across = Math.cos(yaw) * 1.1 * scale;
    const along = Math.sin(yaw) * 1.1 * scale;
    castle('rubble_small', x, z, yaw, scale * 1.2);
    castle('rubble_small', x + across, z - along, yaw + 2.1, scale * 0.9);
    castle('rocks_small', x - across, z + along, yaw + 4.2, scale * 0.8);
    castle('rocks_small', x + along, z + across, yaw + 1, scale * 0.7);
    return;
  }
  prop('castle', node, x, z, yaw, scale, options);
}
const props = (node, ...rest) => prop('props', node, ...rest);
const forest = (node, ...rest) => prop('forest', node, ...rest);

/* ---------- Roads and clear ground ---------- */

const ROAD = [0, 170, 1, 158, -3, 140, 3, 122, 0, 110, -1, 90, 2, 70, -1, 50, 0, 30, -5, 5, -7, -22, 2, -50, 5, -75, 0, -100, 0, -112, 0, -150];
const TRAILS = [
  // From the village's east gate into the forest, to the clearing, then on to the hut.
  [2, 70, 40, 71, 62, 70, 84, 58, 104, 48, 122, 30, 136, 18, 150, 10, 166, -8, 178, -22, 188, -32, 190, -38],
  // A second way in, from the ash flats.
  [-5, 5, 30, 2, 62, -4, 92, 4, 120, 10, 150, 10],
  // Spawn's side path through the moor, to the forest's southern edge.
  [3, 122, 40, 118, 78, 112, 98, 92, 104, 48],
  // Hamlet lanes.
  [-1, 50, -18, 46],
];

function distToLine(line, x, z) {
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i];
    const az = line[i + 1];
    const bx = line[i + 2];
    const bz = line[i + 3];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
const distToRoad = (x, z) => distToLine(ROAD, x, z);
const distToTrail = (x, z) => Math.min(...TRAILS.map((line) => distToLine(line, x, z)));

/* Open ground that scatter must leave alone: circles with a radius. */
const keepOut = [];
const reserve = (x, z, r) => keepOut.push({ x, z, r });
const isReserved = (x, z, pad = 0) => keepOut.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

/** A cheap way to ask if a spot overlaps an existing collider, so scatter can't jam a passage. */
function hitsCollider(x, z, pad) {
  for (const c of colliders) {
    if (c.t === 'c') {
      if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    } else {
      const dx = x - c.x;
      const dz = z - c.z;
      const lx = Math.abs(dx * c.cos - dz * c.sin);
      const lz = Math.abs(dx * c.sin + dz * c.cos);
      if (lx < c.hw + pad && lz < c.hd + pad) return true;
    }
  }
  return false;
}

/* ---------- Building blocks ---------- */

const WALL_HALF_DEPTH = 0.23;

/** Yaw that lays a prop's local +X along the line from a to b. */
const yawAlong = (ax, az, bx, bz) => Math.atan2(-(bz - az), bx - ax);

/**
 * Straight wall from a to b, with modules stretched a hair so they end exactly at b. pick(i, n, course)
 * names each piece; null leaves a hole in that course. The collider covers the whole run.
 */
function wallRun(ax, az, bx, bz, { scale = 1, courses = 1, pick = () => 'wall', collide = true } = {}) {
  const length = Math.hypot(bx - ax, bz - az);
  const count = Math.max(1, Math.round(length / (6 * scale)));
  const fit = length / (count * 6);
  const yaw = yawAlong(ax, az, bx, bz);
  for (let course = 0; course < courses; course += 1) {
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      const node = pick(i, count, course);
      if (node) castle(node, ax + (bx - ax) * t, az + (bz - az) * t, yaw, fit, { y: course * 6 * fit });
    }
  }
  if (collide) rect((ax + bx) / 2, (az + bz) / 2, length / 2, WALL_HALF_DEPTH * fit + 0.05, yaw);
}

/** A stack of tower sections. Their stubby 9 m height is why the art director wanted them stacked. */
function towerStack(node, x, z, scale, courses, { base = node, roof = true, yaw = 0 } = {}) {
  const section = 9 * scale;
  for (let course = 0; course < courses; course += 1) {
    castle(course === 0 ? base : node, x, z, yaw, scale, { y: course * section });
  }
  const radius = node === 'tower_round' ? 4.3 * scale : 4.7 * scale;
  if (roof) spire(x, courses * section - 0.4 * scale, z, radius, radius * 3.2);
}
function roundTower(x, z, scale, courses, options) {
  towerStack('tower_round', x, z, scale, courses, options);
  circle(x, z, 3.9 * scale);
}

function gateArch(x, z, yaw, scale, node = 'wall_gate_round') {
  castle(node, x, z, yaw, scale);
  // Only the two posts block, not the opening between them.
  const reach = 2.59 * scale;
  const postHalf = 0.41 * scale;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  rect(x - reach * cos, z + reach * sin, postHalf, WALL_HALF_DEPTH * scale + 0.05, yaw);
  rect(x + reach * cos, z - reach * sin, postHalf, WALL_HALF_DEPTH * scale + 0.05, yaw);
}

function pillar(node, x, z, scale, radius = 0.42) {
  castle(node, x, z, 0, scale);
  circle(x, z, radius * scale);
}

/** A roofless burnt house: four ruined walls of short modules, one with a door gap. */
function ruinHouse(random, x, z, wide, deep, doorSide) {
  const scale = 0.9;
  const m = 6 * scale;
  const hw = (wide * m) / 2;
  const hd = (deep * m) / 2;
  const corners = [
    [x - hw, z - hd, x + hw, z - hd, 'n'],
    [x + hw, z - hd, x + hw, z + hd, 'e'],
    [x + hw, z + hd, x - hw, z + hd, 's'],
    [x - hw, z + hd, x - hw, z - hd, 'w'],
  ];
  for (const [ax, az, bx, bz, side] of corners) {
    const n = side === 'n' || side === 's' ? wide : deep;
    const yaw = yawAlong(ax, az, bx, bz);
    for (let i = 0; i < n; i += 1) {
      if (side === doorSide && i === Math.floor(n / 2)) {
        const cx = ax + ((bx - ax) * (i + 0.5)) / n;
        const cz = az + ((bz - az) * (i + 0.5)) / n;
        gateArch(cx, cz, yaw, scale, 'wall_arch_broken');
        continue;
      }
      const roll = random();
      // Most of the walls have fallen; a few are still standing tall.
      const node = roll < 0.42 ? 'wall_ruin_low' : roll < 0.84 ? 'wall_ruin' : roll < 0.93 ? 'wall_window' : null;
      if (!node) continue;
      const cx = ax + ((bx - ax) * (i + 0.5)) / n;
      const cz = az + ((bz - az) * (i + 0.5)) / n;
      // Half of the ruin pieces face the other way, so their tall ends don't all line up.
      const flip = random() > 0.5 ? Math.PI : 0;
      castle(node, cx, cz, yaw + flip, scale);
      rect(cx, cz, m / 2, WALL_HALF_DEPTH * scale + 0.05, yaw);
    }
  }
  castle('pillar_buttress', x - hw, z - hd, 0, scale);
  castle('pillar_buttress', x + hw, z - hd, 0, scale);
  castle('pillar_buttress', x - hw, z + hd, 0, scale);
  castle('pillar_buttress', x + hw, z + hd, 0, scale);
  circle(x - hw, z - hd, 0.55);
  circle(x + hw, z - hd, 0.55);
  circle(x - hw, z + hd, 0.55);
  circle(x + hw, z + hd, 0.55);
  castle(random() > 0.5 ? 'rubble_large' : 'rubble_small', x + (random() - 0.5) * hw, z + (random() - 0.5) * hd, random() * 6.28, 1);
}

/* ---------- Fixed places: reserved first, so scatter stays out of them ---------- */

// Binary Graces, one for every area a player can walk to. Ids are saved per character, so they never change.
const GRACES = [
  { id: 1, x: 0, z: 175, name: "Pilgrim's Rest" },
  { id: 6, x: 14, z: 132, name: 'Pale Meadow' },
  { id: 2, x: 6, z: 70, name: 'Burnt Hamlet' },
  { id: 7, x: 12, z: -32, name: 'Ash Flats' },
  { id: 3, x: 150, z: 10, name: 'Forest Clearing' },
  { id: 4, x: 176, z: -22, name: "Hunter's Hut" },
  { id: 5, x: 0, z: -108, name: 'Citadel Gate' },
];
const CHESTS = [
  { id: 1, x: -35, z: 45, yaw: 1.5708, dust: 40 },
  { id: 2, x: 190, z: -40, yaw: 0, dust: 60 },
  { id: 3, x: 72, z: -170, yaw: 0, dust: 150, model: 'chest_gilded' },
];
const CAMPS = [
  // Pale Meadow: harmless animals in the open.
  { kind: 'deer', x: -50, z: 135, count: 4, radius: 14 },
  { kind: 'deer', x: 44, z: 130, count: 4, radius: 14 },
  { kind: 'fox', x: -18, z: 147, count: 2, radius: 10 },
  { kind: 'fox', x: 72, z: 146, count: 2, radius: 10 },
  // Cursed Forest: six wolf packs, kept away from the graces.
  { kind: 'wolf', x: 92, z: -32, count: 3, radius: 10 },
  { kind: 'wolf', x: 128, z: 72, count: 3, radius: 10 },
  { kind: 'wolf', x: 200, z: 62, count: 3, radius: 10 },
  { kind: 'wolf', x: 172, z: -72, count: 3, radius: 10 },
  { kind: 'wolf', x: 216, z: -8, count: 3, radius: 10 },
  { kind: 'wolf', x: 122, z: -62, count: 3, radius: 10 },
  // Herds stay near the forest's edge, where a new player meets them first.
  { kind: 'deer', x: 80, z: 34, count: 4, radius: 10 },
  { kind: 'deer', x: 86, z: -56, count: 4, radius: 10 },
  { kind: 'deer', x: 76, z: 92, count: 4, radius: 10 },
  { kind: 'stag', x: 142, z: -36, count: 1, radius: 8 },
  { kind: 'stag', x: 206, z: 28, count: 1, radius: 8 },
  { kind: 'stag', x: 112, z: 92, count: 1, radius: 8 },
  { kind: 'fox', x: 170, z: 88, count: 2, radius: 8 },
  { kind: 'fox', x: 96, z: 12, count: 2, radius: 8 },
  { kind: 'fox', x: 212, z: -58, count: 1, radius: 8 },
  // Black Aurochs: just past the edge of the clearing, a fight the player can see coming.
  { kind: 'bull', x: 168, z: 26, count: 1, radius: 5 },
  { kind: 'bull', x: 128, z: -14, count: 1, radius: 5 },
];
GRACES.forEach((g) => reserve(g.x, g.z, 4));
CHESTS.forEach((c) => reserve(c.x, c.z, 3));
CAMPS.forEach((c) => reserve(c.x, c.z, c.kind === 'bull' ? 5 : 3));
reserve(SPAWN.x, SPAWN.z, SPAWN.radius + 1);
reserve(150, 10, 18); // the clearing
reserve(190, -40, 11); // the hut

// The stones are the only solid part. The glow and the digits are drawn by client/src/game/graces.ts.
for (const g of GRACES) props('bonfire_unlit', g.x, g.z, g.id * 1.3, 1);

/* ---------- Pilgrim's Rest ---------- */

function pilgrimsRest() {
  const { x: cx, z: cz } = SPAWN;
  // A ring of old columns around the fire, some snapped off.
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const px = cx + Math.cos(a) * 15;
    const pz = cz + Math.sin(a) * 15;
    // The two nearest the road are left out, so the arch frames the view north.
    if (Math.abs(px) < 6 && pz < cz) continue;
    if (i % 3 === 2) pillar('pillar_stump', px, pz, 1.2, 0.42);
    else pillar('pillar_round', px, pz, 1.35, 0.42);
    if (i % 3 === 0) {
      castle(i % 2 ? 'banner_torn_gold' : 'banner_torn_crimson', px, pz + (pz < cz ? 0.75 : -0.75), pz < cz ? 0 : Math.PI, 0.95, { y: 1.8 });
    }
  }
  // The arch that frames the road and the citadel from the spawn point.
  const archScale = 1.9;
  castle('arch_gothic', 0, 158, 0, archScale);
  circle(-2.05 * archScale, 158, 0.42 * archScale);
  circle(2.05 * archScale, 158, 0.42 * archScale);
  // Candles on tall iron stands, flanking the fire.
  for (const [dx, dz] of [[-9.5, 2], [9.5, 2], [-6.5, 9.5], [6.5, 9.5]]) {
    props('candle_stand', cx + dx, cz + dz, dx, 1.1);
    circle(cx + dx, cz + dz, 0.35);
    fire(cx + dx, 1.88, cz + dz, 0.22);
  }
  // The shrine: a broken apse behind the fire, with a statue in it.
  const s = 1.25;
  const m = 6 * s;
  wallRun(-m * 1.5, 196, m * 1.5, 196, { scale: s, pick: (i) => ['wall_ruin', 'wall_window', 'wall_crenel'][i % 3] });
  wallRun(-m * 1.5, 196, -m * 1.5, 186, { scale: s, pick: () => 'wall_ruin' });
  wallRun(m * 1.5, 186, m * 1.5, 196, { scale: s, pick: () => 'wall_ruin_low' });
  castle('statue_stag', 0, 191.5, Math.PI, 1.35);
  rect(0, 191.5, 1.1, 1.1);
  castle('floor_diamond', 0, 191, 0, 2.2, { y: -0.08 });
  props('brazier_unlit', -7, 188, 0, 1.25);
  props('brazier_unlit', 7, 188, 0, 1.25);
  circle(-7, 188, 0.4);
  circle(7, 188, 0.4);
  fire(-7, 2.0, 188, 0.75);
  fire(7, 2.0, 188, 0.75);
  castle('banner_torn_crimson', -5, 195.4, 0, 1.2, { y: 3.8 });
  castle('banner_torn_crimson', 5, 195.4, 0, 1.2, { y: 3.8 });
  castle('rubble_large', -10, 183, 0.8, 0.9);
  castle('rubble_small', 13, 190, 2.2, 1.1);
  rect(-10, 183, 1.4, 1.3, 0.8);
  reserve(0, 186, 16);
  reserve(0, 158, 8);
}

/* ---------- Pale Meadow and the moors either side ---------- */

function meadow(random) {
  // Old fence line and field walls, half gone.
  for (const [ax, az, bx, bz] of [[-84, 118, -36, 112], [34, 114, 84, 120], [-88, 152, -40, 158], [44, 158, 86, 150]]) {
    wallRun(ax, az, bx, bz, { scale: 0.75, pick: (i) => (i % 4 === 3 ? null : 'wall_ruin_low'), collide: false });
    const n = Math.round(Math.hypot(bx - ax, bz - az) / 4.5);
    for (let i = 0; i < n; i += 1) {
      if (i % 4 === 3) continue;
      const t = (i + 0.5) / n;
      rect(ax + (bx - ax) * t, az + (bz - az) * t, 2.25, 0.25, yawAlong(ax, az, bx, bz));
    }
  }
  // A lone roadside gatehouse ruin as a landmark.
  roundTower(-150, 168, 1.5, 1, { roof: false });
  castle('tower_round', 143, 176, 1.2, 1.3);
  circle(143, 176, 5);
  castle('wall_arch_broken', 132, 171, 0.3, 1.5);
  castle('wall_ruin', 155, 177, -0.2, 1.3);
  rect(155, 177, 3.9, 0.35, -0.2);
  reserve(-150, 168, 9);
  reserve(143, 176, 16);

  // Boulders the grass grows around.
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 34; tries += 1) {
    const x = -210 + random() * 420;
    const z = 114 + random() * 92;
    if (distToRoad(x, z) < 8 || distToTrail(x, z) < 5 || isReserved(x, z, 4) || hitsCollider(x, z, 4)) continue;
    const roll = random();
    const node = roll < 0.4 ? 'boulder_a' : roll < 0.7 ? 'boulder_b' : 'rock_slab';
    const radius = { boulder_a: 1.5, boulder_b: 1.3, rock_slab: 0.95 }[node];
    const scale = 0.7 + random() * 0.7;
    forest(node, x, z, random() * 6.28, scale);
    circle(x, z, radius * scale);
    placed += 1;
  }
  // A few bare trees, so the meadow has a skyline.
  placed = 0;
  for (let tries = 0; tries < 300 && placed < 26; tries += 1) {
    const x = -225 + random() * 450;
    const z = 114 + random() * 90;
    if (Math.abs(x) < 16 || distToRoad(x, z) < 10 || distToTrail(x, z) < 5 || isReserved(x, z, 4) || hitsCollider(x, z, 3)) continue;
    const roll = random();
    const node = roll < 0.45 ? 'tree_gnarled_a' : roll < 0.75 ? 'tree_snag' : roll < 0.9 ? 'tree_gnarled_b' : 'tree_gnarled_c';
    const scale = 0.85 + random() * 0.5;
    forest(node, x, z, random() * 6.28, scale);
    circle(x, z, { tree_gnarled_a: 0.5, tree_gnarled_b: 0.55, tree_snag: 0.22, tree_gnarled_c: 0.62 }[node] * scale);
    placed += 1;
  }
  // Grass: thick in the meadow, thinner in the moors.
  for (let i = 0; i < 4300; i += 1) {
    const inMeadow = i < 2800;
    const x = inMeadow ? -92 + random() * 184 : -236 + random() * 472;
    const z = inMeadow ? 113 + random() * 46 : 113 + random() * 96;
    if (distToRoad(x, z) < 3.2 || distToLine([0, 195, 0, 150], x, z) < 3 || Math.hypot(x, z - 175) < 12) continue;
    const roll = random();
    const node = roll < 0.4 ? 'grass_tall' : roll < 0.95 ? 'grass_short' : 'grass_wispy';
    forest(node, x, z, random() * 6.28, 0.9 + random() * 0.9);
  }
  for (let i = 0; i < 220; i += 1) {
    const x = -220 + random() * 440;
    const z = 113 + random() * 92;
    if (distToRoad(x, z) < 3.5) continue;
    forest('rock_small', x, z, random() * 6.28, 0.7 + random() * 1.6);
  }
  for (let i = 0; i < 90; i += 1) {
    const x = -220 + random() * 440;
    const z = 113 + random() * 92;
    if (distToRoad(x, z) < 4 || Math.hypot(x, z - 175) < 12) continue;
    forest('fern_psx', x, z, random() * 6.28, 0.8 + random() * 0.8);
  }
}

/* ---------- Forsaken Village: only a burnt hamlet for now ---------- */

function village(random) {
  // Chapel around the chest, its door to the east, facing the road.
  const s = 1.1;
  const m = 6 * s;
  const west = -35 - m * 1.5;
  const east = -35 + m * 1.5;
  const north = 45 - m;
  const south = 45 + m;
  wallRun(west, north, east, north, { scale: s, pick: (i) => (i === 1 ? 'wall_window' : 'wall_ruin') });
  wallRun(east, south, west, south, { scale: s, pick: (i) => (i === 1 ? 'wall_window' : 'wall_ruin_low') });
  wallRun(west, south, west, north, { scale: s, pick: () => 'wall_window' });
  // The east wall has the door: an arch between two short walls.
  wallRun(east, north, east, 45 - m / 2, { scale: s, pick: () => 'wall_ruin' });
  wallRun(east, 45 + m / 2, east, south, { scale: s, pick: () => 'wall_ruin' });
  gateArch(east, 45, yawAlong(east, 45 - 1, east, 45 + 1), s, 'wall_gate_gothic');
  for (const dx of [-1, 1]) {
    pillar('pillar_square', -35 + dx * 3.5, 45 - 3.5, 1.1, 0.4);
    pillar('pillar_square', -35 + dx * 3.5, 45 + 3.5, 1.1, 0.4);
  }
  castle('floor_squares', -35, 45, 0, 1.2, { y: -0.1 });
  props('candle_stand', -38, 42, 0.5, 1);
  props('candle_stand', -38, 48, 1.2, 1);
  circle(-38, 42, 0.35);
  circle(-38, 48, 0.35);
  fire(-38, 1.7, 42, 0.2);
  fire(-38, 1.7, 48, 0.2);
  reserve(-35, 45, 14);
  reserve(-1, 70, 11);
  reserve(0, 110, 6);

  ruinHouse(random, -44, 90, 2, 2, 'e');
  ruinHouse(random, -24, 88, 1, 2, 'e');
  ruinHouse(random, 24, 92, 2, 2, 'w');
  ruinHouse(random, 46, 92, 1, 2, 's');
  ruinHouse(random, 26, 48, 2, 1, 'n');
  ruinHouse(random, 46, 42, 1, 2, 'w');
  ruinHouse(random, -46, 72, 1, 1, 'e');
  ruinHouse(random, -20, 68, 1, 1, 'e');
  for (const [x, z] of [[-44, 90], [-24, 88], [24, 92], [46, 92], [26, 48], [46, 42], [-46, 72], [-20, 68]]) reserve(x, z, 8);

  // Wrecked carts, crates and barrels along the street.
  for (const [x, z, yaw] of [[9, 82, 0.5], [-10, 56, 2.2], [14, 38, 4]]) {
    props('cart', x, z, yaw, 1);
    rect(x, z, 1.5, 1.1, yaw);
  }
  for (const [x, z, yaw] of [[-11, 92, 0.2], [13, 60, 1.3], [-7, 36, 2.8], [37, 66, 0.7]]) {
    props('crate_stack', x, z, yaw, 1);
    rect(x, z, 0.95, 0.6, yaw);
  }
  for (const [x, z] of [[-9, 96], [12, 56], [-5, 39], [34, 64], [10, 88], [-13, 60]]) {
    props('barrel', x, z, random() * 6, 1);
    circle(x, z, 0.42);
  }
  for (const [x, z] of [[11, 66], [-8, 80], [8, 44], [36, 75]]) {
    props('crate', x, z, random() * 6, 1);
    rect(x, z, 0.42, 0.42);
  }
  for (const [x, z] of [[-6, 74], [16, 72], [-8, 104], [10, 104]]) {
    props('brazier_unlit', x, z, 0, 1);
    circle(x, z, 0.35);
    fire(x, 1.6, z, 0.55);
  }
  // Broken gateposts where the old walls stood.
  gateArch(0, 110, 0, 1.25, 'wall_arch_broken');
  gateArch(0, 30, 0, 1.25, 'wall_arch_broken');
  gateArch(60, 70, 1.5708, 1.25, 'wall_arch_broken');
  reserve(0, 30, 6);
  reserve(60, 70, 6);
  const low = (i) => (i % 3 === 2 ? null : i % 3 === 0 ? 'wall_ruin_low' : 'wall_ruin');
  for (const [ax, az, bx, bz] of [[-58, 110, -6, 110], [6, 110, 58, 110], [-58, 30, -6, 30], [6, 30, 58, 30], [60, 32, 60, 64], [60, 76, 60, 108]]) {
    wallRun(ax, az, bx, bz, { scale: 1, pick: low, collide: false });
    const n = Math.round(Math.hypot(bx - ax, bz - az) / 6);
    for (let i = 0; i < n; i += 1) {
      if (i % 3 === 2) continue;
      const t = (i + 0.5) / n;
      rect(ax + (bx - ax) * t, az + (bz - az) * t, 3 * (Math.hypot(bx - ax, bz - az) / (n * 6)), 0.28, yawAlong(ax, az, bx, bz));
    }
  }
  for (let i = 0; i < 300; i += 1) {
    const x = -58 + random() * 118;
    const z = 31 + random() * 78;
    if (distToRoad(x, z) < 3 || isReserved(x, z, -6)) continue;
    forest(random() > 0.8 ? 'grass_wispy' : 'grass_short', x, z, random() * 6, 0.8 + random() * 0.8);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = -55 + random() * 110;
    const z = 33 + random() * 74;
    if (distToRoad(x, z) < 6 || isReserved(x, z, -3) || hitsCollider(x, z, 2)) continue;
    castle(random() > 0.5 ? 'rubble_small' : 'rocks_small', x, z, random() * 6, 0.7 + random() * 0.5);
  }
}

/* ---------- Ash Flats ---------- */

function ashFlats(random) {
  castle('wall_arch_broken', -22, -38, 0.25, 1.6);
  rect(-22 - 4.1, -38 + 1.0, 0.65, 0.5, 0.25);
  rect(-22 + 4.1, -38 - 1.0, 0.65, 0.5, 0.25);
  reserve(-22, -38, 9);
  castle('wall_ruin', 30, -16, 1.1, 1.5);
  rect(30, -16, 4.5, 0.42, 1.1);
  reserve(30, -16, 7);
  // Toppled columns lying beside the road.
  for (const [x, z, yaw] of [[-18, 0, 0.6], [17, -52, 2.5], [-16, -76, 1.7], [24, 14, 3.4]]) {
    castle('pillar_round', x, z, yaw, 1.5, { y: 0.55, tilt: 1.5 });
    const length = 4.5;
    // A tipped pillar's base stays at (x, z), so its body reaches out along the yaw direction.
    const dirX = Math.cos(yaw);
    const dirZ = -Math.sin(yaw);
    rect(x + dirX * length, z + dirZ * length, length, 0.65, yaw);
    reserve(x + dirX * length, z + dirZ * length, 6);
  }
  props('cart', -14, -60, 1.1, 1.2);
  rect(-14, -60, 1.8, 1.3, 1.1);
  reserve(-14, -60, 4);
  // Lone stones and snags on the way to the gate, pacing the long walk.
  let placed = 0;
  for (let tries = 0; tries < 300 && placed < 26; tries += 1) {
    const x = -54 + random() * 108;
    const z = -96 + random() * 122;
    if (distToRoad(x, z) < 6 || distToTrail(x, z) < 4 || isReserved(x, z, 3) || hitsCollider(x, z, 3)) continue;
    const roll = random();
    const scale = 0.9 + random() * 0.6;
    if (roll < 0.6) {
      forest('tree_snag', x, z, random() * 6, scale);
      circle(x, z, 0.22 * scale);
    } else if (roll < 0.8) {
      forest('rock_spire', x, z, random() * 6, scale * 0.9, { y: -1.1 });
      circle(x, z, 0.9 * scale);
    } else {
      forest('boulder_b', x, z, random() * 6, scale * 0.8);
      circle(x, z, 1.25 * scale * 0.8);
    }
    placed += 1;
  }
  for (let i = 0; i < 40; i += 1) {
    const x = -55 + random() * 110;
    const z = -95 + random() * 122;
    if (distToRoad(x, z) < 5 || isReserved(x, z, -1) || hitsCollider(x, z, 2)) continue;
    castle(random() > 0.5 ? 'rocks_small' : 'rubble_small', x, z, random() * 6, 0.6 + random() * 0.6);
  }
  for (let i = 0; i < 420; i += 1) {
    const x = -58 + random() * 116;
    const z = -98 + random() * 126;
    if (distToRoad(x, z) < 3) continue;
    forest(random() > 0.15 ? 'grass_short' : 'grass_wispy', x, z, random() * 6, 0.8 + random() * 0.6);
  }
  for (let i = 0; i < 140; i += 1) {
    const x = -58 + random() * 116;
    const z = -98 + random() * 126;
    if (distToRoad(x, z) < 3) continue;
    forest('rock_small', x, z, random() * 6, 0.6 + random() * 1.2);
  }
}

/* ---------- Cursed Forest ---------- */

// Only trees the art director kept. Radii are the measured trunk, a bit tighter on the big crowns.
const TREES = [
  // Only the trees that held up in the art review. The rest read as toys in the game's own light.
  ['tree_gnarled_a', 0.5, 34],
  ['tree_gnarled_b', 0.52, 26],
  ['tree_gnarled_c', 0.62, 22],
  ['tree_pine_c', 0.27, 12],
  ['tree_snag', 0.22, 10],
];
const TREE_WEIGHT = TREES.reduce((sum, tree) => sum + tree[2], 0);
function pickTree(random) {
  let roll = random() * TREE_WEIGHT;
  for (const tree of TREES) {
    roll -= tree[2];
    if (roll <= 0) return tree;
  }
  return TREES[0];
}

function poisson(random, minX, maxX, minZ, maxZ, gap, tries, accept) {
  const points = [];
  const cell = gap;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < tries; i += 1) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (!accept(x, z)) continue;
    let clear = true;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let a = cx - 1; a <= cx + 1 && clear; a += 1) {
      for (let b = cz - 1; b <= cz + 1 && clear; b += 1) {
        for (const other of grid.get(`${a},${b}`) ?? []) {
          if (Math.hypot(other.x - x, other.z - z) < gap) clear = false;
        }
      }
    }
    if (!clear) continue;
    const point = { x, z };
    points.push(point);
    const k = key(x, z);
    grid.set(k, [...(grid.get(k) ?? []), point]);
  }
  return points;
}

/** Tips a whole tree onto the ground. Its collider is a long thin box along the trunk. */
function fallenTree(node, x, z, yaw, scale, length) {
  forest(node, x, z, yaw, scale, { y: 0.25, tilt: 1.52 });
  const dirX = Math.cos(yaw);
  const dirZ = -Math.sin(yaw);
  // Only the trunk blocks; the crown is thin twigs that a person pushes through.
  rect(x + (dirX * length) / 2, z + (dirZ * length) / 2, length / 2, 0.42, yaw);
  reserve(x + (dirX * length) / 2, z + (dirZ * length) / 2, length / 2 + 2);
}

function lantern(x, z) {
  castle('pillar_stump', x, z, x + z, 0.62);
  circle(x, z, 0.28);
  fire(x, 1.8, z, 0.34);
  reserve(x, z, 2);
}

function hut() {
  // Three solid walls under one thatched roof, open to the south where the path comes in. It's
  // square and centered under the roof's peak, so that no wall or corner pokes through.
  const s = 0.72;
  const x = 190;
  const z = -40;
  const half = 4.3;
  wallRun(x - half, z - half, x + half, z - half, { scale: s, pick: () => 'wall' });
  wallRun(x - half, z + half, x - half, z - half, { scale: s, pick: () => 'wall' });
  wallRun(x + half, z - half, x + half, z + half, { scale: s, pick: () => 'wall' });
  // Shorter than the walls, because the roof slopes down over the corners.
  const postScale = 0.65;
  for (const [px, pz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    castle('pillar_buttress', x + px, z + pz, 0, postScale);
  }
  // Rests just below the top of the walls and overhangs them, so it hides where they meet.
  spire(x, 4.2, z, 5 * Math.SQRT2, 2.6);
  // A fire left burning beside the chest, the only thing lit for a long way around.
  props('torch_iron', x + 1.7, z - 2.4, 0, 1);
  circle(x + 1.7, z - 2.4, 0.2);
  fire(x + 1.7, 1.95, z - 2.4, 0.42);
  props('crate_stack', x + 2.7, z - 2.8, 0.2, 0.9);
  rect(x + 2.7, z - 2.8, 0.85, 0.55, 0.2);
  props('barrel', x - 2.9, z - 2.9, 1, 1);
  circle(x - 2.9, z - 2.9, 0.42);
  props('barrel', x - 2.9, z - 1.8, 2, 0.9);
  circle(x - 2.9, z - 1.8, 0.38);
  lantern(x - 5.4, z + 5);
  lantern(x + 5.4, z + 5);
  forest('log_a', x + 6, z + 2.5, 0.4, 1.7);
  rect(x + 6, z + 2.5, 1.65, 0.42, 0.4);
  props('crate', x - 7, z + 1, 0.5, 1);
  rect(x - 7, z + 1, 0.42, 0.42, 0.5);
}

function cursedForest(random) {
  hut();
  // Standing stones ringing the clearing, with gaps for the paths.
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const x = 150 + Math.cos(a) * 16.5;
    const z = 10 + Math.sin(a) * 16.5;
    if (distToTrail(x, z) < 4) continue;
    forest('rock_spire', x, z, a * 3, 1 + random() * 0.5, { y: -1.2 });
    circle(x, z, 1);
  }
  forest('tree_twisted_blood', 163, -6, 1, 1.7);
  circle(163, -6, 0.75 * 1.7);
  forest('tree_twisted_blood', 137, 22, 3, 1.5);
  circle(137, 22, 0.75 * 1.5);
  reserve(163, -6, 3);
  reserve(137, 22, 3);
  // Lanterns along the paths, spaced so there's always a next one in the fog.
  for (const [x, z] of [[66, 66], [86, 53], [103, 42], [118, 26], [134, 12], [161, -3], [175, -24], [66, -8], [95, 8], [122, 5]]) lantern(x, z);
  for (const [node, x, z, yaw, scale, length] of [
    ['tree_gnarled_a', 80, 12, 0.5, 1.2, 10],
    ['tree_gnarled_b', 118, 62, 2.2, 1.1, 11],
    ['tree_gnarled_a', 176, 44, 3.9, 1.3, 11],
    ['tree_gnarled_c', 206, -24, 1.1, 1, 12],
    ['tree_gnarled_a', 104, -18, 5.4, 1.2, 10],
    ['tree_gnarled_b', 158, -52, 0.3, 1.1, 11],
    ['tree_gnarled_a', 216, 40, 2.8, 1.2, 10],
    ['tree_snag', 142, 48, 4.4, 1.4, 8],
    ['tree_snag', 186, 18, 1.9, 1.5, 9],
  ]) {
    if (!isReserved(x, z, 1) && distToTrail(x + Math.cos(yaw) * length, z - Math.sin(yaw) * length) > 3 && distToTrail(x, z) > 3) {
      fallenTree(node, x, z, yaw, scale, length);
    }
  }
  // Logs and stumps. Long ones use the box footprint from the asset notes.
  for (let i = 0; i < 26; i += 1) {
    const x = 62 + random() * 168;
    const z = -88 + random() * 196;
    if (distToTrail(x, z) < 4 || isReserved(x, z, 3) || hitsCollider(x, z, 3)) continue;
    const yaw = random() * 6.28;
    const scale = 1.5 + random() * 1.4;
    const node = random() > 0.5 ? 'log_a' : 'log_b';
    forest(node, x, z, yaw, scale);
    rect(x, z, (node === 'log_a' ? 0.95 : 0.89) * scale, 0.32 * scale, yaw);
  }
  for (let i = 0; i < 24; i += 1) {
    const x = 62 + random() * 168;
    const z = -88 + random() * 196;
    if (distToTrail(x, z) < 3 || isReserved(x, z, 2) || hitsCollider(x, z, 2)) continue;
    const node = random() > 0.5 ? 'stump_a' : 'stump_c';
    const scale = 0.9 + random() * 0.8;
    forest(node, x, z, random() * 6.28, scale);
    circle(x, z, (node === 'stump_a' ? 0.4 : 0.48) * scale);
  }
  // Mossy boulders.
  let placed = 0;
  for (let tries = 0; tries < 800 && placed < 62; tries += 1) {
    const x = 60 + random() * 172;
    const z = -90 + random() * 200;
    if (distToTrail(x, z) < 4.5 || isReserved(x, z, 4) || hitsCollider(x, z, 3)) continue;
    const roll = random();
    const scale = 0.6 + random() * 0.9;
    const node = roll < 0.3 ? 'boulder_a' : roll < 0.55 ? 'boulder_b' : roll < 0.7 ? 'boulder_c' : 'rock_slab';
    forest(node, x, z, random() * 6.28, scale);
    circle(x, z, { boulder_a: 1.55, boulder_b: 1.3, boulder_c: 2.1, rock_slab: 0.95 }[node] * scale);
    placed += 1;
  }
  // Extra standing stones among the trees.
  for (let i = 0; i < 12; i += 1) {
    const x = 70 + random() * 155;
    const z = -80 + random() * 180;
    if (distToTrail(x, z) < 5 || isReserved(x, z, 3) || hitsCollider(x, z, 3)) continue;
    const scale = 0.9 + random() * 0.8;
    forest('rock_spire', x, z, random() * 6.28, scale, { y: -1.2 * scale });
    circle(x, z, 0.95 * scale);
  }

  // Trees last, around everything else, with a fringe outside the map so the wood never just stops.
  const inPlay = (x, z) =>
    distToTrail(x, z) > 3.4 &&
    !isReserved(x, z, 1.6) &&
    !hitsCollider(x, z, 1.9);
  const points = poisson(random, 60, 234, -92, 112, 5.7, 26000, (x, z) => {
    // A soft western edge: thin at the fringes, dense inside.
    const edge = smooth(60, 78, x);
    if (random() > 0.22 + edge * 0.78) return false;
    return inPlay(x, z);
  });
  let trees = 0;
  for (const { x, z } of points) {
    const [node, radius] = pickTree(random);
    const scale = 0.95 + random() * 0.65;
    forest(node, x, z, random() * 6.28, scale);
    circle(x, z, radius * scale);
    trees += 1;
  }
  // Past the east edge, behind the map's limit: no colliders, the player can't get there.
  for (const { x, z } of poisson(random, 241, 262, -90, 112, 8, 400, () => true)) {
    forest(pickTree(random)[0], x, z, random() * 6.28, 1 + random() * 0.6);
  }
  console.log(`forest trees with colliders: ${trees}`);

  // Undergrowth. Cheap props by the thousand, the heavy ones as a sprinkling.
  const scatter = (count, node, min, max, clearTrail = 1.8) => {
    for (let i = 0; i < count; i += 1) {
      const x = 58 + random() * 180;
      const z = -92 + random() * 204;
      // Nothing grows over a chest, a fire or the clearing's own grass.
      if (distToTrail(x, z) < clearTrail || isReserved(x, z, 0)) continue;
      forest(node, x, z, random() * 6.28, min + random() * (max - min));
    }
  };
  scatter(1500, 'fern_psx', 0.9, 1.9);
  scatter(70, 'fern_a', 0.8, 1.4);
  scatter(70, 'bush_a', 0.8, 1.5, 3);
  scatter(90, 'grass_wispy', 0.9, 1.5);
  scatter(500, 'grass_short', 1, 1.8);
  scatter(240, 'grass_tall', 0.8, 1.3);
  scatter(280, 'rock_small', 0.6, 1.8);
  scatter(90, 'mushroom_a', 0.9, 1.9);
  // Grass thickens in the clearing, where the light gets through.
  for (let i = 0; i < 240; i += 1) {
    const a = random() * 6.28;
    const r = 2.5 + Math.sqrt(random()) * 14;
    forest(random() > 0.5 ? 'grass_tall' : 'grass_short', 150 + Math.cos(a) * r, 10 + Math.sin(a) * r, random() * 6, 1 + random() * 0.7);
  }
}

/* ---------- Fallen Citadel ---------- */

function citadel(random) {
  const s = 1.5;
  const left = -90;
  const right = 90;
  const south = -100;
  const north = -190;
  const gateHalf = 4.5;

  // Two courses of wall make 18 m, which is what lets the castle read from across the land.
  // The top course is broken in places, so the skyline isn't ruler straight.
  const courses = (i, n, course) => {
    // No windows in the lower course: from outside they read as glowing holes into the yard.
    if (course === 0) return 'wall';
    const roll = (i * 7 + n * 3) % 11;
    return roll === 3 || roll === 8 ? 'wall_ruin' : 'wall_crenel';
  };
  wallRun(left, south, -gateHalf, south, { scale: s, courses: 2, pick: courses });
  wallRun(gateHalf, south, right, south, { scale: s, courses: 2, pick: courses });
  wallRun(left, north, -gateHalf, north, { scale: s, courses: 2, pick: courses, collide: false });
  wallRun(gateHalf, north, right, north, { scale: s, courses: 2, pick: courses, collide: false });
  // The north wall is one unbroken collider until the throne is built: its gate stays shut.
  rect(0, north, 90, WALL_HALF_DEPTH * s + 0.05);
  wallRun(left, north, left, south, { scale: s, courses: 2, pick: courses });
  wallRun(right, south, right, north, { scale: s, courses: 2, pick: courses });

  // Main gate, open doors swung inward, with the wall carrying on above it.
  gateArch(0, south, 0, s, 'wall_gate_round');
  castle('wall_crenel', 0, south, 0, s, { y: 6 * s });
  const hinge = 2.18 * s;
  const swing = 1.42;
  castle('door_round_l', -hinge, south, swing, s);
  castle('door_round_r', hinge, south, -swing, s);
  const leaf = 2.16 * s;
  rect(-hinge + (Math.cos(swing) * leaf) / 2, south - (Math.sin(swing) * leaf) / 2, leaf / 2, 0.22, swing);
  rect(hinge - (Math.cos(swing) * leaf) / 2, south - (Math.sin(swing) * leaf) / 2, leaf / 2, 0.22, -swing);
  castle('banner_torn_crimson', -4.5, south + 0.95, 0, 1.6, { y: 9.5 });
  castle('banner_torn_crimson', 4.5, south + 0.95, 0, 1.6, { y: 9.5 });

  // North gate, shut.
  castle('wall_gate_gothic', 0, north, 0, s);
  castle('wall_crenel', 0, north, 0, s, { y: 6 * s });
  castle('door_gothic_l', -hinge, north, 0, s);
  castle('door_gothic_r', hinge, north, 0, s);

  // Towers. Gate towers and corners are stacked; a roof on most, a shattered top on a few.
  roundTower(-10.7, south, s, 2);
  roundTower(10.7, south, s, 2);
  roundTower(left, south, s * 1.15, 2);
  roundTower(right, south, s * 1.15, 2, { roof: false });
  roundTower(left, north, s * 1.15, 3);
  roundTower(right, north, s * 1.15, 3);
  // Mid-wall buttress towers break up the long runs.
  roundTower(-48, south, s, 2, { roof: false });
  roundTower(48, south, s, 2);
  roundTower(left, -145, s, 2);
  roundTower(right, -145, s, 2, { roof: false });

  // The keep: three sections of giant tower, and a huge door the player can't open.
  const keepZ = -168;
  const k = 2.6;
  towerStack('tower_square', 0, keepZ, k, 3, { base: 'tower_square_gate' });
  rect(0, keepZ, 8.22 * k * 0.5, 8.22 * k * 0.5);
  castle('door_round_l', -2.18 * k, keepZ + 3 * k, 0, k);
  castle('door_round_r', 2.18 * k, keepZ + 3 * k, 0, k);
  for (const dx of [-1, 1]) {
    roundTower(dx * 17, keepZ + 2, 1.9, 3);
    roundTower(dx * 17, keepZ - 14, 1.5, 4);
    castle('banner_crimson', dx * 9, keepZ + 3 * k + 0.45, 0, 2.4, { y: 12 });
    props('brazier_unlit', dx * 12, -151, 0, 1.5);
    circle(dx * 12, -151, 0.45);
    fire(dx * 12, 2.4, -151, 0.95);
  }
  // Wide steps up to the door. They can't be climbed, since the game is flat, so they're solid.
  for (const dx of [-7, 0, 7]) {
    castle('stairs', dx, keepZ + 3 * k + 4, Math.PI / 2, 2.3);
  }
  rect(0, keepZ + 3 * k + 4, 11, 3.7);

  // East tower holds the gilded chest; it is the one you can walk into.
  const tx = 72;
  const tz = -170;
  const ts = 1.6;
  towerStack('tower_square', tx, tz, ts, 3, { base: 'tower_square_gate' });
  const face = 3 * ts;
  const halfOpen = 2.18 * ts;
  rect(tx, tz - face, face + 0.45, 0.5);
  rect(tx - face, tz, 0.5, face + 0.45);
  rect(tx + face, tz, 0.5, face + 0.45);
  rect(tx - (face + 0.4 + halfOpen) / 2, tz + face, (face + 0.4 - halfOpen) / 2, 0.5);
  rect(tx + (face + 0.4 + halfOpen) / 2, tz + face, (face + 0.4 - halfOpen) / 2, 0.5);
  castle('floor_squares', tx, tz, 0, 2.4, { y: -0.1 });
  props('brazier_unlit', tx - 3, tz - 3, 0, 1);
  circle(tx - 3, tz - 3, 0.35);
  fire(tx - 3, 1.6, tz - 3, 0.5);
  props('brazier_unlit', tx + 3, tz - 3, 0, 1);
  circle(tx + 3, tz - 3, 0.35);
  fire(tx + 3, 1.6, tz - 3, 0.5);
  reserve(tx, tz, 10);
  // Its twin to the west is sealed.
  towerStack('tower_square', -tx, tz, ts, 3);
  rect(-tx, tz, 8.22 * ts * 0.5, 8.22 * ts * 0.5);

  // The processional road from the gate to the keep: tiles, columns, and two great arches.
  for (let z = -112; z >= -152; z -= 4.5) {
    for (let x = -4.5; x <= 4.5; x += 4.5) {
      castle(((x + z) | 0) % 3 === 0 ? 'floor_diamond' : 'floor_squares', x, z, 0, 1.5, { y: -0.1 });
    }
  }
  for (const z of [-114, -122, -130, -138, -146]) {
    for (const dx of [-9.5, 9.5]) {
      const broken = (z === -122 && dx > 0) || (z === -138 && dx < 0);
      if (broken) {
        pillar('pillar_stump', dx, z, 1.5, 0.42);
        castle('rubble_small', dx + Math.sign(dx) * 2.5, z + 1, z, 1);
      } else {
        pillar('pillar_round', dx, z, 1.7, 0.42);
      }
      if (z === -114 || z === -130 || z === -146) {
        castle(z === -130 ? 'banner_crimson' : 'banner_torn_crimson', dx, z + 0.82, 0, 1.25, { y: 4.4 });
      }
    }
  }
  for (const z of [-119, -141]) {
    castle('arch_gothic', 0, z, 0, 1.9);
    circle(-2.05 * 1.9, z, 0.42 * 1.9);
    circle(2.05 * 1.9, z, 0.42 * 1.9);
  }
  // Fires up the yard.
  for (const z of [-111, -127, -143]) {
    for (const dx of [-5.8, 5.8]) {
      props('brazier_unlit', dx, z, 0, 1.15);
      circle(dx, z, 0.38);
      fire(dx, 1.85, z, 0.68);
    }
  }
  // Rearing stags watching the yard.
  for (const dx of [-21, 21]) {
    castle('statue_stag', dx, -128, dx > 0 ? -Math.PI / 2 : Math.PI / 2, 1.7);
    rect(dx, -128, 1.35, 1.35);
  }
  // Arcades down each side of the yard, gapped where they've collapsed.
  for (const dx of [-36, 36]) {
    for (let i = 0; i < 10; i += 1) {
      const z = -112 + i * -7.6;
      if (i === 3 || i === 7) {
        castle('rubble_large', dx + 1.5, z, i, 1.1);
        rect(dx + 1.5, z, 1.7, 1.6, i);
        continue;
      }
      castle('arch_support', dx, z, Math.PI / 2, 1.7);
      circle(dx, z, 0.55 * 1.7);
    }
  }
  // Wall dressing: torches and banners facing into the yard, and torches outside the gate.
  for (const x of [-72, -54, -30, 30, 54, 72]) {
    castle('banner_torn_gold', x, south - 0.9, Math.PI, 1.5, { y: 7.5 });
    props('torch_iron', x + 6, south - 0.6, Math.PI, 1.7, { y: 3.4 });
    fire(x + 6, 4.45, south - 1.3, 0.55);
  }
  for (const z of [-118, -135, -158, -176]) {
    for (const [x, yaw, off] of [[left + 0.55, Math.PI / 2, 0.75], [right - 0.55, -Math.PI / 2, -0.75]]) {
      props('torch_iron', x, z, yaw, 1.7, { y: 3.4 });
      fire(x + off, 4.45, z, 0.55);
    }
  }
  for (const x of [-22, 22, -36, 36, -68, 68]) {
    castle('banner_torn_crimson', x, south + 0.9, 0, 1.6, { y: 7 });
  }
  for (const dx of [-7, 7]) {
    props('brazier_unlit', dx, -93, 0, 1.25);
    circle(dx, -93, 0.4);
    fire(dx, 2.0, -93, 0.8);
  }
  // Rubble heaps, and tumbled wall sections leaning in from the broken top course.
  for (let i = 0; i < 46; i += 1) {
    const x = left + 6 + random() * (right - left - 12);
    const z = north + 6 + random() * (south - north - 12);
    if (Math.abs(x) < 13 && z > -156) continue;
    if (hitsCollider(x, z, 2.2) || isReserved(x, z, 1)) continue;
    const roll = random();
    if (roll < 0.25) {
      castle('rubble_large', x, z, random() * 6.28, 0.9 + random() * 0.4);
      circle(x, z, 1.5);
    } else if (roll < 0.65) {
      castle('rubble_small', x, z, random() * 6.28, 0.8 + random() * 0.5);
    } else {
      castle('rocks_small', x, z, random() * 6.28, 0.7 + random() * 0.6);
    }
  }
  // Rubble at the foot of the outer wall, and a few dead trees, so it doesn't rise from a clean lawn.
  for (let i = 0; i < 16; i += 1) {
    const x = -84 + random() * 168;
    const z = -96 + random() * 6;
    if (Math.abs(x) < 12) continue;
    castle(random() > 0.5 ? 'rubble_small' : 'rocks_large', x, z, random() * 6.28, 0.9 + random() * 0.6);
  }
  for (const x of [-30, -14, 19, 38]) {
    forest('tree_snag', x, -86 - (x % 3), x, 1.2);
    circle(x, -86 - (x % 3), 0.26);
  }
  // Weeds through the paving.
  for (let i = 0; i < 180; i += 1) {
    const x = -86 + random() * 172;
    const z = -186 + random() * 82;
    if (Math.abs(x) < 7) continue;
    forest('grass_short', x, z, random() * 6.28, 0.7 + random() * 0.6);
  }
}

/* ---------- Things not built yet stay closed ---------- */

function closedLands(random) {
  // The graveyard's fence: a ruined wall along the village side and across to the map's west edge.
  const fence = (i) => ['wall_ruin', 'wall', 'wall_ruin_low', 'wall_crenel', 'wall_ruin'][i % 5];
  wallRun(-60, -100, -60, 112, { scale: 1.1, pick: fence });
  wallRun(-240, 112, -60, 112, { scale: 1.1, pick: fence });
  // Where the graveyard gate will one day go: iron bars.
  castle('fence_iron', -59.5, 70, Math.PI / 2, 1.4);
  castle('pillar_square', -59.5, 66.8, 0, 1.15);
  castle('pillar_square', -59.5, 73.2, 0, 1.15);
  // The blighted wood behind it. The player can't reach it, so it needs no colliders.
  const trees = poisson(random, -160, -62.5, -94, 110, 7, 1500, () => true);
  for (const { x, z } of trees) {
    const roll = random();
    forest(roll < 0.5 ? 'tree_gnarled_a' : roll < 0.8 ? 'tree_gnarled_c' : 'tree_gnarled_b', x, z, random() * 6.28, 1 + random() * 0.7);
  }
  const moorTrees = poisson(random, -236, -100, 60, 111, 8, 300, () => true);
  for (const { x, z } of moorTrees) {
    forest(random() > 0.4 ? 'tree_gnarled_b' : 'tree_snag', x, z, random() * 6.28, 1 + random() * 0.5);
  }

  // Solid mountain either side of the citadel; world.ts raises the same land into peaks.
  rect((94 + 240) / 2, (-290 + -92) / 2, (240 - 94) / 2, (290 - 92) / 2);
  rect(-(94 + 240) / 2, (-290 + -92) / 2, (240 - 94) / 2, (290 - 92) / 2);
  // Boulders where the land starts to climb.
  for (let i = 0; i < 34; i += 1) {
    const x = 96 + random() * 140;
    const z = -92 - random() * 8;
    forest(random() > 0.5 ? 'boulder_c' : 'boulder_a', x, z, random() * 6.28, 1.5 + random() * 2);
  }
}

/* ---------- Generate ---------- */

pilgrimsRest();
citadel(makeRandom(4041));
closedLands(makeRandom(5151));
village(makeRandom(2021));
ashFlats(makeRandom(3031));
meadow(makeRandom(1011));
cursedForest(makeRandom(6061));

const ZONES = [
  { name: "Pilgrim's Rest", minX: -240, maxX: 240, minZ: 155, maxZ: 210, fogNear: 22, fogFar: 85 },
  { name: 'Pale Meadow', minX: -240, maxX: 240, minZ: 112, maxZ: 155, fogNear: 22, fogFar: 85 },
  { name: 'Forsaken Village', minX: -60, maxX: 60, minZ: 30, maxZ: 112, fogNear: 18, fogFar: 80 },
  { name: 'Ash Flats', minX: -60, maxX: 60, minZ: -92, maxZ: 30, fogNear: 20, fogFar: 85 },
  { name: 'Cursed Forest', minX: 60, maxX: 240, minZ: -92, maxZ: 112, fogNear: 8, fogFar: 48 },
  { name: 'Sunken Graveyard', minX: -240, maxX: -60, minZ: -92, maxZ: 112, fogNear: 10, fogFar: 60 },
  { name: 'Fallen Citadel', minX: -94, maxX: 94, minZ: -192, maxZ: -92, fogNear: 30, fogFar: 125 },
  { name: 'Throne of Ash', minX: -94, maxX: 94, minZ: -290, maxZ: -192, fogNear: 30, fogFar: 85 },
];

const MAP = {
  version: 3,
  bounds: BOUNDS,
  spawn: SPAWN,
  colliders,
  camps: CAMPS,
  chests: CHESTS,
  graces: GRACES,
  zones: ZONES,
  road: ROAD,
  trails: TRAILS,
  fires,
  spires,
  props: [...batches.values()],
};

const lines = (list) => list.map((item) => `    ${JSON.stringify(item)},`).join('\n');
const text = `/** Generated by tools/build-map.mjs. Do not edit by hand. */
import type { MapData } from './mapTypes.js';

export const MAP: MapData = {
  version: ${MAP.version},
  bounds: ${JSON.stringify(MAP.bounds)},
  spawn: ${JSON.stringify(MAP.spawn)},
  colliders: [
${lines(MAP.colliders)}
  ],
  camps: [
${lines(MAP.camps)}
  ],
  chests: [
${lines(MAP.chests)}
  ],
  graces: [
${lines(MAP.graces)}
  ],
  zones: [
${lines(MAP.zones)}
  ],
  road: ${JSON.stringify(MAP.road)},
  trails: ${JSON.stringify(MAP.trails)},
  fires: ${JSON.stringify(MAP.fires)},
  spires: ${JSON.stringify(MAP.spires)},
  props: [
${lines(MAP.props)}
  ],
};
`;
writeFileSync(OUT, text);
const instances = MAP.props.reduce((sum, batch) => sum + batch.items.length / 4, 0);
console.log(`wrote ${OUT}: ${(text.length / 1024).toFixed(0)} KB, ${colliders.length} colliders, ${instances} props in ${MAP.props.length} batches, ${fires.length / 4} fires`);
