import type { LocalName } from '@rebbehub/model';
import { useCallback, useEffect, useState } from 'react';
import { data, Link, redirect } from 'react-router';
import type { Route } from './+types/issue';
import { Composer } from '../components/threads/Composer.js';
import { Picker } from '../components/threads/Picker.js';
import { RichText } from '../components/threads/RichText.js';
import { loadPeople, useReadOnOpen } from '../components/threads/Side.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { LABELS } from '../lib/suggestions.js';
import { threads, ThreadsError, type Issue, type IssueLabel, type IssueRights, type People, type TimelineItem } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { ReviewBox, type ReviewChoice } from '../ui/ReviewBox.js';
import { Timeline, TimelineBlock, TimelineComment } from '../ui/Timeline.js';
import { Avatar, Breadcrumbs, EmptyState, Label, MachineLabel, Skeleton, StatusBadge, type State } from '../ui/primitives.js';
import { Conversation, FollowToggle, Person, When } from '../views/Conversation.js';

/**
 * One Report, numbered with the suggestions (#12), as an issue's page is
 * on GitHub: its title and state, who opened it about what; its words and
 * everything said and done since down one line, and the box to answer it
 * (and close it as fixed or as not planned, or reopen it). Beside it: who
 * it is assigned to, its labels, its kind, the item it is about, the
 * suggestions that will close it, and following it.
 *
 * A public report is read on the server, so the page is whole before
 * script; a private one, and what the reader may do, the browser asks for.
 * A suggestion's number goes on to the suggestion's own page.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  if (!/^\d{1,9}$/.test(params.number)) throw data('not found', { status: 404 });
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const number = Number(params.number);
  const [thread, detail, labels] = await Promise.all([api.threadByNumber(number).catch(() => null), api.issue(number).catch(() => null), api.labels().catch(() => [] as IssueLabel[])]);
  if (thread?.kind === 'suggestion') throw redirect(href(`/suggestions/${number}`, lang));
  return { lang, siteUrl, number, detail, labels, title: detail ? (detail.issue.title ?? detail.issue.typeTitle[lang]) : null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { number, title, lang, siteUrl, detail } = loaderData;
  return pageMeta({ title: title ? `${title} · #${number}` : `#${number}`, description: detail?.issue.body?.slice(0, 160) ?? undefined, path: `/issues/${number}`, lang, siteUrl, noindex: !detail });
}

interface Detail {
  issue: Issue;
  rights: IssueRights;
  timeline: TimelineItem[];
  people: People;
  fixedBy: Array<{ number: number; title: string; status: string }>;
  subscribed: boolean;
}

const W = {
  reports: { he: 'דיווחים', en: 'Reports' },
  opened: { he: 'פתח', en: 'opened this' },
  wrote: { he: 'כתב', en: 'wrote' },
  author: { he: 'מדווח', en: 'Reporter' },
  comments: { he: 'תגובות', en: 'comments' },
  open: { he: 'פתוח', en: 'Open' },
  done: { he: 'טופל', en: 'Fixed' },
  notPlanned: { he: 'לא יטופל', en: 'Not planned' },
  notFound: { he: 'אין דיווח במספר הזה', en: 'No report has this number' },
  notFoundBody: { he: 'אולי הוא פרטי: דיווחים על זכויות ועל תוכן פוגע רואים רק המנהלים ואחראי האוסף.', en: 'It may be private: reports on rights or offensive content are seen only by stewards and the set’s keepers.' },
  editTitle: { he: 'עריכת הכותרת', en: 'Edit title' },
  signIn: { he: 'כדי להגיב צריך להיכנס.', en: 'Sign in to comment.' },
  assignees: { he: 'אחראים', en: 'Assignees' },
  labels: { he: 'תוויות', en: 'Labels' },
  kind: { he: 'סוג', en: 'Kind' },
  about: { he: 'על', en: 'About' },
  fixedBy: { he: 'הצעות שיתקנו', en: 'Fixed by' },
  closesOnApprove: { he: 'ייסגר כשההצעה תאושר', en: 'Closes when it is approved' },
  private: { he: 'פרטי', en: 'Private' },
  foundByOcr: { he: 'נמצא בזיהוי טקסט', en: 'Found by OCR' },
  talk: { he: 'דיון על הפריט', en: 'Talk about the item' },
  guest: { he: 'אורח', en: 'A guest' },
  youKeep: { he: 'את/ה אחראי/ת על האוסף: אפשר לסגור את הדיווח', en: 'You keep this set: you may close the report' },
  mention: { he: '@ לתייג אדם · # להפנות להצעה או לדיווח', en: '@ to mention someone · # for a suggestion or report' },
  comment: { he: 'תגובה', en: 'Comment' },
  commentHint: { he: 'להשאיר תגובה, הדיווח נשאר כמו שהוא', en: 'Say something; the report stays as it is' },
  addComment: { he: 'הוספת תגובה', en: 'Comment' },
  closeDone: { he: 'טופל', en: 'Fixed' },
  closeDoneHint: { he: 'הבעיה תוקנה: הדיווח נסגר', en: 'The problem is fixed: the report closes' },
  closeDoneSubmit: { he: 'סגירה כטופל', en: 'Close as fixed' },
  closeNot: { he: 'לא יטופל', en: 'Not planned' },
  closeNotHint: { he: 'אין מה לתקן, או שזה כפול: הדיווח נסגר', en: 'Nothing to fix, or a duplicate: the report closes' },
  closeNotSubmit: { he: 'סגירה כלא יטופל', en: 'Close as not planned' },
  reopen: { he: 'פתיחה מחדש', en: 'Reopen' },
  reopenHint: { he: 'הבעיה עדיין קיימת', en: 'The problem is still there' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

export default function IssuePage({ loaderData }: Route.ComponentProps) {
  const { number, labels } = loaderData;
  const lang = useLang();
  const account = useAccount();
  const [detail, setDetail] = useState<Detail | null>(loaderData.detail);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDetail(loaderData.detail), [loaderData.detail]);

  const load = useCallback(async () => {
    try {
      setDetail(await threads<Detail>(`issues/${number}`));
      setMissing(false);
    } catch (e) {
      if (e instanceof ThreadsError && (e.status === 404 || e.status === 403)) setMissing(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [number]);

  // Asked again once it is known who is reading: a private report opens to its readers, and the buttons to who may press them.
  useEffect(() => {
    if (account) void load();
    else if (account === null && !loaderData.detail) setMissing(true);
  }, [load, account, loaderData.detail]);
  useReadOnOpen('report', detail?.issue.id ?? null, Boolean(account));

  if (!detail)
    return (
      <div className="wrap page">
        {missing ? (
          <EmptyState icon="report" title={w(lang, 'notFound')} actions={<Link className="btn" to={href('/issues', lang)}>{w(lang, 'reports')}</Link>}>
            #{number} · {w(lang, 'notFoundBody')}
          </EmptyState>
        ) : error ? (
          <p className="note">{error}</p>
        ) : (
          <Skeleton rows={6} lang={lang} />
        )}
      </div>
    );

  const { issue, people } = detail;
  // What the server read is for everyone; what this reader may do comes from the browser's own asking.
  const rights: IssueRights = account ? detail.rights : { read: true, comment: false, edit: false, close: false, triage: false, moderate: false };
  const viewer = account?.person.id ?? null;
  const title = issue.title ?? issue.typeTitle[lang];
  const author = issue.author ? people[issue.author] : null;
  const where = issue.entity ? { path: itemPath(issue.entity), name: nameOf(issue.entity.name as LocalName, lang) || issue.entity.id } : null;
  const state: State = issue.state === 'open' ? 'open' : issue.stateReason === 'not_planned' ? 'closed' : 'approved';
  const handle = (who: string) => people[who]?.username ?? who;

  async function act(run: () => Promise<unknown>): Promise<boolean> {
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

  const labelTo = (name: string) => href('/issues', lang, { label: name });

  return (
    <>
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs items={[{ label: w(lang, 'reports'), to: href('/issues', lang) }, ...(where ? [{ label: where.name, to: href(where.path, lang) }] : [])]} lang={lang} />
          <TitleLine title={title} number={number} lang={lang} mayEdit={rights.edit} onSave={(t) => act(() => threads(`issues/${number}`, { method: 'PATCH', body: { title: t } }))} />
          <div className="pmeta">
            <StatusBadge state={state} icon={issue.state === 'open' ? 'report' : issue.stateReason === 'not_planned' ? 'reportclosed' : 'reportdone'}>
              {w(lang, issue.state === 'open' ? 'open' : issue.stateReason === 'not_planned' ? 'notPlanned' : 'done')}
            </StatusBadge>
            {issue.private ? (
              <span className="badge-private">
                <Icon name="lock" size={11} /> {w(lang, 'private')}
              </span>
            ) : null}
            <span>
              {issue.author ? <Person id={issue.author} people={people} lang={lang} /> : <b>{w(lang, 'guest')}</b>} {w(lang, 'opened')} <When at={issue.createdAt} lang={lang} /> · {issue.comments} {w(lang, 'comments')}
            </span>
            {author?.bot && issue.type === 'wrong-text' ? (
              <MachineLabel lang={lang} size="sm">
                {w(lang, 'foundByOcr')}
              </MachineLabel>
            ) : null}
          </div>
        </div>
      </div>
      <div className="wrap cols issue-page">
        <div className="imain">
          <Timeline label={lang === 'he' ? 'שיחה' : 'Conversation'}>
            <TimelineComment
              id="description"
              author={author?.name ?? w(lang, 'guest')}
              authorId={issue.author ?? undefined}
              role={w(lang, 'author')}
              mine={Boolean(viewer && viewer === issue.author)}
              header={
                <>
                  {issue.author ? <Person id={issue.author} people={people} lang={lang} /> : <b>{w(lang, 'guest')}</b>} <span className="muted">{w(lang, 'wrote')}</span> <When at={issue.createdAt} lang={lang} anchor="description" />
                </>
              }
            >
              <Body issue={issue} lang={lang} mayEdit={rights.edit} onSave={(body) => act(() => threads(`issues/${number}`, { method: 'PATCH', body: { body } }))} />
            </TimelineComment>
            <Conversation
              items={detail.timeline.filter((i) => !(i.type === 'event' && i.kind === 'opened'))}
              people={people}
              lang={lang}
              viewer={viewer}
              thread={`report:${issue.id}`}
              labels={labels}
              roleOf={(who) => (who === issue.author ? w(lang, 'author') : null)}
              mayReply={Boolean(account) && rights.comment}
              reply={(body, parent) => threads(`issues/${number}/comments`, { body: { body, parent } })}
              changed={() => void load()}
            />
            <TimelineBlock className="tl-end">
              {account && rights.comment ? (
                <ReviewBox
                  lang={lang}
                  me={{ name: account.person.displayName, id: account.person.id }}
                  title={tt(lang, 'comment')}
                  name="issue-state"
                  choices={rights.close ? closeChoices(lang, issue.state) : undefined}
                  placeholder={tt(lang, 'leaveComment')}
                  busy={busy}
                  error={error}
                  footnote={
                    <>
                      <Icon name={rights.close ? 'shield' : 'discuss'} size={14} /> {w(lang, rights.close ? 'youKeep' : 'mention')}
                    </>
                  }
                  onSubmit={(choice, note) =>
                    void act(async () => {
                      // "Close with comment": the words first, then the state, as GitHub does.
                      if (note) await threads(`issues/${number}/comments`, { body: { body: note } });
                      if (choice !== 'comment') await threads(`issues/${number}/state`, { body: { state: choice } });
                    })
                  }
                />
              ) : account === null ? (
                <p className="note sign-note">
                  <Icon name="lock" /> <Link to={href('/signin', lang, { return: `/issues/${number}` })}>{w(lang, 'signIn')}</Link>
                </p>
              ) : null}
            </TimelineBlock>
          </Timeline>
        </div>
        <aside className="side" aria-label={lang === 'he' ? 'פרטים' : 'Details'}>
          <section>
            <h4>
              {w(lang, 'assignees')}
              {account && rights.comment ? (
                <Picker
                  lang={lang}
                  title={w(lang, 'assignees')}
                  button={<Icon name="more" label={w(lang, 'assignees')} />}
                  selected={issue.assignees.map(handle)}
                  load={(q) => loadPeople(q, `report:${issue.id}`)}
                  onApply={(values) => void act(() => threads(`issues/${number}/assignees`, { method: 'PUT', body: { assignees: values } }))}
                />
              ) : null}
            </h4>
            {issue.assignees.length ? (
              <ul className="people">
                {issue.assignees.map((id) => (
                  <li key={id}>
                    <Avatar name={people[id]?.name ?? id} id={id} size="xs" bot={people[id]?.bot} />
                    <Person id={id} people={people} lang={lang} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subtle small">
                {tt(lang, 'noAssignees')}
                {account && rights.comment ? (
                  <>
                    {' · '}
                    <button type="button" className="link-btn" onClick={() => void act(() => threads(`issues/${number}/assignees`, { method: 'PUT', body: { assignees: [account.person.username ?? account.person.id] } }))}>
                      {tt(lang, 'assignYourself')}
                    </button>
                  </>
                ) : null}
              </p>
            )}
          </section>
          <section>
            <h4>
              {w(lang, 'labels')}
              {rights.triage ? (
                <Picker
                  lang={lang}
                  title={w(lang, 'labels')}
                  button={<Icon name="more" label={w(lang, 'labels')} />}
                  selected={issue.labels.map((l) => l.name)}
                  load={async (q) => labels.filter((l) => `${l.name} ${LABELS[l.name]?.[lang] ?? ''}`.toLowerCase().includes(q.toLowerCase())).map((l) => ({ value: l.name, label: LABELS[l.name]?.[lang] ?? l.name, hint: l.description ?? undefined, swatch: l.color }))}
                  onApply={(values) => void act(() => threads(`issues/${number}/labels`, { method: 'PUT', body: { labels: values } }))}
                />
              ) : null}
            </h4>
            {issue.labels.length ? (
              <div className="labels-row tight">
                {issue.labels.map((l) => (
                  <Label key={l.name} color={`#${l.color.replace('#', '')}`} to={labelTo(l.name)}>
                    {LABELS[l.name]?.[lang] ?? l.name}
                  </Label>
                ))}
              </div>
            ) : (
              <p className="subtle small">{tt(lang, 'noLabels')}</p>
            )}
          </section>
          <section>
            <h4>{w(lang, 'kind')}</h4>
            <Link to={href('/issues', lang, { type: issue.type })}>{issue.typeTitle[lang]}</Link>
          </section>
          {where ? (
            <section>
              <h4>{w(lang, 'about')}</h4>
              <Link to={href(where.path, lang)} dir="auto">
                {where.name}
              </Link>
              <p className="small">
                <Link className="muted" to={href(`/talk/${issue.entity!.id}`, lang)}>
                  <Icon name="discuss" size={13} /> {w(lang, 'talk')}
                </Link>
              </p>
            </section>
          ) : null}
          <section>
            <h4>{w(lang, 'fixedBy')}</h4>
            {detail.fixedBy.length ? (
              <ul className="thread-lines">
                {detail.fixedBy.map((s) => (
                  <li key={s.number} className="thread-line">
                    <Icon name="suggest" className={s.status === 'merged' ? 'st-approved' : s.status === 'withdrawn' ? 'st-closed' : 'st-open'} />
                    <span>
                      <Link to={href(`/suggestions/${s.number}`, lang)}>#{s.number}</Link> {s.title}
                      {s.status !== 'merged' && s.status !== 'withdrawn' ? <span className="subtle small block">{w(lang, 'closesOnApprove')}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subtle small">{tt(lang, 'fixesHint')}</p>
            )}
          </section>
          <section className="side-acts">
            {account ? <FollowToggle kind="report" id={issue.id} on={detail.subscribed} lang={lang} /> : null}
            {rights.moderate ? (
              <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => threads(`issues/${number}/visibility`, { body: { private: !issue.private } }))}>
                <Icon name={issue.private ? 'eye' : 'lock'} size={14} /> {tt(lang, issue.private ? 'makePublic' : 'makePrivate')}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

/** What a keeper may do with a report from its box: say something, close it one of two ways, or open it again. */
function closeChoices(lang: Lang, state: Issue['state']): ReviewChoice[] {
  const comment: ReviewChoice = { value: 'comment', label: w(lang, 'comment'), hint: w(lang, 'commentHint'), submit: w(lang, 'addComment'), tone: 'primary', icon: 'discuss', needsNote: true };
  if (state === 'closed') return [comment, { value: 'open', label: w(lang, 'reopen'), hint: w(lang, 'reopenHint'), submit: w(lang, 'reopen'), tone: 'approve', icon: 'report' }];
  return [
    comment,
    { value: 'completed', label: w(lang, 'closeDone'), hint: w(lang, 'closeDoneHint'), submit: w(lang, 'closeDoneSubmit'), tone: 'approve', icon: 'reportdone' },
    { value: 'not_planned', label: w(lang, 'closeNot'), hint: w(lang, 'closeNotHint'), submit: w(lang, 'closeNotSubmit'), tone: 'danger', icon: 'reportclosed' },
  ];
}

function TitleLine({ title, number, lang, mayEdit, onSave }: { title: string; number: number; lang: Lang; mayEdit: boolean; onSave: (title: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  if (editing)
    return (
      <form
        className="title-edit"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(value.trim()).then((ok) => ok && setEditing(false));
        }}
      >
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} aria-label={tt(lang, 'title')} autoFocus dir="auto" />
        <button type="submit" className="btn primary">
          {tt(lang, 'save')}
        </button>
        <button type="button" className="btn" onClick={() => setEditing(false)}>
          {tt(lang, 'cancel')}
        </button>
      </form>
    );
  return (
    <div className="title-row">
      <h1 className="page-title" dir="auto">
        {title} <span className="num">#{number}</span>
      </h1>
      {mayEdit ? (
        <button type="button" className="btn sm" onClick={() => (setValue(title), setEditing(true))}>
          <Icon name="pencil" /> {w(lang, 'editTitle')}
        </button>
      ) : null}
    </div>
  );
}

/** The report's own words, as its first card; who sent it (or a keeper) may change them. */
function Body({ issue, lang, mayEdit, onSave }: { issue: Issue; lang: Lang; mayEdit: boolean; onSave: (body: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(issue.body ?? '');
  if (editing)
    return (
      <Composer lang={lang} value={value} onChange={setValue} onSubmit={() => void onSave(value.trim()).then((ok) => ok && setEditing(false))} submitLabel={tt(lang, 'save')} thread={`report:${issue.id}`} autoFocus>
        <button type="button" className="btn sm" onClick={() => setEditing(false)}>
          {tt(lang, 'cancel')}
        </button>
      </Composer>
    );
  return (
    <div className="words">
      {issue.body ? <RichText text={issue.body} lang={lang} /> : <p className="subtle">{tt(lang, 'noDescription')}</p>}
      {mayEdit ? (
        <button type="button" className="icon-btn edit-own" onClick={() => (setValue(issue.body ?? ''), setEditing(true))} aria-label={tt(lang, 'edit')} title={tt(lang, 'edit')}>
          <Icon name="pencil" size={13} />
        </button>
      ) : null}
    </div>
  );
}
