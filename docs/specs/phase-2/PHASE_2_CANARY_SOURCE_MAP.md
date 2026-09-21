# Phase 2 — Canary source map

**Source repository:** `Hokz/canary` at `f6b81a855aa8e7e34cb98821ceb39ff97e3afa4e`
**Machine-readable form:** [`tests/fixtures/canary/import-record.json`](../../../tests/fixtures/canary/import-record.json) — 39 rows, each carrying the file, the symbol, the observed meaning, the keep/simplify/adapt decision, the fixture that pins it, and the exact literal that was read. SRC1-SRC4 assert the authored content against it, and re-verify the record itself against a real checkout when `CANARY_SOURCE` points at one.
**Purpose:** every formula and data element Phase 2 imports or adapts, recorded in the format
`REFERENCES.md` requires. A formula copied without this record is guessed with extra steps.

**Keep** = used as-is · **Simplify** = same shape, fewer inputs · **Adapt** = deliberately changed
for idle execution, with the reason.

---

## 1. Creature — Rat

| Field | Source | Value | Decision |
|---|---|---|---|
| Max HP | `data-otservbr-global/monster/mammals/rat.lua` → `monster.health` / `maxHealth` | **20** | Keep |
| Experience | same → `monster.experience` | **5** | Keep |
| Melee attack | same → `monster.attacks[1]` | `interval 2000`, `chance 100`, `minDamage 0`, `maxDamage -8` | Keep |
| Defense | same → `monster.defenses.defense` | **5** | Keep |
| Armor | same → `monster.defenses.armor` | **1** | Keep |
| Mitigation | same → `monster.defenses.mitigation` | **0.07** | **Simplify** — `Monster::getMitigation` multiplies the authored value by the defence multiplier (1.0) and the configurable `monsterMitigationMultiplier` (default 1.5). The multiplier is a server tunable, not creature data, and it changes nothing this phase can observe: for every integer damage below 953 the truncation in `mitigateDamage` lands on the same integer at 0.07 and at 0.105. SRC2 proves it over the whole range |
| Speed | same → `monster.speed` | 67 | Keep as display/pacing data |
| Target distance | same → `monster.flags.targetDistance` | 1 (melee) | Keep |
| Gold | same → `monster.loot` → `{ name = "gold coin", chance = 100000, maxCount = 4 }` | chance is out of 100000 → **100%**, count **1–4** | **Adapt** — modelled as a *currency reward*, not a loot table. Phase 3 owns loot, `BaseItem` and `ItemInstance`; Phase 2 needs the Gold the same entry produces |
| Elements / immunities | same → `monster.elements`, `monster.immunities` | earth +20, ice −10, holy +20, death −10; paralyze/outfit/invisible/bleed immune | **Recorded, not used** — Phase 2 is physical-only. Carried in content so Phase 3+ does not re-source it |

`Monster::getDefense()` (`src/creatures/monsters/monster.cpp`) returns
`(info.defense + m_defense) * defenseMultiplier`; `getArmor()` returns `info.armor *
defenseMultiplier`. Both multipliers are 1.0 for an unforged Rat, so the authored values are the
effective ones. **Keep.**

## 2. Character — pre-vocation, Level 1

| Field | Source | Value | Decision |
|---|---|---|---|
| Starting level | `schema.sql` → `players.level` default | **1** | Keep |
| Starting health | `schema.sql` → `players.health` / `healthmax` default | **150** | Keep |
| Starting skills | `schema.sql` → `players.skill_fist`, `skill_club`, `skill_sword`, `skill_axe`, `skill_dist`, `skill_shielding`, `skill_fishing` defaults | **10** | Keep |
| Attack interval | `data/XML/vocations.xml` → vocation `id="0" name="None"` → `attackspeed` | **2000 ms** | Keep |
| Melee damage multiplier | same → `<formula meleeDamage="1.0" …>` | 1.0 | Keep |
| Pre-vocation first items | `data-otservbr-global/scripts/movements/others/dawnport_vocation_trial.lua` → `addFirstItems` | leather helmet `3355`, coat `3562`, leather legs `3559`, leather boots `3552` — **armour only, no weapon** | See §4 |
| Armour of that kit | `data/items/items.xml` → `armor` on each of the four | 1 + 1 + 1 + 1 = **4** | Keep as a flat profile value |

## 3. Combat formulas

### 3.1 Maximum melee damage

`src/items/weapons/weapons.cpp` → `Weapons::getMaxWeaponDamage`, and the roll that consumes it,
`WeaponMelee::getWeaponDamage`:

```cpp
const int32_t minDamage  = level / 5;                        // NOT zero for an armed attack
const int32_t realDamage = normal_random(minDamage, maxDamage);
```

The unarmed path (§3.2) rolls from zero instead. The two agree below Level 5 and diverge from
Level 5 up; the tutorial profile is armed, so the armed floor is the one Phase 2 keeps.


```cpp
return attackValue > 0
  ? static_cast<int32_t>(std::round((0.085 * attackFactor * attackValue * attackSkill) + (level / 5)))
  : 0;
```

`level / 5` is **integer** division. **Keep, exactly.**

### 3.2 Unarmed attack

`src/items/weapons/weapons.cpp` → `Weapon::useFist`:

```cpp
const float   attackFactor = player->getAttackFactor();
const int32_t attackSkill  = player->getSkillLevel(SKILL_FIST);
constexpr int32_t attackValue = 7;                 // no item, so no equipment compensation
const int32_t maxDamage = Weapons::getMaxWeaponDamage(level, attackSkill, attackValue, attackFactor, true);
damage.primary.value = -normal_random(0, maxDamage);
params.blockedByArmor = true;  params.blockedByShield = true;
```

**Keep** as the shape of a Character attack: roll `normal_random(0, maxDamage)`, physical, blocked
by both defence and armour.

### 3.3 Armed attack, and the 15.25 compensation

`src/creatures/combat/effective_combat_values.hpp` → `WEAPON_ATTACK_PERCENT = 120`: a weapon's
Attack counts **20% higher** than the raw item data. `WeaponMelee::getWeaponDamage` feeds
`getEffectiveWeaponAttackValue(attack)` into §3.1. **Keep.**

### 3.4 Attack factor

`src/creatures/players/player.cpp` → `Player::getAttackFactor()` returns **1.0** under the modern
combat model (and for `FIGHTMODE_ATTACK` under the legacy one). **Keep 1.0** — Phase 2 has no
fight-mode selector, and inventing one would be a product rule created by a technical module.

### 3.5 Character defence

`Player::getDefense()`:

```cpp
defenseSkill = SKILL_FIST (no weapon)          // 10
defenseValue = 7                                // no weapon, no shield
scaling      = 0.15                             // no shield, no weapon defence
return ((defenseSkill / 4.0 + 2.23) * defenseValue * defenseFactor * scaling) * vocation->defenseMultiplier;
```

At skill 10, factor 1.0, multiplier 1.0 → `(2.5 + 2.23) * 7 * 0.15 = 4.9665` → **4** after the
integer return. **Keep** the computed value as a flat profile number.

### 3.6 Damage reduction ORDER

`src/creatures/creature.cpp` → `Creature::blockHit`, in this order:

1. immunity → damage 0;
2. **defence**, if a block is available: `damage -= uniform_random(defense / 2, defense)`;
3. **armour**: `armor > 3` → `damage -= uniform_random(armor / 2, armor - (armor % 2 + 1))`;
   `armor > 0` → `--damage`;
4. **mitigation**: `damage -= (damage * mitigation) / 100`.

Each step clamps at 0 and stops. **Keep the order exactly** — it is the part official sources never
document and the part that changes the numbers most.

Block availability, `Creature::onThink`: `blockCount` gains 1 per 1000 ms, capped at **2**, and one
is consumed per blocked hit. **Simplify** — at Phase 2's cadence (attacker every 2000 ms, +2
regenerated per interval, capped at 2) a block is *always* available, so Phase 2 models defence as
always applying and records this as the reason. A faster attacker would need the counter.

### 3.7 RNG

`src/utils/tools.cpp`:

- `normal_random(min, max)`: `std::normal_distribution<float>(0.5f, 0.25f)`, **rejection-sampled**
  into `[0, 1]`, then `min + lround(v * (max - min))`. Damage is centred, not uniform. **Keep.**
- `uniform_random(min, max)`: uniform inclusive. **Keep.**

**Adapt:** Global Idle's RNG is the Phase 0B seeded `SeededRandom`, not `std::mt19937` — the
simulation must be reproducible from a durable seed, which a global generator cannot be. The
*distributions* are transcribed; the *source of entropy* is Global Idle's.

## 4. The decision Part F forces — measured, not assumed

Canary's pre-vocation kit (§2) contains **no weapon**. Simulating the faithful formulas above:

| Character profile | Max hit | Avg damage/hit vs Rat | Rat killed |
|---|---|---|---|
| **Fists**, skill 10 (attackValue 7) | 6 | **0.05** | 12% of fights, ~540 s — dies 88% of the time |
| Dagger `3267` (attack 8), skill 10 | 8 | 1.0 | **100%**, ~140 s |
| Hand axe (10) | 10 | — | 100%, ~52 s |
| Sabre (12) | 12 | — | 100%, ~28 s |

*(2000 fights each, Rat HP 20 / defence 5 / armour 1, Character HP 150 / defence 4 / armour 4.)*

A Rat's defence roll is `uniform_random(2, 5)` — mean 3.5 — against a fist roll centred on 3, and
then armour takes one more. **Branch 1 of Part F fails on evidence:** a Level-1 pre-vocation
Character with fists cannot faithfully fight a Rat; it loses.

**Branch 2 applies.** Phase 2 gives the Origin Character a **tutorial combat profile** — an
immutable, content-authored set of combat *inputs*, not an item, not an inventory, not equipment:

```text
maxHealth 150 · attackSkill 10 · attackValue 9.6 · attackIntervalMs 2000
defense 4 · armor 4 · attackFactor 1.0
supply { charges 20, healMin 60, healMax 90, useBelowPercent 40 }
```

`attackValue 9.6` is the **dagger** (`3267`) — raw Attack 8, compensated by
`WEAPON_ATTACK_PERCENT` (§3.3), which is the value `getMaxWeaponDamage` actually receives. It is
the one weapon Canary's own first-vocation kit grants. `armor 4` is the pre-vocation leather kit.
The maximum hit it produces is `round(0.085 × 1.0 × 9.6 × 10) = 8`, the number in the table above.

`defense 4` is `Player::getDefense` (§3.5), and it is 4 under BOTH readings of this Character:
unarmed (fist skill 10, value 7, scaling 0.15) gives 4.9665, and dagger-armed (sword skill 10,
dagger defence 6, scaling 0.146) gives 4.14348. The `int32_t` return truncates each to 4, which
is why authoring it as a flat number costs nothing. Everything else is §2 and §3.

**This profile is explicitly temporary.** Phase 3 replaces it with `BaseItem`, `ItemInstance`,
inventory and equipment, at which point these numbers come from what the Character is actually
wearing. Until then they are one content definition with one source citation each — and retuning
the first fight is a content edit, not a code change.

## 5. XP and level

`src/creatures/players/player.cpp` → `Player::getExpForLevel`:

```cpp
return (((level - 6ULL) * level + 17ULL) * level - 12ULL) / 6ULL * 100ULL;
```

Level 2 → 100, level 3 → 200, level 8 → 4200. **Keep.** `COMBAT_LEVEL_SKILLS_FOUNDATION.md` §45
lists "exact Base Level XP curve" as an open decision; `REFERENCES.md` says Tibia answers gameplay
questions Tibia has already answered, so this closes it from source rather than by invention.

## 6. Supplies

`data/scripts/actions/items/potions.lua` → `[7876] = { health = { 60, 90 }, flask = 285 }`.

Health potion heals **60–90**. **Simplify** — Phase 2 models a supply as
`{ key, charges, healMin, healMax, useBelowHealthPercent }` on the activity, with no item, no
flask and no inventory. Phase 3 replaces it with real items.

## 7. Deliberately NOT imported

The five vocation spell books · every other creature · the item database · the map · Forge ·
Imbuements · Bestiary and Charms · the Wheel · the loot system · blessings and the full death
penalty · conditions and status effects · fight modes · PvP.

One Hunt, proving the simulator.
