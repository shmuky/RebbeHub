import { one } from '@rebbehub/db';
import { carryWordTimes, type EntityId } from '@rebbehub/model';
import type { Catalog, ChangesetRow, NewRevision } from './catalog.js';
import { invalid, notFound } from './errors.js';
import type { Json } from './merge.js';
import { matchWords, wordKey, words as wordsOf } from './words.js';

/**
 * Sync: where each paragraph, and each word, of a text is heard in a
 * recording (the plan, sections 7 and 9: "transcribe, align to the
 * transcript, then to the hanacha paragraph by paragraph"; "the player
 * highlights the words as they are spoken; if it drifts, the user taps
 * 'the Rebbe is saying this line now' and the alignment is fixed from
 * there"). What a machine aligned is labelled until a person checks it;
 * a span a person fixed is locked, and no re-run moves it.
 */

/** A word as a recogniser heard it, in milliseconds from the recording's start. */
export interface HeardWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** One word of a paragraph with when it is heard: character offsets into the paragraph. */
export interface WordTiming {
  from: number;
  to: number;
  startMs: number;
  endMs: number;
}

export interface Timed {
  startMs: number;
  endMs: number;
  words: WordTiming[];
}

/**
 * Pieces of what was heard, as recognisers give them, into words: the
 * words' own times when the recogniser gave them, else the piece's time
 * shared among its words by their length.
 */
export function heardWords(heard: ReadonlyArray<{ text: string; startMs: number; endMs: number; words?: HeardWord[] }>): HeardWord[] {
  const out: HeardWord[] = [];
  for (const h of heard) {
    if (h.words?.length) {
      for (const w of h.words) if (w.text.trim()) out.push({ text: w.text.trim(), startMs: w.startMs, endMs: Math.max(w.startMs, w.endMs) });
      continue;
    }
    const ws = h.text.split(/\s+/).filter(Boolean);
    const chars = ws.reduce((n, w) => n + w.length, 0) || 1;
    let at = h.startMs;
    for (const w of ws) {
      const len = ((h.endMs - h.startMs) * w.length) / chars;
      out.push({ text: w, startMs: Math.round(at), endMs: Math.round(at + len) });
      at += len;
    }
  }
  return out;
}

/**
 * Forced alignment of a text to what was heard: the paragraphs' words are
 * matched to the recognised words (the same word, compared the Hebrew way,
 * in order), a matched word takes the time it was heard, and the words in
 * between share the time between their neighbours by length. So a
 * transcript people corrected still gets word timings from a fresh
 * recognition of the audio. Null when nothing matched at all.
 */
export function alignWords(paragraphs: readonly string[], heard: readonly HeardWord[]): Array<Timed | null> | null {
  const tokens = paragraphs.flatMap((content, p) => wordsOf(content).map((w) => ({ ...w, p })));
  if (!tokens.length || !heard.length) return null;
  const matches = matchWords(
    tokens.map((t) => t.key),
    heard.map((h) => wordKey(h.text)),
  );
  if (!matches.length) return null;
  const start = new Array<number>(tokens.length).fill(NaN);
  const end = new Array<number>(tokens.length).fill(NaN);
  for (const [t, h] of matches) {
    start[t] = heard[h]!.startMs;
    end[t] = heard[h]!.endMs;
  }
  // The words between two matched ones share the time between them, by length.
  const first = heard[0]!.startMs;
  const last = Math.max(...heard.map((h) => h.endMs));
  let i = 0;
  while (i < tokens.length) {
    if (!Number.isNaN(start[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && Number.isNaN(start[j]!)) j++;
    const from = i > 0 ? end[i - 1]! : first;
    const to = j < tokens.length ? start[j]! : last;
    const span = Math.max(0, to - from);
    const chars = tokens.slice(i, j).reduce((n, t) => n + t.text.length, 0) || 1;
    let at = from;
    for (let k = i; k < j; k++) {
      const len = (span * tokens[k]!.text.length) / chars;
      start[k] = at;
      end[k] = at + len;
      at += len;
    }
    i = j;
  }
  return paragraphs.map((_, p) => {
    const ws: WordTiming[] = [];
    tokens.forEach((t, k) => {
      if (t.p === p) ws.push({ from: t.from, to: t.to, startMs: Math.round(start[k]!), endMs: Math.max(Math.round(start[k]!), Math.round(end[k]!)) });
    });
    if (!ws.length) return null;
    return { startMs: ws[0]!.startMs, endMs: Math.max(...ws.map((w) => w.endMs)), words: ws };
  });
}

/**
 * Forced alignment that keeps what people fixed: the paragraphs between
 * two locked ones are aligned only to what was heard between them, so a
 * person's fix steers every re-run. Locked paragraphs come back null
 * (left as they are).
 */
export function alignAroundLocks(paragraphs: ReadonlyArray<{ content: string; locked?: { startMs: number; endMs: number } }>, heard: readonly HeardWord[]): Array<Timed | null> {
  const out: Array<Timed | null> = paragraphs.map(() => null);
  let i = 0;
  while (i < paragraphs.length) {
    if (paragraphs[i]!.locked) {
      i++;
      continue;
    }
    let j = i;
    while (j < paragraphs.length && !paragraphs[j]!.locked) j++;
    const from = i > 0 ? paragraphs[i - 1]!.locked!.endMs : -Infinity;
    const to = j < paragraphs.length ? paragraphs[j]!.locked!.startMs : Infinity;
    const window = heard.filter((h) => (h.startMs + h.endMs) / 2 >= from && (h.startMs + h.endMs) / 2 < to);
    const timed = alignWords(
      paragraphs.slice(i, j).map((p) => p.content),
      window,
    );
    timed?.forEach((t, k) => (out[i + k] = t));
    i = j;
  }
  return out;
}

/** A word's key and, for a word of four letters or more, the same without a leading ו ה ב ל מ ש כ: Yiddish and Hebrew share stems. */
function keysOf(text: string): string[] {
  return wordsOf(text).flatMap((w) => (w.key.length >= 4 && /^[והבלמשכ]/.test(w.key) ? [w.key, w.key.slice(1)] : w.key.length >= 2 ? [w.key] : []));
}

/**
 * Paragraph-level alignment of a recording to its hanacha (the plan,
 * section 9: "paragraph-level alignment to hanachos by text similarity").
 * The hanacha is the Rebbe's words written up afterwards, in Hebrew; the
 * recording is what he said, mostly in Yiddish; so they are not the same
 * words, only many of the same. What was heard is cut into pieces of about
 * 25 words, each piece is scored against each paragraph by the words they
 * share, and the pieces are given out to the paragraphs in order (a
 * paragraph may take no piece: not everything written was said, nor the
 * other way round), so the paragraphs' shares score best in all. Each
 * paragraph comes back with where it is heard, or null.
 */
export function alignParagraphs(paragraphs: readonly string[], heard: readonly HeardWord[], options: { piece?: number } = {}): Array<{ startMs: number; endMs: number; score: number } | null> {
  // Pieces of about 25 words, smaller for a short recording, so each paragraph has a few to take.
  const size = options.piece ?? Math.max(1, Math.min(25, Math.floor(heard.length / (2 * Math.max(1, paragraphs.length)))));
  const pieces: Array<{ keys: string[]; startMs: number; endMs: number }> = [];
  for (let i = 0; i < heard.length; i += size) {
    const slice = heard.slice(i, i + size);
    pieces.push({ keys: slice.flatMap((h) => keysOf(h.text)), startMs: slice[0]!.startMs, endMs: slice.at(-1)!.endMs });
  }
  const sets = paragraphs.map((p) => new Set(keysOf(p)));
  const K = paragraphs.length;
  const M = pieces.length;
  if (!K || !M) return paragraphs.map(() => null);
  const score = (k: number, m: number) => {
    const keys = pieces[m]!.keys;
    if (!keys.length) return 0;
    let hit = 0;
    for (const key of keys) if (sets[k]!.has(key)) hit++;
    return hit / keys.length;
  };
  // best[m][k]: the best total with piece m given to paragraph k; paragraphs only move forward.
  const SKIP = 0.02;
  const best = Array.from({ length: M }, () => new Float64Array(K));
  const from = Array.from({ length: M }, () => new Int32Array(K));
  for (let k = 0; k < K; k++) best[0]![k] = score(k, 0) - SKIP * k;
  for (let m = 1; m < M; m++) {
    // The best earlier paragraph to come from, less a little for each paragraph skipped.
    let runBest = -Infinity;
    let runAt = 0;
    for (let k = 0; k < K; k++) {
      const stay = best[m - 1]![k]!;
      const move = runBest;
      if (stay >= move) {
        best[m]![k] = stay + score(k, m);
        from[m]![k] = k;
      } else {
        best[m]![k] = move + score(k, m);
        from[m]![k] = runAt;
      }
      // Moving on from k to a later paragraph, with the paragraphs between skipped.
      if (stay > runBest) {
        runBest = stay;
        runAt = k;
      }
      runBest -= SKIP;
    }
  }
  let k = 0;
  for (let c = 1; c < K; c++) if (best[M - 1]![c]! > best[M - 1]![k]!) k = c;
  const owner = new Array<number>(M);
  for (let m = M - 1; m >= 0; m--) {
    owner[m] = k;
    if (m > 0) k = from[m]![k]!;
  }
  return paragraphs.map((_, p) => {
    const mine = owner.map((o, m) => (o === p ? m : -1)).filter((m) => m >= 0);
    if (!mine.length) return null;
    const total = mine.reduce((n, m) => n + score(p, m), 0) / mine.length;
    return { startMs: pieces[mine[0]!]!.startMs, endMs: pieces[mine.at(-1)!]!.endMs, score: Math.round(total * 1000) / 1000 };
  });
}

// ------------------------------------------------------------ the catalog

export interface TranscriptParagraph {
  id: EntityId;
  content: string;
  startMs: number | null;
  endMs: number | null;
  /** Word timings, when the sync is word by word. */
  words: WordTiming[] | null;
  /** The span this paragraph's sync is kept in. */
  span: EntityId | null;
  /** A person fixed where it is heard: no machine re-run moves it. */
  locked: boolean;
  /** Whether a person has checked its words. */
  checked: boolean;
  /** A person fixed some of its words but did not check the whole of it: the rest is still the machine's. */
  edited: boolean;
  /** Whether a person has checked where it is heard. */
  syncChecked: boolean;
  by: string | null;
}

export interface TranscriptView {
  recording: EntityId;
  text: EntityId;
  language: string;
  alignment: EntityId | null;
  granularity: 'word' | 'paragraph' | null;
  /** Its paragraphs in order, each with where it is heard, and whether a person has checked it. */
  paragraphs: TranscriptParagraph[];
}

interface SpanData {
  alignment: EntityId;
  segment: EntityId;
  startMs: number;
  endMs: number;
  words?: WordTiming[];
  locked?: boolean;
  origin?: { by: string; checked?: boolean; edited?: boolean };
}

/** A recording that has a transcript, with how much of it people have checked (GET /v1/transcripts). */
export interface TranscribedRecording {
  recording: EntityId;
  title: Json;
  event: EntityId | null;
  durationMs: number | null;
  paragraphs: number;
  checked: number;
  /** Paragraphs whose words carry their own timings: the player lights them word by word. */
  timedWords: number;
}

/**
 * Every recording with a transcript, the most checked first, then the
 * longest: for picking the best to show (the site's showcase picker). One
 * read over all transcripts' paragraphs; there are hundreds, not millions.
 */
export async function transcribedRecordings(catalog: Catalog, options: { limit?: number } = {}): Promise<TranscribedRecording[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
  const { rows } = await catalog.db.query<{ recording: EntityId; title: Json; event: EntityId | null; duration: string | null; paragraphs: string; checked: string; timed: string }>(
    `SELECT x.to_id AS recording, rr.data->'title' AS title, rr.data->>'event' AS event, rr.data->>'durationMs' AS duration,
            count(s.id) AS paragraphs,
            count(s.id) FILTER (WHERE coalesce((sr.data->>'proofread')::int, 0) > 0 OR coalesce((sr.data->'origin'->>'checked')::boolean, false)) AS checked,
            count(s.id) FILTER (WHERE EXISTS (
              SELECT 1 FROM entity_ref z JOIN entity sp ON sp.id = z.from_id AND sp.type = 'alignment-span' AND NOT sp.deleted
              JOIN revision spr ON spr.id = sp.main_rev WHERE z.to_id = s.id AND z.field = 'segment' AND jsonb_array_length(coalesce(spr.data->'words', '[]')) > 0)) AS timed
     FROM entity t JOIN revision tr ON tr.id = t.main_rev AND tr.data->>'kind' = 'transcript'
     JOIN entity_ref x ON x.from_id = t.id AND x.field = 'recording'
     JOIN entity r ON r.id = x.to_id AND NOT r.deleted JOIN revision rr ON rr.id = r.main_rev
     JOIN entity_ref y ON y.to_id = t.id AND y.field = 'text'
     JOIN entity s ON s.id = y.from_id AND s.type = 'segment' AND NOT s.deleted JOIN revision sr ON sr.id = s.main_rev
     WHERE t.type = 'text' AND NOT t.deleted
     GROUP BY x.to_id, rr.data
     ORDER BY checked DESC, paragraphs DESC, x.to_id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    recording: r.recording,
    title: r.title,
    event: r.event,
    durationMs: r.duration ? Number(r.duration) : null,
    paragraphs: Number(r.paragraphs),
    checked: Number(r.checked),
    timedWords: Number(r.timed),
  }));
}

/** A recording's transcript with its sync, paragraph by paragraph; null when it has none. */
export async function recordingTranscript(catalog: Catalog, recording: EntityId): Promise<TranscriptView | null> {
  const text = await one<{ id: EntityId; language: string }>(
    catalog.db,
    `SELECT t.id, tr.data->>'language' AS language FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted
     JOIN revision tr ON tr.id = t.main_rev WHERE x.to_id = $1 AND x.field = 'recording' AND tr.data->>'kind' = 'transcript' ORDER BY t.id LIMIT 1`,
    [recording],
  );
  if (!text) return null;
  const alignment = await one<{ id: EntityId; granularity: 'word' | 'paragraph' }>(
    catalog.db,
    `SELECT a.id, ar.data->>'granularity' AS granularity FROM entity_ref x JOIN entity a ON a.id = x.from_id AND a.type = 'alignment' AND NOT a.deleted
     JOIN revision ar ON ar.id = a.main_rev WHERE x.to_id = $1 AND x.field = 'text' AND ar.data->>'recording' = $2 ORDER BY a.id LIMIT 1`,
    [text.id, recording],
  );
  const { rows } = await catalog.db.query<{ id: EntityId; content: string; proofread: number; origin: { by?: string; checked?: boolean; edited?: boolean } | null; order: string; span: EntityId | null; sd: SpanData | null }>(
    `SELECT s.id, sr.data->>'content' AS content, (sr.data->>'proofread')::int AS proofread, sr.data->'origin' AS origin, sr.data->>'order' AS "order",
            sp.id AS span, sp.data AS sd
     FROM entity_ref x JOIN entity s ON s.id = x.from_id AND s.type = 'segment' AND NOT s.deleted
     JOIN revision sr ON sr.id = s.main_rev
     LEFT JOIN LATERAL (
       SELECT e.id, spr.data FROM entity_ref y JOIN entity e ON e.id = y.from_id AND e.type = 'alignment-span' AND NOT e.deleted
       JOIN revision spr ON spr.id = e.main_rev
       WHERE y.to_id = s.id AND y.field = 'segment' AND spr.data->>'alignment' = $2 ORDER BY e.id LIMIT 1
     ) sp ON TRUE
     WHERE x.to_id = $1 AND x.field = 'text'`,
    [text.id, alignment?.id ?? ''],
  );
  rows.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return {
    recording,
    text: text.id,
    language: text.language,
    alignment: alignment?.id ?? null,
    granularity: alignment?.granularity ?? null,
    paragraphs: rows.map((r) => ({
      id: r.id,
      content: r.content,
      startMs: r.sd ? Number(r.sd.startMs) : null,
      endMs: r.sd ? Number(r.sd.endMs) : null,
      // Timings for words that are no longer there (the paragraph was corrected since) are left out.
      words: r.sd?.words?.length && r.sd.words.every((w) => w.to <= r.content.length) ? r.sd.words : null,
      span: r.span,
      locked: Boolean(r.sd?.locked),
      checked: r.proofread > 0 || Boolean(r.origin?.checked),
      edited: Boolean(r.origin?.edited) && !(r.proofread > 0 || r.origin?.checked),
      syncChecked: Boolean(r.sd?.locked || r.sd?.origin?.checked || (r.sd && !r.sd.origin)),
      by: r.origin?.by ?? null,
    })),
  };
}

/**
 * Fixes a paragraph of a transcript as a suggestion (the one this person
 * already sent for this transcript, while nobody has reviewed it yet, so
 * fixing word after word makes one suggestion): its words as the
 * person heard them, marked checked. A person who fixed only some words
 * (`complete: false`) leaves the paragraph machine hearing, marked
 * `edited`: the fix is on the site, but the paragraph stays labelled and
 * is no training clip until someone checks the whole of it. When the words
 * changed, the words left as they were keep their timings and the words
 * changed are timed between them (model/timing.ts), so the player still
 * lights the paragraph word by word; the next alignment run times them all
 * from the audio again. Words checked unchanged keep theirs, and are
 * training clips at once (trainingClips.ts).
 */
export async function fixParagraph(catalog: Catalog, by: string, input: { segment: EntityId; content: string; complete?: boolean }): Promise<ChangesetRow> {
  const content = input.content.replace(/\s+/g, ' ').trim();
  if (!content || content.length > 20_000) throw invalid('a paragraph of 1 to 20,000 characters');
  const segment = await catalog.get(input.segment);
  if (!segment || segment.type !== 'segment') throw notFound(`paragraph ${input.segment}`);
  const data = segment.data as Record<string, unknown> & { origin?: Record<string, unknown> };
  const revisions: NewRevision[] = [
    {
      id: segment.id,
      type: 'segment',
      data: (input.complete === false
        ? { ...data, content, ...(data.origin && !data.origin.checked ? { origin: { ...data.origin, edited: true } } : {}) }
        : { ...data, content, proofread: 1, ...(data.origin ? { origin: { ...data.origin, checked: true } } : {}) }) as Json,
    },
  ];
  const spans = data.content === content ? [] : await catalog.backlinks(segment.id, { field: 'segment', type: 'alignment-span' });
  for (const s of spans) {
    const span = await catalog.get(s.from);
    const sd = span?.data as unknown as SpanData | undefined;
    if (!span || !sd?.words) continue;
    // The words left as they were keep their times, and the words changed take the time between them; only when nothing is left to go by are they let go.
    const { words: old, ...rest } = sd;
    const words = carryWordTimes(String(data.content ?? ''), old, content);
    // Marked `edited` until the next alignment run times them from the audio again (it looks for these), and no training clip is cut by them meanwhile.
    const origin = words && rest.origin ? { origin: { ...rest.origin, edited: true } } : {};
    revisions.push({ id: span.id, type: 'alignment-span', data: (words ? { ...rest, words, ...origin } : rest) as unknown as Json });
  }
  // A listener's fixes of one transcript go into one suggestion while nobody has reviewed it yet: every word they fix joins it.
  const open = await one<{ id: number }>(
    catalog.db,
    `SELECT c.id FROM changeset c WHERE c.author = $1 AND c.status = 'open' AND c.kind = 'suggestion' AND c.title = $2
       AND EXISTS (SELECT 1 FROM revision r WHERE r.changeset_id = c.id AND r.entity_type = 'segment' AND r.data->>'text' = $3)
       AND NOT EXISTS (SELECT 1 FROM revision r WHERE r.changeset_id = c.id AND r.entity_type NOT IN ('segment', 'alignment-span'))
     ORDER BY c.id DESC LIMIT 1`,
    [by, FIX_TITLE, String(data.text ?? '')],
  );
  if (open && (await catalog.amend(open.id, by, revisions))) return catalog.changeset(open.id);
  const suggestion = await catalog.createChangeset(by, { title: FIX_TITLE });
  for (const revision of revisions) await catalog.putRevision(suggestion.id, by, revision);
  return catalog.submit(suggestion.id, by);
}

const FIX_TITLE = 'תיקון תמלול';
const SYNC_TITLE = 'תיקון סנכרון';

/** A time moved by a fix: the piece between the fixed point and the next locked one is stretched to fit. */
export function remapper(oldAt: number, newAt: number, nextLocked: number | null): (t: number) => number {
  const delta = newAt - oldAt;
  return (t: number) => {
    if (t < oldAt) return Math.max(0, Math.round(t + delta));
    if (nextLocked === null || nextLocked <= oldAt || nextLocked <= newAt) return Math.max(0, Math.round(t + delta));
    if (t >= nextLocked) return t;
    return Math.round(newAt + ((t - oldAt) * (nextLocked - newAt)) / (nextLocked - oldAt));
  };
}

/**
 * "The Rebbe is saying this line now" (the plan, section 7): a listener
 * taps the paragraph (or the word) they hear, at `atMs` in the recording.
 * That paragraph's sync is set there and locked; the paragraphs after it,
 * up to the next one a person locked, are moved with it (stretched to fit
 * before that one), and stay machine sync; the paragraph before it ends
 * where this one now starts. A suggestion like any fix, which goes live
 * straight away for trusted people in open sets. Returns it and the spans
 * as they now stand, so the player can follow the fix at once.
 */
export async function anchorSync(
  catalog: Catalog,
  by: string,
  input: { recording: EntityId; segment: EntityId; atMs: number; word?: number },
): Promise<ChangesetRow & { spans: Array<{ segment: EntityId; startMs: number; endMs: number; words: WordTiming[] | null; locked: boolean }> }> {
  if (!Number.isFinite(input.atMs) || input.atMs < 0) throw invalid('atMs is a time in the recording, in milliseconds');
  let view = await recordingTranscript(catalog, input.recording);
  if (!view) throw notFound(`a transcript of ${input.recording}`);
  // This listener's timing of the recording that still waits: a new tap goes on from it and joins it, so their timings never clash with each other.
  const open = view.alignment
    ? await one<{ id: number }>(
        catalog.db,
        `SELECT c.id FROM changeset c WHERE c.author = $1 AND c.status = 'open' AND c.kind = 'suggestion' AND c.title = $2
           AND EXISTS (SELECT 1 FROM revision r WHERE r.changeset_id = c.id AND r.entity_type = 'alignment-span' AND r.data->>'alignment' = $3)
           AND NOT EXISTS (SELECT 1 FROM revision r WHERE r.changeset_id = c.id AND r.entity_type <> 'alignment-span')
         ORDER BY c.id DESC LIMIT 1`,
        [by, SYNC_TITLE, view.alignment],
      )
    : null;
  if (open) {
    const mine = new Map((await catalog.proposals(open.id)).map((p) => [p.entityId, p.rev.data as unknown as SpanData | null]));
    view = {
      ...view,
      paragraphs: view.paragraphs.map((p) => {
        const d = p.span ? mine.get(p.span) : undefined;
        return d ? { ...p, startMs: Number(d.startMs), endMs: Number(d.endMs), words: d.words?.length && d.words.every((w) => w.to <= p.content.length) ? d.words : null, locked: Boolean(d.locked) } : p;
      }),
    };
  }
  const i = view.paragraphs.findIndex((p) => p.id === input.segment);
  const target = view.paragraphs[i];
  if (!target) throw notFound(`paragraph ${input.segment} in this transcript`);
  if (!target.span || target.startMs === null || target.endMs === null) throw notFound('a sync for this paragraph');
  const word = input.word !== undefined ? target.words?.[input.word] : undefined;
  if (input.word !== undefined && !word) throw notFound(`word ${input.word} of this paragraph`);
  const atMs = Math.round(input.atMs);
  const oldAt = word ? word.startMs : target.startMs;
  let j = i + 1;
  while (j < view.paragraphs.length && !view.paragraphs[j]!.locked) j++;
  const nextLocked = view.paragraphs[j]?.startMs ?? null;
  const move = remapper(oldAt, atMs, nextLocked);

  const changed = new Map<number, { startMs: number; endMs: number; words: WordTiming[] | null; locked: boolean }>();
  for (let k = i; k < j; k++) {
    const p = view.paragraphs[k]!;
    if (!p.span || p.startMs === null || p.endMs === null) continue;
    changed.set(k, {
      startMs: k === i && !word ? atMs : move(p.startMs),
      endMs: move(p.endMs),
      words: p.words?.map((w) => ({ ...w, startMs: move(w.startMs), endMs: move(w.endMs) })) ?? null,
      locked: k === i ? true : p.locked,
    });
  }
  const fixed = changed.get(i)!;
  const before = view.paragraphs[i - 1];
  // The line before ends where this one now starts: earlier if they overlapped, later if a gap opened.
  if (before?.span && !before.locked && before.endMs !== null && before.endMs !== fixed.startMs) {
    changed.set(i - 1, {
      startMs: Math.min(before.startMs ?? 0, fixed.startMs),
      endMs: fixed.startMs,
      words: before.words?.map((w) => ({ ...w, startMs: Math.min(w.startMs, fixed.startMs), endMs: Math.min(w.endMs, fixed.startMs) })) ?? null,
      locked: false,
    });
  }

  const revisions: NewRevision[] = [];
  for (const [k, span] of changed) {
    const p = view.paragraphs[k]!;
    const current = (await catalog.get(p.span!))!.data as unknown as SpanData;
    const { words: _w, ...rest } = current;
    revisions.push({
      id: p.span!,
      type: 'alignment-span',
      data: {
        ...rest,
        startMs: span.startMs,
        endMs: Math.max(span.startMs, span.endMs),
        ...(span.words ? { words: span.words } : {}),
        ...(k === i ? { locked: true, ...(current.origin ? { origin: { ...current.origin, checked: true } } : {}) } : {}),
      } as unknown as Json,
    });
  }
  const spans = [...changed.entries()].sort((a, b) => a[0] - b[0]).map(([k, s]) => ({ segment: view.paragraphs[k]!.id, ...s, endMs: Math.max(s.startMs, s.endMs) }));
  if (open && (await catalog.amend(open.id, by, revisions))) return { ...(await catalog.changeset(open.id)), spans };
  const suggestion = await catalog.createChangeset(by, { title: SYNC_TITLE });
  for (const revision of revisions) await catalog.putRevision(suggestion.id, by, revision);
  return { ...(await catalog.submit(suggestion.id, by)), spans };
}

/**
 * "The sync is right": a listener who has heard the recording through
 * with its transcript marks every paragraph's sync checked. Sync projects
 * count a recording done when all of it is.
 */
export async function confirmSync(catalog: Catalog, by: string, input: { recording: EntityId }): Promise<ChangesetRow> {
  const view = await recordingTranscript(catalog, input.recording);
  if (!view?.alignment) throw notFound(`a sync of ${input.recording}`);
  const open = view.paragraphs.filter((p) => p.span && !p.syncChecked);
  if (!open.length) throw invalid('every paragraph of this sync is checked already');
  const suggestion = await catalog.createChangeset(by, { title: 'בדיקת סנכרון' });
  for (const p of open) {
    const current = (await catalog.get(p.span!))!.data as unknown as SpanData;
    await catalog.putRevision(suggestion.id, by, {
      id: p.span!,
      type: 'alignment-span',
      data: { ...current, origin: { ...(current.origin ?? { by }), checked: true } } as unknown as Json,
    });
  }
  return catalog.submit(suggestion.id, by);
}

/** The hanacha of a recording's farbrengen, when the catalog has its text: kind `hanacha`, of the recording, of a unit of its event, or "based on" its event (a hanacha added for the farbrengen as a whole). */
export async function hanachaOf(catalog: Catalog, recording: EntityId): Promise<EntityId | null> {
  return (await hanachaOfEach(catalog, [recording])).get(recording) ?? null;
}

/** The same for several recordings (a farbrengen's parts) in one statement: by recording, only those with one. */
async function hanachaOfEach(catalog: Catalog, recordings: readonly EntityId[]): Promise<Map<EntityId, EntityId>> {
  if (recordings.length === 0) return new Map();
  const { rows } = await catalog.db.query<{ recording: EntityId; text: EntityId }>(
    `SELECT DISTINCT ON (want.id) want.id AS recording, t.id AS text
     FROM unnest($1::text[]) AS want (id)
     LEFT JOIN entity rec ON rec.id = want.id LEFT JOIN revision rr ON rr.id = rec.main_rev
     JOIN entity t ON t.type = 'text' AND NOT t.deleted JOIN revision tr ON tr.id = t.main_rev AND tr.data->>'kind' = 'hanacha'
     WHERE tr.data->>'recording' = want.id
       OR (rr.data->>'event' IS NOT NULL AND EXISTS (
         SELECT 1 FROM entity u JOIN revision ur ON ur.id = u.main_rev WHERE u.id = tr.data->>'unit' AND ur.data->'events' ? (rr.data->>'event')))
       OR EXISTS (
         SELECT 1 FROM entity_ref a JOIN entity rel ON rel.id = a.from_id AND rel.type = 'relation' AND NOT rel.deleted JOIN revision rlr ON rlr.id = rel.main_rev
         WHERE a.to_id = t.id AND a.field = 'from' AND rlr.data->>'kind' = 'based-on' AND rlr.data->>'to' = rr.data->>'event')
     ORDER BY want.id, t.id`,
    [[...new Set(recordings)]],
  );
  return new Map(rows.map((r) => [r.recording, r.text]));
}

/** A hanacha's paragraphs, each with where it is heard in a recording (a paragraph-level alignment), or null when there is none. */
export type HanachaSync = { text: EntityId; alignment: EntityId; paragraphs: Array<{ id: EntityId; content: string; startMs: number | null; endMs: number | null; checked: boolean }> };

export async function hanachaSync(catalog: Catalog, recording: EntityId): Promise<HanachaSync | null> {
  return (await hanachaSyncs(catalog, [recording])).get(recording) ?? null;
}

/**
 * The same for several recordings at once, by recording, only those with a
 * synced hanacha: a farbrengen's page asks about all its parts in one
 * request (and two statements, plus one per sync found) where it used to
 * ask about each part.
 */
export async function hanachaSyncs(catalog: Catalog, recordings: readonly EntityId[]): Promise<Map<EntityId, HanachaSync>> {
  const out = new Map<EntityId, HanachaSync>();
  const texts = await hanachaOfEach(catalog, recordings);
  if (texts.size === 0) return out;
  // The alignment of each (text, recording) pair, the lowest id when there are several.
  const { rows: alignments } = await catalog.db.query<{ text: EntityId; recording: EntityId; id: EntityId }>(
    `SELECT DISTINCT ON (x.to_id, ar.data->>'recording') x.to_id AS text, ar.data->>'recording' AS recording, a.id
     FROM entity_ref x JOIN entity a ON a.id = x.from_id AND a.type = 'alignment' AND NOT a.deleted
     JOIN revision ar ON ar.id = a.main_rev WHERE x.to_id = ANY($1::text[]) AND x.field = 'text' AND ar.data->>'recording' = ANY($2::text[])
     ORDER BY x.to_id, ar.data->>'recording', a.id`,
    [[...new Set(texts.values())], [...texts.keys()]],
  );
  const alignmentOf = new Map(alignments.map((a) => [`${a.text} ${a.recording}`, a.id]));
  for (const [recording, text] of texts) {
    const alignment = alignmentOf.get(`${text} ${recording}`);
    if (!alignment) continue;
    const { rows } = await catalog.db.query<{ id: EntityId; content: string; order: string; sd: SpanData | null }>(
      `SELECT s.id, sr.data->>'content' AS content, sr.data->>'order' AS "order", sp.data AS sd
       FROM entity_ref x JOIN entity s ON s.id = x.from_id AND s.type = 'segment' AND NOT s.deleted JOIN revision sr ON sr.id = s.main_rev
       LEFT JOIN LATERAL (
         SELECT spr.data FROM entity_ref y JOIN entity e ON e.id = y.from_id AND e.type = 'alignment-span' AND NOT e.deleted JOIN revision spr ON spr.id = e.main_rev
         WHERE y.to_id = s.id AND y.field = 'segment' AND spr.data->>'alignment' = $2 LIMIT 1
       ) sp ON TRUE
       WHERE x.to_id = $1 AND x.field = 'text'`,
      [text, alignment],
    );
    rows.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
    out.set(recording, {
      text,
      alignment,
      paragraphs: rows.map((r) => ({ id: r.id, content: r.content, startMs: r.sd ? r.sd.startMs : null, endMs: r.sd ? r.sd.endMs : null, checked: Boolean(r.sd?.locked || r.sd?.origin?.checked) })),
    });
  }
  return out;
}

/** One change to a transcript: a paragraph's words, its check, or where it is heard. */
export interface TranscriptChange {
  segment: EntityId;
  /** words: its words changed; checked: a person checked them as they were; sync: where it is heard moved; made: the machine made it. */
  kind: 'words' | 'checked' | 'sync' | 'made';
  before?: string;
  after?: string;
  /** For words: whether the person checked the whole paragraph, or fixed only some of it. */
  complete?: boolean;
}

export interface TranscriptCommit {
  commit: number;
  at: string;
  author: string;
  authorName: string | null;
  authorIsBot: boolean;
  /** The suggestion it came in (`/suggestions/{number}`), when it has a number. */
  suggestion: number | null;
  changes: TranscriptChange[];
}

/**
 * Everything that happened to a recording's transcript, newest first, in
 * one read: each approved change with who made it and what it changed,
 * paragraph by paragraph (the full changelog of the editor). The machine's
 * first hearing is one entry, however many paragraphs it made.
 */
export async function transcriptHistory(catalog: Catalog, recording: EntityId, options: { limit?: number } = {}): Promise<TranscriptCommit[] | null> {
  const text = await one<{ id: EntityId }>(
    catalog.db,
    `SELECT t.id FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted
     JOIN revision tr ON tr.id = t.main_rev WHERE x.to_id = $1 AND x.field = 'recording' AND tr.data->>'kind' = 'transcript' ORDER BY t.id LIMIT 1`,
    [recording],
  );
  if (!text) return null;
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const { rows } = await catalog.db.query<{
    seq: string;
    at: string | Date;
    author: string;
    author_name: string | null;
    is_bot: boolean | null;
    number: number | null;
    entity_id: EntityId;
    type: string;
    data: Record<string, unknown> | null;
    prev: Record<string, unknown> | null;
  }>(
    `WITH segs AS (SELECT from_id AS id FROM entity_ref WHERE to_id = $1 AND field = 'text'),
          spans AS (SELECT y.from_id AS id FROM entity_ref y JOIN segs ON segs.id = y.to_id WHERE y.field = 'segment'),
          picked AS (
            SELECT DISTINCT cc.commit_seq FROM commit_change cc
            WHERE cc.entity_id IN (SELECT id FROM segs UNION ALL SELECT id FROM spans)
            ORDER BY cc.commit_seq DESC LIMIT ${limit}
          )
     SELECT c.seq::text AS seq, c.at, r.author, a.display_name AS author_name, a.is_bot, cs.number, cc.entity_id, e.type, r.data, p.data AS prev
     FROM picked JOIN commit c ON c.seq = picked.commit_seq
     JOIN commit_change cc ON cc.commit_seq = c.seq
     JOIN entity e ON e.id = cc.entity_id AND e.type IN ('segment', 'alignment-span')
     JOIN revision r ON r.id = cc.rev_id
     LEFT JOIN revision p ON p.id = cc.prev_rev_id
     LEFT JOIN account a ON a.id = r.author
     LEFT JOIN changeset cs ON cs.id = c.changeset_id
     WHERE cc.entity_id IN (SELECT id FROM segs UNION ALL SELECT id FROM spans)
     ORDER BY c.seq DESC, cc.entity_id`,
    [text.id],
  );
  const commits = new Map<string, TranscriptCommit>();
  for (const r of rows) {
    let commit = commits.get(r.seq);
    if (!commit) {
      commit = { commit: Number(r.seq), at: new Date(r.at).toISOString(), author: r.author, authorName: r.author_name, authorIsBot: Boolean(r.is_bot), suggestion: r.number ?? null, changes: [] };
      commits.set(r.seq, commit);
    }
    const d = r.data ?? {};
    const p = r.prev;
    if (r.type === 'segment') {
      const origin = (d.origin ?? {}) as { checked?: boolean; edited?: boolean };
      const complete = Number(d.proofread ?? 0) > 0 || Boolean(origin.checked);
      if (!p) commit.changes.push({ segment: r.entity_id, kind: 'made', after: String(d.content ?? '') });
      else if (p.content !== d.content) commit.changes.push({ segment: r.entity_id, kind: 'words', before: String(p.content ?? ''), after: String(d.content ?? ''), complete });
      else if (complete) commit.changes.push({ segment: r.entity_id, kind: 'checked' });
    } else {
      const segment = String(d.segment ?? p?.segment ?? '') as EntityId;
      if (p && (p.startMs !== d.startMs || Boolean(p.locked) !== Boolean(d.locked))) commit.changes.push({ segment, kind: 'sync', before: String(p.startMs ?? ''), after: String(d.startMs ?? '') });
    }
  }
  return [...commits.values()].filter((c) => c.changes.length);
}

/** A fix of a transcript's paragraph that is still waiting for approval (an open Suggestion). */
export interface TranscriptPending {
  segment: EntityId;
  /** The paragraph as the fix would make it, and whether the person checked all of it. */
  content: string;
  complete: boolean;
  author: string;
  authorName: string | null;
  at: string;
  /** The Suggestion (`/suggestions/{number}`). */
  suggestion: number | null;
}

/**
 * Word fixes of a transcript that are waiting for approval, a Suggestion's
 * together and in the transcript's order: what a listener sent and does
 * not see on the site yet, and what others sent, so the editor shows the
 * words as they will be and says who is waiting. One read, by the text's
 * own index. Sync is left out: people check words, not timing.
 */
export async function transcriptPending(catalog: Catalog, view: Pick<TranscriptView, 'text' | 'paragraphs'>): Promise<TranscriptPending[]> {
  const { rows } = await catalog.db.query<{ entity_id: EntityId; data: Record<string, unknown> | null; author: string; author_name: string | null; at: string | Date; number: number | string | null }>(
    `SELECT DISTINCT ON (cs.id, r.entity_id) r.entity_id, r.data, cs.author, a.display_name AS author_name,
            coalesce(cs.submitted_at, cs.created_at) AS at, cs.number
     FROM revision r JOIN changeset cs ON cs.id = r.changeset_id AND cs.status IN ('open', 'sent_back')
     LEFT JOIN account a ON a.id = cs.author
     WHERE r.entity_type = 'segment' AND r.data->>'text' = $1
     ORDER BY cs.id, r.entity_id, r.id DESC`,
    [view.text],
  );
  const now = new Map(view.paragraphs.map((p) => [p.id, p]));
  const out: TranscriptPending[] = [];
  for (const r of rows) {
    const d = r.data ?? {};
    const p = now.get(r.entity_id);
    // Only a change of words is shown; a check alone changes nothing a reader sees.
    if (!p || typeof d.content !== 'string' || d.content === p.content) continue;
    const origin = (d.origin ?? {}) as { checked?: boolean };
    out.push({
      segment: r.entity_id,
      content: d.content,
      complete: Number(d.proofread ?? 0) > 0 || Boolean(origin.checked),
      author: r.author,
      authorName: r.author_name,
      at: new Date(r.at).toISOString(),
      suggestion: r.number !== null ? Number(r.number) : null,
    });
  }
  const at = new Map(view.paragraphs.map((p, i) => [p.id, i]));
  return out.sort((a, b) => (a.suggestion ?? 0) - (b.suggestion ?? 0) || at.get(a.segment)! - at.get(b.segment)!);
}
