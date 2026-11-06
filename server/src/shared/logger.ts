type Level = 'info' | 'warn' | 'error';

/**
 * Structured log line on stdout, readable with `docker compose logs`.
 * Callers must never pass passwords, cookies, JWTs or XSRF tokens as fields.
 */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: process.env.SERVICE_NAME ?? 'unknown',
      event,
      ...fields,
    }),
  );
}
