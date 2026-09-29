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
    expect(tools.map((t: { name: string }) => t.name)).toEqual(['search', 'get_item', 'list_children', 'get_text', 'suggest_fix']);
    expect(tools.find((t: { name: string }) => t.name === 'suggest_fix').annotations.readOnlyHint).toBe(false);
    expect((await rpc('ping')).body.result).toEqual({});
    expect((await rpc('nothing/here')).body.error.code).toBe(-32601);
    expect((await rpc('tools/call', { name: 'nope', arguments: {} })).body.error.code).toBe(-32602);
    const bad = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(((await bad.json()) as any).error.code).toBe(-32700);
    expect((await app.request('/mcp')).status).toBe(405);
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
  });

  it('suggests a fix only with a write token, as its person, for review', async () => {
    const refused = await tool('suggest_fix', { id: event, changes: { note: 'x' }, title: 'A note' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/sign in/);

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
});
