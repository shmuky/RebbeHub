import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/issues';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, type Lang } from '../lib/i18n.js';
import { num, tu } from '../lib/i18nUi.js';
import { apiParams, issueKeys, lineOf, queryOf } from '../lib/issueTokens.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { LABELS } from '../lib/suggestions.js';
import { personPath, threads, type Issue, type People } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { withToken } from '../lib/tokens.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import { Avatar, EmptyState, Label, MachineLabel, RelativeTime, Skeleton, StateIcon, cx } from '../ui/primitives.js';

/**
 * Reports (the plan's Report; issues, as GitHub calls them): problems
 * people found, a wrong word, a missing page, a recording cut short.
 * One search line is the filter (`מצב:פתוח תווית:סריקה אחראי:@me`), with
 * the labels, kinds and sets offered as one types and each label's count
 * of open reports; saved searches beside it, the reader's own kept in
 * their browser. Each report says who opened it and when, where it is,
 * its labels, the suggestion that fixes it, who is on it, and how much
 * was said. Public reports are read on the server, so the list works
 * before script and for search engines; a signed-in reader's list is
 * asked again, since some reports are private to those who may read them.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const [labels, templates, sets, open] = await Promise.all([
    api.labels().catch(() => []),
    api.issueTemplates().catch(() => []),
    api.list({ type: 'set', limit: 200 }).then((r) => r.items).catch(() => []),
    api.conversations({ state: 'open', limit: 100 }).catch(() => null),
  ]);
  const setList = sets.map((s) => ({ id: s.id, he: labelOf(s, 'he'), en: labelOf(s, 'en') }));
  const keys = issueKeys(labels, templates, setList);
  const line = lineOf(url.searchParams, keys, lang);
  const query = queryOf(line, keys);
  const mine = query.assignee === '@me' || query.author === '@me';
  const listing = mine ? null : await api.issues({ ...apiParams(query, null), limit: 30 } as never).catch(() => null);
  // Which open suggestion says it fixes each report.
  const fixedBy: Record<number, number[]> = {};
  for (const s of open?.suggestions ?? []) for (const n of s.fixes) (fixedBy[n] ??= []).push(s.number);
  return { lang, siteUrl, labels, templates, sets: setList, line, listing, fixedBy, openSuggestions: open?.counts.open ?? null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'דיווחים' : 'Reports', path: '/issues', lang: loaderData.lang, siteUrl: loaderData.siteUrl, description: loaderData.lang === 'he' ? 'בעיות שהלומדים מצאו: טעות בטקסט, עמוד חסר, הקלטה שנקטעת.' : 'Problems readers found: a wrong word, a missing page, a recording cut short.' });
}

const W = {
  title: { he: 'דיווחים', en: 'Reports' },
  lead: { he: 'בעיות שהלומדים מצאו: טעות בטקסט, עמוד חסר, הקלטה שנקטעת. כל דיווח נבדק על ידי אחראי האוסף.', en: 'Problems readers found: a wrong word, a missing page, a recording cut short. Each report is looked at by the set’s keepers.' },
  newReport: { he: 'דיווח חדש', en: 'New report' },
  suggestions: { he: 'הצעות', en: 'Suggestions' },
  search: { he: 'חיפוש בדיווחים', en: 'Search reports' },
  placeholder: { he: 'אפשר גם לכתוב חופשי: ״עמוד חסר בחלק ג״', en: 'Free text works too: “missing page in volume 3”' },
  open: { he: 'פתוחים', en: 'Open' },
  closed: { he: 'טופלו', en: 'Closed' },
  author: { he: 'מחבר', en: 'Author' },
  labels: { he: 'תוויות', en: 'Labels' },
  assignee: { he: 'אחראי', en: 'Assignee' },
  sort: { he: 'מיון', en: 'Sort' },
  newest: { he: 'החדשים', en: 'Newest' },
  oldest: { he: 'הישנים', en: 'Oldest' },
  mostComments: { he: 'הכי מדוברים', en: 'Most commented' },
  anyone: { he: 'כל אחד', en: 'Anyone' },
  me: { he: 'אני', en: 'Me' },
  nobody: { he: 'ללא אחראי', en: 'Nobody' },
  opened: { he: 'נפתח', en: 'opened' },
  by: { he: 'על ידי', en: 'by' },
  guest: { he: 'אורח', en: 'a guest' },
  closedAt: { he: 'טופל', en: 'closed' },
  inSuggestion: { he: 'בהצעה', en: 'in suggestion' },
  bot: { he: 'בוט', en: 'bot' },
  foundByOcr: { he: 'נמצא ב־OCR', en: 'Found by OCR' },
  saved: { he: 'חיפושים שמורים:', en: 'Saved searches:' },
  save: { he: 'שמירת החיפוש', en: 'Save search' },
  savedDone: { he: 'נשמר', en: 'Saved' },
  forget: { he: 'הסרה מהשמורים', en: 'Remove from saved' },
  assignedToMe: { he: 'משויכים אליי', en: 'Assigned to me' },
  mine: { he: 'שפתחתי', en: 'Opened by me' },
  unassigned: { he: 'ללא אחראי', en: 'Unassigned' },
  scanProblems: { he: 'בעיות סריקה', en: 'Scan problems' },
  nothing: { he: 'אין דיווחים כאן', en: 'No reports here' },
  nothingHint: { he: 'אפשר לנקות את הסינון, או לפתוח דיווח חדש.', en: 'Clear the filters, or open a new report.' },
  clear: { he: 'ניקוי הסינון', en: 'Clear filters' },
  more: { he: 'עוד דיווחים', en: 'More reports' },
  comments: { he: 'תגובות', en: 'comments' },
  fixedByLink: { he: 'מתוקן בהצעה', en: 'Fixed in suggestion' },
  private: { he: 'פרטי', en: 'Private' },
  signInMine: { he: 'כדי לראות את הדיווחים שלכם צריך להיכנס.', en: 'Sign in to see your own reports.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

interface Listing {
  items: Issue[];
  people: People;
  counts: { open: number; closed: number };
}

const SAVED_KEY = 'rebbehub.issues.saved';
function readSaved(): Array<{ name: string; line: string }> {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const list = raw ? (JSON.parse(raw) as Array<{ name: string; line: string }>) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.line === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}
function writeSaved(list: Array<{ name: string; line: string }>) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // A private window: the search is not kept, and the page works the same.
  }
}

export default function Issues({ loaderData }: Route.ComponentProps) {
  const { labels, templates, sets, fixedBy, openSuggestions } = loaderData;
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const keys = useMemo(() => issueKeys(labels, templates, sets), [labels, templates, sets]);
  const line = loaderData.line;
  const query = useMemo(() => queryOf(line, keys), [line, keys]);
  const me = account?.person.username ?? null;
  const needsMe = query.assignee === '@me' || query.author === '@me';
  const [listing, setListing] = useState<Listing | null>(loaderData.listing);
  const [more, setMore] = useState((loaderData.listing?.items.length ?? 0) >= 30);
  const [saved, setSaved] = useState<Array<{ name: string; line: string }>>([]);
  useEffect(() => setSaved(readSaved()), []);

  // A signed-in reader may see private reports, and `@me` is theirs: the list is asked again for them.
  const apiKey = new URLSearchParams(apiParams(query, me)).toString();
  useEffect(() => {
    setListing(loaderData.listing);
    setMore((loaderData.listing?.items.length ?? 0) >= 30);
  }, [loaderData.listing]);
  useEffect(() => {
    if (account === undefined || (!account && !needsMe)) return;
    if (needsMe && !me) {
      setListing({ items: [], people: {}, counts: { open: 0, closed: 0 } });
      return;
    }
    let live = true;
    void threads<Listing>(`issues?${apiKey}`).then(
      (r) => live && (setListing(r), setMore(r.items.length >= 30)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [apiKey, account, me, needsMe]);

  async function loadMore() {
    if (!listing) return;
    const last = listing.items[listing.items.length - 1];
    if (!last) return;
    const next = await threads<Listing>(`issues?${apiKey}&before=${last.number}`);
    setListing({ ...listing, items: [...listing.items, ...next.items], people: { ...listing.people, ...next.people } });
    setMore(next.items.length >= 30);
  }

  const to = (next: string) => href('/issues', lang, { q: next.trim() || undefined });
  const set = (key: string, value: string | null) => to(withToken(line, keys, key, value, lang));
  const items = useMemo(() => {
    const list = [...(listing?.items ?? [])];
    if (query.sort === 'old') list.sort((a, b) => a.number - b.number);
    else if (query.sort === 'comments') list.sort((a, b) => b.comments - a.comments);
    return list;
  }, [listing, query.sort]);
  const people = listing?.people ?? {};
  const presets = [
    ...(account ? [{ name: w(lang, 'assignedToMe'), line: `${lang === 'he' ? 'מצב:פתוח אחראי:@me' : 'state:open assignee:@me'}` }, { name: w(lang, 'mine'), line: `${lang === 'he' ? 'מחבר:@me' : 'author:@me'}` }] : []),
    { name: w(lang, 'unassigned'), line: lang === 'he' ? 'מצב:פתוח אחראי:none' : 'state:open assignee:none' },
    ...(labels.some((l) => l.name === 'scan') ? [{ name: w(lang, 'scanProblems'), line: lang === 'he' ? 'מצב:פתוח תווית:סריקה' : 'state:open label:scan' }] : []),
  ];
  const isSaved = saved.some((s) => s.line === line);
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
              <Link className="btn" to={href('/suggestions', lang)}>
                <Icon name="suggest" />
                {w(lang, 'suggestions')}
                {openSuggestions !== null ? <span className="count">{num(openSuggestions, lang)}</span> : null}
              </Link>
              <Link className="btn primary" to={href('/issues/new', lang)}>
                <Icon name="plus" />
                {w(lang, 'newReport')}
              </Link>
            </div>
          </div>
          <TokenSearch
            lang={lang}
            keys={keys}
            defaultValue={line}
            action={href('/issues', lang)}
            label={w(lang, 'search')}
            placeholder={w(lang, 'placeholder')}
            after={
              <button
                type="button"
                className={cx('btn', isSaved && 'on')}
                aria-pressed={isSaved}
                onClick={() => {
                  const next = isSaved ? saved.filter((s) => s.line !== line) : [...saved, { name: query.text || line.replace(/^(מצב|state):\S+\s*/, '') || line, line }];
                  setSaved(next);
                  writeSaved(next);
                }}
              >
                <Icon name="star" />
                {isSaved ? w(lang, 'savedDone') : w(lang, 'save')}
              </button>
            }
          />
          <nav className="saved-row" aria-label={w(lang, 'saved')}>
            <span className="subtle">{w(lang, 'saved')}</span>
            {[...presets, ...saved].map((s) => (
              <span key={s.line} className="saved-item">
                <Link to={to(s.line)} aria-current={s.line === line ? 'true' : undefined}>
                  {s.name}
                </Link>
                {saved.includes(s) ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${w(lang, 'forget')}: ${s.name}`}
                    onClick={() => {
                      const next = saved.filter((x) => x !== s);
                      setSaved(next);
                      writeSaved(next);
                    }}
                  >
                    <Icon name="x" size={12} />
                  </button>
                ) : null}
              </span>
            ))}
          </nav>
        </div>
      </div>
      <div className="wrap page list-page">
        <section className="box issues" aria-label={w(lang, 'title')}>
          <header className="box-h list-bar">
            <Link to={set('state', 'open')} className={cx('st-tab', query.state === 'open' && 'on')} aria-current={query.state === 'open' ? 'true' : undefined}>
              <Icon name="report" /> <b>{listing ? num(listing.counts.open, lang) : '…'}</b> {w(lang, 'open')}
            </Link>
            <Link to={set('state', 'closed')} className={cx('st-tab', query.state === 'closed' && 'on')} aria-current={query.state === 'closed' ? 'true' : undefined}>
              <Icon name="check" /> {listing ? num(listing.counts.closed, lang) : '…'} {w(lang, 'closed')}
            </Link>
            <span className="end menus">
              <Menu label={w(lang, 'author')} lang={lang}>
                <MenuItem to={set('author', null)} on={!query.author}>
                  {w(lang, 'anyone')}
                </MenuItem>
                {account ? (
                  <MenuItem to={set('author', '@me')} on={query.author === '@me'}>
                    {w(lang, 'me')}
                  </MenuItem>
                ) : null}
                {peopleOf(listing?.items ?? [], people, 'author').map((p) => (
                  <MenuItem key={p.handle} to={set('author', p.handle)} on={query.author === p.handle}>
                    <Avatar name={p.name} id={p.id} size="xs" /> {p.name}
                  </MenuItem>
                ))}
              </Menu>
              <Menu label={w(lang, 'labels')} lang={lang}>
                {labels.map((l) => (
                  <MenuItem key={l.name} to={query.label.includes(l.name) ? to(line.replace(new RegExp(`\\s*(תווית|label):${LABELS[l.name]?.[lang] ?? l.name}`), '')) : to(`${line} ${lang === 'he' ? 'תווית' : 'label'}:${LABELS[l.name]?.[lang] ?? l.name}`)} on={query.label.includes(l.name)}>
                    <Label color={`#${l.color.replace('#', '')}`}>{LABELS[l.name]?.[lang] ?? l.name}</Label>
                    <span className="c">{num((l as { open?: number }).open ?? 0, lang)}</span>
                  </MenuItem>
                ))}
              </Menu>
              <Menu label={w(lang, 'assignee')} lang={lang}>
                <MenuItem to={set('assignee', null)} on={!query.assignee}>
                  {w(lang, 'anyone')}
                </MenuItem>
                <MenuItem to={set('assignee', 'none')} on={query.assignee === 'none'}>
                  {w(lang, 'nobody')}
                </MenuItem>
                {account ? (
                  <MenuItem to={set('assignee', '@me')} on={query.assignee === '@me'}>
                    {w(lang, 'me')}
                  </MenuItem>
                ) : null}
                {peopleOf(listing?.items ?? [], people, 'assignees').map((p) => (
                  <MenuItem key={p.handle} to={set('assignee', p.handle)} on={query.assignee === p.handle}>
                    <Avatar name={p.name} id={p.id} size="xs" /> {p.name}
                  </MenuItem>
                ))}
              </Menu>
              <Menu label={`${w(lang, 'sort')}: ${w(lang, query.sort === 'old' ? 'oldest' : query.sort === 'comments' ? 'mostComments' : 'newest')}`} lang={lang}>
                <MenuItem to={set('sort', null)} on={query.sort === 'new'}>
                  {w(lang, 'newest')}
                </MenuItem>
                <MenuItem to={set('sort', 'old')} on={query.sort === 'old'}>
                  {w(lang, 'oldest')}
                </MenuItem>
                <MenuItem to={set('sort', 'comments')} on={query.sort === 'comments'}>
                  {w(lang, 'mostComments')}
                </MenuItem>
              </Menu>
            </span>
          </header>
          {listing === null ? (
            needsMe && account === null ? (
              <EmptyState icon="lock" title={w(lang, 'signInMine')} compact actions={<Link className="btn" to={href('/signin', lang, { return: `/issues?${params}` })}>{tu(lang, 'signIn')}</Link>} />
            ) : (
              <div className="pad-box">
                <Skeleton rows={6} lang={lang} />
              </div>
            )
          ) : items.length === 0 ? (
            <EmptyState
              icon="report"
              title={w(lang, 'nothing')}
              compact
              actions={
                <>
                  {filtered ? (
                    <Link className="btn sm" to={to(lang === 'he' ? 'מצב:פתוח' : 'state:open')}>
                      {w(lang, 'clear')}
                    </Link>
                  ) : null}
                  <Link className="btn sm primary" to={href('/issues/new', lang)}>
                    {w(lang, 'newReport')}
                  </Link>
                </>
              }
            >
              {w(lang, 'nothingHint')}
            </EmptyState>
          ) : (
            <ul className="rows issue-rows">
              {items.map((issue) => (
                issueRow(issue, fixedBy[issue.number] ?? [])
              ))}
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

  function issueRow(issue: Issue, fixes: number[]) {
    const author = issue.author ? people[issue.author] : null;
    const bot = Boolean(author?.bot);
    const state = issue.state === 'open' ? 'open' : issue.stateReason === 'not_planned' ? 'closed' : 'approved';
    const where = issue.entity ? nameOf(issue.entity.name as never, lang) || issue.entity.id : null;
    const closer = issue.closedBy ? people[issue.closedBy] : null;
    return (
      <li key={issue.number} className="row issue-row">
        <StateIcon kind="report" state={state} label={issue.state === 'open' ? w(lang, 'open') : w(lang, 'closed')} />
        <div className="grow">
          <div className="row-line">
            <Link className="row-title" to={href(`/issues/${issue.number}`, lang)} dir="auto">
              {issue.title ?? issue.typeTitle[lang]}
            </Link>
            {issue.private ? (
              <span className="badge-private">
                <Icon name="lock" size={11} /> {w(lang, 'private')}
              </span>
            ) : null}
            {issue.labels.map((l) => (
              <Label key={l.name} color={`#${l.color.replace('#', '')}`} to={set('label', l.name)} size="sm">
                {LABELS[l.name]?.[lang] ?? l.name}
              </Label>
            ))}
            {bot && issue.type === 'wrong-text' ? <MachineLabel lang={lang} size="sm">{w(lang, 'foundByOcr')}</MachineLabel> : null}
          </div>
          <div className="row-sub">
            <span className="num">#{issue.number}</span>
            {' · '}
            {issue.state === 'open' || !issue.closedAt ? (
              <>
                {w(lang, 'opened')} <RelativeTime at={issue.createdAt} lang={lang} /> {w(lang, 'by')}{' '}
                {author?.username ? (
                  <Link to={href(personPath(author.username), lang)}>{author.name}</Link>
                ) : (
                  <span>{author?.name ?? w(lang, 'guest')}</span>
                )}
                {bot ? <span className="bot-tag">{w(lang, 'bot')}</span> : null}
              </>
            ) : (
              <>
                {w(lang, 'closedAt')} <RelativeTime at={issue.closedAt} lang={lang} />
                {issue.closedBySuggestion ? (
                  <>
                    {' '}
                    {w(lang, 'inSuggestion')} <Link to={href(`/suggestions/${issue.closedBySuggestion}`, lang)}>#{issue.closedBySuggestion}</Link>
                  </>
                ) : null}
                {closer ? (
                  <>
                    {' '}
                    {w(lang, 'by')} {closer.name}
                  </>
                ) : null}
              </>
            )}
            {where ? (
              <>
                {' · '}
                {issue.entity?.path || issue.entity?.id ? <Link to={href(issue.entity.path ?? `/${issue.entity.id}`, lang)}>{where}</Link> : where}
              </>
            ) : null}
            {' · '}
            <Link to={set('type', issue.type)} className="subtle">
              {issue.typeTitle[lang]}
            </Link>
          </div>
        </div>
        <div className="row-side">
          {fixes.map((n) => (
            <Link key={n} className="fix-link" to={href(`/suggestions/${n}`, lang)} title={w(lang, 'fixedByLink')}>
              <Icon name="suggest" size={14} className="st-open" />#{n}
            </Link>
          ))}
          <span className="assignees">
            {issue.assignees.map((id) => (
              <Avatar key={id} name={people[id]?.name ?? id} id={id} size="xs" />
            ))}
          </span>
          {issue.comments ? (
            <Link className="comments subtle" to={href(`/issues/${issue.number}`, lang)} aria-label={`${issue.comments} ${w(lang, 'comments')}`}>
              <Icon name="discuss" size={14} /> {num(issue.comments, lang)}
            </Link>
          ) : (
            <span className="comments" />
          )}
        </div>
      </li>
    );
  }
}

/** People who wrote (or are on) the reports listed, to filter by. */
function peopleOf(items: Issue[], people: People, field: 'author' | 'assignees') {
  const ids = new Set(items.flatMap((i) => (field === 'author' ? (i.author ? [i.author] : []) : i.assignees)));
  return [...ids]
    .map((id) => ({ id, handle: people[id]?.username ?? '', name: people[id]?.name ?? id }))
    .filter((p) => p.handle)
    .slice(0, 12);
}

/** A filter's menu over the list: links that put the filter into the search line. */
function Menu({ label, children }: { label: string; lang: Lang; children: React.ReactNode }) {
  return (
    <details className="pick fmenu">
      <summary>
        {label} <Icon name="chevd" size={12} />
      </summary>
      <div className="pop down" role="list">
        {children}
      </div>
    </details>
  );
}

function MenuItem({ to, on, children }: { to: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link role="listitem" className="pop-o" to={to} aria-current={on ? 'true' : undefined} preventScrollReset>
      <Icon name="check" size={14} className={on ? '' : 'invisible'} />
      {children}
    </Link>
  );
}

