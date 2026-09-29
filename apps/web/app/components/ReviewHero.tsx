import { Headphones, PenLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { MachineToCheck } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { get } from '../lib/transcript.js';
import { Bar } from '../ui/primitives.js';

/**
 * The home page's big band for checking the recordings: how many
 * farbrengens the transcription machine heard that no person has checked,
 * how near the next model is, and the farbrengens to open next, each
 * straight into its editor (`?review=1#transcript`). The list comes with
 * the page (one read, GET /v1/machine/to-check); the training goal is
 * asked for by the browser, so the page costs no more to draw.
 */

interface Goal {
  model: string;
  hours: { done: number; target: number };
  farbrengens: { done: number; target: number };
  next: Array<{ event: string; path: string | null; title: { he: string; en?: string } | null; date: string | null; paragraphs: number; checked: number; mostWanted: boolean }>;
}

type Row = { event: string; path: string | null; title: { he: string; en?: string } | null; date: string | null; paragraphs: number; checked: number; mostWanted?: boolean };

const W = {
  kicker: { he: 'תמלולי ההקלטות', en: 'Transcripts of the recordings' },
  title: { he: 'עזרו לבדוק את שיחות הרבי', en: "Help check the Rebbe's talks" },
  lede: {
    he: 'המכונה שמעה את ההקלטות וכתבה את המילים. מאזינים, קוראים יחד, ומתקנים מה שלא נשמע נכון. כל בדיקה מתקנת את האתר ומלמדת את מודל התמלול הבא.',
    en: 'The machine heard the recordings and wrote down the words. Listen, read along, and fix what was misheard. Every check fixes the site and teaches the next transcription model.',
  },
  farbrengens: { he: 'התוועדויות מחכות', en: 'farbrengens waiting' },
  paragraphs: { he: 'פסקאות לבדוק', en: 'paragraphs to check' },
  model: { he: 'לקראת {model}', en: 'Towards {model}' },
  modelOf: { he: '{done} מתוך {target} התוועדויות נבדקו', en: '{done} of {target} farbrengens checked' },
  start: { he: 'להתחיל לבדוק', en: 'Start checking' },
  all: { he: 'כל הרשימה', en: 'The whole list' },
  next: { he: 'לבדוק עכשיו', en: 'Check next' },
  checkedOf: { he: '{done} מתוך {all} פסקאות נבדקו', en: '{done} of {all} paragraphs checked' },
  review: { he: 'לבדוק', en: 'Check' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const reviewHref = (row: Row, lang: Lang) => `${href(row.path ?? `/${row.event}`, lang, { review: '1' })}#transcript`;

export function ReviewHero({ lang, list }: { lang: Lang; list: MachineToCheck }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => {
    let live = true;
    void get<{ goal: Goal }>('machine/training')
      .then((r) => live && setGoal(r.goal))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The most wanted first, once the browser knows them; until then, what the machine heard last.
  const rows: Row[] = goal?.next.length ? goal.next.slice(0, 6) : list.transcripts.slice(0, 6);
  const first = rows[0];
  return (
    <section className="review-hero" aria-labelledby="review-hero-h">
      <div className="wrap review-hero-in">
        <div className="review-hero-main">
          <span className="review-hero-kicker">
            <Headphones size={16} aria-hidden />
            {w(lang, 'kicker')}
          </span>
          <h2 className="review-hero-title" id="review-hero-h">
            {w(lang, 'title')}
          </h2>
          <p className="review-hero-lede">{w(lang, 'lede')}</p>
          <div className="review-hero-stats">
            <div>
              <b className="num">{num(list.totals.transcripts, lang)}</b>
              <span>{w(lang, 'farbrengens')}</span>
            </div>
            <div>
              <b className="num">{num(list.totals.paragraphs, lang)}</b>
              <span>{w(lang, 'paragraphs')}</span>
            </div>
          </div>
          <div className="review-hero-goal" aria-live="polite">
            {goal ? (
              <>
                <span className="review-hero-goal-t">
                  <b>{w(lang, 'model').replace('{model}', goal.model)}</b>
                  {' · '}
                  {w(lang, 'modelOf').replace('{done}', num(goal.farbrengens.done, lang)).replace('{target}', num(goal.farbrengens.target, lang))}
                </span>
                <Bar value={goal.farbrengens.done} max={goal.farbrengens.target} label={w(lang, 'modelOf').replace('{done}', String(goal.farbrengens.done)).replace('{target}', String(goal.farbrengens.target))} />
              </>
            ) : null}
          </div>
          <div className="review-hero-acts">
            {first ? (
              <Link className="btn primary lg" to={reviewHref(first, lang)}>
                <PenLine size={18} aria-hidden />
                {w(lang, 'start')}
              </Link>
            ) : null}
            <Link className="btn lg" to={href('/check', lang)}>
              {w(lang, 'all')}
            </Link>
          </div>
        </div>

        <div className="review-hero-list">
          <h3 className="review-hero-h3">{w(lang, 'next')}</h3>
          <ul>
            {rows.map((row) => {
              const title = nameOf(row.title ?? undefined, lang) || (row.date ? dateLabel(row.date, lang, { civil: false }) : row.event);
              return (
                <li key={row.event}>
                  <Link className="review-hero-row" to={reviewHref(row, lang)}>
                    <span className="review-hero-row-main">
                      <span className="review-hero-row-t">{title}</span>
                      <span className="review-hero-row-s">
                        {row.date && row.title ? `${dateLabel(row.date, lang, { civil: false })} · ` : ''}
                        {w(lang, 'checkedOf').replace('{done}', num(row.checked, lang)).replace('{all}', num(row.paragraphs, lang))}
                        {row.mostWanted ? ` · ${t(lang, 'mostWanted')}` : ''}
                      </span>
                      <Bar value={row.checked} max={row.paragraphs} />
                    </span>
                    <span className="review-hero-go">{w(lang, 'review')}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
