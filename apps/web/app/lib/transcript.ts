import { wordDiff } from './wordDiff.js';

/**
 * A recording's transcript as the API gives it (GET
 * /v1/recordings/{id}/transcript), shared by the listening view and the
 * editor (components/Transcripts.tsx, components/TranscriptEditor.tsx).
 */

export interface Word {
  from: number;
  to: number;
  startMs: number;
  endMs: number;
}

export interface Paragraph {
  id: string;
  content: string;
  startMs: number | null;
  endMs: number | null;
  words?: Word[] | null;
  locked?: boolean;
  checked: boolean;
  /** A person fixed some of its words without checking all of it: still the machine's. */
  edited?: boolean;
  syncChecked?: boolean;
}

/** A fix of a paragraph's words sent and not yet approved: the paragraph as it will be once it is. */
export interface Pending {
  segment: string;
  content: string;
  complete: boolean;
  author: string;
  authorName: string | null;
  at: string;
  suggestion: number | null;
}

export interface Transcript {
  recording: string;
  language: string;
  alignment?: string | null;
  paragraphs: Paragraph[];
  /** Word fixes waiting for approval, so the words show as they will be and who is waiting. */
  pending?: Pending[];
}

/**
 * Where in a paragraph a waiting fix changes it: the words it takes out,
 * and for words it only adds, the word beside them. Those words are marked
 * in the text until the fix is approved or sent back.
 */
export function pendingRanges(content: string, after: string): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let at = 0;
  for (const part of wordDiff(content, after)) {
    if (part.kind === 'ins') out.push({ from: Math.max(0, at - 1), to: Math.min(content.length, at + 1) });
    else {
      if (part.kind === 'del') out.push({ from: at, to: at + part.text.length });
      at += part.text.length;
    }
  }
  return out;
}

/** A paragraph's sync as a fix left it (POST …/sync/anchor answers with the spans as they now stand). */
export type Span = { segment: string; startMs: number; endMs: number; words: Word[] | null; locked: boolean };

/** One change in a transcript's changelog (GET …/transcript/history). */
export interface TranscriptChange {
  segment: string;
  kind: 'words' | 'checked' | 'sync' | 'made';
  before?: string;
  after?: string;
  complete?: boolean;
}

export interface TranscriptCommit {
  commit: number;
  at: string;
  author: string;
  authorName: string | null;
  authorIsBot: boolean;
  suggestion: number | null;
  changes: TranscriptChange[];
}

/** Reads from the API through the site (the steward pass keeps the visitor's session). */
export async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

export const within = (nowMs: number, p: { startMs: number | null; endMs: number | null }) => p.startMs !== null && p.endMs !== null && nowMs >= p.startMs && nowMs < p.endMs;

/**
 * A paragraph's words with where each sits in its text, and when it is
 * said where the sync is word by word. Without word timings, the words are
 * found by their spaces, and know no moment of their own.
 */
export function tokensOf(p: Paragraph): Array<{ from: number; to: number; ms: number | null }> {
  if (p.words?.length) return p.words.map((w) => ({ from: w.from, to: w.to, ms: w.startMs }));
  return [...p.content.matchAll(/\S+/g)].map((m) => ({ from: m.index!, to: m.index! + m[0].length, ms: null }));
}

/** A selection widened to whole words, so a fix never cuts one in two. */
export function wholeWords(content: string, from: number, to: number): { from: number; to: number } {
  let a = Math.max(0, Math.min(from, to));
  let b = Math.min(content.length, Math.max(from, to));
  while (a > 0 && !/\s/.test(content[a - 1]!)) a--;
  while (b < content.length && !/\s/.test(content[b]!)) b++;
  while (a < b && /\s/.test(content[a]!)) a++;
  while (b > a && /\s/.test(content[b - 1]!)) b--;
  return { from: a, to: b };
}
