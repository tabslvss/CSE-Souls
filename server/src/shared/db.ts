import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { log } from './logger.js';

// Connection settings come from the standard PG* environment variables set in compose.yml.
export const pool = new pg.Pool({ max: 10 });
// Without a listener, an idle connection dropping (say, a database restart) crashes the process.
// The pool has already discarded the broken connection and opens a new one on the next query.
pool.on('error', (err) => log('error', 'db_idle_client_error', { message: err.message }));

const MIGRATION_LOCK_ID = 312_312;
const MAX_CONNECT_ATTEMPTS = 40;

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt >= MAX_CONNECT_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Applies any new files from /migrations in name order. Both services call this at
 * startup, so an advisory lock makes whichever arrives second wait, then find no work.
 */
export async function prepareDatabase(migrationsDir = path.resolve('migrations')): Promise<void> {
  await waitForDatabase();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log('info', 'migration_applied', { file });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
