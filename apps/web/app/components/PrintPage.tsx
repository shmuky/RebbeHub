import { useLayoutEffect, useRef } from 'react';
import type { PageInline } from '@rebbehub/model';
import type { PrintLine, PrintPage as Page } from '../lib/printLines.js';

/**
 * One page of a sicha set as the print sets it (lib/printLines.ts): each
 * printed line at its own place on the page, in the print's faces (Frank,
 * Miram as bold, the ois letter), stretched to the column's width as the
 * printer justified it, the paragraph's last line left flush. The page
 * keeps the scan's shape, so it can stand beside the scan page for page.
 * Its running head is the sefer and the sicha, with the page number on
 * the page's outer side, as printed.
 */

/** A Likkutei Sichos page as the reader straightened it, width over height (1744 × 2689). */
const ASPECT = 1744 / 2689;

/** The part of the page that is drawn: the print's own block (head, columns, notes) with an even margin, the same for every page of a sicha. */
export type Frame = { x0: number; x1: number; y0: number; y1: number };

export function frameOf(pages: Page[]): Frame {
  const lines = pages.flatMap((p) => p.lines);
  const size = pages[0]?.bodySize ?? 0.0115;
  const m = 0.09;
  return {
    x0: Math.max(0, Math.min(...lines.map((l) => l.box[0])) - m),
    x1: Math.min(1, Math.max(...lines.map((l) => l.box[0] + l.box[2])) + m),
    y0: Math.max(0, Math.min(...lines.map((l) => l.box[1])) - size * 3.2 - m * ASPECT),
    y1: Math.min(1, Math.max(...lines.map((l) => l.box[1] + l.box[3])) + m * ASPECT),
  };
}

export function PrintPage({ page, frame, head, title, labels }: { page: Page; frame: Frame; head: string; title: string; labels: Record<string, string> }) {
  const sheet = useRef<HTMLDivElement>(null);

  // Justify each full line to its box, as the printer did: the space left over goes between the words; a line too long is narrowed to fit.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const fit = () => {
      for (const line of el.querySelectorAll<HTMLElement>('.pr-line')) {
        const inner = line.firstElementChild as HTMLElement | null;
        if (!inner) continue;
        inner.style.wordSpacing = '';
        inner.style.transform = '';
        const room = line.clientWidth;
        const natural = inner.scrollWidth;
        if (!room || !natural) continue;
        if (natural > room) {
          inner.style.transform = `scaleX(${room / natural})`;
          continue;
        }
        if (line.dataset.flush) continue;
        const gaps = (inner.textContent?.trim().match(/\s+/g) ?? []).length;
        if (gaps) inner.style.wordSpacing = `${(room - natural) / gaps}px`;
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    void document.fonts?.ready.then(fit);
    return () => watch.disconnect();
  }, [page]);

  const body = page.lines.filter((l) => l.kind !== 'note');
  const columns = page.lines.filter((l) => l.kind === 'body' || l.kind === 'note');
  const left = Math.min(...page.lines.map((l) => l.box[0]));
  const right = Math.max(...page.lines.map((l) => l.box[0] + l.box[2]));
  const top = Math.min(...page.lines.map((l) => l.box[1]));
  const mid = (left + right) / 2;
  // Each word of the running head stands over the middle of its column, as printed.
  const centreOf = (side: 'right' | 'left') => {
    const ls = columns.filter((l) => (l.box[0] + l.box[2] / 2 >= mid) === (side === 'right'));
    return ls.length ? (Math.min(...ls.map((l) => l.box[0])) + Math.max(...ls.map((l) => l.box[0] + l.box[2]))) / 2 : side === 'right' ? (mid + right) / 2 : (left + mid) / 2;
  };
  const n = page.printed && /^\d+$/.test(page.printed) ? Number(page.printed) : null;
  const opens = body.some((l) => l.kind === 'heading');
  const words = head.split(' ');
  const y = top - page.bodySize * 3.2;
  const span = 0.2;
  const headItems: Array<{ text: string; x: number; align: 'start' | 'end' | 'center' }> = [
    { text: words[0] ?? head, x: centreOf('right') - span / 2, align: 'center' as const },
    { text: words.slice(1).join(' '), x: centreOf('left') - span / 2, align: 'center' as const },
    ...(opens ? [] : [{ text: title, x: mid - span / 2, align: 'center' as const }]),
    // The number stands on the page's outer side: the right of an even page, the left of an odd one.
    ...(page.printed ? [n !== null && n % 2 === 1 ? { text: page.printed, x: left, align: 'end' as const } : { text: page.printed, x: right - span, align: 'start' as const }] : []),
  ].filter((x) => x.text);

  return (
    <div className="pr-page" ref={sheet} style={{ aspectRatio: String(((frame.x1 - frame.x0) * ASPECT) / (frame.y1 - frame.y0)) }} dir="rtl" lang="he">
      {headItems.map((h, i) => (
        <div key={`h${i}`} className={`pr-head pr-head-${h.align}`} style={box(frame, [h.x, y, span, page.bodySize], page.bodySize * 0.9)}>
          <span>{h.text}</span>
        </div>
      ))}
      {rulesOf(page).map((rule, i) => (
        <div key={`r${i}`} className="pr-rule" style={box(frame, rule, 0)} />
      ))}
      {page.lines.map((line, i) => (
        <Line key={i} line={line} labels={labels} frame={frame} size={line.kind === 'note' ? page.noteSize : line.kind === 'heading' ? line.box[3] * 1.05 : page.bodySize} />
      ))}
    </div>
  );
}

/** A box on the page as CSS, within the drawn frame and in the page's own width units, so the page scales as one. */
function box(f: Frame, b: [number, number, number, number], size: number): React.CSSProperties {
  const w = f.x1 - f.x0;
  const h = f.y1 - f.y0;
  return {
    left: `${((b[0] - f.x0) / w) * 100}%`,
    top: `${((b[1] - f.y0) / h) * 100}%`,
    width: `${(b[2] / w) * 100}%`,
    height: `${(b[3] / h) * 100}%`,
    // The line's height on the scan is the height of its letters; the type is set larger, as Hebrew letters stand within their size.
    ...(size ? { fontSize: `${(size / ASPECT / w) * 100 * 1.4}cqw` } : {}),
  };
}

/** The short rule the print sets above the footnotes, at the start (right) side of each column that has them. */
function rulesOf(page: Page): Array<[number, number, number, number]> {
  const rules: Array<[number, number, number, number]> = [];
  for (const side of [0, 1]) {
    const inColumn = (l: PrintLine) => (l.kind === 'body' || l.kind === 'note') && (l.box[0] + l.box[2] / 2 >= 0.5 ? 0 : 1) === side;
    const notes = page.lines.filter((l) => l.kind === 'note' && inColumn(l));
    if (!notes.length) continue;
    const first = Math.min(...notes.map((l) => l.box[1]));
    const above = page.lines.filter((l) => l.kind !== 'note' && inColumn(l) && l.box[1] < first).map((l) => l.box[1] + l.box[3]);
    const columnRight = Math.max(...page.lines.filter(inColumn).map((l) => l.box[0] + l.box[2]));
    const columnLeft = Math.min(...page.lines.filter(inColumn).map((l) => l.box[0]));
    const y = above.length ? (Math.max(...above) + first) / 2 : first - page.noteSize * 1.2;
    const width = (columnRight - columnLeft) * 0.3;
    rules.push([columnRight - width, y, width, 0.0012]);
  }
  return rules;
}

function Line({ line, size, labels, frame }: { line: PrintLine; size: number; labels: Record<string, string>; frame: Frame }) {
  const flush = line.last || line.kind === 'heading' || line.kind === 'end';
  return (
    <div className={`pr-line pr-${line.kind}`} style={box(frame, line.box, size)} data-flush={flush || undefined}>
      <span>
        {line.label ? <span className="pr-label">{line.label.startsWith('*') ? line.label : `${line.label})`}&nbsp;</span> : null}
        {line.runs.map((run, i) => (
          <Run key={i} run={run} at={i} count={line.runs.length} labels={labels} />
        ))}
        {line.split ? '־' : null}
      </span>
    </div>
  );
}

function Run({ run, at, count, labels }: { run: PageInline; at: number; count: number; labels: Record<string, string> }) {
  if ('note' in run) {
    const label = labels[run.note] ?? run.note.replace(/^n/, '');
    return <sup className="pr-ref">{label}</sup>;
  }
  if (!('text' in run)) return null;
  // A line's own edges carry no space: the print's line starts and ends at its margin.
  let text = run.text;
  if (at === 0) text = text.replace(/^\s+/, '');
  if (at === count - 1) text = text.replace(/\s+$/, '');
  const marks = run.marks ?? [];
  if (marks.includes('ois')) return <span className="pr-ois">{text}</span>;
  if (marks.includes('b')) return <b className="pr-miram">{text}</b>;
  if (marks.includes('small')) return <span className="pr-small">{text}</span>;
  return <>{text}</>;
}
