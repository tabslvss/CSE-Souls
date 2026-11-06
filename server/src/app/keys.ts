import { existsSync, readFileSync } from 'node:fs';
import { PUBLIC_KEY_PATH } from '../shared/jwt.js';

const WAIT_LIMIT_MS = 60_000;

/** compose.yml starts auth first, but a short wait covers a slow first-boot key generation. */
export async function loadPublicKey(): Promise<string> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (!existsSync(PUBLIC_KEY_PATH)) {
    if (Date.now() > deadline) throw new Error(`Public key never appeared at ${PUBLIC_KEY_PATH}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return readFileSync(PUBLIC_KEY_PATH, 'utf8');
}
