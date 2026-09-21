/**
 * Advance a Hunt run from a BRAND NEW process (§12, PS2 and PS4).
 *
 * Plain ESM against the BUILT domain, because the point is that nothing this
 * test process warmed is involved: no module state, no connection pool, no
 * resolver cache, no generator. A restart that resumed from anything other
 * than the durable row would show up here and nowhere else.
 *
 * Usage: node restart-runner.mjs <databaseUrl> <bundleDir> <activityId> <nowIso>
 */
import {
  content,
  createPrismaClient,
  hunt,
  withTransaction,
} from '../../packages/domain/dist/index.js';

const [databaseUrl, bundleDir, activityId, nowIso] = process.argv.slice(2);
const prisma = createPrismaClient({ connectionString: databaseUrl });

try {
  const resolver = content.createResolver(prisma, bundleDir);
  const view = await withTransaction(prisma, (tx) =>
    hunt.advance(tx, {
      activityId,
      resolver,
      now: new Date(nowIso),
      seen: true,
    }),
  );
  process.stdout.write(JSON.stringify(view));
} finally {
  await prisma.$disconnect();
}
