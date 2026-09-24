# ADR-020 — Character deletion is a 30-day reversible grace, then a hard purge

**Status:** `ACCEPTED` — the product rule is `LOCKED` by the Product Owner (2026-09-24). The
architecture in this record is the builder's design for that rule and has **not yet been
independently reviewed** (PR #13).
**Supersedes:** [ADR-007](./ADR-007-character-retirement.md), in full.
**Amends:** [ADR-019](./ADR-019-currency-custody-scopes.md) — one guarantee row (§8); the rest of
it stands.
**Owning gate:** PRE-PHASE-4 — [`PHASE_GATES.md`](../../PHASE_GATES.md) § *G4.1*. **Nothing in
this record is implemented.**
**Date:** 2026-09-24

## Context

`ADR-007` made deletion *retirement*: the Character stayed forever as historical and audit
state, its vocation and roster place were freed at once, and its items were to move to an
account-level recovery custody. The Product Owner has superseded that model with a two-stage
lifecycle:

```text
ACTIVE
  └─ deletion requested ─▶ PENDING_DELETION   (30 days)
                              ├─ restored before the deadline ─▶ ACTIVE
                              └─ deadline passes ─▶ final purge ─▶ nothing remains
```

That is the opposite of what the repository encodes today, and the difference is structural,
not a matter of wording:

| Where | What it encodes now |
|---|---|
| `schema.prisma` — `Character.retiredAt` | a retired Character is a row that stays forever |
| I1 — `Character_accountId_vocation_key … WHERE "retiredAt" IS NULL` | a retired Character frees its vocation at once |
| I1b — `Character_accountId_key … WHERE "retiredAt" IS NULL AND "vocation" IS NULL` | a retired Origin Character frees the Origin slot at once |
| `contexts/character/roster.ts` — the name and capacity checks | names and roster places are counted over `retiredAt IS NULL` only, so a name is released the moment its Character retires |
| `ON DELETE RESTRICT` from `CharacterStamina`, `HuntRun`, `ActivityParticipant`, `LedgerEntry`, `CurrencyBalance`, `ItemInstance`, `CharacterContainerSlot`, `CharacterLootPolicy` | nothing can delete a Character row |
| `REVOKE UPDATE, DELETE ON "LedgerEntry"` from the application role | no ledger row is ever deleted (I6) |
| `DOMAIN_MODEL.md` — I12 | *"A Character is never hard-deleted"* |
| `retireCharacter` in `contexts/character/roster.ts` | exported, and **reachable from no API route** — no player can retire a Character today |
| `ADR-007`'s account recovery custody | **never built** — a retired Character still holds its own items and Pouch |

The last two rows matter for migration: no product path has ever produced a retired Character, so
no player holds a recovery promise that this decision could break.

## Decision

### 1. The rule — `LOCKED BY PRODUCT`

| # | Rule |
|---|---|
| L1 | A player-requested Character deletion is **not** immediately destructive. |
| L2 | For exactly 30 days after the request, the Character and everything needed to restore it remain intact. |
| L3 | The player may reverse the deletion during those 30 days and recover the Character. |
| L4 | The Character's name remains reserved during the 30-day grace. |
| L5 | When the 30 days expire, deletion is **final and irreversible**. |
| L6 | The final purge removes the Character row and **all** Character-owned state, value and data (§6). |
| L7 | Nothing Character-owned is transferred to a recovery custody or to the Account Bank at purge. |
| L8 | Character-owned value that still exists at purge time is destroyed with the Character. |
| L9 | After the purge, the name is available for creation again. |
| L10 | No surviving Character record retains the deleted Character as historical or audit state. |
| L11 | Account-owned state is not deleted because a Character is deleted — the Account, its Bank, its entitlements and other account-wide state remain. |
| L12 | No surviving account-wide or shared record retains the deleted Character's identity, name or id for historical convenience. Where account integrity needs a transaction or aggregate to survive, the account-level fact survives **without** the Character's identity. |
| L13 | Append-only and audit guarantees hold throughout ordinary play. The purge is a deliberately destructive lifecycle boundary with its own designed policy, not an exception discovered later. |

These thirteen rules are Global Idle's rule. Nothing further is inferred from how any other game
handles deletion.

### 2. States, transitions and time — architecture

| State | Stored? | Meaning |
|---|---|---|
| `ACTIVE` | yes | the ordinary state, and the only **playable** one |
| `PENDING_DELETION` | yes | requested; frozen (§4); restorable strictly before `purgeAt`. At `purgeAt` it becomes **due for immediate final purge**; a row still present after that is a degraded condition (§7), not a lifecycle state |
| *restored* | no — a transition | `PENDING_DELETION → ACTIVE` |
| *purged* | no — an absence | the row and its closure are gone, and nothing records that it existed (L10) |

| Transition | Who | Precondition | Effect |
|---|---|---|---|
| **request** | the owning Account | `ACTIVE`, and §3's quiescence rule holds | `PENDING_DELETION`; `deletionRequestedAt` and `purgeAt` written |
| **restore** | the owning Account | `PENDING_DELETION` **and** `now < purgeAt` | `ACTIVE`; both timestamps cleared; nothing else written |
| **purge** | the server's purge job, **promptly** once `purgeAt` is reached — **never a client command** | `PENDING_DELETION` **and** `now ≥ purgeAt` | §6's closure deleted, the Character row last, the name released in the same commit |

- **No early purge.** L2 guarantees the whole window, so no command — the player's or an
  operator's — shortens it.
- **A repeated request** for a Character already pending is a no-op that returns the existing
  deadline; it never extends or restarts the window. A request made after a restore starts a new
  30-day window.
- **Time.** `purgeAt = deletionRequestedAt + 30 × 24 h`: 720 hours on the server's authoritative
  clock (the injected clock of `ADR-010`), from the instant the request is accepted. It is fixed
  when written and never recomputed, so a later change to the grace length cannot move a deadline
  a player has already been shown. A client-supplied time is never an input. *Restorable* means
  strictly before `purgeAt`. At `purgeAt` the grace is over and the Character is **due for
  immediate final purge** (§7): it can only be purged, and the purge is attempted then, not at
  some later convenience.
  The 720-hour arithmetic is the builder's reading of "exactly 30 days", **not** a decision: it
  remains an open Product Owner confirmation in [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md). A
  different reading — calendar days in a named time zone, for example — changes this paragraph
  and nothing else.

**Conceptual shape — names illustrative, not chosen:**

```text
Character
  lifecycle            ACTIVE | PENDING_DELETION
  deletionRequestedAt  set by request, cleared by restore
  purgeAt              set by request (deletionRequestedAt + 30 × 24 h), cleared by restore
```

The PRE-4 implementation specification chooses the real columns, subject to three requirements:
one authoritative answer to *"is this Character pending?"*; both timestamps present exactly when
it is pending, enforced by a constraint rather than a convention; and `purgeAt` stored, not
derived.

### 3. When a request is accepted — the quiescence rule — architecture

A deletion request is **refused** while the Character:

- holds an occupancy claim (`ADR-013`) — a Hunt, Skill Training or any later primary action — or
  participates in any non-terminal Activity;
- is a member of the Active Party (Phase 4, `ADR-005`);
- is in a co-op lobby or a frozen plan (Phase 5B);
- is party to any live obligation — items or currency in escrow, an open listing or trade
  (Phase 6), a forge input (Phase 7).

The player ends each one through the path that already exists, then requests again. **Deletion
never ends an Activity by itself**: a deletion-triggered settlement would be a second settlement
trigger — a new place for rewards to be applied twice or not at all. Starting the grace from a
quiescent Character is also what makes L2's *"everything needed to restore it"* exact rather than
approximate.

Only the first bullet exists in code today. Each later bullet is an obligation of the phase that
introduces the system: it adds its condition to this rule when it adds the system.

### 4. During the grace — architecture

A `PENDING_DELETION` Character is **frozen**:

- it takes no part in gameplay: no Activity start, no Game Window, no Active Party membership, no
  Skill Training;
- no command mutates Character-owned state: no item move, equip, use, sale or purchase, no Pouch
  debit or credit, no slot unlock, no loot-policy change;
- no command names it as a destination or counterparty: nothing moves into it from the Depot, the
  Stash or the Bank;
- its owner can still see it, with its deadline and a restore action.

The stored state is therefore untouched between request and restore. What the rules **derive from
time** rather than store — today that is Stamina recovery (`ADR-014`) — continues exactly as it
would for any idle Character, because nothing is written. That is the builder's reading of
*"exact restoration"*, and it is listed for confirmation in
[`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md).

Value a player wants to keep must be moved into Account custody — the Bank, the Depot, the Stash —
**before** the request. During the grace, the only way to reach it is to restore first.

### 5. Name, vocation and roster place

**Name — `LOCKED BY PRODUCT` (L4, L9).** A name stays reserved while its Character row exists, in
either state. Only the purge's successful, atomic deletion of the row releases it — in the same
commit that removes the Character and its closure, and never earlier. If a due purge has not yet
committed, the name stays reserved until it does: that is the degraded condition of §7, and the
reservation exists to keep name uniqueness intact through it, not to extend anything. Once the
purge commits, the name is immediately available again.

Scope is unchanged. Today a name is unique **per account**, checked by `createCharacter` under
the account lock; this decision changes *when* a name is released, not *where* names must be
unique. The check must cover every existing row rather than only playable ones, and enforcing it
with a persistence-level constraint is recommended — the reasoning `DOMAIN_MODEL.md` §5.3 gives
for vocation applies unchanged.

**Vocation, the Origin slot and the roster place — `OPEN`, Product Owner.** L3 promises that a
pending Character can be restored. Every uniqueness resource it held must therefore still be
available at restore time, or the restore has to fail:

| Resource | Invariant | If released when deletion is requested |
|---|---|---|
| its vocation | I1 — one Character per vocation per account | a new Character of that vocation makes the restore violate I1 |
| the Origin slot | I1b — at most one un-vocationalized Origin Character | a new Origin Character makes the restore violate I1b |
| its roster place | I2 — `count ≤ rosterCapacity` | a replacement fills the place, and the restore exceeds capacity |

In each case the restore would have to be refused, which L3 forbids. The **minimal safe
invariant** is therefore: *a `PENDING_DELETION` Character keeps its vocation, its Origin slot and
its roster place until the purge releases them*. It follows that a same-vocation replacement —
or any replacement beyond spare capacity — waits for the purge, and that an account at capacity 1
which deletes its only Character cannot create another for 30 days, although it can restore.

That is the builder's **recommendation, not a decision**. It is recorded in
[`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md) and as gate item G4.1b, and no implementation may
release any of these resources early until the Product Owner has decided it.

**Roster capacity — unchanged.** `rosterCapacity` is Account-owned, bought with Gold, and
monotonic (`DOMAIN_MODEL.md` §5.4). Neither the request nor the purge refunds or reduces it. That
part of `ADR-007` survives, because it never depended on retirement.

### 6. What the purge removes, keeps and scrubs — architecture

Every reference to a Character takes exactly one of four actions:

| Action | Meaning |
|---|---|
| **DELETE-OWNED** | the row is Character-owned state or value; it goes, and any value in it is destroyed (L8) |
| **DELETE-HISTORY** | the row is history whose sole subject is the Character; it goes (L10) |
| **SCRUB** | the row is Account-owned or shared, and it survives; the Character's identity is removed from it, and the non-identifying fact stays (L12) |
| **REFUSE** | a live ownership or escrow obligation exists; the request is refused (§3), and a purge that finds one anyway refuses and raises an alarm |

Account-owned rows that never referenced the Character are **KEEP**, and the purge does not touch
them.

#### 6.1 Every reference in the current schema

| Data | Owner | Action |
|---|---|---|
| `Character` | Character | DELETE-OWNED, **last** — releases the name, and whichever of the vocation, Origin slot and roster place it still holds (§5) |
| `CharacterStamina` | Character | DELETE-OWNED |
| `CharacterLootPolicy` | Character | DELETE-OWNED |
| `CharacterContainerSlot`, bought unlocks included | Character | DELETE-OWNED — the unlock is destroyed; the Gold that bought it stays spent where the ledger recorded it |
| `ItemInstance` with a `characterId` — `EQUIPPED`, `HUNT_CONTAINER`, `CHARACTER_CONTAINER`, `LOOT_POUCH` | Character | DELETE-OWNED — contents before their container, and a slot row before the container installed in it |
| `LedgerEntry`, custody `POUCH` | Character | DELETE-HISTORY — the Pouch's history and its remaining value go together |
| `CurrencyBalance`, custody `POUCH` | Character | DELETE-OWNED — the balance is destroyed (L7, L8) |
| `Activity` with its `SessionBoundActivity`, `SkillTrainingActivity`, `HuntRun` and `ActivityParticipant` rows, where the Character is the only participant | Character | DELETE-HISTORY |
| `SettlementOperation` rows whose id derives from those Activities (`settle:<activityId>:<n>`) | Character | DELETE-HISTORY — those Activities can never settle again, so the guard has nothing left to guard |
| `OccupancyClaim` | Character | cannot exist (§3). A purge that finds one REFUSES: that is an integrity alarm, not a race |
| `IdempotencyRecord` for a command that named the Character | the Account's row, carrying Character identity | DELETE-HISTORY — see §6.3 |
| `LedgerEntry` and `CurrencyBalance`, custody `BANK` | Account | KEEP — a BANK row names no Character by construction (`ADR-019`'s CHECK), and the Bank balance is identical before and after |
| `ItemInstance` in the `DEPOT` (`characterId` null), `StashEntry` | Account | KEEP — anything moved there before the request is the Account's |
| `Account`, `AuthIdentity`, `Entitlement`, `EntitlementAudit`, `rosterCapacity` | Account | KEEP — nothing is refunded |
| `ContentBundle` | content | KEEP — deleting Activities may leave a bundle unreferenced; removing it stays `ADR-016`'s explicit, audited path |
| Redis keys that name the Character | ephemeral | evicted — Redis holds nothing that cannot be rebuilt (`ADR-009`) |

#### 6.2 Future references — the rule each phase inherits

| Data | Phase | Action |
|---|---|---|
| Character skills, and any other Character-specific progression | 4 | DELETE-OWNED |
| Active Party configuration | 4 | nothing to do — a member cannot request deletion (§3) |
| an Activity shared with other Characters of the same account | 4 | SCRUB — its participant row and per-participant state go; the Activity and the other participants' facts stay; nothing records who the missing participant was |
| run replay and debug artefacts | 4 | DELETE-HISTORY for runs it ran alone. A shared run that involved it can no longer be replayed exactly, and that is accepted |
| quest and dungeon progress held by the Character | 5 | DELETE-OWNED; Account-wide unlocks KEEP |
| co-op lobby, frozen plan | 5B | REFUSE |
| completed co-op runs | 5B | SCRUB — other accounts keep their own results; the purged Character is not named |
| listings, escrow, trades and player-to-player transfers in flight | 6 | REFUSE |
| completed trades, price history | 6 | SCRUB — the counterparty keeps the price, the item definition, the time and its own side |
| forge inputs in flight | 7 | REFUSE |
| imbuements and their active-use timers on Character-owned items; Wheel, gems, Skill Tree | 7 | DELETE-OWNED, with the item or the Character they belong to |
| any table not listed here — Bestiary, Charms, outfits and achievements (7A) included | — | its phase specification declares its action; an undeclared reference fails the closure test (§7) |

#### 6.3 Two references that need care

**Idempotency records.** An `IdempotencyRecord` belongs to the Account, its principal, but a record
for a command that named the Character stores a result that can contain that Character's id, and
a fingerprint hashed from a request that named it. `ADR-017` still owes a retention policy, so
today such a record would survive indefinitely. The
implementation must make these records findable — record which Character a command names, or
adopt a retention window shorter than the grace so that none can reach the purge — and the purge
deletes whatever remains. Deleting one reopens its client key, which is harmless: every command
that names a purged Character is refused.

**Operations with a BANK leg and a POUCH leg.** One operation can post to both scopes:
`service.buy` debits the Pouch first and the Bank for the remainder, under one operation id, and
a future deposit or withdrawal is a two-leg transfer. The purge deletes the POUCH legs and keeps
the BANK legs, which are the Account's own record that it paid or received value.

- Reconciliation is per custody scope (`ADR-019`) and is unaffected: each surviving scope still
  equals the sum of its entries.
- A check that an operation's legs balance must be restated, because a surviving BANK leg may have
  lost its counterpart to a purge. Recommended: the purge records, as a non-identifying
  Account-level fact, which operation ids lost legs; a missing leg that is not so recorded stays a
  P1.
- An operation id on a BANK entry must never embed a Character's identity. None does today:
  client-command operation ids are `namespace:account:clientKey`, and the one id that embeds a
  Character — `hunt.death:<characterId>:…` — is POUCH-only and is deleted with it.

### 7. How the purge runs — architecture

- **Atomic.** One transaction per Character is the design target: the closure in §6 and the
  Character row commit together or not at all, so a half-purged Character is not a representable
  state. If measurement shows a closure too large for one transaction, the fallback is a durable
  `PURGING` marker that is terminal for restore, keeps the name reserved, makes every step
  idempotent, and deletes the Character row — releasing the name — only as the final step. A
  Character whose marker is set counts as an overdue purge until that final step commits.
- **Idempotent.** A retry after a crash either finds the Character and completes the purge, or
  finds nothing and does nothing. It can never destroy twice or touch a second Character.
- **Serialised with restore and with creation.** Restore and purge each lock the Character row,
  after the Account row, in the order `DATA_ARCHITECTURE.md` §4 fixes. Each decides against the
  authoritative clock read **after** its lock is held, so exactly one of them wins at the
  deadline. Character creation already locks the Account row, so a name, a vocation or a roster
  place is never observed half-released.
- **Privileged, narrowly.** The application role keeps no `UPDATE` or `DELETE` on the ledger, so
  I6 stays true for all gameplay. The purge runs under a separate capability — a dedicated role
  or a guarded routine — that can delete only rows belonging to a Character whose purge
  preconditions it has verified itself, in the same transaction.
- **Order and foreign keys.** Today's `ON DELETE RESTRICT` relations refuse every deletion. Each
  one gets an explicit policy in the implementation specification: either `RESTRICT` stays as the
  guard against every path except the purge, which deletes children in dependency order, or the
  relation is redesigned. `CASCADE` is acceptable only where every row it can reach is
  Character-owned and covered by the closure test — never into an Account-owned or shared table.
- **Proven complete.** A closure test derives every relation that references `Character` from the
  schema itself and fails when one has no declared action. After a purge, a scan of product
  persistence — PostgreSQL and Redis — finds the Character's id and name in **no** row, JSON and
  text columns included, and every Account-owned row is unchanged apart from the documented
  SCRUBs.
- **Due at the deadline — never early, never deferred.** `purgeAt` is the instant the Character
  becomes **due for immediate final purge**. The purge job attempts it promptly at or after that
  instant; a schedule that routinely leaves due Characters waiting is a defect, not a policy. No
  command — the player's or an operator's — purges early, and none postpones a due purge.
- **When a due purge cannot commit — a degraded condition.** Infrastructure failure, an
  unavailable database, an integrity REFUSE (§6), or any other exceptional condition can stop the
  atomic purge from committing. Until it does:
  - the Character stays **non-playable** — it is still frozen (§4);
  - **restore stays forbidden**, because the grace has expired;
  - the **name stays reserved**, so that name uniqueness is never corrupted by a row that still
    exists;
  - the purge is **retried automatically**, and the overdue Character raises an **operational
    alert**.

  This post-deadline, pre-purge window is a **failure to be cleared**, not a lifecycle state of
  the product. It is never a way to extend the grace, and nothing offers it to a player or an
  operator as an option.
- **One final boundary.** Deleting the data and releasing the name happen in one successful
  commit. Atomicity is never weakened to release a name at the deadline while the Character or any
  part of its closure still exists; once the purge commits, the row and closure are gone and the
  name is immediately reusable within the normal uniqueness scope (§5).
- **Overdue purges are observable.** Operations can always see how many Characters are due but
  not yet purged, and how late the oldest one is (`OPERATIONS_ARCHITECTURE.md` §6). A measurable
  lateness target — how long after `purgeAt` a purge may take before it counts as a breach — is
  chosen **before production** (`PHASE_GATES.md`, pre-launch gate). This record deliberately does
  not invent the number.

### 8. What this changes in other decisions

- **`ADR-019`.** Its guarantee row *"a Character that has carried Gold is never hard-deleted —
  `ON DELETE RESTRICT`"* no longer states a product rule. The foreign key may still refuse every
  path except the purge; how the purge removes the rows it guards is §7's to define.
- **I6, the append-only ledger.** Holds for every path but one: the purge deletes the purged
  Character's POUCH entries. Nothing ever **updates** a ledger row, and no BANK entry is ever
  deleted.
- **I12.** Replaced: *a Character is removed only by its final purge — at or after its deadline,
  atomically, by the purge capability.*
- **I1, I1b and I2.** Their predicates lose `retiredAt`. Which lifecycle states they count is the
  OPEN decision of §5; recommended: every existing Character.
- **Access filters.** Every read or command path that filters `retiredAt IS NULL` becomes
  lifecycle-aware: `ACTIVE` for play, every existing row for uniqueness.

### 9. Migrating from what is implemented

For the PRE-4 implementation, forward-only and additive first (`DATA_ARCHITECTURE.md` §8):

1. add the lifecycle state, both timestamps, the request and restore commands, the purge
   capability and the purge job;
2. switch every `retiredAt` read to the lifecycle-aware predicate;
3. count the rows with `retiredAt` set, and report the number in the implementation PR. No
   product path sets it, so any such row comes from a test or a hand edit. Recommended
   conversion: `PENDING_DELETION`, requested at the migration instant, so that no Character is
   destroyed without a full grace window;
4. rebuild I1 and I1b without `retiredAt`, as the §5 decision dictates;
5. only then remove `retiredAt` and `retireCharacter`;
6. replace the VERIFIED tests that encode retirement — Phase 0B `D5` and `D6`, Phase 1 `D22`'s
   retirement step and `D24`'s filter, Phase 3 `RET1`–`RET2`, and the `retiredAt` assertion in
   `tests/integration/characters.test.ts` — through explicit matrix amendments. A verified test is
   superseded visibly, never deleted quietly;
7. correct the schema, migration-adjacent and code comments that cite `ADR-007`.

No migration rewrites a ledger row, and the purge is not a migration.

## Consequences

**Benefits.**

- The product rule the Product Owner asked for: reversible for 30 days, then genuinely gone.
- Nothing is destroyed by a single click. The grace absorbs mistakes, as retirement tried to,
  without keeping the Character forever.
- The Account's own financial truth is safe by construction: a BANK row never names a Character,
  and no BANK row is ever deleted.

**Costs.**

- **Irreversible loss is now a designed outcome.** After the purge, no support action can recover
  a Character, an item it held or the Gold in its Pouch.
- Ledger history is no longer complete. *"Which Character earned this Gold?"* becomes unanswerable
  once that Character is purged; the Account-level answer — how much the Bank received, when and
  why — survives.
- A shared run that involved a purged Character can no longer be replayed exactly.
- The purge is a new privileged path into data that is otherwise append-only. It needs its own
  role, its own tests and its own review.
- The purge job is an operational commitment: it must run promptly, retry, and be monitored
  against a lateness target, because a due Character that lingers is a visible failure.
- Every future table that references a Character must declare a purge action, and the closure
  test has to be kept honest.

**Constraints created.**

- Exactly one path may hard-delete a Character: the purge, once the deadline has made it due.
- No command shortens the grace or postpones a due purge, and no command reaches a purged
  Character.
- A due purge that has not committed is an alerting condition, retried until it succeeds.
- No Character-owned value moves to the Bank or to any recovery custody at purge.
- A BANK entry never carries a Character's identity, in any column, the operation id included.
- A new reference to `Character` is not mergeable without a declared purge action.

## `ADR-007` assumptions that no longer apply

| `ADR-007` said | Under this decision |
|---|---|
| deletion is retirement | deletion is a 30-day grace, then a hard purge |
| a retired Character keeps its identity and history forever | the purge removes both (L10) |
| its items go to an account-level recovery custody scope | there is no recovery custody: items stay with the Character during the grace and are destroyed at purge (L7, L8) |
| its vocation is freed at retirement | freed at purge; during the grace, `OPEN` (§5) |
| it stops counting against the roster at retirement | stops at purge; during the grace, `OPEN` (§5) |
| roster capacity and the Gold that bought it are not refunded | **still true** — capacity is Account-owned and monotonic |
| the Origin Character may be retired, and the tutorial flag is unaffected | the Origin Character may be deleted like any other, and tutorial completion stays Account-level. What a purged Origin Character means for tutorial replay and the starting grant is `OPEN` |
| reversibility is a deferred parameter | reversibility is `LOCKED`: 30 days |
| no code may hard-delete a Character | exactly one path may: the purge |
| vocation uniqueness is a partial index over non-retired rows | the `retiredAt` predicate goes; the grace-state predicate is `OPEN` (§5) |
| *"which Character earned this gold"* stays answerable for years | answerable only while that Character exists |

## Alternatives considered

**Keep retirement.** Superseded by the Product Owner. It also keeps exactly the eternal
historical row that L10 forbids.

**Delete immediately.** Violates L1–L3.

**Retire, then anonymise forever.** A surviving row whose only purpose is to be the deleted
Character is what L10 forbids, anonymised or not — and while it existed it would keep holding the
name, against L9.

**Move the Pouch to the Bank, or the items to recovery custody, at purge.** Forbidden by L7. It
would also turn deletion into a free way to bank carried Gold.

**`ON DELETE CASCADE` everywhere.** Rejected. It hides the policy inside the schema, it reaches
Account-owned and shared rows the moment one relation is added carelessly, and it cannot express
SCRUB or REFUSE at all. Cascade is acceptable only where the closure test proves that it stays
inside Character-owned data.

**End a live Activity automatically when deletion is requested.** Rejected. A second settlement
trigger is a new place for rewards to be applied twice or not at all; the player ends the Activity
through the path that already exists.

**Keep a tombstone after the purge to hold the name.** Contradicts L9 and L10.

## Product constraints requiring this architecture

- The thirteen rules of §1 — Product Owner, 2026-09-24.
- *"Economy operations must be transactional and auditable."* — `AGENTS.md`
- *"no item duplication"* — `docs/ARCHITECTURE.md`, security baseline
- *"Do not determine tutorial eligibility only by counting existing characters."* —
  `TUTORIAL_ROOKGAARD_ROADMAP.md` §2
