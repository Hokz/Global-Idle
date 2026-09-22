'use client';

/**
 * The play surface: panel + Atlas, or the Game Window (Phase 1 §6, §7, §9;
 * Phase 2 §10).
 *
 * WHICH SCREEN IS SHOWN IS THE SERVER'S ANSWER, not the URL's. On load, and
 * after every action, the character's durable activity decides — so a reload
 * inside a Hunt returns to the Hunt because the row says so (§9.5, §9.6).
 */
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  api,
  type Atlas as AtlasData,
  type CharacterDetail,
  type HuntView,
  type Marker,
} from '../../_lib/api';
import { Atlas } from '../../_components/Atlas';
import { CharacterPanel } from '../../_components/CharacterPanel';
import { GameWindow } from '../../_components/GameWindow';

export default function Play() {
  const router = useRouter();
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId;

  const [character, setCharacter] = useState<CharacterDetail | null>(null);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [selected, setSelected] = useState<Marker | null>(null);
  const [hunt, setHunt] = useState<HuntView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const detail = await api<CharacterDetail>(`/api/characters/${characterId}`);
    setCharacter(detail);
    return detail;
  }, [characterId]);

  const load = useCallback(() => {
    setFailed(false);
    return Promise.all([refresh(), api<AtlasData>('/api/atlas')])
      .then(([, world]) => setAtlas(world))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) router.replace('/');
        else if (cause instanceof ApiError && cause.status === 404) router.replace('/characters');
        // Anything else is a failure the PLAYER can act on, so it is shown
        // with a way to act on it. A spinner that never resolves is the worst
        // of both: no information and no way forward.
        else setFailed(true);
      });
  }, [refresh, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape deselects, wherever focus happens to be. Scoping this to the SVG
  // meant Escape did nothing once focus moved into the details sheet, which is
  // exactly where a player would press it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null);
        setHunt(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function select(marker: Marker | null) {
    setSelected(marker);
    setHunt(null);
    if (!marker) return;
    try {
      setHunt(await api<HuntView>(`/api/hunts/${encodeURIComponent(marker.target)}`));
    } catch {
      setError('Could not load that location.');
    }
  }

  async function enter() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/characters/${characterId}/hunt`, {
        method: 'POST',
        // One key per CLICK. A retry of this submission replays the server's
        // own answer instead of racing the occupancy claim; the next
        // deliberate entry mints a new one and genuinely runs.
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ huntKey: selected.target }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not enter.');
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <main className="shell">
        <section className="panel stack" data-testid="load-error" role="alert">
          <h2>The world did not load</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Nothing was lost — your character is safe on the server. Try again.
          </p>
          <div className="row">
            <button className="primary" data-testid="retry" onClick={() => void load()}>
              Retry
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!character) {
    return (
      <main className="shell">
        <div className="panel skeleton" aria-busy="true" />
      </main>
    );
  }

  // The server says the character is in a Hunt, so that is the screen — and
  // in Phase 2 that screen is the GAME WINDOW. The Atlas is a different
  // surface with a different job (UI_SURFACE_ARCHITECTURE.md §1, §2); it is
  // not hidden behind a tab here, it is simply not where the Character is.
  if (character.activity) {
    return (
      <main className="shell stack">
        <CharacterPanel character={character} />
        <GameWindow
          characterId={characterId}
          label={character.activity.hunt.label}
          summary={`${character.activity.hunt.summary} · Primary creature: ${character.activity.hunt.primaryCreature}`}
          onEnded={async () => {
            // Ask the server which screen this is now, rather than assuming
            // the Atlas: the run may have ended for a reason this client did
            // not cause.
            await refresh();
            setSelected(null);
            setHunt(null);
          }}
        />
      </main>
    );
  }

  return (
    <main className="shell stack">
      <div className="world">
        <div className="stack">
          {atlas ? (
            <Atlas data={atlas} selected={selected} onSelect={select} />
          ) : (
            <div className="skeleton" aria-busy="true" />
          )}
        </div>
        <div className="stack">
          <CharacterPanel character={character} />
          {selected ? (
            <section className="sheet floating stack" data-testid="hunt-details">
              <h2>{hunt?.label ?? selected.label}</h2>
              {hunt ? (
                <>
                  <p className="muted small" style={{ margin: 0 }}>
                    {hunt.summary}
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    Primary creature: <strong>{hunt.primaryCreature}</strong>
                  </p>
                </>
              ) : (
                <p className="muted small">Loading…</p>
              )}
              {error ? (
                <p className="error small" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="row">
                <button className="primary" onClick={enter} disabled={busy} data-testid="enter">
                  {busy ? 'Entering…' : 'Enter hunt'}
                </button>
                <button onClick={() => select(null)}>Close</button>
              </div>
            </section>
          ) : (
            <section className="panel">
              <p className="muted small" style={{ margin: 0 }}>
                Select a marker on the Atlas to see what is there.
              </p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
