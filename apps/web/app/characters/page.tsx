'use client';

/**
 * Character selection and creation (spec §5, V2 and V3).
 *
 * An empty account goes straight to creation rather than showing an empty list
 * with a button: the first thing a new player does is make a character.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api, type CharacterSummary } from '../_lib/api';

export default function Characters() {
  const router = useRouter();
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ characters: CharacterSummary[] }>('/api/characters')
      .then((data) => setCharacters(data.characters))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) router.replace('/');
        else setError('Could not load characters.');
      });
  }, [router]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<CharacterSummary>('/api/characters', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      router.push(`/play/${created.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create the character.');
      setBusy(false);
    }
  }

  if (characters === null) {
    return (
      <main className="shell">
        <div className="panel muted">Loading…</div>
      </main>
    );
  }

  return (
    <main className="shell stack">
      {characters.length > 0 ? (
        <section className="panel stack" aria-labelledby="roster">
          <h2 id="roster">Your characters</h2>
          {characters.map((character) => (
            <button key={character.id} onClick={() => router.push(`/play/${character.id}`)}>
              {character.name} — Level {character.baseLevel} ·{' '}
              {character.vocation ?? 'no vocation yet'}
            </button>
          ))}
        </section>
      ) : (
        <section className="panel stack" aria-labelledby="create">
          <div>
            <h2 id="create">Create your character</h2>
            <p className="muted small">
              Your first character begins at Level 1 in Rookgaard. A vocation is chosen later, at
              the Oracle.
            </p>
          </div>
          <form className="field" onSubmit={create}>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
            {error ? (
              <p className="error small" role="alert">
                {error}
              </p>
            ) : null}
            <button className="primary" type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
