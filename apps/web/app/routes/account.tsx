import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/account';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { refreshAccount, useAccount, useGoogleSignIn } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/** A person's own page: their name (which they can change), their passkeys (and adding one), their Google account, and signing out. Filled in by the browser; the page itself is the same for everyone. */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'yourAccount'), path: '/account', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

export default function Account() {
  const lang = useLang();
  const account = useAccount();
  const google = useGoogleSignIn();
  const [leaving, setLeaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
