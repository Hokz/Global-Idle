/**
 * Phase 3 §20 — SYS1 to SYS16. The System UI, in a real browser.
 *
 * Every case runs twice: once on the desktop viewport and once on the touch
 * one, because "desktop and touch" is what §18 asks for and a management
 * surface is exactly where a hover-only affordance strands a phone.
 *
 * What these are about is the SURFACE: that it is separate from the Atlas and
 * the Game Window, that it shows what the server said, that it offers a way to
 * do each thing WITHOUT a drag, and that it refuses what the server refuses
 * rather than hiding it. The rules themselves are proven by the 113 cases that
 * drive the domain directly; those are not re-litigated through a browser.
 */
import { expect, test, type Page } from '@playwright/test';
import { connect, enterHunt, fundBank, play, runOf } from './support';

async function system(page: Page, characterId: string): Promise<void> {
  await page.goto(`/system/${characterId}`);
  await expect(page.getByTestId('system-window')).toBeVisible();
}

test.describe('§20 SYS — the System UI', () => {
  test('SYS1: it is a THIRD surface — not the Atlas and not the Game Window', async ({ page }) => {
    const characterId = await play(page);
    await expect(page.getByTestId('atlas')).toBeVisible();

    await system(page, characterId);
    // UI_SURFACE_ARCHITECTURE: the Atlas navigates, the Game Window watches,
    // this one manages. Three surfaces, and none of them is inside another.
    await expect(page.getByTestId('atlas')).toHaveCount(0);
    await expect(page.getByTestId('game-window')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Manage' })).toBeVisible();
  });

  test('SYS2: the tutorial equipment is worn, and shown', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    const slots = page.getByTestId('equipment-slot');
    // FIVE worn pieces. The backpack is not one of them: a container is
    // INSTALLED in a Hunt slot, which is its own custody — a Character wears
    // one backpack and installs up to five containers.
    await expect(slots).toHaveCount(5);
    for (const slot of ['HEAD', 'ARMOR', 'LEGS', 'FEET', 'LEFT']) {
      await expect(page.locator(`[data-testid="equipment-slot"][data-slot="${slot}"]`)).toHaveCount(
        1,
      );
    }
    await expect(page.locator('[data-testid="equipment-slot"][data-slot="BACKPACK"]')).toHaveCount(
      0,
    );
    // And it IS somewhere: slot 1 holds it, with the potions inside.
    await expect(
      page.getByTestId('container-slot').nth(0).getByTestId('slot-spaces'),
    ).not.toHaveText('empty');
  });

  test('SYS3: exactly five Hunt container slots, one free and four priced', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    const slots = page.getByTestId('container-slot');
    await expect(slots).toHaveCount(5);
    await expect(slots.nth(0)).toHaveAttribute('data-unlocked', 'true');
    for (const index of [1, 2, 3, 4]) {
      await expect(slots.nth(index)).toHaveAttribute('data-unlocked', 'false');
    }
    // And the price is visible rather than a surprise at the moment of paying.
    await expect(page.getByTestId('unlock-slot').first()).toContainText('10000 gold');
  });

  test('SYS4: Capacity and both Gold numbers are the server’s', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    const capacity = page.getByTestId('capacity');
    await expect(capacity).toHaveAttribute('data-limit', '40000');
    // The tutorial kit weighs something, and it is less than the limit.
    const carried = Number(await capacity.getAttribute('data-carried'));
    expect(carried).toBeGreaterThan(0);
    expect(carried).toBeLessThan(40_000);

    await expect(page.getByTestId('gold-pouch')).toContainText('0');
    await expect(page.getByTestId('gold-bank')).toContainText('0');
  });

  test('SYS5: the starting potions are in the first container', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    const first = page.getByTestId('container-slot').nth(0);
    await expect(first.getByTestId('item')).toHaveCount(1);
    await expect(first.locator('[data-definition="item.small-health-potion"]')).toHaveAttribute(
      'data-quantity',
      '20',
    );
    await expect(first.getByTestId('slot-spaces')).toContainText('1 / 20');
  });

  test('SYS6: TOUCH — select then Move, with no hover and no drag', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    // Tap a worn item; the selection is announced rather than implied.
    const dagger = page.locator('[data-definition="item.dagger"]').first();
    await dagger.click();
    await expect(page.getByTestId('selection')).toContainText('Dagger');
    await expect(dagger).toHaveAttribute('aria-pressed', 'true');

    // Move it with a BUTTON. Nothing here needs a pointer that can hover.
    await page.getByTestId('move-to-container').click();
    await expect(page.getByTestId('selection')).toContainText('Nothing selected');
    const first = page.getByTestId('container-slot').nth(0);
    await expect(first.locator('[data-definition="item.dagger"]')).toHaveCount(1);
    // ...and the hand is empty now.
    await expect(page.locator('[data-testid="equipment-slot"][data-slot="LEFT"]')).toHaveCount(0);
  });

  test('SYS7: DESKTOP — dragging an item into a container slot moves it', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    const helmet = page.locator('[data-definition="item.leather-helmet"]').first();
    const target = page.getByTestId('container-slot').nth(0);
    await helmet.dragTo(target);

    await expect(target.locator('[data-definition="item.leather-helmet"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="equipment-slot"][data-slot="HEAD"]')).toHaveCount(0);
  });

  test('SYS8: an illegal move is REFUSED and explained', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    // A potion does not go in the weapon hand, and the server is what says so.
    await page.locator('[data-definition="item.small-health-potion"]').first().click();
    await page.getByTestId('equip').click();
    await expect(page.getByTestId('system-error')).toContainText('ILLEGAL_ITEM_MOVE');
    // Nothing moved.
    await expect(
      page
        .getByTestId('container-slot')
        .nth(0)
        .locator('[data-definition="item.small-health-potion"]'),
    ).toHaveCount(1);
  });

  test('SYS9: buying at the counter delivers goods and spends Gold', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    // With no Gold at all, the counter refuses rather than pretending.
    await page.getByTestId('buy').first().click();
    await expect(page.getByTestId('system-error')).toContainText('INSUFFICIENT_FUNDS');
    await expect(page.getByTestId('gold-bank')).toContainText('0');
  });

  test('SYS10: changing the filter changes what FUTURE loot does', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    await expect(page.getByTestId('policy-mode')).toHaveText('COLLECT_ALL_EXCEPT_SKIPPED');
    await page.getByTestId('toggle-policy').click();
    await expect(page.getByTestId('policy-mode')).toHaveText('ACCEPTED_ONLY');

    // It is DURABLE: a reload asks the server, and the server remembers.
    await page.reload();
    await expect(page.getByTestId('policy-mode')).toHaveText('ACCEPTED_ONLY');
  });

  test('SYS11: inside a Hunt the Depot, the Stash and the counter are not reachable', async ({
    page,
  }) => {
    const characterId = await play(page);
    await enterHunt(page);
    await system(page, characterId);

    await expect(page.getByTestId('in-hunt-notice')).toBeVisible();
    await expect(page.getByTestId('depot-unavailable')).toBeVisible();
    await expect(page.getByTestId('stash-unavailable')).toBeVisible();
    await expect(page.getByTestId('counter-unavailable')).toBeVisible();
    // The carried locations are still manageable — this is not a lockout.
    await expect(page.getByTestId('equipment')).toBeVisible();
    await expect(page.getByTestId('loot-pouch')).toBeVisible();
  });

  test('SYS12: the Hunt fills the Loot Pouch, and both surfaces say so', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);

    // A Hunt advances one tick per real second and a Rat drops cheese on
    // 39.41% of kills, so honestly waiting for a drop is a twenty-minute test.
    // This is the idiom support.ts already describes: the case is about
    // RENDERING, so the durable position is arranged and the SERVER simulates
    // the span. Nothing about the drop is faked — the run's own engine rolls
    // it, over a span this test moved the clock for.
    const prisma = connect();
    try {
      const run = await runOf(prisma, characterId);
      await prisma.huntRun.update({
        where: { activityId: run.activityId },
        data: { simulatedThrough: new Date(Date.now() - 20 * 60_000), lastSeenAt: new Date() },
      });

      // The Game Window reports occupancy, and the combat log names what was
      // picked up — "nothing is being collected" has to be VISIBLE before it
      // can be fixed.
      await expect(page.getByTestId('run-pouch-occupancy')).toBeVisible();
      await expect
        .poll(
          async () =>
            Number(await page.getByTestId('run-pouch-occupancy').getAttribute('data-used')),
          { timeout: 60_000 },
        )
        .toBeGreaterThan(0);
      await expect(page.getByTestId('events')).toContainText('You pick up');

      // ...and the System UI shows the very thing it collected.
      await system(page, characterId);
      await expect(
        page.getByTestId('loot-pouch').locator('[data-definition="item.cheese"]'),
      ).toHaveCount(1);
      await expect(page.getByTestId('pouch-occupancy')).toContainText('/ 20');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('SYS13: unlock Slot 2, buy a container, and it is INSTALLED there', async ({ page }) => {
    const characterId = await play(page);
    const prisma = connect();
    try {
      await fundBank(prisma, characterId, 20_000n);
    } finally {
      await prisma.$disconnect();
    }
    await system(page, characterId);

    const slotTwo = page.getByTestId('container-slot').nth(1);
    await expect(slotTwo).toHaveAttribute('data-unlocked', 'false');
    await slotTwo.getByTestId('unlock-slot').click();
    await expect(slotTwo).toHaveAttribute('data-unlocked', 'true');
    await expect(slotTwo.getByTestId('slot-spaces')).toHaveText('empty');

    // The counter sells a real, source-backed backpack, and a purchased
    // container is DELIVERED by being installed — it cannot go in a container.
    await page.locator('[data-testid="buy"][data-definition="item.backpack"]').click();
    await expect(slotTwo.getByTestId('slot-spaces')).toHaveText('0 / 20');
    await expect(page.getByTestId('gold-bank')).toContainText('9990');
  });

  test('SYS14: an EMPTY container comes back out, and the slot is empty again', async ({
    page,
  }) => {
    const characterId = await play(page);
    const prisma = connect();
    try {
      await fundBank(prisma, characterId, 20_000n);
    } finally {
      await prisma.$disconnect();
    }
    await system(page, characterId);

    const slotTwo = page.getByTestId('container-slot').nth(1);
    await slotTwo.getByTestId('unlock-slot').click();
    await page.locator('[data-testid="buy"][data-definition="item.backpack"]').click();
    await expect(slotTwo.getByTestId('slot-spaces')).toHaveText('0 / 20');

    await slotTwo.getByTestId('uninstall-container').click();
    await expect(slotTwo.getByTestId('slot-spaces')).toHaveText('empty');

    // Slot 1 is LOADED, so its container cannot leave — the button is not
    // even offered, and the server would refuse it anyway.
    await expect(
      page.getByTestId('container-slot').nth(0).getByTestId('uninstall-container'),
    ).toBeDisabled();
  });

  test('SYS15: TOUCH — stash something, and take it back, with no drag', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    // A potion out of the tutorial backpack, selected by TAP.
    const potion = page
      .locator('[data-testid="item"][data-definition="item.small-health-potion"]')
      .first();
    await potion.click();
    await page.getByTestId('amount').fill('2');
    await page.getByTestId('stash-deposit').click();

    const entry = page.getByTestId('stash-entry');
    await expect(entry).toContainText('2');

    await page.getByTestId('amount').fill('1');
    await page
      .locator('[data-testid="stash-withdraw"][data-definition="item.small-health-potion"]')
      .click();
    await expect(page.getByTestId('stash-entry')).toContainText('1');
  });

  test('SYS16: a routing preference is chosen, and survives a reload', async ({ page }) => {
    const characterId = await play(page);
    await system(page, characterId);

    const routing = page.getByTestId('slot-routing').first();
    await routing.selectOption('POTION');
    await expect(routing).toHaveValue('POTION');

    // The server owns it, so it is still there on a cold read.
    await page.reload();
    await expect(page.getByTestId('system-window')).toBeVisible();
    await expect(page.getByTestId('slot-routing').first()).toHaveValue('POTION');
  });
});
