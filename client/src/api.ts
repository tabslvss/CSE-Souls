import type { Appearance, ClassId, Stats } from '../../shared/classes';

export interface SessionUser {
  username: string;
  avatarUrl: string | null;
  level: number;
  hasCharacter: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlockedAt: string | null;
  holders?: number;
}

export interface Player {
  username: string;
  joinedAt: string;
  avatarUrl: string | null;
  level: number;
  xp: number;
  classId: string | null;
  binaryDust: number;
  stats: Stats;
  record: {
    enemiesKilled: number;
    animalsHunted: number;
    bossKills: number;
    bossDamage: number;
    deaths: number;
  };
  achievements: Achievement[];
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  avatarUrl: string | null;
  level: number;
  bossKills: number;
  bossDamage: number;
  kills: number;
}

export interface AvatarResult {
  avatarUrl: string;
  unlocked: Achievement[];
}

export interface AvatarOptions {
  emblems: string[];
  styles: Array<{ id: string; label: string; previewUrl: string }>;
}

export type LeaderboardSort = 'boss_kills' | 'boss_damage' | 'kills' | 'level';

export interface RealmStatus {
  online: number;
  registered: number;
  bossKills: number;
}

export interface SaveSlot {
  slot: number;
  character: { classId: ClassId; level: number; binaryDust: number; graces: number; updatedAt: string } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Held in memory only. It is reissued by /api/session on every page load.
let sessionXsrfToken: string | null = null;

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? 'Something went wrong. Please try again.');
  }
  return body as T;
}

function sendAuthJson<T>(url: string, token: string, payload: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-Token': token },
    body: JSON.stringify(payload),
  });
}

function sessionHeaders(): HeadersInit {
  return sessionXsrfToken ? { 'X-XSRF-Token': sessionXsrfToken } : {};
}

function sendAvatarJson(url: string, payload: unknown): Promise<AvatarResult> {
  return request<AvatarResult>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify(payload),
  });
}

export const api = {
  async session(): Promise<SessionUser | null> {
    const result = await request<{ user: SessionUser | null; xsrfToken?: string }>('/api/session');
    sessionXsrfToken = result.xsrfToken ?? null;
    return result.user;
  },

  async register(username: string, password: string): Promise<void> {
    const { token } = await request<{ token: string }>('/auth/xsrf');
    await sendAuthJson('/register', token, { username, password });
  },

  async login(username: string, password: string): Promise<void> {
    const { token } = await request<{ token: string }>('/auth/xsrf');
    await sendAuthJson('/login', token, { username, password });
  },

  async logout(): Promise<void> {
    await request('/logout', { method: 'POST', headers: sessionHeaders() });
    sessionXsrfToken = null;
  },

  profile: () => request<Player>('/api/profile'),

  /** With no slot, the save in play. */
  character: (slot?: number) =>
    request<{ character: { classId: ClassId; appearance: Appearance } | null }>(
      slot === undefined ? '/api/character' : `/api/character?slot=${slot}`,
    ),

  saveCharacter: (classId: ClassId, appearance: Appearance, slot?: number) =>
    request<{ classId: ClassId; appearance: Appearance }>('/api/character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionHeaders() },
      body: JSON.stringify({ classId, appearance, slot }),
    }),

  saves: () => request<{ active: number; slots: SaveSlot[] }>('/api/saves'),

  selectSave: (slot: number) =>
    request<{ active: number }>('/api/saves/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionHeaders() },
      body: JSON.stringify({ slot }),
    }),

  player: (username: string) => request<Player>(`/api/players/${encodeURIComponent(username)}`),

  uploadAvatar(file: File) {
    const form = new FormData();
    form.append('avatar', file);
    return request<AvatarResult>('/api/profile/avatar', {
      method: 'POST',
      headers: sessionHeaders(),
      body: form,
    });
  },

  avatarOptions: () => request<AvatarOptions>('/api/avatar-options'),

  useEmblem: (emblem: string) => sendAvatarJson('/api/profile/avatar/emblem', { emblem }),

  useGeneratedAvatar: (style: string, seed: string) =>
    sendAvatarJson('/api/profile/avatar/generated', { style, seed }),

  useGitHubAvatar: (login: string) => sendAvatarJson('/api/profile/avatar/github', { login }),

  removeAvatar: () =>
    request<{ avatarUrl: null }>('/api/profile/avatar', { method: 'DELETE', headers: sessionHeaders() }),

  leaderboard(sort: LeaderboardSort, limit: number, offset: number) {
    const query = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) });
    return request<{ total: number; entries: LeaderboardEntry[] }>(`/api/leaderboard?${query}`);
  },

  achievements: () => request<{ achievements: Achievement[] }>('/api/achievements'),

  realm: () => request<RealmStatus>('/api/realm'),
};
