import { describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import { registerFile } from '@rebbehub/core';
import { paragraphs, recordingsToTranscribe, transcribeRecordings, type Transcriber } from '../src/transcribe.js';
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
