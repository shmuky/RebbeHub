import { PDFArray, PDFDocument, PDFName, PDFNumber, type PDFPage, type PDFRef } from 'pdf-lib';
import { analyzePage, type Box, type PageAnalysis } from './analyze.js';
import { renderPages, type RenderOptions } from './render.js';

/**
 * A scan's reading copy, made without touching the scan: each page's
 * picture is only placed differently - turned level, its text box moved to
 * the middle with even margins and scaled to fill the page the same way on
 * every page, and cut to that box, which drops the scanner's black edges.
 * The page's content stream is wrapped in one transform and one clip
 * (`q … cm … re W n … cm <the page as it was> Q`); the images are the
 * same bytes, so the file stays the size it was and nothing is lost. The
 * original stays the file of record; the copy is its `reading-copy`
 * derivation, made again whenever this tool improves.
 */

export interface PagePlan {
  number: number;
  /** Why the page is left as it is, when it is. */
  skipped?: 'blank' | 'rotated' | 'size';
  angle?: number;
  /** The text box, in PDF points, once turned (x right, y up; the page's origin). */
  box?: { left: number; bottom: number; right: number; top: number };
  /** How much the page is enlarged (the same for every page but an outlier). */
  scale?: number;
  /**
   * Where a point of the original page lands on the reading copy, as a PDF
   * matrix `[a, b, c, d, e, f]` in points (x' = a·x + c·y + e, y' = b·x + d·y + f):
   * a line OCR found on the original is drawn on the copy through it.
   */
  transform?: number[];
  /** The PDF operators that go before the page's own content. */
  prefix?: string;
  marks?: number;
  setAside?: number;
}

export interface FixReport {
  pages: PagePlan[];
  /** Pages changed. */
  fixed: number;
}

export interface FixOptions extends RenderOptions {
  /** The margin kept round the text, as a share of the page's width (default 0.05). */
  margin?: number;
  /** The most a page is enlarged (default 1.6). */
  maxScale?: number;
}

interface Measured {
  number: number;
  widthPt: number;
  heightPt: number;
  rotate: number;
  analysis: PageAnalysis;
}

const f = (n: number) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4).replace(/\.?0+$/, ''));

/** One page's plan: the turn, the box in points, and the operators - `scale` chosen for the whole file. */
export function planPage(page: Measured, origin: { x: number; y: number }, scale: number, options: FixOptions = {}): PagePlan {
  const { analysis, widthPt: PW, heightPt: PH } = page;
  const box = analysis.box as Box;
  const k = analysis.width / PW;
  const x0 = origin.x;
  const y0 = origin.y;
  // The box, in PDF points once turned: x right, y up.
  const L = box.left / k + x0;
  const R = box.right / k + x0;
  const T = y0 + PH - box.top / k;
  const B = y0 + PH - box.bottom / k;
  const s = Math.min(scale, fitScale(page, options));
  const margin = (options.margin ?? 0.05) * PW;
  // Centred across, the top at the margin.
  const tx = x0 + (PW - s * (R - L)) / 2;
  const ty = y0 + PH - margin;
  // Turning in the bitmap (y down) by `angle` is turning the other way in PDF space (y up), about the page's middle.
  const t = (analysis.angle * Math.PI) / 180;
  const c = Math.cos(t);
  const sn = Math.sin(t);
  const cx = x0 + PW / 2;
  const cy = y0 + PH / 2;
  const pad = 2;
  const prefix = [
    'q',
    `${f(s)} 0 0 ${f(s)} ${f(tx - s * L)} ${f(ty - s * T)} cm`,
    `${f(L - pad)} ${f(B - pad)} ${f(R - L + 2 * pad)} ${f(T - B + 2 * pad)} re W n`,
    `${f(c)} ${f(sn)} ${f(-sn)} ${f(c)} ${f(cx - c * cx + sn * cy)} ${f(cy - sn * cx - c * cy)} cm`,
    '',
  ].join('\n');
  // The turn, then the placing: one matrix from the original page to the copy.
  const er = cx - c * cx + sn * cy;
  const fr = cy - sn * cx - c * cy;
  const transform = [c * s, sn * s, -sn * s, c * s, er * s + (tx - s * L), fr * s + (ty - s * T)].map((n) => Math.round(n * 1e4) / 1e4);
  return { number: page.number, angle: analysis.angle, box: { left: L, bottom: B, right: R, top: T }, scale: s, transform, prefix, marks: analysis.marks, setAside: analysis.setAside };
}

/** The most this page can be enlarged and keep its box inside the margins. */
function fitScale(page: Measured, options: FixOptions): number {
  const box = page.analysis.box as Box;
  const k = page.analysis.width / page.widthPt;
  const margin = (options.margin ?? 0.05) * page.widthPt;
  const w = (box.right - box.left) / k;
  const h = (box.bottom - box.top) / k;
  return Math.min((page.widthPt - 2 * margin) / w, (page.heightPt - 2 * margin) / h);
}

/**
 * One enlargement for the whole file, so the letters are the same size on
 * every page: what the fullest pages allow (the median of the largest
 * boxes; a page whose box is out of line - a stray mark - just gets less).
 */
export function fileScale(pages: Measured[], options: FixOptions = {}): number {
  const fits = pages.filter((page) => page.analysis.box).map((page) => fitScale(page, options));
  if (!fits.length) return 1;
  const sorted = [...fits].sort((a, b) => a - b);
  // The fuller half of the pages decide: their median fit.
  const fuller = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const scale = fuller[Math.floor(fuller.length / 2)]!;
  return Math.max(0.5, Math.min(options.maxScale ?? 1.6, scale));
}

/** Tilt left on a fixed page past which the fix counts as failed (the lines should be level). */
export const LEVEL_TOLERANCE = 0.3;

export interface CheckResult {
  ok: boolean;
  /** Pages still tilted past LEVEL_TOLERANCE, or whose text runs off the page. */
  problems: Array<{ number: number; angle: number; reason: 'tilted' | 'off-page' }>;
}

/**
 * Reads a fixed PDF back the way a viewer would and measures it again:
 * every changed page must now be level and its text inside the page. A
 * file that fails is not used; the original is served instead.
 */
export async function checkFixed(pdf: Uint8Array, report: FixReport, options: RenderOptions = {}): Promise<CheckResult> {
  const changed = new Set(report.pages.filter((page) => !page.skipped).map((page) => page.number));
  const problems: CheckResult['problems'] = [];
  for await (const page of renderPages(pdf, options)) {
    if (!changed.has(page.number)) continue;
    const analysis = analyzePage(page.bitmap);
    if (Math.abs(analysis.angle) > LEVEL_TOLERANCE) problems.push({ number: page.number, angle: analysis.angle, reason: 'tilted' });
    else if (!analysis.box || analysis.box.left < 0 || analysis.box.top < 0 || analysis.box.right > page.bitmap.width || analysis.box.bottom > page.bitmap.height) {
      problems.push({ number: page.number, angle: analysis.angle, reason: 'off-page' });
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Analyses every page and returns the fixed PDF with what was done to each page. */
export async function fixPdf(data: Uint8Array, options: FixOptions = {}): Promise<{ pdf: Uint8Array; report: FixReport }> {
  const measured: Measured[] = [];
  for await (const page of renderPages(data, options)) {
    measured.push({ number: page.number, widthPt: page.widthPt, heightPt: page.heightPt, rotate: page.rotate, analysis: analyzePage(page.bitmap) });
  }
  const doc = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: false });
  const docPages = doc.getPages();
  const scale = fileScale(measured.filter((page) => page.rotate === 0), options);
  const plans: PagePlan[] = [];
  for (const page of measured) {
    const docPage = docPages[page.number - 1];
    if (!page.analysis.box) {
      plans.push({ number: page.number, skipped: 'blank' });
      continue;
    }
    const rotation = docPage?.node.get(PDFName.of('Rotate'));
    if (page.rotate !== 0 || (rotation instanceof PDFNumber && rotation.asNumber() % 360 !== 0) || !docPage) {
      plans.push({ number: page.number, skipped: 'rotated' });
      continue;
    }
    // pdf.js measured the crop box; the plan is in its coordinates.
    const crop = docPage.getCropBox();
    if (Math.abs(crop.width - page.widthPt) > 0.5 || Math.abs(crop.height - page.heightPt) > 0.5) {
      plans.push({ number: page.number, skipped: 'size' });
      continue;
    }
    const plan = planPage(page, { x: crop.x, y: crop.y }, scale, options);
    wrapContents(doc, docPage, plan.prefix!, '\nQ\n');
    plans.push(plan);
  }
  const pdf = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { pdf, report: { pages: plans, fixed: plans.filter((plan) => !plan.skipped).length } };
}

/** Puts `before` ahead of the page's own content and `after` behind it, whether the page has one content stream or several. */
function wrapContents(doc: PDFDocument, page: PDFPage, before: string, after: string): void {
  const start: PDFRef = doc.context.register(doc.context.flateStream(before));
  const end: PDFRef = doc.context.register(doc.context.flateStream(after));
  const contents = page.node.Contents();
  if (contents instanceof PDFArray) {
    contents.insert(0, start);
    contents.push(end);
    return;
  }
  const own = page.node.get(PDFName.of('Contents'));
  if (!own) throw new Error(`page ${page.ref.toString()} has no content`);
  page.node.set(PDFName.of('Contents'), doc.context.obj([start, own, end]));
}
