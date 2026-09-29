import { describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import { anchorSync, fixParagraph, piecesOf, splitOf, summariseTraining, trainingClips, trainingGoal, type Catalog, type Json } from '@rebbehub/core';
import { add, freshCatalog, yudShvat } from './helpers.js';

/** The retraining cycle's data (trainingClips.ts): checked transcript paragraphs become clips for the next model. */

const word = (from: number, to: number, startMs: number, endMs: number) => ({ from, to, startMs, endMs });

async function transcribed(catalog: Catalog, set: EntityId, url: string, date?: string) {
  const event = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), ...(date ? { date } : {}) });
  const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, url, sets: [set] });
  await catalog.createAccount({ id: 'bot:transcribe', displayName: 'Machine transcription', isBot: true });
  const cs = await catalog.createChangeset('bot:transcribe', { title: 'Transcript' });
  const origin = { by: 'transcribe:fake@1' };
  const text = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'text', data: { kind: 'transcript', recording, language: 'yi' } as Json });
  const alignment = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'alignment', data: { recording, text, granularity: 'word' } as Json });
  // A long paragraph: 40 seconds of ten words, four seconds each.
  const long = Array.from({ length: 10 }, (_, i) => `ווארט${'אבגדהוזחטי'[i]}אבגדהוזח`).join(' ');
  const longWords = long.split(' ').map((w, i, all) => {
    const from = all.slice(0, i).join(' ').length + (i ? 1 : 0);
    return word(from, from + w.length, 12000 + i * 4000, 16000 + i * 4000);
  });
  const paragraphs = [
    { content: 'לחיים לחיים', startMs: 0, endMs: 4000 },
    { content: 'עס שטייט אין פסוק', startMs: 4000, endMs: 8000 },
    { content: 'אין פסוק', startMs: 8000, endMs: 12000 },
    { content: long, startMs: 12000, endMs: 52000, words: longWords },
  ];
  const segments: EntityId[] = [];
  for (const [i, p] of paragraphs.entries()) {
    const segment = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'segment', data: { text, order: `a${i}`, kind: 'paragraph', content: p.content, proofread: 0, origin } as Json });
    segments.push(segment);
    await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'alignment-span', data: { alignment, segment, startMs: p.startMs, endMs: p.endMs, ...(p.words ? { words: p.words } : {}), origin } as unknown as Json });
  }
  await catalog.submit(cs.id, 'bot:transcribe');
  await catalog.merge(cs.id, 'shmuly');
  return { event, recording, segments };
}

describe('the goal for the next model', () => {
  it('counts hours and fully checked farbrengens, and names the most wanted to check next', async () => {
    const { catalog, set } = await freshCatalog();
    const newer = await transcribed(catalog, set, 'https://example.org/a.mp3');
    const older = await transcribed(catalog, set, 'https://example.org/b.mp3', '5733-07-10');
    const heldOut = await transcribed(catalog, set, 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/JEMSK3113.mp3');
    let goal = await trainingGoal(catalog, await trainingClips(catalog));
    expect(goal).toMatchObject({ model: 'V4', hours: { done: 0, target: 34 }, farbrengens: { done: 0, target: 10 } });
    // The held-out farbrengen is never asked for; the one before 5740 comes first.
    expect(goal.next.map((f) => [f.event, f.mostWanted])).toEqual([
      [older.event, true],
      [newer.event, false],
    ]);

    // Every paragraph checked as heard.
    const check = async (segment: EntityId) => {
      const { content } = (await catalog.get(segment))!.data as { content: string };
      await catalog.merge((await fixParagraph(catalog, 'chaim', { segment, content })).id, 'keeper');
    };
    for (const segment of [...newer.segments, ...heldOut.segments]) await check(segment);
    goal = await trainingGoal(catalog, await trainingClips(catalog));
    expect(goal.farbrengens.done).toBe(1);
    expect(goal.hours.done).toBeCloseTo(52 / 3600, 2);
    expect(goal.next.map((f) => f.event)).toEqual([older.event]);
  });
});

describe('training clips from checked transcripts', () => {
  it('uses only paragraphs a person checked, in the training script format', async () => {
    const { catalog, set } = await freshCatalog();
    const { recording, segments } = await transcribed(catalog, set, 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/JEMSK%202957.mp3');
    expect((await trainingClips(catalog)).clips).toEqual([]);

    // Words checked, timing still the machine's: silver.
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[0]!, content: 'לחיים, לחיים טובים' })).id, 'keeper');
    // Timing set by a person too: gold.
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[1]!, content: 'עס שטייט אין פסוק' })).id, 'keeper');
    await catalog.merge((await anchorSync(catalog, 'chaim', { recording, segment: segments[1]!, atMs: 4000 })).id, 'keeper');

    const { clips, skipped } = await trainingClips(catalog);
    expect(clips.map((c) => [c.text, c.start, c.end, c.quality])).toEqual([
      ['לחיים, לחיים טובים', 0, 4, 'silver'],
      ['עס שטייט אין פסוק', 4, 8, 'gold'],
    ]);
    expect(clips[0]).toMatchObject({ audio: ['JEMSK 2957.mp3'], recording, segment: segments[0], group: 'site', section: 'site', pdf: null, split: splitOf(recording, 'JEMSK 2957.mp3') });
    expect(skipped).toEqual([]);

    const summary = summariseTraining({ clips, skipped }, '2000-01-01');
    expect(summary).toMatchObject({ clips: 2, gold: 1, silver: 1, recordings: 1, hours: 0, newHours: 0 });
  });

  it('leaves out a paragraph with words a listener marked unclear', async () => {
    const { catalog, set } = await freshCatalog();
    const { segments } = await transcribed(catalog, set, 'https://example.org/a.mp3');
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[1]!, content: 'עס שטייט אין [פסוק?]' })).id, 'keeper');
    const { clips, skipped } = await trainingClips(catalog);
    expect(clips).toEqual([]);
    expect(skipped).toEqual([{ segment: segments[1], reason: 'words marked unclear' }]);
  });

  it('cuts a long paragraph at its words, and waits for word timing when it has none', async () => {
    const { catalog, set } = await freshCatalog();
    const { segments } = await transcribed(catalog, set, 'https://example.org/a.mp3');
    const long = Array.from({ length: 10 }, (_, i) => `ווארט${'אבגדהוזחטי'[i]}אבגדהוזח`).join(' ');
    // Checked as it is: it keeps its word timings, and is cut between words into pieces Whisper can hear.
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[3]!, content: long })).id, 'keeper');
    let { clips, skipped } = await trainingClips(catalog);
    expect(clips.map((c) => [c.start, c.end, c.quality])).toEqual([
      [12, 40, 'silver'],
      [40, 52, 'silver'],
    ]);
    // Corrected, the word timings are let go until the align run times the new words.
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[3]!, content: `${long} טוב` })).id, 'keeper');
    ({ clips, skipped } = await trainingClips(catalog));
    expect(clips).toEqual([]);
    expect(skipped).toEqual([{ segment: segments[3], reason: 'long, waiting for word timing' }]);

    const words = long.split(' ').map((w, i, all) => {
      const from = all.slice(0, i).join(' ').length + (i ? 1 : 0);
      return word(from, from + w.length, 12000 + i * 4000, 16000 + i * 4000);
    });
    const pieces = piecesOf(long, { startMs: 12000, endMs: 52000, words })!;
    expect(pieces.map((p) => [p.startMs, p.endMs])).toEqual([
      [12000, 40000],
      [40000, 52000],
    ]);
    expect(pieces.map((p) => p.text).join(' ')).toBe(long);
    expect(piecesOf(long, { startMs: 12000, endMs: 52000 })).toBeNull();
  });

  it('keeps a recording in one split, the same on every run', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `rh-${String(i).padStart(6, '0')}` as EntityId);
    const tests = ids.filter((id) => splitOf(id, 'a.mp3') === 'test');
    expect(tests.length).toBeGreaterThan(5);
    expect(tests.length).toBeLessThan(40);
    expect(ids.map((id) => splitOf(id, 'a.mp3'))).toEqual(ids.map((id) => splitOf(id, 'a.mp3')));
    // The farbrengens the training script scores on are never trained on.
    expect(ids.every((id) => splitOf(id, 'JEMSK3113.mp3') === 'test')).toBe(true);
  });
});
