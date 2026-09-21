/**
 * Phase 1 §16 — UI1 to UI8. Component and interaction behaviour (spec §7, §15).
 *
 * These run in a REAL BROWSER rather than jsdom, because half of what they
 * claim is layout and input: a bottom sheet at a mobile width, a visible focus
 * ring, a touch tap, a layout-shift score. jsdom has no layout and no compositor,
 * so it would answer every one of those questions with a guess.
 */
import { expect, test, type Page } from '@playwright/test';

const handle = () => `UI${Math.random().toString(36).slice(2, 8)}`;

async function play(page: Page, name = 'Scout'): Promise<void> {
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter' });
  await expect(enter).toBeEnabled();
  await page.getByLabel('Handle').fill(handle());
  await enter.click();
  await page.waitForURL('**/characters');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL('**/play/**');
  await expect(page.getByTestId('atlas')).toBeVisible();
}

/** The camera transform the Atlas is currently rendering with. */
const camera = (page: Page) => page.locator('[data-testid="atlas"] > g').getAttribute('transform');

test.describe('Atlas and panel interaction', () => {
  test('UI1: the Atlas pans and zooms, by control, by keyboard and by drag', async ({ page }) => {
    await play(page);

    // Zoom, by the controls.
    await expect(page.getByTestId('zoom')).toHaveText('100%');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByTestId('zoom')).toHaveText('125%');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(page.getByTestId('zoom')).toHaveText('100%');

    // Pan, by keyboard — the Atlas is focusable on purpose, so a player who
    // cannot use a pointer is not locked out of the map.
    const before = await camera(page);
    await page.getByTestId('atlas').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => camera(page)).not.toBe(before);

    // Pan, by dragging the BACKGROUND.
    const box = (await page.getByTestId('atlas').boundingBox())!;
    const dragged = await camera(page);
    await page.mouse.move(box.x + 30, box.y + box.height - 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height - 60, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => camera(page)).not.toBe(dragged);

    // Reset puts the camera back where it started.
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.getByTestId('zoom')).toHaveText('100%');
    expect(await camera(page)).toBe('translate(0 0) scale(1)');
  });

  test('UI3: Escape deselects, wherever focus happens to be', async ({ page }) => {
    await play(page);
    await page.getByTestId('marker-marker.rookgaard.sewers').click();
    await expect(page.getByTestId('hunt-details')).toBeVisible();

    // Focus inside the details sheet, which is where a player who just read it
    // would be — an Escape handler scoped to the map would miss this.
    await page.getByTestId('enter').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hunt-details')).toBeHidden();

    // And from the map itself.
    await page.getByTestId('marker-marker.rookgaard.sewers').click();
    await page.getByTestId('atlas').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hunt-details')).toBeHidden();
  });

  test('UI4: keyboard focus is VISIBLE, and reaches the map and its markers', async ({ page }) => {
    await play(page);
    const marker = page.getByTestId('marker-marker.rookgaard.sewers');

    // TAB to it rather than calling .focus(): `:focus-visible` is the
    // browser's judgement about whether focus should be SHOWN, and a
    // programmatic focus does not earn it. Tabbing is also the claim itself —
    // that a keyboard user can reach the marker at all.
    let reached = false;
    for (let press = 0; press < 12 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await marker.evaluate((element) => element === document.activeElement);
    }
    expect(reached, 'the marker was not reachable by Tab').toBe(true);
    await expect(marker).toBeFocused();

    // A visible ring, measured on the real element rather than assumed from
    // the stylesheet.
    const ring = await marker.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
        focusVisible: element.matches(':focus-visible'),
      };
    });
    expect(ring.focusVisible).toBe(true);
    expect(ring.style).not.toBe('none');
    expect(Number.parseFloat(ring.width)).toBeGreaterThanOrEqual(2);

    // Enter activates it: focus that leads nowhere is not keyboard support.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hunt-details')).toBeVisible();
  });

  test('UI5: a locked region is present and inert — visible scale, no false promise', async ({
    page,
  }) => {
    await play(page);

    for (const key of ['region.mainland', 'region.thais', 'region.carlin', 'region.edron']) {
      const region = page.getByTestId(`region-${key}`);
      await expect(region).toBeAttached();
      // Decorative and unreachable: no button, no handler, and hidden from
      // assistive technology so it is not announced as something to try.
      await expect(region).toHaveAttribute('aria-hidden', 'true');
      expect(await region.locator('button').count()).toBe(0);
      expect(Number(await region.getAttribute('opacity'))).toBeLessThan(1);
    }

    await expect(page.getByTestId('region-region.rookgaard')).toHaveAttribute('opacity', '1');
  });

  test('UI6: at a mobile width the details panel is a bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await play(page);
    await page.getByTestId('marker-marker.rookgaard.sewers').click();

    const sheet = page.getByTestId('hunt-details');
    await expect(sheet).toBeVisible();

    const layout = await sheet.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        bottom: style.bottom,
        rect: element.getBoundingClientRect(),
      };
    });
    expect(layout.position).toBe('fixed');
    expect(layout.bottom).toBe('0px');
    // Full-bleed at the bottom of the viewport, which is what makes it a sheet
    // rather than a floating card.
    expect(layout.rect.left).toBeLessThanOrEqual(1);
    expect(Math.round(layout.rect.right)).toBeGreaterThanOrEqual(389);

    // At desktop width it is an ordinary panel beside the map.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => sheet.evaluate((element) => getComputedStyle(element).position))
      .toBe('static');
  });

  test('UI7: the play surface loads without shifting its layout', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) {
            (window as unknown as { __cls: number }).__cls += shift.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await play(page);
    await page.waitForLoadState('networkidle');

    // Measured, not asserted from the stylesheet: the skeleton reserves the
    // same box the loaded panel occupies, so nothing jumps under the player's
    // finger while the first fetch resolves. 0.1 is the "good" CLS threshold.
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });

  test('UI8: when the world cannot load, the surface says so and offers Retry', async ({
    page,
  }) => {
    await play(page);

    // Break the Atlas, then reload: the page has a real failure to render.
    let broken = true;
    await page.route('**/api/atlas', async (route) => {
      if (broken) await route.fulfill({ status: 500, body: '{"error":{"code":"INTERNAL"}}' });
      else await route.continue();
    });
    await page.reload();

    const error = page.getByTestId('load-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('did not load');
    // A dead end would be a spinner. This offers the player the next move.
    const retry = page.getByTestId('retry');
    await expect(retry).toBeVisible();

    broken = false;
    await retry.click();
    await expect(page.getByTestId('atlas')).toBeVisible();
    await expect(error).toBeHidden();
  });
});

/**
 * UI2 needs a TOUCH context, and the desktop project deliberately has none —
 * so it gets its own block rather than switching touch on for every case and
 * quietly changing what the others are testing.
 */
test.describe('marker selection by pointer and by touch', () => {
  test.use({ hasTouch: true });

  test('UI2: a marker is selectable by CLICK and by TAP, not by hover', async ({ page }) => {
    await play(page);
    const marker = page.getByTestId('marker-marker.rookgaard.sewers');

    // Hover alone must not select: a touch device has no hover, and a map that
    // only opens on hover is a map half the players cannot use.
    await marker.hover();
    await expect(page.getByTestId('hunt-details')).toBeHidden();
    await expect(marker).toHaveAttribute('aria-pressed', 'false');

    await marker.click();
    await expect(page.getByTestId('hunt-details')).toBeVisible();
    await expect(marker).toHaveAttribute('aria-pressed', 'true');

    // And by tap. `dispatchEvent` would prove a handler exists; a real touch
    // sequence proves the marker is reachable and big enough to hit.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hunt-details')).toBeHidden();
    const box = (await marker.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('hunt-details')).toBeVisible();
  });
});
