# ADR-020 — Character deletion is a 30-day reversible grace, then a hard purge

**Status:** `ACCEPTED` — the product rule is `LOCKED` by the Product Owner (2026-09-24). The
architecture was independently reviewed and accepted at PR #13 head `45d95f6`, and G4.1b (§5) and
G4.1c (§5.1) at `f249771`, and G4.1c's pre-completion case (§5.2) at `395b9ce`. The reconciliation
with `ADR-021` (§4, §6) was validated with PR #13 head `86a7681`.
**Amended 2026-09-25** by Product Owner decisions made after `86a7681` and recorded in the
governance synchronization that follows it: the grace is locked at exactly 720 elapsed hours
(§1a, §2); it is a full freeze with no elapsed-time recovery (§1a, §4); L10 and L12 are superseded
by an immutable historical deletion record and a public Deleted List (§1b, §6, §7); and the Main
Character model (`ADR-022`) leaves named items open (§5.3). The independent review of `e2d0e04`
returned DH6 for a scope correction: game-wide telemetry is not a deletion deliverable (§1b, §7).
**Those amendments are pending independent review.**
**Supersedes:** [ADR-007](./ADR-007-character-retirement.md), in full.
**Amends:** [ADR-019](./ADR-019-currency-custody-scopes.md) — one guarantee row (§8); the rest of
it stands.
**Extended by:** [ADR-021](./ADR-021-character-bound-consumables-and-store-container.md) — a
Character-bound consumable is the Character's wherever it is stored, the Depot included, and the
purge deletes it (§6).
**Read with:** [ADR-022](./ADR-022-game-account-main-character-and-companions.md) — a Game Account
has exactly one Main Character, and further vocations are companions, not Characters of the kind
this record was written for (§5.3).
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
  └─ deletion requested ─▶ PENDING_DELETION   (30 days = exactly 720 elapsed hours)
                              ├─ restored before the deadline ─▶ ACTIVE
                              └─ deadline passes ─▶ final purge ─▶ no live Character remains
```

As first locked, *"nothing remains"* meant no record at all. Since 2026-09-25 the purge removes
the live, restorable Character while an immutable historical deletion record survives (§1b).

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
| L2 | For exactly 30 days after the request, the Character and everything needed to restore it remain intact. *30 days is exactly 720 elapsed hours — T1, 2026-09-25.* |
| L3 | The player may reverse the deletion during those 30 days and recover the Character. |
| L4 | The Character's name remains reserved during the 30-day grace. |
| L5 | When the 30 days expire, deletion is **final and irreversible**. |
| L6 | The final purge removes the Character row and **all** Character-owned state, value and data (§6). |
| L7 | Nothing Character-owned is transferred to a recovery custody or to the Account Bank at purge. |
| L8 | Character-owned value that still exists at purge time is destroyed with the Character. |
| L9 | After the purge, the name is available for creation again. |
| L10 | ~~No surviving Character record retains the deleted Character as historical or audit state.~~ **SUPERSEDED 2026-09-25** by DH1–DH5 (§1b). |
| L11 | Account-owned state is not deleted because a Character is deleted — the Account, its Bank, its entitlements and other account-wide state remain. |
| L12 | ~~No surviving account-wide or shared record retains the deleted Character's identity, name or id for historical convenience. Where account integrity needs a transaction or aggregate to survive, the account-level fact survives **without** the Character's identity.~~ **SUPERSEDED 2026-09-25** by DH1–DH5 (§1b). |
| L13 | Append-only and audit guarantees hold throughout ordinary play. The purge is a deliberately destructive lifecycle boundary with its own designed policy, not an exception discovered later. |

Two further rules were locked by the Product Owner the same day, as gate items G4.1b and G4.1c:
what a pending Character keeps holding (§5), and what survives a purge of the Origin Character
for tutorial completion and one-time grants (§5.1) — including the case of an Origin Character
purged before Rookgaard is complete, and the Bootstrap Kit it introduces (§5.2).

These rules are Global Idle's rule. Nothing further is inferred from how any other game
handles deletion.

### 1a. Time, freeze and restore — `LOCKED` (2026-09-25)

The Product Owner delegated the safety architecture of the grace and approved this direction,
which replaces the builder's readings of *"exactly 30 days"* and *"exact restoration"* recorded
here until then:

| # | Rule |
|---|---|
| T1 | The grace is **exactly 720 elapsed hours** from the accepted deletion request, on the authoritative server clock. `purgeAt` is stored and fixed. There are no time-zone or calendar-day semantics. |
| FZ1 | A deletion copies nothing. The same authoritative gameplay Character stays persisted where it is, marked `PENDING_DELETION`; there is no second, restorable copy. |
| FZ2 | While `PENDING_DELETION`, the Character is **fully frozen**: no Hunt, no Training, no XP, no Skill progression, **no Stamina recovery**, no other elapsed-time gameplay recovery, no item move or use, no currency mutation, no quest mutation, no reward grant and no bound-item grant. |
| FZ3 | Restore is possible only while `now < purgeAt`. It reactivates the same persisted state and returns it **exactly as it was when the deletion was accepted** — no reconstruction from a copied snapshot, no catch-up and no offline recovery for the pending time. |
| FZ4 | At `now ≥ purgeAt` restore is forbidden and the purge is immediately due. A failed purge is a degraded, frozen condition — never an extension. The name stays reserved until the purge succeeds; retry is automatic, and the condition is visible and alerting. |
| FZ5 | The purge is idempotent. A retry cannot double-settle, double-delete value, re-grant, refund or duplicate anything. After a successful purge the gameplay state cannot be restored. |
| FZ6 | The name is released only by the successful final purge, and may be reused afterwards. A historical deletion record never reserves it. |

### 1b. Deletion history, the public Deleted List and analytics — `LOCKED` (2026-09-25)

L10 and L12 required the purge to leave no identity behind. The Product Owner superseded that on
2026-09-25:

| # | Rule |
|---|---|
| DH1 | A successful purge removes the **live, restorable** gameplay Character. An **immutable historical deletion record** survives it, for audit, moderation and analytics, and can never restore gameplay. |
| DH2 | A **public Deleted List** shows the former Character's name, its vocation, its level at the deletion/purge snapshot, the deletion/purge date, and a **broad reason category** that tells a voluntary deletion from a rules or moderation deletion. Detailed internal moderation reason codes and details are **not** automatically public. |
| DH3 | The internal deletion audit keeps enough immutable history to answer *what was deleted*, and to support anti-duplication, operations and balance analytics — preferably a **purge manifest** (a deletion snapshot) plus analytics facts, never old live gameplay rows left restorable. |
| DH4 | Historical records **may keep identifying fields** internally: the Product Owner asked for named history. |
| DH5 | Historical records **never** take part in live ownership or custody, or in any gameplay uniqueness constraint. |
| DH6 | Analytics are preserved or collected for XP production, hunt efficiency, loot and drop generation, item creation and destruction, deleted Characters, and balance analysis. *Scope, clarified after the independent review of `e2d0e04`:* this is a **game-wide direction**, not a deletion deliverable. Each gameplay or economy phase records the telemetry it introduces, and later balance and analytics work consumes it. The deletion lifecycle owns only its own facts — the historical record, the purge manifest and the Deleted List (DH1–DH3) — and a purge must not corrupt durable audit or analytics data that already exists (§6, §7). |

Because the grace is a full freeze (FZ2), a Character's level cannot change between the deletion
request and the purge, so the Deleted List's *level at the deletion/purge snapshot* is one number.

### 2. States, transitions and time — architecture

| State | Stored? | Meaning |
|---|---|---|
| `ACTIVE` | yes | the ordinary state, and the only **playable** one |
| `PENDING_DELETION` | yes | requested; frozen (§4); restorable strictly before `purgeAt`. At `purgeAt` it becomes **due for immediate final purge**; a row still present after that is a degraded condition (§7), not a lifecycle state |
| *restored* | no — a transition | `PENDING_DELETION → ACTIVE` |
| *purged* | no — an absence | the live row and its closure are gone. Only the immutable historical deletion record remains, outside every live ownership, custody and uniqueness rule (DH1–DH5) |

| Transition | Who | Precondition | Effect |
|---|---|---|---|
| **request** | the owning Account | `ACTIVE`, and §3's quiescence rule holds | `PENDING_DELETION`; `deletionRequestedAt` and `purgeAt` written |
| **restore** | the owning Account | `PENDING_DELETION` **and** `now < purgeAt` | `ACTIVE`; both timestamps cleared; the frozen state resumes from the restore instant, with nothing credited for the pending time (§4, FZ3) |
| **purge** | the server's purge job, **promptly** once `purgeAt` is reached — **never a client command** | `PENDING_DELETION` **and** `now ≥ purgeAt` | the historical deletion record written, §6's closure deleted, the Character row last, the name released in the same commit (§7) |

- **No early purge.** L2 guarantees the whole window, so no command — the player's or an
  operator's — shortens it.
- **A repeated request** for a Character already pending is a no-op that returns the existing
  deadline; it never extends or restarts the window. A request made after a restore starts a new
  30-day window.
- **Time — `LOCKED` (T1, 2026-09-25).** `purgeAt = deletionRequestedAt + 720 h`: exactly 720
  elapsed hours on the server's authoritative clock (the injected clock of `ADR-010`), from the
  instant the request is accepted. There are no time-zone or calendar-day semantics. It is fixed
  when written and never recomputed, so a later change to the grace length cannot move a deadline
  a player has already been shown. A client-supplied time is never an input. *Restorable* means
  strictly before `purgeAt`. At `purgeAt` the grace is over and the Character is **due for
  immediate final purge** (§7): it can only be purged, and the purge is attempted then, not at
  some later convenience. Showing the deadline in a player's local time is presentation; it never
  moves `purgeAt`.

**Conceptual shape — names illustrative, not chosen:**

```text
Character
  lifecycle            ACTIVE | PENDING_DELETION
  deletionRequestedAt  set by request, cleared by restore
  purgeAt              set by request (deletionRequestedAt + 720 h), cleared by restore
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

**The Active Party bullet under `ADR-022`.** It was written when any Character could leave the
personal party. The Main Character cannot — it is always present (`ADR-022` PP2) — so read
literally, this bullet would make the Main undeletable. A running Activity is always refused by the
first bullet. How configured membership counts for the Main, and what happens to its companions
(GA-O2), is restated by the PRE-4 specification (§5.3).

### 4. During the grace — architecture

A `PENDING_DELETION` Character is **fully frozen** (FZ2):

- it takes no part in gameplay: no Activity start, no Game Window, no Active Party membership, no
  Skill Training;
- no command mutates Character-owned state: no item move, equip, use, sale or purchase, no Pouch
  debit or credit, no slot unlock, no loot-policy change;
- no command names it as a destination or counterparty: nothing moves into it from the Depot, the
  Stash or the Bank;
- nothing bound to it moves or is used: no Store Container ↔ Depot move, no use of a
  Character-bound consumable wherever it is stored, and no new Character-bound grant that targets
  it (`ADR-021` §6) — once that system exists;
- no quest or reward state of the Character advances, and no reward is granted to it;
- nothing derived from elapsed time accrues to it: no Stamina recovery and no other elapsed-time
  gameplay recovery;
- its owner can still see it, with its deadline and a restore action.

**Nothing time-derived runs during the grace — `LOCKED` (FZ2, FZ3, 2026-09-25).** This replaces
the builder's earlier reading, under which Stamina recovery kept running as for an idle Character.
A restore returns the gameplay state exactly as it was when the deletion was accepted, with no
catch-up for the pending time. Three consequences for the implementation:

- **settle up to the request, then freeze.** Time-derived state is brought up to the instant the
  request is accepted, in the request's own transaction, so that *"as it was when the deletion was
  accepted"* is a stored fact rather than a derivation;
- **no read settles a pending Character.** Stamina today is a stored position that every read
  moves forward (`contexts/character/stamina/settlement.ts`, *"advance on read"*), and the roster
  and Character views read it (`apps/api/src/game/views.ts`). For a `PENDING_DELETION` Character
  such a read must neither write nor credit anything;
- **resume from the restore instant.** A restore credits nothing for the pending interval: a
  time-derived rule resumes from the moment the Character is `ACTIVE` again. How that is expressed
  — moving a marker, or excluding the interval — is the PRE-4 specification's choice.

Time that runs on the **Account** rather than on the Character — a Premium entitlement's expiry,
for example — is not Character state, and the grace does not stop it.

Value a player wants to keep must be moved into Account custody — the Bank, the Depot, the Stash —
**before** the request. During the grace, the only way to reach it is to restore first. A
Character-bound consumable cannot be kept that way: it stays its Character's in the Depot too, and
is purged with it (`ADR-021`).

### 5. Name, vocation and roster place

**Name — `LOCKED BY PRODUCT` (L4, L9).** A name stays reserved while its Character row exists, in
either state. Only the purge's successful, atomic deletion of the row releases it — in the same
commit that removes the Character and its closure, and never earlier. If a due purge has not yet
committed, the name stays reserved until it does: that is the degraded condition of §7, and the
reservation exists to keep name uniqueness intact through it, not to extend anything. Once the
purge commits, the name is immediately available again. A historical deletion record, and the
public Deleted List built from it, never reserve a name (FZ6, DH5).

Scope is unchanged. Today a name is unique **per account** — per Game Account (`ADR-022` §2) —
checked by `createCharacter` under the account lock; this decision changes *when* a name is
released, not *where* names must be unique. The check must cover every existing row rather than
only playable ones, and enforcing it with a persistence-level constraint is recommended — the
reasoning `DOMAIN_MODEL.md` §5.3 gives for vocation applies unchanged. Because the Deleted List
shows names publicly, two Game Accounts may each show a Character of the same name there; whether
names should instead be unique more widely stays a separate Product Owner decision
([`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md)).

**Vocation, the Origin slot and the roster place — `LOCKED BY PRODUCT` (G4.1b, 2026-09-24).** A
`PENDING_DELETION` Character keeps every uniqueness and capacity resource that its guaranteed
restoration needs, until the final purge commits:

| # | Rule |
|---|---|
| B1 | The pending Character continues to count against `rosterCapacity`. |
| B2 | Its vocation remains reserved. |
| B3 | If it is the Origin Character, the Origin slot (I1b) remains reserved. |
| B4 | The player cannot create a replacement Character that would consume any of those held resources. |
| B5 | Those resources are released **only** by the successful final purge — in the same atomic commit that deletes the Character and releases its name (§7). |
| B6 | A restore before the deadline therefore never depends on freeing or reclaiming a roster place, a vocation or the Origin slot, and can never fail because the player created a replacement. |
| B7 | The name follows the rule above, unchanged: released only by the successful final purge. |

This is exactly the resource set that restoration depends on. Releasing any one of them early
would let a replacement take it, and the restore would then break an invariant:

| Resource | Invariant it protects | What an early release would have broken |
|---|---|---|
| its roster place | I2 — `count ≤ rosterCapacity` | a replacement fills the place, and the restore exceeds capacity |
| its vocation | I1 — one Character per vocation per account | a new Character of that vocation makes the restore duplicate it |
| the Origin slot | I1b — at most one un-vocationalized Origin Character | a new Origin Character makes the restore create a second one |

Consequences, all intended:

- an account at roster capacity 1 that deletes its only Character cannot create another during
  the 30-day grace. It can restore the pending one at any time before the deadline;
- a same-vocation replacement cannot be created until the purge;
- if the pending Character is the Origin Character, a second Origin Character cannot be created
  until the purge;
- a replacement that consumes none of the held resources — another vocation, within spare
  capacity — is unaffected by this rule.

I1, I1b and I2 therefore count **every existing Character**, `PENDING_DELETION` included (§8).

**Roster capacity — unchanged.** `rosterCapacity` is Account-owned, bought with Gold, and
monotonic (`DOMAIN_MODEL.md` §5.4). Neither the request nor the purge refunds or reduces it. That
part of `ADR-007` survives, because it never depended on retirement.

#### 5.1 Tutorial completion and one-time grants — `LOCKED BY PRODUCT` (G4.1c, 2026-09-24)

Tutorial completion belongs to the **Account**, not to the lifetime of the Origin Character:

| # | Rule |
|---|---|
| C1 | Completing the initial Rookgaard tutorial journey marks the **account** as having completed it. |
| C2 | Deleting or permanently purging the Origin Character does **not** reset that account-level state. |
| C3 | Once the account has completed Rookgaard, creating another Character after a purge does **not** restart the first-character tutorial automatically. |
| C4 | That Character follows the normal later-character creation flow the project already defines (`DECISIONS.md` § *Party and character roster*): it starts at Base Level 8, skips Rookgaard, and enters the post-Rookgaard game state. *That section is § Game Account, Main Character and companions since 2026-09-25; what C4 now depends on is §5.3.* |
| C5 | One-time account or tutorial starting grants are **not** awarded again merely because the Origin Character was deleted or purged and another Character was created. |
| C6 | *Delete → purge → recreate* cannot be used to farm starting items, Gold, containers, entitlements, tutorial rewards or any other one-time account grant. |
| C7 | Character-specific starting state that is legitimately part of the normal Level-8 later-character creation flow may still be granted by that flow. It is not a one-time account or tutorial grant, and the two are never conflated. |
| C8 | The Origin Character is historical only as a role while it exists. After its purge there is no residual Character record (L10). The account-level tutorial-completion fact is the only thing that survives for this purpose. *Read since 2026-09-25: no **live** Character record remains. The historical deletion record of DH1 is history, never a Character, and plays no part in tutorial routing.* |

**What the architecture must provide** (PRE-4; none of it exists yet):

- an **Account-owned tutorial-completion fact** — `TUTORIAL_ROOKGAARD_ROADMAP.md` §2 names it
  `tutorialCompleted` and `tutorialVersionCompleted`, and §37 updates it when Rookgaard ends,
  after the vocation is chosen. It is Account state (L11): no purge ever touches it (§6.2);
- **Account-owned state for one-time Tutorial Rewards**, wherever a reward is defined as
  one-time. The Character that earned such a reward may be purged, so only the Account can
  remember it; the state names rewards, never a Character. None is needed yet, because no
  Tutorial Reward exists in code (§5.2);
- **Character creation routed on the completion fact**, never on a count of existing Characters
  (§2 of the tutorial roadmap already forbids that): an account that has completed Rookgaard
  creates through the later-character path only, and one that has not creates a new Origin
  Character (§5.2).

The current starting grant is **not** a one-time grant. §5.2 classifies it: its items are the
Bootstrap Kit, which a new pre-completion Origin Character receives again, bound to that
Character.

#### 5.2 Before Rookgaard is complete — the Bootstrap Kit — `LOCKED BY PRODUCT` (G4.1c, 2026-09-24)

The one case C1–C8 did not state — an Origin Character permanently purged **before** the account
has ever completed Rookgaard — is decided:

| # | Rule |
|---|---|
| P1 | The next Character created is a **new Origin Character**. |
| P2 | It starts at Base Level 1. |
| P3 | It must complete the mandatory Rookgaard tutorial journey. |
| P4 | It receives a fresh **Bootstrap Kit**, sufficient to make the tutorial playable. |
| P5 | The Bootstrap Kit is **not** a one-time Account reward. |
| P6 | It may be issued again to a new pre-completion Origin Character after the previous Origin Character was permanently purged. |
| P7 | Its items are non-exploitable. They cannot be moved to the Depot or the Stash, transferred to another Character, traded or listed, sold or converted into Gold or any other Account-wide value, or used to generate durable Account-wide rewards or value outside the tutorial flow. |
| P8 | If that Origin Character is later purged, its Bootstrap Kit is purged with it. |
| P9 | The replacement Origin Character receives a new, clean Bootstrap Kit, so the tutorial stays playable. |

**Two concepts, never conflated:**

| | Bootstrap Kit | Tutorial Rewards |
|---|---|---|
| Purpose | make the mandatory Level-1 tutorial playable | reward progression and completion |
| Governed by | the Character it was issued to | Account-level completion and reward state |
| Issued again? | yes — to each new pre-completion Origin Character (P6, P9) | no — one-time where defined as one-time, and never reissued because a Character was deleted or purged |
| Can it leave the Character or become value? | never (P7) | as the reward's own definition allows |
| At the purge | destroyed with its Character (P8) | the Account's reward state survives (L11); an item the reward gave the Character is destroyed with it, like everything the Character owned (L8) |

**The locked flow:**

```text
Case 1 — the Account has NOT completed Rookgaard
  Origin purged
  -> new Origin Character, Base Level 1
  -> Rookgaard mandatory
  -> fresh Bootstrap Kit
  -> no replay of any already-consumed one-time Account reward

Case 2 — the Account HAS completed Rookgaard
  Origin or later Character purged
  -> the next Character follows the later-character flow
  -> Base Level 8, skips Rookgaard
  -> only legitimate Character-specific Level-8 starting state
  -> no one-time Account or tutorial reward repeated
```

**Why issuing the kit again is not farming.** C6 forbids farming starting items and containers
through *delete → purge → recreate*. The Bootstrap Kit does not break it: no kit item can ever
leave its Character or become value (P7), and every kit is destroyed with its Character (P8).
However many cycles run, the Account ends with nothing it did not already have.

**What the architecture must provide** (PRE-4; none of it exists yet):

- **a binding on the instance, not the definition.** The kit is made of ordinary item
  definitions: the same backpack and small health potions the Rookgaard counter sells, and the
  same dagger and armour that other sources may give. Binding a definition would bind every copy.
  A kit item carries its binding on its own `ItemInstance`, set when the kit is issued and never
  cleared by any command. This is not the Character-bound consumable binding of `ADR-021`, whose
  items live in the Store Container or the Depot; the two are kept distinct (`ADR-021` §7).
  *Since 2026-09-25 the kit's utility consumables are Character-bound consumables under `ADR-021`
  (§5.3), so this instance binding in gameplay custody concerns the kit's gear — and how that gear
  is represented is open (§5.3);*
- **enforcement in the domain, on every path.** Every command that moves, stows, transfers,
  sells, lists, trades or converts an item refuses a bound instance server-side, whatever the
  client shows. Today those paths are the move to the Depot, the Stash deposit, and the counter
  sale, whose proceeds go straight to the Bank;
- **no mixing.** A bound instance never merges with an unbound one: a stack is wholly Bootstrap
  Kit or not at all. A bought potion never becomes bound, and a kit potion never becomes free by
  joining a bought stack;
- **no leak through what an item holds or produces.** Loot a kit container holds is ordinary
  loot, not kit. Consuming a kit potion in play is the tutorial flow, and nothing it yields may be
  value. Every future system that consumes, transforms, upgrades, lists or trades items — the
  Market (Phase 6), the Forge and imbuement (Phase 7) — refuses a bound instance, or keeps what it
  produces bound to the same Character;
- **the purge destroys it.** A bound instance can only be in its Character's own custody, so the
  DELETE-OWNED of Character-owned `ItemInstance` rows (§6.1) always reaches it;
- **issued on one path only.** Creation issues a kit on the pre-completion Origin path, never on
  the later-character path (Case 2).

**The current starting grant, classified.** `starting-grant.origin.rookgaard` (content label
*"Rookgaard tutorial grant"*) is the only grant in code. It is applied to every Character, because
every Character is an Origin Character today. It credits no Gold and no entitlement.

| Item | Qty | Why it is there | Needed to make Rookgaard playable? | Value and escape paths today | Classification |
|---|---|---|---|---|---|
| leather helmet, coat, leather legs, leather boots | 1 each | Canary's own pre-vocation kit: `addFirstItems` in `dawnport_vocation_trial.lua` gives exactly these four to a vocation-less Character (Phase 3 source map §11) | they are the Character's armour 4 in every Rookgaard fight; not measured on their own | not sellable, not stash-eligible; each can be moved to the Depot | **Bootstrap Kit** — starter gear; its representation is open (§5.3) |
| dagger | 1 | a Global Idle addition: with fists a Level-1 Character loses 88% of its fights against a Rat, and with the dagger it wins them all (Phase 2 source map §4) | **yes — measured** | its definition is `sellable`, but no current counter buys it; it can be moved to the Depot | **Bootstrap Kit** — starter gear; its representation is open (§5.3) |
| backpack | 1 | a Global Idle addition: without a container, nothing carries loot (Phase 3 source map §11) | **yes** | the counter sells the same backpack for 10 Gold; it can be moved to the Depot once empty | **Bootstrap Kit** — starter gear; its representation is open (§5.3) |
| small health potion | 20 | a Global Idle addition, inherited from Phase 2's temporary tutorial profile (`supply { charges 20 }`). Canary's own pre-vocation kit has none; the same file gives ten at the Knight trial, after a vocation is chosen (Phase 3 source map §11). No document records why the pre-vocation kit needs them | **not established** | the counter sells the same potion for 20 Gold — 400 Gold for the grant; stash-eligible and stackable, so it can reach the Stash today and would merge with bought potions | **decided 2026-09-25: a tutorial utility consumable, Character-bound under `ADR-021`** (§5.3). The direction is 20 Health **and** 20 Mana potions, and neither quantity is final while balance is calibrated. The content still grants 20 small health potions and no mana potion |

Every Character is also created with its own starting structure — Stamina at maximum, five Hunt
Container Slots with slot 1 unlocked, a default loot policy. That is Character-specific starting
state of every creation: neither kit nor reward, and destroyed with the Character.

**The two points flagged here until 2026-09-25.** Whether the 20 small health potions were part of
the Bootstrap Kit or a Tutorial Reward is decided: tutorial utility consumables — Health and Mana
potions — are **Character-bound** and use the Store Container model of `ADR-021`, so they are not a
Tutorial Reward, and their binding is `ADR-021`'s: permanent, never removed. Whether the kit's
*gear* binding ends when Rookgaard is complete is no longer a separate question: how that gear is
represented at all is open (§5.3). Both are settled before the kit is implemented
(`PHASE_GATES.md` § *G4.1*).

**No Tutorial Reward exists in code.** The tutorial's rewards — the guaranteed tutorial Treasure
Chest and its Doublet (`TUTORIAL_ROOKGAARD_ROADMAP.md` §18–§19) — are design only. The Doublet
itself is an ordinary item, never Character-bound (`ADR-023` QR8). Which tutorial rewards — the
chest included — are one-time Tutorial Rewards, never replayed for a replacement Origin
Character, is decided with their reward tables (§43 of that document). Whichever is one-time is
claimed once per Game Account (`ADR-023` §2).

**Kit items that already exist.** No `ItemInstance` records where it came from. A kit backpack is
indistinguishable from one bought at the counter, and kit potions merge with bought ones. The PRE-4
specification states how items issued before the binding existed are identified and bound, or
flags the ones that cannot be.

#### 5.3 The Main Character model (`ADR-022`) — what it changes here, and what is open

Everything above §5.3 was written for a roster of up to five equivalent Characters. Since
2026-09-25 a Game Account has exactly one **Main Character**, and further vocations are
**companions**, which are not account-lifecycle Characters of the Main's kind (`ADR-022`). *Origin
Character* here means the Main before it completes Rookgaard, and *the Account* means the Game
Account.

**What reads the same for the Main:**

- the whole lifecycle — request, freeze, restore, purge, history (§1–§4, §6–§7);
- G4.1b (B1–B7): a pending Main is still its Game Account's Main. Its name, its vocation and its
  Main slot — the *"Origin slot"* of B3 — stay reserved, nothing can replace it, only the successful
  purge releases them, and a restore never conflicts;
- C1, C2 and C5–C8: tutorial completion and one-time reward state belong to the Game Account, and
  no deletion or purge resets them or replays a one-time reward;
- the Bootstrap Kit's purpose and its non-exploitability (P4, P5, P7, P8). For the tutorial's
  consumables, S6 makes `ADR-021`'s custody the rule: they may rest in the Depot, still bound to
  their Character, and never reach the Stash, another Character, a market, a trade, a sale or any
  conversion into value (`ADR-021` G1–G3, X5–X6). P7's *"cannot be moved to the Depot"* therefore
  concerns the kit's gear, whose representation is open (DEL-O4).

**What depends on an open question.** C3–C4 and P1–P3, P6 and P9 describe *"the next Character
created"* after a purge. Under `ADR-022` that can only be a **replacement Main** in the same Game
Account, and whether one may exist at all is open (GA-O2). If it may, those rules say how it
starts; if not, they have nothing to apply to.

**Open — the PRE-4 specification settles these, with Product Owner confirmation, before the purge
is built:**

| # | Open item |
|---|---|
| DEL-O1 | **The sole Main and its Game Account** (`ADR-022` GA-O2): what happens to the companions while the Main is `PENDING_DELETION` and at its purge; whether the Game Account ends with its Main or may create a replacement Main; and how configured Active Party membership counts in the quiescence rule (§3). |
| DEL-O2 | **Companion lifecycle** (`ADR-022` GA-O1): whether a companion can be deleted or dismissed on its own, and under which of these rules. |
| DEL-O3 | **Rules and moderation deletion** (DH2 names it as a reason category): whether it takes the same 720-hour grace and restore path, and who may restore. |
| DEL-O4 | **The starter gear.** The Bootstrap Kit's armour, dagger and backpack must be equipped and used in Rookgaard. `ADR-021`'s custody — consumables only, Store Container ↔ Depot only — cannot hold equipped gear, and the Product Owner has not chosen how starter gear is represented. It is **not** forced into `ADR-021`'s model, and no path is invented here. |
| DEL-O5 | **The tutorial consumables' sequencing.** They are Character-bound consumables (`ADR-021`), which the BOUND-CONSUMABLE gate (GBC.1) must precede, while G4.1c ships the Bootstrap Kit with the purge. Whether PRE-4 builds `ADR-021`'s foundation for them, or the starting grant changes shape until GBC.1's phase, is open — and so is how a Hunt drinks a potion held in the Store Container, which is `ADR-021` U4. |
| DEL-O6 | **The public Deleted List's presentation**: which of the deletion or purge date it shows, and the reason categories' wording. |

### 6. What the purge removes, keeps and scrubs — architecture

**Since 2026-09-25 (DH1–DH5).** The actions below say what leaves **live** product persistence. What
leaves it is not forgotten: the purge also records the immutable historical deletion record — a
purge manifest (deletion snapshot) and its deletion-specific facts (DH3) — and the PRE-4
specification defines its shape. It is not a general telemetry platform: the game-wide balance
telemetry of DH6 belongs to the phases that introduce what it measures. Recording the record
atomically with the purge is recommended, so that no purge commits without its record and no
record exists for a purge that did not commit. SCRUB is no longer mandatory: L12 is superseded, so
a phase may keep a purged Character's identity in shared history, provided nothing in it takes
part in live ownership, custody or uniqueness (DH5).

Every reference to a Character takes exactly one of four actions:

| Action | Meaning |
|---|---|
| **DELETE-OWNED** | the row is Character-owned state or value; it leaves live persistence, and any value in it is destroyed (L8) |
| **DELETE-HISTORY** | the row is live history whose sole subject is the Character; it leaves live persistence. Its facts may live on in the historical deletion record (DH3) |
| **SCRUB** | the row is Account-owned or shared, and it survives with the Character's identity removed. **Optional since 2026-09-25** (L12 superseded): the owning phase may keep the identity instead, within DH5 |
| **REFUSE** | a live ownership or escrow obligation exists; the request is refused (§3), and a purge that finds one anyway refuses and raises an alarm |

Account-owned rows that never referenced the Character are **KEEP**, and the purge does not touch
them. Ownership follows the binding as well as the custody: an item bound to the Character is the
Character's even when it is stored in Account custody such as the Depot (`ADR-021` §6).

#### 6.1 Every reference in the current schema

| Data | Owner | Action |
|---|---|---|
| `Character` | Character | DELETE-OWNED, **last** — releases, in this same commit, the name, the vocation, the Origin slot if it is the Origin Character — the Main slot, under `ADR-022` — and its roster place (§5) |
| `CharacterStamina` | Character | DELETE-OWNED |
| `CharacterLootPolicy` | Character | DELETE-OWNED |
| `CharacterContainerSlot`, bought unlocks included | Character | DELETE-OWNED — the unlock is destroyed; the Gold that bought it stays spent where the ledger recorded it |
| `ItemInstance` with a `characterId` — `EQUIPPED`, `HUNT_CONTAINER`, `CHARACTER_CONTAINER`, `LOOT_POUCH` | Character | DELETE-OWNED — contents before their container, and a slot row before the container installed in it. Every Bootstrap Kit instance is here, because it can never be anywhere else (§5.2) |
| `LedgerEntry`, custody `POUCH` | Character | DELETE-HISTORY — the Pouch's history and its remaining value go together. Since 2026-09-25 its facts may survive in the historical deletion record (DH3); whether the entries themselves leave the ledger or stay as immutable history outside live custody is the PRE-4 specification's choice. Either way no live POUCH balance remains and reconciliation stays exact |
| `CurrencyBalance`, custody `POUCH` | Character | DELETE-OWNED — the balance is destroyed (L7, L8) |
| `Activity` with its `SessionBoundActivity`, `SkillTrainingActivity`, `HuntRun` and `ActivityParticipant` rows, where the Character is the only participant | Character | DELETE-HISTORY |
| `SettlementOperation` rows whose id derives from those Activities (`settle:<activityId>:<n>`) | Character | DELETE-HISTORY — those Activities can never settle again, so the guard has nothing left to guard |
| `OccupancyClaim` | Character | cannot exist (§3). A purge that finds one REFUSES: that is an integrity alarm, not a race |
| `IdempotencyRecord` for a command that named the Character | the Account's row, carrying Character identity | DELETE-HISTORY — see §6.3 |
| `LedgerEntry` and `CurrencyBalance`, custody `BANK` | Account | KEEP — a BANK row names no Character by construction (`ADR-019`'s CHECK), and the Bank balance is identical before and after |
| unbound `ItemInstance` in the `DEPOT` (`characterId` null), `StashEntry` | Account | KEEP — anything unbound moved there before the request is the Account's. No bound item exists today; once one does, a Depot item bound to the Character is not KEEP (§6.2) |
| `Account`, `AuthIdentity`, `Entitlement`, `EntitlementAudit`, `rosterCapacity` | Account | KEEP — nothing is refunded |
| `ContentBundle` | content | KEEP — deleting Activities may leave a bundle unreferenced; removing it stays `ADR-016`'s explicit, audited path |
| Redis keys that name the Character | ephemeral | evicted — Redis holds nothing that cannot be rebuilt (`ADR-009`) |

#### 6.2 Future references — the rule each phase inherits

| Data | Phase | Action |
|---|---|---|
| the Account's tutorial-completion fact, and its state for one-time Tutorial Rewards (§5.1) | PRE-4 | KEEP — Account state. No purge resets either (C2, C5) |
| Character skills, and any other Character-specific progression | 4 | DELETE-OWNED |
| Active Party configuration | 4 | nothing to do while a member cannot request deletion (§3). The Main is always a member (`ADR-022` PP2), so for the Main this is settled with DEL-O1 |
| an Activity shared with other Characters of the same account — under `ADR-022`, with the Main's companions | 4 | declared with DEL-O1. The rule written for five Characters was SCRUB — its participant row and per-participant state go; the Activity and the other participants' facts stay; nothing records who the missing participant was. SCRUB is optional since 2026-09-25 (DH5) |
| run replay and debug artefacts | 4 | DELETE-HISTORY for runs it ran alone. A shared run that involved it can no longer be replayed exactly, and that is accepted |
| quest and dungeon progress held by the Character | 5 | DELETE-OWNED; Account-wide unlocks KEEP |
| co-op lobby, frozen plan | 5B | REFUSE |
| completed co-op runs | 5B | other accounts keep their own results. Whether the purged Character stays named there is the phase's declaration: SCRUB, or history within DH5 |
| listings, escrow, trades and player-to-player transfers in flight | 6 | REFUSE |
| completed trades, price history | 6 | the counterparty keeps the price, the item definition, the time and its own side. Whether the purged Character stays named is the phase's declaration: SCRUB, or history within DH5 |
| forge inputs in flight | 7 | REFUSE |
| imbuements and their active-use timers on Character-owned items; Wheel, gems, Skill Tree | 7 | DELETE-OWNED, with the item or the Character they belong to |
| the Store Container (`ADR-021`) | the first phase with a Character-bound consumable | DELETE-OWNED |
| a Character-bound consumable, wherever it is stored — the Store Container or the Depot | the same | DELETE-OWNED, selected by its binding rather than its custody. It never transfers, becomes unbound, stays as an orphaned Depot item, moves to the Stash, refunds or converts (`ADR-021` §6) |
| any table not listed here — Bestiary, Charms, outfits and achievements (7A) included | — | its phase specification declares its action; an undeclared reference fails the closure test (§7) |

#### 6.3 Two references that need care

**Idempotency records.** An `IdempotencyRecord` belongs to the Account, its principal, but a record
for a command that named the Character stores a result that can contain that Character's id, and
a fingerprint hashed from a request that named it. `ADR-017` still owes a retention policy, so
today such a record would survive indefinitely. The
implementation must make these records findable — record which Character a command names, or
adopt a retention window shorter than the grace so that none can reach the purge — and the purge
deletes whatever remains. Deleting one reopens its client key, which is harmless: every command
that names a purged Character is refused. *The reason for deleting them was identity (L12), which
is superseded since 2026-09-25. An idempotency record is still live operational state, not
history, so the post-purge proof still covers it; whether the purge deletes it, or a retention
window shorter than the grace keeps it from ever reaching a purge, is the PRE-4 specification's
choice.*

**Operations with a BANK leg and a POUCH leg.** One operation can post to both scopes:
`service.buy` debits the Pouch first and the Bank for the remainder, under one operation id, and
a future deposit or withdrawal is a two-leg transfer. The purge deletes the POUCH legs and keeps
the BANK legs, which are the Account's own record that it paid or received value.

- Reconciliation is per custody scope (`ADR-019`) and is unaffected: each surviving scope still
  equals the sum of its entries.
- A check that an operation's legs balance must be restated, because a surviving BANK leg may have
  lost its counterpart to a purge. Recommended: the purge manifest (DH3) records which operation
  ids lost a leg; a missing leg that is not so recorded stays a P1. *(Until 2026-09-25 this record
  had to be non-identifying; DH4 lifts that.)*
- An operation id on a BANK entry must never embed a Character's identity. None does today:
  client-command operation ids are `namespace:account:clientKey`, and the one id that embeds a
  Character — `hunt.death:<characterId>:…` — is POUCH-only and is deleted with it. This stays true
  since 2026-09-25: the BANK ledger is **live** persistence, which the post-purge proof covers (§7).

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
  schema itself and fails when one has no declared action — a binding that is independent of
  custody included (`ADR-021` §6). After a purge, a scan of **live** product persistence —
  PostgreSQL and Redis — finds the Character's id and name in no live row, JSON and text columns
  included, and every Account-owned row is unchanged apart from the documented SCRUBs. The
  historical deletion record (DH1–DH5) is the scan's one declared exception: it is immutable, it
  holds no foreign key that live state depends on, and it takes part in no ownership, custody or
  uniqueness rule.
- **Recorded.** The purge writes the historical deletion record — the purge manifest and its
  deletion-specific facts (DH3), and the Deleted List entry (DH2) — as part of the same boundary.
  Its shape is the PRE-4 specification's; that it matches exactly what was purged is a test. The
  manifest may reference durable facts that earlier phases already keep, and the purge builds no
  telemetry beyond its own deletion facts (DH6).
- **No damage to existing audit or analytics data.** The purge changes no durable audit or
  analytics record that it does not own. What it removes from live history (§6) stays answerable
  through the manifest (DH3).
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
  Character's POUCH entries — unless the PRE-4 specification keeps them as immutable history
  outside live custody (§6.1). Nothing ever **updates** a ledger row, and no BANK entry is ever
  deleted.
- **I12.** Replaced: *a Character is removed only by its final purge — at or after its deadline,
  atomically, by the purge capability.*
- **I1, I1b and I2.** Their predicates lose `retiredAt` and count **every existing Character**,
  `PENDING_DELETION` included (§5, G4.1b). Under `ADR-022` they are restated for one Main per Game
  Account and its companions (`DOMAIN_MODEL.md` §7).
- **I17.** The freeze includes elapsed time: nothing time-derived accrues to a pending Character
  (FZ2).
- **I19.** The post-purge proof covers **live** product persistence; the historical deletion record
  is its one declared exception (DH1–DH5).
- **Access filters.** Every read or command path that filters `retiredAt IS NULL` becomes
  lifecycle-aware: `ACTIVE` for play, every existing row for uniqueness.

### 9. Migrating from what is implemented

For the PRE-4 implementation, forward-only and additive first (`DATA_ARCHITECTURE.md` §8):

1. add the lifecycle state, both timestamps, the request and restore commands, the purge
   capability and the purge job — together with the Account-owned tutorial-completion and
   one-time reward state, the creation routing of §5.1–§5.2 and the Bootstrap Kit binding, so
   that no purge can ever be followed by a recreation that accumulates Account value — and the
   freeze of time-derived state (§4), the historical deletion record and the Deleted List entry
   (DH1–DH3). The open items of §5.3 are settled first;
2. complete the classification of the current starting grant (§5.2), with no item left flagged —
   the tutorial consumables under `ADR-021`, the starter gear once DEL-O4 is decided — and bind
   the kit items that already exist, or record the ones that cannot be identified;
3. switch every `retiredAt` read to the lifecycle-aware predicate;
4. count the rows with `retiredAt` set, and report the number in the implementation PR. No
   product path sets it, so any such row comes from a test or a hand edit. Recommended
   conversion: `PENDING_DELETION`, requested at the migration instant, so that no Character is
   destroyed without a full grace window;
5. rebuild I1 and I1b without `retiredAt`, over every existing Character, `PENDING_DELETION`
   included (§5);
6. only then remove `retiredAt` and `retireCharacter`;
7. replace the VERIFIED tests that encode retirement — Phase 0B `D5` and `D6`, Phase 1 `D22`'s
   retirement step and `D24`'s filter, Phase 3 `RET1`–`RET2`, and the `retiredAt` assertion in
   `tests/integration/characters.test.ts` — through explicit matrix amendments. A verified test is
   superseded visibly, never deleted quietly;
8. correct the schema, migration-adjacent and code comments that cite `ADR-007`.

No migration rewrites a ledger row, and the purge is not a migration.

## Consequences

**Benefits.**

- The product rule the Product Owner asked for: reversible for exactly 720 hours, then gone from
  play for good — with an immutable, named history of what was deleted (§1b).
- Nothing is destroyed by a single click. The grace absorbs mistakes, as retirement tried to,
  without keeping the Character forever.
- The Account's own financial truth is safe by construction: a BANK row never names a Character,
  and no BANK row is ever deleted.
- A restore can never fail because of a replacement: a pending Character keeps everything its
  restoration needs (§5).
- Deletion is not a farming loop. Tutorial completion and one-time Tutorial Rewards are Account
  state that survives the purge, and the only thing a recreated Origin Character receives again is
  a Bootstrap Kit that can never leave it (§5.1–§5.2).

**Costs.**

- **Irreversible loss is now a designed outcome.** After the purge, no support action can recover
  a Character, an item it held or the Gold in its Pouch.
- Live ledger history is no longer complete. *"Which Character earned this Gold?"* is no longer
  answered by live state once that Character is purged; the Account-level answer — how much the
  Bank received, when and why — survives, and since 2026-09-25 the internal deletion record keeps
  what the purge removed (DH3).
- The historical deletion record needs its own retention and access rules, and the public Deleted
  List its own presentation. Both are open (§5.3, `OPEN_QUESTIONS.md`).
- The freeze stops Stamina and every other time-derived rule for the whole grace, so a restored
  Character has exactly what it had at the request, never what an idle Character would have
  gained meanwhile.
- A shared run that involved a purged Character can no longer be replayed exactly.
- A player who deletes a Character cannot reuse its vocation, its Origin slot or its roster place
  until the purge. An account at roster capacity 1 that deletes its only Character cannot create
  another for 30 days; it can restore that one at any time before the deadline.
- The purge is a new privileged path into data that is otherwise append-only. It needs its own
  role, its own tests and its own review.
- The purge job is an operational commitment: it must run promptly, retry, and be monitored
  against a lateness target, because a due Character that lingers is a visible failure.
- Every future table that references a Character must declare a purge action, and the closure
  test has to be kept honest.
- Every item path — today's moves, Stash deposits and sales, and every later one — has to check
  the Bootstrap Kit binding on the instance it touches.

**Constraints created.**

- Exactly one path may hard-delete a Character: the purge, once the deadline has made it due.
- No command shortens the grace or postpones a due purge, and no command reaches a purged
  Character.
- A due purge that has not committed is an alerting condition, retried until it succeeds.
- No Character-owned value moves to the Bank or to any recovery custody at purge.
- A pending Character's vocation, Origin slot and roster place are released only by its purge, in
  the commit that deletes it.
- No purge resets the Account's tutorial completion, and no *delete → purge → recreate* awards a
  one-time reward again.
- A Bootstrap Kit item never reaches the Depot, the Stash, another Character, a market, a sale or
  any conversion into Account value, and is destroyed with its Character.
- Ownership follows the binding as well as the custody: the purge deletes every item bound to the
  purged Character, wherever it is stored (`ADR-021`).
- A BANK entry never carries a Character's identity, in any column, the operation id included.
- A new reference to `Character` is not mergeable without a declared purge action.
- Nothing time-derived accrues to a pending Character, and a restore credits nothing for the
  pending interval.
- A historical deletion record never takes part in live ownership, custody or uniqueness, never
  reserves a name, and never restores gameplay.

## `ADR-007` assumptions that no longer apply

| `ADR-007` said | Under this decision |
|---|---|
| deletion is retirement | deletion is a 30-day grace, then a hard purge |
| a retired Character keeps its identity and history forever | the purge removes the live Character (L6). Since 2026-09-25 an immutable historical record keeps its identity for audit, moderation, analytics and the public Deleted List — and, unlike a retired row, it is not a Character, holds no name and restores nothing (DH1–DH5) |
| its items go to an account-level recovery custody scope | there is no recovery custody: items stay with the Character during the grace and are destroyed at purge (L7, L8) |
| its vocation is freed at retirement | held through the grace, freed only by the purge (§5) |
| it stops counting against the roster at retirement | counts through the grace, stops only at the purge (§5) |
| roster capacity and the Gold that bought it are not refunded | **still true** — capacity is Account-owned and monotonic |
| the Origin Character may be retired, and the tutorial flag is unaffected | the Origin Character may be deleted like any other. It keeps the Origin slot through the grace, and tutorial completion stays with the Account through the purge: a purge never restarts the tutorial for an account that completed it, and never awards a one-time reward again (§5.1). Purged before completion, it is replaced by a new Level-1 Origin Character with a fresh Bootstrap Kit (§5.2) |
| reversibility is a deferred parameter | reversibility is `LOCKED`: 30 days — exactly 720 elapsed hours (T1) |
| no code may hard-delete a Character | exactly one path may: the purge |
| vocation uniqueness is a partial index over non-retired rows | the `retiredAt` predicate goes; uniqueness spans every existing Character, `PENDING_DELETION` included (§5) |
| *"which Character earned this gold"* stays answerable for years | answerable from live state only while that Character exists; afterwards from the internal deletion record (DH3) |

## Alternatives considered

**Keep retirement.** Superseded by the Product Owner. A retired row is still a *live* Character:
it holds its name and takes part in uniqueness, which L9 and FZ6 forbid. (It was also the eternal
historical row L10 forbade; L10 is superseded, but DH5 keeps history out of live rules, which a
retired row cannot be.)

**Delete immediately.** Violates L1–L3.

**Retire, then anonymise forever.** A surviving *live* row whose only purpose is to be the deleted
Character would keep holding the name, against L9. History that must survive is the separate,
immutable record of DH1, never a Character row.

**Keep a restorable copy, or leave the old rows restorable after the purge.** Rejected by FZ1,
FZ5 and DH3: deletion copies nothing, and the purge's history is a manifest, never live state that
could be brought back.

**Move the Pouch to the Bank, or the items to recovery custody, at purge.** Forbidden by L7. It
would also turn deletion into a free way to bank carried Gold.

**`ON DELETE CASCADE` everywhere.** Rejected. It hides the policy inside the schema, it reaches
Account-owned and shared rows the moment one relation is added carelessly, and it cannot express
SCRUB or REFUSE at all. Cascade is acceptable only where the closure test proves that it stays
inside Character-owned data.

**End a live Activity automatically when deletion is requested.** Rejected. A second settlement
trigger is a new place for rewards to be applied twice or not at all; the player ends the Activity
through the path that already exists.

**Keep a tombstone after the purge to hold the name.** Contradicts L9 and FZ6.

## Product constraints requiring this architecture

- The thirteen rules of §1, G4.1b (§5), and G4.1c with its pre-completion case (§5.1–§5.2) —
  Product Owner, 2026-09-24.
- T1, FZ1–FZ6 and DH1–DH6 (§1a–§1b), superseding L10 and L12 — Product Owner, 2026-09-25, who
  delegated the safety architecture and approved this direction.
- One Main Character per Game Account, with companions — `ADR-022`, Product Owner, 2026-09-25.
- *"Economy operations must be transactional and auditable."* — `AGENTS.md`
- *"no item duplication"* — `docs/ARCHITECTURE.md`, security baseline
- *"Do not determine tutorial eligibility only by counting existing characters."* —
  `TUTORIAL_ROOKGAARD_ROADMAP.md` §2
