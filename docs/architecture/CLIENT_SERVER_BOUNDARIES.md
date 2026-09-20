# Client / Server Boundaries

**Document status:** `PHASE_0A_COMPLETE` / PENDING INDEPENDENT REVIEW
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
| `setActiveParty(orderedCharacterIds)` | ownership, size 1–4, distinct, all active, **no running activity** (`ADR-005`) |
| `unlockRosterSlot` | capacity < 5, sufficient Gold, transactional spend |
| `createCharacter(vocation)` | slot available, vocation not owned, level rules |
| `retireCharacter(characterId)` | ownership, not currently in a running activity (`ADR-007`) |
| `startActivity(activityDefinitionId)` | ownership, prerequisites, unlocks, party validity, no existing activity |
| `stopActivity` | ownership of the running activity |
| `equipItem(characterId, itemInstanceId, slot)` | custody, ownership, equip requirements, **character not participating in a running activity** (`DOMAIN_MODEL.md` §5.12) |
| `sellItem` / `listItem` / `buyListing` | custody, ownership, funds, escrow, fees |
| `forgeAttempt(target, sacrificeA, sacrificeB)` | custody of all three, classification and rarity match, costs |
| `startSkillTraining(characterId, exerciseItemId)` | custody, charges remaining |
| `claimSkillTraining(characterId)` | ownership; server computes elapsed time |

**Every command is authorized against the Account.** A command naming a character the account
does not own is rejected before any domain logic runs — not filtered afterwards.

### Idempotency

Commands that move value — `unlockRosterSlot`, `buyListing`, `forgeAttempt`, `sellItem`,
`claimSkillTraining` — carry a **client-supplied idempotency key**. A repeat of the same key
returns the original result rather than performing the operation again. Read-only and
configuration commands do not need one.

This is what makes a flaky mobile connection safe: a retried purchase cannot double-charge.

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
