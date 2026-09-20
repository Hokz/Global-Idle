# Global Idle — Architecture Overview

**Document status:** `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`
**Phase:** 0A.9 — Integration Review
**Authority:** This is the **entry point** for Global Idle's technical architecture. The root
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) is a pointer to this set, not a competing source.

---

## 1. The package

| # | Work package | Document |
|---|---|---|
| 0A.1 | Domain architecture | [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md) |
| 0A.2 | Client / server boundaries | [`CLIENT_SERVER_BOUNDARIES.md`](CLIENT_SERVER_BOUNDARIES.md) |
| 0A.3 | Data and persistence | [`DATA_ARCHITECTURE.md`](DATA_ARCHITECTURE.md) |
| 0A.4 | Session, presence, activity lifecycle | [`SESSION_AND_ACTIVITY_LIFECYCLE.md`](SESSION_AND_ACTIVITY_LIFECYCLE.md) |
| 0A.5 | Game engine / simulation | [`GAME_ENGINE_ARCHITECTURE.md`](GAME_ENGINE_ARCHITECTURE.md) |
| 0A.6 | Content / game data | [`CONTENT_DATA_ARCHITECTURE.md`](CONTENT_DATA_ARCHITECTURE.md) |
| 0A.7 | Economy integrity and security | [`ECONOMY_INTEGRITY.md`](ECONOMY_INTEGRITY.md) |
| 0A.8 | Infrastructure, observability, operations | [`OPERATIONS_ARCHITECTURE.md`](OPERATIONS_ARCHITECTURE.md) |
| 0A.9 | Integration review | this document |
| 0A+ | Occupancy, Stamina, active-use timers, Imbuements | [`ACTIVITY_OCCUPANCY_AND_TIMERS.md`](ACTIVITY_OCCUPANCY_AND_TIMERS.md) |

### Decisions

| ADR | Title | Status |
|---|---|---|
| [001](decisions/ADR-001-bounded-contexts-and-single-ownership.md) | Bounded contexts and single ownership of state | `ACCEPTED` |
| [002](decisions/ADR-002-activity-owns-in-flight-state.md) | Activity owns in-flight state; progression changes at settlement | `ACCEPTED` |
| [003](decisions/ADR-003-ledger-derived-currency-balances.md) | Currency balances are ledger-derived projections | `ACCEPTED` |
| [004](decisions/ADR-004-item-single-custody.md) | An ItemInstance has exactly one custody scope | `ACCEPTED` |
| [005](decisions/ADR-005-active-party-as-configuration.md) | Active Party is ordered configuration, not an entity | `ACCEPTED` |
| [006](decisions/ADR-006-participant-profile-refresh.md) | Composition frozen for a run; power refreshes at checkpoints | `ACCEPTED` |
| [007](decisions/ADR-007-character-retirement.md) | Character deletion is retirement, not erasure | `ACCEPTED` |
| [008](decisions/ADR-008-newest-connection-wins.md) | The newest authenticated connection evicts the previous | `ACCEPTED` |
| [009](decisions/ADR-009-postgres-sole-durable-truth.md) | PostgreSQL is the sole durable truth | `ACCEPTED` |
| [010](decisions/ADR-010-pure-engine-injected-clock-and-rng.md) | Pure engine, injected clock and RNG | `ACCEPTED` |
| [011](decisions/ADR-011-content-as-versioned-artifact.md) | Content is a versioned build artifact | `ACCEPTED` |
| [012](decisions/ADR-012-modular-monolith.md) | One deployable modular monolith for Phase 0B | `ACCEPTED` |
| [013](decisions/ADR-013-character-activity-occupancy.md) | One primary action per Character, atomically enforced | `ACCEPTED` |
| [014](decisions/ADR-014-per-character-stamina.md) | Stamina per Character, activated by first qualifying XP | `ACCEPTED` |
| [015](decisions/ADR-015-active-use-duration-timers.md) | Active-use timers settle at checkpoints, never by wall clock | `ACCEPTED` |
| [016](decisions/ADR-016-content-bundle-retention.md) | Content bundles retained while referenced, never GC'd | `ACCEPTED` |
| [017](decisions/ADR-017-idempotency-key-contract.md) | Idempotency keys are account-scoped and fingerprinted | `ACCEPTED` |

---

## 2. The system in one picture

```text
┌──────────────────────────────────────────────────────────────────┐
│  BROWSER — renders and sends intent. Authoritative for nothing.  │
└───────────────────────────┬──────────────────────────────────────┘
                 commands   │   events
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  API / APPLICATION                                               │
│  authn → authz → validation → orchestration → transaction        │
│                                                                  │
│   ┌────────────┐   pure call    ┌──────────────────────────┐     │
│   │ Orchestr.  │───────────────►│  GAME ENGINE (pure)      │     │
│   │            │◄───────────────│  no I/O, injected clock  │     │
│   └─────┬──────┘   described    │  and RNG                 │     │
│         │          effects      └────────────▲─────────────┘     │
│         │                                    │ resolved, pinned  │
│         │                        ┌───────────┴─────────────┐     │
│         │                        │ CONTENT (immutable,     │     │
│         │                        │ versioned artifact)     │     │
│         │                        └─────────────────────────┘     │
└─────────┼────────────────────────────────────────────────────────┘
          │ transactions
    ┌─────▼──────────────┐        ┌────────────────────────────┐
    │  PostgreSQL        │        │  Redis                     │
    │  the only durable  │        │  presence, queues, caches  │
    │  truth             │        │  nothing unrebuildable     │
    └────────────────────┘        └────────────────────────────┘
```

---

## 3. Flow A — request / command

```text
Browser
  │  command + idempotency key (value-moving only). No outcome, no timestamp.
  ▼
API — authenticate            session → Account
  │
  ├─ authorize                every named id loaded SCOPED to the account
  │
  ├─ validate state           no running activity? funds? custody? party legal?
  │
  ├─ orchestrate              gather inputs; content pinned; profile derived
  │     │
  │     └─► ENGINE (pure)     resolves rules, returns DESCRIBED effects
  │            │
  │     ◄──────┘
  │
  ├─ TRANSACTION              ledger + balance + custody + progression + activity state
  │                           one operation id, all-or-nothing
  ▼
Response + events             authoritative totals, not instructions to compute
```

Rejected at the boundary, always: a damage number, an XP amount, a loot result, a success flag,
a client timestamp, an id the account does not own.

---

## 4. Flow B — activity lifecycle

```text
                    startActivity
                          │  claim acquired atomically (one per account)
                          ▼
                  ┌───────────────┐
        resume    │ ONLINE_ACTIVE │──── stop / logout ──────► ACTIVITY_ENDED
     ┌───────────►│   ticking     │──── wipe / stop cond ───► ACTIVITY_ENDED
     │            └───────┬───────┘
     │                    │  transport lost
     │                    │  ① stop ticking immediately
     │                    │  ② settle progress so far
     │                    │  ③ persist graceExpiresAt
     │                    ▼
     │     ┌──────────────────────────┐
     └─────│  RECONNECT_GRACE_PAUSED  │─── 5 min from persisted state ──► ACTIVITY_ENDED
  new conn │  NO tick path exists     │
  (any     │  accumulator frozen      │
  device)  └──────────────────────────┘

  settlement checkpoint  ──►  fold accumulator → durable state
                              re-derive participant profile   (ADR-006)
                              re-evaluate Shared XP eligibility
```

Skill Training does not participate: no session, no pause, no claim; accrues on wall-clock from
persisted timestamps; cannot write Base XP.

---

## 5. Flow C — economy mutation

```text
Intent (+ idempotency key)
  │
  ├─ authorize            custody and ownership, scoped load
  │
  ├─ validate             funds, classification/rarity match, listing active, buyer ≠ seller
  │
  ▼
TRANSACTION   locks acquired in a globally consistent order
  │
  ├─ debit / credit  ──►  LEDGER append (immutable)
  │                  ──►  balance projection updated in the SAME transaction
  │
  ├─ custody transition   exactly one scope, before and after
  │
  ├─ idempotency          CLIENT command: (principal, namespace, client key) + fingerprint
  │                       same fingerprint ⇒ original result
  │                       different fingerprint ⇒ explicit conflict reject
  │                       SETTLEMENT: deterministic server-generated operation id
  │                       both constraint-enforced ⇒ replay is a no-op
  │
  ▼
COMMIT  ──►  audit record complete  ──►  client update

    reconciliation job:  sum(ledger) == projection ?
                         mismatch ⇒ halt economy writes for the subject, P1
```

---

## 6. Flow D — content

```text
authored files  (packages/game-data/content/**)
      │  canonical keys: creature.rookgaard.rat
      ▼
CI VALIDATION   schema · key format · reference resolution · ranges · continuity
      │         blocking — invalid content cannot ship
      ▼
versioned artifact   one version for the whole set
      │
      ▼
runtime load    once at startup, in memory, read-only, NO write path
      │
      ├─► activity pins the version at start
      │
      └─► engine receives RESOLVED definitions, never a lookup key
```

A deployment mid-hunt cannot change the creature a player is fighting.

---

## 7. Integration checklist

### No contradictory ownership

Every state has exactly one owning context (`ADR-001`). The one contradiction found in review —
roster capacity claimed by two contexts — is resolved: the **Character context** owns it, and
the fact that it is stored on the Account row does not decide the boundary
(`DOMAIN_MODEL.md` §5.4).

### No circular responsibility

Authority flows one way. Activity reads Character and Content and *settles* into Character and
Economy; it never writes them directly. Party reads Character, never writes it. Content has no
runtime writer. The engine calls nothing — it is called. There is no path by which a lower layer
re-enters a higher one.

### No client authority leaks

No command carries an outcome, amount, success flag or timestamp. Ownership is enforced by
scoped loading rather than post-hoc comparison. Combat events are presentation-only. Elapsed
time is server-owned for both activity families — which is what closes the wall-clock training
hole (`CLIENT_SERVER_BOUNDARIES.md` §6).

### No economy mutation without transaction and audit

Every value movement is one transaction that appends to the ledger and updates the projection
together, is constraint-enforced against replay — by an account-scoped, fingerprinted client key
for commands, or a deterministic server-generated operation id for settlements (`ADR-017`) — and
leaves an audit record. Admin tooling uses the same paths; there is no privileged bypass
(`ECONOMY_INTEGRITY.md` §6).

### No Hunt/Dungeon offline progression path

Session-bound activities tick only from `ONLINE_ACTIVE`, which requires a live session. Skill
Training — the only disconnected progression — settles on wall-clock and is structurally unable
to write Base XP (invariant I10). There is no third path.

### Reconnect pause cannot advance simulation

There is **no code path from `RECONNECT_GRACE_PAUSED` to a tick**. The guarantee is structural,
not a check inside the tick loop. The accumulator is frozen; expiry is decided from persisted
state rather than from a timer having fired.

### The Party model fits one account, many characters

One account, one session, one claim, an ordered list of at most four active characters drawn
from a roster of at most five with unique vocations. Composition is frozen for a run; power
refreshes at checkpoints. Shared XP eligibility is derived, never stored. Nothing in the model
admits a second human.

### Future systems integrate without rewriting boundaries

| Future system | Integrates as | Requires no change to |
|---|---|---|
| Forge | an economy operation over item custody | ledger, custody, engine boundary |
| Market | escrow custody scope + ledger entries | any of the above |
| Wheel / Skill Tree | modifier layers feeding `deriveParticipantProfile` | engine interface, settlement |
| Imbuements | an independent modifier layer on `ItemInstance` | custody model |
| Boss rotation | scheduled activity starts | activity lifecycle |
| Premium automation | entitlement-gated orchestration | authority model |
| Engine port to Go/Rust/C++ | replacing a pure function | persistence, orchestration, content |

None of these needs a new authority model, a second durable store, or a change to the custody
or ledger invariants.

---

## 8. Known risks

| Risk | Exposure | Mitigation |
|---|---|---|
| Settlement checkpoint interval mis-tuned | too long loses progress on crash and delays level-up power; too short raises write volume | explicit `DEFERRED PARAMETER` with a stated cost model; metric on settlement duration |
| Pessimistic locking contends under load | market throughput | deterministic lock order prevents deadlock; contention is measurable before it is a problem, and no load exists yet |
| Ledger growth | storage and query cost over years | append-only by design; partitioning and retention deferred as a scale concern, not a correctness one |
| Single deployable | scales as one unit | the engine — the plausible hotspot — is already isolated behind a replaceable boundary (`ADR-010`) |
| Content retention vs long activities | a pinned version must stay loadable, and Hunts are endless | referenced bundles are never garbage-collected and any referenced version is loadable (`ADR-016`); no document assumes an activity finishes within any particular time |
| Eviction churn on flaky networks | repeated session evictions | atomic transfer keeps each one consistent; metric surfaces the pattern |

---

## 9. Status

Architecture documents: `PHASE_0A_COMPLETE` / `ARCHITECTURE_APPROVED`.
ADRs: all 17 `ACCEPTED`.

The Product Owner approved the Phase 0A package after independent review. Per the governance
model the architect does not self-approve; this status records the reviewer's and Product
Owner's decision, not the author's.

`IMPLEMENTATION_SPEC_READY` is the next stage and is **not** claimed here. It belongs to Phase
0B planning, once the approved architecture has been turned into concrete implementation specs.

Accepted decisions may still be revised, but a revision is a **new ADR that supersedes the old
one** — the accepted record is not edited in place.
