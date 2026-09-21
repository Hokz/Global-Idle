// Prisma 7 configuration (§4.3). The connection URL lives here because the
// schema file may no longer carry one.
//
// The Prisma CLI runs with this package as its cwd, so `dotenv/config` alone
// would look for packages/domain/.env and find nothing. This loads the
// REPOSITORY-ROOT .env, which is the file .env.example documents.
//
// override: false is deliberate — an already-exported DATABASE_URL wins. That
// is exactly how CI runs (§4.3: "DATABASE_URL is exported for every step"),
// so the local path and the CI path differ only in where the value comes from.
//
// env() is EAGER: a missing DATABASE_URL fails loudly, by name, rather than
// letting `prisma generate` succeed on a machine where `prisma migrate` is
// about to fail with a less useful error.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
