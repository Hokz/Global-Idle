/**
 * The DEVELOPMENT-ONLY private asset loader (Phase 3.7 spec §9.2).
 *
 * User-supplied client graphics are a private reference. They may be looked at
 * on a developer's own machine; they may not be distributed. This route is the
 * only thing that can read them, and it is built to be impossible to ship:
 *
 *  - it gates on `process.env.NODE_ENV !== 'production'`, which the bundler
 *    SUBSTITUTES at build time, so the serving branch is dead code a release
 *    build eliminates;
 *  - it has NO opt-in environment flag. A flag is a way to turn this on in
 *    production by accident, so there is nothing to turn on;
 *  - it reads from `private/assets/`, outside `public/` and outside every
 *    bundler input, so nothing in the production build graph can copy it;
 *  - the tempting place — a private folder under the web app's own `public/`
 *    directory — is FORBIDDEN and fails `scripts/check-release-isolation.mjs`.
 *    That path is deliberately NOT spelled out here: the guard fails any built
 *    file that names it, and a comment reaches the build through the source
 *    map, so writing it down would fail the very check it describes. (Measured:
 *    it did.)
 *
 * The folder name matters too. Next's App Router excludes any folder whose
 * name starts with `_` from routing, so an earlier version of this file at
 * `app/_dev/private-asset/` returned 404 in development as well — a gate on a
 * route that did not exist. `dev-private-asset` is routable, and the guard
 * checks that it stays that way.
 *
 * When the file is absent the caller gets 404 and falls back to the public
 * placeholder, which is also what every CI run and every public build does.
 */
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';

/** Repo-root-relative, resolved from the Next working directory (apps/web). */
const PRIVATE_ROOT = resolve(process.cwd(), '..', '..', 'private', 'assets');

const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  // THE GATE. A production build folds this to `false` and drops everything
  // below it; a production RUNTIME that somehow reached here still refuses.
  if (process.env.NODE_ENV !== 'production') {
    const { path } = await context.params;
    const relative = normalize(path.join('/'));

    // Traversal, absolute paths and anything that climbs out are refused
    // before touching the disk.
    if (relative.startsWith('..') || relative.split(/[\\/]/).includes('..')) return notFound();
    const target = join(PRIVATE_ROOT, relative);
    if (!target.startsWith(PRIVATE_ROOT + sep)) return notFound();

    const dot = target.lastIndexOf('.');
    const type = TYPES[dot === -1 ? '' : target.slice(dot).toLowerCase()];
    if (!type) return notFound();

    try {
      const bytes = await readFile(target);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'content-type': type, 'cache-control': 'no-store' },
      });
    } catch {
      // Absent is the ORDINARY case: almost nobody has these files.
      return notFound();
    }
  }
  return notFound();
}
