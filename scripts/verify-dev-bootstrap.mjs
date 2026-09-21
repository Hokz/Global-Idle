#!/usr/bin/env node
/**
 * End-to-end verification of the developer bootstrap (§11.3, §16 criterion 1).
 *
 * `pnpm dev` is an ORCHESTRATION, and verifying each of its steps separately
 * verifies the steps, not the orchestration. The failures that only this can
 * catch are the ones between the steps: compose health timing, migration and
 * seed sequencing, environment that does not reach a child, a process that
 * dies and takes the script with it, a service that is built but not
 * listening.
 *
 * So this runs THE REAL COMMAND. It does not re-implement dev.mjs's logic, it
 * does not stub compose, and it does not assert on log lines where it can ask
 * the running system instead: readiness, HTTP, the database, Redis.
 *
 * Because `pnpm dev` never exits on its own, the verification is bounded:
 * poll for every acceptance signal, then shut the whole stack down. Failing to
 * reach a signal prints everything the stack said before giving up.
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = ['compose', '-f', 'infra/docker-compose.yml'];

const API = `http://127.0.0.1:${process.env.API_PORT ?? '3001'}`;
const WEB = `http://127.0.0.1:${process.env.WEB_PORT ?? '3000'}`;
const DEADLINE_MS = Number(process.env.DEV_BOOTSTRAP_TIMEOUT_MS ?? 600_000);

const say = (line) => process.stdout.write(`\u001b[35m[verify]\u001b[0m ${line}\n`);

let output = '';
let child;

function startDev() {
  say('spawning the real `pnpm dev`');
  child = spawn('pnpm', ['dev'], {
    cwd: ROOT,
    // Its own process group, so shutting down reaches every app it spawned
    // rather than orphaning three watchers.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
  }
  child.on('exit', (code, signal) => {
    say(`\`pnpm dev\` exited early (code ${code}, signal ${signal})`);
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll `check` until it returns truthy, or fail the whole run. */
async function waitFor(what, check, { intervalMs = 2_000, deadline } = {}) {
  const until = deadline ?? Date.now() + DEADLINE_MS;
  for (;;) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`\`pnpm dev\` exited before ${what} was reached`);
    }
    let result;
    try {
      result = await check();
    } catch {
      result = false;
    }
    if (result) {
      say(`✓ ${what}`);
      return result;
    }
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(intervalMs);
  }
}

const saw = (needle) => output.includes(needle);

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  return { status: response.status, body: await response.text() };
}

/** Ask the database directly, through the compose service, so "the seed ran"
 *  is a row count rather than a log line. */
function psql(sql) {
  const result = spawnSync(
    'docker',
    [
      ...COMPOSE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-tAqc',
      sql,
      '-U',
      'globalidle',
      '-d',
      'globalidle',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
}

function redis(...args) {
  const result = spawnSync('docker', [...COMPOSE, 'exec', '-T', 'redis', 'redis-cli', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
}

async function shutDown() {
  if (child && child.exitCode === null) {
    say('stopping the stack');
    // SIGTERM to the whole group, then SIGKILL. All three behaviours below
    // were MEASURED on CI rather than assumed, and the third is the one this
    // settles on:
    //
    // - SIGINT to the `pnpm` wrapper never reaches the node process under it,
    //   so nothing happens and the grace period is pure waiting;
    // - SIGINT to the GROUP reaches everything, and `node --watch` answers it
    //   with an FSWatcher assertion and a core dump — harmless once the
    //   verification has finished, and alarming in a green log;
    // - SIGTERM to the GROUP reaches dev.mjs and the three watchers directly,
    //   and is the signal each of them handles. CORRECTION to what this
    //   comment said first: `node --watch` still logs an FSEventWrap
    //   assertion as it tears its watchers down, visible in the run this
    //   settled on. What changes is that the abort does not follow, and it
    //   happens after every acceptance signal has already been met. The
    //   orchestrator itself does not then exit, so the bounded SIGKILL
    //   finishes the job.
    //
    // That last step is not a wart to be tidied away: a verification that can
    // hang on shutdown is a verification that can hang, and the kill is what
    // guarantees no orphaned watcher outlives the run.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }

    for (let waited = 0; waited < 5_000 && child.exitCode === null; waited += 250) {
      await sleep(250);
    }
    if (child.exitCode === null) {
      say('apps stopped; killing the remaining process group');
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  // Compose is not the dev script's to clean up, so it is ours. `-v` because
  // a verification that leaves a populated volume behind passes the second
  // time for the wrong reason.
  spawnSync('docker', [...COMPOSE, 'down', '-v'], { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  const deadline = Date.now() + DEADLINE_MS;
  startDev();

  // 1-2. compose services up and healthy — dev.mjs blocks on health before it
  //      will print the next step at all.
  await waitFor('compose services healthy', () => saw('generating the Prisma client'), {
    deadline,
  });

  // 3. migrations applied. The line dev.mjs prints BEFORE migrating proves
  //    nothing, so wait for the next unconditional step and then ask the
  //    database what it actually has.
  await waitFor('migrations applied', () => saw('building the content bundle'), { deadline });
  await waitFor(
    'migration rows present',
    () => {
      const count = psql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
      return count !== null && Number(count) >= 2;
    },
    { deadline },
  );

  // 4. content bundle built.
  await waitFor('content bundle built', () => saw('(version v'), { deadline });

  // 5. seed completed — and actually present, asked of the database.
  await waitFor('seed completed', () => saw('seed complete'), { deadline });
  await waitFor(
    'seeded characters exist',
    () => {
      const count = psql('SELECT count(*) FROM "Character"');
      return count !== null && Number(count) >= 5;
    },
    { deadline },
  );
  await waitFor(
    'seeded content bundle row exists',
    () => {
      const count = psql('SELECT count(*) FROM "ContentBundle"');
      return count !== null && Number(count) >= 1;
    },
    { deadline },
  );

  // 6-7. the API is up, and READY: PostgreSQL, the migration version, Redis
  //      and the content bundle all answered (§12.1).
  await waitFor('api liveness', async () => (await get(`${API}/health/live`)).status === 200, {
    deadline,
  });
  const ready = await waitFor(
    'api readiness on all four conditions',
    async () => {
      const response = await get(`${API}/health/ready`);
      if (response.status !== 200) return false;
      const body = JSON.parse(response.body);
      const up = Object.keys(body.info ?? {})
        .sort()
        .join(',');
      return up === 'content,migrations,postgres,redis' ? body : false;
    },
    { deadline },
  );
  say(`  migration ${ready.info.migrations.version}, content ${ready.info.content.version}`);

  // 8. web is actually serving, not merely compiled.
  await waitFor('web responding', async () => (await get(WEB)).status === 200, { deadline });

  // 9. the worker booted AND did its boot work: the repeatable sweep is
  //    registered in the Redis the stack brought up (§11.2).
  await waitFor('worker ready', () => saw('worker ready'), { deadline });
  await waitFor(
    'worker registered its repeatable sweep',
    () => {
      const keys = redis('--scan', '--pattern', 'bull:activity-maintenance:repeat*');
      return Boolean(keys && keys.length > 0);
    },
    { deadline },
  );

  // ...and is still alive now that everything else is up, rather than having
  // logged a line and died.
  if (child.exitCode !== null) throw new Error('the stack exited before verification finished');
  say('✓ stack still running with every acceptance signal met');
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  await shutDown();
}

if (failure) {
  process.stderr.write(`\n\u001b[31m[verify] FAILED: ${failure.message}\u001b[0m\n`);
  process.stderr.write('--- captured output ---\n');
  process.stderr.write(output.slice(-20_000));
  process.exitCode = 1;
} else {
  say('DEVELOPER BOOTSTRAP VERIFIED END TO END');
}
