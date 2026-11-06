import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_AVATAR_BYTES } from './avatars.js';

/** Fantasy icons from game-icons.net, stored in the repo so they work with no network. */
export const EMBLEMS = [
  'black-knight-helm',
  'visored-helm',
  'overlord-helm',
  'spartan',
  'warlord-helmet',
  'crowned-skull',
  'horned-skull',
  'hooded-figure',
  'warlock-hood',
  'cultist',
  'grim-reaper',
  'wolf-head',
  'dragon-head',
  'raven',
  'vampire-dracula',
  'wizard-face',
] as const;

const DICEBEAR_BASE = 'https://api.dicebear.com/10.x';

/** Only styles DiceBear lists as CC0, so nothing here needs attribution. */
export const DICEBEAR_STYLES = [
  { id: 'pixel-art', label: 'Pixel heroes', params: 'backgroundColor=1a1510' },
  { id: 'identicon', label: 'Patterns', params: 'backgroundColor=14110e&rowColor=e3c88a' },
  { id: 'rings', label: 'Rings', params: 'backgroundColor=14110e&ringColor=e3c88a' },
  {
    id: 'shapes',
    label: 'Shapes',
    params: 'backgroundColor=14110e&shape1Color=e3c88a&shape2Color=8a6a2f&shape3Color=3d3020',
  },
] as const;

const SEED_PATTERN = /^[A-Za-z0-9]{1,32}$/;
// GitHub's own rule for usernames. It leaves no way to alter the URL built from it.
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const DOWNLOAD_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;

export class AvatarSourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Fetches an image without trusting the remote server's redirects. Each hop must be HTTPS
 * to an expected host, so nothing can steer this at internal addresses (SSRF).
 */
async function downloadImage(startUrl: string, allowedHosts: ReadonlySet<string>): Promise<Response> {
  let url = new URL(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      throw new AvatarSourceError(502, "Couldn't get that picture. Please try again.");
    }
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new AvatarSourceError(502, "Couldn't get that picture. Please try again.");
}

/** Stops reading as soon as the limit is passed, so a huge response is never held in memory. */
async function readImageBody(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_AVATAR_BYTES || !response.body) {
    throw new AvatarSourceError(413, 'That image is too large.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_AVATAR_BYTES) {
      await reader.cancel();
      throw new AvatarSourceError(413, 'That image is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Network failures and timeouts become a friendly message rather than a 500. */
async function fromService<T>(service: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof AvatarSourceError) throw err;
    throw new AvatarSourceError(502, `Couldn't reach ${service}. Please try again.`);
  }
}

export function fetchDiceBearAvatar(style: unknown, seed: unknown): Promise<Buffer> {
  const definition = DICEBEAR_STYLES.find((item) => item.id === style);
  if (!definition) throw new AvatarSourceError(400, "That picture style isn't available. Please choose another.");
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) {
    throw new AvatarSourceError(400, "That picture isn't available. Please choose another.");
  }
  const url = `${DICEBEAR_BASE}/${definition.id}/png?size=256&seed=${seed}&${definition.params}`;
  return fromService('the avatar service', async () => {
    const response = await downloadImage(url, new Set(['api.dicebear.com']));
    if (!response.ok) throw new AvatarSourceError(502, "Couldn't get that avatar. Please try again.");
    return readImageBody(response);
  });
}

export function fetchGitHubAvatar(login: unknown): Promise<Buffer> {
  if (typeof login !== 'string' || !GITHUB_LOGIN_PATTERN.test(login)) {
    throw new AvatarSourceError(400, "That doesn't look like a GitHub username.");
  }
  const url = `https://github.com/${login}.png?size=256`;
  return fromService('GitHub', async () => {
    const response = await downloadImage(url, new Set(['github.com', 'avatars.githubusercontent.com']));
    if (response.status === 404) {
      throw new AvatarSourceError(404, 'No GitHub account has that username.');
    }
    if (!response.ok) throw new AvatarSourceError(502, "Couldn't get that picture from GitHub.");
    return readImageBody(response);
  });
}

/** Draws an emblem in gold on a dark background, as a PNG. */
export async function renderEmblem(emblem: unknown, publicDir: string): Promise<Buffer> {
  if (typeof emblem !== 'string' || !(EMBLEMS as readonly string[]).includes(emblem)) {
    throw new AvatarSourceError(400, "That icon isn't available. Please choose another.");
  }
  const source = await readFile(path.join(publicDir, 'icons', `${emblem}.svg`), 'utf8');
  const shapes = source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6ecd2"/>
        <stop offset=".5" stop-color="#d9b872"/>
        <stop offset="1" stop-color="#8a6a2f"/>
      </linearGradient>
      <radialGradient id="glow" cx=".5" cy=".42" r=".7">
        <stop offset="0" stop-color="#3a2d17"/>
        <stop offset="1" stop-color="#0b0a08"/>
      </radialGradient>
    </defs>
    <rect width="512" height="512" fill="url(#glow)"/>
    <g transform="translate(77 77) scale(.7)" fill="url(#gold)">${shapes.replaceAll('fill="#fff"', '')}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
}
