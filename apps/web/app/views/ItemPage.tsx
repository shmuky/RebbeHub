import { Link, useSearchParams } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import { AudioPlayer } from '../components/AudioPlayer.js';
import { EventPage } from './EventPage.js';
import { AuthorPage, SetPage, WorkPage } from './LibraryPages.js';
import { ItemLink, ItemList } from '../components/ItemLink.js';
import { Linked, Sources } from '../components/Linked.js';
import { PageBody } from '../components/PageBody.js';
import { Relations } from '../components/Relations.js';
import { Printings } from '../components/Printings.js';
import { ScanViewer } from '../components/ScanViewer.js';
import { TextView } from '../components/TextView.js';
import { UnitTexts } from '../components/Translations.js';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { kindName, languageName, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import type { ItemView } from '../lib/itemData.server.js';
import { labelOf } from '../lib/labels.js';
import { st } from '../lib/scanStrings.js';
import { ps } from '../lib/pageStrings.js';
import { href, itemPath, SOURCE_NAMES, sourceUrl } from '../lib/links.js';
import { useLang } from '../lib/useLang.js';
import { readHref } from '../routes/read.js';
import { readable } from './EventPage.js';
import { Icon } from '../ui/Icon.js';
import { ItemShell, type ItemFact } from '../ui/ItemShell.js';
import { EmptyState, MachineNote } from '../ui/primitives.js';
import { Shaar } from '../ui/Shaar.js';
import { commonTabs, p, SideActivity, SideDetails, SideKeepers, SideSection, ThreadRows } from './itemParts.js';

/**
 * Every item's page, by its kind: a sefer, a shelf and a Rebbe are the
 * library's (LibraryPages), a farbrengen its own (EventPage); a sicha, a
 * printing, a scan, a recording, a text and anything else are here. Each
 * is drawn in the one frame (ui/ItemShell): head, tabs, body and side.
 */

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

const W = {
  said: { he: 'נאמרה ב', en: 'Said at' },
  inSefer: { he: 'בספר', en: 'In' },
  pages: { he: 'עמ׳', en: 'pp.' },
  checked: { he: 'נבדק בידי אדם', en: 'checked by a person' },
  sections: { he: 'סעיפים', en: 'sections' },
  text: { he: 'טקסט', en: 'Text' },
  printingsTab: { he: 'הדפסות', en: 'Printings' },
  scans: { he: 'סריקות', en: 'Scans' },
  contents: { he: 'תוכן', en: 'Contents' },
  suggestions: { he: 'הצעות', en: 'Suggestions' },
  noSuggestions: { he: 'אין הצעות פתוחות על העמוד הזה.', en: 'No open suggestions about this page.' },
  printing: { he: 'הדפסה', en: 'Printing' },
  printingNo: { he: 'הדפסה', en: 'printing' },
  publisher: { he: 'הוצאה', en: 'Publisher' },
  year: { he: 'שנה', en: 'Year' },
  scanOf: { he: 'סריקה של', en: 'Scan of' },
  pagesCount: { he: 'עמודים', en: 'pages' },
  recording: { he: 'הקלטה', en: 'Recording' },
  play: { he: 'השמעה', en: 'Play' },
  noText: { he: 'לשיחה הזאת עוד אין טקסט כאן.', en: 'This sicha has no text here yet.' },
  addText: { he: 'הוספת טקסט', en: 'Add its text' },
  shaarOf: { he: 'שער', en: 'Title page' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

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
    <div className="side-list">
      {copies.map((c, i) => {
        const link = sourceUrl(c);
        const name = SOURCE_NAMES[c.source]?.[lang] ?? c.source;
        const body = (
          <>
            <span className="grow">
              {name}
              {c.language ? ` · ${languageName(c.language, lang)}` : ''}
              {c.credit ? ` · ${c.credit}` : ''}
            </span>
            <span className="num subtle">{kindName(c.kind, lang)}</span>
          </>
        );
        return link ? (
          <a key={i} href={link} rel="noopener" target="_blank">
            {body}
          </a>
        ) : (
          <span key={i} className="side-row">
            {body}
          </span>
        );
      })}
    </div>
  );
}

/** The crumbs to a sefer and its volume, from a sicha or a printing. */
function workCrumbs(work: Entity | undefined, view: ItemView, lang: Lang, volume?: { value: string; label?: LocalName } | null) {
  const sets = work ? ((((work.data as D).sets ?? []) as string[]).map((id) => view.refs[id]).filter(Boolean) as Entity[]) : [];
  return [
    { label: t(lang, 'tabLibrary'), to: href('/sets', lang) },
    ...sets.slice(0, 1).map((s) => ({ label: nameOf((s.data as D).name, lang), to: href(itemPath(s), lang) })),
    ...(work ? [{ label: labelOf(work, lang), to: href(itemPath(work), lang) }] : []),
    ...(work && volume ? [{ label: nameOf(volume.label, lang) || volume.value, to: href(itemPath(work), lang, { part: volume.value }) }] : []),
  ];
}

function UnitPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const work = view.refs[d.work];
  const steps = (d.position ?? []) as Array<{ level: string; value: string; label?: LocalName }>;
  const volume = steps.length > 1 ? steps[0] : null;
  const events = ((d.events ?? []) as string[]).map((id) => view.refs[id]).filter((e): e is Entity => Boolean(e));
  const texts = view.lists.texts ?? [];
  const originals = texts.filter((x) => (x.data as D).kind !== 'transcript' && (x.data as D).kind !== 'translation');
  const segs = originals.flatMap((x) => view.segments[x.id] ?? []).filter((s) => (s.data as D).kind !== 'heading');
  const checked = segs.filter((s) => Number((s.data as D).proofread ?? 0) >= 1).length;
  const printedIn = view.lists.printedIn ?? [];
  const firstMap = printedIn[0];
  const firstPub = firstMap ? view.refs[(firstMap.data as D).publication] : undefined;
  const scanCopy = ((d.editions ?? []) as Array<{ kind: string; url?: string }>).find((e) => (e.kind === 'pdf' || e.kind === 'scan') && e.url && readable(e.url));
  const compare = originals.length + printedIn.length >= 2;
  const facts: Array<ItemFact | null> = [
    events[0] ? { icon: 'cal', children: <>{w(lang, 'said')}<Link to={href(itemPath(events[0]), lang)}><b>{labelOf(events[0], lang)}</b></Link></> } : d.date ? { icon: 'cal', children: <b>{dateLabel(d.date, lang)}</b> } : null,
    firstMap && firstPub ? { icon: 'file', children: <>{w(lang, 'pages')} <b className="num">{(firstMap.data as D).pages.from}–{(firstMap.data as D).pages.to}</b> · {labelOf(firstPub, lang)}</> } : null,
    segs.length ? { icon: 'layers', children: <><b>{num(segs.length, lang)}</b> {w(lang, 'sections')}</> } : null,
    segs.length ? { icon: 'check', children: <><b>{Math.round((checked / segs.length) * 100)}%</b> {w(lang, 'checked')}</> } : null,
  ];
  const suggestions = view.about.filter((x) => x.kind === 'suggestion' && x.state === 'open').length;
  const [params] = useSearchParams();
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: workCrumbs(work, view, lang, volume),
        kicker: work ? [labelOf(work, lang), volume ? nameOf(volume.label, lang) || volume.value : null].filter(Boolean).join(', ') : undefined,
        title: nameOf(d.label, lang),
        torah: true,
        sub: events[0] ? undefined : d.note,
        facts,
        actions: (
          <>
            {compare ? (
              <Link className="btn" to={href(`/compare/${entity.id}`, lang)}>
                <Icon name="compare" />
                {t(lang, 'comparePrintings')}
              </Link>
            ) : null}
            {scanCopy ? (
              <Link className="btn primary" to={readHref({ url: scanCopy.url!, title: nameOf(d.label, lang), sub: work ? labelOf(work, lang) : undefined }, lang)}>
                <Icon name="book" />
                {t(lang, 'readScan')}
              </Link>
            ) : null}
          </>
        ),
        tabs: [
          { key: 'page', label: w(lang, 'text'), icon: 'file', to: href(itemPath(entity), lang), count: segs.length || undefined },
          { key: 'suggestions', label: w(lang, 'suggestions'), icon: 'suggest', to: href(itemPath(entity), lang, { tab: 'suggestions' }), count: suggestions },
          ...commonTabs(entity, view, lang),
        ],
        tab: params.get('tab') === 'suggestions' ? 'suggestions' : 'page',
      }}
      side={
        <>
          <SideDetails
            lang={lang}
            rows={[
              work && [typeName('work', lang), <ItemLink item={work} />],
              volume && [lang === 'he' ? 'כרך' : 'Volume', work ? <Link to={href(itemPath(work), lang, { part: volume.value })}>{nameOf(volume.label, lang) || volume.value}</Link> : volume.value],
              d.date && [t(lang, 'date'), dateLabel(d.date, lang)],
              events.length ? [t(lang, 'events'), <Refs ids={d.events} view={view} />] : null,
              [p(lang, 'id'), <span className="num">{entity.id}</span>],
            ]}
          />
          {printedIn.length ? (
            <SideSection title={t(lang, 'printedIn')}>
              <div className="side-list">
                {printedIn.map((m) => {
                  const md = m.data as D;
                  const pub = view.refs[md.publication];
                  return pub ? (
                    <Link key={m.id} to={href(itemPath(pub), lang)}>
                      <span className="grow">{labelOf(pub, lang)}</span>
                      <span className="num subtle">
                        {md.pages.from}–{md.pages.to}
                      </span>
                    </Link>
                  ) : null;
                })}
              </div>
            </SideSection>
          ) : null}
          {d.editions?.length ? (
            <SideSection title={t(lang, 'editions')}>
              <Copies copies={d.editions.filter((e: { url?: string }) => !(e.url && readable(e.url)))} lang={lang} />
            </SideSection>
          ) : null}
          <SideKeepers keepers={view.keepers} lang={lang} />
          <SideActivity about={view.about} lang={lang} />
        </>
      }
    >
      <UnitBody entity={entity} view={view} lang={lang} />
    </ItemShell>
  );
}

function UnitBody({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  if (tab === 'suggestions') return <ThreadRows threads={view.about} lang={lang} empty={<EmptyState icon="suggest" title={w(lang, 'noSuggestions')} compact />} />;
  const texts = view.lists.texts ?? [];
  return (
    <>
      {texts.length ? (
        // Its words, one language at a time, with its translations and "Add a translation".
        <UnitTexts unit={entity} texts={texts} segments={view.segments} lang={lang} />
      ) : (
        <div className="box">
          <EmptyState icon="file" title={w(lang, 'noText')} actions={<Link className="btn sm" to={href('/add', lang, { what: 'hanacha', for: entity.id })}>{ps(lang, 'addHanacha')}</Link>} />
        </div>
      )}
      {/* The chapter's own words come first; where they and other copies are from, after. */}
      <PageBody entity={entity} lang={lang} />
    </>
  );
}

function PublicationPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const scans = view.lists.scans ?? [];
  const identifiers = Object.entries((d.identifiers ?? {}) as Record<string, unknown>);
  const work = view.refs[d.work];
  const year = d.date ? dateLabel(d.date, lang, { civil: false }) : d.gregorianYear ? String(d.gregorianYear) : undefined;
  const contents = view.lists.contents ?? [];
  const facts: Array<ItemFact | null> = [
    d.publisher ? { icon: 'layers', children: <b>{[d.publisher, d.placePrinted].filter(Boolean).join(', ')}</b> } : null,
    year ? { icon: 'cal', children: <>{year}{d.gregorianYear && d.date ? ` · ${d.gregorianYear}` : ''}</> } : null,
    d.printing ? { icon: 'layers', children: <>{w(lang, 'printingNo')} <b>{num(d.printing, lang)}</b></> } : null,
    d.pageCount ? { icon: 'file', children: <><b>{num(d.pageCount, lang)}</b> {w(lang, 'pagesCount')}</> } : null,
    { icon: 'scan', children: scans.length ? <><b>{num(scans.length, lang)}</b> {st(lang, 'scansCount')}</> : st(lang, 'noScanYet') },
  ];
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: workCrumbs(work, view, lang),
        cover: <Shaar kind={PUBLICATION_KINDS[d.kind]?.[lang]} title={nameOf(d.title, lang)} publisher={d.publisher} place={d.placePrinted} year={year} caption={year ? `${w(lang, 'shaarOf')} · ${year}` : undefined} />,
        kicker: PUBLICATION_KINDS[d.kind]?.[lang] ?? typeName('publication', lang),
        title: nameOf(d.title, lang),
        torah: true,
        sub: d.simcha ? [d.simcha.families.join(' – '), d.simcha.date ? dateLabel(d.simcha.date, lang) : null, d.simcha.place].filter(Boolean).join(' · ') : undefined,
        facts,
        tabs: [
          { key: 'page', label: w(lang, 'scans'), icon: 'scan', to: href(itemPath(entity), lang), count: scans.length },
          ...commonTabs(entity, view, lang),
        ],
        tab: 'page',
      }}
      side={
        <>
          <SideDetails
            lang={lang}
            rows={[
              d.work && [typeName('work', lang), <>
                <Refs ids={d.work} view={view} />
                {d.volume ? ` · ${d.volume}` : ''}
              </>],
              d.reprintOf && view.refs[d.reprintOf] ? [st(lang, 'reprintOf'), <Refs ids={d.reprintOf} view={view} />] : null,
              ...identifiers.map(([k, v]) => {
                const values = Array.isArray(v) ? v : [v];
                return [
                  SOURCE_NAMES[k]?.[lang] ?? k,
                  <>
                    {values.map((value, i) => {
                      const link = sourceUrl({ source: k, sourceId: String(value) });
                      return (
                        <span key={i} className="num">
                          {i ? ', ' : ''}
                          {link ? <a href={link}>{String(value)}</a> : String(value)}
                        </span>
                      );
                    })}
                  </>,
                ] as [React.ReactNode, React.ReactNode];
              }),
              [p(lang, 'id'), <span className="num">{entity.id}</span>],
            ]}
          />
          <SideKeepers keepers={view.keepers} lang={lang} />
          <SideActivity about={view.about} lang={lang} />
        </>
      }
    >
      <div className="stack-lg">
        {scans.length ? (
          <section className="stack">
            {scans.map((scan) => (
              <div key={scan.id} className="stack">
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
                    <Link className="btn" to={href(`/text/${scan.id}`, lang)}>
                      <Icon name="file" />
                      {t(lang, 'readTheText')}
                    </Link>
                  </p>
                ) : null}
              </div>
            ))}
          </section>
        ) : d.identifiers?.hebrewbooks ? (
          <ScanViewer file={null} title={nameOf(d.title, lang)} sourceLink={sourceUrl({ source: 'hebrewbooks', sourceId: d.identifiers.hebrewbooks })} />
        ) : (
          <ScanViewer file={null} title={nameOf(d.title, lang)} sourceLink={null} />
        )}
        {contents.length ? (
          <section className="stack">
            <h2 className="h-sec">{t(lang, 'contentsMap')}</h2>
            <div className="box toc">
              {contents.map((m) => {
                const md = m.data as D;
                const unit = md.unit ? view.refs[md.unit] : undefined;
                const label = unit ? labelOf(unit, lang) : nameOf(md.label, lang);
                const body = (
                  <>
                    <span className="t">{label}</span>
                    <span />
                    <span className="ct num">{md.pages.to !== md.pages.from ? `${md.pages.to - md.pages.from + 1} ${w(lang, 'pagesCount')}` : ''}</span>
                    <span className="pg num">{md.pages.from}</span>
                  </>
                );
                return unit ? (
                  <Link key={m.id} className="e" to={href(itemPath(unit), lang)}>
                    {body}
                  </Link>
                ) : (
                  <div key={m.id} className="e">
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        {view.lists.otherPrintings?.length ? (
          <section className="stack">
            <h2 className="h-sec">{st(lang, 'otherPrintings')}</h2>
            <Printings publications={view.lists.otherPrintings} lang={lang} />
          </section>
        ) : null}
      </div>
    </ItemShell>
  );
}

function ScanPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const pub = view.refs[d.publication];
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }, ...(pub ? [{ label: labelOf(pub, lang), to: href(itemPath(pub), lang) }] : [])],
        kicker: typeName('scan', lang),
        title: pub ? `${w(lang, 'scanOf')} ${labelOf(pub, lang)}` : typeName('scan', lang),
        facts: [
          d.pageCount ? { icon: 'file', children: <><b>{num(d.pageCount, lang)}</b> {w(lang, 'pagesCount')}</> } : null,
          d.completeness ? { icon: 'check', children: <>{d.completeness}{d.preferred ? ' · ✓' : ''}</> } : null,
          { icon: 'database', children: <Link to={href(`/files/${d.file}`, lang)}><span className="num">{String(d.file).slice(0, 12)}</span></Link> },
        ],
        tabs: [{ key: 'page', label: typeName('scan', lang), icon: 'scan', to: href(itemPath(entity), lang) }, ...commonTabs(entity, view, lang)],
        tab: 'page',
      }}
    >
      <ScanViewer file={view.files[entity.id] ?? null} title={pub ? labelOf(pub, lang) : entity.id} sourceLink={null} pageLabels={d.pageLabels} pages={view.pages[entity.id]} />
    </ItemShell>
  );
}

const duration = (ms: number) => {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

function RecordingPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const event = d.event ? view.refs[d.event] : undefined;
  const parts = (view.lists.parts ?? []).filter((x) => x.id !== entity.id);
  const texts = view.lists.texts ?? [];
  const videos = (d.videos ?? []) as Array<{ provider: string; url: string }>;
  const file = view.files[entity.id];
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [{ label: (lang === "he" ? "התוועדויות" : "Farbrengens"), to: href('/calendar', lang) }, ...(event ? [{ label: labelOf(event, lang), to: href(itemPath(event), lang) }] : [])],
        kicker: typeName('recording', lang),
        title: nameOf(d.title, lang),
        facts: [
          d.part ? { icon: 'layers', children: <>{ps(lang, 'part')} <b>{d.part}</b></> } : null,
          d.durationMs ? { icon: 'clock', children: <b className="num">{duration(d.durationMs)}</b> } : null,
          d.language ? { icon: 'globe', children: languageName(d.language, lang) } : null,
        ],
        tabs: [{ key: 'page', label: w(lang, 'recording'), icon: 'audio', to: href(itemPath(entity), lang) }, ...commonTabs(entity, view, lang)],
        tab: 'page',
      }}
      side={
        <SideDetails
          lang={lang}
          rows={[
            event && [typeName('event', lang), <ItemLink item={event} />],
            d.file && [ps(lang, 'theFile'), <>
              <Link to={href(`/files/${d.file}`, lang)}>
                <span className="num">{String(d.file).slice(0, 12)}</span>
              </Link>
              {file && !file.url ? ` · ${ps(lang, 'notServed')}` : ''}
            </>],
            d.url && [ps(lang, 'listenElsewhere'), <a href={d.url} target="_blank" rel="noopener">{new URL(d.url).hostname}</a>],
            videos.length ? [ps(lang, 'videos'), <>{videos.map((v, i) => (
              <span key={v.url}>
                {i > 0 ? ' · ' : ''}
                <a href={v.url} target="_blank" rel="noopener">
                  {SOURCE_NAMES[v.provider]?.[lang] ?? v.provider}
                </a>
              </span>
            ))}</>] : null,
            [p(lang, 'id'), <span className="num">{entity.id}</span>],
          ]}
        />
      }
    >
      <div className="stack-lg">
        <AudioPlayer recordings={[entity]} sources={{ [entity.id]: file?.url ?? null }} />
        {texts.length ? (
          <section className="stack">
            <h2 className="h-sec">{ps(lang, 'transcripts')}</h2>
            <ItemList items={texts} meta={(x) => `${kindName(String((x.data as D).kind), lang)} · ${languageName(String((x.data as D).language), lang)}`} />
          </section>
        ) : null}
        {parts.length ? (
          <section className="stack">
            <h2 className="h-sec">{ps(lang, 'otherParts')}</h2>
            <ItemList items={parts} meta={(x) => ((x.data as D).part ? `${ps(lang, 'part')} ${(x.data as D).part}` : null)} />
          </section>
        ) : null}
      </div>
    </ItemShell>
  );
}

function TextPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const unit = d.unit ? view.refs[d.unit] : undefined;
  const segments = view.segments[entity.id] ?? [];
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }, ...(unit ? [{ label: labelOf(unit, lang), to: href(itemPath(unit), lang) }] : [])],
        kicker: [kindName(String(d.kind), lang), languageName(String(d.language), lang)].filter(Boolean).join(' · '),
        title: unit ? labelOf(unit, lang) : typeName('text', lang),
        torah: true,
        sub: d.kind === 'translation' && d.credit ? d.credit : undefined,
        facts: [{ icon: 'layers', children: <><b>{num(segments.length, lang)}</b> {w(lang, 'sections')}</> }],
        tabs: [{ key: 'page', label: w(lang, 'text'), icon: 'file', to: href(itemPath(entity), lang) }, ...commonTabs(entity, view, lang)],
        tab: 'page',
      }}
    >
      <TextView segments={segments} language={d.language} withheld={segments.some((s) => s.withheld) ? 'withheld' : undefined} fixable={d.kind === 'translation'} translation={d.kind === 'translation'} />
    </ItemShell>
  );
}

/** Fields every page shows in its own way, or that are not a reader's. */
const NOT_FACTS = new Set(['body', 'bodySource', 'sources', 'externalIds', 'sets', 'topics', 'title', 'name', 'label']);

/** One field's value as a reader sees it: a name, a date, an item's link, a list of them. */
function Fact({ value, view, lang }: { value: unknown; view: ItemView; lang: Lang }): React.ReactElement {
  if (typeof value === 'string') {
    if (view.refs[value]) return <ItemLink item={view.refs[value]!} />;
    if (/^\d{4}(-\w{2,3}(-\d{2})?)?$/.test(value) && Number(value.slice(0, 4)) > 5000) return <>{dateLabel(value, lang)}</>;
    if (/^[0-9a-f]{64}$/.test(value)) {
      return (
        <Link to={href(`/files/${value}`, lang)}>
          <span className="num">{value.slice(0, 12)}</span>
        </Link>
      );
    }
    if (/^https?:\/\//.test(value)) {
      return (
        <a href={value} target="_blank" rel="noopener">
          {value}
        </a>
      );
    }
    return <>{value}</>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return <>{String(value)}</>;
  if (Array.isArray(value)) {
    return (
      <>
        {value.map((v, i) => (
          <span key={i}>
            {i > 0 ? ', ' : ''}
            <Fact value={v} view={view} lang={lang} />
          </span>
        ))}
      </>
    );
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.he === 'string') return <>{nameOf(o as unknown as LocalName, lang)}</>;
    return <code>{JSON.stringify(value)}</code>;
  }
  return <>—</>;
}

/** Anything else (people, places, topics, sources, relations, syncs): its fields as facts, what they name linked. */
function GenericPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = (entity.data ?? {}) as D;
  const facts = Object.entries(d).filter(([k, v]) => !NOT_FACTS.has(k) && v !== null && v !== undefined && v !== '');
  const machine = d.machineOrigin && !d.machineOrigin.checked;
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }],
        kicker: typeName(entity.type, lang),
        title: labelOf(entity, lang),
        extra: machine ? <MachineNote>{ps(lang, 'machineNote')}</MachineNote> : undefined,
        tabs: [{ key: 'page', label: typeName(entity.type, lang), icon: 'file', to: href(itemPath(entity), lang) }, ...commonTabs(entity, view, lang)],
        tab: 'page',
      }}
    >
      {facts.length ? (
        <div className="box box-b">
          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>
                  <Fact value={v} view={view} lang={lang} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {d.sets?.length ? (
        <p className="muted">
          {typeName('set', lang)}: <Refs ids={d.sets} view={view} />
        </p>
      ) : null}
    </ItemShell>
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

/** What every page's side ends with: what belongs to it, where it came from, and its permanent link. */
export function ItemSideEnd({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  return (
    <>
      <Linked entity={entity} groups={view.linked ?? []} lang={lang} />
      <Sources data={(entity.data ?? {}) as Record<string, unknown>} lang={lang} />
      <section className="permalink">
        <h4>{p(lang, 'permanent')}</h4>
        <Link to={href(`/${entity.id}`, lang)} className="num">
          {entity.id}
        </Link>
        {view.backlinks.length ? (
          <span className="subtle small">
            {' '}
            · {t(lang, 'pointsHere')}: {num(view.backlinks.length, lang)}
          </span>
        ) : null}
      </section>
    </>
  );
}

/** What every page's body ends with: its own words (a page body) and its links both ways. */
export function ItemBelowStart({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  return (
    <>
      {entity.type === 'unit' ? null : <PageBody entity={entity} lang={lang} />}
      <Relations relations={view.relations ?? []} refs={view.refs} lang={lang} />
    </>
  );
}

export function ItemPage({ entity, view }: { entity: Entity; view: ItemView }) {
  const lang = useLang();
  const Page = PAGES[entity.type] ?? GenericPage;
  return (
    <article className="item-page" data-type={entity.type}>
      <Page entity={entity} view={view} lang={lang} />
    </article>
  );
}
