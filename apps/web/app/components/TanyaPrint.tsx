import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { PageInline, PageSegment, PageVersion } from '@rebbehub/model';
import type { Lang } from '../lib/i18n.js';
import { segmentAnchor } from './PageWords.js';
import '../styles/pages/tanya.css';

/**
 * Tanya as the book prints it (the Kehot editions since תשט״ז): the title
 * page centered in its sizes, each approbation under its heading with the
 * signature at the end side, the compiler's foreword under its title, and
 * each chapter one justified block that opens with "פרק א" and its first
 * word in large bold type, running on where the book runs on. A new
 * paragraph starts only where the book starts one, at a bold opening
 * word. The words are printed without nikud, as in the book; a button
 * puts it back. The daily-learning marks ([מ: …] [פ: …]) stay, small, since
 * the day's portion starts at them.
 */

const W = {
  nikud: { he: 'ניקוד', en: 'Nikud' },
  nikudHint: { he: 'הספר נדפס בלי ניקוד', en: 'The book is printed without nikud' },
} as const;

const NIKUD_KEY = 'rebbehub:tanya-nikud';
/** The vowels and cantillation, not the maqaf or the sof pasuq. */
const NIKUD = /[֑-ׇֽֿׁׂׅׄ]/g;
/** A daily-learning mark written into the words: `[מ: יט כסלו]`. */
const MARK = /\[(?:מ|פ): [^\]]+\]\s*/g;

/** A segment's runs with its daily-learning marks taken out, and the marks. */
function split(runs: readonly PageInline[] | undefined): { marks: string[]; runs: PageInline[] } {
  const marks: string[] = [];
  const out: PageInline[] = [];
  for (const run of runs ?? []) {
    if ('marker' in run) {
      marks.push(run.marker);
      continue;
    }
    if ('text' in run && typeof run.text === 'string') {
      const text = run.text.replace(MARK, (m) => {
        marks.push(m.trim());
        return '';
      });
      // A run that was only marks, or the space after them, before the words start.
      if (!text.trim() && !out.some((r) => 'text' in r && r.text.trim())) continue;
      out.push({ ...run, text: out.length ? text : text.trimStart() });
      continue;
    }
    out.push(run);
  }
  return { marks, runs: out };
}

const textOf = (runs: readonly PageInline[]) => runs.map((r) => ('text' in r && typeof r.text === 'string' ? r.text : '')).join('');
const marked = (run: PageInline, mark: 'b' | 'small') => 'text' in run && (run.marks ?? []).includes(mark as never);
/** Runs that are all in one mark, but for spaces and punctuation between them. */
const allIn = (runs: readonly PageInline[], ...marks: Array<'b' | 'small'>) =>
  runs.some((r) => 'text' in r && r.text.trim()) && runs.every((r) => 'br' in r || !('text' in r) || !/[\p{L}]/u.test(r.text) || marks.some((m) => marked(r, m)));
const opensBold = (runs: readonly PageInline[]) => {
  const first = runs.find((r) => !('text' in r) || r.text.trim());
  return Boolean(first && marked(first, 'b'));
};

type Block =
  | { kind: 'shaar'; segment: PageSegment; marks: string[]; runs: PageInline[]; first: boolean }
  | { kind: 'head' | 'small' | 'sign'; segment: PageSegment; marks: string[]; runs: PageInline[] }
  | { kind: 'para'; parts: Array<{ segment: PageSegment; marks: string[]; runs: PageInline[] }> };

/** Where the unit stands in the book, from its path: `/tanya/1/4` is Likkutei Amarim's chapter 1. */
function placeOf(path: string | null, label: string) {
  const at = (path ?? '').split('/').slice(2);
  const part = at[0] ?? '';
  const tail = label.split(', ').pop() ?? '';
  const number = tail.replace(/^פרק /, '').replace(/[׳״]/g, '');
  return {
    part,
    /** The title page, or Chinuch Katan's (Shaar HaYichud's own title page, its first three segments). */
    shaar: (id: string) => (part === '1' && at[1] === '1') || (part === '2' && at[1] === '1' && ['1', '2', '3'].includes(id)),
    haskama: part === '1' && at[1] === '2',
    foreword: part === '1' && at[1] === '3',
    /** Over the first chapter of Iggeres HaTeshuva and of Iggeres HaKodesh, the name of the part. */
    partTitle: (part === '3' || part === '4') && at[1] === '1' ? (label.split('; ').pop() ?? '').split(', ')[0]! : null,
    /** Chapters run their "פרק א" into the first line; the letters of Iggeres HaKodesh are numbered over them; Kuntres Acharon has neither. */
    perek: tail.startsWith('פרק ') && (part === '1' ? Number(at[1]) > 3 : part === '2' ? Number(at[1]) > 1 : part === '3') ? `פרק ${number}` : null,
    letter: part === '4' && tail.startsWith('פרק ') ? number : null,
  };
}

function blocksOf(segments: readonly PageSegment[], place: ReturnType<typeof placeOf>): Block[] {
  const blocks: Block[] = [];
  let para: Extract<Block, { kind: 'para' }> | null = null;
  let body = false;
  segments.forEach((segment, i) => {
    const { marks, runs } = split(segment.text);
    if (place.shaar(segment.id)) {
      blocks.push({ kind: 'shaar', segment, marks, runs, first: !blocks.length });
      para = null;
      return;
    }
    // An approbation's heading lines before its words; a line with a break in it, all bold (Kuntres Acharon's title).
    // and the line naming who gave it ("הרב החסיד … מאניפאלי:"), its own block in the book.
    const headline = (place.haskama && !body && (allIn(runs, 'b', 'small') || i === 1)) || (allIn(runs, 'b', 'small') && runs.some((r) => 'br' in r));
    if (headline) {
      blocks.push({ kind: 'head', segment, marks, runs });
      para = null;
      return;
    }
    if (allIn(runs, 'small')) {
      blocks.push({ kind: 'small', segment, marks, runs });
      para = null;
      return;
    }
    // An approbation's signature: its short last line.
    if (place.haskama && i === segments.length - 1 && textOf(runs).length < 60) {
      blocks.push({ kind: 'sign', segment, marks, runs });
      para = null;
      return;
    }
    body = true;
    if (!para || opensBold(runs)) {
      para = { kind: 'para', parts: [] };
      blocks.push(para);
    }
    para.parts.push({ segment, marks, runs });
  });
  return blocks;
}

/** The words of a run list: bold, small, line breaks; the opening bold words of a paragraph in large type. */
function Runs({ runs, open, nikud }: { runs: readonly PageInline[]; open?: boolean; nikud: boolean }) {
  const shown = (s: string) => (nikud ? s : s.replace(NIKUD, ''));
  let opened = !open;
  return (
    <>
      {runs.map((run, i) => {
        if ('br' in run) return <br key={i} />;
        if (!('text' in run) || typeof run.text !== 'string') return null;
        const text = shown(run.text);
        const marks = run.marks ?? [];
        let node: ReactNode = text;
        if (!opened && marks.includes('b' as never)) {
          opened = true;
          // A long bold opening: its first word large, the rest bold as the book sets it.
          const words = text.trim().split(/\s+/);
          node =
            words.length <= 3 ? (
              <b className="tp-open">{text}</b>
            ) : (
              <>
                <b className="tp-open">{text.slice(0, text.indexOf(words[1]!))}</b>
                <b>{text.slice(text.indexOf(words[1]!))}</b>
              </>
            );
        } else {
          if (marks.includes('b' as never)) node = <b>{node}</b>;
          if (marks.includes('small' as never)) node = <small>{node}</small>;
        }
        opened = true;
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

/** The words' first paragraph with no bold word of its own (an approbation's "הנה", Chinuch Katan's "חנוך"): its first word large all the same. */
function withOpening(runs: readonly PageInline[]): PageInline[] {
  if (opensBold(runs)) return [...runs];
  const i = runs.findIndex((r) => 'text' in r && r.text.trim());
  const run = runs[i];
  if (!run || !('text' in run)) return [...runs];
  const [, word = '', rest = ''] = /^(\s*\S+)([\s\S]*)$/.exec(run.text) ?? [];
  return [...runs.slice(0, i), { ...run, text: word, marks: [...(run.marks ?? []), 'b'] as typeof run.marks }, { ...run, text: rest }, ...runs.slice(i + 1)];
}

const Marks = ({ marks }: { marks: string[] }) =>
  marks.length ? (
    <span className="tp-mark">
      {marks.join(' ')}
    </span>
  ) : null;

export function TanyaPrint({ version, path, label, lang }: { version: PageVersion; path: string | null; label: string; lang: Lang }) {
  const [nikud, setNikud] = useState(false);
  useEffect(() => {
    try {
      setNikud(localStorage.getItem(NIKUD_KEY) === '1');
    } catch {
      // No storage: the book's way, without nikud.
    }
  }, []);
  const toggle = () => {
    setNikud(!nikud);
    try {
      localStorage.setItem(NIKUD_KEY, nikud ? '0' : '1');
    } catch {
      // Private windows: the choice lasts this page only.
    }
  };
  const place = placeOf(path, label);
  const segments = version.segments;
  const blocks = blocksOf(segments, place);
  const starts = segments[0]?.id === '1';
  let perekShown = false;
  const firstBody = starts ? blocks.find((b) => b.kind === 'para') : undefined;

  return (
    <div className={`tanya-print${place.shaar(segments[0]?.id ?? '') ? ' tp-shaar-page' : ''}`} lang="he" dir="rtl">
      <div className="tp-tools" lang={lang} dir={lang === 'he' ? 'rtl' : 'ltr'}>
        <button type="button" className="btn sm" aria-pressed={nikud} onClick={toggle} title={W.nikudHint[lang]}>
          {W.nikud[lang]}
        </button>
      </div>
      {starts && place.partTitle ? <h2 className="tp-title">{place.partTitle}</h2> : null}
      {starts && place.foreword ? <h2 className="tp-title">הקדמת המלקט</h2> : null}
      {starts && place.letter ? <h2 className="tp-letter">{place.letter}</h2> : null}
      {blocks.map((block, bi) => {
        if (block.kind === 'para') {
          const perek = starts && place.perek && !perekShown && block.parts[0]?.segment.id === '1';
          if (perek) perekShown = true;
          return (
            <p key={bi} className={`tp-p${place.foreword && block.parts[0]?.segment.id === '1' ? ' tp-sub' : ''}`}>
              {perek ? <b className="tp-perek">{place.perek}</b> : null}
              {block.parts.map(({ segment, marks, runs }, pi) => (
                <span key={segment.id} id={segmentAnchor(segment.id)} className="tp-seg">
                  {pi ? ' ' : null}
                  <Marks marks={marks} />
                  <Runs runs={pi === 0 && block === firstBody ? withOpening(runs) : runs} open={pi === 0 && !(place.foreword && segment.id === '1')} nikud={nikud} />
                </span>
              ))}
            </p>
          );
        }
        const cls = block.kind === 'shaar' ? `tp-shaar${block.first ? ' tp-shaar-first' : ''}${textOf(block.runs).length > 90 ? ' tp-shaar-long' : ''}` : `tp-${block.kind}`;
        return (
          <p key={bi} id={segmentAnchor(block.segment.id)} className={cls}>
            <Marks marks={block.marks} />
            <Runs runs={block.runs} nikud={nikud} />
          </p>
        );
      })}
    </div>
  );
}

const PRINTED = { he: 'כבדפוס', en: 'As printed' };

/** For a unit of Tanya, PageWords' "as printed" setting of its Hebrew; for anything else, nothing. */
export function tanyaPrinted(unit: { path: string | null; data: unknown }, lang: Lang) {
  if (!unit.path?.startsWith('/tanya/')) return undefined;
  const label = (unit.data as { label?: { he?: string } }).label?.he ?? '';
  return { label: PRINTED, render: (version: PageVersion) => <TanyaPrint version={version} path={unit.path} label={label} lang={lang} /> };
}
