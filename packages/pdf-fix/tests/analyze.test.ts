import { describe, expect, it } from 'vitest';
import { analyzePage } from '../src/analyze.js';
import { drawPage } from './page.js';

describe('analyzePage', () => {
  it.each([-2.4, -0.8, 0, 0.6, 1.9])('reads a tilt of %s° to a tenth of a degree', (tilt) => {
    const { bitmap } = drawPage({ width: 600, height: 800, tilt });
    expect(Math.abs(analyzePage(bitmap).angle - tilt)).toBeLessThanOrEqual(0.1);
  });

  it("sets the scanner's edges aside: they neither tilt the page nor stretch the box", () => {
    const clean = analyzePage(drawPage({ width: 600, height: 800, tilt: 1.2 }).bitmap);
    const scanned = analyzePage(drawPage({ width: 600, height: 800, tilt: 1.2, edge: true, sheetEdge: true }).bitmap);
    expect(scanned.setAside).toBe(2);
    expect(scanned.angle).toBeCloseTo(clean.angle, 1);
    expect(scanned.box!.bottom).toBeCloseTo(clean.box!.bottom, 0);
  });

  it('finds the text block where it is, however far off the middle', () => {
    const middle = analyzePage(drawPage({ width: 600, height: 800, tilt: 0 }).bitmap).box!;
    const shifted = analyzePage(drawPage({ width: 600, height: 800, tilt: 0, shift: 60 }).bitmap).box!;
    expect(shifted.left - middle.left).toBeCloseTo(60, -1);
    expect(shifted.right - middle.right).toBeCloseTo(60, -1);
    expect(shifted.top).toBeCloseTo(middle.top, 0);
  });

  it('leaves a blank page alone, and keeps a lone page number level', () => {
    expect(analyzePage({ width: 100, height: 100, gray: new Uint8Array(100 * 100).fill(255) })).toMatchObject({ angle: 0, box: null, marks: 0 });
    const gray = new Uint8Array(200 * 200).fill(255);
    for (let y = 180; y < 186; y++) for (let x = 95; x < 105; x++) gray[y * 200 + x] = 0;
    expect(analyzePage({ width: 200, height: 200, gray })).toMatchObject({ angle: 0, box: { left: 95, top: 180, right: 105, bottom: 186 } });
  });
});
