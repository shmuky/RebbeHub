import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { EntityId } from '@rebbehub/model';
import { recordDerivation, recordPageFix, registerFile, setRights } from '@rebbehub/core';
import { createApp, parseRange } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

let app: Hono;
let set: EntityId;
let event: EntityId;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  event = await add(fresh.catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  // Tests sign in with a header; a real deployment verifies a session.
  app = createApp({ catalog: fresh.catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null, reportSalt: 'test', reportsPerHour: 2 });
});

const call = async (method: string, path: string, options: { as?: string; body?: unknown; ip?: string } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  if (options.ip) headers['CF-Connecting-IP'] = options.ip;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

describe('reading', () => {
  it('serves items, paths, history, search and the schemas', async () => {
    expect((await call('GET', '/v1')).body).toMatchObject({ name: 'RebbeHub', docs: '/openapi.json' });
    expect((await call('GET', `/v1/entities/${event}`)).body).toMatchObject({ id: event, type: 'event', data: { date: '5742-05-10' } });
    expect((await call('GET', `/v1/entities/${event.toUpperCase()}`)).status).toBe(200); // ids are read forgivingly
    expect((await call('GET', '/v1/resolve?path=/events/5742-05-10')).body).toMatchObject({ id: event });
    expect((await call('GET', `/v1/entities/${event}/history`)).body.history).toHaveLength(1);
    const search = await call('GET', `/v1/search?q=${encodeURIComponent('י׳ שבט תשמ״ב')}`);
    expect(search.body.date).toMatchObject({ key: '5742-05-10', en: '10 Shevat 5742' });
    expect(search.body.results.map((r: { id: string }) => r.id)).toContain(event);
    expect((await call('GET', `/v1/entities?type=event&set=${set}`)).body.items).toHaveLength(1);
    expect((await call('GET', '/v1/types')).body.types.length).toBe(21);
    expect((await call('GET', '/openapi.json')).body.openapi).toBe('3.1.0');
  });

  it('answers mistakes plainly', async () => {
    expect(await call('GET', '/v1/entities/nope')).toMatchObject({ status: 400 });
    expect(await call('GET', '/v1/entities/rh-zzzzzzzz')).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(await call('GET', '/v1/entities?type=spaceship')).toMatchObject({ status: 400 });
    expect(await call('GET', '/v1/nothing-here')).toMatchObject({ status: 404 });
  });
});

describe('browsing', () => {
  it('lists a parent\'s children in order, events by date, several items at once, and counts', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const second = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '2' }], order: 'k', label: { he: 'ב' } });
    const first = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'א' } });
    const page1 = await call('GET', `/v1/entities/${work}/children?field=work&type=unit&limit=1`);
    expect(page1.body.items.map((i: { id: string }) => i.id)).toEqual([first]);
    const page2 = await call('GET', `/v1/entities/${work}/children?field=work&type=unit&after=${page1.body.next}`);
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([second]);

    const later = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5742-05-12', title: { he: 'י״ב שבט' } });
    const other = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5711-05-10', title: { he: 'יו״ד שבט תשי״א' } });
    expect((await call('GET', '/v1/events?within=5742-05')).body.items.map((i: { id: string }) => i.id)).toEqual([event, later]);
    expect((await call('GET', '/v1/events?within=5742')).body.items).toHaveLength(2);
    expect((await call('GET', '/v1/events?day=05-10')).body.items.map((i: { id: string }) => i.id)).toEqual([other, event]);
    expect(await call('GET', '/v1/events?within=spring')).toMatchObject({ status: 422 });

    expect((await call('GET', `/v1/entities/batch?ids=${later},rh-zzzzzzzz,${event}`)).body.items.map((i: { id: string }) => i.id)).toEqual([later, event]);
    expect((await call('GET', '/v1/stats')).body.counts).toMatchObject({ event: 3, unit: 2, work: 1, set: 1 });
  });

  it('finds events on several days, on exact dates, and those missing a recording or a text', async () => {
    const later = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5742-05-12', title: { he: 'י״ב שבט' }, links: [{ kind: 'bilti-mugah', label: { he: 'הנחה' }, url: 'https://example.test/h.pdf' }] });
    await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, url: 'https://example.test/a.mp3', part: 1 });
    const ids = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id);
    expect(ids((await call('GET', '/v1/events?day=05-10,05-12')).body)).toEqual([event, later]);
    expect(ids((await call('GET', '/v1/events?dates=5742-05-12')).body)).toEqual([later]);
    const listed = (await call('GET', '/v1/events?within=5742')).body.items;
    expect(listed.map((e: { recordings: number }) => e.recordings)).toEqual([1, 0]); // each says how many recordings it has
    expect(ids((await call('GET', '/v1/events?missing=recordings')).body)).toEqual([later]);
    expect(ids((await call('GET', '/v1/events?missing=texts')).body)).toEqual([event]);
    expect(await call('GET', '/v1/events?dates=5742-05')).toMatchObject({ status: 422 });
    expect(await call('GET', '/v1/events?missing=everything')).toMatchObject({ status: 400 });
  });

  it("gives a work's volumes, one volume's units, and how many units each work has", async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'אגרות' }, slug: 'letters', authors: [], genre: 'igros', levels: ['volume', 'letter'], sets: [set] });
    const volume = (n: string) => ({ level: 'volume', value: n, label: { he: `חלק ${n}` } });
    await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [volume('1'), { level: 'letter', value: '1' }], order: 'V', label: { he: 'א' } });
    await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [volume('1'), { level: 'letter', value: '2' }], order: 'k', label: { he: 'ב' } });
    const inTwo = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [volume('2'), { level: 'letter', value: '3' }], order: 'r', label: { he: 'ג' } });
    expect((await call('GET', `/v1/works/${work}/outline`)).body.parts).toEqual([
      { value: '1', label: { he: 'חלק 1' }, units: 2 },
      { value: '2', label: { he: 'חלק 2' }, units: 1 },
    ]);
    expect((await call('GET', `/v1/works/${work}/parts/2`)).body.items.map((i: { id: string }) => i.id)).toEqual([inTwo]);
    expect((await call('GET', '/v1/refcounts?field=work&type=unit')).body.counts).toEqual({ [work]: 3 });
    expect(await call('GET', '/v1/refcounts?field=1;drop')).toMatchObject({ status: 400 });
  });

  it('sums up the community: who added what, reports waiting, people, and what is missing', async () => {
    await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact' }, ip: '192.0.2.1' });
    const community = (await call('GET', '/v1/community')).body;
    expect(community.recent[0]).toMatchObject({ authorName: 'Mendy', mergedBy: 'keeper', mergedByName: 'Set keeper', changes: 1, authorIsBot: false });
    expect(community.openReports).toBe(1);
    expect(community.people).toBeGreaterThanOrEqual(2); // mendy, and shmuly who set up the set
    expect(community.gaps).toEqual({ events: 1, eventsWithoutRecordings: 1, eventsWithoutTexts: 1 });
  });
});

describe('the media proxy', () => {
  it('serves a file\'s bytes, and ranges of them, only while its rights allow', async () => {
    const bytes = new TextEncoder().encode('0123456789');
    const sha256 = 'c'.repeat(64);
    await registerFile(catalog.db, { sha256, bytes: bytes.length, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const files = {
      async get(key: string, range?: { offset: number; length?: number }) {
        if (key !== `objects/${sha256}`) return null;
        const part = range ? bytes.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length) : bytes;
        return { body: new Blob([part]).stream(), size: bytes.length };
      },
    };
    const proxy = createApp({ catalog, files });
    const whole = await proxy.request(`http://api.test/objects/${sha256}`);
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe('0123456789');
    const part = await proxy.request(`http://api.test/objects/${sha256}`, { headers: { Range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    expect((await proxy.request(`http://api.test/objects/${sha256}`, { headers: { Range: 'bytes=20-' } })).status).toBe(416);
    expect(await (await proxy.request(`http://api.test/v1/files/${sha256}`)).json()).toMatchObject({ url: `http://api.test/objects/${sha256}` });

    // A copy made from it (a scan's reading copy) is listed with it, and served under the same rights.
    const copy = 'd'.repeat(64);
    await recordDerivation(catalog.db, { src: sha256, profile: 'reading-copy', sha256: copy, bytes: 8, mime: 'audio/mpeg', encoder: 'test@1' });
    expect(await (await proxy.request(`http://api.test/v1/files/${sha256}`)).json()).toMatchObject({
      derivations: [{ profile: 'reading-copy', sha256: copy, bytes: 8, encoder: 'test@1', url: `http://api.test/objects/${copy}` }],
    });

    await setRights(catalog.db, 'shmuly', sha256, 'preserved', 'takedown');
    expect((await proxy.request(`http://api.test/objects/${sha256}`)).status).toBe(404);
    expect((await proxy.request(`http://api.test/objects/${copy}`)).status).toBe(404);
    expect(await (await proxy.request(`http://api.test/v1/files/${sha256}`)).json()).toMatchObject({ url: null });
  });

  it("tells the reader what a PDF on Drive needs, by its Drive id, and where its reading copy is", async () => {
    const files = { async get() { return null; } };
    const proxy = createApp({ catalog, files });
    // A publisher's scan RebbeHub only links to: its turns, no copy.
    const linked = 'e'.repeat(64);
    await registerFile(catalog.db, { sha256: linked, bytes: 100, mime: 'application/pdf', source: 'other', licence: 'free-to-read', fileClass: 'publisher-scan', url: 'https://drive.google.com/file/d/1LinkedDriveFile_x/view?resourcekey=0-abc', held: false });
    const turn = { page: 2, angle: 0.6, transform: [1, 0.01, -0.01, 1, 2, -1.5] };
    await recordPageFix(catalog.db, { sha256: linked, encoder: 'pdf-level@1', verdict: 'fixed', pages: [turn] });
    const fixed = await proxy.request('http://api.test/v1/page-fixes/drive/1LinkedDriveFile_x');
    expect(fixed.status).toBe(200);
    expect(await fixed.json()).toEqual({ sha256: linked, encoder: 'pdf-level@1', verdict: 'fixed', reason: null, pages: [turn], readingCopy: null });
    expect(await (await proxy.request(`http://api.test/v1/files/${linked}`)).json()).toMatchObject({ url: null, pageFix: { verdict: 'fixed', pages: [turn] } });

    // An open scan RebbeHub serves, with its reading copy: the reader opens the copy.
    const open = 'f'.repeat(64);
    await registerFile(catalog.db, { sha256: open, bytes: 100, mime: 'application/pdf', source: 'mafteiach', licence: 'unknown', fileClass: 'sichos-kodesh-hanacha', url: 'https://drive.google.com/file/d/1OpenSichosKodesh/view', held: true });
    await recordDerivation(catalog.db, { src: open, profile: 'reading-copy', sha256: '9'.repeat(64), bytes: 90, mime: 'application/pdf', encoder: 'pdf-fix@1' });
    await recordPageFix(catalog.db, { sha256: open, encoder: 'pdf-fix@1', verdict: 'fixed', pages: [turn] });
    expect(await (await proxy.request('http://api.test/v1/page-fixes/drive/1OpenSichosKodesh')).json()).toMatchObject({ verdict: 'fixed', readingCopy: `http://api.test/objects/${'9'.repeat(64)}` });

    // Nothing known, or nothing measured: not found.
    expect((await proxy.request('http://api.test/v1/page-fixes/drive/1NeverSeenBefore')).status).toBe(404);
    expect((await proxy.request('http://api.test/v1/page-fixes/drive/short')).status).toBe(404);
  });

  it('serves the published manifests, and nothing else from the bucket', async () => {
    const manifest = JSON.stringify({ format: 'rebbehub-reading-copies', files: [] });
    const files = {
      async get(key: string) {
        return key === 'manifests/reading-copies/sichos-kodesh.json' ? { body: new Blob([manifest]).stream(), size: manifest.length } : null;
      },
    };
    const proxy = createApp({ catalog, files });
    const found = await proxy.request('http://api.test/manifests/reading-copies/sichos-kodesh.json');
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ format: 'rebbehub-reading-copies', files: [] });
    expect((await proxy.request('http://api.test/manifests/reading-copies/other.json')).status).toBe(404);
    expect((await proxy.request('http://api.test/manifests/..%2Fobjects/x.json')).status).toBe(404);
  });

  it('reads Range headers', () => {
    expect(parseRange('bytes=0-99')).toEqual({ offset: 0, length: 100 });
    expect(parseRange('bytes=100-')).toEqual({ offset: 100 });
    expect(parseRange('bytes=-10', 50)).toEqual({ offset: 40, length: 10 });
    expect(parseRange('bytes=1-2,5-6')).toBeNull();
    expect(parseRange(undefined)).toBeNull();
  });
});

describe('rights', () => {
  it('never serves the words of a text whose source forbids copies', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה א' } });
    const closed = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', unit, language: 'he', licence: 'site-terms' });
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text: closed, order: 'V', kind: 'paragraph', content: 'לא לפרסום', proofread: 0 });
    const served = await call('GET', `/v1/entities/${segment}`);
    expect(served.body).toMatchObject({ id: segment, data: { content: '' } });
    expect(served.body.withheld).toMatch(/site-terms/);
    expect(JSON.stringify((await call('GET', `/v1/revisions/${served.body.rev}`)).body)).not.toContain('לא לפרסום');
    expect(JSON.stringify((await call('GET', '/v1/commits?since=0&limit=100')).body)).not.toContain('לא לפרסום');
    expect(JSON.stringify((await call('GET', '/v1/entities?type=segment')).body)).not.toContain('לא לפרסום');
  });
});

describe('reports', () => {
  it('need no account, and are rate limited per address', async () => {
    expect(await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact', note: 'wrong year' }, ip: '1.2.3.4' })).toMatchObject({ status: 201 });
    expect(await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact' }, ip: '1.2.3.4' })).toMatchObject({ status: 201 });
    expect(await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact' }, ip: '1.2.3.4' })).toMatchObject({ status: 429 });
    expect(await call('POST', '/v1/reports', { body: { reason: 'nonsense' } })).toMatchObject({ status: 400 });
    expect(await call('GET', `/v1/reports?set=${set}`)).toMatchObject({ status: 401 });
    expect((await call('GET', `/v1/reports?set=${set}`, { as: 'keeper' })).body.reports).toHaveLength(2);
  });
});

describe('suggestions', () => {
  it('go from draft to approval over the API', async () => {
    expect(await call('POST', '/v1/suggestions', { body: { title: 'x' } })).toMatchObject({ status: 401 });
    const created = await call('POST', '/v1/suggestions', { as: 'chaim', body: { title: 'Occasion for Yud Shvat' } });
    expect(created.status).toBe(201);
    const id = created.body.id;
    await call('PUT', `/v1/suggestions/${id}/items`, { as: 'chaim', body: { id: event, type: 'event', data: { ...yudShvat(set), occasion: 'yud-shvat' } } });
    const submitted = await call('POST', `/v1/suggestions/${id}/submit`, { as: 'chaim' });
    expect(submitted.body.status).toBe('open');
    const view = await call('GET', `/v1/suggestions/${id}`);
    expect(view.body.entries[0].changes).toEqual([{ path: '/occasion', after: 'yud-shvat' }]);
    expect(await call('POST', `/v1/suggestions/${id}/approve`, { as: 'chaim' })).toMatchObject({ status: 403 });
    expect((await call('POST', `/v1/suggestions/${id}/approve`, { as: 'keeper', body: {} })).status).toBe(200);
    expect((await call('GET', `/v1/entities/${event}`)).body.data.occasion).toBe('yud-shvat');
  });

  it('reports clashes as 409 with the choices', async () => {
    const a = (await call('POST', '/v1/suggestions', { as: 'chaim', body: { title: 'a' } })).body.id;
    const b = (await call('POST', '/v1/suggestions', { as: 'mendy', body: { title: 'b' } })).body.id;
    await call('PUT', `/v1/suggestions/${a}/items`, { as: 'chaim', body: { id: event, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } } });
    await call('PUT', `/v1/suggestions/${b}/items`, { as: 'mendy', body: { id: event, type: 'event', data: { ...yudShvat(set), date: '5742-05-12' } } });
    await call('POST', `/v1/suggestions/${a}/submit`, { as: 'chaim' });
    await call('POST', `/v1/suggestions/${b}/submit`, { as: 'mendy' });
    await call('POST', `/v1/suggestions/${a}/approve`, { as: 'keeper' });
    const clash = await call('POST', `/v1/suggestions/${b}/approve`, { as: 'keeper' });
    expect(clash.status).toBe(409);
    expect(clash.body.conflicts[0]).toMatchObject({ path: `${event}/date`, ours: '5742-05-11', theirs: '5742-05-12' });
    const settled = await call('POST', `/v1/suggestions/${b}/approve`, { as: 'keeper', body: { resolutions: { [event]: { '/date': { take: 'ours' } } } } });
    expect(settled.status).toBe(200);
  });
});

/**
 * "Suggest a fix" as the site's form sends it (one call), and the
 * reviewer's view of it: names instead of ids, and whether this person
 * may approve (so the site knows whether to show the buttons).
 */
describe('suggesting a fix in one step', () => {
  it('sends a fixed date for review, which the keeper, and not its author, may approve', async () => {
    const fixed = { ...yudShvat(set), date: '5742-05-11' };
    expect((await call('POST', '/v1/suggestions/quick', { body: { entityId: event, data: fixed } })).status).toBe(401);
    const sent = await call('POST', '/v1/suggestions/quick', { as: 'chaim', body: { entityId: event, data: fixed, title: 'Wrong date', note: 'The recording says 11 Shvat' } });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'open', title: 'Wrong date', author: 'chaim', description: 'The recording says 11 Shvat' });

    const asAuthor = (await call('GET', `/v1/suggestions/${sent.body.id}`, { as: 'chaim' })).body;
    expect(asAuthor).toMatchObject({ mine: true, mayApprove: false, names: { chaim: 'Chaim' } });
    expect(asAuthor.entries[0].changes).toEqual([{ path: '/date', before: '5742-05-10', after: '5742-05-11' }]);
    expect((await call('GET', `/v1/suggestions/${sent.body.id}`, { as: 'keeper' })).body).toMatchObject({ mine: false, mayApprove: true });
    expect((await call('GET', `/v1/suggestions/${sent.body.id}`)).body).toMatchObject({ mayApprove: false, mayApproveReason: 'sign in to review' });

    await call('POST', `/v1/suggestions/${sent.body.id}/approve`, { as: 'keeper' });
    expect((await call('GET', `/v1/entities/${event}`)).body.data.date).toBe('5742-05-11');

    // History names who changed it and who approved, and says what changed, in fields.
    const [latest, first] = (await call('GET', `/v1/entities/${event}/history`)).body.history;
    expect(latest).toMatchObject({ message: 'Wrong date', authorName: 'Chaim', mergedByName: 'Set keeper', created: false, changes: [{ path: '/date', before: '5742-05-10', after: '5742-05-11' }] });
    expect(first).toMatchObject({ created: true, changes: [] });
  });

  it('refuses an item that is not there', async () => {
    expect((await call('POST', '/v1/suggestions/quick', { as: 'chaim', body: { entityId: 'rh-zzzzzzzz', data: {} } })).status).toBe(404);
  });
});

describe('following', () => {
  it('lists what a person follows, and the changes to it since they followed', async () => {
    expect((await call('GET', '/v1/follows')).status).toBe(401);
    await call('POST', '/v1/follows', { as: 'chaim', body: { kind: 'entity', id: event } });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    await call('POST', '/v1/follows', { as: 'chaim', body: { kind: 'entity', id: work } });

    const fixed = await call('POST', '/v1/suggestions/quick', { as: 'mendy', body: { entityId: event, data: { ...yudShvat(set), date: '5742-05-11' }, title: 'Wrong date' } });
    await call('POST', `/v1/suggestions/${fixed.body.id}/approve`, { as: 'keeper' });
    // A sicha added to the followed sefer shows too.
    await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'א' } });

    const mine = (await call('GET', '/v1/follows', { as: 'chaim' })).body;
    expect(mine.follows.map((f: { id: string }) => f.id).sort()).toEqual([event, work].sort());
    expect(mine.items).toHaveLength(2);
    expect(mine.feed.map((f: { message: string }) => f.message)).toEqual(['Add unit', 'Wrong date']);
    expect(mine.feed[1]).toMatchObject({ entityId: event, authorName: 'Mendy', changes: 1 });

    await call('POST', '/v1/follows', { as: 'chaim', body: { kind: 'entity', id: event, on: false } });
    expect((await call('GET', '/v1/follows', { as: 'chaim' })).body.follows).toHaveLength(1);
  });
});

describe('the Missing board and projects', () => {
  it('lists what is missing, and a project works through it with its progress', async () => {
    const other = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'ט״ו שבט' }, date: '5742-05-15', sets: [set] }, '/events/5742-05-15');
    const missing = (await call('GET', '/v1/missing?kind=recordings&within=5742')).body;
    expect(missing.total).toBe(2);
    expect((await call('GET', '/v1/missing?kind=scans')).body.total).toBe(0);
    expect((await call('GET', '/v1/missing?kind=spaceships')).status).toBe(400);

    // The files Sichos-Kodesh's archive could not get, each with its item when RebbeHub has it.
    await catalog.loadArchiveGaps([
      { collection: 'farbrengens', item_id: '1', kind: 'pdf', source_id: 'd1', role: 'mugah', entity_id: event, source: 'drive', url: 'https://drive.google.com/file/d/d1/view', label: 'לקו"ש', hebrew_date: '5742-05-10', status: 'unresolved', http_status: 404, error: null, attempts: 2, checked_at: '2026-09-01T00:00:00Z' },
      { collection: 'yomanim', item_id: 'y', kind: 'pdf', source_id: 'd2', role: '', entity_id: null, source: 'drive', url: 'https://drive.google.com/file/d/d2/view', label: 'יומן', hebrew_date: null, status: 'error', http_status: 500, error: 'server error', attempts: 5, checked_at: null },
    ]);
    const files = (await call('GET', '/v1/missing?kind=files')).body;
    expect(files.total).toBe(2);
    expect(files.items[0]).toMatchObject({ item_id: '1', status: 'unresolved', entity: { id: event, path: '/events/5742-05-10' } });
    expect(files.items[1]).toMatchObject({ item_id: 'y', entity: null });

    // A contributor opens no projects; the set's keeper does.
    const input = { slug: 'recordings-5742', name: 'הקלטות תשמ״ב', goal: 'Every farbrengen of 5742 with its recording', set, missing: 'recordings', within: '5742' };
    expect((await call('POST', '/v1/projects', { as: 'chaim', body: input })).status).toBe(403);
    expect((await call('POST', '/v1/projects', { as: 'keeper', body: input })).status).toBe(201);

    let project = (await call('GET', '/v1/projects/recordings-5742')).body;
    expect(project.project).toMatchObject({ name: 'הקלטות תשמ״ב', total: 2, done: 0, status: 'open' });
    expect(project.next).toHaveLength(2);

    await add(catalog, 'mendy', 'keeper', 'recording', { event: other, title: { he: 'שיחה א׳' }, url: 'https://example.org/a.mp3', sets: [set] });
    project = (await call('GET', '/v1/projects/recordings-5742')).body;
    expect(project.project).toMatchObject({ total: 2, done: 1 });
    expect(project.next.map((e: { id: string }) => e.id)).toEqual([event]);

    expect((await call('GET', '/v1/projects')).body.projects).toHaveLength(1);
    await call('POST', '/v1/projects/recordings-5742/close', { as: 'keeper' });
    expect((await call('GET', '/v1/projects/recordings-5742')).body).toMatchObject({ project: { status: 'closed' }, next: [] });
  });
});

describe('the wiki model', () => {
  it('keeps its own copy of each text: copied once from Sichos-Kodesh, checked by hash, then served from RebbeHub', async () => {
    const { createHash } = await import('node:crypto');
    const article = '<article><h1>א</h1><p>טקסט</p></article>';
    const sha = createHash('sha256').update(article).digest('hex');
    const store = (objects: Map<string, Uint8Array>) => ({
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes ? { body: new Response(bytes as BodyInit).body!, size: bytes.length } : null;
      },
    });
    const archive = new Map([[`objects/${sha}`, new TextEncoder().encode(article)], [`objects/${'b'.repeat(64)}`, new TextEncoder().encode(article)]]);
    const own = new Map<string, Uint8Array>();
    const withTexts = createApp({ catalog, texts: { store: store(own), writer: { put: async (key, bytes) => void own.set(key, new Uint8Array(bytes)) }, from: store(archive) } });
    const first = await withTexts.request(`/v1/texts/${sha}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-security-policy')).toBe('sandbox');
    expect(await first.text()).toBe(article);
    expect(own.has(`texts/${sha}`)).toBe(true);
    archive.clear();
    expect(await (await withTexts.request(`/v1/texts/${sha}`)).text()).toBe(article); // RebbeHub's own copy now
    expect((await withTexts.request(`/v1/texts/${'b'.repeat(64)}`)).status).toBe(404); // bytes that are not their name
    expect((await withTexts.request('/v1/texts/nope')).status).toBe(404);
    expect((await app.request(`/v1/texts/${sha}`)).status).toBe(404);
  });

  it('keeps a page body in wikitext with where it came from, and edits it through a suggestion', async () => {
    const withBody = { ...yudShvat(set), body: "== תוכן ==\n'''שיחה א'''", bodySource: { source: 'other', via: 'mafteiach-index', url: 'https://www.mafteiach.app/', licence: 'facts-and-links' } };
    const sent = await call('POST', '/v1/suggestions/quick', { as: 'chaim', body: { entityId: event, data: withBody, title: 'Add the outline' } });
    expect(sent.status).toBe(201);
    await call('POST', `/v1/suggestions/${sent.body.id}/approve`, { as: 'keeper' });
    expect((await call('GET', `/v1/entities/${event}`)).body.data).toMatchObject({ body: "== תוכן ==\n'''שיחה א'''", bodySource: { via: 'mafteiach-index' } });
    // What is not in the schema is still refused.
    const bad = await call('POST', '/v1/suggestions/quick', { as: 'chaim', body: { entityId: event, data: { ...withBody, bodySource: { via: 'x' } } } });
    expect(bad.body.status === 'open' ? bad.body.checks.some((c: { status: string }) => c.status === 'fail') : bad.status >= 400).toBe(true);
  });

  it('has a talk page for every page: read by all, written when signed in, answered in threads, hidden by its author', async () => {
    expect((await call('POST', `/v1/entities/${event}/talk`, { body: { body: 'שאלה' } })).status).toBe(401);
    const first = await call('POST', `/v1/entities/${event}/talk`, { as: 'chaim', body: { body: 'האם התאריך נכון?' } });
    expect(first.status).toBe(201);
    await call('POST', `/v1/entities/${event}/talk`, { as: 'mendy', body: { body: 'כן, לפי ההקלטה', parent: first.body.id } });
    expect((await call('POST', `/v1/entities/${event}/talk`, { as: 'mendy', body: { body: 'x', parent: 99999 } })).status).toBe(400);
    const talk = (await call('GET', `/v1/entities/${event}/talk`)).body.talk;
    expect(talk).toMatchObject([
      { authorName: 'Chaim', body: 'האם התאריך נכון?', parent: null },
      { authorName: 'Mendy', parent: first.body.id },
    ]);
    expect((await call('POST', `/v1/comments/${first.body.id}/hide`, { as: 'mendy' })).status).toBe(403);
    await call('POST', `/v1/comments/${first.body.id}/hide`, { as: 'chaim' });
    expect((await call('GET', `/v1/entities/${event}/talk`)).body.talk[0]).toMatchObject({ hidden: true, body: null });
  });
});
