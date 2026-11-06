import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { parse as parseCookieHeader } from 'cookie';
import type { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { SessionClaims } from './jwt.js';
import { log } from './logger.js';

export const XSRF_HEADER = 'x-xsrf-token';

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'http://localhost:8080')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
// The page's own WebSocket address, for the Content-Security-Policy.
const SOCKET_ORIGINS = [...ALLOWED_ORIGINS].map((origin) => origin.replace(/^http/, 'ws'));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cookies: Record<string, string | undefined>;
      auth: SessionClaims | null;
    }
  }
}

export function cookiesFrom(req: IncomingMessage): Record<string, string | undefined> {
  return parseCookieHeader(req.headers.cookie ?? '');
}

/** Middleware shared by both services: headers, cookie parsing and request logging. */
export function installBaseMiddleware(app: Express): void {
  app.disable('x-powered-by');
  // Exactly one trusted proxy (nginx) sits in front, so req.ip is the address nginx saw and can't
  // be spoofed with headers. On Docker Desktop that's always the Docker gateway, not the real client.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          // DiceBear serves the avatar picker's previews.
          imgSrc: ["'self'", 'data:', 'blob:', 'https://api.dicebear.com'],
          fontSrc: ["'self'"],
          mediaSrc: ["'self'"],
          // Have I Been Pwned is called from the register page to check for breached passwords.
          // blob: is how the 3D model loader reads textures embedded in model files.
          connectSrc: ["'self'", 'blob:', ...SOCKET_ORIGINS, 'https://api.pwnedpasswords.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // HSTS is set by nginx only on the deployed HTTPS server. It would be wrong on localhost.
      strictTransportSecurity: false,
    }),
  );

  app.use((req, res, next) => {
    req.cookies = cookiesFrom(req);
    req.auth = null;
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path === '/healthz') return;
      log('info', 'http_request', {
        method: req.method,
        // req.path leaves out the query string, so nothing sensitive can leak from it.
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - startedAt,
        ip: req.ip,
        username: req.auth?.username,
      });
    });
    next();
  });
}

/** Constant-time string comparison. Hashing first equalizes the input lengths. */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Exact match on the whole origin: scheme, host and port. An attacker's page can't change the
 * Origin header a browser sends, and comparing against a fixed list means the client-supplied
 * Host header plays no part in the decision.
 */
export function isAllowedOrigin(req: IncomingMessage): boolean {
  const { origin } = req.headers;
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

/** Blocks state-changing requests that a browser reports as coming from another site. */
export function rejectCrossOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.headers.origin && !isAllowedOrigin(req)) {
    res.status(403).json({ error: 'That request was blocked. Reload the page and try again.' });
    return;
  }
  next();
}

export function notFoundJson(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}

/** Last-resort handler. Details go to the log; the client only gets a generic message. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = (err as { status?: number }).status ?? 500;
  if (status >= 500) {
    log('error', 'unhandled_error', {
      method: req.method,
      path: req.path,
      stack: err instanceof Error ? err.stack : String(err),
    });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }
  res.status(status).json({ error: 'Something went wrong with that request. Reload the page and try again.' });
}
