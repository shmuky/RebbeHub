import { useState } from 'react';
import { Link } from 'react-router';
import { parseDateText } from '@rebbehub/hebrew';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { Panel } from '../ui/primitives.js';

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
  /** The date as a person writes it: "י״ג תמוז תשמ״ה", "13 Tammuz 5745", "תשכ״ב". */
  date: string;
}

function fieldsOf(data: Record<string, unknown>, nameField: NameField, lang: Lang): Fields {
  const title = (data[nameField] ?? {}) as { he?: string; en?: string };
  return { he: title.he ?? '', en: title.en ?? '', date: typeof data.date === 'string' ? dateLabel(data.date, lang, { civil: false }) : '' };
}

/** The date as the catalog keeps it (`5742-05-10`, a month, or a year), read from what was typed; null when it cannot be read. */
function dateKeyOf(f: Fields): string | null {
  if (!f.date.trim()) return null;
  const parsed = parseDateText(f.date);
  if (!parsed.ok) return null;
  const year = Number(parsed.key.slice(0, 4));
  return year >= 5600 && year <= 5900 ? parsed.key : null;
}

export function SuggestFix({ entity, lang }: { entity: Pick<Entity, 'id' | 'type' | 'data' | 'path'>; lang: Lang }) {
  const account = useAccount();
  const data = entity.data as Record<string, unknown>;
  const nameField = nameFieldOf(data) ?? 'title';
  const hadDate = typeof data.date === 'string';
  const dated = DATED.has(entity.type) || hadDate;
  const original = fieldsOf(data, nameField, lang);
  const [fields, setFields] = useState<Fields>(original);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Fields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const date = dateKeyOf(fields);
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
    <Panel id="suggest" icon="suggest" title={t(lang, 'suggestFix')} hint={lang === 'he' ? 'נשלח לבדיקה' : 'Sent for review'}>
      {account === null ? (
        <p>
          {t(lang, 'suggestSignIn')} <Link to={href('/signin', lang, { return: `${here}#suggest` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : sent !== null ? (
        <p className="alert positive" role="status">
          <Icon name="check" />
          <span>
            {t(lang, 'suggestSent')} <Link to={href('/review', lang, { s: String(sent) })}>{t(lang, 'suggestSee')}</Link>
          </span>
        </p>
      ) : (
        <form onSubmit={send} className="form stack">
          <div className="form-row">
            <label className="field">
              <span className="field-label">{t(lang, 'nameHe')}</span>
              <input value={fields.he} onChange={set('he')} required maxLength={300} dir="rtl" />
            </label>
            <label className="field">
              <span className="field-label">{t(lang, 'nameEn')}</span>
              <input value={fields.en} onChange={set('en')} maxLength={300} dir="ltr" />
            </label>
          </div>
          {dated ? (
            <label className="field">
              <span className="field-label">{t(lang, 'date')}</span>
              <input value={fields.date} onChange={set('date')} maxLength={80} dir="auto" placeholder={lang === 'he' ? 'י״ג תמוז תשמ״ה' : '13 Tammuz 5745'} aria-invalid={fields.date.trim() !== '' && !date} />
              <span className="hint">{date ? dateLabel(date, lang) : fields.date.trim() ? (lang === 'he' ? 'לא הצלחתי לקרוא את התאריך. כתבו יום, חודש ושנה, או שנה לבד.' : 'That date could not be read. Write a day, month and year, or a year alone.') : hadDate ? t(lang, 'yearNeeded') : ''}</span>
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">{t(lang, 'suggestWhy')}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} dir="auto" />
          </label>
          {error ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={busy || !changed || !dateOk || !fields.he.trim()}>
              {busy ? t(lang, 'waiting') : t(lang, 'sendForReview')}
            </button>
            <span className="hint">{t(lang, 'suggestHow')}</span>
          </div>
        </form>
      )}
    </Panel>
  );
}
