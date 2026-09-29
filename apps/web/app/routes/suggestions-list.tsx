import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/suggestions-list';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { num, tu } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { personPath, threads, type People, type SuggestionListItem } from '../lib/threads.js';
import { parseTokens, tokenText, withToken, type TokenKey } from '../lib/tokens.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import { Avatar, EmptyState, RelativeTime, Skeleton, StateIcon, StatusBadge, cx } from '../ui/primitives.js';

/**
 * Suggestions as pull requests are listed: open (waiting for review, or
 * sent back to their author) or closed (approved or withdrawn), each with
 * who suggested it and when, whether a keeper approved it, the reports it
 * fixes, who is asked to review it and how much was said. The search
 * line is the filter (`מצב:פתוח בודק:@me`); "asked of me" is a keeper's
 * queue. Read on the server, so the list works before script; a signed-in
 * reader's `@me` is filled in by the browser.
 */

const KEYS: TokenKey[] = [
  {
    key: 'state',
    he: 'מצב',
    en: 'state',
    values: [
      { value: 'open', he: 'פתוחה', en: 'open' },
      { value: 'closed', he: 'סגורה', en: 'closed' },
    ],
  },
  { key: 'author', he: 'מציע', en: 'author', hint: { he: 'שם משתמש או @me', en: 'a username or @me' } },
  { key: 'reviewer', he: 'בודק', en: 'reviewer', hint: { he: 'שם משתמש או @me', en: 'a username or @me' } },
  {
    key: 'sort',
    he: 'מיון',
    en: 'sort',
    values: [
      { value: 'new', he: 'החדשות', en: 'newest' },
      { value: 'old', he: 'הישנות', en: 'oldest' },
      { value: 'comments', he: 'הכי מדוברות', en: 'most-commented' },
    ],
  },
];

function lineFrom(params: URLSearchParams, lang: Lang): string {
  let line = params.get('q') ?? '';
  for (const k of ['state', 'author', 'reviewer'] as const) {
    const v = params.get(k);
    if (v && !parseTokens(line, KEYS).filters[k]) line = withToken(line, KEYS, k, v, lang);
  }
  if (!parseTokens(line, KEYS).filters.state) line = `${tokenText(KEYS[0]!, 'open', lang)} ${line}`.trim();
  return line;
}

function queryFrom(line: string) {
  const parsed = parseTokens(line, KEYS);
  const one = (k: string) => parsed.filters[k]?.[parsed.filters[k]!.length - 1] ?? null;
  const person = (v: string | null) => v?.replace(/^@(?!me$)/, '') ?? null;
  return { state: one('state') === 'closed' ? ('closed' as const) : ('open' as const), author: person(one('author')), reviewer: person(one('reviewer')), sort: one('sort') ?? 'new', text: parsed.text, parsed };
}

function apiOf(q: ReturnType<typeof queryFrom>, me: string | null): Record<string, string> {
  const out: Record<string, string> = { state: q.state };
  const person = (v: string | null) => (v === '@me' ? me : v);
  if (person(q.author)) out.author = person(q.author)!;
  if (person(q.reviewer)) out.reviewer = person(q.reviewer)!;
  if (q.text) out.q = q.text;
  return out;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const line = lineFrom(new URL(request.url).searchParams, lang);
  const q = queryFrom(line);
  const mine = q.author === '@me' || q.reviewer === '@me';
  const listing = mine ? null : await api.conversations({ ...(apiOf(q, null) as { state: 'open' }), limit: 30 }).catch(() => null);
  const issues = await api.issues({ state: 'open', limit: 1 }).catch(() => null);
  return { lang, siteUrl, line, listing, openIssues: issues?.counts.open ?? null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'הצעות' : 'Suggestions', path: '/suggestions', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  title: { he: 'הצעות', en: 'Suggestions' },
  lead: { he: 'תיקונים ותוספות שאנשים הציעו. כל הצעה נבדקת ומאושרת על ידי אחראי האוסף, ורק אז נכנסת.', en: 'Fixes and additions people suggested. Each is reviewed and approved by the set’s keepers before it goes in.' },
  reports: { he: 'דיווחים', en: 'Reports' },
  search: { he: 'חיפוש בהצעות', en: 'Search suggestions' },
  placeholder: { he: 'אפשר גם לכתוב חופשי, או #מספר', en: 'Free text works too, or #number' },
  open: { he: 'פתוחות', en: 'Open' },
  closed: { he: 'סגורות', en: 'Closed' },
  askedOfMe: { he: 'ממתינות לבדיקתי', en: 'Waiting for my review' },
  mine: { he: 'שהצעתי', en: 'Mine' },
  sentBack: { he: 'הוחזרו לתיקון', en: 'Sent back' },
  saved: { he: 'חיפושים שמורים:', en: 'Saved searches:' },
  sort: { he: 'מיון', en: 'Sort' },
  newest: { he: 'החדשות', en: 'Newest' },
  oldest: { he: 'הישנות', en: 'Oldest' },
  mostComments: { he: 'הכי מדוברות', en: 'Most commented' },
  by: { he: 'על ידי', en: 'by' },
  opened: { he: 'נשלחה', en: 'sent' },
  approvedN: { he: 'אישורים', en: 'approvals' },
  fixes: { he: 'מתקנת', en: 'fixes' },
  nothing: { he: 'אין הצעות כאן', en: 'No suggestions here' },
  nothingHint: { he: 'אפשר לנקות את הסינון, או להציע תיקון מכל עמוד באתר.', en: 'Clear the filters, or suggest a fix from any page.' },
  clear: { he: 'ניקוי הסינון', en: 'Clear filters' },
  more: { he: 'עוד הצעות', en: 'More suggestions' },
  merged: { he: 'אושרה', en: 'Approved' },
  withdrawn: { he: 'בוטלה', en: 'Withdrawn' },
  sentBackBadge: { he: 'הוחזרה', en: 'Sent back' },
  signIn: { he: 'כדי לראות את ההצעות שלכם צריך להיכנס.', en: 'Sign in to see your own suggestions.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

interface Listing {
  suggestions: SuggestionListItem[];
  people: People;
  counts: { open: number; closed: number };
}

export default function Suggestions({ loaderData }: Route.ComponentProps) {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const line = loaderData.line;
  const query = useMemo(() => queryFrom(line), [line]);
  const me = account?.person.username ?? null;
  const needsMe = query.author === '@me' || query.reviewer === '@me';
  const [listing, setListing] = useState<Listing | null>(loaderData.listing);
  const [more, setMore] = useState((loaderData.listing?.suggestions.length ?? 0) >= 30);
  const apiKey = new URLSearchParams(apiOf(query, me)).toString();

  useEffect(() => {
    setListing(loaderData.listing);
    setMore((loaderData.listing?.suggestions.length ?? 0) >= 30);
  }, [loaderData.listing]);
  useEffect(() => {
    if (account === undefined || !needsMe) return;
    if (!me) return setListing(null);
    let live = true;
    void threads<Listing>(`suggestions?${apiKey}`).then(
      (r) => live && (setListing(r), setMore(r.suggestions.length >= 30)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [apiKey, account, me, needsMe]);

  async function loadMore() {
    if (!listing) return;
    const last = listing.suggestions[listing.suggestions.length - 1];
    if (!last) return;
    const next = await threads<Listing>(`suggestions?${apiKey}&before=${last.number}`);
    setListing({ ...listing, suggestions: [...listing.suggestions, ...next.suggestions], people: { ...listing.people, ...next.people } });
    setMore(next.suggestions.length >= 30);
  }

  const to = (next: string) => href('/suggestions', lang, { q: next.trim() || undefined });
  const set = (key: string, value: string | null) => to(withToken(line, KEYS, key, value, lang));
  const items = useMemo(() => {
    const list = [...(listing?.suggestions ?? [])];
    if (query.sort === 'old') list.sort((a, b) => a.number - b.number);
    else if (query.sort === 'comments') list.sort((a, b) => b.comments - a.comments);
    return list;
  }, [listing, query.sort]);
  const people = listing?.people ?? {};
  const presets = [
    ...(account
      ? [
          { name: w(lang, 'askedOfMe'), line: lang === 'he' ? 'מצב:פתוחה בודק:@me' : 'state:open reviewer:@me' },
          { name: w(lang, 'mine'), line: lang === 'he' ? 'מצב:פתוחה מציע:@me' : 'state:open author:@me' },
        ]
      : []),
    { name: w(lang, 'closed'), line: lang === 'he' ? 'מצב:סגורה' : 'state:closed' },
  ];
  const filtered = Object.keys(query.parsed.filters).some((k) => k !== 'state') || Boolean(query.text);

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <div className="phead-row list-head">
            <div>
              <h1 className="page-title">{w(lang, 'title')}</h1>
              <p className="lede">{w(lang, 'lead')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/issues', lang)}>
                <Icon name="report" />
                {w(lang, 'reports')}
                {loaderData.openIssues !== null ? <span className="count">{num(loaderData.openIssues, lang)}</span> : null}
              </Link>
            </div>
          </div>
          <TokenSearch lang={lang} keys={KEYS} defaultValue={line} action={href('/suggestions', lang)} label={w(lang, 'search')} placeholder={w(lang, 'placeholder')} />
          <nav className="saved-row" aria-label={w(lang, 'saved')}>
            <span className="subtle">{w(lang, 'saved')}</span>
            {presets.map((s) => (
              <span key={s.line} className="saved-item">
                <Link to={to(s.line)} aria-current={s.line === line ? 'true' : undefined}>
                  {s.name}
                </Link>
              </span>
            ))}
          </nav>
        </div>
      </div>
      <div className="wrap page list-page">
        <section className="box issues" aria-label={w(lang, 'title')}>
          <header className="box-h list-bar">
            <Link to={set('state', 'open')} className={cx('st-tab', query.state === 'open' && 'on')} aria-current={query.state === 'open' ? 'true' : undefined}>
              <Icon name="suggest" /> <b>{listing ? num(listing.counts.open, lang) : '…'}</b> {w(lang, 'open')}
            </Link>
            <Link to={set('state', 'closed')} className={cx('st-tab', query.state === 'closed' && 'on')} aria-current={query.state === 'closed' ? 'true' : undefined}>
              <Icon name="check" /> {listing ? num(listing.counts.closed, lang) : '…'} {w(lang, 'closed')}
            </Link>
            <span className="end menus">
              <details className="pick fmenu">
                <summary>
                  {w(lang, 'sort')}: {w(lang, query.sort === 'old' ? 'oldest' : query.sort === 'comments' ? 'mostComments' : 'newest')} <Icon name="chevd" size={12} />
                </summary>
                <div className="pop down" role="list">
                  {(['new', 'old', 'comments'] as const).map((s) => (
                    <Link key={s} role="listitem" className="pop-o" to={set('sort', s === 'new' ? null : s)} aria-current={query.sort === s ? 'true' : undefined} preventScrollReset>
                      <Icon name="check" size={14} className={query.sort === s ? '' : 'invisible'} />
                      {w(lang, s === 'old' ? 'oldest' : s === 'comments' ? 'mostComments' : 'newest')}
                    </Link>
                  ))}
                </div>
              </details>
            </span>
          </header>
          {listing === null ? (
            needsMe && account === null ? (
              <EmptyState icon="lock" title={w(lang, 'signIn')} compact actions={<Link className="btn" to={href('/signin', lang, { return: `/suggestions?${params}` })}>{tu(lang, 'signIn')}</Link>} />
            ) : (
              <div className="pad-box">
                <Skeleton rows={6} lang={lang} />
              </div>
            )
          ) : items.length === 0 ? (
            <EmptyState icon="suggest" title={w(lang, 'nothing')} compact actions={filtered ? <Link className="btn sm" to={to('')}>{w(lang, 'clear')}</Link> : undefined}>
              {w(lang, 'nothingHint')}
            </EmptyState>
          ) : (
            <ul className="rows issue-rows">
              {items.map((s) => {
                const author = people[s.author];
                const state = s.status === 'merged' ? 'approved' : s.status === 'withdrawn' || s.status === 'draft' ? 'closed' : 'open';
                return (
                  <li key={s.number} className="row issue-row">
                    <StateIcon kind="suggestion" state={state} label={s.status} />
                    <div className="grow">
                      <div className="row-line">
                        <Link className="row-title" to={href(`/suggestions/${s.number}`, lang)} dir="auto">
                          {s.title}
                        </Link>
                        {s.status === 'sent_back' ? (
                          <StatusBadge state="closed" size="sm" icon="back">
                            {w(lang, 'sentBackBadge')}
                          </StatusBadge>
                        ) : s.status === 'merged' ? (
                          <StatusBadge state="approved" size="sm" icon="check">
                            {w(lang, 'merged')}
                          </StatusBadge>
                        ) : s.status === 'withdrawn' ? (
                          <StatusBadge state="closed" size="sm">
                            {w(lang, 'withdrawn')}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <div className="row-sub">
                        <span className="num">#{s.number}</span> · {w(lang, 'opened')} <RelativeTime at={s.submittedAt ?? s.createdAt} lang={lang} /> {w(lang, 'by')}{' '}
                        {author?.username ? <Link to={href(personPath(author.username), lang)}>{author.name}</Link> : <span>{author?.name ?? s.author}</span>}
                        {s.approvals ? (
                          <span className="st-approved">
                            {' '}
                            · <Icon name="check" size={12} /> {num(s.approvals, lang)} {w(lang, 'approvedN')}
                          </span>
                        ) : null}
                        {s.fixes.length ? (
                          <>
                            {' '}
                            · {w(lang, 'fixes')}{' '}
                            {s.fixes.map((n) => (
                              <Link key={n} to={href(`/issues/${n}`, lang)}>
                                #{n}{' '}
                              </Link>
                            ))}
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="row-side">
                      <span />
                      <span className="assignees">
                        {s.reviewers.map((id) => (
                          <Avatar key={id} name={people[id]?.name ?? id} id={id} size="xs" />
                        ))}
                      </span>
                      {s.comments ? (
                        <Link className="comments subtle" to={href(`/suggestions/${s.number}`, lang)}>
                          <Icon name="discuss" size={14} /> {num(s.comments, lang)}
                        </Link>
                      ) : (
                        <span className="comments" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {more ? (
          <div className="more-row">
            <button type="button" className="btn" onClick={() => void loadMore()}>
              {w(lang, 'more')}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
