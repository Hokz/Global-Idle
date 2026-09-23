#!/usr/bin/env node
/**
 * Private client assets must not reach a distributable artefact (Phase 3.7
 * spec §9.3). FAIL CLOSED.
 *
 * `.gitignore` protects COMMITS. It protects nothing about a build: a
 * gitignored file under `apps/web/public/` is still copied into `.next`, into
 * an image layer and onto a CDN. The previous phase's boundary was a commit
 * boundary wearing a distribution boundary's clothes, and independent review
 * said so. This script is the distribution boundary.
 *
 * Four checks, any of which fails the build:
 *
 *   1. the FORBIDDEN path `apps/web/public/assets/private/` does not exist;
 *   2. no distributable static root carries a private-asset signature;
 *   3. no build output contains a private path or the private MARKER;
 *   4. the dev-only loader is absent from, or inert in, a production build.
 *
 * The marker is the trick that makes (3) provable. A scan cannot recognise
 * bytes it has never seen, so the fixture that stands in for private art
 * carries a known, non-proprietary sentinel. If that sentinel is ever found in
 * an artefact, the pipeline that put it there would have shipped real private
 * art the same way.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything under `public/` is a distributable input BY DEFINITION. */
export const FORBIDDEN_PUBLIC_PRIVATE = 'apps/web/public/assets/private';

/** Where a private override is allowed to live: outside every bundler input. */
export const PRIVATE_ROOT = 'private/assets';

/**
 * A non-proprietary sentinel written into FAKE private bytes by tests.
 *
 * Split at definition so this file — which IS shipped, as a repo script — does
 * not itself contain the literal a scan searches for. Otherwise the guard
 * would flag its own source and prove nothing.
 */
export const PRIVATE_MARKER = ['GLOBAL_IDLE', 'PRIVATE_ASSET', 'MARKER'].join('_');

/** Directories whose whole contents are shipped to a browser. */
const DISTRIBUTABLE_STATIC = ['apps/web/public'];

/** Build outputs that become an artefact. */
const BUILD_OUTPUTS = ['apps/web/.next', 'apps/web/out', 'apps/web/dist'];

/** `.next` keeps caches and source maps that are not served. Skip them, so a
 *  stale dev cache cannot fail a release for bytes nobody can fetch. */
/**
 * Top-level directories inside a build output that are not the artefact.
 *
 * `dev` is `next dev`'s own output: a developer who has run the dev server has
 * it, nobody deploys it, and failing a RELEASE check on it is how a guard gets
 * routed around. `cache`, `trace` and `types` are likewise build scaffolding.
 */
const OUTPUT_SKIP = new Set(['cache', 'dev', 'trace', 'types']);

/** Extensions worth scanning as text. A PNG cannot contain a JS import path. */
const TEXT_LIKE = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.txt', '.map', '']);

const problems = [];
const fail = (message) => problems.push(message);
const pass = (message) => console.log(`  ✓ ${message}`);

function* walk(directory, skipTop = new Set()) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skipTop.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

// ── 1. the forbidden path ────────────────────────────────────────────────────
const forbidden = join(ROOT, FORBIDDEN_PUBLIC_PRIVATE);
if (existsSync(forbidden)) {
  const contents = statSync(forbidden).isDirectory() ? readdirSync(forbidden) : ['(a file)'];
  fail(
    `${FORBIDDEN_PUBLIC_PRIVATE} exists (${contents.length} entr${contents.length === 1 ? 'y' : 'ies'}). ` +
      `Everything under apps/web/public is a distributable input, so a private file there is a ` +
      `published file waiting for a deploy. Put private assets in ${PRIVATE_ROOT}/ instead ` +
      `(spec §9.1).`,
  );
} else {
  pass(`${FORBIDDEN_PUBLIC_PRIVATE} does not exist`);
}

// ── 2. distributable static roots carry nothing private ──────────────────────
let staticScanned = 0;
for (const root of DISTRIBUTABLE_STATIC) {
  const full = join(ROOT, root);
  if (!existsSync(full)) continue;
  for (const file of walk(full)) {
    staticScanned += 1;
    const rel = relative(ROOT, file);
    if (rel.split(sep).includes('private')) {
      fail(`${rel} sits on a "private" path inside a distributable static root.`);
      continue;
    }
    const buffer = readFileSync(file);
    if (buffer.includes(PRIVATE_MARKER)) {
      fail(`${rel} carries the private-asset marker.`);
    }
  }
}
pass(`${staticScanned} distributable static file(s) carry no private path or marker`);

// ── 3. build outputs contain no private path and no marker ───────────────────
let outputsSeen = 0;
let outputScanned = 0;
for (const output of BUILD_OUTPUTS) {
  const full = join(ROOT, output);
  if (!existsSync(full)) continue;
  outputsSeen += 1;
  for (const file of walk(full, OUTPUT_SKIP)) {
    const rel = relative(ROOT, file);
    const dot = file.lastIndexOf('.');
    const extension = dot > file.lastIndexOf(sep) ? file.slice(dot) : '';
    if (!TEXT_LIKE.has(extension)) {
      // A binary in the output is scanned for the marker only — it cannot
      // contain a module path, and reading it as text would be meaningless.
      if (readFileSync(file).includes(PRIVATE_MARKER)) fail(`${rel} carries the private marker.`);
      outputScanned += 1;
      continue;
    }
    const text = readFileSync(file, 'utf8');
    outputScanned += 1;
    if (text.includes(PRIVATE_MARKER)) fail(`${rel} carries the private-asset marker.`);
    if (text.includes(FORBIDDEN_PUBLIC_PRIVATE)) {
      fail(`${rel} references the forbidden path ${FORBIDDEN_PUBLIC_PRIVATE}.`);
    }
  }
}
if (outputsSeen === 0) {
  // Not a pass and not a failure: say so, so "the guard ran" is never confused
  // with "the artefact was checked".
  console.log('  · no build output present — run `pnpm build` first to check an artefact');
} else {
  pass(
    `${outputScanned} built file(s) in ${outputsSeen} output(s) carry no private path or marker`,
  );
}

// ── 4. the dev-only loader cannot serve in production ────────────────────────
const LOADER = 'apps/web/app/dev-private-asset/[...path]/route.ts';
const loader = join(ROOT, LOADER);
if (existsSync(loader)) {
  const source = readFileSync(loader, 'utf8');
  /*
   * COMMENTS ARE NOT CODE. Measured: with the gate replaced by `if (true)` the
   * file still described the gate in its header, the substring was still
   * present, and this check still passed while the loader served in
   * production. So the scan runs on the source with comments stripped.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // It must gate on the build-time constant, which the bundler substitutes so
  // the branch is eliminated from a release build.
  if (!code.includes("process.env.NODE_ENV !== 'production'")) {
    fail(`${LOADER} does not gate on process.env.NODE_ENV !== 'production' (spec §9.2).`);
  } else {
    pass('the dev-only loader gates on NODE_ENV, which a release build eliminates');
  }
  // An opt-in flag is a way to ship it by accident. There must not be one.
  // Matches `process.env.FOO`, `process.env['FOO']` and `process.env["FOO"]`;
  // NODE_ENV is the one permitted read, because it is the gate itself.
  const reads = [...code.matchAll(/process\.env(?:\.|\[\s*['"`])([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1])
    .filter((name) => name !== 'NODE_ENV');
  if (reads.length > 0) {
    fail(
      `${LOADER} reads ${[...new Set(reads)].join(', ')} — the loader must have NO opt-in ` +
        `environment flag, because a flag is a way to enable it in production by accident ` +
        `(spec §9.2).`,
    );
  } else {
    pass('the dev-only loader has no opt-in environment flag');
  }
  // And it must actually BE a route. Next's App Router excludes any folder
  // whose name starts with `_` from routing, so a loader under `app/_dev/`
  // 404s in development as well as in production: dead code that reads like a
  // working override. Measured, not assumed — the first version of this loader
  // lived at `app/_dev/private-asset/` and served nothing.
  const unroutable = LOADER.split('/').find((segment) => segment.startsWith('_'));
  if (unroutable) {
    fail(
      `${LOADER} sits under the private folder "${unroutable}" — Next excludes ` +
        `underscore-prefixed folders from routing, so this loader can never serve ` +
        `anything, in development or otherwise (spec §9.2).`,
    );
  } else {
    pass('the dev-only loader is at a routable path, so it works where it is meant to');
  }
} else {
  console.log(`  · ${LOADER} absent — nothing to gate`);
}

if (problems.length > 0) {
  console.error('\nrelease-isolation check FAILED:');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(
    '\nPrivate client assets are a local reference, never a distributable artefact ' +
      '(Phase 3.7 spec §9).',
  );
  process.exit(1);
}
console.log('\nrelease-isolation check passed.');
