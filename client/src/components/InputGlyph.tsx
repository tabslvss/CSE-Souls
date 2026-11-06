import { useSyncExternalStore } from 'react';
import { getInputDevice, subscribeInputDevice, type InputDevice } from '../game/inputDevice';

export type InputAction =
  | 'move' | 'look' | 'run' | 'jump' | 'roll' | 'attack' | 'potion' | 'interact' | 'lock' | 'zoom' | 'pause' | 'confirm';

interface Glyph {
  file: string;
  label: string;
}

const glyph = (file: string, label: string): Glyph => ({ file, label });

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

/** The device in use, updating when the player picks up another one. */
export function useInputDevice(): InputDevice {
  return useSyncExternalStore(subscribeInputDevice, getInputDevice, () => 'keyboard' as const);
}

export function hasGlyph(action: InputAction, device: InputDevice): boolean {
  return GLYPHS[action][device].length > 0;
}

/** The picture of the button for this action, on whichever device is in use. */
export function ActionGlyph({ action }: { action: InputAction }) {
  const device = useInputDevice();
  return (
    <>
      {GLYPHS[action][device].map(({ file, label }) => (
        <img key={file} className="input-glyph" src={`/icons/input/${file}.svg`} alt={label} title={label} draggable={false} />
      ))}
    </>
  );
}
