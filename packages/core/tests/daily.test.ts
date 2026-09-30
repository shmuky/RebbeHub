import { beforeAll, describe, expect, it } from 'vitest';
import { dailyLearning, dailyPathOf, tanyaStart, type Catalog, type Json } from '@rebbehub/core';
import type { EntityId, PageText } from '@rebbehub/model';
import { add, freshCatalog } from './helpers.js';

/**
 * The day's learning over a small Tanya and Hayom Yom shaped as the
 * catalog has them: Tanya's chapters from Sefaria (numbered segments, the
 * Hebrew and English, footnotes), Hayom Yom's days from chabadlibrary.org
 * under their months.
 */

let catalog: Catalog;
const ids = {} as Record<string, EntityId>;

/** A Sefaria chapter of `n` segments in Hebrew and English, the English's 18th with a footnote. */
const chapter = (ref: string, n: number): PageText => ({
  profile: 'sefaria',
  versions: [
    { id: 'he', language: 'he', segments: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), n: i + 1, kind: 'verse' as const, text: [{ text: `${ref} קטע ${i + 1}` }] })) },
    {
      id: 'en',
      language: 'en',
      segments: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), n: i + 1, kind: 'verse' as const, text: [{ text: `${ref} segment ${i + 1}` }, ...(i === 17 ? [{ note: 'n2' }] : i === 1 ? [{ note: 'n1' }] : [])] })),
      notes: [
        { id: 'n1', kind: 'note' as const, text: [{ text: 'A note on segment 2' }] },
        { id: 'n2', kind: 'note' as const, text: [{ text: 'A note on segment 18' }] },
      ],
    },
  ],
});

beforeAll(async () => {
  ({ catalog } = await freshCatalog());
  ids.tanya = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'תניא', en: 'Tanya' }, slug: 'tanya', authors: [], genre: 'chassidus', levels: ['part', 'chapter'] }, '/tanya');
  const tanyaUnit = (ref: string, chapterNo: number, n: number) =>
    add(catalog, 'shmuly', 'shmuly', 'unit', {
      work: ids.tanya,
      position: [{ level: 'part', value: '4', label: { he: 'אגרת הקדש', en: 'Part IV; Iggeret HaKodesh' } }, { level: 'chapter', value: String(chapterNo) }],
      order: `4${String(chapterNo).padStart(2, '0')}`,
      label: { he: `אגרת הקדש ${chapterNo}`, en: `Iggeret HaKodesh ${chapterNo}` },
      editions: [{ kind: 'text', source: 'sefaria', sourceId: `Tanya, ${ref}`, language: 'he', licence: 'cc-by-nc' }],
      body: chapter(ref, n),
    } as unknown as Json);
  ids.ih22 = await tanyaUnit('Part IV; Iggeret HaKodesh 22', 22, 20);
  ids.ih23 = await tanyaUnit('Part IV; Iggeret HaKodesh 23', 23, 10);

  ids.hayomYom = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'היום יום', en: 'Hayom Yom' }, slug: 'hayom-yom', authors: [], genre: 'minhagim', levels: ['day'] }, '/hayom-yom');
  const day = (part: string, month: string, n: number, title: string) =>
    add(catalog, 'shmuly', 'shmuly', 'unit', {
      work: ids.hayomYom,
      position: [{ level: 'day', value: part, label: { he: `<h2>${month}</h2>` } }, { level: 'unit', value: String(n) }],
      order: `${part.padStart(2, '0')}${String(n).padStart(2, '0')}`,
      label: { he: `<h3>${title}</h3>` },
      body: { profile: 'chabad-library', versions: [{ id: 'he', language: 'he', segments: [{ id: 'p1', kind: 'paragraph', text: [{ text: `דברי ${title}` }] }] }] },
    } as unknown as Json);
  ids.adar1 = await day('4', 'אדר א', 1, 'א אדר א ראש חודש');
  ids.adar2 = await day('5', 'אדר ב', 1, 'א אדר ב, ר"ח');
  ids.tishrei19 = await day('12', 'תשרי', 19, 'יט תשרי');
  ids.tishrei20 = await day('12', 'תשרי', 20, 'כ תשרי');
  ids.cheshvan29 = await day('13', 'חשון', 29, 'כט חשון');
}, 60_000);

const segmentIds = (page: unknown, version = 0) => (page as PageText).versions[version]!.segments.map((s) => s.id);

describe("the day's learning", () => {
  it('finds where a day starts in a leap year and a plain one', () => {
    expect(tanyaStart('5787-01-19')).toEqual({ unit: 'Tanya, Part IV; Iggeret HaKodesh 22', segment: '17' });
    expect(tanyaStart('5786-01-19')).toEqual({ unit: 'Tanya, Part IV; Iggeret HaKodesh 23', segment: '5' });
    expect(tanyaStart('5787-03-19')).toEqual({ unit: 'Tanya, Part I; Likkutei Amarim, Title Page', segment: '1' });
  });

  it("cuts a chapter to the day's portion: from where today starts to the chapter's end, when tomorrow starts the next", async () => {
    // 30 September 2026 is 19 Tishrei 5787: Iggeret HaKodesh 22 from its 17th segment; 20 Tishrei starts 23.
    const day = (await dailyLearning(catalog, '2026-09-30'))!;
    expect(day.hebrew).toBe('5787-01-19');
    expect(day.tanya.map((t) => [t.id, t.from, t.to])).toEqual([[ids.ih22, '17', null]]);
    const body = (day.tanya[0]!.data as unknown as { body: PageText }).body;
    expect(segmentIds(body, 0)).toEqual(['17', '18', '19', '20']);
    expect(segmentIds(body, 1)).toEqual(['17', '18', '19', '20']);
    // Only the notes its segments point at.
    expect(body.versions[1]!.notes!.map((n) => n.id)).toEqual(['n2']);
    expect(day.hayomYom.map((h) => h.id)).toEqual([ids.tishrei19]);
  });

  it('ends a portion inside a chapter where tomorrow starts', async () => {
    // 20 Tishrei 5787: Iggeret HaKodesh 23, segments 1 to 3 (21 Tishrei starts at 4).
    const day = (await dailyLearning(catalog, '2026-10-01'))!;
    expect(day.tanya.map((t) => [t.id, t.from, t.to])).toEqual([[ids.ih23, '1', '4']]);
    expect(segmentIds((day.tanya[0]!.data as unknown as { body: PageText }).body)).toEqual(['1', '2', '3']);
    expect(day.hayomYom.map((h) => h.id)).toEqual([ids.tishrei20]);
  });

  it("gives both Adars' Hayom Yom in a plain year's Adar, and the 29th's on a 30th it has none for", async () => {
    // 1 Adar 5786 (a plain year) is 18 February 2026; 30 Cheshvan 5785 is 1 December 2024.
    expect((await dailyLearning(catalog, '2026-02-18'))!.hayomYom.map((h) => h.id)).toEqual([ids.adar1, ids.adar2]);
    expect((await dailyLearning(catalog, '2024-12-01'))!.hayomYom.map((h) => h.id)).toEqual([ids.cheshvan29]);
  });

  it('says nothing for a day the catalog has no learning for, and refuses a day that is not one', async () => {
    const day = (await dailyLearning(catalog, '2026-06-01'))!;
    expect(day.tanya).toEqual([]);
    expect(day.hayomYom).toEqual([]);
    expect(await dailyLearning(catalog, 'yesterday')).toBeNull();
  });

  it("names the day's Chumash, Tehillim and the Rambam's three tracks", async () => {
    // 19 Tishrei 5787 is in Sukkos: V'zos Habracha's fourth (a Wednesday); Tehillim 90-96.
    const day = (await dailyLearning(catalog, '2026-09-30'))!;
    // The catalog here has none of their works, so no pages on RebbeHub yet.
    expect(day.chumash).toEqual({ label: 'וזאת הברכה, רביעי עם פירש״י', ref: 'Deuteronomy 33:18-21', path: null, rashi: null });
    expect(day.tehillim).toEqual([{ text: 'צ-צו.', ref: 'Psalms 90-96', path: null }]);
    expect(day.rambam).toEqual({
      three: { label: 'הלכות מקואות פרקים ה-ז', refs: ['Mishneh Torah, Immersion Pools 5', 'Mishneh Torah, Immersion Pools 6', 'Mishneh Torah, Immersion Pools 7'], paths: [null, null, null] },
      one: { label: 'הלכות גירושין פרק ט', refs: ['Mishneh Torah, Divorce 9'], paths: [null] },
      mitzvos: { label: 'מצות עשה קט', refs: ['Sefer HaMitzvot, Positive Commandments 109'], paths: [null] },
    });
    // The day after Simchas Torah learns Bereishis from its start; Elul adds three chapters.
    expect((await dailyLearning(catalog, '2026-10-05'))!.chumash).toMatchObject({ label: 'בראשית, עד שני עם פירש״י', ref: 'Genesis 1:1-2:19' });
    expect((await dailyLearning(catalog, '2026-08-16'))!.tehillim.map((t) => t.ref)).toEqual(['Psalms 18-22', 'Psalms 7-9']);
  });

  it('places a shiur on the pages the Sefaria importer gives Chitas and the Rambam', () => {
    expect(dailyPathOf('Exodus 10:1-11')).toEqual({ work: '/chumash/exodus', page: '/chumash/exodus/10' });
    expect(dailyPathOf('Exodus 10:12-23', { rashi: true })).toEqual({ work: '/chumash/rashi-exodus', page: '/chumash/rashi-exodus/10#s-12' });
    expect(dailyPathOf('Psalms 119:97-176')?.page).toBe('/tehillim/119#s-97');
    expect(dailyPathOf('Mishneh Torah, Vessels of the Sanctuary and Those who Serve Therein 9')?.page).toBe('/rambam/vessels-of-the-sanctuary-and-those-who-serve-therein/9');
    expect(dailyPathOf('Sefer HaMitzvot, Positive Commandments 109')).toBeNull();
  });

  it('links a shiur to its page once the catalog has it', async () => {
    const work = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'תהלים', en: 'Psalms' }, slug: 'tehillim', authors: [], genre: 'chassidus', levels: ['chapter'] }, '/tehillim');
    await add(catalog, 'shmuly', 'shmuly', 'unit', { work, position: [{ level: 'chapter', value: '90' }], order: '090', label: { he: 'צ', en: '90' } } as unknown as Json, '/tehillim/90');
    const day = (await dailyLearning(catalog, '2026-09-30'))!;
    expect(day.tehillim[0]!.path).toBe('/tehillim/90');
    expect(day.chumash!.path).toBeNull();
  });
});
