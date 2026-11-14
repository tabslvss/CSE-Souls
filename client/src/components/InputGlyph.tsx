import { useId, useSyncExternalStore, type ReactElement } from 'react';
import { getInputDevice, subscribeInputDevice, type InputDevice } from '../game/inputDevice';

export type InputAction =
  | 'move' | 'look' | 'run' | 'jump' | 'roll' | 'attack' | 'potion' | 'interact' | 'lock' | 'zoom' | 'map' | 'pause' | 'confirm';

/**
 * Controller buttons by what they do in menus, for hint bars.
 * 'x' and 'y' mean the left and top face buttons (Square/X and Triangle/Y), the same as the
 * data-pad-x and data-pad-y attributes of ui/padNav.ts.
 */
export type PadButton =
  | 'confirm' | 'back' | 'x' | 'y'
  | 'lb' | 'rb' | 'tabs' | 'lt' | 'rt' | 'triggers'
  | 'dpad' | 'dpadUpDown' | 'dpadLeftRight' | 'adjust'
  | 'leftStick' | 'rightStick' | 'scroll' | 'l3' | 'r3'
  | 'start' | 'select';

type Drawing = 'l1' | 'r1' | 'l2' | 'r2' | 'lb' | 'rb' | 'lt' | 'rt' | 'dpadUpDown' | 'dpadLeftRight' | 'create' | 'view';

interface Glyph {
  /** A picture in /icons/input/, or a drawing made here for buttons that set has no picture of. */
  file?: string;
  draw?: Drawing;
  label: string;
}

const glyph = (file: string, label: string): Glyph => ({ file, label });
const drawn = (draw: Drawing, label: string): Glyph => ({ draw, label });

/** An empty list means this action has no button on that device, so it isn't shown. */
const GLYPHS: Record<InputAction, Record<InputDevice, Glyph[]>> = {
  move: {
    keyboard: [glyph('keyboard_w', 'W'), glyph('keyboard_a', 'A'), glyph('keyboard_s', 'S'), glyph('keyboard_d', 'D')],
    playstation: [glyph('playstation_stick_l', 'Left stick')],
    xbox: [glyph('xbox_stick_l', 'Left stick')],
  },
  look: {
    keyboard: [glyph('mouse_move', 'Mouse')],
    playstation: [glyph('playstation_stick_r', 'Right stick')],
    xbox: [glyph('xbox_stick_r', 'Right stick')],
  },
  run: {
    keyboard: [glyph('keyboard_shift', 'Shift')],
    playstation: [glyph('playstation_button_circle', 'Circle')],
    xbox: [glyph('xbox_button_color_b', 'B')],
  },
  jump: {
    keyboard: [glyph('keyboard_space', 'Space')],
    playstation: [glyph('playstation_button_cross', 'Cross')],
    xbox: [glyph('xbox_button_color_a', 'A')],
  },
  roll: {
    keyboard: [glyph('keyboard_c', 'C')],
    playstation: [glyph('playstation_button_circle', 'Circle')],
    xbox: [glyph('xbox_button_color_b', 'B')],
  },
  attack: {
    keyboard: [glyph('mouse_left', 'Left click')],
    playstation: [glyph('playstation_trigger_r1', 'R1')],
    xbox: [glyph('xbox_rb', 'RB')],
  },
  potion: {
    keyboard: [glyph('keyboard_1', '1')],
    playstation: [glyph('playstation_button_square', 'Square')],
    xbox: [glyph('xbox_button_color_x', 'X')],
  },
  interact: {
    keyboard: [glyph('keyboard_e', 'E')],
    playstation: [glyph('playstation_button_triangle', 'Triangle')],
    xbox: [glyph('xbox_button_color_y', 'Y')],
  },
  lock: {
    keyboard: [glyph('keyboard_q', 'Q'), glyph('mouse_scroll', 'Middle mouse button')],
    playstation: [glyph('playstation_stick_r_press', 'Press the right stick')],
    xbox: [glyph('xbox_stick_r_press', 'Press the right stick')],
  },
  zoom: {
    keyboard: [glyph('mouse_scroll_vertical', 'Scroll wheel')],
    playstation: [],
    xbox: [],
  },
  map: {
    keyboard: [glyph('keyboard_m', 'M')],
    playstation: [drawn('create', 'Create')],
    xbox: [drawn('view', 'View')],
  },
  pause: {
    keyboard: [glyph('keyboard_escape', 'Esc')],
    playstation: [glyph('playstation5_button_options', 'Options')],
    xbox: [glyph('xbox_button_menu', 'Menu')],
  },
  confirm: {
    keyboard: [glyph('mouse_left', 'Left click')],
    playstation: [glyph('playstation_button_cross', 'Cross')],
    xbox: [glyph('xbox_button_color_a', 'A')],
  },
};

type PadDevice = Exclude<InputDevice, 'keyboard'>;

const PAD_GLYPHS: Record<PadButton, Record<PadDevice, Glyph[]>> = {
  confirm: { playstation: [glyph('playstation_button_cross', 'Cross')], xbox: [glyph('xbox_button_color_a', 'A')] },
  back: { playstation: [glyph('playstation_button_circle', 'Circle')], xbox: [glyph('xbox_button_color_b', 'B')] },
  x: { playstation: [glyph('playstation_button_square', 'Square')], xbox: [glyph('xbox_button_color_x', 'X')] },
  y: { playstation: [glyph('playstation_button_triangle', 'Triangle')], xbox: [glyph('xbox_button_color_y', 'Y')] },
  lb: { playstation: [drawn('l1', 'L1')], xbox: [drawn('lb', 'LB')] },
  rb: { playstation: [drawn('r1', 'R1')], xbox: [drawn('rb', 'RB')] },
  tabs: { playstation: [drawn('l1', 'L1'), drawn('r1', 'R1')], xbox: [drawn('lb', 'LB'), drawn('rb', 'RB')] },
  lt: { playstation: [drawn('l2', 'L2')], xbox: [drawn('lt', 'LT')] },
  rt: { playstation: [drawn('r2', 'R2')], xbox: [drawn('rt', 'RT')] },
  triggers: { playstation: [drawn('l2', 'L2'), drawn('r2', 'R2')], xbox: [drawn('lt', 'LT'), drawn('rt', 'RT')] },
  dpad: { playstation: [glyph('playstation_dpad', 'D-pad')], xbox: [glyph('xbox_dpad', 'D-pad')] },
  dpadUpDown: { playstation: [drawn('dpadUpDown', 'D-pad up and down')], xbox: [drawn('dpadUpDown', 'D-pad up and down')] },
  dpadLeftRight: { playstation: [drawn('dpadLeftRight', 'D-pad left and right')], xbox: [drawn('dpadLeftRight', 'D-pad left and right')] },
  adjust: { playstation: [drawn('dpadLeftRight', 'D-pad left and right')], xbox: [drawn('dpadLeftRight', 'D-pad left and right')] },
  leftStick: { playstation: [glyph('playstation_stick_l', 'Left stick')], xbox: [glyph('xbox_stick_l', 'Left stick')] },
  rightStick: { playstation: [glyph('playstation_stick_r', 'Right stick')], xbox: [glyph('xbox_stick_r', 'Right stick')] },
  scroll: { playstation: [glyph('playstation_stick_r', 'Right stick')], xbox: [glyph('xbox_stick_r', 'Right stick')] },
  l3: { playstation: [glyph('playstation_stick_l', 'Press the left stick')], xbox: [glyph('xbox_stick_l', 'Press the left stick')] },
  r3: { playstation: [glyph('playstation_stick_r_press', 'Press the right stick')], xbox: [glyph('xbox_stick_r_press', 'Press the right stick')] },
  start: { playstation: [glyph('playstation5_button_options', 'Options')], xbox: [glyph('xbox_button_menu', 'Menu')] },
  select: { playstation: [drawn('create', 'Create')], xbox: [drawn('view', 'View')] },
};

/** The device in use, updating when the player picks up another one. */
export function useInputDevice(): InputDevice {
  return useSyncExternalStore(subscribeInputDevice, getInputDevice, () => 'keyboard' as const);
}

export function hasGlyph(action: InputAction, device: InputDevice): boolean {
  return GLYPHS[action][device].length > 0;
}

/** The button names for a hint, such as "L1 and R1", for text or screen readers. */
export function padButtonLabel(button: PadButton, device: InputDevice): string {
  const family: PadDevice = device === 'playstation' ? 'playstation' : 'xbox';
  return PAD_GLYPHS[button][family].map((each) => each.label).join(' and ');
}

/** The white shoulder and trigger shapes, with the button's name cut out of them. */
function Plate({ shape, text, label }: { shape: string; text: string; label: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="input-glyph input-glyph--drawn" viewBox="0 0 64 64" role="img" aria-label={label}>
      <title>{label}</title>
      <mask id={`m${id}`}>
        <rect width="64" height="64" fill="#fff" />
        <text
          x="32"
          y="37"
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="700"
          fontSize="17"
          fill="#000"
        >
          {text}
        </text>
      </mask>
      <path d={shape} fill="#fff" mask={`url(#m${id})`} />
    </svg>
  );
}

const SHAPES = {
  // A wide shoulder button, rounder on the outer side.
  bumperLeft: 'M24 15 L50 15 Q56 15 56 21 L56 46 Q56 51 51 51 L13 51 Q8 51 8 46 L8 33 Q8 15 24 15 Z',
  bumperRight: 'M40 15 L14 15 Q8 15 8 21 L8 46 Q8 51 13 51 L51 51 Q56 51 56 46 L56 33 Q56 15 40 15 Z',
  // A trigger, tall with a domed top.
  trigger: 'M14 54 L14 30 Q14 10 32 10 Q50 10 50 30 L50 50 Q50 54 46 54 Z',
};

function DPad({ lit, label }: { lit: 'upDown' | 'leftRight'; label: string }) {
  const arms = {
    up: 'M25 8 L39 8 Q41 8 41 10 L41 25 L23 25 L23 10 Q23 8 25 8 Z',
    down: 'M23 39 L41 39 L41 54 Q41 56 39 56 L25 56 Q23 56 23 54 Z',
    left: 'M10 23 L25 23 L25 41 L10 41 Q8 41 8 39 L8 25 Q8 23 10 23 Z',
    right: 'M39 23 L54 23 Q56 23 56 25 L56 39 Q56 41 54 41 L39 41 Z',
  };
  const on = lit === 'upDown' ? ['up', 'down'] : ['left', 'right'];
  const arrows = {
    up: 'M32 12 L37 19 L27 19 Z',
    down: 'M32 52 L27 45 L37 45 Z',
    left: 'M12 32 L19 27 L19 37 Z',
    right: 'M52 32 L45 37 L45 27 Z',
  };
  return (
    <svg className="input-glyph input-glyph--drawn" viewBox="0 0 64 64" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x="23" y="23" width="18" height="18" fill="#fff" opacity="0.45" />
      {(Object.keys(arms) as (keyof typeof arms)[]).map((arm) => (
        <path key={arm} d={arms[arm]} fill="#fff" opacity={on.includes(arm) ? 1 : 0.4} />
      ))}
      {on.map((arm) => (
        <path key={arm} d={arrows[arm as keyof typeof arrows]} fill="#16120c" />
      ))}
    </svg>
  );
}

function SmallButton({ kind, label }: { kind: 'create' | 'view'; label: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="input-glyph input-glyph--drawn" viewBox="0 0 64 64" role="img" aria-label={label}>
      <title>{label}</title>
      <mask id={`m${id}`}>
        <rect width="64" height="64" fill="#fff" />
        {kind === 'create' ? (
          <path d="M27 24 L37 20 M27 32 L37 28 M27 40 L37 36" stroke="#000" strokeWidth="3" strokeLinecap="round" />
        ) : (
          <>
            <rect x="21" y="22" width="14" height="12" rx="2" fill="none" stroke="#000" strokeWidth="3" />
            <rect x="29" y="30" width="14" height="12" rx="2" fill="#000" />
          </>
        )}
      </mask>
      {kind === 'create' ? (
        <rect x="21" y="10" width="22" height="44" rx="11" fill="#fff" mask={`url(#m${id})`} />
      ) : (
        <circle cx="32" cy="32" r="22" fill="#fff" mask={`url(#m${id})`} />
      )}
    </svg>
  );
}

function GlyphPicture({ glyph: { file, draw, label } }: { glyph: Glyph }): ReactElement | null {
  if (file) return <img className="input-glyph" src={`/icons/input/${file}.svg`} alt={label} title={label} draggable={false} />;
  switch (draw) {
    case 'l1':
    case 'lb':
      return <Plate shape={SHAPES.bumperLeft} text={label} label={label} />;
    case 'r1':
    case 'rb':
      return <Plate shape={SHAPES.bumperRight} text={label} label={label} />;
    case 'l2':
    case 'r2':
    case 'lt':
    case 'rt':
      return <Plate shape={SHAPES.trigger} text={label} label={label} />;
    case 'dpadUpDown':
      return <DPad lit="upDown" label={label} />;
    case 'dpadLeftRight':
      return <DPad lit="leftRight" label={label} />;
    case 'create':
    case 'view':
      return <SmallButton kind={draw} label={label} />;
    default:
      return null;
  }
}

/** The picture of the button for this action, on whichever device is in use. */
export function ActionGlyph({ action }: { action: InputAction }) {
  const device = useInputDevice();
  return (
    <>
      {GLYPHS[action][device].map((each) => (
        <GlyphPicture key={each.file ?? each.draw} glyph={each} />
      ))}
    </>
  );
}

/**
 * The picture of a controller button for menus. With no device given it follows the controller
 * in use, and shows Xbox buttons while the keyboard is in use.
 */
export function PadGlyph({ button, device }: { button: PadButton; device?: InputDevice }) {
  const current = useInputDevice();
  const family: PadDevice = (device ?? current) === 'playstation' ? 'playstation' : 'xbox';
  return (
    <>
      {PAD_GLYPHS[button][family].map((each) => (
        <GlyphPicture key={each.file ?? each.draw} glyph={each} />
      ))}
    </>
  );
}
