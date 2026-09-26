# ADR-022 — A Game Account has one Main Character; further vocations are companions

**Status:** `ACCEPTED` — the product rules are `LOCKED` by the Product Owner (2026-09-25), who
also delegated, and then approved, the login-identity / Game Account separation in §2. Recorded
in the governance synchronization that follows PR #13 head `86a7681`. **Extended** in the final
2026-09-25 synchronization, after PR #13 head `fff6faf`. The Product Owner locked one Login owning
several Game Accounts, each with its own name (GA8–GA10). Companions are permanent, and the Main's
vocation is the one chosen on entering the Main game (GA11–GA13). Rookgaard is a single-player,
vocationless region where a player may stay indefinitely (RK1–RK4). Deletion targets the whole
Game Account (`ADR-024`). **Pending independent review.**
**Supersedes:** the roster of up to five equivalent Characters per Account —
[`DECISIONS.md`](../../DECISIONS.md) § *Party and character roster* as it stood until 2026-09-24,
and [`PARTY_SYSTEM_FOUNDATION.md`](../../design/party/PARTY_SYSTEM_FOUNDATION.md) §2–§8 and §28 as
written then.
**Amends:** [ADR-005](./ADR-005-active-party-as-configuration.md) — the Main is always in the
Active Party. [ADR-013](./ADR-013-character-activity-occupancy.md) and
[ADR-014](./ADR-014-per-character-stamina.md) — which of their per-Character rules reach a
companion is open (§4). [ADR-020](./ADR-020-character-deletion-grace-and-purge.md) — its
replacement flows assumed a new full Character could follow a purge (§5). Its deletion target is
superseded since the final synchronization by
[ADR-024](./ADR-024-game-account-deletion-grace-and-purge.md): the whole Game Account is deleted.
**Owning phases:** Phase 4 builds companions and the personal Active Party. PRE-4 must not build
against the five-Character model (§5). **Nothing in this record is implemented.**
**Date:** 2026-09-25

## Context

Until this decision the roster was up to five **equivalent** Characters per Account, one per
vocation. The first was the Origin Character, which played Rookgaard; each later one was unlocked
with Gold into a roster slot, started at Base Level 8 and was a full Character in every sense —
its own deletion lifecycle, its own place in the tutorial rules, free to replace the Origin in the
Active Party or anywhere else.

What exists in code today:

- `AuthIdentity` (a credential) resolves to exactly one `Account` (`DOMAIN_MODEL.md` §5.18);
- every `Character` row is an Origin Character: Base Level 1, no vocation, the Rookgaard starting
  grant (`roster.ts`, *"Phase 1 only creates origins"*);
- `rosterCapacity` (1–5, default 1) exists on `Account`, and I1b allows at most one
  un-vocationalized Origin Character per Account;
- there is no companion, no roster unlock, no vocation selection and no Active Party.

## Decision

### 1. The rules — `LOCKED BY PRODUCT` (2026-09-25)

**The Game Account and its Main Character**

| # | Rule |
|---|---|
| GA1 | A Game Account has exactly **one Main Character**. |
| GA2 | The Main Character is the player's primary created character and the Game Account's campaign identity. |
| GA3 | Additional vocation actors are unlocked as **companions** — members of the Game Account's roster. |
| GA4 | A companion is **not** an account-lifecycle Character equivalent to the Main. |
| GA5 | The five vocation identities remain Knight, Druid, Sorcerer, Paladin and Monk. |
| GA6 | Companion progression details that were not explicitly reconfirmed are not invented. Approved facts that remain compatible carry over (§3); details the change makes ambiguous are open (§4). |
| GA7 | A player who wants a different Main vocation may use another Game Account under the same login identity, subject to later UX and account-management design. |

**The Login and its Game Accounts** — `LOCKED`, final synchronization (2026-09-25)

| # | Rule |
|---|---|
| GA8 | A **Login Identity** is based on email / authentication. One Login may own **several Game Accounts**, and each Game Account is an independent campaign and session identity. |
| GA9 | Each Game Account has its **own name and display identity**. A Game Account name is not a Character name: the two are separate namespaces (`ADR-024` NM4). |
| GA10 | Each Game Account has its own Main — exactly one, once it enters the Main game — up to four Companions, its own campaign, progression and quest state, its own one-time reward claims, and its own gameplay and economy state. Nothing of it is shared with another Game Account of the same Login. |

**Vocation, the Main and Companions** — `LOCKED`, final synchronization (2026-09-25)

| # | Rule |
|---|---|
| GA11 | An unlocked Companion is **permanent**. It can never be deleted, dismissed, removed, replaced, rerolled, converted into the Main or unlocked backward. It disappears only with its whole Game Account (`ADR-024` GD8). |
| GA12 | The vocation chosen on entering the Main game becomes the **Main's** vocation. The other four vocations are the Game Account's possible Companions. |
| GA13 | The Main / Companion distinction creates **no hidden combat multiplier**. |

**Rookgaard** — `LOCKED`, final synchronization (2026-09-25)

| # | Rule |
|---|---|
| RK1 | Rookgaard is a **full playable region**, and a player may stay there indefinitely. Reaching Level 8 does not end it. |
| RK2 | Rookgaard has no vocation, no Companions, no Main-game Party and no Main-game multiplayer or co-op. It is **single-player**. |
| RK3 | A Game Account's character begins in Rookgaard **vocationless**, and stays vocationless, with no Companions, for as long as the player remains there. |
| RK4 | On proceeding to the Mainland the player selects the **Main vocation** there, and the other four vocations become the Game Account's possible Companions (GA12). |

**The personal Active Party**

| # | Rule |
|---|---|
| PP1 | A personal or solo Hunt belongs to **one** Game Account. |
| PP2 | The Main Character is present in it. Up to **three** companions may join, so it holds at most **four** combat actors. |
| PP3 | The player may reorder the formation, the Frontline included. The Main need not hold Slot 1. |

**Human multiplayer**

| # | Rule |
|---|---|
| MP1 | In human multiplayer or co-op, several human Game Accounts share one multiplayer Activity. |
| MP2 | Each participating Game Account selects **exactly one** eligible combat actor from its unlocked roster. |
| MP3 | That actor may be the Main **or** any unlocked companion. The Main is **not** mandatory in multiplayer. |
| MP4 | The personal four-actor Active Party never enters multiplayer as a block. |
| MP5 | Changing the selected actor never creates another account, another reward entitlement or another completion identity. |

The approved multiplayer direction stands where these rules do not contradict it: the first
cooperative quest takes up to five humans, one selected actor per Game Account; the Warzone scale
stays tentative and benchmark-driven; the lobby strategy and frozen-plan architecture of
[`COOPERATIVE_QUEST_STRATEGY.md`](../../design/multiplayer/COOPERATIVE_QUEST_STRATEGY.md) remain
in force.

These rules are Global Idle's. Nothing further is inferred from how any other game organises its
accounts or characters.

### 2. Login identity, Game Account, Main, companions — semantic separation, not a schema

The Product Owner delegated the question of one sign-in holding several Game Accounts, and
approved this direction:

```text
LOGIN / AUTH IDENTITY        who signs in — email / authentication (GA8)
  └─ GAME ACCOUNT            one campaign, with its own name; one or more per Login
       ├─ MAIN CHARACTER     exactly one per Game Account, once it enters the Main game
       └─ COMPANION ROSTER   up to four permanent companions, one per remaining vocation
```

*Final synchronization (2026-09-25):* the Login → several Game Accounts direction is `LOCKED`
(GA8). A Game Account is deleted as a whole, and its Login survives (`ADR-024` GD1–GD2). The Login
must therefore be represented apart from the Game Account before the purge ships (`ADR-024` §5).

- **The Account is the Game Account.** Every document that says *Account* or *account-level* —
  the Bank, the Depot, the Stash, entitlements as implemented today, tutorial completion,
  one-time reward state, the roster and its unlocks — means the Game Account. No existing rule
  moves between levels by being renamed.
- **The login identity is new.** It sits above Game Accounts. `DOMAIN_MODEL.md` §5.18's *"every
  identity resolves to exactly one Account"* describes what is implemented; one login identity
  holding several Game Accounts changes that cardinality. How it is represented — a principal of
  its own, a mapping, or another shape — is the owning phase's choice.
- **The Main Character is today's `Character`.** Every Character that exists is an Origin
  Character, which is a Main. *Origin Character* is the name Phases 1–3, their specifications and
  the code use (`originCharacter`, `character-baseline.origin`, `starting-grant.origin.rookgaard`);
  it now means the Main before it completes Rookgaard. *Since the final synchronization:* it is
  the Game Account's vocationless Rookgaard character, which becomes the Main — with its chosen
  vocation — on entering the Main game (RK3–RK4). A player who stays in Rookgaard keeps it
  vocationless, with no Companions.
- **A companion has no representation yet.** Whether it is a `Character` row with a role, a
  separate entity, or something else is Phase 4's choice. This record fixes the semantics, not
  the tables.

### 3. What carries over — approved, compatible, unchanged

Each of these was locked before 2026-09-25, and nothing in §1 contradicts it:

- **one roster member per vocation.** The Main and every companion hold distinct vocations, so a
  Game Account has at most four companions. A vocation the Main or a companion holds is not
  offered as a companion unlock;
- **companions are unlocked with in-game Gold**, not with Premium. An unlock is permanent, never
  refunded and never reduced. Exact costs and prerequisites stay open. Premium never adds a fifth
  active actor;
- **a newly unlocked companion starts at Base Level 8**, never enters Rookgaard, receives no
  catch-up levels, and has its own vocation, Base Level, Base XP and Skills;
- **Shared XP eligibility** is evaluated over the whole Active Party — the Main and its companions —
  from the highest and lowest active Base Levels, and a new companion gets no exception;
- **the Active Party is ordered configuration** (`ADR-005`): order is position, Slot 1 is the
  Frontline, composition is frozen for a run, and formation edits are refused while an Activity
  runs.

### 4. Open — made ambiguous by this decision, not decided here

| # | Open item | Decided by |
|---|---|---|
| GA-O1 | ~~**Companion lifecycle.** Whether a companion can be dismissed or deleted, with what grace, and what happens to what it holds.~~ | **Resolved 2026-09-25** by GA11: a companion is permanent, and goes only with its whole Game Account (`ADR-024` GD8) |
| GA-O2 | ~~**The Main's deletion and the Game Account.** What happens to the companions while the Main is `PENDING_DELETION` and at its purge; whether the Game Account ends with its Main, or may create a replacement Main — and if it may, whether `ADR-020` §5.1–§5.2's replacement flows apply.~~ | **Resolved 2026-09-25** by `ADR-024`: the Game Account is deleted as a whole; there is no replacement Main, and a new campaign is a new Game Account (GD1, GD7) |
| GA-O3 | **Companion custody.** Whether each companion has its own equipment, Hunt Container Slots, Loot Pouch, Gold Pouch and Store Container, or shares the Main's. | Phase 4 |
| GA-O4 | **Companion Stamina.** Every roster Character had its own Stamina (`ADR-014`). Whether a companion does, or shares the Main's. | Phase 4 |
| GA-O5 | **Companion occupancy.** Whether a companion outside the Active Party may act on its own — Skill Training, for example — while the Main hunts. Different Characters of one account could act concurrently before. | Phase 4 |
| GA-O6 | **How a low-level companion progresses.** The Main is always present, so a Level-250 Main with a new Level-8 companion fails Shared XP eligibility, and XP allocation for a non-eligible formation is already open. Being selected for multiplayer (MP3) is one path; whether there are others is not decided. | Phase 4 |
| GA-O7 | **Companion names.** Whether companions carry player-chosen names, and under what uniqueness. *Narrowed 2026-09-25:* companions carry Character names, globally unique and reserved while their Game Account is pending (`ADR-024` NM1–NM2). Whether a companion's name is chosen by the player, and when it is set, stays open. | Phase 4 |
| GA-O8 | **Which level owns what.** Whether Premium and other entitlements attach to the login identity or to each Game Account, and at which level sessions, the newest-connection rule (`ADR-008`) and the one activity claim sit. Today all of them are per Account, that is per Game Account. | the phase that builds multiple Game Accounts per login |
| GA-O9 | **A second Game Account under the same login.** Whether its Main must play Rookgaard or may skip it, and whether any progress or benefit is shared across one login's Game Accounts. *Resolved in part 2026-09-25:* every Game Account's character begins in Rookgaard, vocationless (RK3), and no campaign, progression, quest, reward-claim, gameplay or economy state is shared (GA10). Still open: whether a later Game Account may skip the guided tutorial — the PLAY / SKIP offer of `TUTORIAL_ROOKGAARD_ROADMAP.md` §2. Whether entitlements are shared is GA-O8. | the tutorial and account-management design |
| GA-O10 | **Owning phase and UX** for creating, listing and switching Game Accounts under one login. *Since 2026-09-25* PRE-4 needs a minimum of it: the Login represented apart from the Game Account, and a way for a Login whose only Game Account was purged to start a new one (`ADR-024` §5). | the PRE-PHASE-4 specification for that minimum; otherwise not assigned |
| GA-O11 | **Game Account names** (GA9). Whether they must be unique, in what scope, and whether a pending Game Account's name is reserved. They are a separate namespace from Character names (`ADR-024` NM4). | with GA-O10 |

## Consequences

**Benefits.**

- One campaign identity. The Main is the character a Game Account is about, and the tutorial and
  the Main slot attach to one thing instead of five. Since the final synchronization the deletion
  lifecycle attaches to the Game Account itself (`ADR-024`).
- Human multiplayer takes one actor per Game Account, so a four-actor personal party can never be
  carried into a shared run as a bloc.
- A change of Main vocation has a clean path — another Game Account — instead of a delete,
  purge and recreate loop.

**Costs.**

- The five-equivalent-Character assumption is written into the design set, the Phase 0B and
  Phase 1 specifications, invariants I1, I1b and I2, and the deletion rules. Each canonical
  statement is corrected now; the historical specifications keep what they built, with a
  supersession note.
- Several companion rules that used to follow from *"it is a Character"* are now open (§4).
- Levelling a companion becomes a design question (GA-O6), because the Main can no longer step out
  of the personal party.

**Constraints created.**

- A Game Account has at most one Main at any instant, and nothing may create a second.
- The personal Active Party always contains its Game Account's Main.
- A multiplayer Activity takes exactly one actor per participating Game Account.
- No document or code may treat a companion as a second Main, or give it deletion or tutorial
  semantics of its own, without a new Product Owner decision.
- No path deletes, dismisses, removes, replaces, rerolls or converts an unlocked companion, and
  none unlocks one backward (GA11).
- Nothing gives the Main or a companion a hidden combat multiplier for being one (GA13).
- Rookgaard is single-player and vocationless: no companion, Main-game Party or co-op reaches it
  (RK2).
- *Account* keeps meaning the Game Account until a phase that builds several Game Accounts per
  login says otherwise.

## Alternatives considered

**Keep five equivalent Characters.** Superseded by the Product Owner.

**Model companions as a second kind of full Character, with their own deletion and tutorial
rules.** Rejected by GA4: that is the equivalence this decision removes.

**Let the personal Active Party join multiplayer as a bloc.** Rejected by MP4. It would make a
shared run a four-actors-per-human run, which is the *"personal Party re-labelled as a large
Party"* that `MULTIPLAYER_ACTIVITIES_FOUNDATION.md` §1 already forbids.

**Change the Main's vocation in place.** Not chosen: GA7 gives the path, and vocation stays
immutable through ordinary play (`DOMAIN_MODEL.md` §5.3).

## Product constraints requiring this architecture

- GA1–GA7, PP1–PP3 and MP1–MP5 — Product Owner, 2026-09-25.
- GA8–GA13 and RK1–RK4 — Product Owner, 2026-09-25, final synchronization.
- The login identity / Game Account separation — delegated by the Product Owner and approved,
  2026-09-25.
- *"A personal Party is never re-labelled as a large Party."* —
  `MULTIPLAYER_ACTIVITIES_FOUNDATION.md` §1.
- One roster member per vocation, Gold-bought unlocks, Level-8 starts and Shared XP eligibility —
  `DECISIONS.md`, carried over (§3).
