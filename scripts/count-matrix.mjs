#!/usr/bin/env node
/**
 * Count the implemented matrix cases and compare them with what the approved
 * specifications fix: Phase 0B §14 at **92**, Phase 1 §16 at **87**, Phase 2
 * §12 at **106**, Phase 3 §20 at **169**, Phase 3.5 §20 at **95**, Phase 3.6
 * §16 at **25**.
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
      // The correction pass. Death settlement and currency custody changed
      // what Phase 2 MEANS, so they are Phase 2's cases rather than a fourth
      // matrix: the phase is not done without them.
      DL: [1, 14],
      GP: [1, 15],
      BL: [1, 3],
    },
  },
  'phase-3': {
    spec: 'docs/specs/phase-3/PHASE_3_ITEMIZATION_INVENTORY_LOGISTICS_SPEC.md §20',
    // Every Phase 3 prefix is THREE letters, deliberately. The id spaces of the
    // three earlier matrices already hold `S`, `ST`, `C`, `D`, `E` and more, and
    // the counter routes by the longest matching prefix — so `STK` and `STH`
    // win over Phase 2's `ST`, `SYS` over Phase 1's `S`, and `CAP`/`CSL` over
    // Phase 0B's `C`. Two-letter codes would have needed a translation table.
    groups: {
      ISR: [1, 8],
      ITM: [1, 11],
      EQP: [1, 8],
      // The integrity correction's own groups. An ACTIVE container, every
      // mutation run once, and the last free space contested — three things
      // the reviewed 125 stated and did not hold.
      ACT: [1, 7],
      CSL: [1, 11],
      STK: [1, 7],
      CAP: [1, 5],
      LPH: [1, 9],
      POL: [1, 6],
      DTH: [1, 6],
      DPT: [1, 4],
      STH: [1, 8],
      MOV: [1, 10],
      RTE: [1, 6],
      BNK: [1, 6],
      NPC: [1, 5],
      HNT: [1, 6],
      IDM: [1, 7],
      LCK: [1, 4],
      // The final integrity correction: who may act on an item, what a
      // retired Character is, and where external input stops being arbitrary.
      OWN: [1, 6],
      RET: [1, 2],
      VAL: [1, 5],
      SYS: [1, 16],
      MIG: [1, 6],
    },
  },
  'phase-3-5': {
    spec: 'docs/specs/phase-3-5/PHASE_3_5_TILE_SPATIAL_GAME_WINDOW_SPEC.md §20',
    // Three letters again, for the same reason Phase 3 used three: the earlier
    // id spaces already own `S`, `ST`, `PS` and `SU`, and the counter routes by
    // the longest matching prefix.
    groups: {
      TIL: [1, 6],
      // The spatial architecture correction continues PTH rather than opening
      // a group: eight directions are the same question the first six asked.
      PTH: [1, 15],
      SPC: [1, 10],
      SNP: [1, 7],
      RND: [1, 3],
      VIS: [1, 12],
      // The correction's own groups: one authoritative movement timeline,
      // three collision questions, the floor seam, static reachability, and
      // the map the browser draws being the map the server simulates.
      STP: [1, 8],
      COL: [1, 4],
      FLR: [1, 4],
      RCH: [1, 2],
      MPV: [1, 6],
      // The correctness pass: a step in flight survives the database.
      PER: [1, 6],
      // Cross-phase determinism: how the elapsed time was cut into
      // settlements is transport, and must not reach the dice.
      RNGC: [1, 12],
    },
  },
  'phase-3-6': {
    spec: 'docs/specs/phase-3-6/PHASE_3_6_MOVEMENT_FIDELITY_SPEC.md §16',
    groups: {
      SPD: [1, 6],
      GRD: [1, 7],
      BRK: [1, 3],
      THR: [1, 2],
      // PTH CONTINUES Phase 3.5's numbering, which owns 1-15, because an id
      // means one case across the project and not one case per phase.
      PTH: [16, 16],
      REN: [1, 2],
      VER: [1, 1],
      DET: [1, 3],
      // Added by the Phase 3.6 blocker correction: the supported movement
      // domain, which is where the imported arithmetic is still the source's.
      DOM: [1, 8],
      // Added by the Phase 3.6 integration correction: a Hunt, its map and its
      // creatures have to be simulatable TOGETHER, and the plan says so.
      CMP: [1, 9],
    },
  },
};

// Longest-first so `AC13` is not read as `A` + `C13`, and `E2E1` is not `E` +
// `2`. Regex alternation is ordered, and that order is the whole contract.
const PREFIXES = [
  'RNGC',
  'CMP',
  'DOM',
  'SPD',
  'GRD',
  'BRK',
  'THR',
  'REN',
  'VER',
  'DET',
  'TIL',
  'PER',
  'STP',
  'COL',
  'FLR',
  'RCH',
  'MPV',
  'PTH',
  'SPC',
  'SNP',
  'RND',
  'VIS',
  'ISR',
  'ITM',
  'EQP',
  'ACT',
  'IDM',
  'LCK',
  'OWN',
  'RET',
  'VAL',
  'CSL',
  'STK',
  'CAP',
  'LPH',
  'POL',
  'DTH',
  'DPT',
  'STH',
  'MOV',
  'RTE',
  'BNK',
  'NPC',
  'HNT',
  'SYS',
  'MIG',
  'DEV',
  'REG',
  'API',
  'E2E',
  'SIM',
  'SRC',
  'BL',
  'CH',
  'DL',
  'GP',
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
