import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/signin';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { refreshAccount, useAccount, useEmailSignIn, useGoogleSignIn } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Signing in, with a passkey: no password to choose or forget. The passkey
 * lives on the person's phone or computer, opened with their fingerprint,
 * face or screen lock, and works only on RebbeHub. New here: a name to be
 * known by, and the device makes the passkey. Or with Google, once the
 * site has its Google sign-in keys: the browser goes to Google and back.
 * Or by a link sent by email, once the site can send email: the link comes
 * back here (`?email-token=`), and the page asks once more before using it,
 * so a mail program that opens links to check them cannot use it up.
 */

/** Why a Google sign-in came back here (the API's `?error=`). */
const GOOGLE_ERRORS = { 'google-failed': 'googleFailed', 'google-cancelled': 'signInCancelled', 'google-expired': 'googleExpired', 'google-off': 'googleOff' } as const;
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

/** Arriving from the link in an email: what it is for, a new person's name, and one button that uses it. */
function EmailLink({ token, onDone }: { token: string; onDone: () => void }) {
  const lang = useLang();
  const [info, setInfo] = useState<{ email: string; known: boolean; adding: { displayName: string } | null; suggestedName: string | null } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post<NonNullable<typeof info>>('email/check', { token })
      .then((answer) => {
        setInfo(answer);
        setName(answer.suggestedName ?? '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  async function use(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const answer = await post<{ added?: string }>('email/verify', { token, name: name.trim() || undefined });
      if (answer.added) setAdded(true);
      else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="section-header">{t(lang, 'emailLinkTitle')}</h2>
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
      {added ? <p>{t(lang, 'emailLinkAdded')}</p> : null}
      {info && !added ? (
        <form onSubmit={use} className="signin-form">
          <p>
            {info.adding ? `${t(lang, 'emailLinkAdd')} ${info.adding.displayName}: ` : info.known ? `${t(lang, 'emailLinkSignIn')} ` : `${t(lang, 'emailLinkNew')} `}
            <strong dir="ltr">{info.email}</strong>
          </p>
          {!info.known && !info.adding ? (
            <>
              <label htmlFor="email-name">{t(lang, 'nameToShow')}</label>
              <input id="email-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" dir="auto" />
              <p className="row-sub">{t(lang, 'nameToShowHint')}</p>
            </>
          ) : null}
          <button type="submit" disabled={busy || (!info.known && !info.adding && !name.trim())}>
            {busy ? t(lang, 'waiting') : t(lang, 'continueButton')}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/** Asking for a link by email. */
function EmailStart({ returnTo }: { returnTo: string }) {
  const lang = useLang();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('email/start', { email, return: returnTo, lang });
      setSentTo(email.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2 className="section-header">{t(lang, 'orEmail')}</h2>
      {sentTo ? (
        <p role="status">
          {t(lang, 'linkSent')} <strong dir="ltr">{sentTo}</strong>. {t(lang, 'linkSentText')}
        </p>
      ) : (
        <form onSubmit={send} className="signin-form">
          <p>{t(lang, 'orEmailText')}</p>
          <label htmlFor="email">{t(lang, 'emailAddress')}</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required autoComplete="email" dir="ltr" />
          {error ? (
            <p className="row-sub" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="secondary" disabled={busy || !email.trim()}>
            {busy ? t(lang, 'waiting') : t(lang, 'sendLink')}
          </button>
        </form>
      )}
    </section>
  );
}

export default function SignIn() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'in' | 'new' | null>(null);
  const google = useGoogleSignIn();
  const emailOn = useEmailSignIn();
  const emailToken = params.get('email-token');
  const cameBack = GOOGLE_ERRORS[params.get('error') as keyof typeof GOOGLE_ERRORS];
  const [error, setError] = useState<string | null>(cameBack ? t(lang, cameBack) : null);
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
        <>
          <p className="note">
            {t(lang, 'alreadySignedIn')} <strong>{account.person.displayName}</strong>.
          </p>
          {/* Signed in, a new passkey belongs on this account, never on a new one. */}
          <p>
            <Link className="button" to={href('/account', lang)}>
              {t(lang, 'addPasskeyHere')}
            </Link>
          </p>
        </>
      ) : null}

      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}

      {emailToken ? <EmailLink token={emailToken} onDone={done} /> : null}

      {!supported ? <p className="note">{t(lang, 'noPasskeys')}</p> : null}

      {account || emailToken ? null : (
        <>
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
              <p className="row-sub">{t(lang, 'newAccountHint')}</p>
              <button type="submit" disabled={busy !== null || !supported || !name.trim()}>
                {busy === 'new' ? t(lang, 'waiting') : t(lang, 'createAccount')}
              </button>
            </form>
          </section>

          {google ? (
            <section>
              <h2 className="section-header">{t(lang, 'orGoogle')}</h2>
              <p>{t(lang, 'orGoogleText')}</p>
              {/* A whole-page visit: the browser goes to Google and comes back. */}
              <a className="button secondary" href={`/_/auth/google/start?return=${encodeURIComponent(safeReturn(params.get('return')))}`}>
                {t(lang, 'signInWithGoogle')}
              </a>
            </section>
          ) : null}

          {emailOn ? <EmailStart returnTo={safeReturn(params.get('return'))} /> : null}
        </>
      )}

      <section className="note">
        <b>{t(lang, 'whatIsPasskey')}</b>
        <p>{t(lang, 'whatIsPasskeyText')}</p>
      </section>
    </>
  );
}
