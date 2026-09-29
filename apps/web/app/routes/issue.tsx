import type { LocalName } from '@rebbehub/model';
import { Pencil, Settings } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/issue';
import { IssueState, LabelChip, PersonLink, PrivateBadge, TimeAgo } from '../components/threads/Bits.js';
import { Composer } from '../components/threads/Composer.js';
import { Picker } from '../components/threads/Picker.js';
import { RichText } from '../components/threads/RichText.js';
import { loadPeople, SubscribeBox, useReadOnOpen } from '../components/threads/Side.js';
import { Timeline } from '../components/threads/Timeline.js';
import { langFrom, nameOf } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threads, ThreadsError, type Issue, type IssueLabel, type IssueRights, type People, type TimelineItem } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * One issue (a Report, numbered with the suggestions: #12), as on GitHub:
 * its title and words, the conversation, and beside it the people it is
 * assigned to, its labels, the suggestions that will close it, and
 * following it. Closed as done or as not planned, reopened, made private
 * by a steward. Filled in by the browser, since a private issue is only
 * there for those who may read it; a suggestion's number goes on to the
 * suggestion's own page.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  if (!/^\d{1,9}$/.test(params.number)) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin, number: Number(params.number) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: `#${loaderData.number}`, path: `/issues/${loaderData.number}`, lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

interface Detail {
  issue: Issue;
  rights: IssueRights;
  timeline: TimelineItem[];
  people: People;
  fixedBy: Array<{ number: number; title: string; status: string }>;
  subscribed: boolean;
}

export default function IssuePage({ loaderData }: Route.ComponentProps) {
  const { number } = loaderData;
  const lang = useLang();
  const account = useAccount();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [labels, setLabels] = useState<IssueLabel[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await threads<Detail>(`issues/${number}`));
    } catch (e) {
      if (e instanceof ThreadsError && e.status === 404) {
        // #12 may be a suggestion: its page is elsewhere.
        const thread = await threads<{ kind: string }>(`threads/${number}`).catch(() => null);
        if (thread?.kind === 'suggestion') return void navigate(href(`/suggestions/${number}`, lang), { replace: true });
        setMissing(true);
      } else setError(e instanceof Error ? e.message : String(e));
    }
  }, [number, lang, navigate]);

  // Asked again once it is known who is reading: a private issue opens to its readers.
  useEffect(() => {
    if (account !== undefined) void load();
  }, [load, account]);
  useEffect(() => {
    void threads<{ labels: IssueLabel[] }>('labels').then((r) => setLabels(r.labels), () => undefined);
  }, []);
  useReadOnOpen('report', detail?.issue.id ?? null, Boolean(account));

  if (missing) return <p className="note">{lang === 'he' ? `לא נמצא #${number}.` : `#${number} not found.`}</p>;
  if (!detail) return error ? <p className="th-error">{error}</p> : <p className="note">…</p>;

  const { issue, rights, people } = detail;
  const viewer = account?.person.id ?? null;
  const title = issue.title ?? issue.typeTitle[lang];

  async function act<T>(run: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const comment = () => act(() => threads(`issues/${number}/comments`, { body: { body: draft.trim() } })).then((ok) => ok && setDraft(''));
  const setState = (state: 'open' | 'completed' | 'not_planned') =>
    act(async () => {
      // "Close with comment": the words first, then the state, as GitHub does.
      if (draft.trim()) await threads(`issues/${number}/comments`, { body: { body: draft.trim() } });
      await threads(`issues/${number}/state`, { body: { state } });
      setDraft('');
    });

  const assigneeNames = issue.assignees.map((id) => people[id]?.username ?? id);
  return (
    <div className="th-page">
      <IssueHeader issue={issue} title={title} rights={rights} people={people} lang={lang} onSave={(t) => act(() => threads(`issues/${number}`, { method: 'PATCH', body: { title: t } }))} />
      <div className="th-layout">
        <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
          <IssueBody issue={issue} people={people} lang={lang} mayEdit={rights.edit} onSave={(body) => act(() => threads(`issues/${number}`, { method: 'PATCH', body: { body } }))} />
          <Timeline
            items={detail.timeline.filter((i) => !(i.type === 'event' && i.kind === 'opened'))}
            people={people}
            lang={lang}
            viewer={viewer}
            thread={`report:${issue.id}`}
            labels={labels}
            mayReply={Boolean(account) && rights.comment}
            reply={(body, parent) => threads(`issues/${number}/comments`, { body: { body, parent } })}
            changed={() => void load()}
          />
          {account && rights.comment ? (
            <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void comment()} submitLabel={tt(lang, 'comment')} busy={busy} thread={`report:${issue.id}`} error={error}>
              {rights.close && issue.state === 'open' ? (
                <>
                  <button type="button" className="secondary" disabled={busy} onClick={() => void setState('completed')}>
                    {tt(lang, draft.trim() ? 'closeWithComment' : 'closeDone')}
                  </button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => void setState('not_planned')}>
                    {tt(lang, 'closeNotPlanned')}
                  </button>
                </>
              ) : null}
              {rights.close && issue.state === 'closed' ? (
                <button type="button" className="secondary" disabled={busy} onClick={() => void setState('open')}>
                  {tt(lang, 'reopen')}
                </button>
              ) : null}
            </Composer>
          ) : account === null ? (
            <p className="note">
              <Link to={href('/signin', lang, { return: `/issues/${number}` })}>{tt(lang, 'signInToJoin')}</Link>
            </p>
          ) : null}
        </div>
        <aside className="th-side">
          <section>
            <h2>
              {tt(lang, 'assignees')}
              {account && rights.comment ? (
                <Picker
                  lang={lang}
                  title={tt(lang, 'assignees')}
                  button={<Settings size={14} aria-label={tt(lang, 'assignees')} />}
                  selected={assigneeNames}
                  load={(q) => loadPeople(q, `report:${issue.id}`)}
                  onApply={(values) => void act(() => threads(`issues/${number}/assignees`, { method: 'PUT', body: { assignees: values } }))}
                />
              ) : null}
            </h2>
            {issue.assignees.length ? (
              <ul>
                {issue.assignees.map((id) => (
                  <li key={id}>
                    <PersonLink id={id} people={people} lang={lang} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="th-hint">
                {tt(lang, 'noAssignees')}
                {account ? (
                  <>
                    {' — '}
                    <button type="button" className="link-button" onClick={() => void act(() => threads(`issues/${number}/assignees`, { method: 'PUT', body: { assignees: [account.person.username ?? account.person.id] } }))}>
                      {tt(lang, 'assignYourself')}
                    </button>
                  </>
                ) : null}
              </p>
            )}
          </section>
          <section>
            <h2>
              {tt(lang, 'labels')}
              {rights.triage ? (
                <Picker
                  lang={lang}
                  title={tt(lang, 'labels')}
                  button={<Settings size={14} aria-label={tt(lang, 'labels')} />}
                  selected={issue.labels.map((l) => l.name)}
                  load={async (q) => labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase())).map((l) => ({ value: l.name, label: l.name, hint: l.description ?? undefined, swatch: l.color }))}
                  onApply={(values) => void act(() => threads(`issues/${number}/labels`, { method: 'PUT', body: { labels: values } }))}
                />
              ) : null}
            </h2>
            {issue.labels.length ? (
              <div className="th-labels">
                {issue.labels.map((l) => (
                  <LabelChip key={l.name} label={l} to={href('/issues', lang, { label: l.name })} />
                ))}
              </div>
            ) : (
              <p className="th-hint">{tt(lang, 'noLabels')}</p>
            )}
          </section>
          <section>
            <h2>{tt(lang, 'typeOf')}</h2>
            <Link to={href('/issues', lang, { type: issue.type })}>{issue.typeTitle[lang]}</Link>
          </section>
          {issue.entity ? (
            <section>
              <h2>{tt(lang, 'aboutItem')}</h2>
              <Link to={href(itemPath(issue.entity), lang)}>{nameOf(issue.entity.name as LocalName, lang) || issue.entity.id}</Link>
            </section>
          ) : null}
          <section>
            <h2>{tt(lang, 'fixedBy')}</h2>
            {detail.fixedBy.length ? (
              <ul>
                {detail.fixedBy.map((s) => (
                  <li key={s.number}>
                    <Link className="th-ref" to={href(`/suggestions/${s.number}`, lang)}>
                      #{s.number}
                    </Link>{' '}
                    {s.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="th-hint">{tt(lang, 'fixesHint')}</p>
            )}
          </section>
          <SubscribeBox lang={lang} kind="report" id={issue.id} subscribed={detail.subscribed} signedIn={Boolean(account)} />
          {rights.moderate ? (
            <section>
              <button type="button" className="secondary" disabled={busy} onClick={() => void act(() => threads(`issues/${number}/visibility`, { body: { private: !issue.private } }))}>
                {tt(lang, issue.private ? 'makePublic' : 'makePrivate')}
              </button>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function IssueHeader({ issue, title, rights, people, lang, onSave }: { issue: Issue; title: string; rights: IssueRights; people: People; lang: 'he' | 'en'; onSave: (title: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  return (
    <header style={{ display: 'grid', gap: '0.5rem', borderBlockEnd: '1px solid var(--border)', paddingBlockEnd: '0.75rem' }}>
      <div className="th-head">
        {editing ? (
          <form
            className="th-filters"
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              void onSave(value.trim()).then((ok) => ok && setEditing(false));
            }}
          >
            <input type="search" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} aria-label={tt(lang, 'title')} autoFocus dir="auto" />
            <button type="submit">{tt(lang, 'save')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {tt(lang, 'cancel')}
            </button>
          </form>
        ) : (
          <>
            <h1 dir="auto">
              {title} <span className="th-number">#{issue.number}</span>
            </h1>
            {rights.edit ? (
              <button type="button" className="secondary" onClick={() => (setValue(title), setEditing(true))}>
                {tt(lang, 'edit')}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="th-meta">
        <IssueState state={issue.state} reason={issue.stateReason} lang={lang} />
        {issue.private ? <PrivateBadge lang={lang} /> : null}
        <span>
          <PersonLink id={issue.author} people={people} lang={lang} /> {tt(lang, 'opened')} <TimeAgo at={issue.createdAt} lang={lang} /> · {issue.comments} {tt(lang, 'statComments')}
        </span>
      </div>
    </header>
  );
}

/** The issue's own words, as its first card; who sent it (or a keeper) may change them. */
function IssueBody({ issue, people, lang, mayEdit, onSave }: { issue: Issue; people: People; lang: 'he' | 'en'; mayEdit: boolean; onSave: (body: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(issue.body ?? '');
  return (
    <article className="th-card">
      <header className="th-card-head">
        <PersonLink id={issue.author} people={people} lang={lang} /> {tt(lang, 'opened')} <TimeAgo at={issue.createdAt} lang={lang} />
        <span className="th-spacer" />
        {mayEdit && !editing ? (
          <button type="button" className="link-button" onClick={() => (setValue(issue.body ?? ''), setEditing(true))}>
            <Pencil size={12} aria-hidden="true" /> {tt(lang, 'edit')}
          </button>
        ) : null}
      </header>
      <div className="th-card-body">
        {editing ? (
          <Composer lang={lang} value={value} onChange={setValue} onSubmit={() => void onSave(value.trim()).then((ok) => ok && setEditing(false))} submitLabel={tt(lang, 'save')} thread={`report:${issue.id}`} autoFocus>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {tt(lang, 'cancel')}
            </button>
          </Composer>
        ) : issue.body ? (
          <RichText text={issue.body} lang={lang} />
        ) : (
          <p className="th-empty">{tt(lang, 'noDescription')}</p>
        )}
      </div>
    </article>
  );
}
