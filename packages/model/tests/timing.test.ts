import { describe, expect, it } from 'vitest';
import { carryWordTimes } from '../src/timing.js';

const timed = (content: string, times: Array<[number, number]>) =>
  [...content.matchAll(/\S+/g)].map((m, i) => ({ from: m.index!, to: m.index! + m[0].length, startMs: times[i]![0], endMs: times[i]![1] }));

describe('carryWordTimes', () => {
  const before = 'און דער רבי האט געזאגט';
  const words = timed(before, [
    [0, 400],
    [400, 800],
    [800, 1200],
    [1200, 1600],
    [1600, 2400],
  ]);

  it('keeps the times of the words a fix left as they were', () => {
    const after = 'און דער רבי האט געזאגט, אז';
    const carried = carryWordTimes(before, words, after)!;
    expect(carried.map((w) => after.slice(w.from, w.to))).toEqual(['און', 'דער', 'רבי', 'האט', 'געזאגט,', 'אז']);
    expect(carried.slice(0, 5).map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 400],
      [400, 800],
      [800, 1200],
      [1200, 1600],
      [1600, 2400],
    ]);
    // A word added at the end is heard where the paragraph ends.
    expect(carried[5]!.startMs).toBe(2400);
  });

  it('times a changed word between the kept words on either side', () => {
    const after = 'און דער רבי שליט"א האט געזאגט';
    const carried = carryWordTimes(before, words, after)!;
    const added = carried[3]!;
    expect(after.slice(added.from, added.to)).toBe('שליט"א');
    expect(added.startMs).toBe(1200);
    expect(carried[4]!.startMs).toBe(1200);
    expect(carried.every((w, i) => i === 0 || w.startMs >= carried[i - 1]!.startMs)).toBe(true);
  });

  it('has nothing to carry without timings or words', () => {
    expect(carryWordTimes(before, null, 'און')).toBeNull();
    expect(carryWordTimes(before, words, '   ')).toBeNull();
  });
});
