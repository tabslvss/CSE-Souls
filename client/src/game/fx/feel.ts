import type { VhsControls } from '../psxRenderer';
import { sound, type FootSurface } from '../../sound';
import type { CameraFx } from './camera';
import { styleName, type GameFx, type HitMaterial, type Position, type StyleRef } from './effects';

/*
 * One call per game event, so every hit gets the same picture, sound, camera and tape together.
 * "mine" decides who feels it: anyone nearby sees the blood and hears the blow, but only the player
 * who landed or took it gets the freeze, the shake and the tape damage.
 */

export interface FeelParts {
  fx: GameFx;
  camera: CameraFx;
  vhs: VhsControls;
}

export interface LandedHit {
  /** Default: true for the heavy style. */
  heavy?: boolean;
  kill?: boolean;
  material?: HitMaterial;
  /** True when you are the attacker. */
  mine?: boolean;
}

/** A blow connecting. dirYaw is the attacker's yaw. */
export function landHit(parts: FeelParts, pos: Position, dirYaw: number, style: StyleRef, options: LandedHit = {}): void {
  const name = styleName(style);
  const heavy = options.heavy ?? name === 'heavy';
  const kill = options.kill ?? false;
  parts.fx.hit(pos, dirYaw, name, { heavy, kill, material: options.material });
  sound.hitCombo(name, { heavy, kill, material: options.material, x: pos.x, z: pos.z });
  if (!options.mine) return;
  parts.camera.yourHit(dirYaw, { heavy, kill });
  parts.vhs.glitch(kill ? 0.8 : heavy ? 0.5 : 0.25);
  parts.vhs.echo(kill ? 0.75 : heavy ? 0.5 : 0.25);
  parts.vhs.impact(kill ? 1 : heavy ? 0.6 : 0.3);
}

const blastSpot = { x: 0, y: 0 };

/**
 * A meteor landing. Everyone nearby feels this one, not only its caster: it's the biggest thing that
 * can happen near you. It shakes less the further away you are.
 */
export function meteorBlast(parts: FeelParts, id: number, x: number, z: number, radius: number, distance: number, mine: boolean): void {
  parts.fx.arcane.meteorEnd(id, x, z, radius);
  sound.meteorImpact({ x, z });
  const near = Math.max(0, 1 - distance / (radius * 6));
  if (near <= 0) return;
  parts.camera.shake(0.3 + near * 0.7);
  parts.camera.fovKick(1 + near * 3);
  parts.vhs.glitch(0.2 + near * 0.6);
  parts.vhs.echo(0.2 + near * 0.5);
  parts.vhs.impact(near);
  if (mine) parts.camera.hitstop(0.09);
  if (parts.fx.arcane.screenSpot(x, parts.fx.groundY + 1.5, z, blastSpot)) parts.vhs.lens(blastSpot.x, blastSpot.y, near);
}

/** You took a hit. share is the part of your health it cost, 0 to 1. fromYaw is the attacker's yaw. */
export function takeHit(parts: FeelParts, fromYaw: number, share: number): void {
  sound.playGame('hit-player', { duck: Math.min(0.7, share * 1.5) });
  parts.camera.yourHurt(fromYaw, share);
  parts.vhs.glitch(0.35 + share);
  parts.vhs.echo(0.5);
  parts.vhs.damageFlash(0.35 + share);
}

export type MoveKind = 'still' | 'walk' | 'run' | 'roll';

// Seconds between puffs. Running puffs twice per footfall, or the trail reads as separate balls.
const PUFF_SECONDS: Record<MoveKind, number> = { still: 0, walk: 0.47, run: 0.15, roll: 0.075 };

/**
 * Dust and footsteps for one character, driven by how it is moving now. Keep one per character and
 * call update every frame with its feet. Time based instead of tied to the animation's footfalls,
 * so it works for every model and needs nothing from the animation system.
 */
export class FootTrail {
  private last: MoveKind = 'still';
  private wait = 0;
  private puffs = 0;

  constructor(
    private readonly parts: FeelParts,
    /** True for your own character: only that one smears the tape. */
    private readonly mine: boolean,
  ) {}

  update(seconds: number, feet: Position, kind: MoveKind, surface: FootSurface = 'dirt'): void {
    const started = kind !== this.last;
    const wasRoll = this.last === 'roll';
    this.last = kind;
    if (kind === 'roll' && started) {
      sound.playGame('dodge-roll', { x: feet.x, z: feet.z });
      if (this.mine) this.parts.vhs.echo(0.8);
    } else if (wasRoll && started) {
      this.parts.fx.footDust(feet, 'land');
    }
    if (kind === 'still') {
      this.wait = 0;
      return;
    }
    this.wait -= seconds;
    if (this.wait > 0) return;
    this.wait = PUFF_SECONDS[kind];
    this.parts.fx.footDust(feet, kind);
    this.puffs += 1;
    if (kind === 'walk' || (kind === 'run' && this.puffs % 2 === 0)) {
      sound.footstep(surface, { x: feet.x, z: feet.z, running: kind === 'run' });
    }
    if (this.mine) this.parts.vhs.echo(kind === 'roll' ? 0.8 : kind === 'run' ? 0.3 : 0);
  }
}
