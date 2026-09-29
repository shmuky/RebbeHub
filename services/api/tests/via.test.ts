import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * What an agent sends for a person (packages/core/src/via.ts): a
 * suggestion, comment, issue or review sent with one of their API tokens
 * or through an app they connected carries `via`, everywhere its author is
 * shown - the suggestion, the list, the conversation, the issue, the
 * item's history, the commits and the person's page - so the site can say
 * "my script · for @shmuly" and never read it as the person's own hands.
 */

let app: Hono;
let catalog: Catalog;
let event: EntityId;
let me: string;
let set: EntityId;
let token: string;

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(fresh.set), '/events/5742-05-10');
  app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null });
  me = (await createPerson(catalog.db, 'Shmuly', 'shmuly')).id;
  token = (await call('POST', '/v1/tokens', { as: me, body: { name: 'my script', scopes: ['read', 'write'] } })).body.token;
});

async function call(method: string, path: string, options: { as?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
}

describe("an agent's work for a person", () => {
  it('is marked on the suggestion, its list, its conversation, the history, the commits and the profile', async () => {
    const data = { ...yudShvat(set), title: { he: 'יו״ד שבט', en: 'Yud Shvat' } };
    const made = await call('POST', '/v1/suggestions/quick', { token, body: { entityId: event, data, title: 'A shorter title' } });
    expect(made.status).toBe(201);
    const id = made.body.id as number;
    const via = { kind: 'token', name: 'my script', id: expect.stringMatching(/^tok-/) };

    const shown = await call('GET', `/v1/suggestions/${id}`);
    expect(shown.body.changeset).toMatchObject({ author: me, via });
    expect((await call('GET', '/v1/suggestions?state=open')).body.suggestions.find((s: any) => s.id === id)).toMatchObject({ author: me, via });

    // A comment the script writes is its; one the person writes on the site is theirs.
    await call('POST', `/v1/suggestions/${id}/comments`, { token, body: { body: 'The source is the Sefer HaSichos' } });
    await call('POST', `/v1/suggestions/${id}/comments`, { as: me, body: { body: 'Yes, I checked it' } });
    const comments = (await call('GET', `/v1/suggestions/${id}/conversation`)).body.timeline.filter((i: any) => i.type === 'comment');
    expect(comments.map((c: any) => c.via?.name ?? null)).toEqual(['my script', null]);

    // A keeper's approval on the site is a person's; the merged change keeps the script's mark.
    const approved = await call('POST', `/v1/suggestions/${id}/reviews`, { as: 'keeper', body: { verdict: 'approve' } });
    expect(approved.status).toBe(201);
    const review = (await call('GET', `/v1/suggestions/${id}/conversation`)).body.timeline.find((i: any) => i.type === 'review');
    expect(review.via).toBeNull();
    const history = (await call('GET', `/v1/entities/${event}/history`)).body.history;
    expect(history[0]).toMatchObject({ author: me, via });
    expect(history[1].via).toBeNull();
    const commits = (await call('GET', '/v1/commits?since=0&limit=100')).body.commits;
    expect(commits[commits.length - 1]).toMatchObject({ author: me, via });

    const profile = (await call('GET', '/v1/people/shmuly')).body;
    expect(profile.activity.find((a: any) => a.kind === 'suggestion')).toMatchObject({ via });
    expect(profile.activity.find((a: any) => a.kind === 'comment' && !a.via)).toBeTruthy();
  });

  it('is marked on an issue the agent opens, and on nothing the person does on the site', async () => {
    const opened = await call('POST', '/v1/issues', { token, body: { title: 'A page is missing', type: 'missing-page', entityId: event } });
    expect(opened.status).toBe(201);
    const number = opened.body.issue?.number ?? opened.body.number;
    expect((await call('GET', `/v1/issues/${number}`)).body.issue).toMatchObject({ author: me, via: { kind: 'token', name: 'my script' } });

    const mine = await call('POST', '/v1/issues', { as: me, body: { title: 'Another', type: 'other' } });
    const other = mine.body.issue?.number ?? mine.body.number;
    expect((await call('GET', `/v1/issues/${other}`)).body.issue.via).toBeNull();
    const { rows } = await catalog.db.query<{ via: unknown }>('SELECT via FROM changeset WHERE author = $1', [me]);
    expect(rows.every((r) => r.via === null)).toBe(true);
  });
});
