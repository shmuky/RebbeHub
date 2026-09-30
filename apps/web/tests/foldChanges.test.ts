import { describe, expect, it } from 'vitest';
import { foldChanges, foldedName } from '../app/components/ChangeTable.js';

/**
 * A sync bot's change moves every word of a recording: two thousand word
 * timings, which a page of rows stopped phones on (Shmuly, 30 Tishrei).
 * They read as one row each for start and end, with how many and by how much.
 */
describe('a change of many alike fields', () => {
  const words = Array.from({ length: 1000 }, (_, i) => [
    { path: `/words/${i}/endMs`, before: 1000 * i + 500, after: 1000 * i + 91422 },
    { path: `/words/${i}/startMs`, before: 1000 * i, after: 1000 * i + 90922 },
  ]).flat();

  it('is one row per field, with how many and by how much they moved', () => {
    const { rows, hidden } = foldChanges([{ path: '/date', before: '5750-01-01', after: '5750-01-02' }, ...words]);
    expect(rows).toHaveLength(3);
    expect(hidden).toBe(0);
    expect(rows[1]).toMatchObject({ path: '/words/*/endMs', count: 1000, shift: 90922, before: 500, after: 91422 });
    expect(foldedName(rows[2]!, 'en')).toBe('words › startMs · 1,000 changes, all by +90.9 s (the first shown)');
    expect(foldedName(rows[0]!, 'en')).not.toContain('changes');
  });

  it('keeps a few alike changes as they are, and counts the rows past the limit', () => {
    expect(foldChanges(words.slice(0, 3)).rows).toHaveLength(3);
    const many = Array.from({ length: 40 }, (_, i) => ({ path: `/f${i}`, before: 1, after: 2 }));
    expect(foldChanges(many)).toMatchObject({ hidden: 10 });
  });
});
