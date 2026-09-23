/**
 * Phase 3.7 §13 — CTY, SLC, HUD and AUTH, in a real browser.
 *
 * Every case runs twice, on the desktop viewport and on the touch one
 * (playwright.config.ts), because a pannable raster and a pinned Hunt entry
 * are exactly the things that work on a 1440-wide screen and fail on a 390.
 *
 * WHAT THESE CASES ARE ABOUT is that a new surface was added and NOTHING moved
 * underneath it. The Atlas is navigation, the server still decides what starts,
 * the Game Window still draws the tiles the server named, and — the whole point
 * of the A1 correction — the running build contains no private asset and asks
 * for none. Every screenshot below is of art this project drew.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterHunt, play } from './support';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Assembled at runtime so this file does not itself contain the literal the
 * release guard scans for — otherwise scanning the repo would find the test.
 */
const MARKER = ['GLOBAL_IDLE', 'PRIVATE_ASSET', 'MARKER'].join('_');

/** Open the Phase 3.7 Atlas from the play surface. */
async function openAtlas(page: Page): Promise<void> {
  await page.getByTestId('atlas-launcher').click();
  await expect(page.getByTestId('rookgaard-atlas')).toBeVisible();
}

/** World Atlas → the Rookgaard city plan. */
async function descendToCity(page: Page): Promise<void> {
  await page.getByTestId('world-atlas').getByTestId('atlas-pin').first().click();
  await expect(page.getByTestId('city-atlas')).toBeVisible();
}

test.describe('§13 CTY — World Atlas → Rookgaard → a Hunt', () => {
  test('CTY1: the Atlas is an extra surface, not a replacement', async ({ page }) => {
    await play(page);
    // The Phase 1 marker list is what the play surface opens on, and the
    // verified cases that depend on it keep passing because it is still there.
    await expect(page.getByTestId('atlas')).toBeVisible();

    await openAtlas(page);
    await expect(page.getByTestId('rookgaard-atlas')).toHaveAttribute('data-view', 'world');
    await expect(page.getByTestId('atlas')).toBeHidden();

    // And back, so nothing is trapped behind the new surface.
    await page.getByTestId('atlas-launcher').click();
    await expect(page.getByTestId('atlas')).toBeVisible();
  });

  test('CTY2: descending to the city and returning keeps the breadcrumb honest', async ({
    page,
  }) => {
    await play(page);
    await openAtlas(page);
    await expect(page.getByTestId('atlas-breadcrumb-current')).toHaveText('Choose a region');

    await descendToCity(page);
    await expect(page.getByTestId('rookgaard-atlas')).toHaveAttribute('data-view', 'city');
    await expect(page.getByTestId('atlas-breadcrumb-current')).toHaveText('Rookgaard');

    await page.getByTestId('atlas-breadcrumb-world').click();
    await expect(page.getByTestId('world-atlas')).toBeVisible();
    await expect(page.getByTestId('atlas-breadcrumb-current')).toHaveText('Choose a region');
  });

  test('CTY3: EVERY pin on both surfaces is marked as a demonstration', async ({ page }) => {
    // The A2 condition, enforced where a player would see it. No raster in
    // this phase is calibrated, so a pin cannot be a real position — and the
    // marking is not something a caller can suppress.
    await play(page);
    await openAtlas(page);

    const world = page.getByTestId('world-atlas').getByTestId('atlas-pin');
    await expect(world).toHaveCount(1);
    for (const pin of await world.all()) {
      await expect(pin).toHaveAttribute('data-demo', 'true');
    }

    await descendToCity(page);
    const city = page.getByTestId('city-atlas').getByTestId('atlas-pin');
    await expect(city).toHaveCount(5);
    for (const pin of await city.all()) {
      await expect(pin).toHaveAttribute('data-demo', 'true');
    }
    // And the surface says why in words, not only in an attribute.
    await expect(page.getByTestId('city-atlas-caption')).toContainText('no world origin');
  });

  test('CTY4: the raster zooms and pans by KEYBOARD', async ({ page }) => {
    // A map that can only be driven with a mouse is a map a keyboard user
    // cannot read. The frame is focusable and says what its keys do.
    await play(page);
    await openAtlas(page);

    const frame = page.getByTestId('world-atlas-frame');
    await expect(frame).toHaveAttribute('role', 'application');
    await expect(page.getByTestId('world-atlas-zoom')).toHaveText('1×');

    await frame.focus();
    await page.keyboard.press('+');
    await expect(page.getByTestId('world-atlas-zoom')).toHaveText('2×');
    await page.keyboard.press('-');
    await expect(page.getByTestId('world-atlas-zoom')).toHaveText('1×');

    // Panning at zoom 1 with a raster that fits is clamped to the origin, so
    // the case that proves panning MOVES something zooms in first.
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    const before = await frame.getAttribute('data-pan');
    await page.keyboard.press('ArrowRight');
    await expect(frame).not.toHaveAttribute('data-pan', before ?? '');
  });

  test('CTY5: the buttons zoom too, which is the touch path', async ({ page }) => {
    // 390 × 844 with `hasTouch`. A wheel gesture is not available there, so
    // the explicit controls are the only way in and must work on both.
    await play(page);
    await openAtlas(page);

    await page.getByTestId('world-atlas-zoom-in').click();
    await expect(page.getByTestId('world-atlas-zoom')).toHaveText('2×');
    await page.getByTestId('world-atlas-zoom-out').click();
    await expect(page.getByTestId('world-atlas-zoom')).toHaveText('1×');

    // Bounded, and the control DISABLES rather than pretending: at zoom 1
    // there is nowhere further out to go, and the button says so.
    await expect(page.getByTestId('world-atlas-zoom-out')).toBeDisabled();
  });

  test('CTY6: the Hunt pin enters the Hunt, on pointer and on touch', async ({ page }) => {
    await play(page);
    await openAtlas(page);
    await descendToCity(page);

    await page.getByRole('button', { name: /Rookgaard Sewers/ }).click();
    // The server's answer is what changes the screen: the play surface
    // re-reads the Character and finds an Activity.
    await expect(page.getByTestId('game-window')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tile-scene')).toHaveAttribute(
      'data-map',
      'map.rookgaard.sewers',
    );
  });
});

test.describe('§13 SLC — the Rat Hunt visual slice', () => {
  test('SLC1: the running build draws PUBLIC placeholders and says so', async ({ page }) => {
    // The distribution boundary, observed from the browser rather than argued
    // about. `next start` is a production build, so the private branch is
    // folded away and this attribute cannot read anything else here.
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toHaveAttribute('data-sprites', 'public');
  });

  test('SLC2: nothing is requested from the dev loader, or from anywhere remote', async ({
    page,
  }) => {
    // "No missing image requests" in the strongest available form: a list of
    // every request the page made, checked for the private route and for any
    // ASSET that came from somewhere other than this origin.
    //
    // The API is a different origin by design (`:3001`), so a blanket
    // same-origin rule would be false. What must be same-origin is the
    // ARTWORK: an image, a font, a stylesheet or a media file arriving from
    // anywhere else is exactly the leak this case is looking for.
    const assetKinds = new Set(['image', 'font', 'stylesheet', 'media']);
    const requested: string[] = [];
    const assets: string[] = [];
    const failed: string[] = [];
    page.on('request', (request) => {
      requested.push(request.url());
      if (assetKinds.has(request.resourceType())) assets.push(request.url());
    });
    page.on('requestfailed', (request) => {
      // ASSET requests only. Next cancels its own RSC prefetch when a
      // navigation overtakes it, and an aborted prefetch is not a missing
      // picture — counting it would make this case fail for a reason that has
      // nothing to do with the artwork.
      if (assetKinds.has(request.resourceType())) failed.push(request.url());
    });

    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();
    // Let the scene run long enough to have drawn many frames.
    await expect.poll(() => requested.length, { timeout: 15_000 }).toBeGreaterThan(0);

    const origin = new URL(page.url()).origin;
    expect(requested.filter((url) => url.includes('dev-private-asset'))).toEqual([]);
    expect(requested.filter((url) => url.includes('assets/private'))).toEqual([]);
    expect(assets.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'))).toEqual([]);
    // No asset the page asked for went missing, so no placeholder is standing
    // in for a broken request rather than for a private asset.
    expect(failed).toEqual([]);
  });

  test('SLC3: the 15 × 11 window is unchanged by the new artwork', async ({ page }) => {
    // Phase 3.5 locked how much world a player can see. Repainting the tiles
    // is presentation; changing the viewport would be gameplay.
    await play(page);
    await enterHunt(page);

    const canvas = page.getByTestId('tile-scene').locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // 480 × 352 logical, however many CSS pixels that is on this viewport.
    expect(box!.width / box!.height / (480 / 352)).toBeGreaterThan(0.98);
    expect(box!.width / box!.height / (480 / 352)).toBeLessThan(1.02);
  });

  test('SLC4: the slice is drawn, and the screenshot is of this project’s own art', async ({
    page,
  }, testInfo) => {
    await play(page);
    await enterHunt(page);
    const scene = page.getByTestId('tile-scene');
    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute('data-sprites', 'public');

    // Evidence, and safe evidence: the assertion above is what makes this
    // screenshot publishable — it is placeholder art, drawn by the renderer
    // from `PUBLIC_PALETTE`, with no private override present or possible.
    await scene.screenshot({
      path: testInfo.outputPath('visual-slice-public-placeholders.png'),
    });
  });

  test('SLC5: the production server REFUSES the dev loader, private bytes or not', async ({
    request,
  }, testInfo) => {
    // The A1 requirement, stated as a request rather than as an argument: a
    // release build must not serve the override "regardless of local files or
    // environment variables". The harness writes a synthetic file at exactly
    // the path the loader would serve — the marker, never real artwork — so a
    // gate that had been removed would answer 200 here.
    const relative = 'private/assets/sprites/rat/sprite_3821.png';
    const planted = join(REPO_ROOT, relative);
    const existed = existsSync(planted);
    if (!existed) {
      mkdirSync(dirname(planted), { recursive: true });
      writeFileSync(planted, `synthetic bytes ${MARKER}`);
    }
    try {
      const response = await request.get('/dev-private-asset/sprites/rat/sprite_3821.png');
      expect(response.status(), 'a production build must not serve a private asset').toBe(404);
      expect(await response.text()).not.toContain(MARKER);
      testInfo.annotations.push({
        type: 'state',
        description: existed
          ? 'private bytes already present'
          : 'private bytes planted by this case',
      });
    } finally {
      if (!existed) rmSync(planted, { force: true });
    }
  });
});

test.describe('§13 HUD — the frame around the Game Window', () => {
  test('HUD1: the HUD shows the SERVER’s character fields', async ({ page }) => {
    await play(page, 'Hunter');
    await enterHunt(page);

    await expect(page.getByTestId('hud')).toBeVisible();
    await expect(page.getByTestId('hud-name')).toHaveText('Hunter');
    // A level, and a real one: whatever the server returned, not a constant.
    await expect(page.getByTestId('hud-level')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('hud-stamina')).toBeVisible();
  });

  test('HUD2: every dormant panel says it is inactive and claims nothing', async ({ page }) => {
    // The honesty rule for a frame that looks like a full client: a panel with
    // no system behind it must not look like a panel that has one.
    await play(page);
    await enterHunt(page);

    const dormant = page.locator('[data-dormant="true"]');
    await expect(dormant).not.toHaveCount(0);
    for (const panel of await dormant.all()) {
      await expect(panel).toContainText('inactive');
    }
    await expect(page.getByTestId('hud-mana')).toContainText('no mana system');
  });

  test('HUD3: the Game Window is inside the HUD, and is still the Game Window', async ({
    page,
  }) => {
    await play(page);
    await enterHunt(page);
    // Nesting, asserted structurally: the frame wraps the window rather than
    // replacing it, so every verified Phase 2/3.5 case still has its surface.
    await expect(page.getByTestId('hud').getByTestId('game-window')).toBeVisible();
    await expect(page.getByTestId('hud').getByTestId('tile-scene')).toBeVisible();
  });
});

test.describe('§13 AUTH — the Atlas navigates; the server decides', () => {
  test('AUTH1: opening and browsing the Atlas starts NOTHING', async ({ page }) => {
    // A pin is a way of naming a content key. Looking at a map may not begin
    // an Activity, may not move the Character and may not write anything.
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/api/')) {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    const characterId = await play(page);
    writes.length = 0;

    await openAtlas(page);
    await descendToCity(page);
    // Zoom in and back out: magnifying is browsing too, and at zoom 1 the
    // 256 px city plan fits both viewports, so every pin is reachable on a
    // 390-wide screen as well as on a 1440-wide one.
    await page.getByTestId('city-atlas-zoom-in').click();
    await page.getByTestId('city-atlas-zoom-out').click();
    await page.getByRole('button', { name: /^Temple/ }).click();
    await page.getByRole('button', { name: /^Shop/ }).click();

    expect(writes).toEqual([]);
    // Still on the Atlas, still no Activity.
    await expect(page.getByTestId('city-atlas')).toBeVisible();
    expect(page.url()).toContain(characterId);
  });

  test('AUTH2: a pin enters by the SAME server route the marker list uses', async ({ page }) => {
    // One path, two ways of naming a key. If a pin ever got its own endpoint,
    // or posted a position, this is what would catch it.
    const posts: { method: string; path: string; body: string }[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/')) {
        posts.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          body: request.postData() ?? '',
        });
      }
    });

    const characterId = await play(page);
    await openAtlas(page);
    await descendToCity(page);
    await page.getByRole('button', { name: /Rookgaard Sewers/ }).click();
    await expect(page.getByTestId('game-window')).toBeVisible({ timeout: 20_000 });

    const entry = posts.find((post) => post.path.endsWith('/hunt'));
    expect(entry, 'a pin must enter through POST /hunt').toBeTruthy();
    expect(entry!.path).toBe(`/api/characters/${characterId}/hunt`);
    // The key, and ONLY the key. No tile, no raster pixel, no position.
    expect(JSON.parse(entry!.body)).toEqual({ huntKey: 'hunt.rookgaard.sewers' });
  });

  test('AUTH3: with a run active the surface is the Game Window, not a map tab', async ({
    page,
  }) => {
    // The Character is somewhere, and the server says where. The Atlas is not
    // hidden behind a tab during a Hunt — it is simply not this screen.
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('game-window')).toBeVisible();
    await expect(page.getByTestId('atlas-launcher')).toHaveCount(0);
    await expect(page.getByTestId('rookgaard-atlas')).toHaveCount(0);
  });
});
