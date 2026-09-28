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

/** A field's name as people say it. */
export const fieldName = (path: string, lang: Lang) => (FIELD_KEYS[path] ? t(lang, FIELD_KEYS[path]!) : path.split('/').filter(Boolean).join(' › '));

/** A value as people read it: a date in words, text as it is; anything else only as "changed". */
export function valueText(path: string, value: unknown, lang: Lang): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string' && /date/i.test(path)) return dateLabel(value, lang, { civil: false });
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
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
