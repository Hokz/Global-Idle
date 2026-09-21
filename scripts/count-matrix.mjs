#!/usr/bin/env node
/**
 * Count the implemented §14 test cases and compare them with the matrix the
 * approved specification fixes at 92.
 *
 * The convention this relies on: every matrix case is exactly ONE `it` whose
 * title begins with its id. That is what makes "all 92 cases pass" a countable
 * claim rather than an assertion.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = {
  W: 13,
  D: 18,
  O: 15,
  A: 6,
  T: 16,
  I: 4,
  R: 3,
  C: 9,
  H: 5,
  E: 3,
};

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const found = new Map();
const duplicates = [];
for (const file of walk(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.ts'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bit(?:\.\w+)*\(\s*['"`]([WDOATIRCHE]\d{1,2}):/g)) {
    const id = match[1];
    if (found.has(id)) duplicates.push(id);
    else found.set(id, file.slice(ROOT.length + 1));
  }
}

let ok = true;
const lines = [];
for (const [prefix, expected] of Object.entries(EXPECTED)) {
  const ids = [...found.keys()].filter((id) => id[0] === prefix);
  const numbers = ids.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter(
    (n) => !numbers.includes(n),
  );
  const extra = numbers.filter((n) => n > expected);
  if (missing.length > 0 || extra.length > 0) ok = false;
  lines.push(
    `${prefix}: ${numbers.length}/${expected}` +
      (missing.length ? `  MISSING ${missing.map((n) => prefix + n).join(',')}` : '') +
      (extra.length ? `  UNEXPECTED ${extra.map((n) => prefix + n).join(',')}` : ''),
  );
}

const total = found.size;
const expectedTotal = Object.values(EXPECTED).reduce((a, b) => a + b, 0);
console.log(lines.join('\n'));
if (duplicates.length > 0) {
  console.log(`DUPLICATE ids: ${[...new Set(duplicates)].join(', ')}`);
  ok = false;
}
console.log(`TOTAL ${total}/${expectedTotal}`);
if (!ok || total !== expectedTotal) process.exit(1);
