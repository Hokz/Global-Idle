'use client';

/**
 * Session entry (spec §3, V1).
 *
 * The handle is a DEV/TEST credential with no secret — see the notice below,
 * which is on the screen on purpose. Phase 1 is not production-deployable.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from './_lib/api';

export default function SessionEntry() {
  const router = useRouter();
  const [handle, setHandle] = useState('Reviewer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Until React has hydrated, the submit handler does not exist and the form
   * would POST natively — a confusing no-op for a person and an invisible
   * flake for a test. Both get the same fix: the button is not offered until
   * it works.
   */
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/session', { method: 'POST', body: JSON.stringify({ handle }) });
      router.push('/characters');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <main className="shell stack">
      <div className="panel stack">
        <div>
          <h1>Global Idle</h1>
          <p className="muted small">Phase 1 — World / Character vertical slice</p>
        </div>

        <form className="field" onSubmit={signIn}>
          <label htmlFor="handle">Handle</label>
          <input
            id="handle"
            name="handle"
            value={handle}
            autoComplete="off"
            onChange={(event) => setHandle(event.target.value)}
          />
          {error ? (
            <p className="error small" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary" type="submit" disabled={busy || !ready} data-ready={ready}>
            {busy ? 'Signing in…' : 'Enter'}
          </button>
        </form>

        <p className="muted small">
          <strong>Development sign-in.</strong> A handle is not a credential — there is no password
          and no verification. This exists so the slice can be played and tested; real
          authentication is a later phase.
        </p>
      </div>
    </main>
  );
}
