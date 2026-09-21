# Phase 1 — World / Character Vertical Slice: Implementation Specification

**Document status:** **`IMPLEMENTATION_SPEC_DRAFT`** — complete draft, ready for independent
review. **Not** approved, **not** implemented, **not** `VERIFIED`.
**Phase:** 1 — World / Character vertical slice
**Baseline:** Phase 0A `ARCHITECTURE_APPROVED` (`ADR-001`–`ADR-018` `ACCEPTED`); Phase 0B
[`PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md`](../phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md)
`VERIFIED` at `922e1c3`
**Design baselines consumed:** [`TUTORIAL_ROOKGAARD_ROADMAP.md`](../../design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md),
[`DOMAIN_MODEL.md`](../../architecture/DOMAIN_MODEL.md),
[`ACTIVITY_OCCUPANCY_AND_TIMERS.md`](../../architecture/ACTIVITY_OCCUPANCY_AND_TIMERS.md),
[`CLIENT_SERVER_BOUNDARIES.md`](../../architecture/CLIENT_SERVER_BOUNDARIES.md)

> This document is a **specification**. It contains no implementation. Its job is to make the
> implementing phase mechanical: exact contracts, exact boundaries, exact tests, an objective
> Definition of Done — and, where two approved documents disagree, an explicit decision with its
> alternatives rather than a silent one in code.

---

## 1. Phase goal and non-goals

### 1.1 What a player can do when Phase 1 is complete

```text
browser
  → account/session entry
  → character selection (empty on a new account)
  → character creation
  → character panel   (name, Base Level 1, no vocation, Stamina 42:00, Free)
  → World Atlas shell (pan, zoom, locked regions visible)
  → Rookgaard         (the one unlocked region)
  → Rookgaard Sewers  (the one Hunt marker)
  → hunt details panel
  → ENTER HUNT
  → pre-combat Hunt screen: the Character is IN the Hunt, occupied, Stamina NEUTRAL
  → LEAVE
  → back to the Atlas, claim released
```

Reload at any point re-reads the server. The Hunt the Character is in is **durable server state**
(§9.5), not a URL segment and not client memory.

That last stretch is the part that needs care, and §9 specifies it exactly.

### 1.2 Non-goals — Phase 1 does NOT include

| Not in Phase 1 | Owner |
|---|---|
| Rooms 1–10, room-10 loop, monster encounters, combat resolution | Phase 2 |
| Damage formulas, XP curves, gold, loot tables, supplies, death | Phase 2–3 |
| Stamina **consumption** (activation is first qualifying XP — §9.4) | Phase 2 |
| `ItemInstance`, inventory, equipment, custody | Phase 3 |
| Skills, Party gameplay, Active Party editing | Phase 4 |
| The five vocations' kits and the Level-8 Oracle flow | Phase 4 |
| Quests, dungeons, bosses | Phase 5 |
| Market and the economy surface | Phase 6 |
| Forge, Imbuements, Wheel, Skill Tree | Phase 7 |
| Store / payment / Premium purchase flow | Phase 8 |
| The rest of the world's regions and content | Phase 9 |
| NPC dialogue, the tutorial script, tutorial gating | later |

**The rule that decides the rest:** if a behaviour cannot be implemented without inventing a
number the Product Owner has not approved, it is not in Phase 1.

---

## 2. The two contradictions this phase must settle

Both are recorded here rather than resolved in code, per `AGENTS.md` §3.

### 2.1 "One vocation" vs vocation-at-Level-8 — **DECIDED, §4**

`ROADMAP.md` Phase 1 lists *"one vocation"*. `TUTORIAL_ROOKGAARD_ROADMAP.md` §3 says every new
tutorial character starts *"Vocation: not yet chosen"* and §34 puts selection at Level 8.

### 2.2 `Character.vocation` is NOT NULL — **BLOCKING SCHEMA FINDING, §13.2**

This one is not a wording tension; it is a real gap between two `VERIFIED`/`ACCEPTED` artefacts:

- `DOMAIN_MODEL.md` §5.5 gives the Character lifecycle as
  `created → (origin: Rookgaard L1→8 | unlocked: starts at L8) → progresses indefinitely`;
- the Phase 0B schema declares `vocation Vocation` — **not nullable** — so the origin path it
  describes **cannot be represented**.

Phase 0B was right not to notice: it authored no character-creation flow. Phase 1 is the first
phase that must create a Level-1 origin character, and it is the first phase where the gap bites.
§13.2 specifies the migration and why it does not weaken invariant **I1**.

---

## 3. Account / session surface

### 3.1 What already exists

| Exists | Where |
|---|---|
| `Account` with `rosterCapacity` (default 1, `CHECK 1..5`) | schema |
| `AuthIdentity` — `(provider, subject)` unique, FK to Account | schema, *"Phase 1 builds the flows"* |
| `Entitlement` / `EntitlementAudit`, account-wide, with transitions | schema + `identity/entitlement` |
| Correlation ids, `/health/*`, `/metrics`, observability port | `apps/api` |
| **No** route, no session, no auth middleware, no `apps/web` data layer | — |

### 3.2 What Phase 1 adds — the smallest defensible thing

**Decision P1-D1 — a DEVELOPMENT-ONLY credential provider, session by signed HTTP-only cookie.**

> ### ⚠ The `dev` provider is a TEST HARNESS, not authentication
>
> `subject` is a self-asserted handle with **no secret**, so typing another player's handle
> *is* logging in as them. That is acceptable for a local slice and a CI fixture, and
> unacceptable anywhere else.
>
> - the provider is registered **only** when `NODE_ENV !== 'production'` **and**
>   `GLOBAL_IDLE_DEV_AUTH=1`. Both, not either;
> - in production the route is **absent**, not merely hidden — a `404`, not a `403`, because a
>   `403` still tells an attacker the mechanism exists;
> - the API **refuses to start** if `NODE_ENV=production` and `GLOBAL_IDLE_DEV_AUTH=1` are set
>   together. A misconfiguration must be a boot failure, not a silently open door;
> - **Phase 1 is not deployable to production.** Real authentication is a later phase's work and
>   this specification does not pretend otherwise;
> - §19's security cases prove **account scoping and session integrity**. They do not, and must
>   not be read to, prove that the dev provider is safe authentication.

Phase 1 is a vertical slice, not an identity product. It needs exactly: a stable account per
browser session, a **session identity distinct from it** (§3.2.1), an authorization boundary a
test can breach, and reload survival.

- provider `dev`, `subject` = a player-chosen handle. `POST /api/session` upserts the
  `AuthIdentity` and its `Account` in one transaction and sets the cookie.
- session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` when not local, signed with
  `SESSION_SECRET` (new required config key — the process refuses to start without it, like every
  other key in §11.3 of the 0B spec).
- **no password, no email, no recovery, no OAuth.** Those arrive when the product needs them; a
  fake one now would have to be deleted.
- `DELETE /api/session` clears it.

#### 3.2.1 `accountId` is not `sessionId`

**Decision P1-D14 — the cookie carries BOTH, and they mean different things.**

Phase 0B's `SessionBoundActivity.claimHolderSessionId` is the connection that holds the activity
claim (`ADR-008`: the newest connection evicts the previous one). The first draft of this
specification defined no `sessionId` at all, so Enter Hunt had nothing truthful to pass — and the
obvious shortcut, passing `accountId`, would have made two browsers on one account
indistinguishable and silently broken eviction before Phase 2 ever got to implement it.

```text
accountId   WHO owns the characters      stable across logins, devices, time
sessionId   WHICH login is acting now    minted per successful POST /api/session
```

| Rule | |
|---|---|
| Generation | `sessionId` is minted **server-side** (`newId<'SessionId'>()`) on session creation |
| Client authority | **none.** It is inside the signed payload; a request body field named `sessionId` is ignored, and a forged cookie fails the signature |
| Reload | same cookie → same `sessionId`. Reload is not a new login |
| Second browser / second login | a **new** `sessionId` on the same `accountId` |
| Logout | the cookie is cleared; that `sessionId` is never re-minted |
| Enter Hunt | passes the **server-derived** `sessionId` as `claimHolderSessionId` |

**No `Session` table.** The signed cookie *is* the session record: Phase 1 needs no server-side
revocation, no session listing and no idle expiry, and a table would be durable state with no
reader. What Phase 2 adds — eviction, the 5-minute grace, a realtime connection — needs the
*identity* to be right, which this provides, and can add storage then if it needs it.

*Alternative considered:* mint a fresh `sessionId` per request. Rejected — eviction would fire on
every reload, which is precisely the bug `ADR-008` exists to prevent.

*Alternatives:* OAuth/OIDC (real, but a whole product Phase 1 cannot review honestly);
anonymous cookie-only accounts (no way to return to an account from another browser — makes
manual acceptance review in §15 painful); bearer tokens in `localStorage` (XSS-exposed, and
`CLIENT_SERVER_BOUNDARIES.md` puts authority on the server — a cookie the client cannot read is
the smaller surface).

### 3.3 Authorization boundary

Every `/api/**` route except `/api/session` (POST) and `/health/*` and `/metrics` requires a
session. **Every character-scoped and activity-scoped route resolves ownership from the session's
`accountId`, never from a client-supplied account id.** A `characterId` that exists but belongs to
another account returns **404, not 403** — existence is itself information (§19).

### 3.4 Reload, empty account, first character

| Situation | Behaviour |
|---|---|
| Reload with a valid cookie | the same account; the client re-fetches state, holds none across reloads |
| Reload with no/expired cookie | session entry screen, no error banner |
| Account with zero playable characters | character **creation**, not an empty list with a button |
| Account at `rosterCapacity` | creation refused, `ROSTER_FULL`; Phase 1 never sells capacity |

---

## 4. Vocation interpretation — decision

**Decision P1-D2 — Phase 1 implements the PRE-VOCATION ORIGIN CHARACTER state. Vocation
selection stays deferred to the Level-8 Oracle flow, and Phase 1 ships zero vocation kits.**

`null` means **"not chosen yet"**. It is a lifecycle state of the one Origin Character, **not a
sixth vocation** and **not a reusable roster-slot type**. This specification does not describe
"no vocation" as "one vocation"; the roadmap line is read below, but the phase does not adopt its
wording.

Read against the tutorial baseline, `ROADMAP.md`'s *"one vocation"* cannot mean "the player picks
a vocation in Phase 1" — that would contradict a `LOCKED` flow and move the Oracle to Level 1.
What it does mean, and what Phase 1 builds:

1. `Character.vocation` becomes **nullable**, and the Origin Character is created with `null`
   (§13.2). This is the *origin* character of `DOMAIN_MODEL.md` §5.5 — **at most one per
   Account**, enforced by the database (§13.2), not by application logic.
2. The `Vocation` enum keeps its five values. Nothing is removed.
3. The character panel renders vocation as **"Not yet chosen — Oracle at Level 8"**, which is
   product-truthful and needs no balance number.
4. **No** combat kit, skill aptitude, or vocation-derived stat is implemented for any vocation.

*Alternatives considered:*

| Alternative | Why not |
|---|---|
| Ship Knight as "the one vocation", assigned at creation | contradicts `TUTORIAL_ROOKGAARD_ROADMAP.md` §3 and §34, both `LOCKED`. Phase 4 would have to delete it. |
| Ship the Level-8 Oracle selection UI now | requires Base Level 8, which requires XP, which requires Phase 2's combat. Out of order. |
| Keep `vocation` NOT NULL and add a sentinel `NONE` enum member | pollutes a product enum with a lifecycle state, and every future `switch` over `Vocation` must handle a member that is not a vocation. `null` already means "absent" and the partial unique index already treats NULLs as distinct (§13.2). |

**The roster model this sits inside**, so the invariant is not read in isolation:

| | |
|---|---|
| First Character on a new Account | the **Origin Character**: Level 1, Rookgaard, `vocation = null` |
| Reaching Level 8 | the Oracle assigns a concrete vocation — **Phase 4**, not here |
| Additional Characters | start at **Level 8**, represent a vocation **unlock**, and arrive through the future unlock flow — `DOMAIN_MODEL.md` §5.5 |
| Roster slots 2–5 | bought with Gold — **Phase 6**; Phase 1 implements no unlock and no purchase |
| Phase 1's creation endpoint | creates the Origin Character **only**. It is not a generic "make another no-vocation character" API |

*Deferred:* the Oracle flow, the five identities in `TUTORIAL_ROOKGAARD_ROADMAP.md` §35, skill
aptitudes, Gold roster unlocks, and vocation immutability enforcement at confirmation
(`DOMAIN_MODEL.md` §5.5 already decides the rule; Phase 4 enforces it).

---

## 5. Character creation / selection

### 5.1 Creation contract

| Field | Owner | Phase 1 value |
|---|---|---|
| `id` | server | `newId<'CharacterId'>()` |
| `accountId` | **session** — never the request body | — |
| `name` | client-proposed, server-validated | 2–20 chars, letters + single inner spaces, unique among playable characters account-wide |
| `vocation` | server | **`null`** (§4) |
| `baseLevel` | server | **1** (`TUTORIAL_ROOKGAARD_ROADMAP.md` §3) |
| `createdAt` | server clock (`ADR-010`) | — |
| `retiredAt` | server | `null` |
| Stamina | server | `CharacterStamina` row, `remainingMs = STAMINA_MAX` (42:00), mode `NEUTRAL` |

The client sends **`{ name }`** and nothing else. Everything else is server-owned; a request
carrying `baseLevel` or `vocation` is rejected by schema validation, not ignored.

This endpoint creates the **Origin Character** and nothing else (§4). It is not a general
"create a no-vocation Character" API: **I1b** (§13.2) allows one per Account, so a second attempt
is refused by the database, surfaced as `409 ORIGIN_CHARACTER_EXISTS`.

Creation runs in **one transaction** through the existing `character.createCharacter`, extended
for the new fields, and inside it re-checks **I2** (`count(playable) ≤ rosterCapacity`) exactly as
Phase 0B does. I1b is enforced by the index rather than by a read-then-write check, for the reason
`DOMAIN_MODEL.md` §5.5 gives about I1: an application-only check loses to a concurrent request.

### 5.2 Selection and retirement

- `GET /api/characters` lists **playable** characters (`retiredAt IS NULL`) for the session account.
- Selecting a character is **client state**, not server state: Phase 1 has no "active character"
  concept on the server, and inventing one would duplicate state the Activity context already owns.
  The selected id lives in the URL (`/play/[characterId]`), so reload and deep links work.
- Retirement exists in the domain (`ADR-007`) but Phase 1 exposes **no** retirement UI. Rationale:
  retirement frees a vocation and interacts with roster capacity and future item custody; with
  `rosterCapacity` defaulting to 1 and no items, a retire button in Phase 1 would let a player
  strand themselves with zero characters and no way to understand why. Deferred, explicitly.

### 5.3 Validation and error states

| Case | Code | UI |
|---|---|---|
| Name too short/long/ill-formed | `NAME_INVALID` | inline under the field, no navigation |
| Name taken on this account | `NAME_TAKEN` | inline |
| Roster full | `ROSTER_FULL` | blocking message with the capacity |
| Origin Character already exists | `ORIGIN_CHARACTER_EXISTS` | blocking; the account already has its one Level-1 Character (§4) |
| No session | `UNAUTHENTICATED` | redirect to session entry |

### 5.4 No durable location in Phase 1

**Decision P1-D15 — `Character.locationKey` is NOT added. Phase 1 stores no location.**

The first draft gave the Character `locationKey = "region.rookgaard.temple"`. The proposed content
kinds are `region`, `atlas-marker` and `hunt` — there is no `location` kind — so that string would
have been a **pseudo-content key with no build-time guarantee**: it looks like content, resolves
against nothing, and the first typo would surface as a blank panel rather than a failed build.

Two ways out, and the smaller one wins:

| Option | Verdict |
|---|---|
| **A** — define a real `location` content kind, validated like the others | Correct, and premature. Nothing in Phase 1 *reads* location to decide anything: there is no movement, no travel, no location-gated content, and exactly one region |
| **B** — **do not store location at all** ← chosen | The only need is displaying where the Character is. That is already derivable: the Atlas has one `AVAILABLE` region, and an occupied Character's Activity resolves to its Hunt (§9.5) |

So the panel shows `Rookgaard` from the region definition, or the Hunt's label when the Character
is in one. No new column, no new content kind, no unvalidated key anywhere — **every durable
content reference in Phase 1 resolves through the content system.**

When movement exists and a location is something the server *decides with*, a real `location` kind
arrives with it, together with the rules that need it. Infrastructure follows the slice that
requires it.

---

## 6. Character panel

The first real character-facing surface. It renders **what the server returned** and computes
nothing authoritative (`CLIENT_SERVER_BOUNDARIES.md`).

| Element | Source | Phase 1 presentation |
|---|---|---|
| Name | `Character.name` | heading |
| Base Level | `Character.baseLevel` | `Level 1`; no XP bar (no XP exists) |
| Vocation | `Character.vocation` | `null` → *"Not yet chosen — Oracle at Level 8"* |
| Stamina | `CharacterStamina` | `hh:mm` of 42:00 **plus the mode**, all server-derived |
| Premium | account entitlements | `Free` / `Premium`, read-only, no purchase path |
| Where the Character is | the **Atlas region** + current activity | `Rookgaard` when idle, or the Hunt's label when in one — both resolved from content (§10), neither from a durable location column (§5.4) |

**Stamina is displayed, not ticked.** `deriveStaminaMode` is server-side and the mode in Phase 1 is
always `NEUTRAL` (nothing consumes or recovers — §9.4). A client-side countdown would be the
browser inventing authoritative state; the panel re-fetches instead.

---

## 7. World Atlas / map shell

### 7.1 Interaction contract

| Capability | Desktop | Touch | Notes |
|---|---|---|---|
| Pan | drag, arrow keys | one-finger drag | keyboard pan is the a11y path |
| Zoom | wheel, `+`/`-` | pinch | clamped `minZoom..maxZoom` from region data |
| Region focus | click / `Enter` on a focused region | tap | focus ring must be visible |
| Marker select | click / `Enter` | tap | **never hover-only** (`TUTORIAL_ROOKGAARD_ROADMAP.md` §34) |
| Marker detail | side panel (desktop) / bottom sheet (touch) | same content both ways | |
| Deselect | `Escape`, click empty space | tap empty space / sheet dismiss | |

Hover may *enrich* (tooltip) but must never be the only way to reach information.

### 7.2 Rendering

**Decision P1-D3 — inline SVG in a React component, no map library.**

One region, a handful of markers, pan/zoom over a static backdrop. SVG gives crisp scaling,
real DOM nodes for markers (so keyboard focus and screen readers work for free), and no
dependency. A tiling/GIS library would be a heavyweight framework added without evidence, which
§14 forbids.

*Alternatives:* Leaflet/MapLibre (tile pyramids and a CRS this world does not have); canvas
(loses focusability and accessible names, both required by §15).

### 7.3 States

| State | Requirement |
|---|---|
| Loading | skeleton; **no layout shift** when data lands |
| Error | retry affordance; the failure is logged server-side (§18) |
| Empty | cannot occur — content is a build artefact, not user data |
| Locked region | visible, dimmed, `aria-disabled`, tooltip/sheet *"Coming in a later phase"*; **not** clickable through to anything |

Locked regions are part of the design (`TUTORIAL_ROOKGAARD_ROADMAP.md` §12: the world visible in a
locked state *"to create a sense of scale"*). Phase 1 renders them from data (§10) and never
hardcodes a future region's name in business logic.

---

## 8. One region — Rookgaard

**Decision P1-D4 — the one region is Rookgaard**, with the Temple as the character's starting
location.

It is the only defensible choice: `TUTORIAL_ROOKGAARD_ROADMAP.md` makes Rookgaard the mandatory
Level 1–8 tutorial area, §3 puts every new character in the Rookgaard Temple, and §12 focuses the
Atlas camera there. Any other region would need a product decision that does not exist.

The region contract is **data** (§10.1), so Phase 9 adds regions by adding content, not by editing
the client.

---

## 9. One Hunt marker, and the exact Phase 1 / Phase 2 boundary

### 9.1 The Hunt

**Decision P1-D5 — the one Hunt is `hunt.rookgaard.sewers`**, primary creature Rat, from
`TUTORIAL_ROOKGAARD_ROADMAP.md` §7 (*"Rookgaard Sewers / Primary creature: Rat"*). The creature is
**named in content metadata only** — no creature definition, no stats, no loot table.

### 9.2 The boundary — what "enter" means

**Decision P1-D6 — Phase 1 creates a REAL session-bound Activity and stops in the documented
pre-consumption state.**

This is the decision this specification most needs to get right, so here is the reasoning in full.

`ACTIVITY_OCCUPANCY_AND_TIMERS.md` §4 distinguishes an **activation trigger** from a
**continuation signal**, and locks activation as *"the Character receives its first qualifying Hunt
XP reward in that Hunt"*. Before that, the Character is in an explicitly named
**pre-consumption Hunt state**: *"physically in a Hunt"*, occupied, and **neutral** for Stamina.
Mandatory test case 1 of that document is *"Hunt entry before first qualifying XP consumes 0"*.
The Phase 0B schema says the same thing from the other side: `ActivityParticipant.staminaActivatedAt`
is nullable, *"null means NOT YET ACTIVATED, which §7.3.1 reads as NEUTRAL. Phase 0B stores and
reads it; **Phase 2 decides what raises it**."*

So a Phase 1 Hunt with no combat is not a fake Hunt. It is **exactly the approved state that
precedes combat**, and it is reachable using only `VERIFIED` primitives:

| Phase 1 uses | Why it is honest |
|---|---|
| `activity.startSessionBound` with `activityTypeKey: HUNT` | HUNT is a registered `SESSION_BOUND` type |
| the occupancy claim (`ADR-013`, I13) | the Character *is* busy; this is the real constraint |
| `staminaActivatedAt = null` | the documented pre-consumption state; Phase 2 raises it |
| `SessionBoundState: ONLINE_ACTIVE` | the connection is live |
| `activity.endActivity` on Leave | releases the claim in the same transaction |
| reconnect-grace primitives | **present but not driven by Phase 1 UI** — see §9.6 |

| Phase 1 must NOT | Why |
|---|---|
| Raise `staminaActivatedAt` | Phase 2 owns the trigger; raising it without XP inverts a `LOCKED` rule |
| Award XP, gold or loot | no approved numbers exist |
| Create rooms or encounters | Phase 2 |
| Invent a "tutorial-only" activity type | §7 of the tutorial forbids a fake parallel system |

*Alternative considered — stop at selection, create no Activity.* Simpler, and tempting. Rejected
because it leaves Phase 1 with **no** server-authoritative state to prove: no occupancy, no reload
persistence, no negative-authorization surface worth testing, and no exercise of the primitives
Phase 0B was built for. It would also make Phase 2's first act "make Enter actually do something",
which is precisely the seam where gameplay gets invented in a hurry.

*Alternative considered — create the Activity and also mark Stamina consuming.* Rejected outright:
it contradicts the locked activation rule and would be a shortcut Phase 2 must delete.

### 9.3 The pre-combat screen

A deliberately plain surface: the region and hunt name, the character, the Stamina readout
(`NEUTRAL`), a placeholder arena panel reading *"Combat arrives in Phase 2"*, and **Leave**. It
must not resemble a combat UI, must not animate a fight, and must not show a progress bar that
implies simulation.

### 9.4 Stamina in Phase 1

Always `NEUTRAL`, always 42:00, for every character, in and out of a Hunt. Nothing in Phase 1
consumes (no qualifying XP) and nothing recovers (recovery is a Skill-Training/offline concern
Phase 1 does not surface). The *state machine* is exercised; the *transitions* are Phase 2's.

### 9.5 The Activity must know WHICH Hunt it is — `Activity.contentKey`

**Decision P1-D13 — `Activity` gains a durable, server-owned `contentKey`.**

The first draft of this specification promised an `ActivityView.huntKey` and a reload that returns
the player to the same Hunt. The Phase 0B `Activity` row stores `id`, `accountId`,
`activityTypeKey`, `family`, `contentVersion`, `createdAt` — and **nothing that says which Hunt**.
`activityTypeKey` is `"hunt"` for every Hunt ever run. So the promise could not be kept: after a
reload the server could say *"you are in a Hunt"* and not *which one*.

```text
Activity
  activityTypeKey  "hunt"                      WHICH CODE PATH runs
  contentVersion   v2d9f9f15b4585df5           WHICH BUNDLE it was started against (ADR-011)
  contentKey       "hunt.rookgaard.sewers"     WHICH DEFINITION it represents   ← new
```

**Generic on purpose.** It is `contentKey`, not `huntKey`: a Phase 5 Dungeon and a Phase 5 boss
encounter are the same shape of fact — an Activity instance of a content definition — and a
Hunt-only column would have to be replaced rather than reused.

| Property | Rule |
|---|---|
| Ownership | **server**. Derived from the validated request body's `huntKey`, never copied blindly |
| Durability | a column on `Activity`, written in the creating transaction |
| Validity | must resolve **in the Activity's own pinned `contentVersion`** — not in "the current bundle" |
| Kind compatibility | the definition's `kind` must match the activity type: `activityTypeKey = "hunt"` requires `kind: "hunt"` |
| Mutability | **immutable after creation.** No endpoint updates it; reload reads it |
| Reload | the pre-combat screen is reconstructed from `(contentVersion, contentKey)` alone |

**Where it must NOT live:** client state, the URL, Redis, the idempotency result JSON, or a log
line. Each of those loses the fact on the exact failure the durability exists for.

**Creation transaction.** Inside the single transaction that already starts the Activity:
resolve the bundle pinned for this Activity → look up `contentKey` in it → assert `kind` matches
the activity type → assert `availability = AVAILABLE` → write the row. A key that does not resolve
is `404 HUNT_NOT_FOUND`; one that resolves to the wrong kind is `422 CONTENT_KIND_MISMATCH`.
Neither creates an Activity, and the occupancy claim is never taken.

### 9.6 Reload and Leave

| Action | Server | Client |
|---|---|---|
| Reload inside a Hunt | Activity row persists; claim persists | re-fetches and returns to the pre-combat screen — **the URL is not the source of truth, the server is** |
| Leave | `endActivity` → terminal state + claim released, one transaction | back to the Atlas |
| Close the tab | Phase 1 does **not** implement the 5-minute grace countdown UI | the sweeper (Phase 0B) still reconciles stranded claims |
| Start a second Hunt while in one | refused — `OccupancyConflict` (I13), surfaced as a readable message | |

The grace *primitives* exist and the worker sweep runs; Phase 1 simply does not build the
connection-lifecycle UI on top of them. That is Phase 2's line item.

---

## 10. Content / data contracts

All Phase 1 world data is **content**, built through the Phase 0B pipeline: immutable, versioned
as a whole, keyed by stable dot-separated keys, validated at build time, never written at runtime.

### 10.1 New definition kinds

`packages/game-data/src/schema.ts` gains three `kind` discriminants. The existing
`definitionSchema` (key, kind, references, probability, magnitude) stays as the base; each kind
adds a validated payload.

```text
kind: "region"
  key            region.rookgaard
  label          "Rookgaard"
  availability   "AVAILABLE" | "LOCKED"
  atlas          { x, y, width, height }     — Atlas-space bounds
  minZoom/maxZoom
  backdropAssetId                            — §11, an ID, never a path

kind: "atlas-marker"
  key            marker.rookgaard.sewers
  label          "Rookgaard Sewers"
  category       "HUNT" | "DUNGEON" | "NPC" | "SERVICE"
  region         region.rookgaard            — via `references`
  position       { x, y }                    — Atlas-space
  target         hunt.rookgaard.sewers       — via `references`
  iconAssetId
  availability   "AVAILABLE" | "LOCKED"

kind: "hunt"
  key            hunt.rookgaard.sewers
  label          "Rookgaard Sewers"
  region         region.rookgaard
  summary        short prose
  primaryCreature "Rat"                      — a LABEL; no creature definition exists
  activityTypeKey "hunt"                     — must resolve in the activity registry
  availability   "AVAILABLE" | "LOCKED"
```

Categories `DUNGEON`/`NPC`/`SERVICE` are accepted by the schema so Phase 5+ adds markers without a
schema migration, but **Phase 1 authors none** and the client renders an unknown category as a
neutral pin rather than throwing.

### 10.2 Validation rules (build-time, blocking)

- every `references` key resolves (already enforced);
- every marker's `region` is a `region`, and its `target` is a `hunt` (Phase 1) — kind-checked;
- `activityTypeKey` on a hunt exists in the **activity registry** — this is the content/registry
  reconciliation Phase 0B already performs for activity types, extended;
- Atlas-space positions lie inside their region's bounds;
- exactly one region is `AVAILABLE` in the Phase 1 bundle (a Phase 1 assertion, relaxed later);
- every `*AssetId` resolves in the asset manifest (§11).

### 10.3 Authored content

Rookgaard, its Sewers marker and hunt, plus **locked placeholder regions** (Mainland, Thais,
Carlin, Edron) carrying label + bounds + `LOCKED` and nothing else — enough for §7.3's sense of
scale, no gameplay data. The existing `placeholder.*` definitions stay: C-group tests depend on
them.

---

## 11. Asset pipeline and placeholders

**Decision P1-D7 — content references `assetId`; a manifest maps `assetId` → file; gameplay never
sees a filename.**

```text
content definition        →  assetId: "atlas.region.rookgaard"
asset manifest (build)    →  { "atlas.region.rookgaard": { src: "...", w, h, license } }
client asset resolver     →  <img src=…>  /  <image href=…>
```

Consequences, which are the point:

- Phase 1 ships **neutral placeholders** (flat shapes, simple pins, a muted backdrop);
- when the Product Owner supplies real art, only the **manifest** and the files change — no
  content key, no gameplay rule, no component logic;
- a missing asset is a **build-time** failure for authored content and a visible neutral fallback
  at runtime, never a broken image;
- the manifest carries a `license`/`source` field per asset, because `AGENTS.md` §9 makes asset
  rights a real constraint and the moment to record provenance is when the file arrives.

Phase 1 does **not** bulk-import an asset universe, and does not add outfit/creature/effect
pipelines — only the four surfaces it renders: region backdrop, marker icons, character portrait
placeholder, UI icons.

---

## 12. API contracts

`/api` prefix, JSON, session cookie. Errors share one shape: `{ error: { code, message, details? } }`
where `code` is a stable `SCREAMING_SNAKE` identifier (the UI switches on `code`, never on prose).

| Method | Path | Body → Response | Notes |
|---|---|---|---|
| `POST` | `/api/session` | `{ handle }` → `{ accountId }` | upserts `AuthIdentity`+`Account`; sets cookie |
| `DELETE` | `/api/session` | — → `204` | clears cookie |
| `GET` | `/api/me` | → `{ accountId, rosterCapacity, premium: boolean }` | `401` without a session |
| `GET` | `/api/characters` | → `{ characters: CharacterSummary[] }` | playable only, session-scoped |
| `POST` | `/api/characters` | `{ name }` → `CharacterSummary` | `409 NAME_TAKEN`, `409 ROSTER_FULL`, `422 NAME_INVALID` |
| `GET` | `/api/characters/:id` | → `CharacterDetail` | **404** if not owned (§19) |
| `GET` | `/api/atlas` | → `{ contentVersion, regions[], markers[] }` | from the pinned bundle |
| `GET` | `/api/hunts/:key` | → `HuntDetail` | `404` for an unknown or non-`hunt` key |
| `POST` | `/api/characters/:id/hunt` | `{ huntKey }` → `ActivityView` | starts the Activity (§9.2, §9.5); `404 HUNT_NOT_FOUND`, `422 CONTENT_KIND_MISMATCH`, `409 OCCUPANCY_CONFLICT` |
| `GET` | `/api/characters/:id/activity` | → `ActivityView \| null` | what reload reads |
| `DELETE` | `/api/characters/:id/activity` | → `204` | Leave |

```ts
CharacterSummary = { id, name, baseLevel, vocation: VocationName | null, stamina: StaminaView }
CharacterDetail  = CharacterSummary & { premium: boolean, activity: ActivityView | null }
StaminaView      = { remainingMs, maxMs, mode: 'CONSUMING' | 'NEUTRAL' | 'RECOVERING' }
ActivityView     = {
  activityId, activityTypeKey,
  contentVersion,            // the bundle this Activity was pinned to (ADR-011)
  contentKey,                // WHICH definition — durable, server-owned (§9.5)
  hunt: HuntDetail,          // resolved from (contentVersion, contentKey) on read
  state, startedAt,
}
```

`POST /api/characters/:id/hunt` carries an **idempotency key** and goes through the Phase 0B
fingerprinted idempotency primitive: a double-submitted Enter returns the same Activity rather
than racing the occupancy constraint.

---

## 13. Persistence / schema impact

### 13.1 Reused unchanged

`Account`, `AuthIdentity`, `Entitlement`, `EntitlementAudit`, `CharacterStamina`, `Activity`,
`SessionBoundActivity`, `ActivityParticipant`, `OccupancyClaim`, `IdempotencyRecord`,
`ContentBundle`. **No** new table duplicates state an existing context owns.

### 13.2 `Character` — the migration this phase requires

```sql
ALTER TABLE "Character" ALTER COLUMN "vocation" DROP NOT NULL;
ALTER TABLE "Character" ADD COLUMN "baseLevel" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Character" ADD CONSTRAINT "Character_baseLevel_check" CHECK ("baseLevel" >= 1);

-- I1, UNCHANGED: at most one playable Character per CONCRETE vocation per account.
-- (already present; shown for context)
-- CREATE UNIQUE INDEX "Character_accountId_vocation_key"
--     ON "Character" ("accountId", "vocation") WHERE "retiredAt" IS NULL;

-- NEW INVARIANT I1b: at most ONE playable un-vocationalized ORIGIN Character
-- per account. NULLs are distinct to the index above, so without this a second
-- Origin Character would be accepted.
CREATE UNIQUE INDEX "Character_accountId_origin_key"
    ON "Character" ("accountId")
 WHERE "retiredAt" IS NULL AND "vocation" IS NULL;
```

**Invariant I1b — an Account may have at most one playable un-vocationalized Origin Character.**

**Why I1 is untouched, and why I1b is needed.** I1 is *"one playable Character per **vocation**
per account"*. A Character with no vocation holds no vocation, so it cannot violate I1 — and that
is exactly the problem: PostgreSQL treats NULLs as **distinct** in a unique index, so I1 does not
constrain Origin Characters **at all**. A second index must, because the product model allows
exactly one.

> **This reverses a claim the first draft made.** That draft cited the same NULL-distinctness
> behaviour as evidence that *"any number of no-vocation origin characters coexist"*, and
> presented it as the desired outcome. The database behaviour was measured correctly; the product
> conclusion drawn from it was wrong. There is **one** Origin Character per Account — additional
> Characters are vocation **unlocks** that start at Level 8 (`DOMAIN_MODEL.md` §5.5). I1b is the
> constraint the first draft should have specified, and the matrix case that asserted coexistence
> is **reversed**, not merely adjusted.

**Measured against PostgreSQL 16**, with both indexes declared exactly as above:

| Probe | Result |
|---|---|
| First Origin Character on an account | **accepted** |
| **Second** Origin Character, same account | **REFUSED** — `duplicate key value violates unique constraint "…_origin_key"` |
| Origin Character on a **different** account | **accepted** — accounts are independent |
| Two `KNIGHT` rows, one account | **REFUSED** by the I1 index — D4's control holds |
| A `KNIGHT` and an Origin Character, one account | **both present** — I1b constrains only the un-vocationalized row |
| Retire the Origin Character, create another | **accepted** — see the open item below |

The implementing pass still owes the D-group cases: a probe on a scratch table proves *index
semantics*, not that the migration was applied to the real table.

**Retirement before vocation — `OPEN`, flagged rather than decided.** `ADR-007` makes deletion
retirement, and I1b is scoped to playable rows, so retiring an Origin Character frees the slot and
a new one can be created at Level 1. That is a **tutorial replay path**, and
`TUTORIAL_ROOKGAARD_ROADMAP.md` §2 already says the account tracks `tutorialCompleted` and warns
*"Do not determine tutorial eligibility only by counting existing characters."* Whether replay is
allowed, offered with a SKIP, or refused is a **product decision that does not exist yet**. Phase 1
neither implements retirement (§5.2) nor gates creation on tutorial state, so the path is
unreachable in this phase — but the constraint permits it, and the reviewer should know that
before it becomes a surprise in Phase 4.

`baseLevel` is defaulted for the migration's sake and then always written explicitly by
`createCharacter`; the `CHECK` is the constraint that actually holds the floor.

**Rollback:** re-adding `NOT NULL` requires no NULL rows. The down path is
`UPDATE … SET vocation = <chosen> WHERE vocation IS NULL` — a product decision, so the migration
is **forward-only** and the rollback note says so plainly rather than pretending it is reversible.

### 13.3 Not added, deliberately

No `Progression` table — Base Level is one integer until XP exists, and a table now would be a
second home for character state. No `Session` table — the signed cookie *is* the session (§3.2.1),
and a table would be durable state with no reader. **No location column and no `location` content
kind** — §5.4: nothing in Phase 1 decides anything from a location, so storing one would be an
unvalidated key at worst and unread state at best.

---

## 14. Frontend architecture

**Decision P1-D8 — Next.js App Router as installed, server components for data, client components
for interaction, no state library.**

```text
apps/web/app
  /(entry)/page.tsx              session entry             server + form action
  /characters/page.tsx           list / create             server, fetches /api/characters
  /play/[characterId]/page.tsx   panel + Atlas shell       server shell, client islands
  /play/[characterId]/hunt/[huntKey]/page.tsx              pre-combat screen
  /_lib/api.ts                   the ONLY fetch layer      typed, shared error mapping
  /_components/…                 Atlas, Marker, CharacterPanel, StaminaReadout
```

- **Data flows down from server components**; the client holds only interaction state — camera
  (pan/zoom), selected marker, form fields. Character, Stamina, Premium and activity state are
  never mirrored into a client store where they can go stale.
- `apps/web` may import `@global-idle/shared` **and nothing else** from the workspace (0B spec
  §5.2, enforced by dependency-cruiser). Phase 1 puts the API response types in `shared`, so the
  client is typed without reaching into `domain`.
- **No** Redux/Zustand/React-Query. Server components plus `useState` for camera and selection
  covers this surface; adding a store here is the heavyweight framework §14 of the brief warns
  against. When Phase 2 adds live combat state, *that* is the evidence to revisit.
- Responsive: single column ≤ 768 px with the marker detail as a bottom sheet; two columns above.
- Accessibility: markers are `<button>`s in the SVG with accessible names, visible focus, `Escape`
  to deselect, and no hover-only information.

---

## 15. Visual acceptance criteria

Phase 1 is the first phase a reviewer must **look at**. It therefore ships a deterministic demo
state and an explicit visual checklist.

**Demo seed** (`pnpm seed`, extended): one account `dev/reviewer`, one character `Rookie`,
Level 1, no vocation, Stamina 42:00, `Free`, not in an activity.

A reviewer running `pnpm install && pnpm dev` must be able to see, in a browser, at **1440×900**
and **390×844** (iPhone-class) and with touch emulation on:

| # | Visible |
|---|---|
| V1 | session entry; entering a handle lands on the character list |
| V2 | empty account → creation form; invalid/taken name shows an inline error |
| V3 | one character in the list, selectable |
| V4 | character panel: name, `Level 1`, *"Not yet chosen — Oracle at Level 8"*, `42:00 NEUTRAL`, `Free` |
| V5 | Atlas shell renders; pan and zoom work with mouse **and** touch |
| V6 | Rookgaard is `AVAILABLE`; the locked regions are visibly locked and inert |
| V7 | the Rookgaard Sewers marker is visible and selectable **by tap**, not only hover |
| V8 | hunt details panel: label, summary, primary creature `Rat` |
| V9 | ENTER HUNT → pre-combat screen; reload returns to it; LEAVE returns to the Atlas |
| V10 | a second ENTER for the same character is refused with a readable message |

**Decision P1-D9 — Playwright for the E2E flow; no pixel-diff visual regression in Phase 1.**

`scripts/verify-dev-bootstrap.mjs` already proves the stack boots, so the E2E job drives a real
browser against that same stack and asserts **roles, names and state** — not pixels.
Pixel-diffing placeholder art that is about to be replaced (§11) would produce brittle failures
with no information; revisit when the real assets land.

**Playwright is a NEW dependency.** It appears nowhere in the repository today, so the
implementing pass owns its real cost, and the spec names it rather than discovering it in CI:

- `@playwright/test` pinned in the root `package.json`, like every other tool (§3.10 of the 0B
  spec) — no floating range;
- **Chromium only** in Phase 1. Three engines triple the install and the runtime for a slice with
  one flow;
- the browser binary is installed explicitly (`npx playwright install --with-deps chromium`) and
  **cached by version** in the workflow, because an uncached install on every run is a minute of
  download that teaches nothing;
- touch/mobile acceptance uses Playwright's device emulation against the 390×844 viewport of
  §15 — emulation, not a real device, and the spec says so rather than implying coverage it
  does not have.

---

## 16. Test matrix

Stable ids, grouped as Phase 0B's were. **Every case is here because a behaviour above requires
it**; the count is the consequence, not a target.

| Group | Ids | Covers |
|---|---|---|
| **S** — session/auth | S1–S11 | create session; reload persists; no cookie → 401; logout clears; cookie for account A cannot read account B; `/health` and `/metrics` stay unauthenticated; tampered signature rejected; **`sessionId` is minted server-side**; **same cookie ⇒ same `sessionId`**; **a second login ⇒ a different `sessionId` on the same account**; **a client-supplied `sessionId` is ignored** |
| **DEV** — dev-provider containment | DEV1–DEV4 | the provider is registered only when `NODE_ENV!==production` **and** `GLOBAL_IDLE_DEV_AUTH=1`; with either missing the route is **absent (404)**; `NODE_ENV=production` + `GLOBAL_IDLE_DEV_AUTH=1` **fails to boot**; the demo seed and E2E use the dev provider |
| **CH** — character | CH1–CH9 | create with server-owned fields; `vocation` is NULL; `baseLevel` is 1; Stamina row created at 42:00 NEUTRAL; name validation; duplicate name; roster capacity refusal; client-supplied `baseLevel`/`vocation` rejected; **a second Origin Character is refused with `ORIGIN_CHARACTER_EXISTS`** |
| **D** — database/invariant | D14–D20 | migration applies on a clean DB **and** over Phase 0B's; the **first** Origin Character is accepted; a **second** on the same account is **refused by I1b**; a **different account** may have its own; D4/D5 still pass (two Knights refused, retired vocation reusable); a Knight and an Origin Character coexist; `baseLevel >= 1` CHECK holds |
| **AT** — atlas/content | AT1–AT7 | bundle validates; marker→region kind-check; marker→hunt kind-check; hunt's `activityTypeKey` resolves in the registry; position within bounds; exactly one AVAILABLE region; unknown asset id fails the build |
| **API** — contracts | API1–API10 | each route's happy path and its documented error code, including `404`-not-`403` for a foreign character |
| **AC** — activity boundary | AC1–AC13 | Enter creates a real Activity; claim acquired; `staminaActivatedAt` stays NULL; Stamina stays NEUTRAL; reload returns the same Activity; Leave ends it and releases the claim; second Enter → `OccupancyConflict`; double-submitted Enter is idempotent; **`contentKey` is persisted on the Activity**; **reload reconstructs the Hunt from `(contentVersion, contentKey)` alone**; **the key resolves against the Activity's OWN pinned version**; **a non-`hunt` kind is refused with `CONTENT_KIND_MISMATCH` and creates nothing**; **no endpoint can change `contentKey` after creation** |
| **UI** — component/interaction | UI1–UI8 | Atlas pan/zoom; marker selection by click **and** by tap; `Escape` deselects; focus visible; locked region inert; bottom sheet at mobile width; no layout shift on load; error state renders with retry |
| **E2E** — browser flow | E2E1–E2E10 | V1–V10 of §15, desktop and touch viewports |
| **REG** — Phase 0B regression | REG1–REG5 | the 92-case matrix still passes; `pnpm dev` bootstrap still green; boundaries unchanged; occupancy/idempotency/content contracts Phase 1 consumes behave as Phase 0B proved |

**Totals: 10 groups, 84 mandatory cases** — S 11, DEV 4, CH 9, D 7, AT 7, API 10, AC 13, UI 8,
E2E 10, REG 5 —
counted by a `scripts/count-matrix.mjs` extension, so "84/84" stays a countable claim rather than
an assertion. Phase 0B's 92 cases remain in force and are **not** renumbered.

---

## 17. CI and developer workflow

`pnpm install && pnpm dev` **must keep working unchanged** — it is `VERIFIED` and §16's R-group
protects it. `pnpm dev` additionally serves the new routes; the existing `dev-bootstrap` job keeps
asserting the same acceptance signals, plus one: `apps/web` serves the session entry route with a
`200`.

New blocking checks, only where they add evidence:

| Check | Why |
|---|---|
| `pnpm test:e2e` (Playwright, own job, Chromium only) | the only check that proves a human can play the slice. Its own job because it needs a browser install the other jobs do not |
| content validation extended to the new kinds | already a check; the new rules ride it |
| asset-manifest resolution | a missing asset must fail the build, not the browser |

Phase 1 must **not** add a check that merely restates an existing one.

---

## 18. Observability

Reusing the Phase 0B `MetricsPort` / `DomainEventSink` — no new mechanism.

| Signal | Kind | When |
|---|---|---|
| `character_creation_failures_total{reason}` | counter | validation, name collision, roster full |
| `atlas_content_load_failures_total` | counter | the bundle cannot be resolved |
| `hunt_entry_failures_total{reason}` | counter | occupancy conflict, unknown hunt, not owned |
| `authorization_rejects_total{route}` | counter | a session-scoped route refused |
| `character.created` | domain event | after commit, with `characterId` and `accountId` |
| `activity.transition` | domain event | **already emitted by Phase 0B** — Enter/Leave ride it |

Deliberately **not** instrumented: pan, zoom, marker selection, panel opens. Per-click telemetry is
noise Phase 1 has no consumer for.

---

## 19. Security / authority review

| Claim | How Phase 1 holds it |
|---|---|
| The browser does not choose stats | `baseLevel`/`vocation` are server-written; the request body carries `{ name }` only, and extra fields are rejected by schema |
| The browser does not choose Stamina | `StaminaView` is read-only; no endpoint accepts a Stamina value |
| The browser does not choose Premium | entitlements are read-only in Phase 1; no purchase path exists |
| The browser does not choose activity outcome | Enter/Leave are commands; the server decides state. No outcome exists yet to influence |
| Ids are account-scoped | every character/activity route resolves ownership from the session; a foreign id is **404** |
| Content selection is not arbitrary object access | `:key` is validated against the **content key grammar** and looked up in the pinned bundle — never used to index a server object or a path |
| No client-authority leak through the map | the Atlas carries content, not entitlements; a locked region is locked **server-side** — hiding it in the UI is presentation, not enforcement |
| Session integrity | signed `HttpOnly` cookie; a tampered signature is rejected (S7) |

---

## 20. Definition of Done

| # | Criterion |
|---|---|
| 1 | `pnpm install && pnpm build && pnpm test` succeeds from a clean checkout (W12 still passes) |
| 2 | `pnpm dev` brings the stack up and serves the Phase 1 routes; the `dev-bootstrap` job is green |
| 3 | The Phase 0B 92-case matrix passes **unchanged** |
| 4 | The Phase 1 matrix is 84/84, counted by script |
| 5 | The migration applies to a clean database **and** over an existing Phase 0B database |
| 6 | D4/D5 still pass; exactly **one** playable Origin Character per Account (I1b, D16–D18) |
| 7 | A reviewer can complete V1→V10 in a browser at 1440×900 **and** 390×844 with touch |
| 8 | One character is visible with Level 1, no vocation, 42:00 NEUTRAL, Free |
| 9 | The Atlas shell renders, pans and zooms with mouse and touch |
| 10 | Rookgaard is available; locked regions are visible and inert |
| 11 | The Rookgaard Sewers marker is selectable without hover |
| 12 | ENTER creates a real Activity; reload returns to it; LEAVE releases the claim |
| 13 | `staminaActivatedAt` is NULL and Stamina is NEUTRAL throughout (AC3, AC4) |
| 14 | No Phase 2 gameplay exists: no rooms, encounters, XP, gold, loot, damage or supplies |
| 15 | No vocation kit exists for any of the five vocations |
| 16 | Every authoritative value in the UI came from a server response |
| 17 | Assets are referenced by `assetId` through the manifest; no gameplay rule names a file |
| 18 | New observability signals fire from the real flows (as Phase 0B requires of its own) |
| 19 | Documentation updated: this spec, `ROADMAP`, `MASTER_DEVELOPMENT_ROADMAP`, `DESIGN_INDEX`, `AGENTS.md` focus |
| 20 | Both CI jobs green, plus the new E2E job |
| 21 | Independent review completed before merge; **the author does not merge** (`AGENTS.md` §3) |

---

## 21. Autonomous decisions recorded

| # | Decision | Rationale |
|---|---|---|
| P1-D1 | **Dev/test-only** credential provider + signed `HttpOnly` cookie | smallest thing that gives a real authorization boundary without building an identity product. Registered only in dev, absent in production, and a boot failure if misconfigured (§3.2) |
| P1-D2 | Phase 1 implements the **pre-vocation Origin Character state**; zero kits | the only reading that does not contradict the locked tutorial flow. `null` is "not chosen yet", never a sixth vocation |
| P1-D3 | Inline SVG Atlas, no map library | one region and a few markers; SVG gives focusable, accessible markers for free |
| P1-D4 | The region is Rookgaard | the only region the tutorial baseline permits at Level 1 |
| P1-D5 | The hunt is `hunt.rookgaard.sewers`, creature label `Rat` | `TUTORIAL_ROOKGAARD_ROADMAP.md` §7 |
| P1-D6 | Enter creates a **real** Activity, stopping in the documented pre-consumption state | it is an approved state, not a fake; it exercises the primitives Phase 0B built |
| P1-D7 | `assetId` + manifest indirection | real art replaces placeholders without touching gameplay |
| P1-D8 | App Router server components, no state library | no evidence yet justifies a store |
| P1-D9 | Playwright E2E, no pixel diffing | placeholder art makes pixel baselines noise |
| P1-D10 | `vocation` becomes nullable; forward-only migration | see §13.2 — the schema cannot otherwise represent the approved origin character |
| P1-D11 | No retirement UI in Phase 1 | with capacity 1, a retire button strands the player |
| P1-D12 | No server-side "selected character" | the Activity context already owns in-flight state; a second home would drift |
| P1-D13 | `Activity.contentKey` — durable, server-owned, generic | the Activity row could not say **which** Hunt it was; a `huntKey` column would have to be replaced by Phase 5's Dungeons (§9.5) |
| P1-D14 | `sessionId` distinct from `accountId`, both in the signed cookie | `claimHolderSessionId` needs a real session identity; passing `accountId` would make two browsers indistinguishable and break `ADR-008` eviction before Phase 2 implements it (§3.2.1) |
| P1-D15 | **No** `Character.locationKey`, and no `location` content kind | nothing in Phase 1 decides anything from a location; the first draft's key resolved against nothing (§5.4) |
| P1-D16 | **I1b** — one playable Origin Character per Account, by partial unique index | I1 does not constrain NULLs at all, so without a second index a second Origin Character is accepted (§13.2) |

---

## 22. Open items for the reviewer

1. **§13.2 touches `VERIFIED` artefacts twice** — `vocation` becomes nullable, and a second
   partial unique index (**I1b**) is added. Neither weakens I1, but both change a Phase 0B
   constraint's shape and deserve an explicit yes.
2. **`OPEN` — retirement before vocation is a tutorial replay path.** I1b is scoped to playable
   rows, so retiring an Origin Character frees the slot and another Level-1 Character can be
   created. `TUTORIAL_ROOKGAARD_ROADMAP.md` §2 anticipates the question (`tutorialCompleted`,
   and the warning not to judge eligibility by counting characters) but **does not answer it**.
   Phase 1 implements neither retirement nor tutorial gating, so the path is unreachable here —
   this is flagged, not decided, and it belongs to whoever owns the replay rule.
3. **§4's reading of the roadmap's "one vocation" line.** This specification declines that wording
   and implements the pre-vocation Origin state instead. If the Product Owner meant something
   else, this is the cheap moment to say so.
4. **§9.2's boundary** is the decision most likely to be argued. The alternative (stop before
   creating an Activity) is written out in full so it can be chosen instead.
5. **§5.4 removes durable location.** If the Product Owner expects the Character panel to show a
   *place* finer than the region — a Temple, an inn, a depot — that is Option A and it changes
   this phase's content schema. Cheaper to say now than after §12 is built.
6. **Session design (§3.2) is dev-only and Phase 1 is not production-deployable.** If the slice is
   meant to be reachable by real players, real authentication is a prerequisite and belongs in the
   plan before implementation, not after.
