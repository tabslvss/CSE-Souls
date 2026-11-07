/** Rules for Binary Graces, the places where players rest. Shared so the browser can show what the server will allow. */
import type { MapGrace } from './mapTypes.js';

/** Walking this close lights a grace for good, on this save. */
export const GRACE_DISCOVER_RADIUS = 9;
/** How close you must be to rest, and to do anything in the menu. */
export const GRACE_REST_RANGE = 3;
/** Enough room for a party. Seats keep sitting players from overlapping. */
export const GRACE_SEATS = 8;
export const GRACE_SEAT_RADIUS = 1.9;
/** A hunter this close stops you from resting, and interrupts you if you already are. Just past the ward, so hunters can reach it. */
export const REST_DANGER_RADIUS = 12;

export function graceSeat(grace: { x: number; z: number }, seat: number): { x: number; z: number; yaw: number } {
  const angle = (seat / GRACE_SEATS) * Math.PI * 2;
  const x = grace.x + Math.sin(angle) * GRACE_SEAT_RADIUS;
  const z = grace.z + Math.cos(angle) * GRACE_SEAT_RADIUS;
  return { x, z, yaw: Math.atan2(grace.x - x, grace.z - z) };
}

export function findGrace<T extends MapGrace>(graces: readonly T[], id: number): T | undefined {
  return graces.find((grace) => grace.id === id);
}

export const SAVE_SLOTS = 3;

/** A save slot from the outside world, or null. Only ever an integer from 1 to 3. */
export function parseSlot(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= SAVE_SLOTS ? (value as number) : null;
}
