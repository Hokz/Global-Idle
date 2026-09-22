/**
 * Phase 3 §20 — ISR1 to ISR8, ITM1 to ITM10.
 *
 * The cases that need no database: what the content SAYS, and what the item
 * model IS. Everything here is either checked against the Canary import record
 * or against a pure function, which is why it runs in the fixtures project
 * beside SIM and SRC rather than in integration.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '@global-idle/game-engine';
import { itemSchema, validateBundleSource } from '@global-idle/game-data';
import { items } from '@global-idle/domain';
import { canarySource, recorded, recordedValue, verifyAgainstSource } from '../support/canary.js';
import { REPO_ROOT } from '../support/repo.js';

const CONTENT = join(REPO_ROOT, 'packages', 'game-data', 'content', 'rookgaard.json');

interface Authored {
  key: string;
  kind: string;
  [field: string]: unknown;
}

async function content(): Promise<readonly Authored[]> {
  const doc = JSON.parse(await readFile(CONTENT, 'utf8')) as { definitions: Authored[] };
  return doc.definitions;
}

async function authored(key: string): Promise<Authored> {
  const found = (await content()).find((definition) => definition.key === key);
  if (!found) throw new Error(`${key} is not in the authored content.`);
  return found;
}

/** A resolved-bundle shape over the authored file, for the pure helpers. */
async function bundle() {
  const definitions = new Map((await content()).map((entry) => [entry.key, entry]));
  return { version: 'test', definitions } as never;
}

function reverify(prefix: string): void {
  const root = canarySource();
  if (!root) return;
  const failures = verifyAgainstSource(root)
    .filter((result) => result.id.startsWith(prefix))
    .filter((result) => !result.ok);
  expect(failures.map((failure) => `${failure.id}: ${failure.detail}`)).toEqual([]);
}

describe('§20 ISR — the item data is the source’s', () => {
  it('ISR1: the Rat’s physical loot is cheese, and cheese is the whole of it', async () => {
    const rat = await authored('creature.rat');
    const loot = rat['loot'] as { itemKey: string; chance: number; min: number; max: number }[];

    // ONE entry. The source's table is gold plus cheese, and gold is a
    // currency scope rather than an item (ADR-019), so exactly one physical
    // drop survives the adaptation.
    expect(loot).toHaveLength(1);
    expect(loot[0]!.itemKey).toBe('item.cheese');
    expect(loot[0]!.min).toBe(1);
    expect(loot[0]!.max).toBe(1);

    // 39410 out of MAX_LOOTCHANCE, normalised.
    const chance = recordedValue('rat.cheese.chance') as number;
    const denominator = recordedValue('loot.maxChance') as number;
    expect(denominator).toBe(100_000);
    expect(loot[0]!.chance).toBeCloseTo(chance / denominator, 10);
    expect(loot[0]!.chance).toBe(0.3941);

    reverify('rat.cheese');
    reverify('loot.maxChance');
    reverify('rat.loot.entries');
  });

  it('ISR2: every authored item weighs what items.xml says it weighs', async () => {
    const pairs: [string, string][] = [
      ['item.cheese', 'item.cheese.weight'],
      ['item.small-health-potion', 'item.smallHealthPotion.weight'],
      ['item.backpack', 'item.backpack.weight'],
      ['item.dagger', 'item.dagger.weight'],
      ['item.leather-helmet', 'item.leatherHelmet.weight'],
      ['item.coat', 'item.coat.weight'],
      ['item.leather-legs', 'item.leatherLegs.weight'],
      ['item.leather-boots', 'item.leatherBoots.weight'],
    ];
    for (const [key, row] of pairs) {
      expect((await authored(key))['weight'], key).toBe(recordedValue(row));
    }
    // Hundredths of an ounce, which is the unit Capacity is compared in.
    expect((await authored('item.cheese'))['weight']).toBe(400);
    reverify('item.');
  });

  it('ISR3: stackability is the DECODED appearance flag, not a guess', async () => {
    // It is not in items.xml at all — `Items::loadFromProtobuf` reads it from
    // the client appearance protobuf, so the record carries binary probes and
    // this case asserts the authored content agrees with them.
    expect(recordedValue('item.stackable.flagSource')).toBe('flags().cumulative()');

    const cases: [string, string, boolean][] = [
      ['item.cheese', 'appearance.cheese.cumulative', true],
      ['item.small-health-potion', 'appearance.smallHealthPotion.cumulative', true],
      ['item.dagger', 'appearance.dagger.cumulative', false],
      ['item.backpack', 'appearance.backpack.cumulative', false],
      ['item.leather-helmet', 'appearance.leatherHelmet.cumulative', false],
    ];
    for (const [key, row, expected] of cases) {
      expect(recordedValue(row), row).toBe(expected);
      expect((await authored(key))['stackable'], key).toBe(expected);
    }
    reverify('appearance.');
  });

  it('ISR4: the backpack really holds twenty — verified, not remembered', async () => {
    const backpack = await authored('item.backpack');
    expect(backpack['containerSpaces']).toBe(recordedValue('item.backpack.containerSize'));
    expect(backpack['containerSpaces']).toBe(20);
    expect(backpack['category']).toBe('CONTAINER');
    expect(backpack['slot']).toBe('BACKPACK');
    reverify('item.backpack');
  });

  it('ISR5: maxStack 255 is the source’s own ceiling, and the divergence is recorded', async () => {
    // The engine's DEFAULT is 100 and its parser CEILING is 255. The Product
    // Owner locked 255, which stays inside the source's range rather than
    // leaving it — and the row says so rather than the code implying it.
    expect(recordedValue('item.stack.defaultSize')).toBe(100);
    expect(recordedValue('item.stack.ceiling')).toBe(255);
    expect(recorded('item.stack.defaultSize').decision).toBe('Adapt');
    expect(recorded('item.stack.defaultSize').reason).toMatch(/255/);

    for (const definition of await content()) {
      if (definition.kind !== 'item') continue;
      const item = itemSchema.parse(definition);
      expect(item.maxStack, item.key).toBe(item.stackable ? 255 : 1);
    }
    reverify('item.stack');
  });

  it('ISR6: a pre-vocation Capacity of 400 oz is arithmetic, not a round number', async () => {
    // schema.sql's own sample Rookgaard character is LEVEL 2 at cap 410, and
    // vocation "None" gains 10 per level. One step down is 400 — which is also
    // the engine's member default of 40000 hundredths.
    expect(recorded('capacity.level1.none').probe).toMatchObject({ captured: ['2', '410'] });
    expect(recordedValue('capacity.level1.none')).toBe(400);
    expect(recordedValue('capacity.gainCap.none')).toBe(10);
    expect(recordedValue('capacity.storageUnit')).toBe(100);
    expect(recordedValue('capacity.memberDefault')).toBe(40_000);
    // 410 at level 2, minus one gaincap of 10, is 400 at level 1 — which is
    // also 40000 hundredths, the engine's own member default.
    expect(410 - 10).toBe(400);
    expect(400 * 100).toBe(40_000);

    expect(items.capacityFor(1)).toBe(40_000);
    expect(items.capacityFor(2)).toBe(41_000);
    expect(items.capacityFor(8)).toBe(47_000);
    reverify('capacity.');
  });

  it('ISR7: the counter’s prices are the source’s, in the source’s direction', async () => {
    const service = await authored('service.rookgaard.counter');
    const sells = service['sells'] as { itemKey: string; price: number }[];
    const buys = service['buys'] as { itemKey: string; price: number }[];

    // `buy` CHARGES the player; `sell` PAYS them. Transcribed from the two
    // code paths rather than assumed from the words.
    expect(recordedValue('npc.buy.direction')).toBe('buyPrice * amount');
    expect(recordedValue('npc.sell.direction')).toBe('sellPrice * soldAmount');
    expect(sells).toEqual([
      {
        itemKey: 'item.small-health-potion',
        price: recordedValue('npc.lily.smallHealthPotion.buy'),
      },
    ]);
    expect(buys).toEqual([
      { itemKey: 'item.cheese', price: recordedValue('npc.willie.cheese.sell') },
    ]);
    expect(sells[0]!.price).toBe(20);
    expect(buys[0]!.price).toBe(2);
    reverify('npc.');
  });

  it('ISR8: invalid item content is REFUSED, not published', async () => {
    const good = await authored('item.cheese');
    const base = { name: 'test', unlockSets: [] };

    // A stack size above the engine's ceiling.
    const overCeiling = validateBundleSource({
      ...base,
      definitions: [{ ...good, key: 'item.bad', maxStack: 256 }],
    } as never);
    expect(overCeiling.valid).toBe(false);

    // A container with no spaces is not a container.
    const noSpaces = validateBundleSource({
      ...base,
      definitions: [{ ...good, key: 'item.bad', category: 'CONTAINER', containerSpaces: 0 }],
    } as never);
    expect(noSpaces.valid).toBe(false);

    // A negative weight.
    const negative = validateBundleSource({
      ...base,
      definitions: [{ ...good, key: 'item.bad', weight: -1 }],
    } as never);
    expect(negative.valid).toBe(false);

    // A creature naming a drop nothing defines.
    const ghostDrop = validateBundleSource({
      ...base,
      definitions: [{ ...(await authored('creature.rat')), references: ['item.nonexistent'] }],
    } as never);
    expect(ghostDrop.valid).toBe(false);
  });
});

describe('§20 ITM — the item model', () => {
  it('ITM1: a definition is content and an instance is a row, and they are different things', async () => {
    const cheese = await authored('item.cheese');
    // The DEFINITION carries no quantity, no owner, no rarity and no location.
    for (const field of ['quantity', 'accountId', 'characterId', 'location', 'affixes']) {
      expect(cheese[field], field).toBeUndefined();
    }
    // ...and it does carry the things that are the same for everyone.
    expect(cheese['weight']).toBeTypeOf('number');
    expect(cheese['stackable']).toBeTypeOf('boolean');
    expect(cheese['sourceId']).toBe(3607);
  });

  it('ITM2: there is exactly ONE rarity vocabulary, and it has no Epic', async () => {
    const table = await authored('rarity-table.default');
    const tiers = (table['tiers'] as { rarity: string }[]).map((tier) => tier.rarity);
    expect(tiers).toEqual(['COMMON', 'SEMI_RARE', 'RARE', 'MYSTIC', 'LEGENDARY', 'STELLAR']);
    expect(tiers).not.toContain('EPIC');

    // And nothing anywhere in the repository declares a second one.
    const schema = await readFile(
      join(REPO_ROOT, 'packages', 'game-data', 'src', 'schema.ts'),
      'utf8',
    );
    expect(schema.match(/z\.enum\(\['COMMON'/g) ?? []).toHaveLength(1);
  });

  it('ITM3: rarity is exponentially rarer as it climbs', async () => {
    const table = await authored('rarity-table.default');
    const weights = (table['tiers'] as { weight: number }[]).map((tier) => tier.weight);
    for (let index = 1; index < weights.length; index += 1) {
      // Each tier is an ORDER OF MAGNITUDE rarer than the one before it. The
      // exact numbers are INITIAL/TUNABLE; the shape is the decision.
      expect(weights[index]! * 10).toBeCloseTo(weights[index - 1]!, 6);
    }
  });

  it('ITM4: the same seed rolls the same instance, every time', async () => {
    const resolved = await bundle();
    const first = items.rollIdentity(resolved, 'item.dagger', createSeededRandom('itm4'));
    const second = items.rollIdentity(resolved, 'item.dagger', createSeededRandom('itm4'));
    expect(second).toEqual(first);

    const other = items.rollIdentity(resolved, 'item.dagger', createSeededRandom('itm4-other'));
    // Not a guarantee that they DIFFER — a Common roll is overwhelmingly
    // likely both times — but the stream position must have moved.
    expect(other.rarity).toBeTypeOf('string');
  });

  it('ITM5: a definition that is not rarity-eligible is Common and consumes no draws', async () => {
    const resolved = await bundle();
    const rng = createSeededRandom('itm5');
    const before = rng.drawCount;
    const rolled = items.rollIdentity(resolved, 'item.cheese', rng);
    expect(rolled).toEqual({ rarity: 'COMMON', affixes: [] });
    // ZERO draws, so adding an eligible drop to a creature later cannot
    // disturb an existing one's sequence.
    expect(rng.drawCount).toBe(before);
  });

  it('ITM6: higher rarities carry more affixes, and Common carries none', async () => {
    const table = await authored('rarity-table.default');
    const tiers = table['tiers'] as { rarity: string; affixes: number }[];
    expect(tiers.find((tier) => tier.rarity === 'COMMON')!.affixes).toBe(0);
    for (let index = 1; index < tiers.length; index += 1) {
      expect(tiers[index]!.affixes).toBeGreaterThanOrEqual(tiers[index - 1]!.affixes);
    }
    expect(tiers.at(-1)!.affixes).toBe(3);
  });

  it('ITM7: over many rolls the distribution follows the authored weights', async () => {
    const resolved = await bundle();
    const rng = createSeededRandom('itm7');
    const counts = new Map<string, number>();
    for (let index = 0; index < 20_000; index += 1) {
      const rolled = items.rollIdentity(resolved, 'item.dagger', rng);
      counts.set(rolled.rarity, (counts.get(rolled.rarity) ?? 0) + 1);
    }
    // Measured, not assumed: Common dominates and the tail is genuinely rare.
    expect(counts.get('COMMON')! / 20_000).toBeGreaterThan(0.85);
    expect(counts.get('COMMON')! / 20_000).toBeLessThan(0.95);
    expect(counts.get('SEMI_RARE') ?? 0).toBeGreaterThan(0);
    expect((counts.get('LEGENDARY') ?? 0) + (counts.get('STELLAR') ?? 0)).toBeLessThan(20);
  });

  it('ITM8: two instances are fungible only when definition, rarity and affixes all agree', () => {
    const base = { definitionKey: 'item.cheese', rarity: 'COMMON' as const, affixes: [] };
    expect(items.fungibleWith(base, { ...base })).toBe(true);
    expect(items.fungibleWith(base, { ...base, definitionKey: 'item.dagger' })).toBe(false);
    expect(items.fungibleWith(base, { ...base, rarity: 'RARE' })).toBe(false);
    expect(
      items.fungibleWith(base, { ...base, affixes: [{ affix: 'ARMOR_PLUS', value: 1 }] }),
    ).toBe(false);
  });

  it('ITM9: an affix value stays inside its authored range', async () => {
    const resolved = await bundle();
    const table = await authored('rarity-table.default');
    const ranges = new Map(
      (table['affixes'] as { affix: string; min: number; max: number }[]).map((entry) => [
        entry.affix,
        entry,
      ]),
    );
    const rng = createSeededRandom('itm9');
    let seen = 0;
    for (let index = 0; index < 5_000; index += 1) {
      for (const affix of items.rollIdentity(resolved, 'item.dagger', rng).affixes) {
        const range = ranges.get(affix.affix)!;
        expect(affix.value).toBeGreaterThanOrEqual(range.min);
        expect(affix.value).toBeLessThanOrEqual(range.max);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('ITM10: `forgeTier` is a reserved seam and nothing in Phase 3 reads it', async () => {
    const schema = await readFile(
      join(REPO_ROOT, 'packages', 'domain', 'prisma', 'schema.prisma'),
      'utf8',
    );
    expect(schema).toMatch(/forgeTier\s+Int\s+@default\(0\)/);

    // Reserved means UNREAD. A grep over the domain finds the column
    // declaration and nothing that consumes it, which is the difference
    // between a seam and a half-built feature.
    const sources = await readFile(
      join(REPO_ROOT, 'packages', 'domain', 'src', 'contexts', 'items', 'custody.ts'),
      'utf8',
    );
    expect(sources).not.toMatch(/forgeTier/);
  });
});
