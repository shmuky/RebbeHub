import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { alignAroundLocks, alignParagraphs, alignWords, hanachaOf, heardWords, recordingTranscript, type Catalog, type HeardWord, type Json } from '@rebbehub/core';
import { orderKeys, type EntityId, type Language } from '@rebbehub/model';
import { failIfAny, machineRun } from './machineQueue.js';

/**
 * Transcription and sync (the plan, section 7: "the system aligns
 * automatically: transcribe, then align"). A recording is transcribed by
 * machine into a transcript text of paragraphs, each synced to where it is
 * heard: a `transcript` text, its segments, and a paragraph-level
 * alignment whose spans the player follows, word by word where the
 * recogniser gave word times. Everything is marked as
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
  /** Each word's own time, when the recogniser gives them. */
  words?: HeardWord[];
  /**
   * The piece carries on the last word of the piece before: the recogniser
   * ended that piece in the middle of a word ("... פון דעם י", then "וד, און").
   */
  glued?: boolean;
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
        type Word = { word: string; start: number; end: number };
        const body = (await response.json()) as { success?: boolean; errors?: unknown; result?: { segments?: Array<{ start: number; end: number; text: string; words?: Word[] }>; words?: Word[]; text?: string } };
        if (!response.ok || !body.success) throw new Error(`Workers AI: ${response.status} ${JSON.stringify(body.errors ?? body)}`);
        const offset = i * PIECE_SECONDS * 1000;
        // Whisper gives each word's time too (in its segments, or for the older model at the top); kept for word-level sync.
        const toWords = (ws: Word[] | undefined): HeardWord[] | undefined =>
          ws?.length ? ws.filter((w) => w.word?.trim()).map((w) => ({ text: w.word.trim(), startMs: offset + Math.round(w.start * 1000), endMs: offset + Math.round(w.end * 1000) })) : undefined;
        const segments = body.result?.segments ?? [];
        for (const s of segments) {
          const text = s.text.trim();
          if (text) heard.push({ startMs: offset + Math.round(s.start * 1000), endMs: offset + Math.round(s.end * 1000), text, words: toWords(s.words) });
        }
        if (!segments.length && body.result?.text?.trim()) {
          const words = toWords(body.result.words);
          heard.push({ startMs: words?.[0]?.startMs ?? offset, endMs: words?.at(-1)?.endMs ?? offset + PIECE_SECONDS * 1000, text: body.result.text.trim(), words });
        }
      }
      return heard;
    },
  };
}

/**
 * Whisper on this machine (services/jobs/whisper/transcribe.py, with
 * faster-whisper), by default ivrit.ai's Yiddish Whisper: free, runs on a
 * CPU at about four times the speed of speech, and hears the Rebbe's
 * Yiddish far better than Whisper itself (docs/transcription.md).
 */
export function localWhisper(input: { model?: string; python?: string; script?: string } = {}): Transcriber {
  const model = input.model ?? 'ivrit-ai/yi-whisper-large-v3-turbo-ct2';
  const script = input.script ?? fileURLToPath(new URL('../whisper/transcribe.py', import.meta.url));
  return {
    name: 'whisper-local',
    // A model kept on disk (rebbe-whisper, fetched from R2) is named by its folder.
    version: (isAbsolute(model) ? basename(model) : model).replace(/-ct2$/, ''),
    async transcribe(audio, language) {
      const { stdout } = await run(input.python ?? 'python3', [script, audio, '--language', language, '--model', model], { maxBuffer: 1 << 28 });
      return stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const piece = JSON.parse(line) as { start: number; end: number; text: string; words?: Array<[string, number, number, boolean?]>; glued?: boolean };
          const words: HeardWord[] = [];
          for (const [i, [text, start, end, glued]] of (piece.words ?? []).entries()) {
            const last = words.at(-1);
            // A word that carries on the one before is one word with it; the piece's first word is glued with the piece.
            if (glued && i > 0 && last) {
              last.text += text;
              last.endMs = Math.round(end * 1000);
            } else {
              words.push({ text, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
            }
          }
          return { startMs: Math.round(piece.start * 1000), endMs: Math.round(piece.end * 1000), text: piece.text, ...(words.length ? { words } : {}), ...(piece.glued ? { glued: true } : {}) };
        })
        // JEM's spoken opening ("This audio has been restored by JEM") is not the Rebbe's words.
        .filter((h) => !/restored by/i.test(h.text));
    },
  };
}

/**
 * Gathers what was heard into paragraphs of about a minute. A paragraph
 * breaks at a pause of two seconds or more; once it is a minute long, at
 * the end of a sentence (a piece ending in . ? ! : or ;), and once it is
 * two minutes long, at the next piece whatever it ends in, so a long run
 * without punctuation still breaks. It never breaks at a piece that carries
 * on the last word of the one before (`glued`): that piece is joined
 * without a space, and the two halves of the word are one word, heard from
 * the start of the first to the end of the second.
 */
export function paragraphs(heard: Heard[], options: { targetMs?: number; maxMs?: number; pauseMs?: number } = {}): Heard[] {
  const target = options.targetMs ?? 60_000;
  const max = options.maxMs ?? target * 2;
  const pause = options.pauseMs ?? 2_000;
  const out: Heard[] = [];
  for (const h of heard) {
    const last = out.at(-1);
    const glued = Boolean(h.glued && last);
    const length = last ? last.endMs - last.startMs : 0;
    const sentenceEnd = last ? /[.?!:;…]["'״”)\]]*$/.test(last.text) : false;
    if (last && (glued || (h.startMs - last.endMs < pause && (length < target || (length < max && !sentenceEnd))))) {
      last.text = glued ? `${last.text}${h.text}` : `${last.text} ${h.text}`;
      last.endMs = Math.max(last.endMs, h.endMs);
      if (last.words && h.words) {
        const [first, ...rest] = h.words;
        const end = last.words.at(-1);
        if (glued && end && first) last.words = [...last.words.slice(0, -1), { text: `${end.text}${first.text}`, startMs: end.startMs, endMs: first.endMs }, ...rest];
        else last.words = [...last.words, ...h.words];
      } else {
        last.words = undefined;
      }
    } else {
      out.push({ startMs: h.startMs, endMs: h.endMs, text: h.text, words: h.words ? [...h.words] : undefined });
    }
  }
  return out;
}

/**
 * Recordings with no transcript yet, the newest first (one just added is
 * heard next): those whose file is served, and with `linked` those heard
 * at another site too. With `shard` [i, n], only part i of n, so n jobs
 * side by side each take their own recordings.
 */
export async function recordingsToTranscribe(catalog: Catalog, options: { recording?: EntityId; limit?: number; linked?: boolean; shard?: [number, number] } = {}): Promise<Array<{ id: EntityId; file: string | null; url: string | null; language: Language }>> {
  const params: unknown[] = [];
  const only = options.recording
    ? `AND e.id = $${params.push(options.recording)}`
    : options.shard
      ? `AND mod(abs(hashtext(e.id)), $${params.push(options.shard[1])}) = $${params.push(options.shard[0])}`
      : '';
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
     ORDER BY e.created_at DESC, e.id LIMIT ${Math.min(options.limit ?? 5, 500)}`,
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
    /** Only what people asked for (core/machineWork.ts), not the newest recordings nobody asked for too. */
    requestedOnly?: boolean;
    /** Part i of n of the recordings nobody asked for, for n jobs side by side; requests are shared among them. */
    shard?: [number, number];
    log?: (line: string) => void;
  },
): Promise<Array<{ recording: EntityId; paragraphs: number }>> {
  const log = input.log ?? (() => {});
  await catalog.createAccount({ id: TRANSCRIBE_BOT, displayName: 'Machine transcription', isBot: true });
  const origin = { by: `transcribe:${input.transcriber.name}@${input.transcriber.version}` };
  const done: Array<{ recording: EntityId; paragraphs: number }> = [];
  const { failed } = await machineRun(catalog, 'transcript', {
    item: input.recording,
    limit: input.limit ?? 5,
    sweep: !input.requestedOnly,
    log,
    // A recording someone asked for is heard wherever it is, linked or served; the sweep keeps to `linked`.
    find: ({ item, limit }) => recordingsToTranscribe(catalog, { recording: item, limit, linked: item ? true : input.linked, shard: item ? undefined : input.shard }),
    work: transcribeOne,
  });
  failIfAny(failed);
  return done;

  async function transcribeOne(rec: { id: EntityId; file: string | null; url: string | null; language: Language }): Promise<void | { skipped: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'rebbehub-transcribe-'));
    try {
      const audio = join(dir, 'audio');
      await writeFile(audio, await input.fetchAudio(rec));
      const paras = paragraphs(await input.transcriber.transcribe(audio, rec.language, dir));
      if (paras.length === 0) return { skipped: 'nothing heard' };
      // Word timings: each paragraph's words matched to the words as they were heard.
      const timed = paras.some((p) => p.words?.length) ? alignWords(paras.map((p) => p.text), heardWords(paras)) : null;
      const suggestion = await catalog.createChangeset(TRANSCRIBE_BOT, { title: `Machine transcript of ${rec.id} (${input.transcriber.version})` });
      const text = await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { type: 'text', data: { kind: 'transcript', recording: rec.id, language: rec.language } as Json });
      const alignment = await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, {
        type: 'alignment',
        data: { recording: rec.id, text, granularity: timed ? 'word' : 'paragraph', engine: { name: input.transcriber.name, version: input.transcriber.version } } as Json,
      });
      const orders = orderKeys(paras.length);
      for (const [i, p] of paras.entries()) {
        const segment = await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { type: 'segment', data: { text, order: orders[i]!, kind: 'paragraph', content: p.text, proofread: 0, origin } as Json });
        const words = timed?.[i]?.words;
        await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { type: 'alignment-span', data: { alignment, segment, startMs: p.startMs, endMs: p.endMs, ...(words ? { words } : {}), origin } as unknown as Json });
      }
      await catalog.submit(suggestion.id, TRANSCRIBE_BOT);
      await catalog.merge(suggestion.id, input.approveAs, {}, 'Machine transcript, labelled as such until checked');
      log(`${rec.id}: ${paras.length} paragraphs`);
      done.push({ recording: rec.id, paragraphs: paras.length });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export const ALIGN_BOT = 'bot:align';

/**
 * Recordings whose transcript has no word timings yet (it was transcribed
 * before them, or a person changed its words since), and recordings whose
 * farbrengen's hanacha is in the catalog but not yet synced to them.
 * Those with words a person corrected come first (timed, they are the
 * next model's training clips: core/trainingClips.ts), then the ones
 * aligned longest ago, so one that cannot be timed does not hold up the rest.
 */
export async function recordingsToAlign(catalog: Catalog, options: { recording?: EntityId; limit?: number; linked?: boolean } = {}): Promise<Array<{ id: EntityId; file: string | null; url: string | null; language: Language }>> {
  const params: unknown[] = [];
  const only = options.recording ? `AND e.id = $${params.push(options.recording)}` : '';
  const heardHere = "EXISTS (SELECT 1 FROM file f WHERE f.sha256 = r.data->>'file' AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit'))";
  // No word timings, or only those a fix carried over (core/sync.ts fixParagraph), waiting to be timed from the audio.
  const untimed = "NOT coalesce((spr.data->>'locked')::boolean, FALSE) AND (NOT (spr.data ? 'words') OR spr.data->'origin'->>'edited' = 'true')";
  const { rows } = await catalog.db.query<{ id: EntityId; file: string | null; url: string | null; language: Language | null }>(
    `SELECT e.id, r.data->>'file' AS file, r.data->>'url' AS url, r.data->>'language' AS language
     FROM entity e JOIN revision r ON r.id = e.main_rev
     JOIN LATERAL (
       SELECT bool_or(${untimed}) AS untimed,
              bool_or(${untimed} AND (coalesce((sr.data->>'proofread')::int, 0) > 0 OR sr.data->'origin'->>'checked' = 'true')) AS corrected,
              max(spr.created_at) AS last
       FROM entity a JOIN revision ar ON ar.id = a.main_rev
       JOIN entity_ref y ON y.to_id = a.id AND y.field = 'alignment'
       JOIN entity sp ON sp.id = y.from_id AND sp.type = 'alignment-span' AND NOT sp.deleted JOIN revision spr ON spr.id = sp.main_rev
       LEFT JOIN entity s ON s.id = spr.data->>'segment' LEFT JOIN revision sr ON sr.id = s.main_rev
       WHERE a.type = 'alignment' AND NOT a.deleted AND ar.data->>'recording' = e.id
     ) w ON w.untimed
     WHERE e.type = 'recording' AND NOT e.deleted ${only}
       AND (${heardHere}${options.linked ? " OR r.data->>'url' IS NOT NULL" : ''})
     ORDER BY w.corrected DESC, w.last, e.id LIMIT ${Math.min(options.limit ?? 5, 500)}`,
    params,
  );
  const out = rows.map((r) => ({ id: r.id, file: r.file, url: r.url, language: r.language ?? ('yi' as Language) }));
  if (options.recording && !out.length) {
    // One recording asked for by name: align it to its hanacha even when its transcript is timed already.
    const rec = await catalog.get(options.recording);
    const d = rec?.data as { file?: string; url?: string; language?: Language } | undefined;
    if (rec?.type === 'recording' && (await hanachaOf(catalog, rec.id))) out.push({ id: rec.id, file: d?.file ?? null, url: d?.url ?? null, language: d?.language ?? 'yi' });
  }
  return out;
}

/**
 * Forced alignment (the plan, section 9: "then forced alignment for word
 * timings; paragraph-level alignment to hanachos by text similarity"):
 * each recording is heard afresh for its word times, its transcript as it
 * now stands (people's corrections and all) is timed word by word, and,
 * when the catalog has its farbrengen's hanacha, the hanacha is synced
 * paragraph by paragraph. Spans a person locked are never moved; the
 * rest are aligned only to what was heard between the locked ones. As the
 * alignment bot, approved by `approveAs`, labelled until checked.
 */
export async function alignRecordings(
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
): Promise<Array<{ recording: EntityId; words: number; hanacha: number }>> {
  const log = input.log ?? (() => {});
  await catalog.createAccount({ id: ALIGN_BOT, displayName: 'Machine sync', isBot: true });
  const origin = { by: `align:${input.transcriber.name}@${input.transcriber.version}` };
  const done: Array<{ recording: EntityId; words: number; hanacha: number }> = [];
  for (const rec of await recordingsToAlign(catalog, input)) {
    const dir = await mkdtemp(join(tmpdir(), 'rebbehub-align-'));
    try {
      const audio = join(dir, 'audio');
      await writeFile(audio, await input.fetchAudio(rec));
      const heard = heardWords(await input.transcriber.transcribe(audio, rec.language, dir));
      if (!heard.length) {
        log(`${rec.id}: nothing heard`);
        continue;
      }
      const suggestion = await catalog.createChangeset(ALIGN_BOT, { title: `Machine sync of ${rec.id} (${input.transcriber.version})` });
      let words = 0;
      let hanachaParagraphs = 0;
      const view = await recordingTranscript(catalog, rec.id);
      if (view?.alignment) {
        const timed = alignAroundLocks(
          view.paragraphs.map((p) => ({ content: p.content, ...(p.locked && p.startMs !== null && p.endMs !== null ? { locked: { startMs: p.startMs, endMs: p.endMs } } : {}) })),
          heard,
        );
        const alignment = (await catalog.get(view.alignment))!;
        await catalog.putRevision(suggestion.id, ALIGN_BOT, {
          id: alignment.id,
          type: 'alignment',
          data: { ...(alignment.data as Record<string, Json>), granularity: 'word', engine: { name: input.transcriber.name, version: input.transcriber.version } },
        });
        for (const [i, p] of view.paragraphs.entries()) {
          const t = timed[i];
          if (!t || p.locked) continue;
          words += t.words.length;
          const data = { alignment: view.alignment, segment: p.id, startMs: t.startMs, endMs: t.endMs, words: t.words, origin } as unknown as Json;
          await catalog.putRevision(suggestion.id, ALIGN_BOT, p.span ? { id: p.span, type: 'alignment-span', data } : { type: 'alignment-span', data });
        }
      }
      const hanacha = await hanachaOf(catalog, rec.id);
      const synced = hanacha
        ? await catalog.db.query("SELECT 1 FROM entity a JOIN revision ar ON ar.id = a.main_rev WHERE a.type = 'alignment' AND NOT a.deleted AND ar.data->>'recording' = $1 AND ar.data->>'text' = $2", [rec.id, hanacha])
        : null;
      if (hanacha && !synced?.rows.length) {
        const segments = (await catalog.children(hanacha, 'text', 'segment', { limit: 5000 }))
          .map((s) => ({ id: s.id, ...(s.data as { order: string; content: string; kind: string }) }))
          .filter((s) => s.kind !== 'heading')
          .sort((a, b) => (a.order < b.order ? -1 : 1));
        const spans = alignParagraphs(segments.map((s) => s.content), heard);
        if (spans.some(Boolean)) {
          const alignment = await catalog.putRevision(suggestion.id, ALIGN_BOT, {
            type: 'alignment',
            data: { recording: rec.id, text: hanacha, granularity: 'paragraph', engine: { name: 'similarity', version: '1' } } as Json,
          });
          for (const [i, span] of spans.entries()) {
            if (!span) continue;
            hanachaParagraphs++;
            await catalog.putRevision(suggestion.id, ALIGN_BOT, { type: 'alignment-span', data: { alignment, segment: segments[i]!.id, startMs: span.startMs, endMs: span.endMs, origin: { by: 'align:similarity@1' } } as Json });
          }
        }
      }
      if (!words && !hanachaParagraphs) {
        await catalog.withdraw(suggestion.id, ALIGN_BOT);
        log(`${rec.id}: nothing to align`);
        continue;
      }
      await catalog.submit(suggestion.id, ALIGN_BOT);
      await catalog.merge(suggestion.id, input.approveAs, {}, 'Machine sync, labelled as such until checked');
      log(`${rec.id}: ${words} words timed, ${hanachaParagraphs} hanacha paragraphs synced`);
      done.push({ recording: rec.id, words, hanacha: hanachaParagraphs });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return done;
}
