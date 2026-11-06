import { randomBytes } from 'node:crypto';
import path from 'node:path';
import bcrypt from 'bcrypt';
import express, { type CookieOptions, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool, prepareDatabase } from '../shared/db.js';
import {
  errorHandler,
  installBaseMiddleware,
  notFoundJson,
  rejectCrossOrigin,
  safeEqual,
  XSRF_HEADER,
} from '../shared/http.js';
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  SESSION_COOKIE,
  verifySessionToken,
} from '../shared/jwt.js';
import { log } from '../shared/logger.js';
import { loginThrottle, passwordProblem, usernameProblem } from './credentials.js';
import { loadSigningKeys } from './keys.js';

const PORT = Number(process.env.PORT ?? 3001);
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS ?? 43_200);
const BCRYPT_COST = 12;
const GUEST_XSRF_COOKIE = 'xsrf_guest';
const GUEST_XSRF_TTL_MS = 60 * 60 * 1000;
const PAGE_SHELL = path.resolve('public/index.html');

// Compared against when a username does not exist, so a failed login takes the
// same time either way and response timing cannot reveal which accounts exist.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_COST);

const BASE_COOKIE: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: COOKIE_SECURE,
  path: '/',
};

await prepareDatabase();
const { privateKey, publicKey } = loadSigningKeys();

function startSession(res: Response, user: { id: string; username: string }): void {
  const token = jwt.sign(
    { username: user.username, xsrf: randomBytes(32).toString('hex') },
    privateKey,
    {
      algorithm: JWT_ALGORITHM,
      subject: user.id,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: JWT_TTL_SECONDS,
    },
  );
  res.cookie(SESSION_COOKIE, token, { ...BASE_COOKIE, maxAge: JWT_TTL_SECONDS * 1000 });
  // A pre-login token must not outlive the login it protected.
  res.clearCookie(GUEST_XSRF_COOKIE, BASE_COOKIE);
}

/** Double-submit check: only same-origin JavaScript could read the token from /auth/xsrf. */
function requireGuestXsrf(req: Request, res: Response, next: () => void): void {
  const cookieToken = req.cookies[GUEST_XSRF_COOKIE];
  const headerToken = req.header(XSRF_HEADER);
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    res.status(403).json({ error: 'This form expired. Please try again.' });
    return;
  }
  next();
}

const app = express();
installBaseMiddleware(app);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// The login and register pages. nginx sends these paths here, so they never touch the app.
app.get(['/login', '/register'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(PAGE_SHELL);
});

// Logging out changes state, so a plain link or <img> tag must not be able to trigger it.
app.get('/logout', (_req, res) => {
  res.redirect(303, '/');
});

app.get('/auth/xsrf', (req, res) => {
  const token = req.cookies[GUEST_XSRF_COOKIE] ?? randomBytes(32).toString('hex');
  res.cookie(GUEST_XSRF_COOKIE, token, { ...BASE_COOKIE, maxAge: GUEST_XSRF_TTL_MS });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token });
});

const parseJson = express.json({ limit: '4kb' });

app.post('/register', rejectCrossOrigin, requireGuestXsrf, parseJson, async (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  const problem = usernameProblem(username) ?? passwordProblem(password);
  if (problem) {
    log('info', 'register_rejected', { ip: req.ip, reason: problem });
    res.status(400).json({ error: problem });
    return;
  }

  const passwordHash = await bcrypt.hash(password as string, BCRYPT_COST);
  const { rows } = await pool.query<{ id: string; username: string }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (LOWER(username)) DO NOTHING
     RETURNING id, username`,
    [username, passwordHash],
  );
  const user = rows[0];
  if (!user) {
    log('info', 'register_rejected', { ip: req.ip, reason: 'username_taken' });
    res.status(400).json({ error: 'That username is already taken.' });
    return;
  }

  startSession(res, user);
  req.auth = { sub: user.id, username: user.username, xsrf: '', exp: 0 };
  log('info', 'register_ok', { ip: req.ip, username: user.username });
  res.status(201).json({ user });
});

app.post('/login', rejectCrossOrigin, requireGuestXsrf, parseJson, async (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64) {
    res.status(400).json({ error: 'Enter your username and password.' });
    return;
  }
  // A name that couldn't have been registered can't match an account. Refusing it here also stops
  // unusual Unicode spellings from getting separate throttle counts for the same account.
  if (usernameProblem(username)) {
    log('info', 'login_failed', { ip: req.ip });
    res.status(401).json({ error: 'Incorrect username or password.' });
    return;
  }
  const ip = req.ip ?? 'unknown';
  if (loginThrottle.isBlocked(username, ip)) {
    log('warn', 'login_throttled', { ip: req.ip });
    res.status(429).json({ error: 'Too many failed attempts. Wait a few minutes and try again.' });
    return;
  }
  loginThrottle.recordAttempt(username, ip);

  const { rows } = await pool.query<{ id: string; username: string; password_hash: string }>(
    'SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)',
    [username],
  );
  const user = rows[0];
  // Compare a truncated copy so an overlong password fails the same way as a wrong one.
  const matches = await bcrypt.compare(password.slice(0, 200), user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !matches) {
    log('info', 'login_failed', { ip: req.ip });
    res.status(401).json({ error: 'Incorrect username or password.' });
    return;
  }

  loginThrottle.clear(username, ip);
  startSession(res, user);
  req.auth = { sub: user.id, username: user.username, xsrf: '', exp: 0 };
  log('info', 'login_ok', { ip: req.ip, username: user.username });
  res.json({ user: { id: user.id, username: user.username } });
});

app.post('/logout', rejectCrossOrigin, (req, res) => {
  const claims = verifySessionToken(req.cookies[SESSION_COOKIE], publicKey);
  if (claims) {
    const headerToken = req.header(XSRF_HEADER);
    if (!headerToken || !safeEqual(claims.xsrf, headerToken)) {
      res.status(403).json({ error: "We couldn't confirm you're logged in. Reload the page and try again." });
      return;
    }
    req.auth = claims;
    log('info', 'logout_ok', { ip: req.ip, username: claims.username });
  }
  res.clearCookie(SESSION_COOKIE, BASE_COOKIE);
  res.clearCookie(GUEST_XSRF_COOKIE, BASE_COOKIE);
  res.json({ ok: true });
});

app.use(notFoundJson);
app.use(errorHandler);

app.listen(PORT, () => {
  log('info', 'auth_server_listening', { port: PORT });
});
