/**
 * Phase 3.5 §20 — VIS1 to VIS12. The tile scene, in a real browser.
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
     * Which column is the Character DRAWN in?
     *
     * Its body is the only strongly blue thing in the sewers — the floor, the
     * masonry and the Rats are all warm — so the centroid of the blue pixels
     * is where the player sees it, read off the canvas rather than taken from
     * the renderer. A column of `-1` means nothing blue is on screen at all.
     *
     * Reading the DRAWN position matters here: the window deliberately draws
     * one poll behind the newest snapshot, so the tile the server reports and
     * the tile on screen are not the same tile while the Character is walking.
     */
    const drawnColumn = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('.tile-scene canvas') as HTMLCanvasElement;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const scale = canvas.width / 480;
        const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let sumX = 0;
        let count = 0;
        for (let index = 0; index < frame.length; index += 4) {
          const red = frame[index] ?? 0;
          const blue = frame[index + 2] ?? 0;
          if (blue - red < 50) continue;
          sumX += (index / 4) % canvas.width;
          count += 1;
        }
        return count > 0 ? sumX / count / scale / 32 : -1;
      });

    const serverTile = () =>
      page.evaluate(async () => {
        const id = location.pathname.split('/').pop();
        const response = await fetch(`http://127.0.0.1:3001/api/characters/${id}/hunt`, {
          credentials: 'include',
        });
        const snapshot = (await response.json()) as { space: { tile: { x: number; y: number } } };
        return snapshot.space.tile;
      });

    // At the entry the map's left edge is already on screen, so the camera
    // CLAMPS: the Character is drawn in its own column, far left of centre.
    await expect.poll(async () => (await drawnColumn()) < 3, { timeout: 15_000 }).toBe(true);
    expect((await serverTile()).x).toBeLessThan(7);

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

    // Now the Character is drawn inside the CENTRE tile — column 7 of 0..14,
    // whose body spans 7.0 to 8.0 — and the map edges are nowhere near, so it
    // is the centring doing this and not another clamp.
    await expect
      .poll(
        async () => {
          const column = await drawnColumn();
          return column >= 7 && column < 8;
        },
        { timeout: 25_000 },
      )
      .toBe(true);
    const free = await serverTile();
    expect(free.x).toBeGreaterThan(14);
    expect(free.x).toBeLessThan(46);

    // And it STAYS there: the camera follows the walk rather than letting the
    // Character drift toward an edge of the window.
    const columns: number[] = [];
    for (let sample = 0; sample < 10; sample += 1) {
      columns.push(await drawnColumn());
      await page.waitForTimeout(200);
    }
    for (const column of columns) {
      expect(
        column,
        `drawn columns: ${columns.map((n) => n.toFixed(2)).join(', ')}`,
      ).toBeGreaterThan(6.5);
      expect(column, `drawn columns: ${columns.map((n) => n.toFixed(2)).join(', ')}`).toBeLessThan(
        8.5,
      );
    }

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

test.describe('§20 VIS — movement continuity, measured', () => {
  test('VIS12: the drawn Character does not jump between authoritative steps', async ({ page }) => {
    const characterId = await play(page);
    await enterHunt(page);
    await expect(page.getByTestId('tile-scene')).toBeVisible();

    const prisma = connect();
    try {
      // A long unobstructed walk: the Character at one end of a cleared
      // chamber, its encounter at the other, nothing in the way.
      await prisma.huntRun.updateMany({
        where: { characterId },
        data: { room: 4, creatures: [], position: { tile: { x: 19, y: 8, z: 7 } } },
      });
    } finally {
      await prisma.$disconnect();
    }
    await page.waitForTimeout(2500);

    /**
     * Where is the Character DRAWN, in tiles, this frame?
     *
     * Its body is the only strongly blue thing on screen — the floor and the
     * Rats are brown and the masonry is desaturated — so the centroid of the
     * blue pixels is the rendered position without instrumenting the renderer.
     */
    const samples = await page.evaluate(
      () =>
        new Promise<{ x: number; y: number; at: number }[]>((resolve) => {
          const canvas = document.querySelector('.tile-scene canvas') as HTMLCanvasElement;
          const context = canvas.getContext('2d', { willReadFrequently: true })!;
          const scale = canvas.width / 480;
          const taken: { x: number; y: number; at: number }[] = [];
          const started = performance.now();

          const sample = () => {
            const frame = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let sumX = 0;
            let sumY = 0;
            let count = 0;
            for (let index = 0; index < frame.length; index += 4) {
              const red = frame[index] ?? 0;
              const blue = frame[index + 2] ?? 0;
              if (blue - red < 50) continue;
              const pixel = index / 4;
              sumX += pixel % canvas.width;
              sumY += Math.floor(pixel / canvas.width);
              count += 1;
            }
            if (count > 0) {
              taken.push({
                x: sumX / count / scale / 32,
                y: sumY / count / scale / 32,
                at: performance.now(),
              });
            }
            if (performance.now() - started < 6000) requestAnimationFrame(sample);
            else resolve(taken);
          };
          requestAnimationFrame(sample);
        }),
    );

    expect(samples.length).toBeGreaterThan(30);

    // This is the SCREEN position, in tiles. The camera follows the Character
    // but EASES into place — a quarter of the remaining distance per frame —
    // so a teleport of a whole tile cannot be absorbed by it and still shows
    // up here as three quarters of a tile in a single frame.
    let worst = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1]!;
      const current = samples[index]!;
      const moved = Math.hypot(current.x - previous.x, current.y - previous.y);
      if (moved > worst) worst = moved;
    }

    // One authoritative step is one tile. A renderer that replayed only the
    // step in flight would sit still through a poll and then teleport several
    // tiles when the next snapshot landed; a continuous one never crosses more
    // than a fraction of a tile between two frames.
    expect(worst, `largest single-frame displacement: ${worst.toFixed(3)} tiles`).toBeLessThan(0.5);
  });
});
