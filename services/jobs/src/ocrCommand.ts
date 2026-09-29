import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';
import { readScans } from './ocr.js';

/** `rebbehub ocr`: machine OCR of the served scans that have none yet; see ocr.ts. */
export async function ocrCommand(ctx: Context, input: { approveAs: string; scan?: string; limit?: number; files?: string; reread?: boolean; requestedOnly?: boolean }): Promise<void> {
  const base = (input.files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  await withCatalog(ctx, async (catalog) => {
    const done = await readScans(catalog, {
      approveAs: input.approveAs,
      scan: input.scan as EntityId | undefined,
      limit: input.limit,
      reread: input.reread,
      requestedOnly: input.requestedOnly,
      log: ctx.log,
      async fetchFile(sha256) {
        const response = await fetch(`${base}/objects/${sha256}`);
        if (!response.ok) throw new Error(`${base}/objects/${sha256}: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      },
    });
    ctx.log(`read ${done.length} scans, ${done.reduce((n, d) => n + d.pages, 0)} pages`);
  });
}
