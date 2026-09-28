import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * Uploads with in-memory buckets: where the bytes go by their rights,
 * "we already have this", and the suggestion that adds the file to the
 * catalog for the keepers to approve.
 */

let app: Hono;
let event: EntityId;
let set: EntityId;
let buckets: { public: Map<string, number>; preservation: Map<string, number> };
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(fresh.set), '/events/5742-05-10');
  buckets = { public: new Map(), preservation: new Map() };
  const writer = (bucket: Map<string, number>) => ({ put: async (key: string, bytes: ArrayBuffer) => void bucket.set(key, bytes.byteLength) });
  app = createApp({
    catalog,
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    uploads: { public: writer(buckets.public), preservation: writer(buckets.preservation), maxBytes: 1000 },
  });
});

const upload = async (query: string, bytes: Uint8Array<ArrayBuffer>, mime: string, as = 'chaim') => {
  const response = await app.request(`/v1/uploads?${query}`, { method: 'POST', headers: { 'Content-Type': mime, 'X-Test-Account': as }, body: bytes });
  return { status: response.status, body: (await response.json()) as any };
};

const audio = new Uint8Array([1, 2, 3, 4, 5]);

describe('uploads', () => {
  it('adds a recording given freely: served, and sent for review in the farbrengen\'s set', async () => {
    const sent = await upload(`what=recording&for=${event}&rights=mine&title=${encodeURIComponent('שיחה א׳')}`, audio, 'audio/mpeg');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ existed: false, rights: 'open', served: true });
    expect(buckets.public.get(`objects/${sent.body.sha256}`)).toBe(5);
    expect(buckets.preservation.size).toBe(0);

    const review = await catalog.review(sent.body.suggestion);
    expect(review.changeset.status).toBe('open');
    expect(review.entries[0]).toMatchObject({ type: 'recording', after: { event, file: sent.body.sha256, title: { he: 'שיחה א׳' } } });
    await catalog.merge(sent.body.suggestion, 'keeper');
  });

  it('keeps a file of unsure rights privately, never served', async () => {
    const sent = await upload(`what=recording&for=${event}&rights=unsure`, audio, 'audio/mpeg');
    expect(sent.body).toMatchObject({ rights: 'link', served: false });
    expect(buckets.preservation.get(`objects/${sent.body.sha256}`)).toBe(5);
    expect(buckets.public.size).toBe(0);
  });

  it('says where a file already is, and adds nothing twice', async () => {
    const first = await upload(`what=recording&for=${event}&rights=mine`, audio, 'audio/mpeg');
    await catalog.merge(first.body.suggestion, 'keeper');
    const again = await upload(`what=recording&for=${event}&rights=mine`, audio, 'audio/mpeg', 'mendy');
    expect(again.body).toMatchObject({ existed: true, sha256: first.body.sha256 });
    expect(again.body.usedBy).toEqual([expect.objectContaining({ type: 'recording' })]);
  });

  it('adds a scan of a sefer as a printing and its scan', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const sent = await upload(`what=scan&for=${work}&rights=public-domain`, new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    expect(sent.body).toMatchObject({ rights: 'open', served: true });
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['publication', 'scan']);
  });

  it('refuses what does not fit', async () => {
    expect((await upload(`what=recording&for=${event}&rights=mine`, audio, 'audio/mpeg', '')).status).toBe(401);
    expect((await upload(`what=recording&for=${event}&rights=maybe`, audio, 'audio/mpeg')).status).toBe(400);
    expect((await upload(`what=recording&for=${event}&rights=mine`, audio, 'application/pdf')).status).toBe(400);
    expect((await upload(`what=scan&for=${event}&rights=mine`, audio, 'application/pdf')).status).toBe(400);
    expect((await upload(`what=recording&for=${event}&rights=mine`, new Uint8Array(1001), 'audio/mpeg')).status).toBe(422);
  });
});
