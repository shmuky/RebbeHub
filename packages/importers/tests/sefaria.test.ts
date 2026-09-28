import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { chabadTitles, cleanSegment, crawlSefaria, idForKey, readSefariaCrawl, runImport, sefariaAuthor, sefariaClient, sefariaImporter, sefariaLicence, type SefariaIndex } from '@rebbehub/importers';
import { freshCatalog } from '../../core/tests/helpers.js';

/**
 * A made-up Sefaria, answering by URL as the real API does: a table of
 * contents with three Chabad books, one of which Sichos-Kodesh publishes;
 * a book in two parts (a one-level title page and chapters), with a Hebrew
 * text under CC BY-NC and an English one whose licence is not one that
 * lets it be kept. None of the words are from any real book.
 */
const TOC = [
  { category: 'Tanakh', contents: [{ title: 'Genesis', heTitle: 'בראשית', categories: ['Tanakh'] }] },
  {
    category: 'Chasidut',
    contents: [
      {
        category: 'Chabad',
        contents: [
          { title: 'Tanya', heTitle: 'תניא', categories: ['Chasidut', 'Chabad'] },
          { title: 'Sources on Tanya', heTitle: 'מקורות', categories: ['Chasidut', 'Chabad'] },
          { title: 'Made Up Discourses', heTitle: 'מאמרים לדוגמה', categories: ['Chasidut', 'Chabad'] },
        ],
      },
    ],
  },
];

const INDEX: SefariaIndex = {
  title: 'Made Up Discourses',
  heTitle: 'מאמרים לדוגמה',
  categories: ['Chasidut', 'Chabad'],
  authors: [{ en: 'Shneur Zalman of Liadi', slug: 'shneur-zalman-of-liadi' }],
  schema: {
    nodes: [
      { title: 'Introduction', heTitle: 'הקדמה', key: 'Introduction', depth: 1, sectionNames: ['Paragraph'] },
      { title: 'Discourses', heTitle: 'מאמרים', key: 'Discourses', depth: 2, sectionNames: ['Chapter', 'Paragraph'], heSectionNames: ['פרק', 'פסקה'], content_counts: [2, 1] },
    ],
  },
};

const TEXTS: Record<string, unknown> = {
  'Made_Up_Discourses,_Introduction?version=hebrew': { versions: [{ versionTitle: 'Test Edition', license: 'CC-BY-NC', text: ['פתיחה <b>קצרה</b>'] }] },
  'Made_Up_Discourses,_Introduction?version=english': { versions: [] },
  // Too big to serve whole: asked for chapter by chapter.
  'Made_Up_Discourses,_Discourses?version=hebrew': { error: 'too big' },
  'Made_Up_Discourses,_Discourses_1?version=hebrew': { versions: [{ versionTitle: 'Test Edition', license: 'CC-BY-NC', text: ['אות א<sup class="footnote-marker">1</sup><i class="footnote">הערה <i>פנימית</i></i>', 'אות ב <i data-overlay="Pages" data-value="[דף ב]"></i>'] }] },
  'Made_Up_Discourses,_Discourses_2?version=hebrew': { versions: [{ versionTitle: 'Test Edition', license: 'CC-BY-NC', text: ['שנית'] }] },
  'Made_Up_Discourses,_Discourses?version=english': { versions: [{ versionTitle: 'Private Translation', license: 'Copyright', text: [['First'], ['Second']] }] },
};

const fakeSefaria = (asked: string[]) =>
  (async (url: string) => {
    asked.push(url);
    const path = url.replace('https://www.sefaria.org/api/', '');
    if (path === 'index') return new Response(JSON.stringify(TOC));
    if (path.startsWith('v2/index/Made_Up_Discourses')) return new Response(JSON.stringify(INDEX));
    const text = TEXTS[path.replace(/^v3\/texts\//, '')];
    return text ? new Response(JSON.stringify(text)) : new Response(JSON.stringify({ error: 'no such ref' }), { status: 400 });
  }) as unknown as typeof fetch;

let catalog: Catalog;
let dir: string;
beforeEach(async () => {
  ({ catalog } = await freshCatalog());
  dir = mkdtempSync(join(tmpdir(), 'rebbehub-sefaria-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Sefaria's Chabad books", () => {
  it('finds the Chabad books in the table of contents', () => {
    expect(chabadTitles(TOC).map((t) => t.title)).toEqual(['Tanya', 'Sources on Tanya', 'Made Up Discourses']);
  });

  it('reads licences, authors and segments as the texts need them', () => {
    expect(sefariaLicence('CC-BY-NC')).toBe('cc-by-nc');
    expect(sefariaLicence('Public Domain')).toBe('public-domain');
    expect(sefariaLicence('Copyright')).toBe('unknown');
    expect(sefariaAuthor('shneur-zalman-of-liadi')).toBe('alter-rebbe');
    expect(sefariaAuthor('Shalom Dovber Schneersohn')).toBe('rebbe-rashab');
    expect(sefariaAuthor('Someone Else')).toBeNull();
    const notes: string[] = [];
    expect(cleanSegment('a<sup class="footnote-marker">*</sup><i class="footnote">note <i>x</i></i> <span style="c">b</span> <script>no</script>', notes)).toBe('a<sup class="fn"><a href="#n1" id="r1">1</a></sup> b');
    expect(notes).toEqual(['note <i>x</i>']);
  });

  it('crawls the books Sichos-Kodesh does not publish, keeps only texts whose licence lets them be kept, and asks nothing twice', async () => {
    const asked: string[] = [];
    const client = sefariaClient({ fetch: fakeSefaria(asked), cacheDir: join(dir, 'cache'), delayMs: 0 });
    const crawl = await crawlSefaria({ out: join(dir, 'out'), exclude: new Set(['Tanya']), client });
    expect(crawl.books.map((b) => b.title)).toEqual(['Made Up Discourses']);
    const [book] = crawl.books;
    expect(book!.units.map((u) => [u.id, u.ref, u.label.he])).toEqual([
      ['1', 'Made Up Discourses, Introduction', 'הקדמה'],
      ['2/1', 'Made Up Discourses, Discourses 1', 'מאמרים, פרק א'],
      ['2/2', 'Made Up Discourses, Discourses 2', 'מאמרים, פרק ב'],
    ]);
    const chapter = book!.units[1]!;
    expect(chapter.texts.map((t) => [t.language, t.licence, Boolean(t.sha256)])).toEqual([
      ['he', 'cc-by-nc', true],
      ['en', 'unknown', false],
    ]);
    // Each kept text is on disk by its hash, and the English one is not kept at all.
    const { text } = await readSefariaCrawl(join(dir, 'out'));
    const html = (await text(chapter.texts[0]!.sha256!))!;
    expect(createHash('sha256').update(html).digest('hex')).toBe(chapter.texts[0]!.sha256);
    expect(html).toContain('<span class="mark">[דף ב]</span>');
    expect(html).toContain('<aside class="notes"><p id="n1"><a href="#r1">1</a> הערה <i>פנימית</i></p></aside>');
    expect(html).toContain('<span class="licence">CC BY-NC</span>');
    expect(html).not.toContain('First');
    expect(existsSync(join(dir, 'out', 'crawl.json'))).toBe(true);

    const before = asked.length;
    await crawlSefaria({ out: join(dir, 'out'), exclude: new Set(['Tanya']), client: sefariaClient({ fetch: fakeSefaria(asked), cacheDir: join(dir, 'cache'), delayMs: 0 }) });
    expect(asked.length).toBe(before);
  });

  it('makes each chapter a page with its words and its credit, and the other text a link', async () => {
    const client = sefariaClient({ fetch: fakeSefaria([]), delayMs: 0 });
    const crawl = await crawlSefaria({ out: join(dir, 'out'), exclude: new Set(['Tanya']), client });
    crawl.books[0]!.units[1]!.texts[0]!.kept = true;
    const { text } = await readSefariaCrawl(join(dir, 'out'));
    // The rebbehub-set and the genre sets need no works importer; the author does.
    const result = await runImport(catalog, sefariaImporter({ crawl, text, authors: new Set() }), { approveAs: 'shmuly' });
    expect(result.created).toBe(1 + 1 + 1 + 3); // the Sefaria set, a genre set, the book, three chapters
    const work = await catalog.get(await idForKey('sefaria-work:Made Up Discourses'));
    expect(work?.path).toBe('/sefaria/made-up-discourses');
    expect(work?.data).toMatchObject({ title: { he: 'מאמרים לדוגמה', en: 'Made Up Discourses' }, genre: 'maamarim', authors: [] });
    const chapter = await catalog.get(await idForKey('sefaria-unit:Made Up Discourses/2/1'));
    expect(chapter?.path).toBe('/sefaria/made-up-discourses/2/1');
    expect(chapter?.data).toMatchObject({
      label: { he: 'מאמרים, פרק א', en: 'Discourses, Chapter 1' },
      bodySource: { source: 'sefaria', licence: 'cc-by-nc', credit: 'Sefaria: Test Edition', rights: 'credit', url: 'https://www.sefaria.org/Made_Up_Discourses,_Discourses_1' },
      editions: [
        { source: 'sefaria', language: 'he', licence: 'cc-by-nc', credit: 'Sefaria: Test Edition' },
        { source: 'sefaria', language: 'en', licence: 'unknown' },
      ],
    });
    const body = (chapter!.data as { body: string; bodySource: { copy: string } }).body;
    expect(body).toContain('אות א');
    expect(body).not.toContain('First');
    expect((chapter!.data as { bodySource: { copy: string } }).bodySource.copy).toMatch(/^https:\/\/api\.rebbehub\.org\/v1\/texts\/[0-9a-f]{64}$/);
    // A text not yet on RebbeHub's storage is not linked as a copy there.
    expect((await catalog.get(await idForKey('sefaria-unit:Made Up Discourses/2/2')))?.data).not.toHaveProperty('bodySource.copy');
  });
});
