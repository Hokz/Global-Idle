# ADR-018 — The bounded contexts live in `packages/domain`

**Status:** `PROPOSED`
**Phase:** 0B specification
**Date:** 2026-09-20
**Amends:** `ADR-012` — its **source layout only**. Everything else in `ADR-012` stands.

## Context

`ADR-012` is `ACCEPTED` and decides a modular monolith for Phase 0B. Its layout places the
bounded contexts inside the API and names three packages:

> ```text
> apps/ web/ api/ worker/
> packages/ shared/ game-data/ game-engine/
> ```
> *"context modules inside `api` expose an explicit surface and may not reach into each other's
> internals."*

The Phase 0B specification hit a problem that layout cannot solve. `ADR-012` also says the
worker is a *"job-processing entry point"* sharing the codebase, and Phase 0B's restart
reconciliation job must call the Activity context. With the contexts inside `apps/api`, the only
way for `apps/worker` to reach them is an `apps/worker → apps/api/src/**` import — an
**app-to-app reach-in**, which is exactly what `ADR-012`'s boundary rules exist to forbid. The
layout and the worker requirement are in tension with each other.

The original rationale for keeping contexts in the app was, on inspection, mistaken. It held
that extracting them *"would drag [ORM and framework] dependencies into `packages/` — breaking
the rule that packages must not depend on apps."* That is a non-sequitur: the forbidden edge is
**package → app**. A package depending on Prisma or on any npm library breaks no rule at all.

## Decision

**The bounded contexts whose implementations form the runtime application core move to
`packages/domain`.** Both applications depend on it; neither depends on the other.

This is a **source-layout** decision about where five of `ADR-001`'s seven contexts are
implemented. It does not collapse, remove, merge or silently relocate any context `ADR-001`
defines, and it does not change who owns what.

```text
apps/
  web/            Next.js client — renders, never decides
  api/            HTTP + realtime adapters + composition root
  worker/         job consumers + composition root
packages/
  shared/         types and contracts
  domain/         bounded contexts, ORM, transactions — the application core   ← new
  game-data/      content definitions + validation
  game-engine/    pure simulation
```

- `packages/domain` holds `contexts/{identity,character,party,activity,economy}` now, gains
  `contexts/items` when the item model is implemented, and holds
  `platform/{clock,ids,idempotency,transactions,prisma}`;
- each context exposes a public surface at `contexts/<name>/index.ts`, and reaching past it is a
  boundary violation — **the rule `ADR-012` states, now enforced inside the package too**;
- `apps/api` and `apps/worker` are thin: adapters and wiring, no domain logic;
- `apps/api ↔ apps/worker` in either direction is **forbidden**, enforced by dependency-cruiser.

### All seven `ADR-001` contexts are preserved

| `ADR-001` context | Owner of | Where it is implemented | Note |
|---|---|---|---|
| Identity & Access | Account, Session, Entitlement | `packages/domain/src/contexts/identity` | |
| Character | Character, roster capacity, Progression, Skills | `packages/domain/src/contexts/character` | |
| Party | Active Party composition and order | `packages/domain/src/contexts/party` | |
| Activity | Hunt / Dungeon / Skill Training runs and in-flight state | `packages/domain/src/contexts/activity` | |
| **Items** | ItemInstance, Inventory and Equipment custody | `packages/domain/src/contexts/items` | **an accepted context whose implementation is deferred** to the phase that introduces `ItemInstance` (Phase 3). Its ownership and its invariant (`ADR-004`, I4) are unchanged; only the directory does not exist yet |
| Economy | Ledger, balance projections, Market listings, escrow | `packages/domain/src/contexts/economy` | |
| **Content** | BaseItem, Creature, Loot Table, World Location, Hunt and Dungeon definitions | **`packages/game-data`** | **not** moved into `domain`, and not a gap: the Content context is build-time, versioned and read-only at runtime (`ADR-011`), which is exactly why it is its own package with its own stricter rules. `packages/game-data` *is* the Content bounded context |

Five contexts implemented in `domain`, one deferred with its directory reserved, one in
`game-data`: seven. The phrase "the bounded contexts live in `packages/domain`" in this ADR's
title is shorthand for the runtime-application contexts; this table is the precise statement.

### Exactly what is superseded

| `ADR-012` clause | Status |
|---|---|
| The `apps/` + `packages/` **source layout listing three packages** | **superseded** — a fourth package, `domain`, is added |
| *"context modules inside `api`"* | **superseded** — contexts live in `packages/domain`; the *rule* they must expose an explicit surface is **retained verbatim** |
| One deployable modular monolith | **stands** |
| Boundaries enforced by build-time dependency rules | **stands** |
| `game-engine` may not import an app, ORM, cache client or HTTP type | **stands** |
| `game-data` may not import `game-engine` or an app | **stands** |
| `web` may not import `game-engine` or a persistence package | **stands** |
| `packages/shared` is named `shared` | **stands** |
| Microservices rejected as premature | **stands** |
| `ADR-001`'s seven contexts and their ownership (referenced by `ADR-012`) | **stands** — see the table above |

`ADR-012` is **not edited**. This ADR records the amendment; accepted history stays intact.

### Still one modular monolith

The deployment boundary does not move:

- **one build artifact, one container image**, with two start commands — `api` and `worker`;
- `packages/domain` is a **compile-time module**, not a service. It has no network surface, no
  independent deployment and no independent version;
- both entry points run **the same application core in the same process model** `ADR-012`
  describes;
- the economy's multi-row atomicity still happens inside one PostgreSQL transaction in one
  process — the property that made `ADR-012` reject microservices is untouched.

Moving code from a directory inside an app to a package in the same workspace changes the
module graph, not the deployment topology.

### Dependency directions

```text
LEGAL       apps/api    → packages/domain → packages/{shared, game-data, game-engine}
            apps/worker → packages/domain → …
            apps/web    → packages/shared

FORBIDDEN   apps/worker → apps/api        (any path)
            apps/api    → apps/worker
            packages/*  → apps/*
            anything    → a domain context's internals
```

## Consequences

**Benefits.**
- The worker gets a **legal** call path. The reconciliation job imports the Activity context's
  public surface, the same one `apps/api` uses — no privileged access, no second implementation.
- The `ADR-012` rule that apps must not reach into each other is now satisfiable rather than
  merely stated.
- Domain code becomes testable without booting NestJS or Next.js.
- The context surface rule is enforced by the same mechanism across the whole graph.

**Costs.**
- A fourth package to configure, build and reference. Small, one-off.
- `packages/domain` carries Prisma, so it is not a "pure" package like `shared` or
  `game-engine`. That is intended and is why those two keep their stricter rules.
- Anyone reading `ADR-012` alone sees a layout that no longer matches the tree. This ADR is
  linked from `ADR-012`'s status line and from the architecture overview to make the amendment
  discoverable.

**Constraints created.**
- No domain logic may live in an app. Apps are adapters and composition roots.
- No app may import another app, on any path.
- A context's internals are reachable only through its `index.ts`.

## Alternatives considered

**Keep the accepted layout; give the worker a legal entry point anyway (option A).** The only
shapes available were: make `apps/api` export a public surface — which makes it a library
pretending to be an app and still leaves an app-to-app edge; or duplicate the reconciliation
logic in the worker — two implementations of an invariant-bearing operation, which is worse than
any layout problem. Rejected.

**Collapse `apps/worker` into `apps/api` as a second entry file.** Coherent, and it would need
no new package. Rejected because `ADR-012` and the Phase 0B scope both name `apps/worker` as a
workspace, and because separate composition roots keep the two process types' wiring legible.

**Put only the shared pieces in a package and leave the rest in the app.** Rejected: it splits
each context across two locations, so "where does this responsibility live" gets two answers —
the failure mode an implementation spec exists to prevent.

## Product constraints requiring this architecture

- *"one deployable: HTTP + realtime + orchestration"*, worker as a job-processing entry point on
  the same codebase — `ADR-012`
- Context modules expose an explicit surface and may not reach into each other's internals —
  `ADR-012`
- Seven bounded contexts, one owner per piece of state — `ADR-001`
- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
