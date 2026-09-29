import { describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import {
  anchorSync,
  chooseSeed,
  claimNext,
  comparePrintings,
  confirmPage,
  confirmSync,
  fixLine,
  fixParagraph,
  machineToCheck,
  printingsOf,
  projectTodo,
  recordingTranscript,
  registerFile,
  scanProgress,
  scanText,
  uploadOcr,
  type Catalog,
  type Json,
} from '@rebbehub/core';
import { add, freshCatalog, yudShvat } from './helpers.js';

async function scanWithMachineText(catalog: Catalog, set: EntityId, pages: string[][]) {
  await registerFile(catalog.db, { sha256: 'a'.repeat(64), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
  const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, sets: [set] });
  const scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication, file: 'a'.repeat(64), completeness: 'complete', sets: [set] });
  await catalog.createAccount({ id: 'bot:ocr', displayName: 'Machine OCR', isBot: true });
  const cs = await catalog.createChangeset('bot:ocr', { title: 'OCR' });
  const layer = await catalog.putRevision(cs.id, 'bot:ocr', { type: 'text-layer', data: { scan, kind: 'machine-ocr', engine: { name: 'tesseract-heb', version: '5.3' } } as Json });
  await catalog.putRevision(cs.id, 'bot:ocr', { type: 'text-layer', data: { scan, kind: 'community', seededFrom: layer } as Json });
  for (const [i, lines] of pages.entries()) {
    await catalog.putRevision(cs.id, 'bot:ocr', { type: 'text-page', data: { layer, page: i + 1, lines: lines.map((text, k) => ({ id: `l${k + 1}`, text })), proofread: 0 } as unknown as Json });
  }
  await catalog.submit(cs.id, 'bot:ocr');
  await catalog.merge(cs.id, 'shmuly');
  return { scan, publication, layer };
}

describe('proofread levels', () => {
  it('colours pages as they are checked: once when every line is, twice by a second person', async () => {
    const { catalog, set } = await freshCatalog();
    const { scan } = await scanWithMachineText(catalog, set, [['שורה א', 'שורה ב'], ['עמוד ב']]);
    expect(await scanProgress(catalog, scan)).toEqual({ pages: 2, levels: [0, 0] });

    // One line fixed: the page is not yet proofread.
    await catalog.merge((await fixLine(catalog, 'chaim', { scan, page: 1, line: 'l1', text: 'שורה א׳' })).id, 'keeper');
    expect((await scanText(catalog, scan, 1))!).toMatchObject({ level: 0, lines: [{ level: 1 }, { level: 0 }] });

    // Chaim reads the page through: proofread once.
    await catalog.merge((await confirmPage(catalog, 'chaim', { scan, page: 1, fixes: { l2: 'שורה ב׳' } })).id, 'keeper');
    expect((await scanText(catalog, scan, 1))!).toMatchObject({ level: 1, lines: [{ text: 'שורה א׳', level: 1 }, { text: 'שורה ב׳', level: 1 }] });
    // He cannot also be the second reader; Mendy can.
    await expect(confirmPage(catalog, 'chaim', { scan, page: 1 })).rejects.toThrow(/someone else/);
    await catalog.merge((await confirmPage(catalog, 'mendy', { scan, page: 1 })).id, 'keeper');
    expect(await scanProgress(catalog, scan)).toEqual({ pages: 2, levels: [2, 0] });
    await expect(confirmPage(catalog, 'mendy', { scan, page: 1 })).rejects.toThrow(/twice/);
  });
});

describe('uploaded OCR', () => {
  it("adds someone's OCR as its own layer, and keepers pick it to seed the community text, checked lines kept", async () => {
    const { catalog, set } = await freshCatalog();
    const { scan, layer: machine } = await scanWithMachineText(catalog, set, [['שורח א', 'שורח ב']]);
    await catalog.merge((await fixLine(catalog, 'chaim', { scan, page: 1, line: 'l1', text: 'שורה א (נבדקה)' })).id, 'keeper');

    await expect(uploadOcr(catalog, 'mendy', { scan, content: 'x', engine: { name: '', version: '' } })).rejects.toThrow(/name the OCR program/);
    const upload = await uploadOcr(catalog, 'mendy', { scan, content: 'שורה א\nשורה ב\fעמוד ב', engine: { name: 'ABBYY FineReader', version: '16' } });
    expect(upload).toMatchObject({ status: 'open', pages: 2, lines: 3 });
    await catalog.merge(upload.id, 'keeper');

    let view = (await scanText(catalog, scan, 1))!;
    const uploaded = view.layers.find((l) => l.kind === 'uploaded-ocr')!;
    expect(uploaded).toMatchObject({ engine: { name: 'ABBYY FineReader', version: '16' }, uploadedBy: 'mendy', seeds: false });
    expect(view.layers.find((l) => l.id === machine)!.seeds).toBe(true);

    // Only keepers pick.
    await expect(chooseSeed(catalog, 'chaim', { scan, layer: uploaded.id })).rejects.toThrow(/keepers/);
    const pick = await chooseSeed(catalog, 'keeper', { scan, layer: uploaded.id });
    await catalog.merge(pick.id, 'shmuly');
    view = (await scanText(catalog, scan, 1))!;
    expect(view.engine).toMatchObject({ name: 'ABBYY FineReader' });
    // The line Chaim checked stays; the rest comes from the upload.
    expect(view.lines.map((l) => [l.text, l.level])).toEqual([
      ['שורה א (נבדקה)', 1],
      ['שורה ב', 0],
    ]);
    // Page 2 exists only in the upload, and now shows.
    expect((await scanText(catalog, scan, 2))!.lines.map((l) => l.text)).toEqual(['עמוד ב']);
  });
});

describe('proofreading and sync projects', () => {
  it('counts pages proofread, and hands out the next page nobody holds', async () => {
    const { catalog, set } = await freshCatalog();
    const { scan } = await scanWithMachineText(catalog, set, [['א'], ['ב'], ['ג']]);
    await catalog.openFocusProject('keeper', { slug: 'proofread-vol', name: 'הגהת הכרך', set, focus: { missing: 'proofreading', scan } });
    await catalog.merge((await confirmPage(catalog, 'chaim', { scan, page: 1 })).id, 'keeper');
    const [project] = await catalog.projects({ slug: 'proofread-vol' });
    expect(project).toMatchObject({ total: 3, done: 1 });
    expect((await projectTodo(catalog, project!)).map((t) => t.item)).toEqual(['page:2', 'page:3']);

    const first = await claimNext(catalog, 'proofread-vol', 'chaim');
    expect(first).toMatchObject({ item: 'page:2', kind: 'page', page: 2, id: scan, claimedBy: 'chaim' });
    // Asking again gives him the same page; Mendy gets the next.
    expect((await claimNext(catalog, 'proofread-vol', 'chaim'))!.item).toBe('page:2');
    expect((await claimNext(catalog, 'proofread-vol', 'mendy'))!.item).toBe('page:3');
    expect(await claimNext(catalog, 'shmuly', 'shmuly').catch((e) => e.message)).toMatch(/not found/);
    expect(await claimNext(catalog, 'proofread-vol', 'shmuly')).toBeNull();
    // A lapsed claim goes back to the pile.
    await catalog.db.query("UPDATE project_claim SET claimed_at = now() - interval '4 hours' WHERE item = 'page:3'");
    expect((await claimNext(catalog, 'proofread-vol', 'shmuly'))!.item).toBe('page:3');
  });

  it("hands out recordings to sync, done when all of a recording's sync is checked", async () => {
    const { catalog, set } = await freshCatalog();
    const { recording } = await transcribed(catalog, set);
    await catalog.openFocusProject('keeper', { slug: 'sync-5742', name: 'סנכרון תשמ״ב', set, focus: { missing: 'sync', within: '5742' } });
    expect((await catalog.projects({ slug: 'sync-5742' }))[0]).toMatchObject({ total: 1, done: 0 });
    expect(await claimNext(catalog, 'sync-5742', 'chaim')).toMatchObject({ item: recording, kind: 'recording' });
    await catalog.merge((await confirmSync(catalog, 'chaim', { recording })).id, 'keeper');
    expect((await catalog.projects({ slug: 'sync-5742' }))[0]).toMatchObject({ total: 1, done: 1 });
    expect(await claimNext(catalog, 'sync-5742', 'chaim')).toBeNull();
  });
});

async function transcribed(catalog: Catalog, set: EntityId) {
  const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
  const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, url: 'https://example.org/a.mp3', sets: [set] });
  await catalog.createAccount({ id: 'bot:transcribe', displayName: 'Machine transcription', isBot: true });
  const cs = await catalog.createChangeset('bot:transcribe', { title: 'Transcript' });
  const origin = { by: 'transcribe:fake@1' };
  const text = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'text', data: { kind: 'transcript', recording, language: 'yi' } as Json });
  const alignment = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'alignment', data: { recording, text, granularity: 'word' } as Json });
  const paragraphs = [
    { content: 'לחיים לחיים', startMs: 0, endMs: 4000, words: [{ from: 0, to: 5, startMs: 0, endMs: 2000 }, { from: 6, to: 11, startMs: 2000, endMs: 4000 }] },
    { content: 'עס שטייט', startMs: 4000, endMs: 8000, words: [{ from: 0, to: 2, startMs: 4000, endMs: 6000 }, { from: 3, to: 8, startMs: 6000, endMs: 8000 }] },
    { content: 'אין פסוק', startMs: 8000, endMs: 12000 },
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

describe('word-level sync and fixing it', () => {
  it('gives each paragraph its word timings, marked as machine sync', async () => {
    const { catalog, set } = await freshCatalog();
    const { recording } = await transcribed(catalog, set);
    const view = (await recordingTranscript(catalog, recording))!;
    expect(view.granularity).toBe('word');
    expect(view.paragraphs[0]).toMatchObject({ words: [{ from: 0, to: 5 }, { from: 6, to: 11 }], locked: false, syncChecked: false, checked: false });
    expect(view.paragraphs[2]!.words).toBeNull();
  });

  it('"the Rebbe is saying this line now": sets the line there, locks it, and moves what follows', async () => {
    const { catalog, set } = await freshCatalog();
    const { recording, segments } = await transcribed(catalog, set);
    const fix = await anchorSync(catalog, 'chaim', { recording, segment: segments[1]!, atMs: 5000 });
    expect(fix.status).toBe('open');
    expect(fix.spans.map((s) => [s.startMs, s.endMs, s.locked])).toEqual([
      [0, 5000, false], // the line before ends where this one now starts
      [5000, 9000, true],
      [9000, 13000, false], // moved with it
    ]);
    await catalog.merge(fix.id, 'keeper');
    let view = (await recordingTranscript(catalog, recording))!;
    expect(view.paragraphs.map((p) => [p.startMs, p.locked, p.syncChecked])).toEqual([
      [0, false, false],
      [5000, true, true],
      [9000, false, false],
    ]);
    expect(view.paragraphs[1]!.words!.map((w) => w.startMs)).toEqual([5000, 7000]);

    // A fix before a locked line stretches what is between to fit, and leaves the locked line where it is.
    const again = await anchorSync(catalog, 'mendy', { recording, segment: segments[0]!, atMs: 1000 });
    await catalog.merge(again.id, 'keeper');
    view = (await recordingTranscript(catalog, recording))!;
    expect(view.paragraphs.map((p) => p.startMs)).toEqual([1000, 5000, 9000]);
    expect(view.paragraphs[0]!.words!.map((w) => w.startMs)).toEqual([1000, 2600]);

    // A word, tapped: the paragraph moves so that word is heard now.
    const byWord = await anchorSync(catalog, 'chaim', { recording, segment: segments[1]!, word: 1, atMs: 7500 });
    expect(byWord.spans.find((s) => s.segment === segments[1])).toMatchObject({ startMs: 5500, words: [{ startMs: 5500 }, { startMs: 7500 }] });
    await expect(anchorSync(catalog, 'chaim', { recording, segment: segments[1]!, word: 9, atMs: 1 })).rejects.toThrow(/word 9/);
  });

  it('lets go of word timings when a paragraph is corrected', async () => {
    const { catalog, set } = await freshCatalog();
    const { recording, segments } = await transcribed(catalog, set);
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[0]!, content: 'לחיים, לחיים טובים' })).id, 'keeper');
    const view = (await recordingTranscript(catalog, recording))!;
    expect(view.paragraphs[0]).toMatchObject({ content: 'לחיים, לחיים טובים', words: null, startMs: 0, checked: true });
  });
});

describe('compare printings of a unit', () => {
  it("lists a unit's printings and compares two, word by word", async () => {
    const { catalog, set } = await freshCatalog();
    const author = await add(catalog, 'mendy', 'keeper', 'author', { name: { he: 'הרבי' }, kind: 'rebbe', slug: 'the-rebbe', sets: [set] });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'לקוטי שיחות' }, slug: 'ls', authors: [author], genre: 'sichos', levels: ['volume', 'sicha'], sets: [set] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '1' }], order: 'a', label: { he: 'שיחה א' }, sets: [set] });
    const textOf = async (publisher: string, paragraphs: string[]) => {
      const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'לקוטי שיחות חלק א' }, publisher, work, sets: [set] });
      const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit, publication, language: 'he' });
      for (const [i, content] of paragraphs.entries()) await add(catalog, 'mendy', 'keeper', 'segment', { text, order: `a${i}`, kind: 'paragraph', content, proofread: 1 });
      return text;
    };
    const first = await textOf('קה״ת', ['בפרשתנו מסופר', 'ויאמר משה']);
    const second = await textOf('ועד הנחות', ['בפרשתנו מסופר', 'ויאמר משה רבינו']);
    const printings = await printingsOf(catalog, unit);
    expect(printings.map((p) => p.key).sort()).toEqual([`text:${first}`, `text:${second}`].sort());
    expect(printings[0]!.label.he).toMatch(/לקוטי שיחות חלק א \(/);
    const diff = await comparePrintings(catalog, `text:${first}`, `text:${second}`);
    expect(diff).toMatchObject({ same: 4, removed: 0, added: 1, a: { checked: true } });
    expect(diff.runs.at(-1)).toEqual({ op: 'added', text: 'רבינו' });
    await expect(comparePrintings(catalog, 'nonsense', `text:${first}`)).rejects.toThrow(/a printing is/);
  });
});

describe('what the machines wrote for people to check', () => {
  it('lists transcripts and OCR scans with something unchecked, and drops what people finished', async () => {
    const { catalog, set } = await freshCatalog();
    expect(await machineToCheck(catalog)).toEqual({ transcripts: [], scans: [], totals: { transcripts: 0, paragraphs: 0, scans: 0, pages: 0 } });
    const { event, segments } = await transcribed(catalog, set);
    const { scan } = await scanWithMachineText(catalog, set, [['שורה א'], ['עמוד ב']]);

    let list = await machineToCheck(catalog);
    expect(list.transcripts).toMatchObject([{ event, paragraphs: 3, checked: 0 }]);
    expect(list.scans).toMatchObject([{ scan, pages: 2, checked: 0 }]);
    expect(list.totals).toEqual({ transcripts: 1, paragraphs: 3, scans: 1, pages: 2 });

    await catalog.merge((await confirmPage(catalog, 'chaim', { scan, page: 1 })).id, 'keeper');
    await catalog.merge((await fixParagraph(catalog, 'chaim', { segment: segments[0]!, content: 'לחיים לחיים' })).id, 'keeper');
    list = await machineToCheck(catalog);
    expect(list.totals).toEqual({ transcripts: 1, paragraphs: 2, scans: 1, pages: 1 });

    await catalog.merge((await confirmPage(catalog, 'chaim', { scan, page: 2 })).id, 'keeper');
    for (const segment of segments.slice(1)) await catalog.merge((await fixParagraph(catalog, 'chaim', { segment, content: 'אין פסוק' })).id, 'keeper');
    expect((await machineToCheck(catalog)).totals).toEqual({ transcripts: 0, paragraphs: 0, scans: 0, pages: 0 });
  });
});
