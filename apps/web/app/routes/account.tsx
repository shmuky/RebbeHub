import { useState } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/account';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { refreshAccount, useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/** A person's own page: their name, their passkeys, and signing out. Filled in by the browser; the page itself is the same for everyone. */
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
  const [leaving, setLeaving] = useState(false);
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

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
      <h1>{account.person.displayName}</h1>
      <p className="subtitle">{t(lang, 'accountIntro')}</p>

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
      </section>

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
