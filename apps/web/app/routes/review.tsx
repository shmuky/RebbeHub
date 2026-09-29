import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/review';
import { ChangeDiff } from '../components/ChangeDiff.js';
import { PlainWords } from '../components/PlainWords.js';
import type { SuggestionDetail } from '../lib/api.js';
import { langFrom, t, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { st } from '../lib/scanStrings.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { LABELS, detailLabels, stateOf, stateWord } from '../lib/suggestions.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Avatar, Breadcrumbs, EmptyState, Label, MachineLabel, RelativeTime, Skeleton, StateIcon, StatusBadge, Tabs } from '../ui/primitives.js';
import '../styles/pages/contribute.css';

/**
 * Suggestions waiting for review (the plan, section 7), a queue as a pull
 * request list is: each one's change before and after, word by word, and
 * for the set's keepers Approve or Send back with a note, in one tap. Then
 * trusted people's line fixes that went live at once, reviewed after, to
 * keep or undo; and the signed-in person's own suggestions and what became
 * of them. Each may carry the reviewer's advice: a machine's summary,
 * labelled as such, which decides nothing. Filled in by the browser, since
 * who may approve is personal; the page itself is the same for everyone.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'reviewTitle'), path: '/review', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

interface Suggestion {
  id: number;
  /** Its #number, shared with issues; imports have none. */
  number?: number | null;
  title: string;
  description: string | null;
  author: string;
  status: 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn';
  kind: 'suggestion' | 'import' | 'revert' | 'live';
  post_review: 'pending' | 'done' | null;
  submitted_at: string | null;
  created_at: string;
  checks: Array<{ check: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
}

interface Detail {
  changeset: Suggestion;
  entries: Array<{ entityId: string; type: string; before: unknown; after: unknown; changes: Array<{ path: string; before?: unknown; after?: unknown }>; conflicts: unknown[]; withheld?: string }>;
  reviews: Array<{ reviewer: string; verdict: 'approve' | 'send_back'; body: string | null; created_at: string }>;
  names: Record<string, string>;
  files: Record<string, { url: string | null; mime: string; bytes: number; rights: string; similar?: Array<{ kind: 'same' | 'shares'; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null }> }> }>;
  mayApprove: boolean;
  mine: boolean;
  /** The reviewer's advice, written by a machine (null until one has been written). */
  advice: { summary: string; model: string; at: string; machine: true } | null;
}

type View = 'waiting' | 'live' | 'mine';

const W = {
  crumbs: { he: 'הצעות', en: 'Suggestions' },
  waitingTab: { he: 'ממתינות', en: 'Waiting' },
  liveTab: { he: 'עלו, נבדקות אחרי', en: 'Live, reviewed after' },
  mineTab: { he: 'שלי', en: 'Mine' },
  suggested: { he: 'הציע', en: 'suggested' },
  wentLive: { he: 'עלה מיד · נבדק אחרי', en: 'Went live · reviewed after' },
  discussion: { he: 'לדיון המלא', en: 'Full discussion' },
  newItem: { he: 'פריט חדש', en: 'New item' },
  howTitle: { he: 'איך בודקים', en: 'How to review' },
  how: {
    he: ['קוראים את השינוי: מה נמחק באדום, מה נוסף בירוק.', 'בודקים מול המקור: הדפוס, הסריקה או ההקלטה.', 'מאשרים, או מחזירים עם הערה שאומרת מה חסר.'],
    en: ['Read the change: what was taken out in red, what was put in in green.', 'Check it against the source: the printing, the scan or the recording.', 'Approve it, or send it back with a note that says what is missing.'],
  },
  whoTitle: { he: 'מי מאשר', en: 'Who approves' },
  who: { he: 'אחראי האוסף של כל סט מאשרים את מה שמוצע בו. כל אחד יכול לקרוא ולהגיב.', en: "Each set's keepers approve what is suggested in it. Anyone may read and comment." },
  all: { he: 'כל ההצעות', en: 'All suggestions' },
  reports: { he: 'דיווחים פתוחים', en: 'Open reports' },
  noLive: { he: 'אין שינויים שעלו וממתינים לבדיקה.', en: 'No live change is waiting to be reviewed.' },
  noMine: { he: 'עוד לא הצעת תיקון שנסגר.', en: 'None of your suggestions has been closed yet.' },
  mineSignIn: { he: 'היכנסו כדי לראות את ההצעות שלכם.', en: 'Sign in to see your suggestions.' },
  sentBackBy: { he: 'הוחזרה בידי', en: 'Sent back by' },
  note: { he: 'למה? מה צריך לתקן?', en: 'Why? What needs fixing?' },
  checks: { he: 'בדיקות', en: 'Checks' },
  yours: { he: 'את/ה יכול/ה לאשר', en: 'You can approve' },
  cantApprove: { he: 'רק אחראי האוסף מאשרים', en: 'Only the keepers approve' },
  model: { he: 'מודל', en: 'model' },
  mb: { he: 'MB', en: 'MB' },
  open: { he: 'פתיחה', en: 'Open' },
} as const;

async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const response = await fetch(`/_/suggestions${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

/** A new item, as the reviewer needs it: what kind it is, its name, and its file to hear or read before approving. */
function NewItem({ type, data, files, lang }: { type: string; data: Record<string, unknown>; files: Detail['files']; lang: Lang }) {
  const sha = typeof data.file === 'string' ? data.file : null;
  const file = sha ? files[sha] : undefined;
  const title = labelOf({ id: '', type, data } as Parameters<typeof labelOf>[0], lang);
  return (
    <section className="diff rq-new">
      <header className="diff-h">
        <Icon name="plus" />
        <b>{title}</b>
        <span className="subtle">
          {t(lang, 'newItem')}: {typeName(type, lang)}
        </span>
        {file ? <span className="end num subtle">{`${(file.bytes / 1024 / 1024).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: 1 })} MB`}</span> : null}
      </header>
      <div className="rq-new-b">
        {file?.url && file.mime.startsWith('audio/') ? <audio controls preload="none" src={file.url} /> : null}
        {file?.url && file.mime === 'application/pdf' ? (
          <a className="btn sm" href={file.url} target="_blank" rel="noreferrer">
            <Icon name="file" />
            {t(lang, 'openFile')}
          </a>
        ) : null}
        {file && !file.url ? (
          <p className="subtle">
            <Icon name="lock" size={14} /> {t(lang, 'filePrivate')}
          </p>
        ) : null}
        {sha ? (
          <Link className="num subtle rq-sha" to={href(`/files/${sha}`, lang)} dir="ltr">
            {sha.slice(0, 12)}…
          </Link>
        ) : null}
        {/* What the jobs found it looks like: a machine's guess, for the reviewer to check. */}
        {file?.similar?.map((s, i) => (
          <p key={i} className="rq-similar">
            <MachineLabel lang={lang} size="sm" />
            {st(lang, 'machineLooksLike')}{' '}
            {s.items.map((item, j) => (
              <span key={item.id}>
                {j > 0 ? ', ' : ''}
                <Link to={href(item.path ?? `/${item.id}`, lang)}>{typeName(item.type, lang)}</Link>
              </span>
            ))}
            {s.of ? ` (${s.matched}/${s.of} ${st(lang, 'pagesAlike')})` : ''}
          </p>
        ))}
      </div>
    </section>
  );
}

/** The reviewer's advice: a machine's summary in English, said to be one, deciding nothing. */
function Advice({ advice, lang }: { advice: NonNullable<Detail['advice']>; lang: Lang }) {
  return (
    <aside className="rq-advice" aria-label={t(lang, 'adviceTitle')}>
      <header>
        <Icon name="bot" />
        <b>{t(lang, 'adviceTitle')}</b>
        <MachineLabel lang={lang} size="sm" />
        <span className="end subtle num" dir="ltr">
          {advice.model}
        </span>
      </header>
      <p dir="ltr" lang="en">
        {advice.summary}
      </p>
      <footer>{t(lang, 'adviceNote')}</footer>
    </aside>
  );
}

function SuggestionCard({ detail, lang, onDone, open }: { detail: Detail; lang: Lang; onDone: () => void; open: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cs = detail.changeset;
  const author = detail.names[cs.author] ?? cs.author;
  const live = cs.post_review === 'pending';
  const state = live ? 'open' : stateOf(cs.status);

  const act = (path: string, body: unknown = {}) => async () => {
    setBusy(true);
    setError(null);
    try {
      await call(`/${cs.id}/${path}`, { method: 'POST', body });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const failed = cs.checks.filter((c) => c.status !== 'pass');
  const lastSendBack = [...detail.reviews].reverse().find((r) => r.verdict === 'send_back');
  const labels = detailLabels(detail as unknown as Pick<SuggestionDetail, 'entries'>);
  const page = cs.number ? href(`/suggestions/${cs.number}`, lang) : null;
  const deciding = (cs.status === 'open' && detail.mayApprove) || (live && detail.mayApprove);
  return (
    <article className={`rq-card${open ? ' focused' : ''}${live ? ' live' : ''}`} id={`s${cs.id}`}>
      <header className="rq-h">
        <StateIcon kind="suggestion" state={cs.status === 'merged' && !live ? 'approved' : state === 'closed' ? 'closed' : 'open'} />
        <div className="rq-title">
          <h2>
            {page ? <Link to={page}>{cs.title}</Link> : cs.title}
            {cs.number ? <span className="num"> #{cs.number}</span> : null}
          </h2>
          <p className="rq-meta">
            <Avatar name={author} id={cs.author} size="xs" />
            <b>{author}</b> {W.suggested[lang]} <RelativeTime at={cs.submitted_at ?? cs.created_at} lang={lang} />
            {labels.map((l) => (LABELS[l] ? <Label key={l} tone={LABELS[l]!.tone} size="sm">{LABELS[l]![lang]}</Label> : null))}
          </p>
        </div>
        <div className="rq-state">
          {live ? (
            <span className="machine rq-live">
              <Icon name="pulse" size={12} />
              {W.wentLive[lang]}
            </span>
          ) : cs.status !== 'open' ? (
            <StatusBadge state={stateOf(cs.status) === 'approved' ? 'approved' : stateOf(cs.status) === 'draft' ? 'draft' : 'closed'} size="sm">
              {stateWord(cs.status, lang)}
            </StatusBadge>
          ) : null}
        </div>
      </header>

      <div className="rq-b">
        {cs.description ? (
          <div className="rq-desc">
            <PlainWords text={cs.description} lang={lang} />
          </div>
        ) : null}
        {detail.entries.map((entry) => {
          const item = { id: entry.entityId, type: entry.type, data: (entry.after ?? entry.before ?? {}) as Record<string, unknown> };
          const name = labelOf(item as Parameters<typeof labelOf>[0], lang);
          if (entry.before === null && !entry.withheld) return <NewItem key={entry.entityId} data={item.data} files={detail.files} type={entry.type} lang={lang} />;
          return (
            <div key={entry.entityId}>
              {entry.withheld ? (
                <section className="diff">
                  <header className="diff-h">
                    <Icon name="lock" />
                    <b>{name}</b>
                  </header>
                  <p className="rq-withheld">{t(lang, 'withheldChange')}</p>
                </section>
              ) : (
                <ChangeDiff
                  title={<Link to={href(`/${entry.entityId}`, lang)}>{name}</Link>}
                  where={typeName(entry.type, lang)}
                  changes={entry.changes}
                  lang={lang}
                  icon={entry.type === 'recording' ? 'audio' : entry.type === 'event' ? 'cal' : 'file'}
                />
              )}
              {entry.conflicts.length ? (
                <p className="alert negative rq-conflict">
                  <Icon name="warn" />
                  <span>{t(lang, 'changedSince')}</span>
                </p>
              ) : null}
            </div>
          );
        })}
        {detail.advice && (cs.status === 'open' || live) ? <Advice advice={detail.advice} lang={lang} /> : null}
        {failed.length ? (
          <ul className="rq-checks" aria-label={W.checks[lang]}>
            {failed.map((c) => (
              <li key={c.check} className={c.status}>
                <Icon name={c.status === 'fail' ? 'x' : 'warn'} size={14} />
                {c.message}
              </li>
            ))}
          </ul>
        ) : null}
        {lastSendBack?.body && cs.status === 'sent_back' ? (
          <div className="rq-sentback">
            <Avatar name={detail.names[lastSendBack.reviewer] ?? lastSendBack.reviewer} id={lastSendBack.reviewer} size="xs" />
            <div>
              <p className="subtle">
                {W.sentBackBy[lang]} <b>{detail.names[lastSendBack.reviewer] ?? lastSendBack.reviewer}</b> · <RelativeTime at={lastSendBack.created_at} lang={lang} />
              </p>
              <PlainWords text={lastSendBack.body} lang={lang} />
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="alert negative" role="alert">
            <Icon name="warn" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>

      <footer className="rq-f">
        {cs.status === 'open' && detail.mayApprove ? (
          note === null ? (
            <>
              <button type="button" className="btn approve" onClick={act('approve')} disabled={busy} aria-busy={busy || undefined}>
                <Icon name="check" />
                {t(lang, 'approve')}
              </button>
              <button type="button" className="btn" onClick={() => setNote('')} disabled={busy}>
                <Icon name="back" className="flip-ltr" />
                {t(lang, 'sendBack')}
              </button>
            </>
          ) : (
            <div className="rq-sendback">
              <label className="visually-hidden" htmlFor={`note-${cs.id}`}>
                {t(lang, 'sendBackWhy')}
              </label>
              <textarea id={`note-${cs.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t(lang, 'sendBackWhy')} autoFocus dir="auto" />
              <span className="btn-row">
                <button type="button" className="btn danger" onClick={act('send-back', { note })} disabled={busy || !note.trim()}>
                  <Icon name="back" className="flip-ltr" />
                  {t(lang, 'sendBack')}
                </button>
                <button type="button" className="btn ghost" onClick={() => setNote(null)}>
                  {t(lang, 'cancel')}
                </button>
              </span>
            </div>
          )
        ) : null}
        {live && detail.mayApprove ? (
          <>
            <button type="button" className="btn approve" onClick={act('review-live', { verdict: 'approve' })} disabled={busy}>
              <Icon name="check" />
              {t(lang, 'keepLive')}
            </button>
            <button type="button" className="btn danger" onClick={act('review-live', { verdict: 'revert' })} disabled={busy}>
              <Icon name="history" />
              {t(lang, 'undoLive')}
            </button>
          </>
        ) : null}
        {detail.mine && (cs.status === 'open' || cs.status === 'sent_back') ? (
          <button type="button" className="btn" onClick={act('withdraw')} disabled={busy}>
            <Icon name="x" />
            {t(lang, 'withdraw')}
          </button>
        ) : null}
        {!deciding && cs.status === 'open' && !detail.mine ? (
          <span className="subtle rq-who">
            <Icon name="lock" size={14} /> {W.cantApprove[lang]}
          </span>
        ) : null}
        {page ? (
          <Link className="rq-more" to={page}>
            <Icon name="discuss" />
            {W.discussion[lang]}
          </Link>
        ) : null}
      </footer>
    </article>
  );
}

export default function Review() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const focus = Number(params.get('s')) || null;
  const [waiting, setWaiting] = useState<Detail[] | null>(null);
  const [mine, setMine] = useState<Detail[]>([]);
  const [live, setLive] = useState<Detail[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const details = (list: Suggestion[]) => Promise.all(list.map((s) => call<Detail>(`/${s.id}`)));
      const [open, wentLive] = await Promise.all([call<{ suggestions: Suggestion[] }>('?status=open&limit=30'), call<{ suggestions: Suggestion[] }>('?postReview=true&limit=30')]);
      const [a, b] = await Promise.all([details(open.suggestions), details(wentLive.suggestions)]);
      setWaiting(a);
      setLive(b);
      if (account) {
        const own = await call<{ suggestions: Suggestion[] }>(`?author=${encodeURIComponent(account.person.id)}&limit=100`);
        // Newest first; those still waiting are already listed above.
        setMine(await details(own.suggestions.filter((s) => s.status !== 'open' && s.status !== 'draft').reverse().slice(0, 10)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [account]);

  useEffect(() => {
    if (account !== undefined) void load();
  }, [account, load]);

  // The view asked for, or the one the suggestion asked for is in.
  const asked = params.get('view');
  const holding = (list: Detail[]) => focus !== null && list.some((d) => d.changeset.id === focus);
  const view: View = asked === 'live' || asked === 'mine' || asked === 'waiting' ? asked : holding(live) ? 'live' : holding(mine) ? 'mine' : 'waiting';

  useEffect(() => {
    if (focus && waiting) document.getElementById(`s${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus, waiting]);

  const tabHref = (v: View) => href('/review', lang, { view: v === 'waiting' ? undefined : v });
  const shown = view === 'live' ? live : view === 'mine' ? mine : (waiting ?? []);
  const mayApproveAny = (waiting ?? []).some((d) => d.mayApprove);

  return (
    <>
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs items={[{ label: W.crumbs[lang], to: href('/suggestions', lang) }, { label: t(lang, 'reviewTitle') }]} lang={lang} />
          <h1 className="page-title">{t(lang, 'reviewTitle')}</h1>
          <p className="lede">{t(lang, 'reviewIntro')}</p>
          <Tabs
            label={t(lang, 'reviewTitle')}
            current={view}
            replace
            items={[
              { key: 'waiting', label: W.waitingTab[lang], icon: 'suggest', to: tabHref('waiting'), count: waiting ? num(waiting.length, lang) : undefined },
              { key: 'live', label: W.liveTab[lang], icon: 'pulse', to: tabHref('live'), count: waiting ? num(live.length, lang) : undefined },
              { key: 'mine', label: W.mineTab[lang], icon: 'user', to: tabHref('mine'), count: account && waiting ? num(mine.length, lang) : undefined },
            ]}
          />
        </div>
      </div>
      <div className="wrap cols rq">
        <div className="rq-list">
          {error ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              <span>{error}</span>
            </p>
          ) : null}
          {view === 'live' ? <p className="rq-intro muted">{t(lang, 'liveIntro')}</p> : null}
          {waiting === null && !error ? (
            <div className="box">
              <Skeleton rows={4} lang={lang} />
            </div>
          ) : null}
          {waiting !== null && shown.length === 0 ? (
            view === 'mine' && account === null ? (
              <EmptyState icon="user" title={W.mineSignIn[lang]} actions={<Link className="btn primary" to={href('/signin', lang, { return: '/review?view=mine' })}>{t(lang, 'signIn')}</Link>} />
            ) : (
              <EmptyState icon={view === 'waiting' ? 'check' : 'suggest'} title={view === 'waiting' ? t(lang, 'nothingWaiting') : view === 'live' ? W.noLive[lang] : W.noMine[lang]} />
            )
          ) : null}
          {shown.map((d) => (
            <SuggestionCard key={d.changeset.id} detail={d} lang={lang} onDone={load} open={d.changeset.id === focus} />
          ))}
        </div>
        <aside className="side" aria-label={W.howTitle[lang]}>
          {account === null ? (
            <section>
              <p className="alert info">
                <Icon name="lock" />
                <span>
                  {t(lang, 'reviewSignIn')} <Link to={href('/signin', lang, { return: '/review' })}>{t(lang, 'signIn')}</Link>
                </span>
              </p>
            </section>
          ) : null}
          <section>
            <h4>{W.howTitle[lang]}</h4>
            <ol className="edit-steps">
              {W.how[lang].map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>
          <section>
            <h4>{W.whoTitle[lang]}</h4>
            <p className="muted">{W.who[lang]}</p>
            {waiting && account ? (
              <p className={mayApproveAny ? 'rq-you yes' : 'rq-you'}>
                <Icon name={mayApproveAny ? 'check' : 'lock'} size={14} />
                {mayApproveAny ? W.yours[lang] : W.cantApprove[lang]}
              </p>
            ) : null}
          </section>
          <section>
            <Link to={href('/suggestions', lang)} className="side-link">
              <Icon name="suggest" />
              {W.all[lang]}
            </Link>
            <Link to={href('/issues', lang)} className="side-link">
              <Icon name="report" />
              {W.reports[lang]}
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
