/**
 * Phase 3.7 §13 — DIST. Private assets must not reach a distributable artefact.
 *
 * Independent review's condition A1, and the reason it exists: the previous
 * boundary was `.gitignore`, which protects COMMITS. A gitignored file under
 * `apps/web/public/` is still copied into `.next`, into an image layer and onto
 * a CDN. These cases test the DISTRIBUTION boundary instead, by running the
 * real guard against real trees — never by reasoning about what it would say.
 *
 * Every "private" byte here is SYNTHETIC. No proprietary image is copied into
 * a fixture, and the tracer the guard scans for is a sentinel this project
 * invented (spec §9.3).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../support/repo.js';

/**
 * Assembled at runtime, so this test file does not itself contain the literal
 * the guard searches for — otherwise scanning the repo would find the scanner's
 * own test and prove nothing.
 */
const MARKER = ['GLOBAL_IDLE', 'PRIVATE_ASSET', 'MARKER'].join('_');
const GUARD = 'scripts/check-release-isolation.mjs';
const FORBIDDEN = 'apps/web/public/assets/private';
const MANIFEST = 'apps/web/public/ASSET_MANIFEST.json';

/** Synthetic bytes that stand in for art. Never a real image, marked or not. */
const fakeArt = (label: string) => Buffer.from(`not real art :: ${label}`);
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** Write the release allowlist a scratch repo needs to be in a valid state. */
function writeManifest(root: string, approved: unknown[] = []): void {
  writeFileSync(
    join(root, MANIFEST),
    JSON.stringify({
      policy: {
        roots: ['apps/web/public'],
        rule: 'deny-by-default',
        appliesToText: true,
        exemptPaths: [MANIFEST, 'apps/web/public/robots.txt'],
      },
      approved,
    }),
  );
}

/** A provenance record for synthetic bytes. Never a real licence claim. */
const record = (path: string, bytes: Buffer, extra: Record<string, unknown> = {}) => ({
  path,
  sha256: sha256(bytes),
  author: 'this project',
  licence: 'owned',
  ...extra,
});

/** A base64 `data:image` payload long enough to be real artwork. */
function inlineImage(label: string): string {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`${label} `.repeat(16)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

let workspace: string | undefined;

afterEach(() => {
  if (workspace) rmSync(workspace, { force: true, recursive: true });
  workspace = undefined;
});

/** A miniature repo: just enough tree for the guard to have an opinion. */
function scratchRepo(): string {
  workspace = mkdtempSync(join(tmpdir(), 'global-idle-dist-'));
  mkdirSync(join(workspace, 'scripts'), { recursive: true });
  mkdirSync(join(workspace, 'apps/web/public'), { recursive: true });
  mkdirSync(join(workspace, 'apps/web/.next/static'), { recursive: true });
  mkdirSync(join(workspace, 'apps/web/app/dev-private-asset/[...path]'), { recursive: true });
  cpSync(join(REPO_ROOT, GUARD), join(workspace, GUARD));
  cpSync(
    join(REPO_ROOT, 'apps/web/app/dev-private-asset/[...path]/route.ts'),
    join(workspace, 'apps/web/app/dev-private-asset/[...path]/route.ts'),
  );
  // `robots.txt` is the exempt-config case; nothing else lands here unapproved.
  writeFileSync(join(workspace, 'apps/web/public/robots.txt'), 'User-agent: *\n');
  writeManifest(workspace);
  writeFileSync(join(workspace, 'apps/web/.next/static/app.js'), 'console.log("build");\n');
  return workspace;
}

/** Run the real guard in a tree and report how it exited. */
function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(root, GUARD)], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

describe('§13 DIST — a private asset cannot reach a distributable artefact', () => {
  it('DIST1: a clean tree with no private file passes', () => {
    // The ordinary state, and the one every public build and CI run is in.
    const root = scratchRepo();
    const result = runGuard(root);
    expect(result.output).toContain('release-isolation check passed');
    expect(result.status).toBe(0);
  });

  it('DIST2: anything at the FORBIDDEN public path fails the build', () => {
    // The whole point of A1. `public/` is a distributable input by definition,
    // so a private file there is a published file waiting for a deploy — and
    // `.gitignore`, which is all the reviewed spec had, would not notice.
    const root = scratchRepo();
    mkdirSync(join(root, FORBIDDEN), { recursive: true });
    writeFileSync(join(root, FORBIDDEN, 'rat.png'), 'pretend sprite bytes');

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('release-isolation check FAILED');
    expect(result.output).toContain(FORBIDDEN);
    // And it says where they SHOULD go, because a guard that only says "no" is
    // a guard people route around.
    expect(result.output).toContain('private/assets');
  });

  it('DIST3: the marker in a BUILT artefact fails, however it got there', () => {
    // The tracer exists so the scan can prove a negative about bytes it has
    // never seen: if this sentinel can reach the artefact, so can real art.
    const root = scratchRepo();
    writeFileSync(
      join(root, 'apps/web/.next/static/leaked.js'),
      `export const sprite = "data:image/png;base64,${MARKER}";\n`,
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/carries the private-asset marker/);
    expect(result.output).toContain('leaked.js');
  });

  it('DIST4: a built file that merely REFERENCES the forbidden path fails', () => {
    // A bundle that names the path would fetch it at runtime from a deploy
    // that did include it. The reference is the leak.
    const root = scratchRepo();
    writeFileSync(
      join(root, 'apps/web/.next/static/ref.js'),
      `const url = "/${FORBIDDEN.replace('apps/web/public/', '')}/rat.png"; // ${FORBIDDEN}\n`,
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('references the forbidden path');
  });

  it('DIST5: private bytes OUTSIDE the build graph are allowed and never shipped', () => {
    // The permitted state: a developer has the reference locally, at
    // `private/assets/`, which no bundler input covers. The guard passes —
    // and the marker is genuinely present on disk, so this proves the guard
    // distinguishes "exists locally" from "reached the artefact".
    const root = scratchRepo();
    mkdirSync(join(root, 'private/assets/sprites'), { recursive: true });
    writeFileSync(join(root, 'private/assets/sprites/fake.png'), `not real art ${MARKER}`);

    const result = runGuard(root);
    expect(result.status).toBe(0);
    expect(result.output).toContain('release-isolation check passed');
  });

  it('DIST6: a dev loader without the NODE_ENV gate fails', () => {
    // The gate is what a release build folds to `false` and eliminates. A
    // loader without it is a loader that serves in production.
    const root = scratchRepo();
    const loader = join(root, 'apps/web/app/dev-private-asset/[...path]/route.ts');
    writeFileSync(loader, 'export async function GET() { return new Response("anything"); }\n');

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('NODE_ENV');
  });

  it('DIST7: an opt-in environment flag on the dev loader fails', () => {
    // A flag is a way to enable this in production by accident, so there must
    // not be one to set.
    const root = scratchRepo();
    const loader = join(root, 'apps/web/app/dev-private-asset/[...path]/route.ts');
    writeFileSync(
      loader,
      [
        'export async function GET() {',
        "  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_PRIVATE_ASSETS) {",
        '    return new Response("bytes");',
        '  }',
        '  return new Response("no", { status: 404 });',
        '}',
        '',
      ].join('\n'),
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/opt-in environment flag/);
  });

  it('DIST9: a loader under an UNROUTABLE private folder fails', () => {
    // The defect this case exists for was real: the loader first lived at
    // `app/_dev/private-asset/`, and Next excludes underscore-prefixed folders
    // from routing — so it returned 404 in development, with the file present
    // on disk. A gate on a route that does not exist protects nothing and
    // demonstrates nothing, so the guard checks the path as well as the gate.
    const root = scratchRepo();
    const proper = join(root, 'apps/web/app/dev-private-asset/[...path]');
    const hidden = join(root, 'apps/web/app/_dev/private-asset/[...path]');
    mkdirSync(hidden, { recursive: true });
    cpSync(join(proper, 'route.ts'), join(hidden, 'route.ts'));
    rmSync(join(root, 'apps/web/app/dev-private-asset'), { force: true, recursive: true });

    // The guard looks at a fixed path, so the check is run against a copy of
    // the script with that path pointed at the underscore variant — the same
    // source, the same rule, a tree where the rule is broken.
    const script = join(root, GUARD);
    writeFileSync(
      script,
      readFileSync(script, 'utf8').replace(
        "'apps/web/app/dev-private-asset/[...path]/route.ts'",
        "'apps/web/app/_dev/private-asset/[...path]/route.ts'",
      ),
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/underscore-prefixed folders from routing/);
  });

  it('DIST11: an UNMARKED binary at any other public path fails', () => {
    // Independent review's blocker, reproduced before it was fixed: the guard
    // rejected one forbidden DIRECTORY and one invented MARKER, and a real
    // client PNG has neither. `apps/web/public/rat.png` passed every check and
    // would have shipped. Deny-by-default is the only fail-closed answer.
    const root = scratchRepo();
    writeFileSync(join(root, 'apps/web/public/rat.png'), fakeArt('rogue, unmarked'));

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('NOT on the release allowlist');
    expect(result.output).toContain('rat.png');
  });

  it('DIST12: the same file PASSES once it is allowlisted with its hash', () => {
    // The allowlist has to be usable, or it is a wall people climb over.
    // Declaring provenance is the reviewable act that lets art ship.
    const root = scratchRepo();
    const bytes = fakeArt('project-owned placeholder');
    writeFileSync(join(root, 'apps/web/public/rat.png'), bytes);
    writeManifest(root, [
      {
        path: 'apps/web/public/rat.png',
        sha256: sha256(bytes),
        author: 'this project',
        licence: 'owned',
      },
    ]);

    const result = runGuard(root);
    expect(result.output).toContain('release-isolation check passed');
    expect(result.status).toBe(0);
  });

  it('DIST13: swapping the bytes behind an allowlisted path fails', () => {
    // The hash is what stops the declaration drifting from reality — otherwise
    // "rat.png, drawn by us" becomes a slot a proprietary file can be poured
    // into without touching the manifest a reviewer reads.
    const root = scratchRepo();
    writeManifest(root, [
      {
        path: 'apps/web/public/rat.png',
        sha256: sha256(fakeArt('the approved bytes')),
        author: 'this project',
        licence: 'owned',
      },
    ]);
    writeFileSync(join(root, 'apps/web/public/rat.png'), fakeArt('something else entirely'));

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not match its allowlisted hash');
  });

  it('DIST14: a MISSING allowlist fails closed rather than skipping the check', () => {
    // A check that quietly disables itself when its input is absent is worse
    // than no check, because the build still says "passed".
    const root = scratchRepo();
    rmSync(join(root, MANIFEST));
    writeFileSync(join(root, 'apps/web/public/rat.png'), fakeArt('rogue'));

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('release allowlist');
  });

  it('DIST15: an EXEMPT config path ships without a provenance record', () => {
    // A narrow, explicit path list — not an extension class. Making
    // `robots.txt` a licensing question would train people to bulk-approve,
    // which is how an allowlist stops meaning anything. Everything NOT on the
    // list, text included, needs a record (DIST20).
    const root = scratchRepo();
    writeFileSync(join(root, 'apps/web/public/robots.txt'), 'User-agent: *\n');

    const result = runGuard(root);
    expect(result.output).toContain('release-isolation check passed');
    expect(result.status).toBe(0);
  });

  it('DIST16: UNMARKED media in the BUILD ARTEFACT fails, not just under public/', () => {
    // Independent review's counterexample, reproduced: an imported asset is
    // emitted to `.next/static/media/` under a content-hashed name and never
    // passes through `public/`, so the static allowlist cannot see it and a
    // marker scan cannot recognise bytes it was never shown. Before the
    // artefact gate this passed and would have shipped.
    const root = scratchRepo();
    mkdirSync(join(root, 'apps/web/.next/static/media'), { recursive: true });
    writeFileSync(join(root, 'apps/web/.next/static/media/rogue.png'), fakeArt('bundled rogue'));

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('media in a distributable artefact');
    expect(result.output).toContain('rogue.png');
  });

  it('DIST17: built media PASSES once its bytes are release-approved', () => {
    // The gate matches on BYTES, not on path, because the built copy is
    // renamed. An approved asset stays approved after bundling.
    const root = scratchRepo();
    const bytes = fakeArt('approved sprite');
    writeFileSync(join(root, 'apps/web/public/sprite.png'), bytes);
    mkdirSync(join(root, 'apps/web/.next/static/media'), { recursive: true });
    writeFileSync(join(root, 'apps/web/.next/static/media/sprite.a1b2c3.png'), bytes);
    writeManifest(root, [record('apps/web/public/sprite.png', bytes)]);

    const result = runGuard(root);
    expect(result.output).toContain('release-isolation check passed');
    expect(result.status).toBe(0);
  });

  it('DIST18: changing approved bytes fails in the ARTEFACT too', () => {
    // Approval binds to bytes. A renamed build copy whose content drifted is
    // no longer the thing that was approved.
    const root = scratchRepo();
    const approvedBytes = fakeArt('approved sprite');
    writeFileSync(join(root, 'apps/web/public/sprite.png'), approvedBytes);
    mkdirSync(join(root, 'apps/web/.next/static/media'), { recursive: true });
    writeFileSync(
      join(root, 'apps/web/.next/static/media/sprite.a1b2c3.png'),
      fakeArt('something else'),
    );
    writeManifest(root, [record('apps/web/public/sprite.png', approvedBytes)]);

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('match no release-approved asset');
  });

  it("DIST19: Next's own non-art payloads do not need provenance", () => {
    // The gate is targeted, not a blanket build-output exception: `.rsc` and
    // `.meta` are server payloads, not artwork, and still get the marker and
    // forbidden-path scan they always had.
    const root = scratchRepo();
    mkdirSync(join(root, 'apps/web/.next/server/app'), { recursive: true });
    writeFileSync(join(root, 'apps/web/.next/server/app/index.rsc'), 'rsc payload');
    writeFileSync(join(root, 'apps/web/.next/server/app/index.meta'), 'meta payload');

    const result = runGuard(root);
    expect(result.output).toContain('release-isolation check passed');
    expect(result.status).toBe(0);

    // …but the marker in one of them still fails.
    writeFileSync(join(root, 'apps/web/.next/server/app/index.rsc'), `rsc ${MARKER}`);
    expect(runGuard(root).status).toBe(1);
  });

  it('DIST20: PUBLIC TEXT carrying an inlined image fails — "text" is not a content claim', () => {
    // The second bypass: a stylesheet with an unmarked base64 `data:image`
    // payload is artwork, and neither the path nor the marker check sees it.
    // The extension-class exemption is gone; text is allowlisted like anything
    // else, so this fails for want of provenance.
    const root = scratchRepo();
    writeFileSync(
      join(root, 'apps/web/public/theme.css'),
      `.logo{background:url(${inlineImage('smuggled artwork')})}`,
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('NOT on the release allowlist');
    expect(result.output).toContain('theme.css');
  });

  it('DIST21: an EXEMPT config path may not become a carrier either', () => {
    // Exempt means "not artwork", not "unscanned". `robots.txt` needs no
    // provenance record and still may not smuggle an image.
    const root = scratchRepo();
    writeFileSync(
      join(root, 'apps/web/public/robots.txt'),
      `User-agent: *\n# ${inlineImage('hidden in a comment')}\n`,
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('release-exempt configuration');
    expect(result.output).toContain('base64 image payload');
  });

  it('DIST22: an allowlist entry without author or licence is rejected', () => {
    // A hash records that bytes did not change. It does not state who made
    // them or under what licence, and a blank field is not a statement. The
    // script cannot verify a claim is TRUE — only that one was made.
    const root = scratchRepo();
    const bytes = fakeArt('unattributed');
    writeFileSync(join(root, 'apps/web/public/thing.png'), bytes);
    writeManifest(root, [
      { path: 'apps/web/public/thing.png', sha256: sha256(bytes), author: '', licence: '' },
    ]);

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('must state a non-empty author AND licence');
  });

  it('DIST23: malformed allowlist entries are rejected before they can approve anything', () => {
    // Path shape, hash shape, root containment and duplicates — each its own
    // refusal, because each is a different way to make the list say nothing.
    const bytes = fakeArt('entry shape');

    const cases: [string, unknown, RegExp][] = [
      [
        'bad hash',
        { path: 'apps/web/public/a.png', sha256: 'nope', author: 'x', licence: 'y' },
        /valid sha256/,
      ],
      [
        'escapes the root',
        { path: '../../secrets/a.png', sha256: sha256(bytes), author: 'x', licence: 'y' },
        /normalised repository-relative path/,
      ],
      [
        'outside a distributable root',
        { path: 'docs/a.png', sha256: sha256(bytes), author: 'x', licence: 'y' },
        /outside every distributable static root/,
      ],
    ];
    for (const [label, entry, expected] of cases) {
      const root = scratchRepo();
      writeManifest(root, [entry]);
      const result = runGuard(root);
      expect(result.status, label).toBe(1);
      expect(result.output, label).toMatch(expected);
      rmSync(root, { force: true, recursive: true });
      workspace = undefined;
    }

    // A duplicated path is two provenance claims about one file.
    const root = scratchRepo();
    writeFileSync(join(root, 'apps/web/public/a.png'), bytes);
    writeManifest(root, [
      record('apps/web/public/a.png', bytes),
      record('apps/web/public/a.png', bytes),
    ]);
    const duplicate = runGuard(root);
    expect(duplicate.status).toBe(1);
    expect(duplicate.output).toContain('duplicate');
  });

  it('DIST10: a gate that survives only in a COMMENT fails', () => {
    // Found by the bite check, not by reading: replacing the real gate with
    // `if (true)` left the header comment describing it, the substring was
    // still in the file, and the guard passed while the loader served in
    // production. A comment is documentation; the branch is the gate.
    const root = scratchRepo();
    const loader = join(root, 'apps/web/app/dev-private-asset/[...path]/route.ts');
    writeFileSync(
      loader,
      [
        "/** Gates on process.env.NODE_ENV !== 'production', honestly. */",
        'export async function GET() {',
        '  if (true) return new Response("bytes");',
        '  return new Response("no", { status: 404 });',
        '}',
        '',
      ].join('\n'),
    );

    const result = runGuard(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('NODE_ENV');
  });

  it('DIST8: the real repository passes its own guard', () => {
    // Not a simulation: the actual tree, the actual script, the actual build
    // output if one is present. If this ever fails, something really did leak.
    const result = runGuard(REPO_ROOT);
    expect(result.output).toContain('release-isolation check passed');
    expect(result.status).toBe(0);
  });
});
