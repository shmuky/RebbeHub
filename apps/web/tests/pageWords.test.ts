import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import type { EntityId, PageText } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * A page's words drawn by the display rules of where they came from, as
 * the built site renders them on the server. The words are invented for
 * the test.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
let handle: (request: Request) => Promise<Response>;
const ids: Record<string, EntityId> = {};

const SEFARIA: PageText = {
  profile: 'sefaria',
  versions: [
    {
      id: 'he',
      language: 'he',
      title: 'Test Edition',
      credit: 'Sefaria: Test Edition',
      licence: 'cc-by-nc',
      url: 'https://www.sefaria.org/Sample_1?vhe=Test_Edition',
      segments: [
        {
          id: '14',
          kind: 'section',
          n: 14,
          text: [{ text: 'פרק יד' }],
          children: [{ id: '14.3', kind: 'verse', n: 3, text: [{ text: 'אות ' }, { text: 'שלישית', marks: ['b'] }, { note: 'n1' }, { marker: '[דף ב]' }] }],
        },
      ],
      notes: [{ id: 'n1', kind: 'note', n: 1, text: [{ text: 'הערה לדוגמה' }] }],
    },
    {
      id: 'en',
      language: 'en',
      title: 'Sample Translation',
      credit: 'Sefaria: Sample Translation',
      licence: 'cc-by',
      segments: [{ id: '14', kind: 'section', n: 14, text: [{ text: 'Chapter 14' }], children: [{ id: '14.3', kind: 'verse', n: 3, text: [{ text: 'The third letter', href: 'https://example.org/x' }] }] }],
    },
  ],
};

const OUTLINE: PageText = {
  profile: 'outline',
  versions: [{ id: 'he', language: 'he', segments: [{ id: 'contents', kind: 'section', text: [{ text: 'תוכן ענינים' }], children: [{ id: 'contents.1', kind: 'item', n: 1, text: [{ text: 'נושא ראשון' }] }, { id: 'contents.2', kind: 'item', n: 2, text: [{ text: '<script>alert(1)</script>' }] }] }] }],
};

const LIBRARY: PageText = {
  profile: 'chabad-library',
  versions: [
    {
      id: 'he',
      language: 'he',
      credit: 'ספריית ליובאוויטש',
      url: 'https://chabadlibrary.org/books/11',
      segments: [{ id: 'p1', kind: 'paragraph', text: [{ text: 'סוף' }, { marker: "עמ' לח" }, { text: ' התחלה' }, { note: 'n1' }] }],
      notes: [{ id: 'n1', kind: 'note', n: 1, text: [{ text: 'הערה' }] }],
    },
  ],
};

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const { catalog, set } = await freshCatalog();
  const author = await add(catalog, 'shmuly', 'shmuly', 'author', { name: { he: 'הרבי' }, kind: 'rebbe', sets: [set] });
  const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר לדוגמה', en: 'Sample' }, slug: 'sample', authors: [author], genre: 'chassidus', levels: ['chapter'], sets: [set] }, '/sample');
  ids.unit = await add(
    catalog,
    'mendy',
    'keeper',
    'unit',
    { work, position: [{ level: 'chapter', value: '1' }], order: 'V', label: { he: 'פרק א', en: 'Chapter 1' }, body: SEFARIA as never, bodySource: { source: 'sefaria', via: 'sefaria', licence: 'cc-by-nc', credit: 'Sefaria: Test Edition', rights: 'credit' } },
    '/sample/1',
  );
  ids.library = await add(
    catalog,
    'mendy',
    'keeper',
    'unit',
    { work, position: [{ level: 'chapter', value: '2' }], order: 'W', label: { he: 'פרק ב' }, body: LIBRARY as never, bodySource: { source: 'chabadlibrary', via: 'chabadlibrary', credit: 'ספריית ליובאוויטש', rights: 'credit' } },
    '/sample/2',
  );
  ids.event = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'התוועדות' }, date: '5742-05-10', sets: [set], body: OUTLINE as never }, '/events/5742-05-10');
  const api = createApp({ catalog, reportSalt: 'test' });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

const html = async (path: string) => (await handle(new Request(`${SITE}${path}`))).text();

describe("a page's words", () => {
  it("draws a Sefaria chapter by Sefaria's rules: the Hebrew and English side by side, numbered in Hebrew letters, with notes and credit", async () => {
    const page = await html('/sample/1');
    expect(page).toContain('class="words words-sefaria words-pair"');
    // One row per segment, with the anchor a link can point at; the number in Hebrew letters in the Hebrew, digits in the English.
    expect(page).toMatch(/<div id="s-14\.3" class="words-row">/);
    expect(page).toMatch(/<a class="words-n" href="#s-14\.3"[^>]*>ג<\/a>/);
    expect(page).toMatch(/<a class="words-n" href="#s-14\.3"[^>]*>3<\/a>/);
    expect(page).toContain('<b>שלישית</b>');
    expect(page).toContain('<span class="words-marker">[דף ב]</span>');
    expect(page).toContain('href="#n-he-n1"');
    expect(page).toContain('id="n-he-n1"');
    expect(page).toContain('Sefaria: Test Edition · CC BY-NC');
    expect(page).toContain('sefaria.org</a>');
    expect(page).toContain('rel="noopener nofollow">The third letter</a>');
    // The Hebrew is set right to left whatever the page's language.
    expect(await html('/sample/1?lang=en')).toMatch(/<div class="words-cell" lang="he" dir="rtl">/);
  });

  it("draws the Chabad Library's texts with their notes, old pages, and the library's credit linking back to the page", async () => {
    const page = await html('/sample/2');
    expect(page).toContain('class="words words-chabad-library"');
    expect(page).toContain('<span class="words-marker">עמ&#x27; לח</span>');
    expect(page).toContain('id="n-he-n1"');
    expect(page).toMatch(/<a href="https:\/\/chabadlibrary\.org\/books\/11"[^>]*>ספריית ליובאוויטש · chabadlibrary\.org<\/a>/);
    expect(await html('/sample/2?lang=en')).toMatch(/>The Lubavitch Library · chabadlibrary\.org<\/a>/);
  });

  it("draws a farbrengen's outline as numbered items, and words that look like markup only as words", async () => {
    const page = await html('/events/5742-05-10');
    expect(page).toContain('class="words words-outline"');
    expect(page).toMatch(/<ol class="words-outline"><li id="s-contents\.1" value="1">/);
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('<script>alert(1)</script>');
  });

  it("reads a fixed segment back from the editor as runs: only the fixed marks, links and pieces, any other element's words as words", async () => {
    const { readRuns } = await import('../app/lib/editorRuns.js');
    type Fake = { nodeType: number; textContent?: string; tagName?: string; dataset?: Record<string, string>; childNodes: Fake[] };
    const text = (t: string): Fake => ({ nodeType: 3, textContent: t, childNodes: [] });
    const el = (tag: string, children: Fake[], dataset: Record<string, string> = {}): Fake => ({ nodeType: 1, tagName: tag.toUpperCase(), dataset, childNodes: children });
    const root = el('span', [
      el('span', [text('א.')], { mark: 'ois' }),
      text('אות '),
      el('b', [text('שלישית'), el('i', [text(' ממש')])]),
      el('span', [], { run: JSON.stringify({ note: 'n1' }) }),
      el('a', [text('קישור')], { href: 'rh-00000005' }),
      el('font', [text(' מודבק')]),
      el('div', [text('שורה חדשה')]),
      el('br', []),
    ]);
    expect(readRuns(root as unknown as Node)).toEqual([
      { text: 'א.', marks: ['ois'] },
      { text: 'אות ' },
      { text: 'שלישית', marks: ['b'] },
      { text: ' ממש', marks: ['b', 'i'] },
      { note: 'n1' },
      { text: 'קישור', href: 'rh-00000005' },
      { text: ' מודבק' },
      { br: true },
      { text: 'שורה חדשה' },
    ]);
  });

  it('opens the Edit tab on the words themselves, read as they are until the browser knows who is signed in', async () => {
    const page = await html(`/edit/${ids.unit}`);
    expect(page).toContain('class="words words-sefaria words-pair"');
    expect(page).not.toContain('words-editable');
    expect(page).not.toContain('wikitext');
  });
});
