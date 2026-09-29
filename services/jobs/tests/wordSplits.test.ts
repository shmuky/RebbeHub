import { describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import { fixParagraph, recordingTranscript, registerFile } from '@rebbehub/core';
import { transcribeRecordings, type Transcriber } from '../src/transcribe.js';
import { mendTranscriptSplits, mendWordSplits, splitKey, vocabulary, type SplitParagraph } from '../src/wordSplits.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/** Word timings for a paragraph, one per word, back to back from `startMs`, 500 ms each. */
function timed(content: string, startMs: number) {
  const out: Array<{ from: number; to: number; startMs: number; endMs: number }> = [];
  for (const m of content.matchAll(/\S+/g)) out.push({ from: m.index, to: m.index + m[0].length, startMs: startMs + out.length * 500, endMs: startMs + (out.length + 1) * 500 });
  return out;
}

// What the other transcripts write: the whole words, never their halves side by side.
const vocab = vocabulary(['דער יו"ד איז', 'נאך א יו"ד', 'ערוואקסענע אידן', 'די ערוואקסענע', 'דערמיט איז', 'און דערמיט', 'דער מיט', 'דאס איז גוט', 'א אין']);

describe('words cut in two between paragraphs', () => {
  it('compares words without quote marks, final letters or punctuation at their ends, keeping a hyphen', () => {
    expect(splitKey('יו"ד,')).toBe('יוד');
    expect(splitKey('גאנצן')).toBe('גאנצנ');
    expect(splitKey('מסורת-נפש')).toBe('מסורת-נפש');
  });

  it('moves the rest of a cut word back onto the paragraph it was cut from, with its timing', () => {
    const a = 'יראה פון דעם י';
    const b = "וד, און ס'איז ניט סתם א יראה";
    const { paragraphs, mended } = mendWordSplits(
      [
        { content: a, startMs: 0, endMs: 2000, words: timed(a, 0) },
        { content: b, startMs: 2000, endMs: 5500, words: timed(b, 2000) },
      ],
      vocab,
    );
    expect(mended).toEqual([{ at: 0, word: 'יוד,' }]);
    expect(paragraphs[0]).toMatchObject({ content: 'יראה פון דעם יוד,', startMs: 0, endMs: 2500 });
    expect(paragraphs[0]!.words!.at(-1)).toEqual({ from: 13, to: 17, startMs: 1500, endMs: 2500 });
    expect(paragraphs[1]).toMatchObject({ content: "און ס'איז ניט סתם א יראה", startMs: 2500, endMs: 5500 });
    expect(paragraphs[1]!.words![0]).toEqual({ from: 0, to: 3, startMs: 2500, endMs: 3000 });
    // Every word timing still points at a whole word.
    for (const p of paragraphs) for (const w of p.words!) expect(p.content.slice(w.from, w.to)).toMatch(/^\S+$/);
  });

  it('joins a word whose first half is a word by itself only when the second half is not one', () => {
    const { paragraphs, mended } = mendWordSplits<SplitParagraph>([{ content: 'גרייטן זיך ביז ער' }, { content: 'וואקסענע און אידן' }], vocab);
    expect(mended).toEqual([{ at: 0, word: 'ערוואקסענע' }]);
    expect(paragraphs.map((p) => p.content)).toEqual(['גרייטן זיך ביז ערוואקסענע', 'און אידן']);
    expect(paragraphs[0]!.words).toBeNull();
  });

  it('leaves every break it is not sure of', () => {
    const cut = (a: string, b: string, more: Partial<{ fixed: boolean; gap: number }> = {}) =>
      mendWordSplits(
        [
          { content: a, words: timed(a, 0), fixed: more.fixed },
          { content: b, words: timed(b, a.split(' ').length * 500 + (more.gap ?? 0)) },
        ],
        vocab,
      ).mended;
    expect(cut('פון דעם י', 'וד און')).toHaveLength(1);
    expect(cut('פון דעם י.', 'וד און')).toEqual([]); // the paragraph ends a sentence
    expect(cut('פון דעם י', 'וד')).toEqual([]); // nothing would be left of the next one
    expect(cut('פון דעם י', 'וד און', { fixed: true })).toEqual([]); // a person checked it
    expect(cut('פון דעם י', 'וד און', { gap: 300 })).toEqual([]); // heard apart
    expect(cut('אז דער', 'מיט האט')).toEqual([]); // "דערמיט" is written, but so is "דער מיט"
    expect(cut('פון דעם ג', 'וט און')).toEqual([]); // "גוט" is written only once
    expect(cut('דאס איז א', 'ין')).toEqual([]); // "א" is a word by itself
    expect(cut('זאגט דעם', 'איז גוט')).toEqual([]); // two words, not halves of one
    // A garbled transcript, where Whisper wrote many words as lone letters, is left alone.
    const garbled = 'ז ד ז ל נ ך ד ס פון דעם י';
    expect(mendWordSplits([{ content: garbled }, { content: 'וד און' }], vocab).mended).toEqual([]);
  });

  it("mends a transcript in the catalog as the bot, one suggestion, and never a person's paragraph", async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await registerFile(catalog.db, { sha256: 'd'.repeat(64), bytes: 10, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, file: 'd'.repeat(64), sets: [set] });
    // Heard before the fix: pieces cut mid-word, with pauses between, so each is a paragraph of its own.
    const heard = ['יראה פון דעם י', "וד, און ס'איז ניט סתם א יראה.", 'גרייטן זיך ביז ער', 'וואקסענע און דער יו"ד, און נאך א יו"ד, ערוואקסענע און ערוואקסענע.'];
    const transcriber: Transcriber = { name: 'fake', version: '1', transcribe: async () => heard.map((text, i) => ({ startMs: i * 10_000, endMs: i * 10_000 + 5000, text })) };
    await transcribeRecordings(catalog, { approveAs: 'shmuly', transcriber, fetchAudio: async () => new Uint8Array([1]) });
    let view = (await recordingTranscript(catalog, recording))!;
    // A person checked the third paragraph as it is: the cut after it stays for them to fix.
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: view.paragraphs[2]!.id, content: 'גרייטן זיך ביז ער' })).id, 'keeper');

    const dry = await mendTranscriptSplits(catalog, { approveAs: 'shmuly', dryRun: true });
    expect(dry).toEqual([{ recording, mended: [{ at: 0, word: 'יוד,' }] }]);
    expect((await recordingTranscript(catalog, recording))!.paragraphs[0]!.content).toBe('יראה פון דעם י');

    expect(await mendTranscriptSplits(catalog, { approveAs: 'shmuly' })).toEqual(dry);
    view = (await recordingTranscript(catalog, recording))!;
    expect(view.paragraphs.map((p) => p.content)).toEqual(['יראה פון דעם יוד,', "און ס'איז ניט סתם א יראה.", 'גרייטן זיך ביז ער', heard[3]]);
    expect(view.paragraphs[0]).toMatchObject({ checked: false, by: 'transcribe:fake@1' });
    expect((await catalog.history(view.paragraphs[0]!.id as EntityId))[0]).toMatchObject({ author: 'bot:transcribe', mergedBy: 'shmuly' });
    expect((await catalog.history(view.paragraphs[1]!.id as EntityId))[0]!.changeset).toBe((await catalog.history(view.paragraphs[0]!.id as EntityId))[0]!.changeset);
    // Mended once: a second run finds nothing.
    expect(await mendTranscriptSplits(catalog, { approveAs: 'shmuly' })).toEqual([]);
  });
});
