// Phase 2 §12 — SRC1 to SRC4. The baseline is real, or it is decoration.
//
// `REFERENCES.md` makes `Hokz/canary` the DEFAULT TECHNICAL BASELINE for Tibia
// gameplay behaviour and requires every import to be recorded. These four
// cases are what makes that requirement enforceable: the authored numbers and
// the transcribed formulas are compared against the record, and — on a machine
// with a checkout — the record is compared against the source it claims.
//
// A formula copied without that record is guessed with extra steps.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maxMeleeHit, minMeleeHit, type CombatProfile } from '@global-idle/game-engine';
import { hunt } from '@global-idle/domain';
import {
  canarySource,
  importRecord,
  recorded,
  recordedValue,
  verifyAgainstSource,
} from '../support/canary.js';
import { REPO_ROOT } from '../support/repo.js';

const CONTENT = join(REPO_ROOT, 'packages', 'game-data', 'content', 'rookgaard.json');

interface Definition {
  readonly key: string;
  readonly kind: string;
  readonly [field: string]: unknown;
}

async function authored(key: string): Promise<Definition> {
  const doc = JSON.parse(await readFile(CONTENT, 'utf8')) as { definitions: Definition[] };
  const found = doc.definitions.find((definition) => definition.key === key);
  if (!found) throw new Error(`${key} is not in the authored content.`);
  return found;
}

/**
 * Re-verify the record against a real checkout when this machine has one.
 *
 * Every SRC case calls this for the rows it is about, so a drift is reported
 * by the case that depends on it rather than by one catch-all.
 */
function reverify(prefix: string): void {
  const root = canarySource();
  if (!root) return;
  const failures = verifyAgainstSource(root)
    .filter((result) => result.id.startsWith(prefix))
    .filter((result) => !result.ok);
  expect(failures.map((failure) => `${failure.id}: ${failure.detail}`)).toEqual([]);
}

describe('§12 SRC — fidelity to the Canary baseline', () => {
  it('SRC1: the authored Rat is the Rat in rat.lua', async () => {
    const rat = await authored('creature.rat');
    expect(rat.kind).toBe('creature');

    expect(rat.maxHealth).toBe(recordedValue('rat.maxHealth'));
    expect(rat.experience).toBe(recordedValue('rat.experience'));
    expect(rat.speed).toBe(recordedValue('rat.speed'));
    expect((rat.attack as { intervalMs: number }).intervalMs).toBe(
      recordedValue('rat.attack.intervalMs'),
    );
    expect((rat.attack as { maxDamage: number }).maxDamage).toBe(
      recordedValue('rat.attack.maxDamage'),
    );
    expect(rat.defense).toBe(recordedValue('rat.defense'));
    expect(rat.armor).toBe(recordedValue('rat.armor'));
    expect(rat.mitigation).toBe(recordedValue('rat.mitigation'));

    const gold = rat.gold as { chance: number; min: number; max: number };
    expect(gold.chance).toBe(recordedValue('rat.gold.chance'));
    expect(gold.max).toBe(recordedValue('rat.gold.max'));
    expect(gold.min).toBe(1);

    const elements = rat.elements as Record<string, number>;
    expect(elements['earth']).toBe(recordedValue('rat.elements.earth'));
    expect(elements['ice']).toBe(recordedValue('rat.elements.ice'));
    expect(elements['holy']).toBe(recordedValue('rat.elements.holy'));
    expect(elements['death']).toBe(recordedValue('rat.elements.death'));
    expect(rat.immunities).toEqual(['paralyze', 'outfit', 'invisible', 'bleed']);

    // The two rows that are NOT a straight copy say so, and say why. A silent
    // divergence is a defect; a recorded adaptation is a decision.
    expect(recorded('rat.attack.maxDamage').decision).toBe('Adapt');
    expect(recorded('rat.gold.chance').decision).toBe('Adapt');
    expect(recorded('rat.gold.chance').reason).toMatch(/Phase 3 owns|loot table|currency/i);

    // The content carries its own citation, so a reader of the game data does
    // not have to find this test to learn where the numbers came from.
    expect(rat.sourceRef).toContain('rat.lua');
    expect(rat.sourceRef).toContain(importRecord.commit.slice(0, 7));

    reverify('rat.');
  });

  it('SRC2: the damage formula and the reduction chain are the transcribed ones', () => {
    const profile: CombatProfile = {
      level: 1,
      maxHealth: 150,
      attackSkill: 10,
      attackValue: 9.6,
      attackFactor: 1,
      attackIntervalMs: 2000,
      defense: 4,
      armor: 4,
      // ARMED — this case is about the armed floor, which is the whole point
      // of the row it verifies. The unarmed shape rolls from zero and has its
      // own assertion below.
      armed: true,
      supply: { healMin: 60, healMax: 90, useBelowPercent: 40 },
    };

    // getMaxWeaponDamage, evaluated independently from the recorded
    // expression rather than by calling the thing under test.
    const expected = (p: CombatProfile) =>
      p.attackValue > 0
        ? Math.round(
            0.085 * p.attackFactor * p.attackValue * p.attackSkill + Math.floor(p.level / 5),
          )
        : 0;
    for (const level of [1, 2, 4, 5, 6, 10, 50, 100, 499]) {
      for (const skill of [10, 15, 40, 100]) {
        for (const value of [0, 9.6, 12, 40]) {
          const candidate: CombatProfile = {
            ...profile,
            level,
            attackSkill: skill,
            attackValue: value,
          };
          expect(maxMeleeHit(candidate)).toBe(expected(candidate));
          expect(minMeleeHit(candidate)).toBe(Math.floor(level / 5));
        }
      }
    }
    expect(recorded('formula.maxWeaponDamage').decision).toBe('Keep');
    // The armed floor is a separate row because it is a separate function, and
    // because mistaking it for the unarmed zero is the easy error.
    expect(recorded('formula.meleeRoll').value).toBe('normal_random(level / 5, maxDamage)');

    // The chain's ORDER is recorded as three rows, and the order they appear
    // in IS the contract — defence, then armour, then mitigation.
    const chain = importRecord.imports
      .filter(
        (entry) => entry.id.startsWith('formula.blockHit') || entry.id === 'formula.mitigateDamage',
      )
      .map((entry) => entry.id);
    expect(chain).toEqual([
      'formula.blockHit.defense',
      'formula.blockHit.armor',
      'formula.mitigateDamage',
    ]);

    // The one place Phase 2 leaves a Canary input out: the configurable
    // monsterMitigationMultiplier (1.5). The claim in the record is that it
    // cannot change an outcome this phase can produce, so the claim is
    // checked over every integer damage the phase can produce — and well past
    // it, to the first value where the two readings actually disagree.
    const authoredMitigation = 0.07;
    const canaryMitigation = authoredMitigation * 1.5;
    const truncate = (damage: number, mitigation: number) =>
      Math.max(0, Math.floor(damage - (damage * mitigation) / 100));
    for (let damage = 0; damage <= 952; damage += 1) {
      expect(truncate(damage, authoredMitigation)).toBe(truncate(damage, canaryMitigation));
    }
    expect(truncate(953, authoredMitigation)).not.toBe(truncate(953, canaryMitigation));
    expect(recorded('rat.mitigation').decision).toBe('Simplify');

    reverify('formula.');
    reverify('rng.');
  });

  it('SRC3: the Base XP curve is Player::getExpForLevel, wraparound and all', () => {
    // The Tibia numbers a player already knows.
    expect(hunt.xpForLevel(1)).toBe(0n);
    expect(hunt.xpForLevel(2)).toBe(100n);
    expect(hunt.xpForLevel(3)).toBe(200n);
    expect(hunt.xpForLevel(8)).toBe(4200n);
    expect(hunt.xpForLevel(100)).toBe(15_694_800n);

    // An INDEPENDENT evaluation of the recorded C expression, in the unsigned
    // 64-bit arithmetic it is actually written in. This matters below level 6:
    // `level - 6ULL` UNDERFLOWS, and the wraparound is load-bearing — the
    // result only comes back to 0, 100, 200, 400, 800 because it wraps again
    // on the way out. A transcription that "fixed" the underflow would be
    // wrong for exactly the levels every new Character passes through.
    const MOD = 1n << 64n;
    const u64 = (value: bigint) => ((value % MOD) + MOD) % MOD;
    const canary = (level: number): bigint => {
      const l = BigInt(level);
      return u64(u64(u64(u64(u64(l - 6n) * l + 17n) * l) - 12n) / 6n) * 100n;
    };
    for (let level = 1; level <= 2000; level += 1) {
      expect(hunt.xpForLevel(level)).toBe(canary(level));
    }

    // The inverse is exact at every boundary, which is where a level-up
    // happens and where an algebraic inverse would be off by one.
    for (let level = 1; level <= 500; level += 1) {
      const start = hunt.xpForLevel(level);
      const next = hunt.xpForLevel(level + 1);
      expect(hunt.levelForXp(start)).toBe(level);
      if (next > start) {
        expect(hunt.levelForXp(next - 1n)).toBe(level);
        expect(hunt.levelForXp(next)).toBe(level + 1);
      }
    }
    expect(recorded('formula.expForLevel').decision).toBe('Keep');

    reverify('formula.expForLevel');
  });

  it('SRC4: the tutorial combat profile is ASSEMBLED from each of its cited sources', async () => {
    // Phase 3 deleted the authored `combat-profile`. This case did not go with
    // it — it got stronger. The same numbers are still asserted against the
    // same recorded sources; what changed is that they now have to be ARRIVED
    // AT from a Character baseline and the items the grant equips, instead of
    // being read off one definition that declared them.
    expect(
      (
        JSON.parse(await readFile(CONTENT, 'utf8')) as { definitions: { kind: string }[] }
      ).definitions.filter((definition) => definition.kind === 'combat-profile'),
    ).toEqual([]);

    const baseline = await authored('character-baseline.origin');
    expect(baseline.kind).toBe('character-baseline');
    expect(baseline.maxHealth).toBe(recordedValue('character.maxHealth'));
    expect(baseline.attackSkill).toBe(recordedValue('character.attackSkill'));
    expect(baseline.attackIntervalMs).toBe(recordedValue('character.attackIntervalMs'));
    expect(baseline.attackFactor).toBe(recordedValue('character.attackFactor'));

    // The baseline carries NO item facts. That absence is the difference
    // between a Character baseline and the profile it replaced, so it is
    // asserted rather than described.
    for (const itemField of ['armor', 'attackValue', 'defense', 'supply']) {
      expect(baseline[itemField]).toBeUndefined();
    }

    // ── armour: the four leather pieces, summed from the ITEMS ────────────
    const grant = await authored('starting-grant.origin.rookgaard');
    const equipped = grant['equipped'] as { itemKey: string; slot: string }[];
    const worn = await Promise.all(equipped.map((entry) => authored(entry.itemKey)));
    const armor = worn.reduce(
      (total, item) => total + (((item['combat'] as { armor?: number })?.armor ?? 0) as number),
      0,
    );
    const kit = ['leatherHelmet', 'coat', 'leatherLegs', 'leatherBoots'].map(
      (piece) => recordedValue(`armour.${piece}`) as number,
    );
    expect(kit).toEqual([1, 1, 1, 1]);
    expect(armor).toBe(4);

    // ── attack: the dagger's raw 8, compensated by the 120% factor ────────
    const weapon = worn.find((item) => (item['combat'] as { attack?: number })?.attack);
    const raw = recordedValue('weapon.dagger.attack') as number;
    const percent = recordedValue('weapon.attackPercent') as number;
    expect((weapon!['combat'] as { attack: number }).attack).toBe(raw);
    const attackValue = (raw * percent) / 100;
    expect(attackValue).toBe(9.6);

    // ...and that is what makes the first swing top out at 8, which is what
    // makes the fight winnable at all.
    expect(
      maxMeleeHit({
        level: 1,
        maxHealth: baseline.maxHealth as number,
        attackSkill: baseline.attackSkill as number,
        attackValue,
        armed: true,
        attackFactor: baseline.attackFactor as number,
        attackIntervalMs: baseline.attackIntervalMs as number,
        defense: 4,
        armor,
        supply: { healMin: 0, healMax: 0, useBelowPercent: 0 },
      }),
    ).toBe(8);

    // ── defence: Player::getDefense, truncated by its int32_t return ──────
    const weaponDefense = (weapon!['combat'] as { defense: number }).defense;
    const skill = baseline.attackSkill as number;
    const factor = baseline.attackFactor as number;
    expect(Math.trunc((skill / 4 + 2.23) * weaponDefense * factor * 0.146)).toBe(4);
    expect(
      Math.trunc((skill / 4 + 2.23) * (baseline.unarmedAttackValue as number) * factor * 0.15),
    ).toBe(4);

    // ── supplies: a real potion, healing what the source says it heals ────
    const contents = grant['contents'] as { itemKey: string; quantity: number }[];
    const potion = await authored(contents[0]!.itemKey);
    const heal = recordedValue('supply.healthPotion') as [number, number];
    expect(potion['heal']).toEqual({ min: heal[0], max: heal[1] });

    reverify('character.');
    reverify('weapon.');
    reverify('armour.');
    reverify('supply.');
  });
});
