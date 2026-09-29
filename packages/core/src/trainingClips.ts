import type { EntityId } from '@rebbehub/model';
import type { Catalog } from './catalog.js';

/**
 * The retraining cycle's data (docs/transcription.md): every transcript
 * paragraph a person checked becomes training clips for the next Rebbe
 * Whisper, with nobody gathering them by hand. People correct on the
 * site; the nightly align run times the corrected words again; this reads
 * the result as clips in the training script's own format (the rows of
 * clips.jsonl: audio, start, end, text, split), ready for the next paid
 * run whenever there is budget for one.
 *
 * Only words a person checked are used. A clip is `gold` when a person
 * also checked where it is heard, `silver` when the timing is the
 * machine's alignment of the checked words. Whisper hears at most 30
 * seconds at a time, so a longer paragraph is cut at its word timings;
 * without them it waits for the next align run. Each recording is kept
 * wholly in `train` or wholly in `test`, by a hash of its id that never
 * changes, so a model is never scored on audio it learned from.
 */

/** Longest clip, in seconds: under Whisper's 30-second window, with room for the edges. */
export const CLIP_MAX_SECONDS = 28;
const CLIP_MIN_SECONDS = 1;
/** Letters per second outside this range mean the words and the timing do not match. */
const MIN_CHARS_PER_SECOND = 3;
const MAX_CHARS_PER_SECOND = 30;
/** One recording in ten is held out for scoring. */
const TEST_SHARE = 10;

/**
 * Recordings the training script already scores on, by JEM file: always
 * `test`, so no version learns them. The four held-out farbrengens of 5742
 * (Tzom Gedaliah, Taanis Esther, Lag BaOmer, 17 Tammuz) and 11 Nissan 5733.
 */
export const HELD_OUT_AUDIO: readonly string[] = [
  'JEMSK2863.mp3',
  'JEMSK3002.mp3',
  'JEMSK3053.mp3',
  'JEMSK3054.mp3',
  'JEMSK3113.mp3',
  'AR0015492.mp3',
  'AR0015494.mp3',
  'AR0015496.mp3',
  'AR0015498.mp3',
  'AR0015508.mp3',
  'AR0015510.mp3',
  'AR0015512.mp3',
  'AR0015515.mp3',
];

export type ClipQuality = 'gold' | 'silver';

/** One clip, as the training script reads it (clips.jsonl), plus where on RebbeHub it came from. */
export interface TrainingClip {
  /** The recording's audio: its JEM file name when JEM's, else its full address. */
  audio: string[];
  /** Seconds from the recording's start. */
  start: number;
  end: number;
  text: string;
  split: 'train' | 'test';
  /** How its test score is reported, apart from the booklets' and 5742's. */
  group: 'site';
  section: 'site';
  pdf: null;
  quality: ClipQuality;
  recording: EntityId;
  segment: EntityId;
  /** When the paragraph was last checked or changed (ISO). */
  checkedAt: string;
}

export interface TrainingSkip {
  segment: EntityId;
  reason: 'no timing' | 'long, waiting for word timing' | 'too short' | 'words and timing disagree' | 'no audio';
}

export interface TrainingSummary {
  clips: number;
  hours: number;
  gold: number;
  silver: number;
  trainHours: number;
  testHours: number;
  recordings: number;
  /** Hours checked since `since`, when asked: what the next round would add. */
  newHours: number | null;
  skipped: Partial<Record<TrainingSkip['reason'], number>>;
}

interface Row {
  segment: EntityId;
  content: string;
  recording: EntityId;
  url: string | null;
  file: string | null;
  span: { startMs: number; endMs: number; words?: Array<{ from: number; to: number; startMs: number; endMs: number }>; locked?: boolean; origin?: { checked?: boolean } } | null;
  checked_at: Date | string;
}

/** Every checked transcript paragraph with its recording and where it is heard, in one query. */
async function checkedParagraphs(catalog: Catalog, since?: string): Promise<Row[]> {
  const { rows } = await catalog.db.query<Row>(
    `SELECT s.id AS segment, sr.data->>'content' AS content, rec.id AS recording, rr.data->>'url' AS url, rr.data->>'file' AS file,
            sp.data AS span, sr.created_at AS checked_at
     FROM entity t JOIN revision tr ON tr.id = t.main_rev AND tr.data->>'kind' = 'transcript'
     JOIN entity rec ON rec.id = tr.data->>'recording' AND NOT rec.deleted JOIN revision rr ON rr.id = rec.main_rev
     JOIN entity_ref x ON x.to_id = t.id AND x.field = 'text'
     JOIN entity s ON s.id = x.from_id AND s.type = 'segment' AND NOT s.deleted
     JOIN revision sr ON sr.id = s.main_rev
     LEFT JOIN LATERAL (
       SELECT spr.data FROM entity_ref y JOIN entity e ON e.id = y.from_id AND e.type = 'alignment-span' AND NOT e.deleted
       JOIN revision spr ON spr.id = e.main_rev
       JOIN entity a ON a.id = spr.data->>'alignment' AND NOT a.deleted JOIN revision ar ON ar.id = a.main_rev
       WHERE y.to_id = s.id AND y.field = 'segment' AND ar.data->>'recording' = rec.id
       ORDER BY e.id LIMIT 1
     ) sp ON TRUE
     WHERE t.type = 'text' AND NOT t.deleted
       AND (COALESCE((sr.data->>'proofread')::int, 0) > 0 OR sr.data->'origin'->>'checked' = 'true')
       ${since ? 'AND sr.created_at >= $1' : ''}
     ORDER BY rec.id, sr.data->>'order'`,
    since ? [since] : [],
  );
  return rows;
}

/** The recording's audio as the training script fetches it. */
function audioOf(row: Pick<Row, 'url' | 'file'>, filesBaseUrl: string): string | null {
  const jem = row.url ? /\/jem-audio\/([^/?#]+)$/.exec(row.url) : null;
  if (jem) return decodeURIComponent(jem[1]!);
  if (row.file) return `${filesBaseUrl.replace(/\/$/, '')}/objects/${row.file}`;
  return row.url;
}

/** FNV-1a: the same recording id lands in the same split on every machine, every run. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function splitOf(recording: EntityId, audio: string): 'train' | 'test' {
  return HELD_OUT_AUDIO.includes(audio) || hash(recording) % TEST_SHARE === 0 ? 'test' : 'train';
}

/** A paragraph's pieces of at most CLIP_MAX_SECONDS, cut between words; null when it is too long and has no word timings. */
export function piecesOf(content: string, span: NonNullable<Row['span']>): Array<{ text: string; startMs: number; endMs: number }> | null {
  if (span.endMs - span.startMs <= CLIP_MAX_SECONDS * 1000) return [{ text: content, startMs: span.startMs, endMs: span.endMs }];
  const words = span.words?.length && span.words.every((w) => w.to <= content.length) ? span.words : null;
  if (!words) return null;
  const pieces: Array<{ text: string; startMs: number; endMs: number }> = [];
  let first = 0;
  for (let i = 1; i <= words.length; i++) {
    const next = words[i];
    if (next && next.endMs - words[first]!.startMs <= CLIP_MAX_SECONDS * 1000) continue;
    const last = words[i - 1]!;
    pieces.push({ text: content.slice(words[first]!.from, last.to).trim(), startMs: words[first]!.startMs, endMs: last.endMs });
    first = i;
  }
  return pieces;
}

/**
 * The clips people's checking has made so far, and what was left out and
 * why. `since` (an ISO date) keeps only paragraphs checked since then.
 */
export async function trainingClips(catalog: Catalog, options: { since?: string; filesBaseUrl?: string } = {}): Promise<{ clips: TrainingClip[]; skipped: TrainingSkip[] }> {
  const clips: TrainingClip[] = [];
  const skipped: TrainingSkip[] = [];
  for (const row of await checkedParagraphs(catalog, options.since)) {
    const audio = audioOf(row, options.filesBaseUrl ?? 'https://api.rebbehub.org');
    if (!audio) {
      skipped.push({ segment: row.segment, reason: 'no audio' });
      continue;
    }
    if (!row.span) {
      skipped.push({ segment: row.segment, reason: 'no timing' });
      continue;
    }
    const pieces = piecesOf(row.content, { ...row.span, startMs: Number(row.span.startMs), endMs: Number(row.span.endMs) });
    if (!pieces) {
      skipped.push({ segment: row.segment, reason: 'long, waiting for word timing' });
      continue;
    }
    const quality: ClipQuality = row.span.locked || row.span.origin?.checked || !row.span.origin ? 'gold' : 'silver';
    for (const piece of pieces) {
      const seconds = (piece.endMs - piece.startMs) / 1000;
      const letters = piece.text.replace(/[^\p{L}]/gu, '').length;
      if (seconds < CLIP_MIN_SECONDS || !letters) {
        skipped.push({ segment: row.segment, reason: 'too short' });
        continue;
      }
      if (letters / seconds < MIN_CHARS_PER_SECOND || letters / seconds > MAX_CHARS_PER_SECOND) {
        skipped.push({ segment: row.segment, reason: 'words and timing disagree' });
        continue;
      }
      clips.push({
        audio: [audio],
        start: piece.startMs / 1000,
        end: piece.endMs / 1000,
        text: piece.text,
        split: splitOf(row.recording, audio),
        group: 'site',
        section: 'site',
        pdf: null,
        quality,
        recording: row.recording,
        segment: row.segment,
        checkedAt: new Date(row.checked_at).toISOString(),
      });
    }
  }
  return { clips, skipped };
}

/** How much training data people's checking has made, and how much of it is new since `since`. */
export function summariseTraining(all: { clips: TrainingClip[]; skipped: TrainingSkip[] }, since?: string): TrainingSummary {
  const hours = (clips: TrainingClip[]) => Math.round(clips.reduce((t, c) => t + (c.end - c.start), 0) / 36) / 100;
  const skipped: TrainingSummary['skipped'] = {};
  for (const s of all.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
  return {
    clips: all.clips.length,
    hours: hours(all.clips),
    gold: all.clips.filter((c) => c.quality === 'gold').length,
    silver: all.clips.filter((c) => c.quality === 'silver').length,
    trainHours: hours(all.clips.filter((c) => c.split === 'train')),
    testHours: hours(all.clips.filter((c) => c.split === 'test')),
    recordings: new Set(all.clips.map((c) => c.recording)).size,
    newHours: since ? hours(all.clips.filter((c) => c.checkedAt >= new Date(since).toISOString())) : null,
    skipped,
  };
}
