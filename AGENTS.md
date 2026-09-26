# AGENTS.md

This file defines how AI coding agents must operate in this repository.

## 1. Project role

You are working on **Global Idle**, a browser-based, server-authoritative idle strategy RPG.

Do not treat this as a generic clicker game.

The project depends on:

- world navigation;
- endless hunts;
- party composition;
- equipment strategy;
- randomized item instances;
- Forge;
- Imbuements;
- Wheel-style progression;
- vocation-specific skill trees;
- quests as dungeons;
- boss unlocks;
- market/economy;
- Free vs Premium balance.

## 2. Mandatory reading order

Before meaningful work, read:

1. `README.md`
2. `docs/DESIGN_INDEX.md`
3. `docs/MASTER_DEVELOPMENT_ROADMAP.md`
4. `docs/PRODUCT_VISION.md`
5. `docs/GAME_SYSTEMS.md`
6. `docs/ECONOMY.md`
7. `docs/architecture/ARCHITECTURE_OVERVIEW.md`
8. `docs/MVP_SCOPE.md`
9. `docs/DECISIONS.md`
10. `docs/OPEN_QUESTIONS.md`
11. any task-specific design document.

Read these **fresh at the start of every phase**. They are the canonical record of product
direction; conversation history is not. A requirement that exists only in a chat is not a
requirement — if it matters, it is in one of these documents first.

## 3. Agent workflow

Use this workflow:

```text
research
→ choose the best defensible decision
→ document rationale and alternatives
→ complete the assigned phase
→ validate / test
→ pull request
→ independent review
→ correction loop
→ merge only after review
```

**Execution is autonomous.** Do not stop mid-phase to ask permission, and do not leave an item
open merely because it would ordinarily be a Product Owner call.

A builder or architect **may resolve an ordinary OPEN decision** when it is necessary to complete
the assigned phase, provided they:

- do not contradict a **LOCKED** product decision;
- research first, including authoritative sources where the repository is insufficient;
- record the decision and its rationale;
- identify the alternatives considered and the trade-offs;
- keep the change inside the phase's scope;
- validate and test it;
- submit it for independent review;
- **never merge their own work.**

The Product Owner retains final approval and may reverse any autonomous decision during review.

Stop and ask only when:

- an action is destructive or irreversibly external;
- credentials or permissions are required;
- a legal or licensing blocker changes what can be shipped;
- two **LOCKED** requirements are irreconcilable;
- there is genuinely no defensible option after reasonable research.

Note that a *balance or monetization value* is usually not a blocking decision: it is a
configuration input. Defer it as a parameter and continue, rather than stopping the phase.

## 4. Product Owner vs agent authority

### Product Owner owns
- game-design decisions;
- monetization direction;
- balance philosophy;
- Free vs Premium rules;
- final approval.

### Agent owns
- implementation details;
- technical architecture within approved constraints;
- tests;
- refactors necessary for correctness;
- debugging;
- CI repair;
- documentation updates.

Never silently override a locked product decision.

### Recording a direction change

An approved change of product direction is a **documentation change first**, in its own PR:

1. update the **single owning document** — the one that owns that topic, not whichever is open;
2. update `docs/DESIGN_INDEX.md` and every affected cross-reference;
3. mark each statement `APPROVED`, `OPEN` or `TENTATIVE`, and name the owning phase or gate;
4. open a **docs-only PR**, have it independently reviewed, and merge only with the Product
   Owner's authorization.

A direction handoff is **never** by itself authorization to implement. Implementation needs its
own specification, tests, PR and review. A docs PR never advances `activePhase` and never marks a
phase `VERIFIED`.

Where a new direction appears to contradict a **LOCKED** rule, raise it for the Product Owner's
decision in the PR. Do not quietly rewrite the rule.

## 5. Architectural principles

- Keep **game data separate from engine logic**.
- Prefer data-driven creatures, items, hunts, quests, bosses, affixes and costs.
- All authoritative outcomes happen on the server.
- Browser/client is never trusted for:
  - damage;
  - loot;
  - rarity;
  - Forge success;
  - XP;
  - currencies;
  - market transfers.
- Economy operations must be transactional and auditable.
- Randomized outcomes should be reproducible/debuggable through server logs where practical.
- Avoid premature C++/WASM optimization.
- Build the first simulator in the simplest maintainable server stack.
- Keep the combat simulation behind a stable interface so it can later move to Go/Rust/C++ if profiling proves necessary.

## 6. Quality requirements

Before calling work complete:

- add tests for the requested behavior;
- add positive and negative controls where applicable;
- review rounding and RNG;
- review item/currency duplication paths;
- review transaction boundaries;
- review reconnect-grace and offline Skill Training consistency;
- review market races;
- review rollback behavior;
- review Premium/Free implications;
- run CI;
- review the full diff again from scratch.

Green CI does **not** prove game correctness.

## 7. Pull request report

Every substantial PR should state:

- what changed;
- why;
- files changed;
- data/schema changes;
- tests added;
- CI status;
- known limitations;
- unresolved design questions;
- migration/rollback notes if relevant.

Do not merge automatically unless explicitly authorized.

## 8. Research sources

For systems inspired by existing games, use source hierarchy defined in `docs/REFERENCES.md`.

Reference implementations are references, not authority.

## 9. IP / asset boundary

Do not assume third-party maps, sprites, names, text, logos, sounds or other proprietary assets can be shipped commercially merely because they are technically accessible.

Mechanics research and internal prototypes are separate from public-release asset rights.

## 10. Immediate focus

**The canonical project state is [`docs/PROJECT_STATE.json`](docs/PROJECT_STATE.json).** Read it
first. It names the active phase, the last independently VERIFIED phase, and the stacked pull
requests in flight. This section explains what that state MEANS; it does not duplicate it, because
a phase marker copied into five documents is a phase marker that goes stale in four of them — and
this file said *"Current phase: Phase 1"* for two entire phases.
`scripts/check-project-state.mjs` fails CI if the two ever disagree again.

Active phase: **Phase 3.7 — First real asset visual slice** — **`VERIFIED`**, independently
reviewed and accepted 2026-09-24 at head `733503bccf262fbcc7790c78886684d7d239ad84` (PR #12, still
open and stacked on PR #11). Its specification is
[`docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md`](docs/specs/phase-3-7/PHASE_3_7_ASSET_VISUAL_SLICE_SPEC.md)
and its 69 matrix cases pass.

It remains the active phase only because **nothing after it has started. Phase 4 has NOT started.**
**There is no Phase 3.8.** After Phase 3.7 comes the PRE-PHASE-4 gate in
[`docs/PHASE_GATES.md`](docs/PHASE_GATES.md), which has **not** been passed, and then Phase 4. The
canonical sequence (`docs/MASTER_DEVELOPMENT_ROADMAP.md` §20) is:

```text
Phase 3.7 — VERIFIED → PRE-PHASE-4 specification
  → PRE-PHASE-4 implementation + independent validation → Phase 4 foundation
  → PHASE 4A — PLAYABLE BETA SLICE / CREATOR PREVIEW → remainder of Phase 4 → Phase 5
```

The product decisions the gate depends on were made on 2026-09-25. Its next work product is the
**PRE-PHASE-4 specification**, and then the implementation of the decided rules and contracts:

- **G4.1, Game Account deletion** (`ADR-024`, which reuses `ADR-020`'s lifecycle and supersedes
  its Character target; `ADR-020` superseded `ADR-007`'s retirement). A request puts the **whole
  Game Account** into a 720-hour grace, fully frozen and exactly restorable. Then a hard purge
  removes the Main, every companion and everything the Game Account owns. The Login survives,
  nothing transfers, no replacement Main is created, and one lifecycle serves every source,
  moderation included. An internal history record remains, and there is no public Deleted List.
  It is **not implemented** — the code still carries `retiredAt`;
- **G4.2**, the `baseXp` → `baseLevel` projection on every write path, rollback and migration;
- **G4.3**, the Actor/Participant contract — the vocationless Main alone in Rookgaard, the Main and
  up to three companions, one actor per Game Account in co-op;
- **G4.4**, globally unique Character names;
- **G4.5**, the tunable configuration surface (`ADR-025`).

Do not begin Phase 4 work, implement any of it, or mark the gate passed until the Product Owner
says so.

**Phase 4A — Playable Beta Slice / Creator Preview** is a mandatory playable milestone inside the
Phase 4 program, after the Phase 4 foundation. It is not a replacement for Phase 4 and not a gate
([`docs/design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md`](docs/design/milestones/PHASE_4A_PLAYABLE_BETA_SLICE.md)).
One person plays from development / staging sign-in to a restored session: a Game Account, its
Rookgaard Main, the Atlas, an NPC, a Hunt, XP, a Skill, loot, equipment, a potion through an
action slot, and state restored from the server. Creator tooling belongs to an authenticated
privileged identity, never to a *"God Character"*, and never bypasses a domain invariant. It has
**not** started.

Since 2026-09-25 one **Login** may own several **Game Accounts**. Each has exactly **one Main
Character** — the Main from creation, vocationless in Rookgaard, which selects its vocation on
proceeding to the Mainland — up to four **permanent** companions, and its own name, claims and
economy (`ADR-022`). The personal Active Party is the Main plus up to three companions, and human
multiplayer takes one selected actor per Game Account. **Rookgaard** is a permanent, single-player,
vocationless region where a player may stay (RK1–RK4). Replaying a human multiplayer or co-op quest
is separate from its one-time reward claim, which belongs to the Game Account — never the actor or
the Login (`ADR-023`). The weapon attack and defence formulas are **locked**, and ranged Accuracy,
the damage roll and the rounding stages stay open (`docs/DECISIONS.md`). These decisions were
recorded at PR #13 head `c74b845`, which was independently reviewed, its decisions accepted, and
returned for documentation corrections only. The correcting head is **pending independent
review**. **The PRE-4 specification has not started.**

**Character-bound consumables** (`ADR-021`, `LOCKED` by the Product Owner on 2026-09-24) are
consumables bound permanently to one Character — XP Boosts, Store-bought Exercise Weapons, Daily
Reward and Event consumables, and since 2026-09-25 the tutorial's Health and Mana potions. The
binding is separate from custody and lives on the instance, never in Canary's `UNIQUEID`. They move
only between the Character's Store Container and the Account's Depot, a configured action slot may
drink a bound potion straight from the Store Container, and they are never sold, traded, listed,
stashed, forged or converted. They are purged with their Game Account. The Store does not sell
combat equipment. The tutorial's starter gear is ordinary items. **Nothing of it is implemented.**
Which phase first issues the tutorial potions bound is open (`ADR-024` DEL-O5). The first phase
that ships a bound item implements it first, behind gate GBC.1 in
[`docs/PHASE_GATES.md`](docs/PHASE_GATES.md).

User-supplied client assets are a PRIVATE reference and must never be committed — see the Phase
3.7 specification's §9. The
boundary is enforced, not merely documented: `pnpm release:check`
(`scripts/check-release-isolation.mjs`) fails the build if a private asset can reach a
distributable artefact. `apps/web/public/assets/private/` is a forbidden path; every file under
`apps/web/public/` — text included — must be on the deny-by-default release allowlist
`apps/web/public/ASSET_MANIFEST.json`, matched by hash, unless it is on the narrow exempt-path
list; and every image, font or media file in the BUILD ARTEFACT must hash-match an allowlist entry,
because a bundled asset never passes through `public/`. An allowlist entry must state a non-empty
author and licence: the script can require that a claim exists and bind it to exact bytes, but only
a human can verify the claim is true. Private files belong at `private/assets/`, which no bundler
input covers.
Last VERIFIED: **Phase 3.7 — First real asset visual slice**, accepted 2026-09-24 at head
`733503bccf262fbcc7790c78886684d7d239ad84` (PR #12). Phase 3.6 remains VERIFIED at `f96c839`
(PR #10); Phase 3.5 at `2e67f4b` (PR #9); Phase 3 at `d46f78b` (PR #8).

Phase 0A (`ARCHITECTURE_APPROVED`), Phase 0B, Phase 1, Phase 2, Phase 3, Phase 3.5, Phase 3.6 and
Phase 3.7 are closed and VERIFIED. Their
primitives — occupancy, Stamina, active-use timers, entitlements, idempotency, content bundles,
transactions, the deterministic Hunt simulator, currency custody, the physical item model, the
tile map with its authoritative movement timeline, cadence-invariant random streams, the
supported movement domain every actor is proved against, and the release-isolation boundary that
keeps private client assets out of every distributable artefact —
are implemented and independently reviewed. **Reuse them; do not build parallel replacements.**

A phase's own specification is the thing to build against, and the one in
`docs/specs/<phase>/` is authoritative over any summary. Do not silently redesign an approved
specification while coding: record the refinement in that phase's implementation notes instead.

Status vocabulary, and who owns each transition:

| Status | Meaning | Who sets it |
|---|---|---|
| `PLANNED` | named in a roadmap, nothing built | whoever plans |
| `IMPLEMENTATION_SPEC_READY` | the spec is accepted, build against it | the Product Owner |
| `IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW` | the implementer's end state | the implementing agent |
| `VERIFIED` | independently reviewed and accepted | **the Product Owner only** |

An implementing agent never writes `VERIFIED` and never merges its own pull request.

The first playable target is the vertical slice described in `docs/MVP_SCOPE.md`.
