# Global Idle — Design Index

Navigation page for all Global Idle game-design documents.

Design documents live under `docs/design/<domain>/`. This index is the entry point: agents and
contributors should come here before opening any individual design document, so they know which
documents exist, what each one covers and how far each one has been approved.

---

## Current design documents

### Tutorial / Onboarding

- **Rookgaard Tutorial Roadmap**
  - path: `docs/design/tutorial/TUTORIAL_ROOKGAARD_ROADMAP.md`
  - status: `DESIGN BASELINE`
  - scope: Level 1–8 onboarding, Rookgaard, first Hunt, first Dungeon, Atlas, Level 8 vocation transition.

### Combat / Progression

- **Combat, Base Level & Skills Foundation**
  - path: `docs/design/combat/COMBAT_LEVEL_SKILLS_FOUNDATION.md`
  - status: `DESIGN BASELINE / PARTIALLY OPEN`
  - scope: Base Level, Skills, Exercise Weapons, Training Dummies, vocation aptitude, Canary formula research and layered Combat System architecture.

### Party / Roster

- **Party & Character Roster System Foundation**
  - path: `docs/design/party/PARTY_SYSTEM_FOUNDATION.md`
  - status: `DESIGN BASELINE / PARTIALLY OPEN`
  - scope: unique-vocation roster, Gold unlocks, 1–4 Active Party formation, Frontline, Shared XP eligibility, reconnect behavior.

---

## Documentation lifecycle

Every design document carries a status marker. A document advances through these stages:

```text
DRAFT
→ DESIGN_APPROVED / DESIGN_BASELINE
→ IMPLEMENTATION_SPEC_DRAFT
→ IMPLEMENTATION_SPEC_READY
→ IMPLEMENTED
→ VERIFIED
```

| Stage | Meaning |
|---|---|
| `DRAFT` | Under discussion. Not safe to build against. |
| `DESIGN_APPROVED` / `DESIGN_BASELINE` | The Product Owner has approved the direction. Open items may remain. |
| `IMPLEMENTATION_SPEC_DRAFT` | An implementation spec is complete and submitted for independent review. Not yet approved — do not build against it. |
| `IMPLEMENTATION_SPEC_READY` | The design has been turned into a concrete implementation spec, approved after review. |
| `IMPLEMENTED` | The described behavior exists in the codebase. |
| `VERIFIED` | The implementation has been tested and confirmed to match the design. |

A document may also carry a qualifier such as `PARTIALLY OPEN`, meaning the overall direction is
approved but specific decisions inside it are still unresolved.

Do not change a document's status marker without the Product Owner's approval.

---

## Design documents vs implementation specs

> **Design documents define WHAT the game should do.**
>
> **Implementation specs define HOW a specific approved design is to be implemented.**
>
> **Builders must not *silently* convert OPEN design questions into permanent product
> decisions.**

The operative word is *silently*. Under the project's autonomous execution model
(`AGENTS.md` §3), a builder or architect **may resolve an ordinary OPEN item** when it is
necessary to complete the assigned phase — provided the decision does not contradict a LOCKED
rule, is researched, is recorded with its rationale and alternatives, stays inside the phase's
scope, is validated, and goes to independent review rather than being merged by its author.

What remains forbidden is deciding one *by accident*: choosing a value in code, leaving no
record, and letting it harden into product truth unreviewed. A resolved item must be written
down as a decision — in the design document, in `docs/DECISIONS.md`, or in an ADR — and labelled
so a reviewer can find and reverse it.

The Product Owner retains final approval and may reverse any autonomous decision during review.

---

## Related foundation documents

These are project-level documents rather than per-domain design documents, but they constrain
everything under `docs/design/`:

| Document | Role |
|---|---|
| `docs/MASTER_DEVELOPMENT_ROADMAP.md` | Full product and production roadmap |
| `docs/GAME_SYSTEMS.md` | System-by-system overview |
| `docs/DECISIONS.md` | Locked decisions that must not be silently reversed |
| `docs/OPEN_QUESTIONS.md` | Project-level unresolved design questions |
| `docs/architecture/ARCHITECTURE_OVERVIEW.md` | **Technical architecture — entry point.** The Phase 0A package (`ARCHITECTURE_APPROVED`): domain model, boundaries, persistence, lifecycle, engine, content, economy integrity, operations, and all 18 `ACCEPTED` ADRs (`ADR-001`–`ADR-017` from Phase 0A, `ADR-018` from the Phase 0B specification) |
| `docs/specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md` | **Phase 0B implementation specification** — tooling, workspace boundaries, primitive contracts, test matrix and Definition of Done (**`VERIFIED`**) |
| `docs/specs/phase-0b/PHASE_0B_FOUNDATION_REVIEW.md` | **Phase 0B evidence** — the 92-case matrix, an ADR-by-ADR trace, §16 line by line, and every autonomous implementation decision (**`VERIFIED`**, accepted 2026-09-21) |
| `docs/ARCHITECTURE.md` | Phase 0 product-level sketch, superseded in detail by the package above |
| `docs/MVP_SCOPE.md` | First playable vertical slice |
| `docs/ECONOMY.md` | Economy principles, sinks and transaction rules |
| `docs/REFERENCES.md` | Research source hierarchy |
