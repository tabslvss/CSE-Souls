import { useEffect, useRef } from 'react';
import { artUrl } from '../art';
import {
  CITADEL_WINDOWS,
  citadelPath,
  css,
  ditherTo15Bit,
  drawDeadTree,
  fillGraveCross,
  fillSeatedKnight,
  fillSky,
  makeFogTexture,
  mixRgb,
  ridgePath,
  seededRandom,
  type Rgb,
} from './psx';
import { skyAt, worldPhase } from './worldClock';

const WIDTH = 480;
const HEIGHT = 270;
const FRAME_MS = 1000 / 24;
const BACKGROUND_REFRESH_MS = 400;

const CITADEL = { x: 318, base: 182, scale: 0.86 };
const FIRE = { x: 132, y: 213 };
const LIGHT = { x: 320, y: 92 };
const RAY_COUNT = 11;

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  big: boolean;
  ember: boolean;
}

const BLACK: Rgb = [0, 0, 0];

/** The great golden light behind the citadel: a soft halo with slow-turning rays. */
function drawGoldenLight(target: CanvasRenderingContext2D, strength: number, time: number): void {
  target.save();
  target.globalCompositeOperation = 'lighter';

  const halo = target.createRadialGradient(LIGHT.x, LIGHT.y, 4, LIGHT.x, LIGHT.y, 190);
  halo.addColorStop(0, css([255, 232, 176], 0.62 * strength));
  halo.addColorStop(0.3, css([236, 182, 96], 0.3 * strength));
  halo.addColorStop(1, css([120, 80, 30], 0));
  target.fillStyle = halo;
  target.fillRect(0, 0, WIDTH, HEIGHT);

  for (let i = 0; i < RAY_COUNT; i += 1) {
    const angle =
      -Math.PI / 2 + (i - (RAY_COUNT - 1) / 2) * 0.46 + Math.sin(time * 0.00007 + i * 1.7) * 0.06;
    const width = 0.05 + ((i * 7) % 3) * 0.028;
    const length = 330;
    const endX = LIGHT.x + Math.cos(angle) * length;
    const endY = LIGHT.y + Math.sin(angle) * length;
    const beam = target.createLinearGradient(LIGHT.x, LIGHT.y, endX, endY);
    beam.addColorStop(0, css([255, 226, 160], 0.2 * strength));
    beam.addColorStop(1, css([255, 216, 140], 0));
    target.fillStyle = beam;
    target.beginPath();
    target.moveTo(LIGHT.x, LIGHT.y);
    target.lineTo(LIGHT.x + Math.cos(angle - width) * length, LIGHT.y + Math.sin(angle - width) * length);
    target.lineTo(LIGHT.x + Math.cos(angle + width) * length, LIGHT.y + Math.sin(angle + width) * length);
    target.closePath();
    target.fill();
  }
  target.restore();
}

/**
 * The live backdrop: a placeholder landscape at 480x270 in PS1-style dithered color, with
 * gold dust, fog and a day/night cycle. If the named art file exists, the painting shows
 * sharp underneath and this canvas only adds the moving fog and dust on top of it.
 */
export function HeroScene({
  className,
  intensity = 1,
  artName = 'hero-citadel',
}: {
  className?: string;
  intensity?: number;
  artName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = artUrl(artName);
  const isOverlay = !!painting;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const background = document.createElement('canvas');
    background.width = WIDTH;
    background.height = HEIGHT;
    const bg = background.getContext('2d')!;
    bg.imageSmoothingEnabled = false;

    const farRidge = ridgePath(WIDTH, HEIGHT, 158, 14, 7);
    const midRidge = ridgePath(WIDTH, HEIGHT, 192, 9, 23);
    const citadel = citadelPath(CITADEL.x, CITADEL.base, CITADEL.scale, 11);
    const nearGround = ridgePath(WIDTH, HEIGHT, 217, 6, 41);

    const fogTexture = makeFogTexture(256, 72, 5);
    const fogTint = document.createElement('canvas');
    fogTint.width = fogTexture.width;
    fogTint.height = fogTexture.height;
    const fogTintCtx = fogTint.getContext('2d')!;

    const random = seededRandom(1312);
    const motes: Mote[] = [];
    let look = skyAt(worldPhase());

    function paintForeground(target: CanvasRenderingContext2D, ink: Rgb): void {
      target.fillStyle = css(ink);
      target.strokeStyle = css(ink);
      target.fill(nearGround);
      drawDeadTree(target, 44, 219, 74, 3);
      drawDeadTree(target, 438, 224, 92, 9);
      drawDeadTree(target, 76, 221, 34, 17);
      fillGraveCross(target, 196, 223, 13, -0.14);
      fillGraveCross(target, 216, 228, 11, 0.2);
      fillGraveCross(target, 388, 231, 15, 0.1);
      fillGraveCross(target, 244, 231, 9, -0.3);
      fillSeatedKnight(target, FIRE.x - 30, FIRE.y + 3, 1.5);
    }

    function paintBackground(time: number): void {
      const phase = worldPhase();
      look = skyAt(phase);

      if (!isOverlay) {
        fillSky(bg, WIDTH, HEIGHT * 0.72, look.sky);
        bg.fillStyle = css(look.sky[3]);
        bg.fillRect(0, HEIGHT * 0.72, WIDTH, HEIGHT * 0.28);

        // A dim moon crosses the sky at night only. The golden light rules the rest.
        if (phase >= 0.62 && phase < 0.98) {
          const progress = (phase - 0.62) / 0.36;
          const moonX = 60 + progress * 170;
          const moonY = 92 - Math.sin(progress * Math.PI) * 62;
          bg.fillStyle = css(mixRgb([206, 206, 214], look.sky[1], 0.4));
          bg.beginPath();
          bg.arc(moonX, moonY, 7, 0, Math.PI * 2);
          bg.fill();
        }

        drawGoldenLight(bg, look.gold * intensity, time);

        // Thin bars of dark cloud, in front of the light.
        const clouds = seededRandom(77);
        bg.fillStyle = css(mixRgb(look.sky[0], BLACK, 0.2), 0.42);
        for (let i = 0; i < 14; i += 1) {
          const y = 18 + clouds() * 100;
          const x = ((clouds() * 620 + phase * 2400 * (1 + i * 0.1)) % 620) - 120;
          bg.fillRect(x, y, 34 + clouds() * 110, 1 + clouds() * 2);
        }

        bg.fillStyle = css(look.far);
        bg.fill(farRidge);
        bg.fillStyle = css(mixRgb(look.far, BLACK, 0.5));
        bg.fill(midRidge);
        bg.fillStyle = css(mixRgb(look.far, BLACK, 0.8));
        bg.fill(citadel);

        paintForeground(bg, mixRgb(look.far, BLACK, 0.92));
      }

      fogTintCtx.globalCompositeOperation = 'source-over';
      fogTintCtx.clearRect(0, 0, fogTint.width, fogTint.height);
      fogTintCtx.drawImage(fogTexture, 0, 0);
      fogTintCtx.globalCompositeOperation = 'source-in';
      fogTintCtx.fillStyle = css(look.fog);
      fogTintCtx.fillRect(0, 0, fogTint.width, fogTint.height);
    }

    function drawFogBand(y: number, speed: number, alpha: number, time: number): void {
      const offset = (time * speed) % fogTint.width;
      ctx!.globalAlpha = alpha;
      for (let x = -offset; x < WIDTH; x += fogTint.width) {
        ctx!.drawImage(fogTint, x, y);
      }
      ctx!.globalAlpha = 1;
    }

    function drawCampfire(time: number): void {
      const flick = Math.sin(time * 0.013) * 0.5 + Math.sin(time * 0.031) * 0.3;
      const radius = 66 + flick * 7;
      ctx!.globalCompositeOperation = 'lighter';
      const glow = ctx!.createRadialGradient(FIRE.x, FIRE.y - 5, 1, FIRE.x, FIRE.y - 5, radius);
      const strength = 0.62 + look.darkness * 0.38;
      glow.addColorStop(0, css([255, 170, 84], strength));
      glow.addColorStop(0.35, css([210, 100, 36], strength * 0.45));
      glow.addColorStop(1, css([120, 40, 10], 0));
      ctx!.fillStyle = glow;
      ctx!.fillRect(FIRE.x - radius, FIRE.y - 5 - radius, radius * 2, radius * 2);
      ctx!.globalCompositeOperation = 'source-over';

      // Three hard-edged tongues of flame, jittering every frame like a sprite.
      const flame = (w: number, h: number, color: string, jitter: number) => {
        const top = FIRE.y - h - Math.abs(Math.sin(time * 0.02 + jitter)) * 3;
        ctx!.fillStyle = color;
        ctx!.beginPath();
        ctx!.moveTo(FIRE.x - w, FIRE.y + 1);
        ctx!.lineTo(FIRE.x - w * 0.5 + Math.sin(time * 0.017 + jitter) * 1.5, FIRE.y - h * 0.5);
        ctx!.lineTo(FIRE.x + Math.sin(time * 0.023 + jitter) * 2, top);
        ctx!.lineTo(FIRE.x + w * 0.55, FIRE.y - h * 0.45);
        ctx!.lineTo(FIRE.x + w, FIRE.y + 1);
        ctx!.closePath();
        ctx!.fill();
      };
      flame(10, 21, '#c9501c', 0);
      flame(7, 15, '#f09a2e', 1.7);
      flame(3.5, 8, '#ffe08c', 3.1);
    }

    function drawMotes(): void {
      while (motes.length < 70 * intensity) {
        const ember = random() < 0.2;
        motes.push({
          x: ember ? FIRE.x + (random() - 0.5) * 12 : random() * WIDTH,
          y: ember ? FIRE.y - 6 : random() * HEIGHT,
          vx: 0.04 + random() * 0.16,
          vy: -(0.06 + random() * (ember ? 0.5 : 0.18)),
          life: 0,
          max: 120 + random() * 280,
          big: random() < 0.12,
          ember,
        });
      }
      for (let i = motes.length - 1; i >= 0; i -= 1) {
        const mote = motes[i];
        mote.life += 1;
        mote.x += mote.vx + Math.sin(mote.life * 0.04 + i) * 0.16;
        mote.y += mote.vy;
        const progress = mote.life / mote.max;
        if (progress >= 1) {
          motes.splice(i, 1);
          continue;
        }
        // Fades in and back out, so dust never pops into view.
        const alpha = Math.sin(progress * Math.PI);
        const color: Rgb = mote.ember ? [255, 150, 70] : [255, 226, 160];
        ctx!.fillStyle = css(color, alpha);
        ctx!.fillRect(mote.x | 0, mote.y | 0, mote.big ? 2 : 1, mote.big ? 2 : 1);
      }
    }

    function drawFrame(time: number): void {
      if (isOverlay) {
        ctx!.clearRect(0, 0, WIDTH, HEIGHT);
        drawFogBand(170, 0.0054, 0.2 * intensity, time);
        drawMotes();
        return;
      }

      ctx!.drawImage(background, 0, 0);

      // The citadel's few lit windows gutter slowly.
      for (let i = 0; i < CITADEL_WINDOWS.length; i += 1) {
        const [wx, wy] = CITADEL_WINDOWS[i];
        const flicker = 0.55 + Math.sin(time * 0.0031 + i * 2.4) * 0.3;
        ctx!.fillStyle = css([255, 214, 140], flicker * (0.35 + look.darkness * 0.65));
        ctx!.fillRect(CITADEL.x + wx * CITADEL.scale, CITADEL.base + wy * CITADEL.scale, 1.5, 2.5);
      }

      drawFogBand(136, 0.0034, 0.3 * intensity, time);
      drawCampfire(time);
      drawFogBand(190, 0.0072, 0.22 * intensity, time);
      drawMotes();

      const frame = ctx!.getImageData(0, 0, WIDTH, HEIGHT);
      ditherTo15Bit(frame);
      ctx!.putImageData(frame, 0, 0);
    }

    paintBackground(performance.now());

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawFrame(8000);
      return;
    }

    let frameId = 0;
    let lastFrame = 0;
    let lastBackground = performance.now();
    const loop = (time: number) => {
      frameId = requestAnimationFrame(loop);
      if (time - lastFrame < FRAME_MS) return;
      lastFrame = time;
      if (time - lastBackground > BACKGROUND_REFRESH_MS) {
        paintBackground(time);
        lastBackground = time;
      }
      drawFrame(time);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [intensity, isOverlay]);

  return (
    <>
      {painting && <img className={className} src={painting} alt="" data-painting="true" />}
      <canvas
        ref={canvasRef}
        className={className}
        data-overlay={isOverlay}
        width={WIDTH}
        height={HEIGHT}
        aria-hidden="true"
      />
    </>
  );
}
