# PRE-PHASE-4 specification — the gate before Party and vocations

**Status:** `IMPLEMENTATION_SPEC_DRAFT` — submitted for independent review. **Do not build against
it until it is approved.** Nothing in this document is implemented.
**Base:** the approved governance head `23e1c60` of `docs/product-direction-governance` (PR #13).
**Owning gate:** [`PHASE_GATES.md`](../../PHASE_GATES.md) § *PRE-PHASE-4 GATE*, G4.1 to G4.5.
**Project state:** Phase 3.7 is the last `VERIFIED` phase and stays the active phase.
[`PROJECT_STATE.json`](../../PROJECT_STATE.json) is unchanged. The gate has **not** passed. There is
**no Phase 3.8**, and Phase 4 and Phase 4A have **not** started.
**Date:** 2026-09-26

**Related:** [ADR-020](../../architecture/decisions/ADR-020-character-deletion-grace-and-purge.md) ·
[ADR-021](../../architecture/decisions/ADR-021-character-bound-consumables-and-store-container.md) ·
[ADR-022](../../architecture/decisions/ADR-022-game-account-main-character-and-companions.md) ·
[ADR-023](../../architecture/decisions/ADR-023-quest-replay-and-one-time-reward-claims.md) ·
[ADR-024](../../architecture/decisions/ADR-024-game-account-deletion-grace-and-purge.md) ·
[ADR-025](../../architecture/decisions/ADR-025-tunable-configuration-surface.md) ·
[`DOMAIN_MODEL.md`](../../architecture/DOMAIN_MODEL.md) ·
[`DATA_ARCHITECTURE.md`](../../architecture/DATA_ARCHITECTURE.md) ·
[`CLIENT_SERVER_BOUNDARIES.md`](../../architecture/CLIENT_SERVER_BOUNDARIES.md) ·
[`OPERATIONS_ARCHITECTURE.md`](../../architecture/OPERATIONS_ARCHITECTURE.md) ·
[`ECONOMY_INTEGRITY.md`](../../architecture/ECONOMY_INTEGRITY.md) ·
[`ACTIVITY_OCCUPANCY_AND_TIMERS.md`](../../architecture/ACTIVITY_OCCUPANCY_AND_TIMERS.md)

---

## 0. How to read this

The canonical sequence is unchanged:

```text
Phase 3.7 — VERIFIED
  ↓
PRE-PHASE-4 specification          ← this document
  ↓
PRE-PHASE-4 implementation + independent validation
  ↓
Phase 4 foundation
  ↓
Phase 4A — Playable Beta Slice / Creator Preview
  ↓
remainder of Phase 4
  ↓
Phase 5
```

PRE-PHASE-4 is a **gate**, not a phase. It has no `PROJECT_STATE.json` entry of its own, and passing
it changes no phase's verification record (`PHASE_GATES.md` § *What a gate is*).

**Words.**

- **Login** — who signs in (`ADR-022` GA8). New in PRE-4.
- **Game Account** — one campaign. It is the existing `Account` table: *"the Account is the Game
  Account"* (`ADR-022` §2). The table keeps its name; this document says *Game Account* for the
  concept and `Account` for the table.
- **Main** — the Game Account's one Character, from its creation. Today every `Character` row is a
  Main, vocationless in Rookgaard; the code calls it the *Origin Character* (`ADR-022` §2).
- **The closure** — every durable row that belongs to one Game Account or to one of its
  Characters.
- **MUST / MUST NOT** — a requirement the implementation and its tests prove.

**Identifiers.** Rule ids come from the ADRs (GD, NM, HR, FZ, T1, CF, NC, GA, RK). The Product
Owner's decisions taken for this specification are **PO-1** and **PO-2** (§3.1). This
specification's own technical decisions are **SD-1** to **SD-20** (§3.2). Test cases carry the
matrix ids of §14.

**Every G4.x section has the same parts:** purpose, locked behaviour, current implementation
evidence, target architecture, files, data model, migration, transaction boundaries, API and domain
contract, authority, failure modes, idempotency and retry, concurrency, rollback, compatibility,
tests, non-goals, open items and exit criteria. The acceptance cases themselves are gathered in
§14, so that one table counts them.

---

## 1. Scope

### 1.1 What PRE-4 delivers

| # | Deliverable | Section |
|---|---|---|
| 1 | The **Login** represented apart from the Game Account: one Login owns one or more Game Accounts | §4 |
| 2 | **G4.1** — the Game Account deletion lifecycle: request, freeze, restore, purge, history record, ledger archive, closure test, post-purge scan, removal of retirement | §5 |
| 3 | **G4.2** — `baseXp` as the truth and `baseLevel` as its projection, enforced on every write path | §6 |
| 4 | **G4.3** — the Actor / Participant contract, with a compatibility adapter for the verified Hunt | §7 |
| 5 | **G4.4** — globally unique, case-insensitive Character names | §8 |
| 6 | **G4.5** — the tunable configuration surface, in its first form | §9 |

### 1.2 What PRE-4 does not deliver

- Phase 4: Skills, vocations, vocation selection, companions, companion unlocks, the personal Active
  Party, Shared XP and the tactical action slots.
- Phase 4A: its journey, its select / create UX, its NPC flow, creator tooling and the combat
  inspector.
- The locked combat formulas (§11). The verified engine is not modified.
- Character-bound consumables, the Store Container and bound tutorial potions (§10).
- Moderation tooling and any moderation deletion path (`ADR-024` DEL-O3).
- An account-management UI. PRE-4 adds API routes; no web page is required.
- Multiplayer: no lobby, no networking, no cross-account Activity.
- A remote configuration or live-ops platform.
- Production authentication. Sign-in stays the development provider (`GLOBAL_IDLE_DEV_AUTH=1`).

---

## 2. The repository as it is

Read at `23e1c60`, read-only. Every claim in this table was checked against the code.

| Area | Today | Where |
|---|---|---|
| Login | none. `AuthIdentity.accountId` is a **required** FK to `Account`; `(provider, subject)` is unique | `packages/domain/prisma/schema.prisma` — `AuthIdentity` |
| Sign-in | `POST /api/session` with a dev handle: finds the `AuthIdentity`, or creates `Account` + `AuthIdentity` together | `apps/api/src/game/game.controller.ts` — `signIn` |
| Session | an HMAC-signed cookie holding `{ accountId, sessionId }`; no session table | `packages/domain/src/platform/session/index.ts` |
| Authorization | `SessionGuard` opens the cookie; each Character route checks `Character.accountId = session.accountId` with a read **outside** its transaction | `apps/api/src/game/session.guard.ts`, `world.controller.ts` — `own()` |
| Deletion | none. `retiredAt` exists; `retireCharacter` exists and no route reaches it | `contexts/character/roster.ts` |
| Retirement filters | `retiredAt: null` in 4 API reads, the roster count and the name check; partial unique indexes I1 and I1b over `retiredAt IS NULL` | `game.controller.ts`, `inventory.controller.ts`, `world.controller.ts`, `roster.ts`, `schema.prisma` |
| Foreign keys | 26, every one `ON DELETE RESTRICT` (§5.8) | migrations `2026092*` |
| Ledger | append-only by **permission**: `globalidle_app` has no `UPDATE` or `DELETE` on `LedgerEntry` (I6, test D9) | migration `20260920231400_phase_0b_hand_written_constraints` |
| App role | `DATABASE_APP_URL` connects as `globalidle_app` when set; the API and the worker use it | `apps/api/src/main.ts`, `apps/worker/src/main.ts` |
| Names | 2–20 ASCII letters with single inner spaces, trimmed; unique only among the Account's non-retired Characters, compared **exactly**, by an application read under the Account lock; no DB constraint | `game.controller.ts` — `NAME`; `roster.ts` |
| XP | `baseXp` BigInt is the truth; `baseLevel` is written beside it with `levelForXp` in the settlement and death paths; `createCharacter` takes a free `baseLevel` and leaves `baseXp` at its default 0 | `contexts/hunt/run.ts`, `contexts/hunt/progression.ts`, `roster.ts` |
| Curve | Canary's `getExpForLevel`, transcribed; the exact curve is open | `contexts/hunt/progression.ts` |
| Actors | the engine simulates one actor, `CHARACTER_ACTOR = 'character'`; `startSessionBound` takes `participants: CharacterId[]`; `HuntRun.characterId` is the one Character; settlement derives the owner from `Character.accountId` | `packages/game-engine/src/hunt.ts`, `contexts/activity/lifecycle.ts`, `contexts/hunt/run.ts` |
| Tunables | three `INITIAL/TUNABLE` constants in `@global-idle/shared` (`LOOT_POUCH_SPACES` 20, `DEPOT_SPACES` 200, `STASH_MAX_PER_ENTRY` 100 000); two `INITIAL/TUNABLE` definitions in the content bundle (`rarity-table.default`, `container-slots.default`) | `packages/shared/src/constants.ts`, `packages/game-data/content/rookgaard.json` |
| Content pinning | every `Activity` pins `contentVersion` (ADR-011); bundles are versioned artifacts with a checksum | `schema.prisma` — `Activity` |
| Stamina | settled lazily; **the character-list read settles Stamina** (`staminaView`) | `apps/api/src/game/views.ts`, `contexts/character/stamina/settlement.ts` |
| Idempotency | `IdempotencyRecord.principalId` is the Account id; the record is written in the command's own transaction | `platform/idempotency/index.ts` |
| Settlement ids | `settle:<activityId>:<sequence>` and, for active-use timers, `…:timer:<id>` / `…:stop:<id>` in `SettlementOperation`; ledger `operationId`s also embed an Account id (`<namespace>:<accountId>:<clientKey>`) or a Character id (`hunt.death:<characterId>:<iso>`) | `platform/idempotency/index.ts`, `inventory.controller.ts`, `run.ts` |
| Redis | written keys: `activity:claim:<accountId>` (read-through, 30 s TTL) and BullMQ's `bull:*`; `session:presence` and `ratelimit` are declared families with no writer | `platform/redis/index.ts`, `contexts/activity/claim-cache.ts` |
| Worker | one BullMQ queue, `activity-maintenance`, with a 30-second grace-expiry sweep | `apps/worker/src/queues.ts`, `platform/jobs/index.ts` |
| Production data | none: no production deployment exists. Sign-in is the development provider, which refuses to start under `NODE_ENV=production` | `platform/session/index.ts` — `assertDevAuthSafe` |

---

## 3. Decisions

### 3.1 Product Owner decisions — 2026-09-26

The two product questions this specification could not settle without changing irreversible
deletion behaviour or user-visible semantics were put to the Product Owner as one bundle. Both are
answered, and both are recorded in [`DECISIONS.md`](../../DECISIONS.md).

| # | Question | Decision |
|---|---|---|
| **PO-1** | At the purge, is a Game Account's ledger history deleted or kept as history outside live state? | **Moved to an archive.** The purge moves every `LedgerEntry` of the Game Account — BANK and POUCH — and every `EntitlementAudit` row of its entitlements into append-only archive tables outside live state. The archive has no foreign keys and no balances, and gameplay never reads it. Its retention and access are pre-launch questions, like the history record's. |
| **PO-2** | For globally unique Character names, are names that differ only in letter case the same? | **Case-insensitive.** `Rookie`, `rookie` and `ROOKIE` are one name. The first holder keeps it, and every Character keeps the capitalization it was created with. |

Both were answered with the alternatives in front of the Product Owner: deleting the ledger rows
physically, and exact case-sensitive comparison. Keeping purged rows inside the live ledger was
ruled out architecturally, because it would drop the POUCH ownership foreign key (`ADR-019`) and
leave live rows naming purged ids.

### 3.2 Specification decisions

`ADR-024` §3, §5, §6 and §9 and `PHASE_GATES.md` § *G4.1* assign these choices to this
specification. Each is technical, stays inside a locked rule, and is open to reversal in review.

| # | Decision | Why | Alternatives rejected |
|---|---|---|---|
| **SD-1** | A new `Login` table. `AuthIdentity.loginId` replaces `AuthIdentity.accountId`, and `Account.loginId` is a required FK to `Login` | the credential must outlive the Game Account row (`ADR-024` §5); one explicit parent is the simplest representation of GA8's 1:N | a mapping table (adds a join and a uniqueness rule for nothing); keeping `AuthIdentity → Account` and cloning the credential on purge (a credential copied is a credential that can diverge) |
| **SD-2** | The session cookie carries `{ loginId, accountId, sessionId }`. `accountId` stays the name of the **Game Account** in the session | `accountId` already means the Game Account everywhere (`ADR-022` §2); renaming it in every controller buys nothing | a server-side session table (Phase 1 deliberately has none); a Login-only session (every Game Account command would need its id in the request) |
| **SD-3** | Sign-in provisions **one** new `ACTIVE` Game Account only when the Login owns **none** — a first sign-in, or after its last Game Account was purged. Otherwise it selects one (§4.6). `createGameAccount(tx, loginId)` is the one domain operation that creates a Game Account | preserves Phase 1's only flow — sign-in creates the campaign — and answers `PHASE_GATES.md` G4.1's *"how a Login left with no Game Account starts a new one"*; Phase 4A's select / create UX calls the same operation | an explicit create endpoint in PRE-4 (UX that belongs to 4A); refusing sign-in to a Login with no Game Account (strands the Login GD2 keeps) |
| **SD-4** | The lifecycle lives on the `Account` row: `lifecycle` (`ACTIVE` \| `PENDING_DELETION`), `deletionRequestedAt`, `purgeAt`, `deletionSource`, plus `lastRestoredAt`. A CHECK makes `purgeAt = deletionRequestedAt + 720 hours` and ties all four to the state | one authoritative answer to *"is it pending?"*, and T1 true by construction (`ADR-020` §2) | a separate deletion table (two places to ask); a `PURGING` state (not needed: the purge is one transaction, §5.7) |
| **SD-5** | **The freeze guard** is the first statement of every mutating transaction: it locks the Game Account row (`FOR SHARE`, or `FOR UPDATE` where the operation already takes it) and refuses unless `ACTIVE` | one mechanism, race-free against the deletion request's `FOR UPDATE`, obeying the lock order of `DATA_ARCHITECTURE.md` §4 (Game Account first) | per-route checks outside the transaction (today's ownership check is outside — a race window) |
| **SD-6** | A read of a pending Game Account never settles anything | `PHASE_GATES.md` G4.1: *"no read or view settles a pending Game Account"* — and `staminaView` settles on read today | — |
| **SD-7** | Stamina resumes from `max(CharacterStamina.updatedAt, Account.lastRestoredAt)` | restore leaves every Character-owned row byte-identical and still credits nothing for the pending time (FZ3) | rewriting `CharacterStamina.updatedAt` at restore (the closure would no longer compare equal) |
| **SD-8** | **The purge capability** is one `SECURITY DEFINER` function owned by a new `NOLOGIN` role `globalidle_purge`. The application role may only `EXECUTE` it. It archives and deletes the Game Account's ledger and entitlement-audit rows, and refuses unless the Game Account is `PENDING_DELETION` with `purgeAt` passed on the **database** clock | the application role keeps no ledger `UPDATE` or `DELETE` (I6, D9 unchanged); the whole purge stays in one transaction on one connection | a second database credential for the worker (a broad role and a second pool); a `DELETE` grant to the application role (ends I6) |
| **SD-9** | The purge is **one transaction per Game Account**, in the order of §5.7 | `ADR-024` §2's design target; a Game Account's closure is small | the durable-marker fallback (only needed if one transaction were too large) |
| **SD-10** | The purge job is a scheduler in the existing `activity-maintenance` queue, sweeping every 60 seconds, with no delayed per-account job | a sweep is its own safety net, like the grace sweep; *"promptly"* within one interval | a delayed job 720 hours out (a lost job would still need the sweep) |
| **SD-11** | `IdempotencyRecord` rows of the Game Account are **deleted** by the purge | `ADR-024` §3 offers a delete or a retention window; the delete needs no new sweeper | a retention sweeper shorter than the grace |
| **SD-12** | The closure inventory is code — a declaration file — checked by a test that reads `pg_constraint` and `information_schema` | *"derived from the schema by a test that fails on any reference without a declared action"* | a document inventory (drifts) |
| **SD-13** | The internal history record's fields are those of §5.10 | `ADR-024` §4 assigns them here, within HR3 | — |
| **SD-14** | `retiredAt` is removed: the migration **fails closed** if any row has it set, and reports the count | no route sets it and no production data exists; a Character has no deletion state of its own any more | converting retired rows into pending Game Accounts (invents deletions nobody requested); un-retiring them (would break I1b and names) |
| **SD-15** | Existing case-insensitive name collisions make the names migration **fail closed** with a report. No automatic rename | renaming a Character is a player-visible act; there is no production data, so the fail only reaches development databases, which reset | automatic suffixes; a manual rename tool |
| **SD-16** | The name key is a stored column `nameKey = lower(name)`, unique, with a CHECK tying it to `name` | Prisma declares the unique index; the CHECK proves the two never diverge | an expression index on `lower(name)` (Prisma cannot declare it and reports it as drift) |
| **SD-17** | `baseLevel` is enforced by a CHECK that calls an `IMMUTABLE` SQL transcription of the curve | enforces I29 on every path — raw SQL, migrations and backfills included | an application check alone (a script or a future path can bypass it) |
| **SD-18** | The configuration surface's first physical form is a typed `tunables` definition **inside the versioned content bundle** | the bundle is already versioned, validated at build, checksummed, and pinned by every Activity (`ADR-011`); `ADR-025` names it as a candidate | a new config artifact with its own version column on `Activity`; a database table |
| **SD-19** | **DEL-O5**: PRE-4 does **not** issue bound tutorial potions. They become bound in the phase that ships the Store Container and the potion action slot — Phase 4 by the roadmap — behind GBC.1 | `ADR-024` §9 assigns the timing here; binding them needs the Store Container custody that GBC.1 guards, and PRE-4 must not pull that feature in | binding them in PRE-4 (would build `ADR-021`'s foundation early) |
| **SD-20** | G4.3 needs **no schema change**. The contract is types, an ownership resolver and an adapter over `ActivityParticipant` | ownership is already provable through `Character.accountId`; the verified Hunt must not move | a per-participant `accountId` column now (5B's, when participants of several Game Accounts first exist) |

---

## 4. The Login above the Game Account — the minimum foundation

### 4.1 Purpose

GD2 makes the Login survive its Game Account's purge, and GA8 lets one Login own several Game
Accounts. As the schema stands, a credential cannot outlive its `Account` row. PRE-4 adds exactly
what the purge and Phase 4A need: a Login row, the credential on it, and one Login → N Game
Accounts. Nothing else about accounts changes.

### 4.2 Locked behaviour

- One Login owns one or more Game Accounts; each Game Account belongs to exactly one Login (GA8).
- Each Game Account is an independent campaign and session identity. Nothing campaign-,
  progression-, quest-, reward- or economy-related is shared because the Login is (GA10).
- The Main is the Game Account's one campaign Character. It is created in the Game Account's
  creation flow — the Game Account, then its Main under the name the player chooses — and it is the
  Main from that moment, vocationless, in Rookgaard (GA1, RK3). A Game Account without its Main yet
  is only the first step of that flow (`CLIENT_SERVER_BOUNDARIES.md`, `createCharacter`).
- After a purge the Login still signs in, with its credentials intact, and its other Game Accounts
  are identical (`PHASE_GATES.md` G4.1).

### 4.3 Evidence

§2, rows *Login*, *Sign-in*, *Session*, *Authorization*.

### 4.4 Target architecture

```text
LOGIN            id, createdAt
  │ 1
  ├── AUTH IDENTITY (provider, subject) unique        — the credential, on the Login
  │ 1
  └── N  GAME ACCOUNT (table "Account")               — lifecycle, loginId
            └── MAIN CHARACTER …                      — unchanged
```

### 4.5 Data model

```prisma
model Login {
  id             String         @id
  createdAt      DateTime
  authIdentities AuthIdentity[]
  gameAccounts   Account[]
  @@map("Login")
}

model AuthIdentity {           // accountId removed
  id        String   @id
  loginId   String
  provider  String
  subject   String
  createdAt DateTime
  login     Login    @relation(fields: [loginId], references: [id])   // ON DELETE RESTRICT
  @@unique([provider, subject])
  @@index([loginId])
  @@map("AuthIdentity")
}

model Account {                // + loginId; the lifecycle columns are §5.3's
  loginId String
  login   Login @relation(fields: [loginId], references: [id])       // ON DELETE RESTRICT
  @@index([loginId])
}
```

- **Rows are never deleted.** A Login has no deletion path in PRE-4. A future Login deletion is a
  separate product decision.
- **Ids.** A Login created by the application gets a `uuidv7` from `newId`; M1's backfill uses
  PostgreSQL 16's `gen_random_uuid()`. Ids are opaque. A Login id is never an Account id, so the
  post-purge scan (§5.12) cannot find the purged Game Account's id in a surviving Login row.
- **What stays on the Game Account:** `rosterCapacity`, entitlements, the activity claim (I9), the
  idempotency principal and the newest-connection rule. Moving any of them to the Login is GA-O8,
  and PRE-4 does not decide it (§4.14).

### 4.6 Domain and API contract

| Operation | Contract |
|---|---|
| `signIn(handle)` — `POST /api/session` | in one transaction: find the `AuthIdentity` by `('dev', handle)`, or create `Login` + `AuthIdentity`. Then **select** the session's Game Account: the Login's oldest `ACTIVE` Game Account; else its oldest `PENDING_DELETION` one, so its owner can see and restore it; else — none — **provision** one with `createGameAccount` (SD-3). Response: `{ loginId, accountId }` |
| `createGameAccount(tx, { loginId, at })` | locks the Login row `FOR UPDATE`, inserts an `ACTIVE` `Account` with `rosterCapacity` 1. PRE-4 calls it only from sign-in |
| `GET /api/me` | adds `loginId`, `lifecycle`, `deletionRequestedAt`, `purgeAt` to today's fields |
| `GET /api/game-accounts` | the session Login's Game Accounts: `{ id, lifecycle, deletionRequestedAt, purgeAt, createdAt, current }` |

**No switch route and no create route in PRE-4.** In PRE-4 nothing makes a Login own a second
*active* Game Account, so there is nothing to switch to; Phase 4A adds the select / create UX over
`createGameAccount`.

### 4.7 Authority

- Every route resolves the session into `{ loginId, accountId }` and loads the Game Account row once
  per request. A missing row, or one whose `loginId` differs from the session's, is
  **`401 SESSION_GAME_ACCOUNT_GONE`**, and the response clears the cookie. The client signs in
  again, which selects or provisions (§4.6).
- A route that names a Game Account by id (`/api/game-accounts/:id/…`) refuses one that the
  session's Login does not own with `404 GAME_ACCOUNT_NOT_FOUND` — absence, not a 403, the same rule
  as Characters today.
- No request body, query or header ever supplies a `loginId` or an `accountId`.

### 4.8 Migration

| Step | What | Kind |
|---|---|---|
| **M1** `pre4_login_expand` | create `Login`; add nullable `Account.loginId` and `AuthIdentity.loginId`; backfill — for each `Account`, one `Login` with `createdAt = Account.createdAt` and a fresh id; each `AuthIdentity.loginId` from its Account's new Login | additive |
| **M2** `pre4_login_contract` | `NOT NULL` on both columns, both foreign keys, both indexes; drop `AuthIdentity.accountId`, with its FK and index | contract |

Code switches between M1 and M2: sign-in writes `loginId`, and nothing reads
`AuthIdentity.accountId`. Both migrations and the switch ship in one PR. There is no production
data; the split keeps each step reviewable and a failure forward-fixable.

### 4.9 Transactions and concurrency

- Sign-in is one transaction. Two concurrent first sign-ins with one handle race on
  `(provider, subject)`. **New requirement:** the loser catches the unique violation, re-reads, and
  continues with the winner's Login. Today the loser simply fails; PRE-4 fixes it because sign-in
  now also provisions.
- Provisioning locks the Login row, then re-checks under the lock that the Login owns no Game
  Account. Two concurrent sign-ins of a Login that has none therefore create one Game Account, not
  two.
- Lock order: **Login → Game Account → Character → …** — the existing order of
  `DATA_ARCHITECTURE.md` §4 with the Login in front.

### 4.10 Failure modes

| Failure | Behaviour |
|---|---|
| a legacy cookie `{ accountId, sessionId }` without `loginId` | unauthenticated (`openSession` returns null); the client signs in again. Pre-launch, so no migration of cookies |
| the session's Game Account was purged | `401 SESSION_GAME_ACCOUNT_GONE`, cookie cleared |
| `AuthIdentity` points at a missing Login | impossible: FK |

### 4.11 Rollback

Each migration is one transactional DDL script: a failure leaves the previous schema. Forward-only,
like every migration in the repository. A bad deploy is fixed forward.

### 4.12 Compatibility

- **Web:** reads neither `accountId` nor `loginId` (no occurrence under `apps/web/app`). Existing
  401 handling covers `SESSION_GAME_ACCOUNT_GONE`.
- **Tests:** `tests/support/db.ts` — `seedAccount` creates its Login first; `truncateAll` adds
  `Login` and the §5 tables.
- **API:** responses gain fields; none is removed.

### 4.13 Non-goals

Game Account names (GA9, GA-O11), listing UX, switching, an explicit create route, Login deletion,
moving entitlements or sessions to the Login (GA-O8), production authentication.

### 4.14 Open, and why each can wait

| # | Item | Why PRE-4 need not decide it |
|---|---|---|
| GA-O8 | the level that owns entitlements, sessions, the newest-connection rule and the activity claim — and whether an entitlement's time runs while its Game Account is pending | PRE-4 keeps every one of them where it is, on the Game Account. No production path grants a time-limited entitlement, so the pending-time question has no observable effect until one does; the phase that sells one decides it first |
| GA-O10 | the full create / list / switch UX | PRE-4 needs only SD-3's minimum; Phase 4A builds the UX over `createGameAccount` |
| GA-O11 | Game Account names and their uniqueness | PRE-4 adds no Game Account name. The phase that adds one decides GA-O11 first |

### 4.15 Exit criteria

LGN1–LGN9 pass; `AuthIdentity` has no `accountId`; the purge (§5) deletes an `Account` row while
its Login and credentials survive.

---

## 5. G4.1 — Game Account deletion lifecycle

### 5.1 Purpose and locked behaviour

Everything in `ADR-024` §1 and `PHASE_GATES.md` § *G4.1*, restated only as a checklist. §5.17 maps
each gate bullet to a section and to matrix cases.

- The target is the whole Game Account (GD1). The Login and its other Game Accounts survive
  untouched (GD2).
- `ACTIVE` → `PENDING_DELETION` → exactly 720 elapsed hours → hard purge, unless restored (GD3, T1).
- The whole Game Account is frozen, time included (GD4, FZ1–FZ2). Restore is exact and credits
  nothing (FZ3).
- The purge removes all live Game Account state (GD5). Nothing transfers (GD6). No replacement
  Main (GD7). A Companion goes only with its Game Account (GD8).
- One lifecycle for every source, and no bypass (GD9–GD10).
- Names stay reserved until the successful purge (NM1–NM3).
- An internal history record; no public Deleted List (HR1–HR5).
- The purge is atomic, idempotent, race-safe and retried; a failed due purge is a monitored,
  degraded condition (FZ4–FZ6, `ADR-020` §7).
- **PO-1:** the ledger and entitlement-audit history moves to an append-only archive outside live
  state.

### 5.2 Evidence

§2, rows *Deletion*, *Retirement filters*, *Foreign keys*, *Ledger*, *App role*, *Stamina*,
*Idempotency*, *Settlement ids*, *Redis*, *Worker*.

### 5.3 State machine and data model

```text
            request (quiescent)                     purge (server now ≥ purgeAt)
   ACTIVE ───────────────────────► PENDING_DELETION ─────────────────────────────► (row deleted)
     ▲                                   │
     └────────── restore (now < purgeAt) ┘
```

```prisma
enum GameAccountLifecycle {
  ACTIVE
  PENDING_DELETION
}

/// Who asked. PRE-4 builds only PLAYER. A moderation or operator source is added by the phase
/// that builds moderation tooling, through this same lifecycle (GD9–GD10, DEL-O3).
enum DeletionSource {
  PLAYER
}

model Account {
  lifecycle           GameAccountLifecycle @default(ACTIVE)
  deletionRequestedAt DateTime?
  purgeAt             DateTime?
  deletionSource      DeletionSource?
  /// The last restore. Stamina resumes from here (SD-7). Never cleared.
  lastRestoredAt      DateTime?
  @@index([lifecycle, purgeAt])
}
```

Hand-written, in the same migration (**M5** `pre4_game_account_lifecycle`):

```sql
ALTER TABLE "Account" ADD CONSTRAINT "Account_lifecycle_shape_check" CHECK (
  ("lifecycle" = 'ACTIVE'
     AND "deletionRequestedAt" IS NULL AND "purgeAt" IS NULL AND "deletionSource" IS NULL)
  OR
  ("lifecycle" = 'PENDING_DELETION'
     AND "deletionRequestedAt" IS NOT NULL AND "deletionSource" IS NOT NULL
     AND "purgeAt" = "deletionRequestedAt" + INTERVAL '720 hours')
);
```

`GAME_ACCOUNT_DELETION_GRACE = hours(720)` joins the **locked** constants in `@global-idle/shared`.
It is not a tunable (`ADR-025` NC7, §9).

### 5.4 Request

`requestGameAccountDeletion(tx, { loginId, accountId, source: 'PLAYER' })` —
`POST /api/game-accounts/:id/deletion`, in **one transaction**:

1. `SELECT … FROM "Account" WHERE id = $1 FOR UPDATE`. Missing, or another Login's:
   `404 GAME_ACCOUNT_NOT_FOUND`.
2. **Read the server clock after the lock** (`now`).
3. Already `PENDING_DELETION`: return the stored `{ deletionRequestedAt, purgeAt }` and change
   nothing — a repeat neither extends nor restarts the grace.
4. **Quiescence** — `assertQuiescent(tx, accountId)`, one function that every later obligation
   joins. In PRE-4 it refuses with `409 GAME_ACCOUNT_NOT_QUIESCENT` when:
   - any `OccupancyClaim` names one of its Characters;
   - a `SessionBoundActivity` of the Game Account is `ONLINE_ACTIVE` or `RECONNECT_GRACE_PAUSED`;
   - a `SkillTrainingActivity` of the Game Account is `ACCRUING`.

   Configured state — loot policy, slot routing, and later the configured Active Party — does not
   block a request (`ADR-024` §2). Later phases add a lobby, a frozen plan and live obligations to
   this same function.
5. **Settle each Character's Stamina up to `now`**, with occupancy none (FZ1).
6. Set `lifecycle = PENDING_DELETION`, `deletionRequestedAt = now`,
   `purgeAt = now + GAME_ACCOUNT_DELETION_GRACE`, `deletionSource = source`.
7. After commit: invalidate `activity:claim:<accountId>`; record `game-account.deletion-requested`
   with the id and `purgeAt`, and no name.

No route, parameter or domain function accepts a `purgeAt` or a duration. The only writer of
`purgeAt` is step 6.

### 5.5 The freeze

**The guard.** `assertGameAccountActive(tx, accountId, lock: 'share' | 'update')` —
`SELECT "lifecycle" FROM "Account" WHERE id = $1 FOR SHARE` (or `FOR UPDATE`), then
`409 GAME_ACCOUNT_PENDING_DELETION` unless `ACTIVE`, and `401 SESSION_GAME_ACCOUNT_GONE` if the row
is missing. It is **the first statement** of every mutating transaction: before the Character lock,
so the lock order holds, and inside the transaction, so no race window remains. The idempotency
record is written in the same transaction (`platform/idempotency`), so a refused or rolled-back
command leaves no record naming the Game Account.

**Every route, decided.** The per-command test (FRZ1) derives the route list from the Nest router
at runtime, so a route added later without a decision fails it.

| Route | Pending Game Account |
|---|---|
| `POST /api/session`, `DELETE /api/session` | allowed — Login-level |
| `POST /api/game-accounts/:id/restore` | allowed — the one command (§5.6) |
| `POST /api/game-accounts/:id/deletion` | returns the existing deadline |
| `POST /api/characters` | refused — also GD7: nothing creates a Character in a pending or purged Game Account |
| `POST /api/characters/:id/hunt` | refused |
| `DELETE /api/characters/:id/activity` | refused |
| `POST /api/characters/:id/hunt/advance` | refused |
| `POST /api/characters/:id/hunt/heartbeat` | refused |
| `POST /api/characters/:characterId/items/move` | refused |
| `POST /api/characters/:characterId/slots/:slotIndex/unlock` | refused |
| `PUT /api/characters/:characterId/slots/:slotIndex/routing` | refused |
| `PUT /api/characters/:characterId/loot-policy` | refused |
| `POST /api/characters/:characterId/service/buy` | refused |
| `POST /api/characters/:characterId/service/sell` | refused |
| `POST /api/characters/:characterId/stash/deposit` | refused |
| `POST /api/characters/:characterId/stash/withdraw` | refused |
| `POST /api/characters/:characterId/gold/deposit` | refused |
| every `GET` | allowed and **non-settling** (SD-6): `staminaView` returns the stored value for a pending Game Account; the Hunt snapshot is already a pure read |

**Domain entry points** outside a route take the same guard: `createCharacter`, `startSessionBound`
with `startRun`, Hunt settlement (`advance`, `endRun`), every items-context mutation
(`contexts/items/service.ts`, `slots.ts`, `stash.ts`, `routing.ts`, `policy.ts`, `move.ts`). The
ledger's `post` adds a **backstop**: a plain, lock-free read that throws unless the subject's Game
Account is `ACTIVE`. It catches a path that forgot the guard. It never replaces the guard, and it
takes no lock, because a lock taken that late would break the lock order. The grace-expiry sweep
never meets a pending Game Account, because quiescence left it no Activity.

**Time is frozen (FZ2).** Stamina is the only time-derived Game-Account-owned value today. It is
settled at the request and then settles nothing. Active-use timers own nothing yet. Entitlements
are §4.14's GA-O8.

**Destinations.** No command today names another Game Account or its Characters as a destination
or counterparty. The first phase that adds one — trade, mail, co-op — MUST refuse a pending
counterparty, and its test joins FRZ.

### 5.6 Restore

`restoreGameAccount(tx, { loginId, accountId })` — `POST /api/game-accounts/:id/restore`, in
**one transaction**:

1. `FOR UPDATE` on the Game Account. Missing — never existed, another Login's, or already purged:
   `404 GAME_ACCOUNT_NOT_FOUND`.
2. **Server clock after the lock.**
3. `ACTIVE`: return `ACTIVE` and change nothing (idempotent).
4. `now ≥ purgeAt`: `409 RESTORE_WINDOW_CLOSED`, whether or not the purge has run — the
   comparison is inclusive at the deadline.
5. Set `lifecycle = ACTIVE`, clear the three deletion columns, set `lastRestoredAt = now`. Nothing
   else is written.

**What *exactly* means (FZ3).** A snapshot of the closure (§5.8) taken just after the request
commits equals a snapshot taken just after the restore commits, column by column, JSON included.
The only exception is the Game Account row's own lifecycle columns: `lifecycle`,
`deletionRequestedAt`, `purgeAt`, `deletionSource` and `lastRestoredAt`. Stamina resumes from
`max(CharacterStamina.updatedAt, Account.lastRestoredAt)` (SD-7). Immediately after a restore it
equals its value at the request; an hour later it has recovered exactly one hour's worth, counted
from the restore instant.

### 5.7 The purge

**Capability (SD-8).** Created in migration **M6** `pre4_purge_capability`:

```sql
-- inside an IF NOT EXISTS block, as the Phase 0B migration creates "globalidle_app".
-- The migration runs as the database owner, like every migration.
CREATE ROLE "globalidle_purge" NOLOGIN;
GRANT SELECT ON "Account", "Entitlement" TO "globalidle_purge";
GRANT SELECT, DELETE ON "LedgerEntry", "EntitlementAudit" TO "globalidle_purge";
GRANT INSERT ON "LedgerEntryArchive", "EntitlementAuditArchive" TO "globalidle_purge";

CREATE FUNCTION gi_archive_game_account_history(p_account_id text, p_purge_id text)
  RETURNS TABLE (ledger_rows bigint, audit_rows bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ … $$;
ALTER FUNCTION gi_archive_game_account_history(text, text) OWNER TO "globalidle_purge";
REVOKE ALL ON FUNCTION gi_archive_game_account_history(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gi_archive_game_account_history(text, text) TO "globalidle_app";
REVOKE ALL ON "LedgerEntryArchive", "EntitlementAuditArchive" FROM "globalidle_app";
REVOKE SELECT, UPDATE, DELETE ON "GameAccountDeletionRecord" FROM "globalidle_app";  -- INSERT only
```

The function body, in order:

1. Refuse with `RAISE EXCEPTION 'gi_purge_not_due'` unless an `Account` row with
   `id = p_account_id`, `lifecycle = 'PENDING_DELETION'` and `"purgeAt" <= now()` exists. The
   application has already decided due-ness on the **server** clock. This second check on the
   database clock is defence in depth: even a deliberate call from the application role cannot reach
   a Game Account that is not due.
2. Copy the Game Account's ledger rows —
   `INSERT INTO "LedgerEntryArchive" … SELECT … FROM "LedgerEntry" WHERE "accountId" = p_account_id`
   — then `DELETE` the same rows. BANK and POUCH rows both carry the Game Account's `accountId`.
3. The same for `EntitlementAudit` rows whose `Entitlement.accountId = p_account_id`, into
   `EntitlementAuditArchive`.
4. Return both counts. The caller asserts `archived = deleted` for each.

`D9` is unchanged: the application role still has no `UPDATE` or `DELETE` on `LedgerEntry`.

**The transaction (SD-9)** — `purgeGameAccount(tx, accountId, now)`, one per Game Account:

| Step | Statement | Why here |
|---|---|---|
| 0 | `FOR UPDATE` on the `Account` row; skip if missing, `ACTIVE`, or `now < purgeAt` (server clock after the lock) | serialises against restore, request and every guarded command |
| 1 | `FOR UPDATE` on its `Character` rows, ascending id; read names, vocations, `baseLevel` and `Account.createdAt` for §5.10 | lock order |
| 2 | re-check quiescence, and that no `ActivityParticipant` of its Characters sits in another Game Account's Activity. Any hit: **refuse**, roll back, raise the `purge_refused` alarm | cannot happen after §5.4; if it does, deleting would be wrong |
| 3 | `SELECT * FROM gi_archive_game_account_history(A, purgeId)` | removes the ledger rows that reference `Account` and `Character` |
| 4 | `DELETE FROM "CurrencyBalance" WHERE "accountId" = A` | BANK and POUCH projections |
| 5 | `DELETE FROM "SettlementOperation" WHERE "operationId" LIKE 'settle:' \|\| activityId \|\| ':%'` for each of its Activities | string-keyed ids (§5.8) |
| 6 | `DELETE FROM "HuntRun" WHERE "activityId" = ANY(:activityIds)` | → `Activity`, `Character` |
| 7 | `DELETE FROM "SkillTrainingActivity" WHERE "activityId" = ANY(:activityIds)` | → `ActivityParticipant` |
| 8 | `DELETE FROM "SessionBoundActivity" WHERE "activityId" = ANY(:activityIds)` | → `Activity` |
| 9 | `DELETE FROM "ActivityParticipant" WHERE "activityId" = ANY(:activityIds)` | → `Activity`, `Character` |
| 10 | `DELETE FROM "Activity" WHERE "accountId" = A` | → `Account` |
| 11 | `DELETE FROM "CharacterContainerSlot" WHERE "characterId" = ANY(:characterIds)` | → installed container |
| 12 | `ItemInstance` of `accountId = A`, **leaves first**: repeat `DELETE FROM "ItemInstance" i WHERE i."accountId" = A AND NOT EXISTS (SELECT 1 FROM "ItemInstance" c WHERE c."containerId" = i.id)` until it deletes 0 rows | the self-referencing container FK is `RESTRICT`, and nesting depth is not fixed. Selecting by `accountId`, not `characterId`, reaches the Depot — and a future bound item stored there |
| 13 | `DELETE FROM "StashEntry" WHERE "accountId" = A` | |
| 14 | `DELETE FROM "CharacterStamina"`, `"CharacterLootPolicy" WHERE "characterId" = ANY(:characterIds)` | |
| 15 | `DELETE FROM "IdempotencyRecord" WHERE "principalId" = A` | SD-11 |
| 16 | `DELETE FROM "Entitlement" WHERE "accountId" = A` | its audit rows left in step 3 |
| 17 | insert the history record (§5.10) — raw `INSERT`, no `RETURNING` | written in the final boundary (HR2) |
| 18 | `DELETE FROM "Character" WHERE "accountId" = A` | **releases the names at commit** (NM2) |
| 19 | `DELETE FROM "Account" WHERE id = A` | last |
| — | **commit** | |
| 20 | after commit: `DEL activity:claim:A`; record `game-account.purged` with counts and no name; metrics | Redis holds only rebuildable state (`ADR-009`), and the key's 30-second TTL bounds a lost `DEL` |

No `ON DELETE CASCADE` is added. Every `RESTRICT` foreign key stays, as the guard against every
path but this one (`PHASE_GATES.md` G4.1).

**The job (SD-10).** In `apps/worker`, a `game-account-purge` scheduler on `activity-maintenance`,
every 60 seconds. It selects
`id FROM "Account" WHERE lifecycle = 'PENDING_DELETION' AND "purgeAt" <= :now ORDER BY "purgeAt"
LIMIT 50`, without a lock, and purges each id in its own transaction. A failure is caught per Game
Account, logged, counted and left for the next sweep; the rest continue. No route triggers,
advances or undoes a purge (`CLIENT_SERVER_BOUNDARIES.md`).

### 5.8 The closure inventory

**Declaration (SD-12).** `packages/domain/src/contexts/identity/deletion/closure.ts` declares one
entry per table and one per foreign key. The test CLO1 reads `pg_constraint` and
`information_schema.tables` and fails on any table or FK without a declaration, and on any
declaration without a table or FK. Actions use `ADR-020` §6's vocabulary, with PO-1's
**HISTORICALIZE** (moved to the archive).

**Tables** — every table at `23e1c60`, plus PRE-4's new ones:

| Table | Reaches the Game Account through | Action | Step |
|---|---|---|---|
| `Login` | parent of `Account` | **KEEP** (GD2) | — |
| `AuthIdentity` | `loginId` → `Login` | **KEEP** | — |
| `Account` | the root | DELETE-OWNED, last | 19 |
| `Character` | `accountId` | DELETE-OWNED | 18 |
| `CharacterStamina` | `characterId` | DELETE-OWNED | 14 |
| `CharacterLootPolicy` | `characterId` | DELETE-OWNED | 14 |
| `CharacterContainerSlot` | `characterId` | DELETE-OWNED | 11 |
| `ItemInstance` | `accountId` — every custody, the Depot included | DELETE-OWNED | 12 |
| `StashEntry` | `accountId` | DELETE-OWNED | 13 |
| `CurrencyBalance` | `accountId` — BANK and POUCH | DELETE-OWNED | 4 |
| `LedgerEntry` | `accountId` — BANK and POUCH | **HISTORICALIZE** → `LedgerEntryArchive` (PO-1) | 3 |
| `Entitlement` | `accountId` | DELETE-OWNED | 16 |
| `EntitlementAudit` | `entitlementId` → `Entitlement.accountId` | **HISTORICALIZE** → `EntitlementAuditArchive` (PO-1) | 3 |
| `Activity` | `accountId` | DELETE-HISTORY | 10 |
| `SessionBoundActivity` | `(activityId, accountId, family)` | DELETE-HISTORY | 8 |
| `SkillTrainingActivity` | `activityId` | DELETE-HISTORY | 7 |
| `HuntRun` | `activityId`, `characterId` | DELETE-HISTORY | 6 |
| `ActivityParticipant` | `activityId`, `characterId` | DELETE-HISTORY | 9 |
| `OccupancyClaim` | `(activityId, characterId)` | **REFUSE** — cannot exist after quiescence | 2 |
| `SettlementOperation` | `operationId` embeds the Activity id | DELETE-HISTORY | 5 |
| `IdempotencyRecord` | `principalId` = the Game Account id | DELETE-HISTORY (SD-11) | 15 |
| `ActiveUseTimer` | none — no owner column today | **KEEP**. The phase that gives a timer an owner declares it, and CLO1 forces the declaration | — |
| `ContentBundle` | parent of `Activity.contentVersion` | **KEEP** (`ADR-016`) | — |
| `LedgerEntryArchive` *(new)* | `accountId` text, no FK | written by step 3; **declared non-live** | 3 |
| `EntitlementAuditArchive` *(new)* | `accountId` text, no FK | written by step 3; **declared non-live** | 3 |
| `GameAccountDeletionRecord` *(new)* | `gameAccountId` text, no FK | written by step 17; **declared non-live** | 17 |
| `_prisma_migrations` | none | **KEEP** — system | — |

**Foreign keys** — all 26 at `23e1c60`, every one `ON DELETE RESTRICT` and kept so:

| # | From | To | Removed before its target by step |
|---|---|---|---|
| 1 | `AuthIdentity.accountId` | `Account` | **replaced** by `AuthIdentity.loginId → Login` (M2) |
| 2 | `Entitlement.accountId` | `Account` | 16 |
| 3 | `EntitlementAudit.entitlementId` | `Entitlement` | 3 |
| 4 | `Character.accountId` | `Account` | 18 |
| 5 | `CharacterStamina.characterId` | `Character` | 14 |
| 6 | `Activity.accountId` | `Account` | 10 |
| 7 | `Activity.contentVersion` | `ContentBundle` | — (bundle kept) |
| 8 | `SessionBoundActivity (activityId, accountId, family)` | `Activity` | 8 |
| 9 | `SkillTrainingActivity (activityId, family)` | `Activity` | 7 |
| 10 | `SkillTrainingActivity (activityId, traineeCharacterId)` | `ActivityParticipant` | 7 |
| 11 | `ActivityParticipant (activityId, family)` | `Activity` | 9 |
| 12 | `ActivityParticipant.characterId` | `Character` | 9 |
| 13 | `OccupancyClaim (activityId, characterId)` | `ActivityParticipant` | refused at 2 |
| 14 | `HuntRun.activityId` | `Activity` | 6 |
| 15 | `HuntRun.characterId` | `Character` | 6 |
| 16 | `LedgerEntry.accountId` | `Account` | 3 |
| 17 | `LedgerEntry (characterId, accountId)` | `Character (id, accountId)` | 3 |
| 18 | `CurrencyBalance.accountId` | `Account` | 4 |
| 19 | `CurrencyBalance (characterId, accountId)` | `Character (id, accountId)` | 4 |
| 20 | `ItemInstance.accountId` | `Account` | 12 |
| 21 | `ItemInstance (characterId, accountId)` | `Character (id, accountId)` | 12 |
| 22 | `ItemInstance (containerId, characterId)` | `ItemInstance (id, characterId)` | 12, leaves first |
| 23 | `CharacterContainerSlot.characterId` | `Character` | 11 |
| 24 | `CharacterContainerSlot (containerInstanceId, characterId, slotIndex)` | `ItemInstance` | 11 |
| 25 | `StashEntry.accountId` | `Account` | 13 |
| 26 | `CharacterLootPolicy.characterId` | `Character` | 14 |
| new | `AuthIdentity.loginId`, `Account.loginId` | `Login` | never — the Login is kept |

**String-keyed references** — declared in the same file, and proven by the post-purge scan:

| Where | Embeds | Handled by |
|---|---|---|
| `IdempotencyRecord.principalId`, `.result` | the Game Account id; Character and Activity ids | step 15 |
| `SettlementOperation.operationId` | `settle:<activityId>:<seq>[:timer:<id>\|:stop:<id>]` | step 5 |
| `LedgerEntry.subjectId`, `.operationId` | the Game Account id (BANK subject; item-command ids `<namespace>:<accountId>:<key>`); Character ids (POUCH subject; `hunt.death:<characterId>:<iso>`); Activity ids (`settle:…:gold`) | step 3 — the archive keeps them, outside live state |
| `CurrencyBalance.subjectId` | the Game Account or Character id | step 4 |
| `SessionBoundActivity.claimHolderSessionId` | a session id, not an account id | step 8 |
| `HuntRun.creatures`, `.position`, `.rngState` (JSON) | creature keys and tiles only | step 6 |
| Redis `activity:claim:<accountId>` | the Game Account id | step 20 |
| Redis `bull:*` | grace-expiry data: `activityId` and `correlationId` only | no Game Account or Character id; completed jobs age out (`removeOnComplete: 100`) |

**The binding can be followed.** Items are selected by `accountId` (step 12), never only by
`characterId`. When `ADR-021`'s binding arrives, its reference to `Character` is a new FK that CLO1
refuses until it is declared. A bound item in the Depot is already inside step 12's selection.

### 5.9 The ledger archive — PO-1

```prisma
/// Append-only. Outside live state: nothing computes a balance, a custody or a claim from it.
model LedgerEntryArchive {
  id          String   @id           // the original LedgerEntry id
  accountId   String                 // no FK — the purged Game Account
  subjectId   String
  custody     String                 // text, so a later enum change cannot break it
  characterId String?
  currency    String
  amount      BigInt
  reasonCode  String
  operationId String
  createdAt   DateTime
  purgeId     String                 // = GameAccountDeletionRecord.id
  archivedAt  DateTime
  @@index([accountId])
  @@map("LedgerEntryArchive")
}

model EntitlementAuditArchive {
  id            String   @id         // the original EntitlementAudit id
  entitlementId String
  accountId     String               // from the Entitlement, so the row stays attributable
  kind          String
  transition    String
  occurredAt    DateTime
  reason        String
  purgeId       String
  archivedAt    DateTime
  @@index([accountId])
  @@map("EntitlementAuditArchive")
}
```

- **Privileges:** `globalidle_app` has none. `globalidle_purge` has `INSERT` only. No role but the
  owner can `UPDATE` or `DELETE`.
- **Outside live state:** no domain or API code reads either table (LDA5 scans the source). Balance
  reconciliation (I5) runs over live scopes only.
- **Retention and access** are pre-launch questions (`PHASE_GATES.md` § *Pre-launch*), like the
  history record's.
- **`HR4` still holds:** the archive is not a destroyed-value inventory, and nothing reports one.

### 5.10 The internal history record — SD-13

```prisma
/// HR2–HR5. Written by the purge, once. Never read by gameplay. Never a live reference.
model GameAccountDeletionRecord {
  id                  String   @id        // the purge id; LedgerEntryArchive.purgeId points here
  gameAccountId       String   @unique    // HR3's "Game Account reference" — no FK
  deletionSource      String
  deletionRequestedAt DateTime
  purgeAt             DateTime
  purgedAt            DateTime
  main                Json?               // { name, vocation, level } — null only if none existed
  companions          Json     @default("[]")   // [{ name, vocation, level }] — always [] in PRE-4
  campaignSummary     Json                // { gameAccountCreatedAt, charactersPurged }
  @@map("GameAccountDeletionRecord")
}
```

- **Mandatory:** `id`, `gameAccountId`, `deletionSource`, `deletionRequestedAt`, `purgeAt`,
  `purgedAt`, `campaignSummary`.
- **Optional support fields** — HR3's, present when there is something to hold: `main` and
  `companions`. `level` is the `baseLevel` at the accepted request, one number, because the grace
  is a full freeze (`ADR-024` §4).
- **Never held:** a Character id, a Login id, a Gold or item amount (HR4), a claim, a custody.
- **The *broad campaign summary*** in PRE-4 is `{ gameAccountCreatedAt, charactersPurged }`. A later
  phase may extend it only within HR3 and HR5 — for example with tutorial completion — and its
  specification names the field.
- **Privileges:** `globalidle_app` has `INSERT` only. It has no `SELECT`, `UPDATE` or `DELETE`,
  which is why step 17 inserts without `RETURNING`.
- **Written once:** `gameAccountId` is unique, and the insert is inside the purge's one
  transaction, so a record exists exactly when its purge committed.
- **Not a reservation (NM3):** it takes part in no unique index. **No public Deleted List (HR1):**
  no route, view or export reads it.

### 5.11 Failures, retries and observability

| Failure | Result |
|---|---|
| any statement of the purge fails — a bug, a constraint, a lost connection, the function's refusal | the transaction rolls back; the Game Account is whole, still `PENDING_DELETION`, **non-playable** (frozen), **non-restorable** (`now ≥ purgeAt`) and **name-reserving** (its rows exist). The next sweep retries it |
| the purge finds an occupancy claim or a foreign participant | **refused**, rolled back, `purge_refused` alarm |
| the worker is down | nothing is purged; the overdue gauge climbs and alerts |
| Redis `DEL` fails after commit | the key expires within its 30-second TTL; the next read misses it and rebuilds from PostgreSQL, where the Game Account no longer exists |
| a restore and a purge race at `purgeAt` | both take `FOR UPDATE` on the Game Account first and read the clock after the lock; exactly one decides |

**Metrics** (`platform/metrics`, reported on `/metrics`):

- `game_account_deletion_requests_total{source}`
- `game_account_restores_total`
- `game_account_purges_total{outcome="purged"|"failed"|"refused"}`
- `game_account_purges_overdue` — a gauge: `PENDING_DELETION` with `purgeAt` passed
- `game_account_purge_oldest_overdue_seconds` — a gauge
- `game_account_deletion_records_total`, which must equal `purges_total{purged}` —
  `OPERATIONS_ARCHITECTURE.md` makes a difference an integrity alarm

The numeric lateness target and the alert thresholds stay pre-launch obligations
(`PHASE_GATES.md` § *Pre-launch*). PRE-4 ships the signals, not the numbers.

### 5.12 The post-purge scan

A test utility, `tests/support/post-purge-scan.ts`, used by CLO4–CLO6.

- **PostgreSQL:** for every table in `information_schema.columns`, every `text`, `varchar`, `json`
  and `jsonb` column is searched for the purged Game Account id, each purged Character id, and each
  purged name, case-insensitively. Test names are chosen distinctive, so a hit is never a
  coincidence.
- **Declared non-live locations** are skipped by name, and each is asserted to contain the ids it is
  supposed to: `GameAccountDeletionRecord`, `LedgerEntryArchive`, `EntitlementAuditArchive`.
- **Redis:** `SCAN` every key; test each key name and each string value.
- **Bite check** (CLO6): a planted reference in a scratch table, and one in Redis, each make the
  scan fail.

### 5.13 Migration away from `retiredAt`

| Step | What |
|---|---|
| **M4** `pre4_retirement_and_names` | fail closed with `RAISE EXCEPTION` if any `Character."retiredAt" IS NOT NULL`, reporting the count (SD-14). Rebuild I1 as `UNIQUE (accountId, vocation)` over **every** row. Rebuild I1b as `UNIQUE (accountId) WHERE vocation IS NULL` over every row. Then the name key (§8.5) |
| code, with M4 | drop `retiredAt` from every read and count — the 4 API reads, `roster.ts`'s count and name check; remove `retireCharacter` and its export. Access becomes lifecycle-aware through the guard (§5.5) |
| **M7** `pre4_drop_retired_at` | drop `Character."retiredAt"`, after nothing reads it |

Matrix amendments to VERIFIED cases are listed in §14.2. None is deleted quietly.

### 5.14 Files likely to change

| File | Change |
|---|---|
| `packages/domain/prisma/schema.prisma` + migrations M1–M7 | §4.5, §5.3, §5.9, §5.10, §6.5, §8.5 |
| `packages/domain/src/contexts/identity/` | new `login.ts`, `game-account.ts`, `deletion/{request,restore,purge,quiescence,closure,history}.ts`; `index.ts` exports |
| `packages/domain/src/platform/session/index.ts` | `SessionPayload` gains `loginId` |
| `packages/domain/src/platform/errors/index.ts` | `GameAccountPendingDeletion`, `GameAccountNotQuiescent`, `RestoreWindowClosed`, `GameAccountNotFound`, `SessionGameAccountGone`, `PurgeRefused`, `isCharacterNameViolation` |
| `packages/domain/src/platform/jobs/index.ts`, `apps/worker/src/{queues,main}.ts`, `apps/worker/src/jobs/game-account-purge.ts` | the purge scheduler and handler |
| `packages/domain/src/platform/metrics/index.ts` | §5.11's metrics |
| `packages/domain/src/contexts/character/roster.ts`, `stamina/settlement.ts` | guard; no `retiredAt`; `nameKey`; SD-7 |
| `packages/domain/src/contexts/items/*.ts`, `contexts/hunt/run.ts`, `contexts/activity/lifecycle.ts` | the guard as the first statement |
| `apps/api/src/game/game.controller.ts`, `session.guard.ts`, `views.ts`, `errors.ts`, new `game-account.controller.ts` | sign-in (§4.6), session resolution (§4.7), routes (§5.4, §5.6), non-settling reads, error mapping |
| `packages/shared/src/constants.ts` | `GAME_ACCOUNT_DELETION_GRACE` |
| `tests/support/db.ts` and new suites | §14 |

### 5.15 API

| Route | Success | Errors |
|---|---|---|
| `POST /api/game-accounts/:id/deletion` | `200 { lifecycle: 'PENDING_DELETION', deletionRequestedAt, purgeAt }` — also for a repeat | `404 GAME_ACCOUNT_NOT_FOUND`, `409 GAME_ACCOUNT_NOT_QUIESCENT` |
| `POST /api/game-accounts/:id/restore` | `200 { lifecycle: 'ACTIVE' }` — also when already active | `404 GAME_ACCOUNT_NOT_FOUND`, `409 RESTORE_WINDOW_CLOSED` |
| any frozen route (§5.5) | — | `409 GAME_ACCOUNT_PENDING_DELETION` |
| any route, session's Game Account gone | — | `401 SESSION_GAME_ACCOUNT_GONE` |

Both commands are naturally idempotent — a repeat returns the same answer — so they carry no
`Idempotency-Key` (ADR-017 requires one for value-moving commands). They rely on the existing
`SameSite=Lax` cookie and the CORS allow-list: a cross-site `POST` carries no session cookie.

### 5.16 Authority, rollback and compatibility

- **Authority.** Only the owning Login, through its session (§4.7), requests or restores a Game
  Account. PRE-4 builds one source, `PLAYER`. The purge is **not a command**: only the worker runs
  it, and no client can trigger, advance or undo it.
- **Rollback.** Every lifecycle operation is one transaction, all or nothing. M5 and M6 only add;
  M4 and M7 fail closed before they change anything. A deploy rolled back before any purge ran is a
  forward fix. After a purge ran, its data is gone by design; only the archive and the history
  record remain.
- **Compatibility.** Legacy cookies are refused (§4.10). API responses gain fields and error codes;
  none is removed. `D9` is unchanged. The grace-expiry sweep is unchanged. Test helpers change as
  §4.12 and §8.8 say.

### 5.17 Gate traceability — `PHASE_GATES.md` § *G4.1*

| Gate requirement | Section | Cases |
|---|---|---|
| lifecycle on the Game Account, `purgeAt` stored, exactly 720 h, no shortening, no restart | §5.3, §5.4 | GAD1, GAD2, GAD7, GAD8 |
| one lifecycle for every source | §5.3 (`DeletionSource`), §5.7 | GAD8, PRG9 |
| quiescence; configured state does not block | §5.4 | GAD3–GAD6 |
| the whole Game Account frozen, per command | §5.5 | FRZ1–FRZ15 |
| the freeze includes time; no read settles | §5.5, SD-6, SD-7 | FRZ16, FRZ17 |
| other Game Accounts untouched | §5.5 | FRZ18, PRG5 |
| exact restoration; no catch-up | §5.6 | RST1, RST2 |
| restore at or after the deadline refused; nothing after purge | §5.6 | RST3, RST4 |
| restore / purge race | §5.6, §5.7 | RST6 |
| names reserved until the purge; reuse only after it | §5.7 step 18, §8 | NMS5, NMS6, PRG8 |
| the Login apart; how a Login with none starts a new one | §4 | LGN4, LGN5 |
| no replacement; no carry-over; companions only with the Game Account | §5.5, §5.7 | FRZ2, PRG6 |
| purge dependency graph derived from the schema, string keys included | §5.8 | CLO1–CLO3 |
| a policy for every `RESTRICT` FK; `CASCADE` only where safe | §5.8 | CLO1, CLO2 |
| idempotent; crash-safe; no duplication; no collateral | §5.7, §5.11 | PRG3–PRG6 |
| post-purge proof over PostgreSQL and Redis | §5.12 | CLO4–CLO6 |
| the history record | §5.10 | HIS1–HIS6 |
| no public Deleted List | §5.10 | HIS6 |
| no destroyed-value inventory; no general telemetry | §5.9, §5.10 | HIS2 |
| no damage to audit or analytics data it does not own | §5.7, §5.9 | PRG5, LDA4 |
| a closure that can follow a binding | §5.8 | CLO1, PRG12 |
| the purge under its own capability; the ledger choice | §5.7, §5.9 (PO-1) | PRG10, LDA1–LDA5 |
| due at the deadline; no early purge | §5.7 | PRG2, PRG9 |
| a failed purge is degraded, retried and alerting | §5.11 | PRG8 |
| overdue purges observable | §5.11 | PRG8 |
| retirement removed; migration forward-only, additive first; retired rows reported | §5.13 | PMG1–PMG6 |
| retirement tests superseded by explicit amendments | §14.2 | — |

### 5.18 Non-goals, open items and exit criteria

**Non-goals:** a moderation or operator deletion path (DEL-O3); a deletion UI; a Login deletion;
backups, log retention and restore-from-backup (pre-launch); access to the archive or the history
record (pre-launch).

**Open, and not blocking:**

| # | Item | Owner |
|---|---|---|
| DEL-O3 | who may start or restore a moderation deletion | the phase that builds moderation tooling |
| — | retention and access for the history record and the ledger archive | the pre-launch gate |
| — | the purge lateness target and alert thresholds | the pre-launch gate |
| — | restoring a backup that predates purges (`DATA_ARCHITECTURE.md`, *restores and Game Account deletion*) | the pre-launch gate |

**Exit:** GAD, FRZ, RST, PRG, CLO, HIS, LDA and PMG pass. D9 still passes unchanged. The
§14.2 amendments are applied.

---

## 6. G4.2 — `baseXp` → `baseLevel`

### 6.1 Purpose

`baseXp` is the durable truth and `baseLevel` its deterministic stored projection. That was decided
in Phase 2 and confirmed by the Product Owner on 2026-09-25. PRE-4 proves and **enforces** it on
every write path. It does not choose again, and it does not lock the curve.

### 6.2 Locked behaviour

- One authoritative projection function (I29).
- Every XP write updates both columns, in one transaction; a rollback reverts both.
- Migrations and backfills preserve the invariant.
- **The exact curve stays OPEN.** The implemented curve — Canary's `getExpForLevel` — remains the
  baseline until a later explicit product decision replaces it.

### 6.3 Evidence — every write path that exists today

| Path | Writes | Consistent today? |
|---|---|---|
| `createCharacter` (`roster.ts`) | `baseLevel` from its **free input**, `baseXp` left at the DB default 0 | only because every caller passes 1 |
| Hunt settlement (`run.ts`, `advance`) | `baseXp = total`, `baseLevel = levelForXp(total)` | yes |
| death penalty (`run.ts`, `settleDeathPenalty`) | `baseXp = experienceAfter`, `baseLevel = levelAfter = levelForXp(experienceAfter)` (`death.ts`) | yes |
| test helpers (`tests/support/phase2.ts`, `hunt-custody.test.ts`) | both, through `levelForXp` | yes |
| `seedCharacter` (`tests/support/db.ts`) | neither — defaults `0` / `1` | yes |

No reset or backfill path exists. No route accepts either value (CH8).

### 6.4 Target architecture

- **One module.** `contexts/character/progression.ts` owns `xpForLevel`, `levelForXp` and
  `levelProgress`, moved from `contexts/hunt/progression.ts`, which re-exports them so no import
  breaks.
- **One writer.** `writeBaseXp(tx, characterId, totalXp)` in the character context is the only code
  that writes `baseXp`, and it always writes `baseLevel = levelForXp(totalXp)` beside it. The Hunt
  settlement and death paths call it instead of `tx.character.update`.
- **Creation** takes `startingXp` (default `0n`), never a level: the Main starts at 0 XP, Level 1. A
  Phase 4 companion will pass `xpForLevel(8)`.
- **The database refuses an inconsistent pair (SD-17).** Migration **M3** `pre4_xp_projection`:

```sql
CREATE FUNCTION gi_xp_for_level(l integer) RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT (((((l::bigint - 6) * l + 17) * l - 12) / 6) * 100)
$$;
-- level search used only by the backfill; the CHECK needs only gi_xp_for_level
CREATE FUNCTION gi_level_for_xp(xp bigint) RETURNS integer
  LANGUAGE plpgsql IMMUTABLE STRICT AS $$ … $$;

-- report, then repair the projection from the truth
DO $$ … RAISE NOTICE 'PRE-4 G4.2: % Character rows had a stale baseLevel', n; … $$;
UPDATE "Character" SET "baseLevel" = gi_level_for_xp("baseXp")
 WHERE "baseLevel" <> gi_level_for_xp("baseXp");

ALTER TABLE "Character" ADD CONSTRAINT "Character_level_is_projection_of_xp_check"
  CHECK ("baseXp" >= gi_xp_for_level("baseLevel")
     AND "baseXp" <  gi_xp_for_level("baseLevel" + 1));
```

Integer division truncates toward zero in both TypeScript `bigint` and PostgreSQL `bigint`, and the
numerator is non-negative for every level ≥ 1, so both are floor division. XPP1 proves the two
transcriptions agree. **A curve change** is one migration: a new `gi_xp_for_level`, the backfill,
the CHECK re-created, and the TypeScript function changed in the same PR.

### 6.5 Data model

No new column. One CHECK and two functions (M3).

### 6.6 Transactions, retries and rollback

- The XP write sits inside the settlement transaction it belongs to, so rollback is all-or-nothing
  by construction.
- A retried settlement carries the same operation id and is a no-op (`SettlementOperation`, I7), so
  XP is never awarded twice.
- The guard (§5.5) runs first, so a pending Game Account's Character never gains or loses XP.

### 6.7 Preventing future drift

1. the CHECK — every path, SQL included;
2. `writeBaseXp` — the one application writer;
3. XPP9 — a source scan that fails when anything outside `writeBaseXp` and `tests/` writes
   `baseLevel`.

### 6.8 Remaining parts

| Part | G4.2 |
|---|---|
| Files | new `contexts/character/progression.ts` (the curve) and `contexts/character/xp.ts` (`writeBaseXp`); `contexts/character/roster.ts` (`startingXp`); `contexts/hunt/progression.ts` (re-export); `contexts/hunt/run.ts` (two call sites); `apps/api/src/game/game.controller.ts` (no `baseLevel` argument); M3; `tests/support/phase2.ts` (through `writeBaseXp`) |
| API / domain contract | `writeBaseXp(tx, characterId, totalXp: bigint)`; `createCharacter({ …, startingXp?: bigint })` with the `baseLevel` input removed. No route changes, and no route accepts XP or a level (CH8) |
| Authority | server only; no client value reaches either column |
| Failure modes | a write that breaks the projection is refused by the CHECK: the transaction rolls back, the request fails `500 INTERNAL`, and nothing is stored. A negative total is refused by the existing `baseXp >= 0` CHECK and by `levelForXp`'s `RangeError` |
| Idempotency / retry | settlement operation ids (I7): a replay awards nothing |
| Concurrency | XP writes run inside the settlement transaction, which holds the Character lock; two settlements of one run serialise on `HuntRun` (`lockHuntRun`) |
| Rollback | one statement inside the caller's transaction; M3 is transactional |
| Compatibility | `contexts/hunt/progression.ts` keeps its exports; the curve and every value are unchanged, so every verified Hunt and death case passes unmodified |
| Tests | XPP1–XPP9 (§14) |

### 6.9 Non-goals, open and exit

**Non-goals:** a new curve; Skills; level caps. **Open:** the exact XP curve (`DECISIONS.md` §
*Base XP and Base Level*). **Exit:** XPP1–XPP9 pass; M3 applied; no direct `baseLevel` write left.

---

## 7. G4.3 — the Actor / Participant contract

### 7.1 Purpose

Phase 4 brings up to four actors of one Game Account into one Activity; Phase 5B brings one actor
from each of several Game Accounts. PRE-4 fixes the **contract** both will use, so that no code in
between assumes an actor is the Login, the Game Account or the Main — without building either.

### 7.2 Locked behaviour — `PHASE_GATES.md` § *G4.3*

| Shape | Actors | PRE-4 |
|---|---|---|
| Rookgaard | exactly the Game Account's Main — from creation, vocationless, alone | **implemented**: today's only shape |
| the Main game | the Main plus up to three Companions of the same Game Account | **representable**; not built |
| later co-op | exactly one actor per participating Game Account, Main or Companion | **representable**; not built |

Settlement still knows the owning Game Account of every actor.

### 7.3 Evidence

The engine simulates one actor (`CHARACTER_ACTOR`) with one `CombatProfile`. `startSessionBound`
takes `participants: CharacterId[]` and writes `ActivityParticipant` rows. `HuntRun.characterId`
names the one Character. Settlement reads `Character.accountId` to find the POUCH (`run.ts`).

### 7.4 Target architecture — types

`packages/domain/src/contexts/activity/participants.ts`, exported from the activity context:

```ts
/** Every PvE Activity has one side. Team A vs Team B stays representable
 *  (MULTIPLAYER guardrail). */
export type SideId = 'PLAYERS';

/** An actor is a Character — never a Login, never a Game Account. */
export interface ActorRef {
  readonly kind: 'CHARACTER';
  readonly characterId: CharacterId;
}

/** The durable roster fact of one Activity, resolved at start and never
 *  re-derived from a session. */
export interface ParticipantSnapshot {
  readonly actor: ActorRef;
  /** Proven by the FK Character(id, accountId): the Character's own Game Account. */
  readonly owner: AccountId;
  readonly side: SideId;          // 'PLAYERS' for every PvE Activity
  readonly slotIndex: number;     // ActivityParticipant.slotIndex
}

export type ParticipationShape =
  | { readonly kind: 'SOLO_MAIN' }        // PRE-4: the only shape any code path creates
  | { readonly kind: 'PERSONAL_PARTY' }   // Phase 4: declared, no path creates it
  | { readonly kind: 'COOP' };            // Phase 5B: declared, no path creates it

/** Pure. Refuses 0 or 2+ participants for SOLO_MAIN, and an owner other than the Activity's. */
export function validateShape(
  shape: ParticipationShape,
  activityOwner: AccountId,
  participants: readonly ParticipantSnapshot[],
): void;

/** Pure. Groups settlement output by owner — the only way rewards find a Game Account. */
export function byOwner<T>(
  participants: readonly ParticipantSnapshot[],
  valueFor: (participant: ParticipantSnapshot) => T,
): ReadonlyMap<AccountId, readonly T[]>;
```

- `ActorRef`, `AccountId`, `LoginId` and `CharacterId` are **distinct branded types**. `LoginId` is
  new in `@global-idle/shared` `ids.ts`. An actor cannot be passed where an owner is expected
  (APC7).
- `PERSONAL_PARTY` and `COOP` have **no validator body** in PRE-4 beyond refusing use at runtime.
  Their rules — Main present, at most four, one per Game Account — are Phase 4's and 5B's to
  implement and test. APC4 and APC5 prove only that the types **represent** them.

### 7.5 Ownership resolution

`resolveParticipants(tx, activityId)`:

```sql
SELECT p."characterId", p."slotIndex", c."accountId" AS owner
  FROM "ActivityParticipant" p JOIN "Character" c ON c.id = p."characterId"
 WHERE p."activityId" = $1 ORDER BY p."slotIndex"
```

The owner comes from the Character row, never from the session and never from `Activity.accountId`.
For `SOLO_MAIN`, `validateShape` then checks it equals `Activity.accountId`.

### 7.6 The compatibility adapter

In `contexts/hunt/run.ts`:

- at start, `startSessionBound` still receives `[characterId]`; the Hunt builds its
  `ParticipantSnapshot[]` and validates `SOLO_MAIN`;
- at settlement, `resolveParticipants` → `validateShape(SOLO_MAIN)` → the one participant maps to
  the engine's single actor, `CHARACTER_ACTOR`;
- rewards are applied through `byOwner`: XP to `participant.actor` through `writeBaseXp` (§6), Gold
  to `pouchOf(participant.owner, participant.actor.characterId)`, items to the participant's
  Character in its owner's Game Account;
- `HuntRun.characterId` is asserted equal to the single participant's Character;
- events keep the actor id `'character'`, so the Game Window is untouched.

**Nothing changes in `packages/game-engine`.** Its public exports are identical before and after.

### 7.7 Persistence

**None (SD-20).** `ActivityParticipant` already stores the roster. A per-participant owner column
arrives with 5B, when participants of different Game Accounts first exist.

### 7.8 Tests

- **Behaviour unchanged:** every verified Hunt suite — SIM, SRC, ST, RW, DE, CX, PS, DL, GP, the
  Phase 3 Hunt cases, SPC, SNP, RND, MPV, PER, RNGC, SPD, GRD, BRK, THR, DET, CMP, DOM — passes
  **unmodified**. APC1 adds a golden comparison: for a fixed seed set, the settled `HuntRun`, ledger
  and item rows are byte-identical to those produced at `23e1c60`.
- **Contract:** APC2–APC8.

### 7.9 Remaining parts

| Part | G4.3 |
|---|---|
| Files | new `contexts/activity/participants.ts`; `contexts/activity/index.ts` (exports); `contexts/hunt/run.ts` (the adapter); `packages/shared/src/ids.ts` (`LoginId`); new `tests/integration/participants.test.ts` and a golden fixture captured at `23e1c60` |
| Data model, migration | none (SD-20) |
| Transactions | unchanged: participants are resolved inside the settlement transaction, after the guard and the Character lock |
| API / domain contract | §7.4; no route changes |
| Authority | the owner is read from the Character row, never from the session or a request |
| Failure modes | a shape violation — 0 or 2+ participants, a foreign owner — throws `ParticipationShapeViolation`, an internal invariant failure (`500`) that rolls the settlement back. No route can produce one today |
| Idempotency / retry, concurrency | unchanged — settlement operation ids and the existing locks |
| Rollback | code only: revert the commit |
| Compatibility | the adapter, the `'character'` actor id, and the golden comparison (APC1) |
| Tests | APC1–APC8, plus the unmodified verified Hunt suites |

### 7.10 Non-goals, open and exit

**Non-goals:** Party formation, companions, a multi-actor engine, lobbies, networking,
cross-account Activities, an owner column. **Open:** none new. **Exit:** APC1–APC8 pass; no verified
Hunt test changed.

---

## 8. G4.4 — globally unique Character names

### 8.1 Purpose and locked behaviour

- Character names are unique across the whole game and database (NM1). Mains and Companions share
  the namespace (`ADR-024` §6).
- A pending Game Account's names stay reserved; only the successful purge releases them
  (NM2). A history record never reserves one (NM3).
- **PO-2:** the comparison is **case-insensitive**, and the stored name keeps its capitalization.

### 8.2 Evidence

The validator admits 2–20 ASCII letters with single inner spaces, trimmed
(`game.controller.ts` — `NAME`). That settles Unicode normalization and whitespace: neither can
reach the database through the API. Uniqueness today is an application read, per Account, among
non-retired rows, compared exactly, under the Account lock. No database constraint exists.

### 8.3 Target

- `Character.nameKey` — `lower(name)` — with a **global unique index** (SD-16).
- A CHECK `("nameKey" = lower("name"))`, so the key cannot drift from the name.
- One canonical function, `characterNameKey(name) = name.toLowerCase()`, in the character context.
  For the ASCII names the validator admits, JavaScript's `toLowerCase` and PostgreSQL's `lower`
  agree. If they ever disagree, the CHECK refuses the write rather than storing two answers.
- **The database decides.** `createCharacter` drops its read-then-check and translates the unique
  violation on `Character_nameKey_key` into `CharacterNameTaken`.

### 8.4 Reserved names

**None exist, and PRE-4 adds none.** A reserved-name list is a product decision, and adding one
later is a validator change, not a schema change.

### 8.5 Data model and migration — M4, after the retirement step

```sql
ALTER TABLE "Character" ADD COLUMN "nameKey" TEXT;
UPDATE "Character" SET "nameKey" = lower("name");
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (SELECT "nameKey" FROM "Character" GROUP BY 1 HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRE-4 G4.4: % case-insensitive name collisions; resolve them first', n;
  END IF;
END $$;
ALTER TABLE "Character" ALTER COLUMN "nameKey" SET NOT NULL;
ALTER TABLE "Character" ADD CONSTRAINT "Character_nameKey_is_lower_name_check"
  CHECK ("nameKey" = lower("name"));
CREATE UNIQUE INDEX "Character_nameKey_key" ON "Character"("nameKey");
```

`schema.prisma` declares `nameKey String @unique`. **Existing collisions:** the migration fails
closed and reports them (SD-15). No production data exists; a development database resets.

### 8.6 Transactions and concurrency

- Creation runs in one transaction, after the guard. Two concurrent creations of `Rookie` and
  `ROOKIE` in two Game Accounts contend on the unique index: exactly one commits, and the other gets
  `409 NAME_TAKEN`.
- A pending Game Account's Characters still exist, so their keys stay in the index (NM2). The purge
  deletes the rows in step 18, and the keys free **at its commit**, never earlier.

### 8.7 API

`409 NAME_TAKEN`, the existing code, now global. The message does not say whether the holder is
pending: *"That name is taken."*

### 8.8 Compatibility

- `tests/support/db.ts` `seedCharacter` names become globally unique — the full id, not
  `id.slice(0, 8)`. A `uuidv7` built from the same `at` shares its first eight characters, so two
  seeds of one vocation at `T0` would now collide.
- `tests/support/phase2.ts` already randomizes (`hunter-<random>`).
- CH6 keeps passing unchanged: the same name on the same account is still refused. Its reason is
  now global.

### 8.9 Remaining parts

| Part | G4.4 |
|---|---|
| Files | `contexts/character/roster.ts` (no read-then-check; `nameKey`; the violation translated); new `contexts/character/names.ts` (`characterNameKey`); `platform/errors/index.ts` (`isCharacterNameViolation`); `schema.prisma`; M4; `tests/support/db.ts` (`seedCharacter`) |
| API / domain contract | `POST /api/characters` is unchanged in shape; `409 NAME_TAKEN` is now global |
| Authority | the name comes only from the request body, through the existing validator; `nameKey` is always computed on the server |
| Failure modes | a taken name is `409 NAME_TAKEN`; a `nameKey` that disagrees with `lower(name)` is a CHECK violation — `500` and a rollback, never a stored row |
| Idempotency / retry | creation carries no idempotency key today. A retried create of a taken name is refused, including the retry of a create that already committed — unchanged behaviour |
| Concurrency | §8.6: the unique index decides |
| Rollback | M4 is transactional and fails closed before it changes anything |
| Compatibility | §8.8 |
| Tests | NMS1–NMS8 |

### 8.10 Non-goals, open and exit

**Non-goals:** Game Account names (GA-O11); companion naming (GA-O7); a rename feature; reserved
names. **Open:** none. **Exit:** NMS1–NMS8 pass.

---

## 9. G4.5 — the tunable configuration surface

### 9.1 Purpose and locked behaviour

`ADR-025` CF1–CF6: one authoritative, server-side surface for PROVISIONAL and TUNABLE defaults.
Its values are validated in type and range, have safe defaults, are versioned and traceable, are
pinned for a running Activity, and have fixtures. NC1–NC9 are never configuration.

### 9.2 Evidence

§2, rows *Tunables* and *Content pinning*.

### 9.3 Target — SD-18

- **A new definition kind, `tunables`,** in `packages/game-data/src/schema.ts`, with exactly one
  definition per bundle, key `tunables.default`:

```ts
export const tunablesSchema = definitionSchema.extend({
  kind: z.literal('tunables'),
  label: z.string().min(1),
  values: z
    .object({
      'items.lootPouchSpaces': z.number().int().min(1).max(255).default(20),
      'items.depotSpaces': z.number().int().min(1).max(10_000).default(200),
      'items.stashMaxPerEntry': z.number().int().min(1).max(10_000_000).default(100_000),
    })
    .strict(),
});
```

  Every key has a type, a range and a **default equal to today's constant**. An unknown key, a wrong
  type or an out-of-range value fails the bundle build and the bundle load. It is never clamped or
  guessed at the point of use.
- **The two content tables** already marked `INITIAL/TUNABLE` — `rarity-table.*` and
  `container-slots.*` — are typed, validated bundle definitions today. They are registered as
  tunable kinds in the same registry, so the surface is the bundle and nothing is re-typed.
- **The registry.** `packages/game-data/src/tunables.ts` lists every tunable: `key`, `kind`,
  `classification` (`INITIAL/TUNABLE` or `PROVISIONAL`) and where it is read.
- **The accessor.** `tunable(bundle, 'items.depotSpaces')` is typed from the schema. A bundle with
  no `tunables` definition — every bundle published before PRE-4, which old Activities pin — yields
  the defaults. That is CF5's safe default, and it keeps a pinned run's values unchanged.
- **Pinned for a run** through `Activity.contentVersion` (`ADR-011`). No new column. A Hunt reads
  `items.lootPouchSpaces` from its pinned bundle. A command outside an Activity reads the current
  bundle, as it already does for item definitions.
- **Traceable:** a value change is a content change, which is a new bundle version with a checksum
  and a publish row (`ContentBundle`). The git history of `packages/game-data/content` says what
  changed.
- **Server only:** bundles are resolved on the server. No request field sets or overrides a tunable.
- **Fixtures:** tests build bundles with chosen `tunables` values.

### 9.4 The three constants move

`LOOT_POUCH_SPACES`, `DEPOT_SPACES` and `STASH_MAX_PER_ENTRY` leave `@global-idle/shared`. Their
readers — `contexts/hunt/run.ts`, `contexts/items/custody.ts`, `contexts/items/stash.ts` and
`apps/api/src/game/inventory.controller.ts` — read the accessor instead. Values are unchanged, so
every Phase 3 case passes unmodified.

### 9.5 What stays a constant — LOCKED, not tunable

`HUNT_CONTAINER_SLOTS`, `STAMINA_MAX`, `STAMINA_RECOVERY_BOUNDARY`, `RECONNECT_GRACE`, the roster
bounds, `ACTIVE_PARTY_MIN` and `_MAX`, `STACK_CEILING`, `GAME_ACCOUNT_DELETION_GRACE`, and the
source-backed capacity constants. Engineering constants — retry counts, sweep intervals — are not
gameplay tunables. None of NC1–NC9 appears in the schema (CFG8).

### 9.6 Remaining parts

| Part | G4.5 |
|---|---|
| Files | `packages/game-data/src/schema.ts` (the kind); new `packages/game-data/src/tunables.ts` (registry and accessor); `packages/game-data/content/rookgaard.json` (`tunables.default` with today's values) and its published bundle; `packages/shared/src/constants.ts` (three constants removed); `contexts/hunt/run.ts`; `contexts/items/custody.ts`; `contexts/items/stash.ts`; `apps/api/src/game/inventory.controller.ts` |
| Data model, migration | no database change. A content publish produces a new bundle version; older bundles stay pinned and read the defaults |
| Transactions | reads only. A command resolves its bundle exactly as it resolves item definitions today |
| API / domain contract | `tunable(bundle, key)`; no route changes. Views that show a limit — Loot Pouch spaces, Depot size — read it through the accessor |
| Authority | server only |
| Failure modes | an invalid bundle is refused at build and at load; a process that cannot load its current bundle refuses content, as today |
| Idempotency / retry | not applicable |
| Concurrency | a run reads its pinned bundle, so a publish mid-run changes nothing in it (CFG4) |
| Rollback | publish the previous content again; running Activities keep what they pinned |
| Compatibility | the defaults equal today's constants, and a bundle without the definition reads them |
| Tests | CFG1–CFG8 |

### 9.7 Non-goals, open and exit

**Non-goals:** a remote, live-ops or hot-reload platform — `ADR-025` rejects hot reload into running
Activities; a database table of settings; moving source-backed values. **Open:** which future values
join first is each phase's to declare, in the registry. **Exit:** CFG1–CFG8 pass; the three
constants no longer exist in `@global-idle/shared`.

---

## 10. Character-bound tutorial consumables — the PRE-4 boundary

**Locked, unchanged:** tutorial Health and Mana potions are Character-bound on the instance, and
share the ordinary potion's `ItemDefinition` (S7). They are used through the action slots, straight
from the Store Container (U5). Canary's `UNIQUEID` and `ACTIONID` are not a binding (B6). The
binding is immutable, referentially safe and discoverable by the purge closure.

**SD-19 (DEL-O5):** PRE-4 issues **no** bound potion and builds no Store Container. The starting
grant keeps granting ordinary potions until the phase that ships the Store Container and the potion
action slot — Phase 4 by the roadmap — converts them, behind GBC.1.

**What PRE-4 guarantees for that phase:**

- the purge selects items by `accountId` (§5.7 step 12), so a bound item in the Depot is purged;
- the binding's foreign key to `Character` fails CLO1 until it is declared, so it cannot be added
  without a purge action;
- the freeze guard covers every items-context mutation, so a bound-item move or use joins it by
  construction;
- nothing in PRE-4 relies on `characterId` alone to find a Character's items.

---

## 11. Combat — not expanded

The locked formulas — Attack Value, Max Base Damage, Defense Value, Armor Value, Mitigation, and no
hidden vocation multiplier — are governance input for the phase that implements them
([`DECISIONS.md`](../../DECISIONS.md) § *Combat formulas — weapon attack and defence*). **PRE-4
changes no combat code.** G4.2 needs no combat change. G4.3 wraps the engine and keeps its
behaviour byte-identical (APC1). The still-open items stay open: ranged Accuracy, the damage-roll
distribution and minimum, the rounding stages, tie, order and visual mapping, score comparison,
base vs effective Skill and Shielding, and the ShieldDefense edge cases. Phase 4A's combat
inspector reads whichever model is implemented when it runs.

---

## 12. Implementation order

Derived from the repository's dependencies, not assumed:

```text
 1  Login expand + switch + contract (M1, M2)   ── needed by the purge (the credential
                                                   outlives the Game Account row)
 2  XP projection (M3)                          ── independent; the history record reads levels
 3  Retirement removal + names (M4)             ── the freeze replaces retirement filters;
                                                   names must be reserved across Game Accounts
 4  Actor / Participant contract (no migration) ── independent; pure refactor under golden tests
 5  Configuration surface (content publish)     ── independent
 6  Lifecycle, request, freeze, restore (M5)    ── needs 1 (Login routes) and 3 (no retiredAt)
 7  Purge capability, archive, history, job,    ── needs 1, 3 and 6; the closure test
    closure, scan (M6)                             needs the final schema
 8  Drop retiredAt (M7) + matrix amendments     ── last: the only destructive contract step
```

- **Additive first:** M1, M3, M5 and M6 only add. M2, M4 and M7 contract, each after nothing reads
  what they remove.
- **Risk isolation:** steps 2, 4 and 5 touch no deletion code and prove themselves against the
  unchanged verified suites before the lifecycle lands.
- **No step passes the gate on its own.** The implementation is one PR series, and the gate is
  judged on its final head.

---

## 13. Migrations — consolidated

| # | Name | Kind | Adds | Removes | Fails closed when |
|---|---|---|---|---|---|
| M1 | `pre4_login_expand` | additive | `Login`; nullable `Account.loginId`, `AuthIdentity.loginId`; backfill | — | — |
| M2 | `pre4_login_contract` | contract | `NOT NULL`, FKs, indexes | `AuthIdentity.accountId` | a null `loginId` remains |
| M3 | `pre4_xp_projection` | additive | `gi_xp_for_level`, `gi_level_for_xp`, the CHECK; repairs stale levels, reporting the count | — | — |
| M4 | `pre4_retirement_and_names` | contract | I1, I1b over every row; `nameKey`, its CHECK and unique index | the partial indexes over `retiredAt IS NULL` | a row has `retiredAt` set; a case-insensitive collision exists |
| M5 | `pre4_game_account_lifecycle` | additive | two enums; five `Account` columns; the shape CHECK; an index | — | — |
| M6 | `pre4_purge_capability` | additive | `globalidle_purge`; `gi_archive_game_account_history`; `LedgerEntryArchive`, `EntitlementAuditArchive`, `GameAccountDeletionRecord`; grants and revokes | — | — |
| M7 | `pre4_drop_retired_at` | contract | — | `Character.retiredAt` | — |

Each is one directory under `packages/domain/prisma/migrations`, holding Prisma's generated DDL plus
the hand-written statements Prisma cannot express, as every migration since Phase 0B does. All are
forward-only. The content change of §9 is a bundle publish, not a migration.

---

## 14. Acceptance matrix

Every case is one test whose title begins with its id and a colon, the convention
`scripts/count-matrix.mjs` counts. The implementing PR adds the PRE-4 groups to that script. The
prefixes below collide with no existing group.

### 14.1 New cases — 109

| Group | Cases | What each proves |
|---|---|---|
| **LGN** — Login | 1–9 | (1) M1 backfill: one Login per Account, every `AuthIdentity` on its Account's Login, counts preserved · (2) an unknown handle creates a Login, a credential and one `ACTIVE` Game Account, and the session carries `loginId` and `accountId` · (3) a known handle selects its `ACTIVE` Game Account and creates nothing · (4) a Login whose only Game Account is pending selects it, with no provisioning, and `/api/me` shows the deadline · (5) after the purge the same handle signs in: the same Login and credential ids, one new Game Account, nothing of the purged one · (6) two concurrent first sign-ins with one handle create one Login and one Game Account, and both succeed · (7) a session whose Game Account is gone gets `401 SESSION_GAME_ACCOUNT_GONE` and a cleared cookie · (8) `/api/game-accounts/:id/*` on another Login's Game Account is `404` · (9) a legacy cookie without `loginId` is unauthenticated |
| **GAD** — request | 1–8 | (1) a quiescent `ACTIVE` Game Account becomes pending: server clock after the lock, `purgeAt` exactly +720 h, source `PLAYER` · (2) a repeat returns the same deadline and neither extends nor restarts it · (3) refused while a Character holds an occupancy claim · (4) refused while a session-bound Activity is in reconnect grace · (5) configured state — loot policy, routing — does not block · (6) a request racing a Hunt start: exactly one wins, and never a pending Game Account with a running Activity · (7) the shape CHECK refuses inconsistent lifecycle columns · (8) nothing but the request writes `purgeAt`: no route, parameter or function sets it (source scan) |
| **FRZ** — freeze | 1–18 | (1) the runtime route inventory: every mutating route outside §5.5's allow-list refuses a pending Game Account, and a route with no decision fails the test · (2)–(15) one case per frozen route of §5.5, each asserting `409 GAME_ACCOUNT_PENDING_DELETION` and an unchanged closure snapshot · (16) every `GET` on a pending Game Account leaves every row byte-identical — Stamina not settled · (17) 700 injected hours pass: every Game-Account-owned value, derived views included, is unchanged · (18) another Game Account of the same Login hunts and settles normally throughout |
| **RST** — restore | 1–6 | (1) the closure after restore equals the closure after the request, except the Game Account's lifecycle columns · (2) no catch-up: Stamina equals its request value at once, then recovers from the restore instant only · (3) refused at exactly `purgeAt` · (4) after the purge, `404` · (5) restoring an `ACTIVE` Game Account is a no-op · (6) restore and purge race around `purgeAt`, repeated: exactly one wins, and the result is whole-restored or whole-purged |
| **PRG** — purge | 1–12 | (1) a due Game Account is purged in one transaction; its Login and credentials unchanged · (2) not yet due on the server clock: skipped, nothing changes · (3) idempotent: a second run, and a retry after commit, do nothing and write no second record · (4) a failure injected after each step rolls back to a whole, pending, overdue Game Account · (5) no collateral: another Game Account of the same Login and one of another Login are byte-identical, and I5 reconciles every surviving scope · (6) no carry-over: nothing of it reaches another Game Account or the Login · (7) an occupancy claim or a foreign participant found at purge time: refused, alarm, nothing deleted · (8) a forced failure after the deadline: the Game Account stays frozen, unrestorable and name-reserving, is counted overdue, and the next sweep purges it and releases the names in that commit · (9) no early purge: the job skips it before `purgeAt`, and no route purges · (10) the capability: the application role still cannot `UPDATE` or `DELETE` `LedgerEntry`, and the function refuses a Game Account that is not pending or not due on the database clock · (11) the Redis claim key is gone · (12) the full-closure fixture — nested containers, Depot containers, Stash, BANK and POUCH, loot pouch, equipment, five slots, entitlements with audits, idempotency records, finished Hunts with settlement operations — leaves nothing behind |
| **CLO** — closure | 1–6 | (1) every table and FK in `pg_constraint` / `information_schema` has a declaration, and a scratch FK to `Character` makes the test fail · (2) no in-account table is `KEEP`, and no `CASCADE` exists · (3) every string-keyed reference of §5.8 is declared · (4) the PostgreSQL scan finds no purged id or name outside the three declared non-live tables · (5) the Redis scan finds none · (6) a planted reference in a scratch table and one in Redis each make the scan fail |
| **HIS** — history | 1–6 | (1) exactly one record per committed purge, none for a rolled-back one · (2) mandatory fields plus HR3's optional ones only; the level is the request-time level; no Character id, Login id or value field · (3) the application role cannot `SELECT`, `UPDATE` or `DELETE` it · (4) the same name is creatable in another Game Account right after the purge, with the record present · (5) it restores nothing, and no domain or API code reads it (source scan) · (6) no route, view or export exposes it |
| **LDA** — archive | 1–5 | (1) every BANK and POUCH `LedgerEntry` of the Game Account is archived value-for-value with the purge id, and none remains live · (2) every `EntitlementAudit` of its entitlements is archived with `accountId` and `kind`; the entitlements are deleted · (3) the application role has no privilege on either archive; the purge role can only `INSERT`; `UPDATE` and `DELETE` are refused · (4) other Game Accounts' entries and balances are untouched and reconcile · (5) no domain or API code reads the archive (source scan) |
| **NMS** — names | 1–8 | (1) `nameKey = lower(name)` for every row, the unique index exists, and the CHECK refuses a mismatch · (2) the migration fails closed on a case-insensitive collision and applies nothing · (3) `Rookie` in Game Account B is refused while `rookie` exists in A · (4) concurrent `Rookie` and `ROOKIE`: exactly one commits · (5) a pending Game Account's names are refused elsewhere · (6) refused until the purge commits, accepted immediately after · (7) the stored name keeps its capitalization · (8) the refusal is the same `NAME_TAKEN` whether the holder is pending or not |
| **XPP** — XP projection | 1–9 | (1) `gi_xp_for_level` equals `xpForLevel` for levels 1–5000 · (2) the CHECK refuses a stale `baseLevel` written by raw SQL · (3) M3 reports and repairs seeded stale rows, and the CHECK then holds · (4) a Hunt settlement writes both columns, consistent at every checkpoint · (5) the death path writes both · (6) a replayed settlement operation awards nothing and changes neither column · (7) a failure after the XP write rolls both back · (8) creation derives the level from starting XP, and no caller can pass a level · (9) no file outside `writeBaseXp` and `tests/` writes `baseLevel` (source scan) |
| **APC** — actors | 1–8 | (1) golden: fixed seeds settle byte-identically to `23e1c60` · (2) a solo Hunt resolves exactly one participant whose owner is `Character.accountId` · (3) Gold reaches `pouchOf(owner, character)` with today's values · (4) a side of four actors of one Game Account is representable (pure) · (5) participants of three Game Accounts are representable, and `byOwner` routes each reward to its own owner (pure) · (6) `SOLO_MAIN` refuses 0 or 2+ participants and a foreign owner · (7) `ActorRef`, `AccountId`, `LoginId` and `CharacterId` do not assign to one another (type test) · (8) events keep the actor id `'character'` |
| **CFG** — tunables | 1–8 | (1) a `tunables` definition validates; an omitted key takes its default; a wrong type or out-of-range value fails build and load · (2) a bundle without one yields today's constants · (3) the values read through the surface equal 20, 200 and 100 000 · (4) a run pinned to bundle A keeps A's value after B publishes a different one; a new run takes B's · (5) a fixture bundle changing `items.depotSpaces` changes the Depot limit · (6) no request field reaches a tunable (source scan of controllers) · (7) no `INITIAL/TUNABLE` marker exists outside the registry, and the three constants are gone from `@global-idle/shared` · (8) no LOCKED value or NC item is in the schema |
| **PMG** — migrations | 1–6 | (1) M1–M7 apply to a clean database and to one at the VERIFIED Phase 3.7 schema with representative data · (2) M4 fails closed when a row has `retiredAt` set, reporting the count · (3) I1 over every row · (4) I1b over every row: a second vocationless Character refused with `ORIGIN_CHARACTER_EXISTS` — the legacy code for *"the Main already exists"* · (5) I2 holds under concurrent creation, over every row · (6) after M7 no `retiredAt` column exists and no source file names it |

### 14.2 Amendments to VERIFIED cases

Amended **in place**: the same id and the same test, with the new assertion, and the owning
specification's row annotated *amended by PRE-4*. Phase totals do not change.

| Case | Today | After PRE-4 |
|---|---|---|
| Phase 0B **D5** | a retired Character does not reserve its vocation | no retirement exists: every Character reserves its vocation in its Game Account (I1 over every row) |
| Phase 0B **D6** | retiring does not reduce `rosterCapacity` | deletion is per Game Account; a pending Game Account's `rosterCapacity` is unchanged, and restore returns it exactly |
| Phase 1 **D22** | a second Origin Character is refused by I1b, via a retirement step | the retirement step is removed; I1b holds over every row |
| Phase 1 **D24** | coexistence asserted with a `retiredAt: null` filter | the filter is removed |
| Phase 3 **RET1** | a retired Character is not playable on the inventory surface | a pending Game Account's Characters are frozen on the inventory surface |
| Phase 3 **RET2** | every player-facing surface agrees about retirement | every player-facing surface agrees about the freeze |
| `tests/integration/characters.test.ts` `retiredAt` assertion | `row.retiredAt` is null | removed with the column (it is not a matrix case) |
| Phase 0B **D9** | the application role cannot `UPDATE` or `DELETE` a ledger row | **unchanged, and must still pass** |

---

## 15. Open items after this specification

| # | Item | Owner | Blocks PRE-4? |
|---|---|---|---|
| — | the exact XP curve | a later product decision | no — the implemented curve is the baseline |
| DEL-O3 | moderation authority | the phase that builds moderation tooling | no — PRE-4 builds no moderation path |
| GA-O8 | the level that owns entitlements and sessions; entitlement time during a pending grace | the phase that sells a time-limited entitlement or builds multiple active Game Accounts | no (§4.14) |
| GA-O10 | the full create / list / switch UX | Phase 4A | no |
| GA-O11 | Game Account names | the phase that adds them | no |
| — | reserved Character names | a later product decision | no |
| — | retention and access for the history record and the ledger archive; purge lateness target; backups and restore | the pre-launch gate | no |
| — | the combat items listed in §11 | the combat phase | no |

**Resolved by this specification:** the ledger at purge (PO-1), the name comparison (PO-2), the
history record's fields (SD-13), idempotency records at purge (SD-11), the Login minimum and how a
Login with no Game Account starts one (SD-1 to SD-3), the conversion of `retiredAt` rows (SD-14),
existing name collisions (SD-15), the configuration surface's first form (SD-18) and DEL-O5 (SD-19).

## 16. Exit criteria for the gate

The PRE-PHASE-4 gate may be recorded as passed only when all of the following hold, on one
independently reviewed head:

1. §14.1's 109 cases pass, and `count-matrix.mjs` counts them;
2. §14.2's amendments are applied, D9 passes unchanged, and every other VERIFIED case passes
   unmodified;
3. M1–M7 apply to a clean database and to a Phase 3.7 database;
4. `packages/game-engine` is unchanged;
5. CI is green on that head;
6. the Product Owner authorizes recording the gate as passed. Recording it is a documentation change
   that never marks a phase `VERIFIED` and never advances `activePhase`.

## 17. Status

`IMPLEMENTATION_SPEC_DRAFT` — pending independent review. Nothing here is implemented. The gate is
not passed. Phase 3.7 remains the last VERIFIED phase; Phase 4 and Phase 4A have not started; there
is no Phase 3.8.
