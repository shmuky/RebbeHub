import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/signin';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { refreshAccount, useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Signing in, with a passkey: no password to choose or forget. The passkey
 * lives on the person's phone or computer, opened with their fingerprint,
 * face or screen lock, and works only on RebbeHub. New here: a name to be
 * known by, and the device makes the passkey.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'signIn'), path: '/signin', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/_/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body ?? {}) });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

/** Only an address on this site may be returned to after signing in. */
function safeReturn(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account';
}

export default function SignIn() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'in' | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    refreshAccount();
    window.location.assign(safeReturn(params.get('return')));
  };
  // A person who closes the device's prompt has not failed; they only changed their mind.
  const failed = (e: unknown) => setError(e instanceof Error && e.name === 'NotAllowedError' ? t(lang, 'signInCancelled') : e instanceof Error ? e.message : String(e));

  async function signIn() {
    setBusy('in');
    setError(null);
    try {
      const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('passkey/sign-in/options');
      const response = await startAuthentication({ optionsJSON: options });
      await post('passkey/sign-in/verify', { challengeId, response });
      done();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy('new');
    setError(null);
    try {
      const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('passkey/register/options', { name });
      const response = await startRegistration({ optionsJSON: options });
      await post('passkey/register/verify', { challengeId, name, response });
      done();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  const supported = typeof window === 'undefined' || browserSupportsWebAuthn();
  return (
    <>
      <h1>{t(lang, 'signIn')}</h1>
      <p className="subtitle">{t(lang, 'signInIntro')}</p>

      {account ? (
        <p className="note">
          {t(lang, 'alreadySignedIn')} <b>{account.person.displayName}</b>. <Link to={href('/account', lang)}>{t(lang, 'yourAccount')}</Link>
        </p>
      ) : null}

      {!supported ? <p className="note">{t(lang, 'noPasskeys')}</p> : null}

      <section>
        <h2 className="section-header">{t(lang, 'haveAccount')}</h2>
        <p>{t(lang, 'haveAccountText')}</p>
        <button type="button" onClick={signIn} disabled={busy !== null || !supported}>
          {busy === 'in' ? t(lang, 'waiting') : t(lang, 'signInWithPasskey')}
        </button>
      </section>

      <section>
        <h2 className="section-header">{t(lang, 'newAccount')}</h2>
        <form onSubmit={create} className="signin-form">
          <label htmlFor="name">{t(lang, 'nameToShow')}</label>
          <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" dir="auto" />
          <p className="row-sub">{t(lang, 'nameToShowHint')}</p>
          <button type="submit" disabled={busy !== null || !supported || !name.trim()}>
            {busy === 'new' ? t(lang, 'waiting') : t(lang, 'createAccount')}
          </button>
        </form>
      </section>

      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}

      <section className="note">
        <b>{t(lang, 'whatIsPasskey')}</b>
        <p>{t(lang, 'whatIsPasskeyText')}</p>
      </section>
    </>
  );
}
