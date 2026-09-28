import { describe, expect, it } from 'vitest';
import { fetchTexts, htmlToWikitext, sichosKodeshWorksImporter, sourceFooter, type SichosKodeshWorksInput } from '../src/index.js';

const LETTER = '<article dir="rtl" lang="he"><h1>אגרת א</h1><p>ב״ה, <b>ה׳ ניסן</b></p><p>שלום וברכה!<br>נתקבל מכתבו.</p><footer class="source"><span class="version">Kehot</span> · <span class="licence">CC BY-NC</span> · <a href="https://example.org/1">Sefaria</a></footer></article>';

describe('the texts of the seforim', () => {
  it('turns a published text into wikitext, and reads its source from its footer', () => {
    expect(htmlToWikitext(LETTER)).toBe("ב״ה, '''ה׳ ניסן'''\n\nשלום וברכה!<br />נתקבל מכתבו.");
    expect(sourceFooter(LETTER)).toEqual({ version: 'Kehot', licence: 'CC BY-NC', url: 'https://example.org/1' });
    // Wikitext's own markup in a text is taken as words, never as markup.
    expect(htmlToWikitext("<p>[[x]] ''y'' {{z}}</p>")).toBe("[<nowiki/>[x]] '<nowiki/>'y'<nowiki/>' {<nowiki/>{z}}");
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
      body: "ב״ה, '''ה׳ ניסן'''\n\nשלום וברכה!<br />נתקבל מכתבו.",
      bodySource: { source: 'igros-app', via: 'igros-index', sourceId: 'igros:1', credit: 'Kehot Publication Society', rights: 'credit', url: 'https://example.org/1' },
    });
    // The link-only copy is never taken in.
    expect(units[1]!.data).not.toHaveProperty('body');
  });
});
