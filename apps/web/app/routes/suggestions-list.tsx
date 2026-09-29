import { ChevronDown, CircleCheck, GitPullRequest, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/suggestions-list';
import { PersonLink, SuggestionIcon, SuggestionState, TimeAgo } from '../components/threads/Bits.js';
import { Picker } from '../components/threads/Picker.js';
import { loadPeople } from '../components/threads/Side.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threads, type People, type SuggestionListItem } from '../lib/threads.js';
import { tt, type ThreadStringKey } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Suggestions as GitHub lists pull requests: open (waiting for review, or
 * sent back for changes) or closed (merged or withdrawn), with who wrote
 * each, who is asked to review it, its approvals and comments, and the
 * issues it closes. "Asked of me" is the reviewer's own queue. The review
 * page (/review) stays the keepers' quick way through the queue.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'הצעות' : 'Suggestions', path: '/suggestions', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

interface Listing {
  suggestions: SuggestionListItem[];
  people: People;
  counts: { open: number; closed: number };
}

const FILTERS = ['state', 'author', 'reviewer', 'q'] as const;

export default function Suggestions() {
  const lang = useLang();
  const account = useAccount();
  const [params, setParams] = useSearchParams();
  const [listing, setListing] = useState<Listing | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const state = params.get('state') === 'closed' ? 'closed' : 'open';
  const query = new URLSearchParams();
  for (const name of FILTERS) if (params.get(name)) query.set(name, params.get(name)!);
  query.set('state', state);
  const key = query.toString();
  const me = account?.person.username;

  useEffect(() => {
    let live = true;
    setListing(null);
    void threads<Listing>(`suggestions?${key}`).then(
      (r) => live && setListing(r),
      () => live && setListing({ suggestions: [], people: {}, counts: { open: 0, closed: 0 } }),
    );
    return () => {
      live = false;
    };
  }, [key]);

  function set(name: (typeof FILTERS)[number], value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { preventScrollReset: true });
  }
  const stateLink = (to: 'open' | 'closed') => {
    const next = new URLSearchParams(params);
    if (to === 'closed') next.set('state', 'closed');
    else next.delete('state');
    return `/suggestions?${next}`;
  };
  const chip = (name: 'author' | 'reviewer', label: ThreadStringKey) => (
    <Picker
      lang={lang}
      single
      title={tt(lang, label)}
      buttonClass={`th-chip-button${params.get(name) ? ' active' : ''}`}
      button={
        <>
          {tt(lang, label)}
          {params.get(name) ? `: ${params.get(name)}` : ''} <ChevronDown size={12} aria-hidden="true" />
        </>
      }
      selected={params.get(name) ? [params.get(name)!] : []}
      load={(text) => loadPeople(text)}
      onApply={(values) => set(name, values[0] ?? null)}
    />
  );

  return (
    <div className="th-page">
      <div className="th-head">
        <div>
          <h1>{tt(lang, 'suggestionsTitle')}</h1>
          <p className="subtitle">{tt(lang, 'suggestionsLead')}</p>
        </div>
      </div>
      <form
        className="th-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set('q', q.trim() || null);
        }}
      >
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt(lang, 'search')} aria-label={tt(lang, 'search')} dir="auto" />
        {me ? (
          <button type="button" className={`th-chip-button${params.get('reviewer') === me ? ' active' : ''}`} onClick={() => set('reviewer', params.get('reviewer') === me ? null : me)}>
            {tt(lang, 'reasonReviewRequested')}
          </button>
        ) : null}
        {chip('author', 'filterAuthor')}
        {chip('reviewer', 'filterReviewer')}
      </form>
      <div className="th-list">
        <div className="th-list-head">
          <Link to={stateLink('open')} aria-current={state === 'open' ? 'page' : undefined} preventScrollReset>
            <GitPullRequest size={14} aria-hidden="true" /> {listing?.counts.open ?? '…'} {tt(lang, 'stateOpen')}
          </Link>
          <Link to={stateLink('closed')} aria-current={state === 'closed' ? 'page' : undefined} preventScrollReset>
            <CircleCheck size={14} aria-hidden="true" /> {listing?.counts.closed ?? '…'} {tt(lang, 'stateClosed')}
          </Link>
        </div>
        {listing === null ? (
          <p className="note" style={{ padding: '0.75rem' }}>…</p>
        ) : listing.suggestions.length === 0 ? (
          <p className="note" style={{ padding: '0.75rem' }}>{tt(lang, 'nothingHere')}</p>
        ) : (
          <ul className="th-rows">
            {listing.suggestions.map((s) => (
              <li key={s.number} className="th-row">
                <SuggestionIcon status={s.status} />
                <div>
                  <Link className="th-row-title" to={href(`/suggestions/${s.number}`, lang)} dir="auto">
                    {s.title}
                  </Link>
                  {s.status === 'sent_back' ? <SuggestionState status={s.status} lang={lang} small /> : null}
                  <div className="th-meta">
                    #{s.number} · <PersonLink id={s.author} people={listing.people} lang={lang} className="" /> · <TimeAgo at={s.submittedAt ?? s.createdAt} lang={lang} />
                    {s.approvals ? <span>· <CircleCheck size={12} className="th-icon open" aria-hidden="true" /> {s.approvals}</span> : null}
                    {s.fixes.length ? (
                      <span>
                        · {tt(lang, 'fixes')}{' '}
                        {s.fixes.map((n) => (
                          <Link key={n} className="th-ref" to={href(`/issues/${n}`, lang)}>
                            #{n}{' '}
                          </Link>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="th-row-side">
                  {s.reviewers.map((id) => (
                    <PersonLink key={id} id={id} people={listing.people} lang={lang} className="" />
                  ))}
                  {s.comments ? (
                    <span>
                      <MessageSquare size={14} aria-hidden="true" /> {s.comments}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
