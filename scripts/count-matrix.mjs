#!/usr/bin/env node
/**
 * Count the implemented matrix cases and compare them with what the approved
 * specifications fix: Phase 0B §14 at **92**, Phase 1 §16 at **87**, Phase 2
 * §12 at **74**.
 *
 * The convention this relies on: every matrix case is exactly ONE test whose
 * title begins with its id and a colon — `it('W1: ...')` for a Vitest case,
 * `test('UI3: ...')` or `test.step('E2E4: ...')` for a Playwright one. That is
 * what makes "all 92 pass" and "all 87 pass" countable claims rather than
 * assertions.
 *
 * Two matrices, one script, because their id spaces OVERLAP: Phase 0B owns
 * `D1`–`D18` and Phase 1 continues the same letter at `D19`. A counter that
 * treated `D` as one group would report Phase 1's cases as Phase 0B's, and a
 * counter per phase would have to be told which files belong to which — which
 * is a second thing to keep in sync. The id decides.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each group is `[first, last]` INCLUSIVE, so a group that continues another
 * phase's letter says so in its own range instead of in a comment.
 */
const MATRICES = {
  'phase-0b': {
    spec: 'docs/specs/phase-0b/PHASE_0B_TECHNICAL_FOUNDATION_SPEC.md §14',
    groups: {
      W: [1, 13],
      D: [1, 18],
      O: [1, 15],
      A: [1, 6],
      T: [1, 16],
      I: [1, 4],
      R: [1, 3],
      C: [1, 9],
      H: [1, 5],
      E: [1, 3],
    },
  },
  'phase-1': {
    spec: 'docs/specs/phase-1/PHASE_1_WORLD_CHARACTER_VERTICAL_SLICE_SPEC.md §16',
    groups: {
      S: [1, 11],
      DEV: [1, 4],
      CH: [1, 9],
      D: [19, 28],
      AT: [1, 7],
      API: [1, 10],
      AC: [1, 13],
      UI: [1, 8],
      E2E: [1, 10],
      REG: [1, 5],
    },
  },
  'phase-2': {
    spec: 'docs/specs/phase-2/PHASE_2_HUNT_SIMULATOR_SPEC.md §12',
    groups: {
      SIM: [1, 10],
      // ST and AU are `ACTIVITY_OCCUPANCY_AND_TIMERS.md` §7's own numbering,
      // kept rather than renumbered: the active-use cases are 25 to 28 there,
      // and a matrix that renamed them to AU1-AU4 would need a translation
      // table for the one document they exist to satisfy.
      ST: [1, 24],
      AU: [25, 28],
      RW: [1, 6],
      SU: [1, 3],
      DE: [1, 4],
      CX: [1, 6],
      PS: [1, 5],
      GW: [1, 8],
      SRC: [1, 4],
    },
  },
};

// Longest-first so `AC13` is not read as `A` + `C13`, and `E2E1` is not `E` +
// `2`. Regex alternation is ordered, and that order is the whole contract.
const PREFIXES = [
  'DEV',
  'REG',
  'API',
  'E2E',
  'SIM',
  'SRC',
  'CH',
  'AC',
  'AT',
  'AU',
  'CX',
  'DE',
  'GW',
  'PS',
  'RW',
  'ST',
  'SU',
  'UI',
  'A',
  'C',
  'D',
  'E',
  'H',
  'I',
  'O',
  'R',
  'S',
  'T',
  'W',
];
const ID = new RegExp(
  String.raw`\b(?:it|test)(?:\.\w+)*\(\s*['"\`](${PREFIXES.join('|')})(\d{1,2}):`,
  'g',
);

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** Which matrix owns an id — decided by the id alone, never by the file. */
function ownerOf(prefix, number) {
  for (const [phase, matrix] of Object.entries(MATRICES)) {
    const range = matrix.groups[prefix];
    if (range && number >= range[0] && number <= range[1]) return phase;
  }
  return null;
}

// id -> { prefix, number, file }. The PARSE is kept rather than the string:
// `E2E10` cannot be split back into a prefix and a number by a regex over the
// id alone, and a counter that tried reported ten missing cases that were all
// present.
const found = new Map();
const duplicates = new Map(); // id -> [files]
const orphans = []; // ids in no matrix range

for (const file of walk(join(ROOT, 'tests')).filter((f) => /\.(test|spec)\.ts$/.test(f))) {
  const source = readFileSync(file, 'utf8');
  const relative = file.slice(ROOT.length + 1);
  for (const match of source.matchAll(ID)) {
    const id = match[1] + match[2];
    if (found.has(id)) {
      duplicates.set(id, [...(duplicates.get(id) ?? [found.get(id).file]), relative]);
      continue;
    }
    const number = Number(match[2]);
    found.set(id, { prefix: match[1], number, file: relative });
    if (!ownerOf(match[1], number)) orphans.push(`${id} (${relative})`);
  }
}

let ok = true;
const report = [];

for (const [phase, matrix] of Object.entries(MATRICES)) {
  const lines = [];
  let total = 0;
  let expectedTotal = 0;
  for (const [prefix, [first, last]] of Object.entries(matrix.groups)) {
    const expected = last - first + 1;
    expectedTotal += expected;
    const numbers = [...found.values()]
      .filter((entry) => entry.prefix === prefix && ownerOf(prefix, entry.number) === phase)
      .map((entry) => entry.number)
      .sort((a, b) => a - b);
    total += numbers.length;
    const missing = [];
    for (let n = first; n <= last; n += 1) if (!numbers.includes(n)) missing.push(prefix + n);
    if (missing.length > 0) ok = false;
    lines.push(
      `  ${prefix}: ${numbers.length}/${expected}` +
        (missing.length ? `  MISSING ${missing.join(',')}` : ''),
    );
  }
  if (total !== expectedTotal) ok = false;
  report.push(`${phase} (${matrix.spec})`, ...lines, `  TOTAL ${total}/${expectedTotal}`, '');
}

console.log(report.join('\n').trimEnd());

if (duplicates.size > 0) {
  ok = false;
  console.log('\nDUPLICATE ids — one matrix case is exactly one test:');
  for (const [id, files] of duplicates) console.log(`  ${id}: ${files.join(', ')}`);
}
if (orphans.length > 0) {
  ok = false;
  console.log('\nIds in NO matrix range — either the test is misnamed or the matrix moved:');
  for (const orphan of orphans) console.log(`  ${orphan}`);
}

process.exit(ok ? 0 : 1);
