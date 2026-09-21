/**
 * Phase 1 browser acceptance (spec §15, P1-D9).
 *
 * Behaviour, not pixels: roles, names and state. Pixel baselines over
 * placeholder art that is about to be replaced (§11) would be noise with no
 * information in it.
 *
 * Chromium only. Three engines triple install and runtime for a slice with one
 * flow, and the flow is the thing under test.
 */
import { defineConfig, devices } from '@playwright/test';

const WEB = process.env['E2E_WEB_BASE'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['list']] : [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },

  /**
   * Playwright OWNS the stack. Starting the API and the web server by hand and
   * hoping they survive is how a run reports a UI bug that is really a dead
   * process — which is exactly what happened while this suite was written.
   * `reuseExistingServer` keeps a developer's own `pnpm dev` from being
   * duplicated locally, and CI always starts clean.
   */
  webServer: [
    {
      // `--env-file-if-exists` so a developer's own .env supplies DATABASE_URL
      // and REDIS_URL, exactly as `pnpm dev` does. Measured: Node does NOT let
      // the file override a variable already set in the environment, so CI's
      // own values still win and the flag is a no-op there.
      command: 'node --env-file-if-exists=.env apps/api/dist/main.js',
      url: 'http://127.0.0.1:3001/health/live',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        GLOBAL_IDLE_DEV_AUTH: '1',
        API_PORT: '3001',
        LOG_LEVEL: 'error',
      },
    },
    {
      command: 'pnpm --filter @global-idle/web exec next start -p 3000',
      url: WEB,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Touch/mobile acceptance is Playwright DEVICE EMULATION at the §15
    // viewport — emulation, not a real device, and the spec says so rather
    // than implying coverage it does not have. The descriptor is spelled out
    // instead of reusing `devices['iPhone 13']` because that descriptor pins
    // `browserName: 'webkit'`, and this suite is Chromium-only (above).
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
