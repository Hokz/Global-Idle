#!/usr/bin/env node
/**
 * CI check 8 (§13): `pnpm --filter @global-idle/game-data run validate`.
 *
 * Validation is BLOCKING (§10.2) — an invalid bundle must never reach a pin,
 * so this exits non-zero on the first source that fails. Orphan findings are
 * warnings and do not fail the check: content is often authored ahead of its
 * consumer.
 */
import { relative } from 'node:path';
import { validateBundleSource } from '../validate.js';
import { PACKAGE_ROOT, readSource, sourceFiles } from './sources.js';

async function main(): Promise<number> {
  const files = await sourceFiles();
  if (files.length === 0) {
    console.error('No content sources found. Expected at least one JSON file under content/.');
    return 1;
  }

  let failed = false;
  for (const file of files) {
    const where = relative(PACKAGE_ROOT, file);
    const result = validateBundleSource(await readSource(file));
    for (const issue of result.issues) {
      const line = `${issue.severity}: ${where}: [${issue.check}] ${issue.message}`;
      if (issue.severity === 'error') console.error(line);
      else console.warn(line);
    }
    if (!result.valid) failed = true;
    else process.stdout.write(`ok: ${where}\n`);
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
