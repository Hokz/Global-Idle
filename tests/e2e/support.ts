/**
 * Browser-acceptance support (Phase 2 §12, GW).
 *
 * Two things live here. The first is the sign-in-to-hunt flow every case
 * starts from. The second is a connection to the SAME database the API is
 * using, and it needs a word of explanation.
 *
 * A Hunt advances one tick per real second. Reaching room 10 honestly takes
 * about forty minutes, and dying takes about ninety — which is a statement
 * about the balance of the content, not about what the Game Window does with
 * the state it is given. So the cases that are about RENDERING a far-away
 * state arrange that state in the durable row and let the server serve it.
 * The window still learns everything through the real routes — `POST
 * .../hunt/advance` to settle and `GET .../hunt` to read; it is the truth
 * behind them that is fast-forwarded, not the routes.
 *
 * The cases that are about PROGRESS — combat happening, a run resuming — use
 * real server time and assert on real change.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { economy, withTransaction } from '@global-idle/domain';
import { accountId as toAccountId, operationId as toOperationId } from '@global-idle/shared';
import { PrismaClient } from '../../packages/domain/src/generated/prisma/client.js';

const ROOT = join(import.meta.dirname, '..', '..');

/**
 * The same URL the API is started with.
 *
 * The web server runs `node --env-file-if-exists=.env`, so a developer's `.env`
 * is what it reads; CI exports the variable instead. Reading both, in that
 * order of precedence, is what keeps this pointed at the same database the
 * application is using rather than a second one that happens to exist.
 */
export function databaseUrl(): string {
  const fromEnv = process.env['DATABASE_URL'];
  if (fromEnv) return fromEnv;

  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/.exec(line);
      if (match) return match[1]!;
    }
  }
  throw new Error('DATABASE_URL is not set and .env does not provide one.');
}

export const connect = (): PrismaClient =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });

export const handle = () => `GW${Math.random().toString(36).slice(2, 8)}`;

/** Sign in, create a Character, and land on the play surface. */
export async function play(page: Page, name = 'Hunter'): Promise<string> {
  await page.goto('/');
  const enter = page.getByRole('button', { name: 'Enter' });
  await expect(enter).toBeEnabled();
  await page.getByLabel('Handle').fill(handle());
  await enter.click();
  await page.waitForURL('**/characters');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL('**/play/**');
  await expect(page.getByTestId('atlas')).toBeVisible();

  const url = new URL(page.url());
  return url.pathname.split('/').pop()!;
}

/** Enter the Sewers from the Atlas, exactly as a player does. */
export async function enterHunt(page: Page): Promise<void> {
  await page.getByTestId('marker-marker.rookgaard.sewers').click();
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('game-window')).toBeVisible();
}

/** The Character's live run row. */
export async function runOf(prisma: PrismaClient, characterId: string) {
  const claim = await prisma.occupancyClaim.findUniqueOrThrow({ where: { characterId } });
  return prisma.huntRun.findUniqueOrThrow({ where: { activityId: claim.activityId } });
}

/**
 * Put Gold in the Bank, durably, the way a player would have earned it.
 *
 * The prices Phase 3 locked are Gold SINKS on purpose — 10,000 for slot 2 —
 * and a browser case cannot farm that many Rats inside a test timeout. So the
 * durable position is ARRANGED through the same ledger the game uses, and the
 * case then does every visible step for real.
 */
export async function fundBank(
  prisma: PrismaClient,
  characterId: string,
  amount: bigint,
): Promise<void> {
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { accountId: true },
  });
  await withTransaction(prisma as never, (tx) =>
    economy.post(tx, {
      subject: economy.bankOf(toAccountId(character.accountId)),
      currency: 'GOLD',
      amount,
      reasonCode: 'e2e.seed',
      operationId: toOperationId(`e2e:${characterId}:${amount}:${Date.now()}`),
      at: new Date(),
    }),
  );
}
