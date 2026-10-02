import type { EntityId } from '@rebbehub/model';
import { withCatalog, type Context } from './commands.js';
import { alignRecordings, localWhisper, transcribeRecordings, workersAiWhisper, type Transcriber } from './transcribe.js';
import { restoreWordTimes } from './restoreWordTimes.js';
import { mendTranscriptSplits } from './wordSplits.js';

/**
 * `rebbehub transcribe`: machine transcripts, with their sync, of
 * recordings that have none (see transcribe.ts). Whisper runs on
 * Cloudflare Workers AI: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN (a
 * token allowed only Workers AI), or with `--engine local` on this machine
 * (ivrit.ai's Yiddish Whisper; `pip install faster-whisper`, the model in
 * WHISPER_MODEL to change it). Served files come from `files`/objects/.
 */
export async function transcribeCommand(ctx: Context, input: { approveAs: string; recording?: string; limit?: number; linked?: boolean; files?: string; engine?: string; requestedOnly?: boolean; shard?: string }): Promise<void> {
  const shard = input.shard?.split('/').map(Number) as [number, number] | undefined;
  if (shard && !(shard.length === 2 && Number.isInteger(shard[0]) && shard[0]! >= 0 && shard[0]! < shard[1]!)) throw new Error('--shard is i/n, as 0/4');
  const transcriber = engine(input.engine);
  const base = (input.files ?? 'https://api.rebbehub.org').replace(/\/$/, '');
  await withCatalog(ctx, async (catalog) => {
    const done = await transcribeRecordings(catalog, {
      approveAs: input.approveAs,
      transcriber,
      recording: input.recording as EntityId | undefined,
      limit: input.limit,
      linked: input.linked,
      requestedOnly: input.requestedOnly,
      shard,
      log: ctx.log,
      fetchAudio: (recording) => fetchAudio(base, recording),
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
      fetchAudio: (recording) => fetchAudio(base, recording),
    });
    ctx.log(`aligned ${done.length} recordings, ${done.reduce((n, d) => n + d.words, 0)} words, ${done.reduce((n, d) => n + d.hanacha, 0)} hanacha paragraphs`);
  });
}

/**
 * `rebbehub mend-splits`: words that machine transcripts made before the
 * fix cut in two between paragraphs ("... פון דעם י" | "וד, און ..."),
 * joined again, one suggestion by the transcription bot per recording (see
 * wordSplits.ts). Paragraphs a person checked or fixed are left as they are.
 */
export async function mendSplitsCommand(ctx: Context, input: { approveAs?: string; recording?: string; limit?: number; dryRun?: boolean }): Promise<void> {
  if (!input.dryRun && !input.approveAs) throw new Error('--approve-as is needed, or --dry-run');
  await withCatalog(ctx, async (catalog) => {
    const done = await mendTranscriptSplits(catalog, {
      approveAs: input.approveAs ?? '',
      recording: input.recording as EntityId | undefined,
      limit: input.limit,
      dryRun: input.dryRun,
      log: ctx.log,
    });
    ctx.log(`${input.dryRun ? 'would mend' : 'mended'} ${done.reduce((n, d) => n + d.mended.length, 0)} cut words in ${done.length} transcripts`);
  });
}

/**
 * `rebbehub restore-word-times`: word timings back for paragraphs fixed
 * before fixes kept them, from each span's history (see
 * restoreWordTimes.ts). Reads no audio.
 */
export async function restoreWordTimesCommand(ctx: Context, input: { approveAs?: string; recording?: string; limit?: number; dryRun?: boolean }): Promise<void> {
  if (!input.dryRun && !input.approveAs) throw new Error('--approve-as is needed, or --dry-run');
  await withCatalog(ctx, async (catalog) => {
    const done = await restoreWordTimes(catalog, { approveAs: input.approveAs ?? '', recording: input.recording as EntityId | undefined, limit: input.limit, dryRun: input.dryRun, log: ctx.log });
    ctx.log(`${input.dryRun ? 'would give back' : 'gave back'} word timings to ${done.reduce((n, d) => n + d.paragraphs, 0)} paragraphs in ${done.length} transcripts`);
  });
}

/**
 * A recording's audio: its served file, or where it is heard. A dropped
 * connection or a busy server (many workers side by side fetch at once)
 * is tried again, three times in all, before the recording is given up.
 */
export async function fetchAudio(base: string, { file, url }: { file: string | null; url: string | null }, options: { tries?: number; wait?: (ms: number) => Promise<void>; fetch?: typeof fetch } = {}): Promise<Uint8Array> {
  const from = file ? `${base}/objects/${file}` : url!;
  const tries = options.tries ?? 3;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await (options.fetch ?? fetch)(from);
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      const error = new Error(`${from}: ${response.status}`);
      // Not there, or not allowed: asking again will not change it.
      if (response.status < 500 && response.status !== 429) throw Object.assign(error, { final: true });
      throw error;
    } catch (error) {
      if ((error as { final?: boolean }).final || attempt >= tries) throw error;
      await wait(2000 * 2 ** (attempt - 1));
    }
  }
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
