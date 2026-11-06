const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;
// bcrypt ignores everything past 72 bytes, so longer passwords are refused, not silently cut.
const MAX_PASSWORD_BYTES = 72;

export function usernameProblem(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return 'Usernames must be 3 to 20 letters or numbers.';
  }
  return null;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'A password is required.';
  if (password.length < 8) return 'Passwords must be at least 8 characters.';
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `That password is too long. Use ${MAX_PASSWORD_BYTES} characters or fewer.`;
  }
  if (!/[a-z]/.test(password)) return 'Passwords need a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Passwords need an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Passwords need a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Passwords need a special character.';
  return null;
}

const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 8;
// Generous, because a whole lecture hall can share one IP address and make honest typos.
const MAX_FAILURES_PER_IP = 3000;

interface FailureCount {
  count: number;
  resetAt: number;
}

const accountFailures = new Map<string, FailureCount>();
const ipFailures = new Map<string, FailureCount>();

function bump(counts: Map<string, FailureCount>, key: string, now: number): void {
  const entry = counts.get(key);
  if (!entry || entry.resetAt <= now) counts.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

function isOver(counts: Map<string, FailureCount>, key: string, limit: number, now: number): boolean {
  const entry = counts.get(key);
  return !!entry && entry.resetAt > now && entry.count >= limit;
}

/**
 * Brute-force throttle. Each account's count is kept per IP address too, so someone elsewhere
 * can't lock a player out by failing logins on purpose. People sharing one IP address, like a
 * campus network, still can. Telling them apart would need more than an IP, and the lockout
 * only lasts a few minutes.
 */
export const loginThrottle = {
  isBlocked(username: string, ip: string): boolean {
    const now = Date.now();
    return (
      isOver(accountFailures, `${ip}|${username.toLowerCase()}`, MAX_FAILURES_PER_ACCOUNT, now) ||
      isOver(ipFailures, ip, MAX_FAILURES_PER_IP, now)
    );
  },
  /** Counted before the slow password check, so simultaneous guesses can't slip past the limit. */
  recordAttempt(username: string, ip: string): void {
    const now = Date.now();
    bump(accountFailures, `${ip}|${username.toLowerCase()}`, now);
    bump(ipFailures, ip, now);
  },
  /** A correct password cancels the count for that attempt. */
  clear(username: string, ip: string): void {
    accountFailures.delete(`${ip}|${username.toLowerCase()}`);
    const entry = ipFailures.get(ip);
    if (entry) entry.count = Math.max(0, entry.count - 1);
  },
};

// Keeps the maps from growing forever when someone guesses random usernames.
setInterval(() => {
  const now = Date.now();
  for (const counts of [accountFailures, ipFailures]) {
    for (const [key, entry] of counts) {
      if (entry.resetAt <= now) counts.delete(key);
    }
  }
}, FAILURE_WINDOW_MS).unref();
