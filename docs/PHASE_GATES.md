# Phase gates

**Status:** `APPROVED DIRECTION`. Nothing here is implemented; each gate names work that must be
done and proven **before** the phase behind it starts.

**Related:** [`MASTER_DEVELOPMENT_ROADMAP.md`](MASTER_DEVELOPMENT_ROADMAP.md) §20 ·
[`PROJECT_STATE.json`](PROJECT_STATE.json) · [`DESIGN_INDEX.md`](DESIGN_INDEX.md)

---

## What a gate is

A gate is a small set of correctness obligations that a later phase would otherwise discover the
expensive way — after its data shape has hardened, or after two accounts already share a run.

A gate is **not** a phase. It has no matrix of its own unless the work lands in a phase that
does, it does not appear in `PROJECT_STATE.json` as an active phase, and passing one never
changes any phase's verification record.

**This document records requirements. It does not record status.** Implementation and
verification live in [`PROJECT_STATE.json`](PROJECT_STATE.json) and in each phase's own
specification.

---

## PRE-PHASE-4 GATE — before Party and vocations

### G4.1 — Character retirement integrity

Retirement is `ACCEPTED` in `ADR-007` and partially enforced: Phase 3's correction pass found one
player-facing loader that did not filter retired Characters, and normalised it (`RET1`). The
**product flow** was deliberately not built.

Before Phase 4 multiplies the number of Characters in play:

- every read path that can surface a Character filters retirement consistently, and a test proves
  it for each one rather than for a sample;
- a retired Character does not count against roster size, does not reserve its vocation, and
  cannot enter an Active Party — each stated as an invariant test;
- items and currency held at retirement reach the account-level recovery custody scope, with no
  path that destroys or duplicates them.

**Owner:** Phase 4 builder, before Party formation work.
**Acceptance:** invariant tests, not a manual audit.

### G4.2 — `baseXp` vs `baseLevel` projection truth

The Character row carries both a level and an experience total. Two stored numbers that must
agree are two numbers that can disagree.

Before Phase 4:

- state which one is **authoritative** and which is **derived**, in one place;
- prove the projection in both directions across the level curve, including the boundaries;
- prove that death XP loss, and any future XP source, cannot leave the pair inconsistent — and
  that a settlement which rolls back rolls back both.

**Owner:** Phase 4 builder.
**Acceptance:** a projection test over the curve plus an invariant that the pair never diverges.

### G4.3 — An Actor / Participant combat contract

Phase 4 introduces up to 4 same-account actors. Phase 5B introduces participants from several
accounts. The contract written now must support both **without** building a multiplayer platform
yet.

- combat actor identity is its **own** concept. It is not the account id, and it is not one
  hard-coded Character;
- the contract admits several actors per side, and admits participants whose owning accounts
  differ, even though nothing yet creates that case;
- **compatibility adapters** keep previously VERIFIED Hunt behaviour and its fixtures intact. A
  single-Character Hunt must produce the same results, from the same seeds, as it does today;
- `Actor`, `Target` and `Side` stay neutral — the guardrail already recorded in
  [`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md) §4.

**Explicitly not in scope:** lobbies, invitations, cross-account anything.

**Owner:** Phase 4 architect.
**Acceptance:** existing Hunt fixtures pass unchanged through the adapter, plus a contract test
showing a multi-actor side is representable.

---

## PRE-5B GATE — before two accounts share one Activity

### G5B.1 — Multi-account Activity membership invariants

The Character→membership invariant and competitive liveness semantics must exist before any
shared run. The design is in
[`design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md`](design/MULTIPLAYER_ACTIVITIES_FOUNDATION.md);
the invariants are the gate.

- per-Character occupancy still holds when the Activity spans accounts;
- one shared run identity, and membership that cannot silently fork;
- liveness rules stated per participant.

### G5B.2 — Cross-account disconnect, decided separately

**A one-account Party pauses on disconnect because one session owns all of it.** That reasoning
does not transfer.

Cross-account disconnect behaviour is a **separate product decision**, separately tested. One
player's disconnect must **not** automatically pause everybody unless that specific rule is
approved on its own merits. Until it is decided, no shared quest ships.

### G5B.3 — Reward ledger safety across accounts

A shared run pays several accounts. Before the first one runs:

- no double-pay and no lost payout under retry, rollback or partial failure;
- settlement is per account and auditable;
- spectator-only reads cannot claim, influence or alter any of it.

**Owner:** Phase 5B slice 1.
**Acceptance:** concurrency and idempotency tests at the account boundary.

---

## PRE-MARKET GATE — before Market, Forge or Imbuement

### G6.1 — Minimum cross-account settlement, early

The **minimum** multi-account reward and penalty settlement must be implemented and proven before
the first Phase 5B shared quest — it does not wait for the full Market. See G5B.3; this gate is
the statement that the dependency runs the other way round from the phase numbers.

### G6.2 — Definition versioning

An ADR for `ItemDefinition` version semantics: what happens to live `ItemInstance` rows when a
definition's weight, stackability or slot changes in a new bundle. An Activity pins its bundle; a
traded or forged item outlives one Activity.

### G6.3 — Rarity and affix validation

Impossible rarity/affix identities must be rejected at the boundary. Today an affix array is JSON
the domain writes and trusts; a market lets someone else's row reach your inventory.

**Owner:** Phase 6, before any market, forge or imbuement surface exists.

---

## PRE-LAUNCH GATE — and what must NOT wait for it

Phase 10 owns scale and hardening. It does **not** own everything risky.

> **Security, retry/idempotency, economy correctness and realistic load tests happen at the phase
> that introduces their risk — never all postponed to Phase 10.**

A phase that introduces a new way to lose money, duplicate an item or admit an untrusted actor
carries that phase's hardening with it. What Phase 10 owns is the work that genuinely cannot be
done earlier: whole-system load profiling, backup and restore rehearsal, retention and
compaction, anti-abuse at real traffic, and support tooling.

Carried from [`design/FUTURE_DIRECTIONS.md`](design/FUTURE_DIRECTIONS.md) § *Before beta /
scale*: `IdempotencyRecord` retention, `SettlementOperation` retention with a compaction proof,
content bundle archival, an object-storage provider, production rate limiting and auth hardening.

---

## Operational gate — integration, not accumulation

- **Do not endlessly stack open pull requests.** Accepted PRs are integrated in order, with the
  Product Owner's authorization, and CI is verified on the **actual integration base** rather than
  on a branch's own stale base.
- **Every `VERIFIED` status applies to a named reviewed commit**, never to a branch head that
  keeps moving. A verification record names the SHA it verified.
- A docs or design PR never advances `activePhase` and never marks a phase `VERIFIED`.
