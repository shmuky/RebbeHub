import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';
import { alignRecordings, localWhisper, transcribeRecordings, workersAiWhisper, type Transcriber } from './transcribe.js';

/**
 * `rebbehub transcribe`: machine transcripts, with their sync, of
 * recordings that have none (see transcribe.ts). Whisper runs on
 * Cloudflare Workers AI: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN (a
 * token allowed only Workers AI), or with `--engine local` on this machine
 * (ivrit.ai's Yiddish Whisper; `pip install faster-whisper`, the model in
 * WHISPER_MODEL to change it). Served files come from `files`/objects/.
 */
export async function transcribeCommand(ctx: Context, input: { approveAs: string; recording?: string; limit?: number; linked?: boolean; files?: string; engine?: string }): Promise<void> {
  const transcriber = engine(input.engine);
  const base = (input.files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  await withCatalog(ctx, async (catalog) => {
    const done = await transcribeRecordings(catalog, {
      approveAs: input.approveAs,
      transcriber,
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

/**
 * `rebbehub align`: word timings for transcripts that have none (people's
 * corrections included), and hanachos synced paragraph by paragraph (see
 * alignRecordings). The same engines as `transcribe`.
 */
export async function alignCommand(ctx: Context, input: { approveAs: string; recording?: string; limit?: number; linked?: boolean; files?: string; engine?: string }): Promise<void> {
  const transcriber = engine(input.engine);
  const base = (input.files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  await withCatalog(ctx, async (catalog) => {
    const done = await alignRecordings(catalog, {
      approveAs: input.approveAs,
      transcriber,
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
    ctx.log(`aligned ${done.length} recordings, ${done.reduce((n, d) => n + d.words, 0)} words, ${done.reduce((n, d) => n + d.hanacha, 0)} hanacha paragraphs`);
  });
}

/** The Whisper that hears: on Workers AI (the default), or `local`, on this machine. */
function engine(name = 'workers-ai'): Transcriber {
  if (name === 'local') return localWhisper({ model: process.env.WHISPER_MODEL || undefined });
  if (name !== 'workers-ai') throw new Error(`--engine is workers-ai or local, not ${name}`);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_TOKEN;
  if (!accountId || !token) throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN, or use --engine local');
  return workersAiWhisper({ accountId, token });
}
