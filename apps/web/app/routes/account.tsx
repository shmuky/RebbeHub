import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/account';
import { ApiTokens } from '../components/ApiTokens.js';
import { HandleSettings } from '../components/threads/HandleSettings.js';
import { Webhooks } from '../components/Webhooks.js';
import { langFrom, t, typeName, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { personPath } from '../lib/threads.js';
import { refreshAccount, useAccount, useEmailSignIn, useGoogleSignIn, type SignedIn } from '../lib/useAccount.js';
import { setFollow, useFollows } from '../lib/useFollows.js';
import { useLang } from '../lib/useLang.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { AgentBy, Avatar, Box, ChoiceList, EmptyState, Label, RelativeTime, Skeleton } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * A person's own page: their name and handle (which they can change),
 * their passkeys (and adding one), their Google account and email
 * addresses, email updates of what they follow, what they follow and what
 * changed in it, their API tokens and webhooks, and signing out. Laid out
 * as GitHub's settings are: the sections listed at the side, each a box
 * of rows. Filled in by the browser; the page itself is the same for
 * everyone. `?unsubscribe=` (the link in every update) stops the updates,
 * signed in or not.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'yourAccount'), path: '/account', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

/** This page's own words: the names of its sections. */
const WORDS = {
  he: { sections: 'חלקי החשבון', profile: 'פרופיל', signingIn: 'כניסה', email: 'מייל', developers: 'למפתחים', yourPage: 'הדף שלי', displayName: 'שם', trust: 'אמון', contributor: 'תורם', trusted: 'מהימן', role: 'תפקיד', inbox: 'התיבה' },
  en: { sections: 'Account sections', profile: 'Profile', signingIn: 'Signing in', email: 'Email', developers: 'Developers', yourPage: 'Your page', displayName: 'Name', trust: 'Trust', contributor: 'Contributor', trusted: 'Trusted', role: 'Role', inbox: 'Inbox' },
} as const;

async function authPost<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`/_/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

const errorText = (lang: Lang, e: unknown) =>
  // Closing the device's prompt is changing one's mind, not a failure.
  e instanceof Error && e.name === 'NotAllowedError' ? t(lang, 'signInCancelled') : e instanceof Error ? e.message : String(e);

/** A box of settings with its heading, the way every section of this page is drawn. */
function Section({ id, icon, title, count, end, children, footer }: { id: string; icon: IconName; title: ReactNode; count?: number; end?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Box
      as="section"
      id={id}
      className="set-box"
      header={
        <>
          <Icon name={icon} />
          <h2>{title}</h2>
          {count ? <span className="count">{count}</span> : null}
          {end ? <span className="end">{end}</span> : null}
        </>
      }
      footer={footer}
    >
      {children}
    </Box>
  );
}

function Alert({ tone, children }: { tone: 'negative' | 'positive' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'negative' ? 'alert' : 'status'}>
      <Icon name={tone === 'negative' ? 'warn' : tone === 'positive' ? 'check' : 'info'} />
      <div>{children}</div>
    </div>
  );
}

/** "Stop these emails", from the link in an update: one button, no sign-in needed. */
function Unsubscribe({ token }: { token: string }) {
  const lang = useLang();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Box as="section" className="set-box" header={<><Icon name="mail" /><h2>{t(lang, 'unsubscribeTitle')}</h2></>}>
      <div className="set-pad">
        {done ? (
          <Alert tone="positive">{t(lang, 'unsubscribed')}</Alert>
        ) : (
          <button
            type="button"
            className="btn primary"
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
        )}
      </div>
    </Box>
  );
}

/** The addresses that sign this person in, adding one (by a link sent to it), and email updates of what they follow. */
function EmailSettings({ account }: { account: SignedIn }) {
  const lang = useLang();
  const [adding, setAdding] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState(account.notifications.mode);
  const [to, setTo] = useState(account.notifications.email ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
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
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
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
      setMessage({ ok: true, text: t(lang, 'saved') });
      refreshAccount();
    });
  };

  return (
    <>
      <Section id="email" icon="mail" title={t(lang, 'yourEmails')} count={account.emails.length}>
        <p className="set-intro">{t(lang, 'emailsIntro')}</p>
        {account.emails.length ? (
          <ul className="rows">
            {account.emails.map((e) => (
              <li key={e.email} className="row">
                <Icon name="mail" />
                <span className="row-main">
                  <span className="row-title" dir="ltr">
                    {e.email}
                  </span>
                </span>
                {e.google ? <Label size="sm">{t(lang, 'viaGoogle')}</Label> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {sentTo ? (
          <div className="set-pad">
            <Alert tone="info">
              {t(lang, 'confirmSent')} <strong dir="ltr">{sentTo}</strong>. {t(lang, 'linkSentText')}
            </Alert>
          </div>
        ) : null}
        <form onSubmit={add} className="form set-form set-inline">
          <label className="field grow" htmlFor="add-email">
            {t(lang, 'addEmail')}
            <input id="add-email" type="email" value={adding} onChange={(e) => setAdding(e.target.value)} maxLength={254} required autoComplete="email" dir="ltr" />
          </label>
          <button type="submit" className="btn" disabled={busy || !adding.trim()}>
            {t(lang, 'sendLink')}
          </button>
        </form>
      </Section>

      <Section id="updates" icon="bell" title={t(lang, 'notificationsTitle')}>
        <p className="set-intro">{t(lang, 'notificationsIntro')}</p>
        {account.emails.length === 0 ? (
          <div className="set-pad">
            <Alert tone="info">{t(lang, 'notifyNeedsEmail')}</Alert>
          </div>
        ) : (
          <form onSubmit={save} className="form stack set-form">
            <ChoiceList name="notify" legend={t(lang, 'notificationsTitle')} value={mode} onChange={(m) => setMode(m as typeof mode)} options={(['off', 'daily', 'immediate'] as const).map((m) => ({ value: m, label: t(lang, `notify_${m}`) }))} />
            {mode !== 'off' && account.emails.length > 1 ? (
              <div className="field">
                <span className="field-label" aria-hidden="true">
                  {t(lang, 'notifyTo')}
                </span>
                <ChoiceList name="notify-to" legend={t(lang, 'notifyTo')} value={to} onChange={setTo} options={account.emails.map((e, i) => ({ value: i === 0 ? '' : e.email, label: <span dir="ltr">{e.email}</span> }))} />
              </div>
            ) : null}
            {message ? <Alert tone={message.ok ? 'positive' : 'negative'}>{message.text}</Alert> : null}
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={busy}>
                {t(lang, 'save')}
              </button>
            </div>
          </form>
        )}
      </Section>
    </>
  );
}

/** What this person follows, and what changed in it lately. */
function FollowsSection({ lang, when }: { lang: Lang; when: (iso: string) => string }) {
  const follows = useFollows(true);
  if (follows === undefined)
    return (
      <Section id="follows" icon="bell" title={t(lang, 'yourFollows')}>
        <Skeleton rows={2} lang={lang} />
      </Section>
    );
  const items = follows?.items ?? [];
  const feed = follows?.feed ?? [];
  return (
    <>
      <Section id="follows" icon="bell" title={t(lang, 'yourFollows')} count={items.length}>
        {items.length === 0 ? (
          <EmptyState compact icon="bell" title={t(lang, 'followsEmpty')} />
        ) : (
          <ul className="rows">
            {items.map((item) => (
              <li key={item.id} className="row">
                <Icon name={item.type === 'event' ? 'cal' : item.type === 'recording' ? 'audio' : item.type === 'set' ? 'layers' : 'book'} />
                <span className="row-main">
                  <Link className="row-title" to={href(itemPath(item), lang)}>
                    {labelOf(item, lang)}
                  </Link>
                  <span className="row-sub">{typeName(item.type, lang)}</span>
                </span>
                <button type="button" className="btn sm" onClick={() => void setFollow(item, false)}>
                  <Icon name="bellon" />
                  {t(lang, 'unfollow')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {items.length > 0 ? (
        <Section id="follow-feed" icon="history" title={t(lang, 'followFeed')}>
          {feed.length === 0 ? (
            <EmptyState compact icon="history" title={t(lang, 'followFeedEmpty')} />
          ) : (
            <ul className="rows">
              {feed.map((f) => {
                const item = items.find((i) => i.id === f.entityId);
                return (
                  <li key={f.seq} className="row">
                    <Icon name={f.authorIsBot || f.via ? 'bot' : 'pencil'} />
                    <span className="row-main">
                      <Link className="row-title" to={href(`/${f.entityId}`, lang)} dir="auto">
                        {f.message}
                      </Link>
                      <span className="row-sub" suppressHydrationWarning>
                        {item ? `${labelOf(item, lang)} · ` : ''}
                        <AgentBy via={f.via} lang={lang} who={f.authorName}>
                          {f.authorName}
                        </AgentBy>{' '}
                        · {when(f.at)}
                        {f.changes > 1 ? ` · ${f.changes.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')} ${t(lang, 'changesCount')}` : ''}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}
    </>
  );
}

export default function Account() {
  const lang = useLang();
  const w = WORDS[lang];
  const account = useAccount();
  const google = useGoogleSignIn();
  const emailOn = useEmailSignIn();
  const [leaving, setLeaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  // Coming back from linking a Google account that is already another account's.
  const [error, setError] = useState<string | null>(params.get('error') === 'google-taken' ? t(lang, 'googleTaken') : null);
  const unsubscribeToken = params.get('unsubscribe');
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      refreshAccount();
    } catch (e) {
      setError(errorText(lang, e));
    } finally {
      setBusy(false);
    }
  }

  const saveName = (event: React.FormEvent) => {
    event.preventDefault();
    void act(async () => {
      await authPost('name', { name: editing });
      setEditing(null);
    });
  };

  const addPasskey = () =>
    act(async () => {
      const { challengeId, options } = await authPost<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('passkey/add/options');
      const response = await startRegistration({ optionsJSON: options });
      await authPost('passkey/add/verify', { challengeId, response });
    });

  async function signOut() {
    setLeaving(true);
    await fetch('/_/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    refreshAccount();
    window.location.assign(href('/', lang));
  }

  if (!account)
    return (
      <>
        <div className="phead flat">
          <div className="wrap narrow">
            <h1 className="page-title">{t(lang, 'yourAccount')}</h1>
          </div>
        </div>
        <div className="wrap narrow page stack">
          {unsubscribeToken ? <Unsubscribe token={unsubscribeToken} /> : null}
          {account === undefined ? (
            <Skeleton rows={4} lang={lang} />
          ) : (
            <Box>
              <EmptyState
                icon="user"
                title={t(lang, 'notSignedIn')}
                actions={
                  <Link className="btn primary" to={href('/signin', lang, { return: '/account' })}>
                    {t(lang, 'signIn')}
                  </Link>
                }
              />
            </Box>
          )}
        </div>
      </>
    );

  const { person } = account;
  const supported = typeof window === 'undefined' || browserSupportsWebAuthn();
  const nav: Array<{ id: string; icon: IconName; label: string }> = [
    { id: 'profile', icon: 'user', label: w.profile },
    { id: 'passkeys', icon: 'key', label: w.signingIn },
    ...(emailOn ? [{ id: 'email', icon: 'mail' as const, label: w.email }] : []),
    { id: 'follows', icon: 'bell', label: t(lang, 'yourFollows') },
    { id: 'api-tokens', icon: 'code', label: w.developers },
  ];

  return (
    <>
      <div className="phead">
        <div className="wrap">
          <div className="acct-head">
            <Avatar name={person.displayName} id={person.id} size="xl" />
            <div className="acct-who">
              <h1 className="page-title">
                <bdi>{person.displayName}</bdi>
              </h1>
              <p className="pmeta">
                {person.username ? (
                  <Link to={href(personPath(person.username), lang)} dir="ltr">
                    @{person.username}
                  </Link>
                ) : null}
                {person.admin ? <Label size="sm">{t(lang, 'roleAdmin')}</Label> : person.steward ? <Label size="sm">{t(lang, 'steward')}</Label> : null}
                {account.trust === 'trusted' ? <Label size="sm" tone="sync">{w.trusted}</Label> : null}
              </p>
            </div>
            <div className="phead-acts">
              {person.username ? (
                <Link className="btn" to={href(personPath(person.username), lang)}>
                  <Icon name="user" />
                  {w.yourPage}
                </Link>
              ) : null}
              <button type="button" className="btn" onClick={signOut} disabled={leaving}>
                <Icon name="logout" />
                {t(lang, 'signOut')}
              </button>
            </div>
          </div>
          <p className="lede acct-lede">{t(lang, 'accountIntro')}</p>
        </div>
      </div>

      <div className="wrap acct">
        <nav className="acct-nav" aria-label={w.sections}>
          <ul>
            {nav.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`}>
                  <Icon name={n.icon} />
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <ul>
            <li>
              <Link to={href('/inbox', lang)}>
                <Icon name="inbox" />
                {w.inbox}
                {account.unread ? <span className="count">{account.unread}</span> : null}
              </Link>
            </li>
            <li>
              <Link to={href('/review', lang)}>
                <Icon name="suggest" />
                {t(lang, 'yourSuggestions')}
              </Link>
            </li>
            {person.steward ? (
              <li>
                <Link to={href('/admin', lang)}>
                  <Icon name="shield" />
                  {t(lang, 'adminTitle')}
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>

        <div className="acct-main">
          {unsubscribeToken ? <Unsubscribe token={unsubscribeToken} /> : null}
          {error ? <Alert tone="negative">{error}</Alert> : null}

          <Section id="profile" icon="user" title={w.profile}>
            <div className="set-row">
              <div className="set-k">
                <b>{w.displayName}</b>
                <span className="hint">{t(lang, 'nameToShowHint')}</span>
              </div>
              {editing === null ? (
                <>
                  <div className="set-v" dir="auto">
                    {person.displayName}
                  </div>
                  <button type="button" className="btn sm" onClick={() => setEditing(person.displayName)}>
                    {t(lang, 'changeName')}
                  </button>
                </>
              ) : (
                <form onSubmit={saveName} className="set-edit form">
                  <label className="field" htmlFor="name">
                    <span className="visually-hidden">{t(lang, 'nameToShow')}</span>
                    <input id="name" value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={60} required autoFocus autoComplete="name" dir="auto" />
                  </label>
                  <div className="btn-row">
                    <button type="submit" className="btn primary sm" disabled={busy || !editing.trim()}>
                      {t(lang, 'save')}
                    </button>
                    <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                      {t(lang, 'cancel')}
                    </button>
                  </div>
                </form>
              )}
            </div>
            <HandleSettings lang={lang} username={person.username} />
            <div className="set-row">
              <div className="set-k">
                <b>{t(lang, 'accountNumber').replace(/:$/, '')}</b>
              </div>
              <div className="set-v mono" dir="ltr">
                {person.id}
              </div>
            </div>
            <div className="set-row">
              <div className="set-k">
                <b>{w.trust}</b>
                {account.trust === 'trusted' ? <span className="hint">{t(lang, 'trustTrusted')}</span> : null}
              </div>
              <div className="set-v">{account.trust === 'trusted' ? w.trusted : w.contributor}</div>
            </div>
          </Section>

          <Section
            id="passkeys"
            icon="key"
            title={t(lang, 'yourPasskeys')}
            count={account.passkeys.length}
            footer={
              supported ? (
                <button type="button" className="btn" onClick={addPasskey} disabled={busy}>
                  <Icon name={busy ? 'loader' : 'plus'} className={busy ? 'spin' : undefined} />
                  {busy ? t(lang, 'waiting') : t(lang, account.passkeys.length ? 'addAnotherPasskey' : 'addPasskey')}
                </button>
              ) : (
                <span className="muted">{t(lang, 'noPasskeys')}</span>
              )
            }
          >
            {account.passkeys.length === 0 ? (
              <EmptyState compact icon="key" title={t(lang, 'noPasskeysYet')} />
            ) : (
              <ul className="rows">
                {account.passkeys.map((p) => (
                  <li key={p.credentialId} className="row">
                    <Icon name={p.backedUp ? 'globe' : 'monitor'} />
                    <span className="row-main">
                      <span className="row-title">{p.backedUp ? t(lang, 'passkeySynced') : t(lang, 'passkeyThisDevice')}</span>
                      <span className="row-sub">
                        {t(lang, 'madeOn')} {when(p.createdAt)}
                        {p.lastUsedAt ? (
                          <>
                            {' · '}
                            {t(lang, 'lastUsed')} <RelativeTime at={p.lastUsedAt} lang={lang} />
                          </>
                        ) : null}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {google || account.googleAccounts.length ? (
            <Section id="google" icon="globe" title={t(lang, 'yourGoogle')} count={account.googleAccounts.length}>
              {account.googleAccounts.length ? (
                <ul className="rows">
                  {account.googleAccounts.map((g) => (
                    <li key={g.createdAt} className="row">
                      <Icon name="globe" />
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
              ) : null}
              {google && account.googleAccounts.length === 0 ? (
                <div className="set-row">
                  <div className="set-k">
                    <b>{t(lang, 'addGoogle')}</b>
                    <span className="hint">{t(lang, 'addGoogleText')}</span>
                  </div>
                  {/* A whole-page visit: the browser goes to Google and comes back. */}
                  <a className="btn sm" href="/_/auth/google/start?return=%2Faccount">
                    {t(lang, 'addGoogle')}
                  </a>
                </div>
              ) : null}
            </Section>
          ) : null}

          {emailOn ? <EmailSettings account={account} /> : null}

          <FollowsSection lang={lang} when={when} />

          <ApiTokens lang={lang} />
          <Webhooks lang={lang} />
        </div>
      </div>
    </>
  );
}
