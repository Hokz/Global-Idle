// Phase 1 §16 — CH1 to CH9. Character creation (spec §5).
//
// Every field a Character is born with is SERVER-OWNED; the client sends a
// name. These cases drive the real route and then read the real row, because
// "the response said Level 1" and "the database holds Level 1" are different
// claims and only the second one survives a reload.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { character as characterContext } from '@global-idle/domain';
import { createClient, truncateAll } from '../support/db.js';
import {
  call,
  createCharacter,
  publishRookgaard,
  signIn,
  startApp,
  type App,
  type CharacterBody,
} from '../support/phase1.js';

const prisma = createClient();

let directory: string;
let app: App | undefined;
let base: string;
let cookie: string;

/** Roster capacity is a DIFFERENT rule, checked before I1b. Raising it is how
 *  a case about the Origin Character gets to reach the Origin Character. */
async function widenRoster(handle: string, capacity: number): Promise<void> {
  const identity = await prisma.authIdentity.findUniqueOrThrow({
    where: { provider_subject: { provider: 'dev', subject: handle } },
  });
  await prisma.account.update({
    where: { id: identity.accountId },
    data: { rosterCapacity: capacity },
  });
}

beforeEach(async () => {
  await truncateAll(prisma);
  directory = await mkdtemp(join(tmpdir(), 'global-idle-characters-'));
  await publishRookgaard(prisma, directory);
  process.env['GLOBAL_IDLE_DEV_AUTH'] = '1';
  const started = await startApp({ CONTENT_BUNDLE_DIR: directory });
  app = started.app;
  base = started.base;
  cookie = await signIn(base, 'rookie');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env['GLOBAL_IDLE_DEV_AUTH'];
});

describe('character creation', () => {
  it('CH1: the client sends a name; every other field is server-owned', async () => {
    const created = await createCharacter(base, cookie, 'Rookie');

    const row = await prisma.character.findUniqueOrThrow({ where: { id: created.id } });
    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'dev', subject: 'rookie' } },
    });

    expect(row.name).toBe('Rookie');
    // The account comes from the SESSION, not from anything the client sent.
    expect(row.accountId).toBe(identity.accountId);
    expect(row.retiredAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('CH2: vocation is NULL — the Origin Character has not met the Oracle', async () => {
    const created = await createCharacter(base, cookie, 'Rookie');

    expect(created.vocation).toBeNull();
    const row = await prisma.character.findUniqueOrThrow({ where: { id: created.id } });
    // NULL, not a sentinel string. "No vocation yet" is absence, and a
    // 'NONE' member would be a sixth vocation the rules would have to exclude.
    expect(row.vocation).toBeNull();
  });

  it('CH3: baseLevel is 1', async () => {
    const created = await createCharacter(base, cookie, 'Rookie');

    expect(created.baseLevel).toBe(1);
    const row = await prisma.character.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.baseLevel).toBe(1);
  });

  it('CH4: a Stamina row exists at 42:00 with the DERIVED mode, RECOVERING while idle', async () => {
    const created = await createCharacter(base, cookie, 'Rookie');

    const row = await prisma.characterStamina.findUniqueOrThrow({
      where: { characterId: created.id },
    });
    expect(row.remainingMs).toBe(characterContext.STAMINA_MAX);
    expect(created.stamina.remainingMs).toBe(characterContext.STAMINA_MAX);
    expect(created.stamina.maxMs).toBe(characterContext.STAMINA_MAX);

    // DERIVED, not asserted: this is what `deriveStaminaMode` returns for a
    // Character holding no claim, and the view must not invent a different
    // answer from the one the domain gives.
    expect(created.stamina.mode).toBe(characterContext.deriveStaminaMode({ claim: null }));
    expect(created.stamina.mode).toBe('RECOVERING');
  });

  it('CH5: a malformed name is refused with NAME_INVALID and creates nothing', async () => {
    const refused = ['', 'R', 'x'.repeat(21), 'Rook13', 'Two  Spaces', 'Sir-Rook', '  '];
    for (const name of refused) {
      const response = await call<{ error: { code: string } }>(base, '/api/characters', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ name }),
      });
      expect(response.status, `name: ${JSON.stringify(name)}`).toBe(422);
      expect(response.body.error.code).toBe('NAME_INVALID');
    }
    expect(await prisma.character.count()).toBe(0);

    // Surrounding whitespace is TRIMMED, not refused. A player who typed a
    // trailing space has not made a mistake worth an error message, and the
    // stored name is the well-formed one either way.
    const padded = await createCharacter(base, cookie, '  Rookie  ');
    expect(padded.name).toBe('Rookie');
    const row = await prisma.character.findUniqueOrThrow({ where: { id: padded.id } });
    expect(row.name).toBe('Rookie');
  });

  it('CH6: a name already used by a playable Character on the account is refused', async () => {
    await widenRoster('rookie', 5);
    await createCharacter(base, cookie, 'Rookie');

    const again = await call<{ error: { code: string } }>(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Rookie' }),
    });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NAME_TAKEN');
    expect(await prisma.character.count()).toBe(1);
  });

  it('CH7: a full roster is refused with ROSTER_FULL', async () => {
    // A fresh account's capacity is 1 (DOMAIN_MODEL.md §5.4), so the second
    // creation is refused without touching anything.
    await createCharacter(base, cookie, 'Rookie');

    const second = await call<{ error: { code: string } }>(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Another' }),
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ROSTER_FULL');
    expect(await prisma.character.count()).toBe(1);
  });

  it('CH8: a client-supplied baseLevel or vocation is ignored, not trusted', async () => {
    const response = await call<CharacterBody>(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        name: 'Rookie',
        baseLevel: 400,
        vocation: 'KNIGHT',
        premium: true,
        id: 'client-chosen-id',
      }),
    });

    expect(response.status).toBe(201);
    expect(response.body.baseLevel).toBe(1);
    expect(response.body.vocation).toBeNull();
    expect(response.body.id).not.toBe('client-chosen-id');

    const row = await prisma.character.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(row.baseLevel).toBe(1);
    expect(row.vocation).toBeNull();
  });

  it('CH9: a second Origin Character on one account is refused with ORIGIN_CHARACTER_EXISTS', async () => {
    // Capacity is raised so the roster rule cannot answer first — I1b is what
    // this case is about, and a ROSTER_FULL here would prove nothing.
    await widenRoster('rookie', 5);
    await createCharacter(base, cookie, 'First');

    const second = await call<{ error: { code: string } }>(base, '/api/characters', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ name: 'Second' }),
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ORIGIN_CHARACTER_EXISTS');
    expect(await prisma.character.count()).toBe(1);
  });
});
