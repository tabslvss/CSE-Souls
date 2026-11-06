/**
 * Load test: fills the world with simulated players, all moving and swinging at the real input rate.
 * With the stack running:  cd server && npm run loadtest -- <players> <seconds>
 * To test a deployment:    BASE_URL=https://your.domain ORIGIN=https://your.domain npm run loadtest
 * It creates real accounts, so don't leave them on a server you care about.
 * The map has fewer creatures than the server must handle. For the full 200, run a throwaway stack
 * with LOAD_TEST_CREATURES=200 set on the app container, and point APP_CONTAINER at it.
 */
const WebSocket = require('ws');
const { execSync } = require('node:child_process');
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const ORIGIN = process.env.ORIGIN || BASE;
const APP_CONTAINER = process.env.APP_CONTAINER || 'cse-souls-app-1';
const COUNT = Number(process.argv[2] || 40);
const SECONDS = Number(process.argv[3] || 20);
const FLAG_RUN = 1;
const FLAG_ATTACK = 4;
// Long enough to walk out of the bonfire circle at the spawn, where hunters won't follow.
const WALK_OUT_INPUTS = 150;
const stamp = Date.now().toString(36).slice(-5);
const parseCookies = (res, jar) => { for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar[p.slice(0, i)] = p.slice(i + 1); } };
const header = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function account(i) {
  const jar = {};
  let res = await fetch(`${BASE}/auth/xsrf`); parseCookies(res, jar); const { token } = await res.json();
  res = await fetch(`${BASE}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': token, Origin: ORIGIN, Cookie: header(jar) }, body: JSON.stringify({ username: `bot${stamp}${i}`, password: 'Ember&Ash9' + stamp }) });
  if (!res.ok) throw new Error(`register ${res.status}`);
  parseCookies(res, jar);
  res = await fetch(`${BASE}/api/session`, { headers: { Cookie: header(jar) } }); const { xsrfToken } = await res.json();
  res = await fetch(`${BASE}/api/character`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': xsrfToken, Origin: ORIGIN, Cookie: header(jar) }, body: JSON.stringify({ classId: ['juggernaut', 'duelist', 'arcanist', 'ranger'][i % 4], appearance: {} }) });
  if (!res.ok) throw new Error(`character ${res.status}`);
  return jar;
}
(async () => {
  const t0 = Date.now();
  const jars = [];
  for (let i = 0; i < COUNT; i += 3) { (await Promise.all([0, 1, 2].filter((k) => i + k < COUNT).map((k) => account(i + k)))).forEach((j) => jars.push(j)); }
  console.log(`accounts ${jars.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const stats = jars.map(() => ({ snaps: 0, gaps: [], last: 0, bytes: 0, others: 0, creatures: 0, events: 0, hits: 0, bites: 0, deaths: 0, closed: null }));
  const measureSince = new Date().toISOString();
  const sockets = jars.map((jar, i) => new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`, { headers: { Origin: ORIGIN, Cookie: header(jar) } });
    let seq = 0; let timer;
    const bearing = (i / jars.length) * Math.PI * 2;
    ws.on('open', () => {
      timer = setInterval(() => {
        seq += 1;
        const heading = seq < WALK_OUT_INPUTS ? bearing : bearing + (seq - WALK_OUT_INPUTS) * 0.02;
        const flags = (seq % 3 ? FLAG_RUN : 0) | (seq % 30 === 0 ? FLAG_ATTACK : 0);
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', d: [seq, Math.sin(heading), Math.cos(heading), heading, flags] }));
      }, 1000 / 30);
      resolve({ ws, timer });
    });
    ws.on('message', (data) => {
      const s = stats[i]; s.bytes += data.length;
      const m = JSON.parse(data);
      if (m.t !== 's') return;
      const now = Date.now(); if (s.last) s.gaps.push(now - s.last); s.last = now; s.snaps += 1; s.others = m.p.length;
      s.creatures = Math.max(s.creatures, m.c.length);
      for (const e of m.e || []) { s.events += 1; if (e.k === 'hit') s.hits += 1; else if (e.k === 'bite') s.bites += 1; else if (e.k === 'death') s.deaths += 1; }
    });
    ws.on('close', (c) => { stats[i].closed = c; clearInterval(timer); });
    ws.on('error', (e) => { stats[i].closed = String(e.message); resolve({ ws, timer }); });
  }));
  const conns = await Promise.all(sockets);
  const measureFrom = Date.now();
  await new Promise((d) => setTimeout(d, SECONDS * 1000 / 2));
  try {
    console.log(execSync(`docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' ${APP_CONTAINER}`, { encoding: 'utf8' }).trim());
  } catch {
    console.log('(no local container stats)');
  }
  await new Promise((d) => setTimeout(d, SECONDS * 1000 / 2));
  const all = stats.flatMap((s) => s.gaps).sort((a, b) => a - b);
  const secs = (Date.now() - measureFrom) / 1000;
  const total = (name) => stats.reduce((sum, s) => sum + s[name], 0);
  console.log(`players seen ${Math.min(...stats.map((s) => s.others))}-${Math.max(...stats.map((s) => s.others))}; most creatures in one snapshot ${Math.max(...stats.map((s) => s.creatures))}; snapshots/sec per client ${(total('snaps') / stats.length / secs).toFixed(1)}; gap p50 ${all[all.length >> 1]}ms p99 ${all[Math.floor(all.length * 0.99)]}ms max ${all[all.length - 1]}ms; down per client ${(stats[0].bytes / secs / 1024).toFixed(0)} KB/s; closed ${stats.filter((s) => s.closed !== null).length}`);
  console.log(`events received ${total('events')} (hits ${total('hits')}, bites ${total('bites')}, deaths ${total('deaths')}), counted once per client that was sent them`);
  // Read before the sockets close, so that the numbers are all from the full crowd.
  try {
    const lines = execSync(`docker logs --since ${measureSince} ${APP_CONTAINER} 2>&1`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((line) => line.includes('"tick_time"'));
    console.log(lines.join('\n') || '(no tick timing logged yet)');
  } catch {
    console.log('(no local container logs)');
  }
  conns.forEach(({ ws, timer }) => { clearInterval(timer); ws.close(); });
  await new Promise((d) => setTimeout(d, 500));
  const realm = await (await fetch(`${BASE}/api/realm`)).json();
  console.log('after', JSON.stringify(realm));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
