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
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isRuns(value)) return inlineText(value) || '—';
  if (isPageText(value)) {
    const words = pageTextPlain(value);
    return words.length > 300 ? `${words.slice(0, 300)}…` : words || '—';
  }
  if (typeof value === 'object' && isRuns((value as { text?: unknown }).text)) return inlineText((value as { text: PageInline[] }).text) || '—';
  return t(lang, 'changedValue');
}

export function ChangeTable({ changes, lang }: { changes: Array<{ path: string; before?: unknown; after?: unknown }>; lang: Lang }) {
  return (
    <table className="changes">
      <tbody>
        {changes.map((c) => (
          <tr key={c.path}>
            <th scope="row">{fieldName(c.path, lang)}</th>
            <td className="was">{valueText(c.path, c.before, lang)}</td>
            <td aria-hidden="true">{lang === 'he' ? '←' : '→'}</td>
            <td className="now">{valueText(c.path, c.after, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
