import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { data, Link, redirect, useSearchParams } from 'react-router';
import type { Route } from './+types/suggestion';
import { Composer } from '../components/threads/Composer.js';
import { Picker } from '../components/threads/Picker.js';
import { RichText } from '../components/threads/RichText.js';
import { loadPeople, useReadOnOpen } from '../components/threads/Side.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { LABELS } from '../lib/suggestions.js';
import { suggestionView, type CheckLine, type EntryView, type SuggestionView } from '../lib/suggestionView.server.js';
import { threads, ThreadsError, type People, type TimelineItem } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { wordDiff } from '../lib/wordDiff.js';
import { DiffBox, DiffSegment, DiffStat, FieldDiff } from '../ui/Diff.js';
import { Icon } from '../ui/Icon.js';
import { ReviewBox, reviewChoices } from '../ui/ReviewBox.js';
import { Timeline, TimelineBlock, TimelineComment } from '../ui/Timeline.js';
import { Avatar, Breadcrumbs, EmptyState, Label, MachineLabel, Skeleton, StatusBadge, Tabs, cx, type State, MachineNote } from '../ui/primitives.js';
import { Conversation, FollowToggle, Person, When, Author } from '../views/Conversation.js';

/**
 * One suggestion, as a pull request's page is (the plan: "a Suggestion is
 * a PR"): its title and state, who suggests what where; then four views
 * of it. Conversation: the description, everything said and done since,
 * the change itself set in the line, the checks, and the review box.
 * Changes: each change as a reader reads it, a paragraph's words marked
 * word by word among the paragraphs around it, a comment on any one of
 * them now or kept for the review. Against the scan: each changed
 * paragraph beside the printed page it was read from, and whether the new
 * words are what the scan shows (the machine's reading, said so). Checks:
 * what was checked and what it waits for. Beside it: who reviews it, what
 * kind of change it is, the reports it fixes, its project, what it
 * changes for readers, and following it.
 *
 * What is the same for everyone is read on the server, so the page works
 * and is whole before script; the conversation and the review, which are
 * personal, the browser asks for.
 */

export async function loader({ request, params, context }: Route.LoaderArgs) {
  if (!/^\d{1,9}$/.test(params.number)) throw data('not found', { status: 404 });
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const number = Number(params.number);
  const thread = await api.threadByNumber(number).catch(() => null);
  if (thread?.kind === 'issue') throw redirect(href(`/issues/${number}`, lang));
  let view: SuggestionView | null = null;
  let people: People = {};
  if (thread) {
    const detail = await api.suggestion(thread.id, { limit: 200, summary: true }).catch(() => null);
    if (detail) {
      view = await suggestionView(api, detail, lang);
      const found = await api.peopleByIds([detail.changeset.author, ...detail.reviews.map((r) => r.reviewer)]);
      people = Object.fromEntries(found.map((p) => [p.id, { name: p.displayName, username: p.username, bot: p.bot }]));
    }
  }
  return { lang, siteUrl, number, id: thread?.id ?? null, view, people };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const title = loaderData.view ? `${loaderData.view.title} #${loaderData.number}` : `#${loaderData.number}`;
  return pageMeta({ title, path: `/suggestions/${loaderData.number}`, lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

const W = {
  suggestions: { he: 'הצעות', en: 'Suggestions' },
  proposes: { he: 'מציע', en: 'suggests' },
  changesIn: { he: 'שינויים ב', en: 'changes to' },
  change1: { he: 'שינוי אחד ב', en: 'one change to' },
  conversation: { he: 'שיחה', en: 'Conversation' },
  changes: { he: 'השינויים', en: 'Changes' },
  againstScan: { he: 'מול הסריקה', en: 'Against the scan' },
  checks: { he: 'בדיקות', en: 'Checks' },
  author: { he: 'מציע', en: 'Author' },
  reviewer: { he: 'בודק', en: 'Reviewer' },
  sideBySide: { he: 'הצגה זה מול זה', en: 'Side by side' },
  inline: { he: 'הצגה רצופה', en: 'Inline' },
  printing: { he: 'הדפוס', en: 'The printing' },
  page: { he: 'עמ׳', en: 'p.' },
  pages: { he: 'עמ׳', en: 'pp.' },
  line: { he: 'שורה', en: 'line' },
  scanCheck: { he: 'בדיקה מול הסריקה', en: 'Checked against the scan' },
  ocr: { he: 'OCR אוטומטי · טרם נבדק', en: 'Automatic OCR · not checked' },
  found: { he: 'נמצא בסריקה', en: 'in the scan' },
  notFound: { he: 'לא נמצא בסריקה', en: 'not in the scan' },
  openScan: { he: 'פתיחת הסריקה', en: 'Open the scan' },
  scanUnread: { he: 'הסריקה עוד לא נקראה במכונה, אז אין מה להשוות מילה במילה. פתחו את הסריקה ובדקו בעיניים.', en: 'The scan has not been read by a machine yet, so there is nothing to compare word by word. Open the scan and look.' },
  noScan: { he: 'לשינויים האלה אין סריקה להשוות אליה.', en: 'These changes have no scan to compare with.' },
  noScanTitle: { he: 'אין מה להשוות', en: 'Nothing to compare' },
  automatic: { he: 'בדיקה אוטומטית', en: 'Automatic check' },
  labels: { he: 'תוויות', en: 'Labels' },
  linkedReport: { he: 'דיווח מקושר', en: 'Linked report' },
  project: { he: 'פרויקט', en: 'Project' },
  checkedOf: { he: '{d} מתוך {t} נבדקו', en: '{d} of {t} done' },
  whatChanges: { he: 'מה זה משנה', en: 'What this changes' },
  linkTo: { he: 'קישור לסעיף', en: 'Link to the passage' },
  youKeep: { he: 'את/ה אחראי/ת על האוסף הזה, ואישורך מכניס את השינוי.', en: 'You keep this set; your approval puts the change in.' },
  onlyKeepers: { he: 'רק אחראי האוסף מאשרים או מחזירים. כל אחד יכול להגיב.', en: 'Only the set’s keepers approve or send back. Anyone may comment.' },
  signIn: { he: 'כדי להגיב או לבדוק צריך להיכנס.', en: 'Sign in to comment or review.' },
  loading: { he: 'טוען את השיחה…', en: 'Loading the conversation…' },
  notFound404: { he: 'אין הצעה במספר הזה', en: 'No suggestion has this number' },
  newItem: { he: 'פריט חדש', en: 'New item' },
  removedItem: { he: 'הפריט יימחק', en: 'The item is removed' },
  commentHere: { he: 'הערה כאן', en: 'Comment here' },
  commentNow: { he: 'הגבה עכשיו', en: 'Comment now' },
  keepForReview: { he: 'שמירה לבדיקה', en: 'Add to review' },
  pendingNote: { he: 'הערות שישלחו עם הבדיקה', en: 'Comments sent with your review' },
  editTitle: { he: 'עריכת הכותרת', en: 'Edit title' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

/** What a change to an item of this kind changes for readers. */
const IMPACT: Record<string, { he: string; en: string }> = {
  segment: { he: 'הטקסט של השיחה בכל תצוגה, בתרגום המסונכרן ובחיפוש. לא משנה את הסריקה.', en: 'The sicha’s words in every view, in the synced translation and in search. It does not change the scan.' },
  unit: { he: 'איך השיחה נקראת ומוצגת: שמה, תאריכה ומקומה בספר.', en: 'How the sicha is named and shown: its name, date and place in the sefer.' },
  event: { he: 'פרטי ההתוועדות: שמה ותאריכה, בלוח ובחיפוש.', en: 'The farbrengen’s details: its name and date, in the calendar and in search.' },
  work: { he: 'פרטי הספר בכל מקום שהוא מופיע.', en: 'The sefer’s details wherever it is shown.' },
  publication: { he: 'פרטי ההדפסה, וממילא מספרי העמודים שמוצגים לפיה.', en: 'The printing’s details, and so the page numbers shown by it.' },
  recording: { he: 'פרטי ההקלטה ומה שמתנגן בנגן.', en: 'The recording’s details and what the player plays.' },
  'contents-map': { he: 'באיזה עמוד מופיעה השיחה בדפוס.', en: 'Which page the sicha is on in the printing.' },
};

interface ClientDetail {
  mayApprove: boolean;
  mine: boolean;
  changeset: { status: SuggestionView['status']; title: string; description: string | null };
}

interface ConversationData {
  number: number;
  timeline: TimelineItem[];
  people: People;
  reviewRequests: Array<{ reviewer: string; requestedBy: string | null; at: string }>;
  fixes: Array<{ number: number; title: string | null; state: 'open' | 'closed'; private: boolean }>;
  subscribed: boolean;
}

interface Pending {
  entity: string;
  field: string;
  body: string;
}

type Tab = 'conversation' | 'changes' | 'scan' | 'checks';

const stateOfStatus = (status: SuggestionView['status']): State => (status === 'merged' ? 'approved' : status === 'withdrawn' ? 'closed' : status === 'draft' ? 'draft' : status === 'sent_back' ? 'closed' : 'open');

export default function SuggestionPage({ loaderData }: Route.ComponentProps) {
  const { number, id, people: serverPeople } = loaderData;
  const [view, setView] = useState<SuggestionView | null>(loaderData.view);
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'changes' || tabParam === 'scan' || tabParam === 'checks' ? tabParam : 'conversation';
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [talk, setTalk] = useState<ConversationData | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => setView(loaderData.view), [loaderData.view]);

  const load = useCallback(async () => {
    if (id === null) return setMissing(true);
    try {
      const [d, c] = await Promise.all([threads<ClientDetail>(`suggestions/${id}?limit=200`), threads<ConversationData>(`suggestions/${id}/conversation`)]);
      setDetail(d);
      setTalk(c);
      // A title or description just changed here: the page says so without a reload.
      setView((v) => (v ? { ...v, title: d.changeset.title, description: d.changeset.description, status: d.changeset.status } : v));
    } catch (e) {
      if (e instanceof ThreadsError && e.status === 404) setMissing(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => {
    if (account !== undefined) void load();
  }, [load, account]);
  useReadOnOpen('changeset', id, Boolean(account));

  if (!view)
    return (
      <div className="wrap page">
        {missing || id === null ? (
          <EmptyState icon="suggest" title={w(lang, 'notFound404')} actions={<Link className="btn" to={href('/suggestions', lang)}>{w(lang, 'suggestions')}</Link>}>
            #{number}
          </EmptyState>
        ) : (
          <Skeleton rows={6} lang={lang} />
        )}
      </div>
    );

  const people: People = { ...serverPeople, ...(talk?.people ?? {}) };
  const viewer = account?.person.id ?? null;
  const live = view.status === 'open' || view.status === 'sent_back';
  const mayEdit = Boolean(viewer && (viewer === view.author || account?.person.steward));
  const fieldLabel = (a: { entity: string; field: string }) => {
    const e = view.entries.find((x) => x.entityId === a.entity);
    const f = e?.fields.find((x) => x.path === a.field);
    return [e?.label ?? a.entity, f?.name ?? (a.field === '/content' ? (lang === 'he' ? 'הטקסט' : 'the words') : a.field)].join(' › ');
  };
  const here = (t: Tab) => href(`/suggestions/${number}`, lang, t === 'conversation' ? {} : { tab: t });
  const changeCount = view.entries.reduce((n, e) => n + (e.segment ? 1 : 0) + e.fields.length, 0);
  const comments = talk ? talk.timeline.filter((i) => i.type === 'comment').length : null;
  const scans = view.entries.filter((e) => e.scan);

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

  // Who reviewed last, and how, and who is asked: the side column's reviewers.
  const lastVerdict = new Map<string, 'approve' | 'send_back' | 'comment'>();
  for (const item of talk?.timeline ?? []) if (item.type === 'review') lastVerdict.set(item.author, item.verdict);
  const asked = new Set((talk?.reviewRequests ?? []).map((r) => r.reviewer));
  const reviewers = [...new Set([...asked, ...lastVerdict.keys()])].filter((r) => r !== view.author);
  const handle = (who: string) => people[who]?.username ?? who;
  const roleOf = (who: string): ReactNode => (who === view.author ? w(lang, 'author') : asked.has(who) || lastVerdict.has(who) ? w(lang, 'reviewer') : null);

  const conversation = talk ? (
    <Conversation
      items={talk.timeline.filter((i) => !(i.type === 'event' && i.kind === 'opened'))}
      people={people}
      lang={lang}
      viewer={viewer}
      thread={`changeset:${id}`}
      roleOf={roleOf}
      fieldLabel={fieldLabel}
      mayResolve={Boolean(viewer && (viewer === view.author || detail?.mayApprove))}
      mayReply={Boolean(account)}
      reply={(body, parent) => threads(`suggestions/${id}/comments`, { body: { body, parent } })}
      changed={() => void load()}
    />
  ) : null;

  // Undo what was done: a withdrawn suggestion reopens, a merged one is reverted (put back as it was).
  const post = async (path: string, payload: unknown = {}) => {
    const response = await fetch(`/_/suggestions/${id}/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? response.statusText);
  };
  const undoBar =
    mayEdit && (view.status === 'withdrawn' || view.status === 'merged') ? (
      <p className="note undo-note">
        <Icon name="back" size={14} /> {tt(lang, view.status === 'withdrawn' ? 'reopenNote' : 'undoNote')}{' '}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            if (view.status === 'merged' && !window.confirm(tt(lang, 'undoConfirm'))) return;
            void act(() => post(view.status === 'withdrawn' ? 'reopen' : 'revert'));
          }}
        >
          {tt(lang, view.status === 'withdrawn' ? 'reopen' : 'undoChange')}
        </button>
      </p>
    ) : null;

  const reviewBox = !account ? (
    <p className="note sign-note">
      <Icon name="lock" /> <Link to={href('/signin', lang, { return: `/suggestions/${number}` })}>{w(lang, 'signIn')}</Link>
    </p>
  ) : live && detail ? (
    <ReviewBox
      lang={lang}
      me={{ name: account.person.displayName, id: account.person.id }}
      choices={detail.mayApprove && !detail.mine ? reviewChoices(lang) : undefined}
      placeholder={tt(lang, 'leaveComment')}
      busy={busy}
      error={error}
      footnote={
        <>
          <Icon name={detail.mayApprove ? 'shield' : 'lock'} size={14} /> {w(lang, detail.mayApprove && !detail.mine ? 'youKeep' : 'onlyKeepers')}
          {pending.length ? ` · ${w(lang, 'pendingNote')}: ${pending.length}` : ''}
        </>
      }
      extra={
        detail.mine ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await post('withdraw');
              })
            }
          >
            {tt(lang, 'withdraw')}
          </button>
        ) : null
      }
      onSubmit={(choice, note) =>
        void act(async () => {
          if (choice === 'comment' && !pending.length) await threads(`suggestions/${id}/comments`, { body: { body: note } });
          else await threads(`suggestions/${id}/reviews`, { body: { verdict: choice === 'send_back' ? 'request_changes' : choice, body: note, comments: pending } });
          setPending([]);
        })
      }
    />
  ) : live ? null : (
    <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void act(() => threads(`suggestions/${id}/comments`, { body: { body: draft.trim() } })).then((ok) => ok && setDraft(''))} submitLabel={tt(lang, 'comment')} busy={busy} thread={`changeset:${id}`} error={error} />
  );

  return (
    <>
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs items={[...view.crumbs, { label: w(lang, 'suggestions'), to: href('/suggestions', lang) }]} lang={lang} />
          <TitleLine view={view} number={number} lang={lang} mayEdit={mayEdit} onSave={(title) => act(() => threads(`suggestions/${id}`, { method: 'PATCH', body: { title } }))} />
          <div className="pmeta">
            <StatusBadge state={stateOfStatus(view.status)} icon={view.status === 'merged' ? 'check' : undefined}>
              {tt(lang, view.status === 'merged' ? 'stateMerged' : view.status === 'sent_back' ? 'stateSentBack' : view.status === 'withdrawn' ? 'stateWithdrawn' : view.status === 'draft' ? 'stateDraft' : 'stateOpen')}
            </StatusBadge>
            <span>
              <Author id={view.author} people={people} lang={lang} via={view.via} /> {w(lang, 'proposes')} {changeCount === 1 ? w(lang, 'change1') : `${num(changeCount, lang)} ${w(lang, 'changesIn')}`}
              {view.where ? (
                <Label to={href(view.where.path, lang)} className="where-label">
                  {[view.where.within, view.where.label].filter(Boolean).join(' · ')}
                </Label>
              ) : null}{' '}
              · <When at={view.submittedAt ?? view.createdAt} lang={lang} />
            </span>
          </div>
          <Tabs
            label={lang === 'he' ? 'חלקי ההצעה' : 'Views of the suggestion'}
            current={tab}
            items={[
              { key: 'conversation', label: w(lang, 'conversation'), icon: 'discuss', to: here('conversation'), count: comments },
              { key: 'changes', label: w(lang, 'changes'), icon: 'code', to: here('changes'), count: changeCount },
              { key: 'scan', label: w(lang, 'againstScan'), icon: 'scan', to: here('scan'), count: scans.length || null },
              { key: 'checks', label: w(lang, 'checks'), icon: 'check', to: here('checks'), count: view.checks.length },
            ]}
          />
        </div>
      </div>
      <div className="wrap cols sugg">
        <div className="imain">
          {tab === 'conversation' ? (
            <Timeline label={w(lang, 'conversation')}>
              <TimelineComment
                id="description"
                author={people[view.author]?.name ?? view.author}
                authorId={view.author}
                bot={Boolean(view.via)}
                role={w(lang, 'author')}
                mine={viewer === view.author}
                header={
                  <>
                    <Author id={view.author} people={people} lang={lang} via={view.via} /> <span className="muted">{lang === 'he' ? 'כתב' : 'wrote'}</span> <When at={view.createdAt} lang={lang} anchor="description" />
                  </>
                }
              >
                {view.via ? <AgentNote via={view.via} status={view.status} author={people[view.author]?.username ? `@${people[view.author]!.username}` : (people[view.author]?.name ?? view.author)} lang={lang} /> : null}
                <Description view={view} lang={lang} mayEdit={mayEdit} id={id!} onSave={(description) => act(() => threads(`suggestions/${id}`, { method: 'PATCH', body: { description } }))} />
              </TimelineComment>
              {view.entries.slice(0, 3).map((e) => (
                <TimelineBlock key={e.entityId}>
                  <EntryDiff entry={e} lang={lang} compact />
                </TimelineBlock>
              ))}
              {view.entries.length > 3 ? (
                <TimelineBlock>
                  <Link className="more-link" to={here('changes')}>
                    +{num(view.entries.length - 3, lang)} {w(lang, 'changes')}
                  </Link>
                </TimelineBlock>
              ) : null}
              {conversation ?? (
                <TimelineBlock>
                  <Skeleton rows={3} lang={lang} />
                </TimelineBlock>
              )}
              <TimelineBlock>
                <Checks checks={view.checks} lang={lang} />
              </TimelineBlock>
              {undoBar ? <TimelineBlock>{undoBar}</TimelineBlock> : null}
              {reviewBox ? <TimelineBlock className="tl-end">{reviewBox}</TimelineBlock> : null}
            </Timeline>
          ) : tab === 'changes' ? (
            <div className="stack">
              {view.entries.map((e) => (
                <ChangeWithComments key={e.entityId} entry={e} lang={lang} talk={talk} conversation={talk ? { people, viewer, id: id!, detail } : null} signedIn={Boolean(account)} onPending={(p) => setPending([...pending, p])} changed={() => void load()} />
              ))}
              {undoBar}
              {reviewBox}
            </div>
          ) : tab === 'scan' ? (
            <div className="stack">
              {scans.length ? (
                scans.map((e) => <AgainstScan key={e.entityId} entry={e} lang={lang} />)
              ) : (
                <div className="box">
                  <EmptyState icon="scan" title={w(lang, 'noScanTitle')} compact>
                    {w(lang, 'noScan')}
                  </EmptyState>
                </div>
              )}
            </div>
          ) : (
            <Checks checks={view.checks} lang={lang} />
          )}
        </div>
        <aside className="side" aria-label={lang === 'he' ? 'פרטים' : 'Details'}>
          <section>
            <h4>
              {tt(lang, 'reviewers')}
              {account && live && talk ? (
                <Picker
                  lang={lang}
                  title={tt(lang, 'requestReview')}
                  button={<Icon name="more" label={tt(lang, 'requestReview')} />}
                  selected={[...asked].map(handle)}
                  load={(q) => loadPeople(q, `changeset:${id}`)}
                  onApply={(values) =>
                    void act(async () => {
                      const now = [...asked].map(handle);
                      const add = values.filter((v) => !now.includes(v));
                      const drop = now.filter((v) => !values.includes(v));
                      if (add.length) await threads(`suggestions/${id}/review-requests`, { body: { reviewers: add } });
                      for (const name of drop) await threads(`suggestions/${id}/review-requests/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    })
                  }
                />
              ) : null}
            </h4>
            {!talk ? (
              <Skeleton rows={2} lang={lang} />
            ) : reviewers.length ? (
              <ul className="people reviewers">
                {reviewers.map((who) => {
                  const verdict = lastVerdict.get(who);
                  const waiting = asked.has(who) && !verdict;
                  return (
                    <li key={who}>
                      <Avatar name={people[who]?.name ?? who} id={who} size="xs" />
                      <Person id={who} people={people} lang={lang} />
                      <span className={cx('rv', verdict === 'approve' ? 'st-approved' : verdict === 'send_back' ? 'st-closed' : waiting ? 'attention' : 'subtle')}>
                        {waiting ? (
                          <>
                            <Icon name="clock" size={14} /> {tt(lang, 'awaiting')}
                          </>
                        ) : verdict === 'approve' ? (
                          <>
                            <Icon name="check" size={14} /> {tt(lang, 'approved')}
                          </>
                        ) : verdict === 'send_back' ? (
                          <>
                            <Icon name="back" size={14} /> {tt(lang, 'sentBack')}
                          </>
                        ) : (
                          <Icon name="discuss" size={14} label={tt(lang, 'reviewedComment')} />
                        )}
                      </span>
                      {!waiting && live && account && who !== viewer ? (
                        <button type="button" className="icon-btn" title={tt(lang, 'reRequest')} aria-label={tt(lang, 'reRequest')} onClick={() => void act(() => threads(`suggestions/${id}/review-requests`, { body: { reviewers: [handle(who)] } }))}>
                          <Icon name="history" size={13} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="subtle small">{tt(lang, 'noReviewers')}</p>
            )}
          </section>
          {view.labels.length ? (
            <section>
              <h4>{w(lang, 'labels')}</h4>
              <div className="labels-row tight">
                {view.labels.map((l) =>
                  LABELS[l] ? (
                    <Label key={l} tone={LABELS[l]!.tone}>
                      {LABELS[l]![lang]}
                    </Label>
                  ) : null,
                )}
              </div>
            </section>
          ) : null}
          <section>
            <h4>{w(lang, 'linkedReport')}</h4>
            {!talk ? (
              <Skeleton rows={1} lang={lang} />
            ) : talk.fixes.length ? (
              <ul className="thread-lines">
                {talk.fixes.map((f) => (
                  <li key={f.number} className="thread-line">
                    <Icon name={f.state === 'closed' ? 'reportdone' : 'report'} className={f.state === 'closed' ? 'st-approved' : 'st-open'} />
                    <span>
                      <Link to={href(`/issues/${f.number}`, lang)}>#{f.number}</Link> {f.title ?? ''}
                      <span className="subtle small block">{lang === 'he' ? 'ייסגר כשההצעה תאושר' : 'Closes when this is approved'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subtle small">{tt(lang, 'fixesHint')}</p>
            )}
          </section>
          {view.project ? (
            <section>
              <h4>{w(lang, 'project')}</h4>
              <Link to={href(`/projects/${view.project.slug}`, lang)}>{view.project.name}</Link>
              <p className="subtle small">{w(lang, 'checkedOf').replace('{d}', num(view.project.done, lang)).replace('{t}', num(view.project.total, lang))}</p>
            </section>
          ) : null}
          {IMPACT[view.entries[0]?.type ?? ''] ? (
            <section>
              <h4>{w(lang, 'whatChanges')}</h4>
              <p className="muted small">{IMPACT[view.entries[0]!.type]![lang]}</p>
            </section>
          ) : null}
          <section className="side-acts">
            {account && talk ? <FollowToggle kind="changeset" id={id!} on={talk.subscribed} lang={lang} /> : null}
            {view.where ? (
              <Link to={href(view.where.path, lang)}>
                <Icon name="link" size={14} /> {w(lang, 'linkTo')}
              </Link>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

function TitleLine({ view, number, lang, mayEdit, onSave }: { view: SuggestionView; number: number; lang: Lang; mayEdit: boolean; onSave: (title: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(view.title);
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
        {view.title} <span className="num">#{number}</span>
      </h1>
      {mayEdit ? (
        <button type="button" className="btn sm" onClick={() => (setValue(view.title), setEditing(true))}>
          <Icon name="pencil" /> {w(lang, 'editTitle')}
        </button>
      ) : null}
    </div>
  );
}

function Description({ view, lang, mayEdit, id, onSave }: { view: SuggestionView; lang: Lang; mayEdit: boolean; id: number; onSave: (text: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(view.description ?? '');
  if (editing)
    return (
      <Composer lang={lang} value={value} onChange={setValue} onSubmit={() => void onSave(value.trim()).then((ok) => ok && setEditing(false))} submitLabel={tt(lang, 'save')} thread={`changeset:${id}`} autoFocus>
        <button type="button" className="btn sm" onClick={() => setEditing(false)}>
          {tt(lang, 'cancel')}
        </button>
      </Composer>
    );
  return (
    <div className="words">
      {view.description ? <RichText text={view.description} lang={lang} /> : <p className="subtle">{tt(lang, 'noDescription')}</p>}
      {mayEdit ? (
        <button type="button" className="icon-btn edit-own" onClick={() => (setValue(view.description ?? ''), setEditing(true))} aria-label={tt(lang, 'edit')} title={tt(lang, 'edit')}>
          <Icon name="pencil" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/** One change as a reader reads it: a paragraph among its neighbours, marked word by word; a field before and after. */
function EntryDiff({ entry, lang, compact, actions }: { entry: EntryView; lang: Lang; compact?: boolean; actions?: ReactNode }) {
  const [both, setBoth] = useState(false);
  const seg = entry.segment;
  const parts = seg ? wordDiff(seg.before, seg.after) : null;
  const scan = entry.scan;
  return (
    <DiffBox
      id={`d-${entry.entityId}`}
      icon={entry.type === 'segment' ? 'file' : 'pencil'}
      title={
        <Link to={href(entry.path, lang)} className="plain">
          {entry.label}
        </Link>
      }
      where={[entry.isNew ? w(lang, 'newItem') : entry.removed ? w(lang, 'removedItem') : null, scan?.page ? `${w(lang, 'page')} ${scan.page} ${lang === 'he' ? 'בדפוס' : 'in'} ${scan.printing.split(' · ').pop()}` : entry.within].filter(Boolean).join(' · ')}
      stat={parts ? <DiffStat parts={parts} lang={lang} /> : null}
      actions={
        <>
          {seg && seg.before && seg.after ? (
            <button type="button" className="btn sm" onClick={() => setBoth(!both)} aria-pressed={both}>
              {w(lang, both ? 'inline' : 'sideBySide')}
            </button>
          ) : null}
          {actions}
        </>
      }
      note={
        compact && scan ? (
          <>
            <div>
              <span className="subtle">
                {w(lang, 'printing')}: {scan.printing}
                {scan.page ? `, ${w(lang, 'page')} ${scan.page}` : scan.pages ? `, ${w(lang, 'pages')} ${scan.pages.from}–${scan.pages.to}` : ''}
              </span>
              {scan.lines ? <ScanLine lines={scan.lines} words={scan.words} /> : scan.scanPath ? <Link to={href(scan.scanPath, lang)} className="block">{w(lang, 'openScan')}</Link> : null}
            </div>
            <div>
              <span className="row-gap">
                {w(lang, 'scanCheck')} {scan.verdict !== 'unread' ? <MachineLabel lang={lang} size="sm">{w(lang, 'ocr')}</MachineLabel> : null}
              </span>
              <span className="block">
                {scan.verdict === 'unread' ? w(lang, 'scanUnread') : scan.words.map((x) => `${x.word} — ${w(lang, x.found ? 'found' : 'notFound')}`).join(' · ')}
              </span>
            </div>
          </>
        ) : null
      }
    >
      {entry.withheld ? (
        <p className="note pad">{entry.withheld}</p>
      ) : seg ? (
        both ? (
          <div className="diff-both">
            <DiffSegment n={seg.n} before={seg.before} />
            <DiffSegment n={seg.n} before={seg.after} />
          </div>
        ) : (
          <>
            {seg.prev ? <DiffSegment n={seg.prev.n} before={seg.prev.content} context /> : null}
            <DiffSegment n={seg.n} before={seg.before} after={seg.after} />
            {seg.next && !compact ? <DiffSegment n={seg.next.n} before={seg.next.content} context /> : null}
          </>
        )
      ) : null}
      {entry.fields.map((f) => (
        <FieldDiff key={f.path} name={f.name} before={f.before} after={f.after} />
      ))}
    </DiffBox>
  );
}

/** The scan's line as the machine read it, the new words marked where they are found. */
function ScanLine({ lines, words }: { lines: string[]; words: Array<{ word: string; found: boolean }> }) {
  const wanted = new Set(words.filter((x) => x.found).map((x) => x.word));
  const clean = (s: string) => s.replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
  const line = lines.find((l) => l.split(/\s+/).some((x) => wanted.has(clean(x)))) ?? lines[0] ?? '';
  return (
    <div className="scanline" dir="rtl">
      {line.split(/(\s+)/).map((x, i) => (wanted.has(clean(x)) ? <mark key={i}>{x}</mark> : <span key={i}>{x}</span>))}
    </div>
  );
}

function AgainstScan({ entry, lang }: { entry: EntryView; lang: Lang }) {
  const scan = entry.scan!;
  const seg = entry.segment;
  return (
    <section className="box against">
      <header className="box-h">
        <Icon name="scan" />
        <b>{entry.label}</b>
        <span className="subtle">
          {scan.printing}
          {scan.page ? ` · ${w(lang, 'page')} ${scan.page}` : scan.pages ? ` · ${w(lang, 'pages')} ${scan.pages.from}–${scan.pages.to}` : ''}
        </span>
        {scan.scanPath ? (
          <Link className="btn sm end" to={href(scan.scanPath, lang)}>
            <Icon name="external" /> {w(lang, 'openScan')}
          </Link>
        ) : null}
      </header>
      <div className="against-grid">
        <div className="against-page">
          {scan.image ? <img src={scan.image} alt={`${scan.printing}, ${w(lang, 'page')} ${scan.page}`} loading="lazy" /> : scan.lines ? <ScanLine lines={scan.lines} words={scan.words} /> : <p className="subtle small">{w(lang, 'scanUnread')}</p>}
          {scan.lines ? (
            <p className="row-gap small">
              <MachineLabel lang={lang} size="sm">
                {w(lang, 'ocr')}
              </MachineLabel>
            </p>
          ) : null}
        </div>
        <div className="against-text">
          {seg ? <DiffSegment n={seg.n} before={seg.before} after={seg.after} /> : null}
          {scan.words.length ? (
            <ul className="word-checks">
              {scan.words.map((x) => (
                <li key={x.word} className={scan.verdict === 'unread' ? 'subtle' : x.found ? 'st-approved' : 'st-closed'}>
                  <Icon name={scan.verdict === 'unread' ? 'dot' : x.found ? 'check' : 'x'} size={14} />
                  <span className="torah-sm">{x.word}</span>
                  <span className="subtle">{scan.verdict === 'unread' ? '' : w(lang, x.found ? 'found' : 'notFound')}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Checks({ checks, lang }: { checks: CheckLine[]; lang: Lang }) {
  if (!checks.length) return null;
  return (
    <div className="box checks" role="list" aria-label={w(lang, 'checks')}>
      {checks.map((c, i) => (
        <div key={i} className="check" role="listitem">
          <span className={c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'fail' : 'warn'}>
            <Icon name={c.status === 'pass' ? 'check' : c.status === 'fail' ? 'x' : c.status === 'warn' ? 'warn' : 'clock'} size={16} />
          </span>
          <span className="grow">{c.message}</span>
          {c.machine ? <span className="subtle small">{w(lang, 'automatic')}</span> : null}
          {c.note ? <span className="subtle small num">{c.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** A change in the Changes view, with its comments, and a comment on it now or kept for the review. */
function ChangeWithComments({
  entry,
  lang,
  talk,
  conversation,
  signedIn,
  onPending,
  changed,
}: {
  entry: EntryView;
  lang: Lang;
  talk: ConversationData | null;
  conversation: { people: People; viewer: string | null; id: number; detail: ClientDetail | null } | null;
  signedIn: boolean;
  onPending: (p: Pending) => void;
  changed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const field = entry.segment ? '/content' : (entry.fields[0]?.path ?? '');
  const here = (talk?.timeline ?? []).filter((i) => i.type === 'comment' && i.anchor?.entity === entry.entityId && i.parent === null);
  const threadOf = (talk?.timeline ?? []).filter((i) => i.type === 'comment' && (here.some((h) => h.id === i.id) || here.some((h) => h.id === (i as { parent: number | null }).parent)));

  async function now() {
    if (!conversation) return;
    setError(null);
    try {
      await threads(`suggestions/${conversation.id}/comments`, { body: { body: draft.trim(), anchor: { entity: entry.entityId, field } } });
      setDraft('');
      setOpen(false);
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="change-block">
      <EntryDiff
        entry={entry}
        lang={lang}
        actions={
          signedIn ? (
            <button type="button" className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Icon name="discuss" /> {w(lang, 'commentHere')}
            </button>
          ) : null
        }
      />
      {threadOf.length && conversation ? (
        <ol className="timeline field-thread">
          <Conversation
            items={threadOf.map((i) => (i.type === 'comment' ? { ...i, review: null } : i))}
            people={conversation.people}
            lang={lang}
            viewer={conversation.viewer}
            thread={`changeset:${conversation.id}`}
            mayResolve={Boolean(conversation.viewer && conversation.detail?.mayApprove)}
            mayReply={signedIn}
            reply={(body, parent) => threads(`suggestions/${conversation.id}/comments`, { body: { body, parent } })}
            changed={changed}
          />
        </ol>
      ) : null}
      {open && conversation ? (
        <div className="field-composer">
          <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void now()} submitLabel={w(lang, 'commentNow')} thread={`changeset:${conversation.id}`} autoFocus error={error}>
            <button
              type="button"
              className="btn sm"
              disabled={!draft.trim()}
              onClick={() => {
                onPending({ entity: entry.entityId, field, body: draft.trim() });
                setDraft('');
                setOpen(false);
              }}
            >
              {w(lang, 'keepForReview')}
            </button>
            <button type="button" className="btn sm" onClick={() => setOpen(false)}>
              {tt(lang, 'cancel')}
            </button>
          </Composer>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A suggestion an agent sent for a person says so in words, as machine
 * output does: until a person has reviewed it, it is the agent's work, not
 * the person's.
 */
function AgentNote({ via, status, author, lang }: { via: NonNullable<SuggestionView['via']>; status: SuggestionView['status']; author: string; lang: Lang }) {
  const waiting = status === 'open' || status === 'sent_back' || status === 'draft';
  const app = via.kind === 'oauth';
  const text =
    lang === 'he'
      ? `${via.name} ${app ? '(אפליקציה מחוברת, סוכן)' : '(טוקן API, סוכן)'} שלח את ההצעה הזאת בשביל ${author}.${waiting ? ' עדיין אף אדם לא סקר אותה.' : ''}`
      : `${via.name} ${app ? '(a connected app, an agent)' : '(an API token, an agent)'} sent this suggestion for ${author}.${waiting ? ' No person has reviewed it yet.' : ''}`;
  return <MachineNote>{text}</MachineNote>;
}
