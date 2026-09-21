/**
 * The Canary import record (`REFERENCES.md` → "Recording an import").
 *
 * `Hokz/canary` is the DEFAULT TECHNICAL BASELINE for Tibia gameplay
 * behaviour, and every value Phase 2 took from it is recorded with where it
 * came from, what it means, what Global Idle decided, and where that decision
 * is pinned. None of Canary's code is copied into this repository: a record
 * row carries a PATTERN that locates the value and the exact literal that was
 * read, which is enough to re-verify the whole record against a real checkout
 * and not enough to be a copy of anything.
 *
 * With `CANARY_SOURCE` pointing at that checkout the SRC cases re-run every
 * probe against the real files. Without it they still assert that the authored
 * content matches this record — which is what CI proves, and what stops a
 * content edit from quietly walking away from its source.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './repo.js';

export interface ImportRecord {
  readonly id: string;
  readonly file: string;
  readonly symbol: string;
  readonly observed: string;
  readonly decision: 'Keep' | 'Simplify' | 'Adapt';
  readonly fixture: string;
  readonly value: unknown;
  readonly reason?: string;
  readonly probe: { readonly pattern: string; readonly captured: string | string[] };
}

export interface ImportRecordFile {
  readonly sourceRepository: string;
  readonly commit: string;
  readonly imports: readonly ImportRecord[];
}

const FILE = join(REPO_ROOT, 'tests', 'fixtures', 'canary', 'import-record.json');

export const importRecord: ImportRecordFile = JSON.parse(
  readFileSync(FILE, 'utf8'),
) as ImportRecordFile;

const byId = new Map(importRecord.imports.map((entry) => [entry.id, entry]));

/** One row, by id. Throws rather than returning undefined: a case that asked
 *  for a row that is not there is a broken case, not a passing one. */
export function recorded(id: string): ImportRecord {
  const entry = byId.get(id);
  if (!entry) throw new Error(`No Canary import is recorded under ${id}.`);
  return entry;
}

/** The recorded VALUE — what Global Idle decided to author. */
export const recordedValue = (id: string): unknown => recorded(id).value;

/** A checkout of the baseline, if this machine has one. */
export function canarySource(): string | null {
  const configured = process.env['CANARY_SOURCE'];
  if (configured && existsSync(configured)) return configured;
  return null;
}

export interface ProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Re-read every recorded literal out of the real source files.
 *
 * Returns one result per row so a failure names the row that drifted rather
 * than only that something did.
 */
export function verifyAgainstSource(root: string): readonly ProbeResult[] {
  return importRecord.imports.map((entry) => {
    const path = join(root, entry.file);
    if (!existsSync(path)) return { id: entry.id, ok: false, detail: `missing ${entry.file}` };
    const source = readFileSync(path, 'utf8');
    const match = new RegExp(entry.probe.pattern).exec(source);
    if (!match) return { id: entry.id, ok: false, detail: `no match in ${entry.file}` };
    if (match.length < 2)
      return { id: entry.id, ok: false, detail: 'the pattern captures nothing' };

    const captured = match.length > 2 ? match.slice(1) : match[1]!;
    const expected = entry.probe.captured;
    const same = Array.isArray(expected)
      ? Array.isArray(captured) && expected.join('\u0000') === captured.join('\u0000')
      : captured === expected;
    return {
      id: entry.id,
      ok: same,
      detail: same
        ? 'ok'
        : `read ${JSON.stringify(captured)}, recorded ${JSON.stringify(expected)}`,
    };
  });
}
