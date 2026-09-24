# Infrastructure, Observability and Operations Architecture

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.8
**Depends on:** `ADR-009`, `ADR-011`, `ADR-012`

> `AGENTS.md` asks not to over-engineer for hypothetical scale. This document describes what a
> pre-launch project with a real economy needs, and stops there.

---

## 1. Module boundaries for Phase 0B

`ADR-012` decides one deployable with build-enforced boundaries.

```text
apps/
  web/            Next.js + React + TypeScript — renders, never decides
  api/            NestJS + TypeScript — HTTP, realtime, orchestration, transactions
  worker/         same codebase, job-processing entry point
packages/
  shared/         types and contracts shared by web and api
  game-data/      content definitions, schemas, validator, typed accessors
  game-engine/    pure simulation
infra/
  docker-compose.yml
docs/
```

`DECIDED IN PHASE 0A` — the shared package is named **`shared`**, not `shared-types`. The
project documentation previously used both (`docs/ARCHITECTURE.md` said `shared`,
`CLAUDE_BOOTSTRAP.md` said "shared-types package"); `shared` wins because it will hold contracts
and helpers, not only types.

### Enforced dependency rules

| Package | May not import |
|---|---|
| `game-engine` | ORM, cache client, HTTP/framework types, ambient clock, global RNG, `api`, `web` |
| `game-data` | `game-engine`, `api`, `web` |
| `web` | `game-engine`, any persistence package |
| `api` context modules | another context's internals |

Configured in the first Phase 0B commit, before there is anything to violate them.

`DEFERRED` to Phase 0B: workspace tool (pnpm workspaces, Turborepo or Nx). It changes no
boundary; pnpm workspaces is the cheapest starting point.

---

## 2. Local development

One command must produce a working stack. `docker-compose` provides PostgreSQL and Redis;
`web`, `api` and `worker` run locally with hot reload.

Requirements:

- a fresh clone reaches a running app with migrations applied and content loaded;
- seed data is **generated, not dumped** — a script that creates an account, characters and
  items through ordinary domain paths, so the seed cannot encode states the game cannot produce;
- no developer needs production credentials for anything.

`DEFERRED` to Phase 0B: exact compose file, Node version pinning, task runner.

---

## 3. Environments and configuration

| Environment | Purpose |
|---|---|
| local | development |
| ci | ephemeral, per-run database and Redis |
| staging | production-shaped, non-production data |
| production | real players, real economy |

`DECIDED IN PHASE 0A`:

- configuration comes from **environment variables**, never committed files;
- **no secret is ever committed**, including in compose files, fixtures or tests;
- the application **fails fast at startup** on missing or invalid configuration rather than
  discovering it at first use — a game that starts without a database URL and fails on the first
  player action is worse than one that refuses to start;
- configuration is validated against a schema at boot.

`DEFERRED` — secret manager choice, per-environment infrastructure. Deployment target is not an
architectural constraint here.

---

## 4. CI

Blocking checks, in order of cost:

1. lint and format;
2. typecheck;
3. **dependency-boundary check** (§1) — a violation fails the build;
4. unit tests, including engine determinism fixtures;
5. **content validation** (`CONTENT_DATA_ARCHITECTURE.md` §4);
6. migration check — migrations apply cleanly to an empty database and to a copy of the previous
   schema;
7. integration tests against ephemeral PostgreSQL and Redis;
8. build.

`DECIDED IN PHASE 0A` — **economy invariant tests are a CI category of their own**, not ordinary
unit tests: no duplication under concurrent custody transfer, no double-spend under concurrent
purchase, idempotent replay of every value-moving operation, ledger-to-projection reconciliation
after a randomized operation sequence.

`AGENTS.md` §6 warns that green CI does not prove game correctness. These tests are the part of
correctness that CI genuinely can prove, and they are the part where being wrong costs the most.

---

## 5. Migrations in deployment

Per `DATA_ARCHITECTURE.md` §8: forward-only, additive first.

```text
deploy N:    add column/table, backfill, dual-write
deploy N+1:  switch reads
deploy N+2:  remove the old path
```

Migrations run as a **separate step before** the new application version starts. A deploy never
requires a simultaneous code and schema cutover, so a rollback is always available.

No migration rewrites ledger rows.

---

## 6. Observability

### Logging

Structured JSON, correlation id per request, propagated into jobs. Levels used with intent:
`error` means a human should look.

Never logged: credential material, session tokens, personal data beyond an account id.

Always logged: economy operations with their operation ids, custody transitions, activity
lifecycle transitions, session evictions, admin actions with the acting operator.

### Metrics

The ones that would actually reveal a problem:

| Metric | Reveals |
|---|---|
| Active activities by state | whether pause/resume is behaving |
| Settlement duration and failure rate | the economy's hot path degrading |
| Reconciliation mismatches | **must be zero** — any non-zero is a P1 |
| Grace expiries vs resumes | disconnect pain and eviction churn |
| Session evictions | `ADR-008` behaving, or a client reconnect loop |
| Idempotent replay hits | client retry patterns, and whether retries are safe in practice |
| Job queue depth and age | worker starvation |
| Content version in use | whether a deployment actually rolled out |
| Overdue Character purges — how many are due and not yet purged, and how late the oldest is past `purgeAt` | the deletion lifecycle degrading. A due purge that has not committed is a **failure condition**, never a normal state; it alerts against a lateness target chosen before production (`ADR-020` §7, pre-launch gate). **PRE-4 — not implemented** |

### Tracing

`DECIDED IN PHASE 0A` — **not adopted in Phase 0B.** One deployable, one database: correlation
ids in structured logs answer the questions distributed tracing would, without the
instrumentation cost. Tracing earns its place when a second deployable does. Deciding this
explicitly prevents it being added reflexively as ceremony.

---

## 7. Health and readiness

| Endpoint | Answers | Checks |
|---|---|---|
| `/health/live` | is the process alive? | process only — never dependencies |
| `/health/ready` | can it serve traffic? | PostgreSQL reachable, migrations at expected version, Redis reachable, content loaded and validated |

`DECIDED IN PHASE 0A` — liveness must **not** check dependencies. A liveness probe that fails
because the database blipped restarts healthy processes during an incident and turns a database
problem into an outage.

Readiness failing on a **migration version mismatch** prevents a stale instance serving traffic
against a newer schema.

---

## 8. Workers

Shared codebase, separate entry point (`ADR-012`).

| Job | Notes |
|---|---|
| Grace-expiry sweep | decides from persisted state, never from a fired timer (`ADR-009`) |
| Orphaned-activity recovery | after a restart (`SESSION_AND_ACTIVITY_LIFECYCLE.md` §7) |
| Ledger reconciliation | scheduled; halts economy writes for a mismatched subject |
| Listing expiry | returns escrowed items to inventory, transactionally |
| Skill training settlement | on claim, or swept for long-idle accounts |
| Character purge (**PRE-4 — not implemented**) | attempts every Character whose `purgeAt` has arrived **promptly**, one atomic transaction each; a purge that cannot commit is retried automatically and alerts while overdue. It never purges early and never defers a due purge (`ADR-020` §7) |

`DECIDED IN PHASE 0A` — **every job is idempotent and safe to run twice.** Job systems deliver
at-least-once under failure; designing for exactly-once is designing for a guarantee that does
not exist.

---

## 9. Backup and restore

| | |
|---|---|
| PostgreSQL | automated backups plus point-in-time recovery. This is the only store whose loss is unrecoverable. |
| Redis | not backed up. Nothing durable lives there (`ADR-009`). |
| Content bundles | published immutably to durable addressable artifact storage and backed up with it. Version control remains the authoring and history source, but **redeploying an old application build is not the recovery mechanism** — the running server resolves any referenced bundle (`ADR-016`). |

Restore procedure:

1. restore PostgreSQL to the target point;
2. **run ledger reconciliation before reopening economy writes**;
3. **derive the set of referenced content bundles from the restored durable state, and confirm
   every one of them is available in artifact storage**;
4. recover activities per the restart path;
5. reopen activities and the economy only once steps 2 and 3 both pass.

`DECIDED IN PHASE 0A` — step 3 gates reopening for the same reason step 2 does. An activity
pinned to a bundle that is not available cannot be recovered, and discovering that after players
are back is worse than discovering it during the restore.

`DECIDED IN PHASE 0A` — a restore that has not been rehearsed is a hypothesis. The procedure
must be exercised against staging before launch; an untested backup is worse than a known
absence of one, because it produces false confidence.

`DEFERRED` — RPO/RTO targets and backup cadence. They are commercial and operational choices,
not architectural ones.

`OPEN` — **restores and Character deletion** (`ADR-020`). A restore brings back Characters purged
after the target point and loses deletion requests and restores made after it; a pending Character
whose deadline has passed would then be purged again at once, even one its owner restored inside
the lost window. Recommended until decided: the purge job stays paused after a restore until the
lifecycle transitions lost in the window are reconciled, as a step alongside 2 and 3 above. That
pause is part of disaster recovery, not a way to defer purges: every Character that falls due
while it lasts is an **overdue purge**, visible and alerting like any other (`ADR-020` §7). How
long backups and logs may keep a purged Character is open as well.
See [`../OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md) § *Character deletion*.

---

## 10. Operations checklist

- [x] One deployable, boundaries enforced by the build
- [x] `shared` naming conflict resolved
- [x] Local stack from a single command, seeds generated through domain paths
- [x] Config from environment, validated at boot, fail-fast
- [x] CI blocks on boundaries, content validation, migrations and economy invariants
- [x] Migrations forward-only, run before the new version starts
- [x] Structured logs with correlation ids; no secrets
- [x] Reconciliation mismatch metric must be zero
- [x] Tracing explicitly deferred, with a stated trigger
- [x] Liveness never checks dependencies
- [x] Every job idempotent
- [x] Only PostgreSQL is backed up; restore gated on reconciliation
