/**
 * Phase 3.5 §20 — VIS1 to VIS7. The tile scene, in a real browser.
 *
 * Every case runs twice, on the desktop viewport and on the touch one
 * (playwright.config.ts), because a 61-tile map on a 390-wide screen is where
 * a camera goes wrong.
 *
 * What these cases are about is the WINDOW: that it draws the map the server
 * named, that it never advances the world by reading it, and that it refuses a
 * snapshot older than the one already on screen. The simulation itself belongs
 * to SPC and the route contract to SNP; neither is re-litigated here.
 */
import { expect, test } from '@playwright/test';
import { connect, enterHunt, play, runOf } from './support';

test.describe('§20 VIS — the tile scene', () => {
  test('VIS1: the scene is the map the server named', async ({ page }) => {
    await play(page);
    await enterHunt(page);

    const scene = page.getByTestId('tile-scene');
    await expect(scene).toBeVisible();
    // The map KEY comes from the run snapshot. The window does not choose a
    // map; it is told which one it is standing on.
    await expect(scene).toHaveAttribute('data-map', 'map.rookgaard.sewers');
    await expect(scene.locator('canvas')).toBeVisible();

    const size = await scene.locator('canvas').boundingBox();
    expect(size?.width ?? 0).toBeGreaterThan(200);
    expect(size?.height ?? 0).toBeGreaterThan(150);
  });

  test('VIS2: the Character walks — the tile it stands on changes', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();

    const prisma = connect();
    try {
      // The authoritative answer is the durable row, not a pixel. What this
      // case proves is that the run the window is rendering MOVES: the tile
      // the server persisted is not where the Character entered.
      const entry = { x: 1, y: 5 };
      await expect
        .poll(
          async () => {
            const run = await runOf(prisma, characterId);
            const at = (run.position as { tile?: { x: number; y: number } } | null)?.tile;
            return at ? `${at.x},${at.y}` : 'none';
          },
          { timeout: 40_000, message: 'the Character never left the entry tile' },
        )
        .not.toBe(`${entry.x},${entry.y}`);
    } finally {
      await prisma.$disconnect();
    }
  });

  test('VIS3: the window advances with a POST, never by reading', async ({ page }) => {
    const verbs: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/\/api\/characters\/[^/]+\/hunt(\/|$)/.test(url.pathname)) {
        verbs.push(`${request.method()} ${url.pathname.replace(/[^/]+(?=\/hunt)/, ':id')}`);
      }
    });

    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();
    await page.waitForTimeout(6000);

    // Entering is a POST to `/hunt`; settling is a POST to `/hunt/advance`.
    // A GET that advanced would be a settlement a proxy, a prefetch or a
    // retry could charge the player for.
    expect(
      verbs.filter((verb) => verb === 'POST /api/characters/:id/hunt/advance').length,
    ).toBeGreaterThan(1);
    expect(verbs.filter((verb) => verb.startsWith('GET '))).toHaveLength(0);
  });

  test('VIS4: a snapshot older than the screen is discarded', async ({ page }) => {
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();
    await expect(page.getByTestId('room')).toContainText('Room 1');

    // First, prove the window DOES apply a newer snapshot — otherwise the
    // second half would pass for a window that simply stopped listening.
    await page.route('**/api/characters/*/hunt/advance', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { revision: number };
      await route.fulfill({ json: { ...body, revision: body.revision + 1000, room: 42 } });
    });
    await expect(page.getByTestId('room')).toContainText('Room 42', { timeout: 15_000 });

    // Now a settlement from BEFORE the one on screen arrives — which is what
    // two polls in flight look like when the network reorders them. Applying
    // it would rewind the world in front of the player.
    await page.unroute('**/api/characters/*/hunt/advance');
    await page.route('**/api/characters/*/hunt/advance', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...body, revision: 1, room: 7 } });
    });
    await page.waitForTimeout(6000);
    await expect(page.getByTestId('room')).toContainText('Room 42');
  });

  test('VIS5: the map is content — fetched once, not with every poll', async ({ page }) => {
    let maps = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/maps/')) maps += 1;
    });

    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();
    await page.waitForTimeout(8000);

    // Four polls or more have gone by. The 671 tiles came down once.
    expect(maps).toBe(1);
  });

  test('VIS6: the scene fits the screen it is on', async ({ page }) => {
    await play(page);
    await enterHunt(page);
    const scene = page.getByTestId('tile-scene');
    await expect(scene).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const box = await scene.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeLessThanOrEqual(viewport.width);
    // And the readouts the scene does not replace are still there: the canvas
    // is a view of the world, not the only place its numbers live.
    await expect(page.getByTestId('character-health')).toBeVisible();
    await expect(page.getByTestId('creatures')).toBeVisible();
  });

  test('VIS7: the developer overlay is not in the shipped window', async ({ page }) => {
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();

    // A grid with tile coordinates over the scene is a diagnostic. It exists
    // behind a build flag, and a build without that flag has no way to reach
    // it — which is the difference between a debug tool and a feature.
    await expect(page.getByTestId('debug-toggle')).toHaveCount(0);
    await expect(page.getByTestId('tile-debug')).toHaveCount(0);
  });
});
