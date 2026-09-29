import { ChevronDown, CircleCheck, CircleDot, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/issues';
import { IssueIcon, LabelChip, PersonLink, PrivateBadge, TimeAgo } from '../components/threads/Bits.js';
import { Picker } from '../components/threads/Picker.js';
import { loadPeople } from '../components/threads/Side.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threads, type Issue, type IssueLabel, type IssueTemplate, type People } from '../lib/threads.js';
import { tt, type ThreadStringKey } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Issues (Reports), as GitHub lists them: open or closed with their
 * counts, and narrowed by label, kind, set, who it is assigned to, who
 * wrote it, or words. The filters live in the address, so a filtered list
 * can be shared. Filled in by the browser: private issues are listed only
 * for those who may read them.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'דיווחים' : 'Issues', path: '/issues', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

interface Listing {
  items: Issue[];
  people: People;
  counts: { open: number; closed: number };
}

const FILTERS = ['state', 'label', 'type', 'set', 'assignee', 'author', 'q'] as const;

export default function Issues() {
  const lang = useLang();
  const account = useAccount();
  const [params, setParams] = useSearchParams();
  const [listing, setListing] = useState<Listing | null>(null);
  const [more, setMore] = useState(false);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [templates, setTemplates] = useState<IssueTemplate[]>([]);
  const [q, setQ] = useState(params.get('q') ?? '');
  const state = params.get('state') === 'closed' ? 'closed' : 'open';

  const query = new URLSearchParams();
  for (const name of FILTERS) {
    const value = params.get(name);
    if (value) query.set(name, value);
  }
  query.set('state', state);
  const key = query.toString();

  useEffect(() => {
    if (account === undefined) return;
    let live = true;
    setListing(null);
    void threads<Listing>(`issues?${key}`).then(
      (r) => live && (setListing(r), setMore(r.items.length >= 30)),
      () => live && setListing({ items: [], people: {}, counts: { open: 0, closed: 0 } }),
    );
    return () => {
      live = false;
    };
  }, [key, account]);

  useEffect(() => {
    void threads<{ labels: IssueLabel[] }>('labels').then((r) => setLabels(r.labels), () => undefined);
    void threads<{ templates: IssueTemplate[] }>('issues/templates').then((r) => setTemplates(r.templates), () => undefined);
  }, []);

  function set(name: (typeof FILTERS)[number], value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { preventScrollReset: true });
  }

  async function loadMore() {
    if (!listing) return;
    const last = listing.items[listing.items.length - 1];
    if (!last) return;
    const next = await threads<Listing>(`issues?${key}&before=${last.number}`);
    setListing({ ...listing, items: [...listing.items, ...next.items], people: { ...listing.people, ...next.people } });
    setMore(next.items.length >= 30);
  }

  const stateLink = (to: 'open' | 'closed') => {
    const next = new URLSearchParams(params);
    if (to === 'closed') next.set('state', 'closed');
    else next.delete('state');
    return `/issues?${next}`;
  };
  const filtered = FILTERS.some((f) => f !== 'state' && params.get(f));
  const chip = (name: (typeof FILTERS)[number], label: ThreadStringKey, load: (q: string) => Promise<Array<{ value: string; label: string; hint?: string; swatch?: string }>>) => (
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
      load={load}
      onApply={(values) => set(name, values[0] ?? null)}
    />
  );

  return (
    <div className="th-page">
      <div className="th-head">
        <div>
          <h1>{tt(lang, 'issuesTitle')}</h1>
          <p className="subtitle">{tt(lang, 'issuesLead')}</p>
        </div>
        <Link className="button" to={href('/issues/new', lang)}>
          {tt(lang, 'newIssue')}
        </Link>
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
        {chip('label', 'filterLabel', async (text) => labels.filter((l) => l.name.includes(text.toLowerCase())).map((l) => ({ value: l.name, label: l.name, hint: l.description ?? undefined, swatch: l.color })))}
        {chip('type', 'filterType', async (text) => templates.filter((t) => t.label[lang].includes(text) || t.type.includes(text)).map((t) => ({ value: t.type, label: t.label[lang] })))}
        {chip('assignee', 'filterAssignee', async (text) => [...(text ? [] : [{ value: 'none', label: tt(lang, 'nobody') }]), ...(await loadPeople(text))])}
        {chip('author', 'filterAuthor', (text) => loadPeople(text))}
        {filtered ? (
          <Link to={href('/issues', lang, { state: state === 'closed' ? 'closed' : undefined })} className="th-hint">
            {tt(lang, 'clearFilters')}
          </Link>
        ) : null}
      </form>
      {params.get('set') ? (
        <p className="th-hint">
          {tt(lang, 'filterSet')}: {params.get('set')} · <button type="button" className="link-button" onClick={() => set('set', null)}>{tt(lang, 'clearFilters')}</button>
        </p>
      ) : null}
      <div className="th-list">
        <div className="th-list-head">
          <Link to={stateLink('open')} aria-current={state === 'open' ? 'page' : undefined} preventScrollReset>
            <CircleDot size={14} aria-hidden="true" /> {listing?.counts.open ?? '…'} {tt(lang, 'stateOpen')}
          </Link>
          <Link to={stateLink('closed')} aria-current={state === 'closed' ? 'page' : undefined} preventScrollReset>
            <CircleCheck size={14} aria-hidden="true" /> {listing?.counts.closed ?? '…'} {tt(lang, 'stateClosed')}
          </Link>
        </div>
        {listing === null ? (
          <p className="note" style={{ padding: '0.75rem' }}>…</p>
        ) : listing.items.length === 0 ? (
          <p className="note" style={{ padding: '0.75rem' }}>{tt(lang, 'nothingHere')}</p>
        ) : (
          <ul className="th-rows">
            {listing.items.map((issue) => (
              <li key={issue.number} className="th-row">
                <IssueIcon state={issue.state} reason={issue.stateReason} />
                <div>
                  <Link className="th-row-title" to={href(`/issues/${issue.number}`, lang)} dir="auto">
                    {issue.title ?? issue.typeTitle[lang]}
                  </Link>
                  {issue.private ? <PrivateBadge lang={lang} /> : null}{' '}
                  {issue.labels.map((l) => (
                    <LabelChip key={l.name} label={l} to={href('/issues', lang, { label: l.name })} />
                  ))}
                  <div className="th-meta">
                    #{issue.number} · <PersonLink id={issue.author} people={listing.people} lang={lang} className="" /> · <TimeAgo at={issue.createdAt} lang={lang} /> ·{' '}
                    <Link to={href('/issues', lang, { type: issue.type })} className="th-time">
                      {issue.typeTitle[lang]}
                    </Link>
                  </div>
                </div>
                <div className="th-row-side">
                  {issue.assignees.map((id) => (
                    <PersonLink key={id} id={id} people={listing.people} lang={lang} className="" />
                  ))}
                  {issue.comments ? (
                    <span>
                      <MessageSquare size={14} aria-hidden="true" /> {issue.comments}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {more ? (
        <button type="button" className="secondary" onClick={() => void loadMore()}>
          {tt(lang, 'more')}
        </button>
      ) : null}
    </div>
  );
}
