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
  - status: `DESIGN FOUNDATION / PARTIALLY OPEN`
  - scope: Base Level, Skills, Exercise Weapons, Training Dummies, vocation aptitude, Canary formula research and layered Combat System architecture.

---

## Documentation lifecycle

Every design document carries a status marker. A document advances through these stages:

```text
DRAFT
→ DESIGN_APPROVED / DESIGN_BASELINE
→ IMPLEMENTATION_SPEC_READY
→ IMPLEMENTED
→ VERIFIED
```

| Stage | Meaning |
|---|---|
| `DRAFT` | Under discussion. Not safe to build against. |
| `DESIGN_APPROVED` / `DESIGN_BASELINE` | The Product Owner has approved the direction. Open items may remain. |
| `IMPLEMENTATION_SPEC_READY` | The design has been turned into a concrete implementation spec. |
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
> **Builders must not silently convert OPEN design questions into permanent product decisions.**

When a design document marks something as open, unresolved, `TBD`, "not yet locked", "not yet
approved" or "exact ... is OPEN", that item must be raised with the Product Owner before it is
implemented. Choosing a value in code does not resolve it.

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
| `docs/ARCHITECTURE.md` | Technical architecture and boundaries |
| `docs/MVP_SCOPE.md` | First playable vertical slice |
| `docs/ECONOMY.md` | Economy principles, sinks and transaction rules |
| `docs/REFERENCES.md` | Research source hierarchy |
