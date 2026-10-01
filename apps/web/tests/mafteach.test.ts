import { describe, expect, it } from 'vitest';
import { chipLabel, topicLines } from '../app/lib/mafteach.js';

/** The full subject index lists a topic as the design does (5a): a line for each thing said of it, a chip for each volume's page. */
describe('a topic in the full subject index', () => {
  const vol = (volume: number, places: Array<{ page: number; to?: number; context?: string }>) => ({ volume, label: `חלק ${volume}`, path: `/ls-index/${volume}`, machine: volume < 26, places });

  it('names a page as the printed indexes do: the volume, then the page', () => {
    expect(chipLabel(2, { page: 412 }, 'he')).toBe('ח״ב 412');
    expect(chipLabel(15, { page: 137 }, 'he')).toBe('חט״ו 137');
    expect(chipLabel(24, { page: 62, to: 64 }, 'he')).toBe('חכ״ד 62-64');
    expect(chipLabel(24, { page: 62 }, 'en')).toBe('24:62');
  });

  it('puts the same words in two volumes on one line, and the pages with no words of their own first', () => {
    const lines = topicLines({ topic: 'אחד', letter: 'א', volumes: [vol(20, [{ page: 180, context: 'אחד שני ושלישי' }, { page: 261, context: 'מספר' }]), vol(21, [{ page: 16, context: 'אחד שני ושלישי ' }, { page: 5 }])] });
    expect(lines.map((l) => [l.context, l.refs.map((r) => `${r.volume}:${r.place.page}`)])).toEqual([
      ['', ['21:5']],
      ['אחד שני ושלישי', ['20:180', '21:16']],
      ['מספר', ['20:261']],
    ]);
    expect(lines[1]!.refs.map((r) => r.key)).toEqual(['20-0', '21-0']);
  });
});
