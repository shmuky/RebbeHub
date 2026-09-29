import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';

/**
 * For developers and agents: personal API tokens (docs/developers/auth.md).
 * Made and revoked only here, on the site's own page; the token itself is
 * shown once, when it is made, and never again.
 */

interface Token {
  id: string;
  name: string;
  prefix: string;
  scopes: Array<'read' | 'write'>;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const WORDS = {
  he: {
    title: 'למפתחים: טוקנים ל-API',
    intro: 'טוקן אישי מאפשר לסקריפט או לסוכן AI לפעול בשמכם דרך ה-API: לקרוא את מה ששלכם ולשלוח הצעות, שנבדקות כמו כל הצעה. שמרו אותו בסוד.',
    docs: 'איך משתמשים',
    name: 'שם (מה ישתמש בו)',
    read: 'קריאה (מה שאתם עוקבים, המקומות שלכם)',
    write: 'כתיבה (הצעות, תיקונים, תגובות)',
    expires: 'תוקף',
    never: 'ללא הגבלה',
    days: (n: number) => `${n} ימים`,
    make: 'יצירת טוקן',
    shown: 'הטוקן (מוצג פעם אחת בלבד, העתיקו אותו עכשיו):',
    copy: 'העתקה',
    copied: 'הועתק',
    revoke: 'ביטול',
    revoked: 'בוטל',
    expired: 'פג תוקף',
    used: 'שימוש אחרון',
    unused: 'לא נעשה בו שימוש',
    made: 'נוצר',
  },
  en: {
    title: 'For developers: API tokens',
    intro: 'A personal token lets a script or an AI agent act as you through the API: read what is yours and send suggestions, which are reviewed like any other. Keep it secret.',
    docs: 'How to use one',
    name: 'Name (what will use it)',
    read: 'Read (what you follow, your places)',
    write: 'Write (suggestions, fixes, comments)',
    expires: 'Expires',
    never: 'Never',
    days: (n: number) => `in ${n} days`,
    make: 'Make a token',
    shown: 'Your token (shown this once; copy it now):',
    copy: 'Copy',
    copied: 'Copied',
    revoke: 'Revoke',
    revoked: 'revoked',
    expired: 'expired',
    used: 'last used',
    unused: 'never used',
    made: 'made',
  },
} as const;

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

export function ApiTokens({ lang }: { lang: Lang }) {
  const w = WORDS[lang];
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [days, setDays] = useState('');
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setTokens((await call<{ tokens: Token[] }>('tokens').catch(() => ({ tokens: [] }))).tokens), []);
  useEffect(() => void load(), [load]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US');
  const state = (t: Token) => (t.revokedAt ? w.revoked : t.expiresAt && new Date(t.expiresAt) < new Date() ? w.expired : null);

  return (
    <details className="report" id="api-tokens">
      <summary>{w.title}</summary>
      <p className="row-sub">
        {w.intro} <Link to={href('/developers/auth', lang)}>{w.docs}</Link>
      </p>
      <ul className="rows">
        {tokens.map((t) => (
          <li key={t.id} className="row">
            <span className="row-main">
              <span className="row-title">
                {t.name} <code dir="ltr">{t.prefix}…</code>
              </span>
              <span className="row-sub">
                {t.scopes.join(' + ')} · {w.made} {date(t.createdAt)} · {t.lastUsedAt ? `${w.used} ${date(t.lastUsedAt)}` : w.unused}
                {t.expiresAt && !t.revokedAt ? ` · ${w.expires} ${date(t.expiresAt)}` : ''}
                {state(t) ? ` · ${state(t)}` : ''}
              </span>
            </span>
            {state(t) ? null : (
              <button type="button" className="link-button" onClick={async () => void (await call(`tokens/${t.id}`, 'DELETE').then(load))}>
                {w.revoke}
              </button>
            )}
          </li>
        ))}
      </ul>
      {made ? (
        <p className="note" role="status">
          {w.shown} <code dir="ltr">{made}</code>{' '}
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              await navigator.clipboard?.writeText(made).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? w.copied : w.copy}
          </button>
        </p>
      ) : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const answer = await call<{ token: string }>('tokens', 'POST', { name, scopes: write ? ['read', 'write'] : ['read'], ...(days ? { expiresInDays: Number(days) } : {}) });
            setMade(answer.token);
            setCopied(false);
            setName('');
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <label>
          {w.name}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <label>
          <input type="checkbox" checked disabled /> {w.read}
        </label>
        <label>
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} /> {w.write}
        </label>
        <label>
          {w.expires}
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">{w.never}</option>
            {[30, 90, 365].map((n) => (
              <option key={n} value={n}>
                {w.days(n)}
              </option>
            ))}
          </select>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <button type="submit">{w.make}</button>
        </div>
      </form>
    </details>
  );
}
