/**
 * Drawing a page through its page fix (RebbeHub's page fixes: a leaning
 * page turned level, or a reading copy's placing) without a copy of the
 * file. A fix is a PDF matrix: where a point of the page is drawn, in the
 * page's own points. pdf.js draws a page through the viewport's matrix V
 * (points to canvas pixels) and takes one more matrix, applied in canvas
 * pixels; drawing through the fix F first is the same as drawing through
 * V·F·V⁻¹ in pixels. A reading copy's placing also cuts the page to a box
 * (the scanner's edges fall outside it): what lies outside is painted
 * over with the page's white.
 */

export type Matrix = [number, number, number, number, number, number];

/** One page's fix, as the API gives it. */
export interface PageFix {
  page: number;
  transform: number[];
  /** `[left, bottom, right, top]` in points, when the page is also cut. */
  clip?: number[];
}

/** `m` after `n`: a point goes through `n`, then `m`. */
export function compose(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The fix in canvas pixels, for pdf.js's `transform` render parameter. */
export function canvasTransform(viewport: Matrix, fix: Matrix): Matrix {
  return compose(compose(viewport, fix), invert(viewport));
}

/** The cut, in canvas pixels: `[x, y, width, height]` (the viewport turns y downwards). */
export function canvasClip(viewport: Matrix, clip: number[]): [number, number, number, number] {
  const [x0, y0] = apply(viewport, clip[0]!, clip[1]!);
  const [x1, y1] = apply(viewport, clip[2]!, clip[3]!);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
}

/** Only well-formed fixes, by page number: anything else is drawn as it is. */
export function fixesByPage(pages: ReadonlyArray<{ page: number; transform?: number[]; clip?: number[] }>): Map<number, PageFix> {
  const out = new Map<number, PageFix>();
  const finite = (list: unknown, length: number): list is number[] => Array.isArray(list) && list.length === length && list.every((n) => Number.isFinite(n));
  for (const page of pages) {
    if (!Number.isInteger(page.page) || !finite(page.transform, 6)) continue;
    out.set(page.page, { page: page.page, transform: page.transform, ...(finite(page.clip, 4) ? { clip: page.clip } : {}) });
  }
  return out;
}
