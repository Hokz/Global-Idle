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
      if (/^\/api\/content\/[^/]+\/maps\//.test(new URL(request.url()).pathname)) maps += 1;
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

test.describe('§20 VIS — the locked logical viewport', () => {
  /** The logical surface, from the renderer's own constants. */
  const LOGICAL = { width: 480, height: 352, tile: 32, across: 15, down: 11 };

  test('VIS8: the visible world is exactly 15 × 11 tiles, whatever the screen', async ({
    page,
  }) => {
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();

    const surface = await page.evaluate(() => {
      const canvas = document.querySelector('.tile-scene canvas') as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      return { width: canvas.width, height: canvas.height, cssW: box.width, cssH: box.height };
    });

    // The backing buffer is a WHOLE multiple of the logical surface, and the
    // same multiple on both axes — so the logical world is 480 × 352 and the
    // only thing the device decides is how big that looks.
    expect(surface.width % LOGICAL.width).toBe(0);
    expect(surface.height % LOGICAL.height).toBe(0);
    expect(surface.width / LOGICAL.width).toBe(surface.height / LOGICAL.height);
    expect(surface.width / LOGICAL.width).toBeGreaterThanOrEqual(1);

    // 480 / 32 = 15 across, 352 / 32 = 11 down. A bigger monitor shows the
    // same corridor bigger; it does not show more of it.
    expect(LOGICAL.width / LOGICAL.tile).toBe(LOGICAL.across);
    expect(LOGICAL.height / LOGICAL.tile).toBe(LOGICAL.down);
    // And the box it is displayed in keeps that shape.
    expect(surface.cssW / surface.cssH).toBeCloseTo(LOGICAL.width / LOGICAL.height, 1);
  });

  test('VIS9: resizing the window reveals no extra world', async ({ page }) => {
    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();

    const logical = async () =>
      page.evaluate(() => {
        const canvas = document.querySelector('.tile-scene canvas') as HTMLCanvasElement;
        // Whatever the scale, the LOGICAL surface is width / scale.
        const scale = canvas.width / 480;
        return { width: canvas.width / scale, height: canvas.height / scale };
      });

    const before = await logical();
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: Math.min(1600, size.width + 300), height: size.height });
    await page.waitForTimeout(500);
    const after = await logical();

    expect(after).toEqual(before);
    expect(after).toEqual({ width: LOGICAL.width, height: LOGICAL.height });
    await page.setViewportSize(size);
  });

  test('VIS10: the camera centres the Character, and clamps at the map edge', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();

    /**
     * Where is the Character actually drawn?
     *
     * The Character is blue and the sewer floor is brown, so one pixel inside
     * its body answers it: blue beats red, or it does not. This asserts what
     * the player sees rather than what the renderer was asked to do.
     */
    const bodyAt = (column: number) =>
      page.evaluate(async (tileColumn) => {
        const canvas = document.querySelector('.tile-scene canvas') as HTMLCanvasElement;
        const scale = canvas.width / 480;
        const context = canvas.getContext('2d')!;
        const id = location.pathname.split('/').pop();
        const response = await fetch(`http://127.0.0.1:3001/api/characters/${id}/hunt`, {
          credentials: 'include',
        });
        const snapshot = (await response.json()) as { space: { tile: { x: number; y: number } } };
        // Logical y inside the body, from the tile the server says it is on.
        const y = snapshot.space.tile.y * 32 + 20;
        const x = tileColumn * 32 + 16;
        const pixel = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
        return { blue: (pixel[2] ?? 0) > (pixel[0] ?? 0), tile: snapshot.space.tile };
      }, column);

    // At the entry the map's left edge is already on screen, so the camera
    // CLAMPS: the Character is drawn at its own column, not the centre one.
    await expect.poll(async () => (await bodyAt(7)).blue, { timeout: 15_000 }).toBe(false);
    const atEntry = await bodyAt(1);
    expect(atEntry.tile.x).toBeLessThan(7);
    expect(atEntry.blue).toBe(true);

    const prisma = connect();
    try {
      // The middle of a 61-wide map, where the camera is free to centre.
      await prisma.huntRun.updateMany({
        where: { characterId },
        data: { room: 5, creatures: [], position: { tile: { x: 27, y: 5, z: 7 } } },
      });
    } finally {
      await prisma.$disconnect();
    }

    // Now the Character is on the CENTRE column, 7 of 0..14, wherever it walks.
    await expect.poll(async () => (await bodyAt(7)).blue, { timeout: 25_000 }).toBe(true);
    // The map is exactly eleven rows and the viewport is eleven tiles deep, so
    // the camera cannot move vertically at all — which is the clamp doing its
    // job, not the centring failing.
    const rows = await page.evaluate(() => {
      const canvas = document.querySelector('.tile-scene canvas') as HTMLCanvasElement;
      return canvas.height / (canvas.width / 480) / 32;
    });
    expect(rows).toBe(11);
  });

  test('VIS11: the map is fetched at the Activity’s pinned version', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes('/maps/')) urls.push(path);
    });

    await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();
    await page.waitForTimeout(3000);

    expect(urls.length).toBeGreaterThan(0);
    for (const path of urls) {
      // `/api/content/<version>/maps/<key>` — the version is part of the
      // resource's identity, which is what makes `immutable` true.
      expect(path).toMatch(/^\/api\/content\/v[0-9a-f]+\/maps\/map\.rookgaard\.sewers$/);
    }
  });
});
