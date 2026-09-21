# Phase 1 — Implementation Notes

**Status:** `IMPLEMENTATION_COMPLETE` — pending independent review. **Not** `VERIFIED`.
**Correction pass:** three findings from the independent review of `ad52bbb` are fixed; see §0.
**Specification:** [`PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md`](./PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md)
(`IMPLEMENTATION_SPEC_READY`)

> This document exists so that **nothing the implementation decided is only visible in a diff.**
> The specification is approved and stays as approved; every place the implementation had to
> refine, extend or correct it is listed here, with what it cost and why the alternative was
> worse. A reviewer who reads only this file knows exactly where the built thing and the approved
> thing differ.

---

## 0. Correction pass — the three review findings

### 0.1 The Atlas implemented part of §7.1, and the tests only asked for that part

§7.1 is a table of capabilities. The first pass implemented button zoom, keyboard pan and zoom,
pointer-drag pan, marker click/tap and `Escape` — and the UI cases asserted exactly that, so the
gaps were invisible. What was missing, and is now implemented:

| §7.1 row | What was missing |
|---|---|
| Zoom — desktop | **wheel** entirely |
| Zoom — touch | **pinch** entirely |
| Zoom — bounds | clamped to a hard-coded `0.5..3`, not to the authored `minZoom..maxZoom` |
| Deselect | `Escape` only; **pressing empty space** did nothing |
| Region focus | regions were `aria-hidden` decoration — not focusable, not activatable |
| Locked region (§7.3) | `aria-hidden`, which HIDES the sense of scale from exactly the users who cannot see it; §7.3 says **`aria-disabled`** |

Three things this forced into the open:

1. **Regions cover the whole map, so they cannot be treated as controls that swallow gestures.**
   Making them focusable and clickable first broke panning and pinching everywhere except the gaps
   between regions. A press is now resolved on pointer-**up** by how far it travelled: a short
   press activates the region under it, or deselects if it was on empty space; a long one panned.
   One gesture surface, three outcomes, no dead zones.
2. **Zoom bounds come from content.** `zoomBounds()` takes the INTERSECTION of the `minZoom`/
   `maxZoom` of the regions a player can actually be in, so no reachable region renders outside
   its own declared range. Phase 1 authors exactly one AVAILABLE region, so that is Rookgaard's
   `0.6..3`; the intersection is what keeps it correct when a second opens.
3. **A marker inside a locked region is unreachable**, however the marker itself is authored.
   §7.3 forbids clicking through to unavailable content, and the region is the unavailable thing.

Zoom is anchored at the cursor or at the pinch midpoint, so the world under the player's finger
stays put; zooming about the origin makes the map slide away from whatever they were looking at.

The eight UI cases are still §16's eight. **The matrix did not change; the coverage of it did.**
Pinch is driven through Chromium's real input pipeline (`Input.dispatchTouchEvent`) rather than a
synthesised `PointerEvent`, because the second would prove a handler exists rather than that the
browser routes a two-finger gesture into it.

### 0.2 Two local host conventions, and a cookie with no policy

The web defaulted to an API on `127.0.0.1:3001` while the PR told the player to open
`localhost:3000`. Those are different **hosts**, therefore different **sites**, so every
credentialed request from that page was cross-site — and `SameSite=Lax` drops the cookie on a
cross-site `fetch`. The symptom is a silent `401` with nothing in the network panel to explain it.
Separately, `Set-Cookie` never carried `Secure`, on any origin.

**One convention: `127.0.0.1`.** Literal, no name resolution, and no chance of resolving to `::1`
on one machine and `127.0.0.1` on another — which would reintroduce the same split. It is now the
web's default API base, the documented URL, the `WEB_ORIGINS` default, the E2E base and the
bootstrap verifier's. `localhost` was removed from the CORS default deliberately: a CORS refusal
is a worse experience than a working page and a far better one than a silent `401`.

**The cookie's attributes are a policy, decided once from configuration** — `PUBLIC_ORIGIN`, the
origin the API is served on as the browser sees it:

| `PUBLIC_ORIGIN` | Cookie |
|---|---|
| `https://…` | `HttpOnly; SameSite=Lax; Secure` |
| `http://` on loopback (`127.0.0.1`, `localhost`, `::1`) | `HttpOnly; SameSite=Lax` — **no** `Secure`, which a browser would simply discard over http |
| `http://` on any other host | **boot failure** |

The third row is the one worth arguing about. A session travelling in the clear on a public host is
readable by anything on the path; marking it `Secure` would stop the cookie working rather than fix
that. Neither is a default worth shipping, so the process refuses to start — and the check lives on
the *field*, not on the object, because an object-level refinement only runs once every other field
has parsed, and §11.3 promises every problem at once.

Nothing is inferred per request. `X-Forwarded-Proto`, `Host` and the body are all
attacker-controlled, and a cookie whose security attributes depend on them has none. A test sends
all three and asserts the cookie is unchanged.

### 0.3 The idempotency fingerprint contained something the client never sent

`POST /api/characters/:id/hunt` fingerprinted `{ characterId, huntKey, contentVersion }`. The
server picks `contentVersion` from whatever bundle is current when the request lands — so:

1. a request with key `K` enters a Hunt under bundle `V1`;
2. `V2` is published;
3. the network retries the **same logical request** with the **same key**;
4. it fingerprints against `V2`, mismatches, and comes back `IDEMPOTENCY_CONFLICT`.

The caller changed nothing. That is not idempotency; ADR-017 fingerprints the semantically
significant **client command**, and which bundle the Activity pinned belongs to the first
execution's **result**.

The fingerprint is now `{ characterId, huntKey }`, and bundle selection, Hunt resolution and the
kind-check moved **inside** the executed callback — so a replay never re-resolves. It costs a
content read inside the transaction; the resolver caches per version, and the alternative is a
retry refused for a publication the caller never saw. A failed command writes no record, so an
unknown or wrong-kind key can be retried; a *different* `huntKey` under the same key is still an
explicit conflict.

Five cases cover it: a replay after a publication, after the Hunt **changed**, after it was
**removed**, after it was **locked**, and the same key aimed at a different Hunt. In each of the
middle three a *fresh* command is correctly refused while the replay still succeeds — because the
original Activity pinned its own bundle.

---

## 1. Contract refinements — `§12`

### 1.1 `POST /api/characters/:id/hunt` **requires** an `Idempotency-Key` header

§12 says the route *"carries an idempotency key and goes through the Phase 0B fingerprinted
idempotency primitive"*. The implementation makes that a **requirement**, not an option, and adds
two error codes to the envelope:

| Code | Status | When |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | `422` | the header is absent or empty |
| `IDEMPOTENCY_CONFLICT` | `409` | the key was already used for a **different** request |

**Why required.** Optional would make AC8 — *"a double-submitted Enter is idempotent"* — a property
of client goodwill rather than of the route. A client that omits the key races the occupancy
constraint and gets a `409 OCCUPANCY_CONFLICT` **against itself**, which a player reads as "the
button is broken". Making the header mandatory means the guarantee holds for every caller,
including ones written after this phase.

**What it costs.** One more thing a client must send. `apps/web` mints one per click
(`crypto.randomUUID()`), so a retry of that submission replays and the next deliberate entry
genuinely runs.

**The fingerprint is over the SEMANTIC fields** — `{ characterId, huntKey, contentVersion }` — so a
client that serialises its retry differently is still making the same request (proved in AC8), and
one that aims the same key at a different Hunt is refused without overwriting the stored outcome.

### 1.2 `GET /api/characters/:id/activity` returns the literal JSON `null`

§12 declares this route `ActivityView | null`. Returning `null` through Nest sends an **empty 200
body**, which is not `null` — it is "no answer", and every consumer then has to guess. The handler
writes the response itself for this one route. AC6 asserts it.

---

## 2. Content pipeline — one bundle, not one per source file

`packages/game-data/content/` holds one file per authored area (`placeholder.json`,
`rookgaard.json`). The build CLI produced **one bundle per file**, which was unambiguous while
there was exactly one file.

Phase 1 added the second, and `currentVersion()` is *"the most recently published bundle"* — so
publishing the placeholder content after Rookgaard **took the whole world away**: the Atlas
resolved, found no regions, and rendered an empty map. Found by running the stack, not by reading
it.

**The build now merges every source into ONE artifact.** Authoring stays per-area; a bundle is what
the game runs, and the game runs one set of content at a time. There is nothing left for
publication order to decide. Cross-file problems — a duplicate key, a reference into another file
that does not resolve — now fail the build instead of never being checked.

---

## 3. Vocabularies that content and code must agree on — `§10.2`

§10.2 requires two build-time checks that span packages:

- a hunt's `activityTypeKey` **exists in the activity registry**;
- every `*AssetId` **resolves in the asset manifest**.

The registry lives in `packages/domain`; the manifest lives in `apps/web`. `packages/game-data`
may import neither (§5.2). So the **names** — and only the names — live in
`@global-idle/shared`: `ACTIVITY_TYPE_KEYS` and `ASSET_IDS`.

A list of names is not a second source of truth; a list of behaviours would be. Neither list is
allowed to drift:

| Direction | What stops it | Failure mode |
|---|---|---|
| a name with no implementation | `assertRegistryCoversContentVocabulary()` at API startup | the process refuses to boot |
| an asset id with no placeholder | `Record<KnownAssetId, PlaceholderAsset>` | a type error |
| content naming something absent | `validateBundleSource` | the build fails |

What an activity type *does* (family, Stamina classification) stays in the domain registry, exactly
where §7.3.2 put it and for the reasons it gives.

---

## 4. `pnpm dev` bootstrap — one added acceptance signal

§17 asks the existing `dev-bootstrap` job to assert one more thing: *"apps/web serves the session
entry route with a 200"*. The verifier previously waited for **any** 200 on the web port, which was
true of a build serving nothing a player could use. It now requires the entry affordance itself —
the handle field and the control that starts a session — in the served HTML.

---

## 5. Corrections to the approved specification

Both are recorded in the specification's own header and in PR #5; they are repeated here so this
file is a complete list of deltas.

1. **§9.4 — Stamina is not always `NEUTRAL`.** An idle Character derives `RECOVERING`. Corrected
   against the running `deriveStaminaMode`, not against memory.
2. **§16 — the D group was renumbered `D14–D23` → `D19–D28`.** Phase 0B owns `D1–D18`; the draft's
   ids named five live cases a second time.

---

## 6. Defects found by running the thing, not by reading it

Listed because each one is invisible to review and each one was a real failure:

| Found by | Defect |
|---|---|
| `curl` against the real API | a second ENTER returned **500**: I9 trips before the occupancy claim, and nothing translated it |
| a real browser | **CORS**: web and API are different origins in Phase 1, so every credentialed request was blocked |
| a real browser | the sign-in form **submitted natively before React hydrated** |
| a real browser | the Atlas took a pointer capture for panning and **swallowed marker clicks** |
| a real browser | `next start` served the **previous build's chunk manifest** — a stale process, not a code defect, but the failure mode is worth knowing |
| running the stack | the **two-bundle** problem in §2 above |
| Playwright | `devices['iPhone 13']` pins **WebKit**, which a Chromium-only suite does not install |
| the matrix counter | `E2E10` **cannot be split** back into a prefix and a number by a regex over the id alone |

---

## 7. What is NOT here

Phase 1 implements the vertical slice and nothing beyond it. No combat, no rooms, no XP, gold,
loot, supplies, death, inventory, equipment, skills, party, Oracle, quests, dungeons, market,
Forge, Imbuements, Wheel, Skill Tree, Premium purchase, production authentication, durable
locations, or bulk asset import. The E2E suite asserts the absence of Phase 2 vocabulary on the
pre-combat surface so this stays true by test rather than by intention.
