'use client';

/**
 * The first GAME WINDOW (`UI_SURFACE_ARCHITECTURE.md` §1, Phase 2 spec §10).
 *
 * A separate surface from the Atlas, deliberately. The Atlas is world
 * NAVIGATION — where you could go. This is where you ARE: one scene, the
 * Character, the creatures in front of it, and the state the server says they
 * are all in.
 *
 * THE BROWSER IS NEVER AUTHORITATIVE. It does not decide time, targets,
 * damage, hits, misses, death, XP, Gold, supplies or room progression; it
 * polls, and it draws the answer. Nothing here simulates anything, and there
 * is no input that could: no WASD, no attack button, no click-to-move. The
 * Character controls itself, which is what an idle game is.
 *
 * What the browser MAY do is interpolate between two server states so a health
 * bar slides instead of jumping — presentation, expressed in CSS transitions,
 * never a value anyone reads back. Creature positions are the same kind of
 * thing: laid out from the index the server sent, because Phase 2 simulates no
 * positions and inventing persisted ones would be a second source of truth.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  type HuntEvent,
  type MapResponse,
  type RunView,
  type TileMapView,
} from '../_lib/api';
import { TileScene } from './TileScene';

/** How often a connected client proves it is still there. Comfortably inside
 *  the server's liveness window, so an ordinary hiccup is not a disconnect. */
const POLL_MS = 2000;

/**
 * Whether the spatial debug overlay EXISTS in this build.
 *
 * Developer-only, and off even then until someone asks for it: a grid with
 * tile coordinates over the scene is a diagnostic, not a HUD, and shipping it
 * on would be shipping a different game.
 */
const DEBUG_AVAILABLE = process.env['NEXT_PUBLIC_DEBUG_OVERLAY'] === '1';

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const percent = (value: number, of: number) => (of <= 0 ? 0 : clamp((value / of) * 100, 0, 100));

/** 42:00 as a clock, not as a number of milliseconds. */
function asClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

/** `item.small-health-potion` reads badly in a combat log. */
const label = (key: string): string => key.replace(/^item\./, '').replace(/-/g, ' ');

/** One line of combat log, from one server event. */
function describe(event: HuntEvent): string {
  switch (event.kind) {
    case 'spawn':
      return `Room ${event.room}: ${event.count} appear`;
    case 'hit':
      return event.damage === 0 ? 'Your attack is blocked' : `You hit for ${event.damage}`;
    case 'taken':
      return event.damage === 0 ? 'You block the attack' : `You take ${event.damage}`;
    case 'kill':
      return 'The creature dies';
    case 'room-cleared':
      return event.cycle && event.cycle > 0
        ? `Room ${event.room} cleared — cycle ${event.cycle}`
        : `Room ${event.room} cleared`;
    case 'supply':
      return `You drink a potion (+${event.healed}), ${event.remaining} left`;
    // Phase 3 — what physically dropped, and what did NOT get picked up.
    case 'loot': {
      const many = (event.quantity ?? 1) > 1 ? `${event.quantity} ` : '';
      return `You pick up ${many}${label(event.item ?? '')}`;
    }
    case 'loot-skipped': {
      const what = label(event.item ?? '');
      if (event.reason === 'policy') return `${what} left behind — your filter skips it`;
      if (event.reason === 'no-space') return `${what} left behind — the Loot Pouch is full`;
      return `${what} left behind — too heavy to carry`;
    }
    case 'died':
      return 'You have died.';
    default:
      return '';
  }
}

const ENDED: Record<string, { title: string; detail: string }> = {
  DIED: {
    title: 'You have died',
    detail: 'The hunt is over.',
  },
  LEFT: { title: 'You left the hunt', detail: 'You keep what you were carrying.' },
  GRACE_EXPIRED: {
    title: 'The connection did not come back',
    detail:
      'The hunt ended after five minutes of reconnect grace. You keep what you were carrying.',
  },
};

export interface GameWindowProps {
  readonly characterId: string;
  /** The Hunt the Activity pinned, for the heading. */
  readonly label: string;
  readonly summary: string;
  /** Called after the run ends or the player leaves, so the page can go back
   *  to asking the server which screen it is now. */
  readonly onEnded: () => void | Promise<void>;
}

export function GameWindow({ characterId, label, summary, onEnded }: GameWindowProps) {
  const [run, setRun] = useState<RunView | null>(null);
  const [log, setLog] = useState<{ id: string; text: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [map, setMap] = useState<TileMapView | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const seen = useRef(-1);
  /**
   * The highest revision this window has APPLIED.
   *
   * Two polls can be in flight at once — a slow settlement and the next
   * interval — and nothing makes the network deliver them in order. Applying
   * the older answer rewinds the world on screen: the Character jumps back a
   * tile, a dead creature stands up. The server's revision says which of two
   * snapshots is newer, so the stale one is simply dropped.
   */
  const revision = useRef(-1);
  /**
   * The caller's callback, behind a ref.
   *
   * `onEnded` is an inline arrow at every call site, so depending on it
   * directly would give `poll` a new identity on every render — and the effect
   * below would tear the interval down and rebuild it each time. It happens to
   * keep roughly the right cadence, which is worse than failing: a component
   * that re-rendered a little faster would reset the timer before it ever
   * fired, and the Hunt would silently stop advancing.
   */
  const finish = useRef(onEnded);
  finish.current = onEnded;

  const poll = useCallback(async () => {
    try {
      // A POST, because this ADVANCES the simulation. The same request is the
      // heartbeat that proves the connection is alive; what it must not be is
      // a GET, which the browser, a proxy or React itself may repeat at will.
      const next = await api<RunView | null>(`/api/characters/${characterId}/hunt/advance`, {
        method: 'POST',
      });
      setFailed(false);
      if (!next) return;
      // Out of order. The world on screen is already newer than this answer.
      if (next.revision < revision.current) return;
      revision.current = next.revision;
      setRun(next);
      // Only the events from ticks this client has not shown yet, so a
      // settlement that arrives twice does not print twice.
      const fresh = next.events.filter((event) => event.tick > seen.current);
      if (fresh.length > 0) {
        seen.current = fresh[fresh.length - 1]!.tick;
        setLog((previous) =>
          [
            ...previous,
            ...fresh.map((event, index) => ({
              id: `${event.tick}-${index}-${event.kind}`,
              text: describe(event),
            })),
          ].slice(-8),
        );
      }
    } catch (cause) {
      // A SIGNED-OUT session is not a lost connection, and telling a player to
      // wait five minutes for one would be a lie they could sit through. Hand
      // it back to the page, which asks the server which screen this is now.
      if (cause instanceof ApiError && cause.status === 401) {
        await finish.current();
        return;
      }
      // Anything else is a connection problem, not a game state. The server
      // holds the run for five minutes; say so instead of tearing the screen
      // down.
      setFailed(true);
    }
  }, [characterId]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  /**
   * The tile map, fetched ONCE.
   *
   * It is content, immutable for the life of a bundle version, and it is two
   * orders of magnitude larger than a snapshot. Sending it with every poll
   * would be the same 671 tiles every second for the whole hunt.
   */
  const mapKey = run?.space?.mapKey ?? null;
  useEffect(() => {
    if (!mapKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api<MapResponse>(`/api/maps/${encodeURIComponent(mapKey)}`);
        if (!cancelled) setMap(loaded.map);
      } catch {
        // A map that will not load costs the scene, not the hunt: the readouts
        // and the log are the same information and they still work.
        if (!cancelled) setMap(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapKey]);

  // The grace countdown is the only clock this component runs, and it only
  // DISPLAYS: the deadline itself is the server's, and it is the server that
  // decides the hunt is over.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function leave() {
    setLeaving(true);
    try {
      await api(`/api/characters/${characterId}/activity`, { method: 'DELETE' });
      await onEnded();
    } finally {
      setLeaving(false);
    }
  }

  if (!run) {
    return (
      <section className="panel skeleton" aria-busy="true" data-testid="game-window-loading" />
    );
  }

  const ended = run.endedReason ? ENDED[run.endedReason] : null;
  const graceLeft = run.graceExpiresAt ? Date.parse(run.graceExpiresAt) - now : 0;
  const levelStart = Number(run.levelStartXp);
  const levelEnd = Number(run.nextLevelXp);
  const intoLevel = Number(run.baseXp) - levelStart;
  const levelSpan = Math.max(1, levelEnd - levelStart);

  return (
    <section className="game stack" data-testid="game-window" aria-labelledby="game-heading">
      <header className="row game-head">
        <div>
          <h2 id="game-heading">{label}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {summary}
          </p>
        </div>
        {DEBUG_AVAILABLE ? (
          <button
            type="button"
            className="ghost small"
            data-testid="debug-toggle"
            aria-pressed={showDebug}
            onClick={() => setShowDebug((on) => !on)}
          >
            Debug
          </button>
        ) : null}
        <span
          className={`badge connection-${run.connection}`}
          data-testid="connection"
          data-connection={run.connection}
          role="status"
        >
          {run.connection === 'ONLINE_ACTIVE'
            ? 'Live'
            : run.connection === 'RECONNECT_GRACE_PAUSED'
              ? `Reconnecting — ${asClock(Math.max(0, graceLeft))} left`
              : 'Ended'}
        </span>
      </header>

      {/* ── the scene ─────────────────────────────────────────────────── */}
      <div className="scene" data-testid="scene">
        <div className="scene-room">
          <span data-testid="room">Room {run.room}</span>
          {run.cycle > 0 ? (
            <span data-testid="cycle" className="muted small">
              {' '}
              · cycle {run.cycle}
            </span>
          ) : null}
        </div>

        {/* The map, when the Hunt has one. A Hunt without a map is still a
            legitimate run — every Phase 2 fixture is one — so the readouts
            below are the scene in that case, not a fallback for a failure. */}
        {map && run.space ? <TileScene map={map} run={run} debug={showDebug} /> : null}

        <div className={`scene-floor ${map && run.space ? 'with-map' : ''}`}>
          <figure className="actor character" data-testid="character">
            <div className="sprite character-sprite" aria-hidden="true" />
            <figcaption>
              <span className="small">You</span>
              <span className="bar" aria-hidden="true">
                <span
                  className="bar-fill health"
                  style={{ width: `${percent(run.health, run.maxHealth)}%` }}
                />
              </span>
              <span className="small" data-testid="character-health">
                {run.health} / {run.maxHealth}
              </span>
            </figcaption>
          </figure>

          <ul className="actors" data-testid="creatures">
            {run.creatures.map((creature, index) => (
              <li
                key={creature.id ?? `${creature.key}-${index}`}
                className={`actor creature ${creature.health <= 0 ? 'dead' : ''}`}
                data-testid="creature"
                data-creature={creature.key}
              >
                <div className="sprite creature-sprite" aria-hidden="true" />
                <span className="bar" aria-hidden="true">
                  <span
                    className="bar-fill creature-health"
                    style={{ width: `${percent(creature.health, creature.maxHealth)}%` }}
                  />
                </span>
                <span className="small">
                  {creature.health} / {creature.maxHealth}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── what the run is worth ─────────────────────────────────────── */}
      <dl className="readouts">
        <div className="stat">
          <dt>Base level</dt>
          <dd data-testid="base-level">
            {run.baseLevel}
            <span className="bar" aria-hidden="true">
              <span
                className="bar-fill level"
                style={{ width: `${percent(intoLevel, levelSpan)}%` }}
              />
            </span>
            <span className="muted small" data-testid="base-xp">
              {run.baseXp} / {run.nextLevelXp}
            </span>
          </dd>
        </div>
        <div className="stat">
          <dt>Session XP</dt>
          <dd data-testid="session-xp">{run.sessionXp}</dd>
        </div>
        <div className="stat">
          <dt>Gold pouch</dt>
          {/* THE CARRIED TOTAL, and the number that is at risk. `sessionGold`
              is what this run earned; the pouch is what the Character is
              actually holding, and what a death without Full Bless takes. */}
          <dd data-testid="pouch-gold">
            {run.pouchGold}
            <span className="muted small" data-testid="session-gold">
              {run.sessionGold} this run
            </span>
          </dd>
        </div>
        <div className="stat">
          {/* Phase 3 — how full the Loot Pouch is, because "nothing is being
              picked up" is a state the player has to be able to SEE before
              they can fix it. */}
          <dt>Loot pouch</dt>
          {/* `run-pouch-occupancy`, not `pouch-occupancy`: the System UI owns
              that id. Two elements answering to one test id is a test that
              passes by accident. */}
          <dd data-testid="run-pouch-occupancy" data-used={run.lootPouch?.used ?? 0}>
            {run.lootPouch ? `${run.lootPouch.used} / ${run.lootPouch.spaces}` : '—'}
          </dd>
        </div>
        <div className="stat">
          <dt>Stamina</dt>
          {/* `run-stamina`, not `stamina`: the Character panel owns that id
              and Phase 1's cases read it. Two elements answering to one test
              id is a test that passes by accident. */}
          <dd data-testid="run-stamina" data-mode={run.staminaMode}>
            {asClock(run.staminaRemainingMs)}
            <span className="muted small"> {run.staminaMode.toLowerCase()}</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Supplies</dt>
          <dd data-testid="supplies">
            {run.supplyCharges}
            {run.supplyCharges === 0 ? (
              <strong className="warn small" data-testid="supply-warning" role="status">
                {' '}
                out of potions
              </strong>
            ) : null}
          </dd>
        </div>
      </dl>

      {/* ── the last few things that happened ─────────────────────────── */}
      <ol className="log" data-testid="events" aria-live="polite" aria-label="Combat log">
        {log.map((line) => (
          <li key={line.id} className="small">
            {line.text}
          </li>
        ))}
      </ol>

      {failed && !ended ? (
        <p className="muted small" data-testid="poll-error" role="status">
          Reconnecting… your hunt is held on the server for five minutes.
        </p>
      ) : null}

      {ended ? (
        <section className="panel stack" data-testid="ended" data-reason={run.endedReason}>
          <h3 style={{ margin: 0 }}>{ended.title}</h3>
          <p className="muted small" style={{ margin: 0 }}>
            {ended.detail}
          </p>
          {run.penalty ? (
            // WHAT IT COST, said plainly. Two numbers going down without an
            // explanation is how a player concludes the game ate their gold.
            <ul
              className="small stack"
              data-testid="penalty"
              style={{ margin: 0, paddingLeft: 18 }}
            >
              <li data-testid="penalty-xp">
                Lost {run.penalty.experienceLost} experience
                {run.penalty.levelAfter < run.penalty.levelBefore
                  ? ` — down to level ${run.penalty.levelAfter}`
                  : ''}
              </li>
              <li data-testid="penalty-gold">
                {run.penalty.fullBless
                  ? 'Your blessings protected your gold pouch'
                  : run.penalty.goldForfeited === '0'
                    ? 'Your gold pouch was empty'
                    : `Lost ${run.penalty.goldForfeited} gold from your pouch`}
              </li>
            </ul>
          ) : null}
          <div className="row">
            <button className="primary" data-testid="back-to-atlas" onClick={() => void onEnded()}>
              Back to the Atlas
            </button>
          </div>
        </section>
      ) : (
        <div className="row">
          <button onClick={leave} disabled={leaving} data-testid="leave">
            {leaving ? 'Leaving…' : 'Leave hunt'}
          </button>
          <span className="muted small">
            Your character fights on its own. There is nothing to press.
          </span>
        </div>
      )}
    </section>
  );
}
