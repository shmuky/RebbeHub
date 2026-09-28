import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';
import { transcribeRecordings, workersAiWhisper } from './transcribe.js';

/**
 * `rebbehub transcribe`: machine transcripts, with their sync, of
 * recordings that have none (see transcribe.ts). Whisper runs on
 * Cloudflare Workers AI: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN (a
 * token allowed only Workers AI). Served files come from `files`/objects/.
 */
export async function transcribeCommand(ctx: Context, input: { approveAs: string; recording?: string; limit?: number; linked?: boolean; files?: string }): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  if (!accountId || !token) throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN');
  const base = (input.files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  await withCatalog(ctx, async (catalog) => {
    const done = await transcribeRecordings(catalog, {
      approveAs: input.approveAs,
      transcriber: workersAiWhisper({ accountId, token }),
      recording: input.recording as EntityId | undefined,
      limit: input.limit,
      linked: input.linked,
      log: ctx.log,
      async fetchAudio({ file, url }) {
        const from = file ? `${base}/objects/${file}` : url!;
        const response = await fetch(from);
        if (!response.ok) throw new Error(`${from}: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      },
    });
    ctx.log(`transcribed ${done.length} recordings, ${done.reduce((n, d) => n + d.paragraphs, 0)} paragraphs`);
  });
}
