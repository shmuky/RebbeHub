import { describe, expect, it } from 'vitest';
import { chabadLibraryImporter, crawlChabadLibrary, htmlToPageVersion, libraryHtml, type LibraryTree } from '@rebbehub/importers';

/** A little library: a work with two parts, the first with two pages, the second with one. */
const SITE: Record<number, { type: string; data: unknown }> = {
  300000000: { type: 'children', data: [{ id: 1, heading: 'חלק ראשון' }, { id: 2, heading: 'חלק שני' }] },
  1: { type: 'children', data: [{ id: 11, heading: 'א' }, { id: 12, heading: 'ב' }] },
  2: { type: 'children', data: [{ id: 21, heading: 'הוספות' }] },
  11: { type: 'page', data: { text: '<h3>שיחה א</h3>\r\n[cup]תניא[/cup] [בספ"ג דנדה] משביעים[ftnref_1_1]\r\n[ftn_1_1]) נדה ל, ב.', haoros: '' } },
  12: { type: 'page', data: { text: 'not kept' } },
  21: { type: 'page', data: { text: 'not kept' } },
};

const fakeFetch = (asked: number[]) =>
  (async (url: string) => {
    const id = Number(/path=\/(\d+)/.exec(url)![1]);
    asked.push(id);
    return new Response(JSON.stringify({ content: SITE[id] }));
  }) as unknown as typeof fetch;

describe('chabadlibrary.org', () => {
  it('crawls the contents only, and continues where it stopped', async () => {
    const tree: LibraryTree = { nodes: {} };
    const asked: number[] = [];
    expect(await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(asked), pauseMs: 0, concurrency: 1, deadline: Date.now() - 1 })).toBe(false);
    expect(asked).toEqual([]);
    expect(await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(asked), pauseMs: 0 })).toBe(true);
    expect(tree.nodes[11]).toEqual({ heading: 'א', parent: 1, kind: 'page' });
    expect(JSON.stringify(tree)).not.toContain('not kept');
    const again: number[] = [];
    await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(again), pauseMs: 0 });
    expect(again).toEqual([]); // everything known: nothing asked again
  });

  it('makes a page for every chapter, linking to it in the library', async () => {
    const tree: LibraryTree = { nodes: {} };
    await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch([]), pauseMs: 0 });
    const index = {
      works: [
        { id: 'keser-shem-tov', levels: ['chelek', 'siman'], sources: [{ source: 'chabadlibrary', sourceId: '300000000', licence: 'unknown', kind: 'text' }] },
        { id: 'tanya', levels: ['chapter'], sources: [{ source: 'chabadlibrary', sourceId: '3400000000', licence: 'unknown', kind: 'text' }] },
      ],
    };
    const records = [];
    for await (const r of chabadLibraryImporter({ index, withContents: new Set(['tanya']), tree }).records()) records.push(r);
    expect(records.map((r) => r.path)).toEqual(['/keser-shem-tov/1/1', '/keser-shem-tov/1/2', '/keser-shem-tov/2/1']);
    expect(records[0]!.data).toMatchObject({
      label: { he: 'א' },
      position: [{ level: 'chelek', value: '1', label: { he: 'חלק ראשון' } }, { level: 'siman', value: '1' }],
      editions: [{ source: 'chabadlibrary', sourceId: '11', url: 'https://chabadlibrary.org/books/11' }],
    });
  });

  it('numbers volumes as they are printed, so the library\'s first Likkutei Sichos volume is 30', async () => {
    const tree: LibraryTree = {
      nodes: {
        1300000000: { heading: 'לקוטי שיחות', parent: 0, kind: 'section', children: [1, 2] },
        1: { heading: 'כרך ל', parent: 1300000000, kind: 'section', children: [11] },
        2: { heading: 'כרך לא', parent: 1300000000, kind: 'section', children: [21] },
        11: { heading: '1', parent: 1, kind: 'page' },
        21: { heading: '1', parent: 2, kind: 'page' },
        500: { heading: 'המשך', parent: 0, kind: 'section', children: [501, 502] },
        501: { heading: 'חלק ראשון', parent: 500, kind: 'section', children: [511] },
        502: { heading: 'חלק שלישי', parent: 500, kind: 'section', children: [521] },
        511: { heading: 'א', parent: 501, kind: 'page' },
        521: { heading: 'א', parent: 502, kind: 'page' },
        600: { heading: 'אגרות', parent: 0, kind: 'section', children: [601, 602] },
        601: { heading: 'כרך א', parent: 600, kind: 'section', children: [611] },
        602: { heading: 'מפתחות', parent: 600, kind: 'section', children: [621] },
        611: { heading: 'א', parent: 601, kind: 'page' },
        621: { heading: 'א', parent: 602, kind: 'page' },
      },
    };
    const source = (sourceId: string) => [{ source: 'chabadlibrary', sourceId, licence: 'unknown', kind: 'text' }];
    const index = {
      works: [
        { id: 'likkutei-sichos', levels: ['volume', 'sicha'], sources: source('1300000000') },
        { id: 'hemshech', levels: ['chelek'], sources: source('500') },
        { id: 'igros', levels: ['volume'], sources: source('600') },
      ],
    };
    const records = [];
    for await (const r of chabadLibraryImporter({ index, withContents: new Set(), tree }).records()) records.push(r);
    expect(records.map((r) => r.path)).toEqual([
      '/likkutei-sichos/30/1',
      '/likkutei-sichos/31/1',
      '/hemshech/1/1', // ראשון is a word, not the letters of 557
      '/hemshech/3/1',
      '/igros/1/1', // not every part is a numbered volume: they keep their places
      '/igros/2/1',
    ]);
    expect(records[0]!.data).toMatchObject({ position: [{ level: 'volume', value: '30', label: { he: 'כרך ל' } }, { level: 'sicha', value: '1' }] });
  });

  it('keeps each page\'s text with a crawl that asks for it, and puts it on the page with credit', async () => {
    const tree: LibraryTree = { nodes: {} };
    await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch([]), pauseMs: 0 });
    expect(tree.nodes[11]!.sha256).toBeUndefined();
    const kept = new Map<string, string>();
    const asked: number[] = [];
    await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(asked), pauseMs: 0, texts: async (sha, html) => void kept.set(sha, html) });
    expect(asked.filter((id) => id === 11 || id === 12 || id === 21)).toHaveLength(3); // pages read again, for their words
    const sha = tree.nodes[11]!.sha256!;
    expect(kept.get(sha)).toContain('https://chabadlibrary.org/books/11');
    tree.nodes[11]!.kept = true;
    const index = { works: [{ id: 'keser-shem-tov', levels: ['chelek', 'siman'], sources: [{ source: 'chabadlibrary', sourceId: '300000000', licence: 'free-to-read', kind: 'text' }] }] };
    const records = [];
    for await (const r of chabadLibraryImporter({ index, withContents: new Set(), tree, text: async (s) => kept.get(s) ?? null, api: 'https://api.example' }).records()) records.push(r);
    const page = records[0]!.data as { body: unknown; bodySource: Record<string, string> };
    expect(page.body).toEqual({
      profile: 'chabad-library',
      versions: [
        {
          id: 'he',
          language: 'he',
          credit: 'ספריית ליובאוויטש',
          licence: 'free-to-read',
          url: 'https://chabadlibrary.org/books/11',
          segments: [
            { id: 'h1', kind: 'heading', level: 2, text: [{ text: 'שיחה א' }] },
            { id: 'p1', kind: 'paragraph', text: [{ text: 'תניא', marks: ['b'] }, { text: ' [בספ"ג דנדה] משביעים' }, { note: 'n1' }] },
          ],
          notes: [{ id: 'n1', kind: 'note', n: 1, text: [{ text: 'נדה ל, ב.' }] }],
        },
      ],
    });
    expect(page.bodySource).toMatchObject({ source: 'chabadlibrary', sourceId: '11', url: 'https://chabadlibrary.org/books/11', rights: 'credit', copy: `https://api.example/v1/texts/${sha}` });
  });

  it('reads the library\'s own marks: bold and small words, index references, old pages as markers', () => {
    expect(libraryHtml('[headingintext_begin]חג השבועות[headingintext_end] ראה [mafteach_gopage file="ls30" gopage="240"] וע"ע [mafteach_goterm file="ls30" goterm="כיבוד אב ואם"].[new_section]')).toBe(
      "<p><b>חג השבועות</b> ראה עמ' 240 וע\"ע כיבוד אב ואם.</p>",
    );
    expect(libraryHtml('סוף[oldpage_לח] התחלה')).toBe('<p>סוף<span class="mark">עמ\' לח</span> התחלה</p>');
    expect(libraryHtml('<p class=bodytext>א<!--[if !supportFootnotes]-->[1]<!--[endif]--></p>')).toBe('<p class=bodytext>א[1]</p>');
    const version = htmlToPageVersion(libraryHtml('סוף[oldpage_לח] התחלה'), { id: 'he', language: 'he' });
    expect(version.segments).toEqual([{ id: 'p1', kind: 'paragraph', text: [{ text: 'סוף' }, { marker: "עמ' לח" }, { text: ' התחלה' }] }]);
  });

  it('makes footnotes and haoros notes, each pointed to from its marker', () => {
    const html = libraryHtml(
      'שורה[ftnref_2_1] ועוד[ftnref_2_2] ובלי הערה[ftnref_9_7]',
      '[ftn_2_1]) ראה <a href="https://chabadlibrary.org/books/5">שם</a>.\nהמשך ההערה.\n[ftn_2_2]. ועוד.',
    );
    const version = htmlToPageVersion(html, { id: 'he', language: 'he', links: true });
    expect(version.segments).toEqual([
      { id: 'p1', kind: 'paragraph', text: [{ text: 'שורה' }, { note: 'n1' }, { text: ' ועוד' }, { note: 'n2' }, { text: ' ובלי הערה' }, { text: '7', marks: ['sup'] }] },
    ]);
    expect(version.notes).toEqual([
      { id: 'n1', kind: 'note', n: 1, text: [{ text: 'ראה ' }, { text: 'שם', href: 'https://chabadlibrary.org/books/5' }, { text: '.' }, { br: true }, { text: 'המשך ההערה.' }] },
      { id: 'n2', kind: 'note', n: 2, text: [{ text: 'ועוד.' }] },
    ]);
  });
});
