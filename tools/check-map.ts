/**
 * Checks the generated map against the same collision code the game uses: that no important spot
 * is inside a wall, and that a player can walk from spawn to every one of them.
 *
 * Run: client/node_modules/.bin/esbuild tools/check-map.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
 */
import { collide } from '../shared/collision.js';
import { GRACE_SEATS, graceSeat } from '../shared/graces.js';
import { MAP } from '../shared/mapData.js';
import { PLAYER_RADIUS } from '../shared/sim.js';

const { bounds } = MAP;
const STEP = 0.5;
const columns = Math.floor((bounds.maxX - bounds.minX) / STEP) + 1;
const rows = Math.floor((bounds.maxZ - bounds.minZ) / STEP) + 1;

function isFree(x: number, z: number, radius: number): boolean {
  const probe = { x, z };
  collide(probe, radius);
  return probe.x === x && probe.z === z;
}

/** Everything reachable from the start by stepping between open grid points. */
function flood(radius: number, startX: number, startZ: number): Uint8Array {
  const free = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      free[row * columns + column] = isFree(bounds.minX + column * STEP, bounds.minZ + row * STEP, radius) ? 1 : 0;
    }
  }
  const seen = new Uint8Array(columns * rows);
  const queue = new Int32Array(columns * rows);
  let head = 0;
  let tail = 0;
  const start = Math.round((startZ - bounds.minZ) / STEP) * columns + Math.round((startX - bounds.minX) / STEP);
  if (!free[start]) throw new Error('the start is inside a collider');
  seen[start] = 1;
  queue[tail++] = start;
  const steps = [1, -1, columns, -columns];
  while (head < tail) {
    const at = queue[head++];
    for (const step of steps) {
      const next = at + step;
      if (next < 0 || next >= free.length || seen[next] || !free[next]) continue;
      if ((step === 1 || step === -1) && Math.floor(next / columns) !== Math.floor(at / columns)) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return seen;
}

function reachedNear(seen: Uint8Array, x: number, z: number, within: number): boolean {
  const reach = Math.ceil(within / STEP);
  const row = Math.round((z - bounds.minZ) / STEP);
  const column = Math.round((x - bounds.minX) / STEP);
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (dx * dx + dz * dz > reach * reach) continue;
      const key = (row + dz) * columns + column + dx;
      if (key >= 0 && key < seen.length && seen[key]) return true;
    }
  }
  return false;
}

interface Spot {
  name: string;
  x: number;
  z: number;
}
const spots: Spot[] = [
  { name: 'spawn', x: MAP.spawn.x, z: MAP.spawn.z },
  ...MAP.chests.map((chest) => ({ name: `chest ${chest.id}`, x: chest.x, z: chest.z })),
  ...MAP.graces.map((grace) => ({ name: `grace ${grace.id}`, x: grace.x, z: grace.z })),
  // Every seat must be open, or a resting player would be pushed out of the circle.
  ...MAP.graces.flatMap((grace) =>
    Array.from({ length: GRACE_SEATS }, (_, seat) => ({ name: `grace ${grace.id} seat ${seat}`, ...graceSeat(grace, seat) })),
  ),
  ...MAP.camps.map((camp, index) => ({ name: `camp ${index} ${camp.kind}`, x: camp.x, z: camp.z })),
];
// Spawn points scatter across this circle, so the whole of it must be open.
for (let i = 0; i < 16; i += 1) {
  const angle = (i / 16) * Math.PI * 2;
  for (const r of [MAP.spawn.radius * 0.5, MAP.spawn.radius]) {
    spots.push({ name: `spawn ring ${i}`, x: MAP.spawn.x + Math.cos(angle) * r, z: MAP.spawn.z + Math.sin(angle) * r });
  }
}

let failures = 0;
for (const spot of spots) {
  if (!isFree(spot.x, spot.z, PLAYER_RADIUS)) {
    console.log(`INSIDE A COLLIDER: ${spot.name} at ${spot.x}, ${spot.z}`);
    failures += 1;
  }
}

const player = flood(PLAYER_RADIUS, MAP.spawn.x, MAP.spawn.z);
for (const spot of spots) {
  if (!reachedNear(player, spot.x, spot.z, 1.5)) {
    console.log(`NOT REACHABLE: ${spot.name} at ${spot.x}, ${spot.z}`);
    failures += 1;
  }
}

// The biggest walker must also be able to reach its own camp's surroundings without being stuck.
for (const camp of MAP.camps) {
  const radius = camp.kind === 'bull' ? 1.2 : 0.7;
  if (!isFree(camp.x, camp.z, radius)) {
    console.log(`CAMP TOO TIGHT: ${camp.kind} at ${camp.x}, ${camp.z}`);
    failures += 1;
  }
}

// Walks through the main gate along the road in small steps, the way the game moves a player.
const walker = { x: 0, z: -85 };
let deflected = 0;
for (let z = -85; z > -112; z -= 0.1) {
  const expectedX = walker.x;
  walker.z = z;
  collide(walker, PLAYER_RADIUS);
  if (Math.abs(walker.x - expectedX) > 0.001 || Math.abs(walker.z - z) > 0.001) deflected += 1;
}
if (deflected > 0) {
  console.log(`GATE: the walk was pushed aside ${deflected} times`);
  failures += 1;
} else {
  console.log('gate: walked straight through from z -85 to z -112');
}

// The closed lands must stay closed.
for (const [name, x, z] of [
  ['graveyard', -150, 10],
  ['behind the citadel', 0, -240],
  ['east of the citadel', 170, -200],
  ['west of the citadel', -170, -200],
] as const) {
  if (reachedNear(player, x, z, 3)) {
    console.log(`SHOULD BE CLOSED, BUT CAN BE REACHED: ${name}`);
    failures += 1;
  }
}

// The forest has to stay a forest, made of the trees that passed the art review.
const KEPT_TREES = new Set(['tree_gnarled_a', 'tree_gnarled_b', 'tree_gnarled_c', 'tree_snag', 'tree_pine_c']);
const LANDMARK_TREES = new Set(['tree_twisted_blood']);
let forestTrees = 0;
for (const batch of MAP.props) {
  if (batch.file !== 'forest' || !batch.node.startsWith('tree_')) continue;
  if (!KEPT_TREES.has(batch.node) && !LANDMARK_TREES.has(batch.node)) {
    console.log(`TREE THAT FAILED THE ART REVIEW: ${batch.node}`);
    failures += 1;
  }
  for (let i = 0; i + 3 < batch.items.length; i += 4) {
    const x = batch.items[i];
    const z = batch.items[i + 1];
    if (x < 60 || x > 230 || z < -90 || z > 110 || (batch.tilt ?? 0) !== 0) continue;
    // A tree only counts if something stops the player walking through it.
    const probe = { x, z };
    collide(probe, 0.1);
    if (probe.x !== x || probe.z !== z) forestTrees += 1;
  }
}
console.log(`forest: ${forestTrees} standing trees with colliders`);
if (forestTrees < 220) {
  console.log('FOREST TOO THIN');
  failures += 1;
}

const reachable = player.reduce((sum, value) => sum + value, 0) * STEP * STEP;
console.log(`${spots.length} spots checked, ${MAP.colliders.length} colliders, ${Math.round(reachable)} square meters walkable`);
console.log(failures === 0 ? 'PASS' : `FAIL: ${failures} problems`);
process.exitCode = failures === 0 ? 0 : 1;
