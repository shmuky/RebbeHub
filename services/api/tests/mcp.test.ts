import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * The MCP server (mcp.ts): the handshake, the tools, and that an agent
 * reads what anyone reads and suggests as its token's person.
 */

let app: Hono;
let catalog: Catalog;
let set: EntityId;
let event: EntityId;

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null, siteUrl: 'https://rebbehub.test' });
});

let id = 0;
const rpc = async (method: string, params?: unknown, options: { token?: string; notification?: boolean } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const message = { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }), ...(options.notification ? {} : { id: ++id }) };
  const response = await app.request('/mcp', { method: 'POST', headers, body: JSON.stringify(message) });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
};
const tool = async (name: string, args: Record<string, unknown>, token?: string) => (await rpc('tools/call', { name, arguments: args }, { token })).body.result;

describe('the MCP server', () => {
  it('shakes hands, lists its tools, and answers notifications with nothing', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'rebbehub' } });
    // A version we do not know: we answer with ours.
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion).toBe('2025-11-25');
    expect(await rpc('notifications/initialized', undefined, { notification: true })).toEqual({ status: 202, body: null });
    const { tools } = (await rpc('tools/list')).body.result;
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      'search',
      'get_item',
      'list_children',
      'get_text',
      'suggest_fix',
      'list_issues',
      'open_issue',
      'suggest_items',
      'approve_suggestion',
      'ask_machine',
      'machine_queue',
      'get_tree',
      'preview_organize',
      'organize',
      'move_items',
      'move_up',
      'rename_item',
      'reorder_children',
      'create_set',
      'delete_set',
      'merge_items',
    ]);
    expect(tools.find((t: { name: string }) => t.name === 'merge_items').annotations.destructiveHint).toBe(true);
    expect(tools.find((t: { name: string }) => t.name === 'suggest_fix').annotations.readOnlyHint).toBe(false);
    expect((await rpc('ping')).body.result).toEqual({});
    expect((await rpc('nothing/here')).body.error.code).toBe(-32601);
    expect((await rpc('tools/call', { name: 'nope', arguments: {} })).body.error.code).toBe(-32602);
    const bad = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(((await bad.json()) as any).error.code).toBe(-32700);
    expect((await app.request('/mcp')).status).toBe(405);
  });

  it('reads without an account, and asks for one (step-up) only when a tool would write', async () => {
    expect((await rpc('initialize', { protocolVersion: '2025-11-25' })).body.result.serverInfo.name).toBe('rebbehub');
    const call = (token?: string) =>
      app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'suggest_fix', arguments: { id: event, changes: { note: 'x' }, title: 'A note' } } }) });
    // No token: 401, saying where to connect (RFC 9728), so a client set to sign in when needed asks the person.
    const anonymous = await call();
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('WWW-Authenticate')).toBe('Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp", scope="read write"');
    expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
    expect(((await anonymous.json()) as any)).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32001 } });
    // A token that may only read: 403 insufficient_scope, asking for write.
    const me = (await createPerson(catalog.db, 'Reader')).id;
    const made = await app.request('/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': me }, body: JSON.stringify({ name: 'reader' }) });
    const { token } = (await made.json()) as { token: string };
    const reader = await call(token);
    expect(reader.status).toBe(403);
    expect(reader.headers.get('WWW-Authenticate')).toMatch(/^Bearer resource_metadata="[^"]+", scope="read write", error="insufficient_scope"/);
    // A token that is not valid is told so, the same way, so the client refreshes it or connects again.
    const stale = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer rho_${'x'.repeat(43)}` }, body: '{}' });
    expect(stale.status).toBe(401);
    expect(stale.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });

  it('searches, gets items by id or path, lists children and reads texts with machine words marked', async () => {
    const found = await tool('search', { query: 'יו״ד שבט תשמ״ב' });
    expect(found.isError).toBe(false);
    expect(found.structuredContent.results.map((r: { id: string }) => r.id)).toContain(event);
    expect(found.content[0].text).toContain('https://rebbehub.test/events/5742-05-10');

    expect((await tool('get_item', { path: '/events/5742-05-10' })).structuredContent).toMatchObject({ id: event, type: 'event' });
    expect((await tool('get_item', { id: 'rh-zzzzzzzz' })).isError).toBe(true);

    const recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, url: 'https://example.test/a.mp3', part: 1 });
    const children = await tool('list_children', { id: event });
    expect(children.structuredContent.items.map((i: { id: string }) => i.id)).toEqual([recording]);
    const inSet = await tool('list_children', { id: set });
    expect(inSet.structuredContent.items.map((i: { id: string }) => i.id)).toContain(event);

    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'א' } });
    const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit, language: 'he' });
    await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'V', kind: 'paragraph', content: 'בראשית ברא', proofread: 1 });
    await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'k', kind: 'paragraph', content: 'אלקים את השמים', proofread: 0, origin: { by: 'ocr:tesseract-heb@5.3' } });
    const words = await tool('get_text', { id: unit });
    expect(words.isError).toBe(false);
    expect(words.content[0].text).toContain('בראשית ברא');
    expect(words.content[0].text).toContain('[machine] אלקים את השמים');
    expect(words.content[0].text).toMatch(/no person has checked/);
    expect((await tool('get_text', { id: event })).isError).toBe(true);

    // A page imported with its words keeps them on the unit (the Chabad Library's): read with their credit.
    const page = await add(catalog, 'mendy', 'keeper', 'unit', {
      work,
      position: [{ level: 'sicha', value: '2' }],
      order: 'k',
      label: { he: 'ב' },
      body: {
        profile: 'chabad-library',
        versions: [{ id: 'he', language: 'he', credit: 'ספריית ליובאוויטש', url: 'https://chabadlibrary.org/books/1', segments: [
          { id: 'h1', kind: 'heading', text: [{ text: 'חצי יום בכולל', marks: ['b'] }] },
          { id: 'p1', kind: 'paragraph', text: [{ text: 'והרבי השיב' }] },
        ] }],
      },
    });
    const library = await tool('get_text', { id: page });
    expect(library.isError).toBe(false);
    expect(library.content[0].text).toBe('חצי יום בכולל\n\nוהרבי השיב\n\nספריית ליובאוויטש (https://chabadlibrary.org/books/1)');
    expect(library.structuredContent).toMatchObject({ unit: page, language: 'he', paragraphs: [{ id: 'h1' }, { id: 'p1' }] });
    expect((await tool('get_text', { id: page, language: 'en' })).isError).toBe(true);
  });

  it('suggests a fix only with a write token, as its person, for review', async () => {
    const refused = await rpc('tools/call', { name: 'suggest_fix', arguments: { id: event, changes: { note: 'x' }, title: 'A note' } });
    expect(refused.status).toBe(401);

    const me = (await createPerson(catalog.db, 'Agent owner')).id;
    const made = await app.request('/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': me }, body: JSON.stringify({ name: 'my agent', scopes: ['read', 'write'] }) });
    const { token } = (await made.json()) as { token: string };
    const fixed = await tool('suggest_fix', { id: event, changes: { title: { he: 'יו״ד שבט', en: 'Yud Shvat' } }, title: 'Shorter title', note: 'As printed in the Sefer HaSichos' }, token);
    expect(fixed.isError).toBe(false);
    expect(fixed.structuredContent).toMatchObject({ status: 'open', url: expect.stringContaining('https://rebbehub.test/review?s=') });
    const suggestion = await catalog.changeset(fixed.structuredContent.suggestion);
    expect(suggestion.author).toBe(me);
    // Nothing changed on main until a keeper approves.
    expect((await catalog.get(event))!.data).toMatchObject({ title: { en: 'Yud Shvat 5742' } });
  });

  it('adds many items in one suggestion, over several calls, and a steward approves it', async () => {
    const tokenFor = async (who: string) => {
      const made = await app.request('/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': who }, body: JSON.stringify({ name: 'agent', scopes: ['read', 'write'] }) });
      return ((await made.json()) as { token: string }).token;
    };
    expect((await rpc('tools/call', { name: 'suggest_items', arguments: { items: [{ type: 'work', data: {} }] } })).status).toBe(401);
    const token = await tokenFor((await createPerson(catalog.db, 'Indexer')).id);
    const work = { type: 'work', path: '/an-index', data: { title: { he: 'מפתח' }, slug: 'an-index', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] } };
    const first = await tool('suggest_items', { items: [work], submit: false, title: 'An index' }, token);
    expect(first.isError).toBe(false);
    expect(first.structuredContent).toMatchObject({ status: 'draft', items: [{ type: 'work', path: '/an-index' }] });
    const workId = first.structuredContent.items[0].id;
    const suggestion = first.structuredContent.suggestion;
    const unit = { type: 'unit', data: { work: workId, position: [{ level: 'volume', value: '1' }], order: 'V', label: { he: 'א' } } };
    const bad = await tool('suggest_items', { items: [unit, { type: 'unit' }], suggestion, submit: false }, token);
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/item 2: give type and data \(suggestion \d+ keeps the 1 before it\)/);
    const last = await tool('suggest_items', { items: [{ ...unit, data: { ...unit.data, label: { he: 'ב' } } }], suggestion }, token);
    expect(last.isError).toBe(false);
    expect(last.structuredContent.status).toBe('open');
    expect((await catalog.proposals(suggestion)).length).toBe(3);
    expect(await catalog.get(workId)).toBeNull();

    // Only who may approve does: not its author, then a steward.
    expect((await tool('approve_suggestion', { suggestion }, token)).isError).toBe(true);
    const steward = (await createPerson(catalog.db, 'Steward')).id;
    await catalog.createAccount({ id: steward, displayName: 'Steward' });
    await catalog.db.query('UPDATE account SET is_steward = TRUE WHERE id = $1', [steward]);
    const approved = await tool('approve_suggestion', { suggestion, note: 'Checked' }, await tokenFor(steward));
    expect(approved.isError).toBe(false);
    expect((await catalog.get(workId))!.data).toMatchObject({ slug: 'an-index' });
  });

  it('shows the tree and organizes it as suggestions, with a write token', async () => {
    const tree = await tool('get_tree', {});
    expect(tree.isError).toBe(false);
    expect(tree.content[0].text).toContain(`(set, ${set}, /farbrengens) [0 sets, 1 items]`);
    const other = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'שיחות', en: 'Sichos' }, slug: 'sichos', policy: 'moderated', keepers: ['keeper'] }, '/sets/sichos');
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/w');
    const deep = await tool('get_tree', { root: set, depth: 1 });
    expect(deep.structuredContent.children.map((n: { id: string }) => n.id)).toEqual([work, event]);

    const preview = await tool('preview_organize', { operations: [{ op: 'move', items: [work], from: set, to: other }] });
    expect(preview.isError).toBe(false);
    expect(preview.content[0].text).toMatch(/Would make one suggestion: "Move חיבור into שיחות \/ Sichos"/);
    // Without a token a tool that writes is refused at the HTTP level, so the client asks to sign in.
    expect((await rpc('tools/call', { name: 'move_items', arguments: { items: [work], to: other } })).status).toBe(401);

    const me = (await createPerson(catalog.db, 'Organizer')).id;
    const made = await app.request('/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': me }, body: JSON.stringify({ name: 'organizer', scopes: ['read', 'write'] }) });
    const { token } = (await made.json()) as { token: string };
    const moved = await tool('move_items', { items: [work], from: set, to: other, note: 'It is a sefer of sichos' }, token);
    expect(moved.isError).toBe(false);
    expect(moved.structuredContent).toMatchObject({ status: 'open', merged: false, items: 1 });
    expect(moved.content[0].text).toMatch(/sent for review/);
    const movedSuggestion = await catalog.changeset(moved.structuredContent.suggestion);
    expect(movedSuggestion.author).toBe(me);
    expect(movedSuggestion.via).toMatchObject({ name: 'organizer' });

    const renamed = await tool('rename_item', { item: work, name: { en: 'A work' }, slug: 'a-work' }, token);
    expect(renamed.structuredContent.redirects).toEqual([{ id: work, from: '/w', to: '/a-work' }]);
    const created = await tool('create_set', { name: { he: 'חדש' }, slug: 'new-set', parent: other }, token);
    expect(Object.keys(created.structuredContent.created)).toEqual(['set']);
    expect((await tool('delete_set', { item: set }, token)).content[0].text).toMatch(/still holds/);
    expect((await tool('merge_items', { from: work, into: event }, token)).content[0].text).toMatch(/only items of one type/);
    expect((await tool('move_up', { items: [work] }, token)).content[0].text).toMatch(/top set/);
    expect((await tool('reorder_children', { items: [work, event], parent: set }, token)).content[0].text).toMatch(/not beside|no order/);
    const plan = await tool('organize', { operations: [{ op: 'rename', item: other, name: { en: 'Talks' } }], title: 'Name the set' }, token);
    expect(plan.structuredContent).toMatchObject({ status: 'open', summary: ['Rename שיחות / Sichos to שיחות / Talks'] });
  });
});
