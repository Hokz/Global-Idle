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
  writeFileSync(join(workspace, 'apps/web/public/placeholder.txt'), 'public art, ships freely\n');
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
