import { mixRgb, type Rgb } from './psx';

/**
 * The shared day/night cycle. Derived from the wall clock rather than stored anywhere, so
 * every visitor sees the same time of day with no server state. The game can use this too.
 */
export const DAY_CYCLE_MS = 20 * 60 * 1000;

export function worldPhase(now = Date.now()): number {
  return (now % DAY_CYCLE_MS) / DAY_CYCLE_MS;
}

export interface SkyLook {
  sky: readonly [Rgb, Rgb, Rgb, Rgb];
  far: Rgb;
  fog: Rgb;
  /** How much the fire and lit windows stand out. 1 at night. */
  darkness: number;
  /** Strength of the golden light behind the citadel. */
  gold: number;
}

// Golden haze at every hour. Midday is overcast amber, and night keeps a warm horizon.
const KEYFRAMES: ReadonlyArray<{ at: number; name: string; look: SkyLook }> = [
  {
    at: 0.0,
    name: 'Dawn',
    look: {
      sky: [[24, 20, 26], [70, 52, 44], [168, 124, 70], [236, 190, 110]],
      far: [58, 44, 34],
      fog: [224, 186, 124],
      darkness: 0.55,
      gold: 0.8,
    },
  },
  {
    at: 0.28,
    name: 'Day',
    look: {
      sky: [[42, 38, 34], [96, 84, 62], [172, 146, 96], [232, 206, 146]],
      far: [74, 64, 50],
      fog: [226, 208, 164],
      darkness: 0.25,
      gold: 0.65,
    },
  },
  {
    at: 0.5,
    name: 'Dusk',
    look: {
      sky: [[18, 12, 14], [72, 42, 26], [176, 112, 44], [246, 176, 84]],
      far: [48, 30, 22],
      fog: [232, 168, 96],
      darkness: 0.7,
      gold: 1,
    },
  },
  {
    at: 0.68,
    name: 'Night',
    look: {
      sky: [[6, 7, 12], [14, 15, 24], [34, 32, 38], [72, 60, 50]],
      far: [14, 14, 20],
      fog: [108, 100, 92],
      darkness: 1,
      gold: 0.85,
    },
  },
];

export function skyAt(phase: number): SkyLook {
  let index = KEYFRAMES.length - 1;
  for (let i = 0; i < KEYFRAMES.length; i += 1) {
    if (phase >= KEYFRAMES[i].at) index = i;
  }
  const from = KEYFRAMES[index];
  const to = KEYFRAMES[(index + 1) % KEYFRAMES.length];
  const span = (to.at + (to.at <= from.at ? 1 : 0) - from.at) || 1;
  const t = (phase - from.at) / span;
  // Holds each mood for a while, then eases across to the next one.
  const eased = t * t * (3 - 2 * t);
  return {
    sky: [0, 1, 2, 3].map((i) => mixRgb(from.look.sky[i], to.look.sky[i], eased)) as unknown as SkyLook['sky'],
    far: mixRgb(from.look.far, to.look.far, eased),
    fog: mixRgb(from.look.fog, to.look.fog, eased),
    darkness: from.look.darkness + (to.look.darkness - from.look.darkness) * eased,
    gold: from.look.gold + (to.look.gold - from.look.gold) * eased,
  };
}

export function timeOfDayName(phase: number): string {
  let name = KEYFRAMES[KEYFRAMES.length - 1].name;
  for (const keyframe of KEYFRAMES) {
    if (phase >= keyframe.at) name = keyframe.name;
  }
  return name;
}
