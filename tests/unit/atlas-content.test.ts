// Phase 1 §16 — AT1 to AT7. Atlas content validation (spec §10.2).
//
// Build-time and BLOCKING. Each case takes the real authored source, breaks
// exactly one thing, and asserts the validator refuses it — because a rule
// that is never shown refusing anything is a rule nobody can trust.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPE_KEYS, ASSET_IDS } from '@global-idle/shared';
import { activity } from '@global-idle/domain';
import { buildBundle, validateBundleSource, type BundleSource } from '@global-idle/game-data';
import { REPO_ROOT } from '../support/repo.js';

const SOURCE = join(REPO_ROOT, 'packages', 'game-data', 'content', 'rookgaard.json');
const HUNT = 'hunt.rookgaard.sewers';
const MARKER = 'marker.rookgaard.sewers';
const REGION = 'region.rookgaard';

const read = async (): Promise<BundleSource> =>
  JSON.parse(await readFile(SOURCE, 'utf8')) as BundleSource;

/** The authored source with ONE definition edited. */
async function mutated(key: string, patch: Record<string, unknown>): Promise<BundleSource> {
  const source = await read();
  return {
    ...source,
    definitions: source.definitions.map((definition) =>
      definition.key === key ? { ...definition, ...patch } : definition,
    ),
  };
}

const errorsOf = (result: ReturnType<typeof validateBundleSource>) =>
  result.issues.filter((issue) => issue.severity === 'error');

const checks = (result: ReturnType<typeof validateBundleSource>) =>
  new Set(errorsOf(result).map((issue) => issue.check));

describe('Phase 1 content validation', () => {
  it('AT1: the authored Rookgaard bundle validates and builds', async () => {
    const source = await read();
    const result = validateBundleSource(source);

    expect(errorsOf(result), JSON.stringify(errorsOf(result), null, 2)).toEqual([]);
    expect(result.valid).toBe(true);

    // And it builds: the version is a CONTENT HASH, so the same source always
    // produces the same pinnable version.
    const artifact = buildBundle(source);
    expect(artifact.version).toBe(buildBundle(source).version);
    expect(artifact.definitions.map((definition) => definition.key)).toContain(HUNT);
  });

  it('AT2: a marker whose `region` is not a region is refused', async () => {
    // It RESOLVES — `hunt.rookgaard.sewers` exists. It is simply not a region,
    // and the client would discover that at render time.
    const result = validateBundleSource(await mutated(MARKER, { region: HUNT }));

    expect(result.valid).toBe(false);
    expect(checks(result)).toContain('reference-kind');
    expect(errorsOf(result).some((issue) => issue.message.includes('not a region'))).toBe(true);
  });

  it('AT3: a marker whose `target` is not a hunt is refused', async () => {
    const result = validateBundleSource(await mutated(MARKER, { target: REGION }));

    expect(result.valid).toBe(false);
    expect(checks(result)).toContain('reference-kind');
    expect(errorsOf(result).some((issue) => issue.message.includes('not a hunt'))).toBe(true);
  });

  it('AT4: a hunt naming an activityTypeKey the registry does not describe is refused', async () => {
    const result = validateBundleSource(await mutated(HUNT, { activityTypeKey: 'dungeon' }));

    expect(result.valid).toBe(false);
    expect(checks(result)).toContain('activity-type-vocabulary');

    // The list content is checked against and the registry that has to run it
    // are kept in step by a BOOT assertion, not by hope.
    expect(() => activity.assertRegistryCoversContentVocabulary()).not.toThrow();
    for (const key of ACTIVITY_TYPE_KEYS) {
      expect(activity.describe(key as never), key).toBeDefined();
    }
    expect((ACTIVITY_TYPE_KEYS as readonly string[]).includes('dungeon')).toBe(false);
  });

  it('AT5: a marker positioned outside its own region is refused', async () => {
    const source = await read();
    const region = source.definitions.find((definition) => definition.key === REGION) as {
      atlas: { x: number; y: number; width: number; height: number };
    };
    const outside = { x: region.atlas.x + region.atlas.width + 10, y: region.atlas.y };

    const result = validateBundleSource(await mutated(MARKER, { position: outside }));
    expect(result.valid).toBe(false);
    expect(checks(result)).toContain('marker-bounds');

    // The boundary itself is INSIDE: a marker exactly on the edge is legal.
    const edge = { x: region.atlas.x + region.atlas.width, y: region.atlas.y };
    expect(validateBundleSource(await mutated(MARKER, { position: edge })).valid).toBe(true);
  });

  it('AT6: exactly one region is AVAILABLE in the Phase 1 bundle', async () => {
    const source = await read();
    const available = source.definitions.filter(
      (definition) =>
        definition.kind === 'region' &&
        (definition as { availability?: string }).availability === 'AVAILABLE',
    );
    expect(available.map((definition) => definition.key)).toEqual([REGION]);

    // A second one is refused...
    const two = validateBundleSource(
      await mutated('region.mainland', { availability: 'AVAILABLE' }),
    );
    expect(two.valid).toBe(false);
    expect(checks(two)).toContain('one-available-region');

    // ...and so is none, which would leave a player nowhere to go.
    const none = validateBundleSource(await mutated(REGION, { availability: 'LOCKED' }));
    expect(none.valid).toBe(false);
    expect(checks(none)).toContain('one-available-region');
  });

  it('AT7: an assetId the manifest does not define fails the BUILD, not the browser', async () => {
    const region = validateBundleSource(
      await mutated(REGION, { backdropAssetId: 'atlas.region.does-not-exist' }),
    );
    expect(region.valid).toBe(false);
    expect(checks(region)).toContain('asset-resolution');

    const marker = validateBundleSource(await mutated(MARKER, { iconAssetId: 'marker.typo' }));
    expect(marker.valid).toBe(false);
    expect(checks(marker)).toContain('asset-resolution');

    // `buildBundle` refuses to emit invalid content, so a typo can never reach
    // a bundle file in the first place.
    await expect(async () =>
      buildBundle(await mutated(MARKER, { iconAssetId: 'marker.typo' })),
    ).rejects.toThrow();

    // Every id the authored content names is one the manifest defines.
    const source = await read();
    for (const definition of source.definitions) {
      for (const field of ['backdropAssetId', 'iconAssetId'] as const) {
        const id = (definition as Record<string, unknown>)[field];
        if (typeof id === 'string') expect(ASSET_IDS as readonly string[], field).toContain(id);
      }
    }
  });
});
