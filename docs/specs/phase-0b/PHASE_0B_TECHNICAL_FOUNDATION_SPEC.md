# Phase 0B — Technical Foundation: Implementation Specification

**Document status:** **`VERIFIED`** — implemented and independently reviewed; see
[`PHASE_0B_FOUNDATION_REVIEW.md`](./PHASE_0B_FOUNDATION_REVIEW.md)
**Approved:** 2026-09-20 — by the Product Owner, after five rounds of independent review
**Verified:** 2026-09-21 — Product Owner accepted the independent review of `922e1c3cc5b966632c900931417242857239136a`
**Phase:** 0B — Technical Foundation
**Baseline:** Phase 0A, `ARCHITECTURE_APPROVED`, `ADR-001`–`ADR-017` `ACCEPTED`; `ADR-018`
`ACCEPTED` with this specification
**Entry point for the architecture it implements:** [`../../architecture/ARCHITECTURE_OVERVIEW.md`](../../architecture/ARCHITECTURE_OVERVIEW.md)

> **Superseded in part — 2026-09-24.** This specification implemented `ADR-007`'s retirement
> model: `retiredAt`, I1 as a unique index partial over non-retired rows, invariant I12 *"a
> Character is never hard-deleted"*, `retireCharacter` with no delete counterpart, and the tests
> `D5` and `D6`. The Product Owner has since replaced retirement with a 30-day reversible grace
> followed by a hard purge —
> [`ADR-020`](../../architecture/decisions/ADR-020-character-deletion-grace-and-purge.md), which
> supersedes `ADR-007`. Nothing below is rewritten: it remains the accurate record of what Phase 0B
> built and verified, and that code stays in place until the PRE-PHASE-4 gate replaces it
> ([`PHASE_GATES.md`](../../PHASE_GATES.md) § *G4.1*). Where the text below states the retirement
> rule, read it as history, not as the current rule.

> **Superseded in part — 2026-09-25.** This specification's roster rules — `rosterCapacity` 1–5,
> and I1 and I2 over up to five equivalent Characters per Account — were written for a roster the
> Product Owner has since replaced: a Game Account has one Main Character, and further vocations
> are companions
> ([`ADR-022`](../../architecture/decisions/ADR-022-game-account-main-character-and-companions.md)).
> Nothing below is rewritten; it remains the record of what Phase 0B built and verified. Where it
> describes the roster as equivalent Characters, read it as history; the current rules are in
> [`DOMAIN_MODEL.md`](../../architecture/DOMAIN_MODEL.md) §5.1–§5.5 and §7.

> This document is a **specification**. It contains no implementation. Its job is to make the
> implementing phase unambiguous: exact tooling, exact boundaries, exact contracts, exact tests,
> and an objective Definition of Done.
>
> It is now `IMPLEMENTATION_SPEC_READY`. Implementation happens on a separate branch and pull
> request, and **nothing in this document is re-opened by the implementing phase**: a primitive
> that genuinely cannot be built within it is a new superseding ADR, never a quiet deviation.

---

## 1. What Phase 0B is

**Build the reusable technical foundation. Do not build the game.**

Phase 0B produces the primitives that Phases 1, 2, 4, 7 and 8 will consume: a workspace with
enforced boundaries, a database that enforces the load-bearing invariants below the application
layer, and **seven** domain primitives whose correctness is provable without any gameplay balance
existing yet.

### In scope

| | |
|---|---|
| Workspace, tooling, dependency-boundary enforcement | 0B.1, 0B.2 |
| PostgreSQL, migrations, constraints | 0B.3 |
| Character occupancy claims, and durable Skill Training activity state | 0B.6, 0B.3 |
| Stamina durable state, activity classification and mode derivation | 0B.5 |
| `ActiveUseTimer` | 0B.5 |
| Account entitlement / Premium state | 0B.5 |
| Server time interface | 0B.5 |
| Idempotency: client keys and settlement operation ids | 0B.4 |
| Content bundle resolver contract | 0B.7 |
| Redis, local infrastructure, health, observability | 0B.8, 0B.9 |
| CI and the test harness | 0B.10 |

### Explicitly out of scope

- the Hunt simulation loop, room progression, encounters, creature AI;
- Hunt reward balance — XP curves, gold, loot tables, rarity, affixes;
- the Premium XP band's *gameplay effect* (the entitlement state exists; the reward maths does
  not);
- login UI, character creation UI, world map, any gameplay screen;
- Forge, Market, Wheel, Skill Tree, Imbuement application;
- authoring creature, item or hunt content;
- Skill Training **rates**, Exercise Weapon economy or skill progression formulas — only the durable lifecycle exists;
- payment or store flows.

**A useful test of scope:** if a deliverable requires a balance number to be correct, it is not
Phase 0B. Phase 0B builds the machine; Phase 2 sets the dials.

---

## 2. Authority

This specification is subordinate to the approved architecture. Where they differ, the
architecture wins and this document is wrong.

| Constraint | Source | Binds |
|---|---|---|
| Seven bounded contexts, one owner per state | `ADR-001` | §5, §6 |
| Settlement is the only path to durable progression | `ADR-002` | §7, §8 |
| Ledger-derived balances | `ADR-003` | §6, §8 |
| Single item custody | `ADR-004` | §6 |
| Active Party is configuration | `ADR-005` | §6 |
| Participant profile refresh at checkpoints | `ADR-006` | §9 |
| Character retirement, not deletion | `ADR-007` | §6 |
| Newest connection evicts | `ADR-008` | §7, §8 |
| PostgreSQL sole durable truth | `ADR-009` | §6, §10 |
| Pure engine, injected clock and RNG | `ADR-010` | §9 |
| Content is a versioned bundle | `ADR-011` | §11 |
| One modular monolith, build-enforced boundaries | `ADR-012` | §4, §5 |
| One occupancy claim per Character | `ADR-013` | §7 |
| Per-Character Stamina | `ADR-014` | §7 |
| Active-use timers settle at checkpoints | `ADR-015` | §7 |
| Referenced content bundles never removed | `ADR-016` | §11 |
| Account-scoped, fingerprinted idempotency keys | `ADR-017` | §7, §8 |
| Bounded contexts live in `packages/domain` — amends `ADR-012`'s source layout only | `ADR-018` | §4, §5 |

`ADR-018` was raised by this specification and stood `PROPOSED` until the Product Owner accepted
it alongside this document. It is listed here because it is now binding on implementation exactly
as the other seventeen are — and because §4.1 records precisely which two clauses of `ADR-012` it
supersedes and which stand.

**If implementation discovers that a primitive genuinely cannot be built within an accepted
boundary, the answer is a new superseding ADR — never an edit to accepted history, and never a
quiet deviation.**

---

## 3. Tooling decisions

Every choice below is `DECIDED IN PHASE 0B SPEC` with its rationale. They are defensible, not
sacred: the independent reviewer may reverse any of them.

### 3.1 Package manager — **pnpm workspaces**

Chosen over npm and yarn for one reason that matters more than speed: **pnpm's strict
`node_modules` layout makes an undeclared dependency fail at module resolution.** A package
that forgets to declare a dependency cannot accidentally import it through hoisting. That is a
second, independent layer of boundary enforcement underneath the lint rules in §5.3 — and
`ADR-012` requires boundaries the build enforces rather than a style guide.

`pnpm -r run <task>` already executes in topological order, so the workspace graph drives task
order without extra tooling.

### 3.2 Task runner — **none initially**

`pnpm -r` and `pnpm --filter` cover the whole task surface for seven workspaces. Turborepo is the
designated upgrade path, and the trigger is explicit: **adopt it when CI wall time for the
default pipeline exceeds roughly ten minutes, or when remote caching becomes worth configuring.**
Recording the trigger prevents adding it reflexively now and prevents arguing about it later.

### 3.3 Internal package format — **composite packages, `tsc -b`**

An earlier draft of this specification said "source-only, no build step" *and* "project
references". That was incoherent: TypeScript project references consume the referenced project's
**emitted declarations**, and `tsc --build` builds those projects. The two claims cannot both be
true, and the independent review was right to block on it.

**Decision: Option B — composite packages with project references.** Boring, well-trodden, and
the same resolution model in the editor, typecheck, tests and production build.

Each internal package:

```jsonc
// packages/<name>/tsconfig.json
{ "compilerOptions": { "composite": true, "declaration": true, "declarationMap": true,
                       "sourceMap": true, "rootDir": "src", "outDir": "dist" } }
```

```jsonc
// packages/<name>/package.json
{ "main": "./dist/index.js", "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } } }
```

- the root `tsconfig.json` is a **solution file** — `"files": []` plus `references` to **six**
  composite projects: the four packages **and `apps/api` and `apps/worker`**. Each project
  references what it imports. `apps/web` is the deliberate exception, explained in §4.4;
- `pnpm build` generates the Prisma client, runs **`tsc -b`** at the root — which builds the six
  referenced projects in dependency order, emitting `apps/api/dist` and `apps/worker/dist` too —
  and then `next build` for `apps/web`. **`tsc -b` is the only compiler for `api` and `worker`;
  `nest build` is not used** (§4.4). **§4.3 is the authoritative script list**; this bullet is
  the shape, not a second definition;
- `pnpm dev` runs `pnpm generate` once, then `tsc -b --watch` alongside `node --watch` for the two
  Node apps and `next dev` for the web app;
- **Vitest resolves packages through their `exports` map**, i.e. the built output, so tests and
  production agree. There is no source alias that could let tests pass against code the build
  would reject.

**Why not the source-only model.** It requires every consumer to transpile workspace TypeScript
itself. Next.js supports that through `transpilePackages`, but the NestJS path does not: a
`tsc` build with `paths` does not rewrite those paths in the emitted JavaScript, so the output
needs a runtime resolver — a well-known footgun, and one that makes the editor, the test runner
and the production build disagree about where a module comes from. Paying a build step for three
small packages is the cheaper side of that trade.

**Consequence to accept:** `pnpm build` must run before `pnpm test` on a clean checkout, and
`prisma generate` must run before both. That ordering is specified end to end in **§4.3** and
asserted by **W12** (§15, 0B.2) rather than left as folklore.

### 3.4 TypeScript — **`~6.0.3`, ESM everywhere, one shared base config**

**Version: `typescript@~6.0.3`**, not the `latest` tag. Researched, September 2026: npm `latest`
is **7.0.2** (2026‑07‑08) — the native compiler line — while **NestJS 12's own CLI pins
`typescript ~6.0.2`** and its generated project template declares `^6.0.2`. A foundation phase
does not put its API framework on a compiler its framework's toolchain has not adopted. TypeScript
6.0 is the last JavaScript-based line and already errors on the options 7.0 removes, so **nothing
in the configuration below is on that removal list** — no `baseUrl`, no `node10` resolution, no
`outFile`. TypeScript 7 is the designated upgrade, triggered when the NestJS CLI moves (§18).

**Module format: ESM, in every workspace.** This is not a preference; three pinned dependencies
decide it. `@nestjs/core@12` and `@nestjs/common@12` ship as **`"type": "module"` with no
CommonJS entry point**, so a CommonJS API is not available at all; `uuid@14` and `zod@4` are
ESM-only packages; Vitest 5 and the `prisma-client` generator (§3.8) are ESM-native. Every
workspace `package.json` therefore declares `"type": "module"`, relative imports carry the `.js`
extension `nodenext` requires, and the Prisma generator emits ESM (§4.3). The one place where
"choose" was still possible — the generated client's `moduleFormat` — is set explicitly rather
than inferred, so the decision is visible in the schema file.

`tsconfig.base.json` at the root, extended by every workspace:

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",                       // NestJS 12's template target; Node 24 covers it fully
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

`noUncheckedIndexedAccess` is called out because this codebase indexes into party arrays and
content maps constantly, and it is the option that turns a whole class of runtime `undefined`
into a compile error.

Per workspace:

| Workspace | Adds | Why |
|---|---|---|
| `packages/*` | `composite: true`, `rootDir: "src"`, `outDir: "dist"` | project-reference targets (§3.3) |
| `apps/api`, `apps/worker` | `composite: true`, `rootDir: "src"`, `outDir: "dist"`, **`experimentalDecorators`, `emitDecoratorMetadata`** | referenced projects built by `tsc -b`; NestJS 12 still uses legacy decorators with metadata — both options are present in TypeScript 6.0 |
| `apps/web` | Next.js's own managed options (`noEmit`, `jsx`, `bundler` resolution, the `next` plugin) over the base's strictness block | Next.js writes these itself; the app extends the base for **strictness only** — see §4.4 for why it is not a project reference |

`verbatimModuleSyntax` is deliberately **not** set: with `isolatedModules` it adds nothing this
graph needs, and it forbids the `import x = require()` interop that a CJS-only dependency such as
`pino` occasionally needs.

### 3.5 Lint and format — **ESLint (flat config) + Prettier**

Ordinary code quality. Prettier owns formatting; ESLint does not fight it.

### 3.6 Dependency-boundary enforcement — **dependency-cruiser**

The authoritative boundary check (§5.3). Chosen over an ESLint plugin because it reasons over
the **module graph including transitive edges**, can forbid a dependency that arrives two hops
away, and emits a graph artifact for review. It runs locally and in CI, and a violation fails
the build.

ESLint `no-restricted-imports` may mirror the most common rules for in-editor feedback. It is
DX, not the gate.

### 3.7 Test framework — **Vitest**

**Vitest 5** (`^5.0.1`, 2026‑09‑15). Chosen over Jest for this repository specifically: its
`projects` configuration maps onto pnpm workspaces, and its fake-timer control — including moving
a clock **backwards** — is what §7.1.1 and §14.5 need. NestJS 12's own project template now ships
Vitest rather than Jest, so this is no longer even a divergence from the API framework.

**One config file, four projects.** `vitest.config.ts` at the root declares `test.projects` —
`unit`, `fixtures`, `integration`, `invariants` — and §13 selects them with `--project`. An
earlier draft named a `vitest.workspace.ts`; **that file format was removed in Vitest 4**, and
naming it would have sent the builder to a mechanism the pinned version does not have.

**Resolution matches production.** Vitest resolves internal packages through their `exports`
maps, i.e. the **built output** of §3.3, so there is no source alias that could let a test pass
against code the build would reject. `pnpm build` therefore runs before `pnpm test` — asserted by
test W12 from a clean checkout.

Integration tests use **Testcontainers** for ephemeral PostgreSQL and Redis, so a developer and
CI run the same thing and neither depends on a hand-started database.

### 3.8 ORM — **Prisma 7.10.x**, with the `partialIndexes` preview feature

Prisma as the approved architecture states. The **version policy is pinned deliberately**, because
two invariants in §6.4 depend on a capability whose availability changed recently.

**Researched, September 2026:**

| Fact | Source |
|---|---|
| Partial indexes arrived in **Prisma ORM 7.4** (February 2026) behind the `partialIndexes` **preview feature** — a `where` argument on `@@index`, `@@unique` and `@unique` | Prisma changelog 2026‑02‑11 |
| **Prisma 8** (August 2026) promotes expression, partial and unique indexes to **direct schema authoring**, no preview flag | Prisma changelog 2026‑08‑02 |
| `@prisma/client` npm **`latest` = 7.10.0** | npm dist-tags |
| `prisma` CLI npm **`latest` = 8.0.0-rc.15**, `prev` = 7.10.0 | npm dist-tags |
| **`prisma@7.10.0` and `@prisma/client@7.10.0` `engines`: `^20.19 \|\| ^22.12 \|\| >=24.0`** | the pinned packages' own `package.json`, read from the registry |
| `prisma@8.0.0-rc.15` `engines`: `>=22.18.0` | **Prisma 8's** requirement — recorded so it is not mistaken for the pinned toolchain's (§3.10) |
| `@prisma/config@7.10.0`: `defineConfig({ schema, datasource: { url }, migrations: { path, seed } })`; `env(name)` reads `process.env` **eagerly** and throws `PrismaConfigEnvError` when unset; the package does **not** load `.env` itself | the package's published typings and source |
| Prisma 7 schema validation: *"The datasource property `url` is no longer supported in schema files. Move connection URLs for Migrate to `prisma.config.ts` and pass either `adapter` for a direct database connection or `accelerateUrl` … to the `PrismaClient` constructor."* | the pinned schema engine's own diagnostic text |
| `@prisma/client@7.10.0`: *"A driver adapter is required to connect to your database."* | the pinned client runtime's own diagnostic text |
| `prisma-client` generator (`@prisma/client-generator-ts@7.10.0`): `output` **required**; `runtime` ∈ `nodejs`, `deno`, `bun`, `workerd`, `cloudflare`, `vercel-edge`, `edge-light`; `moduleFormat` ∈ `esm`, `cjs` (inferred from `tsconfig`/`package.json` when omitted); `generatedFileExtension` ∈ `ts`, `mts`, `cts` (default `ts`); `importFileExtension` ∈ `""`, `ts`, `mts`, `cts`, `js`, `mjs`, `cjs` (inferred when omitted) | the generator package's source |
| Partial-index `where`: **an object literal or `raw("…")`**. The object form accepts `true`, `false`, `null`, a string, a number, or exactly one of `{ not: … }`; anything else is refused with *"cannot be used in the object syntax of a where clause. Use raw() instead."* | the pinned schema engine's own diagnostic text |

**Decision: pin `prisma` and `@prisma/client` to `7.10.x` and enable the `partialIndexes`
preview feature.**

Rationale: Prisma 8 is a **release candidate**, not generally available — the `prisma` CLI's
`latest` tag points at an RC while `@prisma/client`'s points at stable 7.10.0. A foundation
phase should not pin a project to a pre-release. Prisma 7.4+ already provides the capability
this specification needs; the only cost is a preview flag.

**Generator: `prisma-client`, not `prisma-client-js`.** An earlier draft used
`prisma-client-js`. The independent review is right that a greenfield Prisma 7 project has no
reason to start on the legacy generator: `prisma-client` is the generator Prisma 7 documents as
current, and — verifiably, from its source — it is the one that carries the **`runtime`,
`moduleFormat`, `generatedFileExtension` and `importFileExtension`** controls this build model
needs to make the generated code agree with §3.4's ESM decision. The full generator block, the
config file and the adapter wiring are in §4.3.

**Partial-index predicates: object form where it fits, `raw()` where it does not.** An earlier
draft wrote I9 as `where: { state: { in: [ONLINE_ACTIVE, RECONNECT_GRACE_PAUSED] } }`. **That is
not valid in the pinned version** — the object form has no `in`, as the schema engine's own
diagnostic states — and the review was right to block. The corrected declarations:

| Invariant | Declaration in `schema.prisma` | Form |
|---|---|---|
| I1 — one playable Character per vocation per account | `@@unique([accountId, vocation], where: { retiredAt: null })` | object — `null` equality is supported |
| I9 — one non-terminal session-bound Activity per account | `@@unique([accountId], where: raw("state IN ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED')"))` | `raw()` — an `IN` list has no object form |
| A wall-clock activity has **at most one** participant (§6.3.1) | `@@unique([activityId], where: raw("family = 'WALL_CLOCK'"))` | `raw()` — an enum comparison is kept in `raw()` rather than relying on string coercion |

Column names in the `raw()` predicates are all-lowercase identifiers, so they need no quoting in
PostgreSQL; a camel-case column would.

> **A `raw()` predicate is not hand-written migration SQL.** It is a declaration in
> `schema.prisma` from which **Prisma Migrate generates** the `CREATE UNIQUE INDEX … WHERE (…)`
> statement. The rule that hand-written migration SQL is authorized only where genuinely needed
> — the two cases in the table above, and no others — is unchanged, and **D13** proves the
> generated SQL, not the schema file, carries each predicate.

> **The earlier claim that "Prisma cannot express a partial unique index declaratively" is
> withdrawn.** It was true of older Prisma and is not true of the pinned version. **Invariants
> I1 and I9 are expressed declaratively in `schema.prisma`**, not in raw SQL.

**Designated upgrade:** move to Prisma 8 once it reaches GA and drop the preview flag. Nothing
in this specification changes at that point — the `where` syntax is the same; it merely stops
being a preview.

**Hand-written SQL is used for exactly two things**, justified individually:

| Hand-written SQL | Why no ORM can express it |
|---|---|
| Ledger role grants — `REVOKE UPDATE, DELETE ON "LedgerEntry" FROM <app role>` | A database **permission**, not a schema object. No ORM models it, and this is what makes invariant I6 (`ADR-003`, append-only ledger) true for a developer who has not read the ADR. |
| Two `CHECK` constraints pinning each activity subtype to its family — `CHECK ("family" = 'SESSION_BOUND')` on `SessionBoundActivity` and `CHECK ("family" = 'WALL_CLOCK')` on `SkillTrainingActivity` | Prisma has no declarative `CHECK`. These two lines, together with the composite foreign keys already present, make **two** of §6.3.3's three invalid subtype states unrepresentable rather than merely detectable — see §6.3.3 for the full argument and for the reviewer instruction they are weighed against |

No other hand-written SQL is authorized by this specification. If implementation finds it needs
more, that is a finding to report, not a decision to take quietly.

### 3.9 Supporting libraries

Versions are the **`latest` npm dist-tag as of 2026‑09‑20**, read from the registry, and are
recorded as caret ranges within the major named here. The lockfile pins the exact resolution.

| Concern | Choice | Pinned line | Note |
|---|---|---|---|
| API framework | **NestJS** | `@nestjs/{core,common,platform-express,testing}@^12.0.3` | pure ESM (§3.4); `reflect-metadata@^0.2.2` |
| Web framework | **Next.js** | `next@^16.3.5` | manages its own `tsconfig` (§4.4) |
| ORM | **Prisma** | `prisma@7.10.0`, `@prisma/client@7.10.0`, **`@prisma/adapter-pg@7.10.0`**, `pg@^8.23.0` | exact on the Prisma packages (§3.8); the adapter is **required** by the Prisma 7 client (§4.3) |
| Config validation | **zod** | `zod@^4.6.5` | validated at boot; the process refuses to start on invalid config |
| Logging | **pino** | `pino@^10.3.1`, `nestjs-pino@^5.2.0` | structured JSON; `nestjs-pino` supports NestJS 12 (`peerDependencies: @nestjs/core ^11.0.8 \|\| ^12.0.2`) |
| Metrics | **prom-client** | `prom-client@^15.1.3` | `/metrics` endpoint |
| Health | **@nestjs/terminus** | `@nestjs/terminus@^12.1.0` | backs `/health/live` and `/health/ready`; supports NestJS 12 |
| Redis client | **ioredis** | `ioredis@^6.0.0` | mature, cluster-capable later |
| Job queue | **BullMQ** | `bullmq@^6.3.8` | Redis-backed; 0B proves the wiring with one trivial job |
| UUIDv7 | **uuid** — `import { v7 as uuidv7 } from 'uuid'` | `uuid@^14.0.2` | ESM-only; generated in application code — see §6.2 |
| Tests | **Vitest** | `vitest@^5.0.1`, `@testcontainers/postgresql@^12.1.0` | §3.7 |
| Boundaries | **dependency-cruiser** | `dependency-cruiser@^18.4.0` | §3.6 |
| Lint / format | **ESLint** (flat config, `eslint.config.js`) / **Prettier** | `eslint@^10.11.0`, `prettier@^3.9.8` | ESLint 10 has no `.eslintrc` at all |
| Compiler | **TypeScript** | `typescript@~6.0.3` | §3.4 — tilde, not caret |
| Node runtime | **Node 24** | `.nvmrc` = `24.21.0`; `engines.node` = `>=24.21.0 <25` | the full runtime and package-manager contract is §3.10 |

### 3.10 Runtime and package-manager contract

§3.1's rationale — *an undeclared dependency fails at module resolution* — is only true while the
linker keeps it true. That makes the runtime and the package manager part of the **boundary
contract**, not environment trivia, and all of it is pinned in files rather than described in a
README. An earlier draft left the pins as placeholders (`pnpm@<exact.version>`, "e.g. `24.11.0`");
the review is right that a placeholder is not a pin. **The values below are the values.**

#### Node — `.nvmrc` = `24.21.0`; `engines.node` = `>=24.21.0 <25`

Researched 2026‑09‑20 from the Node release index and the pinned packages' own `engines`:

| Fact | Source |
|---|---|
| Node **24.21.0** is the current release on the 24 line, LTS codename Krypton, released **2026‑09‑08** | the release announcement heading, `doc/changelogs/CHANGELOG_V24.md`, and the `dist/v24.21.0/` file timestamps — all three agree. `dist/index.json` carries `2026-09-07` for the same release; that field is the cut date, not the publication date, and an earlier draft of this table quoted it as the release date |
| `prisma@7.10.0`, `@prisma/client@7.10.0`: `^20.19 \|\| ^22.12 \|\| >=24.0` — the Node 24 line satisfies the **pinned** Prisma from **24.0** | package `engines` |
| **`@nestjs/schematics@12.0.3`: `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`** — the tightest floor on the 24 line in this toolchain, and it is NestJS's, not Prisma's | package `engines` |
| `vitest@5.0.1`: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; `dependency-cruiser@18.4.0`: `^22 \|\| ^24 \|\| >=26`; `eslint@10.11.0`: `>=24`; `@nestjs/terminus@12.1.0`: `>=24.0.0` | package `engines` |
| `prisma@8.0.0-rc.15`: `>=22.18.0` | **Prisma 8's** requirement, listed only so it is not conflated with the pinned toolchain's |
| Corepack ships with the Node 24 line and **is absent from the Node 26 line** | the `corepack` API document exists in the v24 docs and does not in the v26 docs |

An earlier draft attributed a "24.11+" floor to Prisma. That figure belongs to no package in
this toolchain; the correction is recorded rather than quietly overwritten.

| File | Content | Effect |
|---|---|---|
| `.nvmrc` | `24.21.0` | the one place the exact version lives; developers and CI read it |
| root `package.json` → `engines.node` | `">=24.21.0 <25"` | floor = the `.nvmrc` version, ceiling = the line. A developer may run a **newer** 24.x patch than CI, never an older one; moving `.nvmrc` moves the floor in the same change |
| `pnpm-workspace.yaml` → `engineStrict: true` | | a Node outside the range **fails `pnpm install`** rather than printing a warning nobody reads |
| CI | `actions/setup-node` with `node-version-file: .nvmrc` | CI cannot drift from `.nvmrc`, because it reads it |

#### pnpm — `packageManager` = `pnpm@12.5.1`, installed only by Corepack

```jsonc
// root package.json
{ "packageManager": "pnpm@12.5.1" }
```

- **12.5.1** is npm `latest` as of 2026‑09‑20 (published 2026‑09‑18). The version is exact, never
  a range. Corepack records the integrity hash after the version on first use (`corepack use
  pnpm@12.5.1`); that hash is **whatever Corepack writes, never hand-typed**, so the field above
  is shown without it;
- **Corepack is the only installation path.** CI runs `corepack enable` before any `pnpm`
  command, and never `npm i -g pnpm`. A globally installed pnpm can disagree with
  `packageManager`; Corepack cannot, because it reads it. pnpm itself refuses to self-update
  when run through Corepack, which is the behaviour wanted here;
- CI installs with **`pnpm install --frozen-lockfile`**, so a lockfile that disagrees with
  `package.json` fails the build instead of being silently rewritten;
- Corepack ships with Node 24 and **not with Node 26**. Moving the Node line in a later phase
  therefore changes the pnpm installation path in the same change — recorded in §18 rather than
  assumed.

#### Settings live in `pnpm-workspace.yaml`, and the linker is locked

pnpm 12 reads its settings from **`pnpm-workspace.yaml`**, in camel case — its own diagnostics
say *"add … to pnpm-workspace.yaml"*. An earlier draft put them in `.npmrc`; that file is not
where the pinned version looks.

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"

nodeLinker: isolated          # pnpm's default — written down anyway; see below
shamefullyHoist: false
engineStrict: true

# pnpm 10+ refuses to run dependency install scripts unless they are allowed here.
# Every entry carries the reason it exists. Nothing is allowed wholesale.
allowBuilds:
  "@prisma/engines": true     # postinstall: fetches the schema engine the pinned CLI uses
  prisma: true                # preinstall entry script of the pinned CLI
  esbuild: true               # postinstall: verifies its platform binary (Vite / Vitest)
```

The three `allowBuilds` entries are the three packages in this dependency set that declare an
install script — read from their published `package.json`, not guessed. A fourth appears only
when `pnpm install` reports an ignored build, and it is added with its reason, never by
`dangerouslyAllowAllBuilds`.

`nodeLinker: isolated` is pnpm's default and is written down **anyway**, because a default that is
never stated is a default someone changes at 2am to unblock a build. Setting `nodeLinker:
hoisted` or `shamefullyHoist: true`, or adding `publicHoistPattern` entries beyond pnpm's
defaults, re-creates the hoisting that lets an **undeclared** dependency resolve — silently
deleting one of the two enforcement layers this specification claims to have (§3.1, §5.3).

Any change to those three lines is therefore an **architecture change**, not a build fix, and
belongs in a review. This is checked rather than trusted: §16 criterion 5b.

---

## 4. Workspace layout

```text
global-idle/
├─ apps/
│  ├─ web/            Next.js + React + TypeScript
│  ├─ api/            NestJS — HTTP, realtime, orchestration, transactions
│  └─ worker/         BullMQ consumers; depends on packages/domain, never on api
├─ packages/
│  ├─ shared/         contracts, types, ids, result types — no I/O
│  ├─ domain/         bounded contexts, ORM, transactions — the application core
│  ├─ game-data/      the Content bounded context — schemas, validation, bundle build + resolver
│  └─ game-engine/    pure simulation — no I/O, no framework
├─ infra/
│  └─ docker-compose.yml
├─ docs/
├─ .dependency-cruiser.cjs
├─ .nvmrc
├─ eslint.config.js
├─ pnpm-workspace.yaml      workspace list AND pnpm settings (§3.10)
├─ tsconfig.base.json
├─ tsconfig.json            solution file: references to the six composite projects (§4.4)
├─ vitest.config.ts         test.projects (§3.7)
└─ package.json             engines, packageManager, scripts (§4.3)
```

`packages/shared` is named **`shared`**, not `shared-types`, per `OPERATIONS_ARCHITECTURE.md` §1.
It holds contracts and pure helpers, not only types.

### 4.1 Where the domain lives — `packages/domain`

An earlier draft put the bounded contexts inside `apps/api` and said `apps/worker` "shares
api's domain code". That left the worker with no **legal** way to call a context: an
`apps/worker → apps/api/src/**` edge is exactly the app-to-app reach-in `ADR-012` forbids.

> **⚠ This amends an ACCEPTED ADR, and is governed accordingly.** `ADR-012` records the Phase 0B
> layout with contexts *"inside `api`"* and three packages. Moving them is an architecture
> decision, not an implementation detail, so it is recorded in
> **[`ADR-018`](../../architecture/decisions/ADR-018-domain-package-source-layout.md)** — raised
> as `PROPOSED`, never self-accepted, and held there through five review rounds until the Product
> Owner accepted it with this specification. It is now **`ACCEPTED`**. `ADR-012`'s own text is
> **not edited**; it carries a link to the amendment.
>
> `ADR-018` supersedes exactly two things: the **package listing** and the phrase *"context
> modules inside `api`"*. Everything else in `ADR-012` stands — one deployable modular monolith,
> build-enforced boundaries, the engine and data package rules, the `shared` naming, and the
> rejection of microservices. `packages/domain` is a **compile-time module, not a service**: one
> image, two start commands, one PostgreSQL transaction in one process.

**Decision: the bounded contexts live in `packages/domain`.** Both applications depend on it;
neither depends on the other.

```text
packages/domain/src/
├─ contexts/
│  ├─ identity/        Account, AuthIdentity, Session, Entitlement
│  ├─ character/       Character, roster capacity, Stamina
│  ├─ party/           Active Party configuration
│  ├─ activity/        Activity root, claims, occupancy, settlement orchestration
│  ├─ economy/         ledger, balances
│  └─ items/           (Phase 3 — the directory exists only when ItemInstance does; §6.6)
├─ platform/           clock, ids, idempotency, transactions, Prisma client
├─ generated/prisma/   the generated Prisma client — git-ignored, produced by `pnpm generate` (§4.3)
└─ index.ts            the only legal entry point
```

**All seven `ADR-001` contexts, and where each one lives.** `ADR-018` moves the *runtime
application* contexts; it does not collapse, remove or relocate any context `ADR-001` defines.

| `ADR-001` context | Lives in | Phase 0B status |
|---|---|---|
| Identity & Access | `packages/domain/src/contexts/identity` | built (foundations) |
| Character | `packages/domain/src/contexts/character` | built |
| Party | `packages/domain/src/contexts/party` | contract only |
| Activity | `packages/domain/src/contexts/activity` | built |
| **Items** | `packages/domain/src/contexts/items` | **deferred to Phase 3 with `ItemInstance`** — still an accepted context, with its owner and its invariant (I4) recorded in §6.6 |
| Economy | `packages/domain/src/contexts/economy` | built (minimal ledger) |
| **Content** | **`packages/game-data`** | built — this context is build-time, versioned and read-only at runtime (`ADR-011`), which is exactly why it is a separate package rather than a directory under `domain` |

Five directories in `domain` plus one deferred plus one in `game-data` is seven.

The earlier rationale — "extracting them would drag Prisma into `packages/`" — was simply
wrong. The forbidden edge is **package → app**. A package depending on Prisma or on npm
libraries breaks no rule. Correcting this is autonomous decision #6′ in §17.

**Each context exposes a public surface** (`contexts/<name>/index.ts`). Reaching past it into
another context's internals is a dependency-cruiser violation, inside the package as much as
across it.

### 4.2 API and worker

**One deployable artifact, two process entry points**, satisfying `ADR-012`:

| | `apps/api` | `apps/worker` |
|---|---|---|
| Role | HTTP + realtime adapters, composition root | BullMQ consumers, composition root |
| Depends on | `packages/domain`, `shared` | `packages/domain`, `shared` |
| May import the other app | **never** | **never** |
| Container image | **the same image**, different start command | |

Both are thin: adapters and wiring. Neither owns domain logic.

**How 0B.6's reconciliation job calls a context.** It imports the Activity context's public
surface from `packages/domain` and calls it, inside a transaction the domain package owns —
the same call path `apps/api` uses. No privileged access, no second implementation.

**Legal and forbidden edges, exactly:**

```text
LEGAL       apps/api    → packages/domain → packages/{shared, game-data, game-engine}
            apps/worker → packages/domain → …
            apps/web    → packages/shared

FORBIDDEN   apps/worker → apps/api            (any path)
            apps/api    → apps/worker
            packages/*  → apps/*
            anything    → packages/domain/src/contexts/*/internals
                          (only contexts/<name>/index.ts is public)
```

Enforced by dependency-cruiser (§5.3) and tested by W6, W8 and W10.

### 4.3 The clean-build pipeline

`packages/domain` depends on **generated** Prisma artifacts, and §16 criterion 1 requires
`pnpm install && pnpm build && pnpm test` to succeed from a **clean checkout**. Those two facts
only coexist if the specification says exactly where generation happens, what it produces and how
the compiler sees it. An earlier draft answered with a deprecated generator and a subpath-import
plan built around it; the review is right that a greenfield project does not organise itself
around a legacy generator. This section replaces that plan.

#### The Prisma 7 model, exactly

Prisma 7 changed three things at once, and each is verified against the pinned packages (§3.8):

1. **the connection URL left the schema file** — `schema.prisma` declares only the provider; the
   URL lives in `prisma.config.ts`;
2. **the client needs a driver adapter** — `new PrismaClient()` without one throws *"A driver
   adapter is required to connect to your database"*; for PostgreSQL that is `@prisma/adapter-pg`
   over `pg`;
3. **the current generator is `prisma-client`**, which emits **TypeScript**, requires an explicit
   `output`, and takes the runtime and module-format decisions as fields rather than guesses.

```prisma
// packages/domain/prisma/schema.prisma
generator client {
  provider               = "prisma-client"
  output                 = "../src/generated/prisma"   // relative to the schema directory
  runtime                = "nodejs"
  moduleFormat           = "esm"                       // §3.4 — stated, not inferred
  generatedFileExtension = "ts"
  importFileExtension    = "js"                        // nodenext: emitted imports carry .js
  previewFeatures        = ["partialIndexes"]
}

datasource db {
  provider = "postgresql"                              // no url — Prisma 7 refuses one here
}
```

```ts
// packages/domain/prisma.config.ts
import 'dotenv/config';                                // @prisma/config does not load .env itself
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema:     'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },           // eager: a missing variable fails loudly, by name
});
```

```ts
// packages/domain/src/platform/prisma/client.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
```

Every generator field is **written explicitly** even where the generator could infer it.
`moduleFormat` would otherwise be inferred from the nearest `package.json`; `importFileExtension`
from `tsconfig`. Inference is correct today and silently wrong the day someone edits a
`tsconfig`. Four lines make the decision reviewable.

`env()` is deliberately eager. The alternative — a lazily-read URL — would let `pnpm generate`
succeed on a machine where `pnpm migrate` is about to fail with a less useful error. `DATABASE_URL`
is exported for every CI step (below) and documented in `.env.example` for local use.

#### Where the generated client lives, and why `tsc` compiles it

| | |
|---|---|
| Schema | `packages/domain/prisma/schema.prisma` |
| Config | `packages/domain/prisma.config.ts` — found by the CLI in the package directory, which is where every `prisma` script runs |
| Generator `output` | **`packages/domain/src/generated/prisma/`** — *inside* `rootDir: "src"` |
| Emitted as | TypeScript (`client.ts`, `enums.ts`, `models.ts`, …) — the generator's `generatedFileExtension = "ts"` |
| Compiled by `tsc -b` | **yes** — into `dist/generated/prisma/`, exactly like hand-written source |
| Committed to git | **no** — `packages/domain/src/generated/` is ignored |
| Imported as | a relative path with the `.js` extension: `'../../generated/prisma/client.js'` |

**Why inside `src`.** The `prisma-client` generator emits TypeScript, not JavaScript. TypeScript
inside `rootDir` is compiled and emitted by the same `tsc -b` invocation as everything else, so
`dist/` mirrors `src/` and a relative import resolves to the same file in the editor, in the built
output, in Vitest and in production. The earlier subpath-import indirection existed to make a
JavaScript artifact *outside* `rootDir` reachable without a `paths` alias; a TypeScript artifact
*inside* `rootDir` needs no indirection at all. Relative imports are the plainest resolution
mechanism there is, and `tsc` rewrites nothing.

**Why not outside `src`.** A generated `.ts` tree outside `rootDir` cannot be compiled by a
composite project without either a second `tsc` invocation or a `paths` alias — the two things
§3.3 rejects.

`@prisma/client` and `@prisma/adapter-pg` are declared runtime dependencies of `packages/domain`
— the generated code imports the former — and of **no other workspace** (§5.2). `dotenv` and
`prisma` are its dev dependencies.

#### Scripts, exactly

```jsonc
// root package.json
{
  "scripts": {
    "generate":         "pnpm --filter @global-idle/domain run prisma:generate",
    "typecheck":        "tsc -b && pnpm --filter @global-idle/web run typecheck",
    "build":            "pnpm run generate && tsc -b && pnpm --filter @global-idle/web run build",
    "test":             "vitest run",
    "test:unit":        "vitest run --project unit",
    "test:fixtures":    "vitest run --project fixtures",
    "test:integration": "vitest run --project integration",
    "test:invariants":  "vitest run --project invariants",
    "lint":             "eslint .",
    "format:check":     "prettier --check .",
    "boundaries":       "depcruise --config .dependency-cruiser.cjs apps packages"
  }
}
```

```jsonc
// packages/domain/package.json
{ "scripts": {
    "prisma:generate": "prisma generate",
    "prisma:migrate":  "prisma migrate deploy",
    "migrate:check":   "node ./scripts/migrate-check.js" } }

// apps/web/package.json
{ "scripts": { "typecheck": "tsc --noEmit", "build": "next build" } }
```

**The order, and why each step sits where it does:**

1. **`generate` first.** `tsc` cannot compile `src/platform/prisma/client.ts` before
   `src/generated/prisma/client.ts` exists, so generation precedes every typecheck, build and
   test. It is idempotent and cheap on a warm checkout, so running it every time costs nothing
   and removes a whole class of "works here".
2. **`typecheck` is `tsc -b` plus the web app's own `tsc --noEmit`** — never `tsc --noEmit` at
   the root. Project references resolve against **emitted declarations**, so a root no-emit
   pass has nothing to check the graph against. `tsc -b` is incremental, so using the build as
   the typecheck is nearly free after the first run. §4.4 explains why `apps/web` is checked
   separately and how W13 proves all seven workspaces are covered.
3. **`build` = `tsc -b` then `next build`.** `tsc -b` emits every package's `dist` **and**
   `apps/api/dist` and `apps/worker/dist`; `next build` consumes `packages/shared`'s `dist`.
   There is no `nest build` step (§4.4).
4. **`test` last.** Vitest resolves internal packages through their `exports`, i.e. `dist` (§3.7),
   so `pnpm build` must already have run. **W12** asserts exactly this sequence from a clean
   checkout.

**Generation is explicit, never a lifecycle hook.** No `postinstall` runs `prisma generate`.
Lifecycle-script behaviour varies across package-manager versions and settings — pnpm 12 refuses
dependency install scripts outright unless allowed (§3.10) — and a step that *sometimes* runs is
the opposite of a deterministic pipeline. `pnpm build` runs it, visibly, every time.

**Nothing generated is committed.** `packages/domain/src/generated/`, every `dist/`,
`*.tsbuildinfo` and `node_modules/` are ignored. No part of this specification requires a
generated artifact in git, so nothing justifies the drift that committing one would cause.

#### Migrations are not part of the build

`prisma migrate deploy` touches a **database**; `pnpm build` must succeed with no database
reachable. Migrations are applied by the integration-test global setup against the Testcontainers
instance (§3.7) and by the deployment path — never by a build script. `migrate:check` (§13 check
9) applies them from empty and from the previous state, and asserts the generated SQL of every
partial index (**D13**).

#### CI runs this same path

CI runs the **same scripts in the same order**. There is no CI-only build command and no step that
exists only in the workflow file (§13). Two environment details make that true rather than
aspirational:

- **`DATABASE_URL` is exported for every step** — a placeholder for the static steps, the
  Testcontainers URL for the integration steps. `prisma generate` does not connect, but
  `prisma.config.ts` reads the variable **eagerly**, and a variable that is unset only in CI is
  the classic divergence;
- **the pnpm store is cached**, keyed on the lockfile, so a cold CI run and a warm one differ in
  wall time only, never in outcome.

### 4.4 The typecheck graph — all seven workspaces, one compiler

An earlier draft said the root references "every package", that `pnpm typecheck` is `tsc -b`, and
that CI typechecks "all workspaces". The review is right that those three statements do not add
up to the apps being checked. This section makes the graph explicit.

```jsonc
// tsconfig.json — a solution file, nothing else
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/game-data" },
    { "path": "packages/game-engine" },
    { "path": "packages/domain" },
    { "path": "apps/api" },
    { "path": "apps/worker" }
  ]
}
```

| Workspace | Composite | In the root graph | Typechecked by |
|---|---|---|---|
| `packages/shared`, `game-data`, `game-engine`, `domain` | yes | yes | `tsc -b` |
| `apps/api`, `apps/worker` | **yes** | **yes** | `tsc -b` — the same invocation that builds them |
| `apps/web` | **no** | **no** | its own `tsc --noEmit` (`pnpm typecheck`, second half) **and** `next build` (§13 check 12) |

**Why the two Node apps are composite projects.** They are ordinary TypeScript programs that emit
to `dist/` and are started with `node dist/main.js`. Making them reference targets means one
`tsc -b` checks and builds the whole Node graph in dependency order, with one set of options, and
a type error in `apps/worker` fails the same command as one in `packages/domain`.

**Why `apps/web` is not.** Next.js manages its own `tsconfig.json` and sets `noEmit: true`. A
project that disables emit **cannot be a reference target** — TypeScript refuses it
(`TS6310: Referenced project … may not disable emit`) — and forcing emit on a Next.js app fights
its toolchain for no gain. So `apps/web` sits outside the solution graph and is checked twice:
by `tsc --noEmit` in the second half of `pnpm typecheck`, after `tsc -b` has built the
`packages/shared` declarations it consumes, and again by `next build`, which typechecks by
default. It *does* reference `packages/shared` in its own `tsconfig`; a `noEmit` project may
consume references, it just cannot be one.

**One compiler for `api` and `worker`: `tsc -b`. `nest build` is not used.** The NestJS CLI's
build wraps `tsc` with its own `tsconfig.build.json` handling and has no `--build` mode, so
adding it means two compilers over one project graph — two sources of truth for what a type error
is. `tsc -b` already emits everything the apps need, and `node --watch dist/main.js` alongside
`tsc -b --watch` is the development loop. The Nest CLI remains a dev dependency for schematics
only.

**Proof, not description.** Test **W13** introduces a type error into each of the **seven**
workspaces in turn and asserts that `pnpm typecheck` fails every time. A graph description can
drift; a test that fails when a workspace drops out of the graph cannot.

**TypeScript is pinned** to `~6.0.3` (§3.4); the version is a devDependency of the root, and
every workspace resolves the same copy through the isolated linker.

---

## 5. Dependency rules

### 5.1 The graph

```text
apps/web ──────────► packages/shared

apps/api ──────────► packages/domain ──┬──► packages/shared
apps/worker ───────► packages/domain ──┼──► packages/game-data
                                        └──► packages/game-engine

packages/game-engine ──► packages/shared        (types only)
packages/game-data   ──► packages/shared        (types only)
```

**Nothing in `packages/` may depend on anything in `apps/`. Ever.**
**Neither app may depend on the other.** They meet only through `packages/domain`.

### 5.2 Forbidden edges, exactly

| Package | Must not import |
|---|---|
| `game-engine` | NestJS, Next.js, React, Prisma, `@prisma/client`, ioredis, BullMQ, `http`/`https`, `fs`, `path` (for I/O), `crypto` randomness, `Date.now`, `Math.random`, `process.env`, any app |
| `game-data` | any app, `game-engine`, `domain`, NestJS, Next.js, Prisma, ioredis |
| `shared` | any app, any other package, any framework, any I/O |
| `domain` | any app, Next.js, React, HTTP transport types |
| `domain` context module | another context's internals — only `contexts/<name>/index.ts` is public |
| `web` | Prisma, ioredis, `game-engine`, `domain`, any `apps/api` or `apps/worker` internal |
| `api` | `apps/worker` (any path) |
| `worker` | `apps/api` (any path) |

`game-engine`'s ban on `Date.now` and `Math.random` is `ADR-010`'s determinism requirement made
mechanical. Lint rules alone would be bypassable; dependency-cruiser plus a targeted
`no-restricted-globals` rule closes it.

### 5.3 Enforcement

`.dependency-cruiser.cjs` encodes §5.2 as `forbidden` rules with `severity: "error"`.

- `pnpm boundaries` runs it locally;
- CI runs it as a **blocking check** (§13);
- it is configured in the **first commit of 0B.1**, before there is anything to violate it, per
  `ADR-012`.

---

## 6. Persistence

### 6.1 Principles inherited

- **PostgreSQL is the sole durable truth** (`ADR-009`). Redis holds nothing that cannot be
  rebuilt.
- Migrations are **forward-only, additive-first** (`DATA_ARCHITECTURE.md` §8).
- **No migration rewrites ledger rows.** Ever.
- Locks for value movement are acquired in a **globally consistent order** (§8.5).

### 6.2 Identifiers

State entity ids are **UUIDv7**, generated in **application code** by a helper in
`packages/shared`, not by a database default.

Rationale: `gen_uuid_v7()` is not available on every PostgreSQL version the project may deploy
to, and generating in the application keeps id creation testable and deterministic under a fake
clock. A database default may be added later as a safety net; it is never the primary path.

An identifier is **not a secret and not an authorization control** (`DOMAIN_MODEL.md` §4). No
0B code may rely on an id being unguessable.

### 6.3 Initial persistent concepts

The minimum needed to build and prove the 0B primitives. **Do not add gameplay tables that no
0B test exercises.**

| Concept | Purpose in 0B | Notes |
|---|---|---|
| `Account` | ownership principal | roster capacity stored here, **owned by the Character context** |
| `AuthIdentity` | credential → Account | foundations only; Phase 1 builds the flows |
| `Entitlement` | Premium, account-wide | permanent **or** time-bounded; `validFrom`, nullable `validUntil` |
| `Character` | the avatar | vocation, `retiredAt` nullable |
| `CharacterStamina` | Stamina state | `remaining`, `mode`, `modeSince`, `updatedAt` |
| `OccupancyClaim` | one per Character | `characterId` PK; `activityId`; composite FK `(activityId, characterId) → ActivityParticipant` — a claim can only name a participant of the activity it claims; `ADR-013` |
| `Activity` | **shared root** for both families | `id`, `accountId`, `activityTypeKey`, `family`, **`contentVersion` FK `ON DELETE RESTRICT`, NOT NULL** (`ADR-011` — *every* Activity pins), `createdAt`; `UNIQUE(id, family)` and `UNIQUE(id, accountId, family)` as composite FK targets |
| `ActivityParticipant` | per-Character membership — the **durable roster snapshot**, retained after the Activity ends | `(activityId, characterId)` PK, `family` (projection, composite FK to `Activity`), `slotIndex`, `staminaActivatedAt` |
| `SessionBoundActivity` | Hunt / Dungeon subtype | `accountId` and `family` (one composite FK carries both), `CHECK (family = 'SESSION_BOUND')`, `state`, `claimHolderSessionId`, `graceExpiresAt`, `rngSeed` |
| `SkillTrainingActivity` | wall-clock subtype | `family` + `CHECK (family = 'WALL_CLOCK')`, **`traineeCharacterId`** — a composite FK into `ActivityParticipant`, which is what makes the trainee row **mandatory** (§6.3.1) — status ∈ {ACCRUING, ENDED, EXHAUSTED, CANCELLED}, `startedAt`, `lastSettledAt`, `endedAt` |
| `ActiveUseTimer` | reusable duration state | `remainingDuration`, `qualifyingSince` |
| `IdempotencyRecord` | client command keys | scope, fingerprint, result reference |
| `SettlementOperation` | deterministic settlement ids | uniqueness target |
| `LedgerEntry` + `CurrencyBalance` | economy invariant tests | minimal; no market, no forge |
| `ContentBundle` | **bundle metadata** — `version` (PK), `checksum`, `publishedAt`, `location` | one row per published bundle; **not** a reference count |
| `_prisma_migrations` | migration metadata | Prisma-managed |

`ActivityType` is **not** in this table, and an earlier draft's listing of it there was the
ambiguity the review flagged: the activity-type registry is **code**, not a table — §7.3.2.

**Deliberately absent from 0B:** `ItemInstance`, custody scopes, `MarketListing`, Skills,
Progression, Wheel, Skill Tree, Hunt/Room/Creature tables, and any `ActivityType` table. They belong to the phases that use
them. `ItemInstance` in particular is Phase 3 — `ADR-004`'s custody invariant is specified but
not yet built, and §6.6 traces that honestly.

### 6.3.1 The two activity families, durably

`ADR-002` defines two families with different lifecycles. They share an identity so
`OccupancyClaim.activityId` has **one** referential target, and diverge in their subtype state so
the lifecycles are not collapsed into one behaviour.

```text
Activity            id  PK
                    accountId              FK → Account
                    activityTypeKey        String — validated against the code registry (§7.3.2)
                    family ∈ {SESSION_BOUND, WALL_CLOCK}              ← projection of the descriptor
                    contentVersion         FK → ContentBundle.version  ON DELETE RESTRICT, NOT NULL
                                                                      ← ADR-011: EVERY Activity pins
                    createdAt
                    UNIQUE (id, family)                               ← composite FK target
                    UNIQUE (id, accountId, family)                    ← composite FK target

   ├── SessionBoundActivity   activityId  PK, FK → Activity.id
   │                          accountId, family                       ← see "no drift" below
   │                          CHECK (family = 'SESSION_BOUND')        ← §6.3.3
   │                          state ∈ {ONLINE_ACTIVE, RECONNECT_GRACE_PAUSED, ACTIVITY_ENDED}
   │                          claimHolderSessionId, graceExpiresAt, rngSeed
   │                          FOREIGN KEY (activityId, accountId, family)
   │                                        → Activity(id, accountId, family)
   │
   └── SkillTrainingActivity  activityId  PK, FK → Activity.id
                              family
                              CHECK (family = 'WALL_CLOCK')           ← §6.3.3
                              traineeCharacterId                      ← NOT a second source of truth:
                              status ∈ {ACCRUING, ENDED, EXHAUSTED, CANCELLED}
                              startedAt, lastSettledAt, endedAt
                              FOREIGN KEY (activityId, family) → Activity(id, family)
                              FOREIGN KEY (activityId, traineeCharacterId)
                                        → ActivityParticipant(activityId, characterId)
                                                            ← the trainee row must EXIST to be named

ActivityParticipant  activityId  FK → Activity.id
                     characterId FK → Character
                     family                                 ← projection; kept honest by the FK below
                     slotIndex
                     staminaActivatedAt  Instant | null     ← per-Character, ADR-014
                     PRIMARY KEY (activityId, characterId)
                     FOREIGN KEY (activityId, family) → Activity(id, family)
                     UNIQUE (activityId) WHERE family = 'WALL_CLOCK'   ← AT MOST one trainee
                     — retained after the Activity ends: the durable roster snapshot

OccupancyClaim       characterId  PK, UNIQUE                ← I13, one per Character
                     activityId
                     FOREIGN KEY (activityId, characterId) → ActivityParticipant(activityId, characterId)
                                                            ← a claim names a participant, or nothing
                     — released (deleted) when the Activity ends
```

**Every projection is chained, and the chain has no cycle.** Wherever this model stores a
projection of another row's fact — `accountId` and `family` on the subtype and participant rows —
it is chained back to the source row by a composite foreign key, so the projection cannot be
written with a value the source does not have. The alternative, a plain duplicated column kept
honest by discipline, is how projections drift.

The foreign keys impose a **total insert order** with no cycle, which is what lets §8.1's start
transaction use ordinary immediate constraint checking rather than deferred constraints:

```text
ContentBundle → Activity → ActivityParticipant → SkillTrainingActivity  ┐
                        └→ SessionBoundActivity                          ├→ OccupancyClaim
```

#### Why `accountId` is on both, and why it cannot drift

Invariant I9 — *one non-terminal session-bound Activity per Account* — needs `accountId` and
`state` **on the same row**, because a partial unique index cannot span two tables. An earlier
draft asked for a partial unique index on `SessionBoundActivity(accountId)` while `accountId`
lived only on `Activity`. That index is not implementable, and the review was right to block.

The fix is a **composite foreign key**, not a plain duplicated column:

```sql
FOREIGN KEY ("activityId", "accountId") REFERENCES "Activity"("id", "accountId")
```

A row whose `accountId` differs from its root's cannot be inserted or updated into existence —
the database rejects it. The duplication is a projection the database itself keeps honest, not a
denormalisation someone has to remember to maintain.

In Prisma 7.10, with the `partialIndexes` preview feature (§3.8):

```prisma
model Activity {
  id              String         @id
  accountId       String
  activityTypeKey String                       // validated against the code registry, §7.3.2
  family          ActivityFamily
  contentVersion  String                       // NOT NULL — every Activity pins (ADR-011)
  createdAt       DateTime
  bundle          ContentBundle  @relation(fields: [contentVersion], references: [version], onDelete: Restrict)
  sessionBound    SessionBoundActivity?
  skillTraining   SkillTrainingActivity?
  participants    ActivityParticipant[]
  @@unique([id, family])                       // composite FK target
  @@unique([id, accountId, family])            // composite FK target
  @@index([activityTypeKey, family])           // §7.3.2 startup reconciliation
}

model SessionBoundActivity {
  activityId  String            @id
  accountId   String
  family      ActivityFamily
  state       SessionBoundState
  // …
  activity Activity @relation(fields: [activityId, accountId, family],
                               references: [id, accountId, family])

  @@unique([accountId], where: raw("state IN ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED')"))
  //  ^ partial unique index — I9. raw(): the object form has no IN (§3.8)
  //  + CHECK ("family" = 'SESSION_BOUND') — hand-written, §3.8 / §6.3.3
}

model SkillTrainingActivity {
  activityId         String              @id
  family             ActivityFamily
  traineeCharacterId String
  status             SkillTrainingStatus
  // …
  activity Activity            @relation(fields: [activityId, family], references: [id, family])
  trainee  ActivityParticipant @relation(fields: [activityId, traineeCharacterId],
                                         references: [activityId, characterId])
  //  ^ the trainee participant row must EXIST — this is the "at least one" half (§6.3.3)
  //  + CHECK ("family" = 'WALL_CLOCK') — hand-written, §3.8 / §6.3.3
}

model ActivityParticipant {
  activityId         String
  characterId        String
  family             ActivityFamily
  slotIndex          Int
  staminaActivatedAt DateTime?
  activity  Activity  @relation(fields: [activityId, family], references: [id, family])
  claim     OccupancyClaim?
  training  SkillTrainingActivity?
  @@id([activityId, characterId])
  @@unique([activityId], where: raw("family = 'WALL_CLOCK'"))
  //  ^ AT MOST one participant on a wall-clock activity — the "at most one" half (§6.3.3)
}

model OccupancyClaim {
  characterId String  @id
  activityId  String
  participant ActivityParticipant @relation(fields: [activityId, characterId], references: [activityId, characterId])
}
```

The I9 predicate names the **non-terminal states explicitly** rather than negating a terminal
one, so adding a future terminal state cannot silently widen it. **Test D10** fails if two
non-terminal session-bound activities for one account can coexist, and **test D13** asserts that
the **generated migration SQL** — not the schema file — carries each `WHERE` clause.

#### `activityTypeKey` — family is not a substitute for type

`family` distinguishes the two lifecycles. It cannot distinguish **Hunt from Dungeon**, or either
from a future session-bound type, and §7.3.1's stamina classification is a property of the
**type**, not the family.

So `Activity.activityTypeKey` is the canonical key resolving to a validated
`ActivityTypeDescriptor` in the **code registry** of §7.3.2 — there is no `ActivityType` table.
`family` is stored alongside as a projection of the descriptor, written in the creating
transaction and used as a cheap filter and as a composite-FK target; the descriptor remains the
source of truth, and §7.3.2's startup reconciliation (**T16**) refuses to start the process if
any persisted key is unknown to the registry or carries a family the registry disagrees with.

#### `ActivityParticipant` — per-Character stamina activation

`ADR-014` activates Stamina consumption **per Character**. An earlier draft said activation was
*"persisted on the session-bound activity per participant"* without defining any participant
row, which is not a model.

`ActivityParticipant` is that row. It is the minimum Phase 0B needs:

- `(activityId, characterId)` — who is in this activity, and in which slot;
- `staminaActivatedAt: Instant | null` — **null means not yet activated**, so
  §7.3.1 reads `NEUTRAL`; a timestamp means `CONSUMING` while `ONLINE_ACTIVE`;
- nothing else. **Phase 0B stores and reads the flag; Phase 2 decides what raises it**, because
  that requires the qualifying-XP rule and its reward loop.

**Relationship to occupancy claims.** They are different things at different grains, with
different lifetimes:

| | `ActivityParticipant` | `OccupancyClaim` |
|---|---|---|
| Grain | one row per Character **per activity** | one row per Character, **globally** |
| Answers | "who was in this activity, in which slot, and were they activated?" | "is this Character busy right now, and with what?" |
| Cardinality | many per activity; **exactly one** for a wall-clock activity — at most one by the partial unique index, at least one by `SkillTrainingActivity`'s foreign key (§6.3.3) | **exactly one per Character** (I13) |
| Lifetime | **as long as the Activity row exists** — it is the durable roster snapshot | **while the Activity is live** |

Starting an activity writes both, in the same transaction: a participant row per Character and a
claim per Character. **Ending it releases the claims and keeps the participant rows.** An earlier
draft said ending "deletes both", which contradicted the accepted persistence model — `ADR-002`
and `DATA_ARCHITECTURE.md` §7 have the Activity persist its **roster snapshot** for history,
replay and support, and a snapshot that vanishes at the end of the thing it snapshots is not one.
The review was right to block.

The claim is the *occupancy* fact and is gone the instant the Character is free; the participant
row is the *history* fact and stays for as long as the Activity itself is retained. Any later
removal of participant rows is part of the **retention or archive operation** that removes the
Activity — the same operation §7.7 names for content references — and no such operation is
authorized by this specification. A Character can never have two claims, so it can never be a
participant in two *live* activities; it can, of course, appear in the snapshots of many *ended*
ones.

**Test O14** proves that ending an activity releases every claim and preserves every participant
row. **Test T15** proves two Characters in one activity hold **independent** activation state.

**The Skill Training trainee is the participant row, named by a foreign key into it.** Two
drafts have now been wrong here in opposite directions, and both corrections are kept visible:

| Draft | Model | What was wrong |
|---|---|---|
| second review | `SkillTrainingActivity.characterId` **and** `ActivityParticipant.characterId`, unrelated | two unconstrained ids that could disagree |
| third review | **no** Character column on the subtype; cardinality left to `UNIQUE (activityId) WHERE family = 'WALL_CLOCK'` | that index is **at most one**. It does not stop a `SkillTrainingActivity` existing with **zero** participants |
| **this draft** | `SkillTrainingActivity.traineeCharacterId` with a **composite foreign key** to `ActivityParticipant(activityId, characterId)` | — |

The column is back, but it is **not a second source of truth**: it is a foreign key *into* the
participant row, so it cannot name a Character who is not a participant of that activity, and
with at most one participant it cannot name anyone but the trainee. That is precisely the
*"database relationship that makes mismatch impossible"* the third review asked for — and it
closes the fourth review's gap at the same time, because a foreign key requires its target to
**exist**:

- **at most one** participant on a wall-clock activity — the partial unique index
  `UNIQUE (activityId) WHERE family = 'WALL_CLOCK'`;
- **at least one** — `SkillTrainingActivity` cannot be inserted at all unless the participant row
  it names is already there;
- therefore **exactly one**, structurally, with no sweep and no trigger. §6.3.3 works through
  every remaining subtype state.

An `OccupancyClaim` carries the same composite foreign key to `ActivityParticipant(activityId,
characterId)`, so a claim can only name a Character who is a participant of the activity it
claims. The reconciliation sweeper reads the trainee **through** the participant row, never from
a column that could have drifted.

**Test D11** proves a claim naming a non-participant is refused by the database; **test D12**
proves a second participant on a wall-clock activity is refused by the index; **test D14** proves
a `SkillTrainingActivity` with no participant row cannot be inserted at all.

#### Skill Training lifecycle — every status classified

An earlier draft listed `SETTLED` as a status while the restart sweeper classified only
`ACCRUING` as live and three statuses as terminal — leaving `SETTLED` unhandled, which is
precisely the unclassified state a sweeper must never meet.

**`SETTLED` is removed.** Settlement is an **operation** performed on a training that remains
`ACCRUING`; `lastSettledAt` records when it last happened. It was never a lifecycle state.

| Status | Live or terminal | Occupancy claim |
|---|---|---|
| `ACCRUING` | **live** | **held** — the sweeper preserves it |
| `ENDED` | terminal | released, in the transition's transaction |
| `EXHAUSTED` | terminal | released, in the transition's transaction |
| `CANCELLED` | terminal | released, in the transition's transaction |

There is no fifth status. The sweeper's rule is total: **a claim is preserved if and only if its
named activity exists and is live.** `O10`–`O13` cover every status plus the orphaned case.

**Why durable Skill Training state is required in 0B and not deferrable:** restart reconciliation
must decide whether an occupancy claim is live or stranded. A claim naming a training activity
that does not exist in durable state is unanswerable — the sweeper would have to guess, and
guessing either strands a Character forever or releases one mid-training. The claim's referent
must be durable for the reconciliation contract of §7.2 to mean anything.

**What 0B's Skill Training state does *not* need:** training rates, Exercise Weapon economy,
skill progression formulas, or any balance value. Those are Phase 4.

**What it does need:** durable identity, its single participant row (the trainee), a pinned
`contentVersion` on the Activity root so the training it started remains reproducible against
the content it started with (`ADR-011`, **C9**), lifecycle status, start/end/exhaust/cancel
transitions sufficient for reconciliation, server timestamps proving the wall-clock lifecycle,
occupancy acquire/release semantics, and **no Base-XP capability** (invariant I10 — the training
settlement port has no progression method).

### 6.3.2 The account activity claim holder

`ADR-008` requires newest-connection-wins with an atomic transfer, and the claim must survive a
Redis flush (`ADR-009`).

| Field | Where | Durable |
|---|---|---|
| `claimHolderSessionId` | `SessionBoundActivity` | **yes — PostgreSQL is authoritative** |
| Session presence / liveness | Redis `session:presence:*` | no — ephemeral, rebuilt on reconnect |

**Transfer is a compare-and-swap** inside one transaction:

```sql
UPDATE "SessionBoundActivity"
   SET "claimHolderSessionId" = :newSession
 WHERE "id" = :activityId
   AND "claimHolderSessionId" = :expectedOldSession
   AND "state" <> 'ACTIVITY_ENDED'
```

Zero rows updated means another session won the race; the caller receives `ActivityClaimHeld`
and does not retry blindly. At no instant do two sessions hold the claim.

**What survives a restart or Redis loss:** the claim holder, the activity state and
`graceExpiresAt` — all in PostgreSQL. **What does not:** presence, which the next connection
re-establishes.

**Stale holder reconciliation:** a holder session id with no live presence is not by itself
stale — that is exactly what reconnect grace is for. Staleness is decided from
`graceExpiresAt` against `Clock.now()`, never from presence being absent (§11.2).

### 6.3.3 Activity root ↔ subtype integrity

`ADR-002`'s two families mean every `Activity` root must have **exactly one** subtype row, and
the right one. Three states would break that, and an earlier draft closed none of them:

| Invalid state | Closed by | When |
|---|---|---|
| **Wrong-family subtype** — a `WALL_CLOCK` root with a `SessionBoundActivity` row, or the reverse | `CHECK (family = …)` on each subtype **+** the composite FK chaining that column to the root's | **write time** — unrepresentable |
| **Both subtypes present** on one root | the same two constraints, with nothing extra | **write time** — unrepresentable |
| **Missing subtype** — a root with neither | the start transaction (§8.1) **+** the startup integrity sweep below | **start time**, then **startup** |

**Why the first two fall to the same two lines.** Each subtype carries a `family` column chained
to `Activity(id, family)` by a composite foreign key, so it can never disagree with its root; the
`CHECK` pins it to the one constant that subtype is for. A `SESSION_BOUND` root therefore cannot
carry a `SkillTrainingActivity` row — that row's `CHECK` demands `WALL_CLOCK`, its foreign key
demands the root agree, and both cannot hold. Both-subtypes-present is the same contradiction
seen from the other side: it would need the root's `family` to be two values at once. One pair of
`CHECK` constraints, two invalid states gone.

**Why the third does not.** *"Every parent has at least one child"* is a participation constraint
in the parent's direction, and PostgreSQL can only enforce it with a deferred circular foreign key
or a trigger. `SkillTrainingActivity` escapes this because a wall-clock activity has exactly one
participant, so a single column can name it (§6.3.1); an `Activity` root cannot name its subtype
the same way without a nullable pointer per family, which reintroduces exactly the drift the
composite keys exist to prevent. So a missing subtype is **prevented transactionally and detected
structurally**, not made unrepresentable — and the specification says so rather than claiming a
guarantee it does not have.

> **On the hand-written SQL.** The review instruction was *"do not add unnecessary custom
> migration SQL if fail-fast reconciliation is cleaner."* These two `CHECK` lines are weighed
> against that and kept, for one reason: the startup sweep below has to exist regardless (for the
> missing-subtype case), so the `CHECK`s add **no** code — they only move two of the three
> subtype states from *detected after the bad row exists* to *the bad row cannot be written*. That is the same
> trade §3.8 already makes for the ledger role grant, and it is the specification's stated
> preference throughout. If the reviewer disagrees, deleting them costs only **timing**: the
> sweep below is written to be exhaustive on its own over all four invalid states — the three
> subtype states plus an empty roster — so removing
> the `CHECK`s moves wrong-family and both-present from *cannot be written* to *caught at the
> next start*, and changes nothing else. That is only true because the sweep compares
> `Activity.family` against which subtype is present — an earlier draft's query did not, and the
> claim was false until this one.

#### The startup integrity sweep

Run at startup in the same fail-fast path as §7.3.2's registry reconciliation, and by the restart
reconciliation job of §7.2. It is **one query**, and a non-empty result makes the process refuse
to start:

```sql
SELECT a.id, a.family,
       (sb."activityId" IS NOT NULL) AS has_session_bound,
       (st."activityId" IS NOT NULL) AS has_skill_training,
       (SELECT count(*) FROM "ActivityParticipant" p WHERE p."activityId" = a.id) AS participants
  FROM "Activity" a
  LEFT JOIN "SessionBoundActivity"  sb ON sb."activityId" = a.id
  LEFT JOIN "SkillTrainingActivity" st ON st."activityId" = a.id
      -- one predicate per family, each the full negation of "valid for this family"
 WHERE (a.family = 'SESSION_BOUND'
        AND (sb."activityId" IS NULL OR st."activityId" IS NOT NULL))
    OR (a.family = 'WALL_CLOCK'
        AND (st."activityId" IS NULL OR sb."activityId" IS NOT NULL))
      -- and a roster, which no column can make mandatory for 1–4 participants
    OR NOT EXISTS (SELECT 1 FROM "ActivityParticipant" p WHERE p."activityId" = a.id);
```

**Why it is written per family rather than per symptom.** An earlier draft enumerated symptoms —
*no subtype*, *both subtypes*, *no participants* — and so never compared `a.family` against which
subtype was actually present. A `WALL_CLOCK` root carrying only a `SessionBoundActivity` row has
a subtype, does not have both, and may well have a participant: it passed. The review was right
that the sweep did not cover wrong-family, and right that the *"already covers all three states"*
claim above was false as a result.

`family` is a two-valued enum, so **two predicates, each the complete negation of validity for
one value, are exhaustive by construction** — there is no third case to forget. Each says the
same thing: *the subtype for this family must be present, and the other must be absent.* That one
shape catches all three subtype states at once:

| Invalid state | Caught by |
|---|---|
| missing subtype | the `IS NULL` half of whichever family branch applies |
| wrong-family subtype | the `IS NOT NULL` half of the same branch — and the `IS NULL` half of it too, since the right subtype is also absent |
| both subtypes present | the `IS NOT NULL` half, from whichever branch the root's family selects |

The final predicate catches a participant-less activity of **either** family. The wall-clock case
is already unrepresentable (§6.3.1), but a session-bound Hunt with no roster is not, since 1–4
participants cannot be named by a single column the way one trainee can.

**Test O15** exercises the sweep across every branch: a root with no subtype, a root carrying the
**wrong-family** subtype, a root carrying **both**, and a session-bound root with **no
participants** each make it refuse to start; a database holding only valid activities of both
families passes. Because the `CHECK` constraints make two of those states unrepresentable through
the normal write path, the test constructs them by disabling the constraints for the fixture —
which is also what makes it a genuine test of the sweep rather than of the `CHECK`s.

### 6.4 Invariant enforcement plan

For each invariant, **where** it is enforced. "Application validation" alone is never acceptable
for anything that can be raced.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | One **playable (non-retired)** Character per vocation per account | **partial unique index** on `(accountId, vocation)` with the predicate `WHERE "retiredAt" IS NULL` — declared in `schema.prisma` via Prisma's `where` argument (§3.8), no raw SQL |
| I2 | `count(playable characters) ≤ rosterCapacity ≤ 5` | transaction + `CHECK (rosterCapacity BETWEEN 1 AND 5)`; the count is verified inside the creating transaction |
| I7 | Settlement idempotent under its operation id | **unique constraint** on `SettlementOperation.operationId` |
| I9 | One Session holds an account's Activity claim | **partial unique index** on `SessionBoundActivity(accountId)` with the predicate `WHERE state IN ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED')` — declared as `where: raw(…)` in `schema.prisma` (§3.8), generated into the migration by Prisma Migrate (D13) + compare-and-swap transfer |
| I13 | One occupancy claim per Character | **unique constraint** on `OccupancyClaim.characterId`; the claim's composite FK to `ActivityParticipant` makes it name a participant or nothing (D11) |
| — | A wall-clock activity has **exactly one** participant (§6.3.1) | **two constraints, not one**: the partial unique index on `ActivityParticipant(activityId)` `WHERE family = 'WALL_CLOCK'` gives *at most one* (D12), and `SkillTrainingActivity`'s composite FK to `ActivityParticipant` gives *at least one* (D14) |
| — | Every Activity root has exactly one subtype, of the right family (§6.3.3) | wrong-family and both-present: `CHECK (family = …)` + composite FK — **unrepresentable** at write time (D15, D16). Missing subtype: the atomic start transaction (§8.1). **All three**, plus an empty roster, are also caught by the startup integrity sweep, which refuses to start and never repairs (O15) |
| — | Every Activity pins a content version (`ADR-011`) | `Activity.contentVersion` **NOT NULL** + FK `ON DELETE RESTRICT` (C9) |
| I15 | Duration never consumed outside a qualifying state | **interface capability** — only a state transition writes `qualifyingSince` |
| I16 | A **referenced** content bundle is never deleted | **FK `ON DELETE RESTRICT`** from every durable reference — the database refuses. An **un**referenced bundle may be removed through the explicit audited cleanup path (§7.7) |
| I5 | Balance projection reconciles to the ledger | transaction + **reconciliation job** |
| I6 | Ledger entries append-only | **database permission** — the application role has no `UPDATE`/`DELETE` on the ledger table |
| I10 | Skill Training cannot write Base XP | **interface capability** — its settlement port has no progression method |
| I12 | A Character is never hard-deleted | no delete path exists; retirement sets `retiredAt` |

I6 is worth calling out: revoking `UPDATE` and `DELETE` at the database role level is a
five-line migration and it makes the append-only guarantee true even for a future developer who
has not read `ADR-003`.

### 6.5 Migrations

- Prisma Migrate, forward-only.
- Every migration applies cleanly **to an empty database** and **to the previous migration's
  state** — both are CI checks (§13).
- Migrations run as a **separate step before** the application starts, never at boot.
- `/health/ready` fails on a migration-version mismatch (§10).
- **Hand-written migration SQL is authorized for exactly two things** (§3.8): the ledger role
  grants (I6) and the two subtype `CHECK` constraints (§6.3.3). Partial indexes are **not** among
  them — they are declared in `schema.prisma`, in the object form where it fits and as `raw("…")`
  predicates where it does not, and **Prisma Migrate generates their SQL**. A `raw()` predicate in
  the schema is a declaration, not a hand-edited migration, and the distinction is what D13
  checks: the migration-check script asserts the generated `CREATE UNIQUE INDEX … WHERE (…)`
  statements exist with the declared predicates, **and** that the two `CHECK` constraints are
  present. Each hand-written statement carries a comment naming the invariant it enforces.

### 6.6 Invariant trace — what 0B proves and what it defers

Not every accepted invariant can be proven by a phase that deliberately lacks the model it
governs. Stating that honestly is more useful than a checklist that overclaims.

| Invariant | Status in Phase 0B |
|---|---|
| I1 playable vocation uniqueness | **proven** — D4, D5 |
| I2 roster capacity | **proven** — D6–D8 |
| I5 balance reconciles to ledger | **proven** — economy suite |
| I6 ledger append-only | **proven** — D9, by role grant |
| I7 settlement idempotent | **proven** — test I4 |
| I9 one account activity claim | **proven** — A1–A3, **D10** (the index itself refuses the second non-terminal activity) |
| I10 Skill Training cannot write Base XP | **proven structurally** — the port has no such method |
| I12 no hard delete of a Character | **proven** — no delete path exists |
| I13 one occupancy claim per Character | **proven** — O1–O15 and D11: O13 proves the reconciliation rule is total over every persisted Skill Training status, O14 that ending releases claims while keeping the roster snapshot, O15 that no Activity reaches runtime without a subtype and a roster, D11 that a claim can only name a participant |
| I15 duration only consumed while qualifying | **proven** — T1–T11 |
| I16 referenced bundle never deleted | **proven** — C4 for the refusal, **C7 and C8** for the crash window and the reconciliation asymmetry, **C9** that both activity families pin (`ADR-011`) so the refusal covers Skill Training too |
| **I4 an ItemInstance is in exactly one custody scope** | **ACCEPTED ARCHITECTURE — DEFERRED IMPLEMENTATION.** `ADR-004` is accepted and binding, but `ItemInstance` and custody scopes do not exist in 0B. The invariant is proven by the phase that introduces the item model (Phase 3). **Phase 0B claims no item-duplication coverage.** |
| I3 Active Party membership rules | deferred to the phase that builds Active Party configuration |
| **I14 an exhausted Character receives no Hunt reward by any path, including Shared XP** | deferred with the reward loop — §19 forbids building one in 0B, so there is no distribution path to filter. What 0B *does* build is the per-Character state that rule will read: `ActivityParticipant.staminaActivatedAt`, proven independent per participant by **T15** |
| I8 a paused Activity cannot advance | partially — the state machine exists; the tick path it forbids arrives in Phase 2 |
| I11 formation/equipment frozen during an activity | deferred with the systems it constrains |

---

## 7. Domain primitive contracts

These are the substance of Phase 0B. Signatures are illustrative; the **semantics** are binding.

### 7.1 Server time

Two concerns, deliberately separated. An earlier draft called `Instant` "monotonic-safe", which
is wrong: a wall-clock instant is **not** intrinsically monotonic, and a process monotonic clock
cannot span a restart — which is precisely what durable timers must do.

```ts
interface Clock {
  now(): Instant;            // authoritative UTC wall clock — the ONLY durable timestamp source
}

interface MonotonicSource {
  elapsedSince(mark: Mark): Duration;   // intra-process only, NEVER persisted
}
```

| Concern | Used for | Persisted |
|---|---|---|
| `Clock.now()` — UTC wall clock | every durable timestamp: `qualifyingSince`, `modeSince`, `graceExpiresAt`, ledger entries | **yes** |
| `MonotonicSource` | intra-process measurement such as metrics timing | **never** |

- injected everywhere. **No `Date.now()` in domain or engine code**;
- `FakeClock` in test support: settable, advanceable, and able to **move backwards**, which §7.3
  requires;
- a client-supplied timestamp is **never** an input to any settlement
  (`CLIENT_SERVER_BOUNDARIES.md` §6).

### 7.1.1 Clock regression

Server wall clocks move backwards — NTP correction, VM migration, operator error. Durable
settlement must be defined for it.

**Rules:**

1. an elapsed duration is computed as **`max(0, now − qualifyingSince)`**. It is never negative;
2. a backward step therefore **stalls** a timer rather than reversing it. Nothing is minted, and
   nothing already settled is restored;
3. a regression beyond a **tolerance threshold** is logged at `error` and increments
   `clock_regression_total`. It is an operational signal, not a silent correction;
4. `qualifyingSince` is **never rewritten** to compensate — rewriting it would change history to
   match a broken clock;
5. forward jumps settle normally. An unusually large forward jump is logged, because it is
   indistinguishable from a legitimately long qualifying period and an operator may want to know.

Test T11 covers it.

### 7.2 Character occupancy claim

```ts
interface OccupancyPort {
  acquire(tx, characterIds: CharacterId[], activityRef): Result<void, OccupancyConflict>;
  release(tx, activityRef): Promise<void>;
  reserveForGrace(tx, activityRef): Promise<void>;
  reconcileStranded(tx): Promise<ReleasedClaim[]>;
  assertActivityIntegrity(tx): Promise<void>;   // §6.3.3 — throws; never repairs
}
```

Semantics:

- **at most one claim per Character**, enforced by unique constraint (I13);
- acquisition for a party is **all-or-nothing in one transaction**; any conflict rolls the whole
  thing back, leaving no partial claims;
- ids are locked in **ascending `characterId` order** so two concurrent party starts touching the
  same Characters cannot deadlock (§8.5);
- release happens **in the same transaction as the lifecycle transition**, never as a follow-up,
  and releases **claims only** — the activity's `ActivityParticipant` rows are its durable roster
  snapshot and survive the end of the activity (§6.3.1, O14);
- reconnect grace **reserves** rather than releases — the activity still exists;
- `reconcileStranded` releases only claims whose named activity is absent or terminal. Because a
  claim names its activity, this is reconciliation against durable state, not a heuristic;
- `assertActivityIntegrity` runs the §6.3.3 sweep at startup and before reconciliation. It
  **throws and never repairs**: an Activity with no subtype or no roster is a bug in the start
  transaction, and guessing which subtype it should have had is exactly the kind of repair that
  turns one bad row into a silently wrong one.

### 7.3 `ActiveUseTimer`

```ts
type ActiveUseTimer = {
  remainingDuration: Duration;
  qualifyingSince: Instant | null;   // null ⇒ not currently qualifying
};

interface TimerPort {
  enterQualifying(tx, timerRef, at: Instant): Promise<void>;
  leaveQualifying(tx, timerRef, at: Instant, op: OperationId): Promise<Duration>;
  settleCheckpoint(tx, timerRef, at: Instant, op: OperationId): Promise<Duration>;
  remainingAt(timer, at: Instant): Duration;   // pure read
}
```

Semantics:

- **never decremented on a schedule.** No cron, no per-second tick, no background sweep that
  reduces a timer.
- settlement is `remaining -= (at - qualifyingSince)`, clamped at zero;
- every settlement carries an **operation id**; replaying it is a no-op;
- both fields are durable, so a crash resettles from `qualifyingSince` and produces the **same
  result** — this is a required test (§12);
- `remainingAt` is a **computed read**. Consumers, including the UI, must compute rather than
  trusting the stored field between checkpoints.

Stamina uses this machinery with the sign inverted; it is the framework's first consumer and its
reference implementation.

### 7.3.1 Activity stamina classification — the contract that drives the modes

`ACTIVITY_OCCUPANCY_AND_TIMERS.md` §3.2 requires that **every activity type declares whether it
consumes Stamina**, and that an undeclared type is rejected rather than silently defaulting. An
earlier draft of this specification defined the modes but never the declaration that produces
them. Without it, §7.4's mode is unexplainable.

```ts
type StaminaClassification =
  | 'STAMINA_CONSUMING'
  | 'STAMINA_RECOVERY_ELIGIBLE';

type ActivityTypeDescriptor = {
  key: ActivityTypeKey;
  family: 'SESSION_BOUND' | 'WALL_CLOCK';
  stamina: StaminaClassification;   // REQUIRED — no default exists
  occupiesCharacter: true;          // every activity occupies; ADR-013
};
```

**Which types Phase 0B classifies — and which it deliberately does not.**

An earlier draft carried the comment `// Hunt, Dungeon` beside `STAMINA_CONSUMING`. A code comment
is not a place to decide a product rule, and that one did: **no accepted document classifies
Dungeon.** `ACTIVITY_OCCUPANCY_AND_TIMERS.md` names **Hunt** as the consuming activity throughout
(§2.1 activation and continuation; §2.4 the Party table, where the hunting Knight consumes and
the training Druid does not; §3.2 what recovers; §3.3 the pre-consumption state).
Dungeon appears in the design documents as a distinct activity shape and is given a Stamina
classification **nowhere**. The comment would have invented one, and a technical specification
inventing a product rule in a comment is exactly the failure mode the review is guarding against.

| Activity type | 0B registers a descriptor | Classification | Authority |
|---|---|---|---|
| Hunt | **yes** | `STAMINA_CONSUMING` | `ADR-014`; `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §2.1 — activation by first qualifying **Hunt** XP, sustained while the Hunt is `ONLINE_ACTIVE` |
| Skill Training | **yes** | `STAMINA_RECOVERY_ELIGIBLE` | `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §3.2 — recovery covers any state in which the Character is not reserved in a Stamina-consuming Hunt lifecycle |
| **Dungeon** | **no** | **unclassified in Phase 0B** | none exists — and this specification does not create one |
| any other future type | no | — | — |

**What *is* settled about Dungeon, and what is not.** `DOMAIN_MODEL.md` §5.6 lists Dungeon among
the **session-bound** family, alongside Hunt — that is accepted and this specification does not
touch it. What no accepted document states is Dungeon's **Stamina classification**, and §6.3.1
already establishes why the two cannot be conflated: *family* distinguishes the two lifecycles and
cannot distinguish Hunt from Dungeon, while the classification is a property of the **type**. A
settled family is not a settled classification.

**Dungeon's classification therefore belongs to the phase that introduces its descriptor**,
decided as a product rule with the Product Owner, not inferred here from its resemblance to a
Hunt. Phase 0B builds no Dungeon, persists no Dungeon activity, and needs no answer to proceed.

Nothing is lost by waiting, because the registry rule below makes the omission **safe**: a Dungeon
descriptor cannot be added later without a `stamina` value, since a descriptor missing it fails
validation and the process refuses to start. The open question is held open by a mechanism rather
than by someone remembering it — which is the same argument this document makes everywhere else.

**Occupancy is not consumption.** These are orthogonal, and conflating them is the mistake this
contract prevents: Skill Training **occupies** the Character (so it cannot also hunt) **and** is
**recovery-eligible** (so its Stamina climbs). One claim, two independent classifications.

**Mode derivation** is a pure function of authoritative state — never assigned freely:

```text
deriveStaminaMode(character) =

  no occupancy claim                                          → RECOVERING
  claim → activity type is STAMINA_RECOVERY_ELIGIBLE          → RECOVERING
  claim → STAMINA_CONSUMING, state = RECONNECT_GRACE_PAUSED   → NEUTRAL
  claim → STAMINA_CONSUMING, not yet activated                → NEUTRAL
  claim → STAMINA_CONSUMING, ONLINE_ACTIVE and activated      → CONSUMING
```

"Activated" is the first-qualifying-XP flag of `ADR-014`, persisted on the session-bound
activity per participant. Phase 0B stores and reads it; **Phase 2 decides what raises it.**

**Registry validation.** Activity type descriptors are validated at startup and in CI. A
descriptor missing `stamina` **fails validation and the process refuses to start** — the
fail-fast rule of §11.3 applied to a domain registry. A new activity type cannot be added by
forgetting to classify it. Where the registry lives, and why it is code, is §7.3.2.

### 7.3.2 The activity-type registry — code, with one source of truth

An earlier draft listed `ActivityType` among the persistent concepts *and* described a validated
runtime registry whose descriptor was "the source of truth". Two writable sources, and the review
was right to refuse it. **Decision: the registry is code.** There is no `ActivityType` table, no
`ActivityType` content entry, and `Activity.activityTypeKey` is a plain string column validated
against the registry.

| Question | Answer |
|---|---|
| What is it? | A frozen module, `packages/domain/src/contexts/activity/types/registry.ts`, exporting `ReadonlyMap<ActivityTypeKey, ActivityTypeDescriptor>` |
| Why code and not a table? | A descriptor's `family` selects **which lifecycle code path runs** and its `stamina` selects **which mode derivation applies**. Those are behaviour, and behaviour is versioned with the code that implements it. A table would let a `UPDATE` change which code path an existing row takes, with no review and no deploy — a second, mutable source of truth for something the code has to agree with anyway |
| Why code and not versioned content? | `ADR-011` governs **content**: the definitions a type *consumes* — creatures, loot, encounter tables, a Dungeon's floors. Which *kind* of activity exists, and how it occupies and consumes, is not content; it is the shape of the system. A future Dungeon's floors are content; the Dungeon *type* is a descriptor |
| Does this violate `ADR-011`? | No — it satisfies its spirit. The ADR's rule is that runtime definitions are immutable and versioned rather than mutable database content. A code registry is immutable per deployment and versioned with the repository; a table is precisely the mutable database content the ADR rejects |
| How is `activityTypeKey` validated on write? | The activity-start transaction resolves the key in the registry **before** writing; an unknown key is a domain error, never a row |
| How is it validated at startup? | Every descriptor is schema-checked (`family`, `stamina`, `occupiesCharacter` all present and well-formed) — **T12** — and then **reconciled against the database**: `SELECT DISTINCT "activityTypeKey", "family" FROM "Activity"` must yield only keys the registry contains with the same `family`. A persisted key the registry no longer knows, or a family the registry disagrees with, makes **the process refuse to start** — the same fail-fast rule as T12 and §11.3, so `/health/ready`'s four conditions (§12.1) are unchanged and readiness is simply never reached — **T16**. Removing or reclassifying a type that has persisted rows is therefore a fail-fast event, not a silent drift |
| How can `family` on the row and in the descriptor not drift? | The row's `family` is written from the descriptor in the creating transaction, chained by composite FK to every projection of it (§6.3.1), and reconciled against the registry at every startup. One source, two checks |
| How is it versioned? | With the code. The key set is **append-only** and a key's `family` is **immutable**: a change of lifecycle is a new key, never an edit. A snapshot test pins the `key → family` table and fails on any change that is not an addition |
| How is it initialised? | It is a module; importing it is initialising it. Nothing is loaded, seeded or migrated |

**What Phase 0B registers:** Hunt (`SESSION_BOUND`, `STAMINA_CONSUMING`) and Skill Training
(`WALL_CLOCK`, `STAMINA_RECOVERY_ELIGIBLE`) — the two types whose classification the accepted
documents state (§7.3.1). Nothing else, and nothing with a default.

### 7.4 Stamina

```ts
type StaminaMode = 'CONSUMING' | 'NEUTRAL' | 'RECOVERING';

type CharacterStamina = {
  remaining: Duration;              // 0 … STAMINA_MAX
  mode: StaminaMode;
  modeSince: Instant;
};
```

0B builds the **durable representation and the mode machinery**. It does **not** build the Hunt
reward loop.

- `STAMINA_MAX = 42h` as a domain constant in `packages/shared`, referenced everywhere, never
  re-typed as a literal;
- mode is **derived from authoritative state**, never set freely — a Character cannot be put into
  `CONSUMING` except by the activity machinery;
- recovery settles at **Premium 1:1 / Free 1:2**, capped at `STAMINA_MAX`;
- **segmented settlement**: an interval crossing a rate boundary is split and each segment
  settles at its own rate. Two boundaries exist — the 39:00 line and a Premium entitlement
  transition;
- `NEUTRAL` covers reconnect grace and the pre-consumption Hunt state; it neither consumes nor
  recovers.

**What 0B proves:** that a 42h cap holds, that mode transitions settle correctly, that a Premium
transition splits an interval, and that restart and retry do not double-count. **What 0B does
not do:** decide when a Hunt awards qualifying XP, or apply any XP multiplier.

### 7.5 Entitlement

```ts
type Entitlement = {
  accountId: AccountId;
  kind: EntitlementKind;            // PREMIUM in 0B
  validFrom: Instant;
  validUntil: Instant | null;       // null ⇒ permanent
};

interface EntitlementPort {
  activeAt(accountId, at: Instant): Promise<Entitlement[]>;
  segmentsBetween(accountId, from: Instant, to: Instant): Promise<RateSegment[]>;
}
```

- **Account-wide**, never per Character;
- `validUntil: null` means permanent — expiry is optional, not part of the definition
  (`DOMAIN_MODEL.md` §5.17);
- `segmentsBetween` is what §7.4's segmented settlement consumes: it returns the interval cut at
  every transition;
- transitions are **auditable**;
- **a dev/test fixture may grant Premium** so Phase 2 can be tested before the Phase 8 store
  exists. It is a seeded entitlement row through the ordinary domain path, not a bypass.

### 7.6 Idempotency

Two mechanisms, deliberately separate (`ADR-017`).

**Client commands:**

```ts
type IdempotencyKeyIdentity = {
  principalId: AccountId;
  commandNamespace: string;
  clientKey: string;
};

interface IdempotencyPort {
  execute<T>(identity, fingerprint: Fingerprint, fn: (tx) => Promise<T>): Promise<
    | { outcome: 'executed';  result: T }
    | { outcome: 'replayed';  result: T }
    | { outcome: 'conflict' }            // same identity, different fingerprint
  >;
}
```

- uniqueness is over the **full identity**, never the client key alone;
- the fingerprint is a canonical hash of the semantically significant request fields, so field
  order or formatting cannot cause a false mismatch;
- `conflict` **rejects explicitly** — it does not execute and does not overwrite.

**Server settlements:**

```ts
settlementOperationId(activityId, checkpointSequence) → OperationId   // deterministic
```

Enforced by a unique constraint. A retry after a lost response cannot double-apply.

### 7.7 Content bundle resolver

```ts
interface ContentBundleResolver {
  current(): Promise<ResolvedBundle>;
  resolve(version: ContentVersion): Promise<ResolvedBundle>;   // any referenced version
  isAvailable(version: ContentVersion): Promise<boolean>;
}
```

- bundles are **immutable and versioned as a whole**;
- the process holds the current bundle and may cache **several pinned historical bundles**;
- **any referenced bundle must resolve** — `ADR-016`. No code may assume the current bundle is
  the only loadable one;
- the engine receives **already-resolved definitions** and performs no I/O — resolution happens
  in the application layer before the engine is called.

#### How the pinned set is derived

`ContentBundle` is **metadata only**: version, checksum, published timestamp, storage location.
It carries **no reference count and no pinned flag**. A counter would be a mutable side channel
that can drift from reality, and a drifted counter is how a referenced bundle gets deleted.

Durable entities **reference a bundle version directly** — in 0B that is
**`Activity.contentVersion`**, on the shared root, so that **every** Activity of **either**
family pins. An earlier draft placed the column on `SessionBoundActivity` only, which left Skill
Training — an Activity, per `ADR-002` — pinning nothing. `ADR-011` says *"Every Activity pins the
content version it started with"*, and "every" is not "session-bound". The review was right to
block; the column moved to the root, `NOT NULL`, `ON DELETE RESTRICT` (§6.3.1), and **C9** proves
both families pin. The pinned set is therefore a **query over those real references**:

```sql
SELECT DISTINCT "contentVersion" FROM "Activity"
-- no lifecycle filter. Every durable reference added by a later phase UNIONs into this derivation.
```

**No lifecycle filter, deliberately.** An earlier draft restricted the query to non-terminal
states, which would treat a bundle still referenced by an `ACTIVITY_ENDED` row as unreferenced —
contradicting `ADR-016` (*"never garbage-collected while referenced by any persisted Activity or
other durable row"*) and breaking the replay and support debugging that pinning exists for.

**Pinned means referenced by any durable row that still exists**, whatever its lifecycle state.
An `ACTIVITY_ENDED` Hunt and an `EXHAUSTED` Skill Training both keep pinning for as long as their
`Activity` row — and with it their roster snapshot (§6.3.1) — is retained.

If an ended Activity should stop pinning its bundle, the way to achieve that is a **separately
defined retention or archive operation that deliberately clears the reference** — not a filter
that pretends the reference is absent while it is still there. No such operation is authorized by
this specification.

Every future durable reference to a bundle **joins this same derivation**. That is a rule for the
phases that add them, not an option.

It cannot disagree with reality, because it *is* reality.

#### Deletion

An earlier draft said "no delete path exists", which over-claimed: `ADR-016` permits removing a
genuinely **un**referenced bundle through an explicit audited operation.

| Bundle | May be deleted |
|---|---|
| **Referenced** by any durable row | **never** — refused by the database, not by the cleanup code. Test C4 |
| **Unreferenced** | yes, through the explicit audited cleanup path only |

There is **no automatic sweep.** Cleanup is operator-invoked and logs what it removed.

##### Race and crash safety

An earlier draft said cleanup *"re-derives the pinned set inside the same transaction as its
deletion"*. That is necessary and not sufficient: the local provider deletes a **filesystem
artifact**, which cannot join a PostgreSQL transaction. The review was right to block.

**Structural protection first.** Every durable reference to a bundle is a real foreign key with
`ON DELETE RESTRICT`:

```sql
"contentVersion" ... REFERENCES "ContentBundle"("version") ON DELETE RESTRICT
```

Deleting referenced metadata is therefore refused by **the database**, not by remembering to
check. A cleanup bug cannot delete a referenced bundle; the statement simply fails.

**Against the insert race.** Cleanup takes `SELECT … FROM "ContentBundle" WHERE version = :v FOR
UPDATE` before deleting. A concurrent activity start that references that bundle blocks on the
same row until cleanup commits, and then either finds the row gone — its FK insert fails and the
start is retried against the current bundle — or finds cleanup rolled back and proceeds. There is
no window where a new reference is created to a row being removed.

**Ordering, which is the part that matters.** The metadata row is deleted and **committed
first**; the file is deleted **only after** that commit succeeds.

```text
1. BEGIN
2. SELECT … FOR UPDATE on the ContentBundle row
3. DELETE the row        ← FK RESTRICT refuses if anything still references it
4. COMMIT
5. delete the file       ← only now, and only if step 4 succeeded
```

| Failure point | Outcome |
|---|---|
| Crash before step 4 | rollback. Row and file both intact. A referenced bundle keeps its file. |
| Crash between 4 and 5 | **orphaned file**, no row. Harmless and reconcilable. |
| File delete fails at 5 | same orphan. Logged, retried by reconciliation. |

**Deleting the file first is forbidden**, because its failure mode is the unacceptable one: a
committed-nothing rollback leaving a referenced bundle whose file is gone.

**The asymmetry is deliberate.** An orphaned file wastes disk. A missing referenced file breaks
an activity that cannot be recovered. One is a chore; the other is data loss.

**Reconciliation job**, run on a schedule and after any restore:

| Finding | Meaning | Action |
|---|---|---|
| File with no `ContentBundle` row | orphan from a crash between steps 4 and 5 | safe to remove; log |
| `ContentBundle` row with no file | **a referenced bundle's artifact is missing** | **P1 incident.** Do not delete the row; restore the artifact |

Tests C4, C7 and C8 cover the refusal, the crash window and the reconciliation asymmetry.

#### Restart

The local filesystem provider must resolve a **historical** bundle **after a resolver or process
restart**, not merely from an in-memory cache warmed earlier in the same process. Test C3 asserts
exactly that: publish v1, pin an activity to it, advance to v2, restart, resolve v1.

`DEFERRED` — the storage backend. 0B implements a local filesystem provider behind this
interface; object storage is a later swap that changes no caller.

---

## 8. Transactions and concurrency

### 8.1 Boundaries

Each of these is exactly one transaction. Partial application must be impossible.

An earlier draft wrote "Activity start → activity row, account activity claim, one occupancy
claim per participant", which named neither the subtype nor the participant rows — so nothing in
§8 said that the atomic unit is what §6.3.3 depends on it being. The two start transactions are
now written out in full, in the insert order the foreign keys of §6.3.1 impose.

**Session-bound Activity start** — one transaction, in this order:

| # | Write | Note |
|---|---|---|
| 1 | `Activity` root | `accountId`, `activityTypeKey` resolved through the code registry (§7.3.2), `family = SESSION_BOUND`, **`contentVersion` pinned** to the bundle resolved at start (`ADR-011`), `createdAt` from `Clock.now()` |
| 2 | `SessionBoundActivity` | `state = ONLINE_ACTIVE`, `claimHolderSessionId` = the starting session, `graceExpiresAt = null`, `rngSeed`; `accountId` and `family` written from the root and chained to it by composite FK |
| 3 | `ActivityParticipant` × N | one row per Active Party member, `slotIndex` preserving party order — the **roster snapshot**, frozen here (`ADR-002`); `staminaActivatedAt` written **`null`**, the durable "not yet activated" marker §7.3.1 reads as `NEUTRAL` (`ADR-014`; Phase 2 decides what raises it) |
| 4 | `OccupancyClaim` × N | one per participant, acquired in ascending `characterId` order (§8.5). Any conflict rolls the **whole** transaction back — no partial roster, no partial claims |

**Skill Training start** — one transaction, in this order:

| # | Write | Note |
|---|---|---|
| 1 | `Activity` root | `family = WALL_CLOCK`, **`contentVersion` pinned** exactly as above — a wall-clock Activity pins too (`ADR-011`, C9) |
| 2 | `ActivityParticipant` × **1** | the trainee. `slotIndex = 0`, `staminaActivatedAt = null`. It is written **before** the subtype, because the subtype's foreign key requires it to exist |
| 3 | `SkillTrainingActivity` | `status = ACCRUING`, `startedAt = lastSettledAt = Clock.now()`, `endedAt = null`, `traineeCharacterId` naming the row from step 2 |
| 4 | `OccupancyClaim` × **1** | the trainee's |

Steps 2 and 3 in that order are what make "exactly one participant" structural (§6.3.1): the
subtype cannot be inserted first, so a participant-less training cannot be committed even by a
buggy caller.

**Activity end** — one transaction:

| Does | Does not |
|---|---|
| transitions the subtype to its terminal state (`ACTIVITY_ENDED`, or `ENDED`/`EXHAUSTED`/`CANCELLED`) | delete the `Activity` root |
| performs the final settlement where the family has one, carrying its operation id | delete `ActivityParticipant` rows — they are the durable roster snapshot (§6.3.1, O14) |
| **deletes every `OccupancyClaim`** the activity held | clear `contentVersion` — the Activity keeps pinning its bundle (§7.7, `ADR-016`) |

Removing any retained row is the job of a **separate retention or archive operation**, which this
specification does not authorize (§19).

| Operation | Touches |
|---|---|
| Activity pause | lifecycle state, `graceExpiresAt`, settlement checkpoint, claim reservation |
| Occupancy acquire / release | claims only, inside the owning lifecycle transaction |
| Account claim acquire / transfer | conditional write on the activity claim |
| Idempotent command | the command's own writes **plus** the idempotency record |
| Duration settlement | timer fields + settlement operation row |
| Entitlement transition | entitlement row + audit record |

### 8.2 Concurrency strategy

| Data | Strategy |
|---|---|
| Balances, ledger | **pessimistic** row locks |
| Activity claim, occupancy claim | **conditional write** + unique constraint |
| Activity run state | single-writer by construction — only the claim holder writes |
| Configuration (party order, preferences) | **optimistic**, version column |

### 8.3 Retry behaviour

| Failure | Behaviour |
|---|---|
| Unique-constraint violation on a claim | translate to a typed `OccupancyConflict` / `ActivityClaimHeld`; **do not retry blindly** — the caller decides |
| Serialization failure / deadlock | retry with bounded backoff, **maximum 3 attempts**, then surface |
| Idempotency fingerprint mismatch | **never retried** — an explicit conflict is the answer |
| Crash mid-transaction | database rolls back; the operation id stays free to retry |
| Lost response after commit | client retries with the same key and receives the original result |

### 8.4 Expected failure modes

Named so the implementer returns typed errors rather than generic exceptions:

`OccupancyConflict` · `ActivityClaimHeld` · `IdempotencyConflict` · `EntitlementNotActive` ·
`ContentBundleUnavailable` · `MigrationVersionMismatch` · `StaminaExhausted` (a *state*, not an
error — it never blocks combat).

### 8.5 Lock ordering

**One global order, documented once and obeyed everywhere:**

```text
Account → Character (ascending id) → Activity → ActivityParticipant (ascending characterId)
        → OccupancyClaim (ascending characterId)
        → CurrencyBalance (ascending accountId) → LedgerEntry
```

`ActivityParticipant` sits where it does because §8.1's start transactions write it between the
Activity root and the claims; the order is the insert order the foreign keys already impose
(§6.3.1), so obeying one satisfies the other.

A party start locking Characters in id order cannot deadlock against another party start doing
the same. This rule is why it is written down rather than left to each call site.

---

## 9. `packages/game-engine` contract

Phase 0B does **not** implement Hunt simulation. It establishes the boundary and proves it holds.

### 9.1 Shape

```ts
// Illustrative. Names may change; the character of the boundary may not.
function simulateActivity(
  state:   ActivityRunState,
  party:   ParticipantProfile[],
  content: ResolvedContentSlice,   // already resolved, pinned version
  elapsed: Duration,               // injected — never read from a clock
  rng:     SeededRandom,           // injected — never a global
): SimulationResult;               // DESCRIBES change; applies nothing
```

### 9.2 Binding rules

- **no I/O.** No database, cache, network, filesystem, framework or transport type.
- **time is a parameter.** No `Date.now()`, no timers, no scheduling.
- **randomness is injected**, seeded, and the seed is persisted with the activity.
- **content arrives resolved.** The engine never looks a key up, because it has no way to.
- **output is descriptive.** Orchestration applies it inside a transaction. The engine never
  writes.

### 9.3 What 0B builds

A **minimal deterministic proof**, not gameplay:

- a `SeededRandom` implementation with documented draw ordering;
- a trivial pure function exercising the whole shape — state in, seeded rng in, described result
  out;
- fixtures proving **same inputs + same seed ⇒ byte-identical output**, across process restarts;
- a test proving the engine module graph contains **no** forbidden import (§5.2), which is the
  dependency-cruiser rule and a direct check.

No damage formula, no loot table, no balance number. Inventing one here would be a Phase 2
decision smuggled into Phase 0B.

---

## 10. `packages/game-data` contract

### 10.1 Responsibilities

- **canonical content keys** — `creature.rookgaard.rat`, lowercase dot-separated, immutable once
  published;
- **schemas** and a validator;
- **bundle build** producing an immutable versioned artifact;
- the **resolver interface** of §7.7, with a local filesystem implementation;
- **no runtime hot reload into an existing Activity** — a running activity keeps its pinned
  bundle;
- **no imports from apps, `game-engine`, or any framework.**

### 10.2 Validation (build-time, blocking)

| Check | Catches |
|---|---|
| Schema conformance | missing or mistyped fields |
| Key uniqueness and format | duplicates, malformed keys |
| Reference resolution | a pointer to a definition that does not exist |
| Range sanity | negative damage, probability outside 0–1 |
| Unlock-set cardinality | the Powerful Imbuement set not containing **exactly five** keys |
| Orphan detection | **warning only** — content is often authored ahead of its consumer |

### 10.3 What 0B builds

The **pipeline and the contract**, with a **minimal placeholder bundle** sufficient to prove
validation, build, versioning and resolution end to end.

**Do not author creature, item or hunt content.** That is Phase 2 and later.

---

## 11. Redis and runtime infrastructure

### 11.1 Redis is rebuildable only

| Key family | Holds | If flushed |
|---|---|---|
| `session:presence:*` | connection liveness | sessions reconnect |
| `activity:claim:*` | fast path over the authoritative PostgreSQL claim | rebuilt from PostgreSQL |
| `bull:*` | BullMQ queues and timers | sweeper recovers; see below |
| `ratelimit:*` | counters | limits reset |
| `cache:content:*` | derived content projections | cold cache |

**Every key family must have a documented rebuild path.** A 0B test flushes Redis entirely and
asserts no durable state is lost (§12).

The **activity claim is authoritative in PostgreSQL** (`ADR-009`); Redis only fronts it.

### 11.2 Scheduling is never the source of truth

Grace expiry and similar deadlines are decided from **persisted timestamps**, not from a job
having fired. A BullMQ job may trigger the check promptly; a periodic sweeper covers missed
jobs. A lost job delays a decision; it never changes one.

**Every job is idempotent and safe to run twice.** Job systems deliver at-least-once.

### 11.3 Local infrastructure

`infra/docker-compose.yml` provides PostgreSQL and Redis. `web`, `api` and `worker` run locally
with hot reload.

**One command from a clean clone to a running stack**, with migrations applied and the content
bundle built:

```text
pnpm install
pnpm dev        # compose up, migrate, seed, run all three apps
```

**Environment validation:** zod schema, validated at boot, **fail-fast**. A process that cannot
see its database refuses to start rather than failing on the first request.

**Seed data is generated through domain paths** — a script that creates an account, characters
and entitlements by calling the same application services a user would. Never a SQL dump. A seed
that bypasses the domain can encode states the game cannot reach, and those states become bug
reports nobody can reproduce.

---

## 12. Health and observability

### 12.1 Endpoints

| Endpoint | Checks | Never checks |
|---|---|---|
| `/health/live` | the process is running | **any external dependency** |
| `/health/ready` | PostgreSQL reachable; **migration version matches expected**; Redis reachable; current content bundle available and valid | — |

Liveness must not check dependencies: a liveness probe that fails on a database blip restarts
healthy processes during an incident and converts a database problem into an outage.

Readiness failing on **migration version mismatch** stops a stale instance serving traffic
against a newer schema.

### 12.2 Logging

Structured JSON via pino. A **correlation id per request**, propagated into jobs.

**Never logged:** credential material, session tokens, personal data beyond an account id.

**Always logged:** economy operations with their operation ids, claim acquisition and release,
activity lifecycle transitions, session evictions, entitlement transitions.

### 12.3 Metrics from day one

| Metric | Reveals |
|---|---|
| `occupancy_claims_active` | claim leaks |
| `occupancy_conflicts_total` | contention or a client bug |
| `settlement_duration_seconds` | the hot path degrading |
| `settlement_failures_total` | correctness trouble |
| `idempotency_replays_total` / `idempotency_conflicts_total` | client retry behaviour |
| `ledger_reconciliation_mismatches` | **must be zero** — any non-zero is a P1 |
| `migration_version` | whether a deploy actually rolled out |
| `content_bundle_version` | same, for content |
| `job_queue_depth` / `job_age_seconds` | worker starvation |

### 12.4 Tracing

**Not adopted in Phase 0B.** One deployable and one database means correlation ids in structured
logs answer what distributed tracing would. The trigger is explicit: **adopt tracing when a
second deployable exists.** Recording the trigger prevents it being added as ceremony.

---

## 13. CI specification

GitHub Actions. Every check below is **blocking**. Cheapest first, so failures surface fast.

CI runs the **same scripts as a developer, in the same order** (§4.3). There is no CI-only build
command and no step that exists only in the workflow file — a divergence there is how a pipeline
starts proving something other than what developers run.

| # | Check | Command | Fails on |
|---|---|---|---|
| 0 | **Toolchain and install** | `corepack enable`; `actions/setup-node` with `node-version-file: .nvmrc`; `pnpm install --frozen-lockfile` | a Node outside `engines.node` (via `engineStrict`), a pnpm other than `packageManager`, a lockfile that disagrees with `package.json`, or a dependency install script not listed under `allowBuilds` |
| 1 | Format check | `pnpm format:check` | unformatted files |
| 2 | Lint | `pnpm lint` | lint errors |
| 3 | **Dependency boundaries** | `pnpm boundaries` | any forbidden edge in §5.2 |
| 4 | **Prisma client generation** | `pnpm generate` | a schema that cannot generate a client |
| 5 | Typecheck — **all seven workspaces** | **`pnpm typecheck`** (= `tsc -b` over the six composite projects, then `apps/web`'s `tsc --noEmit`; §4.4) | a type error in any workspace — W13 proves each of the seven is covered |
| 6 | Unit tests | `pnpm test` — unit project | failures |
| 7 | **Deterministic engine fixtures** | `pnpm test` — fixtures project | non-reproducible output for the same seed |
| 8 | **Content validation** | `pnpm --filter @global-idle/game-data run validate` | invalid content bundle |
| 9 | **Migration validation** | `pnpm --filter @global-idle/domain run migrate:check` | migrations failing from empty **or** from the previous state, or generated SQL missing any declared partial-index predicate (D13) |
| 10 | Integration tests (Testcontainers: PostgreSQL + Redis) | `pnpm test:integration` | failures |
| 11 | **Economy invariant tests** | `pnpm test:invariants` | currency double-spend under concurrency, non-idempotent replay, ledger mutation, reconciliation drift |
| 12 | App builds (`web`, `api`, `worker`) | `pnpm build` (= `generate`, `tsc -b`, `next build`) | build errors — `next build` typechecks `apps/web` a second time |

Thirteen checks, numbered 0–12.

**Check 5 is `tsc -b` plus the web app's own check, not `tsc --noEmit` at the root.** An
earlier draft of this table said `--noEmit`, which contradicted §3.3: project references resolve
against **emitted declarations**, so a root no-emit pass has nothing to typecheck the graph
against. A later draft said `tsc -b` alone, which left the apps' membership in the graph unstated.
§4.4 records both corrections: six composite projects in the solution file, `apps/web` checked by
its own `tsc --noEmit` because a `noEmit` project cannot be a reference target, and **W13** as the
proof that all seven are covered.

**Check 4 is a check, not a hidden setup step.** Generation is listed on its own line so a schema
that cannot generate fails *there*, plainly, instead of surfacing as a confusing unresolved-module
error inside check 5.

**Check 0 is a check too.** `engineStrict`, `packageManager`, `allowBuilds` and `--frozen-lockfile` turn the
§3.10 contract into four ways for the build to stop, rather than four sentences in a document.

Check 11 is a **category of its own**, not ordinary unit tests. `AGENTS.md` §6 warns that green
CI does not prove game correctness; these are the part of correctness CI genuinely can prove, and
the part where being wrong costs the most.

**What check 11 does *not* cover in Phase 0B — stated so no one is misled.** An earlier draft
claimed it caught *item duplication*. It cannot: `ItemInstance` and custody scopes are
deliberately absent from 0B (§6.3), so there is no item to duplicate. See §6.6.

**Phase 0B is not `VERIFIED` until CI exists and passes.**

---

## 14. Test matrix — **92 cases**

Every row is required. `§` references the contract it proves.

| Group | Cases | Count |
|---|---|---|
| 14.1 Workspace and boundaries | W1–W13 | 13 |
| 14.2 Database | D1–D18 | 18 |
| 14.3 Occupancy | O1–O15 | 15 |
| 14.4 Activity claim | A1–A6 | 6 |
| 14.5 Timers and Stamina | T1–T16 | 16 |
| 14.6 Idempotency | I1–I4 | 4 |
| 14.7 Redis | R1–R3 | 3 |
| 14.8 Content | C1–C9 | 9 |
| 14.9 Health | H1–H5 | 5 |
| 14.10 Engine | E1–E3 | 3 |
| | **Total** | **92** |

The table is not decoration: §16 criterion 18 and the pull request both state a number, and a
number nobody can re-derive is a number that drifts.

> **Two `I` namespaces, deliberately distinguished.** `I1`–`I4` **in §14.6 are idempotency
> *tests***. `I1`–`I16` everywhere else in this document are **invariants** from
> `DOMAIN_MODEL.md`. Where this document means an invariant it writes *invariant*; where it means
> a §14.6 row it writes *test*. Nothing else in §14 collides — every other group letter is unique
> to its group.

### 14.1 Workspace and boundaries

| # | Test |
|---|---|
| W1 | A forbidden import fails `pnpm boundaries` |
| W2 | `game-engine` importing Prisma fails |
| W3 | `game-engine` importing NestJS fails |
| W4 | `game-engine` using `Date.now` fails |
| W5 | `game-engine` using `Math.random` fails |
| W6 | `packages/*` importing `apps/*` fails |
| W7 | `web` importing `game-engine` or a persistence package fails |
| W8 | One API context importing another's internals fails |
| W9 | The full dependency graph matches the declared rules |
| W10 | `apps/worker` importing anything under `apps/api` fails, and vice versa |
| W11 | Importing a `domain` context internal rather than its `index.ts` fails |
| W12 | **From a clean checkout**, `pnpm install && pnpm build && pnpm test` succeeds; tests resolve packages through their built `exports` |
| W13 | **All seven workspaces are typechecked**: a type error introduced into each of `packages/{shared,game-data,game-engine,domain}` and `apps/{api,worker,web}` in turn makes `pnpm typecheck` fail — the six through `tsc -b`, `apps/web` through its own `tsc --noEmit` (§4.4) |

### 14.2 Database

| # | Test |
|---|---|
| D1 | Migrations apply cleanly from an empty database |
| D2 | Migrations apply cleanly from the previous migration state |
| D3 | UUIDv7 ids are generated server-side and are time-ordered |
| D4 | Two playable Characters of the same vocation on one account is **rejected** |
| D5 | A **retired** Character does not reserve its vocation — a new playable one of that vocation is **accepted** |
| D6 | Retiring a Character does **not** reduce `rosterCapacity` |
| D7 | `rosterCapacity` outside 1–5 is rejected |
| D8 | `count(playable) ≤ rosterCapacity` holds under concurrent creation |
| D9 | The application role cannot `UPDATE` or `DELETE` a ledger row |
| D10 | Two **non-terminal** session-bound activities on one account cannot coexist — the second insert is rejected by the partial unique index, not by application code (invariant I9, §6.3.1). A row moved to `ACTIVITY_ENDED` frees the account for a new one |
| D11 | An `OccupancyClaim` naming a Character who is **not** an `ActivityParticipant` of the claimed activity is refused by the composite foreign key (§6.3.1). The Skill Training trainee therefore has one representation, and a claim cannot drift from it |
| D12 | **At most one participant on a wall-clock activity**: a second participant row is refused by the partial unique index `UNIQUE (activityId) WHERE family = 'WALL_CLOCK'`; a session-bound activity accepts several (§6.3.1) |
| D13 | **Migration-generation validation**: the SQL Prisma Migrate generated for the current schema contains a `CREATE UNIQUE INDEX … WHERE` statement for each declared partial index — I1 (`"retiredAt" IS NULL`), I9 (`state IN ('ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED')`) and the wall-clock cardinality index (`family = 'WALL_CLOCK'`) — **and** that the two hand-written `CHECK` constraints of §6.3.3 are present. Asserted against the migration files, not the schema (§3.8, §6.5). D10, D12, D15 and D16 then prove the generated constraints enforce what they declare |
| D14 | **At least one participant on a wall-clock activity**: inserting a `SkillTrainingActivity` whose `traineeCharacterId` has no matching `ActivityParticipant` row is refused by the composite foreign key — so a participant-less Skill Training cannot be committed at all. With D12, this is what makes "exactly one" structural rather than "at most one" (§6.3.1, §6.3.3) |
| D15 | **Wrong-family subtype is unrepresentable**: a `SessionBoundActivity` row on a `WALL_CLOCK` root, and a `SkillTrainingActivity` row on a `SESSION_BOUND` root, are each refused — by the `CHECK` when the projected `family` is set to the subtype's own constant, and by the composite foreign key when it is set to the root's (§6.3.3) |
| D16 | **Both subtypes on one root is unrepresentable**: after either subtype exists, inserting the other on the same root is refused. The test asserts the refusal from both starting families |
| D17 | **A valid `SESSION_BOUND` Activity is accepted**: root + `SessionBoundActivity` + N `ActivityParticipant` rows + N `OccupancyClaim` rows commit in one transaction and satisfy the §6.3.3 sweep |
| D18 | **A valid `WALL_CLOCK` Activity is accepted**: root + one `ActivityParticipant` + `SkillTrainingActivity` naming it + one `OccupancyClaim` commit in one transaction, in §8.1's order, and satisfy the §6.3.3 sweep |

### 14.3 Occupancy

| # | Test |
|---|---|
| O1 | One Character cannot acquire two occupancy claims |
| O2 | Different Characters acquire claims concurrently without conflict |
| O3 | Party acquisition is **all-or-nothing** |
| O4 | A failed party acquisition leaves **no** partial claim |
| O5 | Same Character: Skill Training while hunting is **rejected** |
| O6 | Different Characters: one hunting, one training, both **succeed** |
| O7 | Reconnect grace **reserves** claims rather than releasing them |
| O8 | Restart reconciliation releases **only genuinely stranded** claims |
| O9 | Concurrent party starts on overlapping Characters do not deadlock |
| O10 | Restart reconciliation **preserves** a live Skill Training claim whose training is `ACCRUING` |
| O11 | Restart reconciliation **releases** a claim whose training is `ENDED`, `EXHAUSTED` or `CANCELLED` |
| O12 | Restart reconciliation **releases** a claim whose named activity row is absent |
| O13 | The reconciliation rule is **total over every Skill Training status**: the test enumerates `ACCRUING`, `ENDED`, `EXHAUSTED`, `CANCELLED` from the persisted enum itself and asserts a preserve/release outcome for each. A status added to the enum without a reconciliation rule **fails this test** rather than being silently unhandled (§6.3.1) |
| O14 | **Ending an activity releases occupancy and preserves the roster snapshot**: after a Hunt ends and after a Skill Training reaches each terminal status, every `OccupancyClaim` it held is gone and every `ActivityParticipant` row — slot order and `staminaActivatedAt` included — is still present and unchanged (§6.3.1, §7.2) |
| O15 | **The startup integrity sweep** (§6.3.3), across every branch: a root with **no subtype**, a root carrying the **wrong-family** subtype, a root carrying **both** subtypes, and a session-bound root with **no participant rows** each make `assertActivityIntegrity` throw and the process refuse to start; a database holding only valid activities of both families passes. The two states the `CHECK` constraints make unrepresentable are constructed with the constraints disabled for the fixture, so the test exercises the sweep rather than the `CHECK`s. The sweep **never repairs** — the test fails if any row is written or deleted by it |

### 14.4 Activity claim

| # | Test |
|---|---|
| A1 | Only one authoritative Account Activity claim exists at a time |
| A2 | Claim transfer (newest-connection-wins) is atomic — no instant with two holders |
| A3 | A paused activity **reserves** its claim |
| A4 | `claimHolderSessionId` survives a process restart and a full Redis flush |
| A5 | Compare-and-swap transfer with a stale expected holder affects **zero rows** and returns `ActivityClaimHeld` |
| A6 | Staleness is decided from `graceExpiresAt`, **not** from absent presence |

### 14.5 Timers and Stamina

| # | Test |
|---|---|
| T1 | `FakeClock` produces deterministic settlement |
| T2 | Repeated settlement with the same operation id does **not** double-consume |
| T3 | Restart from the durable `qualifyingSince` yields the **same** result |
| T4 | Client-provided elapsed time is ignored or rejected |
| T5 | A Premium transition **splits** a duration interval into correctly-rated segments |
| T6 | Stamina never exceeds `STAMINA_MAX` (42:00) |
| T7 | Premium recovery settles 1:1; Free settles 1:2 |
| T8 | `NEUTRAL` mode consumes nothing and recovers nothing |
| T9 | A timer is never decremented by any scheduled job |
| T10 | Crash and retry produce neither double-consume nor double-recover |
| T11 | **Clock regression**: a backwards `Clock.now()` yields elapsed `0`, never negative; nothing is minted or restored; `clock_regression_total` increments |
| T12 | An activity type descriptor **missing** its `stamina` classification fails registry validation and the process refuses to start |
| T13 | **Knight hunting + Druid training**: the Druid holds an occupancy claim **and** is `RECOVERING`; the Knight is `NEUTRAL` before activation and `CONSUMING` after |
| T14 | A `STAMINA_CONSUMING` activity in `RECONNECT_GRACE_PAUSED` is `NEUTRAL` |
| T15 | Two Characters in **one** session-bound activity hold **independent** `staminaActivatedAt` (§6.3.1): activating one leaves the other `NEUTRAL`, each settles from its own marker, and neither participant row is written by the other's activation |
| T16 | **Registry ↔ database reconciliation** (§7.3.2): with an `Activity` row whose `activityTypeKey` the registry does not contain, or whose stored `family` differs from the registry's descriptor, **the process refuses to start** (the same startup path as T12 — readiness is never reached and its four conditions are untouched); with every persisted key known and agreeing, it starts. A persisted type cannot be silently removed or reclassified |

### 14.6 Idempotency

| # | Test |
|---|---|
| I1 | Same principal + namespace + key + **same** fingerprint returns the **original** result |
| I2 | Same scope + **different** fingerprint is **rejected**, executes nothing, overwrites nothing |
| I3 | The same client key on **different accounts** does not collide or leak |
| I4 | A deterministic settlement operation id cannot double-apply |

### 14.7 Redis

| # | Test |
|---|---|
| R1 | A **total Redis flush** loses no durable state |
| R2 | Caches and runtime state rebuild from PostgreSQL |
| R3 | A lost scheduled job delays a decision but does not change one |

### 14.8 Content

| # | Test |
|---|---|
| C1 | An invalid bundle fails validation |
| C2 | A bundle builds with a version identifier |
| C3 | A **historical pinned** bundle resolves after the current bundle advances **and after a process restart** — not from a warmed in-memory cache |
| C4 | The cleanup path **refuses to delete a referenced bundle** — refused by the foreign key, with cleanup code removed from the equation; it deletes an unreferenced one and logs what it removed |
| C5 | An unlock set without exactly five keys fails validation |
| C6 | The pinned set is derived by querying real references — `SELECT DISTINCT "contentVersion" FROM "Activity"`, both families — and there is no reference-count column to drift |
| C7 | **The crash window** (§7.7): with the metadata delete committed and the file delete not yet run, the bundle is absent from the pinned derivation, no referenced bundle lost its file, and the next reconciliation pass removes the orphan. Crashing *before* the commit leaves row and file both intact |
| C8 | **Reconciliation asymmetry** (§7.7): a file with no `ContentBundle` row is removed and logged; a row with no file is **never** deleted — it is reported as an incident. The test fails if reconciliation ever deletes a row to resolve a missing artifact |
| C9 | **Every Activity pins** (`ADR-011`): an `Activity` of either family cannot be inserted without a `contentVersion`; a Skill Training activity's bundle is refused deletion exactly as a Hunt's is; after the current bundle advances and the process restarts, `resolve(activity.contentVersion)` still succeeds for the Skill Training activity (§7.7, §6.3.1) |

### 14.9 Health

| # | Test |
|---|---|
| H1 | `/health/live` succeeds with PostgreSQL **down** |
| H2 | `/health/ready` fails with PostgreSQL down |
| H3 | `/health/ready` fails with Redis down |
| H4 | `/health/ready` fails on a migration version mismatch |
| H5 | `/health/ready` fails when the content bundle is unavailable or invalid |

### 14.10 Engine

| # | Test |
|---|---|
| E1 | Same inputs + same seed ⇒ identical output |
| E2 | Determinism survives a process restart |
| E3 | The engine's module graph contains no forbidden import |

---

## 15. Work package breakdown

Eleven packages. The ordering differs from the suggested one in exactly two places, both
justified.

```text
0B.1 ──► 0B.2 ──┬──► 0B.3 ──┬──► 0B.4 ──┬──► 0B.6
                │           │           └──► 0B.5
                │           └──► 0B.7
                └──► 0B.8 ──► 0B.9
                                 └──► 0B.10 ──► 0B.11
```

Every package's acceptance tests are **executable at the end of that package** — nothing a
package accepts depends on a later one. An earlier draft broke this twice (0B.2 proved a
generated client against a schema that arrived in 0B.3; 0B.7 asserted foreign-key refusals
against `Activity` rows that did not exist until 0B.3), and the review was right to block. Both
are fixed by the 0B.2 / 0B.3 / 0B.7 boundaries below.

**Deviation 1 — 0B.10 (CI) starts early, alongside 0B.1.** Standing CI up at the end means all
thirteen checks light up red at once, against a large diff. The skeleton workflow
(format, lint, boundaries, typecheck) lands with the workspace; the remaining checks are added
by the package that makes them meaningful. `ADR-012` requires boundary rules in the first commit
anyway, and a rule nothing runs is a comment.

**Deviation 2 — 0B.7 (content) does not block 0B.4/0B.5/0B.6, and follows 0B.3 rather than
0B.2.** The domain primitives do not depend on content; only `/health/ready` does, so 0B.7 runs in
parallel with them. It follows **0B.3**, not 0B.2, because C4 and C6–C9 assert the database's
refusal to delete a *referenced* bundle, and a reference is an `Activity` row — which exists only
once 0B.3's schema does. Those tests insert `Activity` rows directly; they do not need 0B.6's
activity service.

---

### 0B.1 — Workspace and tooling

**Goal.** A workspace that cannot violate its own boundaries.

**Files.** `pnpm-workspace.yaml` (workspace list **and** the pnpm settings of §3.10:
`nodeLinker`, `shamefullyHoist`, `engineStrict`, `allowBuilds`), root `package.json` (`"type":
"module"`, **`engines.node` = `>=24.21.0 <25`**, **`packageManager` = `pnpm@12.5.1`**,
`typescript@~6.0.3`, and the script block of §4.3), `.nvmrc` (`24.21.0`), `tsconfig.base.json`
(§3.4), root `tsconfig.json` (the solution file of §4.4), `eslint.config.js`, `.prettierrc`,
`.dependency-cruiser.cjs`, `vitest.config.ts` (`test.projects`, §3.7), `.gitignore` (ignoring
`dist/`, `*.tsbuildinfo`, `packages/domain/src/generated/`), `.env.example` (documenting
`DATABASE_URL`).

**Prerequisites.** None.

**Acceptance.** W1–W9. `pnpm install`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
`pnpm boundaries` all run and pass on an otherwise empty workspace.

**Done when.** A deliberately-added forbidden import fails `pnpm boundaries` locally and in CI,
**and** installing under a Node outside `>=24.21.0 <25` fails rather than warns (§16 criterion 5b).

---

### 0B.2 — Application and package skeleton

**Goal.** Seven workspaces — three apps, four packages — that build, start and import each other legally.

**Files.** `apps/web` (Next.js), `apps/api` (NestJS adapters + composition root), `apps/worker`
(BullMQ consumers + composition root), `packages/shared`, `packages/domain` (context
directories), `packages/game-data`, `packages/game-engine` — each with `package.json` (`"type":
"module"`), `tsconfig.json` (`composite: true` for the packages and the two Node apps, §4.4), and
a trivial entry point. **The Prisma generator and configuration land here**, so the clean-build
proof is executable at the end of this package: `packages/domain/prisma/schema.prisma` with the
generator block and datasource of §4.3 and **exactly one model, `ContentBundle`** — the leaf every
later reference points at, with no foreign keys of its own — plus `packages/domain/prisma.config.ts`
and `src/platform/prisma/client.ts`. **No migration** is written in 0B.2; migrations are 0B.3's,
and the first one covers every model.

**Prerequisites.** 0B.1.

**Acceptance.** W6–W8, **W10–W13**, E3. All three apps build and start. Both apps reach the
domain only through `packages/domain`; neither can import the other.

**Done when.** **W12 passes from a clean checkout** — `pnpm install && pnpm build && pnpm test`,
with `packages/domain/src/generated/` absent beforehand and **no database reachable** — and
`tsc -b` builds the six composite projects in dependency order, compiling the generated
`ContentBundle` client along with the hand-written source. **W13 passes**: a type error in any of
the seven workspaces fails `pnpm typecheck`. An earlier draft proved the generated client here
against a schema that only arrived in 0B.3; the review was right that that could not be executed
at the end of 0B.2.

---

### 0B.3 — Database and migrations

**Goal.** A schema whose constraints enforce the load-bearing invariants.

**Files.** The rest of `packages/domain/prisma/schema.prisma`: every model of §6.3 beyond
`ContentBundle` — the `Activity` root with its `contentVersion` FK, `SessionBoundActivity`,
`SkillTrainingActivity`, `ActivityParticipant` and `OccupancyClaim` with their composite foreign
keys (§6.3.1); the account claim holder (§6.3.2); the **initial migration** covering every model,
with **I1, I9 and the wall-clock cardinality index declared in the schema** (object form and
`raw()`, §3.8) — partial indexes are **never** hand-written — and **hand-written migration SQL
for exactly two things and no others: the ledger role grants (I6) and the two subtype-family
`CHECK` constraints (§6.3.3)**; the `migrate:check` script of §4.3, including its generated-SQL
assertion (D13).

**Prerequisites.** 0B.2.

**Acceptance.** D1–D18.

**Done when.** Migrations apply from empty and from the previous state; D4 and D5 both pass —
duplicate playable vocation rejected, retired vocation reusable; **D10–D12 pass** — the second
non-terminal session-bound activity, the claim naming a non-participant, and the second
wall-clock participant are each rejected by the database rather than by application code;
**D14–D16 pass** — a participant-less Skill Training, a wrong-family subtype and a both-subtypes
root are each unrepresentable (§6.3.3); **D17 and D18 pass** — a valid activity of each family
commits; **D13 passes** — the generated migration SQL carries every declared predicate and both
`CHECK` constraints; and D9 confirms the application role cannot mutate a ledger row.

---

### 0B.4 — Core domain primitives

**Goal.** Identifiers, transactions, idempotency, minimal ledger.

**Files.** `packages/shared/src/{ids,result,constants}` (including `STAMINA_MAX`);
`packages/domain/src/platform/{transaction,idempotency}`;
`packages/domain/src/contexts/economy` — minimal ledger and balance.

**Prerequisites.** 0B.3.

**Acceptance.** D3, **tests** I1–I4 (§14.6 — not the invariants of the same name), and the
economy invariant category of §13 check 11.

**Done when.** Idempotency behaves correctly across all four cases including cross-account
isolation, and the ledger reconciles.

---

### 0B.5 — Time, `ActiveUseTimer`, entitlements

**Goal.** The duration machinery every timed system will use.

**Files.** `packages/domain/src/platform/clock` (`Clock`, `SystemClock`, `FakeClock` with
backwards support, `MonotonicSource`); `packages/domain/src/contexts/character/stamina` including
the activity-type **code registry** of §7.3.2 with its startup reconciliation, and `deriveStaminaMode` (§7.3.1);
`packages/domain/src/contexts/identity/entitlement`; a shared `ActiveUseTimer` in
`packages/domain/src/platform/timer`.

**Prerequisites.** 0B.4.

**Acceptance.** T1–T16.

**Done when.** T3 passes (restart from the durable marker is identical), T5 passes (a Premium
transition splits an interval), **T11 passes** (clock regression stalls rather than reverses),
**T13 passes** — Knight hunting while the Druid trains, with the Druid occupied *and* recovering —
and **T15 passes**, with two participants in one activity activating independently. The registry
this package builds is the **code registry of §7.3.2** — no table — and classifies **Hunt and
Skill Training only**; Dungeon is deliberately absent (§7.3.1), T12 keeps that absence safe, and
**T16 passes**: a persisted key the registry does not know, or a family it disagrees with, makes
the process refuse to start.

---

### 0B.6 — Activity and occupancy claims

**Goal.** One action per Character; one activity per account.

**Files.** `packages/domain/src/contexts/activity/{claim,occupancy,lifecycle,skill-training}`,
including the **atomic start and end transactions of §8.1** and the **startup integrity sweep of
§6.3.3** (`assertActivityIntegrity`); the reconciliation job in `apps/worker`, calling the
Activity context's **public surface** — never reaching into `apps/api` (§4.2).

**Prerequisites.** 0B.4.

**Acceptance.** O1–O15, A1–A6.

**Done when.** O3 and O4 pass (all-or-nothing party acquisition), O9 shows no deadlock, **O10–O13
pass** — reconciliation preserves a live training claim, releases only a terminal or orphaned one,
and O13 proves the rule is total over every persisted status — **O14 passes** — ending releases
every claim and leaves every participant row untouched — **O15 passes**, with the integrity sweep
refusing to start on a subtype-less or roster-less Activity and never repairing one — and
**A4–A6 pass** for the durable claim holder.

---

### 0B.7 — Content bundle foundation

**Goal.** Build, validate, version and resolve content bundles.

**Files.** `packages/game-data/src/schema`, `.../validate`, `.../build`, `.../resolver`; a
minimal placeholder bundle; the CI validation script; the audited cleanup path and the
reconciliation job of §7.7 in `packages/domain` (they touch `ContentBundle` rows and are called
through the Content context's public surface).

**Prerequisites.** **0B.3** — C4 and C6–C9 need `Activity` rows to reference a bundle, and
`Activity` exists only once 0B.3's schema does. They insert those rows directly and do not need
0B.6.

**Acceptance.** C1–C9.

**Done when.** C3 passes — a historical pinned bundle still resolves after the current bundle
advances **and a process restart**; C4 confirms the database refuses to delete a referenced bundle;
C7 and C8 confirm the crash window leaves an orphaned file rather than a missing one; **C9
confirms both activity families pin** and that a Skill Training activity's bundle is protected
exactly as a Hunt's is.

---

### 0B.8 — Redis and runtime infrastructure

**Goal.** Redis holding nothing that matters, and a one-command local stack.

**Files.** `infra/docker-compose.yml`; `packages/domain/src/platform/{redis,config}` (zod,
fail-fast); BullMQ setup in `apps/worker`; the seed script calling `packages/domain` services.

**Prerequisites.** 0B.2.

**Acceptance.** R1–R3.

**Done when.** R1 passes — a full Redis flush loses no durable state — and `pnpm dev` takes a
clean clone to a running stack.

---

### 0B.9 — Health, observability, operations

**Goal.** Know what the system is doing, and whether it should receive traffic.

**Files.** `apps/api/src/health`; `packages/domain/src/platform/{logging,metrics}` (pino with a
correlation id, prom-client), the `/metrics` endpoint in `apps/api`, and the migration-version
check in `packages/domain/src/platform/prisma`.

**Prerequisites.** 0B.8.

**Acceptance.** H1–H5.

**Done when.** H1 passes — liveness succeeds with PostgreSQL down — and readiness fails on each
of the four conditions independently.

---

### 0B.10 — CI and test harness

**Goal.** Every rule in this document enforced by a machine.

**Files.** `.github/workflows/ci.yml` (Corepack, `node-version-file: .nvmrc`,
`--frozen-lockfile`, `DATABASE_URL` exported for every step, pnpm-store caching — §4.3),
Testcontainers setup, the engine determinism fixtures, the `integration` and `invariants` entries
of `vitest.config.ts`'s `test.projects`.

**Prerequisites.** 0B.1 for the skeleton; each later package adds its own checks.

**Acceptance.** All **thirteen** checks in §13 (0–12) run and pass, each invoking the same script
a developer runs.

**Done when.** CI is green on a pull request and a deliberately-broken boundary turns it red.

---

### 0B.11 — Integration and foundation review

**Goal.** Prove the foundation holds together and contradicts nothing accepted.

**Deliverables.**
- the full test matrix of §14 passing;
- a written trace from each accepted ADR to where 0B satisfies or defers it;
- the Definition of Done checklist of §16, completed with evidence;
- a list of anything the implementation decided autonomously, with rationale.

**Prerequisites.** All packages.

**Done when.** §16 is satisfiable line by line with evidence, not assertion.

---

## 16. Definition of Done

Objective and checkable. Every line needs evidence, not a claim.

| # | Criterion |
|---|---|
| 1 | `pnpm install` then `pnpm build` then `pnpm test` succeeds from a **clean checkout**, in that order |
| 1a | That clean checkout has **no generated artifact in it** — `packages/domain/src/generated/`, `dist/` and `*.tsbuildinfo` are absent and git-ignored. `prisma generate` runs as the first step of `pnpm build` (§4.3), never as a lifecycle hook, and succeeds with no database reachable |
| 2 | `pnpm format:check` passes |
| 3 | `pnpm lint` passes |
| 4 | `pnpm typecheck` passes across **all seven** workspaces, and W13 shows each one is actually in the check (§4.4) |
| 5 | `pnpm boundaries` passes, and a deliberately-added forbidden import fails it |
| 5a | `apps/worker` cannot import `apps/api`, and no app reaches a `domain` context internal |
| 5b | The §3.10 contract holds **mechanically**: `.nvmrc` is `24.21.0`, `engines.node` is `>=24.21.0 <25`, `packageManager` is `pnpm@12.5.1`, and `pnpm-workspace.yaml` sets `nodeLinker: isolated`, `shamefullyHoist: false`, `engineStrict: true` and an explicit `allowBuilds` list. Installing under a Node outside the range **fails**, an unlisted install script **fails**, and CI reads `.nvmrc` rather than restating a version |
| 6 | Unit tests pass |
| 7 | Integration tests pass against ephemeral PostgreSQL and Redis |
| 8 | Deterministic engine fixtures pass, including across a process restart |
| 9 | Content validation passes; an invalid bundle fails it |
| 10 | Migrations apply cleanly from empty **and** from the previous state |
| 11 | `apps/web` builds and starts |
| 12 | `apps/api` builds and starts |
| 13 | `apps/worker` builds and starts |
| 14 | PostgreSQL connects; the schema matches the expected migration version |
| 15 | Redis connects; a full flush loses no durable state |
| 16 | `/health/live` returns healthy with PostgreSQL down |
| 17 | `/health/ready` fails independently on each of its four conditions |
| 18 | The complete §14 test matrix passes — **all 92 cases**, matching the group table at the head of §14 |
| 19 | CI is green, with all **thirteen** checks of §13 (0–12) present, each running the same script a developer runs |
| 20 | **No accepted architecture invariant is contradicted** — traced ADR by ADR, with §6.6's deferrals stated rather than overclaimed |
| 21 | **No Hunt balance or gameplay loop was implemented** — no XP curve, damage formula, loot table or reward multiplier exists |
| 22 | **No product rule was created by this phase.** The activity-type registry classifies **Hunt and Skill Training only**; Dungeon and every other future type remain unclassified, and T12 proves an unclassified type cannot reach production (§7.3.1) |
| 23 | **Every Activity pins a content version** — `Activity.contentVersion` is `NOT NULL` with `ON DELETE RESTRICT`, and C9 shows a Skill Training activity's bundle is protected exactly as a Hunt's (`ADR-011`) |
| 24 | **Ending an activity releases occupancy and keeps the roster snapshot** — O14 shows every claim gone and every `ActivityParticipant` row intact; the Skill Training trainee has one representation (D11, D12, D14) |
| 24a | **A wall-clock activity has exactly one participant, structurally** — D12 for at most one, **D14 for at least one**. No statement in the specification attributes "exactly one" to the partial unique index alone (§6.3.1, §6.3.3) |
| 24b | **Every Activity root has exactly one subtype of the right family** — D15 and D16 show wrong-family and both-present are unrepresentable; O15 shows a missing subtype or an empty roster makes the process refuse to start and is never repaired; D17 and D18 show a valid activity of each family commits (§6.3.3) |
| 24c | **Activity start is atomic over root + subtype + participants + claims + pinned `contentVersion`**, in §8.1's documented insert order, and Activity end releases claims while retaining participant and history rows |
| 25 | **The activity-type registry has one source of truth** — no `ActivityType` table or content entry exists; T16 shows a persisted key the code registry does not know makes the process refuse to start (§7.3.2) |
| 26 | **The generated Prisma client is the `prisma-client` generator's output**, in `packages/domain/src/generated/`, compiled by `tsc -b`, wired through `@prisma/adapter-pg`, configured by `prisma.config.ts` — no `prisma-client-js` block exists (§4.3) |

Criterion 21 deserves its own review question: *did anything in this phase require a balance
number to be correct?* If yes, scope leaked.

Criterion 22 deserves the mirror question: *did anything in this phase decide something the
Product Owner has not decided?* A comment, a default value and an enum member all count.

---

## 17. Autonomous decisions in this specification

Made under the project's autonomous execution model (`AGENTS.md` §3), recorded for reversal.

| # | Decision | Rationale | Reversal cost |
|---|---|---|---|
| 1 | **pnpm** | strict `node_modules` makes undeclared dependencies fail at resolution — a second boundary layer beneath the lint rules | low, before code exists |
| 2 | **No task runner initially**, Turborepo trigger recorded | seven workspaces do not need a build graph tool; `pnpm -r` is already topological | low |
| 3′ | **Composite packages with project references and `tsc -b`** — *corrects* the earlier source-only claim, which was incoherent with project references | one resolution model across editor, typecheck, tests and build; avoids the NestJS `paths`-not-rewritten footgun | low — decided before code exists |
| 4 | **Vitest** | workspace mode maps to pnpm; fake timers that can run **backwards**, which §7.1.1 requires; resolves through the same `exports` as production | medium — test rewrites |
| 5 | **dependency-cruiser** as the authoritative boundary gate | reasons over transitive edges, emits a reviewable graph | low |
| 6′ | **Contexts live in `packages/domain`; both apps depend on it** — *corrects* the earlier "contexts inside `apps/api`" | the earlier rationale was wrong: the forbidden edge is **package → app**, and a package depending on Prisma breaks no rule. This gives the worker a legal call path instead of an app-to-app reach-in | low — decided before code exists |
| 7 | **UUIDv7 generated in application code** | not every PostgreSQL version offers `uuidv7()`; keeps generation testable under a fake clock | low |
| 8′ | **Prisma 7.10.x pinned, `partialIndexes` preview enabled; I1 and I9 declared in the schema** — *corrects* the withdrawn "Prisma cannot express partial indexes" claim | researched: 7.4 added it behind a preview flag, 8 promotes it to GA but is still an RC. A foundation phase should not pin to a pre-release | low — dropping the flag on Prisma 8 GA changes no syntax |
| 9 | **Ledger append-only by database role grant** | makes I6 true for a developer who has not read `ADR-003` | low |
| 10 | **CI starts in 0B.1**, not at the end | avoids thirteen checks failing at once against a large diff | low |
| 11 | **0B.7 parallel to 0B.4–0B.6** | no dependency exists; shortens the critical path | low |
| 12 | **Testcontainers** for integration tests | developer and CI run the same thing; no hand-started database | low |
| 13 | **BullMQ** | Redis-backed, matches the approved Redis role | low |
| 14 | **Retry bounded at 3 attempts** for serialization failures | bounded so a pathological case surfaces instead of spinning | low |
| 15 | **Shared `Activity` root with two subtype tables** | gives `OccupancyClaim.activityId` one referential target while keeping the two lifecycles distinct, as `ADR-002` requires | low |
| 16 | **`claimHolderSessionId` durable in PostgreSQL**, presence ephemeral in Redis | the claim must survive a Redis flush (`ADR-009`); presence must not | low |
| 17 | **`StaminaClassification` is a required field with no default** | an unclassified activity type failing at startup is the only way "undeclared is rejected" is true in practice | low |
| 18 | **`ContentBundle` is metadata; the pinned set is a query** | a reference count is a mutable side channel that can drift, and a drifted count deletes a referenced bundle | low |
| 19 | **Elapsed is `max(0, now − qualifyingSince)`**; a backward clock stalls a timer | never negative, never mints or restores value; the regression is an operational signal, not a silent correction | low |
| 20″ | **Exact pins: `.nvmrc` = `24.21.0`, `engines.node` = `>=24.21.0 <25`, `packageManager` = `pnpm@12.5.1`; Corepack the only pnpm path; pnpm settings (`nodeLinker: isolated`, `shamefullyHoist: false`, `engineStrict: true`, explicit `allowBuilds`) in `pnpm-workspace.yaml`** — *replaces* the earlier placeholders and the `.npmrc` location, and *corrects* the "24.11" attribution | placeholders are not pins; pnpm 12 reads `pnpm-workspace.yaml`, not `.npmrc`; the 24-line floor in this toolchain is NestJS 12's (`^24.15.0`), not Prisma's (`>=24.0`), and 24.21.0 is the current release. §3.1's boundary claim is false the moment the linker hoists | low — values in three files |
| 21′ | **`prisma-client` generator, `output` inside `src/`, every generator field explicit, compiled by `tsc -b`, imported relatively** — *replaces* the `prisma-client-js` + subpath-import plan | the current generator emits TypeScript; inside `rootDir` it is compiled like any source and resolves by relative path in every context, with no indirection. Its `runtime`/`moduleFormat`/extension fields are set rather than inferred so a `tsconfig` edit cannot silently change the output | low — decided before code exists |
| 22 | **`prisma generate` is an explicit first step of `pnpm build`, never a `postinstall` hook** | lifecycle-script behaviour varies by package-manager version and settings; a step that *sometimes* runs cannot produce a deterministic clean build | low |
| 23 | **Dungeon is deliberately left unclassified for Stamina** | no accepted document classifies it, and a technical specification is not where a product rule should be born. The registry's fail-fast rule makes the omission safe rather than merely pending | none — the decision is to *not* decide |
| 24 | **ESM in every workspace; TypeScript `~6.0.3`, not the `7.0` `latest`** | NestJS 12 ships with no CommonJS entry point and its CLI pins TypeScript `~6.0`; `uuid@14` and `zod@4` are ESM-only. The framework's own toolchain decides both, and the decision is written into `package.json`, `tsconfig.base.json` and the generator block rather than inferred | medium — a module-format change touches every import |
| 25 | **`tsc -b` is the only compiler for `apps/api` and `apps/worker`; `nest build` is not used; both are composite reference targets** | one compiler over one graph is one definition of a type error; the Nest CLI's build has no `--build` mode and would be a second one | low |
| 26 | **`apps/web` is typechecked by its own `tsc --noEmit` and by `next build`, outside the solution graph** | a `noEmit` project cannot be a project-reference target, and forcing emit on a Next.js app fights its toolchain. W13 proves coverage instead of asserting it | low |
| 27 | **`contentVersion` lives on the `Activity` root, `NOT NULL`, `ON DELETE RESTRICT`** — *moves* it off `SessionBoundActivity` | `ADR-011` says *every* Activity pins; Skill Training is an Activity. The pinned-set derivation now reads one table for both families | low — one column moves |
| 28 | **Ending an activity releases occupancy claims and retains `ActivityParticipant` rows** — *corrects* "deletes both" | the participant rows are the durable roster snapshot `ADR-002` and `DATA_ARCHITECTURE.md` §7 require for history, replay and support; removal belongs to a retention operation this specification does not authorize | low |
| 29′ | **`SkillTrainingActivity.traineeCharacterId` returns, as a composite FK into `ActivityParticipant`** — *corrects* decision 29, which removed the column entirely | decision 29 fixed drift but left cardinality at *at most one*: nothing stopped a training with **zero** participants. A foreign key requires its target to exist, so the column supplies the missing *at least one* while remaining incapable of naming a non-participant — the "relationship that makes mismatch impossible" the third review asked for, now also closing the fourth review's gap | low — one column and one FK |
| 32 | **Two hand-written `CHECK` constraints pin each subtype to its family** | with the composite FK already chaining subtype `family` to the root's, they make wrong-family **and** both-subtypes-present unrepresentable — two invalid states for two lines, and **no extra code**, since the startup sweep must exist anyway for the missing-subtype case. Weighed explicitly against the reviewer's "no unnecessary custom SQL" instruction in §6.3.3 | **very low — deleting them loses only timing, not coverage** |
| 33 | **A missing subtype is prevented transactionally and detected by a startup sweep that throws and never repairs; the sweep is written per family so it is exhaustive over every invalid subtype state on its own** | "every parent has at least one child" needs a deferred circular FK or a trigger; neither is worth it, and the specification says so instead of claiming a guarantee it does not have. Writing the query as one complete negation per enum value — rather than as a list of symptoms — is what makes "deleting the `CHECK`s costs only timing" true rather than merely asserted. Repairing would mean guessing which subtype was intended: one bad row becoming a silently wrong one | low |
| 34 | **§8.1 writes both start transactions out in full, in foreign-key insert order** | the atomicity §6.3.3 depends on was asserted in §6 and unstated in §8; and the Skill Training order (participant **before** subtype) is what makes "exactly one" hold even for a buggy caller | low |
| 30 | **The activity-type registry is a frozen code module with startup reconciliation against persisted rows; no `ActivityType` table** | behaviour classification is code, versioned with the code that switches on it; a table is the mutable second source `ADR-011`'s spirit rejects; T16 turns removal or reclassification of a persisted type into a fail-fast event | low |
| 31 | **0B.2 carries the generator, `prisma.config.ts` and the `ContentBundle` model; 0B.3 carries every other model and every migration; 0B.7 follows 0B.3** | each package's acceptance must be executable when that package ends. `ContentBundle` is the leaf every reference points at and has no foreign keys of its own, so it is the one model that can exist before the graph does | low |

None contradicts an accepted ADR or a LOCKED product rule. Decisions 3′, 6′, 8′, 20″, 21′ and
29′ **correct, narrow or replace** earlier ones in this same document, at the independent
reviewer's direction; decisions 27–31 correct model statements the third review found to
contradict `ADR-011`, `ADR-002` or the accepted persistence model; decisions 29′ and 32–34 close
the relational-integrity gaps the fourth review found — the largest of which was this document
claiming *"exactly one"* for a constraint that only delivers *at most one*.

Decision 23 is the only one that is a decision **not to decide**, and it is recorded here
precisely because the previous draft made the opposite decision silently, in a code comment.

---

## 18. Deferred parameters

Genuinely non-blocking for Phase 0B. Most are configuration inputs; three — Node 26 adoption,
TypeScript 7 adoption and Dungeon's Stamina classification — are decisions for a later phase. **No boundary, interface or
invariant in this specification depends on any of them**, which is what makes deferring them
honest rather than convenient.

| | |
|---|---|
| Content bundle **storage backend** | contract fixed in §7.7; 0B ships a local provider |
| Idempotency record **retention window** | long enough to cover any plausible retry |
| Serialization-failure **backoff curve** | attempt cap is fixed at 3; the curve is tuning |
| Redis **cache TTLs** | every key family has a rebuild path regardless |
| **Node 26 adoption** (LTS from October 2026) | *not* the Node version itself — that is pinned to `24.21.0` / `>=24.21.0 <25` in §3.10. What is deferred is **when** to move the line. Node 26 does not ship Corepack, so moving the line **replaces the pnpm installation path** in the same change |
| **TypeScript 7 adoption** | pinned to `~6.0.3` (§3.4) because NestJS 12's CLI pins `~6.0`. Moving to the native compiler is a decision taken when the Nest toolchain takes it; nothing in the configuration is on TypeScript 7's removal list, so the move should be a version bump |
| **Dungeon's Stamina classification** | a product decision for the phase that introduces the Dungeon activity type; 0B registers no Dungeon descriptor and T12 prevents one appearing unclassified (§7.3.1) |
| Metric **histogram buckets** | tuning |
| Settlement **checkpoint interval** | Phase 2; the cost model is recorded in `ADR-006` |
| Every gameplay **balance value** | Phase 2 and later, by definition |

---

## 19. What this specification does not authorize

Stated plainly so scope cannot drift during implementation:

- no Hunt simulation, room progression, encounter resolution or creature behaviour;
- no XP curve, damage formula, loot table, rarity roll, affix generation or reward multiplier;
- no Premium XP band **effect** — the entitlement state exists, the maths does not;
- no gameplay UI beyond what is needed to prove an app starts;
- no Forge, Market, Wheel, Skill Tree or Imbuement application;
- no creature, item or hunt content;
- no payment or store integration;
- no `ItemInstance` or custody implementation — Phase 3;
- **no Dungeon activity type, and no Dungeon descriptor** — its Stamina classification is a
  product decision this specification deliberately does not make (§7.3.1);
- no change to `pnpm-workspace.yaml`'s linker settings, `engines.node`, `.nvmrc` or
  `packageManager` beyond the values §3.10 fixes — those are architecture, not build
  configuration;
- no committed generated artifact of any kind (§4.3);
- no `ActivityType` table, seed or content entry — the registry is code (§7.3.2);
- no retention or archive operation that removes `Activity`, `ActivityParticipant` or
  `ContentBundle` rows (§6.3.1, §7.7, §8.1);
- no repair path in the §6.3.3 integrity sweep — it throws, and inventing a missing subtype is
  never authorized;
- no hand-written migration SQL beyond the ledger role grants and the two subtype `CHECK`
  constraints (§3.8, §6.5);
- no `prisma-client-js` generator block and no `nest build` step (§4.3, §4.4).

---

## 20. Status and next step

This document is **`IMPLEMENTATION_SPEC_READY`**, approved by the Product Owner on 2026-09-20
after five rounds of independent review. `ADR-018`, which it raised, is `ACCEPTED` with it.

**What that means for the implementing phase.** Implementation proceeds on a separate branch and
pull request under the execution model of `AGENTS.md` §3: the builder works autonomously within
the accepted architecture, runs the full matrix, self-reviews, opens a pull request, and does not
merge its own work. The order is §15's: 0B.1 → 0B.2 → 0B.3, with 0B.7 after 0B.3 and 0B.10
alongside 0B.1 from the first commit.

**What is now fixed, and what is not.** Every tooling pin (§3), boundary (§5), schema constraint
(§6), contract (§7) and test (§14) in this document is binding. The eight entries in §18 are the
only parameters left open, and §19 is the list of things implementation may **not** build. A
primitive that genuinely cannot be built within these boundaries is a **new superseding ADR**,
raised before the code — never an edit to this document and never a quiet deviation.

Phase 0B is `VERIFIED` only when §16 is satisfied line by line with evidence and CI is green.
`IMPLEMENTATION_SPEC_READY` is permission to build, not a claim that anything is built.
