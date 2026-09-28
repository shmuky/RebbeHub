import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, History, Library as LibraryIcon, Lightbulb } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import { ItemList } from '../components/ItemLink.js';
import { Books, RebbePortrait, colourOf, coverColour } from '../components/Library.js';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { kindName, languageName, nameOf, t, type Lang } from '../lib/i18n.js';
import type { ItemView } from '../lib/itemData.server.js';
import { href, itemPath, SOURCE_NAMES, sourceUrl } from '../lib/links.js';

/**
 * The library's own pages, as the design has them: a shelf (a set) as its
 * books' covers; a sefer with its cover, and tabs for its contents, where
 * it is read, its printings and its history; a Rebbe with his sefarim.
 */

type D = Record<string, any>;

const GENRES: Record<string, { he: string; en: string }> = {
  chassidus: { he: 'חסידות', en: 'Chassidus' },
  maamarim: { he: 'מאמרים', en: 'Maamarim' },
  sichos: { he: 'שיחות', en: 'Sichos' },
  igros: { he: 'אגרות', en: 'Letters' },
  halacha: { he: 'הלכה', en: 'Halacha' },
  siddur: { he: 'סידור', en: 'Siddur' },
  minhagim: { he: 'מנהגים', en: 'Minhagim' },
  history: { he: 'תולדות', en: 'History' },
  diaries: { he: 'יומנים', en: 'Diaries' },
  recordings: { he: 'הקלטות', en: 'Recordings' },
};

const n = (value: number, lang: Lang) => value.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');

function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <ol className="breadcrumbs">
      {items.map((c, i) => (
        <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}</li>
      ))}
    </ol>
  );
}

/** "Know something we don't?" - the report form at the foot of every page takes it, no account needed. */
function HelpCallout({ lang, title, text }: { lang: Lang; title: string; text: string }) {
  return (
    <aside className="callout" style={{ ['--tone' as string]: '#9a6b00' }}>
      <span className="callout-icon" aria-hidden="true">
        <Lightbulb size={20} />
      </span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
        <a className="button" href="#report">
          {t(lang, 'tellUs')}
        </a>
      </div>
    </aside>
  );
}

export function SetPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const members = view.lists.members ?? [];
  const works = members.filter((m) => m.type === 'work');
  const others = members.filter((m) => m.type !== 'work');
  const genre = (works[0]?.data as D | undefined)?.genre;
  const counts = view.counts ?? {};
  return (
    <>
      <Crumbs items={[{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }]} />
      <div className="item-hero">
        <span className="callout-icon" style={{ width: 56, height: 56, borderRadius: 16, color: colourOf(genre), background: `color-mix(in srgb, ${colourOf(genre)} 14%, var(--bg))` }} aria-hidden="true">
          <LibraryIcon size={26} />
        </span>
        <div>
          <h1>{nameOf(d.name, lang)}</h1>
          <p className="subtitle">
            {works.length ? `${works.length} ${t(lang, 'seforim')}` : `${members.length} ${t(lang, 'unitsShort')}`}
            {d.description ? ` · ${nameOf(d.description, lang)}` : ''}
          </p>
        </div>
      </div>
      {works.length ? <Books works={works} lang={lang} grid meta={(w) => (counts[w.id] ? `${n(counts[w.id]!, lang)} ${t(lang, 'unitsShort')}` : undefined)} /> : null}
      {others.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'moreInShelf')}</h2>
          <ItemList items={others} />
        </section>
      ) : null}
      <HelpCallout lang={lang} title={t(lang, 'missingSefer')} text={t(lang, 'missingSeferText')} />
    </>
  );
}

function Sources({ copies, lang }: { copies: Array<{ source: string; sourceId: string; kind: string; licence: string; language?: string; credit?: string; url?: string }>; lang: Lang }) {
  return (
    <ul className="card-list rows">
      {copies.map((c, i) => {
        const link = sourceUrl(c);
        const name = SOURCE_NAMES[c.source]?.[lang] ?? c.source;
        const body = (
          <>
            <span className="row-icon" aria-hidden="true">
              <BookOpen size={18} />
            </span>
            <span className="row-main">
              <span className="row-title">{name}</span>
              <span className="row-sub">
                {kindName(c.kind, lang)}
                {c.language ? ` · ${languageName(c.language, lang)}` : ''}
                {c.credit ? ` · ${c.credit}` : ''}
              </span>
            </span>
            {link ? <ExternalLink size={16} className="row-trailing" aria-hidden="true" /> : null}
          </>
        );
        return <li key={i}>{link ? <a className="row" href={link} target="_blank" rel="noopener">{body}</a> : <div className="row">{body}</div>}</li>;
      })}
    </ul>
  );
}

type WorkTab = 'contents' | 'sources' | 'printings';

export function WorkPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const [params] = useSearchParams();
  const outline = view.outline ?? [];
  const units = view.lists.units ?? [];
  const copies = (d.sourceCopies ?? []) as Array<{ source: string; sourceId: string; kind: string; licence: string; language?: string; credit?: string; url?: string }>;
  const publications = view.lists.publications ?? [];
  const total = outline.reduce((sum, p) => sum + p.units, 0);
  const volumes = outline.length > 1 && outline.some((p) => p.units > 1);
  const part = params.get('part');
  const openPart = part ? outline.find((p) => p.value === part) : undefined;
  const asked = params.get('tab') as WorkTab | null;
  const tab: WorkTab = asked && ['contents', 'sources', 'printings'].includes(asked) ? asked : total ? 'contents' : 'sources';
  const sets = ((d.sets ?? []) as string[]).map((id) => view.refs[id]).filter((s): s is Entity => Boolean(s));
  const authors = ((d.authors ?? []) as string[]).map((id) => view.refs[id]).filter((a): a is Entity => Boolean(a));
  const tabLink = (to: WorkTab) => href(itemPath(entity), lang, { tab: to === 'contents' ? undefined : to });
  const Back = lang === 'he' ? ChevronRight : ChevronLeft;
  return (
    <>
      <Crumbs items={[{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }, ...sets.map((s) => ({ label: nameOf((s.data as D).name, lang), to: href(itemPath(s), lang) }))]} />
      <div className="item-hero">
        <span className="cover" style={{ background: coverColour(entity) }} aria-hidden="true">
          <span className="cover-title">{nameOf(d.title, lang)}</span>
        </span>
        <div>
          <p className="kicker">
            {GENRES[d.genre]?.[lang] ?? d.genre}
            {authors.length ? ' · ' : ''}
            {authors.map((a, i) => (
              <span key={a.id}>
                {i > 0 ? ', ' : ''}
                <Link to={href(itemPath(a), lang)}>{nameOf((a.data as D).name, lang)}</Link>
              </span>
            ))}
          </p>
          <h1>{nameOf(d.title, lang)}</h1>
          {lang === 'en' && d.title?.en ? (
            <p className="subtitle" lang="he">
              {d.title.he}
            </p>
          ) : null}
          <p className="subtitle">
            {total ? `${n(total, lang)} ${t(lang, 'unitsShort')}` : t(lang, 'noContentsYet')}
            {volumes ? ` · ${outline.length} ${t(lang, 'volumes')}` : ''}
          </p>
        </div>
      </div>
      {d.description ? <p>{nameOf(d.description, lang)}</p> : null}
      {copies.length && tab !== 'sources' ? (
        // Where to read it, one tap away whatever tab is open.
        <ul className="pills" aria-label={t(lang, 'whereToRead')}>
          {copies.map((c, i) => {
            const link = sourceUrl(c);
            const label = `${SOURCE_NAMES[c.source]?.[lang] ?? c.source}${c.language ? ` · ${languageName(c.language, lang)}` : ''}`;
            return (
              <li key={i}>
                {link ? (
                  <a className="pill" href={link} target="_blank" rel="noopener">
                    <BookOpen size={14} aria-hidden="true" />
                    {label}
                  </a>
                ) : (
                  <span className="pill">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <nav className="page-tabs" aria-label={t(lang, 'sections')}>
        {total ? (
          <Link to={tabLink('contents')} aria-current={tab === 'contents' ? 'page' : undefined}>
            {t(lang, 'contents')} <span className="count">{n(total, lang)}</span>
          </Link>
        ) : null}
        {copies.length ? (
          <Link to={tabLink('sources')} aria-current={tab === 'sources' ? 'page' : undefined}>
            {t(lang, 'whereToRead')} <span className="count">{copies.length}</span>
          </Link>
        ) : null}
        {publications.length ? (
          <Link to={tabLink('printings')} aria-current={tab === 'printings' ? 'page' : undefined}>
            {t(lang, 'publications')} <span className="count">{publications.length}</span>
          </Link>
        ) : null}
        <Link to={href(`/history/${entity.id}`, lang)}>
          <History size={14} aria-hidden="true" /> {t(lang, 'history')}
        </Link>
      </nav>

      {tab === 'contents' && total ? (
        openPart ? (
          <section>
            <Link className="more-link" to={href(itemPath(entity), lang)} style={{ marginTop: 0 }}>
              <Back size={14} style={{ verticalAlign: 'middle' }} /> {t(lang, 'allVolumes')}
            </Link>
            <h2>{openPart.label ? nameOf(openPart.label, lang) : openPart.value}</h2>
            <ItemList items={units} meta={(u) => ((u.data as D).date ? dateLabel((u.data as D).date, lang, { civil: false }) : null)} />
          </section>
        ) : volumes ? (
          <ul className="volumes">
            {outline.map((p) => (
              <li key={p.value}>
                <Link className="volume" to={href(itemPath(entity), lang, { part: p.value })}>
                  <span>{p.label ? nameOf(p.label, lang) : p.value}</span>
                  <small>
                    {n(p.units, lang)} {t(lang, 'unitsShort')}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <section>
            {outline.length === 1 && outline[0]!.label ? <h3 className="section-header">{nameOf(outline[0]!.label, lang)}</h3> : null}
            <ItemList items={units} meta={(u) => ((u.data as D).date ? dateLabel((u.data as D).date, lang, { civil: false }) : null)} />
            {view.next ? (
              <div className="pager">
                <Link className="button secondary" to={href(itemPath(entity), lang, { after: view.next })}>
                  {t(lang, 'more')}
                </Link>
              </div>
            ) : null}
          </section>
        )
      ) : null}
      {tab === 'sources' && copies.length ? <Sources copies={copies} lang={lang} /> : null}
      {tab === 'printings' && publications.length ? <ItemList items={publications} /> : null}

      <HelpCallout lang={lang} title={t(lang, 'knowPrinting')} text={t(lang, 'knowPrintingText')} />
    </>
  );
}

export function AuthorPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const works = view.lists.works ?? [];
  const counts = view.counts ?? {};
  return (
    <>
      <Crumbs items={[{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }]} />
      <div className="item-hero" style={{ alignItems: 'center' }}>
        <RebbePortrait author={entity} index={d.rebbe ? d.rebbe + 1 : 0} lang={lang} size={84} />
        <div>
          <h1>{nameOf(d.name, lang)}</h1>
          <p className="subtitle">
            {works.length} {t(lang, 'seforim')}
          </p>
        </div>
      </div>
      {d.description ? <p>{nameOf(d.description as LocalName, lang)}</p> : null}
      {works.length ? <Books works={works} lang={lang} grid meta={(w) => (counts[w.id] ? `${n(counts[w.id]!, lang)} ${t(lang, 'unitsShort')}` : undefined)} /> : null}
    </>
  );
}
