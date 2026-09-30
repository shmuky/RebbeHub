import { describe, expect, it } from 'vitest';
import { foldChanges, foldedName, valueText } from '../app/components/ChangeTable.js';

/**
 * A sync bot's change moves every word of a recording: two thousand word
 * timings, which a page of rows stopped phones on (Shmuly, 30 Tishrei).
 * Timings and machine details are counted, not shown; other alike changes
 * are one row, with how many and by how much; a long value shows its start.
 */
describe('a change of many alike fields', () => {
  const timings = Array.from({ length: 1000 }, (_, i) => [
    { path: `/words/${i}/endMs`, before: 1000 * i + 500, after: 1000 * i + 91422 },
    { path: `/words/${i}/startMs`, before: 1000 * i, after: 1000 * i + 90922 },
  ]).flat();

  it('counts timings and machine details in one line, and shows none of them', () => {
    const { rows, info } = foldChanges([...timings, { path: '/startMs', before: 1, after: 2 }, { path: '/origin/engine', before: 'a', after: 'b' }]);
    expect(rows).toHaveLength(0);
    expect(info).toBe(2002);
  });

  it('is one row per field, with how many and by how much they moved', () => {
    const offsets = Array.from({ length: 500 }, (_, i) => ({ path: `/marks/${i}/offset`, before: i, after: i + 3 }));
    const { rows, hidden } = foldChanges([{ path: '/date', before: '5750-01-01', after: '5750-01-02' }, ...offsets]);
    expect(rows).toHaveLength(2);
    expect(hidden).toBe(0);
    expect(rows[1]).toMatchObject({ path: '/marks/*/offset', count: 500, shift: 3 });
    expect(foldedName(rows[1]!, 'en')).toBe('marks › offset · 500 changes, all by +3 (the first shown)');
    expect(foldedName(rows[0]!, 'en')).not.toContain('changes');
  });

  it('keeps a few alike changes as they are, and counts the rows past the limit', () => {
    expect(foldChanges(Array.from({ length: 3 }, (_, i) => ({ path: `/marks/${i}/offset`, before: 1, after: 2 }))).rows).toHaveLength(3);
    expect(foldChanges(Array.from({ length: 40 }, (_, i) => ({ path: `/f${i}`, before: 1, after: 2 })))).toMatchObject({ hidden: 28 });
  });

  it('shows the start of a long value', () => {
    expect(valueText('/description', 'א'.repeat(1000), 'he')).toHaveLength(201);
  });
});

describe("a small fix to a transcript's words", () => {
  it("counts the paragraph's re-timing and the machine's marks as details, not as a change", async () => {
    const { onlyInfo } = await import('../app/components/ChangeTable.js');
    expect(onlyInfo([{ path: '/words' }, { path: '/origin/edited' }, { path: '/proofread' }, { path: '/updatedAt' }])).toBe(true);
    expect(onlyInfo([{ path: '/words' }, { path: '/content' }])).toBe(false);
    expect(onlyInfo([])).toBe(false);
  });
});
