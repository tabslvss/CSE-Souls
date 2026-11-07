import { padFamily, getInputDevice, setInputDevice } from './inputDevice';

/**
 * Controller support, using Elden Ring's default layout as far as this game has the same actions:
 * R1/RB attack, R3 lock on, Circle/B roll (tap) and run (hold), Cross/A jump, Square/X use potion,
 * Triangle/Y interact, Options/Menu pause, and the small button beside it opens the map. Source: https://eldenring.wiki.gg/wiki/Controls
 * Every other button is left unassigned on purpose.
 */

/** Button numbers in the browser's "standard" controller layout. */
const BUTTON = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  r1: 5,
  share: 8,
  options: 9,
  r3: 11,
  up: 12,
  down: 13,
} as const;

const MOVE_DEADZONE = 0.18;
const MOVE_CURVE = 1.3;
const LOOK_DEADZONE = 0.14;
const LOOK_CURVE = 2;
/** A stick pushed this far, or any button, makes that controller the one in use. */
const WAKE_STICK = 0.5;
/** Holding the roll button at least this long is a run, not a roll. */
const RUN_HOLD_SECONDS = 0.25;
const FLICK_ON = 0.75;
const FLICK_OFF = 0.4;
const MENU_STICK = 0.6;
const MENU_FIRST_REPEAT = 0.4;
const MENU_REPEAT = 0.18;

export type PadAction = 'attack' | 'lock' | 'roll' | 'jump' | 'potion' | 'interact' | 'map' | 'pause';
export type MenuNav = 'up' | 'down' | 'confirm' | 'back';

export interface PadEvents {
  onAction: (action: PadAction) => void;
  onMenu: (nav: MenuNav) => void;
  /** The right stick was flicked. x is right and y is down, from -1 to 1. */
  onFlick: (x: number, y: number) => void;
  /** The controller in use was unplugged. */
  onLost: () => void;
}

interface Actuator {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
  reset?: () => Promise<unknown>;
}

type PadWithRumble = Gamepad & { vibrationActuator?: Actuator | null };

function shapeStick(x: number, y: number, deadzone: number, curve: number, out: { x: number; y: number }): void {
  const size = Math.hypot(x, y);
  if (size <= deadzone) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const amount = Math.min(1, (size - deadzone) / (1 - deadzone)) ** curve;
  out.x = (x / size) * amount;
  out.y = (y / size) * amount;
}

function isBusy(pad: Gamepad): boolean {
  if (pad.buttons.some((button) => button.pressed)) return true;
  return pad.axes.some((axis) => Math.abs(axis) > WAKE_STICK);
}

export class GamepadInput {
  /** Left stick: x is right, y is forward. Zero while a menu is open. */
  readonly move = { x: 0, y: 0 };
  /** Right stick: x is right, y is down. Zero while a menu is open. */
  readonly look = { x: 0, y: 0 };
  run = false;

  private readonly wasDown = new Map<number, boolean[]>();
  private activeIndex: number | null = null;
  private activePad: Gamepad | null = null;
  private circleSeconds = 0;
  private circleArmed = false;
  private flickArmed = true;
  private menuDirection = 0;
  private menuWait = 0;
  private wasInMenu = true;

  constructor(private readonly events: PadEvents) {
    window.addEventListener('gamepaddisconnected', this.onDisconnected);
  }

  /** Call once per frame. The browser has no events for buttons, only their current state. */
  poll(seconds: number, inMenu: boolean): void {
    const pads = this.readPads();
    for (const pad of pads) {
      if (pad.index !== this.activeIndex && isBusy(pad)) {
        this.activeIndex = pad.index;
        this.resetHeld();
      }
    }
    const active = pads.find((pad) => pad.index === this.activeIndex) ?? null;
    if (this.activeIndex !== null && !active) this.loseActive();
    this.activePad = active;

    if (inMenu !== this.wasInMenu) {
      this.resetHeld();
      this.wasInMenu = inMenu;
    }
    if (active) {
      if (isBusy(active)) setInputDevice(padFamily(active.id));
      if (inMenu) this.pollMenu(active, seconds);
      else this.pollPlay(active, seconds);
    }
    for (const pad of pads) this.wasDown.set(pad.index, pad.buttons.map((button) => button.pressed));
  }

  /** A short shake, if this controller and browser can do it. Magnitudes run from 0 to 1. */
  rumble(strong: number, weak: number, milliseconds: number): void {
    if (getInputDevice() === 'keyboard') return;
    const actuator = (this.activePad as PadWithRumble | null)?.vibrationActuator;
    if (!actuator?.playEffect) return;
    try {
      void actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: milliseconds,
        strongMagnitude: strong,
        weakMagnitude: weak,
      }).catch(() => undefined);
    } catch {
      // Some browsers list the actuator but refuse the effect. The game plays on without it.
    }
  }

  dispose(): void {
    window.removeEventListener('gamepaddisconnected', this.onDisconnected);
    try {
      void (this.activePad as PadWithRumble | null)?.vibrationActuator?.reset?.()?.catch(() => undefined);
    } catch {
      // Nothing to stop, then.
    }
    this.activePad = null;
    this.activeIndex = null;
    this.wasDown.clear();
  }

  private readPads(): Gamepad[] {
    if (typeof navigator.getGamepads !== 'function' || !document.hasFocus()) return [];
    try {
      // Other layouts number their buttons differently, so pressing one could do anything.
      return [...navigator.getGamepads()].filter((pad): pad is Gamepad => !!pad && pad.connected && pad.mapping === 'standard');
    } catch {
      return [];
    }
  }

  private pollPlay(pad: Gamepad, seconds: number): void {
    const axes = pad.axes;
    shapeStick(axes[0] ?? 0, axes[1] ?? 0, MOVE_DEADZONE, MOVE_CURVE, this.move);
    // The browser's up is negative, and "forward" is positive here.
    this.move.y = -this.move.y;
    shapeStick(axes[2] ?? 0, axes[3] ?? 0, LOOK_DEADZONE, LOOK_CURVE, this.look);

    if (this.pressed(pad, BUTTON.r1)) this.events.onAction('attack');
    if (this.pressed(pad, BUTTON.r3)) this.events.onAction('lock');
    if (this.pressed(pad, BUTTON.cross)) this.events.onAction('jump');
    if (this.pressed(pad, BUTTON.square)) this.events.onAction('potion');
    if (this.pressed(pad, BUTTON.triangle)) this.events.onAction('interact');
    if (this.pressed(pad, BUTTON.share)) this.events.onAction('map');

    // Roll on letting go, as only then is it clear this wasn't the start of a run.
    if (this.pressed(pad, BUTTON.circle)) {
      this.circleArmed = true;
      this.circleSeconds = 0;
    }
    if (this.circleArmed) {
      if (pad.buttons[BUTTON.circle]?.pressed) {
        this.circleSeconds += seconds;
        this.run = this.circleSeconds >= RUN_HOLD_SECONDS;
      } else {
        if (this.circleSeconds < RUN_HOLD_SECONDS) this.events.onAction('roll');
        this.circleArmed = false;
        this.run = false;
      }
    }

    const flick = Math.hypot(axes[2] ?? 0, axes[3] ?? 0);
    if (this.flickArmed && flick >= FLICK_ON) {
      this.flickArmed = false;
      this.events.onFlick(axes[2] ?? 0, axes[3] ?? 0);
    } else if (flick <= FLICK_OFF) {
      this.flickArmed = true;
    }

    // Last, as pausing changes what the next frame's polling does.
    if (this.pressed(pad, BUTTON.options)) this.events.onAction('pause');
  }

  private pollMenu(pad: Gamepad, seconds: number): void {
    if (this.pressed(pad, BUTTON.cross)) this.events.onMenu('confirm');
    if (this.pressed(pad, BUTTON.circle) || this.pressed(pad, BUTTON.options)) this.events.onMenu('back');

    const stickY = pad.axes[1] ?? 0;
    let direction = 0;
    if (pad.buttons[BUTTON.up]?.pressed || stickY < -MENU_STICK) direction = -1;
    else if (pad.buttons[BUTTON.down]?.pressed || stickY > MENU_STICK) direction = 1;
    this.menuWait -= seconds;
    if (direction !== 0 && (direction !== this.menuDirection || this.menuWait <= 0)) {
      this.events.onMenu(direction < 0 ? 'up' : 'down');
      this.menuWait = direction === this.menuDirection ? MENU_REPEAT : MENU_FIRST_REPEAT;
    }
    this.menuDirection = direction;
  }

  /** True only on the frame a button goes down. */
  private pressed(pad: Gamepad, button: number): boolean {
    return !!pad.buttons[button]?.pressed && !this.wasDown.get(pad.index)?.[button];
  }

  private resetHeld(): void {
    this.move.x = 0;
    this.move.y = 0;
    this.look.x = 0;
    this.look.y = 0;
    this.run = false;
    this.circleArmed = false;
    this.circleSeconds = 0;
    this.flickArmed = false;
    this.menuDirection = 0;
    this.menuWait = 0;
  }

  private loseActive(): void {
    this.activeIndex = null;
    this.activePad = null;
    this.resetHeld();
    this.events.onLost();
  }

  private readonly onDisconnected = (event: GamepadEvent) => {
    this.wasDown.delete(event.gamepad.index);
    if (event.gamepad.index === this.activeIndex) this.loseActive();
  };
}
