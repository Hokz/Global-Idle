# ADR-024 — Game Account deletion: a 720-hour frozen grace, then a hard purge

**Status:** `ACCEPTED` — the product rules are `LOCKED` by the Product Owner (2026-09-25).
Recorded in the final 2026-09-25 governance synchronization, which follows PR #13 head `fff6faf`.
**Pending independent review.**
**Supersedes, in part:** [ADR-020](./ADR-020-character-deletion-grace-and-purge.md). It replaces
ADR-020's deletion target — a Character, rather than the Game Account — and every rule that
existed because a Character could be purged while its Game Account lived on. That covers G4.1b
(B1–B7), G4.1c (C1–C8), the pre-completion case and its Bootstrap Kit (P1–P9), the public Deleted
List (DH2), the purge manifest's content (DH3), the per-Game-Account name scope (§5) and the open
items DEL-O1 to DEL-O6 (§5.3). §8 goes through them one by one.
**Reuses, by reference:** ADR-020's lifecycle mechanics, applied to the Game Account as §2 states:
T1 and FZ1–FZ6 (§1a), the state machine (§2), the quiescence rule (§3), the freeze (§4), the purge
actions and closure test (§6), how the purge runs (§7), and DH1, DH4 and DH5, restated here (§4).
**Amends:** [ADR-021](./ADR-021-character-bound-consumables-and-store-container.md) — a bound item
is purged with its Game Account. [ADR-022](./ADR-022-game-account-main-character-and-companions.md)
— companions are permanent, and the Login survives a purge.
[ADR-023](./ADR-023-quest-replay-and-one-time-reward-claims.md) — reward claims are purged with
their Game Account.
**Owning gate:** PRE-PHASE-4 — [`PHASE_GATES.md`](../../PHASE_GATES.md) § *G4.1* and § *G4.4*.
**Nothing in this record is implemented.**
**Date:** 2026-09-25

## Context

`ADR-020` (2026-09-24) made deleting a **Character** a 30-day reversible grace — exactly 720 elapsed
hours since 2026-09-25 — followed by a hard purge. It was written for a roster of up to five
equivalent Characters, where one could be deleted while the Account and the others played on. That
shape brought its own rules. A pending Character held its vocation, its roster place and the
Origin slot (G4.1b). Tutorial completion had to outlive the Origin Character (G4.1c). A replacement
Origin Character needed a fresh, non-exploitable Bootstrap Kit (P1–P9).

`ADR-022` then gave every Game Account exactly one Main, with further vocations as companions.
`ADR-020` §5.3 left six questions open. Chief among them: what deleting the Main does to its
companions and its Game Account, and whether a replacement Main could follow. The Product Owner
answered by moving the deletion target. What a player deletes is the **Game Account** — the whole
campaign.

What exists in code today:

- no deletion path. `retireCharacter` exists and no route reaches it (`ADR-020`, *Context*);
- `Account` is the Game Account. `AuthIdentity.accountId` is a required foreign key to it, and
  sign-up creates the two together, so as the schema stands a credential cannot outlive its
  Account row;
- Character names are unique among playable Characters **of one Account**, trimmed and compared
  exactly by an application check under the Account lock (`contexts/character/roster.ts`). No
  database constraint backs it.

## Decision

### 1. The rules — `LOCKED BY PRODUCT` (2026-09-25)

**What is deleted**

| # | Rule |
|---|---|
| GD1 | The deletion target is the **Game Account** — the whole campaign. |
| GD2 | The **Login** survives. Every other Game Account under the same Login is unaffected. |
| GD3 | The lifecycle is `ACTIVE` → `PENDING_DELETION` → exactly **720 elapsed hours** → hard purge, unless the Game Account is restored before then. |
| GD4 | The **whole Game Account** is frozen during the grace. |
| GD5 | The purge removes **all live Game Account state**, as applicable: the Main, every Companion, progression, skills, vocation and campaign state and Party state; equipment and items, containers, Store Containers, and the live state of the Loot Pouch and the Gold Pouch; quest and progression state, reward claims, tutorial and campaign state; and every other live object scoped to the Game Account or to its actors. |
| GD6 | Nothing transfers to another Game Account, and nothing becomes Login-level value. |
| GD7 | A purged Game Account is gone. A new campaign requires a **new Game Account**: nothing creates a replacement Main inside a deleted one. |
| GD8 | A Companion disappears only with its whole Game Account. |

**Every deletion source — one lifecycle**

| # | Rule |
|---|---|
| GD9 | There is **one** deletion lifecycle for every source — a player's request, a rules or moderation action — with the same 720-hour grace and the same purge. |
| GD10 | There is no instant moderation purge, and no second deletion model or bypass. |

**Names**

| # | Rule |
|---|---|
| NM1 | Character names are **globally unique** across the entire game and database. |
| NM2 | While a Game Account is `PENDING_DELETION`, all of its Character names — the Main's and every Companion's — stay globally reserved. Only the successful purge releases them. |
| NM3 | A historical record never reserves a name. |
| NM4 | Game Account display names are a **separate namespace** from Character names. |
| NM5 | NM1 supersedes the per-Game-Account uniqueness that Phase 1 implemented and `ADR-020` §5 kept. |

**The deletion history**

| # | Rule |
|---|---|
| HR1 | There is **no public Deleted List**. |
| HR2 | What a purge leaves is an **internal history record, for support**. |
| HR3 | It may keep the Game Account reference, the deletion and purge dates, the Main's name, vocation and level, each Companion's name, vocation and level, and a broad campaign summary. |
| HR4 | It is not required to record Gold destroyed, Pouch value destroyed, destroyed item value or count, or economy-sink totals. The Pouches' live state is simply purged. |
| HR5 | The record is never live ownership, custody, restoration state, name reservation, reward-claim state or uniqueness state. |

These rules are Global Idle's. Nothing further is inferred from how any other game handles
deletion.

### 2. `ADR-020`'s mechanics, applied to a Game Account — architecture

The lifecycle machinery of `ADR-020` is unchanged. What changes is its subject.

| `ADR-020` | Under this record |
|---|---|
| a Character is marked `PENDING_DELETION`; `deletionRequestedAt` and `purgeAt` are stored (§2) | the **Game Account** is. Its Main and Companions are pending because it is; none has a deletion state of its own. The same three requirements hold: one authoritative answer to *"is it pending?"*, both timestamps present exactly while it is, and `purgeAt` stored rather than derived |
| T1 — exactly 720 elapsed hours on the server clock, `purgeAt` fixed when written (§1a, §2) | unchanged |
| request and restore by *"the owning Account"* (§2) | by the owning **Login**, through the Game Account. Who may start or restore a rules or moderation deletion is DEL-O3 (§9) |
| the quiescence rule (§3) | a request is refused while any actor of the Game Account holds an occupancy claim or is in a non-terminal Activity, a co-op lobby or a frozen plan, and while the Game Account or any actor is party to a live obligation — escrow, listing, trade, forge input — as each system arrives. **Configured** Active Party membership is Game Account state, frozen and purged with the rest: it is not an obligation and does not block a request. That settles the reading `ADR-020` §3 left open for the Main |
| the full freeze (§4, FZ2) | covers everything the Game Account and its actors own — **the Bank, the Depot and the Stash included**. No Activity, Training, XP, Skill progress, Stamina or other elapsed-time recovery, item move or use, currency mutation, quest or reward mutation, companion unlock, Character creation or bound-item grant; no command names the Game Account or one of its actors as a destination or counterparty. Its Login still sees it, with its deadline and a restore action, and keeps playing its other Game Accounts |
| restore returns the state exactly, with no catch-up (FZ3) | the whole Game Account, exactly as it was when the deletion was accepted |
| a failed purge is a degraded, frozen, name-reserving, retried and alerting condition (FZ4, §7) | unchanged, per Game Account |
| the purge is idempotent (FZ5) | unchanged. A retry never touches another Game Account |
| a name is released only by the successful purge (FZ6) | every Character name of the Game Account (NM2) |
| time that runs on the Account — a Premium entitlement's expiry — is not stopped by the grace (§4) | **open.** Which level owns entitlements is GA-O8, and whether a Game-Account-scoped entitlement's time runs during the grace is decided with it (§9) |
| the purge actions — DELETE-OWNED, DELETE-HISTORY, SCRUB, REFUSE, KEEP (§6) | unchanged vocabulary. Inside the Game Account nothing is KEEP (§3) |
| one transaction per Character, or a durable `PURGING` marker (§7) | one transaction per **Game Account** is the design target. The fallback is the same marker, set on the Game Account: terminal for restore, names still reserved, every step idempotent, the Game Account row deleted — and the names released — only in the final step |
| restore, purge and creation serialised by locks (§7) | restore and purge lock the Game Account first, in the order `DATA_ARCHITECTURE.md` §4 fixes. A creation in **any** Game Account must observe a reserved name until the purge that frees it commits (§6) |
| the purge capability; the application role keeps no ledger `UPDATE` or `DELETE` (§7) | unchanged |
| the closure test derived from the schema (§7) | every relation that references the Game Account row or one of its Characters, string-keyed ids included |
| the post-purge scan of live persistence (§7) | finds no live row naming the Game Account, any of its Characters or their names. The internal history record is the one declared exception (HR5) |
| overdue purges observable; the lateness target chosen before production (§7) | unchanged, counted per Game Account |
| migrating from retirement (§9) | still applies, together with §5 and §6 below |

### 3. What the purge removes — architecture

Every reference to the Game Account or to one of its Characters takes one of `ADR-020` §6's
actions. Nothing the Game Account owns is KEEP.

| Data | Action |
|---|---|
| `Account` — the Game Account row | DELETE-OWNED, **last**, in the commit that releases its Characters' names |
| `Character` — the Main and every Companion | DELETE-OWNED, each after its own closure |
| what `ADR-020` §6.1 lists as Character-owned — `CharacterStamina`, `CharacterLootPolicy`, `CharacterContainerSlot`, `ItemInstance` in every Character custody, the POUCH `CurrencyBalance` | DELETE-OWNED |
| `ItemInstance` in the `DEPOT`, `StashEntry` | DELETE-OWNED. They are Game Account custody, and a bound item goes the same way as an unbound one |
| the BANK `CurrencyBalance` | DELETE-OWNED |
| `LedgerEntry`, BANK and POUCH | DELETE-HISTORY. Whether the entries leave the ledger or stay as immutable history outside live state is the PRE-4 specification's choice — the choice `ADR-020` §6.1 gave POUCH entries, now for all of them. Either way no live balance remains, and every surviving custody scope still reconciles |
| `Activity`, `SessionBoundActivity`, `SkillTrainingActivity`, `HuntRun`, `ActivityParticipant`, and the `SettlementOperation` rows that derive from them | DELETE-HISTORY |
| `OccupancyClaim` | cannot exist (quiescence). A purge that finds one REFUSES and raises an alarm |
| `IdempotencyRecord` of the Game Account | DELETE-HISTORY, or kept from ever reaching a purge by a retention window shorter than the grace — the PRE-4 specification's choice, as in `ADR-020` §6.3 |
| `Entitlement` of the Game Account | DELETE-OWNED. Nothing is refunded, and nothing moves to the Login (GD6). An entitlement a later phase attaches to the Login instead (GA-O8) is the Login's, and no Game Account purge touches it |
| `EntitlementAudit` of the Game Account | DELETE-HISTORY, or immutable history outside live state — decided with the ledger's choice above |
| the Login and its `AuthIdentity` rows | **KEEP** (GD2). Today `AuthIdentity` references the Game Account row — §5 |
| `ContentBundle` | KEEP. Removing an unreferenced bundle stays `ADR-016`'s explicit path |
| Redis keys that name the Game Account or one of its Characters | evicted (`ADR-009`) |
| a live cross-account obligation — lobby, frozen plan, escrow, listing, trade, forge input | REFUSE (quiescence) |
| a record shared with another Game Account — a completed co-op run (5B), a completed trade or price history (6) | the other Game Account keeps its own side. Whether the purged one stays named there is the owning phase's declaration: SCRUB, or immutable history outside live state, within HR5 |
| any table added later | its phase declares its action; an undeclared reference fails the closure test |

`ADR-020` §6.3's rule for operations with a BANK and a POUCH leg no longer arises inside one Game
Account: both legs are its own and go together. An operation that spans two Game Accounts — a
trade, from Phase 6 — keeps the other Game Account's leg, and that phase restates the leg-balance
check for it.

### 4. The internal history record — architecture

- **Written by the purge**, inside the same final boundary. No purge commits without its record,
  and no record exists for a purge that did not commit.
- **What it holds**: at most HR3's fields. The PRE-4 specification fixes the exact fields and what
  the *broad campaign summary* contains. The grace is a full freeze, so each level it records is the
  level at the accepted request — one number.
- **What it is not** (HR5): it holds no foreign key that live state depends on, restores nothing,
  reserves no name, takes part in no uniqueness rule and holds no reward-claim state. Nothing in
  gameplay reads it; support does.
- **It is not the proof.** A purge's completeness is shown by the closure test and the post-purge
  scan, which are tests, not by an inventory stored in the record (HR4).
- **Retention and access** — who may read it and for how long — are pre-launch questions
  (`PHASE_GATES.md` § *Pre-launch*).

This supersedes `ADR-020` DH2, the public Deleted List, and DH3, the purge manifest and its
deletion facts. DH1, DH4 and DH5 stand, as HR2, HR3 and HR5, and the record's purpose narrows from
*"audit, moderation and analytics"* to support. DH6 is not a deletion rule: game-wide balance
telemetry belongs to the phases that introduce what it measures, and is unchanged.

### 5. The Login above the Game Account — what the purge needs

- GD2 requires the Login to outlive its Game Account. As the schema stands, `AuthIdentity` holds a
  required foreign key to `Account`, the Game Account row. Purging that row would take the
  credential with it, or be refused.
- **The Login must therefore be represented apart from the Game Account before the purge ships.**
  The credential belongs to the Login, and each Game Account to exactly one Login. How it is
  represented — a principal of its own, a mapping, or another shape — stays the implementing
  phase's choice (`ADR-022` §2).
- A Login whose only Game Account is purged still signs in. How it starts a new one — and, in
  general, how a Login creates, lists and switches Game Accounts — is GA-O10. The PRE-4
  specification states the minimum PRE-4 needs.

### 6. Names — architecture

- **Global uniqueness (NM1)** is enforced at persistence level over every existing Character row,
  a pending Game Account's included — a uniqueness guarantee, never a read-then-check alone.
  `ADR-020` §5 recommended the same for its narrower scope.
- **Release (NM2)**: a name is freed only when the purge that deletes its Character commits. The
  internal history record keeps names without reserving them (NM3).
- **Migration**: today a name is unique only within its Game Account, among playable rows,
  trimmed and compared exactly, and nothing in the database stops two Game Accounts from holding
  the same name. The PRE-4 specification states the comparison the global rule uses, and how rows
  that already collide are found and resolved before the constraint is added.
- **Companions** carry Character names under NM1: they are among the names NM2 reserves. Whether
  a companion's name is chosen by the player, and when it is set, stays Phase 4's (`ADR-022`
  GA-O7).
- **Game Account names** are their own namespace (NM4). Whether they must be unique, in what
  scope, and whether a pending Game Account's name is reserved as well are open (GA-O11).

### 7. What later phases inherit

- **Companions** (Phase 4) are permanent (`ADR-022` GA11). They are frozen with their Game
  Account and purged only with it. No path deletes, dismisses, removes, replaces, rerolls or
  converts one.
- **Character-bound consumables** (`ADR-021`) are purged with the Game Account, like everything
  else it owns. The binding still decides who may use or move them: a Companion never uses the
  Main's bound items.
- **Reward claims** (`ADR-023`) are purged with their Game Account. A new Game Account has its own,
  and no surviving Game Account's claim is re-enabled.
- **Multiplayer** (Phase 5B): a Game Account with an actor in a lobby or a frozen plan cannot be
  put up for deletion, and the others keep their results after a purge.
- **Economy** (Phase 6): live obligations refuse the request, and completed trades keep the
  counterparty's side.
- **Rookgaard**: a Game Account that stays in Rookgaard — one vocationless character, no
  Companions (`ADR-022` RK3) — is deleted the same way.

### 8. What this does to `ADR-020`

| `ADR-020` | Under this record |
|---|---|
| its title and deletion target — a Character (L1–L9, §2) | **superseded**: the target is the Game Account (GD1). L1–L9's guarantees hold for it — not immediately destructive, restorable for exactly 720 hours, names reserved, then final, everything destroyed, nothing moved to a recovery custody or a bank |
| L11 — Account-owned state survives a Character's deletion | **superseded**: the Game Account is what is deleted. Only the Login and its other Game Accounts survive (GD2) |
| L13 | kept |
| T1, FZ1–FZ6 (§1a) | kept, for the Game Account (§2) |
| DH1, DH4, DH5 | kept, restated as HR2, HR3 and HR5 (§4) |
| DH2 — the public Deleted List | **superseded** (HR1) |
| DH3 — the purge manifest and its facts | **superseded** (HR3–HR4) |
| DH6 | unchanged — a game-wide direction, not a deletion rule |
| §3, the quiescence rule | kept; its Active Party bullet is read as §2 above |
| §4, the freeze | kept, over the whole Game Account |
| §5, names unique per Game Account | **superseded** by NM1–NM5 |
| §5, G4.1b — B1–B7 | **superseded.** Nothing inside a pending Game Account can be created or replaced (GD4), and its names are reserved across the whole game (NM2), so a restore cannot conflict. The vocation, roster-place and Origin-slot holds have nothing left to protect |
| §5.1, G4.1c — C1–C8 | **superseded.** No Character is purged while its Game Account lives on. Tutorial completion and reward claims are Game Account state and go with it (GD5); a new campaign is a new Game Account with its own (GD7). C6's purpose holds by construction: nothing survives a purge into another Game Account or the Login (GD6) |
| §5.2 — P1–P9 and the Bootstrap Kit | **superseded.** No replacement Origin Character exists (GD7). The starter gear is ordinary items, and the tutorial potions are Character-bound consumables under `ADR-021` (`DECISIONS.md` § *Tutorial starting items*) |
| §5.3 — DEL-O1 to DEL-O6 | resolved or obsolete, except where §9 narrows DEL-O3 and DEL-O5 |
| §6.1's KEEP rows for Account state; §6.3's surviving BANK legs | **superseded**: the Game Account's state is purged (§3) |
| §6, §7 — actions, closure, how the purge runs | kept, for the Game Account (§2–§3) |
| §8, §9 — invariants and migration | kept where they concern retirement; the invariants are restated in `DOMAIN_MODEL.md` §7 |

How each of `ADR-020`'s open items ends:

| # | Outcome |
|---|---|
| DEL-O1 — the sole Main, its companions and its Game Account | **resolved**: the Game Account is deleted as a whole; there is no replacement Main (GD7); configured Active Party membership does not block a request (§2) |
| DEL-O2 — companion lifecycle | **resolved**: companions are permanent and go only with their Game Account (GD8, `ADR-022` GA11) |
| DEL-O3 — rules and moderation deletion | **resolved in part**: the same lifecycle, grace and purge, with no instant path or bypass (GD9–GD10). Who may start one and who may restore it stays open (§9) |
| DEL-O4 — the starter gear | **resolved**: ordinary low-value items, with no binding and no special custody |
| DEL-O5 — the tutorial consumables | **resolved in part**: a configured action slot uses a bound tutorial potion straight from the Store Container (`ADR-021` U5). Which phase first issues them as bound instances stays open (§9) |
| DEL-O6 — the Deleted List's presentation | **obsolete**: there is no public Deleted List (HR1) |

### 9. Open — not decided here

| # | Open item | Decided by |
|---|---|---|
| DEL-O3 *(narrowed)* | **Moderation authority.** Who may start a rules or moderation deletion, and who may restore one during its grace. The lifecycle itself is locked (GD9–GD10). | the phase that builds moderation tooling. Until then no moderation deletion path exists |
| DEL-O5 *(narrowed)* | **When the tutorial potions become bound.** PRE-4, building `ADR-021`'s foundation behind GBC.1, or the phase that builds the action slots that use them (Phase 4). How they are used is decided (`ADR-021` U5). | the PRE-PHASE-4 specification |
| GA-O8 | Whether an entitlement's time keeps running while its Game Account is pending — decided with the level entitlements attach to. | the phase that builds several Game Accounts per Login |
| GA-O10 | How a Login creates, lists and switches Game Accounts. PRE-4 needs only §5's minimum. | not assigned beyond that minimum |
| GA-O11 | Whether Game Account names are unique, in what scope, and whether a pending Game Account's name is reserved. | with GA-O10 |
| — | The internal history record's exact fields, and its campaign summary. | the PRE-PHASE-4 specification |
| — | Retention and access for that record; backups, logs, and a restore from backup. | the pre-launch gate |

## Consequences

**Benefits.**

- One deletion unit. The Game Account goes as a whole, so the replacement-Main flow, the roster
  holds, tutorial-completion survival and the Bootstrap Kit are no longer needed.
- Companions can never be stranded without their Main, and never deleted on their own.
- Deletion cannot farm anything. Nothing survives a purge into another Game Account or the Login,
  and a new Game Account starts its own campaign.
- Moderation cannot quietly destroy a campaign. Every deletion gets the same 720-hour grace.
- One name belongs to one Character across the whole game, and a pending Game Account's names
  stay held until its purge.

**Costs.**

- **Irreversible loss is larger.** After the purge nothing of the campaign can be recovered — Bank
  and Depot included.
- The Login must be represented apart from the Game Account before the first purge (§5).
- Names become a global resource. Existing per-Game-Account duplicates must be resolved, and a
  popular name is taken for everyone.
- The ledger loses whole Game Accounts, not only POUCH history, so the purge's privileged path
  reaches BANK entries too.
- No public list tells anyone a Character was deleted. Support reads the internal record instead.

**Constraints created.**

- The Game Account is the only deletion unit. No path deletes a Main or a Companion on its own.
- Exactly one path hard-deletes a Game Account: its purge, once due.
- One lifecycle serves every deletion source. No instant purge, no bypass.
- No value of a purged Game Account reaches another Game Account or the Login.
- A pending Game Account's Character names are reserved across the whole game until the purge
  commits. A historical record never reserves one.
- The internal history record never takes part in live ownership, custody, restoration, names,
  claims or uniqueness.
- A new reference to the Game Account or to a Character is not mergeable without a declared
  purge action.

## Alternatives considered

**Keep deleting the Main alone, with its Game Account surviving** (`ADR-020` as amended, DEL-O1).
Superseded by GD1. It needed a replacement-Main flow, roster holds, tutorial-completion survival and
a Bootstrap Kit, and it would have left companions without a Main.

**Let a companion be deleted or dismissed on its own.** Rejected by GD8 and `ADR-022` GA11.

**An instant purge for moderation.** Rejected by GD10.

**A public Deleted List.** Superseded by HR1.

**Names unique per Game Account, or per Login.** Superseded by NM1.

**Move surviving value to the Login or to another Game Account.** Rejected by GD6. It would also
turn deletion into a transfer path.

**Keep the Bank, the Depot or the Stash through the purge.** Rejected by GD5: they are Game Account
state.

**Record the value a purge destroyed.** Not required (HR4). Completeness is proven by tests, and
the economy's own telemetry belongs to the phases that move value.

## Product constraints requiring this architecture

- GD1–GD10, NM1–NM5 and HR1–HR5 — Product Owner, 2026-09-25.
- The lifecycle — reversible for exactly 720 elapsed hours, fully frozen, then final — Product
  Owner, 2026-09-24 and 2026-09-25 (`ADR-020` L1–L9, T1, FZ1–FZ6).
- One Login may own several Game Accounts; companions are permanent — `ADR-022`, Product Owner,
  2026-09-25.
- *"Economy operations must be transactional and auditable."* — `AGENTS.md`
- *"no item duplication"* — `docs/ARCHITECTURE.md`, security baseline.
