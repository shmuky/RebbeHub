import { recordingTranscript, type Catalog, type Json, type WordTiming } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { TRANSCRIBE_BOT } from './transcribe.js';

/**
 * Words cut in two between paragraphs of a machine transcript. Whisper
 * sometimes ends a piece in the middle of a word, and transcripts made
 * before `paragraphs()` knew it (transcribe.ts, `glued`) may break a
 * paragraph there: one ends "... יראה פון דעם י", the next starts "וד, און
 * ...". The old transcripts no longer say where Whisper put its spaces, so
 * a cut is found from the words themselves, and only when the evidence is
 * strong: a wrong join makes a word nobody said, which is worse than
 * leaving a cut a person will see and fix.
 *
 * On a sample of 243 transcripts on rebbehub.org (3,403 paragraph
 * breaks), this mends 3 (`י|וד`, `ער|וואקסענע`, `ו|אויך`) and nothing
 * else; looser rules (any lone letter, or a gap of 0 ms, which almost
 * every break has) joined many more, most of them wrongly.
 */

/** How often each word, and each pair of words side by side, is written in the transcripts: what a word looks like. */
export interface Vocabulary {
  words: Map<string, number>;
  pairs: Set<string>;
}

/** A paragraph of a transcript, as recordingTranscript gives it. */
export interface SplitParagraph {
  content: string;
  words?: WordTiming[] | null;
  startMs?: number | null;
  endMs?: number | null;
  /** A person checked or fixed its words or its sync: it is never changed. */
  fixed?: boolean;
}

/** A cut mended: the paragraph at `at` now ends with `word`, which the next paragraph used to start with the rest of. */
export interface WordSplit {
  at: number;
  word: string;
}

/**
 * A word as it is compared here: no niqqud or quote marks (`יו"ד` is
 * `יוד`), no punctuation at its ends, final letters as ordinary ones. A
 * hyphen inside is kept, so `מסורת-נפש` is not taken for `מסורתנפש`.
 */
export function splitKey(word: string): string {
  return word
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳״"'`‘’“”]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[ךםןףץ]/g, (ch) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[ch] ?? ch);
}

/** The words of many transcripts' paragraphs, counted, and the pairs written side by side within a paragraph. */
export function vocabulary(texts: Iterable<string>): Vocabulary {
  const words = new Map<string, number>();
  const pairs = new Set<string>();
  for (const text of texts) {
    const keys = text.split(/\s+/).map(splitKey).filter(Boolean);
    keys.forEach((k, i) => {
      words.set(k, (words.get(k) ?? 0) + 1);
      if (i > 0) pairs.add(`${keys[i - 1]} ${k}`);
    });
  }
  return { words, pairs };
}

const HEBREW_END = /[א-ת]$/;
const HEBREW_START = /^[א-ת]/;
/** A word of one letter: in Yiddish only `א` stands alone; any other is a piece of a word. */
const lone = (key: string) => key.length === 1 && /[א-ת]/.test(key) && key !== 'א';

/**
 * Finds the paragraph breaks that cut a word, and mends each by moving the
 * piece that starts the next paragraph onto the end of the one before,
 * with no space; the joined word is heard from the start of its first
 * half to the end of its second, and the next paragraph's word offsets
 * move back to fit. A break is taken for a cut only when all of these hold:
 *
 * - neither paragraph was checked or fixed by a person;
 * - the first ends in a letter (no punctuation) and the next starts with one,
 *   and the next has more words than the piece;
 * - when both are timed word by word, the two halves are heard back to back;
 * - the transcript is not one of the garbled ones where Whisper wrote many
 *   words as lone letters (more than one word in a hundred, and more than three);
 * - neither half is `א`, the one letter that is a word by itself;
 * - the joined word is written, whole, at least twice in the transcripts
 *   (`vocab`), and the two halves are never written side by side;
 * - and one half is not a word in its own right: a lone letter, or written
 *   whole less often than the joined word.
 *
 * Returns the paragraphs as mended (the same objects where nothing
 * changed) and the cuts mended.
 */
export function mendWordSplits<P extends SplitParagraph>(paragraphs: readonly P[], vocab: Vocabulary, options: { gapMs?: number } = {}): { paragraphs: P[]; mended: WordSplit[] } {
  const gapMs = options.gapMs ?? 40;
  const out = [...paragraphs];
  const mended: WordSplit[] = [];
  const all = paragraphs.flatMap((p) => p.content.split(/\s+/).map(splitKey).filter(Boolean));
  if (all.filter(lone).length > Math.max(3, all.length / 100)) return { paragraphs: out, mended };
  const count = (key: string) => vocab.words.get(key) ?? 0;
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (a.fixed || b.fixed) continue;
    const before = a.content.trimEnd();
    const lead = b.content.length - b.content.trimStart().length;
    const firstEnd = b.content.slice(lead).search(/\s|$/) + lead;
    const piece = b.content.slice(lead, firstEnd);
    const rest = b.content.slice(firstEnd).trimStart();
    if (!HEBREW_END.test(before) || !HEBREW_START.test(piece) || !rest) continue;
    const last = before.slice(before.search(/\S+$/));
    const aw = a.words?.length ? a.words : null;
    const bw = b.words?.length ? b.words : null;
    if (aw && bw && Math.abs(bw[0]!.startMs - aw.at(-1)!.endMs) > gapMs) continue;
    const [kl, kf] = [splitKey(last), splitKey(piece)];
    const joined = kl + kf;
    if (!kl || !kf || kl === 'א' || kf === 'א') continue;
    if (count(joined) < 2 || vocab.pairs.has(`${kl} ${kf}`)) continue;
    if (!(lone(kl) || lone(kf) || count(kl) < count(joined) || count(kf) < count(joined))) continue;

    const content = `${before}${piece}`;
    const next = b.content.length - rest.length;
    // Word timings move with the words, when they line up with the words as written; else they are let go, and the next sync times them again.
    const lined = aw && bw && aw.at(-1)!.to === before.length && bw[0]!.from === lead && bw[0]!.to === firstEnd && bw.slice(1).every((w) => w.from >= next);
    const aWords = lined ? [...aw.slice(0, -1), { ...aw.at(-1)!, to: content.length, endMs: Math.max(aw.at(-1)!.endMs, bw[0]!.endMs) }] : null;
    const bWords = lined ? bw.slice(1).map((w) => ({ ...w, from: w.from - next, to: w.to - next })) : null;
    out[i] = {
      ...a,
      content,
      words: aWords,
      ...(a.endMs != null && bw ? { endMs: Math.max(a.endMs, bw[0]!.endMs) } : {}),
    };
    out[i + 1] = {
      ...b,
      content: rest,
      words: bWords,
      ...(b.startMs != null && bWords?.length ? { startMs: bWords[0]!.startMs } : {}),
    };
    mended.push({ at: i, word: `${last}${piece}` });
  }
  return { paragraphs: out, mended };
}

/**
 * Mends the words cut in two between paragraphs of the machine transcripts
 * already in the catalog (mendWordSplits), one suggestion by the
 * transcription bot per recording, approved by `approveAs`. Only
 * paragraphs no person has touched are changed: not checked, not fixed,
 * not written by a person, and not synced by one. With `dryRun`, it only
 * says what it would mend.
 */
export async function mendTranscriptSplits(
  catalog: Catalog,
  input: { approveAs: string; recording?: EntityId; limit?: number; dryRun?: boolean; log?: (line: string) => void },
): Promise<Array<{ recording: EntityId; mended: WordSplit[] }>> {
  const log = input.log ?? (() => {});
  const transcripts = `FROM entity t JOIN revision tr ON tr.id = t.main_rev
     JOIN entity_ref x ON x.to_id = t.id AND x.field = 'text' JOIN entity s ON s.id = x.from_id AND s.type = 'segment' AND NOT s.deleted
     JOIN revision sr ON sr.id = s.main_rev
     WHERE t.type = 'text' AND NOT t.deleted AND tr.data->>'kind' = 'transcript'`;
  const { rows: texts } = await catalog.db.query<{ content: string }>(`SELECT sr.data->>'content' AS content ${transcripts}`);
  const vocab = vocabulary(texts.map((r) => r.content ?? ''));
  const params: unknown[] = [];
  const only = input.recording ? `AND tr.data->>'recording' = $${params.push(input.recording)}` : '';
  const { rows: recordings } = await catalog.db.query<{ id: EntityId }>(
    `SELECT DISTINCT tr.data->>'recording' AS id FROM entity t JOIN revision tr ON tr.id = t.main_rev
     WHERE t.type = 'text' AND NOT t.deleted AND tr.data->>'kind' = 'transcript' ${only} ORDER BY 1`,
    params,
  );
  if (!input.dryRun) await catalog.createAccount({ id: TRANSCRIBE_BOT, displayName: 'Machine transcription', isBot: true });
  const done: Array<{ recording: EntityId; mended: WordSplit[] }> = [];
  for (const { id } of recordings) {
    if (input.limit !== undefined && done.length >= input.limit) break;
    const view = await recordingTranscript(catalog, id);
    if (!view) continue;
    // Paragraphs whose words a person wrote, even without marking them checked.
    const { rows: byPeople } = await catalog.db.query<{ id: EntityId }>(
      `SELECT s.id FROM entity s JOIN revision r ON r.id = s.main_rev JOIN account a ON a.id = r.author WHERE s.id = ANY($1) AND NOT a.is_bot`,
      [view.paragraphs.map((p) => p.id)],
    );
    const people = new Set(byPeople.map((r) => r.id));
    const { paragraphs, mended } = mendWordSplits(
      view.paragraphs.map((p) => ({ ...p, fixed: p.checked || p.locked || p.syncChecked || people.has(p.id) })),
      vocab,
    );
    if (!mended.length) continue;
    for (const m of mended) log(`${id}: ${view.paragraphs[m.at]!.content.slice(-30)} | ${view.paragraphs[m.at + 1]!.content.slice(0, 30)} -> ${m.word}`);
    done.push({ recording: id, mended });
    if (input.dryRun) continue;

    const suggestion = await catalog.createChangeset(TRANSCRIBE_BOT, { title: `Words cut between paragraphs of the machine transcript of ${id}, joined` });
    for (const [i, p] of paragraphs.entries()) {
      const was = view.paragraphs[i]!;
      if (p.content === was.content) continue;
      const segment = (await catalog.get(was.id))!;
      await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, { id: segment.id, type: 'segment', data: { ...(segment.data as Record<string, Json>), content: p.content } });
      if (!was.span) continue;
      const span = (await catalog.get(was.span))!;
      const { words: _old, ...rest } = span.data as Record<string, Json>;
      await catalog.putRevision(suggestion.id, TRANSCRIBE_BOT, {
        id: span.id,
        type: 'alignment-span',
        data: { ...rest, ...(p.startMs != null ? { startMs: p.startMs } : {}), ...(p.endMs != null ? { endMs: p.endMs } : {}), ...(p.words ? { words: p.words as unknown as Json } : {}) },
      });
    }
    await catalog.submit(suggestion.id, TRANSCRIBE_BOT);
    await catalog.merge(suggestion.id, input.approveAs, {}, 'Machine transcript, labelled as such until checked');
  }
  return done;
}
