import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { fillShaars, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { entityFile, exportCommits, exportSnapshot, generateKeyPair, memorySink, parseTextSegments, shaarFile, syncFile, textFile, verifyManifest, writeDump } from '@rebbehub/mirror';
import { add, freshCatalog } from '../../core/tests/helpers.js';

let catalog: Catalog;
const ids: Record<string, EntityId> = {};

beforeAll(async () => {
  let set: EntityId;
  ({ catalog, set } = await freshCatalog());
  ids.set = set;
  ids.author = await add(catalog, 'shmuly', 'shmuly', 'author', { name: { he: 'הרבי', en: 'The Rebbe' }, kind: 'rebbe', rebbe: 7, slug: 'the-rebbe', sets: [set] });
  ids.event = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'יו״ד שבט תשי״א' }, date: '5711-05-10', sets: [set], externalIds: { 'mafteiach-occasion': '1' } }, '/events/5711-05-10');
  ids.work = await add(catalog, 'mendy', 'keeper', 'work', {
    title: { he: 'ספר המאמרים', en: 'Sefer Hamaamarim' },
    slug: 'sefer-hamaamarim',
    authors: [ids.author],
    genre: 'maamarim',
    levels: ['year', 'maamar'],
    sets: [set],
    sourceCopies: [{ source: 'chabadlibrary', sourceId: '42', kind: 'text', licence: 'free-to-read' }, { source: 'kehot', sourceId: 'x', kind: 'scan', licence: 'commercial' }],
  });
  ids.unit = await add(catalog, 'mendy', 'keeper', 'unit', {
    work: ids.work,
    position: [{ level: 'year', value: '5711', label: { he: 'תשי״א' } }, { level: 'maamar', value: 'basi-legani' }],
    order: 'V',
    label: { he: 'באתי לגני תשי״א', en: 'Basi Legani 5711' },
    date: '5711-05-10',
    events: [ids.event],
    externalIds: { 'sichos-kodesh-unit': 'maamorim-5711-1' },
    editions: [{ source: 'mafteiach', sourceId: 'm1', kind: 'pdf', licence: 'facts-and-links' }],
  });
  ids.text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit: ids.unit, language: 'he' });
  ids.seg1 = await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.text, order: 'V', kind: 'heading', content: 'באתי לגני', proofread: 1 });
  ids.seg2 = await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.text, order: 'k', kind: 'paragraph', content: 'באתי לגני אחותי כלה', proofread: 0, origin: { by: 'ocr:test@1' } });
  ids.closed = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', unit: ids.unit, language: 'he', licence: 'site-terms' });
  ids.secret = await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.closed, order: 'V', kind: 'paragraph', content: 'לא לפרסום', proofread: 0 });
  ids.recording = await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: 'הקלטה' }, url: 'https://example.org/a.mp3' });
  ids.alignment = await add(catalog, 'mendy', 'keeper', 'alignment', { recording: ids.recording, text: ids.text, granularity: 'word' });
  ids.span = await add(catalog, 'mendy', 'keeper', 'alignment-span', { alignment: ids.alignment, segment: ids.seg1, startMs: 1500, endMs: 4000, words: [{ from: 0, to: 4, startMs: 1500, endMs: 2500 }, { from: 5, to: 9, startMs: 2500, endMs: 4000 }], locked: true });
});

describe('the git mirror', () => {
  it('writes one file per item, texts as Markdown and sync as WebVTT', async () => {
    const sink = memorySink();
    const stats = await exportSnapshot(catalog, sink, await catalog.head());
    expect(stats.withheld).toBe(1);
    const event = JSON.parse(sink.files.get(entityFile('event', ids.event!))!);
    expect(event).toMatchObject({ id: ids.event, type: 'event', path: '/events/5711-05-10', data: { date: '5711-05-10' } });
    expect(sink.files.has(entityFile('segment', ids.seg1!))).toBe(false);

    const markdown = sink.files.get(textFile(ids.text!))!;
    expect(markdown).toContain(`<a id="${ids.seg1}"></a>`);
    expect(markdown).toContain('machine="ocr:test@1" checked=false');
    expect(parseTextSegments(markdown)).toEqual([
      { id: ids.seg1, order: 'V', kind: 'heading', proofread: 1, content: 'באתי לגני' },
      { id: ids.seg2, order: 'k', kind: 'paragraph', proofread: 0, content: 'באתי לגני אחותי כלה' },
    ]);

    const closed = sink.files.get(textFile(ids.closed!))!;
    expect(closed).toContain('withheld:');
    expect(closed).not.toContain('לא לפרסום');

    const vtt = sink.files.get(syncFile(ids.alignment!))!;
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain(`${ids.seg1}\n00:00:01.500 --> 00:00:04.000\n<00:00:01.500>באתי <00:00:02.500>לגני`);
    expect(vtt).toContain(`NOTE ${ids.seg1} locked`);
    expect(sink.files.get('COMMIT')).toBe(`${await catalog.head()}\n`);
  });

  it('applies later commits one by one, re-rendering the texts they touch', async () => {
    const sink = memorySink();
    const since = await catalog.head();
    await exportSnapshot(catalog, sink, since);
    const cs = await catalog.createChangeset('chaim', { title: 'Fix a word' });
    await catalog.putRevision(cs.id, 'chaim', { id: ids.seg2, type: 'segment', data: { text: ids.text!, order: 'k', kind: 'paragraph', content: 'באתי לגני אחותי כלה, לגנוני', proofread: 1 } });
    await catalog.submit(cs.id, 'chaim');
    await catalog.merge(cs.id, 'keeper');
    const seen: string[] = [];
    const last = await exportCommits(catalog, sink, since, async (c) => {
      seen.push(`${c.seq}:${c.author}:${c.message}`);
    });
    expect(seen).toEqual([`${since + 1}:chaim:Fix a word`]);
    expect(last).toBe(since + 1);
    expect(sink.files.get(textFile(ids.text!))).toContain('לגנוני');
  });

  it("writes a sefer's shaar file once it has one", async () => {
    const sink = memorySink();
    const since = await catalog.head();
    await exportSnapshot(catalog, sink, since);
    expect(sink.files.has(shaarFile(ids.work!))).toBe(false);
    await fillShaars(catalog);
    await exportCommits(catalog, sink, since);
    expect(sink.files.get(shaarFile(ids.work!))).toBe(
      `---\nshaar: 1\ntitle: ספר המאמרים\ntitle-en: Sefer Hamaamarim\nby: ${ids.author} (הרבי)\ngenre: maamarim\n---\n\n## סדר הספר | Structure\n\nהספר מחולק לשנים, וכל שנה למאמרים.\n`,
    );
  });
});

describe('dumps', () => {
  it('writes signed SQLite, JSON Lines and the Sichos-Kodesh release', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rebbehub-dump-'));
    const key = generateKeyPair(new Uint8Array(32).fill(7));
    const manifest = await writeDump(catalog, dir, { tag: '2026.40', at: await catalog.head(), key, now: new Date('2026-09-28T00:00:00Z') });
    expect(verifyManifest(manifest, { [key.keyId]: key.publicKey })).toEqual({ ok: true, keyId: key.keyId });
    expect(verifyManifest({ ...manifest, commit: 1 }, { [key.keyId]: key.publicKey })).toEqual({ ok: false, reason: 'bad-signature' });
    expect(manifest.files.map((f) => f.name)).toEqual(['rebbehub-2026.40.sqlite', 'rebbehub-2026.40.jsonl.gz', 'rebbehub-2026.40.parquet', 'sichos-kodesh-2026.40.json']);
    expect(manifest.withheld).toBe(1);

    const lines = gunzipSync(await readFile(join(dir, 'rebbehub-2026.40.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l) => l.id === ids.secret)).toBe(false);
    expect(lines.some((l) => l.id === ids.seg1)).toBe(true);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(dir, 'rebbehub-2026.40.sqlite'));
    expect(db.prepare("SELECT count(*) AS n FROM entity WHERE type = 'unit'").get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT reason FROM withheld WHERE id = ?').get(ids.secret!)).toBeDefined();
    db.close();

    // The Parquet file holds the same rows, read back with an independent reader.
    const { parquetMetadata, parquetReadObjects } = await import('hyparquet');
    const bytes = await readFile(join(dir, 'rebbehub-2026.40.parquet'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const rows = (await parquetReadObjects({ file: buffer })) as Array<{ id: string; type: string; path: string | null; rev: bigint; data: unknown }>;
    expect(rows).toHaveLength(lines.length);
    const unitRow = rows.find((r) => r.type === 'unit')!;
    expect(unitRow).toMatchObject({ id: ids.unit, path: null });
    expect(typeof unitRow.data === 'string' ? JSON.parse(unitRow.data) : unitRow.data).toMatchObject({ date: '5711-05-10' });
    expect(rows.some((r) => r.id === ids.secret)).toBe(false);
    expect(parquetMetadata(buffer).key_value_metadata).toContainEqual({ key: 'tag', value: '2026.40' });

    const release = JSON.parse(await readFile(join(dir, 'sichos-kodesh-2026.40.json'), 'utf8'));
    expect(release.authors).toEqual([{ id: 'the-rebbe', name: { he: 'הרבי', en: 'The Rebbe' }, rebbe: 7 }]);
    expect(release.works).toEqual([
      {
        id: 'sefer-hamaamarim',
        title: { he: 'ספר המאמרים', en: 'Sefer Hamaamarim' },
        authors: ['the-rebbe'],
        genre: 'maamarim',
        levels: ['year', 'maamar'],
        sources: [{ source: 'chabadlibrary', sourceId: '42', kind: 'text', licence: 'free-to-read' }],
      },
    ]);
    expect(release.imported).toEqual([
      {
        workId: 'sefer-hamaamarim',
        source: 'chabadlibrary',
        contents: [{ title: { he: 'תשי״א', en: 'תשי״א' }, entries: [{ unitId: 'maamorim-5711-1' }] }],
        units: [
          {
            id: 'maamorim-5711-1',
            workId: 'sefer-hamaamarim',
            label: 'באתי לגני תשי״א',
            labelEn: 'Basi Legani 5711',
            hebrewYear: 5711,
            hebrewDate: '5711-05-10',
            occasionIds: [1],
            editions: [{ source: 'mafteiach', sourceId: 'm1', kind: 'pdf', licence: 'facts-and-links' }],
          },
        ],
      },
    ]);
  });
});
