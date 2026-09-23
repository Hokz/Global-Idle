/**
 * The PUBLIC Rookgaard reference raster (Phase 3.7 spec §3.1, §9).
 *
 * Independently authored here, procedurally: an island silhouette, a coast, a
 * road, a town cluster and some terrain, generated from a fixed seed so it is
 * byte-identical on every machine and in every CI run. It is this project's
 * own art. It carries no `appearanceId` and no `spriteId`, because it has no
 * source to cite, and inventing one would be the same lie as inventing a
 * coordinate.
 *
 * It is a PLACEHOLDER and it says so: the shape is suggestive of an island,
 * not a survey of Rookgaard. A private reference raster may replace it in
 * development through the dev-only loader; in a public build this is the only
 * thing that exists.
 */

/** The placeholder raster's own size. Small on purpose: a pixel preview. */
export const RASTER_SIZE = 512;

/** Deterministic value noise. Same seed, same island, forever. */
function noise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number, scale: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const ex = ease(fx);
  const ey = ease(fy);
  const a = noise(x0, y0, seed);
  const b = noise(x0 + 1, y0, seed);
  const c = noise(x0, y0 + 1, seed);
  const d = noise(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * ex) * (1 - ey) + (c + (d - c) * ex) * ey;
}

const PALETTE = {
  deep: [26, 62, 112],
  sea: [38, 86, 148],
  shallow: [58, 116, 172],
  sand: [198, 178, 122],
  grass: [66, 108, 56],
  grassDark: [50, 88, 44],
  rock: [120, 122, 118],
  road: [126, 104, 74],
  roof: [140, 78, 54],
  wall: [188, 176, 152],
} as const;

/**
 * Paint the placeholder island into an `ImageData`-shaped buffer.
 *
 * Kept as a pure RGBA writer so a unit test can assert the raster is stable
 * and a canvas can blit it without either knowing about the other.
 */
export function paintAtlasRaster(size = RASTER_SIZE): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const centre = size / 2;

  const put = (index: number, rgb: readonly number[]) => {
    pixels[index] = rgb[0]!;
    pixels[index + 1] = rgb[1]!;
    pixels[index + 2] = rgb[2]!;
    pixels[index + 3] = 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      // A lumpy radial falloff makes a coastline that is not a circle.
      const dx = (x - centre) / centre;
      const dy = (y - centre * 0.94) / centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const wobble = smoothNoise(x, y, 11, 48) * 0.42 + smoothNoise(x, y, 23, 17) * 0.1;
      const land = 0.86 - distance + wobble * 0.5;

      if (land < -0.02) {
        put(index, PALETTE.deep);
      } else if (land < 0.03) {
        put(index, PALETTE.sea);
      } else if (land < 0.07) {
        put(index, PALETTE.shallow);
      } else if (land < 0.11) {
        put(index, PALETTE.sand);
      } else {
        const texture = smoothNoise(x, y, 7, 9);
        if (texture > 0.74) put(index, PALETTE.rock);
        else if (texture > 0.44) put(index, PALETTE.grass);
        else put(index, PALETTE.grassDark);
      }
    }
  }

  // A road crossing the island, and a small town cluster where it meets.
  const road = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const px = cx + ox;
          const py = cy + oy;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          put((py * size + px) * 4, PALETTE.road);
        }
      }
    }
  };
  road(
    Math.round(size * 0.24),
    Math.round(size * 0.58),
    Math.round(size * 0.52),
    Math.round(size * 0.5),
  );
  road(
    Math.round(size * 0.52),
    Math.round(size * 0.5),
    Math.round(size * 0.74),
    Math.round(size * 0.62),
  );
  road(
    Math.round(size * 0.52),
    Math.round(size * 0.5),
    Math.round(size * 0.5),
    Math.round(size * 0.28),
  );

  const building = (bx: number, by: number, w: number, h: number) => {
    for (let y = by; y < by + h; y += 1) {
      for (let x = bx; x < bx + w; x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const edge = x === bx || y === by || x === bx + w - 1 || y === by + h - 1;
        put((y * size + x) * 4, edge ? PALETTE.wall : PALETTE.roof);
      }
    }
  };
  const townX = Math.round(size * 0.5);
  const townY = Math.round(size * 0.5);
  for (const [ox, oy, w, h] of [
    [-34, -18, 16, 12],
    [-12, -26, 14, 11],
    [8, -14, 18, 13],
    [-28, 8, 13, 10],
    [4, 10, 15, 12],
    [26, 2, 12, 10],
  ] as const) {
    building(townX + ox, townY + oy, w, h);
  }

  return pixels;
}

/** A cheap stable digest, so a test can prove the raster never drifts. */
export function rasterFingerprint(pixels: Uint8ClampedArray): number {
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 997) {
    hash ^= pixels[index]!;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The city placeholder's own size — a closer view, not more source data. */
export const CITY_RASTER_SIZE = 256;

/**
 * The PUBLIC Rookgaard town placeholder.
 *
 * A street plan shape: grass, a crossroads, a plaza and a few buildings. Like
 * the island above it is this project's own procedural art, generated from a
 * fixed seed. It is NOT a survey: no building here corresponds to a real
 * Rookgaard structure, which is why every pin placed on it renders `demo`.
 */
export function paintCityRaster(size = CITY_RASTER_SIZE): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const put = (index: number, rgb: readonly number[]) => {
    pixels[index] = rgb[0]!;
    pixels[index + 1] = rgb[1]!;
    pixels[index + 2] = rgb[2]!;
    pixels[index + 3] = 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const texture = smoothNoise(x, y, 5, 7);
      put((y * size + x) * 4, texture > 0.55 ? PALETTE.grass : PALETTE.grassDark);
    }
  }

  const band = (x0: number, y0: number, x1: number, y1: number, width: number) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        for (let w = 0; w < width; w += 1) {
          const px = x1 === x0 ? x + w : x;
          const py = y1 === y0 ? y + w : y;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          put((py * size + px) * 4, PALETTE.road);
        }
      }
    }
  };
  const mid = Math.round(size / 2);
  band(8, mid, size - 9, mid, 7); // the east–west road
  band(mid, 8, mid, size - 9, 7); // the north–south road

  const building = (bx: number, by: number, w: number, h: number) => {
    for (let y = by; y < by + h; y += 1) {
      for (let x = bx; x < bx + w; x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const edge = x === bx || y === by || x === bx + w - 1 || y === by + h - 1;
        put((y * size + x) * 4, edge ? PALETTE.wall : PALETTE.roof);
      }
    }
  };
  for (const [bx, by, w, h] of [
    [30, 30, 40, 30],
    [150, 26, 46, 34],
    [26, 150, 42, 36],
    [160, 156, 38, 30],
    [104, 74, 28, 22],
    [96, 168, 34, 26],
  ] as const) {
    building(bx, by, w, h);
  }

  // A plaza of pale stone where the roads meet, so the centre reads as a place.
  for (let y = mid - 14; y < mid + 18; y += 1) {
    for (let x = mid - 16; x < mid + 20; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if (smoothNoise(x, y, 31, 5) > 0.35) put((y * size + x) * 4, PALETTE.rock);
    }
  }
  return pixels;
}
