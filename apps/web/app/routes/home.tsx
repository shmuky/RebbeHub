import { dateKeyToGregorian, dateKeyToHDate, toHebrewNumeral } from '@rebbehub/hebrew';
import type { LocalName } from '@rebbehub/model';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/home';
import type { Via } from '../lib/threads.js';
import { ContinueRow } from '../components/ContinueRow.js';
import { eventData, type EventItem } from '../components/EventRow.js';
import type { Entity, SuggestionDetail } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import { num, tu } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { personName } from '../lib/people.js';
import { pageMeta } from '../lib/seo.js';
import { LABELS, changeExcerpt, detailLabels, firstTextChange, wordsChanged } from '../lib/suggestions.js';
import { describeTargets, type Target } from '../lib/targets.server.js';
import { useAccount } from '../lib/useAccount.js';
import { useFollows } from '../lib/useFollows.js';
import { kviusYears, thisWeek } from '../lib/week.js';
import type { DiffPart } from '../lib/wordDiff.js';
import { InlineDiff } from '../ui/Diff.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { AgentBy, Bar, Label, MachineLabel, RelativeTime, StatusBadge, cx } from '../ui/primitives.js';

/**
 * The home page is the community's desk. Under the header, the day: its
 * Hebrew date, the chag, the coming Shabbos's parsha and this week in the
 * Rebbe's years. Then three columns: the library at hand (and what you
 * follow); what is happening (suggestions asking for review, what was
 * approved, what importers and machines did, with the words that changed);
 * and today in other years, where help is needed, and the projects under
 * way. Personal parts (continue, your feed, what waits for your review)
 * are drawn in the browser; the page itself is the same for everyone.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const week = thisWeek(lang);
  const matching = kviusYears(Number(week.today.slice(0, 4)));
  const [weekEvents, community, stats, works, unitCounts, projects, health, open, issues] = await Promise.all([
    api.events({ day: week.dayTokens, limit: 2000 }),
    api.community(12),
    api.stats(),
    api.list({ type: 'work', limit: 500 }),
    api.refCounts('work', 'unit'),
    api.projects().catch(() => ({ projects: [] })),
    api.health().catch(() => null),
    api.suggestions({ status: 'open', limit: 500 }).catch(() => []),
    api.issues({ state: 'open', limit: 6 }).catch(() => null),
  ]);

  // The week, in a year whose calendar falls like this one (as Sichos-Kodesh's app does).
  const byYear = new Map<number, EventItem[]>();
  for (const e of weekEvents) {
    const year = Number(String(eventData(e).date).slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), e]);
  }
  const asked = Number(new URL(request.url).searchParams.get('year'));
  const fullest = (years: number[]) => [...years].sort((a, b) => (byYear.get(b)?.length ?? 0) - (byYear.get(a)?.length ?? 0) || b - a)[0];
  const year = byYear.has(asked) ? asked : (fullest(matching.filter((y) => byYear.has(y))) ?? fullest([...byYear.keys()]) ?? matching[0] ?? null);
  const todayTokens = new Set(week.dayTokens.filter((tok) => tok.endsWith(week.today.slice(-3))));
  const today = weekEvents
    .filter((e) => todayTokens.has(String(eventData(e).date).slice(5)))
    .sort((a, b) => String(eventData(b).date).localeCompare(String(eventData(a).date)));

  // The library's first shelves: the sefarim with most in them, each with its volumes.
  const top = [...works.items].sort((a, b) => (unitCounts[b.id] ?? 0) - (unitCounts[a.id] ?? 0)).slice(0, 6);
  const outlines = await Promise.all(top.map((w) => api.workOutline(w.id).catch(() => [])));
  const library = top.map((w, i) => ({ id: w.id, path: itemPath(w), title: labelOf(w, lang), units: unitCounts[w.id] ?? 0, volumes: outlines[i]!.length }));

  // The feed: suggestions asking for review (newest first), with the words they change.
  const newestOpen = open.filter((s) => s.kind !== 'import').slice(-6).reverse();
  // A few items of each are enough for a row, their facts without their words (brief): its first change of words is
  // in `changes`, its labels, and how many items in all.
  const details = (await Promise.all(newestOpen.map((s) => api.suggestion(s.id, { limit: 8, brief: true }).catch(() => null)))).filter((d): d is SuggestionDetail => d !== null);
  const targets = await describeTargets(api, details.flatMap((d) => d.entries), lang);
  const suggestionItems: FeedItem[] = details.map((d) => {
    const first = d.entries[0];
    const target = first ? targets.get(first.entityId) : undefined;
    const change = firstTextChange(d);
    // A date reads as a date ("ו׳ מרחשון תשי״ז"), not as its key.
    const diff: DiffPart[] | null =
      change && /date/i.test(change.path) && /^\d{4}-/.test(change.before)
        ? [
            { kind: 'del', text: dateLabel(change.before, lang, { civil: false }) },
            { kind: 'same', text: ' ' },
            { kind: 'ins', text: dateLabel(change.after, lang, { civil: false }) },
          ]
        : changeExcerpt(d, 4);
    return {
      kind: 'suggestion',
      key: `s${d.changeset.id}`,
      at: d.changeset.submitted_at ?? d.changeset.created_at,
      id: d.changeset.id,
      number: d.changeset.number ?? null,
      who: d.names[d.changeset.author] ?? d.changeset.author,
      whoId: d.changeset.author,
      via: d.changeset.via ?? null,
      title: d.changeset.title,
      diff,
      labels: detailLabels(d),
      where: target ? [target.within, target.label].filter(Boolean).join(' · ') : null,
      whereHref: target?.path ?? null,
      entities: [...new Set(d.entries.flatMap((e) => [e.entityId, targets.get(e.entityId)?.rootId ?? '']).filter(Boolean))],
      words: wordsChanged(d),
      items: d.total ?? d.entries.length,
    };
  });

  // What was approved lately, and what the importers and machines did: each with the items it touched.
  const since = Math.max(0, stats.head - 12);
  // Three items of each are shown; an import's commit changes thousands, which the feed only counts.
  const commits = await api.commits(since, 12, 3).catch(() => []);
  const names = new Map(community.recent.map((c) => [c.seq, c]));
  // What each commit touched, as people say it: a paragraph is its sicha, a printing its sefer's.
  const touched = await describeTargets(api, commits.flatMap((c) => c.changes.slice(0, 3).map((x) => ({ entityId: x.id, type: x.type, before: null, after: x.data }))), lang).catch(() => new Map<string, Target>());
  const commitItems: FeedItem[] = commits
    .filter((c) => c.author !== 'system')
    .map((c) => {
      const who = names.get(c.seq);
      const bot = who?.authorIsBot ?? c.author.startsWith('bot:');
      const items = c.changes.slice(0, 3).map((x) => {
        const target = touched.get(x.id);
        return target ? { id: x.id, path: target.path, label: [target.label, target.within].filter(Boolean).join(', '), type: x.type } : { id: x.id, path: x.path ?? `/${x.id}`, label: labelOf({ id: x.id, type: x.type, path: x.path, rev: 0, data: x.data ?? {} } as Entity, lang), type: x.type };
      });
      return {
        kind: bot ? 'bot' : 'merged',
        key: `c${c.seq}`,
        at: c.at,
        who: personName(c.author, who?.authorName, lang),
        whoId: c.author,
        via: c.via ?? null,
        by: who?.mergedByName && c.mergedBy !== c.author ? who.mergedByName : null,
        title: c.message,
        count: c.changed ?? c.changes.length,
        types: c.types ?? [...new Set(c.changes.map((x) => x.type))],
        items: [...new Map(items.map((i) => [i.label, i])).values()],
        entities: [...c.changes.map((x) => x.id), ...c.changes.map((x) => touched.get(x.id)?.rootId ?? '').filter(Boolean)],
      } as FeedItem;
    });

  // Issues people opened: what is wrong, where, with its labels.
  const issueItems: FeedItem[] = (issues?.items ?? []).map((i) => ({
    kind: 'issue',
    key: `i${i.number}`,
    at: i.createdAt,
    number: i.number,
    who: i.author ? (issues!.people[i.author]?.name ?? i.author) : lang === 'he' ? 'אורח' : 'A guest',
    whoId: i.author ?? '',
    title: i.title ?? i.typeTitle[lang],
    labels: i.labels.map((l) => ({ name: l.name, color: l.color })),
    where: i.entity ? { label: nameOf(i.entity.name as LocalName, lang) || i.entity.id, path: i.entity.path ?? `/${i.entity.id}` } : null,
    comments: i.comments,
    entities: [i.entity?.id ?? '', i.set ?? ''].filter(Boolean),
  }));

  const feed = [...suggestionItems, ...commitItems, ...issueItems].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 14);

  return {
    lang,
    siteUrl,
    week,
    civil: dateKeyToGregorian(week.today),
    weekday: dateKeyToHDate(week.today)?.getDay() ?? 0,
    year,
    yearEvents: year ? (byYear.get(year) ?? []) : [],
    years: [...byYear.entries()].map(([y, list]) => ({ year: y, count: list.length })).sort((a, b) => b.year - a.year),
    today: today.slice(0, 5),
    todayTotal: today.length,
    community,
    counts: stats.counts,
    library,
    projects: projects.projects.filter((p) => p.status === 'open').slice(0, 3),
    pages: health ? health.pages : null,
    recordings: health ? health.recordings : null,
    feed,
  };
}

type FeedItem =
  | { kind: 'suggestion'; key: string; at: string; id: number; number: number | null; who: string; whoId: string; via?: Via | null; title: string; diff: DiffPart[] | null; labels: string[]; where: string | null; whereHref: string | null; entities: string[]; words: number; items: number }
  | { kind: 'issue'; key: string; at: string; number: number; who: string; whoId: string; title: string; labels: Array<{ name: string; color: string }>; where: { label: string; path: string } | null; comments: number; entities: string[] }
  | { kind: 'merged' | 'bot'; key: string; at: string; who: string; whoId: string; via?: Via | null; by: string | null; title: string; count: number; types: string[]; items: Array<{ id: string; path: string; label: string; type: string }>; entities: string[] };

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl } = loaderData;
  const base = siteUrl.replace(/\/$/, '');
  return pageMeta({
    title: '',
    description: t(lang, 'tagline'),
    path: '/',
    lang,
    siteUrl,
    // The site and who keeps it: search engines show the name and logo beside results, and search from the result itself.
    jsonLd: [
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        name: 'RebbeHub',
        url: `${base}/`,
        inLanguage: ['he', 'en'],
        publisher: { '@id': `${base}/#organization` },
        potentialAction: { '@type': 'SearchAction', target: `${base}/search?q={q}`, 'query-input': 'required name=q' },
      },
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name: 'RebbeHub',
        url: `${base}/`,
        logo: { '@type': 'ImageObject', url: `${base}/icon-512.png`, width: 512, height: 512 },
        sameAs: ['https://github.com/shmuky/RebbeHub'],
      },
    ],
  });
}

const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

const W = {
  activity: { he: 'פעילות', en: 'Activity' },
  activityLede: { he: 'מה שקרה באוספים שאתם עוקבים אחריהם ובהצעות שאתם בודקים.', en: 'What happened in what you follow and in the suggestions you review.' },
  activityLedeAll: { he: 'מה שקרה באתר: הצעות, אישורים, ייבוא וסנכרון.', en: 'What happened across the site: suggestions, approvals, imports and syncs.' },
  forMe: { he: 'לי', en: 'For me' },
  all: { he: 'כל האתר', en: 'Everything' },
  review: { he: 'ממתין לבדיקה שלי', en: 'Waiting for my review' },
  askedReview: { he: 'ביקש בדיקה בהצעה', en: 'asked for review on' },
  askedYourReview: { he: 'ביקש את בדיקתך בהצעה', en: 'asked for your review on' },
  reported: { he: 'דיווח על בעיה', en: 'reported a problem' },
  comments: { he: 'תגובות', en: 'comments' },
  suggestionsN: { he: 'הצעות', en: 'suggestions' },
  reportsN: { he: 'דיווחים', en: 'reports' },
  approved: { he: 'אישר את', en: 'approved' },
  approvedChange: { he: 'שינוי של', en: 'a change by' },
  imported: { he: 'הוסיף', en: 'added' },
  items: { he: 'פריטים', en: 'items' },
  changedWords: { he: 'שינויים במילים', en: 'words changed' },
  changes: { he: 'שינויים', en: 'changes' },
  approvedBadge: { he: 'אושרה', en: 'Approved' },
  toReview: { he: 'לבדיקה', en: 'Review' },
  library: { he: 'הספרייה', en: 'Library' },
  allLibrary: { he: 'כל הספרייה', en: 'The whole library' },
  volumes: { he: 'כר׳', en: 'vols.' },
  recorded: { he: 'התוועדויות מוקלטות', en: 'Recorded farbrengens' },
  following: { he: 'אוספים שאני עוקב אחריהם', en: 'What I follow' },
  followHint: { he: 'עקבו אחרי ספר או אוסף כדי לראות כאן מה משתנה בו.', en: 'Follow a sefer or a set to see here what changes in it.' },
  todayOther: { he: 'היום בשנים אחרות', en: 'Today in other years' },
  weekIn: { he: 'השבוע בשנת', en: 'This week in' },
  allLink: { he: 'הכול', en: 'All' },
  help: { he: 'איפה צריך עזרה', en: 'Where help is needed' },
  noRecording: { he: 'התוועדויות בלי הקלטה מקושרת', en: 'farbrengens with no recording linked' },
  alreadyLinked: { he: 'כבר מקושרות', en: 'already linked' },
  of: { he: 'מתוך', en: 'of' },
  reportsWaiting: { he: 'דיווחים ממתינים לבדיקה', en: 'reports waiting to be checked' },
  suggestionsWaiting: { he: 'הצעות ממתינות לבדיקה', en: 'suggestions waiting for review' },
  pagesUnchecked: { he: 'עמודים סרוקים שטרם נבדקו', en: 'scanned pages not yet checked' },
  noText: { he: 'התוועדויות בלי טקסט', en: 'farbrengens with no text' },
  projects: { he: 'פרויקטים פעילים', en: 'Active projects' },
  noProjects: { he: 'אין כרגע פרויקט פתוח.', en: 'No project is open just now.' },
  nextShabbos: { he: 'שבת הבאה', en: 'This Shabbos' },
  parsha: { he: 'פרשת', en: 'Parshas' },
  farbrengen: { he: 'התוועדות', en: 'Farbrengen' },
  parts: { he: 'חלקים', en: 'parts' },
  part: { he: 'חלק', en: 'part' },
  noRecordingShort: { he: 'אין הקלטה', en: 'no recording' },
  hanacha: { he: 'הנחה', en: 'hanacha' },
  nothingYet: { he: 'עוד לא קרה כאן דבר.', en: 'Nothing has happened here yet.' },
  nothingMine: { he: 'אין עדיין פעילות במה שאתם עוקבים אחריו.', en: 'Nothing yet in what you follow.' },
  nothingReview: { he: 'אין הצעה שממתינה לבדיקה שלכם.', en: 'No suggestion is waiting for your review.' },
  signInFeed: { he: 'היכנסו כדי לראות את הפעילות שלכם.', en: 'Sign in to see your own activity.' },
  machineImport: { he: 'ייבוא אוטומטי · טרם נבדק', en: 'Automatic import · not yet checked' },
  inCatalog: { he: 'בקטלוג', en: 'In the catalog' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

function DayStrip({ lang, week, civil, weekday, year, yearCount }: { lang: Lang; week: Route.ComponentProps['loaderData']['week']; civil: string | null; weekday: number; year: number | null; yearCount: number }) {
  const civilShort = civil ? civil.split('-').map(Number).reverse().join('.') : null;
  return (
    <div className="daybar">
      <div className="wrap">
        <span>
          <Icon name="cal" />
          {lang === 'he' ? `יום ${WEEKDAYS_HE[weekday]}, ` : `${WEEKDAYS_EN[weekday]}, `}
          <b>{week.todayLabel}</b>
          {civilShort ? ` · ${civilShort}` : ''}
        </span>
        {week.holidays.length ? (
          <>
            <span className="sep" />
            <span>
              <b>{week.holidays.join(' · ')}</b>
            </span>
          </>
        ) : null}
        {week.parsha ? (
          <>
            <span className="sep" />
            <span className="home-parsha">
              {w(lang, 'nextShabbos')}:{' '}
              <b>
                {w(lang, 'parsha')} {week.parsha}
              </b>
            </span>
          </>
        ) : null}
        {year ? (
          <>
            <span className="sep" />
            <span>
              <Link to={href('/calendar', lang, { year: String(year) })}>
                {w(lang, 'weekIn')} <b>{yearLabel(year, lang)}</b>: {num(yearCount, lang)} {t(lang, 'farbrengensCount')}
              </Link>
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A label as the concept draws it: the kinds of change in the words of the plan, any other in its own colour. */
function IssueLabelChip({ name, color, lang }: { name: string; color: string; lang: Lang }) {
  const known = LABELS[name];
  return known ? <Label tone={known.tone}>{known[lang]}</Label> : <Label color={`#${color}`}>{name}</Label>;
}

function FeedEntry({ item, lang, forMe }: { item: FeedItem; lang: Lang; forMe?: boolean }) {
  if (item.kind === 'issue') {
    const to = href(`/issues/${item.number}`, lang);
    return (
      <li className="ev">
        <span className="ic r">
          <Icon name="report" />
        </span>
        <div>
          <div className="line">
            <b>{item.who}</b> {w(lang, 'reported')}{' '}
            <Link to={to}>
              <b>#{item.number}</b>
            </Link>
            {item.where ? (
              <>
                {' '}
                {lang === 'he' ? 'ב' : 'in '}
                <Link to={href(item.where.path, lang)}>
                  <b>{item.where.label}</b>
                </Link>
              </>
            ) : null}
            <RelativeTime at={item.at} lang={lang} className="when" />
          </div>
          <Link className="card" to={to}>
            <div className="t">{item.title}</div>
            <div className="meta">
              {item.labels.map((l) => (
                <IssueLabelChip key={l.name} name={l.name} color={l.color} lang={lang} />
              ))}
              {item.where ? <span>{item.where.label}</span> : null}
              {item.comments ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {num(item.comments, lang)} {w(lang, 'comments')}
                  </span>
                </>
              ) : null}
            </div>
          </Link>
        </div>
      </li>
    );
  }
  if (item.kind === 'suggestion') {
    const to = item.number ? href(`/suggestions/${item.number}`, lang) : href('/review', lang, { s: String(item.id) });
    return (
      <li className="ev">
        <span className="ic g">
          <Icon name="suggest" />
        </span>
        <div>
          <div className="line">
            <AgentBy via={item.via} lang={lang} who={item.who}>
              <b>{item.who}</b>
            </AgentBy>{' '}
            {w(lang, forMe ? 'askedYourReview' : 'askedReview')}{' '}
            <Link to={to}>
              <b>#{item.number ?? item.id}</b>
            </Link>
            <RelativeTime at={item.at} lang={lang} className="when" />
          </div>
          <Link className="card" to={to}>
            <div className="t">{item.title}</div>
            {item.diff ? (
              <div className="quote torah">
                <InlineDiff parts={item.diff} />
              </div>
            ) : null}
            <div className="meta">
              {item.labels.map((l) => (LABELS[l] ? <Label key={l} tone={LABELS[l]!.tone}>{LABELS[l]![lang]}</Label> : null))}
              {item.where ? <span>{item.where}</span> : null}
              {item.words ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {num(item.words, lang)} {w(lang, 'changedWords')}
                  </span>
                </>
              ) : null}
            </div>
          </Link>
        </div>
      </li>
    );
  }
  if (item.kind === 'bot') {
    return (
      <li className="ev">
        <span className="ic">
          <Icon name="bot" />
        </span>
        <div>
          <div className="line">
            <b>{item.who}</b> <Label size="sm">{tu(lang, 'bot')}</Label> {w(lang, 'imported')} {num(item.count, lang)} {w(lang, 'items')}
            {item.items[0] ? (
              <>
                {' '}
                · <b>{item.items[0].label}</b>
              </>
            ) : null}
            <RelativeTime at={item.at} lang={lang} className="when" />
          </div>
          <div className="card row-card">
            <MachineLabel lang={lang}>{w(lang, 'machineImport')}</MachineLabel>
            <span className="muted small">
              {item.title} · {item.types.map((x) => typeName(x, lang)).join(', ')}
            </span>
            {item.items[0] ? (
              <Link className="end small" to={href(item.items[0].path, lang)}>
                {w(lang, 'toReview')}
              </Link>
            ) : null}
          </div>
        </div>
      </li>
    );
  }
  return (
    <li className="ev">
      <span className="ic p">
        <Icon name="check" />
      </span>
      <div>
        <div className="line">
          {item.by ? (
            <>
              <b>{item.by}</b> {w(lang, 'approved')} {w(lang, 'approvedChange')}{' '}
              <AgentBy via={item.via} lang={lang} who={item.who}>
                <b>{item.who}</b>
              </AgentBy>
            </>
          ) : (
            <>
              <AgentBy via={item.via} lang={lang} who={item.who}>
                <b>{item.who}</b>
              </AgentBy>{' '}
              {lang === 'he' ? 'הוסיף' : 'added'}
            </>
          )}
          {item.items[0] ? (
            <>
              {' '}
              {lang === 'he' ? 'ב' : 'to '}
              <Link to={href(item.items[0].path, lang)}>
                <b>{item.items[0].label}</b>
              </Link>
            </>
          ) : null}
          <RelativeTime at={item.at} lang={lang} className="when" />
        </div>
        <div className="card">
          <div className="t">{item.title}</div>
          <div className="meta">
            <StatusBadge state="approved" size="sm">
              {w(lang, 'approvedBadge')}
            </StatusBadge>
            <span>
              {num(item.count, lang)} {w(lang, 'changes')}
            </span>
            {item.items.length > 1 ? (
              <>
                <span aria-hidden="true">·</span>
                {item.items.slice(1).map((x) => (
                  <Link key={x.id} to={href(x.path, lang)}>
                    {x.label}
                  </Link>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/** The feed with its three views; "for me" and "waiting for me" are worked out in the browser. */
function Feed({ lang, feed }: { lang: Lang; feed: FeedItem[] }) {
  const [params] = useSearchParams();
  const account = useAccount();
  const follows = useFollows(Boolean(account));
  const [reviewable, setReviewable] = useState<Set<number> | null>(null);
  const view = params.get('feed') === 'review' ? 'review' : params.get('feed') === 'all' || account === null ? 'all' : account === undefined ? 'all' : 'mine';

  // Which of the open suggestions this person may decide: asked once per page.
  useEffect(() => {
    if (!account) return;
    const ids = feed.filter((f) => f.kind === 'suggestion').map((f) => (f as { id: number }).id);
    let live = true;
    void Promise.all(ids.map((id) => fetch(`/_/suggestions/${id}?limit=1`, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then((r) => (r.ok ? (r.json() as Promise<{ mayApprove?: boolean }>) : null)).catch(() => null))).then((all) => {
      if (live) setReviewable(new Set(ids.filter((_, i) => all[i]?.mayApprove)));
    });
    return () => {
      live = false;
    };
  }, [account, feed]);

  const followed = useMemo(() => new Set([...(follows?.follows.map((f) => f.id) ?? []), ...(follows?.items.map((i) => i.id) ?? [])]), [follows]);
  const shown =
    view === 'review'
      ? feed.filter((f) => f.kind === 'suggestion' && reviewable?.has(f.id))
      : view === 'mine'
        ? feed.filter((f) => f.whoId === account?.person.id || f.entities.some((id) => followed.has(id)) || (f.kind === 'suggestion' && reviewable?.has(f.id)))
        : feed;
  const tabs: Array<{ key: string; label: string; count?: number | null }> = [
    ...(account ? [{ key: 'mine', label: w(lang, 'forMe') }] : []),
    { key: 'all', label: w(lang, 'all') },
    ...(account ? [{ key: 'review', label: w(lang, 'review'), count: reviewable?.size ?? null }] : []),
  ];
  return (
    <>
      <nav className="tabs quiet feedtabs" aria-label={w(lang, 'activity')}>
        {tabs.map((tab) => (
          <Link key={tab.key} to={href('/', lang, { feed: tab.key === 'mine' ? undefined : tab.key, year: params.get('year') ?? undefined })} aria-current={view === tab.key ? 'page' : undefined} preventScrollReset replace>
            {tab.label}
            {tab.count ? <span className="num">{tab.count}</span> : null}
          </Link>
        ))}
      </nav>
      {shown.length ? (
        <ol className="feed">
          {shown.map((item) => (
            <FeedEntry key={item.key} item={item} lang={lang} forMe={item.kind === 'suggestion' && reviewable?.has(item.id)} />
          ))}
        </ol>
      ) : (
        <p className="feed-empty muted">{view === 'review' ? w(lang, 'nothingReview') : view === 'mine' ? w(lang, 'nothingMine') : w(lang, 'nothingYet')}</p>
      )}
    </>
  );
}

function Following({ lang, feed }: { lang: Lang; feed: FeedItem[] }) {
  const account = useAccount();
  const follows = useFollows(Boolean(account));
  if (!account) return null;
  const items = follows?.items ?? [];
  const recent = new Map<string, number>();
  for (const f of follows?.feed ?? []) recent.set(f.entityId, (recent.get(f.entityId) ?? 0) + 1);
  // What is open about each: suggestions waiting, then reports; else how much changed in it lately.
  const open = (id: string, kind: FeedItem['kind']) => feed.filter((f) => f.kind === kind && f.entities.includes(id)).length;
  const note = (id: string) => {
    const s = open(id, 'suggestion');
    const r = open(id, 'issue');
    if (s) return `${num(s, lang)} ${w(lang, 'suggestionsN')}`;
    if (r) return `${num(r, lang)} ${w(lang, 'reportsN')}`;
    return recent.get(id) ? `${num(recent.get(id)!, lang)} ${w(lang, 'changes')}` : '—';
  };
  return (
    <section className="following">
      <h2 className="h-sec">{w(lang, 'following')}</h2>
      {items.length ? (
        <ul>
          {items.slice(0, 6).map((item) => (
            <li key={item.id}>
              <Link to={href(itemPath(item), lang)}>{labelOf(item, lang)}</Link>
              <span className="num subtle">{note(item.id)}</span>
            </li>
          ))}
        </ul>
      ) : follows === undefined ? null : (
        <p className="subtle small">{w(lang, 'followHint')}</p>
      )}
    </section>
  );
}

function yearShort(y: number, lang: Lang) {
  return lang === 'he' ? toHebrewNumeral(y).replace(/^ה/, '') : String(y);
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lang, week, civil, weekday, year, yearEvents, years, today, todayTotal, community, counts, library, projects, pages, feed } = loaderData;
  const account = useAccount();
  const { gaps } = community;
  const withRecordings = gaps.events - gaps.eventsWithoutRecordings;
  const eventsToday = today as unknown as Array<EventItem & { recordings: number }>;
  const weekList = yearEvents as unknown as Array<EventItem & { recordings: number }>;
  const iconFor = (e: EventItem & { recordings: number }): IconName | null => (e.recordings ? 'audio' : eventData(e).links?.length ? 'scan' : null);
  const kind = (e: EventItem & { recordings: number }) =>
    [
      w(lang, 'farbrengen'),
      e.recordings ? (e.recordings === 1 ? `1 ${w(lang, 'part')}` : `${num(e.recordings, lang)} ${w(lang, 'parts')}`) : w(lang, 'noRecordingShort'),
    ].join(' · ');
  return (
    <div className="home">
      <DayStrip lang={lang} week={week} civil={civil} weekday={weekday} year={year} yearCount={yearEvents.length} />
      <div className="wrap home-grid">
        <aside className="home-lib" aria-label={w(lang, 'library')}>
          <h2 className="h-sec">{w(lang, 'library')}</h2>
          <nav className="box lib" aria-label={w(lang, 'library')}>
            {library.map((l) => (
              <Link key={l.id} className="row" to={href(l.path, lang)}>
                <Icon name="book" />
                <span className="he torah">{l.title}</span>
                <span className="num">{l.volumes > 1 ? `${num(l.volumes, lang)} ${w(lang, 'volumes')}` : num(l.units, lang)}</span>
              </Link>
            ))}
            <Link className="row" to={href('/calendar', lang)}>
              <Icon name="audio" />
              <span className="he torah">{w(lang, 'recorded')}</span>
              <span className="num">{num(counts.recording ?? 0, lang)}</span>
            </Link>
          </nav>
          <Link className="more-link" to={href('/sets', lang)}>
            {w(lang, 'allLibrary')} <span aria-hidden="true">{lang === 'he' ? '←' : '→'}</span>
          </Link>
          <Following lang={lang} feed={feed as FeedItem[]} />
        </aside>

        <section className="home-feed" aria-labelledby="feed-h">
          <ContinueRow lang={lang} />
          <h1 className="greet" id="feed-h">
            {w(lang, 'activity')}
          </h1>
          <p className="muted lede-sm">{account ? w(lang, 'activityLede') : w(lang, 'activityLedeAll')}</p>
          <Feed lang={lang} feed={feed as FeedItem[]} />
        </section>

        <aside className="side home-side">
          <section>
            <h2 className="h-side">
              {eventsToday.length ? w(lang, 'todayOther') : `${w(lang, 'weekIn')} ${year ? yearLabel(year, lang) : ''}`}
              <Link to={href('/calendar', lang, year ? { year: String(year) } : {})}>
                {w(lang, 'allLink')}
                {todayTotal > eventsToday.length ? ` · ${num(todayTotal, lang)}` : ''}
              </Link>
            </h2>
            <div className="box years">
              {(eventsToday.length ? eventsToday : weekList.slice(0, 5)).map((e) => {
                const y = Number(String(eventData(e).date).slice(0, 4));
                const icon = iconFor(e);
                return (
                  <Link key={e.id} className="year" to={href(itemPath(e), lang)}>
                    <span className="y display">{eventsToday.length ? yearShort(y, lang) : dateLabel(eventData(e).date, lang, { civil: false }).replace(/\s\S+$/, '')}</span>
                    <span>
                      <span className="n">{nameOf(eventData(e).title, lang)}</span>
                      <span className="s">{kind(e)}</span>
                    </span>
                    {icon ? <Icon name={icon} className="subtle" /> : <span />}
                  </Link>
                );
              })}
              {!eventsToday.length && !weekList.length ? <p className="pad muted small">{t(lang, 'noFarbrengensThisWeek')}</p> : null}
            </div>
            {years.length > 1 ? (
              <nav className="year-links" aria-label={w(lang, 'weekIn')}>
                {years.slice(0, 14).map((y) => (
                  <Link key={y.year} to={href('/', lang, { year: String(y.year) })} aria-current={y.year === year ? 'true' : undefined} preventScrollReset title={`${y.count} ${t(lang, 'farbrengensCount')}`}>
                    {yearShort(y.year, lang)}
                  </Link>
                ))}
              </nav>
            ) : null}
          </section>

          <section>
            <h2 className="h-side">
              {w(lang, 'help')}
              <Link to={href('/help', lang)}>{t(lang, 'howToHelp')}</Link>
            </h2>
            <ul className="box needs">
              {gaps.eventsWithoutRecordings ? (
                <li className="todo">
                  <span className="num">{num(gaps.eventsWithoutRecordings, lang)}</span>
                  <div>
                    <Link to={href('/missing', lang, { kind: 'recordings' })}>{w(lang, 'noRecording')}</Link>
                    <Bar value={withRecordings} max={gaps.events} label={w(lang, 'alreadyLinked')} />
                    <div className="subtle tiny">
                      {num(withRecordings, lang)} {w(lang, 'of')} {num(gaps.events, lang)} {w(lang, 'alreadyLinked')}
                    </div>
                  </div>
                </li>
              ) : null}
              <li className="todo">
                <span className="num">{num(community.openReports, lang)}</span>
                <Link to={href('/issues', lang)}>{w(lang, 'reportsWaiting')}</Link>
              </li>
              <li className="todo">
                <span className="num">{num(community.openSuggestions, lang)}</span>
                <Link to={href('/suggestions', lang)}>{w(lang, 'suggestionsWaiting')}</Link>
              </li>
              {pages && pages.total > pages.checked ? (
                <li className="todo">
                  <span className="num">{num(pages.total - pages.checked, lang)}</span>
                  <Link to={href('/health', lang)}>{w(lang, 'pagesUnchecked')}</Link>
                </li>
              ) : null}
              {gaps.eventsWithoutTexts ? (
                <li className="todo">
                  <span className="num">{num(gaps.eventsWithoutTexts, lang)}</span>
                  <Link to={href('/missing', lang, { kind: 'texts' })}>{w(lang, 'noText')}</Link>
                </li>
              ) : null}
            </ul>
          </section>

          <section>
            <h2 className="h-side">
              {w(lang, 'projects')}
              <Link to={href('/projects', lang)}>{w(lang, 'allLink')}</Link>
            </h2>
            <div className="box">
              {projects.length ? (
                projects.map((p) => (
                  <Link key={p.id} className="row block" to={href(`/projects/${p.slug}`, lang)}>
                    <span className="row-title">{p.name}</span>
                    <Bar value={p.done} max={p.total || 1} />
                    <span className="subtle tiny">
                      {p.total ? Math.round((p.done / p.total) * 100) : 0}% · {num(p.done, lang)} {w(lang, 'of')} {num(p.total, lang)}
                      {p.creatorName ? ` · ${p.creatorName}` : ''}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="pad muted small">{w(lang, 'noProjects')}</p>
              )}
            </div>
          </section>

          <p className={cx('in-catalog', 'subtle', 'small')}>
            {w(lang, 'inCatalog')}: <Link to={href('/sets', lang)}>{num(counts.work ?? 0, lang)} {t(lang, 'seforim')}</Link> · <Link to={href('/calendar', lang)}>{num(counts.event ?? 0, lang)} {t(lang, 'farbrengensCount')}</Link> · {num(counts.recording ?? 0, lang)} {t(lang, 'recordingParts')}
          </p>
        </aside>
      </div>
    </div>
  );
}
