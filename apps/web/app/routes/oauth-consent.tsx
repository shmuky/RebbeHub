import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/oauth-consent';
import { langFrom, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Avatar, Box, Skeleton } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * Connecting an app to your account (the API's OAuth, services/api/src/oauth.ts):
 * Claude or another agent sends you here from /oauth/authorize, and you
 * say yes or no. Drawn as GitHub's "Authorize application" page is: the
 * app as it names itself, where it will send you back (which is what
 * really tells apps apart), and what it may do, each a row. Reading is
 * always given; sending suggestions as you is a row you may untick. The
 * page is the same for everyone; the request is read by the browser, with
 * your session, and the answer sends the browser back to the app.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: WORDS[loaderData.lang].pageTitle, path: '/oauth/consent', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

interface ConnectRequest {
  id: string;
  client: { id: string; name: string; uri: string | null; kind: 'registered' | 'metadata'; host: string | null };
  redirectUri: string;
  redirectHost: string;
  loopback: boolean;
  scopes: Array<'read' | 'write'>;
  resource: string;
  expiresAt: string;
}

const WORDS = {
  he: {
    pageTitle: 'חיבור אפליקציה',
    title: (app: string) => `לחבר את ${app} לחשבון שלכם?`,
    lede: 'אפליקציה מבקשת לפעול בשמכם ב-RebbeHub. אשרו רק אם אתם מכירים אותה ופתחתם את החיבור בעצמכם.',
    signedInAs: 'מחוברים בתור',
    notYou: 'לא אתם?',
    says: 'כך האפליקציה קוראת לעצמה',
    describedAt: 'מתוארת בכתובת',
    registered: 'נרשמה בעצמה, בלי חשבון',
    backTo: 'אחרי התשובה תחזרו אל',
    loopback: 'האפליקציה מחזירה אתכם למחשב שלכם (localhost). כל תוכנה במחשב יכולה להציג את השם הזה; אשרו רק אם פתחתם את החיבור עכשיו, מתוכנה שאתם סומכים עליה.',
    may: 'מה היא תוכל לעשות',
    read: 'לקרוא',
    readHint: 'את הקטלוג, וגם את מה ששלכם: מה שאתם עוקבים אחריו, המקומות שבהם עצרתם.',
    write: 'לשלוח הצעות בשמכם',
    writeHint: 'תיקונים, הצעות, דיווחים ותגובות, תחת השם שלכם. כל הצעה נבדקת ונסקרת כמו כל הצעה אחרת; שום דבר לא משתנה עד שמאשרים.',
    never: 'לעולם לא: להיכנס לחשבון, לנהל טוקנים או כלי מנהלים.',
    allow: 'אישור',
    deny: 'ביטול',
    leaving: 'חוזרים לאפליקציה…',
    revokeLater: 'אפשר לנתק בכל עת, בדף החשבון, תחת "למפתחים".',
    signInFirst: 'כדי לחבר אפליקציה, קודם נכנסים לחשבון.',
    signIn: 'כניסה',
    over: 'הבקשה הזאת כבר לא בתוקף (נענתה, או שעברה חצי שעה). התחילו שוב מתוך האפליקציה.',
    errors: {
      invalid_client: 'האפליקציה לא מוכרת כאן: היא לא נרשמה, או שאי אפשר היה לקרוא את התיאור שלה. בקשו ממנה להתחבר מחדש.',
      invalid_redirect: 'הכתובת שהאפליקציה ביקשה לחזור אליה אינה אחת מהכתובות שרשמה, ולכן לא נחזיר אתכם אליה.',
      other: 'הבקשה לחיבור אינה תקינה. התחילו שוב מתוך האפליקציה.',
    },
    home: 'לדף הבית',
    howTo: 'איך מחברים את Claude',
  },
  en: {
    pageTitle: 'Connect an app',
    title: (app: string) => `Connect ${app} to your account?`,
    lede: 'An app asks to act as you on RebbeHub. Allow it only if you know it and started connecting it yourself.',
    signedInAs: 'Signed in as',
    notYou: 'Not you?',
    says: 'What the app calls itself',
    describedAt: 'Described at',
    registered: 'Registered itself, with no account',
    backTo: 'After you answer, you go back to',
    loopback: 'The app sends you back to your own computer (localhost). Any program there can show this name; allow it only if you started connecting just now, from a program you trust.',
    may: 'What it may do',
    read: 'Read',
    readHint: 'The catalog, and what is yours: what you follow, where you stopped.',
    write: 'Send suggestions as you',
    writeHint: 'Fixes, suggestions, reports and comments, under your name. Each is checked and reviewed like any other; nothing changes until it is approved.',
    never: 'Never: sign in, manage tokens, or use stewards\' tools.',
    allow: 'Allow',
    deny: 'Cancel',
    leaving: 'Going back to the app…',
    revokeLater: 'You can disconnect it at any time on your account page, under Developers.',
    signInFirst: 'Sign in first to connect an app.',
    signIn: 'Sign in',
    over: 'This request is over (answered, or older than half an hour). Start again from the app.',
    errors: {
      invalid_client: 'This app is not known here: it did not register, or its description could not be read. Ask it to connect again.',
      invalid_redirect: 'The address the app asked to send you back to is not one it registered, so you will not be sent there.',
      other: 'This request to connect is not valid. Start again from the app.',
    },
    home: 'Home',
    howTo: 'How to connect Claude',
  },
} as const;

async function ask<T>(id: string, body?: unknown): Promise<T> {
  const response = await fetch(`/_/oauth/requests/${encodeURIComponent(id)}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw Object.assign(new Error(json.message ?? response.statusText), { status: response.status });
  return json;
}

function Alert({ tone, icon, children }: { tone: 'negative' | 'info'; icon: IconName; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'negative' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

/** One thing the app may do: a row, with its tick. Reading cannot be unticked. */
function ScopeRow({ icon, title, hint, checked, locked, onChange }: { icon: IconName; title: string; hint: string; checked: boolean; locked?: boolean; onChange?: (on: boolean) => void }) {
  return (
    <label className={`row consent-scope${locked ? '' : ' hover'}`}>
      <input type="checkbox" checked={checked} disabled={locked} onChange={(e) => onChange?.(e.target.checked)} />
      <Icon name={icon} />
      <span className="row-main">
        <span className="row-title">{title}</span>
        <span className="row-sub">{hint}</span>
      </span>
    </label>
  );
}

function Head({ lang, title, lede }: { lang: Lang; title: string; lede?: string }) {
  return (
    <div className="auth-head">
      <Link to={href('/', lang)} className="mark auth-mark" aria-label="RebbeHub">
        ר
      </Link>
      <h1 className="auth-title">{title}</h1>
      {lede ? <p className="auth-lede">{lede}</p> : null}
    </div>
  );
}

export default function OAuthConsent() {
  const lang = useLang();
  const w = WORDS[lang];
  const [params] = useSearchParams();
  const id = params.get('request');
  const error = params.get('error');
  const account = useAccount();
  const [request, setRequest] = useState<ConnectRequest | null | undefined>(undefined);
  const [write, setWrite] = useState(true);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !account) return;
    ask<ConnectRequest>(id)
      .then((found) => {
        setRequest(found);
        setWrite(found.scopes.includes('write'));
      })
      .catch((e: Error & { status?: number }) => {
        setRequest(null);
        if (e.status !== 404) setFailure(e.message);
      });
  }, [id, account]);

  async function answer(approve: boolean) {
    if (!request) return;
    setBusy(approve ? 'allow' : 'deny');
    setFailure(null);
    try {
      const { redirect } = await ask<{ redirect: string }>(request.id, { approve, scopes: write ? ['read', 'write'] : ['read'] });
      // Back to the app, with its code or with the person's no.
      window.location.assign(redirect);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  if (error || !id) {
    const text = error === 'invalid_client' ? w.errors.invalid_client : error === 'invalid_redirect' ? w.errors.invalid_redirect : w.errors.other;
    return (
      <div className="auth">
        <Head lang={lang} title={w.pageTitle} />
        <Alert tone="negative" icon="warn">
          {text}
        </Alert>
        <p className="auth-text consent-links">
          <Link to={href('/', lang)}>{w.home}</Link> · <Link to={href('/developers/agents', lang)}>{w.howTo}</Link>
        </p>
      </div>
    );
  }

  if (account === null) {
    const back = `/oauth/consent?${params.toString()}`;
    return (
      <div className="auth">
        <Head lang={lang} title={w.pageTitle} lede={w.lede} />
        <Box as="section" className="auth-box">
          <p className="auth-text">{w.signInFirst}</p>
          <Link className="btn primary block lg" to={href('/signin', lang, { return: back })}>
            <Icon name="key" />
            {w.signIn}
          </Link>
        </Box>
      </div>
    );
  }

  if (account === undefined || request === undefined) {
    return (
      <div className="auth">
        <Head lang={lang} title={w.pageTitle} />
        <Skeleton rows={4} lang={lang} />
      </div>
    );
  }

  if (request === null) {
    return (
      <div className="auth">
        <Head lang={lang} title={w.pageTitle} />
        <Alert tone="negative" icon="warn">
          {failure ?? w.over}
        </Alert>
      </div>
    );
  }

  const asksWrite = request.scopes.includes('write');
  return (
    <div className="auth consent">
      <Head lang={lang} title={w.title(request.client.name)} lede={w.lede} />

      {failure ? (
        <Alert tone="negative" icon="warn">
          {failure}
        </Alert>
      ) : null}

      <Box as="section" className="consent-box">
        <div className="row">
          <Avatar name={account.person.displayName} id={account.person.id} size="sm" />
          <span className="row-main">
            <span className="row-sub">{w.signedInAs}</span>
            <span className="row-title">{account.person.displayName}</span>
          </span>
          <span className="end">
            <Link to={href('/signin', lang, { return: `/oauth/consent?${params.toString()}` })} className="muted">
              {w.notYou}
            </Link>
          </span>
        </div>
        <div className="row">
          <Icon name="bot" />
          <span className="row-main">
            <span className="row-sub">{w.says}</span>
            <span className="row-title">{request.client.name}</span>
            <span className="row-sub" dir="ltr">
              {request.client.kind === 'metadata' ? `${w.describedAt} ${request.client.id}` : w.registered}
            </span>
          </span>
        </div>
        <div className="row">
          <Icon name="external" />
          <span className="row-main">
            <span className="row-sub">{w.backTo}</span>
            <span className="row-title" dir="ltr">
              <strong>{request.redirectHost}</strong>
            </span>
            <code className="row-sub" dir="ltr">
              {request.redirectUri}
            </code>
          </span>
        </div>
      </Box>

      {request.loopback ? (
        <Alert tone="info" icon="info">
          {w.loopback}
        </Alert>
      ) : null}

      <Box as="section" className="consent-box" header={<h2 className="consent-h">{w.may}</h2>}>
        <ScopeRow icon="eye" title={w.read} hint={w.readHint} checked locked />
        {asksWrite ? <ScopeRow icon="pencil" title={w.write} hint={w.writeHint} checked={write} onChange={setWrite} /> : null}
        <div className="row consent-never">
          <Icon name="shield" />
          <span className="row-main row-sub">{w.never}</span>
        </div>
      </Box>

      <div className="consent-actions">
        <button type="button" className="btn primary lg" onClick={() => void answer(true)} disabled={busy !== null}>
          <Icon name={busy === 'allow' ? 'loader' : 'check'} className={busy === 'allow' ? 'spin' : undefined} />
          {busy === 'allow' ? w.leaving : w.allow}
        </button>
        <button type="button" className="btn lg" onClick={() => void answer(false)} disabled={busy !== null}>
          {w.deny}
        </button>
      </div>
      <p className="auth-text consent-note">
        <Icon name="key" /> {w.revokeLater}
      </p>
    </div>
  );
}
