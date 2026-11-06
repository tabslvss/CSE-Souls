/*
 * The player's VHS choice, kept apart from the renderer so the web pages can read it without
 * loading three.js. 0 is off and 1 is on. On unless they turned it off.
 */
const KEY = 'cse-souls-vhs';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

let enabled = read();

function mark(): void {
  // vhs.css keys off this, so the page overlay follows the same setting.
  document.documentElement.dataset.vhs = enabled ? 'on' : 'off';
}
mark();

export function vhsEnabled(): boolean {
  return enabled;
}

export function setVhsEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Private browsing can refuse storage. The choice still lasts for this page.
  }
  mark();
}
