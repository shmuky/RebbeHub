import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/signin';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { UsernameField } from '../components/threads/UsernameField.js';
import { refreshAccount, useAccount, useEmailSignIn, useGoogleSignIn } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Box } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * Signing in, with a passkey: no password to choose or forget. The passkey
 * lives on the person's phone or computer, opened with their fingerprint,
 * face or screen lock, and works only on RebbeHub. New here: a name to be
 * known by and a handle for @mentions (suggested from the name), and the
 * device makes the passkey. Or with Google, once the
 * site has its Google sign-in keys: the browser goes to Google and back.
 * Or by a link sent by email, once the site can send email: the link comes
 * back here (`?email-token=`), and the page asks once more before using it,
 * so a mail program that opens links to check them cannot use it up.
 * Drawn as GitHub's sign-in is: one narrow column under the mark, a box
 * for having an account and a box for making one.
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

/** A message in the column: a failure said as one, anything else quietly. */
function Alert({ tone, children }: { tone: 'negative' | 'positive' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'negative' ? 'alert' : 'status'}>
      <Icon name={tone === 'negative' ? 'warn' : tone === 'positive' ? 'check' : 'info'} />
      <div>{children}</div>
    </div>
  );
}

/** Arriving from the link in an email: what it is for, a new person's name, and one button that uses it. */
function EmailLink({ token, onDone }: { token: string; onDone: () => void }) {
  const lang = useLang();
  const [info, setInfo] = useState<{ email: string; known: boolean; adding: { displayName: string } | null; suggestedName: string | null } | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameOk, setUsernameOk] = useState(true);
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
      const answer = await post<{ added?: string }>('email/verify', { token, name: name.trim() || undefined, username: (!info?.known && !info?.adding && username.trim()) || undefined });
      if (answer.added) setAdded(true);
      else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box as="section" className="auth-box">
      <h2 className="auth-h">
        <Icon name="mail" />
        {t(lang, 'emailLinkTitle')}
      </h2>
      {error ? <Alert tone="negative">{error}</Alert> : null}
      {added ? <Alert tone="positive">{t(lang, 'emailLinkAdded')}</Alert> : null}
      {info && !added ? (
        <form onSubmit={use} className="form stack">
          <p className="auth-text">
            {info.adding ? `${t(lang, 'emailLinkAdd')} ${info.adding.displayName}: ` : info.known ? `${t(lang, 'emailLinkSignIn')} ` : `${t(lang, 'emailLinkNew')} `}
            <strong dir="ltr">{info.email}</strong>
          </p>
          {!info.known && !info.adding ? (
            <>
              <label className="field" htmlFor="email-name">
                {t(lang, 'nameToShow')}
                <input id="email-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" dir="auto" />
                <span className="hint">{t(lang, 'nameToShowHint')}</span>
              </label>
              <UsernameField lang={lang} id="email-username" value={username} onChange={setUsername} from={name} onValid={setUsernameOk} />
            </>
          ) : null}
          <button type="submit" className="btn primary block lg" disabled={busy || (!info.known && !info.adding && (!name.trim() || !usernameOk))}>
            {busy ? t(lang, 'waiting') : t(lang, 'continueButton')}
          </button>
        </form>
      ) : null}
    </Box>
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
    <div className="auth-way">
      <h3 className="auth-or">{t(lang, 'orEmail')}</h3>
      {sentTo ? (
        <Alert tone="positive">
          {t(lang, 'linkSent')} <strong dir="ltr">{sentTo}</strong>. {t(lang, 'linkSentText')}
        </Alert>
      ) : (
        <form onSubmit={send} className="form stack">
          <label className="field" htmlFor="email">
            {t(lang, 'emailAddress')}
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required autoComplete="email" dir="ltr" />
            <span className="hint">{t(lang, 'orEmailText')}</span>
          </label>
          {error ? <Alert tone="negative">{error}</Alert> : null}
          <button type="submit" className="btn block" disabled={busy || !email.trim()}>
            <Icon name="mail" />
            {busy ? t(lang, 'waiting') : t(lang, 'sendLink')}
          </button>
        </form>
      )}
    </div>
  );
}

export default function SignIn() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameOk, setUsernameOk] = useState(true);
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
      const { challengeId, options } = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('passkey/register/options', { name, username: username.trim() || undefined });
      const response = await startRegistration({ optionsJSON: options });
      await post('passkey/register/verify', { challengeId, name, username: username.trim() || undefined, response });
      done();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  const supported = typeof window === 'undefined' || browserSupportsWebAuthn();
  return (
    <div className="auth">
      <div className="auth-head">
        <Link to={href('/', lang)} className="mark auth-mark" aria-label="RebbeHub">
          ר
        </Link>
        <h1 className="auth-title">{t(lang, 'signIn')}</h1>
        <p className="auth-lede">{t(lang, 'signInIntro')}</p>
      </div>

      {error ? <Alert tone="negative">{error}</Alert> : null}

      {account ? (
        <Box as="section" className="auth-box">
          <p className="auth-text">
            {t(lang, 'alreadySignedIn')} <strong>{account.person.displayName}</strong>.
          </p>
          {/* Signed in, a new passkey belongs on this account, never on a new one. */}
          <Link className="btn primary block lg" to={href('/account', lang)}>
            <Icon name="key" />
            {t(lang, 'addPasskeyHere')}
          </Link>
        </Box>
      ) : null}

      {emailToken ? <EmailLink token={emailToken} onDone={done} /> : null}

      {!supported ? <Alert tone="info">{t(lang, 'noPasskeys')}</Alert> : null}

      {account || emailToken ? null : (
        <>
          <Box as="section" className="auth-box">
            <h2 className="auth-h">{t(lang, 'haveAccount')}</h2>
            <p className="auth-text">{t(lang, 'haveAccountText')}</p>
            <button type="button" className="btn primary block lg" onClick={signIn} disabled={busy !== null || !supported}>
              <Icon name={busy === 'in' ? 'loader' : 'key'} className={busy === 'in' ? 'spin' : undefined} />
              {busy === 'in' ? t(lang, 'waiting') : t(lang, 'signInWithPasskey')}
            </button>
            {google ? (
              <div className="auth-way">
                <h3 className="auth-or">{t(lang, 'orGoogle')}</h3>
                {/* A whole-page visit: the browser goes to Google and comes back. */}
                <a className="btn block lg" href={`/_/auth/google/start?return=${encodeURIComponent(safeReturn(params.get('return')))}`}>
                  <Icon name="globe" />
                  {t(lang, 'signInWithGoogle')}
                </a>
                <p className="hint">{t(lang, 'orGoogleText')}</p>
              </div>
            ) : null}
            {emailOn ? <EmailStart returnTo={safeReturn(params.get('return'))} /> : null}
          </Box>

          <Box as="section" className="auth-box">
            <h2 className="auth-h">{t(lang, 'newAccount')}</h2>
            <form onSubmit={create} className="form stack">
              <label className="field" htmlFor="name">
                {t(lang, 'nameToShow')}
                <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" dir="auto" />
                <span className="hint">{t(lang, 'nameToShowHint')}</span>
              </label>
              <UsernameField lang={lang} value={username} onChange={setUsername} from={name} onValid={setUsernameOk} />
              <button type="submit" className="btn block lg" disabled={busy !== null || !supported || !name.trim() || !usernameOk}>
                <Icon name={busy === 'new' ? 'loader' : 'plus'} className={busy === 'new' ? 'spin' : undefined} />
                {busy === 'new' ? t(lang, 'waiting') : t(lang, 'createAccount')}
              </button>
              <p className="hint">{t(lang, 'newAccountHint')}</p>
            </form>
          </Box>
        </>
      )}

      <aside className="auth-note">
        <Icon name="key" />
        <div>
          <b>{t(lang, 'whatIsPasskey')}</b>
          <p>{t(lang, 'whatIsPasskeyText')}</p>
        </div>
      </aside>
    </div>
  );
}
