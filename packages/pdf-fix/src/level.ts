import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { analyzePage } from './analyze.js';
import { LEVEL_TOLERANCE, wrapContents } from './fix.js';
import { renderPages, type RenderOptions } from './render.js';

/**
 * Levelling a published book's scan: only the pages that lean are turned,
 * each about its middle, and nothing else changes - no centring, no
 * enlarging, no cutting - so the book still looks like the book. A reading
 * copy (fix.ts) does more, for the typewritten sheets it was made for; a
 * printed book's margins, running heads and rules are the publisher's and
 * stay where they are.
 *
 * A turn is a PDF matrix per page, so it needs no copy of the file: a
 * reader draws the page through it. Every turn is still tried on a copy
 * and the page measured again; a page that does not come out level keeps
 * no turn (the others keep theirs).
 */

export interface LevelOptions extends RenderOptions {
  /** A page is turned when it leans at least this much, in degrees (default 0.3). */
  minAngle?: number;
}

export interface PageTurn {
  page: number;
  /** How far the page leant: degrees, clockwise on screen. */
  angle: number;
  /** The turn, as a PDF matrix in points `[a, b, c, d, e, f]`: where a point of the page is drawn. */
  transform: number[];
}

export interface LevelReport {
  pages: number;
  /** The pages turned, each read back level. */
  turned: PageTurn[];
  /** Pages that leant but did not read back level once turned: left as they are. */
  dropped: Array<{ page: number; angle: number; after: number }>;
  /** Pages with a /Rotate, or a crop box pdf.js disagrees with: left as they are. */
  skipped: number[];
}

export const MIN_TURN = 0.3;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The turn that levels a page leaning `angle` degrees, about the middle of its crop box. */
export function levelTransform(angle: number, crop: { x: number; y: number; width: number; height: number }): number[] {
  // Leaning clockwise on screen (y down) is put right by turning the other way in PDF space (y up), as in fix.ts.
  const t = (angle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy].map(round4);
}

/** The tilt of each page given (every page, when none are), measured as a fix measures it. */
export async function measureAngles(data: Uint8Array, options: RenderOptions = {}): Promise<Array<{ page: number; angle: number; blank: boolean; rotate: number; widthPt: number; heightPt: number }>> {
  const out = [];
  for await (const page of renderPages(data, options)) {
    const analysis = analyzePage(page.bitmap);
    out.push({ page: page.number, angle: analysis.angle, blank: !analysis.box, rotate: page.rotate, widthPt: page.widthPt, heightPt: page.heightPt });
  }
  return out;
}

async function turnPages(data: Uint8Array, turns: PageTurn[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const pages = doc.getPages();
  for (const turn of turns) wrapContents(doc, pages[turn.page - 1]!, `q\n${turn.transform.join(' ')} cm\n`, '\nQ\n');
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** Measures the pages (or `options.pages`), turns the ones that lean, and keeps each turn that reads back level. */
export async function levelPdf(data: Uint8Array, options: LevelOptions = {}): Promise<{ pdf: Uint8Array | null; report: LevelReport }> {
  const minAngle = options.minAngle ?? MIN_TURN;
  const measured = await measureAngles(data, options);
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const docPages = doc.getPages();
  const planned: PageTurn[] = [];
  const skipped: number[] = [];
  for (const page of measured) {
    if (page.blank || Math.abs(page.angle) < minAngle) continue;
    const docPage = docPages[page.page - 1];
    const rotation = docPage?.node.get(PDFName.of('Rotate'));
    const crop = docPage?.getCropBox();
    if (!docPage || !crop || page.rotate !== 0 || (rotation instanceof PDFNumber && rotation.asNumber() % 360 !== 0) || Math.abs(crop.width - page.widthPt) > 0.5 || Math.abs(crop.height - page.heightPt) > 0.5) {
      skipped.push(page.page);
      continue;
    }
    planned.push({ page: page.page, angle: page.angle, transform: levelTransform(page.angle, crop) });
  }
  const report: LevelReport = { pages: docPages.length, turned: [], dropped: [], skipped };
  if (!planned.length) return { pdf: null, report };
  let pdf: Uint8Array | null = await turnPages(data, planned);
  // Read back only the turned pages.
  const after = new Map((await measureAngles(pdf, { scale: options.scale, pages: planned.map((turn) => turn.page) })).map((page) => [page.page, page.angle]));
  for (const turn of planned) {
    const angle = after.get(turn.page) ?? Number.NaN;
    if (Math.abs(angle) <= LEVEL_TOLERANCE) report.turned.push(turn);
    else report.dropped.push({ page: turn.page, angle: turn.angle, after: angle });
  }
  if (report.dropped.length) pdf = report.turned.length ? await turnPages(data, report.turned) : null;
  return { pdf, report };
}
