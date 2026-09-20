#!/usr/bin/env node
/**
 * Enforce the runtime pin of Phase 0B spec §3.10 at install time.
 *
 * WHY THIS FILE EXISTS. §3.10 names `engineStrict: true` as the mechanism that
 * makes "a wrong Node fail `pnpm install`", and §16 criterion 5b requires that
 * failure. Measured against pnpm 12.5.1, `engineStrict` gates the `engines`
 * field of DEPENDENCIES; it does not enforce the root project's own
 * `engines.node`. A full `pnpm install` under Node v22.22.2 exits 0 with
 * `engineStrict: true` set.
 *
 * The specified OUTCOME is achievable, so this guard supplies it rather than
 * the pin being weakened: no version, range, boundary or contract changes.
 * `engineStrict: true` stays — it still does its own job for dependencies.
 *
 * No dependencies: this runs before `pnpm install` has installed anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const range = pkg.engines?.node;

if (typeof range !== 'string' || range.trim() === '') {
  console.error('[node-version] package.json has no engines.node. The runtime pin is missing.');
  process.exit(1);
}

/** @param {string} v */
const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** @param {number[]} a @param {number[]} b */
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const current = parse(process.version);
if (!current) {
  console.error(`[node-version] could not parse process.version: ${process.version}`);
  process.exit(1);
}

// Supports the conjunctive comparator ranges this project pins, e.g.
// ">=24.21.0 <25". Anything else is refused rather than silently passing:
// a guard that does not understand its own range is not a guard.
const clauses = range.trim().split(/\s+/);
const failures = [];

for (const clause of clauses) {
  const m = /^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(clause);
  if (!m) {
    console.error(
      `[node-version] unsupported comparator "${clause}" in engines.node "${range}". ` +
        'Extend scripts/check-node-version.mjs rather than loosening the pin.',
    );
    process.exit(1);
  }
  const op = m[1] ?? '=';
  const bound = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  const c = cmp(current, bound);
  const ok =
    op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
  if (!ok) failures.push(clause);
}

if (failures.length > 0) {
  console.error(
    `\n[node-version] REFUSING TO INSTALL.\n` +
      `  running : ${process.version}\n` +
      `  required: ${range}   (.nvmrc pins the exact version)\n` +
      `  failed  : ${failures.join(', ')}\n\n` +
      `  Phase 0B spec §3.10 pins the runtime because the boundary contract depends on it.\n` +
      `  Use the version in .nvmrc — CI reads that same file via actions/setup-node.\n`,
  );
  process.exit(1);
}
