import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/help';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { ps } from '../lib/pageStrings.js';
import { pageMeta } from '../lib/seo.js';
import { thisWeek } from '../lib/week.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, EmptyState } from '../ui/primitives.js';
import '../styles/pages/info.css';

/**
 * How anyone helps build RebbeHub, and what needs help now: the ways in
 * (report a mistake from any page, no account needed; suggest a fix,
 * signed in, and review what waits; check what the machines wrote, the
 * transcripts they heard and the pages they read from scans; add what is
 * missing; write code), and then this week's farbrengens that have no recording linked yet and the
 * farbrengens with no hanacha, each to open and fill in.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const week = thisWeek(lang);
  const [noRecording, noText, community, toCheck] = await Promise.all([
    api.events({ day: week.dayTokens, missing: 'recordings', limit: 40 }),
    api.events({ missing: 'texts', limit: 200 }),
    api.community(1),
    api.toCheck(1).catch(() => null),
  ]);
  // Only the counts: the rows are on /check.
  const machine = toCheck ? { transcripts: toCheck.totals.transcripts, texts: toCheck.totals.texts, scans: toCheck.totals.scans } : null;
  return { lang, siteUrl, noRecording, noText, machine, gaps: community.gaps, openReports: community.openReports, openSuggestions: community.openSuggestions };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'tabHelp'), path: '/help', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  ways: { he: 'דרכים לעזור', en: 'Ways to help' },
  addTitle: { he: 'הוספת מה שחסר', en: 'Add what is missing' },
  addText: { he: 'הנחה, הקלטה, ספר או מכתב שאין באתר: מעלים קובץ, המכונה מציעה לאן הוא שייך, ואתם מאשרים.', en: 'A hanacha, recording, sefer or letter the site lacks: upload the file, the machine proposes where it belongs, and you confirm.' },
  add: { he: 'הוספה', en: 'Add' },
  review: { he: 'לבדיקה', en: 'Review' },
  checkTitle: { he: 'בדיקת מה שהמכונה כתבה', en: 'Check what the machines wrote' },
  checkText: {
    he: 'תמלולים של הקלטות, ועמודים וסריקות שנקראו במכונה (OCR). מאזינים או משווים לסריקה, ומתקנים. כל בדיקה מתקנת את האתר ומלמדת את הדגם הבא.',
    en: 'Transcripts of recordings, and pages and scans read by machine (OCR). Listen or compare with the scan, and fix. Every check fixes the site and teaches the next model.',
  },
  check: { he: 'לבדוק', en: 'Check' },
  reports: { he: 'דיווחים', en: 'Reports' },
  code: { he: 'GitHub', en: 'GitHub' },
  now: { he: 'מה צריך עזרה עכשיו', en: 'What needs help now' },
  open: { he: 'פתוחים', en: 'open' },
  waiting: { he: 'ממתינות', en: 'waiting' },
} as const;

function Way({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="row way">
      <span className="way-icon">
        <Icon name={icon} />
      </span>
      <div className="row-main">
        <b className="row-title">{title}</b>
        <span className="row-sub">{children}</span>
      </div>
      {action ? <span className="way-act">{action}</span> : null}
    </li>
  );
}

function Some({ events, lang }: { events: EventItem[]; lang: Lang }) {
  const sub = (e: EventItem) => dateLabel(eventData(e).date, lang, { civil: false });
  return (
    <>
      <EventRows events={events.slice(0, 8)} sub={sub} />
      {events.length > 8 ? (
        <details className="more-rows">
          <summary className="btn sm">
            {t(lang, 'moreResults')} ({num(events.length - 8, lang)})
            <Icon name="chevd" size={14} />
          </summary>
          <EventRows events={events.slice(8)} sub={sub} />
        </details>
      ) : null}
    </>
  );
}

export default function Help({ loaderData }: Route.ComponentProps) {
  const { lang, noRecording, noText, machine, gaps, openSuggestions, openReports } = loaderData;
  const toCheck = machine ? machine.transcripts + machine.texts + machine.scans : 0;
  return (
    <>
      <div className="phead">
        <div className="wrap">
          <h1 className="page-title">{t(lang, 'tabHelp')}</h1>
          <p className="lede">{t(lang, 'helpIntro')}</p>
        </div>
      </div>
      <div className="wrap cols help">
        <div className="stack-lg">
          <section aria-labelledby="ways">
            <h2 className="h-side" id="ways">
              {W.ways[lang]}
            </h2>
            <Box as="ul" className="ways">
              <Way icon="report" title={t(lang, 'helpReportTitle')} action={<Link className="btn sm" to={href('/issues', lang)}>{W.reports[lang]} <span className="count">{num(openReports, lang)}</span></Link>}>
                {t(lang, 'helpReportText')}
              </Way>
              <Way icon="suggest" title={t(lang, 'helpSuggestTitle')} action={<Link className="btn sm" to={href('/review', lang)}>{W.review[lang]} <span className="count">{num(openSuggestions, lang)}</span></Link>}>
                {t(lang, 'helpSuggestText')}
              </Way>
              <Way icon="check" title={W.checkTitle[lang]} action={<Link className="btn sm" to={href('/check', lang)}>{W.check[lang]} <span className="count">{num(toCheck, lang)}</span></Link>}>
                {W.checkText[lang]}
              </Way>
              <Way icon="upload" title={W.addTitle[lang]} action={<Link className="btn sm primary" to={href('/add', lang)}><Icon name="plus" />{W.add[lang]}</Link>}>
                {W.addText[lang]}
              </Way>
              <Way icon="code" title={t(lang, 'helpCodeTitle')} action={<a className="btn sm" href="https://github.com/shmuky/RebbeHub/blob/main/CONTRIBUTING.md"><Icon name="external" />{W.code[lang]}</a>}>
                {t(lang, 'helpCodeText')}
              </Way>
            </Box>
          </section>

          <section id="recordings">
            <h2 className="h-side">
              <Icon name="audio" className="subtle" />
              {t(lang, 'helpRecordingsTitle')}
              <span className="count">{num(gaps.eventsWithoutRecordings, lang)}</span>
            </h2>
            <p className="muted help-say">{t(lang, 'helpRecordingsText')}</p>
            {noRecording.length ? (
              <Some events={noRecording as EventItem[]} lang={lang} />
            ) : (
              <div className="box">
                <EmptyState compact icon="check" title={t(lang, 'helpNothingThisWeek')} />
              </div>
            )}
          </section>

          <section id="texts">
            <h2 className="h-side">
              <Icon name="file" className="subtle" />
              {t(lang, 'helpTextsTitle')}
              <span className="count">{num(gaps.eventsWithoutTexts, lang)}</span>
            </h2>
            <p className="muted help-say">{t(lang, 'helpTextsText')}</p>
            {noText.length ? (
              <Some events={noText as EventItem[]} lang={lang} />
            ) : (
              <div className="box">
                <EmptyState compact icon="check" title={ps(lang, 'nothingHere')} />
              </div>
            )}
          </section>
        </div>

        <aside className="side" aria-label={W.now[lang]}>
          <section>
            <h2>{W.now[lang]}</h2>
            <ul className="side-list help-now">
              <li>
                <Link to={href('/review', lang)}>
                  <Icon name="suggest" />
                  <span className="grow">{t(lang, 'reviewTitle')}</span>
                  <span className="num subtle">{num(openSuggestions, lang)}</span>
                </Link>
              </li>
              <li>
                <Link to={href('/check', lang)}>
                  <Icon name="check" />
                  <span className="grow">{W.checkTitle[lang]}</span>
                  <span className="num subtle">{num(toCheck, lang)}</span>
                </Link>
              </li>
              <li>
                <Link to={href('/issues', lang)}>
                  <Icon name="report" />
                  <span className="grow">{W.reports[lang]}</span>
                  <span className="num subtle">{num(openReports, lang)}</span>
                </Link>
              </li>
              <li>
                <a href="#recordings">
                  <Icon name="audio" />
                  <span className="grow">{t(lang, 'helpRecordingsTitle')}</span>
                  <span className="num subtle">{num(gaps.eventsWithoutRecordings, lang)}</span>
                </a>
              </li>
              <li>
                <a href="#texts">
                  <Icon name="file" />
                  <span className="grow">{t(lang, 'helpTextsTitle')}</span>
                  <span className="num subtle">{num(gaps.eventsWithoutTexts, lang)}</span>
                </a>
              </li>
            </ul>
          </section>
          <section>
            <ul className="side-list help-now">
              <li>
                <Link to={href('/missing', lang)}>
                  <Icon name="target" />
                  <span className="grow">{t(lang, 'missingTitle')}</span>
                </Link>
              </li>
              <li>
                <Link to={href('/projects', lang)}>
                  <Icon name="layers" />
                  <span className="grow">{t(lang, 'projectsTitle')}</span>
                </Link>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}
