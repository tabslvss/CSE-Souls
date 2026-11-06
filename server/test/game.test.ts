/**
 * End-to-end game checks against the running stack, through nginx, the way a browser would
 * reach it. Start the stack first with `docker compose up`, then run
 * `node --import tsx --test test/game.test.ts` from the server folder.
 * Every run registers fresh random accounts. Other people may be in the world at the same
 * time, so everything here looks up players by id or username.
 */
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import {
  APPEARANCE_LIMITS,
  CLASSES,
  DEFAULT_APPEARANCE,
  STAT_KEYS,
  type Appearance,
  type ClassId,
} from '../../shared/classes.js';
import { MAP } from '../../shared/mapData.js';
import {
  FLAG_DODGE,
  FLAG_RUN,
  MAX_FLAGS,
  WS_CLOSE_ABUSE,
  WS_CLOSE_REPLACED,
  type PlayerInfo,
  type PlayerSnapshot,
  type ServerMessage,
} from '../../shared/protocol.js';
import {
  createState,
  deriveStats,
  stepPlayer,
  TICK_DT,
  TICK_RATE,
  type Derived,
  type SimInput,
} from '../../shared/sim.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const ORIGIN = new URL(BASE).origin;
const WS_URL = `${BASE.replace(/^http/, 'ws')}/ws`;
const PASSWORD = 'Sw0rd&Sorcery!';

const STACK_WAIT_MS = 5 * 60_000;
const WAIT_MS = 5000;

// Limit private to the server.
const INPUT_BUDGET = 8;

// Stays well above the tick rate and under the limit of 120 messages per second.
const FLOOD_INTERVAL_MS = 12;
const FLOOD_MS = 2000;
// Room for timer and network jitter on top of the server's budget.
const SPEED_MARGIN_INPUTS = 15;

const PUBLIC_INFO_FIELDS = ['appearance', 'avatarUrl', 'classId', 'id', 'level', 'stats', 'username'];
const SNAPSHOT_LENGTH = 20;

type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
type Snapshot = Extract<ServerMessage, { t: 's' }>;
type Join = Extract<ServerMessage, { t: 'join' }>;
type Leave = Extract<ServerMessage, { t: 'leave' }>;
type NoCharacter = Extract<ServerMessage, { t: 'no_character' }>;

/** Minimal cookie-keeping browser. */
class Client {
  cookies = new Map<string, string>();

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', this.cookieHeader());
    let response = await fetch(BASE + path, { redirect: 'manual', ...init, headers });
    // Other suites share this IP address and nginx's request budget.
    for (let attempt = 0; response.status === 429 && attempt < 5; attempt += 1) {
      await sleep(1000);
      response = await fetch(BASE + path, { redirect: 'manual', ...init, headers });
    }
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async guestToken(): Promise<string> {
    const response = await this.fetch('/auth/xsrf');
    return ((await response.json()) as { token: string }).token;
  }

  async authPost(path: string, body: unknown): Promise<Response> {
    const token = await this.guestToken();
    return this.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': token },
      body: JSON.stringify(body),
    });
  }

  async sessionXsrf(): Promise<string> {
    const response = await this.fetch('/api/session');
    return ((await response.json()) as { xsrfToken: string }).xsrfToken;
  }
}

interface Account {
  client: Client;
  username: string;
}

interface Profile {
  username: string;
  classId: string | null;
  level: number;
  binaryDust: number;
  stats: Record<string, number>;
}

function freshName(): string {
  return `t${randomBytes(6).toString('hex')}`;
}

async function registered(username = freshName()): Promise<Account> {
  const client = new Client();
  const response = await client.authPost('/register', { username, password: PASSWORD });
  assert.equal(response.status, 201, `registering ${username}: ${await response.text()}`);
  return { client, username };
}

function postCharacterRaw(client: Client, token: string, body: string, type = 'application/json'): Promise<Response> {
  return client.fetch('/api/character', {
    method: 'POST',
    headers: { 'Content-Type': type, 'X-XSRF-Token': token },
    body,
  });
}

function postCharacter(client: Client, token: string, body: unknown): Promise<Response> {
  return postCharacterRaw(client, token, JSON.stringify(body));
}

async function getJson<T>(client: Client, path: string): Promise<T> {
  const response = await client.fetch(path);
  assert.equal(response.status, 200, `GET ${path}`);
  return (await response.json()) as T;
}

async function assertNoCharacter(client: Client, context: string): Promise<void> {
  const { character } = await getJson<{ character: unknown }>(client, '/api/character');
  assert.equal(character, null, `${context}: /api/character should still be null`);
  const { user } = await getJson<{ user: { hasCharacter: boolean } }>(client, '/api/session');
  assert.equal(user.hasCharacter, false, `${context}: hasCharacter should still be false`);
}

async function withCharacter(classId: ClassId, appearance: Partial<Appearance> = {}): Promise<Account> {
  const account = await registered();
  const response = await postCharacter(account.client, await account.client.sessionXsrf(), { classId, appearance });
  assert.equal(response.status, 200, `saving a ${classId}: ${await response.text()}`);
  return account;
}

// Sockets close at the end of each test, so these accounts can be reused by the next one.
const sharedAccounts = new Map<ClassId, Promise<Account>>();
function shared(classId: ClassId): Promise<Account> {
  let account = sharedAccounts.get(classId);
  if (!account) {
    account = withCharacter(classId);
    sharedAccounts.set(classId, account);
  }
  return account;
}
const hero = () => shared('ranger');
const rival = () => shared('juggernaut');
const witness = () => shared('arcanist');

const openSockets = new Set<GameSocket>();

/** A game connection that records everything it receives, so no wait can miss a message. */
class GameSocket {
  readonly socket: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  closeEvent: { code: number; reason: string } | null = null;
  welcome!: Welcome;
  private wakers: Array<() => void> = [];

  constructor(url: string, headers: Record<string, string>) {
    this.socket = new WebSocket(url, { headers });
    this.socket.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      this.messages.push(JSON.parse(text) as ServerMessage);
      this.wake();
    });
    this.socket.on('close', (code, reason) => {
      this.closeEvent = { code, reason: reason.toString() };
      openSockets.delete(this);
      this.wake();
    });
    // A refused handshake rejects in connect(), and a broken socket shows up as a close.
    this.socket.on('error', () => undefined);
  }

  get you(): number {
    return this.welcome.you;
  }

  get me(): PlayerInfo {
    const me = this.welcome.players.find((player) => player.id === this.you);
    assert.ok(me, `welcome.players should include you (${this.you})`);
    return me;
  }

  /** The position in the message list, for waiting on something that arrives after now. */
  mark(): number {
    return this.messages.length;
  }

  input(seq: number, mx: number, mz: number, yaw = 0, flags = 0): void {
    this.socket.send(JSON.stringify({ t: 'i', d: [seq, mx, mz, yaw, flags] }));
  }

  snapshots(): Snapshot[] {
    return this.messages.filter((message): message is Snapshot => message.t === 's');
  }

  private wake(): void {
    for (const waker of this.wakers.splice(0)) waker();
  }

  private changed(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.wakers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private summary(): string {
    const others = this.messages.filter((message) => message.t !== 's');
    const lastAck = this.snapshots().at(-1)?.a;
    return `Got ${this.messages.length} messages, last ack ${lastAck}, others ${JSON.stringify(others).slice(0, 500)}`;
  }

  async waitFor<T extends ServerMessage>(
    label: string,
    match: (message: ServerMessage) => message is T,
    since = 0,
    timeoutMs = WAIT_MS,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let index = since;
    for (;;) {
      for (; index < this.messages.length; index += 1) {
        const message = this.messages[index];
        if (match(message)) return message;
      }
      if (this.closeEvent) {
        throw new Error(`${label}: socket closed with code ${this.closeEvent.code} first. ${this.summary()}`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`${label}: nothing after ${timeoutMs}ms. ${this.summary()}`);
      await this.changed(remaining);
    }
  }

  snapshot(label: string, match: (item: Snapshot) => boolean = () => true, since = 0): Promise<Snapshot> {
    return this.waitFor(label, (item): item is Snapshot => item.t === 's' && match(item), since);
  }

  nextSnapshot(label: string): Promise<Snapshot> {
    return this.snapshot(label, undefined, this.mark());
  }

  joinOf(id: number, since = 0): Promise<Join> {
    return this.waitFor(`join for player ${id}`, (item): item is Join => item.t === 'join' && item.player.id === id, since);
  }

  leaveOf(id: number, since = 0): Promise<Leave> {
    return this.waitFor(`leave for player ${id}`, (item): item is Leave => item.t === 'leave' && item.id === id, since);
  }

  async waitForClose(label: string, timeoutMs = WAIT_MS): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closeEvent) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`${label}: still open after ${timeoutMs}ms. ${this.summary()}`);
      await this.changed(remaining);
    }
    return this.closeEvent;
  }

  async shutdown(): Promise<void> {
    if (this.closeEvent) return;
    this.socket.close();
    await this.waitForClose('closing at the end of a test', 1000).catch(() => this.socket.terminate());
  }
}

const RECONNECT_WAIT_MS = 500;

interface ConnectOptions {
  search?: string;
  headers?: Record<string, string>;
}

/** Tests reconnect far faster than a person would, so they wait out the server's reconnect limit. */
const lastConnect = new Map<Client, number>();

async function connect(client: Client, options: ConnectOptions = {}): Promise<GameSocket> {
  const wait = (lastConnect.get(client) ?? 0) + RECONNECT_WAIT_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastConnect.set(client, Date.now());
  return new Promise((resolve, reject) => {
    const game = new GameSocket(`${WS_URL}${options.search ?? ''}`, {
      Origin: ORIGIN,
      Cookie: client.cookieHeader(),
      ...options.headers,
    });
    game.socket.once('open', () => {
      openSockets.add(game);
      resolve(game);
    });
    game.socket.once('unexpected-response', (_req, res) => {
      reject(new Error(`WebSocket handshake refused with status ${res.statusCode}`));
      game.socket.terminate();
    });
    game.socket.once('error', reject);
  });
}

/** Connects and waits to be in the world. The welcome always comes first. */
async function enter(account: Account, options: ConnectOptions = {}): Promise<GameSocket> {
  const game = await connect(account.client, options);
  game.welcome = await game.waitFor(
    `welcome for ${account.username}`,
    (item): item is Welcome => item.t === 'welcome',
  );
  assert.equal(game.messages[0]?.t, 'welcome', 'the first message should be the welcome');
  return game;
}

async function closeAllSockets(): Promise<void> {
  await Promise.all([...openSockets].map((game) => game.shutdown()));
}

function entryFor(entries: PlayerSnapshot[], id: number): PlayerSnapshot | undefined {
  return entries.find((entry) => entry[0] === id);
}

function mustEntry(entries: PlayerSnapshot[], id: number, context: string): PlayerSnapshot {
  const entry = entryFor(entries, id);
  assert.ok(entry, `${context}: player ${id} missing from ${JSON.stringify(entries)}`);
  return entry;
}

function assertClose(actual: number, expected: number, label: string, tolerance = 0.01): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected about ${expected}, got ${actual}`);
}

function assertNumericEntry(entry: PlayerSnapshot, context: string): void {
  assert.equal(entry.length, SNAPSHOT_LENGTH, `${context}: snapshot entry length, got ${JSON.stringify(entry)}`);
  for (const [index, value] of entry.entries()) {
    assert.ok(
      typeof value === 'number' && Number.isFinite(value),
      `${context}: snapshot field ${index} should be a finite number, got ${JSON.stringify(entry)}`,
    );
  }
}

/** Top running speed in units per second, which is moveSpeed times the run multiplier. */
function legalRunSpeed(derived: Derived): number {
  // Measured in the open, since the shared rules also apply the map's colliders.
  const state = createState(0, 0, derived);
  let best = 0;
  for (const x of [0, 40, -40, 80, -80, 120, -120, 160, -160]) {
    state.x = x;
    state.z = MAP.spawn.z;
    stepPlayer(state, { seq: 1, mx: 1, mz: 0, yaw: 0, run: true, dodge: false, attack: false, potion: false }, derived);
    best = Math.max(best, Math.abs(state.x - x) / TICK_DT);
    state.stamina = derived.maxStamina;
  }
  return best;
}

/** The direction from here that the shared rules let a runner go the farthest, for tests that need room. */
function openDirection(x: number, z: number, derived: Derived): [number, number] {
  let best: [number, number] = [1, 0];
  let farthest = -1;
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    const mx = Math.sin(angle);
    const mz = Math.cos(angle);
    const state = createState(x, z, derived);
    for (let step = 0; step < TICK_RATE * 4; step += 1) {
      stepPlayer(state, { seq: step, mx, mz, yaw: 0, run: true, dodge: false, attack: false, potion: false }, derived);
      state.stamina = derived.maxStamina;
    }
    const distance = Math.hypot(state.x - x, state.z - z);
    if (distance > farthest) {
      farthest = distance;
      best = [mx, mz];
    }
  }
  return best;
}

function sessionClaims(client: Client): { sub: string; xsrf: string; username: string } {
  const claims = jwt.decode(client.cookies.get('session') ?? '');
  assert.ok(claims && typeof claims === 'object', 'the session cookie should hold a JWT');
  return claims as { sub: string; xsrf: string; username: string };
}

function assertPublicInfo(info: PlayerInfo, username: string, classId: ClassId, context: string): void {
  assert.deepEqual(Object.keys(info).sort(), PUBLIC_INFO_FIELDS, `${context}: player info fields`);
  assert.ok(Number.isInteger(info.id) && info.id > 0, `${context}: id should be a small integer, got ${info.id}`);
  assert.equal(info.username, username, `${context}: username`);
  assert.equal(info.classId, classId, `${context}: classId`);
  assert.deepEqual(Object.keys(info.stats).sort(), [...STAT_KEYS].sort(), `${context}: stats fields`);
  assert.deepEqual(
    Object.keys(info.appearance).sort(),
    Object.keys(APPEARANCE_LIMITS).sort(),
    `${context}: appearance fields`,
  );
}

before(async () => {
  const deadline = Date.now() + STACK_WAIT_MS;
  let problem: unknown = 'no attempt made';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/classes`);
      if (response.ok) return;
      problem = `status ${response.status}`;
    } catch (err) {
      problem = err;
    }
    await sleep(2000);
  }
  throw new Error(`The stack at ${BASE} was not ready after 5 minutes: ${String(problem)}`);
});

describe('character API', () => {
  it('lists exactly the four classes', async () => {
    const response = await fetch(`${BASE}/api/classes`);
    assert.equal(response.status, 200);
    const { classes } = (await response.json()) as { classes: Array<{ id: string }> };
    assert.deepEqual(classes.map((item) => item.id).sort(), ['arcanist', 'duelist', 'juggernaut', 'ranger']);
    assert.deepEqual(classes, CLASSES, 'the served classes should match shared/classes.ts');
  });

  it('gives a new account no character', async () => {
    const { client, username } = await registered();
    await assertNoCharacter(client, 'new account');
    const { user } = await getJson<{ user: { username: string } }>(client, '/api/session');
    assert.equal(user.username, username);
    const profile = await getJson<Profile>(client, '/api/profile');
    assert.equal(profile.classId, null, 'a new profile should have no class');
  });

  it('needs a login to read or save a character', async () => {
    const anonymous = new Client();
    assert.equal((await anonymous.fetch('/api/character')).status, 401, 'GET with no session');
    const token = await anonymous.guestToken();
    const response = await postCharacter(anonymous, token, { classId: 'duelist', appearance: {} });
    assert.equal(response.status, 401, 'POST with only a guest XSRF token');
    const bare = await new Client().fetch('/api/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: 'duelist', appearance: {} }),
    });
    assert.equal(bare.status, 401, 'POST with no session and no token');
  });

  it('needs the XSRF token of this session to save', async () => {
    const { client } = await registered();
    const body = JSON.stringify({ classId: 'duelist', appearance: {} });
    const json = { 'Content-Type': 'application/json' };

    const missing = await client.fetch('/api/character', { method: 'POST', headers: json, body });
    assert.equal(missing.status, 403, 'no token');
    assert.equal((await postCharacterRaw(client, 'wrong', body)).status, 403, 'wrong token');
    assert.equal((await postCharacterRaw(client, await client.guestToken(), body)).status, 403, 'guest token');
    const other = await registered();
    assert.equal(
      (await postCharacterRaw(client, await other.client.sessionXsrf(), body)).status,
      403,
      "another account's token",
    );
    const crossSite = await client.fetch('/api/character', {
      method: 'POST',
      headers: { ...json, 'X-XSRF-Token': await client.sessionXsrf(), Origin: 'https://evil.example' },
      body,
    });
    assert.equal(crossSite.status, 403, 'right token from another site');

    await assertNoCharacter(client, 'after refused saves');
  });

  it('refuses invalid class ids', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    const badIds: unknown[] = [
      'wizard', '', 'DUELIST', ' duelist', '__proto__', 'constructor', null, 7, true, ['duelist'], { id: 'duelist' },
    ];
    for (const classId of badIds) {
      const response = await postCharacter(client, token, { classId, appearance: {} });
      assert.equal(response.status, 400, `classId ${JSON.stringify(classId)}`);
    }
    assert.equal((await postCharacter(client, token, { appearance: {} })).status, 400, 'missing classId');
    await assertNoCharacter(client, 'after invalid class ids');
  });

  it('refuses an appearance that is not an object', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    for (const appearance of [null, 'skin', '', 5, 0, true, false]) {
      const response = await postCharacter(client, token, { classId: 'duelist', appearance });
      assert.equal(response.status, 400, `appearance ${JSON.stringify(appearance)}`);
    }
    assert.equal((await postCharacter(client, token, { classId: 'duelist' })).status, 400, 'missing appearance');
    await assertNoCharacter(client, 'after non-object appearance');
  });

  it('refuses an array as the appearance', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    const response = await postCharacter(client, token, { classId: 'duelist', appearance: [] });
    assert.equal(response.status, 400, `appearance [] should be refused, body ${await response.text()}`);
    await assertNoCharacter(client, 'after array appearance');
  });

  it('refuses out-of-range and non-integer appearance values', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    for (const [key, limit] of Object.entries(APPEARANCE_LIMITS)) {
      for (const value of [limit, limit + 1000, -1, 0.5, '1', null, true, [1], {}]) {
        const response = await postCharacter(client, token, { classId: 'duelist', appearance: { [key]: value } });
        assert.equal(response.status, 400, `appearance.${key} = ${JSON.stringify(value)}`);
      }
    }
    const infinite = await postCharacterRaw(client, token, '{"classId":"duelist","appearance":{"skin":1e999}}');
    assert.equal(infinite.status, 400, 'appearance.skin = Infinity');
    await assertNoCharacter(client, 'after bad appearance values');
  });

  it('refuses bodies it cannot read', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    assert.equal((await postCharacterRaw(client, token, '{"classId":')).status, 400, 'broken JSON');
    assert.equal((await postCharacterRaw(client, token, '[]')).status, 400, 'JSON array');
    const text = await postCharacterRaw(client, token, 'classId=duelist', 'text/plain');
    assert.equal(text.status, 400, 'not JSON at all');
    const padding = 'x'.repeat(3000);
    const huge = await postCharacter(client, token, { classId: 'duelist', appearance: {}, padding });
    assert.equal(huge.status, 413, 'body over the 2kb limit');
    await assertNoCharacter(client, 'after unreadable bodies');
  });

  it('saves each class with its base stats', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    for (const definition of CLASSES) {
      const appearance = { body: 1, skin: 1, hair: 2, hairColor: 3, beard: 0, armor: 2, cloth: 3, headgear: 1, shoulders: 0, variant: 2 };
      const response = await postCharacter(client, token, { classId: definition.id, appearance });
      assert.equal(response.status, 200, `saving ${definition.id}`);
      assert.deepEqual(await response.json(), { classId: definition.id, appearance });

      const profile = await getJson<Profile>(client, '/api/profile');
      assert.equal(profile.classId, definition.id, 'profile class');
      assert.deepEqual(profile.stats, definition.baseStats, `${definition.id} base stats in /api/profile`);

      const { character } = await getJson<{ character: unknown }>(client, '/api/character');
      assert.deepEqual(character, { classId: definition.id, appearance }, 'GET /api/character');
      const { user } = await getJson<{ user: { hasCharacter: boolean } }>(client, '/api/session');
      assert.equal(user.hasCharacter, true, 'hasCharacter after saving');
    }
  });

  it('accepts the largest appearance values and fills in what is left out', async () => {
    const { client } = await registered();
    const token = await client.sessionXsrf();
    const largest = Object.fromEntries(Object.entries(APPEARANCE_LIMITS).map(([key, limit]) => [key, limit - 1]));
    const top = await postCharacter(client, token, { classId: 'arcanist', appearance: largest });
    assert.equal(top.status, 200, 'largest legal values');
    assert.deepEqual(((await top.json()) as { appearance: unknown }).appearance, largest);

    const partial = await postCharacter(client, token, { classId: 'arcanist', appearance: { skin: 3 } });
    assert.equal(partial.status, 200, 'partial appearance');
    assert.deepEqual(((await partial.json()) as { appearance: unknown }).appearance, { ...DEFAULT_APPEARANCE, skin: 3 });
  });

  it('stores only the known appearance fields and ignores everything else sent', async () => {
    const { client, username } = await registered();
    const token = await client.sessionXsrf();
    const earlier = await getJson<Profile>(client, '/api/profile');
    const body =
      '{"classId":"duelist","appearance":{"skin":2,"evil":"<script>","password_hash":"x","__proto__":{"armor":5}},' +
      '"username":"hacker","level":99,"binaryDust":1000000,"strength":999,"stats":{"strength":999,"speed":999}}';
    const response = await postCharacterRaw(client, token, body);
    assert.equal(response.status, 200, 'extra fields should be ignored, not refused');
    assert.deepEqual(await response.json(), {
      classId: 'duelist',
      appearance: { ...DEFAULT_APPEARANCE, skin: 2 },
    });

    const after = await getJson<Profile>(client, '/api/profile');
    assert.equal(after.username, username, 'username');
    assert.equal(after.level, earlier.level, 'level');
    assert.equal(after.binaryDust, earlier.binaryDust, 'binaryDust');
    assert.deepEqual(after.stats, CLASSES.find((item) => item.id === 'duelist')?.baseStats, 'stats');
  });
});

describe('entering the world', () => {
  afterEach(closeAllSockets);

  it('tells an account with no character and keeps it out of the world', async () => {
    const { client, username } = await registered();
    const watcher = await enter(await witness());
    const since = watcher.mark();

    const socket = await connect(client);
    await socket.waitFor('no_character', (item): item is NoCharacter => item.t === 'no_character');
    assert.deepEqual(socket.messages[0], { t: 'no_character' }, 'the only message should be no_character');
    await socket.waitForClose('socket with no character');
    assert.equal(socket.messages.length, 1, `nothing else should follow: ${socket.raw.join(' ')}`);

    await watcher.nextSnapshot('a snapshot after the refused player');
    const joined = watcher.messages.slice(since).filter((item) => item.t === 'join' && item.player.username === username);
    assert.deepEqual(joined, [], 'a player with no character should not join the world');
  });

  it('welcomes a player with their id, username, class and appearance', async () => {
    const appearance = { body: 0, skin: 5, hair: 3, hairColor: 5, beard: 1, armor: 7, cloth: 1, headgear: 1, shoulders: 1, variant: 2 };
    const account = await withCharacter('juggernaut', appearance);
    const socket = await enter(account);
    const definition = CLASSES.find((item) => item.id === 'juggernaut');

    assert.ok(Number.isInteger(socket.you) && socket.you > 0, `you should be a player id, got ${socket.you}`);
    assert.equal(socket.me.username, account.username);
    assert.equal(socket.me.username, sessionClaims(account.client).username, 'username should match the JWT');
    assert.equal(socket.me.classId, 'juggernaut');
    assert.deepEqual(socket.me.appearance, appearance);
    assert.deepEqual(socket.me.stats, definition?.baseStats);
    assert.equal(typeof socket.welcome.binaryDust, 'number');
    assert.deepEqual(socket.welcome.chests, [], 'a new account has opened no chests');
    assert.equal(socket.welcome.mapVersion, MAP.version);
    const spawn = mustEntry(socket.welcome.snapshot, socket.you, 'welcome');
    assert.ok(Math.hypot(spawn[1] - MAP.spawn.x, spawn[2] - MAP.spawn.z) < MAP.spawn.radius + 3, 'starts at the spawn point');
    assertNumericEntry(mustEntry(socket.welcome.snapshot, socket.you, 'welcome'), 'welcome');
  });

  it('uses the new class on the next connection after changing character', async () => {
    const account = await withCharacter('juggernaut');
    const first = await enter(account);
    assert.equal(first.me.classId, 'juggernaut');
    await first.shutdown();

    const token = await account.client.sessionXsrf();
    const response = await postCharacter(account.client, token, { classId: 'ranger', appearance: {} });
    assert.equal(response.status, 200);
    const second = await enter(account);
    assert.equal(second.me.classId, 'ranger');
    assert.deepEqual(second.me.stats, CLASSES.find((item) => item.id === 'ranger')?.baseStats);
  });

  it('takes the stored username from the JWT, however the login was typed', async () => {
    const stored = `Hero${randomBytes(5).toString('hex')}`;
    const { client } = await registered(stored);
    const save = await postCharacter(client, await client.sessionXsrf(), { classId: 'ranger', appearance: {} });
    assert.equal(save.status, 200);

    const login = new Client();
    const response = await login.authPost('/login', { username: stored.toUpperCase(), password: PASSWORD });
    assert.equal(response.status, 200, 'logging in with different capitals');
    const socket = await enter({ client: login, username: stored });
    assert.equal(socket.me.username, stored);
  });

  it('never lets anything a client sends change its username', async () => {
    const account = await hero();
    const spoof = `hacker${randomBytes(4).toString('hex')}`;
    const watcher = await enter(await witness());

    const socket = await enter(account, {
      search: `?username=${spoof}`,
      headers: { 'X-Username': spoof, 'X-Forwarded-User': spoof },
    });
    assert.equal(socket.me.username, account.username, 'query strings and headers are not identity');

    const attempts = [
      { t: 'i', d: [1, 0, 0, 0, 0], username: spoof },
      { t: 'join', player: { id: socket.you, username: spoof } },
      { t: 'welcome', you: socket.you, players: [{ id: socket.you, username: spoof }] },
      { t: 'rename', username: spoof },
      { username: spoof },
      { t: 'i', d: [2, 0, 0, 0, 0], player: { id: socket.you, username: spoof } },
    ];
    for (const attempt of attempts) socket.socket.send(JSON.stringify(attempt));
    await socket.snapshot('the last attempt being processed', (item) => item.a === 2);

    const later = await enter(await rival());
    const listed = later.welcome.players.find((player) => player.id === socket.you);
    assert.equal(listed?.username, account.username, 'a later arrival should see the real username');

    await watcher.nextSnapshot('a snapshot after the attempts');
    for (const text of [...watcher.raw, ...later.raw, ...socket.raw]) {
      assert.ok(!text.includes(spoof), `the spoofed name reached a player: ${text.slice(0, 300)}`);
    }
    const { user } = await getJson<{ user: { username: string } }>(account.client, '/api/session');
    assert.equal(user.username, account.username, 'the session username');
  });
});

describe('other players', () => {
  afterEach(closeAllSockets);

  it('announces arrivals, shows both players in snapshots and announces departures', async () => {
    const firstAccount = await hero();
    const secondAccount = await rival();
    const first = await enter(firstAccount);
    const since = first.mark();
    const second = await enter(secondAccount);

    const join = await first.joinOf(second.you, since);
    assert.equal(join.player.username, secondAccount.username);
    assert.deepEqual(join.player, second.me, 'the join should describe the same player as the welcome');
    const listed = second.welcome.players.find((player) => player.id === first.you);
    assert.equal(listed?.username, firstAccount.username, 'the welcome should list the player already there');
    assert.ok(entryFor(second.welcome.snapshot, first.you), 'the welcome snapshot should include the other player');

    await first.snapshot('first sees second', (item) => !!entryFor(item.p, second.you));
    await second.snapshot('second sees first', (item) => !!entryFor(item.p, first.you));
    const ownJoin = second.messages.find((item) => item.t === 'join' && item.player.id === second.you);
    assert.equal(ownJoin, undefined, 'a player should not get a join for themselves');

    first.input(1, 1, 0);
    const acked = await first.snapshot('the move being applied', (item) => item.a === 1);
    const position = mustEntry(acked.p, first.you, 'mover');
    await second.snapshot('second sees the move', (item) => {
      const entry = entryFor(item.p, first.you);
      return entry?.[1] === position[1] && entry[2] === position[2];
    });

    const beforeLeave = first.mark();
    second.socket.close();
    const leave = await first.leaveOf(second.you, beforeLeave);
    assert.deepEqual(leave, { t: 'leave', id: second.you });
    const afterLeave = await first.nextSnapshot('a snapshot after the leave');
    assert.equal(entryFor(afterLeave.p, second.you), undefined, 'the player who left should be gone from snapshots');
    assert.equal(first.closeEvent, null, 'the player who stayed should stay connected');
  });

  it('shares only public fields with other players', async () => {
    const subject = await hero();
    const viewer = await witness();
    const watcher = await enter(viewer);
    const since = watcher.mark();
    const socket = await enter(subject);

    const join = await watcher.joinOf(socket.you, since);
    assert.deepEqual(Object.keys(join).sort(), ['player', 't'], 'join message fields');
    assertPublicInfo(join.player, subject.username, 'ranger', 'join');

    const later = await enter(await rival());
    const listed = later.welcome.players.find((player) => player.id === socket.you);
    assert.ok(listed, 'the welcome should list the subject');
    assertPublicInfo(listed, subject.username, 'ranger', 'welcome list');

    await later.nextSnapshot('a snapshot for the later player');
    const seen = await watcher.nextSnapshot('a snapshot for the watcher');
    assertNumericEntry(mustEntry(seen.p, socket.you, 'watcher'), 'watcher');

    const secrets = [
      ['user id', sessionClaims(subject.client).sub],
      ['XSRF token', sessionClaims(subject.client).xsrf],
      ['session token', subject.client.cookies.get('session') ?? ''],
      ['password', PASSWORD],
      ['bcrypt hash', '$2b$'],
      ['field name password', 'password'],
      ['field name xsrf', 'xsrf'],
      ['field name user_id', 'user_id'],
      ['field name userId', 'userId'],
      ['field name sub', '"sub"'],
    ];
    for (const text of [...watcher.raw, ...later.raw]) {
      for (const [label, secret] of secrets) {
        assert.ok(!text.includes(secret), `${label} was sent to another player: ${text.slice(0, 300)}`);
      }
    }
  });
});

describe('movement', () => {
  afterEach(closeAllSockets);

  it('moves the player by the shared rules and acknowledges each input', async () => {
    const socket = await enter(await hero());
    const first = await socket.snapshot('a snapshot before any input');
    assert.equal(first.a, 0, 'nothing has been applied yet');

    const start = mustEntry(socket.welcome.snapshot, socket.you, 'welcome');
    const derived = deriveStats(socket.me.stats);
    const expected = createState(start[1], start[2], derived);
    const count = 20;
    for (let seq = 1; seq <= count; seq += 1) {
      const input: SimInput = { seq, mx: 0.6, mz: -0.8, yaw: 1.25, run: seq > 10, dodge: false, attack: false, potion: false };
      stepPlayer(expected, input, derived);
      socket.input(seq, input.mx, input.mz, input.yaw, input.run ? FLAG_RUN : 0);
      await sleep(1000 / TICK_RATE);
    }

    const acked = await socket.snapshot(`the ack for input ${count}`, (item) => item.a === count);
    const entry = mustEntry(acked.p, socket.you, 'after moving');
    assertNumericEntry(entry, 'after moving');
    assert.ok(Math.hypot(entry[1] - start[1], entry[2] - start[2]) > 1, 'the player should have moved');
    assertClose(entry[1], expected.x, 'x');
    assertClose(entry[2], expected.z, 'z');
    assertClose(entry[3], expected.yaw, 'yaw');
    assertClose(entry[4], expected.stamina, 'stamina');
    assert.equal(entry[5], expected.moving, 'moving');

    const acks = socket.snapshots().map((item) => item.a);
    assert.deepEqual(acks, [...acks].sort((a, b) => a - b), 'acks should never go backward');
    assert.ok(acks.every((ack) => ack <= count), 'acks should never pass the newest input');
    assert.ok(new Set(acks).size > 2, `acks should advance as inputs apply, got ${[...new Set(acks)].join(',')}`);
  });

  it('ignores inputs that are not newer than the last one applied', async () => {
    const socket = await enter(await hero());
    socket.input(5, 1, 0);
    const moved = await socket.snapshot('the ack for input 5', (item) => item.a === 5);
    const position = mustEntry(moved.p, socket.you, 'after input 5');

    for (const seq of [5, 4, 1, 0, -1]) socket.input(seq, 1, 0);
    socket.input(6, 0, 0);
    const after = await socket.snapshot('the ack for input 6', (item) => item.a === 6);
    const entry = mustEntry(after.p, socket.you, 'after replays');
    assert.deepEqual([entry[1], entry[2]], [position[1], position[2]], 'replayed inputs should not move the player');
  });
});

describe('anti-cheat', () => {
  afterEach(closeAllSockets);

  it('holds a flood of the largest allowed inputs to the legal speed', async () => {
    const socket = await enter(await hero());
    const derived = deriveStats(socket.me.stats);
    const runSpeed = legalRunSpeed(derived);

    const baseline = await socket.nextSnapshot('a snapshot before the flood');
    const startedAt = Date.now();
    const start = mustEntry(baseline.p, socket.you, 'before the flood');
    const [awayX, awayZ] = openDirection(start[1], start[2], derived);

    // The biggest values the server accepts. Anything larger is dropped, tested below.
    const huge = [8, 7, 6];
    let seq = 0;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (Date.now() - startedAt >= FLOOD_MS) {
          clearInterval(timer);
          resolve();
          return;
        }
        seq += 1;
        const size = huge[seq % huge.length];
        socket.input(seq, size * awayX, size * awayZ, 0, FLAG_RUN);
      }, FLOOD_INTERVAL_MS);
    });
    const sentPerSecond = seq / ((Date.now() - startedAt) / 1000);
    assert.ok(
      sentPerSecond > TICK_RATE * 1.5,
      `the flood should beat the ${TICK_RATE} tick rate, sent ${sentPerSecond.toFixed(0)} per second`,
    );
    assert.equal(socket.closeEvent, null, `${sentPerSecond.toFixed(0)} messages per second is under the limit`);

    // Queued inputs keep applying after the flood, so this waits for the very last one.
    const last = await socket.snapshot(`the ack for input ${seq}`, (item) => item.a === seq);
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const end = mustEntry(last.p, socket.you, 'after the flood');
    assertNumericEntry(end, 'after the flood');

    const moved = Math.hypot(end[1] - start[1], end[2] - start[2]);
    const legalMax = runSpeed * (elapsedSeconds + (INPUT_BUDGET + SPEED_MARGIN_INPUTS) * TICK_DT);
    assert.ok(
      moved <= legalMax,
      `moved ${moved.toFixed(2)} in ${elapsedSeconds.toFixed(2)}s, over the legal ${legalMax.toFixed(2)} at speed ${runSpeed}`,
    );
    assert.ok(
      moved >= runSpeed * (FLOOD_MS / 1000) * 0.5,
      `moved only ${moved.toFixed(2)} in ${elapsedSeconds.toFixed(2)}s, so the flood barely ran`,
    );
    for (const item of socket.snapshots()) {
      const entry = mustEntry(item.p, socket.you, 'during the flood');
      assert.ok(
        entry[4] >= 0 && entry[4] <= derived.maxStamina,
        `stamina should stay between 0 and ${derived.maxStamina}, got ${entry[4]}`,
      );
    }
  });

  it('cannot teleport with one big burst of inputs', async () => {
    const socket = await enter(await hero());
    const derived = deriveStats(socket.me.stats);
    const step = legalRunSpeed(derived) * TICK_DT;

    const baseline = await socket.nextSnapshot('a snapshot before the burst');
    const start = mustEntry(baseline.p, socket.you, 'before the burst');
    const [awayX, awayZ] = openDirection(start[1], start[2], derived);
    const count = 100;
    const startedAt = Date.now();
    for (let seq = 1; seq <= count; seq += 1) socket.input(seq, 8 * awayX, 8 * awayZ, 0, FLAG_RUN);

    const last = await socket.snapshot(`the ack for input ${count}`, (item) => item.a === count);
    const end = mustEntry(last.p, socket.you, 'after the burst');
    const moved = Math.hypot(end[1] - start[1], end[2] - start[2]);
    // One input a tick for as long as this took, plus the budget. A burst buys nothing else.
    const ticks = ((Date.now() - startedAt) / 1000) * TICK_RATE;
    const legalMax = step * (ticks + INPUT_BUDGET + SPEED_MARGIN_INPUTS);
    assert.ok(ticks < count, `the queue limit should have dropped part of the burst, took ${ticks.toFixed(0)} ticks`);
    assert.ok(moved <= legalMax, `moved ${moved.toFixed(2)} from one burst, over the legal ${legalMax.toFixed(2)}`);
    assert.ok(moved > step, 'the burst should still have moved the player');
  });

  it('drops inputs too large to be real, so they can never reach the simulation', async () => {
    const socket = await enter(await hero());
    const watcher = await enter(await witness());
    const start = mustEntry(socket.welcome.snapshot, socket.you, 'welcome');

    // Each is finite, but values like these overflow to NaN inside the movement maths.
    const absurd: Array<[number, number, number, number]> = [
      [1.7e308, 1.7e308, 0, FLAG_DODGE],
      [9, 0, 0, 0],
      [0, -9, 0, 0],
      [0, 0, 1e306, 0],
      [0, 0, -1001, 0],
      [0, 0, 0, MAX_FLAGS + 1],
      [0, 0, 0, 1024],
      [0, 0, 0, -1],
      [0, 0, 0, 1.5],
    ];
    absurd.forEach(([mx, mz, yaw, flags], index) => socket.input(index + 1, mx, mz, yaw, flags));

    // Handled in order, so an ack for this input means all of the above were dropped.
    const nextSeq = absurd.length + 1;
    socket.input(nextSeq, 0, 0);
    const acked = await socket.snapshot('the ack after the absurd inputs', (item) => item.a === nextSeq);
    const entry = mustEntry(acked.p, socket.you, 'own snapshot');
    assertNumericEntry(entry, 'after absurd inputs');
    assert.ok(Math.abs(entry[1] - start[1]) < 0.01 && Math.abs(entry[2] - start[2]) < 0.01, 'the player should not have moved');
    assert.equal(entry[6], 0, 'the overflowing dodge should not have started');
    assert.equal(socket.closeEvent, null, 'dropping a bad input should not close the socket');

    const seen = await watcher.nextSnapshot('what the other player sees');
    assertNumericEntry(mustEntry(seen.p, socket.you, 'watcher'), 'seen by another player');
  });

  it('drops a sequence number that is not a safe whole number', async () => {
    const socket = await enter(await hero());
    socket.socket.send(JSON.stringify({ t: 'i', d: [1e300, 0, 0, 0, 0] }));
    socket.socket.send(JSON.stringify({ t: 'i', d: [1.5, 0, 0, 0, 0] }));
    socket.socket.send(JSON.stringify({ t: 'i', d: [-1, 0, 0, 0, 0] }));
    // A huge sequence accepted here would make every real input afterward look old.
    socket.input(1, 0, 0);
    const acked = await socket.snapshot('the ack for a normal input', (item) => item.a === 1);
    assertNumericEntry(mustEntry(acked.p, socket.you, 'own snapshot'), 'after bad sequence numbers');
  });
});

describe('badly behaved clients', () => {
  afterEach(closeAllSockets);

  it('ignores malformed messages without closing anyone', async () => {
    const watcher = await enter(await witness());
    const socket = await enter(await hero());
    const start = mustEntry(socket.welcome.snapshot, socket.you, 'welcome');

    const badText = [
      'not json', '', '{', '[', 'undefined',
      '[]', '[1,1,0,0,0]', 'null', 'true', '42', '"i"', '{}',
      '{"t":"i"}', '{"t":"i","d":null}', '{"t":"i","d":"12345"}', '{"t":"i","d":{"length":5}}', '{"t":"i","d":7}',
      '{"t":"i","d":[]}', '{"t":"i","d":[9,1,0,0]}', '{"t":"i","d":[9,1,0,0,0,0]}',
      '{"t":"i","d":["9",1,0,0,0]}', '{"t":"i","d":[9,"1",0,0,0]}', '{"t":"i","d":[9,1,null,0,0]}',
      '{"t":"i","d":[9,1,0,[],0]}', '{"t":"i","d":[9,1,0,0,{}]}', '{"t":"i","d":[[9],[1],[0],[0],[0]]}',
      '{"t":"i","d":[NaN,1,0,0,0]}', '{"t":"i","d":[9,NaN,0,0,0]}', '{"t":"i","d":[9,1,0,NaN,0]}',
      '{"t":"i","d":[1e999,1,0,0,0]}', '{"t":"i","d":[9,1e999,0,0,0]}', '{"t":"i","d":[9,1,-1e999,0,0]}',
      '{"t":"i","d":[9,1,0,1e999,0]}', '{"t":"i","d":[9,1,0,0,1e999]}',
      '{"t":"x","d":[9,1,0,0,0]}', '{"t":"I","d":[9,1,0,0,0]}', '{"t":9,"d":[9,1,0,0,0]}',
      '{"t":["i"],"d":[9,1,0,0,0]}', '{"t":null,"d":[9,1,0,0,0]}', '{"d":[9,1,0,0,0]}',
      '{"__proto__":{"t":"i","d":[9,1,0,0,0]}}',
    ];
    for (const text of badText) socket.socket.send(text);
    const validInBinary = Buffer.from(JSON.stringify({ t: 'i', d: [9, 1, 0, 0, 0] }));
    for (const data of [Buffer.alloc(0), Buffer.from([0, 255, 1, 254]), validInBinary]) {
      socket.socket.send(data, { binary: true });
    }

    // Messages are handled in order, so an ack for this one means all of the above were handled.
    socket.input(1, 0, 0);
    const handled = await socket.snapshot('the ack after the bad messages', (item) => item.a === 1);
    const entry = mustEntry(handled.p, socket.you, 'after the bad messages');
    assertNumericEntry(entry, 'after the bad messages');
    assert.deepEqual([entry[1], entry[2]], [start[1], start[2]], 'bad messages should not move the player');
    assert.ok(
      socket.snapshots().every((item) => item.a <= 1),
      `no bad message should be acknowledged, got ${socket.snapshots().map((item) => item.a).join(',')}`,
    );
    assert.equal(socket.closeEvent, null, 'the sender should stay connected');

    socket.input(2, 1, 0);
    const moved = await socket.snapshot('the ack for a good input after the bad ones', (item) => item.a === 2);
    assert.notEqual(mustEntry(moved.p, socket.you, 'after a good input')[1], start[1], 'good inputs should still work');

    await watcher.nextSnapshot('a snapshot for the healthy player');
    assert.equal(watcher.closeEvent, null, 'the healthy player should stay connected');
    assert.equal((await fetch(`${BASE}/api/classes`)).status, 200, 'the API should still respond');
    const fresh = await enter(await rival());
    assert.ok(fresh.you > socket.you, 'a new player should still get in, on the same server process');
  });

  for (const [label, send] of [
    ['a message over the size limit', (game: GameSocket) => game.socket.send('x'.repeat(2048))],
    ['a text frame of invalid UTF-8', (game: GameSocket) => game.socket.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false })],
  ] as const) {
    it(`closes only the sender of ${label}`, async () => {
      const watcher = await enter(await witness());
      const socket = await enter(await hero());
      const since = watcher.mark();
      send(socket);
      const closed = await socket.waitForClose(label);
      assert.ok([1006, 1007, 1009].includes(closed.code), `unexpected close code ${closed.code}`);

      await watcher.leaveOf(socket.you, since);
      await watcher.nextSnapshot('a snapshot for the healthy player');
      assert.equal(watcher.closeEvent, null, 'the healthy player should stay connected');
    });
  }

  for (const [label, frame] of [
    ['valid inputs', (seq: number) => JSON.stringify({ t: 'i', d: [seq, 0, 0, 0, 0] })],
    ['garbage text', () => 'not json'],
    ['binary frames', () => Buffer.from([1, 2, 3])],
  ] as const) {
    it(`closes a socket flooding ${label} with code ${WS_CLOSE_ABUSE}`, async () => {
      const watcher = await enter(await witness());
      const account = await hero();
      const socket = await enter(account);
      const since = watcher.mark();

      // Sent at once, so at least 120 of these land inside one of the server's one-second counts.
      for (let seq = 1; seq <= 300; seq += 1) socket.socket.send(frame(seq));
      const closed = await socket.waitForClose('the flooding socket');
      assert.equal(closed.code, WS_CLOSE_ABUSE, `close code, reason "${closed.reason}"`);

      await watcher.leaveOf(socket.you, since);
      await watcher.nextSnapshot('a snapshot for the healthy player');
      assert.equal(watcher.closeEvent, null, 'the healthy player should stay connected');
      const again = await enter(account);
      assert.equal(again.me.username, account.username, 'the kicked account should be able to come back');
    });
  }

  it(`replaces the first connection of an account with code ${WS_CLOSE_REPLACED}`, async () => {
    const account = await hero();
    const watcher = await enter(await witness());
    const since = watcher.mark();
    const first = await enter(account);
    await watcher.joinOf(first.you, since);

    const second = await enter(account);
    const closed = await first.waitForClose('the replaced connection');
    assert.equal(closed.code, WS_CLOSE_REPLACED, `close code, reason "${closed.reason}"`);
    assert.notEqual(second.you, first.you, 'the new connection should be a new player');
    assert.equal(second.me.username, account.username);
    assert.equal(second.welcome.players.find((player) => player.id === first.you), undefined, 'the old player is gone');

    await watcher.leaveOf(first.you, since);
    const join = await watcher.joinOf(second.you, since);
    assert.equal(join.player.username, account.username);
    const wrongLeave = watcher.messages.slice(since).filter((item) => item.t === 'leave' && item.id === second.you);
    assert.deepEqual(wrongLeave, [], 'the new connection should not be announced as leaving');

    // The old socket closing must not take the new player out of the world.
    const after = second.mark();
    second.input(1, 1, 0);
    const acked = await second.snapshot('the new connection still playing', (item) => item.a === 1, after);
    assert.ok(entryFor(acked.p, second.you), 'the new player should be in snapshots');
    assert.equal(entryFor(acked.p, first.you), undefined, 'the old player should not be in snapshots');
    assert.equal(second.closeEvent, null, 'the new connection should stay open');
  });
});
