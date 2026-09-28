import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Catalog, Json } from '@rebbehub/core';
import { orderKeys, type EntityId, type Language } from '@rebbehub/model';

/**
 * Transcription and sync (the plan, section 7: "the system aligns
 * automatically: transcribe, then align"). A recording is transcribed by
 * machine into a transcript text of paragraphs, each synced to where it is
 * heard: a `transcript` text, its segments, and a paragraph-level
 * alignment whose spans the player follows. Everything is marked as
 * machine output (proofread 0, `origin.by`) until a person checks it; the
 * bot never merges its own work, a steward does.
 */

const run = promisify(execFile);

export const TRANSCRIBE_BOT = 'bot:transcribe';

/** Where the words were heard, in milliseconds from the recording's start. */
export interface Heard {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcriber {
  name: string;
  version: string;
  /** The words of an audio file, in order, with when each piece is heard. */
  transcribe(audio: string, language: Language, dir: string): Promise<Heard[]>;
}

/**
 * Whisper on Cloudflare Workers AI. The audio is cut into ten-minute
 * pieces (mono, 16 kHz, small enough to send), each is sent on its own,
 * and the times are put back on the recording's clock.
 */
export function workersAiWhisper(input: { accountId: string; token: string; model?: string; fetch?: typeof fetch }): Transcriber {
  const model = input.model ?? '@cf/openai/whisper-large-v3-turbo';
  const PIECE_SECONDS = 600;
  return {
    name: 'whisper-workers-ai',
    version: model.replace(/^@cf\//, ''),
    async transcribe(audio, language, dir) {
      await run('ffmpeg', ['-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'segment', '-segment_time', String(PIECE_SECONDS), join(dir, 'piece%03d.mp3')]);
      const pieces = (await readdir(dir)).filter((f) => f.startsWith('piece')).sort();
      const heard: Heard[] = [];
      for (const [i, piece] of pieces.entries()) {
        const bytes = await readFile(join(dir, piece));
        const response = await (input.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai/run/${model}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: bytes.toString('base64'), language, task: 'transcribe' }),
        });
        const body = (await response.json()) as { success?: boolean; errors?: unknown; result?: { segments?: Array<{ start: number; end: number; text: string }>; text?: string } };
        if (!response.ok || !body.success) throw new Error(`Workers AI: ${response.status} ${JSON.stringify(body.errors ?? body)}`);
        const offset = i * PIECE_SECONDS * 1000;
        for (const s of body.result?.segments ?? []) {
          const text = s.text.trim();
          if (text) heard.push({ startMs: offset + Math.round(s.start * 1000), endMs: offset + Math.round(s.end * 1000), text });
        }
      }
      return heard;
    },
  };
}

/** Gathers what was heard into paragraphs of about a minute, breaking at pauses of two seconds or more. */
export function paragraphs(heard: Heard[], options: { targetMs?: number; pauseMs?: number } = {}): Heard[] {
  const target = options.targetMs ?? 60_000;
  const pause = options.pauseMs ?? 2_000;
  const out: Heard[] = [];
  for (const h of heard) {
    const last = out.at(-1);
    if (last && h.startMs - last.endMs < pause && last.endMs - last.startMs < target) {
      last.text = `${last.text} ${h.text}`;
      last.endMs = h.endMs;
    } else {
      out.push({ ...h });
    }
  }
  return out;
}

/** Recordings with no transcript yet, oldest first: those whose file is served, and with `linked` those heard at another site too. */
export async function recordingsToTranscribe(catalog: Catalog, options: { recording?: EntityId; limit?: number; linked?: boolean } = {}): Promise<Array<{ id: EntityId; file: string | null; url: string | null; language: Language }>> {
  const params: unknown[] = [];
  const only = options.recording ? `AND e.id = $${params.push(options.recording)}` : '';
  const heardHere = "EXISTS (SELECT 1 FROM file f WHERE f.sha256 = r.data->>'file' AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit'))";
  const { rows } = await catalog.db.query<{ id: EntityId; file: string | null; url: string | null; language: Language | null }>(
    `SELECT e.id, r.data->>'file' AS file, r.data->>'url' AS url, r.data->>'language' AS language
     FROM entity e JOIN revision r ON r.id = e.main_rev
     WHERE e.type = 'recording' AND NOT e.deleted ${only}
       AND (${heardHere}${options.linked ? " OR r.data->>'url' IS NOT NULL" : ''})
       AND NOT EXISTS (
         SELECT 1 FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted
         JOIN revision tr ON tr.id = t.main_rev
         WHERE x.to_id = e.id AND x.field = 'recording' AND tr.data->>'kind' = 'transcript')
     ORDER BY e.id LIMIT ${Math.min(options.limit ?? 5, 500)}`,
    params,
  );
  return rows.map((r) => ({ id: r.id, file: r.file, url: r.url, language: r.language ?? 'yi' }));
}

/**
 * Transcribes the recordings and adds each one's transcript and sync as a
 * suggestion by the transcription bot, approved by `approveAs`. `fetchAudio`
 * gets a recording's audio (its served file, or where it is heard).
 */
export async function transcribeRecordings(
  catalog: Catalog,
  input: {
    approveAs: string;
    transcriber: Transcriber;
    fetchAudio: (recording: { file: string | null; url: string | null }) => Promise<Uint8Array>;
    recording?: EntityId;
    limit?: number;
    linked?: boolean;
    log?: (line: string) => void;
  },
): Promise<Array<{ recording: EntityId; paragraphs: number }>> {
  const log = input.log ?? (() => {});
  await catalog.createAccount({ id: TRANSCRIBE_BOT, displayName: 'Machine transcription', isBot: true });
  const origin = { by: `transcribe:${input.transcriber.name}@${input.transcriber.version}` };
  const done: Array<{ recording: EntityId; paragraphs: number }> = [];
  for (const rec of await recordingsToTranscribe(catalog, { recording: input.recording, limit: input.limit, linked: input.linked })) {
    const dir = await mkdtemp(join(tmpdir(), 'rebbehub-transcribe-'));
    try {
      const audio = join(dir, 'audio');
      await writeFile(audio, await input.fetchAudio(rec));
      const paras = paragraphs(await input.transcriber.transcribe(audio, rec.language, dir));
      if (paras.length === 0) {
        log(`${rec.id}: nothing heard`);
        continue;
      }
      const suggestion = await catalog.createChangeset(TRANSCRIBE_BOT, { title: `Machine transcript of ${rec.id} (${input.transcriber.version})` });
      const text = await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { type: 'text', data: { kind: 'transcript', recording: rec.id, language: rec.language } as Json });
      const alignment = await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, {
        type: 'alignment',
        data: { recording: rec.id, text, granularity: 'paragraph', engine: { name: input.transcriber.name, version: input.transcriber.version } } as Json,
      });
      const orders = orderKeys(paras.length);
      for (const [i, p] of paras.entries()) {
        const segment = await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { type: 'segment', data: { text, order: orders[i]!, kind: 'paragraph', content: p.text, proofread: 0, origin } as Json });
        await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { type: 'alignment-span', data: { alignment, segment, startMs: p.startMs, endMs: p.endMs, origin } as Json });
      }
      await catalog.submit(suggestion.id, TRANSCRIBE_BOT);
      await catalog.merge(suggestion.id, input.approveAs, {}, 'Machine transcript, labelled as such until checked');
      log(`${rec.id}: ${paras.length} paragraphs`);
      done.push({ recording: rec.id, paragraphs: paras.length });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return done;
}
