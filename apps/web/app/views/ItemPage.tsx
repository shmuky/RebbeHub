import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import { AudioPlayer } from '../components/AudioPlayer.js';
import { ItemLink, ItemList } from '../components/ItemLink.js';
import { ScanViewer } from '../components/ScanViewer.js';
import { TextView } from '../components/TextView.js';
import type { Entity } from '../lib/api.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { kindName, languageName, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import type { ItemView } from '../lib/itemData.server.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath, SOURCE_NAMES, sourceUrl } from '../lib/links.js';
import { useLang } from '../lib/useLang.js';

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

const PUBLICATION_KINDS: Record<string, { he: string; en: string }> = {
  'book-volume': { he: 'כרך', en: 'Volume' },
  kovetz: { he: 'קובץ', en: 'Kovetz' },
  'periodical-issue': { he: 'גיליון', en: 'Issue' },
  booklet: { he: 'חוברת', en: 'Booklet' },
  teshura: { he: 'תשורה', en: 'Teshura' },
  manuscript: { he: 'כתב יד', en: 'Manuscript' },
  other: { he: 'הוצאה', en: 'Publication' },
};

const POLICIES: Record<string, { he: string; en: string }> = {
  open: { he: 'פתוח', en: 'Open' },
  moderated: { he: 'בפיקוח', en: 'Moderated' },
  locked: { he: 'נעול', en: 'Locked' },
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

function SetPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const members = view.lists.members ?? [];
  const byType = new Map<string, Entity[]>();
  for (const m of members) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
  return (
    <>
      <Crumbs items={[{ label: t(lang, 'sets'), to: href('/sets', lang) }]} />
      <h1>{nameOf(d.name, lang)}</h1>
      {d.description ? <p className="subtitle">{nameOf(d.description, lang)}</p> : null}
      <dl className="facts">
        <dt>{t(lang, 'policy')}</dt>
        <dd>{POLICIES[d.policy]?.[lang] ?? d.policy}</dd>
        <dt>{t(lang, 'keepers')}</dt>
        <dd>{d.keepers?.length ? d.keepers.join(', ') : t(lang, 'noKeepers')}</dd>
      </dl>
      {[...byType.entries()].map(([type, items]) => (
        <section key={type}>
          <h2>
            {typeName(type, lang)} <span className="card-meta">({items.length})</span>
          </h2>
          <ItemList items={items} />
        </section>
      ))}
    </>
  );
}

/** A work's units grouped under the parts of its table of contents. */
function Contents({ units, lang }: { units: Entity[]; lang: Lang }) {
  const groups: Array<{ key: string; label: string; units: Entity[] }> = [];
  for (const unit of units) {
    const steps = ((unit.data as D).position ?? []) as Array<{ value: string; label?: LocalName }>;
    const parents = steps.slice(0, -1);
    const key = parents.map((s) => s.value).join('/');
    const label = parents.map((s) => nameOf(s.label, lang) || s.value).join(' · ');
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.units.push(unit);
    else groups.push({ key, label, units: [unit] });
  }
  return (
    <>
      {groups.map((g, i) => (
        <div className="contents-group" key={`${g.key}-${i}`}>
          {g.label ? <h3>{g.label}</h3> : null}
          <ItemList items={g.units} meta={(u) => ((u.data as D).date ? dateLabel((u.data as D).date, lang, { civil: false }) : null)} />
        </div>
      ))}
    </>
  );
}

function WorkPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const units = view.lists.units ?? [];
  return (
    <>
      <Crumbs items={[...((d.sets ?? []) as string[]).map((id) => view.refs[id]).filter(Boolean).map((s) => ({ label: labelOf(s!, lang), to: href(itemPath(s!), lang) }))]} />
      <p className="kicker">{GENRES[d.genre]?.[lang] ?? d.genre}</p>
      <h1>{nameOf(d.title, lang)}</h1>
      {lang === 'en' && d.title?.en ? (
        <p className="subtitle" lang="he">
          {d.title.he}
        </p>
      ) : null}
      {d.authors?.length ? (
        <p>
          {t(lang, 'by')} <Refs ids={d.authors} view={view} />
        </p>
      ) : null}
      {d.description ? <p>{nameOf(d.description, lang)}</p> : null}
      {d.sourceCopies?.length ? (
        <section>
          <h2>{t(lang, 'sources')}</h2>
          <Copies copies={d.sourceCopies} lang={lang} />
        </section>
      ) : null}
      {view.lists.publications?.length ? (
        <section>
          <h2>{t(lang, 'publications')}</h2>
          <ItemList items={view.lists.publications} />
        </section>
      ) : null}
      {units.length ? (
        <section>
          <h2>{t(lang, 'contents')}</h2>
          <Contents units={units} lang={lang} />
          <div className="pager">
            {view.next ? (
              <Link className="button secondary" to={href(itemPath(entity), lang, { after: view.next })}>
                {t(lang, 'more')}
              </Link>
            ) : (
              <span />
            )}
          </div>
        </section>
      ) : null}
    </>
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
      {d.editions?.length ? (
        <section>
          <h2>{t(lang, 'editions')}</h2>
          <Copies copies={d.editions} lang={lang} />
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

function EventPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const recordings = view.lists.recordings ?? [];
  const sources = Object.fromEntries(recordings.map((r) => [r.id, view.files[r.id]?.url ?? null]));
  const year = typeof d.date === 'string' ? d.date.slice(0, 4) : null;
  return (
    <>
      <Crumbs items={[{ label: t(lang, 'calendar'), to: href('/calendar', lang) }, ...(year ? [{ label: yearLabel(Number(year), lang), to: href(`/calendar/${year}`, lang) }] : [])]} />
      <h1>{nameOf(d.title, lang)}</h1>
      <dl className="facts">
        {d.date ? (
          <>
            <dt>{t(lang, 'date')}</dt>
            <dd>{dateLabel(d.date, lang)}</dd>
          </>
        ) : null}
        {d.place ? (
          <>
            <dt>{t(lang, 'place')}</dt>
            <dd>
              <Refs ids={d.place} view={view} />
            </dd>
          </>
        ) : null}
      </dl>
      {recordings.length ? (
        <section>
          <h2>{t(lang, 'recordings')}</h2>
          <AudioPlayer recordings={recordings} sources={sources} />
        </section>
      ) : null}
      {view.lists.units?.length ? (
        <section>
          <h2>{t(lang, 'units')}</h2>
          <ItemList items={view.lists.units} />
        </section>
      ) : null}
      {view.lists.otherYears?.length ? (
        <section>
          <h2>{t(lang, 'thisDay')}</h2>
          <ItemList items={view.lists.otherYears} meta={(e) => dateLabel((e.data as D).date, lang, { civil: false })} />
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
            <ScanViewer
              key={scan.id}
              file={view.files[scan.id] ?? null}
              title={nameOf(d.title, lang)}
              sourceLink={d.identifiers?.hebrewbooks ? sourceUrl({ source: 'hebrewbooks', sourceId: d.identifiers.hebrewbooks }) : null}
              pageLabels={(scan.data as D).pageLabels}
            />
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
      <ScanViewer file={view.files[entity.id] ?? null} title={pub ? labelOf(pub, lang) : entity.id} sourceLink={null} pageLabels={d.pageLabels} />
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

function AuthorPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  return (
    <>
      <p className="kicker">{typeName('author', lang)}</p>
      <h1>{nameOf(d.name, lang)}</h1>
      {d.born || d.passed ? (
        <p className="subtitle">
          {[d.born ? dateLabel(d.born, lang, { civil: false }) : '', d.passed ? dateLabel(d.passed, lang, { civil: false }) : ''].join(' – ')}
        </p>
      ) : null}
      {view.lists.works?.length ? (
        <section>
          <h2>{t(lang, 'works')}</h2>
          <ItemList items={view.lists.works} meta={(w) => GENRES[(w.data as D).genre]?.[lang] ?? null} />
        </section>
      ) : null}
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
      <Page entity={entity} view={view} lang={lang} />
      <div className="item-footer">
        <span>
          {t(lang, 'permanentLink')}: <Link to={href(`/${entity.id}`, lang)}><code>{entity.id}</code></Link>
        </span>
        <Link to={href(`/history/${entity.id}`, lang)}>{t(lang, 'history')}</Link>
        {pointing > 0 ? (
          <span>
            {t(lang, 'pointsHere')}: {pointing}
          </span>
        ) : null}
      </div>
    </article>
  );
}
