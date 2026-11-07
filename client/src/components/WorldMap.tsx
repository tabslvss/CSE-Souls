import { useEffect, useRef } from 'react';
import { MAP } from '../../../shared/mapData';
import type { MapView } from '../game/GameClient';

const PICK_PIXELS = 18;
const OTHER_PLAYERS_NAMED = 12;
/** Colors that match the site's gold style. A canvas can't read them from the stylesheet cheaply every frame. */
const GOLD = '#ecd59b';
const GOLD_PALE = '#f6ecd2';
const ZONE_COLORS = ['rgba(201, 164, 92, 0.1)', 'rgba(125, 95, 43, 0.16)'];

const { minX, maxX, minZ, maxZ } = MAP.bounds;

interface Fit {
  scale: number;
  left: number;
  top: number;
}

function fitTo(width: number, height: number): Fit {
  const scale = Math.min(width / (maxX - minX), height / (maxZ - minZ));
  return { scale, left: (width - (maxX - minX) * scale) / 2, top: (height - (maxZ - minZ) * scale) / 2 };
}

// The start of the map is at the bottom and the citadel at the top, so walking forward from the start goes up the page.
function toX(fit: Fit, x: number): number {
  return fit.left + (x - minX) * fit.scale;
}

function toY(fit: Fit, z: number): number {
  return fit.top + (z - minZ) * fit.scale;
}

function drawLine(context: CanvasRenderingContext2D, fit: Fit, points: readonly number[]): void {
  context.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (i === 0) context.moveTo(toX(fit, points[i]), toY(fit, points[i + 1]));
    else context.lineTo(toX(fit, points[i]), toY(fit, points[i + 1]));
  }
  context.stroke();
}

/** The parts that never change, drawn once and copied into every picture. */
function drawLand(target: HTMLCanvasElement, fit: Fit): void {
  const context = target.getContext('2d');
  if (!context) return;
  context.fillStyle = '#0d0b08';
  context.fillRect(0, 0, target.width, target.height);

  MAP.zones.forEach((zone, index) => {
    const x = toX(fit, zone.minX);
    const y = toY(fit, zone.minZ);
    const width = (zone.maxX - zone.minX) * fit.scale;
    const height = (zone.maxZ - zone.minZ) * fit.scale;
    context.fillStyle = ZONE_COLORS[index % ZONE_COLORS.length];
    context.fillRect(x, y, width, height);
    context.strokeStyle = 'rgba(201, 164, 92, 0.24)';
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  });

  context.fillStyle = 'rgba(189, 180, 160, 0.2)';
  for (const collider of MAP.colliders) {
    const radius = collider.t === 'c' ? collider.r : Math.max(collider.hw, collider.hd);
    const size = Math.max(1, radius * fit.scale * 1.4);
    context.fillRect(toX(fit, collider.x) - size / 2, toY(fit, collider.z) - size / 2, size, size);
  }

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(189, 180, 160, 0.3)';
  context.lineWidth = Math.max(1, fit.scale * 1.5);
  for (const trail of MAP.trails ?? []) drawLine(context, fit, trail);
  context.strokeStyle = 'rgba(236, 213, 155, 0.55)';
  context.lineWidth = Math.max(1.5, fit.scale * 3);
  drawLine(context, fit, MAP.road);

  context.fillStyle = 'rgba(236, 213, 155, 0.65)';
  context.font = `${Math.max(11, Math.round(fit.scale * 5))}px Cinzel, Georgia, serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const zone of MAP.zones) {
    context.fillText(zone.name, toX(fit, (zone.minX + zone.maxX) / 2), toY(fit, (zone.minZ + zone.maxZ) / 2));
  }
}

/**
 * The world, drawn from the same map data the server plays on. Graces this save hasn't found are left off.
 * Text here is only drawn into a canvas with fillText, so a username can't be read as HTML.
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
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const land = document.createElement('canvas');
    let fit = fitTo(1, 1);
    let frame = 0;
    let hover: number | null = null;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      land.width = canvas.width;
      land.height = canvas.height;
      fit = fitTo(canvas.width, canvas.height);
      drawLand(land, fit);
    };

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      const ratio = window.devicePixelRatio || 1;
      const { view: read, lit: litNow, here: hereNow } = latest.current;
      context.drawImage(land, 0, 0);
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      context.font = `${Math.round(12 * ratio)}px Cinzel, Georgia, serif`;

      for (const grace of MAP.graces) {
        if (!litNow.includes(grace.id)) continue;
        const x = toX(fit, grace.x);
        const y = toY(fit, grace.z);
        const bright = grace.id === hereNow || grace.id === hover;
        const reach = (bright ? 20 : 14) * ratio * (1 + 0.08 * Math.sin(time / 500 + grace.id));
        const glow = context.createRadialGradient(x, y, 0, x, y, reach);
        glow.addColorStop(0, 'rgba(255, 196, 92, 0.85)');
        glow.addColorStop(1, 'rgba(255, 196, 92, 0)');
        context.fillStyle = glow;
        context.fillRect(x - reach, y - reach, reach * 2, reach * 2);
        const size = 4 * ratio;
        context.fillStyle = GOLD_PALE;
        context.beginPath();
        context.moveTo(x, y - size);
        context.lineTo(x + size, y);
        context.lineTo(x, y + size);
        context.lineTo(x - size, y);
        context.closePath();
        context.fill();
        context.fillStyle = bright ? GOLD_PALE : GOLD;
        context.fillText(grace.name, x, y - size - 3 * ratio);
      }

      const { me, others } = read();
      context.font = `${Math.round(11 * ratio)}px Georgia, serif`;
      others.forEach((other, index) => {
        const x = toX(fit, other.x);
        const y = toY(fit, other.z);
        context.fillStyle = '#9fc4e8';
        context.beginPath();
        context.arc(x, y, 3 * ratio, 0, Math.PI * 2);
        context.fill();
        if (index < OTHER_PLAYERS_NAMED) context.fillText(other.name, x, y - 5 * ratio);
      });

      if (me) {
        const x = toX(fit, me.x);
        const y = toY(fit, me.z);
        // Forward in the world is sin(yaw), cos(yaw), and the map's axes run the same way.
        const dx = Math.sin(me.yaw);
        const dy = Math.cos(me.yaw);
        const size = 8 * ratio;
        context.fillStyle = '#ffffff';
        context.strokeStyle = '#070605';
        context.lineWidth = 1.5 * ratio;
        context.beginPath();
        context.moveTo(x + dx * size, y + dy * size);
        context.lineTo(x - dy * size * 0.6 - dx * size * 0.6, y + dx * size * 0.6 - dy * size * 0.6);
        context.lineTo(x + dy * size * 0.6 - dx * size * 0.6, y - dx * size * 0.6 - dy * size * 0.6);
        context.closePath();
        context.stroke();
        context.fill();
      }
    };

    const graceAt = (event: MouseEvent): number | null => {
      const { onPick: pick, lit: litNow, here: hereNow } = latest.current;
      if (!pick) return null;
      const box = canvas.getBoundingClientRect();
      const ratio = canvas.width / Math.max(1, box.width);
      const x = (event.clientX - box.left) * ratio;
      const y = (event.clientY - box.top) * ratio;
      for (const grace of MAP.graces) {
        if (grace.id === hereNow || !litNow.includes(grace.id)) continue;
        if (Math.hypot(toX(fit, grace.x) - x, toY(fit, grace.z) - y) <= PICK_PIXELS * ratio) return grace.id;
      }
      return null;
    };
    const onMove = (event: MouseEvent) => {
      hover = graceAt(event);
      canvas.style.cursor = hover === null ? 'default' : 'pointer';
    };
    const onClick = (event: MouseEvent) => {
      const picked = graceAt(event);
      if (picked !== null) latest.current.onPick?.(picked);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
    };
  }, []);

  return <canvas ref={canvasRef} className="world-map" aria-label="Map of the world" />;
}

/** What the marks on the map mean. */
export function WorldMapLegend() {
  return (
    <ul className="world-map__legend">
      <li><span className="world-map__mark world-map__mark--me" /> You</li>
      <li><span className="world-map__mark world-map__mark--grace" /> Binary Grace you have found</li>
      <li><span className="world-map__mark world-map__mark--player" /> Other players</li>
    </ul>
  );
}
