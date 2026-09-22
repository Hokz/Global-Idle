/**
 * Phase 2 §12 — GW1 to GW8. The first Game Window, in a real browser.
 *
 * Every case runs twice: once on the desktop viewport and once on the touch
 * one (playwright.config.ts), because "desktop and touch" is what §12 asks for
 * and a 390-wide layout is where a five-column readout row goes wrong.
 *
 * What these cases are about is the SURFACE: that it is separate from the
 * Atlas, that it shows what the server said and nothing it made up, that it
 * survives a reload and a lost connection, and that it offers no way to fight.
 * The SIMULATION is proven by SIM, and the server's lifecycle by CX and DE —
 * those are not re-litigated through a browser.
 */
import { expect, test } from '@playwright/test';
import { connect, enterHunt, play, runOf } from './support';

test.describe('§12 GW — the Game Window', () => {
  test('GW1: the Atlas leads to the Hunt, and the Game Window is a separate surface', async ({
    page,
  }) => {
    await play(page);

    // Before: world NAVIGATION. The Atlas is where you could go.
    await expect(page.getByTestId('atlas')).toBeVisible();
    await expect(page.getByTestId('game-window')).toHaveCount(0);

    await enterHunt(page);

    // After: the Game Window is where you ARE — and the Atlas is not part of
    // it. `Atlas != Game Window` is an architectural rule
    // (UI_SURFACE_ARCHITECTURE.md §2), so it is asserted as one.
    await expect(page.getByTestId('game-window')).toBeVisible();
    await expect(page.getByTestId('atlas')).toHaveCount(0);
    await expect(page.getByTestId('scene')).toBeVisible();
    await expect(page.getByTestId('room')).toContainText('Room 1');
    await expect(page.getByTestId('connection')).toHaveAttribute(
      'data-connection',
      'ONLINE_ACTIVE',
    );

    // Everything §10 asks the window to show, all of it the server's.
    await expect(page.getByTestId('character-health')).toContainText('150 / 150');
    await expect(page.getByTestId('run-stamina')).toHaveAttribute('data-mode', 'NEUTRAL');
    await expect(page.getByTestId('run-stamina')).toContainText('42:00');
    await expect(page.getByTestId('session-xp')).toHaveText('0');
    // The CARRIED total, which is the number at risk — and the run's own
    // earnings beside it. They start equal and stop being equal the moment a
    // Character carries anything in from an earlier Hunt.
    await expect(page.getByTestId('pouch-gold')).toContainText('0');
    await expect(page.getByTestId('session-gold')).toContainText('0 this run');
    await expect(page.getByTestId('base-level')).toContainText('1');
    await expect(page.getByTestId('base-xp')).toContainText('0 / 100');
    await expect(page.getByTestId('supplies')).toContainText('20');
    await expect(page.getByTestId('supply-warning')).toHaveCount(0);
  });

  test('GW2: combat happens on its own, and the window shows it', async ({ page }) => {
    await play(page);
    await enterHunt(page);

    // A Rat is there, at full health, because the server spawned one.
    const creature = page.getByTestId('creature').first();
    await expect(creature).toBeVisible();
    await expect(creature).toContainText('/ 20');

    // Nothing is pressed. The log fills because the server is fighting.
    const events = page.getByTestId('events');
    await expect(events.locator('li')).not.toHaveCount(0, { timeout: 20_000 });
    const first = await events.innerText();

    await expect.poll(async () => events.innerText(), { timeout: 20_000 }).not.toBe(first);

    // And the numbers on the scene are moving with it: either the Rat has
    // taken damage or the Character has. Both are the server's.
    await expect
      .poll(
        async () => {
          const rat = await creature.innerText();
          const self = await page.getByTestId('character-health').innerText();
          return `${rat}|${self}`;
        },
        { timeout: 30_000 },
      )
      .not.toBe(`${await creature.innerText()}|150 / 150`);

    // Health is never invented by the client: it is always "n / max".
    await expect(page.getByTestId('character-health')).toContainText('/ 150');
  });

  test('GW3: the room number and the room-10 cycle come from the server', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('cycle')).toHaveCount(0);

    const prisma = connect();
    try {
      const run = await runOf(prisma, characterId);
      // Forty minutes of Hunt, arranged rather than waited for; see support.ts.
      await prisma.huntRun.update({
        where: { activityId: run.activityId },
        data: { room: 10, cycle: 3, creatures: [] },
      });

      await expect(page.getByTestId('room')).toContainText('Room 10', { timeout: 15_000 });
      await expect(page.getByTestId('cycle')).toContainText('cycle 3');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('GW4: a reload returns to the same run', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);

    // Let the server get somewhere first, so "the same run" is a claim with
    // content in it.
    await expect(page.getByTestId('events').locator('li')).not.toHaveCount(0, { timeout: 20_000 });

    const prisma = connect();
    try {
      const before = await runOf(prisma, characterId);

      await page.reload();

      // The window comes back because the ROW says the Character is hunting —
      // not because the URL, a cookie or anything in this browser remembered.
      await expect(page.getByTestId('game-window')).toBeVisible();
      await expect(page.getByTestId('room')).toContainText(`Room ${before.room}`);
      await expect(page.getByTestId('character-health')).toContainText('/ 150');

      const after = await runOf(prisma, characterId);
      expect(after.activityId).toBe(before.activityId);
      expect(after.tick).toBeGreaterThanOrEqual(before.tick);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('GW5: losing the connection is visible, and says what happens next', async ({ page }) => {
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('events').locator('li')).not.toHaveCount(0, { timeout: 20_000 });

    // The connection goes away. The window must not tear itself down or
    // pretend combat is still resolving: the run is held on the server, and
    // the player is told so.
    await page.route('**/api/characters/*/hunt', (route) => route.abort('failed'));
    await expect(page.getByTestId('poll-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('poll-error')).toContainText('five minutes');

    // The window is still a window: the last state the server gave is still
    // on screen rather than replaced by a spinner.
    await expect(page.getByTestId('scene')).toBeVisible();
    await expect(page.getByTestId('room')).toBeVisible();

    // And when the SERVER is the one reporting the pause — which is what a
    // sweep or a second session sees — the badge says so, with the deadline
    // the server set. The response is shaped here rather than waited for,
    // because a client that is reading is by definition connected and its own
    // read resumes the run; CX3 to CX5 own that behaviour server-side.
    await page.unroute('**/api/characters/*/hunt');
    await page.route('**/api/characters/*/hunt', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        json: {
          ...body,
          connection: 'RECONNECT_GRACE_PAUSED',
          graceExpiresAt: new Date(Date.now() + 240_000).toISOString(),
        },
      });
    });
    await expect(page.getByTestId('connection')).toHaveAttribute(
      'data-connection',
      'RECONNECT_GRACE_PAUSED',
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('connection')).toContainText('Reconnecting');
  });

  test('GW6: the connection coming back resumes the same run', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('events').locator('li')).not.toHaveCount(0, { timeout: 20_000 });

    const prisma = connect();
    try {
      const before = await runOf(prisma, characterId);

      await page.route('**/api/characters/*/hunt', (route) => route.abort('failed'));
      await expect(page.getByTestId('poll-error')).toBeVisible({ timeout: 15_000 });

      await page.unroute('**/api/characters/*/hunt');

      // Back to Live, on the SAME run: the room and the totals continue from
      // where they were rather than restarting.
      await expect(page.getByTestId('poll-error')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('connection')).toHaveAttribute(
        'data-connection',
        'ONLINE_ACTIVE',
      );

      const after = await runOf(prisma, characterId);
      expect(after.activityId).toBe(before.activityId);
      expect(after.tick).toBeGreaterThanOrEqual(before.tick);
      expect(after.endedReason).toBeNull();
      await expect(page.getByTestId('room')).toContainText(`Room ${after.room}`);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('GW7: Leave ends the run and returns to the Atlas', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);

    await page.getByTestId('leave').click();

    // Back to world navigation, because the server says the Character is no
    // longer in an Activity — not because the button navigated.
    await expect(page.getByTestId('atlas')).toBeVisible();
    await expect(page.getByTestId('game-window')).toHaveCount(0);

    const prisma = connect();
    try {
      expect(await prisma.occupancyClaim.findUnique({ where: { characterId } })).toBeNull();
      const run = await prisma.huntRun.findFirstOrThrow({ where: { characterId } });
      expect(run.endedReason).toBe('LEFT');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('GW8: death is shown, with a way back — and there is never a way to fight', async ({
    page,
  }) => {
    const characterId = await play(page);
    await enterHunt(page);

    // There is NO combat input on this surface, and there must not be: no
    // WASD, no attack, no click-to-move. The Character controls itself.
    const buttons = await page.getByTestId('game-window').getByRole('button').allInnerTexts();
    expect(buttons.map((label) => label.toLowerCase()).join(' ')).not.toMatch(
      /attack|move|fight|cast|target/,
    );
    await page.keyboard.press('KeyW');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('game-window')).toBeVisible();

    // This guard MOVES FORWARD with the code rather than being deleted. It
    // named Phase 3's itemization while Phase 3 had not happened; Phase 3 has
    // happened, and the Game Window now legitimately shows a Loot Pouch. So it
    // refuses the NEXT phases' vocabulary instead: Phase 4's party and
    // vocation progression, and Phase 7's Forge and Bestiary. What the case
    // asserts is unchanged — the Hunt surface does not ship a later phase.
    const text = (await page.getByTestId('game-window').innerText()).toLowerCase();
    for (const forbidden of [
      'party',
      'shared xp',
      'promotion',
      'skill tree',
      'forge',
      'imbuement',
      'bestiary',
      'charm',
      'auto-sell',
    ]) {
      expect(text, `a later phase's vocabulary leaked: ${forbidden}`).not.toContain(forbidden);
    }

    const prisma = connect();
    try {
      // Ninety minutes of hunting, arranged; see support.ts. The engine still
      // decides that the next hit is fatal.
      const run = await runOf(prisma, characterId);
      await prisma.huntRun.update({
        where: { activityId: run.activityId },
        data: { characterHealth: 1, supplyCharges: 0 },
      });

      const ended = page.getByTestId('ended');
      await expect(ended).toBeVisible({ timeout: 60_000 });
      await expect(ended).toHaveAttribute('data-reason', 'DIED');
      await expect(ended).toContainText('You have died');

      // WHAT IT COST, said plainly. Two numbers going down without an
      // explanation is how a player concludes the game ate their gold.
      await expect(page.getByTestId('penalty')).toBeVisible();
      await expect(page.getByTestId('penalty-xp')).toContainText('experience');
      await expect(page.getByTestId('penalty-gold')).toContainText(/pouch|blessings/);
      // The Pouch is gone with it: this Character had no blessings.
      await expect(page.getByTestId('pouch-gold')).toContainText('0');
      await expect(page.getByTestId('connection')).toHaveAttribute(
        'data-connection',
        'ACTIVITY_ENDED',
      );
      // The run is over on the server too, and the claim is released.
      await expect
        .poll(
          async () =>
            (await prisma.huntRun.findFirstOrThrow({ where: { characterId } })).endedReason,
          {
            timeout: 15_000,
          },
        )
        .toBe('DIED');
      expect(await prisma.occupancyClaim.findUnique({ where: { characterId } })).toBeNull();

      // And there is a way out of it.
      await page.getByTestId('back-to-atlas').click();
      await expect(page.getByTestId('atlas')).toBeVisible();
    } finally {
      await prisma.$disconnect();
    }
  });
});
