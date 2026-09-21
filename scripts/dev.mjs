#!/usr/bin/env node
/**
 * One command from a clean clone to a running stack (§11.3):
 *
 *   pnpm install
 *   pnpm dev        # compose up, migrate, seed, run all three apps
 *
 * Every step is explicit and fails loudly. A dev script that swallows a failed
 * migration hands the developer a stack that looks up and behaves wrongly.
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = ['compose', '-f', 'infra/docker-compose.yml'];

const say = (line) => process.stdout.write(`\u001b[36m[dev]\u001b[0m ${line}\n`);

function step(name, command, args, options = {}) {
  say(name);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (result.error?.code === 'ENOENT') {
    throw new Error(`${command} is not installed or not on PATH.`);
  }
  if (result.status !== 0) throw new Error(`${name} failed (exit ${result.status}).`);
}

/** Block until compose reports every service healthy. Migrating against a
 *  database that is still starting fails in a way that looks like a broken
 *  migration. */
function waitForHealthy(timeoutMs = 120_000) {
  say('waiting for postgres and redis to report healthy');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = spawnSync('docker', [...COMPOSE, 'ps', '--format', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const services = (result.stdout ?? '')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    const health = services.map((service) => service.Health || service.State);
    if (services.length >= 2 && health.every((state) => state === 'healthy')) return;
    if (Date.now() > deadline) {
      throw new Error(`services did not become healthy in time: ${health.join(', ')}`);
    }
    // A short synchronous pause; this script is a sequence of blocking steps.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
}

/**
 * LOCAL DEVELOPMENT ONLY.
 *
 * The migration creates `globalidle_app` NOLOGIN on purpose — a migration has
 * no business holding a credential (§6.4). Attaching one is a deployment
 * concern, and here "deployment" is this script.
 */
function attachLocalAppRoleCredential() {
  const url = process.env.DATABASE_APP_URL;
  if (!url) {
    say('DATABASE_APP_URL is unset; skipping the local application-role credential');
    return;
  }
  const parsed = new URL(url);
  const role = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  step(`attaching a local login to ${role}`, 'docker', [
    ...COMPOSE,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'globalidle',
    '-d',
    'globalidle',
    '-c',
    `ALTER ROLE "${role}" WITH LOGIN PASSWORD '${password}'`,
  ]);
}

/** Run the three apps together, and take them all down together. */
function runApps() {
  const apps = [
    ['web', 'pnpm', ['--filter', '@global-idle/web', 'run', 'dev']],
    ['api', 'pnpm', ['--filter', '@global-idle/api', 'run', 'dev']],
    ['worker', 'pnpm', ['--filter', '@global-idle/worker', 'run', 'dev']],
  ];

  const children = apps.map(([name, command, args]) => {
    say(`starting ${name}`);
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => {
      say(`${name} exited (${code}); stopping the rest`);
      stop();
    });
    return child;
  });

  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  }

  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
}

try {
  step('bringing up postgres and redis', 'docker', [...COMPOSE, 'up', '-d']);
  waitForHealthy();
  step('generating the Prisma client', 'pnpm', ['run', 'generate']);
  step('building the workspace', 'npx', ['tsc', '-b']);
  step('applying migrations', 'pnpm', [
    '--filter',
    '@global-idle/domain',
    'exec',
    'prisma',
    'migrate',
    'deploy',
  ]);
  attachLocalAppRoleCredential();
  step('building the content bundle', 'pnpm', [
    '--filter',
    '@global-idle/game-data',
    'run',
    'build:bundle',
  ]);
  step('seeding through domain services', 'node', [
    '--env-file-if-exists=.env',
    './scripts/seed.mjs',
  ]);
  runApps();
} catch (error) {
  process.stderr.write(`\u001b[31m[dev]\u001b[0m ${error.message}\n`);
  process.exitCode = 1;
}
