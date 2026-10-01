import { useContext, useState } from 'react';
import { Form, Link, useSearchParams } from 'react-router';
import { hasShaar, type LocalName, type WorkData } from '@rebbehub/model';
import { CoverChoice } from '../components/CoverChoice.js';
import { EditActions, RowEdit } from '../components/EditSheet.js';
import { ItemList } from '../components/ItemLink.js';
import { Books, RebbePortrait } from '../components/Library.js';
import { SeeAll } from '../components/Linked.js';
import { Printings } from '../components/Printings.js';
import { ShaarFile, shaarOf } from '../components/ShaarFile.js';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { languageName, nameOf, t, type Lang } from '../lib/i18n.js';
import { num, tu } from '../lib/i18nUi.js';
import type { ItemView } from '../lib/itemData.server.js';
import { href, itemPath } from '../lib/links.js';
import { additionOf } from '../lib/shelves.js';
import { labelOf } from '../lib/labels.js';
import type { TocGroup, TocRow } from '../lib/workView.server.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { readHref } from '../routes/read.js';
import { ItemShell, ItemSlots, useHashPanels } from '../ui/ItemShell.js';
import { EmptyState, MachineLabel } from '../ui/primitives.js';
import { Shaar } from '../ui/Shaar.js';
import { commonTabs, p, SideActivity, SideDetails, SideKeepers, SideSection, SideSources, ThreadRows } from './itemParts.js';
import { ofVolume } from '../lib/volumes.js';
import '../styles/pages/volume.css';

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
  additions: { he: 'הוספות', en: 'Additions' },
  additionTo: { he: 'הוספה ל', en: 'An addition to' },
  readAs: { he: 'איך לקרוא', en: 'How to read it' },
  asText: { he: 'טקסט', en: 'Text' },
  asTextHint: { he: 'ברירת המחדל · עם הערות וחיפוש', en: 'The default · with notes and search' },
  asScan: { he: 'דף סרוק', en: 'Scanned page' },
  asScanHint: { he: 'PDF של הדפוס, עמוד מול עמוד', en: 'The printing as PDF, page by page' },
  thisVolume: { he: 'הדפסות של חלק זה', en: 'Printings of this volume' },
  more: { he: 'עוד', en: 'More' },
} as const;

/** The kinds of addition to a sefer, in the order its page lists them (WorkData.addition). */
const ADDITION_KIND_NAMES: Record<string, { he: string; en: string }> = {
  commentary: { he: 'ביאורים', en: 'Commentaries' },
  index: { he: 'מפתחות', en: 'Indexes' },
  about: { he: 'על הספר', en: 'About it' },
  collection: { he: 'ליקוטים', en: 'Collections' },
  other: { he: 'אחר', en: 'Other' },
};

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

export function SetPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as D;
  const members = view.lists.members ?? [];
  // The shelf is its official sefarim; the additions that belong to no sefer are kept apart, closed, after them.
  const works = members.filter((m) => m.type === 'work' && !additionOf(m));
  const loose = members.filter((m) => m.type === 'work' && additionOf(m));
  const others = members.filter((m) => m.type !== 'work');
  // How many there are in all: the page lists the first of them (itemData.server.ts).
  const othersTotal = view.linked.filter((g) => g.field === 'sets' && g.type !== 'work').reduce((n, g) => n + g.count, 0) || others.length;
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
          others.length ? { icon: 'layers', children: <><b>{num(othersTotal, lang)}</b> {t(lang, 'unitsShort')}</> } : null,
          view.keepers.length ? { icon: 'users', children: <><b>{num(view.keepers.length, lang)}</b> {p(lang, 'keepers')}</> } : null,
        ].filter((f): f is NonNullable<typeof f> => f !== null) as never,
        tabs: [{ key: 'page', label: t(lang, 'seforim'), icon: 'book', to: href(itemPath(entity), lang), count: works.length || undefined }, ...commonTabs(entity, view, lang)],
        tab: 'page',
        actions: <EditActions target={{ id: entity.id, type: 'set', label: nameOf(d.name, lang), parent: typeof d.parent === 'string' ? d.parent : null }} lang={lang} editHref={href(`/edit/${entity.id}`, lang)} />,
      }}
      side={
        <>
          <SideKeepers keepers={view.keepers} lang={lang} />
          <SideActivity about={view.about} lang={lang} />
        </>
      }
    >
      {works.length ? (
        <Books
          works={works}
          lang={lang}
          covers={view.covers}
          meta={(wk) => (counts[wk.id] ? `${num(counts[wk.id]!, lang)} ${t(lang, 'unitsShort')}` : undefined)}
          action={(wk) => <RowEdit lang={lang} target={{ id: wk.id, type: 'work', label: nameOf((wk.data as D).title, lang), parent: entity.id }} />}
        />
      ) : null}
      {loose.length ? (
        <details className="stack">
          <summary className="h-sec">{`${w(lang, 'additions')} (${num(loose.length, lang)})`}</summary>
          <ItemList items={loose} after={(o) => <RowEdit lang={lang} target={{ id: o.id, type: o.type, label: labelOf(o, lang), parent: entity.id }} />} />
        </details>
      ) : null}
      <SeeAll id={entity.id} group={view.linked.find((g) => g.field === 'sets' && g.type === 'work')} shown={works.length + loose.length} lang={lang} />
      {others.length ? (
        <section className="stack">
          <h2 className="h-sec">{t(lang, 'moreInShelf')}</h2>
          <ItemList items={others} after={(o) => <RowEdit lang={lang} target={{ id: o.id, type: o.type, label: labelOf(o, lang), parent: entity.id }} />} />
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
                <div key={r.id} className="e-line">
                  <Link className="e" to={href(r.path, lang)}>
                    <span className="t">
                      {r.title}
                      {r.sub ? <small>{r.sub}</small> : null}
                    </span>
                    <Marks row={r} lang={lang} />
                    <span className="ct num">{r.sections ? `${num(r.sections, lang)} ${w(lang, 'sec')}` : '—'}</span>
                    <span className="pg num">{r.page ?? ''}</span>
                  </Link>
                  <RowEdit lang={lang} target={{ id: r.id, type: 'unit', label: r.title, parent: entity.id }} />
                </div>
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

/** A sicha's letter at the end of its name: בראשית א, נח ב׳. */
const LETTER = /^(.+?)\s+([א-ת]{1,3}[׳״'"]?)$/;
/** A sicha said on a day within a parsha's week, joined without spaces: וירא-כ׳ מ״ח. */
const JOINED = /^(\S(?:.*?\S)?)-(\S.*)$/;

/**
 * A volume whose sichos are named for their parsha (בראשית א, בראשית ב,
 * נח א, וירא-כ׳ מ״ח) and not grouped yet is grouped by parsha, each row
 * then named within it (שיחה א, כ׳ מ״ח), as the design shows a volume. A
 * name that says neither stays whole in the group before it.
 */
function byParsha(groups: TocGroup[], lang: Lang): TocGroup[] {
  if (groups.length !== 1 || groups[0]!.label) return groups;
  const rows = groups[0]!.rows;
  if (rows.filter((r) => LETTER.test(r.title)).length < rows.length / 2) return groups;
  const out: TocGroup[] = [];
  for (const r of rows) {
    const joined = JOINED.exec(r.title);
    const letter = joined ? null : LETTER.exec(r.title);
    const key = joined ? joined[1]! : letter ? letter[1]! : (out[out.length - 1]?.label ?? null);
    // "הוספות - שיחות ומכתבים א" holds letters as well as sichos: its rows are their letter alone.
    const title = joined ? joined[2]! : letter ? (letter[1]!.includes(' - ') ? letter[2]! : `${lang === 'he' ? 'שיחה' : 'Sicha'} ${letter[2]}`) : r.title;
    const last = out[out.length - 1];
    if (last && last.label === key) last.rows.push({ ...r, title });
    else out.push({ label: key, from: null, to: null, rows: [{ ...r, title }] });
  }
  return out;
}

/**
 * A volume, as the design draws it (3b, and 3c its sheet): its name, how
 * to read it (the text, the printed page, the other printings) behind one
 * button, and its sichos grouped by parsha, each with a quiet dot when a
 * machine made some of its words and nobody checked them yet. Everything
 * else a sefer's page has (printings, recordings, suggestions, talk,
 * history, editing) is behind the one ⋯.
 */
function VolumePage({ entity, view, lang, part, title, partLabel }: { entity: Entity; view: ItemView; lang: Lang; part: string; title: string; partLabel: string }) {
  const slots = useContext(ItemSlots);
  useHashPanels();
  const toc = view.toc!;
  const groups = byParsha(toc.groups.filter((g) => g.rows.length), lang);
  // From the first parsha to the last ("בראשית – ויחי"); a section like "הוספות - שיחות ומכתבים" is not one.
  const named = groups.map((g) => g.label).filter((x): x is string => Boolean(x) && !x!.includes(' - '));
  const span = named.length > 1 ? `${named[0]} – ${named[named.length - 1]}` : named[0] ?? null;
  const here = href(itemPath(entity), lang, { part });
  const tabTo = (tab: string) => href(itemPath(entity), lang, { part, tab });
  const scanTo = toc.read.scanUrl ? readHref({ url: toc.read.scanUrl, title: `${title}, ${partLabel}`, sub: toc.printing?.label }, lang) : null;
  const more: Array<{ to: string; icon: IconName; label: string; count?: number }> = [
    { to: tabTo('printings'), icon: 'layers', label: w(lang, 'printingsTab'), count: toc.stats.printings || undefined },
    ...(toc.stats.withAudio ? [{ to: tabTo('recordings'), icon: 'audio' as const, label: w(lang, 'recordings'), count: toc.stats.withAudio }] : []),
    { to: tabTo('suggestions'), icon: 'suggest', label: p(lang, 'suggestions') },
    ...commonTabs(entity, view, lang).map((x) => ({ to: x.to!, icon: x.icon!, label: String(x.label), count: typeof x.count === 'number' ? x.count : undefined })),
    ...(toc.read.scanFile ? [{ to: href(`/files/${toc.read.scanFile}`, lang), icon: 'down' as const, label: w(lang, 'download') }] : []),
    // Organizing the sefer (its EditSheet) is on the sefer's own page; the volume's menu edits its details.
    { to: href(`/edit/${entity.id}`, lang), icon: 'pencil', label: p(lang, 'edit') },
  ];
  return (
    <div className="wrap vol">
      <div className="vol-top">
        <Link className="vol-back" to={href(itemPath(entity), lang)}>
          <Icon name="back" size={18} />
          <span className="torah">{title}</span>
        </Link>
        <details className="vol-more">
          <summary className="ib" aria-label={w(lang, 'more')} title={w(lang, 'more')}>
            <Icon name="more" />
          </summary>
          <div className="vol-menu" role="list">
            {more.map((x) => (
              <Link key={x.to} role="listitem" to={x.to}>
                <Icon name={x.icon} size={18} className="subtle" />
                <span className="grow">{x.label}</span>
                {x.count ? <span className="subtle num">{num(x.count, lang)}</span> : null}
              </Link>
            ))}
            <div className="vol-menu-actions">
              {slots?.actions}
            </div>
          </div>
        </details>
      </div>

      <header className="vol-head">
        <div>
          <h1 className="torah">{partLabel}</h1>
          {span ? <p>{span}</p> : null}
        </div>
        <details className="vol-as">
          <summary className="btn">
            <Icon name="file" size={16} />
            {w(lang, 'asText')}
            <Icon name="chevd" size={14} className="subtle" />
          </summary>
          <div className="vol-sheet" role="dialog" aria-label={`${partLabel} · ${w(lang, 'readAs')}`}>
            <h2>
              {partLabel} · {w(lang, 'readAs')}
            </h2>
            <Link className="vol-opt on" to={here} replace preventScrollReset aria-current="true">
              <Icon name="file" size={18} />
              <span className="grow">
                <b>{w(lang, 'asText')}</b>
                <span>{w(lang, 'asTextHint')}</span>
              </span>
              <Icon name="check" size={18} />
            </Link>
            {scanTo ? (
              <Link className="vol-opt" to={scanTo}>
                <Icon name="scan" size={18} />
                <span className="grow">
                  <b>{w(lang, 'asScan')}</b>
                  <span>{w(lang, 'asScanHint')}</span>
                </span>
              </Link>
            ) : null}
            {toc.editions.length ? (
              <>
                <h3>{w(lang, 'thisVolume')}</h3>
                {toc.editions.map((x) => (
                  <Link key={x.id} className="vol-opt" to={href(x.path, lang)}>
                    <Icon name="layers" size={18} />
                    <span className="grow">
                      <b className="torah">{x.title || title}</b>
                      {x.label ? <span>{x.label}</span> : null}
                    </span>
                  </Link>
                ))}
              </>
            ) : null}
          </div>
        </details>
      </header>

      {groups.length ? (
        groups.map((g, gi) => (
          <section key={gi} className="vol-group" aria-label={g.label ?? undefined}>
            {g.label ? <h2>{g.label}</h2> : null}
            <ul>
              {g.rows.map((r) => (
                <li key={r.id}>
                  <Link to={href(r.path, lang)}>
                    <span className="grow">
                      <b className="torah">{r.title}</b>
                      {r.sub ? <span className="vol-when">{r.sub}</span> : null}
                    </span>
                    {r.machine ? (
                      <span className="vol-machine">
                        <Icon name="dot" size={16} />
                        {tu(lang, 'machineUnchecked')}
                      </span>
                    ) : null}
                    <Icon name="chev" size={16} className="subtle flip-ltr" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState icon="book" title={t(lang, 'noContentsYet')} />
      )}
      {view.next ? (
        <p className="more-row">
          <Link className="btn" to={href(itemPath(entity), lang, { part, after: view.next })}>
            {t(lang, 'more')}
          </Link>
        </p>
      ) : null}
      {slots?.below ? <div className="below">{slots.below}</div> : null}
    </div>
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
  // A volume only its printings have (no contents yet) opens on them.
  const tab: WorkTab = asked && ['contents', 'printings', 'recordings', 'suggestions'].includes(asked) ? asked : openPart && !openPart.units && outline.length > 1 ? 'printings' : 'contents';
  const authors = ((d.authors ?? []) as string[]).map((id) => view.refs[id]).filter((a): a is Entity => Boolean(a));
  const toc = view.toc;
  const title = nameOf(d.title, lang);
  const partLabel = openPart && outline.length > 1 ? (openPart.label ? nameOf(openPart.label, lang) : openPart.value) : null;
  const ofPart = publications.filter((x) => ofVolume((x.data as D).volume, openPart));
  const first = ofPart[0];
  const fd = (first?.data ?? {}) as D;
  const firstYear = fd.date ? dateLabel(fd.date, lang, { civil: false }) : fd.gregorianYear ? String(fd.gregorianYear) : null;
  const suggestions = view.about.filter((x) => x.kind === 'suggestion' && x.state === 'open');
  const tabTo = (to: WorkTab) => href(itemPath(entity), lang, { part: part ?? undefined, tab: to === 'contents' ? undefined : to });
  const cover = view.workCover?.cover;
  const sets = ((d.sets ?? []) as string[]).map((id) => view.refs[id]).filter((s): s is Entity => Boolean(s));
  const volumeIndex = openPart && outline.length > 1 ? outline.indexOf(openPart) + 1 : 0;
  const readTo = toc?.read.scanUrl ? null : toc?.read.unit ? href(toc.read.unit, lang) : null;
  // Its shaar, the README of a sefer (components/ShaarFile): what its title page says, and its sections under the contents.
  const shaar = shaarOf(d as WorkData);
  // An addition belongs under an official sefer, and its page leads back there; an official sefer lists its additions.
  const additionTo = typeof d.addition?.to === 'string' ? view.refs[d.addition.to] : undefined;
  const additions = view.lists.additions ?? [];

  const facts = [
    additionTo ? { icon: 'book' as const, children: <>{w(lang, 'additionTo')}{lang === 'he' ? '' : ' '}<Link to={href(itemPath(additionTo), lang)}>{nameOf((additionTo.data as D).title, lang)}</Link></> } : null,
    first ? { icon: 'cal' as const, children: <>{w(lang, 'firstPrinted')} <b>{[fd.publisher, firstYear].filter(Boolean).join(', ')}</b></> } : null,
    toc?.stats.pages ? { icon: 'file' as const, children: <><b>{num(toc.stats.pages, lang)}</b> {w(lang, 'pages')}</> } : null,
    ofPart.length ? { icon: 'layers' as const, children: <><b>{num(ofPart.length, lang)}</b> {w(lang, 'printings')}</> } : null,
    volumes ? { icon: 'book' as const, children: <><b>{num(outline.length, lang)}</b> {t(lang, 'volumes')} · <b>{num(total, lang)}</b> {t(lang, 'unitsShort')}</> } : null,
    toc?.stats.withAudio ? { icon: 'audio' as const, children: <><b>{num(toc.stats.withAudio, lang)}</b> {w(lang, 'withAudio')}</> } : null,
    toc && toc.stats.checked !== null ? { icon: 'check' as const, children: <>{w(lang, 'checked')}: <b>{toc.stats.checked}%</b></> } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  // A volume of a sefer of many opens as the design's volume page; its other tabs keep the full page.
  if (partLabel && part && tab === 'contents' && toc) return <VolumePage entity={entity} view={view} lang={lang} part={part} title={title} partLabel={partLabel} />;

  return (
    <ItemShell
      lang={lang}
      head={{
        crumbs: [
          ...libraryCrumbs(view, d, lang),
          ...(additionTo ? [{ label: nameOf((additionTo.data as D).title, lang), to: href(itemPath(additionTo), lang) }] : []),
          ...(partLabel ? [{ label: title, to: href(itemPath(entity), lang) }, { label: partLabel }] : [{ label: title }]),
        ],
        cover: (
          <Shaar
            kind={lang === 'he' ? 'ספר' : 'Sefer'}
            title={title}
            part={partLabel ?? undefined}
            subtitle={partLabel ? undefined : nameOf(shaar.subtitle, lang) || undefined}
            by={nameOf(shaar.byLine, lang) || authors.map((a) => nameOf((a.data as D).name, lang)).join(', ') || undefined}
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
            <EditActions target={{ id: entity.id, type: 'work', label: title, parent: sets[0]?.id ?? null }} lang={lang} editHref={href(`/edit/${entity.id}`, lang)} />
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
              const printings = publications.filter((pb) => (pb.data as D).volume && ofVolume((pb.data as D).volume, x)).length;
              return (
                <li key={x.value}>
                  <Link className="row hover" to={href(itemPath(entity), lang, { part: x.value })}>
                    <span className="vol-n num">{num(i + 1, lang)}</span>
                    <span className="row-main">
                      <span className="row-title torah">{x.label ? nameOf(x.label, lang) : `${w(lang, 'volumeRow')} ${x.value}`}</span>
                      <span className="row-sub">
                        {[x.units ? `${num(x.units, lang)} ${w(lang, 'sichos')}` : null, printings ? `${num(printings, lang)} ${w(lang, 'printings')}` : null].filter(Boolean).join(' · ')}
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
      {tab === 'contents' && !part && additions.length ? (
        <section className="stack" aria-label={w(lang, 'additions')}>
          <h2 className="h-sec">{w(lang, 'additions')}</h2>
          {Object.keys(ADDITION_KIND_NAMES)
            .map((kind) => [kind, additions.filter((x) => additionOf(x)?.kind === kind)] as const)
            .filter(([, list]) => list.length)
            .map(([kind, list]) => (
              <div key={kind}>
                <h3 className="h-side">{ADDITION_KIND_NAMES[kind]![lang]}</h3>
                <ItemList items={list} />
              </div>
            ))}
        </section>
      ) : null}
      {tab === 'contents' && !part && hasShaar(d as WorkData) ? <ShaarFile work={entity} lang={lang} /> : null}
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
