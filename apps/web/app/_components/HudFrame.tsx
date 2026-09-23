'use client';

/**
 * The HUD grammar (Phase 3.7 spec §7).
 *
 * Centred Game Window, panels at the sides, log below — the shape a Tibia
 * player recognises, built as fresh HTML and CSS. The Qt RCC images in the
 * private reference were INSPIRATION and are not a runtime dependency: nothing
 * here loads an image at all, so a public build looks exactly like this.
 *
 * WHAT IT SHOWS IS WHAT THE SERVER SAID. Name, level, vocation and Stamina come
 * from the character the server returned. Where a system does not exist yet —
 * mana, action slots, an automation profile — the panel says so in words
 * instead of inventing a number. A fabricated stat is worse than an empty one:
 * an empty panel is honest about Phase 4 not being here, and a fake one is a
 * promise the game cannot keep.
 */
import type { ReactNode } from 'react';
import type { CharacterDetail } from '../_lib/api';

export interface HudFrameProps {
  readonly character: CharacterDetail;
  /** The Game Window, centred. */
  readonly children: ReactNode;
  /** Opens the Atlas surface. Presentation only — it starts nothing. */
  readonly onOpenAtlas?: () => void;
}

/** A panel that exists so the grammar is complete, and says why it is empty. */
function DormantPanel({
  title,
  reason,
  testId,
  slots = 0,
}: {
  title: string;
  reason: string;
  testId: string;
  slots?: number;
}) {
  return (
    <section className="hud-panel" data-testid={testId} data-dormant="true">
      <h3>
        {title} <em className="hud-panel__tag">inactive</em>
      </h3>
      {slots > 0 ? (
        <div className="hud-slots" aria-hidden="true">
          {Array.from({ length: slots }, (_, index) => (
            <span className="hud-slot" key={index} />
          ))}
        </div>
      ) : null}
      <p className="hud-panel__reason">{reason}</p>
    </section>
  );
}

export function HudFrame({ character, children, onOpenAtlas }: HudFrameProps) {
  // The server's own numbers, converted for DISPLAY and nothing else. The
  // fields are `remainingMs`, `maxMs` and `mode`; a percentage and an hour
  // count are how those read to a person, not new facts about the character.
  const stamina = character.stamina;
  const remainingPercent =
    stamina.maxMs > 0 ? Math.max(0, Math.min(100, (stamina.remainingMs / stamina.maxMs) * 100)) : 0;
  const remainingHours = Math.floor(stamina.remainingMs / 3_600_000);

  return (
    <div className="hud" data-testid="hud">
      <aside className="hud-column hud-column--left">
        <section className="hud-panel" data-testid="hud-skills">
          <h3>Skills</h3>
          <dl className="hud-stats">
            <dt>Name</dt>
            <dd data-testid="hud-name">{character.name}</dd>
            <dt>Level</dt>
            <dd data-testid="hud-level">{character.baseLevel}</dd>
            <dt>Vocation</dt>
            <dd>{character.vocation ?? 'None'}</dd>
          </dl>
          <p className="hud-panel__reason">
            Combat skills are not a Phase 3.7 surface; these are the character fields the server
            already returns.
          </p>
        </section>

        <DormantPanel
          title="Equipment"
          testId="hud-equipment"
          slots={6}
          reason="Worn items are shown on the System surface. Wiring them here is presentation work this phase did not take on."
        />
      </aside>

      <div className="hud-centre">
        <section className="hud-vitals" data-testid="hud-vitals">
          <div className="hud-bar" data-testid="hud-stamina">
            <span
              className="hud-bar__fill hud-bar__fill--stamina"
              style={{ width: `${remainingPercent}%` }}
            />
            <span className="hud-bar__label">
              Stamina {remainingHours}h · {stamina.mode.toLowerCase()}
            </span>
          </div>
          <div className="hud-bar hud-bar--dormant" data-testid="hud-mana">
            <span className="hud-bar__label">Mana — no mana system in this phase</span>
          </div>
        </section>

        {children}

        <section className="hud-log" data-testid="hud-log">
          <h3>Server Log</h3>
          <p className="hud-panel__reason">
            The Game Window above carries the authoritative event feed. This panel is the place it
            will move to; it invents no line of its own.
          </p>
        </section>
      </div>

      <aside className="hud-column hud-column--right">
        <section className="hud-panel" data-testid="hud-atlas">
          <h3>Atlas</h3>
          <button
            type="button"
            onClick={onOpenAtlas}
            disabled={!onOpenAtlas}
            data-testid="hud-atlas-open"
          >
            Open World Atlas
          </button>
          <p className="hud-panel__reason">
            Navigation only. Available between hunts — the Character is somewhere right now, and the
            server decides where.
          </p>
        </section>

        <DormantPanel
          title="Battle List"
          testId="hud-battle-list"
          reason="Creatures in range are drawn in the Game Window. A separate list would be a second reading of the same server state, so it stays empty until it is wired to that one."
        />
        <DormantPanel
          title="Backpack"
          testId="hud-backpack"
          slots={6}
          reason="Containers and loot routing live on the System surface, which is where Phase 3 verified them."
        />
        <DormantPanel
          title="Actions"
          testId="hud-actions"
          slots={4}
          reason="Automation slots are a Phase 4 system. These are empty boxes, not disabled buttons: there is nothing behind them to enable."
        />
      </aside>
    </div>
  );
}
