import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';
import { kraken, readScans, tesseract, type OcrEngine } from './ocr.js';

/**
 * `rebbehub ocr`: machine OCR of the served scans that have none yet; see
 * ocr.ts. `--engine kraken-index` reads the index books with RebbeHub's
 * Kraken model instead (`--model`, or KRAKEN_MODEL; `pip install kraken`),
 * taking over what Tesseract read of them.
 */
export async function ocrCommand(
  ctx: Context,
  input: { approveAs: string; scan?: string; limit?: number; files?: string; reread?: boolean; requestedOnly?: boolean; engine?: string; model?: string },
): Promise<void> {
  const reader = engine(input.engine, input.model);
  const base = (input.files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  await withCatalog(ctx, async (catalog) => {
    const done = await readScans(catalog, {
      approveAs: input.approveAs,
      engine: reader,
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

/** Who reads: Tesseract (the default, every scan), or `kraken-index`, index books only. */
function engine(name = tesseract.name, model = process.env.KRAKEN_MODEL): OcrEngine {
  if (name === tesseract.name) return tesseract;
  if (name !== 'kraken-index') throw new Error(`--engine is ${tesseract.name} or kraken-index, not ${name}`);
  if (!model) throw new Error('kraken-index needs its model: --model <file.safetensors>, or KRAKEN_MODEL');
  return kraken({ model, tessdata: process.env.KRAKEN_TESSDATA || undefined });
}
