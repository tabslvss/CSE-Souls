import type {
  ClientMessage,
  PlayerInfo,
  PlayerSnapshot,
  ServerMessage,
} from '../../../shared/protocol';
import { applySnapshot, FLAG_ATTACK, FLAG_DODGE, FLAG_POTION, FLAG_RUN, WS_CLOSE_EXPIRED, WS_CLOSE_REPLACED } from '../../../shared/protocol';
import {
  createState,
  deriveStats,
  stepPlayer,
  TICK_DT,
  type Derived,
  type SimInput,
  type SimState,
} from '../../../shared/sim';

/** Remote players are drawn slightly in the past, so there are always two snapshots to blend. */
const INTERPOLATION_DELAY_MS = 110;
const MAX_SNAPSHOTS_KEPT = 30;
const MAX_FRAME_CATCHUP_STEPS = 5;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export interface RemoteFrame {
  time: number;
  x: number;
  z: number;
  yaw: number;
  moving: number;
  dodgeTime: number;
  attackTime: number;
  attackCount: number;
  deadTime: number;
  staggerTime: number;
  drinkTime: number;
}

export interface NetPlayer {
  info: PlayerInfo;
  frames: RemoteFrame[];
}

export type ConnectionStatus = 'connecting' | 'open' | 'lost' | 'replaced' | 'expired' | 'no_character';

export interface NetEvents {
  onStatus: (status: ConnectionStatus) => void;
  onJoin: (player: PlayerInfo) => void;
  onLeave: (id: number) => void;
  /** Called on every (re)connect, with the full player list. */
  onWelcome: (myId: number, players: PlayerInfo[], binaryDust: number) => void;
}

function lerpAngle(a: number, b: number, t: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}

/**
 * Owns the WebSocket and all three parts of the netcode:
 * - prediction: your own inputs apply instantly, using the same rules the server runs
 * - reconciliation: each snapshot rewinds you to the server's answer and replays unconfirmed inputs
 * - interpolation: other players are drawn by blending between their recent snapshots
 */
export class GameConnection {
  myId = -1;
  readonly players = new Map<number, NetPlayer>();
  state: SimState | null = null;
  previous: SimState | null = null;
  derived: Derived | null = null;
  /** How far the last correction moved you. It shrinks each frame to hide small snaps. */
  readonly correction = { x: 0, z: 0 };
  /** Round-trip estimate from confirmed inputs, shown in the HUD. */
  pingMs = 0;

  private socket: WebSocket | null = null;
  private pending: SimInput[] = [];
  private sentAt = new Map<number, number>();
  private seq = 0;
  private accumulator = 0;
  private disposed = false;
  private attempts = 0;
  private retryTimer = 0;

  constructor(private readonly events: NetEvents) {
    this.connect();
  }

  private connect(): void {
    this.events.onStatus('connecting');
    // HTTPS pages must use wss://. Plain ws:// keeps working on http://localhost:8080.
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
    this.socket = socket;
    socket.onmessage = (event) => this.onMessage(JSON.parse(event.data as string) as ServerMessage);
    socket.onclose = (event) => {
      if (this.disposed) return;
      if (event.code === WS_CLOSE_REPLACED) {
        this.events.onStatus('replaced');
        return;
      }
      if (event.code === WS_CLOSE_EXPIRED) {
        this.events.onStatus('expired');
        return;
      }
      this.events.onStatus('lost');
      this.attempts += 1;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.attempts = 0;
        this.onWelcome(message.you, message.players, message.snapshot, message.binaryDust);
        this.events.onStatus('open');
        break;
      case 'join':
        this.players.set(message.player.id, { info: message.player, frames: [] });
        this.events.onJoin(message.player);
        break;
      case 'leave':
        this.players.delete(message.id);
        this.events.onLeave(message.id);
        break;
      case 's':
        this.onSnapshot(message.a, message.p);
        break;
      case 'no_character':
        this.disposed = true;
        this.events.onStatus('no_character');
        break;
    }
  }

  private onWelcome(you: number, infos: PlayerInfo[], snapshot: PlayerSnapshot[], dust: number): void {
    this.myId = you;
    this.players.clear();
    this.pending = [];
    this.sentAt.clear();
    this.seq = 0;
    for (const info of infos) this.players.set(info.id, { info, frames: [] });

    const mine = this.players.get(you)!;
    this.derived = deriveStats(mine.info.stats);
    this.state = createState(0, 0, this.derived);
    this.previous = { ...this.state };
    const entry = snapshot.find((item) => item[0] === you);
    if (entry) applySnapshot(entry, this.state);
    this.previous = { ...this.state };

    this.events.onWelcome(you, infos, dust);
    this.onSnapshot(0, snapshot);
  }

  private onSnapshot(ack: number, entries: PlayerSnapshot[]): void {
    const now = performance.now();
    for (const entry of entries) {
      const id = entry[0];
      if (id === this.myId) {
        this.reconcile(ack, entry);
        continue;
      }
      const player = this.players.get(id);
      if (!player) continue;
      player.frames.push({
        time: now,
        x: entry[1],
        z: entry[2],
        yaw: entry[3],
        moving: entry[5],
        dodgeTime: entry[6],
        attackTime: entry[7],
        attackCount: entry[8],
        deadTime: entry[17],
        staggerTime: entry[14],
        drinkTime: entry[19],
      });
      if (player.frames.length > MAX_SNAPSHOTS_KEPT) player.frames.shift();
    }
  }

  private reconcile(ack: number, entry: PlayerSnapshot): void {
    if (!this.state || !this.derived) return;
    const sent = this.sentAt.get(ack);
    if (sent !== undefined) {
      this.pingMs = this.pingMs === 0 ? performance.now() - sent : this.pingMs * 0.9 + (performance.now() - sent) * 0.1;
    }
    for (const seq of this.sentAt.keys()) {
      if (seq <= ack) this.sentAt.delete(seq);
    }
    this.pending = this.pending.filter((input) => input.seq > ack);

    const predictedX = this.state.x;
    const predictedZ = this.state.z;
    applySnapshot(entry, this.state);
    for (const input of this.pending) stepPlayer(this.state, input, this.derived);

    // Any small disagreement fades out, so it never shows as a visible jump.
    const errorX = predictedX - this.state.x;
    const errorZ = predictedZ - this.state.z;
    if (Math.hypot(errorX, errorZ) < 3) {
      this.correction.x += errorX;
      this.correction.z += errorZ;
    } else {
      this.correction.x = 0;
      this.correction.z = 0;
    }
  }

  /** Runs fixed simulation steps for the time that passed, then sends those inputs. */
  advance(
    frameSeconds: number,
    readInput: () => Omit<SimInput, 'seq'>,
  ): void {
    if (!this.state || !this.derived || this.socket?.readyState !== WebSocket.OPEN) return;
    this.accumulator = Math.min(this.accumulator + frameSeconds, TICK_DT * MAX_FRAME_CATCHUP_STEPS);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      const input: SimInput = { seq: ++this.seq, ...readInput() };
      this.previous = { ...this.state };
      stepPlayer(this.state, input, this.derived);
      this.pending.push(input);
      this.sentAt.set(input.seq, performance.now());

      const flags =
        (input.run ? FLAG_RUN : 0) | (input.dodge ? FLAG_DODGE : 0) | (input.attack ? FLAG_ATTACK : 0) | (input.potion ? FLAG_POTION : 0);
      const message: ClientMessage = {
        t: 'i',
        d: [
          input.seq,
          Math.round(input.mx * 1000) / 1000,
          Math.round(input.mz * 1000) / 1000,
          Math.round(input.yaw * 1000) / 1000,
          flags,
        ],
      };
      this.socket.send(JSON.stringify(message));
    }
    const decay = Math.exp(-frameSeconds * 12);
    this.correction.x *= decay;
    this.correction.z *= decay;
  }

  /** Where to draw the local player this frame, smoothed between fixed steps. */
  localPosition(): { x: number; z: number; yaw: number } | null {
    if (!this.state || !this.previous) return null;
    const t = this.accumulator / TICK_DT;
    return {
      x: this.previous.x + (this.state.x - this.previous.x) * t + this.correction.x,
      z: this.previous.z + (this.state.z - this.previous.z) * t + this.correction.z,
      yaw: lerpAngle(this.previous.yaw, this.state.yaw, t),
    };
  }

  /** Where to draw another player right now. */
  remoteFrame(player: NetPlayer): RemoteFrame | null {
    const { frames } = player;
    if (frames.length === 0) return null;
    const renderTime = performance.now() - INTERPOLATION_DELAY_MS;
    for (let i = frames.length - 1; i > 0; i -= 1) {
      const a = frames[i - 1];
      const b = frames[i];
      if (a.time <= renderTime && renderTime <= b.time) {
        const t = (renderTime - a.time) / Math.max(1, b.time - a.time);
        return {
          ...b,
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          yaw: lerpAngle(a.yaw, b.yaw, t),
        };
      }
    }
    return frames[renderTime < frames[0].time ? 0 : frames.length - 1];
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
  }
}
