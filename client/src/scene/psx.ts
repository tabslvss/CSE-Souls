/**
 * Small toolkit for PS1-looking pictures drawn in code: a low internal resolution,
 * 15-bit color with ordered dithering (what the original console's GPU did), hard pixel
 * edges and silhouettes. The website art and the future game share this visual language.
 */

export type Rgb = readonly [number, number, number];

const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Reduces an image to 5 bits per channel, using dither to hide the color banding. */
export function ditherTo15Bit(image: ImageData): void {
  const { data, width } = image;
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    const x = pixel % width;
    const y = (pixel / width) | 0;
    const offset = (BAYER_4X4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 8;
    data[i] = clampByte(data[i] + offset) & 0xf8;
    data[i + 1] = clampByte(data[i + 1] + offset) & 0xf8;
    data[i + 2] = clampByte(data[i + 2] + offset) & 0xf8;
  }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css(color: Rgb, alpha = 1): string {
  return `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${alpha})`;
}

export function fillSky(ctx: CanvasRenderingContext2D, w: number, h: number, stops: readonly Rgb[]): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((stop, index) => gradient.addColorStop(index / (stops.length - 1), css(stop)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** A ragged horizon: layered sine noise closed off along the bottom of the picture. */
export function ridgePath(w: number, h: number, base: number, rough: number, seed: number): Path2D {
  const random = seededRandom(seed);
  const phases = [random() * 7, random() * 7, random() * 7];
  const path = new Path2D();
  path.moveTo(0, h);
  for (let x = 0; x <= w; x += 2) {
    const n =
      Math.sin(x * 0.013 + phases[0]) * 0.55 +
      Math.sin(x * 0.041 + phases[1]) * 0.3 +
      Math.sin(x * 0.11 + phases[2]) * 0.15;
    path.lineTo(x, base + n * rough + (random() - 0.5) * 1.5);
  }
  path.lineTo(w, h);
  path.closePath();
  return path;
}

/** One broken or spired tower, added to an existing path. */
function addTower(
  path: Path2D,
  x: number,
  base: number,
  width: number,
  height: number,
  roof: number,
  random: () => number,
): void {
  const top = base - height;
  path.rect(x, top, width, height);
  if (roof > 0) {
    // Gothic spire, slightly overhanging the tower, with a thin finial.
    path.moveTo(x - 1, top);
    path.lineTo(x + width / 2, top - roof);
    path.lineTo(x + width + 1, top);
    path.closePath();
    path.rect(x + width / 2 - 0.5, top - roof - 3, 1, 4);
  } else {
    // Ruined top: an uneven line of snapped masonry.
    path.moveTo(x, top);
    let px = x;
    while (px < x + width) {
      const step = 1 + random() * 3;
      path.lineTo(px + step / 2, top - random() * 6);
      px += step;
    }
    path.lineTo(x + width, top);
    path.closePath();
  }
}

/** The ruined citadel. Coordinates are relative to the crag's center and base line. */
export function citadelPath(cx: number, base: number, scale: number, seed: number): Path2D {
  const random = seededRandom(seed);
  const path = new Path2D();
  const s = scale;

  // Wedge of rock the fortress grows out of.
  path.moveTo(cx - 118 * s, base + 40 * s);
  path.lineTo(cx - 92 * s, base + 2 * s);
  path.lineTo(cx - 60 * s, base - 6 * s);
  path.lineTo(cx + 48 * s, base - 8 * s);
  path.lineTo(cx + 84 * s, base + 4 * s);
  path.lineTo(cx + 122 * s, base + 40 * s);
  path.closePath();

  // Curtain wall with crenellations.
  path.rect(cx - 72 * s, base - 28 * s, 130 * s, 26 * s);
  for (let x = -72; x < 58; x += 6) path.rect(cx + x * s, base - 32 * s, 3 * s, 5 * s);

  const towers: Array<[number, number, number, number]> = [
    // x offset, width, height, roof height (0 means a broken top)
    [-84, 13, 58, 0],
    [-62, 11, 74, 20],
    [-44, 9, 54, 15],
    [-30, 17, 104, 34],
    [-10, 24, 128, 46],
    [16, 13, 92, 30],
    [32, 10, 62, 0],
    [46, 14, 78, 22],
    [64, 9, 44, 0],
  ];
  for (const [x, width, height, roof] of towers) {
    addTower(path, cx + x * s, base, width * s, height * s, roof * s, random);
  }

  // Flying buttresses: slanted slabs bracing the great keep.
  for (const [x1, y1, x2, y2] of [
    [-30, -74, -46, -44],
    [-30, -58, -62, -30],
    [14, -96, 32, -52],
    [29, -60, 50, -34],
  ]) {
    path.moveTo(cx + x1 * s, base + y1 * s);
    path.lineTo(cx + x1 * s, base + (y1 + 4) * s);
    path.lineTo(cx + x2 * s, base + (y2 + 3) * s);
    path.lineTo(cx + x2 * s, base + y2 * s);
    path.closePath();
  }
  return path;
}

/** Where lit windows sit on the citadel, in the same coordinate system. */
export const CITADEL_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [-3, -100],
  [4, -86],
  [-1, -66],
  [-24, -78],
  [-22, -52],
  [20, -70],
  [50, -56],
  [-58, -50],
];

export function drawDeadTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  seed: number,
): void {
  const random = seededRandom(seed);
  const branch = (bx: number, by: number, angle: number, length: number, width: number) => {
    const ex = bx + Math.cos(angle) * length;
    const ey = by + Math.sin(angle) * length;
    ctx.lineWidth = Math.max(1, width);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (length < 4) return;
    const forks = random() > 0.35 ? 2 : 1;
    for (let i = 0; i < forks; i += 1) {
      branch(ex, ey, angle + (random() - 0.5) * 1.4, length * (0.62 + random() * 0.14), width * 0.65);
    }
  };
  branch(x, y, -Math.PI / 2 + (random() - 0.5) * 0.2, height * 0.42, Math.max(1.5, height / 14));
}

export function fillGraveCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, lean = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.fillRect(-size * 0.1, -size, size * 0.2, size);
  ctx.fillRect(-size * 0.36, -size * 0.74, size * 0.72, size * 0.18);
  ctx.restore();
}

export function fillTombstone(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x - size * 0.4, y);
  ctx.lineTo(x - size * 0.4, y - size * 0.7);
  ctx.quadraticCurveTo(x, y - size * 1.2, x + size * 0.4, y - size * 0.7);
  ctx.lineTo(x + size * 0.4, y);
  ctx.closePath();
  ctx.fill();
}

/** A cloaked figure sitting beside the fire, sword planted in the ground. */
export function fillSeatedKnight(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 7 * s, y);
  ctx.lineTo(x - 6 * s, y - 7 * s);
  ctx.lineTo(x - 3 * s, y - 12 * s);
  ctx.lineTo(x - 2 * s, y - 16 * s);
  ctx.lineTo(x + 1 * s, y - 18 * s);
  ctx.lineTo(x + 3.5 * s, y - 16 * s);
  ctx.lineTo(x + 3 * s, y - 12 * s);
  ctx.lineTo(x + 6 * s, y - 6 * s);
  ctx.lineTo(x + 9 * s, y - 4 * s);
  ctx.lineTo(x + 9 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x + 11 * s, y - 15 * s, Math.max(1, s), 15 * s);
  ctx.fillRect(x + 9 * s, y - 12 * s, 5 * s, Math.max(1, s));
}

/** Soft cloudy noise in the alpha channel. Tiles horizontally, for scrolling fog. */
export function makeFogTexture(width: number, height: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const random = seededRandom(seed);
  const waves = Array.from({ length: 7 }, (_, i) => ({
    fx: ((1 + (i % 4)) * Math.PI * 2) / width,
    fy: (0.05 + random() * 0.12) * (1 + i * 0.4),
    p1: random() * 7,
    p2: random() * 7,
    amp: 1 / (1 + i * 0.5),
  }));
  for (let y = 0; y < height; y += 1) {
    const fade = Math.sin((y / height) * Math.PI);
    for (let x = 0; x < width; x += 1) {
      let n = 0;
      for (const wave of waves) {
        n += Math.sin(x * wave.fx + wave.p1 + Math.sin(y * wave.fy + wave.p2) * 1.6) * wave.amp;
      }
      const value = Math.max(0, n * 0.34 + 0.34) * fade;
      const index = (y * width + x) * 4;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = 255;
      image.data[index + 3] = value * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
