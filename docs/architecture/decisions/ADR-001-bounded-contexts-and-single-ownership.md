# ADR-001 — Bounded contexts and single ownership of state

**Status:** `PROPOSED`
**Phase:** 0A.1
**Date:** 2026-09-20

## Context

Global Idle spans a wide surface: identity, characters, party formation, simulated combat,
itemization, content authoring and a player economy. `docs/ARCHITECTURE.md` lists twenty-plus
entities without saying which part of the system is responsible for each one.

Without that answer, two failure modes are near-certain. The first is *shared mutable state*:
combat writes a character's XP, the party screen writes it too, and the economy adjusts it for
a death penalty — three writers, no single place to enforce an invariant. The second is
*circular responsibility*: the engine reaches into persistence, persistence calls back into
domain services, and the "isolated simulation engine" the product requires becomes impossible.

The project has already committed to keeping the simulation replaceable:

> *"Keep the combat simulation behind a stable interface so it can later move to Go/Rust/C++ if
> profiling proves necessary."* — `AGENTS.md` §5

That is only achievable if the engine's inputs and outputs are explicit, which in turn requires
knowing what the engine does and does not own.

## Decision

Partition the domain into **seven bounded contexts**, each the exclusive owner of its state:

| Context | Owns |
|---|---|
| Identity & Access | Account, Session, Entitlement |
| Character | Character, roster capacity, Progression, Skills |
| Party | Active Party composition and order |
| Activity | Hunt / Dungeon / Skill Training runs and their in-flight state |
| Items | ItemInstance, Inventory and Equipment custody |
| Economy | Ledger, balance projections, Market listings, escrow |
| Content | BaseItem, Creature, Loot Table, World Location, Hunt and Dungeon definitions |

Three rules govern them:

1. **Exactly one authoritative owner per piece of state.** No state is writable from two
   contexts.
2. **Cross-context access is by published identifier**, never by reaching into another
   context's internals.
3. **Authority flows in one direction.** Activity reads Character and Content and *settles*
   into Character and Economy; it never writes them directly. Party reads Character, never
   writes it. Content has no runtime writer at all.

## Consequences

**Benefits.**
- Every invariant has an obvious home, so "where is this enforced?" always has an answer.
- The engine boundary becomes describable: Activity and Content in, settlement results out.
- Contexts become independently testable, which is what makes a future language change to the
  engine survivable.
- The `AGENTS.md` separation of game data from engine logic is structural rather than
  aspirational.

**Costs.**
- Operations that span contexts — settling a hunt touches Character, Items and Economy — need
  explicit orchestration at the application layer rather than a convenient direct write. This
  is the intended trade: the coordination becomes visible instead of implicit.
- Some reads require composing two contexts (a character sheet needs Character plus Items).
- Seven contexts is more ceremony than a small codebase needs on day one. Accepted, because
  the economy's integrity requirements arrive early and are expensive to retrofit.

**Constraints created.**
- No context may expose a write path into another's state, including "just this once" helpers.
- A new system must declare which context owns its state before it is built.

## Alternatives considered

**A single application-service layer over one shared model.** Rejected. It is faster to start
and it is exactly how the double-writer problem arises. The economy's anti-dupe requirements
make an unowned shared model a liability from the first sprint.

**Microservices per context.** Rejected as premature. `AGENTS.md` §5 says to *"build the first
simulator in the simplest maintainable server stack"* and to avoid premature optimization.
Context boundaries inside one deployable give the same design discipline without distributed
transactions — and the economy genuinely needs real transactions. Contexts are drawn so that
extraction remains possible later if profiling justifies it.

**Fewer, coarser contexts** (e.g. folding Party into Character and Items into Economy).
Rejected: Party has a different lifecycle from Character (configuration vs. persistent avatar),
and Items outlive any single economy operation. Merging them would hide exactly the boundaries
that matter.

## Product constraints requiring this architecture

- *"All authoritative outcomes happen on the server."* — `AGENTS.md` §5
- *"Keep game data separate from engine logic."* — `AGENTS.md` §5
- *"Economy operations must be transactional and auditable."* — `AGENTS.md` §5
- *"Keep the combat simulation behind a stable interface."* — `AGENTS.md` §5
- The entity list in `docs/ARCHITECTURE.md`, which this ADR assigns owners to.
