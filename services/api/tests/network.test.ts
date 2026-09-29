import { beforeEach, describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import { EMBEDDING_DIMENSIONS, embedItems, type Embedder } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];
let set: EntityId;
let event: EntityId;

const fake: Embedder = {
  model: '@cf/baai/bge-m3',
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of t.split(/\s+/)) v[[...word].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % EMBEDDING_DIMENSIONS, 7)] += 1;
      return v;
    });
  },
};

beforeEach(async () => {
  ({ catalog, set } = await freshCatalog());
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
});

const json = async (app: ReturnType<typeof createApp>, path: string) => {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as any };
};

describe('search that lands on the moment, and by meaning', () => {
  it('gives the paragraph of a transcript with the moment it is heard', async () => {
    const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, url: 'https://example.org/a.mp3', sets: [set] });
    const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'transcript', recording, language: 'yi' });
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'V', kind: 'paragraph', content: 'אהבת ישראל', proofread: 0, origin: { by: 'transcribe:fake@1' } });
    const alignment = await add(catalog, 'mendy', 'keeper', 'alignment', { recording, text, granularity: 'paragraph' });
    await add(catalog, 'mendy', 'keeper', 'alignment-span', { alignment, segment, startMs: 61_000, endMs: 90_000 });
    const app = createApp({ catalog });
    const { body } = await json(app, `/v1/search/moments?q=${encodeURIComponent('אהבת')}`);
    expect(body.moments).toMatchObject([{ kind: 'paragraph', id: segment, event, recording, startMs: 61_000, machine: true }]);
  });

  it("gives a farbrengen's parts their synced hanachos in one request, and each part its own", async () => {
    const first = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, url: 'https://example.org/a.mp3', sets: [set] });
    const second = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק ב' }, url: 'https://example.org/b.mp3', sets: [set] });
    const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', recording: first, language: 'he' });
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'V', kind: 'paragraph', content: 'אהבת ישראל', proofread: 1 });
    const alignment = await add(catalog, 'mendy', 'keeper', 'alignment', { recording: first, text, granularity: 'paragraph' });
    await add(catalog, 'mendy', 'keeper', 'alignment-span', { alignment, segment, startMs: 61_000, endMs: 90_000 });
    const app = createApp({ catalog });
    const sync = { text, alignment, paragraphs: [{ id: segment, content: 'אהבת ישראל', startMs: 61_000, endMs: 90_000, checked: false }] };
    expect((await json(app, `/v1/recordings/${first}/hanacha`)).body).toEqual(sync);
    expect((await json(app, `/v1/recordings/${second}/hanacha`)).status).toBe(404);
    // Both parts at once: the one without a synced hanacha is left out.
    expect((await json(app, `/v1/recordings/batch/hanacha?ids=${first},${second}`)).body).toEqual({ items: { [first]: sync } });
    expect((await json(app, '/v1/recordings/batch/hanacha?ids=')).body).toEqual({ items: {} });
  });

  it('says search by meaning is not available until it is set up, and labels what it finds', async () => {
    expect((await json(createApp({ catalog }), '/v1/search/similar?q=x')).body).toEqual({ query: 'x', available: false, machine: true, results: [] });
    await embedItems(catalog, fake);
    const app = createApp({ catalog, embedder: fake });
    const { body } = await json(app, `/v1/search/similar?q=${encodeURIComponent('יו״ד שבט')}&types=event`);
    expect(body).toMatchObject({ available: true, machine: true, results: [{ item: { id: event }, machine: true }] });
    expect((await json(app, '/v1/search/similar?q=x&types=spaceship')).status).toBe(400);
  });
});

describe('links and health', () => {
  it("shows an item's links both ways, and the catalog's health", async () => {
    const other = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5743-05-10', title: { he: 'יו״ד שבט תשמ״ג' } });
    await add(catalog, 'mendy', 'keeper', 'relation', { kind: 'cites', from: other, to: event, note: 'שיחת יו״ד שבט תשמ״ב', origin: { by: 'citations@1' } });
    const app = createApp({ catalog });
    expect((await json(app, `/v1/entities/${event}/relations`)).body.relations).toMatchObject([{ kind: 'cites', direction: 'in', other, machine: true }]);
    const health = (await json(app, '/v1/health')).body;
    expect(health.years.map((y: { year: number }) => y.year)).toEqual([5742, 5743]);
    expect(health).toMatchObject({ recordings: { total: 0 }, links: { checked: 0, dead: 0 }, embeddings: { embedded: 0 } });
  });
});

describe('OAI-PMH', () => {
  const xml = async (app: ReturnType<typeof createApp>, query: string) => {
    const response = await app.request(`http://api.test/oai?${query}`);
    expect(response.headers.get('content-type')).toContain('text/xml');
    return response.text();
  };

  it('is offered only with an administrators address', async () => {
    expect((await createApp({ catalog }).request('/oai?verb=Identify')).status).toBe(404);
  });

  it('identifies itself, lists records a page at a time, and reports deletions', async () => {
    const author = await add(catalog, 'shmuly', 'shmuly', 'author', { name: { he: 'הרבי', en: 'The Rebbe' }, kind: 'rebbe', rebbe: 7, sets: [set] });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' }, slug: 'likkutei-sichos', authors: [author], genre: 'sichos', levels: ['volume'], sets: [set] }, '/likkutei-sichos');
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'volume', value: '1' }], order: 'V', label: { he: 'בראשית' }, date: '5725-07-01', events: [event], sets: [set] });
    const app = createApp({ catalog, oai: { adminEmail: 'stewards@example.org', siteUrl: 'https://rebbehub.test', pageSize: 2 } });

    const identify = await xml(app, 'verb=Identify');
    expect(identify).toContain('<adminEmail>stewards@example.org</adminEmail>');
    expect(identify).toContain('<deletedRecord>persistent</deletedRecord>');
    expect(identify).toContain('<request verb="Identify">http://api.test/oai</request>');

    const first = await xml(app, 'verb=ListIdentifiers&metadataPrefix=oai_dc');
    expect(first.match(/<header>/g)).toHaveLength(2);
    const token = /<resumptionToken>([^<]+)<\/resumptionToken>/.exec(first)![1]!;
    const second = await xml(app, `verb=ListRecords&resumptionToken=${token}`);
    expect(second).toContain(`<identifier>oai:rebbehub.test:${unit}</identifier>`);
    expect(second).toContain('<dc:title xml:lang="he">בראשית</dc:title>');
    expect(second).toContain('<dc:creator xml:lang="en">The Rebbe</dc:creator>');
    expect(second).toContain('<dc:relation>https://rebbehub.test/likkutei-sichos</dc:relation>');
    expect(second).toContain('<resumptionToken></resumptionToken>');

    const record = await xml(app, `verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:rebbehub.test:${event}`);
    expect(record).toContain('<dc:type>Event</dc:type>');
    expect(record).toContain('<dc:coverage xml:lang="en">10 Shevat 5742</dc:coverage>');
    expect(record).toContain(`<setSpec>set:${set}</setSpec>`);

    const cs = await catalog.createChangeset('mendy', { title: 'מחיקה' });
    await catalog.putRevision(cs.id, 'mendy', { id: unit, type: 'unit', data: null });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'keeper');
    const today = new Date().toISOString().slice(0, 10);
    const changed = await xml(app, `verb=ListIdentifiers&metadataPrefix=oai_dc&from=${today}&set=type:unit`);
    expect(changed).toContain(`<header status="deleted"><identifier>oai:rebbehub.test:${unit}</identifier>`);

    expect(await xml(app, 'verb=Nope')).toContain('<error code="badVerb">');
    expect(await xml(app, 'verb=ListRecords')).toContain('<error code="badArgument">');
    expect(await xml(app, 'verb=ListRecords&metadataPrefix=marc')).toContain('<error code="cannotDisseminateFormat">');
    expect(await xml(app, 'verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:elsewhere:rh-0000000')).toContain('<error code="idDoesNotExist">');
    expect(await xml(app, 'verb=ListRecords&resumptionToken=junk')).toContain('<error code="badResumptionToken">');
    expect(await xml(app, 'verb=ListRecords&metadataPrefix=oai_dc&from=2000-01-01&until=2000-01-02')).toContain('<error code="noRecordsMatch">');
    expect(await xml(app, 'verb=ListSets')).toContain('<setSpec>type:unit</setSpec>');
  });
});
