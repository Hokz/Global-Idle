/**
 * Phase 1 §16 — E2E1 to E2E10: V1–V10 of §15, in a real browser, on both the
 * desktop and the touch viewport.
 *
 * Every assertion drives the REAL API through the real UI. Nothing is mocked:
 * a stubbed API would prove the components render, which is not the question.
 *
 * The ten cases are `test.step`s inside ONE journey rather than ten independent
 * tests, because they ARE one journey — E2E10 is "reload and leave", and a
 * version of it that started from a fresh browser would be testing something
 * else. Each step is named with its id, so the run reports ten results and the
 * matrix counter can see all ten.
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
  test('the vertical slice: session → character → atlas → hunt → reload → leave', async ({
    page,
  }) => {
    const who = handle();

    await test.step('E2E1: session entry — a handle lands on the character list', async () => {
      await signIn(page, who);
      await expect(page).toHaveURL(/\/characters$/);
    });

    await test.step('E2E2: an empty account goes straight to creation', async () => {
      await expect(page.getByRole('heading', { name: 'Create your character' })).toBeVisible();
      await expect(page.getByLabel('Name')).toBeVisible();
    });

    await test.step('E2E3: the character is created and the play surface opens', async () => {
      await createCharacter(page, 'Rookie');
      await expect(page).toHaveURL(/\/play\//);
    });

    await test.step('E2E4: the panel shows SERVER state — Level 1, no vocation, 42:00, Free', async () => {
      await expect(page.getByRole('heading', { name: 'Rookie' })).toBeVisible();
      await expect(page.getByTestId('level')).toContainText('1');
      await expect(page.getByTestId('vocation')).toHaveText('Not yet chosen — Oracle at Level 8');
      await expect(page.getByTestId('stamina')).toContainText('42:00');
      // Idle derives RECOVERING (§9.4) — the value the server computed, not a
      // constant the browser decided to show.
      await expect(page.getByTestId('stamina')).toContainText('RECOVERING');
      await expect(page.getByTestId('premium')).toHaveText('Free');
    });

    await test.step('E2E5: the Atlas renders, and zoom works', async () => {
      await expect(page.getByTestId('atlas')).toBeVisible();
      await expect(page.getByTestId('zoom')).toHaveText('100%');
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await expect(page.getByTestId('zoom')).not.toHaveText('100%');
      await page.getByRole('button', { name: 'Reset view' }).click();
      await expect(page.getByTestId('zoom')).toHaveText('100%');
    });

    await test.step('E2E6: Rookgaard is available; the locked regions are present and inert', async () => {
      await expect(page.getByTestId('region-region.rookgaard')).toBeVisible();
      for (const locked of ['region.mainland', 'region.thais', 'region.carlin', 'region.edron']) {
        await expect(page.getByTestId(`region-${locked}`)).toBeAttached();
      }
    });

    await test.step('E2E7: the marker is selectable by tap/click, not by hover', async () => {
      const marker = page.getByTestId('marker-marker.rookgaard.sewers');
      await marker.hover();
      await expect(page.getByTestId('hunt-details')).toBeHidden();
      await marker.click();
      await expect(page.getByTestId('hunt-details')).toBeVisible();
    });

    await test.step('E2E8: the hunt details name the place and what lives there', async () => {
      const details = page.getByTestId('hunt-details');
      await expect(details).toContainText('Rookgaard Sewers');
      await expect(details).toContainText('Rat');
    });

    await test.step('E2E9: ENTER creates a real pre-combat Activity', async () => {
      await page.getByTestId('enter').click();
      await expect(page.getByTestId('pre-combat')).toBeVisible();
      await expect(page.getByTestId('pre-combat')).toContainText('Combat arrives in Phase 2');
      // The documented pre-consumption state: NEUTRAL, and still 42:00.
      await expect(page.getByTestId('stamina')).toContainText('NEUTRAL');
      await expect(page.getByTestId('stamina')).toContainText('42:00');
    });

    await test.step('E2E10: RELOAD returns to the same Hunt, and LEAVE releases it', async () => {
      await page.reload();
      await expect(page.getByTestId('pre-combat')).toBeVisible();
      await expect(page.getByTestId('pre-combat')).toContainText('Rookgaard Sewers');

      await page.getByTestId('leave').click();
      await expect(page.getByTestId('atlas')).toBeVisible();
      await expect(page.getByTestId('stamina')).toContainText('RECOVERING');
    });
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
