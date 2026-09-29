import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { Icon } from '../ui/Icon.js';
import { Box, ChoiceList, EmptyState, Label } from '../ui/primitives.js';

/**
 * For developers and agents: personal API tokens (docs/developers/auth.md).
 * Made and revoked only here, on the site's own page; the token itself is
 * shown once, when it is made, and never again. Apps connected with OAuth
 * (Claude and other agents, through the consent page) are listed here too,
 * by the app's name and where it lives, and disconnected the same way.
 */

interface Token {
  id: string;
  kind?: 'personal' | 'oauth';
  name: string;
  prefix: string;
  scopes: Array<'read' | 'write'>;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  client?: { id: string; name: string; uri: string | null; host: string | null };
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
    none: 'אין עדיין טוקנים.',
    scopes: 'הרשאות',
    newToken: 'טוקן חדש',
    app: 'אפליקציה מחוברת',
    connected: 'חוברה',
    disconnect: 'ניתוק',
    apps: 'אפליקציות כמו Claude שחיברתם לחשבון מופיעות כאן גם הן.',
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
    none: 'No tokens yet.',
    scopes: 'What it may do',
    newToken: 'A new token',
    app: 'connected app',
    connected: 'connected',
    disconnect: 'Disconnect',
    apps: 'Apps you connected to your account, like Claude, are listed here too.',
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
    <Box
      as="section"
      id="api-tokens"
      className="set-box"
      header={
        <>
          <Icon name="key" />
          <h2>{w.title}</h2>
          <span className="end">
            <Link to={href('/developers/auth', lang)}>{w.docs}</Link>
          </span>
        </>
      }
    >
      <p className="set-intro">
        {w.intro} {w.apps}
      </p>
      {tokens.length === 0 ? (
        <EmptyState compact icon="key" title={w.none} />
      ) : (
        <ul className="rows">
          {tokens.map((t) => (
            <li key={t.id} className="row">
              <Icon name={t.kind === 'oauth' ? 'bot' : 'key'} />
              <span className="row-main">
                <span className="row-title">
                  {t.name} {t.kind === 'oauth' ? <Label size="sm">{w.app}</Label> : <code dir="ltr">{t.prefix}…</code>} {state(t) ? <Label size="sm">{state(t)}</Label> : null}
                </span>
                <span className="row-sub">
                  {t.client?.host ? (
                    <>
                      <span dir="ltr">{t.client.host}</span> ·{' '}
                    </>
                  ) : null}
                  {t.scopes.join(' + ')} · {t.kind === 'oauth' ? w.connected : w.made} {date(t.createdAt)} · {t.lastUsedAt ? `${w.used} ${date(t.lastUsedAt)}` : w.unused}
                  {t.expiresAt && !t.revokedAt && t.kind !== 'oauth' ? ` · ${w.expires} ${date(t.expiresAt)}` : ''}
                </span>
              </span>
              {state(t) ? null : (
                <button type="button" className="btn sm danger" onClick={async () => void (await call(`tokens/${t.id}`, 'DELETE').then(load))}>
                  {t.kind === 'oauth' ? w.disconnect : w.revoke}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {made ? (
        <div className="set-pad">
          <div className="alert positive" role="status">
            <Icon name="check" />
            <div className="grow">
              {w.shown}
              <div className="secret-line">
                <code dir="ltr">{made}</code>
                <button
                  type="button"
                  className="btn sm"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(made).catch(() => undefined);
                    setCopied(true);
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} />
                  {copied ? w.copied : w.copy}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <form
        className="form stack set-form"
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
        <h3 className="set-sub">{w.newToken}</h3>
        <label className="field">
          {w.name}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </label>
        <fieldset className="field">
          <legend>{w.scopes}</legend>
          <label className="check-line">
            <input type="checkbox" checked disabled /> {w.read}
          </label>
          <label className="check-line">
            <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} /> {w.write}
          </label>
        </fieldset>
        <div className="field">
          <span className="field-label" aria-hidden="true">
            {w.expires}
          </span>
          <ChoiceList name="token-expires" inline value={days} onChange={setDays} legend={w.expires} options={[{ value: '', label: w.never }, ...[30, 90, 365].map((n) => ({ value: String(n), label: w.days(n) }))]} />
        </div>
        {error ? (
          <div className="alert negative" role="alert">
            <Icon name="warn" />
            <div>{error}</div>
          </div>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn primary">
            <Icon name="plus" />
            {w.make}
          </button>
        </div>
      </form>
    </Box>
  );
}
