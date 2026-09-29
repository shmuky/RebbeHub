import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toHebrewNumeral } from '@rebbehub/hebrew';
import { allSegments, type PageInline, type PageSegment, type PageText, type PageVersion, type TextProfile } from '@rebbehub/model';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { Icon } from '../ui/Icon.js';
import { MachineNote } from '../ui/primitives.js';
import '../styles/pages/words.css';
import { SegmentEditor, SentNote, type SentSuggestion } from './SegmentEditor.js';

const WORDS = {
  he: { he: 'עברית', en: 'Hebrew' },
  en: { he: 'אנגלית', en: 'English' },
  yi: { he: 'יידיש', en: 'Yiddish' },
  both: { he: 'זה לצד זה', en: 'Side by side' },
  versions: { he: 'גרסאות', en: 'Versions' },
  notes: { he: 'הערות', en: 'Notes' },
  back: { he: 'חזרה למקום ההערה', en: 'Back to where the note is' },
  machine: { he: 'נכתב בידי מכונה ועדיין לא נבדק בידי אדם - הקטעים שלא נבדקו מסומנים.', en: 'Made by a machine and not yet checked by a person - the segments nobody has checked are marked.' },
  segmentLink: { he: 'קישור לקטע', en: 'Link to this segment' },
  fixHint: { he: 'לחיצה לתיקון', en: 'Click to fix' },
  right: { he: 'נכון', en: 'Right' },
  rightHint: { he: 'בדקתי מול הסריקה, והקטע נכון כמו שהוא', en: 'Checked against the scan: right as it is' },
  library: { he: 'ספריית ליובאוויטש', en: 'The Lubavitch Library' },
} as const;

const RTL = new Set(['he', 'yi', 'ar']);
const dirOf = (language: string) => (RTL.has(language) ? 'rtl' : 'ltr');
const MARK_TAGS = { b: 'b', i: 'i', u: 'u', small: 'small', sup: 'sup', sub: 'sub' } as const;

/** A segment's anchor in the page: `#s-3.14` links to it. */
export const segmentAnchor = (id: string) => `s-${id}`;

/** A number as the version counts it: Hebrew letters for Hebrew (`יד`), digits for any other. */
function numberIn(n: number, language: string): string {
  return RTL.has(language) && n > 0 && n < 10000 ? toHebrewNumeral(n).replace(/[׳״]/g, '') : String(n);
}

interface Context {
  lang: Lang;
  profile: TextProfile;
  version: PageVersion;
  /** A note's marker as the text shows it. */
  noteLabel: (id: string) => string;
  edit?: EditState;
  /** Side by side, the row carries the segment's anchor, not each version's copy of it. */
  rowAnchors?: boolean;
}

/** The words of one segment: runs in their marks, links, footnote marks, source markers, line breaks. Never HTML. */
function Runs({ runs, ctx }: { runs: readonly PageInline[] | undefined; ctx: Context }) {
  return (
    <>
      {(runs ?? []).map((run, i) => {
        if ('br' in run) return <br key={i} />;
        if ('marker' in run)
          return (
            <span key={i} className="words-marker">
              {run.marker}
            </span>
          );
        if ('note' in run)
          return (
            <sup key={i} className="words-note-ref" id={`r-${ctx.version.id}-${run.note}`}>
              <a href={`#n-${ctx.version.id}-${run.note}`}>{ctx.noteLabel(run.note)}</a>
            </sup>
          );
        let node: ReactNode = run.text;
        for (const mark of [...(run.marks ?? [])].reverse()) {
          const Tag = MARK_TAGS[mark];
          node = <Tag>{node}</Tag>;
        }
        if (run.href) {
          const target = run.href;
          if (/^https?:/.test(target))
            return (
              <a key={i} href={target} target="_blank" rel="noopener nofollow">
                {node}
              </a>
            );
          return (
            <Link key={i} to={href(target.startsWith('/') ? target : `/${target}`, ctx.lang)}>
              {node}
            </Link>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

// ---------------------------------------------------------------- editing in place

interface EditState {
  entityId: string;
  /** Checking a machine's words against their scan: each unchecked segment can be marked right as it is. */
  check?: boolean;
  /** A segment was opened or marked: the scan beside turns to its page. */
  onFocus?: (segmentId: string) => void;
  open: string | null;
  adding: string | null;
  sent: Record<string, SentSuggestion>;
  setOpen: (key: string | null) => void;
  setAdding: (key: string | null) => void;
  markSent: (key: string, sent: SentSuggestion) => void;
}

/**
 * A segment's words: as read, or, on the editing page, as a place to
 * click and fix them in place. Each fix goes for review on its own.
 */
function Words({ segment, ctx }: { segment: PageSegment; ctx: Context }) {
  const edit = ctx.edit;
  if (!edit) return <Runs runs={segment.text} ctx={ctx} />;
  const key = `${ctx.version.id}/${segment.id}`;
  const sent = edit.sent[key];
  const editor =
    edit.open === key ? (
      <SegmentEditor
        entityId={edit.entityId}
        version={ctx.version.id}
        segment={segment}
        mode="edit"
        lang={ctx.lang}
        labelOf={ctx.noteLabel}
        onClose={() => edit.setOpen(null)}
        onSent={(s) => edit.markSent(key, s)}
        onAddAfter={segment.kind === 'section' || segment.kind === 'note' ? undefined : () => edit.setAdding(key)}
      />
    ) : (
      <span
        className="words-editable"
        role="button"
        tabIndex={0}
        title={WORDS.fixHint[ctx.lang]}
        onClick={(e) => {
          // A link in the words still goes where it points; while checking, it stays on this page.
          if ((e.target as HTMLElement).closest('a')) {
            if (!edit.check) return;
            e.preventDefault();
          }
          edit.setOpen(key);
          edit.onFocus?.(segment.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            edit.setOpen(key);
            edit.onFocus?.(segment.id);
          }
        }}
      >
        <Runs runs={segment.text} ctx={ctx} />
      </span>
    );
  const right = edit.check && !sent && edit.open !== key && unchecked(segment) ? <RightButton segment={segment} ctx={ctx} onSent={(s) => edit.markSent(key, s)} /> : null;
  return (
    <>
      {editor}
      {right}
      {sent ? <SentNote sent={sent} lang={ctx.lang} /> : null}
      {edit.adding === key ? (
        <SegmentEditor
          entityId={edit.entityId}
          version={ctx.version.id}
          segment={segment}
          mode="add"
          lang={ctx.lang}
          onClose={() => edit.setAdding(null)}
          onSent={(s) => {
            edit.setAdding(null);
            edit.markSent(key, s);
          }}
        />
      ) : null}
    </>
  );
}

/** "Right": a machine's segment read against its scan and found right, sent as a check that keeps its words. */
function RightButton({ segment, ctx, onSent }: { segment: PageSegment; ctx: Context; onSent: (sent: SentSuggestion) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = ctx.edit!;
  const send = async () => {
    setBusy(true);
    setError(null);
    edit.onFocus?.(segment.id);
    try {
      const response = await fetch('/_/suggestions/words', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ entityId: edit.entityId, change: 'check', version: ctx.version.id, segment: segment.id, before: segment.text ?? [], title: WORDS.rightHint[ctx.lang] }),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: number; status?: string; message?: string };
      if (!response.ok) throw new Error(json.message ?? response.statusText);
      onSent({ id: json.id!, status: json.status ?? 'open' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="btn sm words-right" onClick={() => void send()} disabled={busy} aria-busy={busy || undefined} title={WORDS.rightHint[ctx.lang]}>
        <Icon name="check" size={14} />
        {WORDS.right[ctx.lang]}
      </button>
      {error ? (
        <span className="words-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- one version

const unchecked = (segment: PageSegment) => Boolean(segment.origin && !segment.origin.checked);

/** The segments of a list in reading order, outline items and list items gathered into lists. */
function Segments({ list, depth, ctx }: { list: readonly PageSegment[]; depth: number; ctx: Context }) {
  const out: ReactNode[] = [];
  let items: PageSegment[] = [];
  const flushItems = () => {
    if (!items.length) return;
    const numbered = items.some((s) => s.n !== undefined);
    const Tag = numbered ? 'ol' : 'ul';
    out.push(
      <Tag key={`list-${items[0]!.id}`} className={ctx.profile === 'outline' ? 'words-outline' : 'words-list'}>
        {items.map((s) => (
          <li key={s.id} id={segmentAnchor(s.id)} value={s.n} className={unchecked(s) ? 'machine' : undefined}>
            <Words segment={s} ctx={ctx} />
          </li>
        ))}
      </Tag>,
    );
    items = [];
  };
  for (const segment of list) {
    if (segment.kind === 'item') {
      items.push(segment);
      continue;
    }
    flushItems();
    out.push(<Segment key={segment.id} segment={segment} depth={depth} ctx={ctx} />);
  }
  flushItems();
  return <>{out}</>;
}

function Heading({ level, children, id, className }: { level: number; children: ReactNode; id?: string; className?: string }) {
  const Tag = level <= 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

function Segment({ segment, depth, ctx }: { segment: PageSegment; depth: number; ctx: Context }) {
  const anchor = segmentAnchor(segment.id);
  const id = ctx.rowAnchors ? undefined : anchor;
  const machine = unchecked(segment) ? ' machine' : '';
  switch (segment.kind) {
    case 'section':
      return (
        <section className="words-section">
          {segment.text?.length ? (
            <Heading level={depth + 2} id={id} className="words-heading">
              <Words segment={segment} ctx={ctx} />
            </Heading>
          ) : null}
          <Segments list={segment.children ?? []} depth={depth + 1} ctx={ctx} />
        </section>
      );
    case 'heading':
      return (
        <Heading level={(segment.level ?? 1) + 1} id={id} className="words-heading">
          <Words segment={segment} ctx={ctx} />
        </Heading>
      );
    case 'verse':
      return (
        <p id={id} className={`words-verse${machine}`}>
          {segment.n !== undefined ? (
            <a className="words-n" href={`#${anchor}`} aria-label={WORDS.segmentLink[ctx.lang]}>
              {numberIn(segment.n, ctx.version.language)}
            </a>
          ) : null}
          <Words segment={segment} ctx={ctx} />
        </p>
      );
    case 'note':
      return null; // drawn with the notes
    default:
      return (
        <p id={id} className={`words-p${segment.end ? ' end' : ''}${machine}`}>
          {/* The paragraph's number in the margin: its own when it has one, else counted in order (words.css). */}
          <a className="words-anchor" href={`#${anchor}`} aria-label={WORDS.segmentLink[ctx.lang]}>
            {segment.n !== undefined ? numberIn(segment.n, ctx.version.language) : null}
          </a>
          <Words segment={segment} ctx={ctx} />
        </p>
      );
  }
}

function Notes({ ctx }: { ctx: Context }) {
  const notes = ctx.version.notes ?? [];
  if (!notes.length) return null;
  return (
    <aside className="words-notes" aria-label={WORDS.notes[ctx.lang]}>
      <ol>
        {notes.map((note) => (
          <li key={note.id} id={`n-${ctx.version.id}-${note.id}`}>
            <a className="words-note-back" href={`#r-${ctx.version.id}-${note.id}`} aria-label={WORDS.back[ctx.lang]}>
              {ctx.noteLabel(note.id)}
            </a>{' '}
            <Words segment={note} ctx={ctx} />
          </li>
        ))}
      </ol>
    </aside>
  );
}

function noteLabels(version: PageVersion): (id: string) => string {
  const labels = new Map((version.notes ?? []).map((n, i) => [n.id, n.label ?? (n.n !== undefined ? numberIn(n.n, version.language) : String(i + 1))]));
  return (id) => labels.get(id) ?? '*';
}

/**
 * The credit line of a version: its edition, its licence and where it is
 * read at its source (Sefaria asks for it on every page that uses its
 * texts). The Chabad Library's texts are shown on the condition of its
 * credit: the library's name in the reader's language, linking back to
 * the page there (docs/rights.md).
 */
function Credit({ version, profile, lang }: { version: PageVersion; profile?: TextProfile; lang?: Lang }) {
  if (profile === 'chabad-library' && lang) {
    return (
      <p className="words-credit row-sub" lang={lang} dir={dirOf(lang)}>
        {version.url ? (
          <a href={version.url} target="_blank" rel="noopener">
            {`${WORDS.library[lang]} · chabadlibrary.org`}
          </a>
        ) : (
          WORDS.library[lang]
        )}
      </p>
    );
  }
  const parts = [version.credit ?? version.title, version.licence ? (LICENCES[version.licence] ?? version.licence) : undefined].filter(Boolean);
  let site: string | null = null;
  try {
    site = version.url ? new URL(version.url).hostname.replace(/^www\./, '') : null;
  } catch {
    site = null;
  }
  if (!parts.length && !site) return null;
  return (
    <p className="words-credit row-sub" lang={version.language} dir={dirOf(version.language)}>
      {parts.join(' · ')}
      {site ? (
        <>
          {parts.length ? ' · ' : ''}
          <a href={version.url} target="_blank" rel="noopener">
            {site}
          </a>
        </>
      ) : null}
    </p>
  );
}

const LICENCES: Record<string, string> = { 'cc-by-nc': 'CC BY-NC', 'cc-by': 'CC BY', cc0: 'CC0', 'public-domain': 'Public domain' };

function VersionView({ version, profile, lang, edit }: { version: PageVersion; profile: TextProfile; lang: Lang; edit?: EditState }) {
  const ctx: Context = { lang, profile, version, noteLabel: noteLabels(version), edit };
  return (
    <div className={`words words-${profile}${version.origin && !version.origin.checked ? ' machine' : ''}`} lang={version.language} dir={dirOf(version.language)}>
      <Segments list={version.segments} depth={0} ctx={ctx} />
      <Notes ctx={ctx} />
      {profile === 'sefaria' || profile === 'sichos-kodesh' || profile === 'chabad-library' ? <Credit version={version} profile={profile} lang={lang} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- two versions side by side

/**
 * Sefaria's rule: the Hebrew and the English side by side, segment by
 * segment. Segments pair by their id (`3.14` is the same place in both);
 * any the second version has that the first lacks follow at the end.
 */
function SideBySide({ first, second, lang, edit }: { first: PageVersion; second: PageVersion; lang: Lang; edit?: EditState }) {
  const a: Context = { lang, profile: 'sefaria', version: first, noteLabel: noteLabels(first), edit, rowAnchors: true };
  const b: Context = { lang, profile: 'sefaria', version: second, noteLabel: noteLabels(second), edit, rowAnchors: true };
  const others = new Map<string, PageSegment>();
  for (const s of allSegments(second.segments)) others.set(s.id, s);
  const shown = new Set<string>();

  const cell = (segment: PageSegment | undefined, ctx: Context, depth: number) => (
    <div className="words-cell" lang={ctx.version.language} dir={dirOf(ctx.version.language)}>
      {segment ? segment.kind === 'section' ? segment.text?.length ? <Heading level={depth + 2} className="words-heading"><Words segment={segment} ctx={ctx} /></Heading> : null : <Segment segment={segment} depth={depth} ctx={ctx} /> : null}
    </div>
  );
  const rows = (list: readonly PageSegment[], depth: number): ReactNode[] =>
    list.flatMap((segment) => {
      const other = others.get(segment.id);
      if (other) shown.add(segment.id);
      const row = (
        <div key={segment.id} id={segmentAnchor(segment.id)} className={`words-row${segment.kind === 'section' ? ' words-row-heading' : ''}`}>
          {cell(segment, a, depth)}
          {cell(other, b, depth)}
        </div>
      );
      return segment.kind === 'section' ? [row, ...rows(segment.children ?? [], depth + 1)] : [row];
    });
  const main = rows(first.segments, 0);
  const rest = [...allSegments(second.segments)].filter((s) => s.kind !== 'section' && !shown.has(s.id));
  return (
    <div className="words words-sefaria words-pair">
      {main}
      {rest.map((segment) => (
        <div key={`rest-${segment.id}`} className="words-row">
          {cell(undefined, a, 0)}
          {cell(segment, b, 0)}
        </div>
      ))}
      <div className="words-row">
        <div className="words-cell" lang={first.language} dir={dirOf(first.language)}>
          <Notes ctx={a} />
          <Credit version={first} />
        </div>
        <div className="words-cell" lang={second.language} dir={dirOf(second.language)}>
          <Notes ctx={b} />
          <Credit version={second} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

const versionName = (v: PageVersion, lang: Lang) => (v.language === 'he' || v.language === 'en' || v.language === 'yi' ? WORDS[v.language][lang] : (v.title ?? v.id));

/**
 * A page's words, drawn by the display rules of where they came from
 * (their profile):
 *
 * - sefaria: sections under their titles, numbered segments (in Hebrew
 *   letters in the Hebrew), footnotes, the Hebrew and English side by
 *   side or one at a time, each version's credit and licence;
 * - sichos-kodesh: paragraphs and headings as Sichos-Kodesh's app sets
 *   them, a letter's lines at the end side, versions one at a time;
 * - chabad-library: chabadlibrary.org's texts, paragraphs and headings
 *   like sichos-kodesh, its footnotes and haoros as notes, the printed
 *   edition's old page numbers as markers, and the library's credit line
 *   linking back to the page there;
 * - outline: a farbrengen's contents, numbered items under titles;
 * - plain: what people wrote here.
 *
 * Every segment has an anchor (`#s-3.14`) a link can point at. With
 * `edit`, each segment can be clicked and fixed in place (the Edit tab).
 */
export function PageWords({ page, lang, edit }: { page: PageText; lang: Lang; edit?: { entityId: string; check?: boolean; onFocus?: (segmentId: string) => void } }) {
  const versions = page.versions.filter((v) => v.segments.length);
  const pairable = page.profile === 'sefaria' && versions.length > 1;
  const [shown, setShown] = useState<string>(pairable ? 'both' : (versions[0]?.id ?? ''));
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, SentSuggestion>>({});
  if (!versions.length) return null;
  const editState: EditState | undefined = edit
    ? {
        entityId: edit.entityId,
        check: edit.check,
        onFocus: edit.onFocus,
        open,
        adding,
        sent,
        setOpen: (key) => {
          setAdding(null);
          setOpen(key);
        },
        setAdding: (key) => {
          setOpen(null);
          setAdding(key);
        },
        markSent: (key, s) => {
          setOpen(null);
          setSent((was) => ({ ...was, [key]: s }));
        },
      }
    : undefined;
  const machine = versions.some((v) => (v.origin && !v.origin.checked) || [...allSegments(v.segments)].some(unchecked));
  const current = versions.find((v) => v.id === shown) ?? versions[0]!;
  return (
    <div className="page-words">
      {versions.length > 1 ? (
        <div className="segmented words-versions" role="group" aria-label={WORDS.versions[lang]}>
          {versions.map((v) => (
            <button key={v.id} type="button" aria-pressed={shown === v.id} onClick={() => setShown(v.id)} lang={v.language}>
              {versionName(v, lang)}
            </button>
          ))}
          {pairable ? (
            <button type="button" aria-pressed={shown === 'both'} onClick={() => setShown('both')}>
              {WORDS.both[lang]}
            </button>
          ) : null}
        </div>
      ) : null}
      {machine ? <MachineNote>{WORDS.machine[lang]}</MachineNote> : null}
      {pairable && shown === 'both' ? (
        <SideBySide first={versions[0]!} second={versions[1]!} lang={lang} edit={editState} />
      ) : (
        <VersionView version={current} profile={page.profile} lang={lang} edit={editState} />
      )}
    </div>
  );
}
