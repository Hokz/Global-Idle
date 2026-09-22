#!/usr/bin/env node
/**
 * The mandatory agent instructions must not be several phases behind reality.
 *
 * `AGENTS.md` told every agent "Current phase: Phase 1" while Phase 3 was
 * being implemented — and `AGENTS.md` is the one file an agent is REQUIRED to
 * read. A stale marker there is not a documentation nit; it is the first thing
 * a new agent believes.
 *
 * So there is exactly one canonical statement of project state, and this
 * script fails CI when anything that quotes it has drifted.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATUSES = new Set([
  'PLANNED',
  'IMPLEMENTATION_SPEC_READY',
  'IMPLEMENTATION_COMPLETE — PENDING INDEPENDENT REVIEW',
  'VERIFIED',
]);

let failed = false;
const fail = (message) => {
  console.error(`  ✗ ${message}`);
  failed = true;
};
const pass = (message) => console.log(`  ✓ ${message}`);

const state = JSON.parse(readFileSync(resolve(ROOT, 'docs/PROJECT_STATE.json'), 'utf8'));
pass('docs/PROJECT_STATE.json parses');

for (const phase of state.phases) {
  if (!STATUSES.has(phase.status)) fail(`${phase.id} has an unknown status: ${phase.status}`);
}
if (!failed) pass('every phase carries a known status');

const active = state.phases.find((phase) => phase.id === state.activePhase.id);
if (!active) fail(`activePhase ${state.activePhase.id} is not in the phases list`);
else if (active.status !== state.activePhase.status) {
  fail(`activePhase status disagrees with the phases list for ${active.id}`);
} else pass('the active phase agrees with the phase list');

const verified = state.phases.find((phase) => phase.id === state.lastVerifiedPhase.id);
if (!verified || verified.status !== 'VERIFIED') {
  fail(`lastVerifiedPhase ${state.lastVerifiedPhase.id} is not VERIFIED in the phases list`);
} else pass('the last verified phase agrees with the phase list');

// The whole point: the file agents must read cannot contradict the canonical
// state, and cannot quietly stop pointing at it.
const agents = readFileSync(resolve(ROOT, 'AGENTS.md'), 'utf8');
if (!agents.includes('docs/PROJECT_STATE.json')) {
  fail('AGENTS.md no longer points at docs/PROJECT_STATE.json');
} else pass('AGENTS.md points at the canonical state');

if (!agents.includes(state.activePhase.name)) {
  fail(`AGENTS.md does not name the active phase (${state.activePhase.name})`);
} else pass('AGENTS.md names the active phase');

if (/Current phase:\s*\*\*Phase 1\b/.test(agents)) {
  fail('AGENTS.md still carries the stale Phase 1 marker');
}

console.log(failed ? '\nproject-state check FAILED.' : '\nproject-state check passed.');
process.exit(failed ? 1 : 0);
