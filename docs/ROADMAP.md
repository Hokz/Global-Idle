# Roadmap — navigation

**This page is a map, not a definition.**

The **one canonical sequence** of phases — their ownership, dependency gates and high-level
deliverables — is [`docs/MASTER_DEVELOPMENT_ROADMAP.md`](MASTER_DEVELOPMENT_ROADMAP.md) §20.

This file used to carry a second, independently maintained set of phase definitions. Two
roadmaps meant two places to update and one to forget, and they had already drifted: Phases 5B,
7A and 10 existed only here, while Phase 3.7's detail existed only there. The definitions now
live in the master roadmap alone, and this page points at them.

---

## Where each kind of answer lives

| Question | Document |
|---|---|
| What is the phase sequence, and what does each phase deliver? | [`MASTER_DEVELOPMENT_ROADMAP.md`](MASTER_DEVELOPMENT_ROADMAP.md) §20 |
| What must be true *before* a phase starts? | [`PHASE_GATES.md`](PHASE_GATES.md) |
| What is built, and what is independently VERIFIED? | [`PROJECT_STATE.json`](PROJECT_STATE.json) — the canonical state |
| What did the Product Owner lock? | [`DECISIONS.md`](DECISIONS.md) |
| What is still undecided, and who owns deciding it? | [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) |
| What does a given system actually do? | [`DESIGN_INDEX.md`](DESIGN_INDEX.md) → `docs/design/…` |
| How is a phase being implemented? | `docs/specs/<phase>/…` |

---

## The sequence at a glance

Detail for every entry is in the master roadmap; nothing below adds to it.

```text
0A  Architecture                        ARCHITECTURE_APPROVED
0B  Technical foundation                VERIFIED
1   World / character vertical slice
2   Hunt simulator                      VERIFIED
3   Itemization
3.5 Tile / spatial Game Window
3.6 Movement fidelity
3.7 First real asset visual slice
    ── PRE-PHASE-4 GATE ──              (specification, then implementation + validation)
4   Party / vocations                   (Skills; the Main + companions; personal Active Party)
                                        Phase 4 foundation
                                        4A Playable Beta Slice / Creator Preview
                                           (a milestone inside Phase 4 — not a gate)
                                        remainder of Phase 4
5   Quest / dungeon / boss framework    (generic engine; solo + one-account Party)
    ── PRE-5B GATE ──
5B  Multiplayer activities              (one selected actor per Game Account)
                                        slice 1 infrastructure
                                        slice 2 first cooperative quest
                                        slice 3 Warzones
6   Economy                             (minimum cross-account settlement lands EARLIER)
7   Forge / Imbuement / Wheel / vocation Skill Trees
7A  Advanced progression                (Bestiary, Charms, outfits, achievements)
8   Premium / automation
9   Content expansion
10  Scale / hardening                   (but risk is hardened where it is introduced)
    later: PvP arena, matchmaking, ranking — after the combat foundations
```

There is **no Phase 3.8** (2026-09-25). After Phase 3.7 comes the PRE-PHASE-4 gate: its
specification — drafted and pending independent review — then its implementation and independent
validation. Then the Phase 4 foundation, **Phase 4A — Playable Beta Slice / Creator Preview**, and
the remainder of Phase 4, before Phase 5. Phase 4A is a mandatory playable milestone inside
Phase 4, not a replacement for it and not a gate. The master roadmap §20 says so, and these lines
only repeat it.

---

## Historical note — superseded phrasing

This page's Phase 1 list once read **"one vocation"**. The accepted Phase 1 specification
([`specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md`](specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md)
§§ *Vocation at creation*) cites that exact phrase as the wording it had to reconcile against
`TUTORIAL_ROOKGAARD_ROADMAP.md`, and resolved it: Rookgaard characters start **without** a
vocation and choose one at Level 8.

The phrase is recorded here so that reasoning stays checkable. It is **history, not a
requirement** — the current Phase 1 entry is in the master roadmap.

---

**Phase status is not shown here on purpose.** A phase marker copied into a second document is a
phase marker that goes stale in one of them. `PROJECT_STATE.json` is the canonical state, and
`scripts/check-project-state.mjs` fails CI if `AGENTS.md` disagrees with it.
