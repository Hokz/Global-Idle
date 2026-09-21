/**
 * E2E1-E2E10 — the Phase 1 vertical slice in a real browser (spec §15).
 *
 * Every assertion drives the REAL API through the real UI. Nothing is mocked:
 * a stubbed API would prove the components render, which is not the question.
 */
import { expect, test, type Page } from '@playwright/test';

const handle = () => `E2E${Math.random().toString(36).slice(2, 8)}`;

async function signIn(page: Page, who: string) {
  await page.goto('/');
  // The button is disabled until React has hydrated, so waiting for it to be
  // enabled is waiting for the handler to exist — not an arbitrary sleep.
  const enter = page.getByRole('button', { name: 'Enter' });
  await expect(enter).toBeEnabled();
  await page.getByLabel('Handle').fill(who);
  await enter.click();
  await page.waitForURL('**/characters');
}

async function createCharacter(page: Page, name: string) {
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL('**/play/**');
}

test.describe('Phase 1 vertical slice', () => {
  test('E2E1-E2E10: session -> character -> atlas -> hunt -> reload -> leave', async ({ page }) => {
    const who = handle();

    // E2E1 — session entry
    await signIn(page, who);

    // E2E2 — an empty account goes straight to creation
    await expect(page.getByRole('heading', { name: 'Create your character' })).toBeVisible();

    // E2E3 — the character exists and we land on the play surface
    await createCharacter(page, 'Rookie');

    // E2E4 — the panel shows SERVER state: Level 1, no vocation, 42:00, Free
    await expect(page.getByRole('heading', { name: 'Rookie' })).toBeVisible();
    await expect(page.getByTestId('vocation')).toHaveText('Not yet chosen — Oracle at Level 8');
    await expect(page.getByTestId('stamina')).toContainText('42:00');
    await expect(page.getByTestId('premium')).toHaveText('Free');

    // E2E5 — the Atlas renders and zoom works
    const atlas = page.getByTestId('atlas');
    await expect(atlas).toBeVisible();
    await expect(page.getByTestId('zoom')).toHaveText('100%');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByTestId('zoom')).not.toHaveText('100%');
    await page.getByRole('button', { name: 'Reset view' }).click();

    // E2E6 — Rookgaard is available; the locked regions are present and inert
    await expect(page.getByTestId('region-region.rookgaard')).toBeVisible();
    await expect(page.getByTestId('region-region.mainland')).toBeVisible();

    // E2E7 — the marker is selectable by TAP/CLICK, not hover
    await page.getByTestId('marker-marker.rookgaard.sewers').click();

    // E2E8 — hunt details
    const details = page.getByTestId('hunt-details');
    await expect(details).toBeVisible();
    await expect(details).toContainText('Rookgaard Sewers');
    await expect(details).toContainText('Rat');

    // E2E9 — ENTER creates a real pre-combat Activity
    await page.getByTestId('enter').click();
    await expect(page.getByTestId('pre-combat')).toBeVisible();
    await expect(page.getByTestId('pre-combat')).toContainText('Combat arrives in Phase 2');
    // The documented pre-consumption state: NEUTRAL, and still 42:00.
    await expect(page.getByTestId('stamina')).toContainText('NEUTRAL');
    await expect(page.getByTestId('stamina')).toContainText('42:00');

    // E2E10a — RELOAD returns to the same Hunt, from durable server state
    await page.reload();
    await expect(page.getByTestId('pre-combat')).toBeVisible();
    await expect(page.getByTestId('pre-combat')).toContainText('Rookgaard Sewers');

    // E2E10b — LEAVE releases the claim and returns to the Atlas
    await page.getByTestId('leave').click();
    await expect(page.getByTestId('atlas')).toBeVisible();
    await expect(page.getByTestId('stamina')).toContainText('RECOVERING');
  });

  test('no Phase 2 gameplay is present on the pre-combat surface', async ({ page }) => {
    const who = handle();
    await signIn(page, who);
    await createCharacter(page, 'Scout');
    await page.getByTestId('marker-marker.rookgaard.sewers').click();
    await page.getByTestId('enter').click();
    await expect(page.getByTestId('pre-combat')).toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const forbidden of ['xp', 'damage', 'loot', 'gold', 'room ', 'supplies']) {
      expect(body, `Phase 2 vocabulary leaked: ${forbidden}`).not.toContain(forbidden);
    }
    await page.getByTestId('leave').click();
  });
});
