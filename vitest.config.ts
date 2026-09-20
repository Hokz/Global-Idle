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
