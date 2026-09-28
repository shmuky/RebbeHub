import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import { AudioPlayer } from '../components/AudioPlayer.js';
import { EventPage } from './EventPage.js';
import { AuthorPage, SetPage, WorkPage } from './LibraryPages.js';
import { ItemLink, ItemList } from '../components/ItemLink.js';
import { PageBody } from '../components/PageBody.js';
import { PageTabs } from '../components/PageTabs.js';
import { Printings } from '../components/Printings.js';
import { ScanViewer } from '../components/ScanViewer.js';
import { TextView } from '../components/TextView.js';
import type { Entity } from '../lib/api.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { kindName, languageName, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import type { ItemView } from '../lib/itemData.server.js';
import { labelOf } from '../lib/labels.js';
import { st } from '../lib/scanStrings.js';
import { href, itemPath, SOURCE_NAMES, sourceUrl } from '../lib/links.js';
import { useLang } from '../lib/useLang.js';
import { readHref } from '../routes/read.js';
import { readable } from './EventPage.js';

type D = Record<string, any>;


const PUBLICATION_KINDS: Record<string, { he: string; en: string }> = {
  'book-volume': { he: 'כרך', en: 'Volume' },
  kovetz: { he: 'קובץ', en: 'Kovetz' },
  'periodical-issue': { he: 'גיליון', en: 'Issue' },
  booklet: { he: 'חוברת', en: 'Booklet' },
  teshura: { he: 'תשורה', en: 'Teshura' },
  manuscript: { he: 'כתב יד', en: 'Manuscript' },
  other: { he: 'הוצאה', en: 'Publication' },
};


function Refs({ ids, view }: { ids: unknown; view: ItemView }) {
  const list = (Array.isArray(ids) ? ids : ids ? [ids] : []).map((id) => view.refs[id as string]).filter((e): e is Entity => e !== undefined);
  return (
    <>
      {list.map((e, i) => (
        <span key={e.id}>
          {i > 0 ? ', ' : ''}
          <ItemLink item={e} />
        </span>
      ))}
    </>
  );
}

/** Where a copy is, as a link to it when RebbeHub knows the address. */
function Copies({ copies, lang }: { copies: Array<{ source: string; sourceId: string; kind: string; licence: string; language?: string; credit?: string; url?: string }>; lang: Lang }) {
  if (!copies.length) return null;
  return (
    <ul className="list">
      {copies.map((c, i) => {
        const link = sourceUrl(c);
        const name = SOURCE_NAMES[c.source]?.[lang] ?? c.source;
        const body = (
          <>
            <span>
              {name}
              {c.language ? ` · ${languageName(c.language, lang)}` : ''}
              {c.credit ? ` · ${c.credit}` : ''}
            </span>
            <span className="meta">{kindName(c.kind, lang)}</span>
          </>
        );
        return (
          <li key={i}>
            {link ? (
              <a href={link} rel="noopener" target="_blank">
                {body}
              </a>
            ) : (
              <div className="row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <ol className="breadcrumbs">
      {items.map((c, i) => (
        <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : c.label}</li>
      ))}
    </ol>
  );
}

function UnitPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const work = view.refs[d.work];
  const steps = (d.position ?? []) as Array<{ level: string; value: string; label?: LocalName }>;
  return (
    <>
      <Crumbs items={[...(work ? [{ label: labelOf(work, lang), to: href(itemPath(work), lang) }] : []), ...steps.slice(0, -1).map((s) => ({ label: nameOf(s.label, lang) || s.value }))]} />
      <h1>{nameOf(d.label, lang)}</h1>
      <dl className="facts">
        {work ? (
          <>
            <dt>{typeName('work', lang)}</dt>
            <dd>
              <ItemLink item={work} />
            </dd>
          </>
        ) : null}
        {d.date ? (
          <>
            <dt>{t(lang, 'date')}</dt>
            <dd>{dateLabel(d.date, lang)}</dd>
          </>
        ) : null}
        {d.events?.length ? (
          <>
            <dt>{t(lang, 'events')}</dt>
            <dd>
              <Refs ids={d.events} view={view} />
            </dd>
          </>
        ) : null}
      </dl>
      {(view.lists.texts ?? []).map((text) => (
        <section key={text.id}>
          <h2>
            {t(lang, 'text')} <span className="card-meta">({languageName((text.data as D).language, lang)})</span>
          </h2>
          <TextView segments={view.segments[text.id] ?? []} language={(text.data as D).language} withheld={(view.segments[text.id] ?? []).some((s) => s.withheld) ? 'withheld' : undefined} />
        </section>
      ))}
      {/* The chapter's own words come first; where they and other copies are from, after. */}
      <PageBody entity={entity} lang={lang} />
      {(d.editions ?? [])
        .filter((e: { kind: string; url?: string }) => (e.kind === 'pdf' || e.kind === 'scan') && e.url && readable(e.url))
        .slice(0, 1)
        .map((e: { url: string }) => (
          // A PDF the site's own reader opens; its exact file at the source is listed under the copies below.
          <p key={e.url}>
            <Link className="button" to={readHref({ url: e.url, title: nameOf(d.label, lang), sub: work ? labelOf(work, lang) : undefined }, lang)}>
              {t(lang, 'readScan')}
            </Link>
          </p>
        ))}
      {d.editions?.length ? (
        <section>
          <h2>{t(lang, 'editions')}</h2>
          <Copies copies={d.editions.filter((e: { url?: string }) => !(e.url && readable(e.url)))} lang={lang} />
        </section>
      ) : null}
      {view.lists.printedIn?.length ? (
        <section>
          <h2>{t(lang, 'printedIn')}</h2>
          <ul className="list">
            {view.lists.printedIn.map((m) => {
              const md = m.data as D;
              const pub = view.refs[md.publication];
              return pub ? (
                <li key={m.id}>
                  <Link to={href(itemPath(pub), lang)}>
                    <span>{labelOf(pub, lang)}</span>
                    <span className="meta">
                      {`${t(lang, 'pages')} ${md.pages.from}–${md.pages.to}`}
                    </span>
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function PublicationPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const scans = view.lists.scans ?? [];
  const identifiers = Object.entries((d.identifiers ?? {}) as Record<string, unknown>);
  return (
    <>
      <p className="kicker">{PUBLICATION_KINDS[d.kind]?.[lang] ?? typeName('publication', lang)}</p>
      <h1>{nameOf(d.title, lang)}</h1>
      <dl className="facts">
        {d.work ? (
          <>
            <dt>{typeName('work', lang)}</dt>
            <dd>
              <Refs ids={d.work} view={view} />
              {d.volume ? ` · ${d.volume}` : ''}
            </dd>
          </>
        ) : null}
        {d.publisher ? (
          <>
            <dt>{t(lang, 'publisher')}</dt>
            <dd>
              {d.publisher}
              {d.placePrinted ? `, ${d.placePrinted}` : ''}
            </dd>
          </>
        ) : null}
        {d.date || d.gregorianYear ? (
          <>
            <dt>{t(lang, 'date')}</dt>
            <dd>{[d.date ? dateLabel(d.date, lang) : null, d.gregorianYear].filter(Boolean).join(' · ')}</dd>
          </>
        ) : null}
        {d.printing ? (
          <>
            <dt>{t(lang, 'printing')}</dt>
            <dd>{d.printing}</dd>
          </>
        ) : null}
        {d.reprintOf && view.refs[d.reprintOf] ? (
          <>
            <dt>{st(lang, 'reprintOf')}</dt>
            <dd>
              <Refs ids={d.reprintOf} view={view} />
            </dd>
          </>
        ) : null}
        {d.simcha ? (
          <>
            <dt>{t(lang, 'simcha')}</dt>
            <dd>
              {d.simcha.families.join(' – ')}
              {d.simcha.date ? ` · ${dateLabel(d.simcha.date, lang)}` : ''}
              {d.simcha.place ? ` · ${d.simcha.place}` : ''}
            </dd>
          </>
        ) : null}
        {identifiers.length ? (
          <>
            <dt>{t(lang, 'identifiers')}</dt>
            <dd>
              {identifiers.map(([k, v]) => {
                const values = Array.isArray(v) ? v : [v];
                return values.map((value) => {
                  const link = sourceUrl({ source: k, sourceId: String(value) });
                  return (
                    <span key={`${k}${value}`} style={{ marginInlineEnd: 12 }}>
                      {SOURCE_NAMES[k]?.[lang] ?? k}: {link ? <a href={link}>{String(value)}</a> : String(value)}
                    </span>
                  );
                });
              })}
            </dd>
          </>
        ) : null}
      </dl>
      {scans.length ? (
        <section>
          <h2>{t(lang, 'scans')}</h2>
          {scans.map((scan) => (
            <div key={scan.id}>
              <ScanViewer
                file={view.files[scan.id] ?? null}
                title={nameOf(d.title, lang)}
                sourceLink={d.identifiers?.hebrewbooks ? sourceUrl({ source: 'hebrewbooks', sourceId: d.identifiers.hebrewbooks }) : null}
                pageLabels={(scan.data as D).pageLabels}
                pages={view.pages[scan.id]}
              />
              {/* Its text, page by page, where the machine has read it; a scan whose file is not served has none shown. */}
              {view.files[scan.id]?.url ? (
                <p>
                  <Link to={href(`/text/${scan.id}`, lang)}>{t(lang, 'readTheText')}</Link>
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : d.identifiers?.hebrewbooks ? (
        <ScanViewer file={null} title={nameOf(d.title, lang)} sourceLink={sourceUrl({ source: 'hebrewbooks', sourceId: d.identifiers.hebrewbooks })} />
      ) : null}
      {view.lists.contents?.length ? (
        <section>
          <h2>{t(lang, 'contentsMap')}</h2>
          <ul className="list">
            {view.lists.contents.map((m) => {
              const md = m.data as D;
              const unit = md.unit ? view.refs[md.unit] : undefined;
              const label = unit ? labelOf(unit, lang) : nameOf(md.label, lang);
              const body = (
                <>
                  <span>{label}</span>
                  <span className="meta">
                    {`${t(lang, 'pages')} ${md.pages.from}–${md.pages.to}`}
                  </span>
                </>
              );
              return <li key={m.id}>{unit ? <Link to={href(itemPath(unit), lang)}>{body}</Link> : <div className="row">{body}</div>}</li>;
            })}
          </ul>
        </section>
      ) : null}
      {view.lists.otherPrintings?.length ? (
        <section>
          <h2>{st(lang, 'otherPrintings')}</h2>
          <Printings publications={view.lists.otherPrintings} lang={lang} />
        </section>
      ) : null}
    </>
  );
}

function ScanPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const pub = view.refs[d.publication];
  return (
    <>
      {pub ? <Crumbs items={[{ label: labelOf(pub, lang), to: href(itemPath(pub), lang) }]} /> : null}
      <h1>
        {typeName('scan', lang)}
        {pub ? ` · ${labelOf(pub, lang)}` : ''}
      </h1>
      <ScanViewer file={view.files[entity.id] ?? null} title={pub ? labelOf(pub, lang) : entity.id} sourceLink={null} pageLabels={d.pageLabels} pages={view.pages[entity.id]} />
    </>
  );
}

function RecordingPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  return (
    <>
      {d.event && view.refs[d.event] ? <Crumbs items={[{ label: labelOf(view.refs[d.event]!, lang), to: href(itemPath(view.refs[d.event]!), lang) }]} /> : null}
      <h1>{nameOf(d.title, lang)}</h1>
      <AudioPlayer recordings={[entity]} sources={{ [entity.id]: view.files[entity.id]?.url ?? null }} />
    </>
  );
}

function TextPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const unit = d.unit ? view.refs[d.unit] : undefined;
  const segments = view.segments[entity.id] ?? [];
  return (
    <>
      {unit ? <Crumbs items={[{ label: labelOf(unit, lang), to: href(itemPath(unit), lang) }]} /> : null}
      <h1>{unit ? labelOf(unit, lang) : typeName('text', lang)}</h1>
      <TextView segments={segments} language={d.language} withheld={segments.some((s) => s.withheld) ? 'withheld' : undefined} />
    </>
  );
}

/** Anything else (people, places, topics, sources, relations): its fields, as they are. */
function GenericPage({ entity, lang }: { entity: Entity; lang: Lang }) {
  return (
    <>
      <p className="kicker">{typeName(entity.type, lang)}</p>
      <h1>{labelOf(entity, lang)}</h1>
      <pre className="json">{JSON.stringify(entity.data, null, 2)}</pre>
    </>
  );
}

const PAGES: Record<string, (props: { entity: Entity; view: ItemView; lang: Lang }) => React.ReactElement> = {
  set: SetPage,
  work: WorkPage,
  unit: UnitPage,
  event: EventPage,
  publication: PublicationPage,
  scan: ScanPage,
  recording: RecordingPage,
  author: AuthorPage,
  text: TextPage,
};

export function ItemPage({ entity, view }: { entity: Entity; view: ItemView }) {
  const lang = useLang();
  const Page = PAGES[entity.type] ?? GenericPage;
  const pointing = view.backlinks.length;
  return (
    <article>
      <PageTabs entity={entity} lang={lang} current="page" />
      <Page entity={entity} view={view} lang={lang} />
      {entity.type === 'unit' ? null : <PageBody entity={entity} lang={lang} />}
      <div className="item-footer">
        <span>
          {t(lang, 'permanentLink')}: <Link to={href(`/${entity.id}`, lang)}><code>{entity.id}</code></Link>
        </span>
        {pointing > 0 ? (
          <span>
            {t(lang, 'pointsHere')}: {pointing}
          </span>
        ) : null}
      </div>
    </article>
  );
}
