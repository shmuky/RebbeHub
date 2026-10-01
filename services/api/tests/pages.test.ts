import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { recordCover, registerFile } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * Every item's page through the API: all that points at an item, a page at
 * a time with its total; sefarim's covers; a file's own page; and adding
 * what the catalog lacks (a hanacha's PDF or words, a recording of a new
 * farbrengen, a new sefer), with the machine's proposal of where it goes.
 */

let app: Hono;
let set: EntityId;
let event: EntityId;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];
let buckets: { public: Map<string, number>; preservation: Map<string, number> };

const sha = (c: string) => c.repeat(64);

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  buckets = { public: new Map(), preservation: new Map() };
  const writer = (bucket: Map<string, number>) => ({ put: async (key: string, bytes: ArrayBuffer) => void bucket.set(key, bytes.byteLength) });
  app = createApp({
    catalog,
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    filesBaseUrl: 'https://files.test',
    uploads: { public: writer(buckets.public), preservation: writer(buckets.preservation), maxBytes: 1000 },
  });
});

const get = async (path: string) => {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as any };
};
const post = async (path: string, body: BodyInit, type: string, as = 'chaim') => {
  const response = await app.request(path, { method: 'POST', headers: { 'Content-Type': type, 'X-Test-Account': as }, body });
  return { status: response.status, body: (await response.json()) as any };
};
const pdf = (n: number) => new Uint8Array([37, 80, 68, 70, n]);

describe('all that belongs to an item', () => {
  it('counts the groups, and pages through one to its end', async () => {
    for (let i = 0; i < 5; i++) await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: `חלק ${i + 1}` }, part: i + 1 });
    const counts = await get(`/v1/entities/${event}/linked/counts`);
    expect(counts.body.groups).toEqual(expect.arrayContaining([{ type: 'recording', field: 'event', count: 5 }]));

    const first = await get(`/v1/entities/${event}/linked?field=event&type=recording&limit=2`);
    expect(first.body).toMatchObject({ total: 5 });
    expect(first.body.items.map((i: any) => i.data.part)).toEqual([1, 2]);
    const second = await get(`/v1/entities/${event}/linked?field=event&type=recording&limit=2&after=${first.body.next}`);
    expect(second.body.items.map((i: any) => i.data.part)).toEqual([3, 4]);
    const last = await get(`/v1/entities/${event}/linked?field=event&type=recording&limit=2&after=${second.body.next}`);
    expect(last.body.items.map((i: any) => i.data.part)).toEqual([5]);
    expect(last.body.next).toBeNull();

    expect((await get(`/v1/entities/${event}/linked`)).status).toBe(400);
    expect((await get(`/v1/entities/${event}/linked?field=event&after=nonsense!`)).status).toBe(422);
  });

  it('gives one group of what points at each of several items in one request, a few of each in order, and how far each text is checked', async () => {
    const other = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5743-05-10', title: { he: 'התוועדות אחרת' } }, '/events/5743-05-10');
    const alone = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5744-05-10', title: { he: 'בלי הקלטות' } }, '/events/5744-05-10');
    for (const [e, parts] of [[event, 3], [other, 2]] as const) for (let part = parts; part >= 1; part--) await add(catalog, 'mendy', 'keeper', 'recording', { event: e, title: { he: `חלק ${part}` }, part, url: `https://example.org/${part}.mp3`, sets: [set] });
    const both = await get(`/v1/entities/batch/linked?ids=${event},${other},${alone}&field=event&type=recording`);
    expect(both.status).toBe(200);
    expect(Object.keys(both.body.linked).sort()).toEqual([event, other].sort());
    expect(both.body.linked[event].map((r: { data: { part: number } }) => r.data.part)).toEqual([1, 2, 3]);
    expect(both.body.linked[other].map((r: { data: { part: number } }) => r.data.part)).toEqual([1, 2]);
    // At most `limit` of each, in the group's order, whatever the others have.
    const few = await get(`/v1/entities/batch/linked?ids=${event},${other}&field=event&type=recording&limit=1`);
    expect(few.body.linked[event].map((r: { data: { part: number } }) => r.data.part)).toEqual([1]);
    expect(few.body.linked[other]).toHaveLength(1);
    expect((await get(`/v1/entities/batch/linked?ids=${event}`)).status).toBe(400);
    expect((await get(`/v1/entities/batch/linked?ids=${event}&field=event&type=nonsense`)).status).toBe(400);
    expect((await get(`/v1/entities/batch/linked?ids=${Array.from({ length: 201 }, () => event).join(',')}&field=event`)).status).toBe(400);
    // Texts' progress: paragraphs (headings aside) and how many a person checked, for many texts at once.
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work: await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/sefer'), position: [{ level: 'sicha', value: '1' }], order: 'a', label: { he: 'שיחה' } });
    const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit, language: 'he' });
    const empty = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', unit, language: 'he' });
    await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'a', kind: 'heading', content: 'כותרת', proofread: 1 });
    for (const [order, proofread] of [['b', 1], ['c', 0], ['d', 2]] as const) await add(catalog, 'mendy', 'keeper', 'segment', { text, order, kind: 'paragraph', content: `פסקה ${order}`, proofread });
    // Two a machine made: one a person checked since, one nobody did (the list's quiet dot).
    await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'e', kind: 'paragraph', content: 'פסקה e', proofread: 1, origin: { by: 'ocr:kraken@5', checked: true } });
    await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'f', kind: 'paragraph', content: 'פסקה f', proofread: 0, origin: { by: 'ocr:kraken@5' } });
    const progress = await get(`/v1/texts/batch/progress?ids=${text},${empty}`);
    expect(progress.status).toBe(200);
    expect(progress.body.progress).toEqual({ [text]: { paragraphs: 5, checked: 3, machine: 1 } });
  });
});

describe("a list carries an item's facts, not its words", () => {
  it('leaves body out of every list, keeps it when an item is read by id, and gives a feed a suggestion without it', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['volume', 'sicha'], sets: [set] }, '/sefer');
    const body = { profile: 'sichos-kodesh', versions: [{ id: 'he', language: 'he', segments: [{ id: 'p1', kind: 'paragraph', text: [{ text: 'דברי השיחה' }] }] }] };
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '1' }], order: 'a', label: { he: 'שיחה' }, body });
    const facts = (items: Array<{ id: string; data: Record<string, unknown> }>) => {
      const row = items.find((i) => i.id === unit);
      expect(row?.data).toMatchObject({ label: { he: 'שיחה' }, order: 'a' });
      for (const i of items) expect(i.data).not.toHaveProperty('body');
    };
    facts((await get(`/v1/entities/${work}/linked?field=work&type=unit`)).body.items);
    facts((await get(`/v1/entities/batch/linked?ids=${work}&field=work`)).body.linked[work]);
    facts((await get(`/v1/entities/${work}/children?field=work&type=unit`)).body.items);
    facts((await get(`/v1/works/${work}/parts/1`)).body.items);
    facts((await get('/v1/entities?type=unit')).body.items);
    expect((await get(`/v1/entities/${unit}`)).body.data.body).toEqual(body);
    expect((await get(`/v1/entities/batch?ids=${unit}`)).body.items[0].data.body).toEqual(body);

    // A suggestion's page carries each item before and after in full for its reviewer; a feed asks for the facts (brief=1),
    // and finds what changed whole in `changes`. Its checks: those that did not pass, and how many did.
    const cs = await catalog.createChangeset('chaim', { title: 'Relabel' });
    await catalog.putRevision(cs.id, 'chaim', { id: unit, type: 'unit', data: { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '1' }], order: 'a', label: { he: 'שיחה א' }, body } });
    const added = await catalog.putRevision(cs.id, 'chaim', { type: 'unit', data: { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '2' }], order: 'b', label: { he: 'שיחה ב' }, body } });
    await catalog.submit(cs.id, 'chaim');
    const entryOf = (page: { entries: Array<{ entityId: string }> }, id: string) => page.entries.find((e) => e.entityId === id) as any;
    const full = (await get(`/v1/suggestions/${cs.id}`)).body;
    expect(entryOf(full, unit).before.body).toEqual(body);
    expect(entryOf(full, unit).after.body).toEqual(body);
    expect(entryOf(full, added).changes[0].after.body).toEqual(body);
    const brief = (await get(`/v1/suggestions/${cs.id}?brief=1`)).body;
    expect(entryOf(brief, unit).before).toEqual({ work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '1' }], order: 'a', label: { he: 'שיחה' } });
    expect(entryOf(brief, unit).after.label).toEqual({ he: 'שיחה א' });
    expect(entryOf(brief, unit).after).not.toHaveProperty('body');
    expect(entryOf(brief, unit).changes).toEqual([{ path: '/label/he', before: 'שיחה', after: 'שיחה א' }]);
    // A new item is one change, of the whole: its facts there too.
    expect(entryOf(brief, added).before).toBeNull();
    expect(entryOf(brief, added).after.label).toEqual({ he: 'שיחה ב' });
    expect(entryOf(brief, added).changes).toEqual([{ path: '', after: { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '2' }], order: 'b', label: { he: 'שיחה ב' } } }]);
    expect(brief.changeset.checks.every((k: { status: string }) => k.status !== 'pass')).toBe(true);
    expect(brief.changeset.checkCounts).toMatchObject({ fail: 0 });
    expect(brief.changeset.checkCounts.pass).toBeGreaterThan(0);
    // The list says nothing of the checks (a list of imports carried thousands).
    const listed = (await get('/v1/suggestions?status=open')).body.suggestions.find((s: { id: number }) => s.id === cs.id);
    expect(listed).toMatchObject({ title: 'Relabel', items: 2 });
    expect(listed).not.toHaveProperty('checks');
  });
});

describe('covers and files', () => {
  it("gives a sefer's cover while its PDF is served, and a file's own page", async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const pub = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work });
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    await add(catalog, 'mendy', 'keeper', 'scan', { publication: pub, file: sha('a'), completeness: 'complete' });
    const picture = (c: string) => ({ sha256: sha(c), bytes: 5, width: 480, height: 672 });
    await recordCover(catalog.db, { entity: work, src: sha('a'), page: 3, chosenBy: 'machine', score: 4, reasons: ['sparse'], image: picture('d'), thumb: picture('e') });

    const covers = await get(`/v1/covers?ids=${work},${event}`);
    expect(Object.keys(covers.body.covers)).toEqual([work]);
    expect(covers.body.covers[work]).toMatchObject({ page: 3, machine: true, thumb: { url: `https://files.test/objects/${sha('e')}`, width: 480 } });

    await catalog.db.query("INSERT INTO file_fingerprint (sha256, kind, encoder, pages) VALUES ($1, 'pdf-pages', 'dhash-256@1', 12)", [sha('a')]);
    const cover = await get(`/v1/works/${work}/cover`);
    expect(cover.body).toMatchObject({ work, chosen: null, cover: { page: 3 }, sources: [{ sha256: sha('a'), via: 'scan', pages: 12 }] });
    expect((await get(`/v1/works/${event}/cover`)).status).toBe(404);

    const about = await get(`/v1/files/${sha('a')}/about`);
    expect(about.body).toMatchObject({ sha256: sha('a'), rights: 'open', url: `https://files.test/objects/${sha('a')}`, usedBy: { total: 1 } });
    expect(about.body.usedBy.items[0]).toMatchObject({ type: 'scan' });
    expect(about.body.covers).toEqual([{ entity: work, page: 3, machine: true }]);
    expect(JSON.stringify(about.body.sources)).not.toContain('uploaded_by');
    expect((await get(`/v1/files/${sha('0')}/about`)).status).toBe(404);
  });
});

describe('adding what the catalog lacks', () => {
  it('proposes the farbrengen a file is of, from the date in its name', async () => {
    const proposed = await post('/v1/uploads/propose', JSON.stringify({ what: 'hanacha', name: 'הנחה י שבט תשמב.pdf' }), 'application/json');
    expect(proposed.status).toBe(200);
    expect(proposed.body).toMatchObject({ machine: true, what: 'hanacha', date: '5742-05-10' });
    expect(proposed.body.candidates[0]).toMatchObject({ id: event });
    expect((await post('/v1/uploads/propose', JSON.stringify({ what: 'x' }), 'application/json')).status).toBe(400);
    expect((await post('/v1/uploads/propose', JSON.stringify({ what: 'hanacha' }), 'application/json', '')).status).toBe(401);
  });

  it("adds a hanacha's PDF to its farbrengen, linked from its page since it is served", async () => {
    const sent = await post(`/v1/uploads?what=hanacha&for=${event}&rights=mine&kind=mugah`, pdf(1), 'application/pdf');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ as: 'hanacha', rights: 'open', served: true, event });
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['event', 'publication', 'relation', 'scan']);
    const eventEntry = review.entries.find((e) => e.type === 'event')!;
    expect(JSON.stringify(eventEntry.after)).toContain(`https://files.test/objects/${sent.body.sha256}`);
    await catalog.merge(sent.body.suggestion, 'keeper');
  });

  it('keeps a hanacha whose rights are unsure, and does not link it', async () => {
    const sent = await post(`/v1/uploads?what=hanacha&for=${event}&rights=unsure`, pdf(2), 'application/pdf');
    expect(sent.body).toMatchObject({ served: false });
    expect(buckets.preservation.size).toBe(1);
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['publication', 'relation', 'scan']);
  });

  it('adds a recording of a farbrengen the catalog lacks, with the farbrengen', async () => {
    const sent = await post(`/v1/uploads?what=recording&eventTitle=${encodeURIComponent('התוועדות ש״פ בא')}&eventDate=5742-05-08&rights=mine`, new Uint8Array([1, 2, 3]), 'audio/mpeg');
    expect(sent.status).toBe(201);
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['event', 'recording']);
    expect((await post(`/v1/uploads?what=recording&eventTitle=x&rights=mine`, new Uint8Array([1]), 'audio/mpeg')).status).toBe(400);
  });

  it('adds a sefer the catalog does not know, with its printing and scan', async () => {
    const sent = await post(`/v1/uploads?what=document&as=sefer&title=${encodeURIComponent('ספר חדש')}&set=${set}&year=5750&rights=public-domain`, pdf(3), 'application/pdf');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ as: 'sefer', served: true });
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['publication', 'scan', 'work']);
    expect((await post(`/v1/uploads?what=document&as=sefer&rights=mine`, pdf(4), 'application/pdf')).status).toBe(400);
  });

  it("adds a hanacha's words to its farbrengen, for its keepers to review", async () => {
    const sent = await post('/v1/hanachos/text', JSON.stringify({ for: event, content: 'פסקה ראשונה\n\nפסקה שנייה', rights: 'mine' }), 'application/json');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ event });
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.filter((e) => e.type === 'segment')).toHaveLength(2);
    await catalog.merge(sent.body.suggestion, 'keeper');
    expect((await post('/v1/hanachos/text', JSON.stringify({ for: event, content: '', rights: 'mine' }), 'application/json')).status).toBe(422);
    expect((await post('/v1/hanachos/text', JSON.stringify({ content: 'x', rights: 'mine' }), 'application/json')).status).toBe(400);
  });
});
