/**
 * Builds client/public/map/world.webp, the painted picture under the world map screen, and surround.webp,
 * the dimmer mountains that fill the window around it.
 *
 * It renders the real 3D world from straight above through the map lab page, so every tree, wall and
 * wall is where it is in the game, then paints them onto an invented land: the simulation is flat, so the
 * hills here are for reading the land only. The picture covers MAP.bounds exactly, north at the top.
 *
 * Needs: the Vite dev server running (npm run dev in client/), Chrome, sharp and playwright-core.
 *        Modules are looked for here, in server/node_modules, and in $TOOL_MODULES.
 * Run:   node tools/build-world-map.mjs            renders, then paints (about a minute)
 *        node tools/build-world-map.mjs --reuse    paints again from the last renders, for tuning colors
 *        node tools/build-world-map.mjs --out=x.webp --lab=http://localhost:5173/map-lab.html
 * It also prints how far each Binary Grace's bonfire sits from where the map says it is, in pixels.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const REUSE = process.argv.includes('--reuse');
const OUT = resolve(option('out', join(ROOT, 'client/public/map/world.webp')));
const LAB = option('lab', 'http://localhost:5173/map-lab.html');
const CACHE = join(tmpdir(), 'cse-world-map');

function need(name) {
  const places = [import.meta.url, join(ROOT, 'server/package.json'), join(process.env.TOOL_MODULES ?? ROOT, '_.js')];
  for (const place of places) {
    try {
      return createRequire(place)(name);
    } catch {
      // The next place might have it.
    }
  }
  throw new Error(`Can't find ${name}. Run npm i --no-save ${name}, or point TOOL_MODULES at a node_modules folder that has it.`);
}
const sharp = need('sharp');

/* ---------- What the picture is ---------- */

/** Rendered big and shrunk, which gives clean edges on thin branches and wall tops. */
const RENDER = { width: 3932, height: 4096 };
const W = 2304;
const H = 2400;
/** Lights the invented relief: northwest and fairly low, the way shaded relief maps are lit, so that ranges read. */
const SUN = norm([-1, 1.3, -1]);
/** Lights the render: nearly overhead, as a low sun's long tower shadows read as stripes across the map. */
const RENDER_SUN = norm([-0.1, 1, -0.13]);
const KINDS = {
  /** Anything that isn't a plant or a stone: the castle, ruins, walls and huts, and the castle's core, which has no name. */
  built: '^(?!tree_|bush|fern|grass|mushroom|log_|stump_|rock_|plant|flower|dead_)',
  bonfire: '^bonfire',
};

function norm(v) {
  const size = Math.hypot(...v);
  return v.map((part) => part / size);
}
function smooth(from, to, value) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
const mix = (a, b, t) => a + (b - a) * t;

/* ---------- Rendering, through the map lab ---------- */

async function render() {
  const { chromium } = need('playwright-core');
  mkdirSync(CACHE, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    // Works without a GPU, and a software renderer has no trouble with one still picture.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
  });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 480 } })).newPage();
  page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 300)));
  await page.goto(`${LAB}?manual=1&phase=0.5`, { timeout: 60000 });
  await page.waitForFunction(() => window.lab);
  await page.evaluate(() => window.lab.ready);
  await page.waitForTimeout(1500);

  const pass = async (name, options) => {
    const started = Date.now();
    const png = await page.evaluate((o) => window.lab.bakeTopDown(o), { sun: RENDER_SUN, ...options });
    writeFileSync(join(CACHE, `${name}.png`), Buffer.from(png, 'base64'));
    console.log(`rendered ${name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  };
  await pass('lit', RENDER);
  await pass('plain', { ...RENDER, shadows: false });
  await pass('props', { width: W, height: H, propsOnly: true });
  await pass('built', { width: W, height: H, propsOnly: true, match: KINDS.built });
  await pass('bonfire', { width: W, height: H, propsOnly: true, match: KINDS.bonfire });

  writeFileSync(join(CACHE, 'data.json'), JSON.stringify(await page.evaluate(() => window.lab.mapData())));
  await browser.close();
}

/* ---------- Small tools on float images ---------- */

async function readColor(name) {
  const { data } = await sharp(join(CACHE, `${name}.png`)).removeAlpha().resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(W * H * 3);
  for (let i = 0; i < out.length; i += 1) out[i] = data[i] / 255;
  return out;
}

async function readAlpha(name) {
  const { data } = await sharp(join(CACHE, `${name}.png`)).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i += 1) out[i] = data[i] / 255;
  return out;
}

/** Three box blurs in a row, which is close to a Gaussian and doesn't care how big the radius gets. */
function blur(source, width, height, sigma, channels = 1, channel = 0) {
  const radius = Math.max(1, Math.round(sigma * 1.1));
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = source[i * channels + channel];
  const line = new Float32Array(Math.max(width, height));
  const run = (count, length, at, step) => {
    for (let n = 0; n < count; n += 1) {
      const start = at(n);
      let sum = 0;
      for (let i = -radius; i <= radius; i += 1) sum += out[start + Math.max(0, Math.min(length - 1, i)) * step];
      for (let i = 0; i < length; i += 1) {
        line[i] = sum;
        sum += out[start + Math.min(length - 1, i + radius + 1) * step] - out[start + Math.max(0, i - radius) * step];
      }
      for (let i = 0; i < length; i += 1) out[start + i * step] = line[i] / (radius * 2 + 1);
    }
  };
  for (let pass = 0; pass < 3; pass += 1) {
    run(height, width, (row) => row * width, 1);
    run(width, height, (column) => column, width);
  }
  return out;
}

/** The fixed noise the whole picture is built from, so that every run paints the same land. Integer mixing, as a sine hash beats into visible stripes. */
function hash(x, z) {
  let h = (Math.imul(Math.floor(x), 374761393) + Math.imul(Math.floor(z), 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2147483629);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = x - ix;
  const tz = z - iz;
  const fx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const fz = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
// Each octave is turned a little, or the noise's square grid shows through as boxy ridges.
function fbm(x, z, octaves = 4) {
  let total = 0;
  let amplitude = 0.5;
  for (let i = 0; i < octaves; i += 1) {
    total += noise(x + i * 37.7, z - i * 19.3) * amplitude;
    amplitude *= 0.5;
    const turned = x * 1.66 - z * 1.11;
    z = x * 1.11 + z * 1.66;
    x = turned;
  }
  return total;
}
function ridged(x, z, octaves = 4) {
  // Bent first, so the crests wander like real ridgelines.
  const bentX = x + (fbm(x * 0.7 + 3, z * 0.7, 2) - 0.37) * 1.5;
  const bentZ = z + (fbm(x * 0.7, z * 0.7 + 8, 2) - 0.37) * 1.5;
  let total = 0;
  let amplitude = 0.56;
  let u = bentX;
  let v = bentZ;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(noise(u + i * 11.3, v - i * 7.9) * 2 - 1);
    total += n * n * amplitude;
    amplitude *= 0.47;
    const turned = u * 1.72 - v * 1.15;
    v = u * 1.15 + v * 1.72;
    u = turned;
  }
  return total;
}

function toLine(points) {
  const segments = [];
  for (let i = 0; i + 3 < points.length; i += 2) segments.push([points[i], points[i + 1], points[i + 2] - points[i], points[i + 3] - points[i + 1]]);
  return segments;
}
function distanceTo(segments, x, z) {
  let best = Infinity;
  for (const [ax, az, dx, dz] of segments) {
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
function rectDistance(x, z, minX, maxX, minZ, maxZ) {
  return Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minZ - z, 0, z - maxZ));
}

/** A mild painterly filter: every pixel takes the color of the calmest quarter of its neighborhood. */
function kuwahara(image, width, height, radius) {
  const out = new Float32Array(image.length);
  const quarters = [[-radius, 0, -radius, 0], [0, radius, -radius, 0], [-radius, 0, 0, radius], [0, radius, 0, radius]];
  const count = (radius + 1) ** 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = Infinity;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [left, right, top, bottom] of quarters) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let squares = 0;
        for (let v = top; v <= bottom; v += 1) {
          const row = Math.max(0, Math.min(height - 1, y + v)) * width;
          for (let u = left; u <= right; u += 1) {
            const i = (row + Math.max(0, Math.min(width - 1, x + u))) * 3;
            const cr = image[i];
            const cg = image[i + 1];
            const cb = image[i + 2];
            const luma = cr * 0.3 + cg * 0.59 + cb * 0.11;
            sr += cr;
            sg += cg;
            sb += cb;
            squares += luma * luma;
          }
        }
        const meanLuma = (sr * 0.3 + sg * 0.59 + sb * 0.11) / count;
        const variance = squares / count - meanLuma * meanLuma;
        if (variance < best) {
          best = variance;
          r = sr / count;
          g = sg / count;
          b = sb / count;
        }
      }
      const o = (y * width + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

/** Colors along a ramp from 0 to 1, in the sRGB values the picture is stored in. */
function ramp(stops, t, out) {
  const clamped = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && clamped > stops[i + 1][0]) i += 1;
  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[i + 1];
  const f = (clamped - t0) / (t1 - t0);
  out[0] = (r0 + (r1 - r0) * f) / 255;
  out[1] = (g0 + (g1 - g0) * f) / 255;
  out[2] = (b0 + (b1 - b0) * f) / 255;
}

/* ---------- The invented land ---------- */

/** The painted mountains around the sheet, so a wide window shows land rather than empty sides. Only the land outside MAP.bounds is ever seen. */
const SURROUND = { minX: -480, maxX: 480, minZ: -420, maxZ: 340, pixelsPerMeter: 2 };
/** Contours every this many meters, an index line every fifth. */
const CONTOUR = 4;
/** How hard water cuts. Higher digs deeper, branchier valleys. */
const EROSION = 0.07;

/**
 * Meters of height at one point. The game's ground is flat where you can walk, so this only has to agree
 * with what stands there: level at the castle, the shrine and the hamlet, a valley along the road, rolling
 * hills under the trees, and ranges closing in along the edges, with passes cut through them.
 */
function landHeight(x, z, bounds, road) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const wobble = (fbm(x * 0.016 + 5, z * 0.016 - 3, 3) - 0.44) * 50;
  // Foothills wander well out from the land's straight borders, or the foot of a range is one long ruled line with a corner in it.
  const wander = (fbm(x * 0.006 - 21, z * 0.006 + 2, 2) - 0.37) * 110;
  // Noise stretched along the range, so that it reads as long ridges: east to west in the north, north to south down the sides.
  const northness = smooth(-60, -130, z + wobble * 0.4);
  const crags = mix(ridged(x * 0.017 + 40, z * 0.0095 - 17), ridged(x * 0.0095, z * 0.017), northness);
  const band = smooth(-110, -180, z);
  const passes = 1 - 0.55 * Math.exp(-((x / 46) ** 2)) - band * (0.5 * Math.exp(-(((x + 158) / 24) ** 2)) + 0.46 * Math.exp(-(((x - 142) / 22) ** 2)));

  const toSide = Math.min(x - minX, maxX - x) + wobble * 1.5 + wander;
  const toSouth = maxZ - z + wobble * 0.5;
  const edge = Math.max(smooth(52, 0, toSide), 0.5 * smooth(28, 0, toSouth));
  const rim = edge * 16 + edge ** 1.4 * crags * 72;
  const north = smooth(-198, -282, z + wobble * 0.6) * 18 + smooth(-194, -238, z + wobble * 0.9) * crags * 96 * passes;
  // Open to the south a while past the sheet, so that a tall window shows the meadow running on before the hills start.
  const outside = Math.min(rectDistance(x, z, -240, 240, -92, 262), rectDistance(x, z, -94, 94, -292, -92));
  const corners = (smooth(-4, 90, outside + wobble * 0.7 - wander * 0.8) * 22 + smooth(-2, 46, outside + wobble * 0.7 - wander * 0.8) * crags * 104) * passes;
  const mountains = Math.max(rim, north, corners);

  const inForest = 1 - smooth(0, 24, rectDistance(x, z, 60, 240, -92, 112));
  const inGraveyard = 1 - smooth(0, 24, rectDistance(x, z, -240, -60, -92, 112));
  const roadDistance = distanceTo(road, x, z);
  const amplitude = 2.3 + 5 * inForest + 3.4 * inGraveyard;
  const hills = (fbm(x * 0.012 + 9, z * 0.012 + 2) - 0.47) * 2.4 * amplitude + (fbm(x * 0.038, z * 0.038 + 7, 3) - 0.44) * 0.7 * amplitude;
  const valley = -3.6 * Math.exp(-((roadDistance / 42) ** 2));
  // The land climbs slowly from the shrine in the south to the citadel in the north.
  let height = ((maxZ - z) / (maxZ - minZ)) * 9 + valley + hills * smooth(5, 52, roadDistance) + mountains;

  // Flat places, set at heights between contour lines so that no line runs through them.
  const flatten = (amount, level) => {
    height = mix(height, level, amount);
  };
  flatten(1 - smooth(4, 34, rectDistance(x, z, -90, 90, -190, -100) + wobble * 0.3), 6);
  flatten(1 - smooth(14, 44, Math.hypot(x, z - 178) + wobble * 0.2), 2);
  flatten(1 - smooth(6, 30, rectDistance(x, z, -54, 54, 38, 106) + wobble * 0.16), 2);
  flatten(1 - smooth(10, 30, Math.hypot(x - 150, z - 10) + wobble * 0.16), 6);
  flatten(1 - smooth(6, 22, Math.hypot(x - 180, z + 30) + wobble * 0.14), 6);
  return height;
}

/**
 * Heights for everything the map shows, carved by water. Noise alone never looks like mountains: it makes
 * smooth worms. Letting rain find its way downhill and cut channels (a simple stream-power model) gives the
 * branching valleys and sharp spurs of a real range. Only high ground is carved, so the flat places stay flat.
 */
function erodedField(bounds, road) {
  const step = 2;
  const { minX, maxX, minZ, maxZ } = SURROUND;
  const columns = (maxX - minX) / step;
  const rows = (maxZ - minZ) / step;
  const count = columns * rows;
  const start = new Float32Array(count);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = minX + (column + 0.5) * step;
      const z = minZ + (row + 0.5) * step;
      const height = landHeight(x, z, bounds, road);
      // Rough ground gives the water something to choose between. On smooth ground it just runs in parallel.
      start[row * columns + column] = height + smooth(10, 26, height) * (fbm(x * 0.07 + 13, z * 0.07 - 29, 5) - 0.48) * 22;
    }
  }
  const field = start.slice();
  const carve = start.map((value) => smooth(9, 22, value));
  const order = new Int32Array(count);
  const receiver = new Int32Array(count);
  const seen = new Uint8Array(count);
  const area = new Float32Array(count);
  const heap = new Int32Array(count);
  const keys = new Float32Array(count);
  const distances = [step, step, step, step, step * Math.SQRT2, step * Math.SQRT2, step * Math.SQRT2, step * Math.SQRT2];
  const moves = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let pass = 0; pass < 30; pass += 1) {
    // Water drains from the lowest ground outward, so that every cell has a way down, even out of a hollow.
    seen.fill(0);
    let size = 0;
    const push = (cell, key) => {
      let i = size;
      size += 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (keys[heap[parent]] <= key) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = cell;
      keys[cell] = key;
    };
    const pop = () => {
      const top = heap[0];
      size -= 1;
      const last = heap[size];
      const key = keys[last];
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= size) break;
        if (child + 1 < size && keys[heap[child + 1]] < keys[heap[child]]) child += 1;
        if (keys[heap[child]] >= key) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
      return top;
    };
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const cell = row * columns + column;
        if (carve[cell] === 0 || row === 0 || column === 0 || row === rows - 1 || column === columns - 1) {
          seen[cell] = 1;
          receiver[cell] = -1;
          push(cell, field[cell]);
        }
      }
    }
    let visited = 0;
    while (size > 0) {
      const cell = pop();
      order[visited] = cell;
      visited += 1;
      const row = Math.floor(cell / columns);
      const column = cell - row * columns;
      for (const [dx, dz] of moves) {
        const nextColumn = column + dx;
        const nextRow = row + dz;
        if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
        const next = nextRow * columns + nextColumn;
        if (seen[next]) continue;
        seen[next] = 1;
        receiver[next] = cell;
        push(next, Math.max(field[next], keys[cell] + 0.001));
      }
    }
    area.fill(1);
    for (let i = visited - 1; i >= 0; i -= 1) if (receiver[order[i]] >= 0) area[receiver[order[i]]] += area[order[i]];
    for (let i = 0; i < visited; i += 1) {
      const cell = order[i];
      const down = receiver[cell];
      if (down < 0) continue;
      const pull = (EROSION * Math.sqrt(area[cell]) * carve[cell]) / step;
      field[cell] = (field[cell] + pull * field[down]) / (1 + pull);
    }
    // The ranges keep rising a little as they wear down, so that peaks survive between the valleys.
    for (let i = 0; i < count; i += 1) field[i] += (start[i] - field[i]) * 0.07 * carve[i];
  }
  return { field, columns, rows, step };
}

/** The carved heights resampled for one picture. */
function heightGrid(area, width, height, pixelsPerMeter, eroded) {
  const { field, columns, rows, step } = eroded;
  const full = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const v = Math.min(rows - 1.001, Math.max(0, (area.minZ + (y + 0.5) / pixelsPerMeter - SURROUND.minZ) / step - 0.5));
    const iv = Math.floor(v);
    for (let x = 0; x < width; x += 1) {
      const u = Math.min(columns - 1.001, Math.max(0, (area.minX + (x + 0.5) / pixelsPerMeter - SURROUND.minX) / step - 0.5));
      const iu = Math.floor(u);
      const a = field[iv * columns + iu];
      const b = field[iv * columns + iu + 1];
      const c = field[(iv + 1) * columns + iu];
      const d = field[(iv + 1) * columns + iu + 1];
      full[y * width + x] = mix(mix(a, b, u - iu), mix(c, d, u - iu), v - iv);
    }
  }
  return { area, width, height, pixelsPerMeter, heights: blur(full, width, height, 0.67 * pixelsPerMeter) };
}

/** Adds a soft dot to a float image. */
function plot(image, width, height, x, y, amount) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= width - 1 || iy >= height - 1) return;
  const fx = x - ix;
  const fy = y - iy;
  image[iy * width + ix] += amount * (1 - fx) * (1 - fy);
  image[iy * width + ix + 1] += amount * fx * (1 - fy);
  image[(iy + 1) * width + ix] += amount * (1 - fx) * fy;
  image[(iy + 1) * width + ix + 1] += amount * fx * fy;
}

/**
 * The land's shape as layers to paint with. The raw noise lit directly reads as crumpled foil, so
 * mountains are lit from heights smoothed by about 2 m, then given their form back three ways:
 * broad shading for the massifs, a lighter crest and darker gully, and hachures down the steep faces.
 */
function buildRelief(grid) {
  const { width: w, height: h, pixelsPerMeter: ppm, heights, area } = grid;
  const soft = blur(heights, w, h, 2 * ppm);
  const wide = blur(heights, w, h, 8 * ppm);
  const broad = blur(heights, w, h, 22 * ppm);
  const contourBase = blur(heights, w, h, 1.4 * ppm);
  const mountain = new Float32Array(w * h);
  const relief = new Float32Array(w * h);
  const surface = new Float32Array(w * h);
  const meter = 1 / ppm;
  const flatLight = SUN[1];
  const lighting = (slopeX, slopeZ, exaggeration) => {
    const nx = -slopeX * exaggeration;
    const nz = -slopeZ * exaggeration;
    return ((nx * SUN[0] + SUN[1] + nz * SUN[2]) / Math.hypot(nx, 1, nz)) / flatLight;
  };
  for (let y = 0; y < h; y += 1) {
    const wz = area.minZ + ((y + 0.5) / ppm);
    for (let x = 0; x < w; x += 1) {
      const at = y * w + x;
      const wx = area.minX + ((x + 0.5) / ppm);
      mountain[at] = smooth(9, 26, soft[at] + (noise(wx * 0.09, wz * 0.09) - 0.5) * 12);
      surface[at] = mix(contourBase[at], soft[at], mountain[at]);
      // Fine broken rock, for the light only. The carved heights are too coarse to hold up when zoomed in.
      soft[at] += (fbm(wx * 0.21 + 3, wz * 0.21 + 91, 4) - 0.47) * 4.5 * mountain[at];
    }
  }
  for (let y = 0; y < h; y += 1) {
    const up = Math.max(0, y - 1) * w;
    const down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x += 1) {
      const at = y * w + x;
      const left = Math.max(0, x - 1);
      const right = Math.min(w - 1, x + 1);
      const m = mountain[at];
      const near = lighting((mix(heights[y * w + right], soft[y * w + right], m) - mix(heights[y * w + left], soft[y * w + left], m)) / (2 * meter), (mix(heights[down + x], soft[down + x], m) - mix(heights[up + x], soft[up + x], m)) / (2 * meter), mix(0.9, 1.25, m));
      const far = lighting((broad[y * w + right] - broad[y * w + left]) / (2 * meter), (broad[down + x] - broad[up + x]) / (2 * meter), 1.5);
      // A soft ceiling on the light, because a hard one turns every face either full light or full dark.
      const lit = mix(mix(1, near, 0.42), near, m) - 1;
      const base = 1 + (lit > 0 ? 0.24 * Math.tanh(lit / 0.24) : 0.33 * Math.tanh(lit / 0.33));
      const crest = Math.min(1, Math.max(-1, (soft[at] - wide[at]) / 5));
      relief[at] = base * (1 + m * 0.14 * Math.tanh((far - 1) / 0.3)) * (1 + m * crest * 0.2);
    }
  }
  return { mountain, relief, surface, soft };
}

/** Short ink strokes running straight downhill on steep faces, the old engravers' way of drawing a mountain. */
function traceHachures(grid, relief, spacing) {
  const { width: w, height: h, pixelsPerMeter: ppm } = grid;
  const { soft, mountain } = relief;
  const ink = new Float32Array(w * h);
  const toSun = norm([SUN[0], SUN[2]]);
  const step = spacing * ppm;
  for (let gy = 0; gy * step < h; gy += 1) {
    for (let gx = 0; gx * step < w; gx += 1) {
      let px = (gx + hash(gx + 11, gy) * 0.9) * step;
      let py = (gy + hash(gx, gy + 23) * 0.9) * step;
      const slopeAt = (x, y) => {
        const ix = Math.max(1, Math.min(w - 2, Math.round(x)));
        const iy = Math.max(1, Math.min(h - 2, Math.round(y)));
        return [(soft[iy * w + ix + 1] - soft[iy * w + ix - 1]) * 0.5 * ppm, (soft[(iy + 1) * w + ix] - soft[(iy - 1) * w + ix]) * 0.5 * ppm, iy * w + ix];
      };
      const [startX, startY, at] = slopeAt(px, py);
      const steep = Math.hypot(startX, startY);
      if (steep < 0.38 || mountain[at] < 0.3) continue;
      const faces = (-startX * toSun[0] - startY * toSun[1]) / steep;
      const strength = mountain[at] * smooth(0.38, 1, steep) * mix(1, 0.42, smooth(-0.4, 0.4, faces));
      const length = Math.min(7, 1.6 + steep * 4) * ppm;
      for (let walked = 0; walked < length; walked += 0.7) {
        const [sx, sy] = slopeAt(px, py);
        const size = Math.hypot(sx, sy);
        if (size < 0.05) break;
        // Tapers off downhill, as a pen stroke does.
        plot(ink, w, h, px, py, strength * (1 - (walked / length) * 0.7));
        px -= (sx / size) * 0.7;
        py -= (sy / size) * 0.7;
      }
    }
  }
  return ink;
}

/**
 * Real contour lines, followed from end to end, so that small loops can be thrown away and the rest smoothed.
 * Lowland gets few lines and only long ones: its hills are invented noise, and every small loop there reads as a stray scribble.
 */
function traceContours(grid, relief) {
  const { width: w, height: h, pixelsPerMeter: ppm } = grid;
  const { surface } = relief;
  const thin = new Float32Array(w * h);
  const index = new Float32Array(w * h);
  const cell = Math.max(2, Math.round(0.8 * ppm));
  const columns = Math.floor((w - 1) / cell);
  const rows = Math.floor((h - 1) / cell);
  const sample = new Float32Array((columns + 1) * (rows + 1));
  let top = 0;
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= columns; i += 1) {
      const value = surface[j * cell * w + i * cell];
      sample[j * (columns + 1) + i] = value;
      top = Math.max(top, value);
    }
  }
  for (let level = CONTOUR; level < top; level += CONTOUR) {
    const lowland = level < 16;
    if (lowland && level % (CONTOUR * 2) !== 0) continue;
    const isIndex = level % (CONTOUR * 5) === 0;
    const links = new Map();
    const pointOf = new Map();
    const edgePoint = (i, j, vertical) => {
      const id = (j * (columns + 1) + i) * 2 + (vertical ? 1 : 0);
      if (!pointOf.has(id)) {
        const a = sample[j * (columns + 1) + i];
        const b = vertical ? sample[(j + 1) * (columns + 1) + i] : sample[j * (columns + 1) + i + 1];
        const t = (level - a) / (b - a);
        pointOf.set(id, vertical ? [i * cell, (j + t) * cell] : [(i + t) * cell, j * cell]);
      }
      return id;
    };
    const link = (a, b) => {
      if (!links.has(a)) links.set(a, []);
      if (!links.has(b)) links.set(b, []);
      links.get(a).push(b);
      links.get(b).push(a);
    };
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < columns; i += 1) {
        const a = sample[j * (columns + 1) + i] >= level;
        const b = sample[j * (columns + 1) + i + 1] >= level;
        const c = sample[(j + 1) * (columns + 1) + i + 1] >= level;
        const d = sample[(j + 1) * (columns + 1) + i] >= level;
        if (a === b && b === c && c === d) continue;
        const crossings = [];
        if (a !== b) crossings.push(edgePoint(i, j, false));
        if (b !== c) crossings.push(edgePoint(i + 1, j, true));
        if (c !== d) crossings.push(edgePoint(i, j + 1, false));
        if (d !== a) crossings.push(edgePoint(i, j, true));
        link(crossings[0], crossings[1]);
        if (crossings.length === 4) link(crossings[2], crossings[3]);
      }
    }
    const seen = new Set();
    const follow = (start) => {
      const chain = [start];
      seen.add(start);
      for (let walking = true; walking;) {
        walking = false;
        for (const next of links.get(chain[chain.length - 1])) {
          if (seen.has(next)) continue;
          seen.add(next);
          chain.push(next);
          walking = true;
          break;
        }
      }
      return chain;
    };
    const ends = [...links.keys()].filter((id) => links.get(id).length === 1);
    for (const start of [...ends, ...links.keys()]) {
      if (seen.has(start)) continue;
      const chain = follow(start);
      const closed = links.get(chain[chain.length - 1]).includes(start) && chain.length > 2;
      let points = chain.map((id) => pointOf.get(id));
      if (closed) points.push(points[0]);
      let length = 0;
      for (let p = 1; p < points.length; p += 1) length += Math.hypot(points[p][0] - points[p - 1][0], points[p][1] - points[p - 1][1]);
      length /= ppm;
      if ((closed && length < 40) || (lowland && length < 110) || length < 12) continue;
      for (let pass = 0; pass < 3; pass += 1) {
        points = points.map((point, p) => {
          const before = points[closed ? (p - 1 + points.length - 1) % (points.length - 1) : Math.max(0, p - 1)];
          const after = points[closed ? (p + 1) % (points.length - 1) : Math.min(points.length - 1, p + 1)];
          return [point[0] * 0.5 + (before[0] + after[0]) * 0.25, point[1] * 0.5 + (before[1] + after[1]) * 0.25];
        });
      }
      const target = isIndex ? index : thin;
      const strength = lowland ? 0.65 : 1;
      for (let p = 1; p < points.length; p += 1) {
        const [ax, ay] = points[p - 1];
        const dx = points[p][0] - ax;
        const dy = points[p][1] - ay;
        const size = Math.hypot(dx, dy);
        for (let t = 0; t < size; t += 0.7) plot(target, w, h, ax + (dx * t) / size, ay + (dy * t) / size, 0.7 * strength);
      }
    }
  }
  return { thin, index };
}

/* ---------- Painting ---------- */

const LAND_RAMP = [[0, 20, 13, 8], [0.22, 52, 38, 24], [0.48, 112, 88, 58], [0.72, 170, 142, 96], [1, 226, 205, 158]];
const ROCK_RAMP = [[0, 48, 35, 24], [0.3, 92, 73, 52], [0.62, 136, 113, 82], [1, 192, 170, 132]];
const INK = [34 / 255, 23 / 255, 13 / 255];
/** Contour ink, a warm umber, so that lines sit in the paint rather than on it. */
const UMBER = [0x3a / 255, 0x2a / 255, 0x18 / 255];
/** What the ground is made of in each region. Unbounded sides run on past the map, so the sheet's edges can't show a gap. */
const BIOMES = [
  { minX: -900, maxX: 900, minZ: 155, maxZ: 900, color: [180, 149, 100] },
  { minX: -900, maxX: 900, minZ: 112, maxZ: 155, color: [176, 145, 96] },
  { minX: -60, maxX: 60, minZ: 30, maxZ: 112, color: [156, 128, 88] },
  { minX: -60, maxX: 60, minZ: -92, maxZ: 30, color: [142, 121, 88] },
  { minX: 60, maxX: 900, minZ: -92, maxZ: 112, color: [84, 74, 44], forest: true },
  { minX: -900, maxX: -60, minZ: -92, maxZ: 112, color: [108, 91, 68] },
  { minX: -94, maxX: 94, minZ: -192, maxZ: -92, color: [146, 124, 90] },
  { minX: -94, maxX: 94, minZ: -900, maxZ: -192, color: [92, 78, 62] },
];
/** Land with no region of its own, behind the mountains. */
const BARE = [86, 72, 56];

/**
 * The ground's color. Regions are straight boxes in the game's data, so the point is pushed around by noise
 * first and neighbours blend across about 30 m, which turns their ruler lines into a natural wandering edge.
 */
function groundAt(wx, wz, out) {
  const px = wx + (fbm(wx * 0.017 + 3, wz * 0.017 + 8, 3) - 0.44) * 92 + (fbm(wx * 0.07, wz * 0.07 + 31, 2) - 0.37) * 18;
  const pz = wz + (fbm(wx * 0.017 + 19, wz * 0.017 - 6, 3) - 0.44) * 92 + (fbm(wx * 0.07 + 47, wz * 0.07, 2) - 0.37) * 18;
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let forest = 0;
  for (const biome of BIOMES) {
    const weight = smooth(-15, 15, Math.min(px - biome.minX, biome.maxX - px, pz - biome.minZ, biome.maxZ - pz));
    if (weight <= 0) continue;
    total += weight;
    r += biome.color[0] * weight;
    g += biome.color[1] * weight;
    b += biome.color[2] * weight;
    if (biome.forest) forest += weight;
  }
  const bare = Math.max(0, 1 - total);
  const sum = total + bare;
  // Slow patches of light and dark, then a finer mottle, as thin paint settles on rough paper.
  const patches = 1 + (fbm(wx * 0.021 + 71, wz * 0.021 - 13, 4) - 0.47) * 0.5 + (fbm(wx * 0.11, wz * 0.11 + 5, 3) - 0.44) * 0.2;
  const warmth = (fbm(wx * 0.03 - 9, wz * 0.03 + 41, 2) - 0.37) * 0.12;
  out[0] = (((r + BARE[0] * bare) / sum) / 255) * patches * (1 + warmth);
  out[1] = (((g + BARE[1] * bare) / sum) / 255) * patches;
  out[2] = (((b + BARE[2] * bare) / sum) / 255) * patches * (1 - warmth);
  return forest / sum;
}

function rockAt(wx, wz, height, out) {
  ramp(ROCK_RAMP, 0.38 + (height / 130) * 0.3 + (fbm(wx * 0.09, wz * 0.09, 3) - 0.44) * 0.2, out);
}

function stamp(image, cx, cy, radius, strength, keepHighest) {
  const reach = Math.ceil(radius);
  for (let y = Math.max(0, Math.floor(cy) - reach); y <= Math.min(H - 1, Math.ceil(cy) + reach); y += 1) {
    for (let x = Math.max(0, Math.floor(cx) - reach); x <= Math.min(W - 1, Math.ceil(cx) + reach); x += 1) {
      const value = (1 - smooth(radius * 0.25, radius, Math.hypot(x - cx, y - cy))) * strength;
      image[y * W + x] = keepHighest ? Math.max(image[y * W + x], value) : image[y * W + x] + value;
    }
  }
}

async function paint() {
  const data = JSON.parse(readFileSync(join(CACHE, 'data.json'), 'utf8'));
  const { minX, maxX, minZ, maxZ } = data.bounds;
  const worldX = (x) => minX + ((x + 0.5) / W) * (maxX - minX);
  const worldZ = (y) => minZ + ((y + 0.5) / H) * (maxZ - minZ);
  const pixelsPerMeter = W / (maxX - minX);
  const toPixelX = (wx) => ((wx - minX) / (maxX - minX)) * W;
  const toPixelY = (wz) => ((wz - minZ) / (maxZ - minZ)) * H;
  console.log('reading renders');
  const lit = await readColor('lit');
  const plain = await readColor('plain');
  const props = await readAlpha('props');
  const built = await readAlpha('built');
  reportAlignment(await readAlpha('bonfire'), data);

  console.log('building the land');
  const road = toLine(data.road);
  const trails = (data.trails ?? []).map(toLine);
  const eroded = erodedField(data.bounds, road);
  const grid = heightGrid({ minX, maxX, minZ, maxZ }, W, H, pixelsPerMeter, eroded);
  const heights = grid.heights;
  const land = buildRelief(grid);
  const hachures = traceHachures(grid, land, 1.7);
  const contours = traceContours(grid, land);

  // The long thin walls along x = -60, x = 60 and z = 112 read as ruled lines on a map, so here they're shown in broken stretches.
  console.log('painting');
  const cut = new Float32Array(W * H);
  const wallGap = (along, seed) => smooth(0.47, 0.5, fbm(along * 0.075 + seed, seed * 3.1, 2) + 0.03);
  for (let y = 0; y < H; y += 1) {
    const wz = worldZ(y);
    for (let x = 0; x < W; x += 1) {
      const wx = worldX(x);
      let gone = 0;
      if (Math.abs(wx + 60) < 3.4 && wz > -90 && wz < 116) gone = wallGap(wz, 13);
      if (Math.abs(wx - 60) < 3.4 && wz > -90 && wz < 116) gone = Math.max(gone, wallGap(wz, 41));
      if (Math.abs(wz - 112) < 3.4 && (wx < -56 || wx > 56)) gone = Math.max(gone, wallGap(wx, 29));
      cut[y * W + x] = gone;
    }
  }

  // Bare trees out in the open, mostly the graveyard's, look like a sheet of identical stamps from above. Some are left off, more and
  // more toward the west, and the rest go in as a faint, soft mass over a dark pool of ground.
  const graveTree = new Float32Array(W * H);
  const graveGone = new Float32Array(W * H);
  const pool = new Float32Array(W * H);
  const crown = new Float32Array(W * H);
  const crownLight = new Float32Array(W * H);
  const crownShadow = new Float32Array(W * H);
  const groundColor = [0, 0, 0];
  const stands = [];
  for (const batch of data.props) {
    if (!batch.node.startsWith('tree_')) continue;
    for (let i = 0; i + 3 < batch.items.length; i += 4) stands.push({ wx: batch.items[i], wz: batch.items[i + 1], scale: batch.items[i + 3] });
  }
  // The forest's edge wanders with the ground under it, so a few painted trees spill past the real ones.
  for (let gx = 24; gx < 244; gx += 7) {
    for (let gz = -118; gz < 136; gz += 7) {
      if (gx > 60 && gz > -92 && gz < 112) continue;
      const wx = gx + hash(gx, gz) * 7;
      const wz = gz + hash(gz, gx + 3) * 7;
      if (hash(gx * 3, gz * 5) < groundAt(wx, wz, groundColor) * 0.9) stands.push({ wx, wz, scale: 0.8 + hash(gx, gz + 9) * 0.5 });
    }
  }
  let graveyardTrees = 0;
  for (const { wx, wz, scale } of stands) {
    const seed = hash(wx * 37, wz * 91);
    const cx = toPixelX(wx);
    const cy = toPixelY(wz);
    const forestHere = groundAt(wx, wz, groundColor);
    if (wx < -58 || (wz > 118 && forestHere < 0.2)) {
      graveyardTrees += 1;
      const thin = smooth(-112, -168, wx + (noise(wz * 0.05, 7) - 0.5) * 40) * 0.72;
      const hidden = seed < thin;
      const reach = Math.ceil(6.5 * pixelsPerMeter);
      for (let y = Math.max(0, Math.floor(cy) - reach); y <= Math.min(H - 1, Math.ceil(cy) + reach); y += 1) {
        for (let x = Math.max(0, Math.floor(cx) - reach); x <= Math.min(W - 1, Math.ceil(cx) + reach); x += 1) {
          if (Math.hypot(x - cx, y - cy) > reach) continue;
          if (hidden) graveGone[y * W + x] = 1;
          else graveTree[y * W + x] = 1;
        }
      }
      stamp(pool, cx, cy, (11 + seed * 7) * pixelsPerMeter, hidden ? 0.14 : 0.3, false);
      continue;
    }
    // A real tree that the wandering edge has left out in the open still stands, but without a painted crown.
    if (forestHere < 0.2 && wx > 58 && wz > -94 && wz < 114) continue;
    const inForest = forestHere > 0.2;
    const meters = (inForest ? 4.4 + seed * 2.2 : 2.6 + seed * 1.2) * Math.max(0.8, Math.min(1.5, scale));
    const radius = meters * pixelsPerMeter;
    stamp(crownShadow, cx + radius * 0.7, cy + radius * 0.7, radius * 1.15, inForest ? 0.5 : 0.16, true);
    const reach = Math.ceil(radius * 1.25);
    for (let y = Math.max(0, Math.floor(cy) - reach); y <= Math.min(H - 1, Math.ceil(cy) + reach); y += 1) {
      for (let x = Math.max(0, Math.floor(cx) - reach); x <= Math.min(W - 1, Math.ceil(cx) + reach); x += 1) {
        const dx = (x - cx) / radius;
        const dy = (y - cy) / radius;
        const lobes = (noise(x * 0.11 + seed * 90, y * 0.11) - 0.5) * 0.55;
        const shape = 1 - smooth(0.55, 1.05, Math.hypot(dx, dy) + lobes);
        if (shape <= 0) continue;
        const at = y * W + x;
        const amount = shape * (inForest ? 1 : 0.5);
        if (amount > crown[at]) {
          crown[at] = amount;
          // Rounded like a ball lit from the northwest.
          crownLight[at] = 0.5 + (-dx * SUN[0] - dy * SUN[2]) * -0.62 + (noise(x * 0.31, y * 0.31) - 0.5) * 0.5;
        }
      }
    }
  }
  console.log(`  ${stands.length} trees, ${graveyardTrees} standing alone`);
  // The empty land west of the graveyard's trees gets a few dark drifts, so that the wood fades out rather than stopping.
  for (let gx = -240; gx < -150; gx += 13) {
    for (let gz = -90; gz < 112; gz += 13) {
      if (fbm(gx * 0.03 + 4, gz * 0.03, 2) > 0.39) stamp(pool, toPixelX(gx + hash(gx, gz) * 13), toPixelY(gz + hash(gz, gx) * 13), (9 + hash(gz, gx + 5) * 8) * pixelsPerMeter, 0.16, false);
    }
  }
  const treeAlpha = new Float32Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const keep = (1 - cut[i]) * (1 - graveGone[i]);
    built[i] *= keep;
    const standing = props[i] * keep;
    treeAlpha[i] = standing * graveTree[i] * (1 - built[i]);
    props[i] = Math.max(built[i], standing * (1 - graveTree[i]));
  }
  const treeSoft = blur(treeAlpha, W, H, 2.5);
  const poolSoft = blur(pool, W, H, 3 * pixelsPerMeter);

  // Shadows on their own, softened and put back faint: at full strength the castle's towers paint stripes across the map.
  const cutWide = blur(cut, W, H, 5);
  const shadowRaw = new Float32Array(W * H);
  for (let i = 0; i < shadowRaw.length; i += 1) {
    const a = lit[i * 3] * 0.3 + lit[i * 3 + 1] * 0.59 + lit[i * 3 + 2] * 0.11;
    const b = plain[i * 3] * 0.3 + plain[i * 3 + 1] * 0.59 + plain[i * 3 + 2] * 0.11;
    shadowRaw[i] = mix(Math.min(1, (a + 0.012) / (b + 0.012)), 1, Math.max(Math.min(1, cutWide[i] * 2.5), graveGone[i], graveTree[i]));
  }
  const shadows = blur(shadowRaw, W, H, 3);
  const painted = kuwahara(plain, W, H, 1);

  const crownShadowSoft = blur(crownShadow, W, H, 3);
  const nearProps = blur(props, W, H, 4);
  const builtEdge = blur(built, W, H, 1.4);
  const builtNear = blur(built, W, H, 9);

  // Contours keep clear of the graces and the spawn, where the map's own marks go.
  const clearing = new Float32Array(W * H);
  for (const mark of [...data.graces, data.spawn]) stamp(clearing, toPixelX(mark.x), toPixelY(mark.z), 20 * pixelsPerMeter, 1, true);

  // Auto levels: the render's own brightness range mapped onto the ramp, ignoring the darkest and brightest few percent of what stands on the land.
  const histogram = new Uint32Array(256);
  let counted = 0;
  for (let i = 0; i < W * H; i += 2) {
    if (props[i] < 0.5) continue;
    histogram[Math.min(255, Math.floor((painted[i * 3] * 0.3 + painted[i * 3 + 1] * 0.59 + painted[i * 3 + 2] * 0.11) * 255))] += 1;
    counted += 1;
  }
  const percentile = (share) => {
    let seen = 0;
    for (let i = 0; i < 256; i += 1) {
      seen += histogram[i];
      if (seen >= counted * share) return i / 255;
    }
    return 1;
  };
  const blackPoint = percentile(0.02);
  const whitePoint = percentile(0.985);

  const out = Buffer.alloc(W * H * 3);
  // Paper's tooth: random speckle, softened a little, so that it isn't one-pixel static.
  const speckle = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) speckle[y * W + x] = hash(x + 5000, y + 9000) - 0.5;
  const grain = blur(speckle, W, H, 1);
  const tone = [0, 0, 0];
  const rock = [0, 0, 0];

  for (let y = 0; y < H; y += 1) {
    const wz = worldZ(y);
    for (let x = 0; x < W; x += 1) {
      const at = y * W + x;
      const wx = worldX(x);
      const height = heights[at];
      const mountain = land.mountain[at];

      groundAt(wx, wz, groundColor);
      let r = groundColor[0];
      let g = groundColor[1];
      let b = groundColor[2];

      // Whatever stands on the land keeps its render, graded onto the map's own ramp.
      const standing = Math.min(1, props[at] * 1.3);
      if (standing > 0) {
        const r0 = painted[at * 3];
        const g0 = painted[at * 3 + 1];
        const b0 = painted[at * 3 + 2];
        const luma = r0 * 0.3 + g0 * 0.59 + b0 * 0.11;
        const level = Math.min(1, Math.max(0, (luma - blackPoint) / (whitePoint - blackPoint)));
        ramp(LAND_RAMP, 0.06 + 0.86 * level ** 0.86, tone);
        const scale = (0.08 + tone[0] * 0.3 + tone[1] * 0.59 + tone[2] * 0.11) / (luma + 0.08);
        r = mix(r, mix(tone[0], r0 * scale, 0.14), standing);
        g = mix(g, mix(tone[1], g0 * scale, 0.14), standing);
        b = mix(b, mix(tone[2], b0 * scale, 0.14), standing);
      }

      // The graveyard's wood: dark ground pooled under it, and the trees themselves only faintly.
      const pooled = Math.min(1, poolSoft[at]) * 0.42;
      if (pooled > 0) {
        r *= 1 - pooled;
        g *= 1 - pooled;
        b *= 1 - pooled * 0.9;
      }
      const tree = Math.min(1, treeSoft[at] * 1.5) * 0.45;
      if (tree > 0) {
        r = mix(r, 0.13, tree);
        g = mix(g, 0.1, tree);
        b = mix(b, 0.075, tree);
      }

      // Forest mass: painted crowns under the rendered branches.
      const c = crown[at] * (1 - mountain * 0.85);
      if (c > 0) {
        const l = Math.min(1, Math.max(0, crownLight[at]));
        const amount = c * mix(0.92, 0.55, props[at]);
        r = mix(r, mix(0.098, 0.25, l), amount);
        g = mix(g, mix(0.095, 0.225, l), amount);
        b = mix(b, mix(0.066, 0.14, l), amount);
      }

      // Mountains are painted from the height alone. The render's rocks stop dead at the walkable edge, in long
      // straight lines, so only the castle and tree crowns stay on top.
      if (mountain > 0) {
        rockAt(wx, wz, height, rock);
        const keep = mountain * (1 - built[at]) * (1 - c * 0.9);
        r = mix(r, rock[0], keep);
        g = mix(g, rock[1], keep);
        b = mix(b, rock[2], keep);
      }

      // The road and trails stay pale and easy to find, with a hand-inked edge.
      const nearRoad = wx > -26 && wx < 26;
      const edgeNoise = (noise(wx * 0.5, wz * 0.5) - 0.5) * 0.9;
      const roadDistance = nearRoad ? distanceTo(road, wx, wz) + edgeNoise : 99;
      let trailDistance = 99;
      if (wx > -24 && wz > -30 && wz < 130) for (const trail of trails) trailDistance = Math.min(trailDistance, distanceTo(trail, wx, wz) + edgeNoise);
      const roadPale = 1 - smooth(1.5, 2.5, roadDistance);
      const roadInk = (1 - smooth(2.3, 3.3, roadDistance)) * (1 - roadPale);
      const trailPale = 1 - smooth(0.7, 1.5, trailDistance);
      const paleAmount = Math.max(roadPale * 0.86, trailPale * 0.52);
      const inkAmount = roadInk * 0.3;
      if (paleAmount > 0 || inkAmount > 0) {
        r = mix(mix(r, 0.78, paleAmount), INK[0], inkAmount);
        g = mix(mix(g, 0.68, paleAmount), INK[1], inkAmount);
        b = mix(mix(b, 0.5, paleAmount), INK[2], inkAmount);
      }

      const relief = land.relief[at];
      r *= relief;
      g *= relief * mix(1, 0.97, 1 - Math.min(1, relief));
      b *= relief * mix(1, 0.9, 1 - Math.min(1, relief));

      // Cast shadows, and the faint dark that gathers around everything standing on the ground.
      const shadow = Math.min(mix(1, shadows[at], 0.42 + 0.58 * (1 - Math.min(1, builtNear[at] * 1.5))), 1 - crownShadowSoft[at] * (1 - c));
      const shadowed = 1 - (1 - shadow) * 0.72;
      r *= shadowed * mix(0.9, 1, shadow) * (1 - nearProps[at] * 0.08);
      g *= shadowed * mix(0.87, 1, shadow) * (1 - nearProps[at] * 0.08);
      b *= shadowed * mix(0.78, 1, shadow) * (1 - nearProps[at] * 0.08);

      // A faint dark line just outside the castle and ruins, so they read like drawn plans without a halo.
      const outline = Math.min(1, Math.max(0, builtEdge[at] - built[at]) * 3.6);
      if (outline > 0) {
        r = mix(r, INK[0], outline * 0.4);
        g = mix(g, INK[1], outline * 0.4);
        b = mix(b, INK[2], outline * 0.4);
      }
      if (built[at] > 0) {
        const lift = 1 + built[at] * 0.12;
        r *= lift;
        g *= lift;
        b *= lift * 0.97;
      }

      // Hachures on the steep faces, then contours, kept off everything the land is carrying.
      const clear = (1 - Math.min(1, nearProps[at] * 1.5)) * (1 - c * 0.8) * (1 - Math.max(roadPale, roadInk, trailPale * 0.7)) * (1 - Math.min(1, builtNear[at] * 1.5)) * (1 - clearing[at]);
      const hachure = Math.min(1, hachures[at] * 0.9) * 0.36 * (1 - built[at]);
      if (hachure > 0) {
        r = mix(r, INK[0], hachure);
        g = mix(g, INK[1], hachure);
        b = mix(b, INK[2], hachure);
      }
      const line = (Math.min(1, contours.thin[at] * 1.3) * 0.14 + Math.min(1, contours.index[at] * 1.3) * 0.3) * clear;
      if (line > 0) {
        r = mix(r, UMBER[0], line);
        g = mix(g, UMBER[1], line);
        b = mix(b, UMBER[2], line);
      }

      // Old paper: fine grain and slow blotches. The burn at the edges is now drawn on screen, around the whole view.
      const fine = (hash(x, y) - 0.5) * 0.7 + grain[at] * 9;
      const blotch = fbm(x * 0.006, y * 0.006, 3) - 0.45;
      const paper = 1 + fine * 0.05 + blotch * 0.14;
      const o = at * 3;
      out[o] = Math.round(Math.min(1, Math.max(0, r * paper)) * 255);
      out[o + 1] = Math.round(Math.min(1, Math.max(0, g * paper)) * 255);
      out[o + 2] = Math.round(Math.min(1, Math.max(0, b * paper * 0.98)) * 255);
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const info = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 88, effort: 6, smartSubsample: true }).toFile(OUT);
  console.log(`wrote ${OUT}: ${info.width}x${info.height}, ${(info.size / 1048576).toFixed(2)} MB`);
  await paintSurround(data, eroded);
}

/**
 * The same mountains carried on past the map, in the map's own paint but dimmer, and fading out into the frame.
 * Dimmed about as much as unexplored land, because almost every new player's sheet ends in the unexplored veil.
 */
async function paintSurround(data, eroded) {
  const { minX, maxX, minZ, maxZ } = data.bounds;
  const area = SURROUND;
  const ppm = area.pixelsPerMeter;
  const width = (area.maxX - area.minX) * ppm;
  const height = (area.maxZ - area.minZ) * ppm;
  const grid = heightGrid(area, width, height, ppm, eroded);
  const land = buildRelief(grid);
  const hachures = traceHachures(grid, land, 2.6);
  const contours = traceContours(grid, land);
  const out = Buffer.alloc(width * height * 4);
  const ground = [0, 0, 0];
  const rock = [0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    const wz = area.minZ + (y + 0.5) / ppm;
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const wx = area.minX + (x + 0.5) / ppm;
      const o = at * 4;
      // Under the middle of the sheet nothing shows, and empty pixels cost next to nothing to store.
      if (wx > minX + 40 && wx < maxX - 40 && wz > minZ + 40 && wz < maxZ - 40) continue;
      groundAt(wx, wz, ground);
      rockAt(wx, wz, grid.heights[at], rock);
      const m = land.mountain[at];
      let r = mix(ground[0], rock[0], m) * land.relief[at];
      let g = mix(ground[1], rock[1], m) * land.relief[at];
      let b = mix(ground[2], rock[2], m) * land.relief[at];
      const hachure = Math.min(1, hachures[at] * 1.3) * 0.2;
      const line = Math.min(1, contours.index[at] * 1.3) * 0.22;
      r = mix(mix(r, INK[0], hachure), UMBER[0], line);
      g = mix(mix(g, INK[1], hachure), UMBER[1], line);
      b = mix(mix(b, INK[2], hachure), UMBER[2], line);
      const luma = r * 0.3 + g * 0.59 + b * 0.11;
      const dim = 0.66;
      out[o] = Math.round(Math.min(1, mix(luma, r, 0.75) * dim) * 255);
      out[o + 1] = Math.round(Math.min(1, mix(luma, g, 0.75) * dim) * 255);
      out[o + 2] = Math.round(Math.min(1, mix(luma, b, 0.75) * dim) * 255);
      const fade = Math.min(smooth(0, 80, wx - area.minX), smooth(0, 80, area.maxX - wx), smooth(0, 60, wz - area.minZ), smooth(0, 60, area.maxZ - wz));
      out[o + 3] = Math.round(fade * 255);
    }
  }
  const path = join(dirname(OUT), 'surround.webp');
  const info = await sharp(out, { raw: { width, height, channels: 4 } }).webp({ quality: 72, alphaQuality: 70, effort: 6 }).toFile(path);
  console.log(`wrote ${path}: ${info.width}x${info.height}, ${(info.size / 1048576).toFixed(2)} MB`);
}


/** Each grace has a bonfire model standing on it. Its pixels should center where the map data says the grace is. */
function reportAlignment(mask, data) {
  const { minX, maxX, minZ, maxZ } = data.bounds;
  for (const grace of data.graces) {
    const px = ((grace.x - minX) / (maxX - minX)) * W;
    const py = ((grace.z - minZ) / (maxZ - minZ)) * H;
    let total = 0;
    let sx = 0;
    let sy = 0;
    for (let y = Math.max(0, Math.round(py - 40)); y < Math.min(H, py + 40); y += 1) {
      for (let x = Math.max(0, Math.round(px - 40)); x < Math.min(W, px + 40); x += 1) {
        const value = mask[y * W + x];
        total += value;
        sx += (x + 0.5) * value;
        sy += (y + 0.5) * value;
      }
    }
    const offset = total > 0 ? `${(sx / total - px).toFixed(1)}, ${(sy / total - py).toFixed(1)} px` : 'no bonfire found';
    console.log(`  ${grace.name}: map point (${px.toFixed(0)}, ${py.toFixed(0)}), bonfire offset ${offset}`);
  }
}

if (!REUSE || !existsSync(join(CACHE, 'data.json'))) await render();
await paint();
