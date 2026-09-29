import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import type { AboutThread } from '../lib/about.server.js';
import { type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import type { ItemView } from '../lib/itemData.server.js';
import { href, shortLabel, SOURCE_NAMES, sourceUrl } from '../lib/links.js';
import { LABELS } from '../lib/suggestions.js';
import { personPath } from '../lib/threads.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Avatar, Label, RelativeTime } from '../ui/primitives.js';
import type { TabItem } from '../ui/primitives.js';

/**
 * The pieces every item's page is made of, beside its own: the tabs every
 * item has (its talk page, its history), and the side column's sections
 * (details, where it came from, who keeps it, what happened lately).
 */

export const P = {
  details: { he: 'פרטים', en: 'Details' },
  sources: { he: 'מקורות', en: 'Sources' },
  keepers: { he: 'אחראי האוסף', en: 'Keepers' },
  activity: { he: 'פעילות אחרונה', en: 'Recent activity' },
  talk: { he: 'דיונים', en: 'Talk' },
  history: { he: 'היסטוריה', en: 'History' },
  suggestions: { he: 'הצעות', en: 'Suggestions' },
  open: { he: 'פתוחה', en: 'open' },
  approved: { he: 'אושרה', en: 'approved' },
  closed: { he: 'נסגרה', en: 'closed' },
  id: { he: 'מזהה', en: 'Id' },
  licence: { he: 'רישיון', en: 'Licence' },
  catalogLicence: { he: 'פרטי הקטלוג פתוחים, CC0', en: 'Catalog facts are open, CC0' },
  edit: { he: 'עריכה', en: 'Edit' },
  noActivity: { he: 'עוד לא הוצע כאן תיקון ולא דווחה בעיה.', en: 'No fix suggested or problem reported here yet.' },
  permanent: { he: 'קישור קבוע', en: 'Permanent link' },
} as const;

export const p = (lang: Lang, key: keyof typeof P) => P[key][lang];

/** The tabs every item has after its own: its talk page and its history. */
export function commonTabs(entity: Pick<Entity, 'id'>, view: Pick<ItemView, 'talk'>, lang: Lang): TabItem[] {
  return [
    { key: 'talk', label: p(lang, 'talk'), icon: 'discuss', to: href(`/talk/${entity.id}`, lang), count: view.talk || undefined },
    { key: 'history', label: p(lang, 'history'), icon: 'history', to: href(`/history/${entity.id}`, lang) },
  ];
}

export function SideSection({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <h2>
        {title}
        {action}
      </h2>
      {children}
    </section>
  );
}

export function SideDetails({ rows, lang }: { rows: Array<[ReactNode, ReactNode] | null | false | undefined>; lang: Lang }) {
  const shown = rows.filter((r): r is [ReactNode, ReactNode] => Boolean(r));
  if (!shown.length) return null;
  return (
    <SideSection title={p(lang, 'details')}>
      <dl>
        {shown.map(([k, v], i) => (
          <div key={i} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </SideSection>
  );
}

type Copy = { source: string; sourceId?: string; kind?: string; url?: string };

/** Where it is read elsewhere: each source with its id there, linked when the address is known. */
export function SideSources({ copies, lang }: { copies: Copy[]; lang: Lang }) {
  if (!copies.length) return null;
  return (
    <SideSection title={p(lang, 'sources')}>
      <div className="side-list">
        {copies.map((c, i) => {
          const link = c.url ?? (c.sourceId ? sourceUrl({ source: c.source, sourceId: c.sourceId }) : null);
          const body = (
            <>
              <span className="grow">{SOURCE_NAMES[c.source]?.[lang] ?? c.source}</span>
              {c.sourceId ? <span className="num subtle src-id" dir="ltr">{/^\d+$/.test(c.sourceId) ? `#${c.sourceId}` : shortLabel(c.sourceId)}</span> : null}
            </>
          );
          return link ? (
            <a key={i} href={link} target="_blank" rel="noopener" title={link}>
              {body}
            </a>
          ) : (
            <span key={i} className="side-row">
              {body}
            </span>
          );
        })}
      </div>
    </SideSection>
  );
}

/** Who keeps the set: they approve what is suggested here. */
export function SideKeepers({ keepers, lang }: { keepers: ItemView['keepers']; lang: Lang }) {
  if (!keepers.length) return null;
  return (
    <SideSection title={p(lang, 'keepers')}>
      <div className="people">
        {keepers.map((k) => {
          const body = (
            <>
              <Avatar name={k.displayName} id={k.id} size="xs" />
              {k.displayName}
            </>
          );
          return k.username ? (
            <Link key={k.id} to={href(personPath(k.username), lang)}>
              {body}
            </Link>
          ) : (
            <span key={k.id}>{body}</span>
          );
        })}
      </div>
    </SideSection>
  );
}

const THREAD_ICON: Record<string, IconName> = { suggestion: 'suggest', issue: 'report' };

/** A conversation as one line: its icon in its state's colour, #number, title, where, and state. */
export function ThreadLine({ t, lang, where = true }: { t: AboutThread; lang: Lang; where?: boolean }) {
  const icon: IconName = t.kind === 'suggestion' ? (t.state === 'approved' ? 'check' : 'suggest') : t.state === 'open' ? 'report' : 'reportdone';
  const to = href(t.kind === 'suggestion' ? `/suggestions/${t.number}` : `/issues/${t.number}`, lang);
  return (
    <div className="thread-line">
      <Icon name={icon ?? THREAD_ICON[t.kind]!} className={`st-${t.state}`} />
      <span>
        <Link to={to} className="num-link">
          #{t.number}
        </Link>{' '}
        {t.title}
        {where && t.where ? <span className="subtle"> · {t.where}</span> : null}
        {t.kind === 'suggestion' ? <span className="subtle"> · {p(lang, t.state)}</span> : null}
      </span>
    </div>
  );
}

export function SideActivity({ about, lang, more }: { about: AboutThread[]; lang: Lang; more?: string }) {
  return (
    <SideSection title={p(lang, 'activity')} action={more ? <Link to={more}>{lang === 'he' ? 'הכול' : 'All'}</Link> : undefined}>
      {about.length ? (
        <div className="thread-lines">
          {about.slice(0, 5).map((t) => (
            <ThreadLine key={`${t.kind}${t.number}`} t={t} lang={lang} where={false} />
          ))}
        </div>
      ) : (
        <p className="subtle small">{p(lang, 'noActivity')}</p>
      )}
    </SideSection>
  );
}

/** A label by its key: the kinds of change in the plan's words, any other in its own colour. */
export function ThreadLabel({ name, color, lang }: { name: string; color?: string; lang: Lang }) {
  const known = LABELS[name];
  return known ? <Label tone={known.tone}>{known[lang]}</Label> : <Label color={color ? `#${color}` : undefined}>{name}</Label>;
}

/** Conversations about an item as rows, as the suggestions and issues lists have them. */
export function ThreadRows({ threads, lang, empty }: { threads: AboutThread[]; lang: Lang; empty: ReactNode }) {
  if (!threads.length) return <div className="box">{empty}</div>;
  return (
    <ul className="box rows threads">
      {threads.map((t) => {
        const to = href(t.kind === 'suggestion' ? `/suggestions/${t.number}` : `/issues/${t.number}`, lang);
        const icon: IconName = t.kind === 'suggestion' ? (t.state === 'approved' ? 'check' : 'suggest') : t.state === 'open' ? 'report' : 'reportdone';
        return (
          <li key={`${t.kind}${t.number}`} className="row thread-row">
            <Icon name={icon} className={`st-${t.state}`} />
            <div className="row-main">
              <Link className="row-title" to={to}>
                {t.title}
              </Link>
              <span className="labels">
                {t.labels.map((l) => (
                  <ThreadLabel key={l.name} name={l.name} color={l.color} lang={lang} />
                ))}
              </span>
              <span className="row-sub">
                #{t.number} · {t.who} · <RelativeTime at={t.at} lang={lang} />
                {t.where ? ` · ${t.where}` : ''}
              </span>
            </div>
            {t.comments ? (
              <span className="end subtle num">
                <Icon name="discuss" size={14} /> {num(t.comments, lang)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
