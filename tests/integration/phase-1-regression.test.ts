// Phase 1 §16 — REG1 to REG5. Phase 0B is VERIFIED; Phase 1 must not spend it.
//
// The group exists because the cheapest way to make a new phase pass is to
// weaken the old one's tests. These cases make that visible rather than
// possible: the Phase 0B matrix is compared, id and TITLE, against the commit
// it was verified at, and the primitives Phase 1 consumes are driven through
// the Phase 1 routes and checked against the Phase 0B behaviour.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, truncateAll } from '../support/db.js';
import { REPO_ROOT, boundaries, run } from '../support/repo.js';
import phase0bMatrix from '../support/phase-0b-matrix.json' with { type: 'json' };
import {
  HUNT_KEY,
  REGION_KEY,
  call,
  createCharacter,
  enterHunt,
  idempotencyKey,
  publishRookgaard,
  signIn,
  startApp,
  type App,
} from '../support/phase1.js';

const prisma = createClient();

/**
 * The Phase 0B matrix as it stood at the commit it was VERIFIED at, committed
 * as a snapshot rather than read out of git.
 *
 * It was read out of git first, and that failed in the one place it mattered
 * most: W12 exports the tree WITHOUT `.git` and runs the whole suite there, so
 * the git-backed version silently found zero cases in a clean checkout. A
 * committed snapshot works everywhere, and it shows up in review — changing a
 * Phase 0B title now means editing this file in the same pull request, where
 * someone will see it.
 */
const PHASE_0B: { verifiedAt: string; count: number; cases: Record<string, string> } =
  phase0bMatrix;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** Every `it('<ID>: <title>')` in the working tree. */
function matrixTitles(): Map<string, string> {
  const titles = new Map<string, string>();
  for (const file of walk(join(REPO_ROOT, 'tests')).filter((name) => name.endsWith('.test.ts'))) {
    const source = readFileSync(file, 'utf8');
    // Single OR double quoted: W8's title contains an apostrophe, and a regex
    // that only knew about one of them would silently drop a case — which is
    // precisely the kind of quiet loss this case exists to catch.
    for (const match of source.matchAll(
      /\bit(?:\.\w+)*\(\s*(?:'([A-Z]+\d{1,2}): ([^']*)'|"([A-Z]+\d{1,2}): ([^"]*)")/g,
    )) {
      const id = match[1] ?? match[3];
      const title = match[2] ?? match[4];
      if (id && title !== undefined) titles.set(id, title);
    }
  }
  return titles;
}

let directory: string;
let app: App | undefined;
let base: string;

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-reg-'));
  await publishRookgaard(prisma, directory);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env['GLOBAL_IDLE_DEV_AUTH'];
});

async function stack(): Promise<{ cookie: string; characterId: string }> {
  const started = await startApp({ CONTENT_BUNDLE_DIR: directory });
  app = started.app;
  base = started.base;
  const cookie = await signIn(base, 'rookie');
  const hero = await createCharacter(base, cookie, 'Rookie');
  return { cookie, characterId: hero.id };
}

describe('Phase 0B regression', () => {
  it('REG1: the 92-case matrix is intact — same ids, same titles, none weakened', () => {
    const now = matrixTitles();
    const verified = Object.keys(PHASE_0B.cases);

    expect(PHASE_0B.count).toBe(92);
    expect(verified).toHaveLength(92);

    for (const id of verified) {
      // A MISSING case is the obvious regression; a RENAMED one is the quiet
      // one, because a case can be hollowed out and keep its number.
      expect(now.has(id), `${id} has disappeared since ${PHASE_0B.verifiedAt}`).toBe(true);
      expect(now.get(id), `${id}'s title changed since ${PHASE_0B.verifiedAt}`).toBe(
        PHASE_0B.cases[id],
      );
    }

    // And the counter agrees, for both matrices at once.
    const counted = run('node', ['scripts/count-matrix.mjs']);
    expect(counted.status, `${counted.stdout}${counted.stderr}`).toBe(0);
    expect(counted.stdout).toMatch(/phase-0b[\s\S]*?TOTAL 92\/92/);
    expect(counted.stdout).toMatch(/phase-1[\s\S]*?TOTAL 87\/87/);
  }, 120_000);

  it('REG2: the `pnpm dev` bootstrap contract is intact, and now covers the Phase 1 route', async () => {
    // WHAT THIS CASE CAN AND CANNOT DO. Running the real `pnpm dev` needs
    // Docker, and the place that has it is the `dev-bootstrap` CI job — which
    // is blocking, runs the real command, and is where "still green" is
    // actually demonstrated. What is checkable HERE is the contract that job
    // depends on: the verifier still asserts every Phase 0B acceptance signal,
    // it asserts the one §17 adds, and the workflow still runs it.
    const verifier = await readFile(join(REPO_ROOT, 'scripts', 'verify-dev-bootstrap.mjs'), 'utf8');

    for (const signal of [
      '/health/live',
      '/health/ready',
      'content,migrations,postgres,redis',
      'worker ready',
      'bull:activity-maintenance:repeat',
    ]) {
      expect(verifier, `the verifier no longer checks ${signal}`).toContain(signal);
    }
    // §17's addition: apps/web serves THE SESSION ENTRY ROUTE with a 200 —
    // not merely "something answered on port 3000".
    expect(verifier).toContain('web serves the session entry route');
    expect(verifier).toMatch(/Handle/);

    const workflow = await readFile(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(workflow).toContain('verify:dev');

    // `pnpm dev` itself is still a real script the workspace exposes.
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['dev']).toContain('scripts/dev.mjs');
    expect(manifest.scripts['verify:dev']).toContain('verify-dev-bootstrap.mjs');
  });

  it('REG3: the package boundaries are unchanged — the real cruiser, not a summary', () => {
    const result = boundaries();
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/no dependency violations found/);
  }, 180_000);

  it('REG4: occupancy behaves through the Phase 1 route exactly as Phase 0B proved', async () => {
    const { cookie, characterId } = await stack();

    // I13 — at most one claim per Character, globally, enforced by the
    // DATABASE and surfaced as a conflict rather than a 500.
    const first = await enterHunt<{ activityId: string }>(base, cookie, characterId, HUNT_KEY);
    expect(first.status).toBe(201);

    const second = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      characterId,
      HUNT_KEY,
      idempotencyKey(),
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('OCCUPANCY_CONFLICT');

    expect(await prisma.occupancyClaim.count({ where: { characterId } })).toBe(1);

    // I9 — one non-terminal session-bound Activity per account, still in force.
    const bound = await prisma.sessionBoundActivity.findMany({
      where: { state: { in: ['ONLINE_ACTIVE', 'RECONNECT_GRACE_PAUSED'] } },
    });
    expect(bound).toHaveLength(1);

    // Release, and the claim is gone — not orphaned, which is what the Phase 0B
    // reconciliation job exists to catch.
    await call(base, `/api/characters/${characterId}/activity`, { method: 'DELETE', cookie });
    expect(await prisma.occupancyClaim.count()).toBe(0);
  });

  it('REG5: idempotency and content pinning behave as Phase 0B proved', async () => {
    const { cookie, characterId } = await stack();

    // Idempotency — the FULL identity is the key, so the same client key on a
    // different account cannot collide (§7.6, ADR-017).
    const shared = idempotencyKey();
    const mine = await enterHunt<{ activityId: string }>(
      base,
      cookie,
      characterId,
      HUNT_KEY,
      shared,
    );
    expect(mine.status).toBe(201);

    const otherCookie = await signIn(base, 'other');
    const theirs = await createCharacter(base, otherCookie, 'Other');
    const theirEntry = await enterHunt<{ activityId: string }>(
      base,
      otherCookie,
      theirs.id,
      HUNT_KEY,
      shared,
    );
    expect(theirEntry.status).toBe(201);
    // Same client key, different principal: two real commands, not a replay.
    expect(theirEntry.body.activityId).not.toBe(mine.body.activityId);
    expect(await prisma.idempotencyRecord.count()).toBe(2);

    // Content — every Activity PINS its bundle (ADR-011), and the pin is a
    // real published version with a real checksum.
    const rows = await prisma.activity.findMany({ select: { contentVersion: true } });
    const versions = new Set(rows.map((row) => row.contentVersion));
    expect(versions.size).toBe(1);
    const bundle = await prisma.contentBundle.findUniqueOrThrow({
      where: { version: [...versions][0]! },
    });
    expect(bundle.checksum.length).toBeGreaterThan(0);

    // And the bundle cannot be deleted while an Activity references it
    // (ON DELETE RESTRICT, Phase 0B test C9).
    await expect(
      prisma.contentBundle.delete({ where: { version: bundle.version } }),
    ).rejects.toThrow();

    // A key of the wrong KIND still creates nothing, through the same
    // resolution path Phase 0B built.
    await call(base, `/api/characters/${characterId}/activity`, { method: 'DELETE', cookie });
    const wrongKind = await enterHunt<{ error: { code: string } }>(
      base,
      cookie,
      characterId,
      REGION_KEY,
    );
    expect(wrongKind.status).toBe(422);
    expect(await prisma.activity.count()).toBe(2);
  });
});
