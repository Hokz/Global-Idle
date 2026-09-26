# Client / Server Boundaries

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.2
**Depends on:** [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md), `ADR-001`, `ADR-010`

---

## 1. The one rule

> *"The browser must never decide loot, rarity, forge success, damage, currency balances or
> market transactions. The client requests actions and renders results; the server validates and
> resolves them."* — `docs/MASTER_DEVELOPMENT_ROADMAP.md` §17

Everything in this document is that sentence made specific enough to build against.

**The client owns rendering and intent. The server owns truth.** There is no third category.

---

## 2. Layers and what each is for

| Layer | Owns | Never |
|---|---|---|
| **Web client** (Next.js/React) | rendering, input capture, local UI preference, optimistic *presentation* | decides an outcome, computes a reward, measures elapsed time, holds authority |
| **API / application** | authentication, authorization, validation, orchestration, transactions, settlement | contains combat rules, contains balance formulas |
| **Game engine** | simulation rules, combat, loot resolution, progression math | touches I/O, reads a clock, reads a database, applies its own results |
| **Persistence** | durable truth, constraints, transactions | contains game rules beyond invariants |
| **Redis / workers** | presence, scheduling, queues, caches | holds anything that cannot be rebuilt (`ADR-009`) |

The engine sits *inside* the API deployable (`ADR-012`) but is architecturally separate: a pure
package the application calls, never a layer the client can reach.

---

## 3. Commands — what the client may ask for

The client sends **intents**, never outcomes. `startHunt(huntId, partyConfig)` is an intent;
`grantXp(1000)` is not a command the protocol contains.

| Command | Server validates |
|---|---|
| `authenticate` | credentials, rate limits, account status |
| `setActiveParty(orderedCharacterIds)` | ownership, size 1–4, distinct, the Game Account's Main present (`ADR-022` PP2), the Game Account `ACTIVE` — not pending deletion — **no running activity** (`ADR-005`, `ADR-024`) |
| `unlockRosterSlot` | capacity < 5, sufficient Gold, transactional spend. Under `ADR-022` this is a companion unlock; its shape is Phase 4's |
| `createCharacter(vocation)` | the Game Account `ACTIVE`, with no character yet — creation makes its one character, vocationless and in Rookgaard, which becomes the Main on entering the Main game (`ADR-022` GA1, RK3–RK4; the Origin slot, I1b); the name **not taken or reserved anywhere in the game**, counted over every existing Character of every Game Account, pending ones included (`ADR-024` NM1–NM2, I27); level rules. A companion is unlocked, not created this way. No replacement Main is ever created in a Game Account (`ADR-024` GD7). *Until 2026-09-25 this validated per-account names, G4.1b's holds and G4.1c's tutorial routing and Bootstrap Kit (`ADR-020` §5–§5.2) — superseded* |
| `requestGameAccountDeletion(gameAccountId)` | the Login owns the Game Account; `ACTIVE`; no occupancy claim or non-terminal Activity for any of its actors, no lobby or frozen plan, no live obligation; configured Active Party membership does not block (`ADR-024` §2, `ADR-013`). A repeat while pending returns the existing deadline. Every deletion source — a moderation tool included — goes through the same lifecycle (GD9–GD10) |
| `restoreGameAccount(gameAccountId)` | the Login owns the Game Account; `PENDING_DELETION`; server time strictly before `purgeAt` (`ADR-020` §2). The whole Game Account returns exactly as it was, and nothing is credited for the pending time (FZ3). Who may restore a moderation-started deletion is `ADR-024` DEL-O3 |
| `startActivity(activityDefinitionId)` | ownership, prerequisites, unlocks, party validity, no existing **account** activity claim, and — in the same transaction — **atomic acquisition of the occupancy claim for every participating Character**; fails if any participant already holds one (`ADR-013`) |
| `stopActivity` | ownership of the running activity; releases every participant's occupancy claim in the same transaction as the lifecycle transition |
| `equipItem(characterId, itemInstanceId, slot)` | custody, ownership, equip requirements, **character not participating in a running activity** (`DOMAIN_MODEL.md` §5.12) |
| `sellItem` / `listItem` / `buyListing` | custody, ownership, funds, escrow, fees; never a Character-bound consumable (`ADR-021`). The starter gear is ordinary items (2026-09-25) |
| `forgeAttempt(target, sacrificeA, sacrificeB)` | custody of all three, classification and rarity match, the sacrifices at the required prior tier (2026-09-25), costs; none of them a Character-bound consumable |
| `moveBoundConsumable(itemInstanceId, to)` | Account ownership; `to` is the bound Character's Store Container or the Account's Depot, and nothing else; the bound Character is `ACTIVE`; the binding is unchanged (`ADR-021` §4) |
| `useBoundConsumable(characterId, itemInstanceId)` | Account ownership; `characterId` is the item's bound Character, `ACTIVE` and eligible; the item's own use rule; no output convertible into transferable value (`ADR-021` §5). A bound potion in a Hunt is used by its configured action slot, straight from the Store Container, as part of settlement — not by a client command (`ADR-021` U5) |
| `startSkillTraining(characterId, exerciseItemId)` | custody, charges remaining — for a Character-bound Exercise Weapon, only its bound Character, spending charges where it is stored (`ADR-021` §5) — and — in the same transaction — **atomic acquisition of that Character's occupancy claim**; fails if the Character is hunting, in a dungeon, or already training (`ADR-013`) |
| `claimSkillTraining(characterId)` | ownership; server computes elapsed time |
| `claimQuestReward(rewardId)` (future, Phase 5) | Game Account ownership and eligibility, decided on the server; a claim already recorded for this Game Account and reward grants nothing, and a new claim commits with its grant exactly once, whichever actor the Game Account used (`ADR-023` §2) |

The two deletion commands are illustrative names; the PRE-4 implementation specification fixes
them. Since `ADR-024` they name the **Game Account**, never a single Character: no command deletes
a Main or a companion on its own. *The Bootstrap Kit refusal that stood here until 2026-09-25 is
retired with the kit.* **A Character-bound consumable is refused by every command except a move
between its bound Character's Store Container and the Depot, and a use by that Character**
(`ADR-021`, `DOMAIN_MODEL.md` I23). The two bound-consumable commands above are illustrative names;
the phase that ships the first bound item fixes them. The **purge** that follows a deletion's
deadline is **not a command**: the client can neither trigger it, bring it forward nor undo it, and
every command that names a `PENDING_DELETION` Game Account or one of its Characters — other than
restore — is refused (`ADR-020` §4, §7; `ADR-024` §2).

**Every command is authorized against the Account.** A command naming a character the account
does not own is rejected before any domain logic runs — not filtered afterwards.

### Idempotency

Commands that move value — `unlockRosterSlot`, `buyListing`, `forgeAttempt`, `sellItem`,
`claimSkillTraining` — carry a **client-supplied idempotency key**. Read-only and configuration
commands do not need one.

`DECIDED IN PHASE 0A` — see `ADR-017`. The key is **scoped and fingerprinted**:

```text
key identity  =  (authenticated account/principal, command namespace, client key)
stored with   =  canonical fingerprint of the request payload
```

| Case | Behaviour |
|---|---|
| Key unseen | execute, store `(fingerprint, result)`, return result |
| Key seen, fingerprint **matches** | return the original result; do not execute |
| Key seen, fingerprint **differs** | **reject explicitly**; do not execute, do not overwrite |
| Key belonging to another account | not visible — it is a different key identity |

Scoping by principal means account A can neither collide with nor observe account B's result.
Fingerprinting means a retry carrying a *different* payload fails loudly instead of silently
returning a result for an operation the caller did not request.

This is what makes a flaky mobile connection safe: a retried purchase cannot double-charge.

Settlement operation ids are a separate mechanism — server-generated and deterministic, not
client keys (`DATA_ARCHITECTURE.md` §5).

---

## 4. Events — what the server tells the client

The server pushes **facts**, never instructions the client must apply to compute state:

- activity lifecycle transitions (started, paused, resumed, ended, and why);
- settlement results (XP, gold, items gained, supplies consumed, room reached);
- combat presentation events (hits, heals, deaths) — **already resolved**, for rendering only;
- warnings (supplies exhausted, loot capacity full);
- session events (evicted, grace started, grace expiring).

`DECIDED IN PHASE 0A` — **combat presentation events are a rendering feed, not a source of
truth.** The client may animate from them; it must never accumulate them into a total it then
trusts. A client that loses or duplicates events must still show the right numbers after the
next settlement, because settlement carries authoritative totals.

---

## 5. What the client may cache

| Cacheable | Why it is safe |
|---|---|
| Content definitions (creatures, items, hunts) for the current content version | immutable (`ADR-011`); the version is part of the cache key |
| Static assets, map tiles, icons | immutable, CDN-served |
| UI preferences, collapsed panels, filters | purely local, no authority |
| Last known character/inventory snapshot | for instant render; **always** reconciled against the server on reconnect |

**Never cached as truth:** balances, item custody, activity progress, elapsed time, unlock state.

A cached render is allowed to be briefly stale. A cached *decision* is never allowed.

---

## 6. The trust boundary, stated as refusals

The server rejects, rather than sanitizes, any input implying client authority:

| If a client sends | Server does |
|---|---|
| a damage number, XP amount, or loot result | reject — no such field exists in any command |
| elapsed time or a timestamp for accrual | ignore; `DECIDED IN PHASE 0A` — **time is server-owned**, for both activity families |
| a computed balance or item state | ignore; the server reads its own |
| an item id it does not hold custody of | reject on authorization |
| a character id it does not own | reject on authorization |
| a "success" flag for a forge or a roll | reject — the protocol has no such field |
| a second concurrent activity start | reject; one activity claim per account (`ADR-008`) |

**Wall-clock skill training is the sharpest case.** A client that could report how long it
trained could mint skill progress. Elapsed time is computed from server-persisted timestamps
only.

---

## 7. Authorization model

Three checks, in order, before any command reaches domain logic:

1. **Authentication** — a valid session resolves to an Account (`DOMAIN_MODEL.md` §5.18).
2. **Ownership** — every entity id named in the command belongs to that Account.
3. **State** — the command is legal given current state (no running activity, sufficient funds,
   correct custody).

`DECIDED IN PHASE 0A` — ownership is verified by **loading the entity scoped to the account**,
never by loading it and then comparing. `findCharacter(id)` followed by `if (c.accountId !== …)`
is the shape that eventually leaks; `findCharacterForAccount(accountId, id)` cannot.

---

## 8. Optimistic UI — allowed, and bounded

The client may render an intent as pending before the server confirms it, for responsiveness.
It must:

- present pending state as visibly provisional;
- never treat the optimistic value as input to another decision;
- reconcile to the server's answer, including rolling back.

Optimistic rendering of an *outcome the server rolls* — a forge result, a loot drop, a rarity —
is forbidden outright. Showing a Legendary that turns out to be Common is worse than a moment
of latency.

---

## 9. Realtime channel

`DEFERRED` to Phase 0B: transport choice (WebSocket vs SSE) and library. The architecture
requires only that the channel:

- is authenticated and bound to one session;
- carries server→client events and session liveness (`SESSION_AND_ACTIVITY_LIFECYCLE.md`);
- is **not** a command path for anything security-sensitive — value-moving commands go through
  the request/response API where idempotency keys and transactions are natural;
- can be lost and re-established without any state being lost, because nothing authoritative
  lives in it.

---

## 10. Boundary checklist

- [x] No command carries an outcome, a reward, or a computed number
- [x] No client-supplied timestamp feeds accrual
- [x] Every command is authorized against the Account before domain logic
- [x] Ownership is enforced by scoped loading, not post-hoc comparison
- [x] Value-moving commands carry idempotency keys
- [x] Combat events are presentation-only
- [x] The client caches only immutable content and non-authoritative renders
- [x] The realtime channel holds no authoritative state
