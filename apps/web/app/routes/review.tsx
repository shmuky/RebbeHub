import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/review';
import { QueueRow } from '../components/QueueRow.js';
import { TranscriptFixes } from '../components/TranscriptFixes.js';
import { ReviewCard, suggestionCall as call, type ReviewDetail, type ReviewPerson, type ReviewRow } from '../components/ReviewCard.js';
import { langFrom, t } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Breadcrumbs, EmptyState, Skeleton, Tabs } from '../ui/primitives.js';
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
 * The queue is a list of titles, as GitHub lists pull requests: one line
 * each, with its #number, who sent it, when and how many items it
 * changes. Its changes, a page of 25 at a time, and Approve are on its
 * own page, so a queue of a bot's Suggestions of 500 items each opens at
 * once and reads at a glance. A Suggestion with no #number (an import)
 * has no page of its own: its line opens it here (`?s=`), whole, as its
 * card (components/ReviewCard.tsx).
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'reviewTitle'), path: '/review', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

type View = 'waiting' | 'transcripts' | 'live' | 'mine';

const W = {
  crumbs: { he: 'הצעות', en: 'Suggestions' },
  waitingTab: { he: 'ממתינות', en: 'Waiting' },
  transcriptsTab: { he: 'תיקוני תמלול', en: 'Transcript fixes' },
  liveTab: { he: 'עלו, נבדקות אחרי', en: 'Live, reviewed after' },
  mineTab: { he: 'שלי', en: 'Mine' },
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
  yours: { he: 'את/ה יכול/ה לאשר', en: 'You can approve' },
} as const;


export default function Review() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const focus = Number(params.get('s')) || null;
  const [waiting, setWaiting] = useState<ReviewRow[] | null>(null);
  const [mine, setMine] = useState<ReviewRow[]>([]);
  const [live, setLive] = useState<ReviewRow[]>([]);
  const [people, setPeople] = useState<Record<string, ReviewPerson>>({});
  const [decidable, setDecidable] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // The lists alone: each Suggestion's changes are read by its card, as it comes into view.
  const load = useCallback(async () => {
    type List = { suggestions: ReviewRow[]; people?: Record<string, ReviewPerson> };
    try {
      const [open, wentLive, own] = await Promise.all([
        call<List>('?status=open&limit=100'),
        call<List>('?postReview=true&limit=30'),
        account ? call<List>(`?author=${encodeURIComponent(account.person.id)}&limit=100`) : Promise.resolve<List>({ suggestions: [] }),
      ]);
      let waitingRows = open.suggestions;
      const found = { ...open.people, ...wentLive.people, ...own.people };
      // Asked for by id (`?s=`) and in none of the lists (an import has no #number to link to): read on its own.
      if (focus !== null && ![...open.suggestions, ...wentLive.suggestions, ...own.suggestions].some((s) => s.id === focus)) {
        const one = await call<ReviewDetail & { people?: Record<string, ReviewPerson> }>(`/${focus}?limit=1`).catch(() => null);
        if (one) {
          waitingRows = [{ ...one.changeset, items: one.total }, ...waitingRows];
          Object.assign(found, one.people);
        }
      }
      setPeople(found);
      setWaiting(waitingRows);
      setLive(wentLive.suggestions);
      // Newest first; those still waiting are already listed above.
      setMine(own.suggestions.filter((s) => s.status !== 'open' && s.status !== 'draft').reverse().slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [account, focus]);

  useEffect(() => {
    if (account !== undefined) void load();
  }, [account, load]);

  const onDecidable = useCallback((id: number, may: boolean) => setDecidable((d) => (may === d.has(id) ? d : may ? new Set([...d, id]) : new Set([...d].filter((x) => x !== id)))), []);

  // The view asked for, or the one the suggestion asked for is in.
  const asked = params.get('view');
  const holding = (list: ReviewRow[]) => focus !== null && list.some((d) => d.id === focus);
  const view: View = asked === 'live' || asked === 'mine' || asked === 'waiting' || asked === 'transcripts' ? asked : holding(live) ? 'live' : holding(mine) ? 'mine' : 'waiting';

  useEffect(() => {
    if (focus && waiting) document.getElementById(`s${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus, waiting]);

  const tabHref = (v: View) => href('/review', lang, { view: v === 'waiting' ? undefined : v });
  const shown = view === 'transcripts' ? [] : view === 'live' ? live : view === 'mine' ? mine : (waiting ?? []);
  const mayApproveAny = decidable.size > 0;

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
              { key: 'transcripts', label: W.transcriptsTab[lang], icon: 'audio', to: tabHref('transcripts') },
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
          {view === 'transcripts' ? <TranscriptFixes lang={lang} onDone={load} /> : null}
          {view === 'live' ? <p className="rq-intro muted">{t(lang, 'liveIntro')}</p> : null}
          {view !== 'transcripts' && waiting === null && !error ? (
            <div className="box">
              <Skeleton rows={4} lang={lang} />
            </div>
          ) : null}
          {view !== 'transcripts' && waiting !== null && shown.length === 0 ? (
            view === 'mine' && account === null ? (
              <EmptyState icon="user" title={W.mineSignIn[lang]} actions={<Link className="btn primary" to={href('/signin', lang, { return: '/review?view=mine' })}>{t(lang, 'signIn')}</Link>} />
            ) : (
              <EmptyState icon={view === 'waiting' ? 'check' : 'suggest'} title={view === 'waiting' ? t(lang, 'nothingWaiting') : view === 'live' ? W.noLive[lang] : W.noMine[lang]} />
            )
          ) : null}
          {/* The one asked for by `?s=` whole, with its changes and Approve; the rest as titles. */}
          {shown.filter((row) => row.id === focus).map((row) => (
            <ReviewCard key={`${row.id}:${row.status}:${row.post_review}`} row={row} person={people[row.author]} lang={lang} onDone={load} open onDecidable={onDecidable} />
          ))}
          {shown.some((row) => row.id !== focus) ? (
            <section className="box">
              <ul className="rows issue-rows">
                {shown.filter((row) => row.id !== focus).map((row) => (
                  <QueueRow key={row.id} row={row} person={people[row.author]} lang={lang} />
                ))}
              </ul>
            </section>
          ) : null}
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
            {/* Known only for a Suggestion opened here; its own page says so for the rest. */}
            {waiting && account && mayApproveAny ? (
              <p className="rq-you yes">
                <Icon name="check" size={14} />
                {W.yours[lang]}
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
