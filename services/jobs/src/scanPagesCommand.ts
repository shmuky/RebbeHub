import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';
import { makeCovers } from './covers.js';
import { R2Store } from './readingCopies.js';
import { fingerprintFiles, makePageImages } from './scanPages.js';

/** A served file's bytes from the API's media proxy (`<files>/objects/<sha256>`). */
const fetcher = (files?: string) => {
  const base = (files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  return async (sha256: string): Promise<Uint8Array> => {
    const response = await fetch(`${base}/objects/${sha256}`);
    if (!response.ok) throw new Error(`${base}/objects/${sha256}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
};

/** An R2 bucket through Cloudflare's REST API, or null without credentials. */
function bucket(name: string): R2Store | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  return accountId && token ? new R2Store(accountId, name, token) : null;
}

/** `rebbehub page-images`: page images and thumbnails of served scans that have none; see scanPages.ts. */
export async function pageImagesCommand(ctx: Context, input: { scan?: string; limit?: number; files?: string; bucket?: string }): Promise<void> {
  const store = bucket(input.bucket ?? 'rebbehub-public');
  if (!store) throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with R2 edit rights): page images go into the public bucket');
  await withCatalog(ctx, async (catalog) => {
    const done = await makePageImages(catalog, { fetchFile: fetcher(input.files), store, scan: input.scan as EntityId | undefined, limit: input.limit, log: ctx.log });
    ctx.log(`page images of ${done.length} scans, ${done.reduce((n, d) => n + d.pages, 0)} pages`);
  });
}

/** `rebbehub fingerprints`: page hashes and audio fingerprints of held files not measured yet; see scanPages.ts. */
export async function fingerprintsCommand(ctx: Context, input: { limit?: number; files?: string; preservationBucket?: string }): Promise<void> {
  const preserved = bucket(input.preservationBucket ?? 'rebbehub-preservation');
  await withCatalog(ctx, async (catalog) => {
    const done = await fingerprintFiles(catalog, {
      fetchPublic: fetcher(input.files),
      fetchPreserved: preserved ? (sha256) => preserved.get(`objects/${sha256}`) : undefined,
      limit: input.limit,
      log: ctx.log,
    });
    ctx.log(`measured ${done.length} files; ${done.filter((d) => d.similar > 0).length} look like files already held`);
  });
}

/** `rebbehub covers`: sefarim's covers from their title pages; see covers.ts. */
export async function coversCommand(ctx: Context, input: { work?: string; limit?: number; again?: boolean; files?: string; bucket?: string }): Promise<void> {
  const store = bucket(input.bucket ?? 'rebbehub-public');
  if (!store) throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with R2 edit rights): covers go into the public bucket');
  await withCatalog(ctx, async (catalog) => {
    const done = await makeCovers(catalog, { fetchFile: fetcher(input.files), store, work: input.work as EntityId | undefined, limit: input.limit, again: input.again, log: ctx.log });
    ctx.log(`covers of ${done.length} sefarim, ${done.filter((d) => d.machine).length} chosen by the machine`);
  });
}
