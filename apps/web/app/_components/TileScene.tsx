'use client';

/**
 * The tile scene (Phase 3.5 §7).
 *
 * A CAMERA, not a simulator. Every position it draws came from the server:
 * the map is content, the tiles actors stand on are authoritative, and the
 * only thing this file decides is how many pixels lie between two of them
 * while the eye catches up. There is no input, no prediction and no local
 * clock that anything durable depends on — pause the tab and the drawing
 * stops; the hunt does not.
 *
 * What it MAY do is ease. A server tick is a second long and a step is one
 * tile, so a renderer that snapped would look like a spreadsheet. It eases
 * over a fraction of a second between two tiles the server stated, and any
 * snapshot that disagrees wins immediately.
 */
import { useEffect, useRef } from 'react';
import type { RunView, Tile, TileMapView } from '../_lib/api';

/** How long the eye takes to cross one tile. Presentation, nothing else. */
const EASE_MS = 260;

/**
 * How much of the world is in frame.
 *
 * A chamber is nine tiles deep, so the tile size is taken from the SHORTER
 * constraint: a viewport that only fits six rows would cut the room in half
 * and hide half the fight.
 */
const VIEW_WIDE = 17;
const VIEW_NARROW = 9;
const VIEW_DEEP = 9;
const VIEW_SHALLOW = 7;
const NARROW_PX = 560;

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
  readonly health: number;
  readonly maxHealth: number;
  readonly label: string;
}

/** Where an actor is being drawn, between two tiles the server stated. */
interface Eased {
  from: Tile;
  to: Tile;
  startedAt: number;
  facing: 1 | -1;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ease-out cubic: fast off the tile, settling onto the next one. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A stable pseudo-random number for a tile, so the same stone is mottled the
 * same way every frame and after a reload. Not `Math.random` — a floor that
 * shimmered every frame would be a bug you could see.
 */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

const KIND: Record<string, 'wall' | 'floor' | 'water'> = {};

export function TileScene({ map, run, debug = false }: TileSceneProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** The latest snapshot, read by the animation loop without restarting it. */
  const latest = useRef<{ map: TileMapView; run: RunView; debug: boolean }>({ map, run, debug });
  const eased = useRef(new Map<string, Eased>());
  const camera = useRef<{ x: number; y: number } | null>(null);

  latest.current = { map, run, debug };

  useEffect(() => {
    const element = canvas.current;
    const box = holder.current;
    if (!element || !box) return;

    const context = element.getContext('2d');
    if (!context) return;

    let frame = 0;
    let stop = false;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(box.clientWidth));
      const height = Math.max(1, Math.round(box.clientHeight));
      if (element.width !== width * ratio || element.height !== height * ratio) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      return { width, height, ratio };
    };

    const draw = (at: number) => {
      if (stop) return;
      const { map: current, run: view, debug: overlay } = latest.current;
      const { width, height, ratio } = resize();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const narrow = width < NARROW_PX;
      const across = narrow ? VIEW_NARROW : VIEW_WIDE;
      const down = narrow ? VIEW_SHALLOW : VIEW_DEEP;
      const size = Math.max(14, Math.floor(Math.min(width / across, height / down)));
      const rows = current.rows;
      const mapWidth = (rows[0]?.length ?? 0) * size;
      const mapHeight = rows.length * size;

      // ── who is on the board ──────────────────────────────────────────
      const actors: Drawn[] = [];
      if (view.space) {
        actors.push({
          id: 'character',
          kind: 'character',
          tile: view.space.tile,
          health: view.health,
          maxHealth: view.maxHealth,
          label: 'You',
        });
      }
      for (const creature of view.creatures) {
        if (!creature.tile || !creature.id) continue;
        actors.push({
          id: creature.id,
          kind: 'creature',
          tile: creature.tile,
          health: creature.health,
          maxHealth: creature.maxHealth,
          label: creature.key.replace(/^creature\./, ''),
        });
      }

      // ── ease each actor toward the tile the server put it on ─────────
      const live = new Set(actors.map((actor) => actor.id));
      for (const id of [...eased.current.keys()]) {
        if (!live.has(id)) eased.current.delete(id);
      }
      const placed = new Map<string, { x: number; y: number; facing: number }>();
      for (const actor of actors) {
        const previous = eased.current.get(actor.id);
        if (!previous) {
          eased.current.set(actor.id, {
            from: actor.tile,
            to: actor.tile,
            startedAt: at,
            facing: 1,
          });
        } else if (previous.to.x !== actor.tile.x || previous.to.y !== actor.tile.y) {
          const progress = Math.min(1, (at - previous.startedAt) / EASE_MS);
          const t = ease(progress);
          const fromX = lerp(previous.from.x, previous.to.x, t);
          const fromY = lerp(previous.from.y, previous.to.y, t);
          eased.current.set(actor.id, {
            from: { x: fromX, y: fromY, z: actor.tile.z },
            to: actor.tile,
            startedAt: at,
            facing: actor.tile.x < fromX ? -1 : 1,
          });
        }
        const step = eased.current.get(actor.id)!;
        const progress = Math.min(1, (at - step.startedAt) / EASE_MS);
        const t = ease(progress);
        placed.set(actor.id, {
          x: lerp(step.from.x, step.to.x, t),
          y: lerp(step.from.y, step.to.y, t),
          facing: step.facing,
        });
      }

      // ── camera ───────────────────────────────────────────────────────
      const hero = placed.get('character') ?? { x: 0, y: 0, facing: 1 };
      const wantX = hero.x * size + size / 2 - width / 2;
      const wantY = hero.y * size + size / 2 - height / 2;
      const clampX =
        mapWidth <= width ? (mapWidth - width) / 2 : Math.min(Math.max(wantX, 0), mapWidth - width);
      const clampY =
        mapHeight <= height
          ? (mapHeight - height) / 2
          : Math.min(Math.max(wantY, 0), mapHeight - height);
      // The camera itself eases, so a two-tile settlement does not snap the
      // whole world sideways.
      const previousCamera = camera.current;
      const cam = previousCamera
        ? { x: lerp(previousCamera.x, clampX, 0.18), y: lerp(previousCamera.y, clampY, 0.18) }
        : { x: clampX, y: clampY };
      camera.current = cam;

      // ── the floor ────────────────────────────────────────────────────
      //
      // The one thing this drawing has to get right is WHICH TILES ARE SOLID.
      // A player who cannot see the walls cannot read why the Character went
      // around, so masonry is lighter and lit from above and the floor is the
      // dark thing you move across — not the other way round.
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
          const kind = current.legend[symbol] ?? KIND[symbol] ?? 'wall';
          const px = Math.round(x * size - cam.x);
          const py = Math.round(y * size - cam.y);
          const noise = hash(x, y);

          if (kind === 'wall') {
            // MASONRY: lighter than the floor, lit from above, with a shadow
            // under the lip. A wall drawn darker than the ground reads as a
            // hole, and then the player cannot tell why the Character walked
            // round it.
            const lip = Math.max(3, size * 0.2);
            context.fillStyle = `hsl(206 8% ${33 + noise * 7}%)`;
            context.fillRect(px, py, size, size);
            context.fillStyle = 'rgba(255,255,255,0.16)';
            context.fillRect(px, py, size, lip * 0.5);
            context.fillStyle = 'rgba(0,0,0,0.42)';
            context.fillRect(px, py + size - lip * 0.6, size, lip * 0.6);
            // Courses, so a long wall is not one flat slab.
            context.fillStyle = 'rgba(0,0,0,0.22)';
            context.fillRect(px, py + size * 0.52, size, 1);
            context.fillRect(px + (y % 2 === 0 ? size * 0.5 : size * 0.25), py, 1, size * 0.52);
            context.strokeStyle = 'rgba(0,0,0,0.45)';
            context.lineWidth = 1;
            context.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
          } else if (kind === 'water') {
            context.fillStyle = `hsl(196 48% ${22 + noise * 6}%)`;
            context.fillRect(px, py, size, size);
            context.strokeStyle = 'rgba(160, 220, 255, 0.25)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(px + size * 0.15, py + size * (0.4 + noise * 0.2));
            context.lineTo(px + size * 0.85, py + size * (0.5 + noise * 0.2));
            context.stroke();
          } else {
            context.fillStyle = `hsl(30 10% ${18 + noise * 5}%)`;
            context.fillRect(px, py, size, size);
            // Grout, and a few flagstone chips, so the floor has a texture at
            // a glance without costing a texture atlas.
            context.strokeStyle = 'rgba(0,0,0,0.42)';
            context.lineWidth = 1;
            context.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
            if (noise > 0.8) {
              context.fillStyle = 'rgba(255,255,255,0.05)';
              context.fillRect(px + size * 0.28, py + size * 0.55, size * 0.2, size * 0.1);
            }
            if (noise < 0.07) {
              context.fillStyle = 'rgba(120, 160, 130, 0.09)';
              context.fillRect(px + size * 0.12, py + size * 0.2, size * 0.36, size * 0.22);
            }
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
        lantern.addColorStop(0, 'rgba(255, 198, 130, 0.13)');
        lantern.addColorStop(0.6, 'rgba(255, 180, 110, 0.04)');
        lantern.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = lantern;
        context.fillRect(0, 0, width, height);

        // Enough fall-off to give the frame a centre. Not enough to hide the
        // map: a player who cannot see the far wall cannot read the room.
        const dusk = context.createRadialGradient(lx, ly, size * 7, lx, ly, size * 18);
        dusk.addColorStop(0, 'rgba(0, 0, 0, 0)');
        dusk.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
        context.fillStyle = dusk;
        context.fillRect(0, 0, width, height);
      }

      // ── actors ───────────────────────────────────────────────────────
      const order = [...actors].sort((a, b) => {
        const pa = placed.get(a.id)!;
        const pb = placed.get(b.id)!;
        return pa.y - pb.y;
      });

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
        if (actor.kind === 'character') {
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
          context.fillStyle = '#efd7b0';
          context.beginPath();
          context.arc(cx, py + size * 0.3, size * 0.16, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          // A blade, held on the side it last moved toward.
          context.strokeStyle = '#cdd6e0';
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
          const body = size * 0.26;
          context.strokeStyle = 'rgba(0,0,0,0.6)';
          context.lineWidth = Math.max(1.2, size * 0.04);
          context.fillStyle = '#8a7361';
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
          context.strokeStyle = '#6b5a4a';
          context.lineWidth = Math.max(1, size * 0.05);
          context.beginPath();
          context.moveTo(cx - spot.facing * body, py + size * 0.64);
          context.lineTo(cx - spot.facing * body * 1.8, py + size * 0.5);
          context.stroke();
        }

        if (!dead && actor.health < actor.maxHealth) {
          const barWidth = size * 0.66;
          const barHeight = Math.max(3, size * 0.08);
          const left = cx - barWidth / 2;
          const top = py + size * 0.1;
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
      // checks before an attack — so drawing a clash between two actors that
      // are next to each other states something true rather than guessing at
      // a fight the client cannot see.
      const heroTile = view.space?.tile;
      if (heroTile) {
        for (const creature of view.creatures) {
          if (!creature.tile || creature.health <= 0) continue;
          const touching =
            creature.tile.z === heroTile.z &&
            Math.abs(creature.tile.x - heroTile.x) + Math.abs(creature.tile.y - heroTile.y) === 1;
          if (!touching) continue;
          const mx = ((creature.tile.x + heroTile.x) / 2 + 0.5) * size - cam.x;
          const my = ((creature.tile.y + heroTile.y) / 2 + 0.5) * size - cam.y;
          const pulse = 0.5 + 0.5 * Math.sin(at / 90);
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
        context.strokeStyle = 'rgba(120, 200, 255, 0.22)';
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
        context.fillStyle = 'rgba(120, 200, 255, 0.75)';
        context.font = `${Math.max(8, Math.round(size * 0.24))}px ui-monospace, monospace`;
        for (let y = firstRow; y <= lastRow; y += 5) {
          for (let x = firstColumn; x <= lastColumn; x += 5) {
            context.fillText(`${x},${y}`, x * size - cam.x + 2, y * size - cam.y + size * 0.3);
          }
        }
        for (const actor of actors) {
          const spot = placed.get(actor.id)!;
          context.fillStyle = 'rgba(255, 255, 255, 0.85)';
          context.fillText(
            actor.id === 'character' ? 'character' : actor.id.split(':').slice(-1)[0]!,
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

  return (
    <div className="tile-scene" ref={holder} data-testid="tile-scene" data-map={map.key}>
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
