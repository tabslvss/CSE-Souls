import { useEffect, useRef, useState } from 'react';
import { artUrl } from '../art';
import {
  citadelPath,
  css,
  ditherTo15Bit,
  drawDeadTree,
  fillGraveCross,
  fillSky,
  fillTombstone,
  makeFogTexture,
  ridgePath,
  seededRandom,
  type Rgb,
} from './psx';

export type VignetteKind = 'village' | 'forest' | 'graveyard' | 'citadel' | 'throne' | 'sovereign' | 'lost';

const W = 160;
const H = 240;

const BLACK = '#050404';

function fog(ctx: CanvasRenderingContext2D, y: number, color: Rgb, alpha: number, seed: number): void {
  const texture = makeFogTexture(W, 56, seed);
  const tint = texture.getContext('2d')!;
  tint.globalCompositeOperation = 'source-in';
  tint.fillStyle = css(color);
  tint.fillRect(0, 0, W, 56);
  ctx.globalAlpha = alpha;
  ctx.drawImage(texture, 0, y);
  ctx.globalAlpha = 1;
}

function glowAt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: Rgb, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(color, alpha));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function village(ctx: CanvasRenderingContext2D): void {
  fillSky(ctx, W, H, [[20, 16, 22], [66, 38, 34], [156, 88, 48], [80, 50, 40]]);
  glowAt(ctx, 118, 96, 60, [255, 180, 110], 0.4);
  fog(ctx, 92, [190, 140, 100], 0.4, 3);
  ctx.fillStyle = '#1b1313';
  ctx.fill(ridgePath(W, H, 150, 5, 2));
  const house = (x: number, y: number, w: number, h: number, ink: string, lit: boolean) => {
    ctx.fillStyle = ink;
    ctx.fillRect(x, y - h, w, h);
    ctx.beginPath();
    ctx.moveTo(x - 3, y - h);
    ctx.lineTo(x + w * 0.45, y - h - w * 0.62);
    ctx.lineTo(x + w + 3, y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = lit ? '#e8913a' : '#050404';
    ctx.fillRect(x + w * 0.2, y - h * 0.7, 3, 4);
    ctx.fillRect(x + w * 0.62, y - h * 0.5, 3, 3);
  };
  house(10, 176, 34, 24, '#120d0d', false);
  house(98, 170, 42, 30, '#120d0d', true);
  // Roof beams with the thatch burned away.
  ctx.strokeStyle = '#120d0d';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.moveTo(52 + i * 8, 150);
    ctx.lineTo(70, 128);
    ctx.stroke();
  }
  house(48, 182, 44, 28, '#0a0707', true);
  fog(ctx, 150, [150, 96, 70], 0.34, 8);
  ctx.fillStyle = BLACK;
  ctx.fill(ridgePath(W, H, 204, 4, 9));
  ctx.strokeStyle = BLACK;
  drawDeadTree(ctx, 144, 208, 56, 12);
  for (let x = 6; x < 90; x += 11) ctx.fillRect(x, 192 + Math.sin(x) * 2, 2, 14);
}

function forest(ctx: CanvasRenderingContext2D): void {
  fillSky(ctx, W, H, [[8, 16, 14], [24, 46, 36], [66, 92, 62], [20, 34, 28]]);
  const random = seededRandom(17);
  fog(ctx, 70, [130, 170, 120], 0.4, 4);
  for (const [ink, count, width] of [
    ['#1a2e26', 11, 4],
    ['#0e1d18', 8, 7],
    ['#060d0b', 5, 12],
  ] as const) {
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    for (let i = 0; i < count; i += 1) {
      const x = random() * W;
      const w = width + random() * width * 0.4;
      ctx.fillRect(x, 0, w, H);
      ctx.lineWidth = 1;
      for (let b = 0; b < 3; b += 1) {
        const by = 30 + random() * 120;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, by);
        ctx.lineTo(x + (random() - 0.5) * 60, by - 20 - random() * 22);
        ctx.stroke();
      }
    }
    fog(ctx, 96 + random() * 40, [120, 160, 110], 0.26, 20 + count);
  }
  ctx.fillStyle = BLACK;
  ctx.fill(ridgePath(W, H, 208, 5, 6));
  // Something is watching.
  ctx.fillStyle = '#e8362a';
  for (const [x, y] of [[50, 170], [57, 170], [108, 184], [114, 184]]) ctx.fillRect(x, y, 2, 1);
}

function graveyard(ctx: CanvasRenderingContext2D): void {
  fillSky(ctx, W, H, [[6, 10, 20], [14, 26, 44], [36, 58, 76], [20, 34, 44]]);
  glowAt(ctx, 104, 66, 56, [190, 214, 230], 0.42);
  ctx.fillStyle = '#d6e2ea';
  ctx.beginPath();
  ctx.arc(104, 66, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d1a24';
  ctx.fill(ridgePath(W, H, 150, 8, 3));
  ctx.strokeStyle = '#0d1a24';
  drawDeadTree(ctx, 30, 156, 78, 6);
  fog(ctx, 118, [110, 150, 170], 0.42, 5);
  ctx.fillStyle = '#0a141c';
  fillTombstone(ctx, 88, 172, 15);
  fillGraveCross(ctx, 118, 168, 15, 0.12);
  fillGraveCross(ctx, 52, 172, 13, -0.1);
  ctx.fill(ridgePath(W, H, 176, 3, 8));
  fog(ctx, 158, [90, 130, 150], 0.34, 9);
  ctx.fillStyle = BLACK;
  fillGraveCross(ctx, 34, 214, 34, -0.12);
  fillTombstone(ctx, 116, 216, 34);
  fillGraveCross(ctx, 76, 208, 18, 0.22);
  ctx.fill(ridgePath(W, H, 210, 3, 11));
}

function citadelCard(ctx: CanvasRenderingContext2D): void {
  fillSky(ctx, W, H, [[18, 13, 10], [58, 40, 22], [170, 124, 58], [70, 50, 26]]);
  glowAt(ctx, 80, 126, 84, [255, 216, 140], 0.55);
  ctx.fillStyle = '#2a1e10';
  ctx.fill(ridgePath(W, H, 146, 10, 4));
  fog(ctx, 100, [220, 176, 104], 0.3, 7);
  ctx.fillStyle = '#0d0905';
  ctx.fill(citadelPath(80, 176, 0.92, 13));
  ctx.fillStyle = '#ffd98c';
  for (const [x, y] of [[78, 90], [82, 112], [62, 122], [100, 124], [78, 138]]) ctx.fillRect(x, y, 2, 3);
  fog(ctx, 160, [150, 110, 56], 0.4, 10);
  ctx.fillStyle = BLACK;
  ctx.fill(ridgePath(W, H, 212, 5, 14));
}

function throne(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#080506';
  ctx.fillRect(0, 0, W, H);
  // Two colonnades receding toward the throne.
  for (let i = 0; i < 4; i += 1) {
    const inset = 8 + i * 20;
    const shade = 34 - i * 7;
    ctx.fillStyle = css([shade + 8, shade, shade - 12]);
    ctx.fillRect(inset, 0, 8 - i, 196 - i * 18);
    ctx.fillRect(W - inset - (8 - i), 0, 8 - i, 196 - i * 18);
  }
  glowAt(ctx, 80, 92, 76, [255, 206, 120], 0.66);
  // Steps.
  for (let i = 0; i < 7; i += 1) {
    ctx.fillStyle = css([26 - i * 2, 16 - i, 14 - i]);
    ctx.fillRect(20 - i * 3, 150 + i * 13, 120 + i * 6, 13);
    ctx.fillStyle = css([92 - i * 8, 70 - i * 6, 34 - i * 2]);
    ctx.fillRect(20 - i * 3, 150 + i * 13, 120 + i * 6, 1);
  }
  // The throne, and the shape upon it.
  ctx.fillStyle = BLACK;
  ctx.beginPath();
  ctx.moveTo(52, 150);
  ctx.lineTo(52, 74);
  ctx.lineTo(62, 56);
  ctx.lineTo(70, 72);
  ctx.lineTo(80, 42);
  ctx.lineTo(90, 72);
  ctx.lineTo(98, 56);
  ctx.lineTo(108, 74);
  ctx.lineTo(108, 150);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffb25c';
  ctx.fillRect(77, 94, 2, 1);
  ctx.fillRect(82, 94, 2, 1);
  fog(ctx, 180, [190, 150, 80], 0.26, 12);
}

/** The boss itself: an armored giant, crowned and faceless, resting on a greatsword. */
function sovereign(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#080405';
  ctx.fillRect(0, 0, W, H);
  for (const x of [10, 138]) {
    ctx.fillStyle = '#1c1509';
    ctx.fillRect(x, 0, 12, H);
  }
  glowAt(ctx, 80, 110, 100, [255, 206, 120], 0.72);
  glowAt(ctx, 80, 226, 70, [255, 196, 110], 0.5);

  const shape = (points: Array<[number, number]>, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  const mirrored = (points: Array<[number, number]>, fill: string) => {
    shape(points, fill);
    shape(points.map(([x, y]) => [160 - x, y]), fill);
  };

  // Tattered cape, wider than the body, torn along the hem.
  shape(
    [[50, 66], [110, 66], [134, 150], [140, 216], [128, 206], [120, 226], [106, 210], [94, 228], [80, 214],
     [66, 228], [54, 210], [40, 226], [32, 206], [20, 216], [26, 150]],
    '#0c0607',
  );
  // Legs, then torso.
  mirrored([[62, 132], [78, 132], [76, 222], [58, 222]], '#050303');
  shape([[56, 62], [104, 62], [100, 134], [60, 134]], '#040202');
  // Arms come down and in, to the hilt.
  mirrored([[46, 74], [60, 72], [74, 110], [66, 118], [46, 92]], '#050303');
  // Huge spiked pauldrons.
  mirrored([[32, 76], [36, 58], [28, 44], [46, 52], [60, 56], [64, 70], [50, 84]], '#050303');
  // Faceless helm.
  shape([[69, 62], [68, 42], [92, 42], [91, 62], [85, 68], [75, 68]], '#030202');
  // The crown has grown into the helm.
  shape([[66, 44], [64, 26], [71, 36], [75, 20], [80, 33], [85, 20], [89, 36], [96, 26], [94, 44]], '#120a06');

  // Molten light in the seams of the armor.
  ctx.fillStyle = '#f4c56c';
  ctx.fillRect(72, 52, 16, 1);
  ctx.fillRect(79, 72, 2, 20);
  ctx.fillRect(66, 86, 28, 1);
  ctx.fillRect(62, 118, 36, 1);
  ctx.fillRect(66, 170, 8, 1);
  ctx.fillRect(86, 170, 8, 1);
  ctx.fillRect(40, 66, 14, 1);
  ctx.fillRect(106, 66, 14, 1);
  ctx.fillStyle = '#fff0c4';
  ctx.fillRect(76, 52, 8, 1);

  // The greatsword, point down, broken a third of the way up.
  shape([[75, 118], [85, 118], [85, 172], [82, 178], [78, 168], [75, 174]], '#2c2520');
  shape([[77, 186], [84, 184], [84, 226], [80, 234], [76, 226]], '#2c2520');
  ctx.fillStyle = '#4a4037';
  ctx.fillRect(75, 118, 1, 52);
  ctx.fillRect(77, 188, 1, 38);
  ctx.fillStyle = '#17110d';
  ctx.fillRect(60, 110, 40, 6);
  ctx.fillRect(76, 94, 8, 18);
  ctx.fillStyle = '#b59a65';
  ctx.fillRect(60, 110, 40, 1);
  ctx.fillRect(77, 90, 6, 4);

  fog(ctx, 190, [214, 170, 96], 0.42, 12);
}

function lost(ctx: CanvasRenderingContext2D): void {
  fillSky(ctx, W, H, [[10, 10, 12], [30, 28, 28], [60, 54, 50], [24, 22, 22]]);
  fog(ctx, 60, [150, 140, 130], 0.5, 2);
  ctx.fillStyle = '#100e0e';
  ctx.fill(ridgePath(W, H, 170, 6, 8));
  ctx.strokeStyle = '#100e0e';
  drawDeadTree(ctx, 118, 176, 90, 15);
  fog(ctx, 136, [120, 112, 104], 0.5, 6);
  ctx.fillStyle = BLACK;
  ctx.fill(ridgePath(W, H, 206, 4, 13));
  fillGraveCross(ctx, 58, 212, 26, 0.1);
}

const PAINTERS: Record<VignetteKind, (ctx: CanvasRenderingContext2D) => void> = {
  village,
  forest,
  graveyard,
  citadel: citadelCard,
  throne,
  sovereign,
  lost,
};

interface VignetteProps {
  kind: VignetteKind;
  /** Name of a painted image in src/art. Used if that file exists. */
  art?: string;
  className?: string;
}

/** A small painted-in-code PS1 picture, used as the card art until real art arrives. */
export function Vignette({ kind, art, className }: VignetteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [artLoaded, setArtLoaded] = useState(false);
  const artSource = art ? artUrl(art) : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    PAINTERS[kind](ctx);
    const image = ctx.getImageData(0, 0, W, H);
    ditherTo15Bit(image);
    ctx.putImageData(image, 0, 0);
  }, [kind]);

  return (
    <span className={`vignette ${className ?? ''}`}>
      <canvas ref={canvasRef} width={W} height={H} aria-hidden="true" />
      {artSource && (
        <img src={artSource} alt="" data-loaded={artLoaded} onLoad={() => setArtLoaded(true)} />
      )}
    </span>
  );
}
