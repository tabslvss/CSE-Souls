import type { IncomingMessage, Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { findClass, sanitizeAppearance, DEFAULT_APPEARANCE } from '../../../shared/classes.js';
import { MAP } from '../../../shared/mapData.js';
import {
  packSnapshot,
  WS_CLOSE_ABUSE,
  WS_CLOSE_EXPIRED,
  WS_CLOSE_REPLACED,
  type ServerMessage,
} from '../../../shared/protocol.js';
import { SNAPSHOT_EVERY_TICKS, TICK_DT } from '../../../shared/sim.js';
import { pool } from '../shared/db.js';
import { cookiesFrom, isAllowedOrigin } from '../shared/http.js';
import { SESSION_COOKIE, verifySessionToken, type SessionClaims } from '../shared/jwt.js';
import { log } from '../shared/logger.js';
import { avatarUrl } from './avatars.js';
import { parseInput, withLoadTestCreatures, World, type WorldPlayer } from './combat.js';
import { Mode } from './creatures.js';
import { ProgressStore } from './progress.js';

const HEARTBEAT_MS = 25_000;
const MAX_MESSAGE_BYTES = 1024;
const MAX_MESSAGES_PER_SECOND = 120;
// A client too slow to keep up is dropped, rather than letting its queue grow without limit.
const MAX_BUFFERED_BYTES = 1024 * 1024;
// Past this a client just misses a snapshot, since the next one replaces it anyway.
const SKIP_SNAPSHOT_BUFFERED_BYTES = 64 * 1024;
// Each join is a database query and a message to every player, so reconnecting has a floor.
const RECONNECT_COOLDOWN_MS = 400;
const FLUSH_INTERVAL_MS = 3000;
// The clock checks far more often than it ticks, so ticks stay evenly spaced on average.
const CLOCK_INTERVAL_MS = 5;
const MAX_CATCH_UP_TICKS = 3;
const TICK_LOG_INTERVAL_MS = 10_000;

interface Connection {
  socket: WebSocket;
  claims: SessionClaims;
  isAlive: boolean;
  messagesThisSecond: number;
}

interface Seat {
  connection: Connection;
  player: WorldPlayer;
}

const connections = new Set<Connection>();
const seats = new Map<string, Seat>();
const lastConnectAt = new Map<string, number>();
const progress = new ProgressStore((text, params) => pool.query(text, params));

const world = new World({
  send(player, message) {
    const seat = seats.get(player.userId);
    if (seat?.player === player) send(seat.connection.socket, message);
  },
  credit(player, delta) {
    progress.add(player.userId, delta);
  },
  openChest(player, chest) {
    return progress.openChest(player.userId, chest.id, chest.dust);
  },
  unlock(player, achievement) {
    return progress.unlock(player.userId, achievement);
  },
  // Compose never sets this. Only a throwaway stack for server/loadtest.cjs does.
}, withLoadTestCreatures(MAP, Number(process.env.LOAD_TEST_CREATURES ?? 0)));

/** How many accounts are currently in the world. */
export function onlineCount(): number {
  return seats.size;
}

function send(socket: WebSocket, message: ServerMessage | string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return;
  }
  socket.send(typeof message === 'string' ? message : JSON.stringify(message));
}

function broadcast(message: ServerMessage, except?: Seat): void {
  const text = JSON.stringify(message);
  for (const seat of seats.values()) {
    if (seat !== except) send(seat.connection.socket, text);
  }
}

function takeSeat(userId: string): void {
  const existing = seats.get(userId);
  if (!existing) return;
  seats.delete(userId);
  world.removePlayer(existing.player);
  existing.connection.socket.close(WS_CLOSE_REPLACED, 'Opened in another tab');
  broadcast({ t: 'leave', id: existing.player.id });
  void progress.flushUser(userId);
}

async function enterWorld(connection: Connection): Promise<void> {
  const { sub: userId, username } = connection.claims;
  // One character per account: a new tab takes over from the old one. That happens before reading
  // totals, so nothing the old one earns can fall in the gap and be missing from the new one.
  takeSeat(userId);
  await progress.flushUser(userId);
  await progress.settle();

  const loaded = await progress.load(userId);
  const definition = findClass(loaded?.classId);
  if (!loaded || !definition) {
    send(connection.socket, { t: 'no_character' });
    connection.socket.close();
    return;
  }
  // The socket may have closed during the database calls.
  if (connection.socket.readyState !== WebSocket.OPEN) return;
  // Another connection for this account may have gotten in during them.
  takeSeat(userId);

  // Anything that failed to save is still waiting in memory, and it still belongs to this player.
  const unsaved = progress.unsaved(userId);
  const player = world.addPlayer({
    userId,
    info: {
      id: 0,
      // Identity only ever comes from the verified JWT.
      username,
      avatarUrl: avatarUrl(loaded.avatarFile),
      classId: definition.id,
      appearance: sanitizeAppearance(loaded.appearance) ?? DEFAULT_APPEARANCE,
      level: loaded.level,
      stats: loaded.stats,
    },
    dust: loaded.dust + (unsaved?.dust ?? 0),
    enemies: loaded.enemies + (unsaved?.enemies ?? 0),
    animals: loaded.animals + (unsaved?.animals ?? 0),
    chests: loaded.chests,
    achievements: loaded.achievements,
  });
  const seat: Seat = { connection, player };
  broadcast({ t: 'join', player: player.info });
  seats.set(userId, seat);

  send(connection.socket, {
    t: 'welcome',
    you: player.id,
    players: world.players.map((item) => item.info),
    snapshot: world.players.map((item) => packSnapshot(item.id, item.state)),
    binaryDust: player.dust,
    chests: [...player.chests],
    mapVersion: MAP.version,
  });
  send(connection.socket, { t: 'self', dust: player.dust, kills: player.enemies + player.animals });
  log('info', 'player_entered_world', { username });
}

function leaveWorld(connection: Connection): void {
  const userId = connection.claims.sub;
  const seat = seats.get(userId);
  if (seat?.connection === connection) {
    seats.delete(userId);
    world.removePlayer(seat.player);
    broadcast({ t: 'leave', id: seat.player.id });
    void progress.flushUser(userId);
  }
}

function tick(): void {
  world.tick();
  if (world.tickNumber % SNAPSHOT_EVERY_TICKS !== 0) return;
  world.beginSnapshots();
  for (const seat of seats.values()) {
    const { socket } = seat.connection;
    if (socket.bufferedAmount > SKIP_SNAPSHOT_BUFFERED_BYTES && socket.bufferedAmount <= MAX_BUFFERED_BYTES) continue;
    send(socket, world.snapshotFor(seat.player));
  }
  world.endSnapshots();
}

function percentile(sorted: number[], share: number): number {
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] * 100) / 100;
}

/** Runs ticks at a steady rate by the clock, not by how accurately a timer happens to fire. */
function startClock(): void {
  const tickMs = TICK_DT * 1000;
  let due = performance.now() + tickMs;
  let durations: number[] = [];
  let lastLog = performance.now();
  setInterval(() => {
    const now = performance.now();
    let ran = 0;
    while (now >= due && ran < MAX_CATCH_UP_TICKS) {
      const startedAt = performance.now();
      // One bad tick must never take the whole game server down.
      try {
        tick();
      } catch (err) {
        log('error', 'tick_failed', { stack: err instanceof Error ? err.stack : String(err) });
      }
      durations.push(performance.now() - startedAt);
      due += tickMs;
      ran += 1;
    }
    // After a long stall the world carries on from now, instead of rushing to make up the time.
    if (now >= due) due = now + tickMs;
    if (now - lastLog >= TICK_LOG_INTERVAL_MS) {
      lastLog = now;
      if (seats.size > 0 && durations.length > 0) {
        durations.sort((a, b) => a - b);
        log('info', 'tick_time', {
          p50: percentile(durations, 0.5),
          p99: percentile(durations, 0.99),
          max: percentile(durations, 1),
          players: seats.size,
          creatures: world.field.creatures.length,
          awake: world.field.creatures.filter((c) => c.mode !== Mode.Sleep).length,
        });
      }
      durations = [];
    }
  }, CLOCK_INTERVAL_MS);
}

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachRealtime(server: Server, publicKey: string): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Plain string handling, because parsing a URL can throw on a malformed request line.
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname !== '/ws') {
      refuse(socket, '404 Not Found');
      return;
    }
    // Browsers attach cookies to cross-site handshakes, so the origin is checked as well.
    if (!isAllowedOrigin(req)) {
      log('warn', 'ws_refused', { reason: 'origin' });
      refuse(socket, '403 Forbidden');
      return;
    }
    const claims = verifySessionToken(cookiesFrom(req)[SESSION_COOKIE], publicKey);
    if (!claims) {
      refuse(socket, '401 Unauthorized');
      return;
    }
    const now = Date.now();
    if (now - (lastConnectAt.get(claims.sub) ?? 0) < RECONNECT_COOLDOWN_MS) {
      refuse(socket, '429 Too Many Requests');
      return;
    }
    lastConnectAt.set(claims.sub, now);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection: Connection = { socket: ws, claims, isAlive: true, messagesThisSecond: 0 };
      connections.add(connection);

      // A socket keeps its identity for as long as it is open, so it ends with the token.
      const expiresInMs = Math.max(0, claims.exp * 1000 - Date.now());
      // A client can ignore a close frame for 30 seconds, so the player leaves the world right away.
      const expiryTimer = setTimeout(() => {
        leaveWorld(connection);
        ws.close(WS_CLOSE_EXPIRED, 'Session expired');
      }, expiresInMs);
      expiryTimer.unref();

      const overFloodLimit = (): boolean => {
        connection.messagesThisSecond += 1;
        if (connection.messagesThisSecond <= MAX_MESSAGES_PER_SECOND) return false;
        leaveWorld(connection);
        ws.close(WS_CLOSE_ABUSE, 'Too many messages');
        return true;
      };

      // Control frames never reach the message handler, so they're counted here.
      ws.on('pong', () => {
        connection.isAlive = true;
        overFloodLimit();
      });
      ws.on('ping', () => {
        overFloodLimit();
      });
      ws.on('error', () => ws.terminate());
      ws.on('message', (data, isBinary) => {
        if (overFloodLimit()) return;
        const seat = seats.get(claims.sub);
        if (isBinary || seat?.connection !== connection) return;
        const input = parseInput(data.toString());
        if (input) world.queueInput(seat.player, input);
      });
      ws.on('close', () => {
        clearTimeout(expiryTimer);
        connections.delete(connection);
        leaveWorld(connection);
      });

      enterWorld(connection).catch((err: unknown) => {
        log('error', 'enter_world_failed', { stack: err instanceof Error ? err.stack : String(err) });
        ws.close(1011, 'Could not enter the world');
      });
    });
  });

  startClock();

  // Saved in batches, so one slow write can't hold up the game.
  setInterval(() => void progress.flush(), FLUSH_INTERVAL_MS).unref();
  process.once('SIGTERM', () => {
    void progress
      .flush()
      .then(() => progress.settle())
      .finally(() => process.exit(0));
  });

  // Resets per-second message counts, and forgets old reconnect times.
  setInterval(() => {
    for (const connection of connections) connection.messagesThisSecond = 0;
    const cutoff = Date.now() - RECONNECT_COOLDOWN_MS;
    for (const [userId, at] of lastConnectAt) {
      if (at < cutoff) lastConnectAt.delete(userId);
    }
  }, 1000).unref();

  // Removes connections that died without sending a close frame.
  setInterval(() => {
    for (const connection of connections) {
      if (!connection.isAlive) {
        connection.socket.terminate();
        continue;
      }
      connection.isAlive = false;
      connection.socket.ping();
    }
  }, HEARTBEAT_MS).unref();
}
