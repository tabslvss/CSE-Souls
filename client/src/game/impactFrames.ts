import * as THREE from 'three';

/*
 * Impact frames: at the instant of a huge hit the picture is replaced for a few frames by stark
 * black and white images (inverted, outlined, cut by speed lines or a hard split), then snaps back.
 * The looks are drawn by the PS1 dither pass in psxRenderer.ts from the already-rendered scene, so
 * the same 4x4 Bayer pattern and low-res pixels apply to them. This file only times the sequence
 * and writes uniforms; it never allocates per frame.
 *
 * Timing is in REAL seconds (the game's own clock may be frozen by hitstop). Frames are written at a
 * nominal 60 fps, but every frame shows at least once however slow the machine runs.
 *
 * PHOTOSENSITIVITY. A "flash" below means the whole screen going from mostly dark to mostly bright
 * and back. The scene behind is dark, so a threshold frame reads dark and an inverted or flash frame
 * reads bright. Each preset stays well under the usual three flashes in any one second:
 *   heavy  dark > bright for 5 frames (flash, inverted, black-on-white edge) > dark: 1 flash, 0.08 s.
 *   blade  black, half and half split, 1 bright inverted frame, dark hold: 1 flash, inside 0.07 s.
 *   arrow  1 bright frame, 3 dark, 2 bright, dark: 2 flashes, all inside the first 0.1 s.
 *   magic  dark duotone pulses (the pulse moves the tone levels a little, not a flip), then one
 *          white flash easing out over 0.3 s: 1 flash.
 *   light  two dark frames, no flash at all.
 * Nothing flips brightness after the first 0.3 s of any preset: blade's later 0.25 s is a still
 * dark hold, magic's later part is a single slow fade. With prefers-reduced-motion the whole
 * sequence becomes one soft 0.15 s desaturated dim, with no shake, no split and no flash.
 */

/** threshold: black and white through the Bayer matrix. inverted: the same, swapped. edge: thick
 *  Sobel outlines. accent: threshold plus one color burning through. flash: one flat color. dim:
 *  the reduced-motion stand-in, a soft desaturated darkening. */
export type ImpactLook = 'threshold' | 'inverted' | 'edge' | 'accent' | 'flash' | 'dim';

export type ImpactFrame = {
  look: ImpactLook;
  /** How long it shows, in real seconds. One nominal frame is IMPACT_FRAME (1/60). */
  seconds: number;
  /** Swaps black and white. A white flash with invert is a black flash; an edge with invert is black lines on white. */
  invert?: boolean;
  /** Keep one color where the scene is very bright or shares its hue. true uses the play's accent. */
  accent?: boolean | number;
  /** Radial speed lines from the focus, 0 to 1: more of them, bolder, reaching closer in. */
  lines?: number;
  /** Radius around the focus the lines leave clear, in screen heights. Default 0.17. */
  clear?: number;
  /** A hard split through the focus at this angle in degrees (0 horizontal): one side inverted and shifted. */
  split?: number;
  /** Whole-picture jitter in low-res pixels, rerolled every frame. 1 to 3. */
  shake?: number;
  /** Eases this frame's look back into the scene over its duration. */
  fade?: boolean;
  /** Freezes the picture: the scene isn't redrawn and nothing jitters. The delayed-cut hold. */
  still?: boolean;
  /** Pushes the tone levels: positive brightens the threshold, negative darkens it. About +-0.1. */
  pulse?: number;
  /** The colors used for "white" and "black". Default pure white and pure black. */
  paper?: number;
  ink?: number;
};

export type ImpactPresetName = 'heavy' | 'blade' | 'arrow' | 'magic' | 'light';

export type ImpactPlayOptions = {
  /** Screen point of the hit, 0 to 1 each side, y = 0 at the BOTTOM (as Vector3.project gives, *0.5+0.5). */
  focus?: { x: number; y: number };
  /** Accent color as 0xRRGGBB, overriding the preset's. */
  accent?: number;
};

/** One frame at the nominal 60 fps the presets are written for. */
export const IMPACT_FRAME = 1 / 60;
const F = IMPACT_FRAME;

export const IMPACT_EMBER = 0xff6418;
export const IMPACT_ARCANE = 0x58a8ff;
const MAGIC_PAPER = 0xffe2a0;
const MAGIC_INK = 0x060a1e;

type Preset = { frames: readonly ImpactFrame[]; accent: number; tail: number };

/** The chroma split and leftover jitter on the frames just after a sequence, in real seconds. */
const TAIL_SECONDS = 0.16;
const TAIL_CHROMA = 2;

export const IMPACT_PRESETS: Readonly<Record<ImpactPresetName, Preset>> = {
  // Hammer comes down: white, inverted with lines, outline, the ember trail burning through, ease back.
  heavy: {
    accent: IMPACT_EMBER,
    tail: TAIL_SECONDS,
    frames: [
      { look: 'flash', seconds: F, shake: 3 },
      { look: 'inverted', seconds: 2 * F, lines: 1, shake: 3 },
      { look: 'edge', seconds: 2 * F, invert: true, shake: 2 },
      { look: 'accent', seconds: 3 * F, accent: true, lines: 0.5, shake: 2 },
      { look: 'accent', seconds: 0.12, accent: true, fade: true, shake: 1 },
    ],
  },
  // The cut: black, the picture sliced on a diagonal, one inverted beat, then a dead-still hold
  // before it releases. The game can land the blood spray on the release (impactPresetSeconds).
  blade: {
    accent: IMPACT_EMBER,
    tail: TAIL_SECONDS,
    frames: [
      { look: 'flash', seconds: F, invert: true },
      { look: 'edge', seconds: 2 * F, split: -28, shake: 2 },
      { look: 'inverted', seconds: F, shake: 2 },
      { look: 'threshold', seconds: 0.25, still: true },
    ],
  },
  // As slowed time resumes: white, lines converging tight on the target, inverted, release.
  arrow: {
    accent: IMPACT_EMBER,
    tail: TAIL_SECONDS,
    frames: [
      { look: 'flash', seconds: F, shake: 1 },
      { look: 'threshold', seconds: 3 * F, lines: 1, clear: 0.07, shake: 1 },
      { look: 'inverted', seconds: 2 * F, lines: 0.6, clear: 0.07, shake: 2 },
    ],
  },
  // Blue-gold duotone pulsing three times as the lines grow, then a long white bloom easing out.
  magic: {
    accent: IMPACT_ARCANE,
    tail: TAIL_SECONDS,
    frames: [
      { look: 'accent', seconds: 2 * F, accent: true, lines: 0.35, pulse: 0.08, shake: 1, paper: MAGIC_PAPER, ink: MAGIC_INK },
      { look: 'accent', seconds: 2 * F, accent: true, lines: 0.35, pulse: -0.04, paper: MAGIC_PAPER, ink: MAGIC_INK },
      { look: 'accent', seconds: 2 * F, accent: true, lines: 0.65, pulse: 0.08, shake: 2, paper: MAGIC_PAPER, ink: MAGIC_INK },
      { look: 'accent', seconds: 2 * F, accent: true, lines: 0.65, pulse: -0.04, shake: 1, paper: MAGIC_PAPER, ink: MAGIC_INK },
      { look: 'accent', seconds: 2 * F, accent: true, lines: 1, pulse: 0.08, shake: 3, paper: MAGIC_PAPER, ink: MAGIC_INK },
      { look: 'accent', seconds: 2 * F, accent: true, lines: 1, pulse: -0.04, shake: 2, paper: MAGIC_PAPER, ink: MAGIC_INK },
      { look: 'flash', seconds: 0.3, fade: true, shake: 1 },
    ],
  },
  // A boss blow landing on the player: two dark frames, no flash.
  light: {
    accent: IMPACT_EMBER,
    tail: 0.1,
    frames: [
      { look: 'threshold', seconds: F, shake: 2 },
      { look: 'edge', seconds: F, shake: 1 },
    ],
  },
};

const REDUCED: readonly ImpactFrame[] = [{ look: 'dim', seconds: 0.15 }];

/** Total length of a preset in real seconds at 60 fps, without the chroma tail. */
export function impactPresetSeconds(name: ImpactPresetName): number {
  let total = 0;
  for (const frame of IMPACT_PRESETS[name].frames) total += frame.seconds;
  return total;
}

const LOOK_CODE: Record<ImpactLook, number> = { threshold: 1, inverted: 1, accent: 1, edge: 2, flash: 3, dim: 4 };
const MAX_STEP = 0.1;
const projected = new THREE.Vector3();

/** The uniforms the dither pass reads. Created once by the renderer and handed to write(). */
export function createImpactUniforms() {
  return {
    /** mode (0 off, 1 threshold, 2 edge, 3 flash, 4 dim), invert, mix, tone shift */
    uImpact: { value: new THREE.Vector4(0, 0, 0, 0) },
    /** focus x, focus y, line amount, clear radius */
    uImpactLines: { value: new THREE.Vector4(0.5, 0.5, 0, 0.17) },
    /** split normal x, normal y, shift in pixels, on */
    uImpactSplit: { value: new THREE.Vector4(0, 1, 0, 0) },
    /** accent rgb (display space), on */
    uImpactAccent: { value: new THREE.Vector4(1, 0.4, 0.1, 0) },
    uImpactPaper: { value: new THREE.Vector3(1, 1, 1) },
    uImpactInk: { value: new THREE.Vector3(0, 0, 0) },
    /** jitter x, jitter y (low-res pixels), chroma split (pixels), line seed */
    uImpactShake: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}
export type ImpactUniforms = ReturnType<typeof createImpactUniforms>;

function setHex(target: THREE.Vector3 | THREE.Vector4, hex: number): void {
  target.x = ((hex >> 16) & 255) / 255;
  target.y = ((hex >> 8) & 255) / 255;
  target.z = (hex & 255) / 255;
}

/** psx.impact. play() starts a sequence, update(realSeconds) runs it, the renderer draws it. */
export class ImpactSequencer {
  private frames: readonly ImpactFrame[] = REDUCED;
  private index = -1;
  private elapsed = 0;
  private shown = false;
  private focusX = 0.5;
  private focusY = 0.5;
  private accent = IMPACT_EMBER;
  private tailLeft = 0;
  private tailTotal = 0;
  private tick = 0;
  private jitterX = 0;
  private jitterY = 0;
  private readonly reducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  /** True while a black and white frame (or the reduced-motion dim) is on screen. The chroma tail after doesn't count. */
  get active(): boolean {
    return this.index >= 0;
  }

  /** True while the current frame holds the picture still, so the renderer can skip drawing the scene. */
  get frozen(): boolean {
    return this.index >= 0 && this.frames[this.index].still === true;
  }

  play(preset: ImpactPresetName | readonly ImpactFrame[], options?: ImpactPlayOptions): void {
    const named = typeof preset === 'string' ? IMPACT_PRESETS[preset] : null;
    const reduced = this.reducedMotion?.matches === true;
    this.frames = reduced ? REDUCED : named ? named.frames : (preset as readonly ImpactFrame[]);
    if (this.frames.length === 0) return;
    this.accent = options?.accent ?? named?.accent ?? IMPACT_EMBER;
    this.focusX = options?.focus ? Math.min(1, Math.max(0, options.focus.x)) : 0.5;
    this.focusY = options?.focus ? Math.min(1, Math.max(0, options.focus.y)) : 0.5;
    this.tailTotal = reduced ? 0 : named ? named.tail : TAIL_SECONDS;
    this.tailLeft = 0;
    this.index = 0;
    this.elapsed = 0;
    this.shown = false;
    this.reroll();
  }

  /** Stops at once, with no tail. */
  cancel(): void {
    this.index = -1;
    this.tailLeft = 0;
  }

  /** Call every frame with REAL elapsed seconds, before rendering. */
  update(realSeconds: number): void {
    const step = Math.min(MAX_STEP, Math.max(0, realSeconds));
    if (this.index < 0) {
      if (this.tailLeft > 0) {
        this.tailLeft = Math.max(0, this.tailLeft - step);
        this.reroll();
      }
      return;
    }
    this.elapsed += step;
    // Only past a frame that has been drawn, so even at 10 fps nothing is skipped.
    while (this.shown && this.elapsed >= this.frames[this.index].seconds) {
      this.elapsed = Math.min(MAX_STEP, this.elapsed - this.frames[this.index].seconds);
      this.index += 1;
      this.shown = false;
      if (this.index >= this.frames.length) {
        this.index = -1;
        this.tailLeft = this.tailTotal;
        break;
      }
    }
    if (this.index >= 0 && !this.frames[this.index].still) this.reroll();
  }

  /** Projects a world point to the focus coordinates play() takes. Returns false behind the camera. */
  static screenFocus(world: { x: number; y: number; z: number }, camera: THREE.Camera, out: { x: number; y: number }): boolean {
    projected.set(world.x, world.y, world.z).project(camera);
    if (projected.z > 1 || projected.z < -1) return false;
    out.x = projected.x * 0.5 + 0.5;
    out.y = projected.y * 0.5 + 0.5;
    return true;
  }

  private reroll(): void {
    this.tick = (this.tick + 1) % 997;
    const frame = this.index >= 0 ? this.frames[this.index] : null;
    const amount = frame ? frame.shake ?? 0 : this.tailTotal > 0 ? (this.tailLeft / this.tailTotal) * 1.5 : 0;
    // Whole pixels, and never zero on a shaking frame, so the jolt always reads.
    const sx = Math.random() < 0.5 ? -1 : 1;
    const sy = Math.random() < 0.5 ? -1 : 1;
    this.jitterX = amount >= 1 ? sx * (1 + Math.floor(Math.random() * amount)) : 0;
    this.jitterY = amount >= 1 ? sy * Math.floor(Math.random() * (amount + 1) * 0.7) : 0;
  }

  /** @internal Called by the renderer each frame. Marks the current frame as shown. */
  write(u: ImpactUniforms): void {
    const impact = u.uImpact.value;
    const shake = u.uImpactShake.value;
    if (this.index < 0) {
      impact.x = 0;
      const tail = this.tailTotal > 0 ? this.tailLeft / this.tailTotal : 0;
      shake.set(tail > 0 ? this.jitterX : 0, tail > 0 ? this.jitterY : 0, Math.round(tail * TAIL_CHROMA), shake.w);
      return;
    }
    const frame = this.frames[this.index];
    this.shown = true;
    const progress = Math.min(1, this.elapsed / Math.max(1e-4, frame.seconds));
    let mix = frame.fade ? 1 - progress : 1;
    if (frame.look === 'dim') mix = Math.sin(Math.PI * progress) * 0.55;
    impact.set(LOOK_CODE[frame.look], (frame.look === 'inverted') !== (frame.invert === true) ? 1 : 0, mix, frame.pulse ?? 0);

    const lines = u.uImpactLines.value;
    lines.set(this.focusX, this.focusY, frame.lines ?? 0, frame.clear ?? 0.17);

    const split = u.uImpactSplit.value;
    if (frame.split !== undefined) {
      const angle = (frame.split * Math.PI) / 180;
      split.set(-Math.sin(angle), Math.cos(angle), 4, 1);
    } else split.w = 0;

    const accent = u.uImpactAccent.value;
    const accentOn = frame.accent !== undefined && frame.accent !== false;
    if (accentOn) setHex(accent, typeof frame.accent === 'number' ? frame.accent : this.accent);
    accent.w = accentOn ? 1 : 0;
    setHex(u.uImpactPaper.value, frame.paper ?? 0xffffff);
    setHex(u.uImpactInk.value, frame.ink ?? 0x000000);
    shake.set(frame.still ? 0 : this.jitterX, frame.still ? 0 : this.jitterY, 0, frame.still ? shake.w : this.tick);
  }
}
