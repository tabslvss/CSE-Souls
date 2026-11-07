import { useEffect, useRef } from 'react';
import { MAP } from '../../../shared/mapData';
import type { MapView } from '../game/GameClient';

const PAINTING_URL = '/map/world.webp';
const SURROUND_URL = '/map/surround.webp';
/** The ground the surround picture covers. Must match SURROUND in tools/build-world-map.mjs. */
const SURROUND_AREA = { minX: -480, maxX: 480, minZ: -420, maxZ: 340 };
/** How far in from each side the painting dissolves into the surround, in meters. */
const SHEET_FEATHER = 30;
const { minX, maxX, minZ, maxZ } = MAP.bounds;
const MAP_WIDTH = maxX - minX;
const MAP_HEIGHT = maxZ - minZ;

const PICK_PIXELS = 18;
const OTHER_PLAYERS_NAMED = 12;
const DRAG_PIXELS = 4;
/** How close the picture can get, in CSS pixels per meter. The painting holds 4.8 pixels a meter, and much past that it turns to mush. */
const MOST_ZOOM = 6;
const WHEEL_SPEED = 0.0016;
/** Grace names come in from this close, in CSS pixels per meter. */
const NAMES_FROM = 3.9;

/** Colors that match the site's gold style. A canvas can't read them from the stylesheet cheaply every frame. */
const GOLD = '#c9a45c';
const GOLD_BRIGHT = '#ecd59b';
const GOLD_PALE = '#f6ecd2';
const HALO = 'rgba(11, 7, 3, 0.92)';
const BACKDROP_CENTER = '#1c140c';
const BACKDROP_EDGE = '#080604';
/** Region names: gold on what you've found, and a touch fainter on what you haven't, but never lost in the veil. */
const REGION_INK = '#d9bf84';
const FOUND_ALPHA = 0.95;
const UNFOUND_ALPHA = 0.74;
const DISPLAY_FONT = 'Cinzel, Georgia, serif';

/**
 * Where each region's name goes, placed by eye so it sits on open ground and misses the road and buildings.
 * Size is how much the place matters on the way through the game. Names fade out as you zoom in, the big ones last.
 */
const REGIONS: ReadonlyArray<{ zone: string; lines: string[]; x: number; z: number; size: number }> = [
  { zone: 'Fallen Citadel', lines: ['Fallen Citadel'], x: 0, z: -211, size: 25 },
  { zone: 'Throne of Ash', lines: ['Throne of Ash'], x: 0, z: -264, size: 18 },
  { zone: 'Cursed Forest', lines: ['Cursed Forest'], x: 115, z: -50, size: 18 },
  { zone: 'Sunken Graveyard', lines: ['Sunken', 'Graveyard'], x: -150, z: 8, size: 21 },
  { zone: 'Ash Flats', lines: ['Ash Flats'], x: 30, z: -66, size: 12 },
  { zone: 'Forsaken Village', lines: ['Forsaken', 'Village'], x: -38, z: 16, size: 13 },
  { zone: 'Pale Meadow', lines: ['Pale Meadow'], x: -112, z: 133, size: 17 },
  { zone: "Pilgrim's Rest", lines: ["Pilgrim's Rest"], x: 76, z: 183, size: 15 },
];

/**
 * The graces whose light reveals each zone. A zone with no grace of its own is revealed by the grace
 * nearest to it, or the graveyard and the throne room could never be uncovered.
 */
const ZONE_GRACES: ReadonlyArray<readonly number[]> = MAP.zones.map((zone) => {
  const distance = (x: number, z: number) => Math.hypot(Math.max(zone.minX - x, 0, x - zone.maxX), Math.max(zone.minZ - z, 0, z - zone.maxZ));
  const inside = MAP.graces.filter((grace) => distance(grace.x, grace.z) === 0).map((grace) => grace.id);
  if (inside.length > 0) return inside;
  const nearest = [...MAP.graces].sort((a, b) => distance(a.x, a.z) - distance(b.x, b.z))[0];
  return nearest ? [nearest.id] : [];
});

/* ---------- Loading ---------- */

let paintingBytes: Promise<Blob> | null = null;
let surroundBytes: Promise<Blob> | null = null;

/**
 * The file is downloaded once and its bytes kept. The big decoded picture only lives while a map is
 * open. A failed download is forgotten, so that opening the map again tries again.
 */
function loadPainting(): Promise<ImageBitmap> {
  if (!paintingBytes) {
    paintingBytes = fetch(PAINTING_URL).then((response) => {
      if (!response.ok) throw new Error(`The map painting answered ${response.status}`);
      return response.blob();
    });
    paintingBytes.catch(() => {
      paintingBytes = null;
    });
  }
  return paintingBytes.then((bytes) => createImageBitmap(bytes));
}

/** The mountains around the sheet are only scenery, so if they can't be had the map carries on without them. */
function loadSurround(): Promise<ImageBitmap> {
  if (!surroundBytes) {
    surroundBytes = fetch(SURROUND_URL).then((response) => {
      if (!response.ok) throw new Error(`The map surround answered ${response.status}`);
      return response.blob();
    });
    surroundBytes.catch(() => {
      surroundBytes = null;
    });
  }
  return surroundBytes.then((bytes) => createImageBitmap(bytes));
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/* ---------- Cached pictures, built once and only copied from then on ---------- */

/** The land at two sizes. Copying from the smaller one when zoomed out is faster and doesn't shimmer. */
interface Plate {
  full: HTMLCanvasElement;
  half: HTMLCanvasElement;
}

function withHalf(full: HTMLCanvasElement): Plate {
  const half = makeCanvas(full.width / 2, full.height / 2);
  const context = half.getContext('2d');
  if (context) {
    context.imageSmoothingQuality = 'high';
    context.drawImage(full, 0, 0, half.width, half.height);
  }
  return { full, half };
}

function freePlate(plate: Plate | null): void {
  if (!plate) return;
  plate.full.width = 0;
  plate.half.width = 0;
}

/** A plain drawing of the land from the map data, for while the painting loads or if it can't. */
function sketchPlate(): Plate {
  const scale = 2;
  const sketch = makeCanvas(MAP_WIDTH * scale, MAP_HEIGHT * scale);
  const context = sketch.getContext('2d');
  if (!context) return withHalf(sketch);
  const x = (value: number) => (value - minX) * scale;
  const y = (value: number) => (value - minZ) * scale;
  context.fillStyle = '#2b2116';
  context.fillRect(0, 0, sketch.width, sketch.height);
  MAP.zones.forEach((zone, index) => {
    context.fillStyle = index % 2 === 0 ? 'rgba(201, 164, 92, 0.1)' : 'rgba(125, 95, 43, 0.16)';
    context.fillRect(x(zone.minX), y(zone.minZ), (zone.maxX - zone.minX) * scale, (zone.maxZ - zone.minZ) * scale);
    context.strokeStyle = 'rgba(201, 164, 92, 0.22)';
    context.strokeRect(x(zone.minX), y(zone.minZ), (zone.maxX - zone.minX) * scale, (zone.maxZ - zone.minZ) * scale);
  });
  const line = (points: readonly number[], color: string, width: number) => {
    context.beginPath();
    for (let i = 0; i + 1 < points.length; i += 2) {
      if (i === 0) context.moveTo(x(points[i]), y(points[i + 1]));
      else context.lineTo(x(points[i]), y(points[i + 1]));
    }
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  };
  for (const trail of MAP.trails ?? []) line(trail, 'rgba(201, 180, 130, 0.35)', 2);
  line(MAP.road, 'rgba(236, 213, 155, 0.65)', 5);
  return withHalf(sketch);
}

/** Which zones this save has uncovered. */
function knownZones(lit: readonly number[], here: number | undefined): boolean[] {
  return ZONE_GRACES.map((graces) => graces.some((grace) => grace === here || lit.includes(grace)));
}

/** Value noise for the veil's edge. The same land always gets the same edge. */
function veilNoise(x: number, z: number): number {
  const corner = (cx: number, cz: number) => {
    let h = (Math.imul(cx, 374761393) + Math.imul(cz, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = x - ix;
  const tz = z - iz;
  const fx = tx * tx * (3 - 2 * tx);
  const fz = tz * tz * (3 - 2 * tz);
  const top = corner(ix, iz) + (corner(ix + 1, iz) - corner(ix, iz)) * fx;
  const bottom = corner(ix, iz + 1) + (corner(ix + 1, iz + 1) - corner(ix, iz + 1)) * fx;
  return top + (bottom - top) * fz;
}

const zoneDistance = (zone: (typeof MAP.zones)[number], x: number, z: number) =>
  Math.hypot(Math.max(zone.minX - x, 0, x - zone.maxX), Math.max(zone.minZ - z, 0, z - zone.maxZ));

/**
 * A small soft mask, opaque over the land not yet found. The edge fades over about 40 m and noise pushes
 * it around, like mist thinning, so that it never reads as a band along a zone's straight border.
 */
function unexploredMask(known: readonly boolean[]): HTMLCanvasElement | null {
  if (known.every(Boolean)) return null;
  const columns = 240;
  const rows = 250;
  const mask = makeCanvas(columns, rows);
  const context = mask.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(columns, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = minX + ((column + 0.5) / columns) * MAP_WIDTH;
      const z = minZ + ((row + 0.5) / rows) * MAP_HEIGHT;
      let toKnown = Infinity;
      let toUnknown = Infinity;
      MAP.zones.forEach((zone, index) => {
        const distance = zoneDistance(zone, x, z);
        if (known[index]) toKnown = Math.min(toKnown, distance);
        else toUnknown = Math.min(toUnknown, distance);
      });
      const drift = (veilNoise(x * 0.018, z * 0.018) - 0.5) * 44 + (veilNoise(x * 0.06 + 40, z * 0.06) - 0.5) * 20 + (veilNoise(x * 0.17, z * 0.17 + 70) - 0.5) * 8;
      image.data[(row * columns + column) * 4 + 3] = smooth(-20, 20, Math.min(toKnown, 400) - Math.min(toUnknown, 400) + drift) * 255;
    }
  }
  context.putImageData(image, 0, 0);
  return mask;
}

/** A small mask, opaque except for a wandering fade around the sheet's four sides. */
function sheetEdge(): HTMLCanvasElement | null {
  const columns = 240;
  const rows = 250;
  const mask = makeCanvas(columns, rows);
  const context = mask.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(columns, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = minX + ((column + 0.5) / columns) * MAP_WIDTH;
      const z = minZ + ((row + 0.5) / rows) * MAP_HEIGHT;
      const inside = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
      image.data[(row * columns + column) * 4 + 3] = smooth(0, SHEET_FEATHER, inside - 4 + (veilNoise(x * 0.05 + 11, z * 0.05 + 23) - 0.5) * 8) * 255;
    }
  }
  context.putImageData(image, 0, 0);
  return mask;
}

/** The painting with unexplored land dimmed and a little drained, in its own hues, so it still looks like the same land. */
function paintedPlate(painting: ImageBitmap, known: readonly boolean[]): Plate {
  const full = makeCanvas(painting.width, painting.height);
  const context = full.getContext('2d');
  if (!context) return withHalf(full);
  context.drawImage(painting, 0, 0);
  const mask = unexploredMask(known);
  if (mask) {
    const veil = makeCanvas(painting.width / 2, painting.height / 2);
    const veiling = veil.getContext('2d');
    if (veiling) {
      veiling.drawImage(painting, 0, 0, veil.width, veil.height);
      // 30% of the way to grey, which leaves 70% of the saturation.
      veiling.globalCompositeOperation = 'saturation';
      veiling.fillStyle = 'rgba(128, 128, 128, 0.3)';
      veiling.fillRect(0, 0, veil.width, veil.height);
      // A neutral multiply changes lightness only: 65%.
      veiling.globalCompositeOperation = 'multiply';
      veiling.fillStyle = '#a6a6a6';
      veiling.fillRect(0, 0, veil.width, veil.height);
      // A faint warm lift, so that the darkest forest doesn't sink to black under the veil.
      veiling.globalCompositeOperation = 'screen';
      veiling.fillStyle = '#17110a';
      veiling.fillRect(0, 0, veil.width, veil.height);
      veiling.globalCompositeOperation = 'destination-in';
      veiling.imageSmoothingQuality = 'high';
      veiling.drawImage(mask, 0, 0, veil.width, veil.height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(veil, 0, 0, full.width, full.height);
    }
    veil.width = 0;
    mask.width = 0;
  }
  // Last, as the veil's fills need solid paint under them: the sheet's edge dissolves into the mountains around it.
  const edge = sheetEdge();
  if (edge) {
    context.globalCompositeOperation = 'destination-in';
    context.imageSmoothingQuality = 'high';
    context.drawImage(edge, 0, 0, full.width, full.height);
    context.globalCompositeOperation = 'source-over';
    edge.width = 0;
  }
  return withHalf(full);
}

/** Paper grain at the screen's own pixels. It stays crisp when the painting underneath is being enlarged. */
function grainTile(): HTMLCanvasElement {
  const size = 256;
  const tile = makeCanvas(size, size);
  const context = tile.getContext('2d');
  if (!context) return tile;
  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + (Math.random() - 0.5) * 92;
    image.data[i] = value;
    image.data[i + 1] = value * 0.98;
    image.data[i + 2] = value * 0.94;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return tile;
}

/** Spaced serif capitals in pale gold on a dark halo, rendered once and copied. Only ever fillText, so a name can't be read as HTML. */
function textSprite(lines: readonly string[], size: number, ratio: number, color: string, spacing: number): HTMLCanvasElement {
  const px = size * ratio;
  const font = `600 ${px}px ${DISPLAY_FONT}`;
  const pad = Math.ceil(px * 0.6);
  const lineHeight = px * 1.28;
  const measure = makeCanvas(1, 1).getContext('2d');
  if (!measure) return makeCanvas(1, 1);
  measure.font = font;
  const gap = px * spacing;
  const widths = lines.map((line) => [...line].reduce((sum, letter) => sum + measure.measureText(letter).width + gap, -gap));
  const sprite = makeCanvas(Math.max(...widths) + pad * 2, lineHeight * lines.length + pad * 2);
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  context.font = font;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  const eachLetter = (draw: (letter: string, x: number, y: number) => void) => {
    lines.forEach((line, index) => {
      let x = (sprite.width - widths[index]) / 2;
      const y = pad + lineHeight * (index + 0.5);
      for (const letter of line) {
        draw(letter, x, y);
        x += measure.measureText(letter).width + gap;
      }
    });
  };
  context.shadowColor = HALO;
  context.shadowBlur = px * 0.42;
  context.fillStyle = HALO;
  for (let pass = 0; pass < 3; pass += 1) eachLetter((letter, x, y) => context.fillText(letter, x, y));
  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(11, 7, 3, 0.75)';
  context.lineWidth = Math.max(1, px * 0.1);
  eachLetter((letter, x, y) => context.strokeText(letter, x, y));
  context.fillStyle = color;
  eachLetter((letter, x, y) => context.fillText(letter, x, y));
  return sprite;
}

function glowSprite(ratio: number): HTMLCanvasElement {
  const size = Math.round(72 * ratio);
  const sprite = makeCanvas(size, size);
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255, 206, 110, 0.95)');
  glow.addColorStop(0.28, 'rgba(255, 180, 80, 0.45)');
  glow.addColorStop(1, 'rgba(255, 170, 70, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
  return sprite;
}

/** A four-pointed gold star in a thin ring. */
function graceSprite(ratio: number): HTMLCanvasElement {
  const size = Math.round(26 * ratio);
  const sprite = makeCanvas(size, size);
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const middle = size / 2;
  const long = size * 0.42;
  const short = size * 0.1;
  const star = () => {
    context.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI) / 4 - Math.PI / 2;
      const reach = i % 2 === 0 ? long : short;
      const x = middle + Math.cos(angle) * reach;
      const y = middle + Math.sin(angle) * reach;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  };
  context.lineJoin = 'round';
  context.strokeStyle = HALO;
  context.lineWidth = 2.6 * ratio;
  star();
  context.stroke();
  context.beginPath();
  context.arc(middle, middle, size * 0.26, 0, Math.PI * 2);
  context.lineWidth = 2.4 * ratio;
  context.stroke();
  context.strokeStyle = GOLD;
  context.lineWidth = Math.max(1, 0.9 * ratio);
  context.stroke();
  const fill = context.createLinearGradient(0, middle - long, 0, middle + long);
  fill.addColorStop(0, GOLD_PALE);
  fill.addColorStop(1, '#e0b35c');
  context.fillStyle = fill;
  star();
  context.fill();
  return sprite;
}

/** A compass rose in the same ink as the region names. North is at the top: the citadel's side of the world. */
function compassSprite(ratio: number): HTMLCanvasElement {
  const size = Math.round(96 * ratio);
  const sprite = makeCanvas(size, size + Math.round(16 * ratio));
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const cx = size / 2;
  const cy = size / 2 + 14 * ratio;
  const radius = size * 0.41;

  context.shadowColor = HALO;
  context.shadowBlur = 6 * ratio;
  context.strokeStyle = GOLD;
  context.lineWidth = Math.max(1, 1.1 * ratio);
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
  context.shadowBlur = 0;
  context.globalAlpha = 0.65;
  context.beginPath();
  context.arc(cx, cy, radius * 0.86, 0, Math.PI * 2);
  context.lineWidth = Math.max(0.6, 0.6 * ratio);
  context.stroke();
  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2;
    const inner = radius * (i % 4 === 0 ? 0.86 : 0.93);
    context.beginPath();
    context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    context.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    context.stroke();
  }
  context.globalAlpha = 1;

  // Each point has a lit face and a dark one, the classic way of giving a flat rose some depth.
  const point = (angle: number, reach: number, waist: number) => {
    const tipX = cx + Math.cos(angle) * reach;
    const tipY = cy + Math.sin(angle) * reach;
    for (const [side, color] of [[-1, GOLD_BRIGHT], [1, '#3c2b15']] as const) {
      const sideAngle = angle + (side * Math.PI) / 2;
      context.beginPath();
      context.moveTo(cx, cy);
      context.lineTo(cx + Math.cos(sideAngle) * waist, cy + Math.sin(sideAngle) * waist);
      context.lineTo(tipX, tipY);
      context.closePath();
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = 'rgba(201, 164, 92, 0.85)';
      context.lineWidth = Math.max(0.5, 0.5 * ratio);
      context.stroke();
    }
  };
  for (let i = 0; i < 4; i += 1) point((i * Math.PI) / 2 + Math.PI / 4, radius * 0.58, radius * 0.07);
  for (let i = 0; i < 4; i += 1) point((i * Math.PI) / 2 - Math.PI / 2, radius * (i === 0 ? 1.04 : 0.86), radius * 0.13);

  const north = textSprite(['N'], 13, ratio, GOLD_BRIGHT, 0);
  context.drawImage(north, cx - north.width / 2, cy - radius - north.height * 0.86);
  return sprite;
}

function backdropSprite(width: number, height: number): HTMLCanvasElement {
  const sprite = makeCanvas(width, height);
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width, height) / 2);
  glow.addColorStop(0, BACKDROP_CENTER);
  glow.addColorStop(1, BACKDROP_EDGE);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  return sprite;
}

/** Old paper's darkened edges, around the view rather than the sheet, which no longer has an edge of its own. */
function burnSprite(width: number, height: number): HTMLCanvasElement {
  const sprite = makeCanvas(width, height);
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const radius = Math.hypot(width, height) / 2;
  const burn = context.createRadialGradient(width / 2, height / 2, radius * 0.55, width / 2, height / 2, radius);
  burn.addColorStop(0, 'rgba(8, 5, 2, 0)');
  burn.addColorStop(1, 'rgba(8, 5, 2, 0.5)');
  context.fillStyle = burn;
  context.fillRect(0, 0, width, height);
  return sprite;
}

interface Sprites {
  ratio: number;
  regions: HTMLCanvasElement[];
  graces: Map<number, HTMLCanvasElement>;
  glow: HTMLCanvasElement;
  grace: HTMLCanvasElement;
  compass: HTMLCanvasElement;
}

function makeSprites(ratio: number): Sprites {
  return {
    ratio,
    regions: REGIONS.map((region) => textSprite(region.lines.map((line) => line.toUpperCase()), region.size, ratio, REGION_INK, 0.2)),
    graces: new Map(MAP.graces.map((grace) => [grace.id, textSprite([grace.name], 12, ratio, GOLD_PALE, 0.05)])),
    glow: glowSprite(ratio),
    grace: graceSprite(ratio),
    compass: compassSprite(ratio),
  };
}

function freeSprites(sprites: Sprites | null): void {
  if (!sprites) return;
  for (const sprite of [...sprites.regions, ...sprites.graces.values(), sprites.glow, sprites.grace, sprites.compass]) sprite.width = 0;
}

const clamp = (low: number, high: number, value: number) => Math.min(high, Math.max(low, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp(0, 1, (value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** A round scale length near the given number of meters. */
function scaleLength(meters: number): number {
  const lengths = [5, 10, 20, 50, 100, 200];
  return lengths.reduce((best, length) => (Math.abs(length - meters) < Math.abs(best - meters) ? length : best), lengths[0]);
}

function readController(): Gamepad | null {
  if (typeof navigator.getGamepads !== 'function' || !document.hasFocus()) return null;
  try {
    for (const pad of navigator.getGamepads()) if (pad?.connected && pad.mapping === 'standard') return pad;
  } catch {
    // A page can be refused controllers, which is the same as having none.
  }
  return null;
}

/**
 * The world, painted from a render of the real map, with this save's discoveries over it. Graces this save
 * hasn't found are left off. Text here is only drawn into a canvas with fillText, so a username can't be read as HTML.
 */
export function WorldMap({
  view,
  lit,
  here,
  onPick,
}: {
  view: () => MapView;
  /** Binary Graces this save has lit. */
  lit: readonly number[];
  /** The grace you're resting at, if any. */
  here?: number;
  /** Makes the graces clickable. The list beside the map does the same for a controller. */
  onPick?: (grace: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read inside the drawing loop, so that the loop doesn't restart whenever one of these changes.
  const latest = useRef({ view, lit, here, onPick });
  latest.current = { view, lit, here, onPick };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) return;

    let frame = 0;
    let unmounted = false;
    let painting: ImageBitmap | null = null;
    let surround: ImageBitmap | null = null;
    let grain: CanvasPattern | null = null;
    let failed = false;
    let plate: Plate = sketchPlate();
    let plateKey = '';
    let lastLit: readonly number[] | null = null;
    let lastHere: number | undefined;
    let known: boolean[] = knownZones(latest.current.lit, latest.current.here);
    let sprites: Sprites | null = null;
    let fontsReady = false;
    let backdrop = makeCanvas(1, 1);
    let burn = makeCanvas(1, 1);
    const layer = makeCanvas(1, 1);
    let layerStale = true;
    const layerCamera = { x: 0, z: 0, zoom: 0 };
    let ratio = window.devicePixelRatio || 1;
    let width = 1;
    let height = 1;
    let fit = 1;
    let most = 4;

    /** The world point at the canvas's center, and how far in we are. Zoom 1 shows the whole map. */
    const camera = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, zoom: 1, goal: 1 };
    /** While zooming, the world point that stays under the cursor. */
    let anchor: { x: number; z: number; sx: number; sy: number } | null = null;
    let opened = false;
    const pointer = { x: -1, y: -1, inside: false };
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    let hover: number | null = null;
    let cursor = '';
    let lastTime = performance.now();

    const keepOnMap = () => {
      const scale = fit * camera.zoom;
      const halfWidth = width / 2 / scale;
      const halfHeight = height / 2 / scale;
      camera.x = MAP_WIDTH > halfWidth * 2 ? clamp(minX + halfWidth, maxX - halfWidth, camera.x) : (minX + maxX) / 2;
      camera.z = MAP_HEIGHT > halfHeight * 2 ? clamp(minZ + halfHeight, maxZ - halfHeight, camera.z) : (minZ + maxZ) / 2;
    };

    const screenX = (x: number) => width / 2 + (x - camera.x) * fit * camera.zoom;
    const screenY = (z: number) => height / 2 + (z - camera.z) * fit * camera.zoom;

    const resize = () => {
      ratio = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const nextHeight = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (nextWidth === width && nextHeight === height) return;
      const shownBefore = fit * camera.zoom;
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      layer.width = width;
      layer.height = height;
      layerStale = true;
      fit = Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
      most = Math.max(3, (MOST_ZOOM * ratio) / fit);
      // A resized window keeps showing the land at the same size, rather than jumping.
      if (opened) {
        camera.zoom = clamp(1, most, shownBefore / fit);
        camera.goal = camera.zoom;
        anchor = null;
      }
      keepOnMap();
      backdrop.width = 0;
      backdrop = backdropSprite(width, height);
      burn.width = 0;
      burn = burnSprite(width, height);
      if (fontsReady && sprites?.ratio !== ratio) {
        freeSprites(sprites);
        sprites = makeSprites(ratio);
      }
    };

    const refreshPlate = () => {
      const { lit: litNow, here: hereNow } = latest.current;
      if (litNow === lastLit && hereNow === lastHere && plateKey) return;
      lastLit = litNow;
      lastHere = hereNow;
      known = knownZones(litNow, hereNow);
      const key = `${painting ? 'paint' : 'sketch'}:${known.map(Number).join('')}`;
      if (key === plateKey) return;
      plateKey = key;
      layerStale = true;
      if (!painting) return;
      freePlate(plate);
      plate = paintedPlate(painting, known);
    };

    const zoomAt = (factor: number, sx: number, sy: number) => {
      const scale = fit * camera.zoom;
      anchor = { x: camera.x + (sx - width / 2) / scale, z: camera.z + (sy - height / 2) / scale, sx, sy };
      camera.goal = clamp(1, most, camera.goal * factor);
    };

    const stepCamera = (seconds: number) => {
      const pad = readController();
      if (pad) {
        // The left stick moves through the menu's buttons, so the map gets the right one, and the triggers zoom.
        const stickX = pad.axes[2] ?? 0;
        const stickY = pad.axes[3] ?? 0;
        const push = Math.hypot(stickX, stickY);
        if (push > 0.18) {
          const speed = ((push - 0.18) / 0.82 / push) * 520 * ratio * seconds / (fit * camera.zoom);
          camera.x += stickX * speed;
          camera.z += stickY * speed;
          anchor = null;
            }
        const zoomPush = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
        if (Math.abs(zoomPush) > 0.08) zoomAt(Math.exp(zoomPush * seconds * 1.8), width / 2, height / 2);
      }

      if (camera.zoom !== camera.goal) {
        const step = 1 - Math.exp(-seconds * 12);
        const next = Math.exp(Math.log(camera.zoom) + (Math.log(camera.goal) - Math.log(camera.zoom)) * step);
        camera.zoom = Math.abs(next - camera.goal) < camera.goal * 0.001 ? camera.goal : next;
        if (anchor) {
          const scale = fit * camera.zoom;
          camera.x = anchor.x - (anchor.sx - width / 2) / scale;
          camera.z = anchor.z - (anchor.sy - height / 2) / scale;
        }
        if (camera.zoom === camera.goal) anchor = null;
      }
      keepOnMap();
    };

    const graceAt = (x: number, y: number, pickableOnly: boolean): number | null => {
      const { lit: litNow, here: hereNow, onPick: pick } = latest.current;
      if (pickableOnly && !pick) return null;
      let best = PICK_PIXELS * ratio;
      let found: number | null = null;
      for (const grace of MAP.graces) {
        if (!litNow.includes(grace.id) || (pickableOnly && grace.id === hereNow)) continue;
        const distance = Math.hypot(screenX(grace.x) - x, screenY(grace.z) - y);
        if (distance <= best) {
          best = distance;
          found = grace.id;
        }
      }
      return found;
    };

    const setCursor = (next: string) => {
      if (next === cursor) return;
      cursor = next;
      canvas.style.cursor = next;
    };

    const drawArrow = (x: number, y: number, yaw: number, time: number) => {
      // Forward in the world is sin(yaw), cos(yaw), and the map's axes run the same way.
      const dx = Math.sin(yaw);
      const dy = Math.cos(yaw);
      const size = 11 * ratio;
      const ring = size * (1.5 + 0.1 * Math.sin(time / 420));
      context.beginPath();
      context.arc(x, y, ring, 0, Math.PI * 2);
      context.strokeStyle = 'rgba(11, 7, 3, 0.65)';
      context.lineWidth = 3.4 * ratio;
      context.stroke();
      context.strokeStyle = 'rgba(246, 236, 210, 0.85)';
      context.lineWidth = 1.2 * ratio;
      context.stroke();
      context.beginPath();
      context.moveTo(x + dx * size, y + dy * size);
      context.lineTo(x - dy * size * 0.68 - dx * size * 0.78, y + dx * size * 0.68 - dy * size * 0.78);
      context.lineTo(x - dx * size * 0.34, y - dy * size * 0.34);
      context.lineTo(x + dy * size * 0.68 - dx * size * 0.78, y - dx * size * 0.68 - dy * size * 0.78);
      context.closePath();
      context.lineJoin = 'round';
      context.strokeStyle = '#090604';
      context.lineWidth = 3.2 * ratio;
      context.stroke();
      context.fillStyle = '#ffffff';
      context.fill();
    };

    const drawName = (target: CanvasRenderingContext2D, name: string, x: number, y: number) => {
      target.strokeStyle = HALO;
      target.lineWidth = 3 * ratio;
      target.lineJoin = 'round';
      target.strokeText(name, x, y);
      target.fillText(name, x, y);
    };

    const drawScaleBar = (target: CanvasRenderingContext2D, scale: number) => {
      const meters = scaleLength((130 * ratio) / scale);
      const barWidth = meters * scale;
      const x = 26 * ratio;
      const y = height - 30 * ratio;
      const barHeight = 5 * ratio;
      target.fillStyle = HALO;
      target.fillRect(x - 2 * ratio, y - 2 * ratio, barWidth + 4 * ratio, barHeight + 4 * ratio);
      for (let i = 0; i < 4; i += 1) {
        target.fillStyle = i % 2 === 0 ? GOLD_BRIGHT : 'rgba(44, 30, 14, 0.95)';
        target.fillRect(x + (barWidth * i) / 4, y, barWidth / 4, barHeight);
      }
      target.strokeStyle = GOLD;
      target.lineWidth = Math.max(1, 0.8 * ratio);
      target.strokeRect(x, y, barWidth, barHeight);
      target.font = `${Math.round(13 * ratio)}px Georgia, serif`;
      target.textAlign = 'center';
      target.textBaseline = 'bottom';
      target.fillStyle = GOLD_BRIGHT;
      drawName(target, `${meters} m`, x + barWidth / 2, y - 3 * ratio);
    };

    /**
     * Everything that only changes when the camera does: land, region names, compass and scale. Scaling a
     * picture this big is the frame's biggest cost, so it's done here, and most frames just copy the result.
     */
    const paintLayer = () => {
      const target = layer.getContext('2d', { alpha: false });
      if (!target) return;
      layerStale = false;
      layerCamera.x = camera.x;
      layerCamera.z = camera.z;
      layerCamera.zoom = camera.zoom;

      const scale = fit * camera.zoom;
      const left = screenX(minX);
      const top = screenY(minZ);
      const mapWidth = MAP_WIDTH * scale;
      const mapHeight = MAP_HEIGHT * scale;
      // Scenery only goes in when the sheet's edge, or its see-through border, is actually on screen.
      const feather = SHEET_FEATHER * scale;
      if (left + feather > 0 || top + feather > 0 || left + mapWidth - feather < width || top + mapHeight - feather < height) {
        target.drawImage(backdrop, 0, 0);
        if (surround) {
          target.imageSmoothingEnabled = true;
          target.imageSmoothingQuality = 'medium';
          target.drawImage(surround, screenX(SURROUND_AREA.minX), screenY(SURROUND_AREA.minZ), (SURROUND_AREA.maxX - SURROUND_AREA.minX) * scale, (SURROUND_AREA.maxZ - SURROUND_AREA.minZ) * scale);
        }
      }
      target.imageSmoothingEnabled = true;
      // Only medium: the plate already has a smaller copy to shrink from.
      target.imageSmoothingQuality = 'medium';
      target.drawImage(mapWidth < plate.full.width * 0.6 ? plate.half : plate.full, left, top, mapWidth, mapHeight);

      // Screen-fixed, so grain and burnt edges stay still and sharp while the land moves under them.
      if (grain) {
        target.globalCompositeOperation = 'overlay';
        target.globalAlpha = 0.2;
        target.fillStyle = grain;
        target.fillRect(0, 0, width, height);
        target.globalAlpha = 1;
        target.globalCompositeOperation = 'source-over';
      }
      target.drawImage(burn, 0, 0);

      if (sprites) {
        // Names give way as you zoom in: by the time the land fills the view, you can see what it is.
        const labelFade = 1 - smooth(3.9, MOST_ZOOM, scale / ratio);
        if (labelFade > 0) {
          REGIONS.forEach((region, index) => {
            const zoneIndex = MAP.zones.findIndex((zone) => zone.name === region.zone);
            const sprite = sprites!.regions[index];
            target.globalAlpha = labelFade * (known[zoneIndex] ? FOUND_ALPHA : UNFOUND_ALPHA);
            target.drawImage(sprite, Math.round(screenX(region.x) - sprite.width / 2), Math.round(screenY(region.z) - sprite.height / 2));
          });
        }
        target.globalAlpha = 0.95;
        target.drawImage(sprites.compass, width - sprites.compass.width - 18 * ratio, 18 * ratio);
        target.globalAlpha = 1;
      }
      drawScaleBar(target, scale);
    };

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      const seconds = Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;
      // Read once a frame: this walks every player in the world.
      const { me, others } = latest.current.view();
      const { lit: litNow, here: hereNow } = latest.current;
      refreshPlate();

      // Opens on the whole world, so that the citadel you're heading for is in view from the first moment.
      opened = true;
      stepCamera(seconds);

      if (layerStale || camera.x !== layerCamera.x || camera.z !== layerCamera.z || camera.zoom !== layerCamera.zoom) paintLayer();
      context.drawImage(layer, 0, 0);

      const metersScale = (fit * camera.zoom) / ratio;
      if (sprites) {
        const nameFade = smooth(NAMES_FROM - 0.4, NAMES_FROM + 0.4, metersScale);
        for (const grace of MAP.graces) {
          if (!litNow.includes(grace.id)) continue;
          const x = screenX(grace.x);
          const y = screenY(grace.z);
          const bright = grace.id === hereNow || grace.id === hover;
          const pulse = 0.72 + 0.28 * Math.sin(time / 620 + grace.id * 1.7);
          const glowSize = sprites.glow.width * (bright ? 1.25 : 0.9) * (0.94 + 0.08 * pulse);
          context.globalCompositeOperation = 'screen';
          context.globalAlpha = (bright ? 0.95 : 0.7) * pulse;
          context.drawImage(sprites.glow, x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
          context.globalCompositeOperation = 'source-over';
          context.globalAlpha = 1;
          const mark = sprites.grace;
          context.drawImage(mark, Math.round(x - mark.width / 2), Math.round(y - mark.height / 2));
          const shown = bright ? 1 : nameFade;
          if (shown > 0) {
            const name = sprites.graces.get(grace.id);
            if (name) {
              context.globalAlpha = shown;
              context.drawImage(name, Math.round(x - name.width / 2), Math.round(y - mark.height / 2 - name.height + name.height * 0.2));
              context.globalAlpha = 1;
            }
          }
        }
      }

      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      context.font = `${Math.round(11.5 * ratio)}px Georgia, serif`;
      const namesFrom = metersScale >= NAMES_FROM;
      const near = pointer.inside ? 16 * ratio : 0;
      others.forEach((other, index) => {
        const x = screenX(other.x);
        const y = screenY(other.z);
        if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return;
        context.beginPath();
        context.arc(x, y, 3.2 * ratio, 0, Math.PI * 2);
        context.fillStyle = '#c9dceb';
        context.fill();
        context.strokeStyle = '#0c0a08';
        context.lineWidth = 1.3 * ratio;
        context.stroke();
        const hovered = near > 0 && Math.hypot(x - pointer.x, y - pointer.y) <= near;
        if (hovered || (namesFrom && index < OTHER_PLAYERS_NAMED)) {
          context.fillStyle = '#dfe9f2';
          drawName(context, other.name, x, y - 5 * ratio);
        }
      });

      if (me) drawArrow(screenX(me.x), screenY(me.z), me.yaw, time);

      if (!painting) {
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = `${Math.round(14 * ratio)}px Georgia, serif`;
        context.fillStyle = GOLD_BRIGHT;
        drawName(context, failed ? 'The painted map could not be loaded, so here is a plain sketch.' : 'Unrolling the map…', width / 2, height - 42 * ratio);
      }
    };

    const toCanvas = (event: { clientX: number; clientY: number }) => {
      const box = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, box.width);
      const scaleY = canvas.height / Math.max(1, box.height);
      return { x: (event.clientX - box.left) * scaleX, y: (event.clientY - box.top) * scaleY };
    };

    const onWheel = (event: WheelEvent) => {
      // Not passive, so this can stop the menu behind the map from scrolling too.
      event.preventDefault();
      event.stopPropagation();
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
      const { x, y } = toCanvas(event);
      zoomAt(Math.exp(-event.deltaY * lines * WHEEL_SPEED), x, y);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const position = toCanvas(event);
      pointer.x = position.x;
      pointer.y = position.y;
      pointer.inside = true;
      if (drag) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_PIXELS) return;
        drag.moved = true;
        drag.x = event.clientX;
        drag.y = event.clientY;
        const scale = fit * camera.zoom;
        camera.x -= (dx * ratio) / scale;
        camera.z -= (dy * ratio) / scale;
        anchor = null;
          keepOnMap();
        setCursor('grabbing');
        return;
      }
      hover = graceAt(position.x, position.y, false);
      setCursor(graceAt(position.x, position.y, true) === null ? 'grab' : 'pointer');
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const wasDragged = drag.moved;
      drag = null;
      if (wasDragged) {
        setCursor('grab');
        return;
      }
      const { x, y } = toCanvas(event);
      const picked = graceAt(x, y, true);
      if (picked !== null) latest.current.onPick?.(picked);
    };

    const onPointerLeave = () => {
      pointer.inside = false;
      hover = null;
    };

    const grainContext = makeCanvas(1, 1).getContext('2d');
    grain = grainContext?.createPattern(grainTile(), 'repeat') ?? null;

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    setCursor('grab');
    frame = requestAnimationFrame(draw);

    // Drawing text in a font that hasn't arrived silently uses another one, and the sprites would keep it.
    void Promise.allSettled([document.fonts.load(`600 20px ${DISPLAY_FONT}`), document.fonts.ready]).then(() => {
      if (unmounted) return;
      fontsReady = true;
      sprites = makeSprites(ratio);
      layerStale = true;
    });

    loadPainting().then(
      (bitmap) => {
        if (unmounted) {
          bitmap.close();
          return;
        }
        painting = bitmap;
        plateKey = '';
        refreshPlate();
      },
      (error: unknown) => {
        failed = true;
        console.warn('World map painting failed to load', error);
      },
    );

    void loadSurround().then(
      (bitmap) => {
        if (unmounted) {
          bitmap.close();
          return;
        }
        surround = bitmap;
        layerStale = true;
      },
      (error: unknown) => {
        console.warn('World map surround failed to load', error);
      },
    );

    return () => {
      unmounted = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      painting?.close();
      surround?.close();
      freePlate(plate);
      freeSprites(sprites);
      backdrop.width = 0;
      burn.width = 0;
      layer.width = 0;
    };
  }, []);

  return (
    <div className="world-map">
      <canvas ref={canvasRef} className="world-map__canvas" aria-label="Map of the world" />
      <div className="world-map__frame" />
    </div>
  );
}

/** What the marks on the map mean. */
export function WorldMapLegend() {
  return (
    <ul className="world-map__legend">
      <li><span className="world-map__mark world-map__mark--me" /> You</li>
      <li><span className="world-map__mark world-map__mark--grace" /> Binary Grace you have found</li>
      <li><span className="world-map__mark world-map__mark--player" /> Other players</li>
      <li><span className="world-map__mark world-map__mark--unexplored" /> Not yet explored</li>
      <li className="world-map__hint">Scroll to zoom, drag to move</li>
    </ul>
  );
}
