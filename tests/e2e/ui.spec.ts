/**
 * Phase 1 §16 — UI1 to UI8. Component and interaction behaviour (spec §7, §15).
 *
 * These run in a REAL BROWSER rather than jsdom, because most of what they
 * claim is layout and input: a wheel, a two-finger pinch, a bottom sheet at a
 * mobile width, a visible focus ring, a layout-shift score. jsdom has no
 * layout and no compositor, so it would answer every one of those with a guess.
 *
 * THE EIGHT CASES ARE §16's EIGHT. An earlier pass implemented only part of
 * each capability — button zoom but not wheel or pinch, Escape but not
 * empty-space dismissal, `aria-hidden` locked regions where §7.3 says
 * `aria-disabled`. These cases now cover the whole of §7.1's table under the
 * same ids: the matrix did not change, the coverage of it did.
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

const zoomPercent = async (page: Page) =>
  Number.parseInt((await page.getByTestId('zoom').innerText()).replace('%', ''), 10);

/**
 * A REAL two-finger gesture, dispatched through Chromium's input pipeline.
 * Playwright's `touchscreen` only taps, and a synthesised PointerEvent would
 * prove a handler exists rather than that the browser routes a pinch into it.
 */
async function pinch(
  page: Page,
  from: readonly [{ x: number; y: number }, { x: number; y: number }],
  to: readonly [{ x: number; y: number }, { x: number; y: number }],
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (pair: readonly { x: number; y: number }[]) =>
    pair.map((point, index) => ({ x: point.x, y: point.y, id: index }));

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let step = 1; step <= 6; step += 1) {
    const t = step / 6;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points([
        { x: from[0].x + (to[0].x - from[0].x) * t, y: from[0].y + (to[0].y - from[0].y) * t },
        { x: from[1].x + (to[1].x - from[1].x) * t, y: from[1].y + (to[1].y - from[1].y) * t },
      ]),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('Atlas and panel interaction', () => {
  test('UI1: the Atlas pans and zooms — controls, keyboard, drag and WHEEL', async ({ page }) => {
    await play(page);
    const box = (await page.getByTestId('atlas').boundingBox())!;

    // Zoom, by the controls.
    await expect(page.getByTestId('zoom')).toHaveText('100%');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByTestId('zoom')).toHaveText('125%');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(page.getByTestId('zoom')).toHaveText('100%');

    // §7.1 desktop zoom: the WHEEL. This was missing entirely.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
    await page.mouse.wheel(0, 240);
    await expect.poll(() => zoomPercent(page)).toBeLessThan(115);

    // Pan, by keyboard — the Atlas is focusable on purpose, so a player who
    // cannot use a pointer is not locked out of the map.
    await page.getByRole('button', { name: 'Reset view' }).click();
    const before = await camera(page);
    await page.getByTestId('atlas').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => camera(page)).not.toBe(before);

    // Pan, by dragging the BACKGROUND.
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

    // §7.1: the bounds come from REGION DATA, not from a constant the
    // component picked. Rookgaard authors 0.6..3, and the camera stops there.
    const atlas = page.getByTestId('atlas');
    await expect(atlas).toHaveAttribute('data-zoom-min', '0.6');
    await expect(atlas).toHaveAttribute('data-zoom-max', '3');

    for (let press = 0; press < 12; press += 1) {
      await page.getByRole('button', { name: 'Zoom out' }).click();
    }
    expect(await zoomPercent(page)).toBe(60);

    for (let press = 0; press < 20; press += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
    }
    expect(await zoomPercent(page)).toBe(300);

    // The wheel obeys the same bounds — a second path to the same clamp is a
    // second place it could have been forgotten.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let notch = 0; notch < 10; notch += 1) await page.mouse.wheel(0, -120);
    expect(await zoomPercent(page)).toBe(300);
    for (let notch = 0; notch < 30; notch += 1) await page.mouse.wheel(0, 120);
    expect(await zoomPercent(page)).toBe(60);
  });

  test('UI3: Escape deselects, and so does pressing EMPTY SPACE', async ({ page }) => {
    await play(page);
    const marker = page.getByTestId('marker-marker.rookgaard.sewers');

    await marker.click();
    await expect(page.getByTestId('hunt-details')).toBeVisible();

    // Focus inside the details sheet, which is where a player who just read it
    // would be — an Escape handler scoped to the map would miss this.
    await page.getByTestId('enter').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hunt-details')).toBeHidden();

    // And from the map itself.
    await marker.click();
    await page.getByTestId('atlas').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('hunt-details')).toBeHidden();

    // §7.1's other dismissal: a press on empty Atlas space. It must be told
    // apart from a pan, which shares the same gesture surface.
    await marker.click();
    await expect(page.getByTestId('hunt-details')).toBeVisible();
    const box = (await page.getByTestId('atlas').boundingBox())!;
    const empty = { x: box.x + box.width - 24, y: box.y + box.height - 24 };
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId('hunt-details')).toBeHidden();

    // A DRAG across empty space pans and does NOT deselect — otherwise every
    // pan would close the panel the player was reading.
    await marker.click();
    await expect(page.getByTestId('hunt-details')).toBeVisible();
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x - 140, empty.y - 90, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId('hunt-details')).toBeVisible();
  });

  test('UI4: focus is VISIBLE and reaches both MARKERS and REGIONS', async ({ page }) => {
    await play(page);
    const marker = page.getByTestId('marker-marker.rookgaard.sewers');
    const region = page.getByTestId('region-region.rookgaard');

    // §7.1 gives regions their own row: focusable, activated by Enter, with a
    // visible ring. They were purely decorative before.
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region).toHaveAttribute('role', 'button');
    await region.focus();
    await expect(region).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('focused-region')).toHaveText('Rookgaard');
    // The ring is rendered, not merely declared.
    await expect(region.locator('rect').first()).toHaveAttribute('stroke-width', '4');

    // TAB to the marker rather than calling .focus(): `:focus-visible` is the
    // browser's judgement about whether focus should be SHOWN, and a
    // programmatic focus does not earn it. Tabbing is also the claim itself —
    // that a keyboard user can reach the marker at all.
    let reached = false;
    for (let press = 0; press < 20 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await marker.evaluate((element) => element === document.activeElement);
    }
    expect(reached, 'the marker was not reachable by Tab').toBe(true);

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

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hunt-details')).toBeVisible();
  });

  test('UI5: a locked region is visible, dimmed, aria-disabled and NOT a way through', async ({
    page,
  }) => {
    await play(page);

    for (const key of ['region.mainland', 'region.thais', 'region.carlin', 'region.edron']) {
      const region = page.getByTestId(`region-${key}`);
      await expect(region).toBeAttached();
      // §7.3: VISIBLE and announced as unavailable — not `aria-hidden`, which
      // removes the sense of scale for exactly the users who cannot see it.
      await expect(region).toHaveAttribute('aria-disabled', 'true');
      await expect(region).toHaveAccessibleName(/Locked/i);
      expect(Number(await region.getAttribute('opacity'))).toBeLessThan(1);

      // Activating it surfaces the phase note and navigates NOWHERE: no hunt
      // details, no route change.
      //
      // Pressed through the MOUSE rather than `locator.click()`, because
      // Playwright refuses to click an `aria-disabled` control — which is
      // itself evidence the semantics are right, and not what a real player
      // is prevented from doing.
      const shape = (await region.boundingBox())!;
      await page.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
      await expect(page.getByTestId('focused-region')).toContainText('Coming in a later phase');
      await expect(page.getByTestId('hunt-details')).toBeHidden();
      await expect(page).toHaveURL(/\/play\//);
    }

    const rookgaard = page.getByTestId('region-region.rookgaard');
    await expect(rookgaard).toHaveAttribute('opacity', '1');
    expect(await rookgaard.getAttribute('aria-disabled')).toBeNull();
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
test.describe('touch: selection, pinch and one-finger pan', () => {
  test.use({ hasTouch: true });

  test('UI2: selection by click and TAP, pinch zoom, and one-finger pan', async ({ page }) => {
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

    // §7.1 touch zoom: PINCH. Two real touch points, spread apart.
    const atlas = (await page.getByTestId('atlas').boundingBox())!;
    const centre = { x: atlas.x + atlas.width / 2, y: atlas.y + atlas.height / 2 };
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.getByTestId('zoom')).toHaveText('100%');

    await pinch(
      page,
      [
        { x: centre.x - 40, y: centre.y },
        { x: centre.x + 40, y: centre.y },
      ],
      [
        { x: centre.x - 130, y: centre.y },
        { x: centre.x + 130, y: centre.y },
      ],
    );
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);

    // Pinching back in zooms out again — the gesture is not one-way.
    const spread = await zoomPercent(page);
    await pinch(
      page,
      [
        { x: centre.x - 130, y: centre.y },
        { x: centre.x + 130, y: centre.y },
      ],
      [
        { x: centre.x - 45, y: centre.y },
        { x: centre.x + 45, y: centre.y },
      ],
    );
    await expect.poll(() => zoomPercent(page)).toBeLessThan(spread);

    // ONE-FINGER PAN still works after all that: adding pinch must not have
    // cost the simpler gesture.
    const before = await camera(page);
    const cdp = await page.context().newCDPSession(page);
    const finger = { x: atlas.x + 40, y: atlas.y + atlas.height - 40 };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: finger.x, y: finger.y, id: 0 }],
    });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: finger.x + step * 18, y: finger.y - step * 12, id: 0 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(() => camera(page)).not.toBe(before);
  });
});
