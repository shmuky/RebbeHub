import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, finishMachineWork, registerFile, takeMachineRequests, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { githubDispatch } from '../src/machine.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/** Asking the machines for work (machine.ts): the queue over the API and the MCP tools, and starting the free job at once. */

let app: Hono;
let catalog: Catalog;
let scan: EntityId;
let privateScan: EntityId;
let recording: EntityId;
let dispatched: string[];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  const { set } = fresh;
  await registerFile(catalog.db, { sha256: 'a'.repeat(64), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
  await registerFile(catalog.db, { sha256: 'b'.repeat(64), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'unknown', held: true });
  const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, sets: [set] });
  scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication, file: 'a'.repeat(64), completeness: 'complete', sets: [set] });
  privateScan = await add(catalog, 'mendy', 'keeper', 'scan', { publication, file: 'b'.repeat(64), completeness: 'complete', sets: [set] });
  const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  recording = await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'שיחה א׳' }, url: 'https://example.test/a.mp3', sets: [set] });
  dispatched = [];
  app = createApp({
    catalog,
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    siteUrl: 'https://rebbehub.test',
    machineDispatch: async (kind) => {
      dispatched.push(kind);
      return true;
    },
  });
});

const call = async (method: string, path: string, options: { as?: string; token?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

describe('asking the machines over the API', () => {
  it('queues a request, joins a second one, and starts the free job once', async () => {
    expect((await call('POST', '/v1/machine/requests', { body: { kind: 'ocr', item: scan } })).status).toBe(401);
    const first = await call('POST', '/v1/machine/requests', { as: 'chaim', body: { kind: 'ocr', item: scan } });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ created: true, startsAtOnce: true, request: { kind: 'ocr', item: scan, status: 'waiting', position: 1, requestedBy: 'chaim' } });
    const again = await call('POST', '/v1/machine/requests', { as: 'mendy', body: { kind: 'ocr', item: scan.toUpperCase() } });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, request: { id: first.body.request.id } });
    const second = await call('POST', '/v1/machine/requests', { as: 'mendy', body: { kind: 'transcript', item: recording } });
    expect(second.body.request).toMatchObject({ kind: 'transcript', position: 1 });
    expect(dispatched).toEqual(['ocr', 'transcript']);

    const list = await call('GET', `/v1/machine/requests?items=${scan},${recording}`);
    expect(list.body.requests.map((r: any) => r.item).sort()).toEqual([scan, recording].sort());
    const summary = await call('GET', '/v1/machine');
    expect(summary.body).toMatchObject({ ocr: { waiting: 1, backlog: 1 }, transcript: { waiting: 1, backlog: 0 }, startsAtOnce: true });
  });

  it('says why not: a scan it may not copy, the wrong kind of item, work already done', async () => {
    expect((await call('POST', '/v1/machine/requests', { as: 'chaim', body: { kind: 'ocr', item: privateScan } })).status).toBe(422);
    expect((await call('POST', '/v1/machine/requests', { as: 'chaim', body: { kind: 'transcript', item: scan } })).status).toBe(422);
    expect((await call('POST', '/v1/machine/requests', { as: 'chaim', body: { kind: 'poem', item: scan } })).status).toBe(422);
    expect((await call('POST', '/v1/machine/requests', { as: 'chaim', body: { kind: 'ocr', item: 'nonsense' } })).status).toBe(400);

    // The job takes it and finishes; asking again is a new request, which the job settles as done.
    await call('POST', '/v1/machine/requests', { as: 'chaim', body: { kind: 'ocr', item: scan } });
    const [taken] = await takeMachineRequests(catalog, 'ocr', 5);
    expect(taken).toMatchObject({ item: scan, status: 'running', position: null });
    expect(await finishMachineWork(catalog, 'ocr', scan, { status: 'done' })).toBe(1);
    const done = await call('GET', `/v1/machine/requests?item=${scan}`);
    expect(done.body.requests[0]).toMatchObject({ status: 'done' });
    expect(done.body.requests[0].finishedAt).toBeTruthy();
  });

  it('is an MCP tool too, for a write token', async () => {
    const me = (await createPerson(catalog.db, 'Agent owner')).id;
    const made = await call('POST', '/v1/tokens', { as: me, body: { name: 'agent', scopes: ['read', 'write'] } });
    const rpc = async (name: string, args: Record<string, unknown>) =>
      ((await (await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${made.body.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()) as any).result;
    const asked = await rpc('ask_machine', { kind: 'transcript', item: recording });
    expect(asked.isError).toBe(false);
    expect(asked.text ?? asked.content[0].text).toMatch(/^Asked: #\d+ transcribe/);
    const queue = await rpc('machine_queue', {});
    expect(queue.content[0].text).toMatch(/Transcripts: 1 waiting/);
    expect(queue.structuredContent.requests).toHaveLength(1);
  });
});

describe('starting the job on GitHub', () => {
  it("dispatches the kind's workflow for requests only", async () => {
    const sent: Array<{ url: string; body: any; auth: string | null }> = [];
    const dispatch = githubDispatch({
      token: 't0ken',
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('Authorization') });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch,
    });
    expect(await dispatch('transcript')).toBe(true);
    expect(sent).toEqual([{ url: 'https://api.github.com/repos/shmuky/RebbeHub/actions/workflows/transcribe.yml/dispatches', body: { ref: 'main', inputs: { requested: 'true' } }, auth: 'Bearer t0ken' }]);
  });
});
