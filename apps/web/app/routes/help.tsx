import { Code2, Flag, Headphones, KeyRound, ScrollText } from 'lucide-react';
import type { Route } from './+types/help';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, t } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';
import { thisWeek } from '../lib/week.js';

/**
 * How anyone helps build RebbeHub, and what needs help now: this week's
 * farbrengens that have no recording linked yet, the farbrengens with no
 * hanacha, reporting a mistake from any page (no account needed), and the
 * code. Suggesting a fix directly comes with sign-in.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const week = thisWeek(lang);
  const [noRecording, noText, community] = await Promise.all([
    api.events({ day: week.dayTokens, missing: 'recordings', limit: 40 }),
    api.events({ missing: 'texts', limit: 200 }),
    api.community(1),
  ]);
  return { lang, siteUrl, noRecording, noText, gaps: community.gaps, openReports: community.openReports };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'tabHelp'), path: '/help', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export default function Help({ loaderData }: Route.ComponentProps) {
  const { lang, noRecording, noText, gaps } = loaderData;
  /** The first few, and the rest behind "more". */
  const Some = ({ events }: { events: EventItem[] }) => {
    const sub = (e: EventItem) => dateLabel(eventData(e).date, lang, { civil: false });
    return (
      <>
        <EventRows events={events.slice(0, 8)} sub={sub} />
        {events.length > 8 ? (
          <details className="more">
            <summary className="more-link">
              {t(lang, 'moreResults')} ({events.length - 8})
            </summary>
            <EventRows events={events.slice(8)} sub={sub} />
          </details>
        ) : null}
      </>
    );
  };
  const num = (n: number) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
  return (
    <>
      <h1>{t(lang, 'tabHelp')}</h1>
      <p className="subtitle">{t(lang, 'helpIntro')}</p>

      <section className="callout" style={{ ['--tone' as string]: '#8c2a3c' }}>
        <span className="callout-icon" aria-hidden="true">
          <Flag size={20} />
        </span>
        <div>
          <b>{t(lang, 'helpReportTitle')}</b>
          <p>{t(lang, 'helpReportText')}</p>
        </div>
      </section>

      <section id="recordings">
        <h2 className="section-header">
          <span>
            <Headphones size={14} aria-hidden="true" /> {t(lang, 'helpRecordingsTitle')}
          </span>
          <span>{num(gaps.eventsWithoutRecordings)}</span>
        </h2>
        <p className="row-sub">{t(lang, 'helpRecordingsText')}</p>
        {noRecording.length ? <Some events={noRecording as EventItem[]} /> : <p className="subtitle">{t(lang, 'helpNothingThisWeek')}</p>}
      </section>

      <section id="texts">
        <h2 className="section-header">
          <span>
            <ScrollText size={14} aria-hidden="true" /> {t(lang, 'helpTextsTitle')}
          </span>
          <span>{num(gaps.eventsWithoutTexts)}</span>
        </h2>
        <p className="row-sub">{t(lang, 'helpTextsText')}</p>
        <Some events={noText as EventItem[]} />
      </section>

      <section className="callout" style={{ ['--tone' as string]: '#23466e' }}>
        <span className="callout-icon" aria-hidden="true">
          <KeyRound size={20} />
        </span>
        <div>
          <b>{t(lang, 'helpSoonTitle')}</b>
          <p>{t(lang, 'helpSoonText')}</p>
        </div>
      </section>

      <section className="callout" style={{ ['--tone' as string]: '#16744a' }}>
        <span className="callout-icon" aria-hidden="true">
          <Code2 size={20} />
        </span>
        <div>
          <b>{t(lang, 'helpCodeTitle')}</b>
          <p>{t(lang, 'helpCodeText')}</p>
          <a className="button" href="https://github.com/shmuky/RebbeHub/blob/main/CONTRIBUTING.md">
            GitHub
          </a>
        </div>
      </section>
    </>
  );
}
