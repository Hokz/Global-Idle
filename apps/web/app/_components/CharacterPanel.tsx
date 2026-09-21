/**
 * The character panel (spec §6, V4).
 *
 * Every value here came from the server. The browser formats; it does not
 * compute, and it does not tick a Stamina countdown — a client-side clock
 * would be the browser inventing authoritative state.
 */
import type { CharacterDetail } from '../_lib/api';
import { asset } from '../_lib/assets';

const hhmm = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function CharacterPanel({ character }: { character: CharacterDetail }) {
  const portrait = asset('portrait.character');
  return (
    <section className="panel stack" aria-labelledby="character-heading">
      <div className="row">
        <svg width="56" height="56" role="img" aria-label="Character portrait placeholder">
          <rect
            width="56"
            height="56"
            rx="8"
            fill={portrait.fill}
            stroke={portrait.stroke}
            strokeWidth="2"
          />
        </svg>
        <div>
          <h2 id="character-heading" style={{ marginBottom: 2 }}>
            {character.name}
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Level {character.baseLevel}
          </p>
        </div>
      </div>

      <dl style={{ margin: 0 }}>
        <div className="stat">
          <dt>Vocation</dt>
          <dd data-testid="vocation">
            {character.vocation ?? 'Not yet chosen — Oracle at Level 8'}
          </dd>
        </div>
        <div className="stat">
          <dt>Stamina</dt>
          <dd data-testid="stamina">
            {hhmm(character.stamina.remainingMs)} / {hhmm(character.stamina.maxMs)}{' '}
            <span className="muted small">{character.stamina.mode}</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Account</dt>
          <dd data-testid="premium">{character.premium ? 'Premium' : 'Free'}</dd>
        </div>
        <div className="stat">
          <dt>Where</dt>
          <dd data-testid="where">
            {character.activity ? character.activity.hunt.label : 'Rookgaard'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
