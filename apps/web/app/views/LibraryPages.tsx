import { useState } from 'react';
import { Form, Link, useSearchParams } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import { CoverChoice } from '../components/CoverChoice.js';
import { ItemList } from '../components/ItemLink.js';
import { Books, RebbePortrait } from '../components/Library.js';
import { SeeAll } from '../components/Linked.js';
import { Printings } from '../components/Printings.js';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { languageName, nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import type { ItemView } from '../lib/itemData.server.js';
import { href, itemPath } from '../lib/links.js';
import type { TocRow } from '../lib/workView.server.js';
import { Icon } from '../ui/Icon.js';
import { readHref } from '../routes/read.js';
import { ItemShell } from '../ui/ItemShell.js';
import { EmptyState, MachineLabel } from '../ui/primitives.js';
import { Shaar } from '../ui/Shaar.js';
import { commonTabs, p, SideActivity, SideDetails, SideKeepers, SideSection, SideSources, ThreadRows } from './itemParts.js';

/**
 * The library's own pages. A sefer (and each of its volumes) as the design
 * has it: its title page, its numbers (pages, printings, sichos with a
 * recording, how much of its text a person checked), tabs for its
 * contents, printings, recordings, suggestions and talk; the contents
 * grouped as the sefer is, each sicha with the Shabbos it was said, its
 * sections, its page in the chosen printing and whether it has a scan, a
 * recording and a translation; and beside it its details, sources, keepers
 * and what happened lately. A shelf (a set) is its books; a Rebbe his.
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

const W = {
  firstPrinted: { he: 'נדפס לראשונה', en: 'First printed' },
  pages: { he: 'עמודים', en: 'pages' },
  printings: { he: 'הדפסות', en: 'printings' },
  printingsTab: { he: 'הדפסות', en: 'Printings' },
  withAudio: { he: 'שיחות עם הקלטה', en: 'sichos with a recording' },
  checked: { he: 'טקסט נבדק מול הסריקה', en: 'Text checked against the scan' },
  contents: { he: 'תוכן', en: 'Contents' },
  recordings: { he: 'הקלטות', en: 'Recordings' },
  follow: { he: 'מעקב', en: 'Follow' },
  download: { he: 'הורדה', en: 'Download' },
  read: { he: 'קריאה', en: 'Read' },
  filter: { he: 'סינון שיחות לפי פרשה, נושא או תאריך', en: 'Filter by parsha, subject or date' },
  bookOrder: { he: 'לפי סדר הספר', en: 'In the sefer’s order' },
  dateOrder: { he: 'לפי תאריך', en: 'By date' },
  suggestContents: { he: 'הצעת תיקון לתוכן', en: 'Suggest a fix to the contents' },
  pagesFromTo: { he: 'עמ׳', en: 'pp.' },
  to: { he: 'עד', en: 'to' },
  sec: { he: 'סע׳', en: 'sec.' },
  scan: { he: 'סריקה', en: 'Scan' },
  farbrengenRec: { he: 'הקלטת ההתוועדות', en: 'Recording of the farbrengen' },
  translation: { he: 'תרגום אנגלי', en: 'English translation' },
  pagesBy: { he: 'מספרי העמודים לפי', en: 'Page numbers as in' },
  changePrinting: { he: 'החלפת הדפסה', en: 'Change printing' },
  noPages: { he: 'עוד אין מספרי עמודים לשום הדפסה.', en: 'No printing has page numbers yet.' },
  addPages: { he: 'הוספת מספרי עמודים', en: 'Add page numbers' },
  series: { he: 'סדרה', en: 'Series' },
  of: { he: 'מתוך', en: 'of' },
  language: { he: 'שפה', en: 'Language' },
  publisher: { he: 'הוצאה', en: 'Publisher' },
  shaar: { he: 'שער', en: 'Title page' },
  printingOf: { he: 'דפוס', en: 'printed' },
  machineCover: { he: 'השער נבחר במכונה', en: 'Title page chosen by a machine' },
  noMatch: { he: 'אין שיחה שמתאימה לסינון.', en: 'No sicha matches the filter.' },
  clear: { he: 'ניקוי', en: 'Clear' },
  sichos: { he: 'שיחות', en: 'sichos' },
  noRecordings: { he: 'לאף שיחה כאן עוד לא קושרה הקלטה.', en: 'No sicha here has a recording linked yet.' },
  noSuggestions: { he: 'אין הצעות פתוחות על הספר הזה.', en: 'No open suggestions about this sefer.' },
  allSuggestions: { he: 'כל ההצעות', en: 'All suggestions' },
  volumeRow: { he: 'כרך', en: 'Volume' },
  missingSefer: { he: 'חסר כאן ספר?', en: 'A sefer missing here?' },
  knowPrinting: { he: 'יודעים על הדפסה, סריקה או הקלטה שחסרה כאן?', en: 'Know of a printing, scan or recording that is missing here?' },
  addIt: { he: 'הוסיפו אותה', en: 'Add it' },
  tellUs: { he: 'ספרו לנו', en: 'Tell us' },
  organize: { he: 'סידור', en: 'Organize' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

/** Where the library starts, and the shelves (sets) a page is on. */
function libraryCrumbs(view: ItemView, d: D, lang: Lang) {
  const sets = ((d.sets ?? []) as string[]).map((id) => view.refs[id]).filter((s): s is Entity => Boolean(s));
  return [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }, ...sets.map((s) => ({ label: nameOf((s.data as D).name, lang), to: href(itemPath(s), lang) }))];
}

/** "Know something we don't?": what to add from here. */
function HelpNote({ lang, title, to, action }: { lang: Lang; title: string; to: string; action: string }) {
  return (
    <div className="box help-note">
      <Icon name="plus" className="subtle" />
      <span className="grow">{title}</span>
      <Link className="btn sm" to={to}>
        {action}
      </Link>
    </div>
  );
}

/** Into the organizing view of this set or sefer: move, rename, reorder and merge what is in it. */
function OrganizeLink({ id, lang }: { id: string; lang: Lang }) {
  return (
    <Link className="btn" to={href('/organize', lang, { root: id })}>
      <Icon name="layers" />
      {w(lang, 'organize')}
    </Link>
  );
}

export function SetPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const members = view.lists.members ?? [];
  const works = members.filter((m) => m.type === 'work');
  const others = members.filter((m) => m.type !== 'work');
  const counts = view.counts ?? {};
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }],
        title: nameOf(d.name, lang),
        torah: true,
        sub: d.description ? nameOf(d.description, lang) : undefined,
        facts: [
          works.length ? { icon: 'book', children: <><b>{num(works.length, lang)}</b> {t(lang, 'seforim')}</> } : null,
          others.length ? { icon: 'layers', children: <><b>{num(others.length, lang)}</b> {t(lang, 'unitsShort')}</> } : null,
          view.keepers.length ? { icon: 'users', children: <><b>{num(view.keepers.length, lang)}</b> {p(lang, 'keepers')}</> } : null,
        ].filter((f): f is NonNullable<typeof f> => f !== null) as never,
        tabs: [{ key: 'page', label: t(lang, 'seforim'), icon: 'book', to: href(itemPath(entity), lang), count: works.length || undefined }, ...commonTabs(entity, view, lang)],
        tab: 'page',
        actions: <OrganizeLink id={entity.id} lang={lang} />,
      }}
      side={
        <>
          <SideKeepers keepers={view.keepers} lang={lang} />
          <SideActivity about={view.about} lang={lang} />
        </>
      }
    >
      {works.length ? <Books works={works} lang={lang} covers={view.covers} meta={(wk) => (counts[wk.id] ? `${num(counts[wk.id]!, lang)} ${t(lang, 'unitsShort')}` : undefined)} /> : null}
      <SeeAll id={entity.id} group={view.linked.find((g) => g.field === 'sets' && g.type === 'work')} shown={works.length} lang={lang} />
      {others.length ? (
        <section className="stack">
          <h2 className="h-sec">{t(lang, 'moreInShelf')}</h2>
          <ItemList items={others} />
        </section>
      ) : null}
      {view.linked
        .filter((g) => g.field === 'sets' && g.type !== 'work')
        .map((g) => (
          <SeeAll key={g.type} id={entity.id} group={g} shown={others.filter((o) => o.type === g.type).length} lang={lang} />
        ))}
      <HelpNote lang={lang} title={w(lang, 'missingSefer')} to={href('/add', lang, { what: 'sefer' })} action={w(lang, 'tellUs')} />
    </ItemShell>
  );
}

type WorkTab = 'contents' | 'printings' | 'recordings' | 'suggestions';

/** The three marks of a sicha: a scan, the farbrengen's recording, an English translation. */
function Marks({ row, lang }: { row: TocRow; lang: Lang }) {
  return (
    <span className="has" aria-label={[row.scan && w(lang, 'scan'), row.audio && w(lang, 'farbrengenRec'), row.translation && w(lang, 'translation')].filter(Boolean).join(', ') || undefined}>
      {row.scan ? <Icon name="scan" label={w(lang, 'scan')} /> : <span />}
      {row.audio ? <Icon name="audio" label={w(lang, 'farbrengenRec')} /> : <span />}
      {row.translation ? <Icon name="book" label={w(lang, 'translation')} /> : <span />}
    </span>
  );
}

/** The contents, grouped, filtered as one types (and by ?q= without script), in the sefer's order or by date. */
function Contents({ entity, view, lang, part }: { entity: Entity; view: ItemView; lang: Lang; part: string | null }) {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const toc = view.toc!;
  const byDate = params.get('sort') === 'date';
  const words = q.trim().split(/\s+/).filter(Boolean);
  const match = (r: TocRow) => words.every((x) => `${r.title} ${r.sub ?? ''}`.includes(x));
  const groups = byDate
    ? [{ label: null, from: null, to: null, rows: toc.groups.flatMap((g) => g.rows).sort((a, b) => String(a.sub).localeCompare(String(b.sub))) }]
    : toc.groups;
  const shown = groups.map((g) => ({ ...g, rows: g.rows.filter(match) })).filter((g) => g.rows.length);
  const here = (extra: Record<string, string | undefined>) => href(itemPath(entity), lang, { part: part ?? undefined, printing: params.get('printing') ?? undefined, sort: params.get('sort') ?? undefined, q: q || undefined, ...extra });
  return (
    <section aria-label={w(lang, 'contents')}>
      <div className="toolbar">
        <Form className="filter" method="get" role="search" onSubmit={(e) => e.preventDefault()}>
          <Icon name="search" className="subtle" />
          {part ? <input type="hidden" name="part" value={part} /> : null}
          {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
          <input name="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w(lang, 'filter')} aria-label={w(lang, 'filter')} />
        </Form>
        <Link className="btn" to={here({ sort: byDate ? undefined : 'date' })} preventScrollReset replace>
          <Icon name="sort" />
          {byDate ? w(lang, 'dateOrder') : w(lang, 'bookOrder')}
        </Link>
        <a className="btn" href="#suggest">
          <Icon name="plus" />
          {w(lang, 'suggestContents')}
        </a>
      </div>
      {shown.length ? (
        <div className="box toc">
          {shown.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.label ?? undefined}>
              {g.label || g.from ? (
                <div className="grp">
                  <span>{g.label}</span>
                  {g.from ? (
                    <span className="muted num">
                      {w(lang, 'pagesFromTo')} {g.from} {w(lang, 'to')} {g.to}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {g.rows.map((r) => (
                <Link key={r.id} className="e" to={href(r.path, lang)}>
                  <span className="t">
                    {r.title}
                    {r.sub ? <small>{r.sub}</small> : null}
                  </span>
                  <Marks row={r} lang={lang} />
                  <span className="ct num">{r.sections ? `${num(r.sections, lang)} ${w(lang, 'sec')}` : '—'}</span>
                  <span className="pg num">{r.page ?? ''}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="box">
          <EmptyState icon="search" title={w(lang, 'noMatch')} compact actions={<button type="button" className="btn sm" onClick={() => setQ('')}>{w(lang, 'clear')}</button>} />
        </div>
      )}
      <div className="toc-legend subtle">
        <span>
          <Icon name="scan" /> {w(lang, 'scan')}
        </span>
        <span>
          <Icon name="audio" /> {w(lang, 'farbrengenRec')}
        </span>
        <span>
          <Icon name="book" /> {w(lang, 'translation')}
        </span>
        <span className="end">
          {toc.printing ? (
            <>
              {w(lang, 'pagesBy')} {toc.printing.label}.{' '}
              {toc.printings.length > 1 ? (
                <details className="pick">
                  <summary>{w(lang, 'changePrinting')}</summary>
                  <div className="pop" role="list">
                    {toc.printings.map((pr) => (
                      <Link key={pr.id} role="listitem" className="pop-o" to={here({ printing: pr.id })} aria-current={pr.id === toc.printing!.id ? 'true' : undefined} preventScrollReset replace>
                        {pr.label}
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <>
              {w(lang, 'noPages')} <a href="#suggest">{w(lang, 'addPages')}</a>
            </>
          )}
        </span>
      </div>
      {view.next ? (
        <p className="more-row">
          <Link className="btn" to={href(itemPath(entity), lang, { after: view.next })}>
            {t(lang, 'more')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

export function WorkPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const [params] = useSearchParams();
  const outline = view.outline ?? [];
  const copies = (d.sourceCopies ?? []) as Array<{ source: string; sourceId: string; kind: string }>;
  const publications = view.lists.publications ?? [];
  const total = outline.reduce((sum, x) => sum + x.units, 0);
  const part = params.get('part');
  const openPart = part ? outline.find((x) => x.value === part) : outline.length === 1 ? outline[0] : undefined;
  const volumes = outline.length > 1 && !openPart;
  const asked = params.get('tab') as WorkTab | null;
  const tab: WorkTab = asked && ['contents', 'printings', 'recordings', 'suggestions'].includes(asked) ? asked : 'contents';
  const authors = ((d.authors ?? []) as string[]).map((id) => view.refs[id]).filter((a): a is Entity => Boolean(a));
  const toc = view.toc;
  const title = nameOf(d.title, lang);
  const partLabel = openPart && outline.length > 1 ? (openPart.label ? nameOf(openPart.label, lang) : openPart.value) : null;
  const ofPart = publications.filter((x) => !openPart || !(x.data as D).volume || String((x.data as D).volume) === openPart.value);
  const first = ofPart[0];
  const fd = (first?.data ?? {}) as D;
  const firstYear = fd.date ? dateLabel(fd.date, lang, { civil: false }) : fd.gregorianYear ? String(fd.gregorianYear) : null;
  const suggestions = view.about.filter((x) => x.kind === 'suggestion' && x.state === 'open');
  const tabTo = (to: WorkTab) => href(itemPath(entity), lang, { part: part ?? undefined, tab: to === 'contents' ? undefined : to });
  const cover = view.workCover?.cover;
  const sets = ((d.sets ?? []) as string[]).map((id) => view.refs[id]).filter((s): s is Entity => Boolean(s));
  const volumeIndex = openPart && outline.length > 1 ? outline.indexOf(openPart) + 1 : 0;
  const readTo = toc?.read.scanUrl ? null : toc?.read.unit ? href(toc.read.unit, lang) : null;

  const facts = [
    first ? { icon: 'cal' as const, children: <>{w(lang, 'firstPrinted')} <b>{[fd.publisher, firstYear].filter(Boolean).join(', ')}</b></> } : null,
    toc?.stats.pages ? { icon: 'file' as const, children: <><b>{num(toc.stats.pages, lang)}</b> {w(lang, 'pages')}</> } : null,
    ofPart.length ? { icon: 'layers' as const, children: <><b>{num(ofPart.length, lang)}</b> {w(lang, 'printings')}</> } : null,
    volumes ? { icon: 'book' as const, children: <><b>{num(outline.length, lang)}</b> {t(lang, 'volumes')} · <b>{num(total, lang)}</b> {t(lang, 'unitsShort')}</> } : null,
    toc?.stats.withAudio ? { icon: 'audio' as const, children: <><b>{num(toc.stats.withAudio, lang)}</b> {w(lang, 'withAudio')}</> } : null,
    toc && toc.stats.checked !== null ? { icon: 'check' as const, children: <>{w(lang, 'checked')}: <b>{toc.stats.checked}%</b></> } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [...libraryCrumbs(view, d, lang), ...(partLabel ? [{ label: title, to: href(itemPath(entity), lang) }, { label: partLabel }] : [{ label: title }])],
        cover: (
          <Shaar
            kind={lang === 'he' ? 'ספר' : 'Sefer'}
            title={title}
            part={partLabel ?? undefined}
            by={authors.map((a) => nameOf((a.data as D).name, lang)).join(', ') || undefined}
            publisher={fd.publisher}
            place={fd.placePrinted}
            year={firstYear ?? undefined}
            image={cover?.image.url ?? null}
            label={title}
            caption={cover?.machine ? <MachineLabel lang={lang} size="sm">{w(lang, 'machineCover')}</MachineLabel> : firstYear ? `${w(lang, 'shaar')} · ${w(lang, 'printingOf')} ${firstYear}` : undefined}
          />
        ),
        title: partLabel ? `${title}, ${partLabel}` : title,
        torah: true,
        sub:
          GENRES[d.genre] || authors.length ? (
            <>
              {GENRES[d.genre]?.[lang]}
              {authors.map((a, i) => (
                <span key={a.id}>
                  {i === 0 ? (GENRES[d.genre] ? ' · ' : '') : ', '}
                  <Link to={href(itemPath(a), lang)}>{nameOf((a.data as D).name, lang)}</Link>
                </span>
              ))}
            </>
          ) : undefined,
        facts,
        desc: d.description ? <p>{nameOf(d.description, lang)}</p> : undefined,
        actions: (
          <>
            <OrganizeLink id={entity.id} lang={lang} />
            {toc?.read.scanFile ? (
              <Link className="btn" to={href(`/files/${toc.read.scanFile}`, lang)}>
                <Icon name="down" />
                {w(lang, 'download')}
              </Link>
            ) : null}
            {toc?.read.scanUrl ? (
              <Link className="btn primary" to={readHref({ url: toc.read.scanUrl, title: partLabel ? `${title}, ${partLabel}` : title, sub: toc.printing?.label }, lang)}>
                <Icon name="book" />
                {w(lang, 'read')}
              </Link>
            ) : readTo ? (
              <Link className="btn primary" to={readTo}>
                <Icon name="book" />
                {w(lang, 'read')}
              </Link>
            ) : null}
          </>
        ),
        tabs: [
          { key: 'contents', label: w(lang, 'contents'), icon: 'book', to: tabTo('contents'), count: volumes ? outline.length : toc?.stats.sichos ?? (total || undefined) },
          { key: 'printings', label: w(lang, 'printingsTab'), icon: 'layers', to: tabTo('printings'), count: ofPart.length },
          ...(toc ? [{ key: 'recordings', label: w(lang, 'recordings'), icon: 'audio' as const, to: tabTo('recordings'), count: toc.stats.withAudio }] : []),
          { key: 'suggestions', label: p(lang, 'suggestions'), icon: 'suggest', to: tabTo('suggestions'), count: suggestions.length },
          ...commonTabs(entity, view, lang),
        ],
        tab,
      }}
      side={
        <>
          <SideDetails
            lang={lang}
            rows={[
              sets[0] && [
                w(lang, 'series'),
                <>
                  <Link to={href(itemPath(sets[0]), lang)}>{nameOf((sets[0].data as D).name, lang)}</Link>
                  {volumeIndex ? ` · ${num(volumeIndex, lang)} ${w(lang, 'of')} ${num(outline.length, lang)}` : ''}
                </>,
              ],
              partLabel ? [t(lang, 'volumes'), <Link to={href(itemPath(entity), lang)}>{title}</Link>] : null,
              [w(lang, 'language'), languageName(String(d.language ?? 'he'), lang)],
              fd.publisher ? [w(lang, 'publisher'), [fd.publisher, fd.placePrinted].filter(Boolean).join(', ')] : null,
              [p(lang, 'id'), <span className="num">{entity.id}</span>],
              [p(lang, 'licence'), p(lang, 'catalogLicence')],
            ]}
          />
          <SideSources copies={copies} lang={lang} />
          <SideKeepers keepers={view.keepers} lang={lang} />
          <SideActivity about={view.about} lang={lang} more={tabTo('suggestions')} />
          {view.workCover && (view.workCover.cover || view.workCover.sources.length) ? (
            <SideSection title={w(lang, 'shaar')}>
              <CoverChoice work={entity} cover={view.workCover} lang={lang} />
            </SideSection>
          ) : null}
        </>
      }
    >
      {tab === 'contents' ? (
        volumes ? (
          <ul className="box rows volumes">
            {outline.map((x, i) => {
              const printings = publications.filter((pb) => String((pb.data as D).volume ?? '') === x.value).length;
              return (
                <li key={x.value}>
                  <Link className="row hover" to={href(itemPath(entity), lang, { part: x.value })}>
                    <span className="vol-n num">{num(i + 1, lang)}</span>
                    <span className="row-main">
                      <span className="row-title torah">{x.label ? nameOf(x.label, lang) : `${w(lang, 'volumeRow')} ${x.value}`}</span>
                      <span className="row-sub">
                        {num(x.units, lang)} {w(lang, 'sichos')}
                        {printings ? ` · ${num(printings, lang)} ${w(lang, 'printings')}` : ''}
                      </span>
                    </span>
                    <Icon name="chev" className="subtle flip-ltr" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : toc ? (
          <Contents entity={entity} view={view} lang={lang} part={openPart?.value ?? null} />
        ) : (
          <div className="box">
            <EmptyState icon="book" title={t(lang, 'noContentsYet')}>
              <p>{t(lang, 'knowPrintingText')}</p>
            </EmptyState>
          </div>
        )
      ) : null}
      {tab === 'printings' ? (
        <>
          {ofPart.length ? (
            <Printings publications={ofPart} scanCounts={view.scanCounts} lang={lang} />
          ) : (
            <div className="box">
              <EmptyState icon="layers" title={lang === 'he' ? 'עוד לא נרשמה הדפסה.' : 'No printing is listed yet.'} />
            </div>
          )}
          <SeeAll id={entity.id} group={view.linked.find((g) => g.field === 'work' && g.type === 'publication')} shown={publications.length} lang={lang} />
        </>
      ) : null}
      {tab === 'recordings' && toc ? (
        toc.groups.some((g) => g.rows.some((r) => r.audio)) ? (
          <ul className="box rows">
            {toc.groups
              .flatMap((g) => g.rows)
              .filter((r) => r.audio)
              .map((r) => (
                <li key={r.id}>
                  <Link className="row hover" to={href(r.path, lang)}>
                    <Icon name="audio" className="subtle" />
                    <span className="row-main">
                      <span className="row-title torah">{r.title}</span>
                      {r.sub ? <span className="row-sub">{r.sub}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        ) : (
          <div className="box">
            <EmptyState icon="audio" title={w(lang, 'noRecordings')} actions={<Link className="btn sm" to={href('/add', lang, { what: 'recording' })}>{w(lang, 'addIt')}</Link>} />
          </div>
        )
      ) : null}
      {tab === 'suggestions' ? (
        <div className="stack">
          <ThreadRows threads={view.about} lang={lang} empty={<EmptyState icon="suggest" title={w(lang, 'noSuggestions')} compact />} />
          <p className="more-row">
            <Link to={href('/suggestions', lang)}>{w(lang, 'allSuggestions')}</Link>
          </p>
        </div>
      ) : null}
      <HelpNote lang={lang} title={w(lang, 'knowPrinting')} to={href('/add', lang, { what: 'sefer', for: entity.id })} action={w(lang, 'addIt')} />
    </ItemShell>
  );
}

export function AuthorPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const works = view.lists.works ?? [];
  const counts = view.counts ?? {};
  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [{ label: t(lang, 'tabLibrary'), to: href('/sets', lang) }],
        cover: <RebbePortrait author={entity} lang={lang} size={96} />,
        title: nameOf(d.name, lang),
        torah: true,
        sub: d.description ? nameOf(d.description as LocalName, lang) : undefined,
        facts: [{ icon: 'book', children: <><b>{num(works.length, lang)}</b> {t(lang, 'seforim')}</> }],
        tabs: [{ key: 'page', label: t(lang, 'seforim'), icon: 'book', to: href(itemPath(entity), lang), count: works.length }, ...commonTabs(entity, view, lang)],
        tab: 'page',
      }}
    >
      {works.length ? <Books works={works} lang={lang} covers={view.covers} meta={(wk) => (counts[wk.id] ? `${num(counts[wk.id]!, lang)} ${t(lang, 'unitsShort')}` : undefined)} /> : null}
      <SeeAll id={entity.id} group={view.linked.find((g) => g.field === 'authors' && g.type === 'work')} shown={works.length} lang={lang} />
    </ItemShell>
  );
}
