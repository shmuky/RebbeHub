import { describe, expect, it } from 'vitest';
import { recordingTranscript, registerFile, type Json } from '@rebbehub/core';
import { restoreWordTimes } from '../src/restoreWordTimes.js';
import { transcribeRecordings, type Transcriber } from '../src/transcribe.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

describe('word timings back for paragraphs fixed before fixes kept them', () => {
  it('carries a span’s last word timings to the paragraph as it now stands', async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await registerFile(catalog.db, { sha256: 'e'.repeat(64), bytes: 10, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, file: 'e'.repeat(64), sets: [set] });
    const heard = [{ startMs: 0, endMs: 3000, text: 'לחיים עס שטייט', words: [{ text: 'לחיים', startMs: 0, endMs: 1000 }, { text: 'עס', startMs: 1000, endMs: 2000 }, { text: 'שטייט', startMs: 2000, endMs: 3000 }] }];
    const transcriber: Transcriber = { name: 'fake', version: '1', transcribe: async () => heard };
    await transcribeRecordings(catalog, { approveAs: 'shmuly', transcriber, fetchAudio: async () => new Uint8Array([1]) });
    const p = (await recordingTranscript(catalog, recording))!.paragraphs[0]!;

    // A fix as they were made before: the words changed, the word timings let go.
    const span = (await catalog.get(p.span!))!;
    const segment = (await catalog.get(p.id))!;
    const { words: _dropped, ...rest } = span.data as Record<string, unknown>;
    const fix = await catalog.createChangeset('chaim', { title: 'תיקון תמלול' });
    await catalog.putRevision(fix.id, 'chaim', { id: segment.id, type: 'segment', data: { ...(segment.data as Record<string, unknown>), content: 'לחיים, עס שטייט דאך' } as Json });
    await catalog.putRevision(fix.id, 'chaim', { id: span.id, type: 'alignment-span', data: rest as Json });
    await catalog.submit(fix.id, 'chaim');
    await catalog.merge(fix.id, 'keeper');
    expect((await recordingTranscript(catalog, recording))!.paragraphs[0]!.words).toBeNull();

    expect(await restoreWordTimes(catalog, { approveAs: 'shmuly', dryRun: true })).toEqual([{ recording, paragraphs: 1 }]);
    expect((await recordingTranscript(catalog, recording))!.paragraphs[0]!.words).toBeNull();

    expect(await restoreWordTimes(catalog, { approveAs: 'shmuly' })).toEqual([{ recording, paragraphs: 1 }]);
    const view = (await recordingTranscript(catalog, recording))!;
    expect(view.paragraphs[0]!.words!.map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
      [3000, 3000],
    ]);
    // Machine sync still, and nothing left to give back.
    expect(view.paragraphs[0]!.syncChecked).toBe(false);
    expect(await restoreWordTimes(catalog, { approveAs: 'shmuly' })).toEqual([]);
  });
});
