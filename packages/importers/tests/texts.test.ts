import { describe, expect, it } from 'vitest';
import { articleOf, fetchTexts, htmlToPageVersion, sichosKodeshWorksImporter, sourceFooter, type SichosKodeshWorksInput } from '../src/index.js';

const LETTER = '<article dir="rtl" lang="he"><h1>אגרת א</h1><p>ב״ה, <b>ה׳ ניסן</b></p><p>שלום וברכה!<br>נתקבל מכתבו.</p><footer class="source"><span class="version">Kehot</span> · <span class="licence">CC BY-NC</span> · <a href="https://example.org/1">Sefaria</a></footer></article>';
const LETTER_SEGMENTS = [
  { id: 'p1', kind: 'paragraph', text: [{ text: 'ב״ה, ' }, { text: 'ה׳ ניסן', marks: ['b'] }] },
  { id: 'p2', kind: 'paragraph', text: [{ text: 'שלום וברכה!' }, { br: true }, { text: 'נתקבל מכתבו.' }] },
];

describe('the texts of the seforim', () => {
  it('reads a published text into structured words, and its source from its footer', () => {
    expect(htmlToPageVersion(LETTER, { id: 'he', language: 'he' })).toEqual({ id: 'he', language: 'he', segments: LETTER_SEGMENTS });
    expect(sourceFooter(LETTER)).toEqual({ version: 'Kehot', licence: 'CC BY-NC', url: 'https://example.org/1' });
    expect(articleOf(LETTER)).toEqual({ language: 'he' });
    // Anything that looks like markup is only words; tags the form does not use are dropped, their words kept.
    expect(htmlToPageVersion("<p>[[x]] ''y'' &lt;b&gt; <script>no()</script><span onclick=\"x\">z</span></p>", { id: 'he', language: 'he' }).segments).toEqual([
      { id: 'p1', kind: 'paragraph', text: [{ text: "[[x]] ''y'' <b> z" }] },
    ]);
  });

  it("keeps a letter's lines set to the end side, its headings, and notes with no marker", () => {
    const html = '<article lang="he"><p class="end">ב״ה</p><h2>פתיחה</h2><p>גוף</p><aside class="notes"><p>הערת המו״ל</p></aside></article>';
    expect(htmlToPageVersion(html, { id: 'he', language: 'he' })).toEqual({
      id: 'he',
      language: 'he',
      segments: [
        { id: 'p1', kind: 'paragraph', end: true, text: [{ text: 'ב״ה' }] },
        { id: 'h1', kind: 'heading', level: 1, text: [{ text: 'פתיחה' }] },
        { id: 'p2', kind: 'paragraph', text: [{ text: 'גוף' }] },
      ],
      notes: [{ id: 'n1', kind: 'note', text: [{ text: 'הערת המו״ל' }] }],
    });
  });

  it("keeps Sefaria's structure: sections by their own numbers, numbered segments with ids from their place", () => {
    const html =
      '<article dir="rtl" lang="he" data-source="sefaria" data-version="Kehot"><h1>תניא</h1><h2>פרק א</h2><p>א<sup class="fn"><a href="#n1" id="r1">*</a></sup></p><p>ב</p><h2>פרק ג</h2><p>ג</p>' +
      '<aside class="notes"><p id="n1"><a href="#r1">*</a> הערה</p></aside><footer class="source"><span class="version">Kehot</span></footer></article>';
    expect(articleOf(html)).toEqual({ language: 'he', source: 'sefaria', version: 'Kehot' });
    const version = htmlToPageVersion(html, { id: 'he', language: 'he', numbered: true });
    expect(version.segments).toEqual([
      { id: '1', kind: 'section', n: 1, text: [{ text: 'פרק א' }], children: [
        { id: '1.1', kind: 'verse', n: 1, text: [{ text: 'א' }, { note: 'n1' }] },
        { id: '1.2', kind: 'verse', n: 2, text: [{ text: 'ב' }] },
      ] },
      { id: '3', kind: 'section', n: 3, text: [{ text: 'פרק ג' }], children: [{ id: '3.1', kind: 'verse', n: 1, text: [{ text: 'ג' }] }] },
    ]);
    expect(version.notes).toEqual([{ id: 'n1', kind: 'note', label: '*', text: [{ text: 'הערה' }] }]);
  });

  it('fetches the texts through the API a few at a time, and tries a busy one again', async () => {
    const asked: string[] = [];
    let busy = 1;
    const fake = (async (url: string) => {
      asked.push(url);
      if (url.endsWith('b'.repeat(64)) && busy-- > 0) return new Response('', { status: 503 });
      return new Response(`<p>${url.slice(-4)}</p>`);
    }) as typeof fetch;
    const texts = await fetchTexts(['a'.repeat(64), 'b'.repeat(64), 'a'.repeat(64), 'not-a-hash'], { base: 'https://api.test', fetch: fake, pauseMs: 1 });
    expect([...texts.keys()].sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(asked.filter((u) => u.endsWith('a'.repeat(64)))).toEqual([`https://api.test/v1/texts/${'a'.repeat(64)}`]);
    expect(asked.filter((u) => u.endsWith('b'.repeat(64)))).toHaveLength(2);
    const down = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(fetchTexts(['c'.repeat(64)], { base: 'https://api.test', fetch: down, pauseMs: 1 })).rejects.toThrow(/answered 503/);
  });

  it("puts each unit's text on its page, with the record of where it came from, only where its rights let it ship", async () => {
    const input: SichosKodeshWorksInput = {
      index: {
        authors: [{ id: 'rebbe', name: { he: 'הרבי', en: 'The Rebbe' } }],
        works: [
          {
            id: 'igros',
            title: { he: 'אגרות קודש', en: 'Igros Kodesh' },
            authors: ['rebbe'],
            genre: 'igros',
            levels: ['letter'],
            sources: [
              { source: 'chabadlibrary', sourceId: '1', kind: 'text', licence: 'free-to-read', rights: 'link-only', language: 'he' },
              { source: 'igros-app', sourceId: 'igros', kind: 'text', licence: 'commercial', rights: 'ship-with-credit', language: 'he', credit: 'Kehot Publication Society' },
            ],
          },
        ],
      },
      contents: [
        {
          workId: 'igros',
          contents: [{ unitId: '1' }, { unitId: '2' }],
          units: [
            { id: '1', label: 'אגרת א', ref: 'igros:1', editions: [{ source: 0, sha256: 'b'.repeat(64) }, { source: 1, sha256: 'a'.repeat(64) }] },
            { id: '2', label: 'אגרת ב', editions: [{ source: 0, sha256: 'b'.repeat(64) }] },
          ],
        },
      ],
      texts: new Map([
        ['a'.repeat(64), LETTER],
        ['b'.repeat(64), '<p>not to be shipped</p>'],
      ]),
    };
    const records = [];
    for await (const r of sichosKodeshWorksImporter(input).records()) records.push(r);
    const units = records.filter((r) => r.type === 'unit');
    expect(units[0]!.data).toMatchObject({
      body: { profile: 'sichos-kodesh', versions: [{ id: 'he', language: 'he', credit: 'Kehot Publication Society', licence: 'CC BY-NC', url: 'https://example.org/1', segments: LETTER_SEGMENTS }] },
      bodySource: { source: 'igros-app', via: 'igros-index', sourceId: 'igros:1', credit: 'Kehot Publication Society', rights: 'credit', url: 'https://example.org/1' },
    });
    // The link-only copy is never taken in.
    expect(units[1]!.data).not.toHaveProperty('body');
  });
});
