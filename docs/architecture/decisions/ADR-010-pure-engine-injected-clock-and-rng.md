# ADR-010 — The engine is a pure function over explicit inputs, with injected clock and RNG

**Status:** `ACCEPTED`
**Phase:** 0A.5
**Date:** 2026-09-20

## Context

The product requires the simulation to be replaceable:

> *"Keep the combat simulation behind a stable interface so it can later move to Go/Rust/C++ if
> profiling proves necessary."* — `AGENTS.md` §5

And to be debuggable:

> *"Randomized outcomes should be reproducible/debuggable through server logs where practical."*
> — `AGENTS.md` §5

Both properties die the moment the engine reaches outside itself. An engine that queries the
database cannot be tested without one, cannot be ported without porting the data layer, and
cannot be replayed because its inputs are not recorded anywhere. An engine that calls
`Date.now()` or `Math.random()` produces a different answer every run, which makes a bug report
unreproducible by construction.

## Decision

**The engine is a pure function.** Given the same inputs it returns the same outputs, always.

- **No I/O.** No database, no cache, no network, no filesystem, no framework types. Content
  arrives as data that was already loaded.
- **Time is injected.** The engine never reads a system clock. Elapsed time and tick boundaries
  are parameters.
- **Randomness is injected.** The engine receives a seeded generator, never a global one. The
  seed is part of the activity's recorded state.
- **Content arrives pinned.** The content version is an input; the engine never resolves a key
  against a mutable source.
- **Output is a description of change**, not an applied change. The engine returns what should
  happen; orchestration decides how to persist it.

The engine does **not** own: persistence, transactions, scheduling, session liveness,
authorization, or the decision to settle.

## Consequences

**Benefits.**
- A bug becomes a fixture. An activity's inputs plus its seed reproduce the exact run, on a
  laptop, in a test, years later.
- Testable without a database, a browser, or a running API — which is what makes a future
  language change survivable rather than theoretical.
- The port boundary is real: replacing the engine means replacing a function with a known
  signature, not untangling it from the application.
- Balance simulation becomes cheap, which the combat foundation explicitly asks for
  (`COMBAT_LEVEL_SKILLS_FOUNDATION.md` §43 requests a developer-only progression simulator).

**Costs.**
- Orchestration must gather every input before calling the engine, which is more work than
  letting the engine fetch what it needs. This is the whole point: the inputs become explicit
  and therefore recordable.
- Large input payloads for large parties and content sets. Mitigated by passing pinned,
  pre-loaded content rather than copies.
- Seeds must be stored and managed. Small cost, large payoff.

**Constraints created.**
- No import of a framework, ORM, cache client or HTTP type inside the engine package. This is
  enforceable by dependency rules in the build, not by review discipline alone.
- No ambient clock or global RNG anywhere in engine code.
- Every engine result must be applicable by orchestration without further engine calls.

## Alternatives considered

**Engine with repository access.** Rejected. Convenient, and it makes every property above
impossible: not testable without a database, not portable, not replayable, and the inputs to any
given run are unknowable after the fact.

**Ambient clock and global RNG.** Rejected. Non-reproducible by construction, and it makes
deterministic tests flaky in exactly the code where correctness matters most.

**Engine writes its own results.** Rejected. It would give the engine transaction
responsibilities, cross the boundary `ADR-001` establishes, and put the anti-dupe invariants in
the one component intended to be replaceable.

**Actor or process-per-activity model.** Rejected as premature. It solves a concurrency problem
the game does not yet have, and it would couple the engine to a runtime, undermining the port
story.

## Product constraints requiring this architecture

- *"Keep the combat simulation behind a stable interface..."* — `AGENTS.md` §5
- *"Avoid premature C++/WASM optimization"* and *"Build the first simulator in the simplest
  maintainable server stack"* — `AGENTS.md` §5
- *"Randomized outcomes should be reproducible/debuggable through server logs where practical."*
  — `AGENTS.md` §5
- *"All authoritative outcomes happen on the server."* — `AGENTS.md` §5
- The balance simulation tool requested in `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §43
