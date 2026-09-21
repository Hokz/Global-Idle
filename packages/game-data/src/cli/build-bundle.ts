#!/usr/bin/env node
/**
 * Build authored content into immutable, versioned artifacts (§10.1).
 *
 * The version is computed from the content, never passed in: rebuilding the
 * same source produces the same version and the same bytes, which is what
 * makes a pinned version a durable reference rather than a label.
 */
import { relative } from 'node:path';
import { buildBundle } from '../build.js';
import { writeBundle } from '../resolver.js';
import { BUNDLES_DIR, PACKAGE_ROOT, readSource, sourceFiles } from './sources.js';

async function main(): Promise<number> {
  const files = await sourceFiles();
  if (files.length === 0) {
    console.error('No content sources found. Expected at least one JSON file under content/.');
    return 1;
  }

  for (const file of files) {
    // buildBundle validates first and refuses to emit invalid content, so a
    // broken source fails here rather than at the pin.
    const artifact = buildBundle(await readSource(file));
    const written = await writeBundle(BUNDLES_DIR, artifact);
    process.stdout.write(
      `${relative(PACKAGE_ROOT, file)} -> ${relative(PACKAGE_ROOT, written)} ` +
        `(version ${artifact.version})\n`,
    );
  }
  return 0;
}

process.exitCode = await main();
