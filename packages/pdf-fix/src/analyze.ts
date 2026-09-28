/**
 * Finds what a scanned page needs to read straight: how far the text is
 * tilted, and the box the text takes once it's straight. Works on a
 * greyscale rendering of the page (0 black .. 255 white), top row first.
 *
 * Ink is what's clearly darker than the paper around it (the paper's own
 * tone is measured per block, so grey or unevenly lit paper still works).
 * Before measuring, the scan's own marks are set aside: anything touching
 * the edge of the image (the scanner's black borders and shadows), long
 * thin lines (the edge of the sheet), and large dark areas. Only the text
 * - letters, handwriting, page numbers - decides the tilt and the box.
 */

export interface PageBitmap {
  width: number;
  height: number;
  /** One byte per pixel, 0 black to 255 white, row by row from the top. */
  gray: Uint8Array;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageAnalysis {
  width: number;
  height: number;
  /**
   * The text's tilt in degrees, clockwise on screen: turning the page back
   * by this much makes the lines level. 0 when there's too little text to
   * tell.
   */
  angle: number;
  /** The text's box once the page is turned (about its centre), in pixels; null for a page with no text. */
  box: Box | null;
  /** How many marks (letters, words) the box and the tilt came from. */
  marks: number;
  /** Marks set aside as the scan's own (borders, sheet edges, dark areas). */
  setAside: number;
}

/** Tilts looked at, in degrees: a scan tilted more than this is left as it is. */
export const MAX_ANGLE = 5;
/** Below this many marks the tilt isn't measured (a page number alone can't say how the page lies). */
const MIN_MARKS_FOR_ANGLE = 40;

/** Ink: a pixel clearly darker than the paper around it (the paper's tone per 32px block). */
export function inkMask(page: PageBitmap): Uint8Array {
  const { width: W, height: H, gray } = page;
  const B = 32;
  const bw = Math.ceil(W / B);
  const bh = Math.ceil(H / B);
  const paper = new Float32Array(bw * bh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      for (let y = by * B; y < Math.min(H, by * B + B); y++) {
        for (let x = bx * B; x < Math.min(W, bx * B + B); x++) {
          hist[gray[y * W + x]!]!++;
          n++;
        }
      }
      // The paper is the bright end: the 90th percentile of the block.
      let acc = 0;
      let level = 255;
      for (let v = 0; v < 256; v++) {
        acc += hist[v]!;
        if (acc >= n * 0.9) {
          level = v;
          break;
        }
      }
      paper[by * bw + bx] = Math.max(96, level);
    }
  }
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = Math.min(bh - 1, (y / B) | 0) * bw;
    for (let x = 0; x < W; x++) {
      if (gray[y * W + x]! < paper[row + Math.min(bw - 1, (x / B) | 0)]! * 0.6) ink[y * W + x] = 1;
    }
  }
  return ink;
}

interface Mark {
  left: number;
  top: number;
  right: number;
  bottom: number;
  area: number;
  /** Its pixels, as y * width + x. */
  pixels: number[];
}

/** The page's marks: 8-connected runs of ink. */
export function findMarks(ink: Uint8Array, W: number, H: number): Mark[] {
  const label = new Int32Array(W * H).fill(-1);
  const marks: Mark[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || label[start] !== -1) continue;
    const id = marks.length;
    const mark: Mark = { left: W, top: H, right: -1, bottom: -1, area: 0, pixels: [] };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      mark.pixels.push(p);
      mark.area++;
      if (x < mark.left) mark.left = x;
      if (x > mark.right) mark.right = x;
      if (y < mark.top) mark.top = y;
      if (y > mark.bottom) mark.bottom = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (ink[q] && label[q] === -1) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    marks.push(mark);
  }
  return marks;
}

/** A mark that belongs to the scan, not the text: it touches the image's edge, or is a long thin line, or a large dark area. */
export function isScanMark(mark: Mark, W: number, H: number): boolean {
  const w = mark.right - mark.left + 1;
  const h = mark.bottom - mark.top + 1;
  const edge = 2;
  if (mark.left < edge || mark.top < edge || mark.right >= W - edge || mark.bottom >= H - edge) return true;
  if ((w > W * 0.4 && h < H * 0.03) || (h > H * 0.4 && w < W * 0.03)) return true;
  if (mark.area > W * H * 0.02) return true;
  return false;
}

function rotator(angle: number, W: number, H: number) {
  const t = (angle * Math.PI) / 180;
  const s = Math.sin(t);
  const c = Math.cos(t);
  const cx = W / 2;
  const cy = H / 2;
  return {
    x: (x: number, y: number) => (x - cx) * c + (y - cy) * s + cx,
    y: (x: number, y: number) => -(x - cx) * s + (y - cy) * c + cy,
  };
}

/** The tilt that lines the text up best: the angle whose row profile is sharpest, to a tenth of a degree, then to a fiftieth. */
export function measureAngle(points: Int32Array, W: number, H: number): number {
  const score = (angle: number) => {
    const t = (angle * Math.PI) / 180;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const rows = new Float32Array(H * 2 + 4);
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i]! - W / 2;
      const y = points[i + 1]! - H / 2;
      const ry = Math.round(-x * s + y * c + H);
      if (ry >= 0 && ry < rows.length) rows[ry]!++;
    }
    let sum = 0;
    for (let k = 1; k < rows.length; k++) {
      const d = rows[k]! - rows[k - 1]!;
      sum += d * d;
    }
    return sum;
  };
  let best = 0;
  let bestScore = score(0);
  for (let a = -MAX_ANGLE; a <= MAX_ANGLE + 1e-9; a += 0.1) {
    const v = score(a);
    if (v > bestScore) {
      bestScore = v;
      best = a;
    }
  }
  const coarse = best;
  for (let a = coarse - 0.1; a <= coarse + 0.1 + 1e-9; a += 0.02) {
    const v = score(a);
    if (v > bestScore) {
      bestScore = v;
      best = a;
    }
  }
  return Math.round(best * 100) / 100;
}

export function analyzePage(page: PageBitmap): PageAnalysis {
  const { width: W, height: H } = page;
  const marks = findMarks(inkMask(page), W, H);
  const text = marks.filter((mark) => !isScanMark(mark, W, H));
  const setAside = marks.length - text.length;
  // Specks (dust, the scanner's noise) say nothing about the tilt; they still count for the box, so nothing real is cut.
  const letters = text.filter((mark) => mark.area >= 6);
  if (text.length === 0) return { width: W, height: H, angle: 0, box: null, marks: 0, setAside };

  let angle = 0;
  if (letters.length >= MIN_MARKS_FOR_ANGLE) {
    // Every other pixel of the letters is plenty to measure by.
    const count = letters.reduce((n, mark) => n + Math.ceil(mark.pixels.length / 2), 0);
    const points = new Int32Array(count * 2);
    let i = 0;
    for (const mark of letters) {
      for (let k = 0; k < mark.pixels.length; k += 2) {
        const p = mark.pixels[k]!;
        points[i++] = p % W;
        points[i++] = (p - (p % W)) / W;
      }
    }
    angle = measureAngle(points, W, H);
  }

  // The box: the corners of every letter, turned; a speck counts only near the letters (a dot, a vowel), so dust in the margin can't hold the margin open.
  const turn = rotator(angle, W, H);
  const lettersBox = letters.length ? cornersBox(letters, turn) : cornersBox(text, turn);
  const near = Math.max(W, H) * 0.03;
  const inBox = text.filter((mark) => {
    if (mark.area >= 6) return true;
    const x = turn.x((mark.left + mark.right) / 2, (mark.top + mark.bottom) / 2);
    const y = turn.y((mark.left + mark.right) / 2, (mark.top + mark.bottom) / 2);
    return x > lettersBox.left - near && x < lettersBox.right + near && y > lettersBox.top - near && y < lettersBox.bottom + near;
  });
  return { width: W, height: H, angle, box: cornersBox(inBox, turn), marks: text.length, setAside };
}

function cornersBox(marks: Mark[], turn: ReturnType<typeof rotator>): Box {
  const box: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const mark of marks) {
    for (const [x, y] of [
      [mark.left, mark.top],
      [mark.right + 1, mark.top],
      [mark.left, mark.bottom + 1],
      [mark.right + 1, mark.bottom + 1],
    ] as const) {
      const rx = turn.x(x, y);
      const ry = turn.y(x, y);
      if (rx < box.left) box.left = rx;
      if (rx > box.right) box.right = rx;
      if (ry < box.top) box.top = ry;
      if (ry > box.bottom) box.bottom = ry;
    }
  }
  return box;
}
