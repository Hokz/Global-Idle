# ADR-011 — Content is a versioned build artifact, and activities pin their version

**Status:** `PROPOSED`
**Phase:** 0A.6
**Date:** 2026-09-20

## Context

`AGENTS.md` §5 requires game data to be separate from engine logic and prefers *"data-driven
creatures, items, hunts, quests, bosses, affixes and costs."* `docs/ARCHITECTURE.md` places
those definitions in a `game-data` package.

What neither settles is where content *lives at runtime*: rows in the same database as player
state, or an artifact shipped with the build. The choice has consequences that are hard to
reverse, because it determines whether content can be edited underneath a running simulation.

It also interacts with `ADR-010`. A pure, reproducible engine needs its content inputs to be
stable: replaying an activity is meaningless if the creature it fought has since been rebalanced.

## Decision

**Content is a versioned artifact, authored in the repository, validated in CI, and immutable at
runtime.**

- Definitions live as files in `game-data`, reviewed like code.
- The content set carries a **single version identifier** covering all definitions together.
- CI **validates** the set before it can ship: references resolve, keys are unique and
  well-formed, required fields exist, numeric ranges are sane.
- At runtime the server **loads** content; nothing writes it. There is no content table a
  support tool can edit.
- Every Activity **pins** the content version it started with, and the engine is handed
  definitions from that version for the activity's whole life.
- Identity is a **canonical key** (`creature.rookgaard.rat`), stable across versions. An
  imported external reference is recorded as a **source alias**, never as the canonical key.

**Hot reload is explicitly not supported.** A content change is a deployment.

## Consequences

**Benefits.**
- Content changes are reviewable in a pull request — which is the entire reason to separate
  content from logic.
- A deployment mid-hunt cannot change the creature a player is currently fighting.
- Replay works: an activity's inputs, seed and content version fully determine its outcome.
- Invalid content fails in CI, not at 3am in production.
- Source aliases keep research traceable to Canary or another reference without letting an
  external id become the project's identity.

**Costs.**
- A balance tweak requires a deploy. At this stage that is a feature, not a limitation: the
  economy and combat are not yet stable enough for unreviewed live edits to be safe.
- Long-running activities may hold an old content version alive. Bounded in practice — sessions
  end — and a retention policy for superseded versions is a `DEFERRED` operational detail.
- Content and code versions must be deployed compatibly, so the build must record which content
  version it carries.

**Constraints created.**
- No runtime write path to content, including admin tooling.
- Canonical keys are immutable once published; renaming is a new key plus a documented
  migration.
- The engine receives resolved definitions, never a key to look up.

## Alternatives considered

**Content as database rows, edited through an admin UI.** Rejected. It makes content mutable
under a running simulation, removes code review from balance changes, and breaks replay. It is
also the path by which a single bad edit takes down live gameplay with no CI in the way.

**Per-definition versioning.** Rejected as disproportionate. It produces a combinatorial space
of version tuples to pin and reason about, when a whole-set version answers every question the
project actually has.

**Hot reload without versioning.** Rejected. It is the mutable-content problem with faster
symptoms: a running activity could observe two different definitions of the same creature within
one run.

**External ids as canonical keys.** Rejected. It would bind the project's identity model to
another project's numbering, and `docs/REFERENCES.md` is explicit that reference implementations
are *"references, not authority"*. It would also complicate the IP boundary the project must
preserve.

## Product constraints requiring this architecture

- *"Keep game data separate from engine logic"*, *"Prefer data-driven creatures, items, hunts,
  quests, affixes and balance values"* — `AGENTS.md` §5
- *"Do not implement each Dungeon as a custom combat engine."* —
  `TUTORIAL_ROOKGAARD_ROADMAP.md` §16
- *"Reference implementations are references, not authority."* — `docs/REFERENCES.md`
- Reproducible, debuggable randomized outcomes — `AGENTS.md` §5
