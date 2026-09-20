// Flat config (ESLint 10 — there is no .eslintrc). Phase 0B spec §3.5, §3.6.
//
// ESLint is code quality plus IN-EDITOR mirrors of the most common boundary
// rules. It is NOT the boundary gate: dependency-cruiser is (§5.3), because it
// reasons over transitive edges and ESLint does not.
//
// The one place ESLint is load-bearing is ADR-010's determinism requirement:
// `Date.now` and `Math.random` are property accesses on globals, which no
// module-graph tool can see. `no-restricted-properties` closes that (W4, W5).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.next/**',
      'packages/domain/src/generated/**',
      'packages/game-data/bundles/**',
      'packages/domain/prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // ------------------------------------------------------------------ ADR-010: the engine is deterministic
  {
    files: ['packages/game-engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'ADR-010: the engine reads no clock. Time is a parameter — take an injected Clock or an elapsed Duration (§9.2). Test W4.',
        },
        {
          object: 'Math',
          property: 'random',
          message:
            'ADR-010: the engine draws from an injected SeededRandom, never a global (§9.2). Test W5.',
        },
        {
          object: 'process',
          property: 'env',
          message: 'ADR-010: the engine reads no environment. Configuration is a parameter (§9.2).',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: 'ADR-010: the engine does no scheduling (§9.2).' },
        { name: 'setInterval', message: 'ADR-010: the engine does no scheduling (§9.2).' },
        { name: 'fetch', message: 'ADR-010: the engine performs no I/O (§9.2).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'ADR-010: `new Date()` reads the ambient clock. Take an injected Clock or an elapsed Duration (§9.2). Test W4.',
        },
      ],
    },
  },

  // ------------------------------------------------------------------ the domain reads no ambient clock either
  {
    files: ['packages/domain/**/*.ts'],
    ignores: ['packages/domain/src/generated/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            '§7.1: every durable timestamp comes from the injected Clock. No Date.now() in domain code.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '§7.1: take the injected Clock rather than reading the ambient wall clock.',
        },
      ],
    },
  },

  // ------------------------------------------------------------------ the one legitimate ambient read
  {
    // SystemClock IS the implementation of §7.1's Clock port: it is the single
    // place the ambient wall clock may be read, which is exactly why every
    // other file must take the injected Clock instead. Confining the read to
    // one file is the rule's purpose, not an exception to it.
    files: ['packages/domain/src/platform/clock/index.ts'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-properties': 'off' },
  },

  // ------------------------------------------------------------------ in-editor mirrors of §5.2
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@global-idle/api', '@global-idle/worker', '@global-idle/web'],
              message:
                'Nothing in packages/ may depend on anything in apps/ (§5.1). The authoritative check is `pnpm boundaries`.',
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------------------------ tests and tooling
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts', '**/test-support/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    files: [
      '*.config.js',
      '*.config.ts',
      '*.cjs',
      'scripts/**/*.{js,mjs,cjs}',
      '**/scripts/**/*.{js,mjs,cjs}',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
);
