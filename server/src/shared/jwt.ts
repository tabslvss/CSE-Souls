import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'session';
export const JWT_ALGORITHM = 'RS256' as const;
export const JWT_ISSUER = 'cse-souls-auth';
export const JWT_AUDIENCE = 'cse-souls-app';

export const PRIVATE_KEY_PATH = '/keys/private/jwt-private.pem';
export const PUBLIC_KEY_PATH = '/keys/public/jwt-public.pem';

export interface SessionClaims {
  /** User id. */
  sub: string;
  username: string;
  /** Per-session XSRF token. Signed into the JWT, so it cannot be swapped or forged. */
  xsrf: string;
  exp: number;
}

/**
 * Local verification only: no database lookup and no call to the auth server.
 * The algorithm list is pinned, so `alg: none` and HS256-signed-with-the-public-key
 * tokens are rejected, and so is any token missing an exp claim.
 */
export function verifySessionToken(token: unknown, publicKey: string): SessionClaims | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const claims = jwt.verify(token, publicKey, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (
      typeof claims !== 'object' ||
      typeof claims.sub !== 'string' ||
      typeof claims.username !== 'string' ||
      typeof claims.xsrf !== 'string' ||
      typeof claims.exp !== 'number'
    ) {
      return null;
    }
    return { sub: claims.sub, username: claims.username, xsrf: claims.xsrf, exp: claims.exp };
  } catch {
    return null;
  }
}
