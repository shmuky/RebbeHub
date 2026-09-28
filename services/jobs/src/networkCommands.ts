import { embedItems, embedderFromEnv, proposeCitations } from '@rebbehub/core';
import { withCatalog, type Context } from './commands.js';
import { checkLinks } from './linkCheck.js';

/**
 * The phase-6 jobs (docs/operations.md): semantic search's embeddings,
 * citations proposed as links, and the dead-link check behind the health
 * page. Each does only what an earlier run has not.
 */

/**
 * `rebbehub embed`: turns the words of items not embedded yet into
 * vectors for search by meaning, with BGE-M3 on Cloudflare Workers AI
 * (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN, as `transcribe` uses).
 */
export async function embedCommand(ctx: Context, input: { limit?: number }): Promise<void> {
  const embedder = embedderFromEnv(process.env);
  if (!embedder) throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN');
  await withCatalog(ctx, async (catalog) => {
    const done = await embedItems(catalog, embedder, { limit: input.limit, log: ctx.log });
    ctx.log(`embedded ${done.embedded} items with ${embedder.model}; ${done.skipped} had no words to embed`);
  });
}

/**
 * `rebbehub citations`: reads texts, scans' pages and pages of sichos for
 * citations and proposes the links as Suggestions by the citations bot,
 * left for a keeper, or approved at once with `--approve-as`.
 */
export async function citationsCommand(ctx: Context, input: { approveAs?: string; limit?: number }): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    const done = await proposeCitations(catalog, { approveAs: input.approveAs, limit: input.limit, log: ctx.log });
    ctx.log(`read ${done.read} items, found ${done.found} citations, proposed ${done.proposed} new links in ${done.suggestions.length} suggestions${input.approveAs ? ', approved' : ', waiting for review'}`);
  });
}

/** `rebbehub check-links`: asks the catalog's links, those checked longest ago first, whether they still answer. */
export async function checkLinksCommand(ctx: Context, input: { limit?: number }): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    const done = await checkLinks(catalog, { limit: input.limit, log: ctx.log });
    ctx.log(`${done.links} links in the catalog; checked ${done.checked}, ${done.dead} did not answer`);
  });
}
