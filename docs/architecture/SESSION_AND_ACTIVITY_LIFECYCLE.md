# Session, Presence and Activity Lifecycle

**Document status:** `PHASE_0A_COMPLETE` / PENDING INDEPENDENT REVIEW
**Phase:** 0A.4
**Depends on:** `ADR-002`, `ADR-006`, `ADR-008`, `ADR-009`

---

## 1. What this translates

`docs/DECISIONS.md` locks the online-activity policy in product language. This document turns it
into a state model precise enough to implement, without choosing a transport or a heartbeat
interval.

The five locked facts everything else must satisfy:

1. Hunts and Dungeons progress **only** while the session is connected.
2. A background or minimized client keeps playing while the connection is alive.
3. An unexpected disconnect **pauses immediately** and preserves the activity for **5 minutes**.
4. **Nothing** progresses while paused — no XP, loot, gold, room progression or supply
   consumption.
5. Explicit logout and manual exit **bypass** the grace period.

---

## 2. Session states

```text
UNAUTHENTICATED
      │ authenticate
      ▼
AUTHENTICATED ──── connect ────► CONNECTED
      ▲                              │
      │                              │ transport lost
      │                              ▼
      │                        DISCONNECTED
      │                              │
      └──── explicit logout ─────────┘
```

`CONNECTED` is the only state in which a session-bound activity may advance.

**Liveness is observed, not declared.** A client cannot assert it is connected; the server
concludes it from the transport. `DEFERRED` to Phase 0B: the detection mechanism and its
interval. The architecture requires only that loss is detected promptly and that detection is
server-side.

**Background and minimized tabs are `CONNECTED`.** No product rule distinguishes them, and the
design explicitly wants background play to continue. If the OS or browser suspends the
connection, the server observes transport loss and treats it as any other disconnect.

---

## 3. Activity states

```text
                    startActivity
                         │
                         ▼
                 ┌──────────────┐
      resume     │ ONLINE_ACTIVE│ ──── stopActivity / logout ────► ACTIVITY_ENDED
   ┌────────────►│              │ ──── wipe / stop condition ────► ACTIVITY_ENDED
   │             └──────┬───────┘
   │                    │ connection lost
   │                    ▼
   │         ┌────────────────────────┐
   └─────────│ RECONNECT_GRACE_PAUSED │──── 5 min elapsed ────► ACTIVITY_ENDED
             └────────────────────────┘
```

| State | Simulation | Accumulator | Claim held |
|---|---|---|---|
| `ONLINE_ACTIVE` | ticking | growing | yes |
| `RECONNECT_GRACE_PAUSED` | **none** | **frozen** | yes, reserved |
| `ACTIVITY_ENDED` | none | settled and cleared | released |

`DECIDED IN PHASE 0A` — **there is no code path from `RECONNECT_GRACE_PAUSED` to a tick.** The
zero-progression guarantee is structural, not a check inside the tick loop. A tick is only
reachable from `ONLINE_ACTIVE`.

---

## 4. Transitions in detail

### 4.1 Start

Preconditions: authenticated, connected, no existing activity claim, party valid, activity
prerequisites met.

On start, in **one transaction**, the Activity records the roster snapshot (composition and
order), the pinned content bundle version, the RNG seed, the initial participant profile and an
empty accumulator — **and acquires the occupancy claim for every participating Character**. If
any participant already holds a claim, the whole start fails; nothing partial is left behind.
Claims are acquired in the globally consistent order of `DATA_ARCHITECTURE.md` §4, so two party
starts touching the same Characters cannot deadlock.

### 4.2 Settlement checkpoint

Reached periodically while `ONLINE_ACTIVE`, and always on pause entry and on end.

One transaction: fold the accumulator into Character progression, item custody and the ledger;
clear the accumulator; **re-derive the participant profile** and Shared XP eligibility
(`ADR-006`); persist the new run state.

Carries an operation id. Replaying it is a no-op.

### 4.3 Pause

Trigger: the server observes transport loss.

1. The activity stops ticking **immediately**.
2. A settlement checkpoint runs, so progress up to the disconnect is not lost.
3. State becomes `RECONNECT_GRACE_PAUSED` with a persisted `graceExpiresAt`.
4. The account activity claim is **reserved**, not released.
5. Every participating Character's **occupancy claim is also reserved** — the activity still
   exists, so those Characters are still committed to it and cannot be started on anything else.

`DECIDED IN PHASE 0A` — settling on pause entry rather than discarding means a disconnect costs
a player nothing they had already earned. Discarding would make an unstable connection a
progression penalty, which no product rule asks for.

### 4.4 Resume

Trigger: an authenticated connection arrives for the account while a paused activity exists and
`now < graceExpiresAt`.

The activity returns to `ONLINE_ACTIVE` from its preserved state. The participant profile is
re-derived, because durable state may have changed (skill training settled, items equipped
elsewhere) during the gap.

**Resume works from a different device.** This is the same path as `ADR-008`'s eviction: the
new connection takes the claim and finds a paused activity waiting.

### 4.5 Expiry

`DECIDED IN PHASE 0A` — **expiry is evaluated from the persisted `graceExpiresAt`, never from a
timer having fired.** A Redis-scheduled job may trigger the check promptly, but the decision is
made against durable state, so a lost or late job cannot resurrect an activity that should have
ended or end one that should not have. A periodic sweeper covers missed jobs (`ADR-009`).

On expiry: the activity ends, any residual accumulator settles, and **both the account activity
claim and every participant's occupancy claim are released** — in the same transaction as the
lifecycle transition, never as a follow-up step. A later Hunt re-entry starts at Room 1 —
structurally, because run state died with the activity.

### 4.6 Explicit end

Manual `stopActivity` and explicit logout **bypass the grace period entirely**. Final settlement
runs, the activity ends, and all claims — account and per-Character occupancy — are released
immediately, in the same request and the same transaction.

The difference from a disconnect is *intent the server received*. When the server only observes
transport loss — including a closed tab — it cannot distinguish intent and applies the grace
period.

---

## 5. The activity claim

**Invariant I9:** at most one session holds an account's activity claim at any instant.

- The claim is **authoritative in PostgreSQL** (`ADR-009`), so it survives a Redis flush.
- Acquisition is atomic: a conditional write that fails if another session holds it.
- Transfer on eviction (`ADR-008`) is a single atomic operation. There is no window with two
  holders and no path where a tick runs during transfer.
- A paused activity **reserves** its claim, which is why a returning connection resumes rather
  than starting fresh.

---

## 6. Skill Training — a different lifecycle

Skill Training is a wall-clock activity (`ADR-002`) and **does not participate in any of the
above**.

```text
started ──► accruing (independent of session) ──► claimed / exhausted
```

- no pause, no grace, no claim;
- accrual is computed from **server-persisted timestamps only** — never a client-supplied
  duration;
- settlement occurs on claim or on a read that needs current values;
- the settlement path **cannot write Base XP** (invariant I10), enforced as a capability
  boundary rather than a runtime check.

An account may have a Skill Training activity and a Hunt running at the same time **only on
different Characters**. The same Character can never do both: it holds at most one occupancy
claim (`ADR-013`, invariant I13). A Knight hunting while a Druid trains is the intended shape of
roster play; a Knight hunting *and* training is refused at the command boundary.

---

## 7. Crash and restart recovery

A server restart is, from the activity's perspective, indistinguishable from a disconnect —
and it is handled by the same machinery.

On restart, for each activity:

| Persisted state | Action |
|---|---|
| `ONLINE_ACTIVE` but no live session | transition to `RECONNECT_GRACE_PAUSED` with a fresh grace window |
| `RECONNECT_GRACE_PAUSED`, not expired | leave paused; await reconnect |
| `RECONNECT_GRACE_PAUSED`, expired | end it; settle any residual accumulator; release all claims |

The same sweeper recovers **stranded occupancy claims**: a claim whose named activity or training
no longer exists in a live state is released. Because a claim names its activity, this is a
reconciliation against durable state rather than guesswork (`ADR-013`).

Progress lost by a crash is bounded by the settlement checkpoint interval, which is the explicit
cost side of that tuning knob.

`DECIDED IN PHASE 0A` — granting a fresh grace window after a server restart favours the player
for an outage that was not their fault.

---

## 8. What is deliberately not decided here

| | Why |
|---|---|
| Transport (WebSocket vs SSE) and library | Phase 0B; the model does not depend on it |
| Heartbeat/keepalive interval | task scope forbids choosing it without implementation review |
| Settlement checkpoint interval | `DEFERRED PARAMETER` with a stated cost model |
| Grace-expiry sweeper frequency | operational tuning, bounded by correctness from persisted state |

---

## 9. Lifecycle checklist

- [x] No tick path exists from the paused state
- [x] Pause settles rather than discards
- [x] Grace expiry is evaluated from persisted state, not from a fired timer
- [x] Explicit logout and manual exit bypass grace
- [x] Transport loss the server cannot attribute to intent gets the grace period
- [x] One claim per account, transferred atomically
- [x] Resume works across devices
- [x] Skill Training has no session dependency and cannot write Base XP
- [x] Server restart is handled by the same pause machinery
