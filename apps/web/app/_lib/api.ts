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
  kind:
    | 'spawn'
    | 'hit'
    | 'taken'
    | 'kill'
    | 'room-cleared'
    | 'supply'
    | 'died'
    // Phase 3 — physical loot, collected or explained.
    | 'loot'
    | 'loot-skipped'
    // Phase 3.5 — an actor stepped from one authoritative tile to another.
    | 'move';
  room?: number;
  cycle?: number;
  count?: number;
  target?: string;
  source?: string;
  damage?: number;
  healed?: number;
  remaining?: number;
  item?: string;
  quantity?: number;
  reason?: 'policy' | 'no-space' | 'over-capacity';
  actor?: string;
  from?: Tile;
  to?: Tile;
  startsAtMs?: number;
  arrivesAtMs?: number;
}

/** A tile, exactly as the server states it. The browser never invents one. */
export interface Tile {
  x: number;
  y: number;
  z: number;
}

/**
 * A step in flight, on the SERVER'S millisecond timeline.
 *
 * The client interpolates pixels along it for the sake of the eye, using these
 * two instants and the snapshot's own `nowMs` — never a duration of its own.
 * The authoritative answer is always `tile`; a step that disagrees with the
 * next snapshot loses.
 */
export interface Movement {
  from: Tile;
  to: Tile;
  startsAtMs: number;
  arrivesAtMs: number;
}
export interface RunCreature {
  key: string;
  health: number;
  maxHealth: number;
  /** Phase 3.5 — present only when the Hunt has a map. */
  id?: string;
  tile?: Tile;
  movement?: Movement | null;
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
  /** What THIS RUN earned. The carried total is `pouchGold`. */
  sessionGold: string;
  /** The Gold Pouch — CARRIED, and lost on death without Full Bless. Not the
   *  Bank, which is safe and is a different number. */
  pouchGold: string;
  baseLevel: number;
  baseXp: string;
  levelStartXp: string;
  nextLevelXp: string;
  staminaRemainingMs: number;
  staminaMode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';
  connection: 'ONLINE_ACTIVE' | 'RECONNECT_GRACE_PAUSED' | 'ACTIVITY_ENDED';
  graceExpiresAt: string | null;
  endedReason: 'DIED' | 'LEFT' | 'GRACE_EXPIRED' | null;
  /** Only on the settlement that killed the Character. */
  penalty: {
    experienceLost: string;
    goldForfeited: string;
    levelBefore: number;
    levelAfter: number;
    fullBless: boolean;
  } | null;
  events: HuntEvent[];
  /** Phase 3.5 — where the Character is, on which map, of which BUNDLE, and
   *  at what simulation instant. Null when the Hunt has no map. */
  space: {
    contentVersion: string;
    mapKey: string;
    tile: Tile;
    movement: Movement | null;
    nowMs: number;
  } | null;
  /** Phase 3.5 — monotonic. A snapshot older than the one on screen is
   *  DISCARDED: two polls can arrive out of order, and applying the older one
   *  rewinds the world in front of the player. */
  revision: number;
  /** Phase 3 — how full the Loot Pouch is right now. */
  lootPouch?: { used: number; spaces: number };
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

/**
 * The static tile map, as `GET /api/maps/:key` returns it (Phase 3.5).
 *
 * Immutable for the life of a bundle version, so the browser fetches it once
 * and keeps it. The rows are the authored source, not a second model: the
 * server compiles the same characters into the same collision it simulates on.
 */
export interface MapRegion {
  id: string;
  room: number;
  rect: [number, number, number, number];
  spawns: { x: number; y: number }[];
}
export interface TileMapView {
  key: string;
  z: number;
  rows: string[];
  legend: Record<string, 'wall' | 'floor' | 'water' | 'sludge'>;
  entry: { x: number; y: number };
  regions: MapRegion[];
}
export interface MapResponse {
  contentVersion: string;
  map: TileMapView;
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — physical items (Phase 3 spec §17, §18)
//
// The System UI's whole world in one shape, because the server decides all of
// it: what is worn, what fits, what a slot costs, and whether a counter is
// even reachable from where the Character is standing.
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemView {
  id: string;
  definitionKey: string;
  label: string;
  category: string;
  quantity: number;
  rarity: string;
  affixes: { affix: string; value: number }[];
  weight: number;
  stackable: boolean;
  maxStack: number;
  slot: string | null;
  containerId: string | null;
  location: string;
  sellable: boolean;
  stashEligible: boolean;
}

export interface ContainerSlotView {
  slotIndex: number;
  unlocked: boolean;
  containerInstanceId: string | null;
  routingCategory: string | null;
  price: number;
  spaces: number;
  contents: ItemView[];
}

export interface InventoryView {
  characterId: string;
  /** The server's answer to "can this Character reach a counter?". */
  inHunt: boolean;
  capacity: { carried: number; limit: number };
  gold: { pouch: string; bank: string };
  equipment: ItemView[];
  slots: ContainerSlotView[];
  lootPouch: { spaces: number; contents: ItemView[] };
  depot: { total: number; offset: number; limit: number; items: ItemView[] };
  stash: { definitionKey: string; label: string; quantity: string }[];
  lootPolicy: { mode: string; rules: { itemKey?: string; accept: boolean }[] };
  routingCategories: string[];
  service: {
    key: string;
    sells: { itemKey: string; price: number }[];
    buys: { itemKey: string; price: number }[];
  };
}
