// One config file, four projects (§3.7). `vitest.workspace.ts` was removed in
// Vitest 4; `test.projects` replaces it. §13 selects a project with --project.
import { defineConfig } from 'vitest/config';

const shared = {
  globals: false,
  restoreMocks: true,
  clearMocks: true,
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          include: ['{packages,apps}/*/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          environment: 'node',
          // The §14.1 cases drive the real commands — depcruise, eslint, tsc -b —
          // because a boundary test that reasons about the rules instead of
          // running them proves nothing about the gate CI uses. That costs
          // seconds per case, so the default 5s timeout does not apply here.
          testTimeout: 180_000,
          hookTimeout: 180_000,
          // These cases write a real violation into the working tree and then
          // run the real command. Two such files in parallel see each other's
          // violations, so a case can fail on a finding that belongs to another
          // test. They are sequential by necessity, not by preference.
          fileParallelism: false,
        },
      },
      {
        test: {
          ...shared,
          name: 'fixtures',
          include: ['tests/fixtures/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          ...shared,
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/global-setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          ...shared,
          name: 'invariants',
          include: ['tests/invariants/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/global-setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
