import { useState } from 'react';
import { Link } from 'react-router';
import { MONTHS, parseDateKey } from '@rebbehub/hebrew';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * "Suggest a fix" (the plan, section 7): change what is wrong on the page
 * itself, say where it comes from, and send it for review. An item's name
 * in Hebrew and English, and its date where it has one; the set's keepers
 * approve it. Signed out, it leads to signing in and back.
 */

/** Which field holds an item's name. */
const NAME_FIELDS = ['title', 'name', 'label'] as const;
type NameField = (typeof NAME_FIELDS)[number];

/** Kinds of item whose name (and date) people may fix here; sets, schemas and sources are the stewards'. */
const FIXABLE = new Set(['event', 'unit', 'work', 'publication', 'recording', 'person', 'place', 'topic']);
/** Kinds of item that always carry a date; a sicha or letter shows one only when it has one already. */
const DATED = new Set(['event', 'publication']);

export function canSuggestFix(entity: Pick<Entity, 'type' | 'data'>): boolean {
  const data = entity.data as Record<string, unknown> | null;
  return FIXABLE.has(entity.type) && data !== null && nameFieldOf(data) !== null;
}

function nameFieldOf(data: Record<string, unknown>): NameField | null {
  return NAME_FIELDS.find((f) => data[f] && typeof data[f] === 'object') ?? null;
}

interface Fields {
  he: string;
  en: string;
  year: string;
  month: string;
  day: string;
}

/** A Hebrew year is a leap year (with Adar I and II) seven times in nineteen. */
const isLeap = (year: number) => (7 * year + 1) % 19 < 7;

function fieldsOf(data: Record<string, unknown>, nameField: NameField): Fields {
  const title = (data[nameField] ?? {}) as { he?: string; en?: string };
  const parts = typeof data.date === 'string' ? parseDateKey(data.date) : null;
  return { he: title.he ?? '', en: title.en ?? '', year: parts ? String(parts.year) : '', month: parts?.month ?? '', day: parts?.day ? String(parts.day) : '' };
}

/** The date as the catalog keeps it (`5742-05-10`, or `5742-05` without a day); null when the year is missing or out of range. */
function dateKeyOf(f: Fields): string | null {
  const year = Number(f.year);
  if (!Number.isInteger(year) || year < 5600 || year > 5900) return null;
  if (!f.month) return String(year);
  const day = f.day ? `-${f.day.padStart(2, '0')}` : '';
  return `${year}-${f.month}${day}`;
}

export function SuggestFix({ entity, lang }: { entity: Pick<Entity, 'id' | 'type' | 'data' | 'path'>; lang: Lang }) {
  const account = useAccount();
  const data = entity.data as Record<string, unknown>;
  const nameField = nameFieldOf(data) ?? 'title';
  const hadDate = typeof data.date === 'string';
  const dated = DATED.has(entity.type) || hadDate;
  const original = fieldsOf(data, nameField);
  const [fields, setFields] = useState<Fields>(original);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Fields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const date = dateKeyOf(fields);
  const leap = isLeap(Number(fields.year));
  const months = MONTHS.filter((m) => m.years === 'all' || (m.years === 'leap') === leap);
  const changedName = fields.he.trim() !== original.he || fields.en.trim() !== original.en;
  const changedDate = dated && date !== (hadDate ? data.date : null);
  // A date may be left empty only where there was none.
  const dateOk = !dated || date !== null || !hadDate;
  const changed = changedName || changedDate;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!dateOk || !fields.he.trim()) return;
    setBusy(true);
    setError(null);
    const title = [changedDate ? t(lang, 'fixDate') : null, changedName ? t(lang, 'fixName') : null].filter(Boolean).join(', ');
    const { en: _en, ...keep } = (data[nameField] ?? {}) as Record<string, string>;
    const next: Record<string, unknown> = { ...data, [nameField]: { ...keep, he: fields.he.trim(), ...(fields.en.trim() ? { en: fields.en.trim() } : {}) } };
    if (dated && date) next.date = date;
    try {
      const response = await fetch('/_/suggestions/quick', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ entityId: entity.id, data: next, title, note }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? response.statusText);
      setSent(body.id!);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const here = entity.path ?? `/${entity.id}`;
  return (
    <details className="report suggest" id="suggest">
      <summary>{t(lang, 'suggestFix')}</summary>
      {account === null ? (
        <p>
          {t(lang, 'suggestSignIn')} <Link to={href('/signin', lang, { return: `${here}#suggest` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : sent !== null ? (
        <p role="status">
          {t(lang, 'suggestSent')} <Link to={href('/review', lang, { s: String(sent) })}>{t(lang, 'suggestSee')}</Link>
        </p>
      ) : (
        <form onSubmit={send}>
          <label>
            {t(lang, 'nameHe')}
            <input value={fields.he} onChange={set('he')} required maxLength={300} dir="rtl" />
          </label>
          <label>
            {t(lang, 'nameEn')}
            <input value={fields.en} onChange={set('en')} maxLength={300} dir="ltr" />
          </label>
          {dated ? (
            <>
              <fieldset className="date-fields">
                <legend>{t(lang, 'date')}</legend>
                <select aria-label={t(lang, 'day')} value={fields.day} onChange={set('day')}>
                  <option value="">—</option>
                  {Array.from({ length: 30 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <select aria-label={t(lang, 'month')} value={fields.month} onChange={set('month')}>
                  <option value="">—</option>
                  {months.map((m) => (
                    <option key={m.token} value={m.token}>
                      {m[lang]}
                    </option>
                  ))}
                </select>
                <input aria-label={t(lang, 'year')} value={fields.year} onChange={set('year')} inputMode="numeric" maxLength={4} size={5} dir="ltr" />
              </fieldset>
              <p className="row-sub">{date ? dateLabel(date, lang) : hadDate ? t(lang, 'yearNeeded') : ''}</p>
            </>
          ) : null}
          <label>
            {t(lang, 'suggestWhy')}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div>
            <button type="submit" disabled={busy || !changed || !dateOk || !fields.he.trim()}>
              {busy ? t(lang, 'waiting') : t(lang, 'sendForReview')}
            </button>
          </div>
          <p className="row-sub">{t(lang, 'suggestHow')}</p>
        </form>
      )}
    </details>
  );
}
