/**
 * Static world collision, shared so client prediction and the server agree. Circles and rotated
 * rectangles from the generated map, found through a uniform grid. Uses only + - * / and sqrt,
 * which give the same answer in every browser.
 */
import { MAP } from './mapData.js';
import type { MapCollider } from './mapTypes.js';

const CELL = 8;
/** The biggest circle ever passed to collide(), so that the grid always finds what it could touch. */
const LARGEST_RADIUS = 1;
const { bounds } = MAP;
const columns = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 1;
const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL) + 1;
const grid: (number[] | undefined)[] = new Array(columns * rows);

function reachOf(collider: MapCollider): number {
  return collider.t === 'c' ? collider.r : Math.sqrt(collider.hw * collider.hw + collider.hd * collider.hd);
}

MAP.colliders.forEach((collider, index) => {
  const reach = reachOf(collider) + LARGEST_RADIUS;
  const left = Math.max(0, Math.floor((collider.x - reach - bounds.minX) / CELL));
  const right = Math.min(columns - 1, Math.floor((collider.x + reach - bounds.minX) / CELL));
  const top = Math.max(0, Math.floor((collider.z - reach - bounds.minZ) / CELL));
  const bottom = Math.min(rows - 1, Math.floor((collider.z + reach - bounds.minZ) / CELL));
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const key = row * columns + column;
      (grid[key] ??= []).push(index);
    }
  }
});

/** Keeps a point inside the map's edge. */
export function clampToWorld(position: { x: number; z: number }): void {
  if (position.x < bounds.minX) position.x = bounds.minX;
  else if (position.x > bounds.maxX) position.x = bounds.maxX;
  if (position.z < bounds.minZ) position.z = bounds.minZ;
  else if (position.z > bounds.maxZ) position.z = bounds.maxZ;
}

function pushOut(collider: MapCollider, position: { x: number; z: number }, radius: number): boolean {
  const dx = position.x - collider.x;
  const dz = position.z - collider.z;
  if (collider.t === 'c') {
    const limit = collider.r + radius;
    const squared = dx * dx + dz * dz;
    if (squared >= limit * limit) return false;
    if (squared < 1e-8) {
      position.x = collider.x + limit;
      return true;
    }
    const distance = Math.sqrt(squared);
    position.x = collider.x + (dx / distance) * limit;
    position.z = collider.z + (dz / distance) * limit;
    return true;
  }
  // Into the rectangle's own axes, using its stored sine and cosine.
  const localX = dx * collider.cos - dz * collider.sin;
  const localZ = dx * collider.sin + dz * collider.cos;
  const nearX = localX < -collider.hw ? -collider.hw : localX > collider.hw ? collider.hw : localX;
  const nearZ = localZ < -collider.hd ? -collider.hd : localZ > collider.hd ? collider.hd : localZ;
  const offX = localX - nearX;
  const offZ = localZ - nearZ;
  const squared = offX * offX + offZ * offZ;
  let newX = localX;
  let newZ = localZ;
  if (squared > 1e-8) {
    if (squared >= radius * radius) return false;
    const distance = Math.sqrt(squared);
    newX = nearX + (offX / distance) * radius;
    newZ = nearZ + (offZ / distance) * radius;
  } else {
    // The center is inside, so it leaves through the nearest side.
    const toSideX = collider.hw - Math.abs(localX);
    const toSideZ = collider.hd - Math.abs(localZ);
    if (toSideX < toSideZ) newX = (localX < 0 ? -1 : 1) * (collider.hw + radius);
    else newZ = (localZ < 0 ? -1 : 1) * (collider.hd + radius);
  }
  position.x = collider.x + newX * collider.cos + newZ * collider.sin;
  position.z = collider.z - newX * collider.sin + newZ * collider.cos;
  return true;
}

/** Slides a circle out of anything it overlaps. Three passes handle corners. */
export function collide(position: { x: number; z: number }, radius: number): void {
  clampToWorld(position);
  for (let pass = 0; pass < 3; pass += 1) {
    const column = Math.floor((position.x - bounds.minX) / CELL);
    const row = Math.floor((position.z - bounds.minZ) / CELL);
    if (column < 0 || column >= columns || row < 0 || row >= rows) return;
    const cell = grid[row * columns + column];
    if (!cell) return;
    let moved = false;
    for (const index of cell) {
      if (pushOut(MAP.colliders[index], position, radius)) moved = true;
    }
    if (!moved) return;
  }
}

/** True if the straight segment passes through a collider. Used to stop projectiles. */
export function segmentBlocked(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  const steps = Math.ceil(Math.sqrt((toX - fromX) ** 2 + (toZ - fromZ) ** 2) / 0.5);
  const probe = { x: 0, z: 0 };
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    probe.x = fromX + (toX - fromX) * t;
    probe.z = fromZ + (toZ - fromZ) * t;
    const startX = probe.x;
    const startZ = probe.z;
    collide(probe, 0.05);
    if (probe.x !== startX || probe.z !== startZ) return true;
  }
  return false;
}
