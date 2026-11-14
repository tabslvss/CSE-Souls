/**
 * Controller navigation for every screen of the site, in the style of a console menu:
 * the D-pad or left stick moves a gold highlight to the nearest item in that direction,
 * Cross/A presses it, Circle/B backs out, the shoulder buttons switch tabs and the right
 * stick scrolls.
 *
 * One poller runs for the whole site. During play the game reads the controller itself
 * (game/gamepad.ts) and tells this module so with setGameActive(true); until it says
 * false again, nothing here reacts to the controller.
 *
 * Markup that screens use (all optional):
 *   data-pad-scope    A region that takes over the controller while it is open (a modal, an
 *                     overlay, a whole screen). The innermost visible one wins; between
 *                     unrelated ones, the later one in the page wins. With none, the whole page.
 *   data-pad-custom   On a scope: the sticks and triggers are left to the screen, which gets a
 *                     'padstick' event on the scope every frame. The D-pad still moves focus.
 *   data-pad-default  The item focused first when nothing in the scope has focus yet.
 *   data-pad-item     Makes any element an item the highlight can land on.
 *   data-pad-skip     The element and everything inside it are never focused by the controller.
 *   data-pad-back     Circle/B presses this element (the scope's own, not a nested scope's).
 *   data-pad-tab      The shoulder buttons step through these in page order and press the new one.
 *   data-pad-adjust   Left and right on this item send a 'padadjust' event instead of moving.
 *   data-pad-x, data-pad-y   Square/X and Triangle/Y press this element.
 *
 * Events:
 *   window 'padnav'     CustomEvent<PadNavDetail>, cancelable, before the default handling.
 *   scope  'padback'    CustomEvent, cancelable, when Circle/B has no [data-pad-back] to press.
 *   item   'padadjust'  CustomEvent<{ step: -1 | 1 }>, bubbles, cancelable.
 *   scope  'padstick'   CustomEvent<PadStickDetail>, each frame, only in a [data-pad-custom] scope.
 *   window 'padstart'   Event, when Options/Menu is pressed.
 */
import { padFamily, setInputDevice, subscribeInputDevice, getInputDevice } from '../game/inputDevice';
import { sound } from '../sound';

export type PadNavAction =
  | 'up' | 'down' | 'left' | 'right'
  | 'confirm' | 'back' | 'x' | 'y'
  | 'tabPrev' | 'tabNext' | 'lt' | 'rt'
  | 'start' | 'select' | 'l3' | 'r3';

export interface PadNavDetail {
  action: PadNavAction;
  /** True when a held direction repeats. */
  repeat: boolean;
  /** The scope element in charge, or null for the whole page. */
  scope: HTMLElement | null;
}

export interface PadStickDetail {
  /** Left stick, x right and y down, -1 to 1, deadzone removed. */
  lx: number;
  ly: number;
  /** Right stick, the same way. */
  rx: number;
  ry: number;
  /** Triggers, 0 to 1. */
  lt: number;
  rt: number;
  /** Seconds since the last frame. */
  seconds: number;
}

/** Button numbers in the browser's "standard" controller layout. */
const B = {
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  select: 8, start: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
} as const;

const STICK_DEADZONE = 0.5;
const SCROLL_DEADZONE = 0.2;
const RAW_DEADZONE = 0.15;
const TRIGGER_ON = 0.5;
const FIRST_REPEAT = 0.35;
const REPEAT = 0.12;
const WAKE_STICK = 0.5;
/** Pixels per second at full right stick. */
const SCROLL_SPEED = 1500;
const NOTE_MS = 2600;

const FOCUSABLE = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[data-pad-item]',
].join(', ');

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week', '']);

type Direction = 'up' | 'down' | 'left' | 'right';

let started = false;
let gameActive = false;
let frameId = 0;
let lastTime = 0;
let activeIndex: number | null = null;
const wasDown = new Map<number, boolean[]>();
/** Set when the game hands the controller back, so buttons still held from play don't fire here. */
let swallowHeld = true;
let heldDirection: Direction | null = null;
let heldWait = 0;
let triggerWas = { lt: false, rt: false };
let lastScope: Element | null | undefined;
/** The item last highlighted, to notice when a screen change removes it. */
let lastFocused: HTMLElement | null = null;
const rememberedFocus = new WeakMap<Element | Document, HTMLElement>();
let ring: HTMLDivElement | null = null;
let ringTarget: Element | null = null;
let glideTimer = 0;
let note: HTMLDivElement | null = null;
let noteTimer = 0;

// ---------- public API ----------

/** Starts the site-wide poller. Safe to call more than once. */
export function startPadNav(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  // Keeps the device tracker listening for the whole life of the page.
  subscribeInputDevice(syncHtmlClasses);
  syncHtmlClasses();
  document.addEventListener('mousemove', showPointer, true);
  document.addEventListener('pointerdown', showPointer, true);
  window.addEventListener('gamepaddisconnected', onDisconnected);
  frameId = requestAnimationFrame(frame);
}

/** Stops the poller. Only tests and hot reloads need this. */
export function stopPadNav(): void {
  if (!started) return;
  started = false;
  cancelAnimationFrame(frameId);
  document.removeEventListener('mousemove', showPointer, true);
  document.removeEventListener('pointerdown', showPointer, true);
  window.removeEventListener('gamepaddisconnected', onDisconnected);
  ring?.remove();
  ring = null;
}

/**
 * True while the game is being played and reads the controller itself. While true, this module
 * ignores the controller completely. When it turns false, buttons still held must be let go
 * before they count here.
 */
export function setGameActive(active: boolean): void {
  if (active === gameActive) return;
  gameActive = active;
  swallowHeld = true;
  heldDirection = null;
  document.documentElement.classList.toggle('pad-game', active);
  updateRing();
}

export function isGameActive(): boolean {
  return gameActive;
}

/** The scope element in charge right now, or null for the whole page. */
export function currentPadScope(): HTMLElement | null {
  return findScope();
}

/** Moves the highlight to this element, scrolling it into view. */
export function padFocus(element: HTMLElement): void {
  focusItem(element, false);
}

/** Moves the highlight as if the D-pad were pressed. Returns false when nothing lies that way. */
export function padMove(direction: Direction): boolean {
  return move(direction);
}

/** Shows the short message along the bottom that the controller layer uses for its notes. */
export function showPadNote(text: string): void {
  if (!note) {
    note = document.createElement('div');
    note.className = 'pad-note';
    note.setAttribute('role', 'status');
  }
  // A modal <dialog> sits in the browser's top layer, above anything in body, so the note goes inside it.
  const host = overlayHost();
  if (note.parentElement !== host) host.appendChild(note);
  note.textContent = text;
  note.classList.add('pad-note--on');
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => note?.classList.remove('pad-note--on'), NOTE_MS);
}

// ---------- device and classes ----------

function syncHtmlClasses(): void {
  const device = getInputDevice();
  const root = document.documentElement;
  root.classList.toggle('pad-active', device !== 'keyboard');
  root.classList.toggle('pad-playstation', device === 'playstation');
  root.classList.toggle('pad-xbox', device === 'xbox');
  if (device === 'keyboard') root.classList.remove('pad-pointer-hidden');
  updateRing();
}

function showPointer(): void {
  document.documentElement.classList.remove('pad-pointer-hidden');
}

function hidePointer(): void {
  if (!gameActive) document.documentElement.classList.add('pad-pointer-hidden');
}

function onDisconnected(event: GamepadEvent): void {
  wasDown.delete(event.gamepad.index);
  if (event.gamepad.index === activeIndex) activeIndex = null;
}

// ---------- polling ----------

function readPads(): Gamepad[] {
  if (typeof navigator.getGamepads !== 'function') return [];
  try {
    return [...navigator.getGamepads()].filter((pad): pad is Gamepad => !!pad && pad.connected && pad.mapping === 'standard');
  } catch {
    return [];
  }
}

function isBusy(pad: Gamepad): boolean {
  return pad.buttons.some((button) => button.pressed) || pad.axes.some((axis) => Math.abs(axis) > WAKE_STICK);
}

function frame(time: number): void {
  frameId = requestAnimationFrame(frame);
  const seconds = Math.min(0.1, (time - lastTime) / 1000 || 0);
  lastTime = time;
  try {
    poll(seconds);
  } catch (error) {
    // One broken screen must not stop the controller for the rest of the site.
    console.error(error);
  }
  if (ring) updateRing();
}

function poll(seconds: number): void {
  const pads = readPads();
  for (const pad of pads) {
    if (pad.index !== activeIndex && isBusy(pad)) {
      activeIndex = pad.index;
      swallowHeld = true;
    }
  }
  const pad = pads.find((each) => each.index === activeIndex) ?? null;
  if (!pad || gameActive || !document.hasFocus()) {
    remember(pads);
    heldDirection = null;
    return;
  }
  if (swallowHeld) {
    swallowHeld = false;
    remember(pads);
    triggerWas = { lt: (pad.buttons[B.l2]?.value ?? 0) > TRIGGER_ON, rt: (pad.buttons[B.r2]?.value ?? 0) > TRIGGER_ON };
    heldDirection = currentDirection(pad);
    heldWait = FIRST_REPEAT;
    return;
  }
  if (isBusy(pad)) {
    setInputDevice(padFamily(pad.id));
    hidePointer();
  }

  const scope = findScope();
  if (scope !== lastScope) onScopeChange(lastScope, scope);
  recoverLostFocus(scope);
  const custom = !!scope?.hasAttribute('data-pad-custom');

  if (pressed(pad, B.cross)) act('confirm', scope);
  if (pressed(pad, B.circle)) act('back', scope);
  if (pressed(pad, B.square)) act('x', scope);
  if (pressed(pad, B.triangle)) act('y', scope);
  if (pressed(pad, B.l1)) act('tabPrev', scope);
  if (pressed(pad, B.r1)) act('tabNext', scope);
  if (pressed(pad, B.select)) act('select', scope);
  if (pressed(pad, B.l3)) act('l3', scope);
  if (pressed(pad, B.r3)) act('r3', scope);
  if (pressed(pad, B.start)) act('start', scope);

  const lt = (pad.buttons[B.l2]?.value ?? (pad.buttons[B.l2]?.pressed ? 1 : 0));
  const rt = (pad.buttons[B.r2]?.value ?? (pad.buttons[B.r2]?.pressed ? 1 : 0));
  if (lt > TRIGGER_ON && !triggerWas.lt) act('lt', scope);
  if (rt > TRIGGER_ON && !triggerWas.rt) act('rt', scope);
  triggerWas = { lt: lt > TRIGGER_ON, rt: rt > TRIGGER_ON };

  // Directions, with a pause before a held one starts repeating.
  const direction = currentDirection(pad, custom);
  heldWait -= seconds;
  if (direction && direction !== heldDirection) {
    act(direction, scope, false);
    heldWait = FIRST_REPEAT;
  } else if (direction && heldWait <= 0) {
    act(direction, scope, true);
    heldWait = REPEAT;
  }
  heldDirection = direction;

  const axes = pad.axes;
  if (custom && scope) {
    const left = shape(axes[0] ?? 0, axes[1] ?? 0, RAW_DEADZONE);
    const right = shape(axes[2] ?? 0, axes[3] ?? 0, RAW_DEADZONE);
    const detail: PadStickDetail = { lx: left.x, ly: left.y, rx: right.x, ry: right.y, lt, rt, seconds };
    scope.dispatchEvent(new CustomEvent<PadStickDetail>('padstick', { detail }));
  } else {
    const right = shape(axes[2] ?? 0, axes[3] ?? 0, SCROLL_DEADZONE);
    if (right.x !== 0 || right.y !== 0) scrollBy(scope, right.x * SCROLL_SPEED * seconds, right.y * SCROLL_SPEED * seconds);
  }

  remember(pads);
}

function remember(pads: Gamepad[]): void {
  for (const each of pads) wasDown.set(each.index, each.buttons.map((button) => button.pressed));
}

function pressed(pad: Gamepad, button: number): boolean {
  return !!pad.buttons[button]?.pressed && !wasDown.get(pad.index)?.[button];
}

function currentDirection(pad: Gamepad, customScope = false): Direction | null {
  const held = (button: number) => !!pad.buttons[button]?.pressed;
  if (held(B.up)) return 'up';
  if (held(B.down)) return 'down';
  if (held(B.left)) return 'left';
  if (held(B.right)) return 'right';
  if (customScope) return null;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.hypot(x, y) < STICK_DEADZONE) return null;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

function shape(x: number, y: number, deadzone: number): { x: number; y: number } {
  const size = Math.hypot(x, y);
  if (size <= deadzone) return { x: 0, y: 0 };
  const amount = Math.min(1, (size - deadzone) / (1 - deadzone)) ** 1.6;
  return { x: (x / size) * amount, y: (y / size) * amount };
}

// ---------- scopes and items ----------

function isShown(element: Element): boolean {
  if (!element.isConnected) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const html = element as HTMLElement & { checkVisibility?: (options?: Record<string, boolean>) => boolean };
  if (typeof html.checkVisibility === 'function') {
    if (!html.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findScope(): HTMLElement | null {
  const scopes = [...document.querySelectorAll<HTMLElement>('[data-pad-scope]')].filter(isShown);
  if (scopes.length === 0) return null;
  // Innermost first: a scope holding another visible scope gives way to it.
  const leaves = scopes.filter((scope) => !scopes.some((other) => other !== scope && scope.contains(other)));
  return leaves[leaves.length - 1];
}

function scopeRoot(scope: HTMLElement | null): HTMLElement {
  return scope ?? document.body;
}

/** True when the element belongs to this scope and not to a scope nested inside it. */
function ownedBy(element: Element, scope: HTMLElement | null): boolean {
  const owner = element.closest('[data-pad-scope]');
  if (scope) return owner === scope;
  return owner === null || !isShown(owner);
}

function items(scope: HTMLElement | null): HTMLElement[] {
  const root = scopeRoot(scope);
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[data-pad-skip]') && ownedBy(element, scope) && isShown(element),
  );
}

function focusedIn(scope: HTMLElement | null): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || active === document.documentElement) return null;
  const root = scopeRoot(scope);
  if (!root.contains(active) || !isShown(active)) return null;
  if (scope && !scope.contains(active)) return null;
  return active;
}

function defaultItem(scope: HTMLElement | null): HTMLElement | null {
  const all = items(scope);
  const marked = all.find((element) => element.hasAttribute('data-pad-default'));
  if (marked) return marked;
  // A nested default that is not itself focusable, such as a wrapper.
  const wrapper = scopeRoot(scope).querySelector<HTMLElement>('[data-pad-default]');
  if (wrapper && ownedBy(wrapper, scope)) {
    const inside = all.find((element) => wrapper.contains(element));
    if (inside) return inside;
  }
  return all[0] ?? null;
}

function onScopeChange(from: Element | null | undefined, to: HTMLElement | null): void {
  const active = document.activeElement as HTMLElement | null;
  if (from !== undefined && active && active !== document.body) rememberedFocus.set(from ?? document, active);
  lastScope = to;
  // The very first look at the page is not a change: the first press only shows the highlight.
  if (from === undefined || getInputDevice() === 'keyboard') return;
  // A newly opened modal gets the highlight straight away; a closed one hands it back.
  if (focusedIn(to)) return;
  const back = rememberedFocus.get(to ?? document);
  if (back && back.isConnected && isShown(back) && ownedBy(back, to)) focusItem(back, false, true);
  else if (to) {
    const first = defaultItem(to);
    if (first) focusItem(first, false, true);
  }
}

/** When a page change removes the highlighted item, the highlight moves to the new page's default. */
function recoverLostFocus(scope: HTMLElement | null): void {
  const current = focusedIn(scope);
  if (current) {
    lastFocused = current;
    return;
  }
  if (!lastFocused || lastFocused.isConnected) return;
  lastFocused = null;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const first = defaultItem(scope);
  if (first) focusItem(first, false, true);
}

function focusItem(element: HTMLElement, withSound: boolean, instant = false): void {
  if (element.hasAttribute('data-pad-item') && !element.hasAttribute('tabindex') && element.tabIndex < 0) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus({ preventScroll: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = reduce || instant ? 'instant' : 'smooth';
  if (nearPageTop(element)) window.scrollTo({ top: 0, behavior });
  else element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
  if (withSound) sound.play('hover');
  glide();
}

// ---------- actions ----------

function act(action: PadNavAction, scope: HTMLElement | null, repeat = false): void {
  const event = new CustomEvent<PadNavDetail>('padnav', { detail: { action, repeat, scope }, cancelable: true });
  window.dispatchEvent(event);
  if (event.defaultPrevented) return;

  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      direction(action, scope);
      break;
    case 'confirm':
      confirm(scope);
      break;
    case 'back':
      back(scope);
      break;
    case 'x':
    case 'y':
      pressMarked(scope, `data-pad-${action}`);
      break;
    case 'tabPrev':
      switchTab(scope, -1);
      break;
    case 'tabNext':
      switchTab(scope, 1);
      break;
    case 'start':
      window.dispatchEvent(new Event('padstart'));
      break;
    default:
      break;
  }
}

function direction(where: Direction, scope: HTMLElement | null): void {
  const current = focusedIn(scope);
  if (!current) {
    const first = defaultItem(scope);
    if (first) focusItem(first, true);
    return;
  }
  if (where === 'left' || where === 'right') {
    const step = where === 'left' ? -1 : 1;
    if (adjust(current, step)) return;
  }
  if (!move(where)) {
    // Nothing more that way: scroll, so long pages can still be read to the end.
    if (where === 'up' || where === 'down') scrollBy(scope, 0, (where === 'up' ? -1 : 1) * window.innerHeight * 0.35, true);
  }
}

function adjust(current: HTMLElement, step: -1 | 1): boolean {
  const target = current.closest<HTMLElement>('[data-pad-adjust]');
  if (target) {
    target.dispatchEvent(new CustomEvent('padadjust', { detail: { step }, bubbles: true, cancelable: true }));
    return true;
  }
  if (current instanceof HTMLInputElement && current.type === 'range') {
    const min = Number(current.min || 0);
    const max = Number(current.max || 100);
    const stepSize = current.step === 'any' ? (max - min) / 20 : Number(current.step) || 1;
    const next = Math.min(max, Math.max(min, Number(current.value) + step * stepSize));
    setNativeValue(current, String(next));
    return true;
  }
  if (current instanceof HTMLSelectElement) {
    const options = [...current.options];
    let index = current.selectedIndex;
    do index += step;
    while (index >= 0 && index < options.length && options[index].disabled);
    if (index >= 0 && index < options.length) {
      setNativeValue(current, options[index].value);
      sound.play('hover');
    }
    return true;
  }
  return false;
}

/** Sets a form value the way typing would, so React's onChange sees it. */
function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function move(where: Direction): boolean {
  const scope = findScope();
  const current = focusedIn(scope);
  const all = items(scope);
  if (!current) {
    const first = defaultItem(scope);
    if (first) focusItem(first, true);
    return !!first;
  }
  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const element of all) {
    if (element === current || element.contains(current) || current.contains(element)) continue;
    const to = element.getBoundingClientRect();
    const tx = to.left + to.width / 2;
    const ty = to.top + to.height / 2;
    let along: number;
    let across: number;
    let centerAcross: number;
    if (where === 'down' || where === 'up') {
      const down = where === 'down';
      if (down ? ty <= fy + 1 : ty >= fy - 1) continue;
      along = down ? to.top - from.bottom : from.top - to.bottom;
      if (along < -Math.min(from.height, to.height) / 2) continue;
      across = Math.max(0, to.left - from.right, from.left - to.right);
      centerAcross = Math.abs(tx - fx);
    } else {
      const right = where === 'right';
      if (right ? tx <= fx + 1 : tx >= fx - 1) continue;
      along = right ? to.left - from.right : from.left - to.left - to.width;
      if (along < -Math.min(from.width, to.width) / 2) continue;
      across = Math.max(0, to.top - from.bottom, from.top - to.bottom);
      centerAcross = Math.abs(ty - fy);
    }
    // Things in line count for much more than things that are merely close.
    const score = Math.max(0, along) + across * 4 + centerAcross * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }
  if (!best) return false;
  focusItem(best, true);
  return true;
}

function confirm(scope: HTMLElement | null): void {
  const current = focusedIn(scope);
  if (!current) {
    const first = defaultItem(scope);
    if (first) focusItem(first, true);
    return;
  }
  if (isTextField(current)) {
    current.focus();
    showPadNote('Typing needs a keyboard.');
    return;
  }
  if (current instanceof HTMLSelectElement) {
    showPadNote('Press left or right to change this.');
    return;
  }
  current.click();
}

function isTextField(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type);
  return (element as HTMLElement).isContentEditable;
}

function ownMarked(scope: HTMLElement | null, attribute: string): HTMLElement | null {
  const root = scopeRoot(scope);
  const found = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].filter(
    (element) => ownedBy(element, scope) && isShown(element) && !(element as HTMLButtonElement).disabled,
  );
  return found[found.length - 1] ?? null;
}

function pressMarked(scope: HTMLElement | null, attribute: string): boolean {
  const target = ownMarked(scope, attribute);
  if (!target) return false;
  target.click();
  return true;
}

function back(scope: HTMLElement | null): void {
  if (pressMarked(scope, 'data-pad-back')) return;
  const target: EventTarget = scope ?? document;
  const event = new CustomEvent('padback', { cancelable: true, bubbles: false });
  target.dispatchEvent(event);
  if (event.defaultPrevented) return;
  if (location.pathname.startsWith('/play')) return;
  // Only within this site: react-router counts its own history entries.
  const index = (history.state as { idx?: number } | null)?.idx ?? 0;
  if (index > 0) history.back();
}

function switchTab(scope: HTMLElement | null, step: -1 | 1): void {
  const root = scopeRoot(scope);
  const tabs = [...root.querySelectorAll<HTMLElement>('[data-pad-tab]')].filter(
    (element) => ownedBy(element, scope) && isShown(element) && !(element as HTMLButtonElement).disabled,
  );
  if (tabs.length === 0) return;
  const active = document.activeElement;
  let index = tabs.findIndex(
    (tab) =>
      tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('aria-current') === 'page' ||
      tab.getAttribute('aria-pressed') === 'true' ||
      tab.classList.contains('active') ||
      tab.classList.contains('is-active'),
  );
  if (index < 0) index = tabs.findIndex((tab) => tab === active || tab.contains(active));
  const next = tabs[index < 0 ? 0 : (index + step + tabs.length) % tabs.length];
  if (next === tabs[index]) return;
  next.click();
  focusItem(next, false);
}

/**
 * True for an item in the page's first screen that scrolls with the page itself. Coming back up to it shows
 * the very top of the page (a hero's title, a page heading) rather than leaving the item flush under the bar.
 */
function nearPageTop(element: HTMLElement): boolean {
  if (window.scrollY <= 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.bottom + window.scrollY > window.innerHeight * 0.8) return false;
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    if (scrollable(node)) return false;
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return false;
  }
  return true;
}

function scrollable(element: Element): boolean {
  const style = getComputedStyle(element);
  return /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX) &&
    (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
}

function scrollBy(scope: HTMLElement | null, x: number, y: number, smooth = false): void {
  let target: Element | null = focusedIn(scope) ?? scope;
  while (target && target !== document.body && target !== document.documentElement) {
    if (scrollable(target)) break;
    if (scope && target === scope) {
      target = null;
      break;
    }
    target = target.parentElement;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = smooth && !reduce ? 'smooth' : 'instant';
  if (target && target !== document.body && target !== document.documentElement) target.scrollBy({ left: x, top: y, behavior });
  // A fixed overlay with nothing to scroll must not scroll the page hidden behind it.
  else if (!scope || getComputedStyle(scope).position !== 'fixed') window.scrollBy({ left: x, top: y, behavior });
}

// ---------- the highlight that glides between items ----------

function ensureRing(): HTMLDivElement {
  if (ring) return ring;
  ring = document.createElement('div');
  ring.className = 'pad-ring';
  ring.setAttribute('aria-hidden', 'true');
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const span = document.createElement('span');
    span.className = `pad-ring__corner pad-ring__corner--${corner}`;
    ring.appendChild(span);
  }
  const pointer = document.createElement('span');
  pointer.className = 'pad-ring__pointer';
  ring.appendChild(pointer);
  document.body.appendChild(ring);
  return ring;
}

/** Where the ring and the note live: inside the open modal dialog if there is one (it is in the top layer), else body. */
function overlayHost(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const dialog = dialogs[i];
    try {
      if (dialog.matches(':modal')) return dialog;
    } catch {
      return dialog;
    }
  }
  return document.body;
}

function glide(): void {
  const element = ensureRing();
  element.classList.add('pad-ring--glide');
  window.clearTimeout(glideTimer);
  glideTimer = window.setTimeout(() => element.classList.remove('pad-ring--glide'), 220);
}

function updateRing(): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement as HTMLElement | null;
  const show =
    getInputDevice() !== 'keyboard' &&
    !gameActive &&
    !!active &&
    active !== document.body &&
    active !== document.documentElement &&
    !active.hasAttribute('data-pad-noring') &&
    !active.closest('[data-pad-skip]') &&
    isShown(active);
  if (!show) {
    if (ring) ring.classList.remove('pad-ring--on');
    ringTarget = null;
    return;
  }
  const element = ensureRing();
  const host = overlayHost();
  if (element.parentElement !== host) host.appendChild(element);
  const rect = active.getBoundingClientRect();
  const offscreen = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
  if (active !== ringTarget) {
    if (!ringTarget) element.classList.remove('pad-ring--glide');
    ringTarget = active;
  }
  const pad = 6;
  element.style.transform = `translate(${Math.round(rect.left - pad)}px, ${Math.round(rect.top - pad)}px)`;
  element.style.width = `${Math.round(rect.width + pad * 2)}px`;
  element.style.height = `${Math.round(rect.height + pad * 2)}px`;
  element.classList.toggle('pad-ring--on', !offscreen);
}
