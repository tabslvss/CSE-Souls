/**
 * Saves what players earn. The game loop only adds to totals held in memory, and they reach the
 * database in batches, so a slow or failing database can never hold up a tick. Failed writes stay
 * in memory and go out with the next batch. Every value here comes from the server's own game
 * rules, and every statement is parameterized.
 */
import { MAX_STAT, STAT_KEYS, type StatKey, type Stats } from '../../../shared/classes.js';
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
  /** The account's active save. */
  slot: number;
  /** Null when that slot has no character yet. */
  classId: unknown;
  appearance: unknown;
  level: number;
  stats: Stats;
  dust: number;
  enemies: number;
  animals: number;
  chests: number[];
  graces: number[];
  respawnGrace: number | null;
  achievements: string[];
}

const LOAD_SQL = `
  SELECT p.avatar_file, p.active_slot, c.class_id, c.appearance, c.level, c.binary_dust,
         c.strength, c.dexterity, c.arcane, c.speed, c.stamina, c.health, c.respawn_grace,
         s.enemies_killed, s.animals_hunted,
         ARRAY(SELECT chest_id FROM opened_chests o WHERE o.user_id = $1 AND o.slot = p.active_slot) AS chests,
         ARRAY(SELECT grace_id FROM discovered_graces g WHERE g.user_id = $1 AND g.slot = p.active_slot) AS graces,
         ARRAY(SELECT achievement_id FROM user_achievements WHERE user_id = $1) AS achievements
  FROM player_profiles p
  LEFT JOIN character_saves c ON c.user_id = p.user_id AND c.slot = p.active_slot
  LEFT JOIN player_stats s ON s.user_id = p.user_id
  WHERE p.user_id = $1`;

// One statement, so that a batch is saved whole or not at all and can safely be retried.
// Dust belongs to a save and kill counts to the account, which may appear twice in a batch if it
// just switched saves, so the counts are added up first. An UPDATE can't apply two rows to one.
// Lifetime dust earned is what the xp column holds (docs/GAME_PLAN.md section 1.5).
const FLUSH_SQL = `
  WITH delta AS (
    SELECT * FROM unnest($1::uuid[], $2::int[], $3::bigint[], $4::int[], $5::int[], $6::int[])
      AS d(user_id, slot, dust, enemies, animals, deaths)
  ), saves AS (
    UPDATE character_saves c
    SET binary_dust = c.binary_dust + delta.dust, xp = c.xp + delta.dust, updated_at = NOW()
    FROM delta WHERE c.user_id = delta.user_id AND c.slot = delta.slot AND delta.dust <> 0
  ), account AS (
    SELECT user_id, SUM(enemies)::int AS enemies, SUM(animals)::int AS animals, SUM(deaths)::int AS deaths
    FROM delta GROUP BY user_id
  )
  UPDATE player_stats s
  SET enemies_killed = s.enemies_killed + account.enemies,
      animals_hunted = s.animals_hunted + account.animals,
      deaths = s.deaths + account.deaths
  FROM account WHERE s.user_id = account.user_id`;

// The insert and the reward are one statement, so a chest can't pay out twice or get lost halfway.
const OPEN_CHEST_SQL = `
  WITH opened AS (
    INSERT INTO opened_chests (user_id, slot, chest_id) VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING RETURNING chest_id
  )
  UPDATE character_saves
  SET binary_dust = binary_dust + $4::bigint, xp = xp + $4::bigint, updated_at = NOW()
  WHERE user_id = $1 AND slot = $2 AND EXISTS (SELECT 1 FROM opened)`;

const DISCOVER_SQL = `
  INSERT INTO discovered_graces (user_id, slot, grace_id) VALUES ($1, $2, $3)
  ON CONFLICT DO NOTHING`;

const RESPAWN_SQL = `
  UPDATE character_saves SET respawn_grace = $3, updated_at = NOW()
  WHERE user_id = $1 AND slot = $2`;

/** Column names can't be parameters, so the stat only ever picks one of these fixed strings. */
const UPGRADE_SQL: Record<StatKey, string> = Object.fromEntries(
  STAT_KEYS.map((stat) => [
    stat,
    // The dust check, the cap and the price all live in this one statement, so two racing upgrades can't both pass.
    // level = $4 means the price was worked out for this exact level.
    `UPDATE character_saves
     SET ${stat} = ${stat} + 1, level = level + 1, binary_dust = binary_dust - $3::bigint, updated_at = NOW()
     WHERE user_id = $1 AND slot = $2 AND binary_dust >= $3::bigint AND level = $4 AND ${stat} < $5`,
  ]),
) as Record<StatKey, string>;

const UNLOCK_SQL = `
  INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)
  ON CONFLICT DO NOTHING`;

interface PendingSave {
  userId: string;
  slot: number;
  delta: ProgressDelta;
}

export class ProgressStore {
  /** Keyed by account and save, so a save can never be paid what another one earned. */
  private pending = new Map<string, PendingSave>();
  private inFlight = new Set<Promise<unknown>>();
  private batchRunning = false;

  constructor(private query: QueryFn) {}

  async load(userId: string): Promise<LoadedPlayer | null> {
    const { rows } = await this.query(LOAD_SQL, [userId]);
    const row = rows[0];
    if (!row) return null;
    return {
      avatarFile: row.avatar_file,
      slot: row.active_slot,
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
      graces: row.graces,
      respawnGrace: row.respawn_grace,
      achievements: row.achievements,
    };
  }

  add(userId: string, slot: number, delta: Partial<ProgressDelta>): void {
    const key = `${userId}:${slot}`;
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { userId, slot, delta: { dust: 0, enemies: 0, animals: 0, deaths: 0 } };
      this.pending.set(key, entry);
    }
    entry.delta.dust += delta.dust ?? 0;
    entry.delta.enemies += delta.enemies ?? 0;
    entry.delta.animals += delta.animals ?? 0;
    entry.delta.deaths += delta.deaths ?? 0;
  }

  /** Earned but not saved yet, because the last write failed. Added to what the database says on login. */
  unsaved(userId: string, slot: number): ProgressDelta | undefined {
    return this.pending.get(`${userId}:${slot}`)?.delta;
  }

  /** Kills and deaths belong to the account, so they count from every save still waiting to be written. */
  unsavedAccount(userId: string): ProgressDelta {
    const total: ProgressDelta = { dust: 0, enemies: 0, animals: 0, deaths: 0 };
    for (const entry of this.pending.values()) {
      if (entry.userId !== userId) continue;
      total.enemies += entry.delta.enemies;
      total.animals += entry.delta.animals;
      total.deaths += entry.delta.deaths;
    }
    return total;
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.inFlight.add(work);
    const done = () => this.inFlight.delete(work);
    work.then(done, done);
    return work;
  }

  private write(keys: string[]): Promise<void> {
    const batch = keys.map((key) => this.pending.get(key)!);
    for (const key of keys) this.pending.delete(key);
    const write = this.query(FLUSH_SQL, [
      batch.map((entry) => entry.userId),
      batch.map((entry) => entry.slot),
      batch.map((entry) => entry.delta.dust),
      batch.map((entry) => entry.delta.enemies),
      batch.map((entry) => entry.delta.animals),
      batch.map((entry) => entry.delta.deaths),
    ]).then(
      () => undefined,
      (err: unknown) => {
        // Put it back, on top of anything earned since, for the next batch to retry.
        for (const entry of batch) this.add(entry.userId, entry.slot, entry.delta);
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

  /** Saves one account right away, for when they leave. */
  async flushUser(userId: string): Promise<void> {
    const keys = [...this.pending.entries()].filter(([, entry]) => entry.userId === userId).map(([key]) => key);
    if (keys.length > 0) await this.write(keys);
  }

  /** Waits for writes already under way, so a player who reconnects reads their latest totals. */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  /** True if this call opened the chest, false if this save already had. Rejects if the database failed. */
  openChest(userId: string, slot: number, chestId: number, dust: number): Promise<boolean> {
    // Whether a row was updated is the only thing that says the insert was new.
    return this.track(this.query(OPEN_CHEST_SQL, [userId, slot, chestId, dust]).then((result) => result.rowCount === 1));
  }

  /** True if the achievement is newly earned. Only ever called with ids fixed in the server's code. */
  unlock(userId: string, achievementId: string): Promise<boolean> {
    return this.query(UNLOCK_SQL, [userId, achievementId]).then((result) => result.rowCount === 1);
  }

  discoverGrace(userId: string, slot: number, graceId: number): Promise<void> {
    return this.track(this.query(DISCOVER_SQL, [userId, slot, graceId]).then(() => undefined));
  }

  saveRespawn(userId: string, slot: number, graceId: number): Promise<void> {
    return this.track(this.query(RESPAWN_SQL, [userId, slot, graceId]).then(() => undefined));
  }

  /**
   * True if the stat went up. Dust in memory runs ahead of the database, so what this player earned
   * is written first, or a price they can afford would be refused. Rejects if the database failed.
   */
  async upgradeStat(userId: string, slot: number, stat: StatKey, cost: number, level: number): Promise<boolean> {
    await this.flushUser(userId);
    await this.settle();
    const result = await this.track(this.query(UPGRADE_SQL[stat], [userId, slot, cost, level, MAX_STAT]));
    return result.rowCount === 1;
  }
}
