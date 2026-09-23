'use client';

/**
 * The tile scene (Phase 3.5 spec §7).
 *
 * A CAMERA, not a simulator. Every position it draws came from the server:
 * the map is content pinned to the Activity's bundle, the tiles actors stand
 * on are authoritative, and the timing of a step in flight is the server's
 * too. There is no input, no prediction and no clock of its own that anything
 * durable depends on — pause the tab and the drawing stops; the hunt does not.
 *
 * THE LOGICAL WORLD IS FIXED. Fifteen tiles across and eleven down, 32 logical
 * pixels each, on a 480 × 352 logical surface — on a desktop monitor, on a
 * phone, at any device pixel ratio. A bigger screen shows the same corridor
 * bigger; it does not show more of it. How much of the world a player can see
 * is gameplay, and gameplay does not depend on the hardware.
 */
import { useEffect, useRef } from 'react';
import type { Movement, RunView, Tile, TileMapView } from '../_lib/api';
import {
  PUBLIC_PALETTE,
  READS_AS_WALKABLE,
  facingFromDelta,
  privateSpriteUrl,
  ratFrameUrl,
  spriteDrawBox,
  tileNoise,
  walkPhase,
  type Facing,
  type SpriteKey,
} from '../_lib/sprites';

/** The LOCKED Game Window. Logical pixels, not CSS pixels, not device pixels. */
export const TILE_PX = 32;
export const VIEW_TILES_X = 15;
export const VIEW_TILES_Y = 11;
export const LOGICAL_WIDTH = TILE_PX * VIEW_TILES_X; // 480
export const LOGICAL_HEIGHT = TILE_PX * VIEW_TILES_Y; // 352
/** Zero-based centre tile: the Character stands here whenever bounds allow. */
export const CENTRE_X = (VIEW_TILES_X - 1) / 2; // 7
export const CENTRE_Y = (VIEW_TILES_Y - 1) / 2; // 5

export interface TileSceneProps {
  readonly map: TileMapView;
  readonly run: RunView;
  /** Developer-only. Grid, tile coordinates, actor ids, revision. */
  readonly debug?: boolean;
}

interface Drawn {
  readonly id: string;
  readonly kind: 'character' | 'creature';
  readonly tile: Tile;
  readonly movement: Movement | null;
  readonly health: number;
  readonly maxHealth: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The server's tile kind → the meaning the scene asks a sprite for.
 *
 * A LOOKUP, not a decision. The kind comes from the compiled map's legend and
 * is the authored gameplay classification; this only chooses which picture
 * stands for it. Nothing here can make a tile walkable or change its ground
 * speed — see the Phase 3.7 spec §6 and `READS_AS_WALKABLE`.
 */
const TILE_SPRITE: Readonly<Record<string, SpriteKey>> = {
  floor: 'tile.cave.floor',
  wall: 'tile.cave.wall',
  water: 'tile.cave.water',
  sludge: 'tile.cave.sludge',
};

/**
 * A private override's bitmap, if one is present AND this is development.
 *
 * In a public build `privateSpriteUrl` is `null` for every key, so no `Image`
 * is ever constructed, no request is made, and the placeholder path is the
 * only path. When a URL does exist the load is fire-and-forget: until it
 * resolves — and forever, if it 404s — the placeholder is what gets drawn.
 * Absent is the ORDINARY case and must never be an error path (spec §9.2).
 */
const overrides = new Map<string, HTMLImageElement | null>();

/**
 * The bitmap at a private URL, once it has loaded.
 *
 * Keyed by URL rather than by semantic key, because the rat selects a
 * DIFFERENT frame per facing and per animation phase and each one is its own
 * file. A frame that has not loaded yet, or that 404s, is simply `null` and
 * the caller paints the placeholder — absent is the ordinary case.
 */
function imageFor(url: string | null): HTMLImageElement | null {
  if (!url) return null;
  const known = overrides.get(url);
  if (known !== undefined) return known && known.complete && known.naturalWidth > 0 ? known : null;

  const image = new Image();
  image.onerror = () => overrides.set(url, null);
  image.src = url;
  overrides.set(url, image);
  return null;
}

const overrideFor = (key: SpriteKey): HTMLImageElement | null => imageFor(privateSpriteUrl(key));

/**
 * How far BEHIND the newest snapshot the scene is drawn.
 *
 * Measured, not chosen: with a two-second poll and a 550 ms step, a settlement
 * can contain three completed steps the client never sees the middle of. A
 * renderer that draws the newest instant has nothing to show for them and
 * teleports when the next snapshot lands — 3.000 tiles in one frame, on the
 * real stack (`VIS12`).
 *
 * So the scene is drawn one poll interval in the past, where every step is
 * already described by the `move` events the snapshot carries. The picture
 * lags by two seconds and is continuous; nothing extra is sent, nothing extra
 * is settled, and the server stays the only thing that decides where anyone is.
 */
const RENDER_DELAY_MS = 2000;

/** A step the server stated, kept until the drawing has gone past it. */
type Leg = Movement;

/**
 * Where an actor is, in tiles, at a simulation instant.
 *
 * The whole interpolation contract: the fraction comes from the server's own
 * `startsAtMs`/`arrivesAtMs` and the instant being drawn. Nothing here invents
 * a duration, and nothing extrapolates past a step's arrival.
 */
export function placeActor(
  tile: Tile,
  legs: readonly Leg[],
  atMs: number,
): {
  x: number;
  y: number;
} {
  let current: Leg | null = null;
  let last: Leg | null = null;
  let next: Leg | null = null;
  for (const leg of legs) {
    if (leg.startsAtMs <= atMs && atMs < leg.arrivesAtMs) current = leg;
    if (leg.arrivesAtMs <= atMs && (!last || leg.arrivesAtMs > last.arrivesAtMs)) last = leg;
    if (leg.startsAtMs > atMs && (!next || leg.startsAtMs < next.startsAtMs)) next = leg;
  }
  if (current) {
    const span = current.arrivesAtMs - current.startsAtMs;
    const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (atMs - current.startsAtMs) / span));
    return {
      x: lerp(current.from.x, current.to.x, progress),
      y: lerp(current.from.y, current.to.y, progress),
    };
  }
  // Between two steps: standing on the last arrival, or waiting on the next
  // departure. Both are tiles the server named.
  if (last) return { x: last.to.x, y: last.to.y };
  if (next) return { x: next.from.x, y: next.from.y };
  return { x: tile.x, y: tile.y };
}

export function TileScene({ map, run, debug = false }: TileSceneProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** The latest snapshot, read by the animation loop without restarting it. */
  const latest = useRef<{ map: TileMapView; run: RunView; debug: boolean }>({ map, run, debug });
  /**
   * Wall clock at the moment the current snapshot's simulation time was true.
   *
   * The simulation runs at one second per second, so after a snapshot arrives
   * the client advances its notion of simulation time with the wall clock and
   * nothing else. That is the only arithmetic the renderer does about time.
   */
  const anchor = useRef<{ nowMs: number; at: number } | null>(null);
  const camera = useRef<{ x: number; y: number } | null>(null);
  /** The last facing each actor was given, so stopping does not snap it north. */
  const poses = useRef(new Map<string, Facing>());
  /**
   * Every step the server has stated lately, per actor.
   *
   * The snapshot already carries them: each `move` event is an authoritative
   * leg with its own start and arrival. Keeping a bounded window of them is
   * what lets the scene draw the steps BETWEEN two polls instead of jumping
   * over them — and it costs nothing, because the bytes were already sent.
   */
  const timeline = useRef(new Map<string, Leg[]>());

  useEffect(() => {
    latest.current = { map, run, debug };
    if (!run.space) return;
    anchor.current = { nowMs: run.space.nowMs, at: performance.now() };

    const add = (actor: string, leg: Leg) => {
      const legs = timeline.current.get(actor) ?? [];
      if (legs.some((known) => known.startsAtMs === leg.startsAtMs)) return;
      legs.push(leg);
      timeline.current.set(actor, legs);
    };
    for (const event of run.events) {
      if (event.kind !== 'move') continue;
      if (!event.actor || !event.from || !event.to) continue;
      if (event.startsAtMs === undefined || event.arrivesAtMs === undefined) continue;
      add(event.actor, {
        from: event.from,
        to: event.to,
        startsAtMs: event.startsAtMs,
        arrivesAtMs: event.arrivesAtMs,
      });
    }
    if (run.space.movement) add('character', run.space.movement);
    for (const creature of run.creatures) {
      if (creature.id && creature.movement) add(creature.id, creature.movement);
    }

    // Bounded: anything the drawing has long gone past is dropped, and an
    // actor that no longer exists takes its legs with it.
    const living = new Set<string>([
      'character',
      ...run.creatures.map((creature) => creature.id ?? ''),
    ]);
    const horizon = run.space.nowMs - RENDER_DELAY_MS * 3;
    for (const [actor, legs] of timeline.current) {
      if (!living.has(actor)) {
        timeline.current.delete(actor);
        continue;
      }
      timeline.current.set(
        actor,
        legs.filter((leg) => leg.arrivesAtMs >= horizon),
      );
    }
  }, [map, run, debug]);

  useEffect(() => {
    const element = canvas.current;
    const box = holder.current;
    if (!element || !box) return;

    const context = element.getContext('2d');
    if (!context) return;

    let frame = 0;
    let stop = false;

    /**
     * The backing buffer is a whole multiple of the LOGICAL surface, and the
     * CSS box is whatever the layout gives it. Everything drawn below is in
     * logical pixels, so no viewport and no device pixel ratio can change what
     * is visible — only how large it looks.
     */
    const resize = () => {
      const cssWidth = Math.max(1, box.clientWidth);
      const cssHeight = Math.max(1, box.clientHeight);
      const fit = Math.min(cssWidth / LOGICAL_WIDTH, cssHeight / LOGICAL_HEIGHT);
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const scale = Math.max(1, Math.round(fit * ratio));
      if (element.width !== LOGICAL_WIDTH * scale) element.width = LOGICAL_WIDTH * scale;
      if (element.height !== LOGICAL_HEIGHT * scale) element.height = LOGICAL_HEIGHT * scale;
      element.style.width = `${Math.floor(LOGICAL_WIDTH * fit)}px`;
      element.style.height = `${Math.floor(LOGICAL_HEIGHT * fit)}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.imageSmoothingEnabled = false;
    };

    const draw = () => {
      if (stop) return;
      const { map: current, run: view, debug: overlay } = latest.current;
      resize();
      const width = LOGICAL_WIDTH;
      const height = LOGICAL_HEIGHT;
      const size = TILE_PX;
      const rows = current.rows;
      const mapWidth = (rows[0]?.length ?? 0) * size;
      const mapHeight = rows.length * size;

      // ── the simulation instant being drawn ───────────────────────────
      //
      // One poll behind the newest snapshot, which is exactly the window the
      // snapshot's own `move` events describe.
      const held = anchor.current;
      const simNow = held ? held.nowMs - RENDER_DELAY_MS + (performance.now() - held.at) : 0;

      // ── who is on the board ──────────────────────────────────────────
      const actors: Drawn[] = [];
      if (view.space) {
        actors.push({
          id: 'character',
          kind: 'character',
          tile: view.space.tile,
          movement: view.space.movement,
          health: view.health,
          maxHealth: view.maxHealth,
        });
      }
      for (const creature of view.creatures) {
        if (!creature.tile || !creature.id) continue;
        actors.push({
          id: creature.id,
          kind: 'creature',
          tile: creature.tile,
          movement: creature.movement ?? null,
          health: creature.health,
          maxHealth: creature.maxHealth,
        });
      }

      const placed = new Map<
        string,
        { x: number; y: number; facing: number; heading: Facing; phase: number | null }
      >();
      for (const actor of actors) {
        const legs = timeline.current.get(actor.id) ?? [];
        const at = placeActor(actor.tile, legs, simNow);
        // THE SERVER'S OWN LEG decides which way an actor faces and how far
        // through its step it is. Both are read from the authoritative
        // timestamps; neither introduces a clock or a decision of its own.
        const leg = legs.find((step) => step.startsAtMs <= simNow && simNow < step.arrivesAtMs);
        const facing = leg && leg.to.x < leg.from.x ? -1 : 1;
        const heading: Facing = leg
          ? facingFromDelta(leg.to.x - leg.from.x, leg.to.y - leg.from.y)
          : (poses.current.get(actor.id) ?? 'south');
        poses.current.set(actor.id, heading);
        const phase = leg ? walkPhase(leg.startsAtMs, leg.arrivesAtMs, simNow) : null;
        placed.set(actor.id, { ...at, facing, heading, phase });
      }

      // ── camera: the Character on the centre tile, clamped at the edges ─
      const hero = placed.get('character') ?? {
        x: 0,
        y: 0,
        facing: 1,
        heading: 'south' as Facing,
        phase: null,
      };
      const wantX = (hero.x - CENTRE_X) * size;
      const wantY = (hero.y - CENTRE_Y) * size;
      const clampX =
        mapWidth <= width ? (mapWidth - width) / 2 : Math.min(Math.max(wantX, 0), mapWidth - width);
      const clampY =
        mapHeight <= height
          ? (mapHeight - height) / 2
          : Math.min(Math.max(wantY, 0), mapHeight - height);
      // The camera eases so a settlement does not snap the world sideways; it
      // is presentation, and it never changes WHICH tiles are in frame by more
      // than the clamp above allows.
      const previousCamera = camera.current;
      const cam = previousCamera
        ? { x: lerp(previousCamera.x, clampX, 0.25), y: lerp(previousCamera.y, clampY, 0.25) }
        : { x: clampX, y: clampY };
      camera.current = cam;

      // ── the floor ────────────────────────────────────────────────────
      context.fillStyle = '#05070a';
      context.fillRect(0, 0, width, height);

      const firstColumn = Math.max(0, Math.floor(cam.x / size));
      const lastColumn = Math.min((rows[0]?.length ?? 0) - 1, Math.ceil((cam.x + width) / size));
      const firstRow = Math.max(0, Math.floor(cam.y / size));
      const lastRow = Math.min(rows.length - 1, Math.ceil((cam.y + height) / size));

      for (let y = firstRow; y <= lastRow; y += 1) {
        const row = rows[y] ?? '';
        for (let x = firstColumn; x <= lastColumn; x += 1) {
          const symbol = row[x] ?? '#';
          // An unknown symbol cannot reach here — the content build refuses
          // the bundle — so the fallback is a belt, not a policy.
          const kind = current.legend[symbol] ?? 'wall';
          const px = Math.round(x * size - cam.x);
          const py = Math.round(y * size - cam.y);
          const noise = tileNoise(x, y);

          // WHICH PICTURE stands for this tile — a meaning, never a file. In
          // a public build the answer is always the placeholder below; the
          // override is development-only and is painted on top, so a missing
          // or half-loaded one still leaves a complete, readable scene.
          const spriteKey = TILE_SPRITE[kind] ?? 'tile.cave.wall';
          const paint = PUBLIC_PALETTE[spriteKey];

          context.fillStyle = paint.base;
          context.fillRect(px, py, size, size);

          // The one thing this drawing has to get right is WHICH TILES ARE
          // SOLID. A player who cannot see the walls cannot read why the
          // Character went around, so masonry is lit from above and the floor
          // is the dark thing you move across — not the other way round.
          if (!READS_AS_WALKABLE[spriteKey]) {
            const lip = Math.max(3, size * 0.2);
            if (noise > 0.5) {
              context.fillStyle = paint.speck;
              context.fillRect(px, py, size, size);
            }
            context.fillStyle = 'rgba(255,255,255,0.16)';
            context.fillRect(px, py, size, lip * 0.5);
            context.fillStyle = 'rgba(0,0,0,0.42)';
            context.fillRect(px, py + size - lip * 0.6, size, lip * 0.6);
            if (spriteKey === 'tile.cave.wall') {
              // Courses, so a run of wall reads as masonry rather than a slab.
              context.fillStyle = 'rgba(0,0,0,0.22)';
              context.fillRect(px, py + size * 0.52, size, 1);
              context.fillRect(px + (y % 2 === 0 ? size * 0.5 : size * 0.25), py, 1, size * 0.52);
            } else {
              // Water: a ripple, drawn from the tile's own stable noise.
              context.strokeStyle = 'rgba(160, 220, 255, 0.25)';
              context.lineWidth = 1;
              context.beginPath();
              context.moveTo(px + size * 0.15, py + size * (0.4 + noise * 0.2));
              context.lineTo(px + size * 0.85, py + size * (0.5 + noise * 0.2));
              context.stroke();
            }
            context.strokeStyle = paint.edge;
            context.lineWidth = 1;
            context.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
          } else {
            context.strokeStyle = paint.edge;
            context.lineWidth = 1;
            context.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
            if (noise > 0.8) {
              context.fillStyle = paint.speck;
              context.fillRect(px + size * 0.28, py + size * 0.55, size * 0.2, size * 0.1);
            }
            if (noise < 0.07) {
              // A loose stone on the floor. Decoration, and only decoration:
              // a CANDIDATE prop may never define collision or ground speed.
              const stone = PUBLIC_PALETTE['prop.stone'];
              context.fillStyle = stone.base;
              context.fillRect(px + size * 0.3, py + size * 0.46, size * 0.22, size * 0.16);
              context.fillStyle = stone.edge;
              context.fillRect(px + size * 0.3, py + size * 0.6, size * 0.22, size * 0.04);
            }
          }

          const override = overrideFor(spriteKey);
          if (override) {
            const box = spriteDrawBox(32, size, x, y);
            context.drawImage(override, box.x - cam.x, box.y - cam.y, box.width, box.height);
          }
        }
      }

      // ── light ────────────────────────────────────────────────────────
      //
      // A sewer is dark. The Character carries the only light, so the frame
      // has somewhere to look: warm close in, and the corners fall away.
      {
        const lx = hero.x * size + size / 2 - cam.x;
        const ly = hero.y * size + size / 2 - cam.y;
        const lantern = context.createRadialGradient(lx, ly, size * 0.4, lx, ly, size * 5);
        lantern.addColorStop(0, 'rgba(255, 198, 130, 0.14)');
        lantern.addColorStop(0.6, 'rgba(255, 180, 110, 0.04)');
        lantern.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = lantern;
        context.fillRect(0, 0, width, height);

        // Enough fall-off to give the frame a centre. NOT enough to hide the
        // map: a player who cannot see the far wall cannot read the room.
        const dusk = context.createRadialGradient(lx, ly, size * 6, lx, ly, size * 14);
        dusk.addColorStop(0, 'rgba(0, 0, 0, 0)');
        dusk.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
        context.fillStyle = dusk;
        context.fillRect(0, 0, width, height);
      }

      // ── actors ───────────────────────────────────────────────────────
      const order = [...actors].sort((a, b) => placed.get(a.id)!.y - placed.get(b.id)!.y);

      for (const actor of order) {
        const spot = placed.get(actor.id)!;
        const px = spot.x * size - cam.x;
        const py = spot.y * size - cam.y;
        const cx = px + size / 2;
        const dead = actor.health <= 0;

        // A soft shadow anchors an actor to its tile; without one everything
        // looks like it is floating a little above the floor.
        context.fillStyle = 'rgba(0,0,0,0.38)';
        context.beginPath();
        context.ellipse(cx, py + size * 0.82, size * 0.3, size * 0.12, 0, 0, Math.PI * 2);
        context.fill();

        context.lineJoin = 'round';
        // An actor's private override is a 64px cell anchored BOTTOM-RIGHT
        // over its tile, so a tall sprite overhangs up and left and the tile
        // under its feet stays the tile the server named. Public builds never
        // reach this: `overrideFor` is `null` for every key there.
        // THE RAT is the one appearance whose direction mapping the manifest
        // actually determines — pattern 4x1x1, one layer — so it selects a real
        // frame per facing and per phase. The citizen is a PARTIAL base-layer
        // extraction (8 of 48 cells, 2 layers unrecorded), so its mapping is a
        // SOURCE GAP and it draws the single frame the reference supplies.
        const actorOverride = dead
          ? null
          : actor.kind === 'creature'
            ? imageFor(ratFrameUrl(spot.heading, spot.phase))
            : overrideFor('actor.character');
        if (actorOverride) {
          const box = spriteDrawBox(64, size, spot.x, spot.y);
          context.drawImage(actorOverride, box.x - cam.x, box.y - cam.y, box.width, box.height);
        } else if (actor.kind === 'character') {
          const skin = PUBLIC_PALETTE['actor.character'];
          const body = size * 0.3;
          context.strokeStyle = 'rgba(0,0,0,0.65)';
          context.lineWidth = Math.max(1.5, size * 0.05);
          context.fillStyle = '#3f86a8';
          context.beginPath();
          context.moveTo(cx - body, py + size * 0.82);
          context.lineTo(cx + body, py + size * 0.82);
          context.lineTo(cx + body * 0.7, py + size * 0.36);
          context.lineTo(cx - body * 0.7, py + size * 0.36);
          context.closePath();
          context.fill();
          context.stroke();
          context.fillStyle = skin.base;
          context.beginPath();
          context.arc(cx, py + size * 0.3, size * 0.16, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          // A blade, held on the side it last moved toward.
          context.strokeStyle = skin.speck;
          context.lineWidth = Math.max(2, size * 0.07);
          context.beginPath();
          context.moveTo(cx + spot.facing * body * 1.05, py + size * 0.72);
          context.lineTo(cx + spot.facing * body * 1.25, py + size * 0.34);
          context.stroke();
        } else if (dead) {
          context.fillStyle = 'rgba(120, 40, 40, 0.45)';
          context.beginPath();
          context.ellipse(cx, py + size * 0.7, size * 0.3, size * 0.14, 0, 0, Math.PI * 2);
          context.fill();
        } else {
          const pelt = PUBLIC_PALETTE['actor.rat'];
          const body = size * 0.26;
          context.strokeStyle = pelt.edge;
          context.lineWidth = Math.max(1.2, size * 0.04);
          context.fillStyle = pelt.speck;
          context.beginPath();
          context.ellipse(cx, py + size * 0.62, body, body * 0.7, 0, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.beginPath();
          context.arc(cx + spot.facing * body * 0.9, py + size * 0.56, body * 0.42, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          // Ears and a tail — the difference between "a rat" and "a blob".
          context.beginPath();
          context.arc(
            cx + spot.facing * body * 0.75,
            py + size * 0.44,
            body * 0.18,
            0,
            Math.PI * 2,
          );
          context.fill();
          context.strokeStyle = pelt.speck;
          context.lineWidth = Math.max(1, size * 0.05);
          context.beginPath();
          context.moveTo(cx - spot.facing * body, py + size * 0.64);
          context.lineTo(cx - spot.facing * body * 1.8, py + size * 0.5);
          context.stroke();
        }

        if (!dead && actor.health < actor.maxHealth) {
          const barWidth = size * 0.66;
          const barHeight = Math.max(3, size * 0.09);
          const left = cx - barWidth / 2;
          const top = py + size * 0.08;
          context.fillStyle = 'rgba(0,0,0,0.6)';
          context.fillRect(left, top, barWidth, barHeight);
          const share = Math.max(0, Math.min(1, actor.health / Math.max(1, actor.maxHealth)));
          context.fillStyle = share > 0.5 ? '#4caf50' : share > 0.25 ? '#e0a83b' : '#d15b4a';
          context.fillRect(left, top, barWidth * share, barHeight);
        }
      }

      // ── contact ──────────────────────────────────────────────────────
      //
      // Adjacency is IN THE DATA — it is the precondition the server itself
      // checks before an attack, Chebyshev one — so drawing a clash between
      // two actors that are next to each other states something true rather
      // than guessing at a fight the client cannot see.
      const heroSpot = placed.get('character');
      if (heroSpot) {
        for (const creature of view.creatures) {
          if (!creature.id || creature.health <= 0) continue;
          const spot = placed.get(creature.id);
          if (!spot) continue;
          // Measured on what is DRAWN. The scene is a moment behind the
          // snapshot, so marking contact from the newest tiles would put
          // sparks where nobody is standing yet.
          const touching =
            Math.max(Math.abs(spot.x - heroSpot.x), Math.abs(spot.y - heroSpot.y)) < 1.05 &&
            Math.max(Math.abs(spot.x - heroSpot.x), Math.abs(spot.y - heroSpot.y)) > 0.7;
          if (!touching) continue;
          const mx = ((spot.x + heroSpot.x) / 2 + 0.5) * size - cam.x;
          const my = ((spot.y + heroSpot.y) / 2 + 0.5) * size - cam.y;
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
          context.strokeStyle = `rgba(255, 216, 140, ${0.25 + pulse * 0.45})`;
          context.lineWidth = Math.max(1.5, size * 0.06);
          for (const angle of [Math.PI / 4, -Math.PI / 4]) {
            context.beginPath();
            context.moveTo(mx - Math.cos(angle) * size * 0.2, my - Math.sin(angle) * size * 0.2);
            context.lineTo(mx + Math.cos(angle) * size * 0.2, my + Math.sin(angle) * size * 0.2);
            context.stroke();
          }
        }
      }

      // ── the developer overlay ────────────────────────────────────────
      if (overlay) {
        context.strokeStyle = 'rgba(120, 200, 255, 0.28)';
        context.lineWidth = 1;
        for (let x = firstColumn; x <= lastColumn + 1; x += 1) {
          const px = Math.round(x * size - cam.x) + 0.5;
          context.beginPath();
          context.moveTo(px, 0);
          context.lineTo(px, height);
          context.stroke();
        }
        for (let y = firstRow; y <= lastRow + 1; y += 1) {
          const py = Math.round(y * size - cam.y) + 0.5;
          context.beginPath();
          context.moveTo(0, py);
          context.lineTo(width, py);
          context.stroke();
        }
        context.fillStyle = 'rgba(120, 200, 255, 0.8)';
        context.font = '8px ui-monospace, monospace';
        for (let y = firstRow; y <= lastRow; y += 5) {
          for (let x = firstColumn; x <= lastColumn; x += 5) {
            context.fillText(`${x},${y}`, x * size - cam.x + 2, y * size - cam.y + 9);
          }
        }
        for (const actor of actors) {
          const spot = placed.get(actor.id)!;
          context.fillStyle = 'rgba(255, 255, 255, 0.85)';
          context.fillText(
            actor.id === 'character' ? 'character' : (actor.id.split(':').slice(-1)[0] ?? ''),
            spot.x * size - cam.x,
            spot.y * size - cam.y - 2,
          );
        }
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      stop = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  /**
   * Which side of the distribution boundary this scene drew from.
   *
   * A public build folds `privateSpriteUrl` to `null`, so this is `public` in
   * every deployment, in CI, and on every machine without the private
   * reference — which is what the acceptance tests assert against.
   */
  const spriteSource = privateSpriteUrl('actor.rat') ? 'private-override' : 'public';

  return (
    <div
      className="tile-scene"
      ref={holder}
      data-testid="tile-scene"
      data-map={map.key}
      data-sprites={spriteSource}
    >
      <canvas ref={canvas} role="img" aria-label={`The ${map.key} map, seen from above`} />
      {debug ? (
        <p className="tile-debug small" data-testid="tile-debug">
          rev {run.revision} · tick {run.tick} · room {run.room}
          {run.cycle > 0 ? `/c${run.cycle}` : ''} · you{' '}
          {run.space ? `${run.space.tile.x},${run.space.tile.y},${run.space.tile.z}` : '—'} ·{' '}
          {run.creatures.filter((creature) => creature.health > 0).length} alive
        </p>
      ) : null}
    </div>
  );
}
