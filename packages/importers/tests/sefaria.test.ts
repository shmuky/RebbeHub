import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { chabadTitles, chooseVersion, cleanSegment, crawlSefaria, dailyBooks, idForKey, readSefariaCrawl, runImport, sefariaAuthor, sefariaClient, sefariaImporter, sefariaLicence, type SefariaIndex, type SefariaVersionInfo } from '@rebbehub/importers';
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
    // Sefaria's own structure: numbered segments, a footnote pointed to from its segment, the page marker kept as one, the credit per version.
    expect((chapter!.data as { body: unknown }).body).toEqual({
      profile: 'sefaria',
      versions: [
        {
          id: 'he',
          language: 'he',
          title: 'Test Edition',
          credit: 'Sefaria: Test Edition',
          licence: 'cc-by-nc',
          url: 'https://www.sefaria.org/Made_Up_Discourses,_Discourses_1?vhe=Test_Edition',
          segments: [
            { id: '1', kind: 'verse', n: 1, text: [{ text: 'אות א' }, { note: 'n1' }] },
            { id: '2', kind: 'verse', n: 2, text: [{ text: 'אות ב ' }, { marker: '[דף ב]' }] },
          ],
          notes: [{ id: 'n1', kind: 'note', n: 1, text: [{ text: 'הערה ' }, { text: 'פנימית', marks: ['i'] }] }],
        },
      ],
    });
    expect(JSON.stringify((chapter!.data as { body: unknown }).body)).not.toContain('First');
    expect((chapter!.data as { bodySource: { copy: string } }).bodySource.copy).toMatch(/^https:\/\/api\.rebbehub\.org\/v1\/texts\/[0-9a-f]{64}$/);
    // A text not yet on RebbeHub's storage is not linked as a copy there.
    expect((await catalog.get(await idForKey('sefaria-unit:Made Up Discourses/2/2')))?.data).not.toHaveProperty('bodySource.copy');
  });
});

/**
 * The daily learning, from a made-up Sefaria as well: a Genesis whose
 * first Hebrew version is under CC BY-SA and whose public-domain one must
 * be asked for by name, and a Rashi on it three levels deep (chapter,
 * verse, comment). None of the words are from the real books.
 */
const DAILY_TOC = [
  { category: 'Tanakh', contents: [{ title: 'Genesis', heTitle: 'בראשית', categories: ['Tanakh', 'Torah'] }] },
  {
    category: 'Halakhah',
    contents: [
      {
        category: 'Mishneh Torah',
        contents: [
          { category: 'Introduction', contents: [{ title: 'Mishneh Torah, Positive Mitzvot', heTitle: 'משנה תורה, מצוות עשה', categories: ['Halakhah', 'Mishneh Torah', 'Introduction'] }] },
          { category: 'Sefer Madda', contents: [{ title: 'Mishneh Torah, Foundations of the Torah', heTitle: 'משנה תורה, הלכות יסודי התורה', categories: ['Halakhah', 'Mishneh Torah', 'Sefer Madda'] }] },
        ],
      },
      { title: 'Mishneh Torah Commentary', heTitle: 'פירוש', categories: ['Halakhah', 'Commentary'] },
    ],
  },
];
const TANACH_PD = "Tanach with Ta'amei Hamikra";
const RASHI_PD = "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934";
const DAILY: Record<string, unknown> = {
  index: DAILY_TOC,
  'v2/index/Genesis?with_content_counts=1': { title: 'Genesis', heTitle: 'בראשית', categories: ['Tanakh', 'Torah'], schema: { depth: 2, sectionNames: ['Chapter', 'Verse'], heSectionNames: ['פרק', 'פסוק'], content_counts: [2, 1] } },
  'v2/index/Rashi_on_Genesis?with_content_counts=1': {
    title: 'Rashi on Genesis',
    heTitle: 'רש"י על בראשית',
    categories: ['Tanakh', 'Rishonim on Tanakh', 'Rashi', 'Torah'],
    authors: [{ en: 'Rashi', slug: 'rashi' }],
    schema: { depth: 3, sectionNames: ['Chapter', 'Verse', 'Comment'], heSectionNames: ['פרק', 'פסוק', 'פירוש'], content_counts: [[2, 0, 1]] },
  },
  'texts/versions/Genesis': [
    { language: 'he', versionTitle: 'Miqra according to the Masorah', license: 'CC-BY-SA', priority: 2 },
    { language: 'he', versionTitle: TANACH_PD, license: 'Public Domain', priority: 1 },
    { language: 'en', versionTitle: 'A Private Translation', license: 'Copyright' },
  ],
  'texts/versions/Rashi_on_Genesis': [
    { language: 'he', versionTitle: RASHI_PD, license: 'Public Domain', priority: 4 },
    { language: 'en', versionTitle: RASHI_PD, license: 'Public Domain', priority: 5 },
  ],
  [`v3/texts/Genesis?version=hebrew|${TANACH_PD}`]: { versions: [{ versionTitle: TANACH_PD, license: 'Public Domain', text: [['פסוק ראשון', 'פסוק שני'], ['פסוק שלישי']] }] },
  'v3/texts/Genesis?version=english': { versions: [{ versionTitle: 'A Private Translation', license: 'Copyright', text: [['One', 'Two'], ['Three']] }] },
  [`v3/texts/Rashi_on_Genesis?version=hebrew|${RASHI_PD}`]: { versions: [{ versionTitle: RASHI_PD, license: 'Public Domain', text: [[['<b>דבור</b> פירוש', '<b>דבור שני</b> עוד'], [], ['<b>דבור שלישי</b> סוף']]] }] },
  // The English it names has none of this book: the primary English is asked for, and has none either.
  [`v3/texts/Rashi_on_Genesis?version=english|${RASHI_PD}`]: { versions: [] },
  'v3/texts/Rashi_on_Genesis?version=english': { versions: [] },
};
const dailySefaria = (asked: string[]) =>
  (async (url: string) => {
    const path = decodeURIComponent(url.replace('https://www.sefaria.org/api/', ''));
    asked.push(path);
    const answer = DAILY[path];
    return answer ? new Response(JSON.stringify(answer)) : new Response(JSON.stringify({ error: 'no such ref' }), { status: 400 });
  }) as unknown as typeof fetch;

describe('Chitas and the Rambam from Sefaria', () => {
  it('asks for a version whose licence lets its words be kept, not a translation filed under Hebrew', () => {
    const versions = DAILY['texts/versions/Genesis'] as SefariaVersionInfo[];
    expect(chooseVersion(versions, 'he', [TANACH_PD])).toBe(TANACH_PD);
    // Without a preference, the most prominent version that may be kept.
    expect(chooseVersion([...versions, { language: 'he', versionTitle: 'Tanach with Nikkud', license: 'Public Domain', priority: 3 }], 'he')).toBe('Tanach with Nikkud');
    // A preferred version under a licence that does not let it be kept is passed over.
    expect(chooseVersion(versions, 'he', ['Miqra according to the Masorah'])).toBe(TANACH_PD);
    expect(chooseVersion([{ language: 'he', versionTitle: 'Yiddish Tanakh [yi]', license: 'CC0' }, { language: 'he', versionTitle: 'Other', actualLanguage: 'fa', license: 'Public Domain' }], 'he')).toBeNull();
    expect(chooseVersion(versions, 'en')).toBeNull();
  });

  it('names each book, its path and the Hebrew versions to ask for', () => {
    const books = dailyBooks(DAILY_TOC);
    expect(books.map((b) => [b.title, b.heTitle, b.path])).toEqual([
      ['Genesis', 'בראשית', '/chumash/genesis'],
      ['Rashi on Genesis', 'רש״י על בראשית', '/chumash/rashi-genesis'],
      ['Exodus', 'שמות', '/chumash/exodus'],
      ['Rashi on Exodus', 'רש״י על שמות', '/chumash/rashi-exodus'],
      ['Leviticus', 'ויקרא', '/chumash/leviticus'],
      ['Rashi on Leviticus', 'רש״י על ויקרא', '/chumash/rashi-leviticus'],
      ['Numbers', 'במדבר', '/chumash/numbers'],
      ['Rashi on Numbers', 'רש״י על במדבר', '/chumash/rashi-numbers'],
      ['Deuteronomy', 'דברים', '/chumash/deuteronomy'],
      ['Rashi on Deuteronomy', 'רש״י על דברים', '/chumash/rashi-deuteronomy'],
      ['Psalms', 'תהלים', '/tehillim'],
      ['Mishneh Torah, Positive Mitzvot', 'משנה תורה, מצוות עשה', '/rambam/positive-mitzvot'],
      ['Mishneh Torah, Foundations of the Torah', 'משנה תורה, הלכות יסודי התורה', '/rambam/foundations-of-the-torah'],
      ['Sefer HaMitzvot', 'ספר המצוות', '/sefer-hamitzvos'],
    ]);
    expect(books.find((b) => b.title === 'Psalms')!.hebrew[0]).toBe(TANACH_PD);
    expect(books.find((b) => b.title.startsWith('Mishneh Torah'))!.hebrew).toEqual(['Torat Emet 363']);
    expect(books.find((b) => b.title === 'Sefer HaMitzvot')!.hebrew).toEqual(['Sefer HaMitzvot, Warsaw 1883']);
    expect(books.filter((b) => b.genre === 'halacha').length).toBe(3);
  });

  it('crawls them in their own Set, at their own paths, with Rashi grouped under each verse', async () => {
    const asked: string[] = [];
    const client = sefariaClient({ fetch: dailySefaria(asked), delayMs: 0 });
    const crawl = await crawlSefaria({ out: join(dir, 'out'), exclude: new Set(), client, only: ['Genesis', 'Rashi on Genesis'], daily: true });
    expect(asked).toContain(`v3/texts/Genesis?version=hebrew|${TANACH_PD}`);
    expect(asked).not.toContain('v3/texts/Genesis?version=hebrew');
    expect(crawl.books.map((b) => [b.title, b.heTitle, b.daily])).toEqual([
      ['Genesis', 'בראשית', { path: '/chumash/genesis', genre: 'chassidus' }],
      ['Rashi on Genesis', 'רש״י על בראשית', { path: '/chumash/rashi-genesis', genre: 'chassidus' }],
    ]);
    expect(crawl.books[0]!.units.map((u) => [u.id, u.texts.map((t) => [t.language, t.version, t.licence, Boolean(t.sha256)])])).toEqual([
      ['1', [['he', TANACH_PD, 'public-domain', true], ['en', 'A Private Translation', 'unknown', false]]],
      ['2', [['he', TANACH_PD, 'public-domain', true], ['en', 'A Private Translation', 'unknown', false]]],
    ]);

    const { text } = await readSefariaCrawl(join(dir, 'out'));
    const result = await runImport(catalog, sefariaImporter({ crawl, text, authors: new Set() }), { approveAs: 'shmuly' });
    expect(result.created).toBe(1 + 1 + 2 + 3); // the Sefaria set, the daily set, two books, three chapters
    const set = await catalog.get(await idForKey('rebbehub-set:chitas-rambam'));
    expect(set?.path).toBe('/sets/chitas-rambam');
    expect(set?.data).toMatchObject({ name: { he: 'חת״ת ורמב״ם', en: 'Chitas and Rambam' } });
    // No Chabad kind's Set: the daily books are not Chabad books.
    expect(await catalog.get(await idForKey('rebbehub-set:chassidus'))).toBeNull();
    const genesis = await catalog.get(await idForKey('sefaria-daily-work:Genesis'));
    expect(genesis?.path).toBe('/chumash/genesis');
    expect(genesis?.data).toMatchObject({ title: { he: 'בראשית', en: 'Genesis' }, slug: 'chumash-genesis', sets: [await idForKey('rebbehub-set:chitas-rambam')] });
    const verses = await catalog.get(await idForKey('sefaria-daily-unit:Genesis/1'));
    expect(verses?.path).toBe('/chumash/genesis/1');
    expect(verses?.data).toMatchObject({ bodySource: { licence: 'public-domain', credit: `Sefaria: ${TANACH_PD}`, rights: 'open' } });
    const body = (verses!.data as { body: { versions: Array<{ id: string; segments: Array<{ id: string }> }> } }).body;
    expect(body.versions.map((v) => [v.id, v.segments.map((s) => s.id)])).toEqual([['he', ['1', '2']]]);

    // Rashi: a section per verse that has comments (its id the verse), its comments under it (`<verse>.<n>`).
    const rashi = await catalog.get(await idForKey('sefaria-daily-unit:Rashi on Genesis/1'));
    expect(rashi?.path).toBe('/chumash/rashi-genesis/1');
    const [he] = (rashi!.data as { body: { versions: Array<{ segments: Array<{ id: string; kind: string; n: number; children?: Array<{ id: string; text: unknown }> }> }> } }).body.versions;
    expect(he!.segments.map((s) => [s.id, s.kind, s.n, s.children!.map((c) => c.id)])).toEqual([
      ['1', 'section', 1, ['1.1', '1.2']],
      ['3', 'section', 3, ['3.1']],
    ]);
    expect(he!.segments[0]!.children![0]!.text).toEqual([{ text: 'דבור', marks: ['b'] }, { text: ' פירוש' }]);
  });
});
