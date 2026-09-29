import { describe, expect, it } from 'vitest';
import {
  addHanachaText,
  chooseTitlePage,
  coverSources,
  coversOf,
  coverFetchFailed,
  coversWanted,
  fileAbout,
  getFile,
  hebrewBooksPdfUrl,
  findDateIn,
  hanachaOf,
  linkedCounts,
  linkedPage,
  lookOfPage,
  proposeNewMaterial,
  recordCover,
  registerFile,
  setRights,
  suggestDocument,
  suggestHanachaPdf,
  suggestRecording,
  titlePageScore,
  type GreyPage,
} from '@rebbehub/core';
import { orderKeys, type EntityId } from '@rebbehub/model';
import { add, freshCatalog, yudShvat } from './helpers.js';

/**
 * Every item's page: all that belongs to it, a page at a time with its
 * total; a sefer's cover from its title page; a file's own page; and adding
 * what the catalog does not have yet (a hanacha, a recording, a sefer).
 */

const sha = (c: string) => c.repeat(64);

/** A page drawn in grey: white, with dark blocks where `ink` says (x, y, width, height as fractions). */
function page(ink: Array<[number, number, number, number]>, W = 200, H = 280): GreyPage {
  const gray = new Uint8Array(W * H).fill(255);
  for (const [x, y, w, h] of ink) {
    for (let yy = Math.floor(y * H); yy < Math.floor((y + h) * H); yy++) for (let xx = Math.floor(x * W); xx < Math.floor((x + w) * W); xx++) gray[yy * W + xx] = 20;
  }
  return { width: W, height: H, gray };
}

/** A page of body text: thirty lines of words across the page. */
const bodyText = () =>
  page(Array.from({ length: 30 * 10 }, (_, k) => [0.1 + (k % 10) * 0.08, 0.07 + Math.floor(k / 10) * 0.028, 0.05, 0.012] as [number, number, number, number]));
/** A title page: a few short centred lines. */
const titlePage = () =>
  page([
    [0.3, 0.2, 0.4, 0.04],
    [0.35, 0.3, 0.3, 0.02],
    [0.4, 0.7, 0.2, 0.015],
    [0.42, 0.75, 0.16, 0.015],
  ]);

describe('what belongs to an item, all of it', () => {
  it('counts each group and pages through one in its own order, never ending without the total', async () => {
    const { catalog, set } = await freshCatalog();
    const cs = await catalog.createChangeset('mendy', { title: 'A year of farbrengens' });
    // 250 farbrengens, added out of order.
    const months = ['01', '02', '03', '04', '05', '07', '08', '09', '10', '11', '12'];
    for (let i = 250; i >= 1; i--) {
      const day = String(((i - 1) % 28) + 1).padStart(2, '0');
      await catalog.putRevision(cs.id, 'mendy', { type: 'event', data: { kind: 'farbrengen', title: { he: `התוועדות ${i}` }, date: `${5700 + Math.floor((i - 1) / 11)}-${months[(i - 1) % 11]}-${day}`, sets: [set] } });
    }
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'keeper');

    const groups = await linkedCounts(catalog.db, set);
    expect(groups).toContainEqual({ type: 'event', field: 'sets', count: 250 });

    const seen: string[] = [];
    let after: string | undefined;
    for (let round = 0; round < 5; round++) {
      const pageOf = await linkedPage(catalog.db, set, { field: 'sets', type: 'event', after, limit: 100 });
      expect(pageOf.total).toBe(250);
      seen.push(...pageOf.items.map((e) => (e.data as { date: string }).date));
      if (!pageOf.next) break;
      after = pageOf.next;
    }
    expect(seen).toHaveLength(250);
    expect([...seen].sort()).toEqual(seen);
    await expect(linkedPage(catalog.db, set, { field: 'sets', after: 'not a cursor!' })).rejects.toThrow();
  });

  it("lists a sefer's units in their order", async () => {
    const { catalog, set } = await freshCatalog();
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const orders = orderKeys(3);
    for (const [i, label] of ['ג', 'א', 'ב'].entries()) {
      await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: label }], order: orders[[2, 0, 1][i]!]!, label: { he: label } });
    }
    const { items, total, next } = await linkedPage(catalog.db, work, { field: 'work', type: 'unit' });
    expect(total).toBe(3);
    expect(next).toBeNull();
    expect(items.map((u) => (u.data as { label: { he: string } }).label.he)).toEqual(['א', 'ב', 'ג']);
  });
});

describe("a sefer's cover from its title page", () => {
  it('finds the title page by its ink and its words, past a blank page and a dark cover sheet', () => {
    const blank = lookOfPage(1, page([]));
    const dark = lookOfPage(2, page([[0, 0, 1, 1]]));
    const title = lookOfPage(3, titlePage(), 'ספר השיחות הוצאת קה"ת ברוקלין, נ.י. שנת תשמ"ב');
    const body = lookOfPage(4, bodyText(), 'בשיחה זו מבואר '.repeat(80));
    expect(titlePageScore(blank).reasons).toEqual(['blank']);
    expect(titlePageScore(dark).reasons).toEqual(['dark cover sheet']);
    expect(titlePageScore(title).reasons).toEqual(expect.arrayContaining(['sparse', 'centred', 'sefer', 'publisher line']));
    expect(titlePageScore(body).score).toBeLessThan(0);
    expect(chooseTitlePage([blank, dark, title, body]).page).toBe(3);
    // Without words, the sparse centred page still wins over body text.
    expect(chooseTitlePage([lookOfPage(1, page([])), lookOfPage(2, bodyText()), lookOfPage(3, titlePage())]).page).toBe(3);
    // A copyright page is not the title page.
    expect(titlePageScore(lookOfPage(2, titlePage(), 'ISBN 0-8266-0000-0 © Copyright Kehot')).reasons).toContain('copyright page');
    // Nothing like a title page: the first real page; nothing at all: page 1.
    expect(chooseTitlePage([lookOfPage(1, page([])), lookOfPage(2, bodyText())]).page).toBe(2);
    expect(chooseTitlePage([lookOfPage(1, page([]))]).page).toBe(1);
  });

  it('draws from served PDFs first, lets a person choose the page, and hides the cover when its file is taken down', async () => {
    const { catalog, set } = await freshCatalog();
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const other = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר אחר' }, slug: 'other', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const pub = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work, date: '5742' });
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    await registerFile(catalog.db, { sha256: sha('b'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'unknown', held: true });
    const scanB = await add(catalog, 'mendy', 'keeper', 'scan', { publication: pub, file: sha('b'), completeness: 'complete' });
    const scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: pub, file: sha('a'), completeness: 'complete' });
    // A unit's PDF on Drive that RebbeHub holds and serves (the old Sichos Kodesh scans).
    await registerFile(catalog.db, { sha256: sha('c'), bytes: 10, mime: 'application/pdf', source: 'mafteiach', licence: 'unknown', fileClass: 'sichos-kodesh-hanacha', url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view', held: true });
    await add(catalog, 'mendy', 'keeper', 'unit', {
      work: other,
      position: [{ level: 'volume', value: '1' }],
      order: 'a0',
      label: { he: 'א' },
      editions: [{ source: 'mafteiach', sourceId: '1AbCdEfGhIjKlMn', kind: 'pdf', licence: 'facts-and-links', url: 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/1AbCdEfGhIjKlMn?filename=x.pdf' }],
    });

    // The served scan first; the one kept privately (its uploader was not sure: linked) after it.
    expect(await coverSources(catalog.db, work)).toEqual([
      { sha256: sha('a'), via: 'scan', item: scan, linked: false },
      { sha256: sha('b'), via: 'scan', item: scanB, linked: true },
    ]);
    expect((await coverSources(catalog.db, other)).map((s) => s.sha256)).toEqual([sha('c')]);
    const wanted = await coversWanted(catalog.db);
    expect(wanted.map((w) => w.work).sort()).toEqual([work, other].sort());

    const picture = (c: string) => ({ sha256: sha(c), bytes: 5, width: 480, height: 672 });
    await recordCover(catalog.db, { entity: work, src: sha('a'), page: 3, chosenBy: 'machine', score: 4, reasons: ['sparse'], image: picture('d'), thumb: picture('e') });
    expect((await coversWanted(catalog.db)).map((w) => w.work)).toEqual([other]);
    expect((await coversOf(catalog.db, [work, other]))[work]).toMatchObject({ page: 3, machine: true, image: { sha256: sha('d') }, thumb: { sha256: sha('e') } });

    // A keeper chooses page 2: the cover is drawn again, as the person's choice.
    const cs = await catalog.createChangeset('mendy', { title: 'Cover' });
    const current = (await catalog.get(work))!;
    await catalog.putRevision(cs.id, 'mendy', { id: work, type: 'work', data: { ...(current.data as object), cover: { file: sha('a'), page: 2 } } });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'keeper');
    expect(await coversWanted(catalog.db, { work })).toEqual([expect.objectContaining({ work, chosen: { file: sha('a'), page: 2 } })]);
    await recordCover(catalog.db, { entity: work, src: sha('a'), page: 2, chosenBy: 'person', image: picture('f'), thumb: picture('9') });
    expect(await coversWanted(catalog.db, { work })).toEqual([]);
    expect((await coversOf(catalog.db, [work]))[work]).toMatchObject({ page: 2, machine: false });

    // A takedown of the PDF takes its cover down.
    await setRights(catalog.db, 'shmuly', sha('a'), 'preserved', 'takedown');
    expect(await coversOf(catalog.db, [work])).toEqual({});
    const about = await fileAbout(catalog.db, sha('a'));
    expect(about?.covers).toEqual([{ entity: work, page: 2, machine: false }]);
    expect(about?.usedBy.total).toBe(1);
    expect(about?.derivations.map((d) => d.profile)).toEqual(expect.arrayContaining(['cover/2', 'cover-thumb/2']));
  });

  it("draws from a PDF RebbeHub only links to: the cover is served, the PDF never, and a takedown still hides it", async () => {
    const { catalog, set } = await freshCatalog();
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const hb = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר בהיברו בוקס' }, slug: 'hb', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const pub = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work: hb, date: '5710', identifiers: { hebrewbooks: '12345' } });
    // An Otzros library PDF on Drive: known, not held (a publisher scan, link only).
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 10, mime: 'application/pdf', source: 'other', licence: 'free-to-read', fileClass: 'publisher-scan', credit: 'אוצרות הרבי', url: 'https://drive.google.com/file/d/1OtzrosAbCdEf/view', held: false });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', {
      work,
      position: [{ level: 'volume', value: '1' }],
      order: 'a0',
      label: { he: 'א' },
      editions: [{ source: 'other', sourceId: '1OtzrosAbCdEf', kind: 'pdf', licence: 'free-to-read', url: 'https://drive.google.com/file/d/1OtzrosAbCdEf/view' }],
    });
    expect(await coverSources(catalog.db, work)).toEqual([{ sha256: sha('a'), via: 'unit', item: unit, linked: true }]);
    // The HebrewBooks scan is still to be fetched: no file yet.
    const wanted = await coversWanted(catalog.db);
    expect(wanted.map((w) => w.work).sort()).toEqual([work, hb].sort());
    expect(wanted.find((w) => w.work === hb)).toMatchObject({ sources: [], toFetch: [{ item: pub, source: 'hebrewbooks', url: hebrewBooksPdfUrl('12345') }] });
    // One that could not be fetched waits until its publication changes.
    await coverFetchFailed(catalog.db, pub);
    expect((await coversWanted(catalog.db)).map((w) => w.work)).toEqual([work]);

    const picture = (c: string) => ({ sha256: sha(c), bytes: 5, width: 480, height: 672 });
    await recordCover(catalog.db, { entity: work, src: sha('a'), page: 1, chosenBy: 'machine', image: picture('d'), thumb: picture('e') });
    expect((await coversOf(catalog.db, [work]))[work]).toMatchObject({ file: sha('a'), machine: true, credit: 'אוצרות הרבי' });
    // The cover's pictures are served, credited; the PDF stays linked.
    expect(await getFile(catalog.db, sha('d'))).toMatchObject({ rights_state: 'credit', storage_tier: 'public', credit: 'אוצרות הרבי' });
    expect(await getFile(catalog.db, sha('a'))).toMatchObject({ rights_state: 'link', storage_tier: 'none' });

    // A takedown hides it, and clearing the PDF back to linked shows it again.
    await setRights(catalog.db, 'shmuly', sha('a'), 'preserved', 'takedown');
    expect(await coversOf(catalog.db, [work])).toEqual({});
    expect(await getFile(catalog.db, sha('e'))).toMatchObject({ rights_state: 'preserved' });
    await setRights(catalog.db, 'shmuly', sha('a'), 'link', 'cleared');
    expect(await getFile(catalog.db, sha('e'))).toMatchObject({ rights_state: 'credit', storage_tier: 'public' });
    expect(Object.keys(await coversOf(catalog.db, [work]))).toEqual([work]);
  });
});

describe('adding what the catalog does not have yet', () => {
  it('reads a date out of a file name', () => {
    expect(findDateIn('הנחה יו"ד שבט תשמ"ב.pdf')).toBe('5742-05-10');
    expect(findDateIn('10 Shvat 5742 - sicha 2.mp3')).toBe('5742-05-10');
    expect(findDateIn('farbrengen 5742-05-10.pdf')).toBe('5742-05-10');
    expect(findDateIn('scan_0001.pdf')).toBeNull();
  });

  it('proposes the farbrengen on the date the name gives, and a sefer the catalog has by its name', async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
    await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'לקוטי שיחות' }, slug: 'likkutei-sichos', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const hanacha = await proposeNewMaterial(catalog, { what: 'hanacha', name: 'הנחה יו"ד שבט תשמ"ב.pdf' });
    expect(hanacha).toMatchObject({ machine: true, date: '5742-05-10' });
    expect(hanacha.candidates[0]).toMatchObject({ id: event, why: 'date' });
    const sefer = await proposeNewMaterial(catalog, { what: 'document', name: 'לקוטי שיחות חלק ד.pdf' });
    expect(sefer.as).toBe('printing');
    expect(sefer.candidates[0]?.type).toBe('work');
    expect((await proposeNewMaterial(catalog, { what: 'document', name: 'תשורה משמחת כהן.pdf' })).as).toBe('teshura');
  });

  it("adds a hanacha's PDF to its farbrengen: a printing of its own, based on it, linked from its page when served", async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    const made = await suggestHanachaPdf(catalog, 'chaim', { file: sha('a'), place: { target: event }, licence: 'cc0', servedUrl: `https://files.test/objects/${sha('a')}` });
    const review = await catalog.review(made.suggestion.id);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['event', 'publication', 'relation', 'scan']);
    await catalog.merge(made.suggestion.id, 'keeper');
    const after = (await catalog.get(event))!.data as { links: Array<{ kind: string; url: string }> };
    expect(after.links).toEqual([expect.objectContaining({ kind: 'bilti-mugah', url: `https://files.test/objects/${sha('a')}` })]);
    expect((await linkedCounts(catalog.db, event)).find((g) => g.type === 'relation')).toBeTruthy();
  });

  it("adds a hanacha's words, which its farbrengen's recordings then sync to", async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
    const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, url: 'https://example.org/a.mp3' });
    const made = await addHanachaText(catalog, 'chaim', { place: { target: event }, content: 'פסקה ראשונה.\n\nפסקה שניה.', rights: 'mine' });
    await catalog.merge(made.suggestion.id, 'keeper');
    expect(await hanachaOf(catalog, recording)).toBe(made.text);
    const text = (await catalog.get(made.text))!.data;
    expect(text).toMatchObject({ kind: 'hanacha', language: 'he' });
    expect((await linkedPage(catalog.db, made.text, { field: 'text', type: 'segment' })).total).toBe(2);
    // Words whose rights are unsure are kept and withheld.
    const unsure = await addHanachaText(catalog, 'chaim', { place: { target: event }, content: 'עוד.', rights: 'unsure' });
    expect((await catalog.review(unsure.suggestion.id)).entries.find((e) => e.type === 'text')?.after).toMatchObject({ licence: 'unknown' });
    await expect(addHanachaText(catalog, 'chaim', { place: { target: event }, content: '   ', rights: 'mine' })).rejects.toThrow();
  });

  it('adds a recording of a farbrengen the catalog lacks, and a sefer it does not know', async () => {
    const { catalog } = await freshCatalog();
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 10, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const rec = await suggestRecording(catalog, 'chaim', { file: sha('a'), place: { newEvent: { title: 'ש"פ בא תשמ"ב', date: '5742-05-06' } }, title: 'שיחה א' });
    await catalog.merge(rec.suggestion.id, 'shmuly');
    expect((await catalog.get(rec.event))!.data).toMatchObject({ kind: 'farbrengen', date: '5742-05-06' });
    expect((await catalog.get(rec.recording))!.data).toMatchObject({ event: rec.event, part: 1, file: sha('a') });

    await registerFile(catalog.db, { sha256: sha('b'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    const doc = await suggestDocument(catalog, 'chaim', { file: sha('b'), as: 'sefer', title: 'ספר הזכרונות', genre: 'history', year: { date: '5745' } });
    await catalog.merge(doc.suggestion.id, 'shmuly');
    expect((await catalog.get(doc.work as EntityId))!.data).toMatchObject({ title: { he: 'ספר הזכרונות' }, genre: 'history', levels: ['volume'] });
    expect((await catalog.get(doc.publication))!.data).toMatchObject({ kind: 'book-volume', work: doc.work, date: '5745' });
    await expect(suggestDocument(catalog, 'chaim', { file: sha('b'), as: 'sefer', title: '' })).rejects.toThrow();
  });
});
