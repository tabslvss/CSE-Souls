import { createServer } from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { pool, prepareDatabase } from '../shared/db.js';
import {
  errorHandler,
  installBaseMiddleware,
  notFoundJson,
  rejectCrossOrigin,
  safeEqual,
  XSRF_HEADER,
} from '../shared/http.js';
import { CLASSES, DEFAULT_APPEARANCE, findClass, sanitizeAppearance } from '../../../shared/classes.js';
import { parseSlot, SAVE_SLOTS } from '../../../shared/graces.js';
import { SESSION_COOKIE, verifySessionToken } from '../shared/jwt.js';
import { log } from '../shared/logger.js';
import {
  AVATAR_DIR,
  AvatarBusyError,
  avatarUrl,
  deleteAvatarFile,
  InvalidImageError,
  MAX_AVATAR_BYTES,
  saveAvatar,
} from './avatars.js';
import {
  AvatarSourceError,
  DICEBEAR_STYLES,
  EMBLEMS,
  fetchDiceBearAvatar,
  fetchGitHubAvatar,
  renderEmblem,
} from './avatarSources.js';
import { loadPublicKey } from './keys.js';
import { attachRealtime, canSwitchSave, onlineCount, seatedSlot } from './realtime.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = path.resolve('public');
const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;

await prepareDatabase();
const publicKey = await loadPublicKey();

const app = express();
installBaseMiddleware(app);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Identity comes only from the verified JWT. The database is never asked who someone is.
app.use((req, _res, next) => {
  req.auth = verifySessionToken(req.cookies[SESSION_COOKIE], publicKey);
  next();
});

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'You must be logged in.' });
    return;
  }
  next();
}

/** The XSRF token is signed into the JWT, so it is tied to this user's session. */
function requireXsrf(req: Request, res: Response, next: NextFunction): void {
  const headerToken = req.header(XSRF_HEADER);
  if (!req.auth || !headerToken || !safeEqual(req.auth.xsrf, headerToken)) {
    res.status(403).json({ error: "We couldn't confirm you're logged in. Reload the page and try again." });
    return;
  }
  next();
}

const stateChange = [rejectCrossOrigin, requireAuth, requireXsrf];

interface AchievementRow {
  id: string;
  name: string;
  description: string;
  unlocked_at: Date | null;
}

async function grantAchievement(userId: string, achievementId: string): Promise<AchievementRow[]> {
  const { rows } = await pool.query<AchievementRow>(
    `WITH granted AS (
       INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING achievement_id, unlocked_at
     )
     SELECT a.id, a.name, a.description, g.unlocked_at
     FROM granted g JOIN achievements a ON a.id = g.achievement_id`,
    [userId, achievementId],
  );
  return rows;
}

// A profile shows the save being played. Someone with no character yet shows the starting numbers.
const PLAYER_COLUMNS = `
  u.id, u.username, u.created_at,
  p.avatar_file, c.class_id,
  COALESCE(c.level, 1) AS level, COALESCE(c.xp, 0) AS xp, COALESCE(c.binary_dust, 0) AS binary_dust,
  COALESCE(c.strength, 10) AS strength, COALESCE(c.dexterity, 10) AS dexterity, COALESCE(c.arcane, 10) AS arcane,
  COALESCE(c.speed, 10) AS speed, COALESCE(c.stamina, 10) AS stamina, COALESCE(c.health, 10) AS health,
  s.enemies_killed, s.animals_hunted, s.boss_kills, s.boss_damage, s.deaths`;

async function loadPlayer(where: string, value: string) {
  const { rows } = await pool.query(
    `SELECT ${PLAYER_COLUMNS}
     FROM users u
     JOIN player_profiles p ON p.user_id = u.id
     JOIN player_stats s ON s.user_id = u.id
     LEFT JOIN character_saves c ON c.user_id = u.id AND c.slot = p.active_slot
     WHERE ${where}`,
    [value],
  );
  const row = rows[0];
  if (!row) return null;
  const achievements = await pool.query<AchievementRow>(
    `SELECT a.id, a.name, a.description, ua.unlocked_at
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
     ORDER BY a.sort_order`,
    [row.id],
  );
  return {
    username: row.username as string,
    joinedAt: row.created_at as Date,
    avatarUrl: avatarUrl(row.avatar_file),
    level: row.level as number,
    xp: Number(row.xp),
    classId: row.class_id as string | null,
    binaryDust: Number(row.binary_dust),
    stats: {
      strength: row.strength as number,
      dexterity: row.dexterity as number,
      arcane: row.arcane as number,
      speed: row.speed as number,
      stamina: row.stamina as number,
      health: row.health as number,
    },
    record: {
      enemiesKilled: row.enemies_killed as number,
      animalsHunted: row.animals_hunted as number,
      bossKills: row.boss_kills as number,
      bossDamage: Number(row.boss_damage),
      deaths: row.deaths as number,
    },
    achievements: achievements.rows.map(serializeAchievement),
  };
}

function serializeAchievement(row: AchievementRow) {
  return { id: row.id, name: row.name, description: row.description, unlockedAt: row.unlocked_at };
}

// ---- Session and profile ----------------------------------------------------------------

app.get('/api/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.auth) {
    res.json({ user: null });
    return;
  }
  const { rows } = await pool.query<{ avatar_file: string | null; level: number | null; class_id: string | null }>(
    `SELECT p.avatar_file, c.level, c.class_id
     FROM player_profiles p
     LEFT JOIN character_saves c ON c.user_id = p.user_id AND c.slot = p.active_slot
     WHERE p.user_id = $1`,
    [req.auth.sub],
  );
  const profile = rows[0];
  res.json({
    user: {
      username: req.auth.username,
      avatarUrl: avatarUrl(profile?.avatar_file),
      level: profile?.level ?? 1,
      hasCharacter: !!profile?.class_id,
    },
    xsrfToken: req.auth.xsrf,
  });
});

app.get('/api/profile', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const player = await loadPlayer('u.id = $1', req.auth!.sub);
  if (!player) {
    notFoundJson(req, res);
    return;
  }
  res.json(player);
});

app.get('/api/players/:username', async (req, res) => {
  const { username } = req.params;
  const player = USERNAME_PATTERN.test(username)
    ? await loadPlayer('LOWER(u.username) = LOWER($1)', username)
    : null;
  if (!player) {
    res.status(404).json({ error: 'No player has that username.' });
    return;
  }
  res.json(player);
});

// ---- Character creation -----------------------------------------------------------------

app.get('/api/classes', (_req, res) => {
  res.json({ classes: CLASSES });
});

async function activeSlot(userId: string): Promise<number> {
  const { rows } = await pool.query<{ active_slot: number }>(
    'SELECT active_slot FROM player_profiles WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.active_slot ?? 1;
}

const NO_SLOT = 'There is no save with that number.';
const REST_FIRST = 'Rest at a Binary Grace before changing to another save.';

// Every query below is keyed by the id in the verified session, so a slot number can only ever
// mean one of the logged-in player's own saves. Another account's saves can't be named at all.
app.get('/api/character', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // Query strings are always text, so only these exact forms count as a slot.
  const asked = req.query.slot;
  const slot = asked === undefined ? await activeSlot(req.auth!.sub) : parseSlot(/^[1-9]$/.test(String(asked)) ? Number(asked) : null);
  if (slot === null) {
    res.status(400).json({ error: NO_SLOT });
    return;
  }
  const { rows } = await pool.query<{ class_id: string; appearance: unknown }>(
    'SELECT class_id, appearance FROM character_saves WHERE user_id = $1 AND slot = $2',
    [req.auth!.sub, slot],
  );
  const row = rows[0];
  res.json({
    character: row
      ? { classId: row.class_id, appearance: sanitizeAppearance(row.appearance) ?? DEFAULT_APPEARANCE }
      : null,
  });
});

// Saving makes this the save in play. A character whose stats were raised keeps its class and stats,
// so this route can't be used to undo upgrades or get a free class change: only its looks can change.
const SAVE_CHARACTER_SQL = `
  WITH saved AS (
    INSERT INTO character_saves AS c (user_id, slot, class_id, appearance, strength, dexterity, arcane, speed, stamina, health)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (user_id, slot) DO UPDATE SET
      class_id = EXCLUDED.class_id,
      appearance = EXCLUDED.appearance,
      strength = CASE WHEN c.level = 1 THEN EXCLUDED.strength ELSE c.strength END,
      dexterity = CASE WHEN c.level = 1 THEN EXCLUDED.dexterity ELSE c.dexterity END,
      arcane = CASE WHEN c.level = 1 THEN EXCLUDED.arcane ELSE c.arcane END,
      speed = CASE WHEN c.level = 1 THEN EXCLUDED.speed ELSE c.speed END,
      stamina = CASE WHEN c.level = 1 THEN EXCLUDED.stamina ELSE c.stamina END,
      health = CASE WHEN c.level = 1 THEN EXCLUDED.health ELSE c.health END,
      updated_at = NOW()
    WHERE c.level = 1 OR c.class_id = EXCLUDED.class_id
    RETURNING slot
  ), active AS (
    UPDATE player_profiles SET active_slot = $2, updated_at = NOW()
    WHERE user_id = $1 AND EXISTS (SELECT 1 FROM saved)
  )
  SELECT slot FROM saved`;

app.post('/api/character', ...stateChange, express.json({ limit: '2kb' }), async (req, res) => {
  const { classId, appearance, slot: askedSlot } = (req.body ?? {}) as { classId?: unknown; appearance?: unknown; slot?: unknown };
  const definition = findClass(classId);
  const cleanAppearance = sanitizeAppearance(appearance);
  const userId = req.auth!.sub;
  const slot = askedSlot === undefined ? await activeSlot(userId) : parseSlot(askedSlot);
  if (!definition || !cleanAppearance || slot === null) {
    res.status(400).json({ error: 'That character could not be saved.' });
    return;
  }
  // Saving another slot would change saves, which has the same rule as loading one.
  const seated = seatedSlot(userId);
  if (seated !== null && seated !== slot && !canSwitchSave(userId)) {
    res.status(409).json({ error: REST_FIRST });
    return;
  }
  const { strength, dexterity, arcane, speed, stamina, health } = definition.baseStats;
  const { rowCount } = await pool.query(SAVE_CHARACTER_SQL, [
    userId, slot, definition.id, JSON.stringify(cleanAppearance), strength, dexterity, arcane, speed, stamina, health,
  ]);
  if (rowCount !== 1) {
    res.status(409).json({
      error: 'This character has raised its stats, so its class is fixed. Start a new character in another save to play a different class.',
    });
    return;
  }
  log('info', 'character_saved', { username: req.auth!.username, classId: definition.id, slot });
  res.json({ classId: definition.id, appearance: cleanAppearance });
});

// ---- Saves ------------------------------------------------------------------------------

app.get('/api/saves', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const userId = req.auth!.sub;
  const { rows } = await pool.query<{
    slot: number;
    class_id: string;
    level: number;
    binary_dust: string;
    updated_at: Date;
    graces: string;
  }>(
    `SELECT c.slot, c.class_id, c.level, c.binary_dust, c.updated_at,
            (SELECT COUNT(*) FROM discovered_graces g WHERE g.user_id = c.user_id AND g.slot = c.slot) AS graces
     FROM character_saves c WHERE c.user_id = $1`,
    [userId],
  );
  const slots = Array.from({ length: SAVE_SLOTS }, (_, index) => {
    const row = rows.find((item) => item.slot === index + 1);
    return {
      slot: index + 1,
      character: row
        ? {
            classId: row.class_id,
            level: row.level,
            binaryDust: Number(row.binary_dust),
            graces: Number(row.graces),
            updatedAt: row.updated_at,
          }
        : null,
    };
  });
  res.json({ active: await activeSlot(userId), slots });
});

// Only moves which save is in play. The next time this account enters the world, it loads that one.
app.post('/api/saves/select', ...stateChange, express.json({ limit: '1kb' }), async (req, res) => {
  const slot = parseSlot((req.body as { slot?: unknown } | undefined)?.slot);
  if (slot === null) {
    res.status(400).json({ error: NO_SLOT });
    return;
  }
  const userId = req.auth!.sub;
  if (!canSwitchSave(userId)) {
    res.status(409).json({ error: REST_FIRST });
    return;
  }
  const { rowCount } = await pool.query(
    `UPDATE player_profiles SET active_slot = $2, updated_at = NOW()
     WHERE user_id = $1 AND EXISTS (SELECT 1 FROM character_saves WHERE user_id = $1 AND slot = $2)`,
    [userId, slot],
  );
  if (rowCount !== 1) {
    res.status(404).json({ error: NO_SLOT });
    return;
  }
  log('info', 'save_selected', { username: req.auth!.username, slot });
  res.json({ active: slot });
});

// ---- Avatars ----------------------------------------------------------------------------

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0 },
}).single('avatar');

// Every source ends here, so an API's image gets the same checks and re-encoding as an upload.
async function applyAvatar(req: Request, res: Response, image: Buffer): Promise<void> {
  const filename = await saveAvatar(image);
  const userId = req.auth!.sub;
  const previous = await pool.query<{ avatar_file: string | null }>(
    'SELECT avatar_file FROM player_profiles WHERE user_id = $1',
    [userId],
  );
  await pool.query(
    'UPDATE player_profiles SET avatar_file = $1, updated_at = NOW() WHERE user_id = $2',
    [filename, userId],
  );
  await deleteAvatarFile(previous.rows[0]?.avatar_file);
  const unlocked = await grantAchievement(userId, 'profile_picture');
  log('info', 'avatar_updated', { username: req.auth!.username });
  res.json({ avatarUrl: avatarUrl(filename), unlocked: unlocked.map(serializeAchievement) });
}

function sendAvatarError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof InvalidImageError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof AvatarBusyError) {
    res.status(503).json({ error: 'The server is busy with other pictures. Please try again shortly.' });
  } else if (err instanceof AvatarSourceError) {
    res.status(err.status).json({ error: err.message });
  } else {
    next(err);
  }
}

// Each change can trigger a call to an outside service, so one player can't spam them through us.
const AVATAR_COOLDOWN_MS = 1000;
const lastAvatarChange = new Map<string, number>();
// One account can only have one picture being worked on at a time.
const avatarsInProgress = new Set<string>();

function avatarCooldown(req: Request, res: Response, next: NextFunction): void {
  const userId = req.auth!.sub;
  const now = Date.now();
  if (avatarsInProgress.has(userId) || now - (lastAvatarChange.get(userId) ?? 0) < AVATAR_COOLDOWN_MS) {
    res.status(429).json({ error: 'Please wait a moment and try again.' });
    return;
  }
  lastAvatarChange.set(userId, now);
  avatarsInProgress.add(userId);
  res.on('close', () => avatarsInProgress.delete(userId));
  next();
}

setInterval(() => {
  const cutoff = Date.now() - AVATAR_COOLDOWN_MS;
  for (const [userId, at] of lastAvatarChange) {
    if (at < cutoff) lastAvatarChange.delete(userId);
  }
}, 60_000).unref();

const parseJson = express.json({ limit: '1kb' });
const avatarChange = [...stateChange, avatarCooldown];

app.get('/api/avatar-options', (_req, res) => {
  res.json({
    emblems: EMBLEMS,
    styles: DICEBEAR_STYLES.map(({ id, label, params }) => ({
      id,
      label,
      previewUrl: `https://api.dicebear.com/10.x/${id}/svg?${params}&seed=`,
    })),
  });
});

app.post('/api/profile/avatar', ...avatarChange, (req, res, next) => {
  avatarUpload(req, res, async (uploadError: unknown) => {
    try {
      if (uploadError instanceof multer.MulterError) {
        const tooLarge = uploadError.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400).json({
          error: tooLarge ? 'Images can be at most 5 MB.' : "That upload couldn't be read.",
        });
        return;
      }
      if (uploadError) throw uploadError;
      if (!req.file) {
        res.status(400).json({ error: 'Choose an image to upload.' });
        return;
      }
      await applyAvatar(req, res, req.file.buffer);
    } catch (err) {
      sendAvatarError(err, res, next);
    }
  });
});

app.post('/api/profile/avatar/emblem', ...avatarChange, parseJson, async (req, res, next) => {
  try {
    await applyAvatar(req, res, await renderEmblem(req.body?.emblem, PUBLIC_DIR));
  } catch (err) {
    sendAvatarError(err, res, next);
  }
});

app.post('/api/profile/avatar/generated', ...avatarChange, parseJson, async (req, res, next) => {
  try {
    await applyAvatar(req, res, await fetchDiceBearAvatar(req.body?.style, req.body?.seed));
  } catch (err) {
    sendAvatarError(err, res, next);
  }
});

app.post('/api/profile/avatar/github', ...avatarChange, parseJson, async (req, res, next) => {
  try {
    await applyAvatar(req, res, await fetchGitHubAvatar(req.body?.login));
  } catch (err) {
    sendAvatarError(err, res, next);
  }
});

app.delete('/api/profile/avatar', ...stateChange, async (req, res) => {
  const { rows } = await pool.query<{ avatar_file: string | null }>(
    `UPDATE player_profiles p SET avatar_file = NULL, updated_at = NOW()
     FROM (SELECT user_id, avatar_file FROM player_profiles WHERE user_id = $1) old
     WHERE p.user_id = old.user_id
     RETURNING old.avatar_file`,
    [req.auth!.sub],
  );
  await deleteAvatarFile(rows[0]?.avatar_file);
  res.json({ avatarUrl: null });
});

// ---- Public data ------------------------------------------------------------------------

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

// Client input only ever selects a key here. It is never placed into the SQL text.
const LEADERBOARD_ORDER: Record<string, string> = {
  boss_kills: 's.boss_kills DESC, s.boss_damage DESC',
  boss_damage: 's.boss_damage DESC, s.boss_kills DESC',
  kills: 's.enemies_killed DESC, s.animals_hunted DESC',
  level: 'COALESCE(best.level, 1) DESC, COALESCE(best.xp, 0) DESC',
};

app.get('/api/leaderboard', async (req, res) => {
  const sortKey = typeof req.query.sort === 'string' ? req.query.sort : 'boss_kills';
  const order = Object.hasOwn(LEADERBOARD_ORDER, sortKey)
    ? LEADERBOARD_ORDER[sortKey]
    : LEADERBOARD_ORDER.boss_kills;
  const limit = clampInteger(req.query.limit, 25, 1, 100);
  const offset = clampInteger(req.query.offset, 0, 0, 1_000_000);

  const { rows } = await pool.query(
    `SELECT ROW_NUMBER() OVER (ORDER BY ${order}, LOWER(u.username)) AS rank,
            COUNT(*) OVER () AS total,
            u.username, p.avatar_file, COALESCE(best.level, 1) AS level,
            s.boss_kills, s.boss_damage, s.enemies_killed, s.animals_hunted
     FROM users u
     JOIN player_profiles p ON p.user_id = u.id
     JOIN player_stats s ON s.user_id = u.id
     -- An account ranks by its best save, so starting a new character doesn't cost a place.
     LEFT JOIN LATERAL (
       SELECT c.level, c.xp FROM character_saves c WHERE c.user_id = u.id ORDER BY c.level DESC, c.xp DESC LIMIT 1
     ) best ON TRUE
     ORDER BY rank
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  res.json({
    total: Number(rows[0]?.total ?? 0),
    entries: rows.map((row) => ({
      rank: Number(row.rank),
      username: row.username,
      avatarUrl: avatarUrl(row.avatar_file),
      level: row.level,
      bossKills: row.boss_kills,
      bossDamage: Number(row.boss_damage),
      kills: row.enemies_killed + row.animals_hunted,
    })),
  });
});

app.get('/api/achievements', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { rows } = await pool.query<AchievementRow & { holders: string }>(
    `SELECT a.id, a.name, a.description, mine.unlocked_at,
            (SELECT COUNT(*) FROM user_achievements ua WHERE ua.achievement_id = a.id) AS holders
     FROM achievements a
     LEFT JOIN user_achievements mine ON mine.achievement_id = a.id AND mine.user_id = $1
     ORDER BY a.sort_order`,
    [req.auth?.sub ?? null],
  );
  res.json({
    achievements: rows.map((row) => ({ ...serializeAchievement(row), holders: Number(row.holders) })),
  });
});

app.get('/api/realm', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { rows } = await pool.query<{ registered: string; boss_kills: string | null }>(
    `SELECT (SELECT COUNT(*) FROM users) AS registered,
            (SELECT SUM(boss_kills) FROM player_stats) AS boss_kills`,
  );
  res.json({
    online: onlineCount(),
    registered: Number(rows[0]?.registered ?? 0),
    bossKills: Number(rows[0]?.boss_kills ?? 0),
  });
});

app.use('/api', notFoundJson);

// ---- Static files and the website -------------------------------------------------------

app.use(
  '/avatars',
  express.static(AVATAR_DIR, { immutable: true, maxAge: '1y', index: false, fallthrough: false }),
);
app.use(
  '/assets',
  express.static(path.join(PUBLIC_DIR, 'assets'), {
    immutable: true,
    maxAge: '1y',
    index: false,
    fallthrough: false,
  }),
);
app.use(
  '/audio',
  express.static(path.join(PUBLIC_DIR, 'audio'), { maxAge: '1d', index: false, fallthrough: false }),
);
app.use(
  '/models',
  express.static(path.join(PUBLIC_DIR, 'models'), { maxAge: '1d', index: false, fallthrough: false }),
);
app.use(
  '/icons',
  express.static(path.join(PUBLIC_DIR, 'icons'), { maxAge: '1d', index: false, fallthrough: false }),
);
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

// Any other GET is a page in the website, which the React router renders in the browser.
app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(notFoundJson);
app.use(errorHandler);

const server = createServer(app);
attachRealtime(server, publicKey);
server.listen(PORT, () => {
  log('info', 'app_server_listening', { port: PORT });
});
