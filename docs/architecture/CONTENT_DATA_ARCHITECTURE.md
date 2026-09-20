# Content / Game-Data Architecture

**Document status:** `PHASE_0A_COMPLETE` / PENDING INDEPENDENT REVIEW
**Phase:** 0A.6
**Depends on:** `ADR-011`, `ADR-010`, `ADR-012`

---

## 1. What content is

Everything the team authors and the game reads but never writes: creatures, base items, loot
tables, hunts, rooms, dungeons, bosses, vocation parameters, progression tables, affix
definitions, world locations, and later Wheel and Skill Tree node catalogues.

`ADR-011` establishes the model: content is a **versioned build artifact**, authored in the
repository, validated in CI, immutable at runtime, pinned by running activities.

---

## 2. Canonical identity

```text
<domain>.<namespace>.<name>

creature.rookgaard.rat
item.shield.dragon_shield
hunt.rookgaard.sewers
room.hunt.rookgaard.sewers.3
loot_table.creature.rookgaard.rat
affix.suffix.fire_resist
vocation.knight
```

Rules:

- lowercase, dot-separated, `snake_case` segments;
- **immutable once published.** Renaming is a new key plus a documented migration, because
  persisted `ItemInstance` rows reference base item keys forever;
- namespaced by domain first, so a grep for `creature.` finds every creature;
- **never** an external project's numeric id.

### Source aliases

Research references an external implementation — Canary in particular. `docs/REFERENCES.md` is
explicit that reference implementations are *"references, not authority"*.

`DECIDED IN PHASE 0A` — an external id is recorded as a **non-authoritative alias** on the
definition:

```yaml
key: creature.rookgaard.rat
sourceAliases:
  canary: "rat"
```

Aliases exist for traceability during research. Nothing resolves a game rule through one, and
nothing in the runtime path reads them. This also keeps the IP boundary
(`docs/REFERENCES.md` §IP reminder) visible: an alias documents where a number came from
without importing another project's identity model.

---

## 3. Authoring format

`DECIDED IN PHASE 0A` — **content is authored as structured data files in the repository**
(YAML or JSON; the exact choice is `DEFERRED` to Phase 0B, as it changes nothing structural),
one logical definition set per file, organised by domain.

```text
packages/game-data/
  content/
    creatures/
    items/
    loot_tables/
    hunts/
    dungeons/
    vocations/
    affixes/
    world/
  schema/          validation schemas
  src/             loader, validator, typed accessors
```

Files, not database rows, because the entire point of separating content from logic is that a
balance change arrives as a reviewable diff.

---

## 4. Validation

`DECIDED IN PHASE 0A` — **content that does not validate cannot ship.** CI runs the validator
on every change, and it is a blocking check.

| Check | Catches |
|---|---|
| Schema conformance | missing or mistyped fields |
| Key uniqueness and format | duplicates, malformed keys |
| Reference resolution | a loot table pointing at a base item that does not exist |
| Range and sanity checks | negative damage, probabilities outside 0–1, empty pools |
| Loot table totals | probability sets that cannot sum correctly |
| Room/floor continuity | a hunt missing room 4, a dungeon without its boss room |
| Orphan detection | a creature no hunt or dungeon references |

`DECIDED IN PHASE 0A` — **orphans are a warning, not an error.** Content is often authored ahead
of the hunt that will use it, and failing the build for that would punish normal workflow.

A typed accessor layer is generated from the validated set, so engine code referencing a
nonexistent key fails at compile time rather than at runtime.

---

## 5. Versioning

**The content set is versioned as a whole.** One identifier covers every definition together.

Rejected alternative, for the record: per-definition versioning produces a combinatorial space
of version tuples that an activity would have to pin and reason about, answering a question
nobody asked (`ADR-011`).

### Pinning

An Activity records the content version it started with and is served definitions from that
version for its whole life. A deployment mid-hunt cannot change the creature a player is
fighting.

### Retention

`DECIDED IN PHASE 0A` — see `ADR-016`. **A referenced bundle is never garbage-collected.**

Each published version is an immutable, addressable bundle. The running server can load **any
referenced bundle**, not only the one it shipped with, so a persisted Activity pinned to version
N stays recoverable after a deploy to N+1 **by construction**.

An earlier draft justified a short retention window by claiming session-bound activities end
within hours. That is false: **Hunts are endless by design** — room 10 repeats indefinitely and
the reconnect grace preserves an activity across disconnects. There is no upper bound on how long
a pinned version may be referenced, and the failure mode of getting it wrong is silent and total:
the activity does not degrade, it fails to load.

The set of referenced versions is **derived from durable state**, so it cannot drift from
reality. Removing a genuinely unreferenced bundle is an explicit, audited operational action,
never an automatic sweep.

---

## 6. Loading

```text
build      content files + schemas
   ↓
CI         validate → fail the build on error
   ↓
artifact   versioned content set shipped with the deployment
   ↓
runtime    loaded into memory at startup, read-only
   ↓
engine     handed pre-resolved definitions, pinned to a version
```

- Loaded **once at startup**, held in memory, never written.
- Redis may cache derived projections of content for client responses; the in-memory set remains
  authoritative for the process.
- The engine receives **resolved definitions**, never a key to look up (`ADR-010` — it has no
  I/O to look anything up with).

### Hot reload

`DECIDED IN PHASE 0A` — **not supported.** A content change is a deployment.

Hot reload would let a running activity observe two different definitions of the same creature
within one run, which breaks replay and the pinning guarantee. The convenience it buys during
balance iteration is better served by the offline simulation tool
(`GAME_ENGINE_ARCHITECTURE.md` §9), which needs no running server at all.

---

## 7. When content changes

| Change | Effect on persisted state |
|---|---|
| Add a definition | none |
| Tune a number (damage, drop rate, cost) | none; new activities use it, running ones keep their pinned version |
| Rename a key | **migration required** — persisted `ItemInstance` rows reference base item keys |
| Remove a definition | only safe when nothing persisted references it; validator flags references |
| Restructure a schema | version the schema, migrate content in the same change |

`DECIDED IN PHASE 0A` — **base item keys are effectively permanent**, because item instances
outlive content revisions. Removing one requires proving no instance references it. This is the
single strongest constraint on content authoring and is worth knowing before the first item is
named.

---

## 8. Content vs player state — the line

| | Content | Player state |
|---|---|---|
| Dragon Shield's base armour value | ✅ | |
| *This* Dragon Shield's rarity and affixes | | ✅ |
| Rat's health and damage | ✅ | |
| That a player killed 400 rats | | ✅ |
| A hunt's room-by-room creature pool | ✅ | |
| Which room this activity is in | | ✅ |
| Rarity probability bands | ✅ | |
| A rolled rarity result | | ✅ |

The test: **if two players could see different values, it is state.**

---

## 9. Deferred

| | |
|---|---|
| YAML vs JSON | Phase 0B; structurally irrelevant |
| Generated accessor mechanics | Phase 0B |
| Storage backend for published bundles | Phase 0B; the retention rule is fixed by `ADR-016` |
| Authoring tooling beyond a text editor and CI | not needed at this stage |
| Every balance number in every table | `DEFERRED PARAMETER` — they are the content |

---

## 10. Content checklist

- [x] Canonical readable keys, immutable once published
- [x] External ids recorded as non-authoritative aliases only
- [x] Authored as reviewable files, not database rows
- [x] Validation is a blocking CI check
- [x] Whole-set versioning; activities pin a version
- [x] No runtime write path to content
- [x] No hot reload
- [x] Engine receives resolved definitions, never a lookup key
- [x] Base item keys treated as permanent
