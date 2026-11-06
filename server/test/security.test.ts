/**
 * End-to-end security checks against the running stack, through nginx, the way a browser
 * would reach it. Start the stack first with `docker compose up`, then run `npm test`
 * from the server folder. Every run registers fresh random accounts.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { WebSocket } from 'ws';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const HOST = new URL(BASE).host;
const PASSWORD = 'Sw0rd&Sorcery!';

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], { cwd: '..', encoding: 'utf8' });
}

/** Minimal cookie-keeping browser. */
class Client {
  cookies = new Map<string, string>();

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', this.cookieHeader());
    const response = await fetch(BASE + path, { redirect: 'manual', ...init, headers });
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

function freshName(): string {
  return `t${randomBytes(6).toString('hex')}`;
}

async function registered(): Promise<{ client: Client; username: string }> {
  const client = new Client();
  const username = freshName();
  const response = await client.authPost('/register', { username, password: PASSWORD });
  assert.equal(response.status, 201);
  return { client, username };
}

async function sessionUser(token: string): Promise<unknown> {
  const response = await fetch(`${BASE}/api/session`, { headers: { Cookie: `session=${token}` } });
  return ((await response.json()) as { user: unknown }).user;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function wsAttempt(headers: Record<string, string>): Promise<'open' | number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`, { headers });
    socket.on('open', () => {
      socket.close();
      resolve('open');
    });
    socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    socket.on('error', reject);
  });
}

describe('accounts', () => {
  it('rejects weak passwords and non-alphanumeric usernames', async () => {
    const client = new Client();
    const weak = await client.authPost('/register', { username: freshName(), password: 'password' });
    assert.equal(weak.status, 400);
    const badName = await client.authPost('/register', { username: '<script>', password: PASSWORD });
    assert.equal(badName.status, 400);
  });

  it('refuses duplicate usernames regardless of case', async () => {
    const { username } = await registered();
    const again = await new Client().authPost('/register', {
      username: username.toUpperCase(),
      password: PASSWORD,
    });
    assert.equal(again.status, 400);
  });

  it('logs in, and treats SQL injection as a wrong password', async () => {
    const { username } = await registered();
    assert.equal((await new Client().authPost('/login', { username, password: PASSWORD })).status, 200);
    const injected = await new Client().authPost('/login', {
      username: `${username}' OR '1'='1' --`,
      password: "' OR '1'='1",
    });
    assert.equal(injected.status, 401);
  });

  it('stores only a salted bcrypt hash', () => {
    const output = compose(
      'exec', '-T', 'db', 'sh', '-c',
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT password_hash FROM users LIMIT 1"',
    );
    assert.match(output.trim(), /^\$2[aby]\$12\$/);
  });

  it('sets the session cookie with the right directives', async () => {
    const client = new Client();
    const token = await client.guestToken();
    const response = await client.fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': token },
      body: JSON.stringify({ username: freshName(), password: PASSWORD }),
    });
    const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith('session='));
    assert.ok(line);
    assert.match(line, /HttpOnly/i);
    assert.match(line, /Max-Age=\d+/i);
    assert.match(line, /SameSite=Strict/i);
    assert.match(line, /Path=\//i);
  });

  it('logs out over POST only, and clears the session', async () => {
    const { client } = await registered();
    assert.equal((await client.fetch('/logout')).status, 303);
    assert.ok(client.cookies.has('session'), 'GET /logout must not end the session');
    const xsrf = await client.sessionXsrf();
    const response = await client.fetch('/logout', { method: 'POST', headers: { 'X-XSRF-Token': xsrf } });
    assert.equal(response.status, 200);
    assert.ok(!client.cookies.has('session'));
  });
});

describe('XSRF protection', () => {
  it('refuses login and register without the token', async () => {
    for (const path of ['/login', '/register']) {
      const response = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: freshName(), password: PASSWORD }),
      });
      assert.equal(response.status, 403, path);
    }
  });

  it('refuses a request whose Origin is another site', async () => {
    const client = new Client();
    const token = await client.guestToken();
    const response = await client.fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-Token': token,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ username: 'anyone', password: PASSWORD }),
    });
    assert.equal(response.status, 403);
  });

  it('refuses logout and profile changes without the session token', async () => {
    const { client } = await registered();
    assert.equal((await client.fetch('/logout', { method: 'POST' })).status, 403);
    assert.ok(client.cookies.has('session'));
    assert.equal((await client.fetch('/api/profile/avatar', { method: 'DELETE' })).status, 403);
  });

  it('gives each session its own token', async () => {
    const [a, b] = await Promise.all([registered(), registered()]);
    assert.notEqual(await a.client.sessionXsrf(), await b.client.sessionXsrf());
  });

  it("refuses one user's token on another user's session", async () => {
    const [a, b] = await Promise.all([registered(), registered()]);
    const response = await a.client.fetch('/api/profile/avatar', {
      method: 'DELETE',
      headers: { 'X-XSRF-Token': await b.client.sessionXsrf() },
    });
    assert.equal(response.status, 403);
  });
});

describe('JWT verification', () => {
  let publicKey = '';
  let validToken = '';
  let username = '';

  before(async () => {
    const account = await registered();
    username = account.username;
    validToken = account.client.cookies.get('session')!;
    publicKey = compose('exec', '-T', 'app', 'cat', '/keys/public/jwt-public.pem');
  });

  it('accepts a real token, which is signed with RS256 and has exp', async () => {
    assert.ok(await sessionUser(validToken));
    const decoded = jwt.decode(validToken, { complete: true })!;
    assert.equal(decoded.header.alg, 'RS256');
    assert.equal(typeof (decoded.payload as jwt.JwtPayload).exp, 'number');
  });

  it('rejects a tampered payload', async () => {
    const [header, payload, signature] = validToken.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = `${header}.${base64url({ ...claims, username: 'admin' })}.${signature}`;
    assert.equal(await sessionUser(forged), null);
  });

  it('rejects alg:none', async () => {
    const claims = JSON.parse(Buffer.from(validToken.split('.')[1], 'base64url').toString());
    const forged = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.`;
    assert.equal(await sessionUser(forged), null);
  });

  it('rejects HS256 signed with the public key (algorithm confusion)', async () => {
    const claims = JSON.parse(Buffer.from(validToken.split('.')[1], 'base64url').toString());
    const header = base64url({ alg: 'HS256', typ: 'JWT' });
    const payload = base64url(claims);
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', publicKey).update(`${header}.${payload}`).digest('base64url');
    assert.equal(await sessionUser(`${header}.${payload}.${signature}`), null);
  });

  it('rejects a token signed by a different RSA key', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = jwt.sign({ username, xsrf: 'x' }, privateKey, {
      algorithm: 'RS256',
      subject: '00000000-0000-0000-0000-000000000000',
      issuer: 'cse-souls-auth',
      audience: 'cse-souls-app',
      expiresIn: 3600,
    });
    assert.equal(await sessionUser(forged), null);
  });

  it('rejects an expired token signed by the real key', async () => {
    // Signed inside the auth container, the only place the private key exists.
    const script = `
      const jwt = require('jsonwebtoken'), fs = require('fs');
      const key = fs.readFileSync('/keys/private/jwt-private.pem');
      process.stdout.write(jwt.sign({ username: 'x', xsrf: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, key,
        { algorithm: 'RS256', subject: '00000000-0000-0000-0000-000000000000', issuer: 'cse-souls-auth', audience: 'cse-souls-app' }));
    `;
    const expired = compose('exec', '-T', 'auth', 'node', '-e', script);
    assert.equal(expired.split('.').length, 3);
    assert.equal(await sessionUser(expired), null);
  });

  it('keeps the private key out of the app container', () => {
    assert.throws(() =>
      execFileSync('docker', ['compose', 'exec', '-T', 'app', 'ls', '/keys/private/jwt-private.pem'], {
        cwd: '..',
        stdio: 'pipe',
      }),
    );
  });
});

describe('routing', () => {
  it('sends a 404 for API paths the app does not have, without leaking a stack', async () => {
    const response = await fetch(`${BASE}/api/nope`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Error:|at .*\.js/);
  });

  it('sets nosniff on every kind of response', async () => {
    for (const path of ['/', '/login', '/api/realm', '/api/nope', '/assets/missing.js', '/audio/missing.mp3']) {
      const response = await fetch(BASE + path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    }
  });

  it('serves pages for /login and /register from the auth server, not the app', () => {
    const logs = compose('logs', '--no-log-prefix', '--tail', '2000', 'app');
    assert.doesNotMatch(logs, /"path":"\/(login|register|logout)"/);
  });

  it('does not expose the database', () => {
    const output = compose('ps', '--format', '{{.Service}} {{.Publishers}}');
    const db = output.split('\n').find((line) => line.startsWith('db '))!;
    assert.doesNotMatch(db, /0\.0\.0\.0|127\.0\.0\.1|\[::\]:/);
  });
});

describe('avatars', () => {
  const upload = async (client: Client, bytes: Buffer, name: string, type: string) => {
    const form = new FormData();
    form.append('avatar', new Blob([bytes], { type }), name);
    return client.fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'X-XSRF-Token': await client.sessionXsrf() },
      body: form,
    });
  };

  it('refuses uploads from guests', async () => {
    const form = new FormData();
    form.append('avatar', new Blob(['x']), 'a.png');
    const response = await fetch(`${BASE}/api/profile/avatar`, { method: 'POST', body: form });
    assert.equal(response.status, 401);
  });

  it('refuses a script disguised as an image', async () => {
    const { client } = await registered();
    const response = await upload(client, Buffer.from('alert(document.cookie)'), 'attack.jpg', 'image/jpeg');
    assert.equal(response.status, 400);
  });

  it('crops a wide image to a square PNG instead of stretching it, and unlocks the achievement', async () => {
    const { client, username } = await registered();
    const wide = await sharp({
      create: { width: 900, height: 300, channels: 3, background: '#883322' },
    })
      .jpeg()
      .toBuffer();
    const response = await upload(client, wide, 'wide.jpg', 'image/jpeg');
    assert.equal(response.status, 200);
    const result = (await response.json()) as { avatarUrl: string; unlocked: Array<{ id: string }> };
    assert.deepEqual(result.unlocked.map((item) => item.id), ['profile_picture']);

    const image = await fetch(BASE + result.avatarUrl);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [256, 256, 'png']);

    const player = (await (await fetch(`${BASE}/api/players/${username}`)).json()) as { avatarUrl: string };
    assert.equal(player.avatarUrl, result.avatarUrl);
  });
});

describe('avatar sources', () => {
  // Picture changes are limited to one per second for each player.
  const afterCooldown = () => new Promise((resolve) => setTimeout(resolve, 1100));

  const post = async (client: Client, path: string, body: unknown) =>
    client.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': await client.sessionXsrf() },
      body: JSON.stringify(body),
    });

  it('requires a login and an XSRF token', async () => {
    const guest = await fetch(`${BASE}/api/profile/avatar/emblem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emblem: 'raven' }),
    });
    assert.equal(guest.status, 401);
    const { client } = await registered();
    const noToken = await client.fetch('/api/profile/avatar/emblem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emblem: 'raven' }),
    });
    assert.equal(noToken.status, 403);
  });

  it('turns an emblem into a 256px PNG', async () => {
    const { client } = await registered();
    const response = await post(client, '/api/profile/avatar/emblem', { emblem: 'raven' });
    assert.equal(response.status, 200);
    const { avatarUrl } = (await response.json()) as { avatarUrl: string };
    const meta = await sharp(Buffer.from(await (await fetch(BASE + avatarUrl)).arrayBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [256, 256, 'png']);
  });

  it('refuses path traversal in an emblem name', async () => {
    const { client } = await registered();
    const response = await post(client, '/api/profile/avatar/emblem', { emblem: '../../etc/passwd' });
    assert.equal(response.status, 400);
  });

  it('refuses unknown DiceBear styles and unsafe seeds', async () => {
    const { client } = await registered();
    const badStyle = await post(client, '/api/profile/avatar/generated', { style: 'evil', seed: 'a' });
    assert.equal(badStyle.status, 400);
    await afterCooldown();
    const badSeed = await post(client, '/api/profile/avatar/generated', {
      style: 'pixel-art',
      seed: 'a&url=http://169.254.169.254/',
    });
    assert.equal(badSeed.status, 400);
  });

  it('refuses GitHub names that could change the request URL', async () => {
    const { client } = await registered();
    for (const login of ['../evil', 'a/b', 'a?x=1', 'evil.example', '-bad', '']) {
      const response = await post(client, '/api/profile/avatar/github', { login });
      assert.equal(response.status, 400, login);
      await afterCooldown();
    }
  });

  it('allows one change per second per player', async () => {
    const { client } = await registered();
    const first = await post(client, '/api/profile/avatar/emblem', { emblem: 'raven' });
    assert.equal(first.status, 200);
    const second = await post(client, '/api/profile/avatar/emblem', { emblem: 'raven' });
    assert.equal(second.status, 429);
  });
});

describe('WebSocket', () => {
  const origin = `http://${HOST}`;

  it('refuses a handshake with no session', async () => {
    assert.equal(await wsAttempt({ Origin: origin }), 401);
  });

  it('refuses a handshake from another origin even with a valid session', async () => {
    const { client } = await registered();
    const status = await wsAttempt({ Origin: 'https://evil.example', Cookie: client.cookieHeader() });
    assert.equal(status, 403);
  });

  it('refuses a forged token', async () => {
    assert.equal(await wsAttempt({ Origin: origin, Cookie: 'session=not.a.token' }), 401);
  });

  it('accepts a same-origin handshake with a valid session', async () => {
    const { client } = await registered();
    assert.equal(await wsAttempt({ Origin: origin, Cookie: client.cookieHeader() }), 'open');
  });
});

describe('regressions from the security review', () => {
  const rawRequest = (text: string): Promise<string> =>
    new Promise((resolve) => {
      const socket = connect(Number(new URL(BASE).port), new URL(BASE).hostname, () => socket.write(text));
      let received = '';
      socket.on('data', (chunk) => {
        received += chunk.toString();
      });
      socket.on('close', () => resolve(received));
      socket.on('error', () => resolve(received));
      setTimeout(() => socket.destroy(), 1500);
    });

  it('survives a malformed WebSocket upgrade request', async () => {
    await rawRequest(`GET //[/../ws HTTP/1.1\r\nHost: ${HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const status = compose('ps', '--format', '{{.Service}} {{.Status}}').split('\n').find((line) => line.startsWith('app '));
    assert.doesNotMatch(status ?? '', /Restarting|Exited|Less than a second/);
    assert.equal((await fetch(`${BASE}/api/realm`)).status, 200);
  });

  it('requires the exact Origin, including its scheme', async () => {
    const { client } = await registered();
    const cookie = client.cookieHeader();
    for (const origin of [`https://${HOST}`, `ftp://${HOST}`, `http://${HOST}/path`, `http://x:y@${HOST}`, 'null']) {
      assert.equal(await wsAttempt({ Origin: origin, Cookie: cookie }), 403, origin);
    }
    assert.equal(await wsAttempt({ Cookie: cookie }), 403, 'no Origin at all');
  });

  it('does not trust the Host header when checking Origin', async () => {
    const { client } = await registered();
    const status = await wsAttempt({ Origin: 'http://evil.example', Host: 'evil.example', Cookie: client.cookieHeader() });
    assert.equal(status, 403);
  });

  it('sends every casing of the auth paths to the auth server', async () => {
    const marker = `/LoGiN`;
    await fetch(BASE + marker);
    const logs = compose('logs', '--no-log-prefix', '--tail', '2000', 'app');
    assert.ok(!logs.includes(`"path":"${marker}"`), 'the app container saw an auth path');
  });

  it('counts simultaneous login guesses', async () => {
    const username = freshName();
    const responses = await Promise.all(
      Array.from({ length: 14 }, () => new Client().authPost('/login', { username, password: 'Wrong&Guess1' })),
    );
    assert.ok(responses.some((response) => response.status === 429), 'all guesses got through at once');
  });

  it('refuses SVG uploads before they reach the image decoder', async () => {
    const { client } = await registered();
    const form = new FormData();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    form.append('avatar', new Blob([svg], { type: 'image/png' }), 'attack.png');
    const response = await client.fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'X-XSRF-Token': await client.sessionXsrf() },
      body: form,
    });
    assert.equal(response.status, 400);
  });

  it('refuses the dev server origin on the grading stack', async () => {
    const { client } = await registered();
    assert.equal(await wsAttempt({ Origin: 'http://localhost:5173', Cookie: client.cookieHeader() }), 403);
  });

  it('refuses path tricks that nginx and Express could read differently', async () => {
    for (const target of ['/login\\\\#x', '/assets/../login', '/login/..', '/api/players/..%2f..%2fassets%2fx', '/login%5c']) {
      const reply = await rawRequest(`GET ${target} HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`);
      assert.match(reply, /^HTTP\/1\.1 400/, target);
      assert.match(reply, /x-content-type-options: nosniff/i, `${target} still needs nosniff`);
    }
  });

  it('sends every casing of the XSRF path to the auth server', async () => {
    for (const path of ['/AUTH/XSRF', '/auth/xsrf/']) {
      const response = await fetch(BASE + path);
      assert.match(response.headers.get('content-type') ?? '', /json/, path);
    }
  });

  it('only allows GET on static files', async () => {
    assert.equal((await fetch(`${BASE}/assets/x`, { method: 'POST' })).status, 403);
  });

  it('refuses a very long, thin image that would expand to gigabytes', async () => {
    const { client } = await registered();
    const thin = await sharp({ create: { width: 4000, height: 16, channels: 3, background: '#000000' } }).png().toBuffer();
    const form = new FormData();
    form.append('avatar', new Blob([thin], { type: 'image/png' }), 'thin.png');
    const response = await client.fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'X-XSRF-Token': await client.sessionXsrf() },
      body: form,
    });
    assert.equal(response.status, 400);
  });

  it('refuses a JPEG with an absurd number of scans before decoding it', async () => {
    const { client } = await registered();
    const scan = Buffer.from([0xff, 0xda, 0x00, 0x02]);
    const bomb = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), ...Array.from({ length: 200 }, () => scan)]);
    const form = new FormData();
    form.append('avatar', new Blob([bomb], { type: 'image/jpeg' }), 'bomb.jpg');
    const response = await client.fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'X-XSRF-Token': await client.sessionXsrf() },
      body: form,
    });
    assert.equal(response.status, 400);
  });

  it('limits how fast one account can reconnect', async () => {
    const { client } = await registered();
    const cookie = client.cookieHeader();
    const first = await wsAttempt({ Origin: `http://${HOST}`, Cookie: cookie });
    const second = await wsAttempt({ Origin: `http://${HOST}`, Cookie: cookie });
    assert.equal(first, 'open');
    assert.equal(second, 429);
  });

  it('does not allow WebSockets to other hosts in the Content-Security-Policy', async () => {
    const csp = (await fetch(`${BASE}/`)).headers.get('content-security-policy') ?? '';
    const connect = csp.split(';').find((part) => part.trim().startsWith('connect-src')) ?? '';
    assert.doesNotMatch(connect, /\s(ws:|wss:)(\s|$)/);
    assert.match(connect, /ws:\/\/localhost:8080/);
  });
});

describe('leaderboard', () => {
  it('ignores an unknown sort key rather than passing it to SQL', async () => {
    const response = await fetch(`${BASE}/api/leaderboard?sort=${encodeURIComponent('level; DROP TABLE users;--')}`);
    assert.equal(response.status, 200);
    const realm = await fetch(`${BASE}/api/realm`);
    assert.equal(realm.status, 200);
  });

  it('lists every account, including ones that are not online', async () => {
    const { username } = await registered();
    const { total, entries } = (await (await fetch(`${BASE}/api/leaderboard?limit=100`)).json()) as {
      total: number;
      entries: Array<{ username: string }>;
    };
    assert.ok(total >= 1);
    assert.ok(total > 100 || entries.some((entry) => entry.username === username));
  });
});
