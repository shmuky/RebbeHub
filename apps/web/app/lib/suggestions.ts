import type { SuggestionDetail, SuggestionEntry } from './api.js';
import type { Lang } from './i18n.js';
import { wordDiff, type DiffPart } from './wordDiff.js';
import type { LabelTone } from '../ui/primitives.js';

/**
 * How suggestions and reports are shown in lists and feeds: what kind of
 * change each is (its labels), the words it changes, and its state, in
 * the plan's words. Shared by the home feed, the suggestions list, a
 * suggestion's page and the reports list.
 */

export interface LabelInfo {
  key: string;
  tone: LabelTone;
  he: string;
  en: string;
}

export const LABELS: Record<string, LabelInfo> = {
  text: { key: 'text', tone: 'text', he: 'טקסט', en: 'Text' },
  source: { key: 'source', tone: 'source', he: 'מראה מקום', en: 'Source' },
  scan: { key: 'scan', tone: 'scan', he: 'סריקה', en: 'Scan' },
  date: { key: 'date', tone: 'date', he: 'תאריך', en: 'Date' },
  meta: { key: 'meta', tone: 'meta', he: 'מטא־דאטה', en: 'Metadata' },
  audio: { key: 'audio', tone: 'audio', he: 'הקלטה', en: 'Recording' },
  translation: { key: 'translation', tone: 'translation', he: 'תרגום', en: 'Translation' },
  sync: { key: 'sync', tone: 'sync', he: 'סנכרון', en: 'Sync' },
  printing: { key: 'printing', tone: 'source', he: 'הדפסה', en: 'Printing' },
  rights: { key: 'rights', tone: 'meta', he: 'זכויות', en: 'Rights' },
  duplicate: { key: 'duplicate', tone: 'meta', he: 'כפילות', en: 'Duplicate' },
};

/** The labels a report carries, by its reason. */
export const REPORT_LABEL: Record<string, string> = {
  'wrong-fact': 'date',
  'missing-page': 'scan',
  'bad-scan': 'scan',
  'audio-problem': 'audio',
  'wrong-text': 'text',
  duplicate: 'duplicate',
  rights: 'rights',
  other: 'meta',
};

/** A verse's place ("בראשית ו, ט"), whose change makes a suggestion a source fix too. */
const SOURCE_REF = /\((?:[^()]*?\s)?[א-ת]{1,3}["״׳']?[א-ת]?,\s*[א-ת]{1,3}["״׳']?[א-ת]?\)/;

/** What kind of change an entry is, as labels. */
export function entryLabels(entry: SuggestionEntry): string[] {
  const out = new Set<string>();
  if (entry.before === null) {
    if (entry.type === 'publication' || entry.type === 'scan') out.add('printing');
    else if (entry.type === 'recording') out.add('audio');
    else if (entry.type === 'text' || entry.type === 'segment') out.add('text');
    else out.add('meta');
  }
  for (const c of entry.changes) {
    if (/date/i.test(c.path)) out.add('date');
    else if (entry.type === 'segment' || /content|body/.test(c.path)) {
      out.add('text');
      if (typeof c.before === 'string' && typeof c.after === 'string' && SOURCE_REF.test(c.after) && c.before.match(SOURCE_REF)?.[0] !== c.after.match(SOURCE_REF)?.[0]) out.add('source');
    } else if (entry.type === 'recording' || entry.type === 'alignment') out.add(entry.type === 'alignment' ? 'sync' : 'audio');
    else if (entry.type === 'text' && /translation/.test(String(entry.after?.kind))) out.add('translation');
    else out.add('meta');
  }
  return [...out];
}

export function detailLabels(detail: Pick<SuggestionDetail, 'entries'>): string[] {
  return [...new Set(detail.entries.flatMap(entryLabels))];
}

/** The first change of words in a suggestion, with the field it is in. */
export function firstTextChange(detail: Pick<SuggestionDetail, 'entries'>): { entry: SuggestionEntry; path: string; before: string; after: string } | null {
  for (const entry of detail.entries)
    for (const c of entry.changes)
      if (typeof c.before === 'string' && typeof c.after === 'string' && c.before !== c.after) return { entry, path: c.path, before: c.before, after: c.after };
  return null;
}

/** A change's words with only a few kept on either side of what changed, for a feed: "…היה <del>בדורו</del> <ins>בדורותיו</ins>״…". */
export function excerpt(parts: DiffPart[], around = 6): DiffPart[] {
  const out: DiffPart[] = [];
  parts.forEach((p, i) => {
    if (p.kind !== 'same') return void out.push(p);
    const words = p.text.split(/(\s+)/);
    const first = i === 0;
    const last = i === parts.length - 1;
    const keep = around * 2;
    if (words.length <= keep * 2 + 1 || (!first && !last && words.length <= keep * 4)) return void out.push(p);
    if (first) out.push({ kind: 'same', text: `…${words.slice(-keep).join('')}` });
    else if (last) out.push({ kind: 'same', text: `${words.slice(0, keep).join('')}…` });
    else out.push({ kind: 'same', text: `${words.slice(0, keep).join('')} … ${words.slice(-keep).join('')}` });
  });
  return out;
}

export function changeExcerpt(detail: Pick<SuggestionDetail, 'entries'>, around = 6): DiffPart[] | null {
  const change = firstTextChange(detail);
  return change ? excerpt(wordDiff(change.before, change.after), around) : null;
}

/** How many words a suggestion changes, over all its text. */
export function wordsChanged(detail: Pick<SuggestionDetail, 'entries'>): number {
  let n = 0;
  for (const entry of detail.entries)
    for (const c of entry.changes)
      if (typeof c.before === 'string' && typeof c.after === 'string') n += wordDiff(c.before, c.after).filter((p) => p.kind === 'ins').reduce((s, p) => s + (p.text.match(/[\p{L}\p{N}]+/gu) ?? []).length, 0);
  return n;
}

export type SuggestionState = 'open' | 'approved' | 'closed' | 'draft';

/** A suggestion's state as a badge says it: open, approved (merged), closed (sent back, withdrawn) or a draft. */
export function stateOf(status: string): SuggestionState {
  if (status === 'open') return 'open';
  if (status === 'merged') return 'approved';
  if (status === 'draft') return 'draft';
  return 'closed';
}

export const STATE_WORDS: Record<string, { he: string; en: string }> = {
  open: { he: 'פתוחה', en: 'Open' },
  merged: { he: 'אושרה', en: 'Approved' },
  sent_back: { he: 'הוחזרה', en: 'Sent back' },
  withdrawn: { he: 'בוטלה', en: 'Withdrawn' },
  draft: { he: 'טיוטה', en: 'Draft' },
  live: { he: 'חיה, ממתינה לבדיקה', en: 'Live, awaiting review' },
};

export const stateWord = (status: string, lang: Lang) => STATE_WORDS[status]?.[lang] ?? status;
