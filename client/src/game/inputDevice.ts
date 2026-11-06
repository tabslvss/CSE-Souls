/** Which controls the player is using right now, so the screen can show the matching button pictures. */
export type InputDevice = 'keyboard' | 'playstation' | 'xbox';

/** Mouse movement smaller than this is a bumped desk, not someone switching back to the mouse. */
const MOUSE_SWITCH_PIXELS = 6;

let device: InputDevice = 'keyboard';
const listeners = new Set<() => void>();

/** Browsers only tell us a controller's name, so anything not recognized as PlayStation shows Xbox buttons. */
export function padFamily(id: string): 'playstation' | 'xbox' {
  return /playstation|dualsense|dualshock|sony|054c|wireless controller/i.test(id) ? 'playstation' : 'xbox';
}

export function getInputDevice(): InputDevice {
  return device;
}

export function setInputDevice(next: InputDevice): void {
  if (next === device) return;
  device = next;
  listeners.forEach((listener) => listener());
}

function useKeyboard(): void {
  setInputDevice('keyboard');
}

function onMouseMove(event: MouseEvent): void {
  if (Math.abs(event.movementX) + Math.abs(event.movementY) > MOUSE_SWITCH_PIXELS) setInputDevice('keyboard');
}

function onPadConnected(event: GamepadEvent): void {
  if (event.gamepad.mapping === 'standard') setInputDevice(padFamily(event.gamepad.id));
}

function onPadDisconnected(): void {
  const left = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].some((pad) => pad?.connected) : false;
  if (!left) setInputDevice('keyboard');
}

function attach(): void {
  window.addEventListener('keydown', useKeyboard);
  window.addEventListener('mousedown', useKeyboard);
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('gamepadconnected', onPadConnected);
  window.addEventListener('gamepaddisconnected', onPadDisconnected);
}

function detach(): void {
  window.removeEventListener('keydown', useKeyboard);
  window.removeEventListener('mousedown', useKeyboard);
  document.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('gamepadconnected', onPadConnected);
  window.removeEventListener('gamepaddisconnected', onPadDisconnected);
}

export function subscribeInputDevice(listener: () => void): () => void {
  if (listeners.size === 0) attach();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}
