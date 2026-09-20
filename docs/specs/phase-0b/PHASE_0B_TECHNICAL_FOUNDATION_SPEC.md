# Phase 0B — Technical Foundation: Implementation Specification

**Document status:** `DRAFT` / PENDING INDEPENDENT REVIEW
**Phase:** 0B — Technical Foundation
**Baseline:** Phase 0A, `ARCHITECTURE_APPROVED`, 17 ADRs `ACCEPTED`
**Entry point for the architecture it implements:** [`../../architecture/ARCHITECTURE_OVERVIEW.md`](../../architecture/ARCHITECTURE_OVERVIEW.md)

> This document is a **specification**. It contains no implementation. Its job is to make the
> implementing phase unambiguous: exact tooling, exact boundaries, exact contracts, exact tests,
> and an objective Definition of Done.
>
> On independent approval this document becomes `IMPLEMENTATION_SPEC_READY`. Implementation
> happens on a separate branch and pull request.

---

## 1. What Phase 0B is

**Build the reusable technical foundation. Do not build the game.**

Phase 0B produces the primitives that Phases 1, 2, 4, 7 and 8 will consume: a workspace with
enforced boundaries, a database that enforces the load-bearing invariants below the application
layer, and six domain primitives whose correctness is provable without any gameplay balance
existing yet.

### In scope

| | |
|---|---|
| Workspace, tooling, dependency-boundary enforcement | 0B.1, 0B.2 |
| PostgreSQL, migrations, constraints | 0B.3 |
| Character occupancy claims | 0B.6 |
| Stamina durable state and mode machinery | 0B.4 |
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

`pnpm -r` and `pnpm --filter` cover the whole task surface for six workspaces. Turborepo is the
designated upgrade path, and the trigger is explicit: **adopt it when CI wall time for the
default pipeline exceeds roughly ten minutes, or when remote caching becomes worth configuring.**
Recording the trigger prevents adding it reflexively now and prevents arguing about it later.

### 3.3 Internal package format — **source-only, no build step**

Internal packages (`shared`, `game-data`, `game-engine`) are consumed **as TypeScript source**,
not as built artifacts:

- `apps/web` uses Next.js `transpilePackages`;
- `apps/api` and `apps/worker` compile them through the same `tsc` pass via project references;
- `vitest` executes them directly.

This sidesteps the ESM/CJS conflict entirely — NestJS ships CommonJS, Next.js prefers ESM, and
making three internal packages satisfy both is a build-configuration tax with no payoff for a
private monorepo. There is no publish target. Nothing is versioned independently.

**Consequence to accept:** no package build cache. With three small packages that is
immaterial, and it is revisited under the same trigger as §3.2.

### 3.4 TypeScript — **strict, shared base config**

`tsconfig.base.json` at the root, extended per workspace. Non-negotiable options:

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "isolatedModules": true,
  "skipLibCheck": true
}
```

`noUncheckedIndexedAccess` is called out because this codebase indexes into party arrays and
content maps constantly, and it is the option that turns a whole class of runtime `undefined`
into a compile error.

`apps/api` additionally needs `experimentalDecorators` and `emitDecoratorMetadata` for NestJS.

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

Chosen over Jest for this repository specifically: it runs TypeScript source directly (which
§3.3 depends on), its workspace mode maps onto pnpm workspaces, and its fake-timer control is
what §7.5's determinism tests need. NestJS's Jest default is not a strong enough reason to take
on a transform pipeline this repo does not otherwise need.

Integration tests use **Testcontainers** for ephemeral PostgreSQL and Redis, so a developer and
CI run the same thing and neither depends on a hand-started database.

### 3.8 ORM — **Prisma**, as the approved architecture states

With one concrete caveat the implementer must not discover the hard way:

> **Prisma cannot express a partial unique index declaratively.** Invariant I1 — one *playable*
> (non-retired) Character per vocation — is a unique constraint over non-retired rows only. It
> must be created by **hand-edited raw SQL inside a Prisma migration**, and §12 requires a test
> that proves it holds.

The declarative fallback, if the reviewer prefers it: a generated column holding the vocation
when playable and `NULL` when retired, with a plain unique index — PostgreSQL does not collide
on `NULL`. Both work. The partial index is recommended as the more direct statement of intent.

### 3.9 Supporting libraries

| Concern | Choice | Note |
|---|---|---|
| Config validation | **zod** | validated at boot; the process refuses to start on invalid config |
| Logging | **pino** | structured JSON; `nestjs-pino` for request context |
| Metrics | **prom-client** | `/metrics` endpoint |
| Health | **@nestjs/terminus** | backs `/health/live` and `/health/ready` |
| Redis client | **ioredis** | mature, cluster-capable later |
| Job queue | **BullMQ** | Redis-backed; 0B proves the wiring with one trivial job |
| UUIDv7 | **`uuid` v11+ (`uuidv7()`)** | generated in application code — see §6.2 |

---

## 4. Workspace layout

```text
global-idle/
├─ apps/
│  ├─ web/            Next.js + React + TypeScript
│  ├─ api/            NestJS — HTTP, realtime, orchestration, transactions
│  └─ worker/         BullMQ consumers; shares api's domain code
├─ packages/
│  ├─ shared/         contracts, types, ids, result types — no I/O
│  ├─ game-data/      content schemas, validation, bundle build + resolver contract
│  └─ game-engine/    pure simulation — no I/O, no framework
├─ infra/
│  └─ docker-compose.yml
├─ docs/
├─ .dependency-cruiser.cjs
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ package.json
```

`packages/shared` is named **`shared`**, not `shared-types`, per `OPERATIONS_ARCHITECTURE.md` §1.
It holds contracts and pure helpers, not only types.

### 4.1 Where the domain lives

`ADR-012` specifies a modular monolith. The bounded contexts of `ADR-001` live **inside
`apps/api`**, one module per context:

```text
apps/api/src/
├─ contexts/
│  ├─ identity/        Account, AuthIdentity, Session, Entitlement
│  ├─ character/       Character, roster capacity, Progression, Skills, Stamina
│  ├─ party/           Active Party configuration
│  ├─ activity/        Activity, claims, settlement orchestration
│  ├─ items/           ItemInstance, custody
│  └─ economy/         ledger, balances, listings
├─ platform/           clock, ids, idempotency, transactions, logging, metrics
└─ main.ts
```

Each context exposes a **public surface** (an `index.ts` barrel). Reaching past it into another
context's internals is a dependency-cruiser violation (§5.3).

**Why contexts live in the app rather than in packages:** they need the ORM, transactions and
the framework. Extracting them into packages would either drag those dependencies into
`packages/` — breaking the rule that packages must not depend on apps — or force an abstraction
layer that buys nothing while the monolith is one deployable. The context boundary is enforced
by the module graph, not by the directory being a package.

---

## 5. Dependency rules

### 5.1 The graph

```text
apps/web ────────► packages/shared
                          ▲
apps/api ────────► packages/shared
   │                      ▲
   ├──────────────► packages/game-data
   │                      ▲
   └──────────────► packages/game-engine

apps/worker ─────► (same as apps/api)

packages/game-engine ──► packages/shared        (types only)
packages/game-data  ──► packages/shared        (types only)
```

**Nothing in `packages/` may depend on anything in `apps/`. Ever.**

### 5.2 Forbidden edges, exactly

| Package | Must not import |
|---|---|
| `game-engine` | NestJS, Next.js, React, Prisma, `@prisma/client`, ioredis, BullMQ, `http`/`https`, `fs`, `path` (for I/O), `crypto` randomness, `Date.now`, `Math.random`, `process.env`, any app |
| `game-data` | any app, `game-engine`, NestJS, Next.js, Prisma, ioredis |
| `shared` | any app, any other package, any framework, any I/O |
| `web` | Prisma, ioredis, `game-engine`, any `apps/api` internal |
| `api` context module | another context's internals (anything not its `index.ts`) |
| `worker` | another context's internals |

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
| `OccupancyClaim` | one per Character | names its activity; `ADR-013` |
| `Activity` | activity row + account claim | lifecycle state, `graceExpiresAt`, pinned bundle version |
| `ActiveUseTimer` | reusable duration state | `remainingDuration`, `qualifyingSince` |
| `IdempotencyRecord` | client command keys | scope, fingerprint, result reference |
| `SettlementOperation` | deterministic settlement ids | uniqueness target |
| `LedgerEntry` + `CurrencyBalance` | economy invariant tests | minimal; no market, no forge |
| `ContentBundleRef` | pinned bundle versions | what `ADR-016` derives the pinned set from |
| `_prisma_migrations` | migration metadata | Prisma-managed |

**Deliberately absent from 0B:** `ItemInstance`, custody scopes, `MarketListing`, Skills,
Progression, Wheel, Skill Tree, Hunt/Room/Creature tables. They belong to the phases that use
them. `ItemInstance` in particular is Phase 3 — `ADR-004`'s custody invariant is specified but
not yet built, and that is correct.

### 6.4 Invariant enforcement plan

For each invariant, **where** it is enforced. "Application validation" alone is never acceptable
for anything that can be raced.

| # | Invariant | Enforced by |
|---|---|---|
| I1 | One **playable (non-retired)** Character per vocation per account | **partial unique index** on `(accountId, vocation) WHERE "retiredAt" IS NULL` — raw SQL in a migration (§3.8) |
| I2 | `count(playable characters) ≤ rosterCapacity ≤ 5` | transaction + `CHECK (rosterCapacity BETWEEN 1 AND 5)`; the count is verified inside the creating transaction |
| I7 | Settlement idempotent under its operation id | **unique constraint** on `SettlementOperation.operationId` |
| I9 | One Session holds an account's Activity claim | **partial unique index** on `Activity(accountId) WHERE state <> 'ENDED'` + conditional write |
| I13 | One occupancy claim per Character | **unique constraint** on `OccupancyClaim.characterId` |
| I15 | Duration never consumed outside a qualifying state | **interface capability** — only a state transition writes `qualifyingSince` |
| I16 | A referenced content bundle is never deleted | **no delete path exists**; deletion is an explicit audited operation guarded by a reference query |
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
- Raw SQL (partial indexes, role grants) lives in hand-edited migration files with a comment
  explaining which invariant it enforces.

---

## 7. Domain primitive contracts

These are the substance of Phase 0B. Signatures are illustrative; the **semantics** are binding.

### 7.1 Server time

```ts
interface Clock {
  now(): Instant;          // server-authoritative, monotonic-safe for durations
}
```

- Injected everywhere. **No `Date.now()` inside domain or engine code.**
- `FakeClock` in test support: settable, advanceable, deterministic.
- A client-supplied timestamp is **never** an input to any settlement
  (`CLIENT_SERVER_BOUNDARIES.md` §6).

### 7.2 Character occupancy claim

```ts
interface OccupancyPort {
  acquire(tx, characterIds: CharacterId[], activityRef): Result<void, OccupancyConflict>;
  release(tx, activityRef): Promise<void>;
  reserveForGrace(tx, activityRef): Promise<void>;
  reconcileStranded(tx): Promise<ReleasedClaim[]>;
}
```

Semantics:

- **at most one claim per Character**, enforced by unique constraint (I13);
- acquisition for a party is **all-or-nothing in one transaction**; any conflict rolls the whole
  thing back, leaving no partial claims;
- ids are locked in **ascending `characterId` order** so two concurrent party starts touching the
  same Characters cannot deadlock (§8.5);
- release happens **in the same transaction as the lifecycle transition**, never as a follow-up;
- reconnect grace **reserves** rather than releases — the activity still exists;
- `reconcileStranded` releases only claims whose named activity is absent or terminal. Because a
  claim names its activity, this is reconciliation against durable state, not a heuristic.

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
- the **pinned set is a query over durable state** (`ContentBundleRef`), not separate
  bookkeeping;
- **no delete path exists**;
- the engine receives **already-resolved definitions** and performs no I/O — resolution happens
  in the application layer before the engine is called.

`DEFERRED` — the storage backend. 0B implements a local filesystem provider behind this
interface; object storage is a later swap that changes no caller.

---

## 8. Transactions and concurrency

### 8.1 Boundaries

Each of these is exactly one transaction. Partial application must be impossible.

| Operation | Touches |
|---|---|
| Activity start | activity row, account activity claim, **one occupancy claim per participant** |
| Activity pause | lifecycle state, `graceExpiresAt`, settlement checkpoint, claim reservation |
| Activity end / expiry | lifecycle state, final settlement, **release of all claims** |
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
Account → Character (ascending id) → Activity → OccupancyClaim (ascending characterId)
        → CurrencyBalance (ascending accountId) → LedgerEntry
```

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

| # | Check | Fails on |
|---|---|---|
| 1 | Format check (Prettier) | unformatted files |
| 2 | Lint (ESLint) | lint errors |
| 3 | **Dependency boundaries** (dependency-cruiser) | any forbidden edge in §5.2 |
| 4 | Typecheck (`tsc --noEmit`, all workspaces) | type errors |
| 5 | Unit tests (Vitest) | failures |
| 6 | **Deterministic engine fixtures** | non-reproducible output for the same seed |
| 7 | **Content validation** | invalid content bundle |
| 8 | **Migration validation** | migrations failing from empty **or** from the previous state |
| 9 | Integration tests (Testcontainers: PostgreSQL + Redis) | failures |
| 10 | **Economy invariant tests** | duplication, double-spend, non-idempotent replay, reconciliation drift |
| 11 | Build (`web`, `api`, `worker`) | build errors |

Check 10 is a **category of its own**, not ordinary unit tests. `AGENTS.md` §6 warns that green
CI does not prove game correctness; these are the part of correctness CI genuinely can prove, and
the part where being wrong costs the most.

**Phase 0B is not `VERIFIED` until CI exists and passes.**

---

## 14. Test matrix

Every row is required. `§` references the contract it proves.

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

### 14.4 Activity claim

| # | Test |
|---|---|
| A1 | Only one authoritative Account Activity claim exists at a time |
| A2 | Claim transfer (newest-connection-wins) is atomic — no instant with two holders |
| A3 | A paused activity **reserves** its claim |

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
| C3 | A **historical pinned** bundle resolves after the current bundle advances |
| C4 | A referenced bundle has **no delete path** |
| C5 | An unlock set without exactly five keys fails validation |

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
0B.1 ──► 0B.2 ──┬──► 0B.3 ──► 0B.4 ──┬──► 0B.6
                │                     └──► 0B.5
                ├──► 0B.7
                └──► 0B.8 ──► 0B.9
                                 └──► 0B.10 ──► 0B.11
```

**Deviation 1 — 0B.10 (CI) starts early, alongside 0B.1.** Standing CI up at the end means the
first eleven checks all light up red at once, against a large diff. The skeleton workflow
(format, lint, boundaries, typecheck) lands with the workspace; the remaining checks are added
by the package that makes them meaningful. `ADR-012` requires boundary rules in the first commit
anyway, and a rule nothing runs is a comment.

**Deviation 2 — 0B.7 (content) does not block 0B.4/0B.5/0B.6.** The domain primitives do not
depend on content; only `/health/ready` does. Running them in parallel shortens the critical
path with no coupling cost.

---

### 0B.1 — Workspace and tooling

**Goal.** A workspace that cannot violate its own boundaries.

**Files.** `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `.eslintrc`/flat
config, `.prettierrc`, `.dependency-cruiser.cjs`, `vitest.workspace.ts`, `.gitignore`,
`.nvmrc`, `.env.example`.

**Prerequisites.** None.

**Acceptance.** W1–W9. `pnpm install`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
`pnpm boundaries` all run and pass on an otherwise empty workspace.

**Done when.** A deliberately-added forbidden import fails `pnpm boundaries` locally and in CI.

---

### 0B.2 — Application and package skeleton

**Goal.** Six workspaces that build, start and import each other legally.

**Files.** `apps/web` (Next.js), `apps/api` (NestJS + context directories), `apps/worker`
(BullMQ entry), `packages/shared`, `packages/game-data`, `packages/game-engine` — each with
`package.json`, `tsconfig.json`, and a trivial entry point.

**Prerequisites.** 0B.1.

**Acceptance.** W6–W8, E3. All three apps build and start. `shared` is importable from `web`,
`api` and `worker`.

**Done when.** `pnpm build` passes for every workspace and the three apps start clean.

---

### 0B.3 — Database and migrations

**Goal.** A schema whose constraints enforce the load-bearing invariants.

**Files.** `apps/api/prisma/schema.prisma`, initial migrations including **hand-edited raw SQL**
for the partial unique indexes (I1, I9) and the ledger role grants (I6), a migration-check
script.

**Prerequisites.** 0B.2.

**Acceptance.** D1–D9.

**Done when.** Migrations apply from empty and from the previous state; D4 and D5 both pass —
duplicate playable vocation rejected, retired vocation reusable.

---

### 0B.4 — Core domain primitives

**Goal.** Identifiers, transactions, idempotency, minimal ledger.

**Files.** `packages/shared/src/ids`, `.../result`, `.../constants` (including `STAMINA_MAX`);
`apps/api/src/platform/transaction`, `.../idempotency`; `contexts/economy` minimal ledger and
balance.

**Prerequisites.** 0B.3.

**Acceptance.** D3, I1–I4, and the economy invariant category of check 10.

**Done when.** Idempotency behaves correctly across all four cases including cross-account
isolation, and the ledger reconciles.

---

### 0B.5 — Time, `ActiveUseTimer`, entitlements

**Goal.** The duration machinery every timed system will use.

**Files.** `platform/clock` (`Clock`, `SystemClock`, `FakeClock`); `contexts/character/stamina`;
`contexts/identity/entitlement`; a shared `ActiveUseTimer` implementation.

**Prerequisites.** 0B.4.

**Acceptance.** T1–T10.

**Done when.** T3 passes — restart from the durable marker produces an identical result — and
T5 passes — a Premium transition splits an interval correctly.

---

### 0B.6 — Activity and occupancy claims

**Goal.** One action per Character; one activity per account.

**Files.** `contexts/activity/claim`, `.../occupancy`, `.../lifecycle`, and the reconciliation
job in `apps/worker`.

**Prerequisites.** 0B.4.

**Acceptance.** O1–O9, A1–A3.

**Done when.** O3 and O4 pass — party acquisition is all-or-nothing with no partial claims — and
O9 shows no deadlock under concurrent overlapping starts.

---

### 0B.7 — Content bundle foundation

**Goal.** Build, validate, version and resolve content bundles.

**Files.** `packages/game-data/src/schema`, `.../validate`, `.../build`, `.../resolver`; a
minimal placeholder bundle; the CI validation script.

**Prerequisites.** 0B.2.

**Acceptance.** C1–C5.

**Done when.** C3 passes — a historical pinned bundle still resolves after the current bundle
advances — and C4 confirms no delete path exists.

---

### 0B.8 — Redis and runtime infrastructure

**Goal.** Redis holding nothing that matters, and a one-command local stack.

**Files.** `infra/docker-compose.yml`, `platform/redis`, `platform/config` (zod, fail-fast),
BullMQ setup with one trivial job, the seed script running through domain services.

**Prerequisites.** 0B.2.

**Acceptance.** R1–R3.

**Done when.** R1 passes — a full Redis flush loses no durable state — and `pnpm dev` takes a
clean clone to a running stack.

---

### 0B.9 — Health, observability, operations

**Goal.** Know what the system is doing, and whether it should receive traffic.

**Files.** `apps/api/src/health`, `platform/logging` (pino + correlation id), `platform/metrics`
(prom-client + `/metrics`), the migration-version check.

**Prerequisites.** 0B.8.

**Acceptance.** H1–H5.

**Done when.** H1 passes — liveness succeeds with PostgreSQL down — and readiness fails on each
of the four conditions independently.

---

### 0B.10 — CI and test harness

**Goal.** Every rule in this document enforced by a machine.

**Files.** `.github/workflows/ci.yml`, Testcontainers setup, the engine determinism fixtures,
`vitest.workspace.ts` integration project.

**Prerequisites.** 0B.1 for the skeleton; each later package adds its own checks.

**Acceptance.** All eleven checks in §13 run and pass.

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
| 1 | `pnpm install` succeeds from a clean checkout |
| 2 | `pnpm format:check` passes |
| 3 | `pnpm lint` passes |
| 4 | `pnpm typecheck` passes across all workspaces |
| 5 | `pnpm boundaries` passes, and a deliberately-added forbidden import fails it |
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
| 18 | The complete §14 test matrix passes |
| 19 | CI is green, with all eleven checks of §13 present |
| 20 | **No accepted architecture invariant is contradicted** — traced ADR by ADR |
| 21 | **No Hunt balance or gameplay loop was implemented** — no XP curve, damage formula, loot table or reward multiplier exists |

Criterion 21 deserves its own review question: *did anything in this phase require a balance
number to be correct?* If yes, scope leaked.

---

## 17. Autonomous decisions in this specification

Made under the project's autonomous execution model (`AGENTS.md` §3), recorded for reversal.

| # | Decision | Rationale | Reversal cost |
|---|---|---|---|
| 1 | **pnpm** | strict `node_modules` makes undeclared dependencies fail at resolution — a second boundary layer beneath the lint rules | low, before code exists |
| 2 | **No task runner initially**, Turborepo trigger recorded | six workspaces do not need a build graph tool; `pnpm -r` is already topological | low |
| 3 | **Source-only internal packages** | avoids the NestJS-CJS / Next-ESM conflict entirely; no publish target exists | medium — changing later means adding build config |
| 4 | **Vitest** | runs TS source directly (which #3 needs), workspace mode, fake timers for §14.5 | medium — test rewrites |
| 5 | **dependency-cruiser** as the authoritative boundary gate | reasons over transitive edges, emits a reviewable graph | low |
| 6 | **Contexts inside `apps/api`, not packages** | they need ORM and framework; extracting them would violate "packages must not depend on apps" | medium |
| 7 | **UUIDv7 generated in application code** | not every PostgreSQL version offers `uuidv7()`; keeps generation testable under a fake clock | low |
| 8 | **Partial unique index by raw SQL** for I1 | Prisma cannot express it declaratively; generated-column fallback documented | low |
| 9 | **Ledger append-only by database role grant** | makes I6 true for a developer who has not read `ADR-003` | low |
| 10 | **CI starts in 0B.1**, not at the end | avoids eleven checks failing at once against a large diff | low |
| 11 | **0B.7 parallel to 0B.4–0B.6** | no dependency exists; shortens the critical path | low |
| 12 | **Testcontainers** for integration tests | developer and CI run the same thing; no hand-started database | low |
| 13 | **BullMQ** | Redis-backed, matches the approved Redis role | low |
| 14 | **Retry bounded at 3 attempts** for serialization failures | bounded so a pathological case surfaces instead of spinning | low |

None contradicts an accepted ADR or a LOCKED product rule.

---

## 18. Deferred parameters

Genuinely non-blocking. Each is a configuration input; no boundary, interface or invariant
depends on any of them.

| | |
|---|---|
| Content bundle **storage backend** | contract fixed in §7.7; 0B ships a local provider |
| Idempotency record **retention window** | long enough to cover any plausible retry |
| Serialization-failure **backoff curve** | attempt cap is fixed at 3; the curve is tuning |
| Redis **cache TTLs** | every key family has a rebuild path regardless |
| **Node version** beyond "current LTS" | pinned in `.nvmrc` at implementation time |
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
- no `ItemInstance` or custody implementation — Phase 3.

---

## 20. Status and next step

This document is `DRAFT` / PENDING INDEPENDENT REVIEW.

On independent approval it becomes **`IMPLEMENTATION_SPEC_READY`**, and implementation proceeds
on a separate branch and pull request under the execution model of `AGENTS.md` §3: the builder
works autonomously within the accepted architecture, runs the full matrix, self-reviews, opens a
pull request, and does not merge its own work.

Phase 0B is `VERIFIED` only when §16 is satisfied line by line with evidence and CI is green.
