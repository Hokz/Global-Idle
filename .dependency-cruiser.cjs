/**
 * Dependency boundaries — the authoritative gate (Phase 0B spec §5.2, §5.3).
 *
 * Chosen over an ESLint plugin because it reasons over the module graph
 * INCLUDING TRANSITIVE EDGES: it can forbid a dependency that arrives two hops
 * away. ESLint `no-restricted-imports` mirrors the common cases for in-editor
 * feedback (eslint.config.js) but is DX, not the gate.
 *
 * Every rule below is `error`. A violation fails `pnpm boundaries` locally and
 * CI check 3. This file is configured in the first commit of 0B.1, before
 * there is anything to violate it, as ADR-012 requires.
 */

/** Frameworks and I/O clients the pure packages may never reach. */
const FRAMEWORKS = [
  '^@nestjs',
  '^next$',
  '^next/',
  '^react$',
  '^react-dom',
  '^@prisma/client',
  '^prisma$',
  '^ioredis$',
  '^bullmq$',
  '^express$',
  '^pino',
  '^prom-client$',
];

/** Node core modules that perform or enable I/O. */
const IO_CORE = [
  '^(node:)?fs$',
  '^(node:)?fs/promises$',
  '^(node:)?http$',
  '^(node:)?https$',
  '^(node:)?net$',
  '^(node:)?dgram$',
  '^(node:)?child_process$',
  '^(node:)?worker_threads$',
  '^(node:)?cluster$',
  '^(node:)?dns$',
  '^(node:)?tls$',
];

/**
 * Boundary analysis resolves workspace packages to their SOURCE.
 *
 * WITHOUT THIS THE GATE IS THEATRE. `@global-idle/domain` resolves through
 * pnpm's symlink and the package's `exports` map to dist/index.js, which
 * `doNotFollow`/`exclude` then drop — so a cruise of the workspace saw ZERO
 * cross-package edges and rules W6, W7 and W10 could never fire. Measured:
 * `apps/worker/src/main.ts -> @global-idle/domain` was absent from the graph.
 *
 * The fix is the inert `source` field on each workspace package.json plus
 * `exportsFields: []` in options below. Node and TypeScript ignore `source`
 * and still resolve through `exports` to dist (§3.3); only this cruise reads
 * it. That makes the rules STRICTER, not looser: the boundary question is
 * about the source module graph, and the rules are written against source
 * paths.
 */

module.exports = {
  forbidden: [
    // ---------------------------------------------------------------- the rule ADR-012 exists for
    {
      name: 'no-package-to-app',
      comment:
        'Nothing in packages/ may depend on anything in apps/. Ever. (§5.1, ADR-012, test W6)',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'api-not-worker',
      comment: 'apps/api may not import apps/worker on any path (§5.2, test W10).',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^apps/worker/' },
    },
    {
      name: 'worker-not-api',
      comment: 'apps/worker may not import apps/api on any path (§5.2, test W10).',
      severity: 'error',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'web-not-server-apps',
      comment:
        'apps/web may not import an apps/api or apps/worker internal (§5.2, test W7). ' +
        'Together with api-not-worker and worker-not-api this closes app-to-app entirely.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: ['^apps/api/', '^apps/worker/'] },
    },

    // ---------------------------------------------------------------- packages/game-engine — ADR-010
    {
      name: 'engine-no-frameworks-or-clients',
      comment:
        'The engine is pure simulation: no NestJS, Next, React, Prisma, Redis, BullMQ or ' +
        'transport type. (ADR-010, §5.2, tests W2 and W3)',
      severity: 'error',
      from: { path: '^packages/game-engine/' },
      to: { path: FRAMEWORKS },
    },
    {
      name: 'engine-no-io',
      comment: 'The engine performs no I/O of any kind (ADR-010, §9.2).',
      severity: 'error',
      from: { path: '^packages/game-engine/' },
      to: { path: IO_CORE, dependencyTypes: ['core'] },
    },
    {
      name: 'engine-only-shared',
      comment:
        'The engine may depend on packages/shared for types, and on nothing else in the ' +
        'workspace (§5.1).',
      severity: 'error',
      from: { path: '^packages/game-engine/' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/game-engine/', '^packages/shared/'],
      },
    },

    // ---------------------------------------------------------------- packages/game-data — Content context
    {
      name: 'game-data-no-engine-or-domain',
      comment:
        'game-data is the Content bounded context: build-time, versioned, read-only at ' +
        'runtime. It may not import game-engine or domain (§5.2, §10.1).',
      severity: 'error',
      from: { path: '^packages/game-data/' },
      to: { path: ['^packages/game-engine/', '^packages/domain/'] },
    },
    {
      name: 'game-data-no-frameworks',
      comment: 'game-data imports no framework and no persistence client (§5.2, §10.1).',
      severity: 'error',
      from: { path: '^packages/game-data/' },
      to: { path: FRAMEWORKS },
    },

    // ---------------------------------------------------------------- packages/shared — pure contracts
    {
      name: 'shared-is-pure',
      comment:
        'packages/shared holds contracts and pure helpers. It may not import any other ' +
        'workspace package, any framework, or any I/O (§5.2).',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: ['^packages/(?!shared/)', '^apps/', ...FRAMEWORKS] },
    },
    {
      name: 'shared-no-io',
      comment: 'packages/shared performs no I/O (§5.2).',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: IO_CORE, dependencyTypes: ['core'] },
    },

    // ---------------------------------------------------------------- packages/domain — the application core
    {
      name: 'domain-no-ui-or-transport',
      comment:
        'packages/domain owns the bounded contexts and may carry Prisma, but never a UI ' +
        'framework or an HTTP transport type (§5.2, ADR-018).',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { path: ['^next$', '^next/', '^react$', '^react-dom', '^express$'] },
    },

    // ---------------------------------------------------------------- context public surfaces — W11
    {
      name: 'domain-context-public-surface-only',
      comment:
        'A bounded context is reachable only through contexts/<name>/index.ts. Reaching past ' +
        'it is a boundary violation inside the package as much as across it. ' +
        '(ADR-012 rule retained by ADR-018, §4.2, test W11)',
      severity: 'error',
      from: { pathNot: '^packages/domain/src/contexts/' },
      to: {
        path: '^packages/domain/src/contexts/[^/]+/.+',
        pathNot: '^packages/domain/src/contexts/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'domain-no-cross-context-internals',
      comment:
        "One context may not reach into another context's internals — only its index.ts " +
        '(ADR-001 single ownership, §4.1, test W8).',
      severity: 'error',
      from: { path: '^packages/domain/src/contexts/([^/]+)/' },
      to: {
        path: '^packages/domain/src/contexts/([^/]+)/.+',
        pathNot: [
          '^packages/domain/src/contexts/$1/',
          '^packages/domain/src/contexts/[^/]+/index\\.ts$',
        ],
      },
    },

    // ---------------------------------------------------------------- apps/web — CLIENT_SERVER_BOUNDARIES
    {
      name: 'web-no-server-internals',
      comment:
        'The web client renders; it never decides. No Prisma, no Redis, no engine, no domain ' +
        '(§5.2, CLIENT_SERVER_BOUNDARIES.md, test W7).',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: {
        path: [
          '^@prisma/client',
          '^prisma$',
          '^ioredis$',
          '^bullmq$',
          '^packages/game-engine/',
          '^packages/domain/',
        ],
      },
    },

    // ---------------------------------------------------------------- hygiene
    {
      name: 'not-to-unresolvable',
      comment:
        'An import that does not resolve is either a typo or an UNDECLARED dependency that ' +
        "pnpm's isolated linker is refusing to hoist into existence (§3.1). Both are errors. " +
        'This is also what makes test W7 bite: apps/web importing @global-idle/domain cannot ' +
        'resolve, because domain is not one of its declared dependencies — without this rule ' +
        'the violation would simply produce no edge and no finding.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      comment: 'A cycle makes ownership unanswerable (ADR-001).',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'An unreachable module is dead weight; delete it or wire it up.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '(^|/)(eslint|vitest|next|prettier)\\.config\\.(js|cjs|mjs|ts)$',
          '(^|/)prisma\\.config\\.ts$',
          // Entry points are legitimately unimported within the cruise:
          // a package's public surface and an app's process entry.
          '^packages/[^/]+/src/index\\.ts$',
          '^apps/(api|worker)/src/main\\.ts$',
          // Next.js routes the app/ directory by convention; nothing imports them.
          '^apps/web/app/',
          '^apps/web/next\\.config\\.ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '(^|/)dist/',
        '(^|/)coverage/',
        '(^|/)\\.next/',
        '(^|/)src/generated/',
        // Declaration files are not source. This repository authors none —
        // every .d.ts here is generated (next-env.d.ts, Prisma's emitted
        // types) — and the boundary rules are about the source module graph.
        // Cruising them only reports the framework's own subpath exports.
        '\\.d\\.ts$',
        '\\.test\\.ts$',
        '\\.spec\\.ts$',
        '(^|/)tests?/',
      ],
    },
    // Type-only imports count: importing a type from an app is still an
    // app-to-app edge, and the boundary rules are about the module graph,
    // not about what survives erasure.
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      // exportsFields is EMPTY on purpose. With the `exports` map in play,
      // `@global-idle/domain` resolves to packages/domain/dist/index.js, which
      // carries no source structure for the rules to match. Ignoring it lets
      // mainFields pick the `source` field instead, so the cruise sees
      // packages/domain/src/index.ts — source to source.
      exportsFields: [],
      mainFields: ['source', 'module', 'main'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      mainFiles: ['index'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
