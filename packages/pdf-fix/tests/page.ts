import { createCanvas } from '@napi-rs/canvas';
import type { PageBitmap } from '../src/analyze.js';

export interface SyntheticPage {
  width: number;
  height: number;
  /** Turns the text by this many degrees, clockwise on screen. */
  tilt: number;
  /** Moves the text block across (px). */
  shift?: number;
  /** Draws a scanner's black edge along the bottom, touching the image's edge. */
  edge?: boolean;
  /** A stray long thin line (the sheet's edge) inside the image. */
  sheetEdge?: boolean;
}

/** A typewriter-like page: 30 lines of "words" (small black blocks), tilted, as a PNG and as a bitmap. */
export function drawPage(spec: SyntheticPage): { png: Buffer; bitmap: PageBitmap } {
  const { width: W, height: H } = spec;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2 + (spec.shift ?? 0), H / 2);
  g.rotate((spec.tilt * Math.PI) / 180);
  g.fillStyle = '#000';
  const left = -W * 0.32;
  const lineGap = (H * 0.7) / 30;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let line = 0; line < 30; line++) {
    const y = -H * 0.35 + line * lineGap;
    let x = left;
    while (x < W * 0.32) {
      const word = 8 + random() * 30;
      // Letters: a few ink columns per word, the height of a line of type.
      for (let k = 0; k < word; k += 4) g.fillRect(x + k, y, 3, lineGap * 0.45);
      x += word + 7;
    }
  }
  g.restore();
  g.fillStyle = '#000';
  if (spec.edge) g.fillRect(0, H - 6, W, 6);
  if (spec.sheetEdge) g.fillRect(W * 0.05, H * 0.93, W * 0.9, 2);
  const rgba = g.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]!;
  return { png: canvas.toBuffer('image/png'), bitmap: { width: W, height: H, gray } };
}
