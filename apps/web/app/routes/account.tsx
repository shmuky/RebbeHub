import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/account';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { labelOf } from '../lib/labels.js';
import { itemPath } from '../lib/links.js';
import { refreshAccount, useAccount, useEmailSignIn, useGoogleSignIn, type SignedIn } from '../lib/useAccount.js';
import { setFollow, useFollows } from '../lib/useFollows.js';
import { Webhooks } from '../components/Webhooks.js';
import { useLang } from '../lib/useLang.js';

/**
 * A person's own page: their name (which they can change), their passkeys
 * (and adding one), their Google account and email addresses, email
 * updates of what they follow, and signing out. Filled in by the browser;
 * the page itself is the same for everyone. `?unsubscribe=` (the link in
 * every update) stops the updates, signed in or not.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'yourAccount'), path: '/account', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

async function authPost<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`/_/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

/** "Stop these emails", from the link in an update: one button, no sign-in needed. */
function Unsubscribe({ token }: { token: string }) {
  const lang = useLang();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="note">
      <b>{t(lang, 'unsubscribeTitle')}</b>
      {done ? (
        <p role="status">{t(lang, 'unsubscribed')}</p>
      ) : (
        <p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void authPost('email/unsubscribe', { token })
                .then(() => {
                  setDone(true);
                  refreshAccount();
                })
                .finally(() => setBusy(false));
            }}
          >
            {t(lang, 'unsubscribeButton')}
          </button>
        </p>
      )}
    </section>
  );
}

/** The addresses that sign this person in, adding one (by a link sent to it), and email updates of what they follow. */
function EmailSettings({ account }: { account: SignedIn }) {
  const lang = useLang();
  const [adding, setAdding] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState(account.notifications.mode);
  const [to, setTo] = useState(account.notifications.email ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(account.notifications.mode);
    setTo(account.notifications.email ?? '');
  }, [account.notifications.mode, account.notifications.email]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await authPost('email/start', { email: adding, return: '/account', lang });
      setSentTo(adding.trim());
      setAdding('');
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await authPost('notifications', { mode, email: to || null, lang });
      setMessage(t(lang, 'saved'));
      refreshAccount();
    });
  };

  return (
    <>
      <section>
        <h2 className="section-header">{t(lang, 'yourEmails')}</h2>
        <p className="row-sub">{t(lang, 'emailsIntro')}</p>
        <ul className="rows">
          {account.emails.map((e) => (
            <li key={e.email} className="row">
              <span className="row-main">
                <span className="row-title" dir="ltr">
                  {e.email}
                </span>
                {e.google ? <span className="row-sub">{t(lang, 'viaGoogle')}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {sentTo ? (
          <p role="status">
            {t(lang, 'confirmSent')} <strong dir="ltr">{sentTo}</strong>. {t(lang, 'linkSentText')}
          </p>
        ) : null}
        <form onSubmit={add} className="signin-form">
          <label htmlFor="add-email">{t(lang, 'addEmail')}</label>
          <input id="add-email" type="email" value={adding} onChange={(e) => setAdding(e.target.value)} maxLength={254} required autoComplete="email" dir="ltr" />
          <button type="submit" className="secondary" disabled={busy || !adding.trim()}>
            {t(lang, 'sendLink')}
          </button>
        </form>
      </section>

      <section>
        <h2 className="section-header">{t(lang, 'notificationsTitle')}</h2>
        <p className="row-sub">{t(lang, 'notificationsIntro')}</p>
        {account.emails.length === 0 ? (
          <p>{t(lang, 'notifyNeedsEmail')}</p>
        ) : (
          <form onSubmit={save} className="signin-form">
            {(['off', 'daily', 'immediate'] as const).map((m) => (
              <label key={m} className="choice">
                <input type="radio" name="notify" value={m} checked={mode === m} onChange={() => setMode(m)} /> {t(lang, `notify_${m}`)}
              </label>
            ))}
            {mode !== 'off' && account.emails.length > 1 ? (
              <label>
                {t(lang, 'notifyTo')}{' '}
                <select value={to} onChange={(e) => setTo(e.target.value)} dir="ltr">
                  <option value="">{account.emails[0]!.email}</option>
                  {account.emails.slice(1).map((e) => (
                    <option key={e.email} value={e.email}>
                      {e.email}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button type="submit" disabled={busy}>
              {t(lang, 'save')}
            </button>
          </form>
        )}
      </section>
      {message ? (
        <p className="row-sub" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

export default function Account() {
  const lang = useLang();
  const account = useAccount();
  const google = useGoogleSignIn();
  const emailOn = useEmailSignIn();
  const follows = useFollows(Boolean(account));
  const [leaving, setLeaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  // Coming back from linking a Google account that is already another account's.
  const [error, setError] = useState<string | null>(params.get('error') === 'google-taken' ? t(lang, 'googleTaken') : null);
  const unsubscribeToken = params.get('unsubscribe');
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

  async function post<T>(path: string, body: unknown = {}): Promise<T> {
    const response = await fetch(`/_/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new Error(json.message ?? response.statusText);
    return json;
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      refreshAccount();
    } catch (e) {
      // Closing the device's prompt is changing one's mind, not a failure.
      setError(e instanceof Error && e.name === 'NotAllowedError' ? t(lang, 'signInCancelled') : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await post('name', { name: editing });
      setEditing(null);
    });
  };

  const addPasskey = () =>
    act(async () => {
      const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('passkey/add/options');
      const response = await startRegistration({ optionsJSON: options });
      await post('passkey/add/verify', { challengeId, response });
    });

  async function signOut() {
    setLeaving(true);
    await fetch('/_/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    refreshAccount();
    window.location.assign(href('/', lang));
  }

  if (account === undefined) return <h1>{t(lang, 'yourAccount')}</h1>;
  if (account === null)
    return (
      <>
        <h1>{t(lang, 'yourAccount')}</h1>
        {unsubscribeToken ? <Unsubscribe token={unsubscribeToken} /> : null}
        <p>
          {t(lang, 'notSignedIn')} <Link to={href('/signin', lang, { return: '/account' })}>{t(lang, 'signIn')}</Link>
        </p>
      </>
    );
  return (
    <>
      {editing === null ? (
        <h1>
          {account.person.displayName}{' '}
          <button type="button" className="link-button" onClick={() => setEditing(account.person.displayName)}>
            {t(lang, 'changeName')}
          </button>
        </h1>
      ) : (
        <form onSubmit={saveName} className="signin-form">
          <label htmlFor="name">{t(lang, 'nameToShow')}</label>
          <input id="name" value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={60} required autoFocus autoComplete="name" dir="auto" />
          <p className="row-sub">{t(lang, 'nameToShowHint')}</p>
          <p>
            <button type="submit" disabled={busy || !editing.trim()}>
              {t(lang, 'save')}
            </button>{' '}
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              {t(lang, 'cancel')}
            </button>
          </p>
        </form>
      )}
      <p className="subtitle">{t(lang, 'accountIntro')}</p>
      <p className="row-sub">
        {t(lang, 'accountNumber')} <span dir="ltr">{account.person.id}</span>
        {account.person.admin ? ` · ${t(lang, 'roleAdmin')}` : account.person.steward ? ` · ${t(lang, 'steward')}` : ''}
      </p>
      {account.trust === 'trusted' ? <p className="row-sub">{t(lang, 'trustTrusted')}</p> : null}
      {unsubscribeToken ? <Unsubscribe token={unsubscribeToken} /> : null}

      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}

      <section>
        <h2 className="section-header">{t(lang, 'yourPasskeys')}</h2>
        <ul className="rows">
          {account.passkeys.map((p) => (
            <li key={p.credentialId} className="row">
              <span className="row-main">
                <span className="row-title">{p.backedUp ? t(lang, 'passkeySynced') : t(lang, 'passkeyThisDevice')}</span>
                <span className="row-sub">
                  {t(lang, 'madeOn')} {when(p.createdAt)}
                  {p.lastUsedAt ? ` · ${t(lang, 'lastUsed')} ${when(p.lastUsedAt)}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {account.passkeys.length === 0 ? <p>{t(lang, 'noPasskeysYet')}</p> : null}
        {typeof window === 'undefined' || browserSupportsWebAuthn() ? (
          <button type="button" className="secondary" onClick={addPasskey} disabled={busy}>
            {busy ? t(lang, 'waiting') : t(lang, account.passkeys.length ? 'addAnotherPasskey' : 'addPasskey')}
          </button>
        ) : null}
      </section>

      {google || account.googleAccounts.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'yourGoogle')}</h2>
          <ul className="rows">
            {account.googleAccounts.map((g) => (
              <li key={g.createdAt} className="row">
                <span className="row-main">
                  <span className="row-title" dir="ltr">
                    {g.email ?? 'Google'}
                  </span>
                  <span className="row-sub">
                    {t(lang, 'linkedOn')} {when(g.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {google && account.googleAccounts.length === 0 ? (
            <p>
              <a href="/_/auth/google/start?return=%2Faccount">{t(lang, 'addGoogle')}</a> <span className="row-sub">{t(lang, 'addGoogleText')}</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {emailOn ? <EmailSettings account={account} /> : null}

      <section>
        <h2 className="section-header">{t(lang, 'yourFollows')}</h2>
        {follows && follows.items.length === 0 ? <p className="row-sub">{t(lang, 'followsEmpty')}</p> : null}
        <ul className="rows">
          {follows?.items.map((item) => (
            <li key={item.id} className="row">
              <span className="row-main">
                <Link className="row-title" to={href(itemPath(item), lang)}>
                  {labelOf(item, lang)}
                </Link>
              </span>
              <button type="button" className="link-button" onClick={() => void setFollow(item, false)}>
                {t(lang, 'unfollow')}
              </button>
            </li>
          ))}
        </ul>
        {follows && follows.items.length > 0 ? (
          <>
            <h3 className="subsection">{t(lang, 'followFeed')}</h3>
            {follows.feed.length === 0 ? <p className="row-sub">{t(lang, 'followFeedEmpty')}</p> : null}
            <ul className="rows">
              {follows.feed.map((f) => (
                <li key={f.seq} className="row">
                  <span className="row-main">
                    <Link className="row-title" to={href(`/${f.entityId}`, lang)}>
                      {f.message}
                    </Link>
                    <span className="row-sub" suppressHydrationWarning>
                      {(() => {
                        const item = follows.items.find((i) => i.id === f.entityId);
                        return item ? `${labelOf(item, lang)} · ` : '';
                      })()}
                      {f.authorName} · {when(f.at)}
                      {f.changes > 1 ? ` · ${f.changes.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')} ${t(lang, 'changesCount')}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <p>
        <Link to={href('/review', lang)}>{t(lang, 'yourSuggestions')}</Link>
        {account.person.steward ? (
          <>
            {' · '}
            <Link to={href('/admin', lang)}>{t(lang, 'adminTitle')}</Link>
          </>
        ) : null}
      </p>

      <Webhooks lang={lang} />

      <section className="note">
        <b>{t(lang, 'comingForAccounts')}</b>
        <p>{t(lang, 'comingForAccountsText')}</p>
      </section>

      <button type="button" className="secondary" onClick={signOut} disabled={leaving}>
        {t(lang, 'signOut')}
      </button>
    </>
  );
}
