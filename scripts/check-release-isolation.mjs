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
 * Five checks, any of which fails the build:
 *
 *   1. the FORBIDDEN path `apps/web/public/assets/private/` does not exist;
 *   2. no distributable static root carries a private-asset signature;
 *   3. every distributable static BINARY is on the release allowlist, by hash;
 *   4. no build output contains a private path or the private MARKER;
 *   5. the dev-only loader is absent from, or inert in, a production build.
 *
 * The marker makes (4) provable for bytes the scan has never seen: the fixture
 * that stands in for private art carries a known, non-proprietary sentinel, so
 * a pipeline that ships the sentinel would ship real art the same way.
 *
 * (3) exists because the marker is NOT enough on its own, and independent
 * review proved it: a real client PNG carries no sentinel this project
 * invented, so an unmarked proprietary file at any public path other than the
 * one forbidden directory passed every other check and would have shipped.
 * Marker matching recognises what it was told to look for; an allowlist
 * recognises everything it was NOT told about. Only the second is fail-closed.
 */
import { createHash } from 'node:crypto';
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

/**
 * The release allowlist: which distributable binaries are approved to ship,
 * who made them and under what licence, pinned by hash.
 *
 * DENY BY DEFAULT. A binary under a distributable static root that is not
 * listed here — or whose bytes no longer match its recorded hash — fails the
 * build. The manifest itself is text and tracked, so adding art is a
 * deliberate act a reviewer can see in a diff.
 */
const ASSET_MANIFEST = 'apps/web/public/ASSET_MANIFEST.json';

/**
 * The ONLY files under a distributable static root that need no provenance.
 *
 * An explicit, narrow path list — not an extension class. The previous version
 * exempted every `.css`, `.js`, `.json` and `.xml`, and independent review
 * showed what that bought: a public stylesheet can carry an unmarked
 * `data:image;base64` payload, which is artwork, and no path or marker check
 * sees it. "Text" is not a statement about content.
 *
 * Everything not on this list — text included — must be on the release
 * allowlist, bound to its bytes.
 */
const EXEMPT_STATIC_PATHS = new Set([
  'apps/web/public/ASSET_MANIFEST.json',
  'apps/web/public/robots.txt',
]);

/**
 * Extensions that ARE artwork, wherever they appear.
 *
 * Used for the build-output provenance gate. `.svg` is text and is still art,
 * which is exactly the kind of gap an extension-class rule creates.
 */
const MEDIA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.ogg',
  '.wav',
  '.mp4',
  '.webm',
]);

/** Output files worth reading as text when hunting for an inlined payload. */
const OUTPUT_TEXTISH = new Set(['.js', '.mjs', '.cjs', '.css', '.json', '.html', '.txt', '.map']);

/**
 * An image smuggled into text as a base64 data URI.
 *
 * A SECONDARY signal, never the boundary — the allowlist is the boundary. This
 * exists because a build output has no allowlist of its own, and because an
 * exempt config file should not quietly become a carrier. The 64-character
 * floor keeps a 1×1 tracking pixel or an inline cursor out of the results
 * while still catching anything that could be real artwork.
 */
const INLINE_IMAGE = /data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]{64,})/;

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
// ── 3. …and every file among them is EXEMPT or ALLOWLISTED, by hash ──────────
//
// Read the allowlist first, so a missing or malformed manifest fails CLOSED
// rather than silently disabling the check that depends on it.
const manifestPath = join(ROOT, ASSET_MANIFEST);
/** @type {Map<string, {sha256: string, author: string, licence: string}>} */
const approved = new Map();
/** Hashes alone, for the build-output gate: a built copy has a different path. */
const approvedHashes = new Set();
let manifestUsable = false;

/** A path is only comparable if it is normalised the one way this file writes them. */
const normalise = (value) => value.split(sep).join('/').replace(/^\.\//, '');

if (!existsSync(manifestPath)) {
  fail(
    `${ASSET_MANIFEST} is missing. It is the release allowlist for distributable art; ` +
      `without it nothing can be approved to ship (spec §9.6).`,
  );
} else {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entries = parsed.approved ?? [];
    if (!Array.isArray(entries)) throw new Error('`approved` must be an array');

    entries.forEach((entry, index) => {
      const where = `${ASSET_MANIFEST} entry ${index}`;
      /*
       * A PROVENANCE record, not a checksum list.
       *
       * The script cannot verify that a licence claim is TRUE — only a human
       * can. What it can do is refuse a record that makes no claim at all, and
       * bind whatever claim was made to the exact bytes it was made about.
       * Independent review found an entry with blank author and licence
       * passing; a blank field is not a statement.
       */
      const path = typeof entry?.path === 'string' ? normalise(entry.path.trim()) : '';
      if (!path) {
        fail(`${where} has no path.`);
        return;
      }
      if (path.includes('..') || path.startsWith('/')) {
        fail(`${where} (${path}) is not a normalised repository-relative path.`);
        return;
      }
      if (!DISTRIBUTABLE_STATIC.some((root) => path.startsWith(`${root}/`))) {
        fail(
          `${where} (${path}) is outside every distributable static root ` +
            `(${DISTRIBUTABLE_STATIC.join(', ')}). The allowlist approves what SHIPS.`,
        );
        return;
      }
      if (approved.has(path)) {
        fail(`${where} (${path}) is a duplicate; one path may carry only one provenance record.`);
        return;
      }
      if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        fail(`${where} (${path}) has no valid sha256 — expected 64 lowercase hex characters.`);
        return;
      }
      const author = typeof entry.author === 'string' ? entry.author.trim() : '';
      const licence = typeof entry.licence === 'string' ? entry.licence.trim() : '';
      if (!author || !licence) {
        fail(
          `${where} (${path}) must state a non-empty author AND licence. ` +
            `A hash without a provenance claim records that bytes did not change, ` +
            `not that they may ship.`,
        );
        return;
      }
      approved.set(path, { sha256: entry.sha256, author, licence });
      approvedHashes.add(entry.sha256);
    });
    manifestUsable = true;
  } catch (error) {
    fail(`${ASSET_MANIFEST} is not valid JSON: ${error.message}`);
  }
}

let staticScanned = 0;
let staticApproved = 0;
for (const root of DISTRIBUTABLE_STATIC) {
  const full = join(ROOT, root);
  if (!existsSync(full)) continue;
  for (const file of walk(full)) {
    staticScanned += 1;
    const rel = normalise(relative(ROOT, file));
    if (rel.split('/').includes('private')) {
      fail(`${rel} sits on a "private" path inside a distributable static root.`);
      continue;
    }
    const buffer = readFileSync(file);
    if (buffer.includes(PRIVATE_MARKER)) {
      fail(`${rel} carries the private-asset marker.`);
      continue;
    }

    /*
     * EXEMPT, or ALLOWLISTED. There is no third category and no extension
     * class: "it is text" says nothing about whether it carries artwork, and
     * a stylesheet with an embedded `data:image` payload is artwork that no
     * path or marker check can see.
     */
    if (EXEMPT_STATIC_PATHS.has(rel)) {
      // An exempt file is exempt from PROVENANCE, not from carrying art.
      const match = INLINE_IMAGE.exec(buffer.toString('utf8'));
      if (match) {
        fail(
          `${rel} is release-exempt configuration, but carries an inlined ` +
            `${match[1].length}-character base64 image payload. Exempt means "not artwork"; ` +
            `move the image to its own allowlisted file.`,
        );
      }
      continue;
    }

    if (!manifestUsable) continue; // already failed above; do not pile on
    const entry = approved.get(rel);
    if (!entry) {
      fail(
        `${rel} is a distributable file that is NOT on the release allowlist. ` +
          `Add it to ${ASSET_MANIFEST} with its author, licence and sha256 — or remove it. ` +
          `Deny by default: an unmarked proprietary file would otherwise ship (spec §9.6).`,
      );
      continue;
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== entry.sha256) {
      fail(
        `${rel} does not match its allowlisted hash (recorded ${entry.sha256.slice(0, 12)}…, ` +
          `found ${digest.slice(0, 12)}…). The bytes changed after they were approved.`,
      );
      continue;
    }
    staticApproved += 1;
  }
}
pass(`${staticScanned} distributable static file(s) carry no private path or marker`);
if (manifestUsable) {
  pass(
    `${staticApproved} distributable file(s) release-approved by hash, ` +
      `${EXEMPT_STATIC_PATHS.size} exempt config path(s), ${approved.size} allowlist entries`,
  );
}

// ── 4. build outputs contain no private path and no marker ───────────────────
let outputsSeen = 0;
let outputScanned = 0;
let outputMedia = 0;

/** The hash of what a base64 payload DECODES to, so an inlined copy of an
 *  approved asset is recognised as that asset rather than as a new one. */
const hashOfBase64 = (payload) => {
  try {
    return createHash('sha256').update(Buffer.from(payload, 'base64')).digest('hex');
  } catch {
    return '';
  }
};
for (const output of BUILD_OUTPUTS) {
  const full = join(ROOT, output);
  if (!existsSync(full)) continue;
  outputsSeen += 1;
  for (const file of walk(full, OUTPUT_SKIP)) {
    const rel = relative(ROOT, file);
    const dot = file.lastIndexOf('.');
    const extension = (dot > file.lastIndexOf(sep) ? file.slice(dot) : '').toLowerCase();

    /*
     * THE ARTEFACT'S OWN PROVENANCE GATE.
     *
     * `public/` is not the only way art reaches a deploy. An imported asset is
     * emitted into `.next/static/media/` under a content-hashed name, never
     * passing through `public/` at all — so the allowlist above cannot see it,
     * and a marker scan cannot recognise bytes it has never been shown.
     * Independent review's counterexample was exactly this.
     *
     * So: anything in the artefact that IS artwork — image, font, audio,
     * video, SVG — must hash-match something a human approved. Everything
     * else Next emits (`.rsc`, `.meta`, chunks, maps) is scaffolding, not art,
     * and keeps the marker and path scan it already had. That is a targeted
     * gate rather than a blanket exception.
     */
    if (MEDIA_EXTENSIONS.has(extension)) {
      outputScanned += 1;
      outputMedia += 1;
      const buffer = readFileSync(file);
      if (buffer.includes(PRIVATE_MARKER)) {
        fail(`${rel} carries the private-asset marker.`);
        continue;
      }
      if (!manifestUsable) continue;
      const digest = createHash('sha256').update(buffer).digest('hex');
      if (!approvedHashes.has(digest)) {
        fail(
          `${rel} is ${extension} media in a distributable artefact whose bytes match no ` +
            `release-approved asset (sha256 ${digest.slice(0, 12)}…). Every image, font or ` +
            `media file that ships must have a provenance record in ${ASSET_MANIFEST}, ` +
            `whether it came from public/ or was bundled from source (spec §9.6).`,
        );
      }
      continue;
    }

    if (!TEXT_LIKE.has(extension)) {
      // Not art, not text: Next's own payloads. Scanned for the marker only —
      // they cannot contain a module path, and reading them as text is noise.
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
    // A SECONDARY signal, not the boundary: the artefact has no allowlist of
    // its own, so an inlined image in a chunk would otherwise be invisible.
    if (OUTPUT_TEXTISH.has(extension)) {
      const match = INLINE_IMAGE.exec(text);
      if (match && !approvedHashes.has(hashOfBase64(match[1]))) {
        fail(
          `${rel} inlines a ${match[1].length}-character base64 image payload that matches no ` +
            `release-approved asset. Inlining does not change what it is.`,
        );
      }
    }
  }
}
if (outputsSeen === 0) {
  // Not a pass and not a failure: say so, so "the guard ran" is never confused
  // with "the artefact was checked".
  console.log('  · no build output present — run `pnpm build` first to check an artefact');
} else {
  pass(
    `${outputScanned} built file(s) in ${outputsSeen} output(s) carry no private path or marker; ` +
      `${outputMedia} media file(s) in the artefact are release-approved`,
  );
}

// ── 5. the dev-only loader cannot serve in production ────────────────────────
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
