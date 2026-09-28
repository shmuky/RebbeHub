import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { EntityId } from '@rebbehub/model';
import { MAX_PLACES, paragraphsOf } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

let app: Hono;
let set: EntityId;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null });
});

const call = async (method: string, path: string, options: { as?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any, headers: response.headers };
};

describe('where a person stopped', () => {
  const reading = { kind: 'read', key: 'https://api.rebbehub.org/objects/abc', title: 'לקוטי שיחות חלק יב', sub: 'בראשית', href: '/read?src=x', place: { page: 14 } };

  it('keeps the latest place per thing, for its person only, newest first', async () => {
    expect((await call('GET', '/v1/places')).status).toBe(401);
    expect((await call('PUT', '/v1/places', { as: 'chaim', body: reading })).body).toMatchObject({ kind: 'read', place: { page: 14 } });
    await call('PUT', '/v1/places', { as: 'chaim', body: { ...reading, place: { page: 20 } } });
    await call('PUT', '/v1/places', { as: 'chaim', body: { kind: 'listen', key: '/events/5742-05-10', title: 'יו״ד שבט', href: '/events/5742-05-10', place: { index: 1, time: 312.5, queue: [] } } });
    const mine = await call('GET', '/v1/places', { as: 'chaim' });
    expect(mine.headers.get('Cache-Control')).toBe('no-store');
    expect(mine.body.places.map((p: { kind: string }) => p.kind)).toEqual(['listen', 'read']);
    expect(mine.body.places[1].place).toEqual({ page: 20 });
    expect((await call('GET', `/v1/places?kind=read&key=${encodeURIComponent(reading.key)}`, { as: 'chaim' })).body.places).toHaveLength(1);
    expect((await call('GET', '/v1/places', { as: 'mendy' })).body.places).toEqual([]);

    await call('DELETE', `/v1/places?kind=read&key=${encodeURIComponent(reading.key)}`, { as: 'chaim' });
    expect((await call('GET', '/v1/places', { as: 'chaim' })).body.places).toHaveLength(1);
  });

  it('takes only places on the site, of a sensible size, and keeps the latest few', async () => {
    expect((await call('PUT', '/v1/places', { as: 'chaim', body: { ...reading, href: 'https://elsewhere.example/' } })).status).toBe(422);
    expect((await call('PUT', '/v1/places', { as: 'chaim', body: { ...reading, href: '//elsewhere.example/' } })).status).toBe(422);
    expect((await call('PUT', '/v1/places', { as: 'chaim', body: { ...reading, kind: 'watch' } })).status).toBe(422);
    expect((await call('PUT', '/v1/places', { as: 'chaim', body: { ...reading, place: { big: 'x'.repeat(20_000) } } })).status).toBe(422);
    for (let i = 0; i < MAX_PLACES + 3; i++) await call('PUT', '/v1/places', { as: 'chaim', body: { ...reading, key: `k${i}` } });
    expect((await call('GET', '/v1/places?limit=100', { as: 'chaim' })).body.places).toHaveLength(MAX_PLACES);
  });
});

describe('translations', () => {
  let unit: EntityId;
  let original: EntityId;

  beforeEach(async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'א' } });
    original = await add(catalog, 'mendy', 'shmuly', 'text', { kind: 'edition', unit, language: 'he' });
  });

  it('come in as a suggestion: a text of their own with language, credit and rights, paragraph by paragraph', async () => {
    const made = await call('POST', `/v1/units/${unit}/translations`, {
      as: 'chaim',
      body: { language: 'en', credit: 'Translated by Chaim', translationOf: original, content: 'In the beginning.\n\nAnd the second\nline of it.\n\n\n' },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: 'open', author: 'chaim' });
    await catalog.merge(made.body.id, 'shmuly');

    const texts = (await call('GET', `/v1/entities/${unit}/backlinks?field=unit&type=text`)).body.backlinks as Array<{ from: string }>;
    expect(texts).toHaveLength(2);
    const translation = texts.map((b) => b.from).find((id) => id !== original)!;
    expect((await call('GET', `/v1/entities/${translation}`)).body.data).toEqual({ kind: 'translation', unit, language: 'en', translationOf: original, credit: 'Translated by Chaim' });
    const segments = (await call('GET', `/v1/entities/${translation}/children?field=text&type=segment`)).body.items;
    expect(segments.map((s: { data: { content: string } }) => s.data.content)).toEqual(['In the beginning.', 'And the second line of it.']);

    // A fix to one paragraph is its own suggestion, and marks it checked.
    const fix = await call('POST', '/v1/translations/fix', { as: 'mendy', body: { segment: segments[1].id, content: 'And the second line.' } });
    expect(fix.status).toBe(201);
    await catalog.merge(fix.body.id, 'shmuly');
    expect((await call('GET', `/v1/entities/${segments[1].id}`)).body.data).toMatchObject({ content: 'And the second line.', proofread: 1 });
  });

  it('label a machine translation until each paragraph is checked', async () => {
    const made = await call('POST', `/v1/units/${unit}/translations`, { as: 'chaim', body: { language: 'en', credit: 'Machine translation, unchecked', content: 'One.\n\nTwo.', machine: 'mt:example@1' } });
    await catalog.merge(made.body.id, 'shmuly');
    const text = (await catalog.db.query<{ id: string }>("SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'text' AND r.data->>'kind' = 'translation'")).rows[0]!.id;
    const segments = (await call('GET', `/v1/entities/${text}/children?field=text&type=segment`)).body.items;
    expect(segments.map((s: { data: { origin: unknown } }) => s.data.origin)).toEqual([
      { by: 'mt:example@1', checked: false },
      { by: 'mt:example@1', checked: false },
    ]);
    const fix = await call('POST', '/v1/translations/fix', { as: 'mendy', body: { segment: segments[0].id, content: 'One, checked.' } });
    await catalog.merge(fix.body.id, 'shmuly');
    expect((await call('GET', `/v1/entities/${segments[0].id}`)).body.data.origin).toEqual({ by: 'mt:example@1', checked: true });
  });

  it('refuse what cannot be kept: no credit, rights that forbid copies, a text that is not a translation', async () => {
    const post = (body: object) => call('POST', `/v1/units/${unit}/translations`, { as: 'chaim', body: { language: 'en', credit: 'X', content: 'Words.', ...body } });
    expect((await post({ credit: ' ' })).status).toBe(422);
    expect((await post({ licence: 'commercial' })).status).toBe(422);
    expect((await post({ language: 'xx' })).status).toBe(422);
    expect((await post({ content: '\n\n' })).status).toBe(422);
    expect((await post({ licence: 'cc-by-nc' })).status).toBe(201);
    expect((await call('POST', `/v1/units/${unit}/translations`, { body: { language: 'en', credit: 'X', content: 'Words.' } })).status).toBe(401);
    const segment = await add(catalog, 'mendy', 'shmuly', 'segment', { text: original, order: 'V', kind: 'paragraph', content: 'מילים', proofread: 0 });
    expect((await call('POST', '/v1/translations/fix', { as: 'mendy', body: { segment, content: 'x' } })).status).toBe(404);
  });

  it('split pasted text at blank lines', () => {
    expect(paragraphsOf('a\r\nb\r\n\r\n  c  \n\n\n')).toEqual(['a b', 'c']);
  });
});
