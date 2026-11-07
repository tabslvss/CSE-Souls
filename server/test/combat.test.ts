/**
 * Combat through the running stack, by real play: these accounts walk across the real map with
 * the input protocol to reach animals and chests, as a player would, so there are no test hooks.
 * Totals are read back through /api/profile, so these also show what reached the database.
 * Start the stack first with `docker compose up`, then `node --import tsx --test test/combat.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { CLASSES, type ClassId } from '../../shared/classes.js';
import { collide, segmentBlocked } from '../../shared/collision.js';
import { INTERACT_RANGE } from '../../shared/combat.js';
import { CREATURE_BY_ID, CreatureState } from '../../shared/creatures.js';
import { MAP } from '../../shared/mapData.js';
import {
  FLAG_ATTACK,
  FLAG_INTERACT,
  FLAG_RUN,
  type CreatureSnapshot,
  type GameEvent,
  type PlayerSnapshot,
  type ServerMessage,
} from '../../shared/protocol.js';
import { deriveStats, TICK_RATE } from '../../shared/sim.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const ORIGIN = new URL(BASE).origin;
const WS_URL = `${BASE.replace(/^http/, 'ws')}/ws`;
const PASSWORD = 'Sw0rd&Sorcery!';
const SNIPE_RANGE = 14;

type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
type Snapshot = Extract<ServerMessage, { t: 's' }>;

class Client {
  cookies = new Map<string, string>();

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', this.header());
    let response = await fetch(BASE + path, { redirect: 'manual', ...init, headers });
    // Other suites share this address and nginx's request budget.
    for (let attempt = 0; response.status === 429 && attempt < 8; attempt += 1) {
      await sleep(1000);
      response = await fetch(BASE + path, { redirect: 'manual', ...init, headers });
    }
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
}

async function freshCharacter(classId: ClassId, variant = 0): Promise<Client> {
  const client = new Client();
  const { token } = (await (await client.fetch('/auth/xsrf')).json()) as { token: string };
  const username = `c${randomBytes(6).toString('hex')}`;
  const registered = await client.fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': token },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  assert.equal(registered.status, 201);
  const { xsrfToken } = (await (await client.fetch('/api/session')).json()) as { xsrfToken: string };
  const saved = await client.fetch('/api/character', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': xsrfToken },
    body: JSON.stringify({ classId, appearance: { variant } }),
  });
  assert.equal(saved.status, 200);
  return client;
}

interface Profile {
  xp: number;
  binaryDust: number;
  record: { enemiesKilled: number; animalsHunted: number; deaths: number };
  achievements: Array<{ id: string; unlockedAt: string | null }>;
}

async function profile(client: Client): Promise<{ binaryDust: number; xp: number; enemies: number; animals: number; deaths: number; earned: string[] }> {
  const body = (await (await client.fetch('/api/profile')).json()) as Profile;
  return {
    binaryDust: body.binaryDust,
    xp: body.xp,
    enemies: body.record.enemiesKilled,
    animals: body.record.animalsHunted,
    deaths: body.record.deaths,
    // Spawning beside a grace lights it, whatever else a test does.
    earned: body.achievements.filter((item) => item.unlockedAt && item.id !== 'first_grace').map((item) => item.id),
  };
}

const opened = new Set<Player>();

class Player {
  messages: ServerMessage[] = [];
  events: GameEvent[] = [];
  closed = false;
  welcome!: Welcome;
  latest!: Snapshot;
  private seq = 0;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(message);
      if (message.t === 'welcome') this.welcome = message;
      if (message.t === 's') {
        this.latest = message;
        if (message.e) this.events.push(...message.e);
      }
    });
    socket.on('close', () => {
      this.closed = true;
      opened.delete(this);
    });
    socket.on('error', () => undefined);
  }

  static async enter(client: Client): Promise<Player> {
    const player = new Player(new WebSocket(WS_URL, { headers: { Origin: ORIGIN, Cookie: client.header() } }));
    opened.add(player);
    for (let waited = 0; !player.latest || !player.welcome; waited += 20) {
      assert.ok(waited < 8000 && !player.closed, 'should get into the world');
      await sleep(20);
    }
    return player;
  }

  get me(): PlayerSnapshot {
    const entry = this.latest.p.find((item) => item[0] === this.welcome.you);
    assert.ok(entry, 'should be in the snapshot');
    return entry;
  }

  send(mx: number, mz: number, yaw: number, flags: number): void {
    this.seq += 1;
    this.socket.send(JSON.stringify({ t: 'i', d: [this.seq, mx, mz, yaw, flags] }));
  }

  /** Walks a route found ahead of time. Keeps the one-input-per-tick rate a real client has. */
  async walkTo(x: number, z: number, within: number, what: string): Promise<void> {
    const staminaToRun = 25;
    const deadline = Date.now() + 180_000;
    let route = findRoute(this.me[1], this.me[2], x, z);
    let next = 0;
    let checkAt = Date.now() + 2000;
    let checkX = this.me[1];
    let checkZ = this.me[2];
    while (Math.hypot(this.me[1] - x, this.me[2] - z) > within) {
      assert.ok(Date.now() < deadline, `never reached ${what}, stopped at ${this.me[1]}, ${this.me[2]}`);
      if (next < route.length - 1 && Math.hypot(this.me[1] - route[next][0], this.me[2] - route[next][1]) < 1.5) next += 1;
      const [toX, toZ] = route[next];
      const yaw = Math.atan2(toX - this.me[1], toZ - this.me[2]);
      this.send(Math.sin(yaw), Math.cos(yaw), yaw, this.me[4] > staminaToRun ? FLAG_RUN : 0);
      await sleep(1000 / TICK_RATE);
      if (Date.now() > checkAt) {
        if (Math.hypot(this.me[1] - checkX, this.me[2] - checkZ) < 1) {
          route = findRoute(this.me[1], this.me[2], x, z);
          next = 0;
        }
        checkX = this.me[1];
        checkZ = this.me[2];
        checkAt = Date.now() + 2000;
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.socket.close();
    for (let waited = 0; !this.closed && waited < 1000; waited += 20) await sleep(20);
  }
}

const GRID = 2;

function walkable(x: number, z: number): boolean {
  const probe = { x, z };
  collide(probe, 0.9);
  return probe.x === x && probe.z === z;
}

/** A plain A* over the real colliders, the way a person sees a way around a wall. */
function findRoute(fromX: number, fromZ: number, toX: number, toZ: number): Array<[number, number]> {
  const { bounds } = MAP;
  const columns = Math.ceil((bounds.maxX - bounds.minX) / GRID);
  const key = (column: number, row: number) => row * columns + column;
  const columnOf = (x: number) => Math.round((x - bounds.minX) / GRID);
  const rowOf = (z: number) => Math.round((z - bounds.minZ) / GRID);
  const goalColumn = columnOf(toX);
  const goalRow = rowOf(toZ);
  const open = new Map<number, number>();
  const cost = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const start = key(columnOf(fromX), rowOf(fromZ));
  open.set(start, 0);
  cost.set(start, 0);
  let bestNode = start;
  let bestLeft = Infinity;
  const buckets: number[][] = [[start]];
  let bucket = 0;
  while (bucket < buckets.length) {
    const current = buckets[bucket]?.pop();
    if (current === undefined) {
      bucket += 1;
      continue;
    }
    const row = Math.floor(current / columns);
    const column = current - row * columns;
    const left = Math.hypot(column - goalColumn, row - goalRow);
    if (left < bestLeft) {
      bestLeft = left;
      bestNode = current;
    }
    if (left <= 1) break;
    for (const [dc, dr, step] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.42], [1, -1, 1.42], [-1, 1, 1.42], [-1, -1, 1.42]]) {
      const nextColumn = column + dc;
      const nextRow = row + dr;
      const next = key(nextColumn, nextRow);
      const total = cost.get(current)! + step;
      if (total >= (cost.get(next) ?? Infinity)) continue;
      const x = bounds.minX + nextColumn * GRID;
      const z = bounds.minZ + nextRow * GRID;
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ || !walkable(x, z)) continue;
      cost.set(next, total);
      cameFrom.set(next, current);
      const estimate = Math.floor(total + Math.hypot(nextColumn - goalColumn, nextRow - goalRow));
      (buckets[Math.max(estimate, bucket)] ??= []).push(next);
    }
  }
  const route: Array<[number, number]> = [[toX, toZ]];
  for (let node = bestNode; node !== start; node = cameFrom.get(node)!) {
    const row = Math.floor(node / columns);
    route.unshift([bounds.minX + (node - row * columns) * GRID, bounds.minZ + row * GRID]);
  }
  return route;
}

async function until<T>(what: string, check: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    assert.ok(Date.now() < deadline, `waited ${timeoutMs} ms for ${what}`);
    await sleep(40);
  }
}

before(async () => {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/classes`)).ok) return;
    } catch {
      // Still starting.
    }
    assert.ok(Date.now() < deadline, 'the stack should be running');
    await sleep(2000);
  }
});

afterEach(async () => {
  await Promise.all([...opened].map((player) => player.close()));
});

describe('combat by real play', () => {
  it('can’t be told to deal damage, grant dust or open chests by any message', async () => {
    const client = await freshCharacter('juggernaut');
    const player = await Player.enter(client);
    const before = await profile(client);
    const forged = [
      { t: 'hit', c: 1, dmg: 99999 },
      { t: 'hit', by: player.welcome.you, c: 1, x: 0, z: 0, dmg: 99999, style: 0, kill: 1, stagger: 1 },
      { k: 'hit', c: 1, dmg: 99999 },
      { t: 'self', dust: 1000000, kills: 1000 },
      { t: 'chest', id: 1, dust: 1000, potion: 1 },
      { t: 'open', chest: 1 },
      { t: 'dust', n: 1000 },
      { t: 'unlock', achievement: 'boss_slayer' },
      { t: 'i', d: [1, 0, 0, 0, 0], dmg: 99999, target: 1, dust: 100000 },
      { t: 'i', d: [2, 0, 0, 0, FLAG_INTERACT], chest: 1, x: MAP.chests[0]?.x, z: MAP.chests[0]?.z },
      { t: 'i', d: [3, 0, 0, 0, FLAG_ATTACK], x: 0, z: 0, health: 99999, c: 1 },
    ];
    for (const message of forged) player.socket.send(JSON.stringify(message));
    await until('the inputs among them being applied', () => player.latest.a === 3);
    await sleep(2000);

    const hits = player.events.filter((event) => event.k === 'hit' || event.k === 'dust');
    assert.deepEqual(hits, [], 'nothing near the spawn was in reach of that swing');
    // Walking up to the grace at spawn really does earn its achievement. Nothing else may.
    assert.ok(
      !player.messages.some(
        (message) => message.t === 'chest' || (message.t === 'unlock' && message.achievement !== 'first_grace'),
      ),
    );
    assert.deepEqual(await profile(client), before);
    assert.equal(player.me[12], deriveStats(player.welcome.players.find((item) => item.id === player.welcome.you)!.stats).maxHealth, 'health is unchanged');
    assert.equal(player.closed, false, 'and the server just ignores them');
  });

  it('shows nearby animals, and limits what it sends', async (t) => {
    if (MAP.camps.length === 0) return t.skip('this map has no camps');
    const player = await Player.enter(await freshCharacter('ranger'));
    await until('an animal in view', () => player.latest.c.length > 0, 3000).catch(() => undefined);
    assert.ok(player.latest.c.length <= 40);
    for (const entry of player.latest.c) {
      assert.equal(entry.length, 7);
      assert.ok(Math.hypot(entry[2] - player.me[1], entry[3] - player.me[2]) <= 92, 'within view');
      assert.ok(entry[1] >= 0 && entry[1] < CREATURE_BY_ID.size);
    }
  });

  it('kills animals with arrows, and the dust and the kills reach the database', async (t) => {
    if (MAP.camps.length === 0) return t.skip('this map has no camps');
    const client = await freshCharacter('ranger');
    const player = await Player.enter(client);
    const deadline = Date.now() + 240_000;
    const preyKinds = new Set(['fox', 'deer'].map((id) => CREATURE_BY_ID.get(id)!.index));
    const dustFromEvents = () =>
      player.events.reduce((sum, event) => sum + (event.k === 'dust' && event.to === player.welcome.you ? event.n : 0), 0);
    const kills = () => player.events.filter((event) => event.k === 'hit' && event.by === player.welcome.you && event.kill === 1).length;

    const nearest = (): CreatureSnapshot | undefined => {
      let best: CreatureSnapshot | undefined;
      let bestDistance = Infinity;
      for (const entry of player.latest.c) {
        if (!preyKinds.has(entry[1]) || entry[5] === CreatureState.Dead) continue;
        const distance = Math.hypot(entry[2] - player.me[1], entry[3] - player.me[2]);
        if (distance < bestDistance) {
          best = entry;
          bestDistance = distance;
        }
      }
      return best;
    };

    // Keep hunting until a kill pays, since a kill can roll no dust.
    while (dustFromEvents() === 0) {
      assert.ok(Date.now() < deadline, `no paying kill in time, ${kills()} kills`);
      let target = nearest();
      if (!target) {
        const camp = MAP.camps
          .filter((item) => item.kind === 'fox' || item.kind === 'deer')
          .sort((a, b) => Math.hypot(a.x - player.me[1], a.z - player.me[2]) - Math.hypot(b.x - player.me[1], b.z - player.me[2]))[0];
        await player.walkTo(camp.x, camp.z, 15, 'a camp');
        target = nearest();
        if (!target) {
          await sleep(500);
          continue;
        }
      }
      const distance = Math.hypot(target[2] - player.me[1], target[3] - player.me[2]);
      if (distance > SNIPE_RANGE || segmentBlocked(player.me[1], player.me[2], target[2], target[3])) {
        const yaw = Math.atan2(target[2] - player.me[1], target[3] - player.me[2]);
        player.send(Math.sin(yaw), Math.cos(yaw), yaw, player.me[4] > 25 ? FLAG_RUN : 0);
      } else {
        // Hold still and shoot where it's going to be.
        const flight = distance / 34;
        const speed = target[5] === CreatureState.Run ? 6.5 : target[5] === CreatureState.Walk ? 1.2 : 0;
        const aimX = target[2] + Math.sin(target[4]) * speed * flight;
        const aimZ = target[3] + Math.cos(target[4]) * speed * flight;
        player.send(0, 0, Math.atan2(aimX - player.me[1], aimZ - player.me[2]), FLAG_ATTACK);
      }
      await sleep(1000 / TICK_RATE);
    }

    const dust = dustFromEvents();
    const killCount = kills();
    assert.ok(killCount >= 1);
    const hit = player.events.find((event) => event.k === 'hit' && event.by === player.welcome.you);
    assert.ok(hit?.k === 'hit' && hit.style === 4, 'an arrow, as the browser should show it');
    assert.ok(player.events.some((event) => event.k === 'shot' && event.by === player.welcome.you));
    assert.ok(player.events.some((event) => event.k === 'shotEnd' && event.hit === 1));

    const self = await until('the private totals', () =>
      [...player.messages].reverse().find((message) => message.t === 'self' && message.dust >= dust && message.kills >= killCount),
    );
    assert.ok(self.t === 'self');

    // Saved in batches, so it arrives within a few seconds without leaving.
    const saved = await until('the batch to save', async () => {
      const current = await profile(client);
      return current.binaryDust >= dust && current;
    }, 10_000);
    assert.equal(saved.animals, killCount);
    assert.equal(saved.enemies, 0, 'foxes and deer are animals');
    assert.equal(saved.xp, saved.binaryDust, 'xp is lifetime dust');

    // And it comes back on the next visit.
    await player.close();
    await sleep(600);
    const again = await Player.enter(client);
    assert.equal(again.welcome.binaryDust, saved.binaryDust);
    const firstSelf = again.messages.find((message) => message.t === 'self');
    assert.ok(firstSelf?.t === 'self' && firstSelf.kills === killCount);
  });

  it('opens a chest once per account, surviving a reconnect, while another account still can', async (t) => {
    if (MAP.chests.length === 0) return t.skip('this map has no chests');
    const chest = [...MAP.chests].sort(
      (a, b) => Math.hypot(a.x - MAP.spawn.x, a.z - MAP.spawn.z) - Math.hypot(b.x - MAP.spawn.x, b.z - MAP.spawn.z),
    )[0];
    const client = await freshCharacter('ranger');
    const player = await Player.enter(client);
    assert.deepEqual(player.welcome.chests, []);

    // From too far away first.
    player.send(0, 0, 0, FLAG_INTERACT);
    await sleep(300);
    assert.ok(!player.messages.some((message) => message.t === 'chest'), 'out of reach');

    await player.walkTo(chest.x, chest.z, INTERACT_RANGE - 0.5, 'the chest');
    const potionsBefore = player.me[18];
    for (let index = 0; index < 20; index += 1) {
      player.send(0, 0, 0, FLAG_INTERACT);
      await sleep(1000 / TICK_RATE);
    }
    const message = await until('the chest to open', () => player.messages.find((item) => item.t === 'chest'));
    assert.deepEqual(message, { t: 'chest', id: chest.id, dust: chest.dust, potion: 1 });
    await until('the potion', () => player.me[18] === potionsBefore + 1);
    assert.equal(player.messages.filter((item) => item.t === 'chest').length, 1, 'held down, it opens once');
    assert.equal((await profile(client)).binaryDust, chest.dust, 'saved at once');

    await player.close();
    await sleep(600);
    const again = await Player.enter(client);
    const other = await freshCharacter('duelist');
    const otherPlayer = await Player.enter(other);
    assert.deepEqual(otherPlayer.welcome.chests, [], 'other accounts still see it shut');
    assert.deepEqual(again.welcome.chests, [chest.id]);
    assert.equal(again.welcome.binaryDust, chest.dust);

    await Promise.all([
      again.walkTo(chest.x, chest.z, INTERACT_RANGE - 0.5, 'the chest again'),
      otherPlayer.walkTo(chest.x, chest.z, INTERACT_RANGE - 0.5, 'the chest, for another account'),
    ]);
    for (let index = 0; index < 15; index += 1) {
      again.send(0, 0, 0, FLAG_INTERACT);
      otherPlayer.send(0, 0, 0, FLAG_INTERACT);
      await sleep(1000 / TICK_RATE);
    }
    await until('the other account’s chest', () => otherPlayer.messages.find((item) => item.t === 'chest'));
    assert.equal((await profile(other)).binaryDust, chest.dust, 'they get their own');
    assert.ok(!again.messages.some((item) => item.t === 'chest'), 'still open for this account');
    const after = await profile(client);
    assert.equal(after.binaryDust, chest.dust, 'no second payout');
    assert.equal(after.xp, chest.dust);
  });

  it('a wolf bites a player who has stopped sending inputs, who dies, is saved as dead, and comes back', async (t) => {
    const camps = MAP.camps.filter((camp) => camp.kind === 'wolf');
    if (camps.length === 0) return t.skip('this map has no wolves');
    const camp = [...camps].sort(
      (a, b) => Math.hypot(a.x - MAP.spawn.x, a.z - MAP.spawn.z) - Math.hypot(b.x - MAP.spawn.x, b.z - MAP.spawn.z),
    )[0];
    const client = await freshCharacter('arcanist');
    const player = await Player.enter(client);
    const maxHealth = deriveStats(CLASSES.find((item) => item.id === 'arcanist')!.baseStats).maxHealth;
    await player.walkTo(camp.x, camp.z, 12, 'the wolves');

    // Stops sending anything at all, like a hidden browser tab.
    const you = player.welcome.you;
    const bite = await until('a bite', () => player.events.find((event) => event.k === 'bite' && event.v === you), 30_000);
    assert.ok(bite.k === 'bite');
    assert.equal(bite.dmg, CREATURE_BY_ID.get('wolf')!.kind.damage);
    assert.ok(player.me[12] < maxHealth);

    await until('dying', () => player.events.some((event) => event.k === 'death' && event.v === you), 60_000);
    await until('coming back', () => player.events.some((event) => event.k === 'respawn' && event.v === you), 8000);
    assert.equal(player.me[12], maxHealth, 'full health');
    assert.ok(player.me[18] >= 3, 'with potions');
    const nearestGrace = Math.min(...MAP.graces.map((item) => Math.hypot(item.x - player.me[1], item.z - player.me[2])));
    assert.ok(nearestGrace < 6, `at a Binary Grace, ${nearestGrace} away`);

    const saved = await until('the death to be saved', async () => {
      const current = await profile(client);
      return current.deaths >= 1 && current;
    }, 10_000);
    assert.equal(saved.deaths, 1);
    assert.equal(player.closed, false);
  });
});
