/**
 * The ONLY place `apps/web` talks to the API (spec §14).
 *
 * The browser renders what the server returned and decides nothing
 * (CLIENT_SERVER_BOUNDARIES.md). These types mirror §12's responses; they are
 * not a second model of the game.
 *
 * `apps/web` may import `@global-idle/shared` and nothing else from the
 * workspace (§5.2), so these shapes are declared here rather than reached for
 * inside the domain.
 */
export const API_BASE = process.env['NEXT_PUBLIC_API_BASE'] ?? 'http://127.0.0.1:3001';

export interface StaminaView {
  remainingMs: number;
  maxMs: number;
  mode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';
}
export interface HuntView {
  key: string;
  label: string;
  summary: string;
  primaryCreature: string;
  region: string;
  availability: string;
}
export interface ActivityView {
  activityId: string;
  activityTypeKey: string;
  contentVersion: string;
  contentKey: string;
  hunt: HuntView;
  state: string;
  startedAt: string;
}
export interface CharacterSummary {
  id: string;
  name: string;
  baseLevel: number;
  vocation: string | null;
  stamina: StaminaView;
}
export interface CharacterDetail extends CharacterSummary {
  premium: boolean;
  activity: ActivityView | null;
}
/**
 * The Hunt run, exactly as `GET /api/characters/:id/hunt` returns it.
 *
 * EVERY FIELD IS THE SERVER'S. The browser renders this and computes nothing
 * from it that could disagree: not the tick, not the damage, not who is alive,
 * not how much Stamina is left. The big integers arrive as strings because a
 * total this curve produces outgrows a JavaScript number, and a UI that
 * quietly lost the last digits of someone's XP would be worse than one that
 * could not display it at all.
 */
export interface HuntEvent {
  tick: number;
  kind: 'spawn' | 'hit' | 'taken' | 'kill' | 'room-cleared' | 'supply' | 'died';
  room?: number;
  cycle?: number;
  count?: number;
  target?: string;
  source?: string;
  damage?: number;
  healed?: number;
  remaining?: number;
}
export interface RunCreature {
  key: string;
  health: number;
  maxHealth: number;
}
export interface RunView {
  activityId: string;
  characterId: string;
  room: number;
  cycle: number;
  tick: number;
  health: number;
  maxHealth: number;
  supplyCharges: number;
  creatures: RunCreature[];
  sessionXp: string;
  sessionGold: string;
  baseLevel: number;
  baseXp: string;
  levelStartXp: string;
  nextLevelXp: string;
  staminaRemainingMs: number;
  staminaMode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';
  connection: 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED';
  graceExpiresAt: string | null;
  endedReason: 'DIED' | 'LEFT' | 'GRACE_EXPIRED' | null;
  events: HuntEvent[];
}

export interface Region {
  key: string;
  label: string;
  availability: 'AVAILABLE' | 'LOCKED';
  atlas: { x: number; y: number; width: number; height: number };
  minZoom: number;
  maxZoom: number;
  backdropAssetId: string;
}
export interface Marker {
  key: string;
  label: string;
  category: 'HUNT' | 'DUNGEON' | 'NPC' | 'SERVICE';
  region: string;
  position: { x: number; y: number };
  target: string;
  iconAssetId: string;
  availability: 'AVAILABLE' | 'LOCKED';
}
export interface Atlas {
  contentVersion: string;
  regions: Region[];
  markers: Marker[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** One fetch, one error shape. The UI switches on `code`, never on prose. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as
    { error?: { code?: string; message?: string } } | T | null;
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Something went wrong.',
    );
  }
  return body as T;
}
