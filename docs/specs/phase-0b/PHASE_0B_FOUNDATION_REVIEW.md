# Phase 0B — Foundation review

**Status:** `IMPLEMENTATION_COMPLETE — CI GREEN — PENDING PRODUCT OWNER REVIEW`
**Specification:** [`PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md`](./PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md) (`IMPLEMENTATION_SPEC_READY`)
**Branch:** `feat/phase-0b-technical-foundation`

This is work package **0B.11**'s deliverable: the test matrix, an ADR-by-ADR trace, the
Definition of Done with evidence rather than assertion, and a list of everything the
implementation decided on its own.

> **§16 criterion 19 is now satisfied.** The workflow runs on GitHub and **all thirteen checks
> pass**, including the Testcontainers suites this environment could not exercise:
> [run 35614825163](https://github.com/Hokz/Global-Idle/actions/runs/35614825163), on the current head, alongside the
> `dev-bootstrap` job. The FIRST green run took three attempts
> ([35550647692](https://github.com/Hokz/Global-Idle/actions/runs/35550647692)), and each failure
> was a real defect a green local suite could not have shown — §6 records them.
>
> Moving Phase 0B itself to `VERIFIED` is the Product Owner's call, not this document's. What
> this document reports is that every criterion now carries evidence.

---

## 1. Test matrix — 92 cases

`node scripts/count-matrix.mjs` counts one `it('<ID>: …')` per matrix case and compares the
result with the group table at the head of §14. That is what keeps *"all 92 cases pass"* a
countable claim rather than an assertion.

```text
W: 13/13   D: 18/18   O: 15/15   A: 6/6    T: 16/16
I: 4/4     R: 3/3     C: 9/9     H: 5/5    E: 3/3
TOTAL 92/92
```

| Group | Cases | Where |
|---|---|---|
| §14.1 Workspace and boundaries | W1–W11, W13 | `tests/unit/workspace-boundaries.test.ts` |
| | W12 | `tests/unit/clean-build.test.ts` |
| §14.2 Database | D1–D9 | `tests/integration/database-schema.test.ts` |
| | D10–D18 | `tests/integration/activity-integrity.test.ts` |
| §14.3 Occupancy | O1–O15 | `tests/integration/occupancy.test.ts` |
| §14.4 Activity claim | A1–A6 | `tests/integration/activity-claim.test.ts` |
| §14.5 Timers and Stamina | T4–T9, T11–T14 | `tests/unit/stamina-and-modes.test.ts` |
| | T1–T3, T10, T15, T16 | `tests/integration/timers.test.ts` |
| §14.6 Idempotency | I1–I4 | `tests/integration/idempotency.test.ts` |
| §14.7 Redis | R1–R3 | `tests/integration/redis.test.ts` |
| §14.8 Content | C1–C9 | `tests/integration/content.test.ts` |
| §14.9 Health | H1–H5 | `tests/integration/health.test.ts` |
| §14.10 Engine | E1, E2 | `tests/fixtures/engine-determinism.test.ts` |
| | E3 | `tests/fixtures/engine-boundary.test.ts` |

Full run, all four Vitest projects: **16 files, 116 tests, 0 failures** — 23 unit, 3 fixtures,
84 integration, 6 invariants. The twenty-four cases beyond the matrix are not counted toward the
92: seven unnumbered assertions that belong with their neighbours (the `/metrics` surface, the
registry's own consistency), and the seventeen observability cases the two correction passes
added — ten proving §12.2 and §12.3 are exercised by real flows, seven proving occupancy errors
are classified narrowly and reconciliation reports what it released.

---

## 2. ADR trace — all eighteen

Each row says where the decision is **enforced**, not where it is mentioned. Where 0B defers, it
says so in the words §6.6 uses, without widening the claim.

| ADR | Status in 0B | Enforced by |
|---|---|---|
| **001** Bounded contexts, single ownership | satisfied | `contexts/<name>/index.ts` as the only public surface, enforced by dependency-cruiser **inside** the package as much as across it (`domain-context-public-surface-only`, `domain-no-cross-context-internals`) — W8, W11 |
| **002** Activity owns in-flight state; settlement is the only durable path | satisfied structurally | one shared `Activity` root, two subtype tables, the roster snapshot **retained** after end — O14, D15–D18. The settlement path itself is Phase 2; nothing here writes durable progression |
| **003** Ledger-derived currency balances | satisfied | append-only by **database role grant** (`REVOKE UPDATE, DELETE ON "LedgerEntry"`), projection moved in the same transaction, reconciliation recomputed from entries — D9, the invariants suite, `ledger_reconciliation_mismatches` |
| **004** An ItemInstance has exactly one custody scope | **accepted, implementation deferred to Phase 3** | `ItemInstance` does not exist in 0B (§6.3, §6.6). **Phase 0B claims no item-duplication coverage** |
| **005** Active Party is ordered configuration | partially — the ordering is honoured where it exists | `ActivityParticipant.slotIndex`; the engine consumes the party as an **ordered array**, and E1 shows reordering it is a different run. Party configuration itself is a later phase (`contexts/party` is a contract only) |
| **006** Composition frozen for a run; power refreshes at checkpoints | deferred with settlement | the roster snapshot that a refresh reads is built and retained (O14); the checkpoint that refreshes it is Phase 2 |
| **007** Retirement, not erasure | satisfied | `retiredAt`, a partial unique index over **playable** rows, and `retireCharacter` with **no delete counterpart** — D4, D5, D6 |
| **008** The newest connection evicts the previous | satisfied | `transferClaim`'s compare-and-swap in one statement; zero rows updated means another session won — A1–A6 |
| **009** PostgreSQL sole durable truth; Redis rebuildable | satisfied | every Redis key family has a documented rebuild path, and a key outside the table **cannot be written** (`UndocumentedRedisKey`); a total flush loses nothing — R1, R2 |
| **010** Pure engine, injected clock and RNG | satisfied | dependency-cruiser over the module graph **and** ESLint over the globals no graph tool can see, each proven to bite by real violations — E3; determinism against a committed golden file, in-process and after a restart — E1, E2 |
| **011** Content is versioned; every Activity pins its version | satisfied | `Activity.contentVersion` `NOT NULL` on the **shared root**, `ON DELETE RESTRICT` — C9 proves both families pin and that a Skill Training bundle is protected exactly as a Hunt's |
| **012** One deployable modular monolith, build-enforced boundaries | satisfied, as amended by **018** | one image, two start commands; `apps/api ↛ apps/worker` and the reverse — W10; nothing in `packages/` reaches `apps/` — W6 |
| **013** One primary action per Character, atomically | satisfied | `OccupancyClaim.characterId` as the primary key, the claim's composite FK into `ActivityParticipant` so it can only name a participant — O1–O15, D11 |
| **014** Per-Character Stamina, activated by first qualifying XP | satisfied for the state; the reward loop is deferred | `CharacterStamina` per Character, `staminaActivatedAt` per participant, a mode **derived** and never assigned — T4–T15. **I14 is deferred with the reward loop**: §19 forbids building one here, so there is no distribution path to filter |
| **015** Active-use timers settle at checkpoints, never by wall clock | satisfied | `remainingAt` as a **computed read**, elapsed as `max(0, now − since)`, a backward clock stalling rather than restoring — T1–T3, T10 |
| **016** Referenced bundles are never garbage-collected | satisfied | **the database refuses**, by `ON DELETE RESTRICT`, with cleanup code removed from the equation — C4; the crash window leaves an orphaned file and never a missing one — C7; reconciliation never deletes a row to resolve a missing artifact — C8 |
| **017** Account-scoped, fingerprinted idempotency keys | satisfied | `fingerprintOf` canonicalising at every depth, a unique constraint on the key, `ON CONFLICT DO NOTHING` for settlement claims — I1–I4 |
| **018** The bounded contexts live in `packages/domain` | satisfied | both apps depend on `packages/domain` and neither on the other; the worker calls a context's public surface, the same call path the api uses — W6, W10, W11 |

**Nothing in this implementation contradicts an accepted ADR.** Three are deferred, and each
deferral is the one §6.6 already records: **I4** (no item model in 0B), **I3** (no Active Party
configuration yet), **I14** (no reward loop to filter). Two more are partial for the same reason:
**I8** has the state machine but not the tick path, and **I11** waits for the systems it
constrains.

---

## 3. Definition of Done — §16, line by line

| # | Criterion | Evidence |
|---|---|---|
| 1 | `pnpm install && pnpm build && pnpm test` from a clean checkout | **W12** copies the tree to a scratch directory with a pristine environment and runs exactly that sequence — including **`pnpm test`, the documented root command**, not a subset of it. An earlier version ran `vitest run --project unit` there, which proved clean-install → build → *unit tests* while claiming the criterion's own wording (see i30) |
| 1a | No generated artifact in the checkout; `prisma generate` succeeds with no database reachable | `git check-ignore` confirms `packages/domain/src/generated/`, `dist/` and `*.tsbuildinfo`; **measured:** `DATABASE_URL` pointing at a dead port, `pnpm generate` exits 0. No `postinstall` hook generates anything |
| 2 | `pnpm format:check` | passes |
| 3 | `pnpm lint` | passes |
| 4 | `pnpm typecheck` across all seven workspaces | passes; **W13** proves each of the seven is in the check by putting a real type error in each and asserting the command fails |
| 5 | `pnpm boundaries`, and a forbidden import fails it | passes (82 modules, 209 dependencies). **Measured:** `shared → ioredis`, `web → ioredis` and `engine → @nestjs/common` each turn it red |
| 5a | `apps/worker ↛ apps/api`; no app reaches a context internal | **W10**, **W11** |
| 5b | The §3.10 contract holds **mechanically** | `.nvmrc` = `24.21.0`; `engines.node` = `>=24.21.0 <25`; `packageManager` = `pnpm@12.5.1`; `pnpm-workspace.yaml` sets `nodeLinker: isolated`, `shamefullyHoist: false`, `engineStrict: true` and an explicit `allowBuilds` map. **Measured:** installing under Node 22.22.2 fails at the `preinstall` guard; removing one `allowBuilds` entry fails the install with `ERR_PNPM_IGNORED_BUILDS`; CI reads `.nvmrc` through `node-version-file` and restates no version |
| 6 | Unit tests | 23 pass; 3 fixture cases pass |
| 7 | Integration tests against ephemeral PostgreSQL and Redis | **satisfied.** 84 integration and 6 invariant cases pass **under Testcontainers in CI** ([run 35614825163](https://github.com/Hokz/Global-Idle/actions/runs/35614825163), checks 10 and 11), and locally against PostgreSQL 16 and Redis through the documented escape hatch |
| 8 | Deterministic engine fixtures, including across a process restart | **E1**, **E2** — against a **committed golden file**, because two fresh runs of a broken implementation agree with each other perfectly |
| 9 | Content validation passes; an invalid bundle fails it | `pnpm --filter @global-idle/game-data run validate` exits 0; **measured:** an invalid source exits 1 and names the check. **C1** covers every §10.2 check |
| 10 | Migrations apply from empty **and** from the previous state | `migrate:check` — **D1**, **D2**; **D13** asserts the generated SQL carries every declared partial-index predicate and both hand-written `CHECK` constraints |
| 11 | `apps/web` builds and starts | `next build` in `pnpm build`; **measured:** `next start` serves `200` |
| 12 | `apps/api` builds and starts | **measured:** starts, `/health/live` `200`, `/health/ready` `200` with all four conditions `up` |
| 13 | `apps/worker` builds and starts | **measured:** starts, logs ready, and registers its repeatable sweep (`bull:activity-maintenance:repeat:grace-expiry-sweep` present in Redis) |
| 14 | PostgreSQL connects; the schema matches the expected migration version | `/health/ready`'s `migrations` indicator reports `20260920231400_phase_0b_hand_written_constraints`; **H4** shows a database ahead of this build fails readiness |
| 15 | Redis connects; a full flush loses no durable state | **R1** |
| 16 | `/health/live` healthy with PostgreSQL down | **H1** |
| 17 | `/health/ready` fails independently on each of its four conditions | **H2** (PostgreSQL), **H3** (Redis), **H4** (migration version), **H5** (content unavailable *and* invalid). H2 also asserts the control: with everything up, all four report `up` |
| 18 | The complete §14 matrix — all 92 cases | 92/92, counted (§1 above) |
| 19 | **CI green, thirteen checks, each the same script a developer runs** | **satisfied.** All thirteen green on GitHub: [run 35614825163](https://github.com/Hokz/Global-Idle/actions/runs/35614825163), on the current head. The same thirteen also pass locally, in the same order, against a genuinely clean checkout |
| 20 | No accepted architecture invariant contradicted | §2 above, ADR by ADR, with §6.6's deferrals stated rather than overclaimed |
| 21 | No Hunt balance or gameplay loop | no XP curve, damage formula, loot table or reward multiplier exists. The engine's per-participant draw is **deliberately uninterpreted**; `settleRecovery` produces the 39:00 and Premium **split** and applies no multiplier to it. *Did anything require a balance number to be correct?* **No.** |
| 22 | No product rule created by this phase | the registry classifies **Hunt and Skill Training only**; there is no Dungeon descriptor, and **T12** proves an unclassified type cannot reach production. *Did anything decide something the Product Owner has not?* **No** — §5 lists every implementation decision, and none is a product rule |
| 23 | Every Activity pins a content version | `NOT NULL` + `ON DELETE RESTRICT` on the shared root — **C9** |
| 24 | Ending an activity releases occupancy and keeps the roster snapshot | **O14**; the trainee has one representation — **D11**, **D12**, **D14** |
| 24a | A wall-clock activity has exactly one participant, structurally | **D12** (at most one, partial unique index) and **D14** (at least one, composite FK). Neither is credited with both halves |
| 24b | Every root has exactly one subtype of the right family | **D15**, **D16** (unrepresentable), **O15** (the startup sweep refuses and never repairs), **D17**, **D18** (a valid activity of each family commits) |
| 24c | Start is atomic over root + subtype + participants + claims + pin | `startSessionBound` and `startSkillTraining`, one transaction each, in §8.1's insert order; Skill Training writes the **participant before the subtype**, which is what makes "exactly one" hold for a buggy caller |
| 25 | One source of truth for activity types | a frozen code registry, no `ActivityType` table, no content entry — **T16** makes a persisted key the registry does not know a startup refusal |
| 26 | The `prisma-client` generator's output, in `src/`, compiled by `tsc -b`, wired through `@prisma/adapter-pg`, configured by `prisma.config.ts` | `packages/domain/prisma/schema.prisma` — no `prisma-client-js` generator block exists in the repository — the only occurrences of the name are a comment recording that it is not used, and URLs inside the generated client |

**All twenty-six are satisfied with evidence.**

---

## 4. Work packages

| Package | Commit | Acceptance |
|---|---|---|
| 0B.1 Workspace and tooling | `build(0B.1)` | W1–W5, W9 |
| 0B.2 Application and package skeleton | `feat(0B.2)` | W6–W8, W10–W13, E3 |
| 0B.3 Database and migrations | `feat(0B.3)` | D1–D18 |
| 0B.4 Core domain primitives | `feat(0B.4)` | I1–I4, the invariants suite |
| 0B.5 Time, timers, entitlements | `feat(0B.5)` | T1–T16 |
| 0B.6 Activity and occupancy claims | `feat(0B.6)` | O1–O15, A1–A6 |
| 0B.7 Content bundle foundation | `feat(0B.7)` | C1–C9 |
| 0B.8 Redis and runtime infrastructure | `feat(0B.8)` | R1–R3 |
| 0B.9 Health, observability, operations | `feat(0B.9)` | H1–H5 |
| — the engine's deterministic proof (§9.3) | `feat(engine)` | E1, E2 |
| 0B.10 CI and test harness | `ci(0B.10)` | the thirteen checks |
| 0B.11 Integration and foundation review | this document | §16 |

---

## 5. Autonomous decisions made during implementation

§17 records the decisions the **specification** made. These are the ones the **implementation**
made, under the same model, recorded for reversal. None creates a product rule and none
contradicts an accepted ADR.

| # | Decision | Rationale | Reversal cost |
|---|---|---|---|
| i1 | A `preinstall` guard, `scripts/check-node-version.mjs` | **measured:** pnpm's `engineStrict` enforces *dependencies'* `engines`, not the root project's own. A forced install under Node 22 exited 0 without it, which made §3.10's first mechanical guarantee untrue | low — one script |
| i2 | An inert `"source"` export condition on each workspace package, and `conditionNames` with `source` first in the cruise | **measured:** without it the cruise saw **zero cross-package edges** — `apps/worker/src/main.ts → @global-idle/domain` was absent, and W6, W7 and W10 could never fire. An earlier attempt (`exportsFields: []`) broke third-party ESM resolution | low |
| i3 | `not-to-unresolvable` as an error, and later: framework bans matched as **paths under node_modules**, with node_modules modules kept in the graph as leaves | the bare-specifier patterns matched nothing; every framework ban was in fact resting on the package being absent from that workspace. **Measured:** with `@nestjs/common` at the repository root, a NestJS import in the engine produced **no finding at all** | low |
| i4 | `fileParallelism: false` for the unit project | the §14.1 cases write a real violation into the working tree and run the real command; two such files in parallel see each other's violations | low |
| i5 | `NODE_ENV` deliberately absent from `.env` | **measured:** pinning it to `development` made `next build` prerender with React's development build and fail on its own `/_global-error` page. Each tool sets it for what it is doing | low |
| i6 | `*.md`, `docs/` and the engine golden file in `.prettierignore` | `pnpm format` rewrote 43 approved documents and 1,295 lines of the specification on first use; and a formatter that adds a trailing newline should not break a determinism test for a reason that has nothing to do with determinism | low |
| i7 | `identity.createAccount`/`linkIdentity` and `character.createCharacter`/`retireCharacter` | §11.3 requires the seed to go **through domain services**, and none existed. `createCharacter` carries I2's transactional count, which D8 now drives instead of re-implementing | low |
| i8 | The content lifecycle lives in `packages/domain/src/contexts/content/` | 0B.7 places it in `packages/domain`, and §5.2 forbids `game-data` from importing Prisma. See **§7** — §4.1's arithmetic sentence is now one short | low — one directory |
| i9 | The audited cleanup path propagates the foreign-key error **untranslated**, and performs no pre-check | §7.7 makes the refusal the database's. A pre-check invites the belief that the check is the protection; a translated error puts cleanup code back into it | low |
| i10 | `deleteBundleMetadata` is a separate exported operation | it **is** §7.7's steps 1–4, so C7 can exercise the crash window without a test seam in production code | low |
| i11 | Queue **names** in `packages/domain/src/platform/jobs`; BullMQ setup stays in `apps/worker` | the worker consumes the queue and `/metrics` reports its depth, and neither app may import the other | low |
| i12 | `bullmq` and `ioredis` added to `apps/api` | otherwise `job_queue_depth` and `job_age_seconds` are declared and never populated, and §12.3 says *metrics from day one* | low |
| i13 | The Redis readiness probe is a **function**, not a held client | **measured:** a long-lived client cannot both fail fast while Redis is down and recover when it returns — with retries off it never reconnects, with them on a `PING` queues. A healthy Redis reported `down` | low |
| i14 | Every injection in `apps/api` uses an explicit token | Nest can infer a class-typed parameter from `design:paramtypes`, but that metadata exists only when the compiler emits it, and esbuild — which the test runner uses — does not | low |
| i15 | `createApp` in `apps/api`, and **no NestJS at the repository root** | root devDependencies are reachable from every workspace; putting a framework there weakens the boundary for everything. The test drives the same wiring the process does | low |
| i16 | `CONTENT_BUNDLE_DIR` resolved to an absolute path at load; the api and worker start from the repository root | **measured:** relative, it resolved differently for each app and `/health/ready` reported `content` down | low |
| i17 | The engine's PRNG is sfc32 seeded by cyrb128, **written out in the repository** | a dependency that changes its implementation changes every historical replay, and this package must reproduce a run recorded a year ago | medium — changing it invalidates the golden file, which is the point |
| i18 | `nextInt` consumes exactly one draw, never rejection-sampling | a variable number of draws makes the same seed produce different futures depending on data, and the bug surfaces as an unreproducible support ticket | low |
| i19 | The restart cases (C3, C9, E2) spawn a **real node process** against the built package | a fresh object in the same process has a cold cache but the same module graph; "survives a restart" is not a claim that can support | low |
| i20 | `economy.countReconciliationMismatches`, a `FULL OUTER JOIN` | `ledger_reconciliation_mismatches` must be zero, and drift runs both ways: a wrong projection, and a missing one | low |
| i21 | Local env via `node --env-file-if-exists`, not a runtime dotenv dependency | Node 24 loads it; a runtime dependency to read a development file is one more thing in the production image | low |
| i22 | CI checks 6 and 7 run `pnpm test:unit` and `pnpm test:fixtures` | §13's command column reads *"`pnpm test` — unit project"*. Taken literally, checks 6 and 7 would each run the whole suite and duplicate checks 10 and 11. Both are scripts a developer runs | low |
| i23 | CI provides a PostgreSQL **service** for check 9 and installs `psql` if the image lacks it | `migrate:check` creates and drops scratch databases; checks 10 and 11 still use Testcontainers and never this service | low |
| i24 | `'silent'` added to `LOG_LEVELS` | a health check that prints a request line per case buries the failure it is reporting. It is a real pino level | low |
| i25 | `package-manager-cache: false` on `actions/setup-node` | **measured on GitHub:** it defaults to true, sees `packageManager: pnpm@12.5.1`, and shells out to `pnpm` to resolve the store path — while still installing the Node that Corepack ships with. Corepack cannot move earlier without shimming the runner's default Node. The store is cached explicitly anyway | low |
| i26 | `not-to-unresolvable` exempts `generated/prisma/` | **measured on GitHub:** check 3 was red with five unresolvable imports of the generated client, because §13 runs boundaries at 3 and generation at 4. The cruise already excludes that tree from the graph, so whether it exists is check 4's question, not check 3's. Once generation has run, the import resolves and the exemption applies to nothing | low |
| i27 | The test global setup attaches the application role's login after migrating | the migration creates `globalidle_app` `NOLOGIN` on purpose (§6.4), and **D9 passed here only because the role had been given a login by hand in an earlier session** — exactly the local state that makes a suite green on a developer machine and red in CI. Reproduced by resetting the role: `28P01 password authentication failed`. The migration still holds no credential | low |
| i28 | An **observability port** in `platform/observability`, bound by each composition root | §12.3's counters and §12.2's events are reported by domain code that must not import `prom-client` or hold a logger (§5.2). The port is the boundary: `domain event → port → adapter`. The default is a no-op, so a process that binds nothing still works and a test binds its own and sees only its own |
| i29 | Domain events are **buffered and emitted after the transaction commits** | a domain operation runs inside a transaction that may still roll back. One buffer per ATTEMPT, established by `withTransaction`, because a retried attempt's writes are gone and its events must go with them. A "success" line for a vanished row is worse than no line |
| i30 | W12 runs **`pnpm test`**, and forwards `GLOBAL_IDLE_TEST_*` into the scratch checkout | §16 criterion 1 names the root command; hand-picking projects tests an approximation of the public interface instead of the interface. The nested run therefore includes the database suites, which need services: with a Docker daemon it brings its own up, and where the documented escape hatch is in use instead it has to be handed down, because `runClean` strips the environment on purpose |
| i32 | `isOccupancyUniqueViolation` in `platform/errors`, matched on the **constraint name** | `acquire` turns what it matches into a typed conflict AND a `occupancy_conflicts_total` increment, so a broad predicate lies twice. Measured against Prisma 7.10 + `@prisma/adapter-pg`: a lost race is P2002 / SQLSTATE 23505 with `meta.driverAdapterError.cause.constraint.index` naming `OccupancyClaim_pkey`. `meta.target` is **not** populated by this adapter, which is why nothing reads it. Anything else — a foreign key, a dead connection, a serialization failure the retry layer owns (§8.3) — propagates untouched |
| i33 | `reconcileStranded` deletes with `DELETE … RETURNING`, matched on the **(character, activity) pair** | the §12.2 event has to describe what this transaction actually released. Under ReadCommitted a candidate can be gone by the time the delete runs, so counting candidates would record a release that never happened; matching the pair rather than the Character alone also leaves a claim re-acquired for a live activity where it is. One event per activity, because a sweep can strand claims from several at once and a single aggregate filed under an arbitrary id is a false record |
| i31 | The developer-bootstrap verification is a **script and a CI job of its own**, not a case in the test matrix | it runs `docker compose up`, so it cannot share a runner with the job whose PostgreSQL service already holds 5432, and putting it in the integration project would make `pnpm test` — which W12 now nests — require compose. §15's 0B.10 allows a dedicated step for exactly this |

---

## 6. Verification status — including what is still **not** verified

Stated plainly, because a foundation review that overclaims is worse than one that is short. All
three claims below were unverified when this document was first written. All three now carry a
CI run as evidence; what remains unverified is stated under the table, not hidden in it.

| Claim | Status |
|---|---|
| **CI is green** (§16 criterion 19) | **VERIFIED** — [run 35614825163](https://github.com/Hokz/Global-Idle/actions/runs/35614825163), all thirteen checks plus the matrix count, on the current head. The first green run took three attempts; those three defects are i25, i26 and i27 |
| **Integration tests under Testcontainers** (§16 criterion 7) | **VERIFIED in CI.** The `GLOBAL_IDLE_TEST_*` escape hatch is deliberately absent from the workflow, so Testcontainers was the only path. Locally Testcontainers still cannot run — the daemon starts, but this environment's egress policy refuses Docker Hub image blobs — and the escape hatch exists for exactly that. The suite has since been run here against a local PostgreSQL 16 and Redis through that hatch, which is how the Prisma error shapes behind i32 were measured rather than assumed |
| **`pnpm dev`** (§11.3, one command to a running stack) | **VERIFIED** — [run 35614825163](https://github.com/Hokz/Global-Idle/actions/runs/35614825163), the `dev-bootstrap` job, which runs `scripts/verify-dev-bootstrap.mjs`. It has passed on every run since it was added ([35557424621](https://github.com/Hokz/Global-Idle/actions/runs/35557424621) was the first). It spawns the REAL `pnpm dev` and waits for every acceptance signal before shutting the stack down: compose healthy, migrations applied *and present in `_prisma_migrations`*, the content bundle built, the seed *present as rows in the database*, `/health/live` and `/health/ready` 200 with all four conditions up, `apps/web` serving 200, the worker booted *and its repeatable sweep registered in the Redis the stack brought up*. It asks the running system wherever it can rather than grepping log lines. Every signal was met, in order, and the stack was torn down with its volumes |

**Locally the bootstrap verification still cannot run**, and fails loudly rather than skipping: this
environment's egress policy refuses Docker Hub image blobs (`403` on
`production.cloudfront.docker.com`), so `docker compose up` cannot pull `postgres:16-alpine`.
The verifier detected `pnpm dev`'s early exit, printed the captured output and exited non-zero —
which is the behaviour a bootstrap check is for. CI has the images, and is the evidence above.

### One thing found here and deliberately left alone

`isRetryable` (§8.3, `platform/transaction`) reads the SQLSTATE from `code` and `meta.code`.
Measured against this stack, a deadlock arrives as `code: 'P2010'` with the real SQLSTATE at
`meta.driverAdapterError.cause.originalCode` — a path that function does not read — and
`'P2010'` itself matches its five-character SQLSTATE test, so the structural check returns a
code that is not a SQLSTATE and never matches. **Retries work today only because the message
regex still matches Prisma's prose.** Behaviour is correct, so this is fragility rather than a
defect, and rewriting the retry layer was outside this correction pass. Raised here rather than
changed.

### Observability is proven by behaviour, not by declaration

A registered metric and a declared event type are infrastructure. Nothing in
`tests/integration/observability.test.ts` calls the port: every case performs the real domain
operation and then asserts what the **real prom-client registry** and the bound sink recorded.

| Proven | Case |
|---|---|
| `occupancy_conflicts_total` increments on a refused claim, and **not** on an unrelated failure | a second activity claiming the same Character; an unknown activity type, which never reaches the claim; and a **real foreign-key violation inside the insert itself**, which propagates as P2003 and is not counted |
| `settlement_duration_seconds` observes **every** settlement | a first settlement and its idempotent replay — two observations, zero failures |
| `settlement_failures_total` counts a real failure only | a settlement statement that violates `NOT NULL` |
| `idempotency_replays_total` / `idempotency_conflicts_total` are counted separately | the same key replayed, then reused with a different fingerprint |
| `economy.operation` carries its operation id | a committed posting |
| `occupancy.acquired` / `occupancy.released` | a real activity start and end |
| `occupancy.released` on the **reconciliation** path, one event per activity | a stranded party of two and a stranded solo swept in one call: two events, `2` and `1`, not one aggregate of `3` |
| `activity.transition` | start, grace and end |
| `session.evicted` **only when a holder actually loses the claim** | a transfer, then re-asserting the same holder |
| `entitlement.transition` | grant and revoke |
| **Nothing is emitted for a transaction that rolls back** | a posting followed by a throw: no ledger row, no event |

**These cases were shown to bite.** Removing `metrics.occupancyConflict()` and the ledger's
`recordDomainEvent` failed exactly those two cases and no others; silencing the port entirely
failed nine of the ten, the tenth being the rollback case, which correctly still passes when
nothing is emitted. The seven cases added by the second correction pass were checked the same
way: restoring the over-broad `catch` failed the foreign-key case alone; deleting the
reconciliation events failed the two that assert them; and replacing them with a single
aggregate event failed the per-activity case and nothing else.

> A first attempt at that check appeared to show the tests passing without the instrumentation.
> It was wrong: Vitest resolves internal packages through their built `exports` (§3.7), so the
> edit had to be compiled before it meant anything. The rebuilt run is the one above.

### The three defects CI found, and why they matter

Each passed locally and failed on GitHub, for a different reason:

| # | Defect | Why local could not see it |
|---|---|---|
| i25 | `actions/setup-node` shelled out to `pnpm` for its own cache before Corepack had provided it | a step needing a tool the previous step installs — there is no local equivalent of that sequence |
| i26 | `pnpm boundaries` (check 3) needed the client `pnpm generate` (check 4) produces | a check depending on a later check having run — invisible once generation has been run even once |
| i27 | D9 could not connect as `globalidle_app` | the role had been given a login **by hand** here in an earlier session; the migration leaves it `NOLOGIN` on purpose |

**All three were invisible to a green local suite.** That is the whole argument for criterion 19,
and it is the reason this document did not claim the phase was done before the workflow ran.

§13's last line — *Phase 0B is not `VERIFIED` until CI exists and passes* — is now met on the
evidence. The status transition itself belongs to the Product Owner.

---

## 7. Specification observations — raised, not resolved

Three places where the implementation had to choose between two statements in the approved
specification. Each is implemented per the more specific statement and **recorded here rather
than by editing approved text**.

1. **Hand-written SQL scope.** §3.8 and §6.5 authorize hand-written migration SQL for *"exactly
   two things"* — the ledger role grants and the two subtype `CHECK` constraints. §6.4 also
   requires `CHECK (rosterCapacity BETWEEN 1 AND 5)` for I2, which is a third. Implemented per
   §6.4, because it names an enforcement mechanism for a `LOCKED BY PRODUCT` rule. Recorded in
   the migration file itself.
2. **Where the durable half of the Content context lives.** §4.1 says *"Five directories in
   `domain` plus one deferred plus one in `game-data` is seven"*, while 0B.7 places the audited
   cleanup path and the reconciliation job *"in `packages/domain`… called through the Content
   context's public surface"*. They cannot live in `game-data`, which §5.2 forbids from importing
   Prisma. Implemented per 0B.7 as `contexts/content/`, which makes §5.2's *"only
   `contexts/<name>/index.ts` is public"* rule apply to it automatically. **§4.1's count sentence
   is now one short.**
3. **CI checks 6 and 7.** §13's command column reads *"`pnpm test` — unit project"* and
   *"`pnpm test` — fixtures project"*, while checks 10 and 11 name `pnpm test:integration` and
   `pnpm test:invariants`. Read literally, 6 and 7 would run every project and duplicate 10 and
   11. Implemented as `pnpm test:unit` and `pnpm test:fixtures`.

None of the three changes a boundary, an interface, an invariant or a product rule.

---

## 8. Next step

1. **Independent Phase 0B implementation review** of [PR #4](https://github.com/Hokz/Global-Idle/pull/4).
2. If the review accepts it, the Product Owner moves Phase 0B to `VERIFIED` and this document's
   status line moves with it.
3. Nothing in §16 is now untested. The one environmental limit that remains is recorded in §6:
   the bootstrap verification cannot run where Docker Hub image blobs are blocked, and fails
   loudly rather than skipping when they are.
