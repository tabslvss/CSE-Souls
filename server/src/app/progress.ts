/**
 * Saves what players earn. The game loop only adds to totals held in memory, and they reach the
 * database in batches, so a slow or failing database can never hold up a tick. Failed writes stay
 * in memory and go out with the next batch. Every value here comes from the server's own game
 * rules, and every statement is parameterized.
 */
import { log } from '../shared/logger.js';

export type QueryFn = (text: string, params: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export interface ProgressDelta {
  dust: number;
  enemies: number;
  animals: number;
  deaths: number;
}

export interface LoadedPlayer {
  avatarFile: string | null;
  classId: unknown;
  appearance: unknown;
  level: number;
  stats: { strength: number; dexterity: number; arcane: number; speed: number; stamina: number; health: number };
  dust: number;
  enemies: number;
  animals: number;
  chests: number[];
  achievements: string[];
}

const LOAD_SQL = `
  SELECT p.avatar_file, p.class_id, p.appearance, p.level, p.binary_dust,
         p.strength, p.dexterity, p.arcane, p.speed, p.stamina, p.health,
         s.enemies_killed, s.animals_hunted,
         ARRAY(SELECT chest_id FROM opened_chests WHERE user_id = $1) AS chests,
         ARRAY(SELECT achievement_id FROM user_achievements WHERE user_id = $1) AS achievements
  FROM player_profiles p
  LEFT JOIN player_stats s ON s.user_id = p.user_id
  WHERE p.user_id = $1`;

// One statement, so that a batch is saved whole or not at all and can safely be retried.
// Lifetime dust earned is what the xp column holds (docs/GAME_PLAN.md section 1.5).
const FLUSH_SQL = `
  WITH delta AS (
    SELECT * FROM unnest($1::uuid[], $2::bigint[], $3::int[], $4::int[], $5::int[])
      AS d(user_id, dust, enemies, animals, deaths)
  ), profiles AS (
    UPDATE player_profiles p
    SET binary_dust = p.binary_dust + delta.dust, xp = p.xp + delta.dust, updated_at = NOW()
    FROM delta WHERE p.user_id = delta.user_id AND delta.dust <> 0
  )
  UPDATE player_stats s
  SET enemies_killed = s.enemies_killed + delta.enemies,
      animals_hunted = s.animals_hunted + delta.animals,
      deaths = s.deaths + delta.deaths
  FROM delta WHERE s.user_id = delta.user_id`;

// The insert and the reward are one statement, so a chest can't pay out twice or get lost halfway.
const OPEN_CHEST_SQL = `
  WITH opened AS (
    INSERT INTO opened_chests (user_id, chest_id) VALUES ($1, $2)
    ON CONFLICT DO NOTHING RETURNING chest_id
  )
  UPDATE player_profiles
  SET binary_dust = binary_dust + $3::bigint, xp = xp + $3::bigint, updated_at = NOW()
  WHERE user_id = $1 AND EXISTS (SELECT 1 FROM opened)`;

const UNLOCK_SQL = `
  INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)
  ON CONFLICT DO NOTHING`;

export class ProgressStore {
  private pending = new Map<string, ProgressDelta>();
  private inFlight = new Set<Promise<unknown>>();
  private batchRunning = false;

  constructor(private query: QueryFn) {}

  async load(userId: string): Promise<LoadedPlayer | null> {
    const { rows } = await this.query(LOAD_SQL, [userId]);
    const row = rows[0];
    if (!row) return null;
    return {
      avatarFile: row.avatar_file,
      classId: row.class_id,
      appearance: row.appearance,
      level: row.level,
      stats: {
        strength: row.strength,
        dexterity: row.dexterity,
        arcane: row.arcane,
        speed: row.speed,
        stamina: row.stamina,
        health: row.health,
      },
      dust: Number(row.binary_dust),
      enemies: Number(row.enemies_killed ?? 0),
      animals: Number(row.animals_hunted ?? 0),
      chests: row.chests,
      achievements: row.achievements,
    };
  }

  add(userId: string, delta: Partial<ProgressDelta>): void {
    const entry = this.pending.get(userId) ?? { dust: 0, enemies: 0, animals: 0, deaths: 0 };
    entry.dust += delta.dust ?? 0;
    entry.enemies += delta.enemies ?? 0;
    entry.animals += delta.animals ?? 0;
    entry.deaths += delta.deaths ?? 0;
    this.pending.set(userId, entry);
  }

  /** Earned but not saved yet, because the last write failed. Added to what the database says on login. */
  unsaved(userId: string): ProgressDelta | undefined {
    return this.pending.get(userId);
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.inFlight.add(work);
    const done = () => this.inFlight.delete(work);
    work.then(done, done);
    return work;
  }

  private write(userIds: string[]): Promise<void> {
    const batch = userIds.map((userId) => [userId, this.pending.get(userId)!] as const);
    for (const userId of userIds) this.pending.delete(userId);
    const write = this.query(FLUSH_SQL, [
      batch.map(([userId]) => userId),
      batch.map(([, delta]) => delta.dust),
      batch.map(([, delta]) => delta.enemies),
      batch.map(([, delta]) => delta.animals),
      batch.map(([, delta]) => delta.deaths),
    ]).then(
      () => undefined,
      (err: unknown) => {
        // Put it back, on top of anything earned since, for the next batch to retry.
        for (const [userId, delta] of batch) this.add(userId, delta);
        log('error', 'progress_flush_failed', { message: err instanceof Error ? err.message : String(err) });
      },
    );
    return this.track(write);
  }

  /** Saves everyone's changes. Skipped while the last batch is still going, so slow writes can't pile up. */
  async flush(): Promise<void> {
    if (this.batchRunning || this.pending.size === 0) return;
    this.batchRunning = true;
    try {
      await this.write([...this.pending.keys()]);
    } finally {
      this.batchRunning = false;
    }
  }

  /** Saves one player right away, for when they leave. */
  async flushUser(userId: string): Promise<void> {
    if (this.pending.has(userId)) await this.write([userId]);
  }

  /** Waits for writes already under way, so a player who reconnects reads their latest totals. */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  /** True if this call opened the chest, false if this account already had. Rejects if the database failed. */
  openChest(userId: string, chestId: number, dust: number): Promise<boolean> {
    // Whether a row was updated is the only thing that says the insert was new.
    return this.track(this.query(OPEN_CHEST_SQL, [userId, chestId, dust]).then((result) => result.rowCount === 1));
  }

  /** True if the achievement is newly earned. Only ever called with ids fixed in the server's code. */
  unlock(userId: string, achievementId: string): Promise<boolean> {
    return this.query(UNLOCK_SQL, [userId, achievementId]).then((result) => result.rowCount === 1);
  }
}
