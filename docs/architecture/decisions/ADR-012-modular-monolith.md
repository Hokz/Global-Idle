# ADR-012 — One deployable modular monolith for Phase 0B

**Status:** `ACCEPTED`
**Amended by:** [`ADR-018`](ADR-018-domain-package-source-layout.md) (`PROPOSED`) — the **source
layout only**. `ADR-018` moves the bounded contexts from `apps/api` into `packages/domain` so the
worker has a legal call path. Every other decision below stands, including one deployable, the
build-enforced boundaries, and the rule that context modules expose an explicit surface. **This
ADR's own text is not edited.**
**Phase:** 0A.8
**Date:** 2026-09-20

## Context

`ADR-001` establishes seven bounded contexts. A reasonable next question is whether those become
separate services.

The pressure to split is real — contexts with clean boundaries are deployable independently —
but so is the pressure not to. The economy requires multi-row atomicity across ledger, balance
and item custody. Splitting Economy and Items into separate services turns that into a
distributed transaction, and distributed transactions are how item duplication bugs are born.

The project has also stated its preference plainly:

> *"Build the first simulator in the simplest maintainable server stack."* — `AGENTS.md` §5
> *"Avoid premature C++/WASM optimization."* — `AGENTS.md` §5

And the product has not shipped. There are no users, no load data, and no profiling.

## Decision

**Phase 0B builds one deployable API with enforced module boundaries**, plus the web client and
a worker process that shares the same codebase.

```text
apps/
  web/          Next.js client — renders, never decides
  api/          one deployable: HTTP + realtime + orchestration
  worker/       same codebase, job-processing entry point
packages/
  shared/       types and contracts shared by web and api
  game-data/    content definitions + validation (ADR-011)
  game-engine/  pure simulation (ADR-010)
```

Boundaries are enforced by **build-time dependency rules**, not by convention:

- `game-engine` may not import `api`, `web`, any ORM, cache client or HTTP type;
- `game-data` may not import `game-engine` or `api`;
- `web` may not import `game-engine` or any persistence package;
- context modules inside `api` expose an explicit surface and may not reach into each other's
  internals.

`packages/shared` is the single name for the shared contract package. An earlier draft of the
project documentation used both `shared` and `shared-types`; `shared` wins.

## Consequences

**Benefits.**
- Real database transactions are available exactly where the economy needs them.
- One deployment, one log stream, one migration path — the operational surface stays small while
  the team is small.
- The context discipline of `ADR-001` survives, because the boundaries are checked by the build
  rather than by memory.
- Extraction stays possible: a module with an enforced surface and no inbound reach-ins is a
  service waiting to happen, if profiling ever justifies one.

**Costs.**
- Everything scales together. Accepted: there is no traffic to scale, and the engine is the only
  plausible hotspot, which `ADR-010` already isolates behind a replaceable interface.
- A single deployable can rot into a tangle if the dependency rules are not enforced from the
  first commit. Hence build-time enforcement rather than a style guide.
- The worker sharing the API codebase means a worker-only change redeploys both. Acceptable at
  one deployable; a real cost only at a scale the project has not reached.

**Constraints created.**
- Dependency rules are configured in Phase 0B's first commit, before there is anything to
  violate them.
- No context may import another's internals; cross-context work goes through published surfaces.
- No new deployable may be introduced without a profiling or isolation argument.

## Alternatives considered

**Microservices per bounded context.** Rejected as premature and actively harmful here. It
converts the economy's atomicity requirement into a distributed-transaction problem, and
`docs/ARCHITECTURE.md`'s security baseline — no duplication, no double-spend — is exactly what
distributed transactions make hard. No load data exists to justify the cost.

**A separate simulation service from day one.** Rejected. `ADR-010` already gives the engine a
clean, replaceable boundary. Making it a network hop adds latency, serialization and a failure
mode, and buys nothing until profiling says otherwise.

**No enforced boundaries — rely on review.** Rejected. Boundaries that depend on everyone
remembering are boundaries that erode under deadline pressure, and the erosion is invisible
until it is expensive.

**Separate repositories per package.** Rejected. It would make a cross-cutting change a
multi-repository ceremony for a team this size, with no isolation benefit that the monorepo's
dependency rules do not already provide.

## Product constraints requiring this architecture

- *"Build the first simulator in the simplest maintainable server stack."* — `AGENTS.md` §5
- *"Avoid premature C++/WASM optimization."* — `AGENTS.md` §5
- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
- *"no item duplication; no currency double-spend."* — `docs/ARCHITECTURE.md`
- The monorepo target in `docs/ARCHITECTURE.md`
