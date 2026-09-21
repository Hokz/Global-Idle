'use client';

/**
 * The play surface: panel + Atlas, or the pre-combat Hunt (spec §6, §7, §9).
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

export default function Play() {
  const router = useRouter();
  const params = useParams<{ characterId: string }>();
  const characterId = params.characterId;

  const [character, setCharacter] = useState<CharacterDetail | null>(null);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [selected, setSelected] = useState<Marker | null>(null);
  const [hunt, setHunt] = useState<HuntView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const detail = await api<CharacterDetail>(`/api/characters/${characterId}`);
    setCharacter(detail);
    return detail;
  }, [characterId]);

  useEffect(() => {
    Promise.all([refresh(), api<AtlasData>('/api/atlas')])
      .then(([, world]) => setAtlas(world))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) router.replace('/');
        else if (cause instanceof ApiError && cause.status === 404) router.replace('/characters');
        else setError('Could not load the world.');
      });
  }, [refresh, router]);

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
        body: JSON.stringify({ huntKey: selected.target }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not enter.');
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await api(`/api/characters/${characterId}/activity`, { method: 'DELETE' });
      await refresh();
      setSelected(null);
      setHunt(null);
    } finally {
      setBusy(false);
    }
  }

  if (!character) {
    return (
      <main className="shell">
        <div className="panel skeleton" aria-busy="true" />
      </main>
    );
  }

  // The server says the character is in a Hunt, so that is the screen.
  if (character.activity) {
    return (
      <main className="shell stack">
        <CharacterPanel character={character} />
        <section className="panel stack" data-testid="pre-combat" aria-labelledby="hunt-heading">
          <div>
            <h2 id="hunt-heading">{character.activity.hunt.label}</h2>
            <p className="muted small">
              {character.activity.hunt.summary} · Primary creature:{' '}
              {character.activity.hunt.primaryCreature}
            </p>
          </div>
          <div
            className="panel"
            style={{ background: '#14161a', textAlign: 'center', padding: '40px 16px' }}
          >
            <p style={{ margin: 0 }}>Your character is in the hunt.</p>
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Combat arrives in Phase 2. Stamina is {character.stamina.mode} and has not started
              being spent.
            </p>
          </div>
          <div className="row">
            <button onClick={leave} disabled={busy} data-testid="leave">
              {busy ? 'Leaving…' : 'Leave hunt'}
            </button>
            <span className="muted small">Activity {character.activity.state}</span>
          </div>
        </section>
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
