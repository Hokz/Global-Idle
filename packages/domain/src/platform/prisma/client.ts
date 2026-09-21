// The Prisma 7 client is constructed with a driver adapter. Without one the
// pinned client throws: "A driver adapter is required to connect to your
// database." (§4.3)
//
// The generated client is imported by RELATIVE PATH with the .js extension
// nodenext requires. It lives inside rootDir, so `tsc -b` compiles it to
// dist/generated/prisma alongside hand-written source, and the same specifier
// resolves in the editor, in the built output, in Vitest and in production —
// with no paths alias and nothing to rewrite.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

export type { PrismaClient };

export interface PrismaClientOptions {
  readonly connectionString: string;
}

export function createPrismaClient(options: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: options.connectionString });
  return new PrismaClient({ adapter });
}
