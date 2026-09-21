#!/usr/bin/env node
/**
 * Build authored content into ONE immutable, versioned artifact (§10.1).
 *
 * The version is computed from the content, never passed in: rebuilding the
 * same source produces the same version and the same bytes, which is what
 * makes a pinned version a durable reference rather than a label.
 *
 * ONE BUNDLE, FROM EVERY SOURCE FILE. The files under `content/` are how
 * content is AUTHORED — one per area, so a region's definitions are not
 * appended to a file about something else. A bundle is what the game RUNS,
 * and the game runs one set of content at a time.
 *
 * This was one artifact per file until Phase 1 added a second source. Two
 * bundles made "the current bundle" mean "whichever was published last", so
 * publishing the placeholder content after Rookgaard took the whole world
 * away — the Atlas resolved, found no regions, and rendered an empty map. The
 * merge is the fix: a build produces exactly one version, and there is nothing
 * for publication order to decide.
 */
import { relative } from 'node:path';
import { buildBundle } from '../build.js';
import { writeBundle } from '../resolver.js';
import { bundleSourceSchema, type BundleSource } from '../schema.js';
import { BUNDLES_DIR, PACKAGE_ROOT, readSource, sourceFiles } from './sources.js';

/** The name every built bundle carries. The SOURCES have names; the artifact
 *  they merge into is the game's content, not any one of them. */
const BUNDLE_NAME = 'global-idle';

async function main(): Promise<number> {
  const files = await sourceFiles();
  if (files.length === 0) {
    console.error('No content sources found. Expected at least one JSON file under content/.');
    return 1;
  }

  const merged: BundleSource = { name: BUNDLE_NAME, definitions: [], unlockSets: [] };
  for (const file of files) {
    // Each source is schema-checked on its own, so a broken file is reported
    // as itself rather than as a confusing error about the merged whole.
    const parsed = bundleSourceSchema.safeParse(await readSource(file));
    if (!parsed.success) {
      console.error(`${relative(PACKAGE_ROOT, file)} is not a valid content source:`);
      for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
      return 1;
    }
    merged.definitions.push(...parsed.data.definitions);
    merged.unlockSets.push(...parsed.data.unlockSets);
    process.stdout.write(
      `${relative(PACKAGE_ROOT, file)}: ${parsed.data.definitions.length} definitions, ` +
        `${parsed.data.unlockSets.length} unlock sets\n`,
    );
  }

  // buildBundle validates the MERGED source and refuses to emit invalid
  // content, so a cross-file problem — a duplicate key, a reference into
  // another file that does not resolve — fails here rather than at the pin.
  const artifact = buildBundle(merged);
  const written = await writeBundle(BUNDLES_DIR, artifact);
  process.stdout.write(
    `-> ${relative(PACKAGE_ROOT, written)} (version ${artifact.version}, ` +
      `${artifact.definitions.length} definitions)\n`,
  );
  return 0;
}

process.exitCode = await main();
