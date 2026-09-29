import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import { registerFile } from '@rebbehub/core';
import { localWhisper, paragraphs, recordingsToTranscribe, transcribeRecordings, type Transcriber } from '../src/transcribe.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

describe('machine transcription and sync', () => {
  it('gathers what was heard into paragraphs, breaking at pauses and after about a minute', () => {
    const heard = [
      { startMs: 0, endMs: 4000, text: 'א' },
      { startMs: 4500, endMs: 9000, text: 'ב' },
      { startMs: 15000, endMs: 20000, text: 'ג' }, // after a pause
      { startMs: 20500, endMs: 90000, text: 'ד' },
      { startMs: 90500, endMs: 95000, text: 'ה' }, // the paragraph is already over a minute
    ];
    expect(paragraphs(heard)).toEqual([
      { startMs: 0, endMs: 9000, text: 'א ב' },
      { startMs: 15000, endMs: 90000, text: 'ג ד' },
      { startMs: 90500, endMs: 95000, text: 'ה' },
    ]);
  });

  it("reads the local Whisper's lines, in milliseconds, without JEM's spoken opening", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'whisper-'));
    const script = join(dir, 'fake.mjs');
    const lines = [
      { start: 0, end: 1.84, text: 'This audio has been restored by JEM.', words: [['This', 0, 0.22]] },
      { start: 5.136, end: 6.5, text: 'עס זאל', words: [['עס', 5.136, 5.5], ['זאל', 5.6, 6.5]] },
      { start: 7, end: 8, text: 'קומען' },
    ];
    await writeFile(script, `${lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))})`).join(';')}; (await import('node:fs')).writeFileSync(${JSON.stringify(join(dir, 'args'))}, process.argv.slice(2).join(' '))`);
    expect(await localWhisper({ python: process.execPath, script }).transcribe('a.mp3', 'yi', dir)).toEqual([
      { startMs: 5136, endMs: 6500, text: 'עס זאל', words: [{ text: 'עס', startMs: 5136, endMs: 5500 }, { text: 'זאל', startMs: 5600, endMs: 6500 }] },
      { startMs: 7000, endMs: 8000, text: 'קומען' },
    ]);
    expect(await readFile(join(dir, 'args'), 'utf8')).toBe('a.mp3 --language yi --model ivrit-ai/yi-whisper-large-v3-turbo-ct2');
    expect(localWhisper().version).toBe('ivrit-ai/yi-whisper-large-v3-turbo');
    expect(localWhisper({ model: '/home/runner/models/rebbehub-whisper-v2' }).version).toBe('rebbehub-whisper-v2');
  });

  it("adds a served recording's transcript and its sync, once, as the bot, approved by a steward", async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await registerFile(catalog.db, { sha256: 'd'.repeat(64), bytes: 10, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const served = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, file: 'd'.repeat(64), sets: [set] });
    const linked = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה ב׳' }, url: 'https://example.org/b.mp3', sets: [set] });
    expect((await recordingsToTranscribe(catalog)).map((r) => r.id)).toEqual([served]);
    expect((await recordingsToTranscribe(catalog, { linked: true })).map((r) => r.id).sort()).toEqual([served, linked].sort());

    const transcriber: Transcriber = {
      name: 'fake',
      version: '1',
      transcribe: async (_audio, language) => {
        expect(language).toBe('yi');
        return [
          { startMs: 0, endMs: 5000, text: 'לחיים' },
          { startMs: 9000, endMs: 12000, text: 'עס שטייט' },
        ];
      },
    };
    const done = await transcribeRecordings(catalog, { approveAs: 'shmuly', transcriber, fetchAudio: async () => new Uint8Array([1]) });
    expect(done).toEqual([{ recording: served, paragraphs: 2 }]);

    const [text] = await catalog.list({ type: 'text' });
    expect(text!.data).toMatchObject({ kind: 'transcript', recording: served, language: 'yi' });
    const segments = await catalog.list({ type: 'segment' });
    expect(segments.map((s) => s.data).sort((a, b) => ((a as { order: string }).order < (b as { order: string }).order ? -1 : 1))).toMatchObject([
      { content: 'לחיים', proofread: 0, origin: { by: 'transcribe:fake@1' } },
      { content: 'עס שטייט', proofread: 0 },
    ]);
    const spans = await catalog.list({ type: 'alignment-span' });
    expect(spans.map((s) => (s.data as { startMs: number }).startMs).sort((a, b) => a - b)).toEqual([0, 9000]);
    expect(await recordingsToTranscribe(catalog)).toEqual([]);
    expect((await catalog.history(text!.id as EntityId))[0]).toMatchObject({ author: 'bot:transcribe', mergedBy: 'shmuly' });

    // Read with its sync, and a paragraph fixed by a person is marked checked.
    const { fixParagraph, recordingTranscript } = await import('@rebbehub/core');
    const view = (await recordingTranscript(catalog, served))!;
    expect(view.paragraphs).toMatchObject([
      { content: 'לחיים', startMs: 0, endMs: 5000, checked: false, by: 'transcribe:fake@1' },
      { content: 'עס שטייט', startMs: 9000, endMs: 12000, checked: false },
    ]);
    const fix = await fixParagraph(catalog, 'chaim', { segment: view.paragraphs[1]!.id, content: 'עס שטייט אין פסוק' });
    await catalog.merge(fix.id, 'keeper');
    expect((await recordingTranscript(catalog, served))!.paragraphs[1]).toMatchObject({ content: 'עס שטייט אין פסוק', checked: true, startMs: 9000 });
  });
});

describe('word-level sync', () => {
  it('keeps the word times Whisper gives, and aligns a corrected transcript and the hanacha afresh', async () => {
    const { alignRecordings, recordingsToAlign } = await import('../src/transcribe.js');
    const { fixParagraph, recordingTranscript, anchorSync, hanachaSync } = await import('@rebbehub/core');
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await registerFile(catalog.db, { sha256: 'd'.repeat(64), bytes: 10, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, file: 'd'.repeat(64), sets: [set] });
    const heard = [
      { startMs: 0, endMs: 2000, text: 'לחיים עס', words: [{ text: 'לחיים', startMs: 0, endMs: 1000 }, { text: 'עס', startMs: 1000, endMs: 2000 }] },
      { startMs: 5000, endMs: 7000, text: 'שטייט אין', words: [{ text: 'שטייט', startMs: 5000, endMs: 6000 }, { text: 'אין', startMs: 6000, endMs: 7000 }] },
    ];
    const transcriber: Transcriber = { name: 'fake', version: '2', transcribe: async () => heard };
    await transcribeRecordings(catalog, { approveAs: 'shmuly', transcriber, fetchAudio: async () => new Uint8Array([1]) });
    let view = (await recordingTranscript(catalog, recording))!;
    expect(view.granularity).toBe('word');
    expect(view.paragraphs.map((p) => p.words?.map((w) => w.startMs))).toEqual([[0, 1000], [5000, 6000]]);
    expect(await recordingsToAlign(catalog)).toEqual([]);

    // A person corrects the second paragraph and fixes where the first is heard: its word times go, and it is locked.
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: view.paragraphs[1]!.id, content: 'שטייט דאך אין' })).id, 'keeper');
    await catalog.merge((await anchorSync(catalog, 'chaim', { recording, segment: view.paragraphs[0]!.id, atMs: 500 })).id, 'keeper');
    expect((await recordingsToAlign(catalog)).map((r) => r.id)).toEqual([recording]);

    // The farbrengen's hanacha is in the catalog too.
    const author = await add(catalog, 'mendy', 'keeper', 'author', { name: { he: 'הרבי' }, kind: 'rebbe', slug: 'the-rebbe', sets: [set] });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'התוועדויות' }, slug: 'hisvaaduyos', authors: [author], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'a', label: { he: 'שיחה א' }, events: [event], sets: [set] });
    const hanacha = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', unit, language: 'he' });
    await add(catalog, 'mendy', 'keeper', 'segment', { text: hanacha, order: 'a', kind: 'paragraph', content: 'לחיים', proofread: 1 });
    await add(catalog, 'mendy', 'keeper', 'segment', { text: hanacha, order: 'b', kind: 'paragraph', content: 'כמו שכתוב אין', proofread: 1 });

    const done = await alignRecordings(catalog, { approveAs: 'shmuly', transcriber, fetchAudio: async () => new Uint8Array([1]) });
    expect(done).toEqual([{ recording, words: 3, hanacha: 2 }]);
    view = (await recordingTranscript(catalog, recording))!;
    // The locked paragraph is left as the person set it; the corrected one is timed word by word, "דאך" between its neighbours.
    expect(view.paragraphs[0]).toMatchObject({ locked: true, startMs: 500 });
    expect(view.paragraphs[1]!.words!.map((w) => [w.startMs, w.endMs])).toEqual([[5000, 6000], [6000, 6000], [6000, 7000]]);
    expect(view.paragraphs[1]).toMatchObject({ syncChecked: false });
    const synced = (await hanachaSync(catalog, recording))!;
    expect(synced.paragraphs.map((p) => p.startMs !== null)).toEqual([true, true]);
    expect((await catalog.history(synced.alignment))[0]).toMatchObject({ author: 'bot:align', mergedBy: 'shmuly' });
  });
});
