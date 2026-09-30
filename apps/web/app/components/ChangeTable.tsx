import { inlineText, isPageText, pageTextPlain, type PageInline } from '@rebbehub/model';
import { dateLabel } from '../lib/dates.js';
import { t, type Lang } from '../lib/i18n.js';

/**
 * A change as people read it (the plan: nobody ever sees JSON or a raw
 * field diff): each field by its name, what it was, and what it became; a
 * date as a date. Used by the review page and by History.
 */

const FIELD_KEYS: Record<string, 'date' | 'nameHe' | 'nameEn' | 'dateEnd'> = {
  '/date': 'date',
  '/dateEnd': 'dateEnd',
  '/title/he': 'nameHe',
  '/title/en': 'nameEn',
  '/name/he': 'nameHe',
  '/name/en': 'nameEn',
  '/label/he': 'nameHe',
  '/label/en': 'nameEn',
};

const WORDS_FIELD = { he: 'טקסט', en: 'Words' } as const;
const SEGMENT_FIELDS = new Set(['versions', 'segments', 'notes', 'children', 'text', 'n', 'label', 'kind', 'level', 'end', 'origin']);

/** A field's name as people say it; a page's words by version and segment (`Words › he › 14.3`). */
export const fieldName = (path: string, lang: Lang) => {
  if (FIELD_KEYS[path]) return t(lang, FIELD_KEYS[path]!);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'body') {
    const [, , version, ...rest] = parts;
    const segment = rest.filter((p) => !SEGMENT_FIELDS.has(p)).pop();
    return [WORDS_FIELD[lang], version, segment].filter(Boolean).join(' › ');
  }
  return parts.join(' › ');
};

const isRuns = (value: unknown): value is PageInline[] => Array.isArray(value) && value.every((r) => r && typeof r === 'object' && ('text' in r || 'br' in r || 'note' in r || 'marker' in r));

/** A value as people read it: a date in words, text as it is, a page's words as words; anything else only as "changed". */
export function valueText(path: string, value: unknown, lang: Lang): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string' && /date/i.test(path)) return dateLabel(value, lang, { civil: false });
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isRuns(value)) return inlineText(value) || '—';
  if (isPageText(value)) {
    const words = pageTextPlain(value);
    return words.length > 300 ? `${words.slice(0, 300)}…` : words || '—';
  }
  if (typeof value === 'object' && isRuns((value as { text?: unknown }).text)) return inlineText((value as { text: PageInline[] }).text) || '—';
  return t(lang, 'changedValue');
}

/**
 * A bot's change of many alike fields (a recording's word timings, each
 * word's start and end) as a few rows, not thousands: the fields that differ
 * only by their place in a list are one row, with how many there are, the
 * first of them as the example, and by how much they all moved when they all
 * moved alike. A page of every one of them said nothing more and stopped
 * phones (Shmuly, 30 Tishrei). At most `limit` rows; the rest are counted.
 */
export interface FoldedChange {
  path: string;
  before?: unknown;
  after?: unknown;
  /** How many alike changes this row stands for (1 when it is one change). */
  count: number;
  /** When every one of them is a number moved by the same amount: that amount. */
  shift?: number;
}

const FOLD_AT = 4;

export function foldChanges(changes: ReadonlyArray<{ path: string; before?: unknown; after?: unknown }>, limit = 30): { rows: FoldedChange[]; hidden: number } {
  const groups = new Map<string, Array<{ path: string; before?: unknown; after?: unknown }>>();
  for (const c of changes) {
    const pattern = c.path.replace(/\/\d+(?=\/|$)/g, '/*');
    const group = groups.get(pattern);
    if (group) group.push(c);
    else groups.set(pattern, [c]);
  }
  const rows: FoldedChange[] = [];
  for (const [pattern, group] of groups) {
    if (group.length < FOLD_AT || pattern === group[0]!.path) {
      for (const c of group) rows.push({ ...c, count: 1 });
      continue;
    }
    const first = group[0]!;
    const moves = group.map((c) => (typeof c.before === 'number' && typeof c.after === 'number' ? c.after - c.before : NaN));
    const shift = moves.every((m) => m === moves[0] && !Number.isNaN(m)) ? moves[0] : undefined;
    rows.push({ path: pattern, before: first.before, after: first.after, count: group.length, ...(shift !== undefined ? { shift } : {}) });
  }
  return { rows: rows.slice(0, limit), hidden: rows.slice(limit).reduce((n, r) => n + r.count, 0) };
}

/** A folded row's name: the field without its places in the list, and how many there are. */
export function foldedName(row: FoldedChange, lang: Lang): string {
  const name = fieldName(row.path.replace(/\/\*(?=\/|$)/g, ''), lang);
  if (row.count === 1) return name;
  const ms = /ms$/i.test(row.path);
  const by = row.shift === undefined ? null : ms ? `${row.shift > 0 ? '+' : '−'}${(Math.abs(row.shift) / 1000).toFixed(1)} ${lang === 'he' ? 'שנ׳' : 's'}` : `${row.shift > 0 ? '+' : '−'}${Math.abs(row.shift)}`;
  const count = row.count.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
  if (lang === 'he') return `${name} · ${count} שינויים${by ? `, כולם ב־${by}` : ''} (לדוגמה הראשון)`;
  return `${name} · ${count} changes${by ? `, all by ${by}` : ''} (the first shown)`;
}

/** The line under folded rows that were left out: "and 1,200 more changes". */
export const moreChanges = (hidden: number, lang: Lang) => (lang === 'he' ? `ועוד ${hidden.toLocaleString('he-IL')} שינויים` : `and ${hidden.toLocaleString('en-US')} more changes`);

export function ChangeTable({ changes, lang }: { changes: Array<{ path: string; before?: unknown; after?: unknown }>; lang: Lang }) {
  const folded = foldChanges(changes);
  return (
    <table className="changes">
      <tbody>
        {folded.rows.map((c) => (
          <tr key={c.path}>
            <th scope="row">{foldedName(c, lang)}</th>
            <td className="was">{valueText(c.path, c.before, lang)}</td>
            <td aria-hidden="true">{lang === 'he' ? '←' : '→'}</td>
            <td className="now">{valueText(c.path, c.after, lang)}</td>
          </tr>
        ))}
        {folded.hidden ? (
          <tr>
            <td colSpan={4} className="subtle">
              {moreChanges(folded.hidden, lang)}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
