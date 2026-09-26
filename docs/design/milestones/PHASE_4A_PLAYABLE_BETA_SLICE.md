# Phase 4A — Playable Beta Slice / Creator Preview

**Status:** `APPROVED DIRECTION` — approved by the Product Owner after the final 2026-09-25
synchronization decisions, and recorded in the review correction of PR #13 head `c74b845`
(2026-09-26). **Not implemented, and not started.** Recording it changes nothing in
[`PROJECT_STATE.json`](../../PROJECT_STATE.json), which alone holds phase status.
**Where it sits:** a **mandatory playable milestone inside the Phase 4 program** —
[`MASTER_DEVELOPMENT_ROADMAP.md`](../../MASTER_DEVELOPMENT_ROADMAP.md) §20. It does not replace
Phase 4, and it is not a gate.
**Related:** [`DECISIONS.md`](../../DECISIONS.md) § *Phase 4A — Playable Beta Slice / Creator
Preview* · [`PHASE_GATES.md`](../../PHASE_GATES.md) ·
[`UI_SURFACE_ARCHITECTURE.md`](../../architecture/UI_SURFACE_ARCHITECTURE.md) ·
[`ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](../world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md)

---

## 1. What it is

Phase 4A is the first time the pieces built since Phase 1 are played **as one journey** — by one
person, from sign-in to a restored session. It is also the first time a creator can drive that
journey deliberately, from the server, to test it.

It is a **beta**. It may be rough, visually incomplete and unbalanced, and its values may be
`INITIAL/TUNABLE`. It may not be fake: every step runs on the real server-authoritative paths, and
what it shows after a reload comes from PostgreSQL and server state.

## 2. Where it sits

```text
Phase 3.7 — VERIFIED
  ↓
PRE-PHASE-4 specification
  ↓
PRE-PHASE-4 implementation + independent validation
  ↓
Phase 4 foundation
  ↓
PHASE 4A — PLAYABLE BETA SLICE / CREATOR PREVIEW
  ↓
remainder of Phase 4
  ↓
Phase 5
```

- There is **no Phase 3.8**.
- 4A is **inside** the Phase 4 program. It does not replace Phase 4, and it removes none of Phase
  4's deliverables.
- 4A is **not a gate**. The PRE-PHASE-4 gate stays exactly as
  [`PHASE_GATES.md`](../../PHASE_GATES.md) states it, and 4A adds no obligation before Phase 4
  starts.
- Which Phase 4 deliverables make up the **foundation** 4A stands on, and which are the
  **remainder**, is for the Phase 4 specification to place. The journey below sets the minimum:
  whatever it needs is built before 4A closes, by the foundation or by 4A itself.

## 3. The acceptance journey — minimum

One person, in a browser, completes all of it:

| # | Step |
|---|---|
| J1 | launch the web client |
| J2 | sign in through **development / staging authentication** |
| J3 | select or create a **Game Account** |
| J4 | start its **Main Character** in Rookgaard — the Main from creation, vocationless there (`ADR-022` RK3) — and choose a **globally unique Character name** (`ADR-024` NM1) |
| J5 | enter a small Rookgaard **Game Window** |
| J6 | use a small, functional **Atlas** (§4) |
| J7 | hover, focus and click Atlas entries, and see useful labels and details |
| J8 | interact with at least one **real, reusable NPC / dialogue flow** |
| J9 | select and enter at least one **Hunt** — preferably the Rookgaard Sewers and its Rats |
| J10 | complete a short combat rotation |
| J11 | gain **XP** |
| J12 | progress at least one relevant **Skill** |
| J13 | receive **loot** |
| J14 | equip and unequip real **ItemInstances** |
| J15 | visibly observe the effect of equipment and stats on combat |
| J16 | use at least one **potion** through the tactical **action-slot** model |
| J17 | exit, reload or log out |
| J18 | return, and see the authoritative persistent state restored from PostgreSQL / server state |

The journey is played in Rookgaard, so the Main plays **alone**: no Companions, no Main-game Party
and no co-op exist there (`ADR-022` RK2).

**What exists today, and what the journey still needs.** This is a reading of the code at the
VERIFIED Phase 3.7, for the Phase 4 specification to start from; it assigns nothing.

| Steps | Today | Still needed |
|---|---|---|
| J1 | the web client (`apps/web`) | — |
| J2 | a **dev credential provider**: a self-asserted handle with no secret, enabled only by `GLOBAL_IDLE_DEV_AUTH=1` and refused at boot under `NODE_ENV=production` | what *staging* is, and how its sign-in is protected |
| J3 | one identity resolves to exactly one Account (`DOMAIN_MODEL.md` §5.18) | the Login apart from the Game Account (PRE-4, `ADR-024` §5) and a minimal select / create flow (`ADR-022` GA-O10) |
| J4 | creation makes the Main — one vocationless Rookgaard character, the code's *Origin Character*; its name is checked per Account only | global name uniqueness (PRE-4, `PHASE_GATES.md` § *G4.4*) |
| J5 | the verified 15 × 11 Game Window and the Rookgaard visual slice (Phases 3.5–3.7) | — |
| J6–J7 | the World Atlas and the Rookgaard atlas: Rookgaard `AVAILABLE`, Thais and the other regions `LOCKED`, the Sewers marker. Temple, shop, trainer and quest pins exist only as `demo` markers | useful labels and details on each entry (§4) |
| J8 | one service counter — *"Not an NPC, not a chat tree"* (`packages/game-data`) | a reusable NPC / dialogue flow |
| J9–J11 | the Rookgaard Sewers Hunt, its Rats, XP and settlement (Phases 2–3.6) | — |
| J12 | no Skills | Skills and their progression (Phase 4) |
| J13–J14 | loot, ItemInstances, equipment slots, equip and unequip (Phase 3) | — |
| J15 | combat already reads the equipped items | a visible way to see the effect (§6) |
| J16 | a carried potion is drunk below a health threshold (`supplyUseBelowPercent`) | the tactical action slots (`DECISIONS.md` § *Tactical action slots*) |
| J17–J18 | sign-out, and server-authoritative persistence in PostgreSQL (`ADR-009`) | proof across every step above |

## 4. The minimum Atlas

- **Rookgaard** is available;
- the **Temple**, the **Sewers** and at least one useful marker;
- **Thais** may appear, locked and marked as future;
- hovering, focusing or clicking an entry shows a useful label and details;
- **no invented geographic polygon or coordinate.**
  [`ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md`](../world/ATLAS_NAVIGATION_AND_REGION_BOUNDARIES.md)
  §4 holds unchanged: a position that is not sourced, or sits on an uncalibrated raster, renders
  as a visible **demo** marker. Calibration, region polygons and the gold highlight stay Phase
  9's.

## 5. Creator tooling — development and staging

**Administrative capability belongs at the authenticated authorization level, not to a fake
ordinary *"God Character"*.** A creator is a **development / staging privileged identity**. The
capability comes from who signed in; no Character, Game Account or item carries it, and the
Character being tested stays an ordinary Character.

The plan must support server-side commands such as these:

| Command | What it must go through |
|---|---|
| set / add XP | the ordinary XP write. `baseLevel` follows as its projection (`DOMAIN_MODEL.md` I29, `PHASE_GATES.md` § *G4.2*) |
| set Level | **only** the authoritative XP → Level invariant: the command sets the XP that Level needs, and never writes `baseLevel` |
| set / add Skill progress | the Skill progression path Phase 4 builds |
| restore HP, Mana and Stamina, where applicable | the state the game itself keeps for them |
| grant / remove / equip test items | real `ItemInstance`s, through custody, ownership and binding (`ADR-021`) |
| grant / remove test Gold | valid ledger and domain paths — never a balance edit (`ADR-003`, `ADR-019`) |
| enter / teleport to approved test content | approved test content only |
| start / reset a test Hunt | the Hunt lifecycle and its settlement |
| set / reset safe test progression flags | safe test flags only |
| inspect server-authoritative combat calculations | read-only — the combat inspector (§6) |

**DEV tools must NOT bypass domain invariants.** A creator command is a server command with more
authority. It is not a way around the rules: ownership, custody, bindings, the ledger, the XP →
Level projection, global name uniqueness, exactly-once reward claims and the deletion lifecycle
hold for it exactly as they hold for play.

The tooling exists for development and staging. Whether any creator capability ever reaches
production — for support or moderation — is not decided here: moderation authority is still open
(`ADR-024` DEL-O3).

## 6. The combat inspector

A read-only view of the **server's own** combat calculation. Where implemented, it shows:

- Attack Value and its roll;
- Armor Value and its check or roll;
- Defense Value and its check or roll;
- the block / pass outcome;
- the spark / smoke mapping, once it is locked;
- Max Base Damage;
- the damage roll;
- Mitigation;
- the final HP damage;
- the contributions of Skills and equipment;
- the deterministic seed and run identity, where appropriate.

Three rules bound it:

- **It shows the combat model that is implemented when it runs, and names it.** At the VERIFIED
  Phase 3.7 that is the Canary-derived engine Phases 2–3.6 verified. The locked formulas
  ([`DECISIONS.md`](../../DECISIONS.md) § *Combat formulas — weapon attack and defence*) replace
  it only through explicit matrix amendments, where the PRE-PHASE-4 specification places them.
- **It reads; it never decides.** Its values are the server's, never a client-side recomputation,
  and nothing it shows is gameplay authority (`UI_SURFACE_ARCHITECTURE.md`).
- **What is open stays open.** Ranged Accuracy, the damage-roll distribution and minimum damage,
  the rounding stages and the tie / order / visual-mapping rules are not decided
  (`DECISIONS.md`). The inspector shows them only once they are decided and implemented.

## 7. Non-goals

4A does not deliver:

- all of Rookgaard;
- the full tutorial ([`TUTORIAL_ROOKGAARD_ROADMAP.md`](../tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md));
- final Atlas calibration;
- final UI, art or balance;
- production public authentication;
- complete quests, dungeons or the boss framework (Phase 5);
- human multiplayer (Phase 5B);
- Market or economy expansion (Phase 6);
- Forge, Imbuements, the Wheel, full Skill Trees or Premium (Phases 7–8);
- scale hardening (Phase 10).

## 8. What it inherits

- **The Main from creation.** The Rookgaard character **is** the Game Account's Main, vocationless
  there, and alone (`ADR-022` GA1, RK2–RK3). 4A never shows a second Main or a companion.
- **The PRE-PHASE-4 gate has passed** before Phase 4 starts, so before 4A: the Game Account
  deletion lifecycle, the XP projection, the Actor/Participant contract, global names and the
  configuration surface (G4.1–G4.5).
- **Server authority, deterministic replay, pinned content and transactional settlement**, as in
  every phase since 0B.
- **`INITIAL/TUNABLE` values live in the configuration surface** once it exists (`ADR-025` CF1),
  never as scattered literals.
- **The asset boundary** of `AGENTS.md` §9 and Phase 3.7: no proprietary client asset is
  committed, whatever the beta renders.

## 9. Open — for the Phase 4 specification

- which Phase 4 deliverables form the foundation and which the remainder, and which of the
  journey's missing pieces 4A builds itself;
- what *staging* is, and how its authentication is protected;
- how the privileged identity is represented and granted, and how creator commands are recorded;
- whether any creator capability reaches production (`ADR-024` DEL-O3);
- the shape of the reusable NPC / dialogue flow — content-driven and server-scripted
  (`UI_SURFACE_ARCHITECTURE.md` §4) — and which NPC comes first;
- which potion 4A's action slot uses: an ordinary carried one, or a Character-bound one from the
  Store Container, which needs GBC.1 first. A slot's sources and their order are already open
  (`DECISIONS.md` § *Tactical action slots*);
- which combat model the inspector shows at 4A — whether the locked formulas are implemented by
  then;
- the minimal Game Account select / create flow (`ADR-022` GA-O10), and whether Game Account names
  are unique (GA-O11);
- which test content is approved for teleport, and which progression flags are safe to reset;
- how the journey is proven: its matrix cases and its browser evidence.

## Product constraints

- The sequence, the acceptance journey, the minimum Atlas, the creator tooling, the combat
  inspector and the non-goals — Product Owner, approved after the final 2026-09-25
  synchronization.
- *"Administrative capability belongs at the authenticated authorization level, not to a fake
  ordinary 'God Character'."* — Product Owner.
- *"DEV tools must NOT bypass domain invariants."* — Product Owner.
- *"The beta may be rough, visually incomplete and unbalanced; INITIAL/TUNABLE values are
  acceptable."* — Product Owner.
