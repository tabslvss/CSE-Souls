/** The shape of the generated world in mapData.ts, which both server and browser import. */

export type MapCollider =
  | { t: 'c'; x: number; z: number; r: number }
  /** A rotated rectangle, with half width, half depth and its rotation's stored sine and cosine. */
  | { t: 'r'; x: number; z: number; hw: number; hd: number; sin: number; cos: number };

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapCamp {
  /** An id from shared/creatures.ts. */
  kind: string;
  x: number;
  z: number;
  count: number;
  /** How far from the camp's center they spawn and wander. */
  radius: number;
}

export interface MapChest {
  id: number;
  x: number;
  z: number;
  yaw: number;
  /** Binary Dust inside. */
  dust: number;
  /** Prop node to draw. Plain 'chest' if left out. */
  model?: string;
}

/** A Binary Grace: where players rest, raise stats and travel from. */
export interface MapGrace {
  id: number;
  x: number;
  z: number;
  /** Shown in menus and on the map. */
  name: string;
}

export interface MapZone {
  name: string;
  /** Rectangle the zone covers. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Fog distances while inside. */
  fogNear: number;
  fogFar: number;
}

/** Every copy of one prop: packed x, z, yaw, scale, repeating. */
export interface MapPropBatch {
  /** Model file under /models/world, without its extension. */
  file: string;
  /** Node inside that file. */
  node: string;
  items: number[];
  /** Height above the ground for the whole batch, for stacked towers and things hung on walls. */
  y?: number;
  /** Radians tipped over, before the yaw, for fallen trees and pillars. */
  tilt?: number;
}

export interface MapData {
  version: number;
  bounds: MapBounds;
  spawn: { x: number; z: number; radius: number };
  colliders: MapCollider[];
  camps: MapCamp[];
  chests: MapChest[];
  graces: MapGrace[];
  zones: MapZone[];
  /** Polyline of the road, for the ground painter: x, z, repeating. */
  road: number[];
  props: MapPropBatch[];
  /** Dirt side paths for the ground painter. Each one is x, z, repeating. */
  trails?: number[][];
  /** Flames to draw: x, y, z, size, repeating. Nothing else about a fire is in the sim. */
  fires?: number[];
  /** Slate tower roofs: x, y, z, radius, height, repeating. */
  spires?: number[];
}
