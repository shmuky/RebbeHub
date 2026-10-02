import { useState } from 'react';
import type { Lang } from '../lib/i18n.js';
import { MODEL_FAMILIES } from '../lib/models.js';

/**
 * The models' scores as figures, for the showcase: a few numbers that
 * matter, then each model against where it started, on material it never
 * learned from. Every number comes from lib/models.ts (the /models page),
 * so the figures and the tables never disagree.
 */

type L = { he: string; en: string };
type Cell = string | L;

const W = {
  title: { he: 'מדדים', en: 'Benchmarks' },
  sub: {
    he: 'כל מספר נמדד על חומר שהמודל לא למד ממנו. נמוך יותר טוב יותר בשני התרשימים.',
    en: 'Every number is measured on material the model never learned from. Lower is better in both charts.',
  },
  letters: { he: 'אותיות שנקראו נכון', en: 'Letters read right' },
  lines: { he: 'שורות בלי טעות אחת', en: 'Lines without a single mistake' },
  miram: { he: 'מילות מירם שזוהו נכון', en: 'Miram words found right' },
  wer: { he: 'מילים שגויות בתמלול', en: 'Words wrong in a transcript' },
  ocrTest: { he: '4,500 שורות מלקוטי שיחות חלק לט', en: '4,500 lines of Likkutei Sichos vol. 39' },
  whisperTest: { he: 'י״ז תמוז תשמ״ב, כל 29 הדקות', en: '17 Tammuz 5742, the whole 29 minutes' },
  ocrChart: { he: 'מילים שנקראו לא נכון, מתוך 100', en: 'Words read wrong, per 100' },
  ocrChartSub: { he: 'קורא לקוטי שיחות, מול מנוע OCR מוכן', en: 'The Likkutei Sichos reader, against an off-the-shelf OCR engine' },
  whisperChart: { he: 'מילים שגויות, מתוך 100', en: 'Words wrong, per 100' },
  whisperChartSub: { he: 'קול הרבי לטקסט, גרסה אחר גרסה', en: "The Rebbe's voice to text, version by version" },
  fewer: { he: 'פחות טעויות', en: 'fewer mistakes' },
  was: { he: 'היה', en: 'was' },
} as const;

const en = (c: Cell | undefined) => (c === undefined ? '' : typeof c === 'string' ? c : c.en);
const pct = (c: Cell | undefined) => {
  const m = /([\d.]+)%/.exec(en(c));
  return m ? Number(m[1]) : null;
};
const tableOf = (family: string, id: string) => MODEL_FAMILIES.find((f) => f.id === family)?.tables.find((t) => t.id === id);

type Bar = { label: string; value: number; ours: boolean };

/** The figures from the model pages, or nothing where a table is missing. */
function figures(lang: Lang) {
  const ocr = tableOf('ocr', 'ocr-headline');
  const start = ocr?.rows.find((r) => r.state === 'start');
  const keeper = ocr?.rows.find((r) => en(r.name as Cell) === 'rebbehub-kraken-ls-v1');
  const whisper = tableOf('whisper', 'whisper-held-out');
  const whole = whisper?.rows[whisper.rows.length - 1];
  const miram = tableOf('miram', 'miram-pages')?.rows.find((r) => r.state === 'inUse');
  const ocrBars: Bar[] =
    start && keeper
      ? [
          { label: (start.name as L)[lang] ?? en(start.name as Cell), value: Number((100 - (pct(start.cells[1]) ?? 100)).toFixed(2)), ours: false },
          { label: 'rebbehub-kraken-ls-v1', value: Number((100 - (pct(keeper.cells[1]) ?? 100)).toFixed(2)), ours: true },
        ]
      : [];
  const whisperBars: Bar[] =
    whisper && whole
      ? whole.cells.flatMap((c, i) => {
          const v = pct(c);
          const name = whisper.columns[i + 1];
          if (v === null || !name) return [];
          const short = name.en.replace(/\s*\(.*\)$/, '');
          return [{ label: /^v\d/.test(short) ? `rebbehub-whisper-${short}` : short, value: v, ours: i === whole.cells.length - 1 }];
        })
      : [];
  return {
    letters: keeper ? en(keeper.cells[0]) : null,
    lines: keeper ? en(keeper.cells[2]) : null,
    miram: miram ? en(miram.cells[0]) : null,
    wer: whisperBars.length ? whisperBars[whisperBars.length - 1]! : null,
    werStart: whisperBars[0] ?? null,
    ocrBars,
    whisperBars,
  };
}

export function Benchmarks({ lang }: { lang: Lang }) {
  const f = figures(lang);
  const w = (k: keyof typeof W) => W[k][lang];
  const times = (bars: Bar[]) => {
    const first = bars[0];
    const last = bars[bars.length - 1];
    return first && last && last.value ? Math.round(first.value / last.value) : null;
  };
  return (
    <>
      <div className="bm-tiles">
        {f.letters ? <Tile label={w('letters')} value={f.letters} note={w('ocrTest')} /> : null}
        {f.lines ? <Tile label={w('lines')} value={f.lines} note={w('ocrTest')} /> : null}
        {f.miram ? <Tile label={w('miram')} value={f.miram} note={lang === 'he' ? 'חמישה עמודים שנבדקו בעין' : 'Five pages checked by eye'} /> : null}
        {f.wer ? <Tile label={w('wer')} value={`${f.wer.value}%`} note={f.werStart ? `${w('was')} ${f.werStart.value}% · ${w('whisperTest')}` : w('whisperTest')} /> : null}
      </div>
      <div className="bm-charts">
        {f.ocrBars.length ? <BarChart title={w('ocrChart')} sub={`${w('ocrChartSub')} · ${w('ocrTest')}`} bars={f.ocrBars} times={times(f.ocrBars)} lang={lang} /> : null}
        {f.whisperBars.length ? <BarChart title={w('whisperChart')} sub={`${w('whisperChartSub')} · ${w('whisperTest')}`} bars={f.whisperBars} times={times(f.whisperBars)} lang={lang} /> : null}
      </div>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bm-tile">
      <div className="bm-tile-label">{label}</div>
      <div className="bm-tile-value">{value}</div>
      <div className="bm-tile-note">{note}</div>
    </div>
  );
}

/** One measure, one bar per model, the model in use marked; its value at the bar's tip, and on hover. */
function BarChart({ title, sub, bars, times, lang }: { title: string; sub: string; bars: Bar[]; times: number | null; lang: Lang }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value)) * 1.08;
  const row = 46;
  const bar = 24;
  const labelW = 210;
  const plotW = 360;
  const height = bars.length * row + 8;
  const x = (v: number) => (v / max) * plotW;
  return (
    <figure className="bm-chart">
      <figcaption>
        <div className="bm-chart-t">{title}</div>
        <div className="bm-chart-sub">{sub}</div>
      </figcaption>
      {times && times > 1 ? (
        <p className="bm-times">
          <strong>{times}×</strong> {W.fewer[lang]}
        </p>
      ) : null}
      <svg viewBox={`0 0 ${labelW + plotW + 80} ${height}`} role="img" aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.value}%`).join(', ')}`} style={{ direction: 'ltr' }}>
        <line x1={labelW} x2={labelW} y1={0} y2={height} className="bm-axis" />
        {bars.map((b, i) => {
          const y = i * row + (row - bar) / 2;
          const wBar = Math.max(4, x(b.value));
          const r = Math.min(4, wBar / 2);
          return (
            <g key={b.label} className={['bm-row', b.ours ? 'ours' : '', hover === i ? 'hover' : ''].filter(Boolean).join(' ')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={i * row} width={labelW + plotW + 80} height={row} className="bm-hit" />
              <text x={labelW - 12} y={y + bar / 2} className="bm-label" textAnchor="end" dominantBaseline="central">
                {b.label}
              </text>
              {/* Square at the baseline, rounded at the data end. */}
              <path d={`M${labelW},${y} h${wBar - r} a${r},${r} 0 0 1 ${r},${r} v${bar - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${wBar - r} z`} className="bm-bar" />
              <text x={labelW + wBar + 8} y={y + bar / 2} className="bm-value" dominantBaseline="central">
                {b.value}%
              </text>
              <title>{`${b.label}: ${b.value}%`}</title>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
