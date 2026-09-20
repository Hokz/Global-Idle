# ADR-016 — Versioned content bundles are retained while referenced, and never garbage-collected

**Status:** `ACCEPTED`
**Phase:** 0A (corrects a claim in `CONTENT_DATA_ARCHITECTURE.md`)
**Date:** 2026-09-20

## Context

`ADR-011` establishes that content is a versioned artifact and that a running Activity pins the
version it started with. The retention question was answered with a claim that is simply wrong:

> *"Since session-bound activities end within hours, the practical retention window is short."*

Hunts are **endless by design**. Room 10 repeats indefinitely, and the reconnect grace preserves
an activity across disconnects. There is no upper bound on how long an Activity pinned to
content version N may persist, and "hours" is an assumption, not a fact.

The consequence of getting this wrong is severe and silent: deploy N+1, garbage-collect N, and
every persisted activity pinned to N becomes unrecoverable. The player's hunt does not degrade —
it fails to load.

## Decision

**Content bundles are immutable, addressable by version, and retained for as long as anything
references them.**

- each published version is an **immutable bundle**, addressable by its version identifier;
- the running server can **load any referenced bundle**, not only the one it shipped with;
- a bundle is **never garbage-collected while referenced** by a persisted Activity, an
  `ItemInstance`, or any other durable row;
- reference counting is derivable from durable state — the set of pinned versions is a query,
  not a bookkeeping side-channel that could drift;
- deleting an unreferenced old bundle is an explicit, audited operational action, never an
  automatic sweep.

**A persisted Activity pinned to version N remains recoverable after a deploy to N+1, by
construction.** Recovery loads N, not whatever shipped last.

No assumption is made anywhere about how long an activity lives.

## Consequences

**Benefits.**
- An endless Hunt stays recoverable across any number of deployments. The player's session
  survives the team shipping.
- Replay and support debugging keep working for old activities, which was the point of pinning.
- The failure mode is removed rather than mitigated: there is no sweep that could delete a
  referenced bundle.
- Reference counting from durable state means it cannot silently disagree with reality.

**Costs.**
- Bundles accumulate. Content is text; this is cheap, and an explicit audited cleanup exists for
  genuinely unreferenced versions.
- The server must be able to hold several bundles in memory simultaneously when old activities
  are still running. Bounded by how many distinct versions are actually pinned, which is small
  in practice and measurable.
- Deployment must publish bundles to durable, addressable storage rather than only bundling them
  into the application image. This is the real cost of the decision, and it is worth it.

**Constraints created.**
- No automatic content garbage collection, ever.
- No code may assume the current bundle is the only loadable one.
- No document may claim activities finish within any particular time.

## Alternatives considered

**Time-based retention ("keep 30 days").** Rejected. It is the same bug with a longer fuse: an
activity older than the window still breaks, and the failure is rare enough to reach production
undetected.

**Migrate pinned activities forward on deploy.** Rejected. It changes the content an activity is
running under — a creature could gain health mid-fight — which defeats pinning and breaks
replay. It also turns every content change into a migration.

**Refuse to deploy while old-version activities exist.** Rejected. With endless Hunts that means
never deploying.

**Keep only the bundles referenced at deploy time.** Rejected. It races: an activity can start on
version N moments before the check, and the check cannot be made atomic against a live system
without stopping it.

## Product constraints requiring this architecture

- Hunts are endless; room 10 repeats indefinitely — `docs/DECISIONS.md`
- The reconnect grace preserves an activity across disconnection — `docs/DECISIONS.md`
- A running Activity is pinned to its content version — `ADR-011`
- Reproducible, debuggable randomized outcomes — `AGENTS.md` §5
