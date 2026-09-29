import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';
import { actionsFor, operationsFor, organizeCalls, suggestionPath, type EditTarget } from '../app/lib/organize.js';
import { shortLabel } from '../app/lib/links.js';

/**
 * Organizing where people are: the Edit and "…" actions on a set's and a
 * sefer's page and on each row of their lists, the operations each action
 * becomes, the preview and send calls the sheet makes (through the site
 * to the API, as one Suggestion); and long links on an item's page that
 * must not push a phone's screen sideways.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
const DRIVE = 'https://drive.google.com/drive/folders/1AiUDxZ71bhoTPlPoTvPqh53hp9w9Vikb';

describe('what each action becomes', () => {
  const set: EditTarget = { id: 'rh-set', type: 'set', label: 'Set', parent: 'rh-top' };
  const work: EditTarget = { id: 'rh-work', type: 'work', label: 'Sefer', parent: 'rh-set' };
  const unit: EditTarget = { id: 'rh-unit', type: 'unit', label: 'Sicha', parent: 'rh-work' };

  it('offers each kind the actions that fit it', () => {
    expect(actionsFor(set)).toEqual(['rename', 'move', 'move-up', 'reorder', 'create-set', 'merge', 'delete-set']);
    expect(actionsFor({ ...set, parent: null })).not.toContain('move-up');
    expect(actionsFor(work)).toEqual(['rename', 'move', 'move-up', 'reorder', 'merge']);
    expect(actionsFor(unit)).toEqual(['rename', 'move', 'merge']);
  });

  it('turns each into the plan’s operations', () => {
    expect(operationsFor(work, { kind: 'rename', name: { he: 'שם', en: 'Name' }, slug: 'name' })).toEqual([{ op: 'rename', item: 'rh-work', name: { he: 'שם', en: 'Name' }, slug: 'name' }]);
    expect(operationsFor(work, { kind: 'move', to: 'rh-other' })).toEqual([{ op: 'move', items: ['rh-work'], to: 'rh-other', from: 'rh-set' }]);
    expect(operationsFor(work, { kind: 'move', to: 'rh-other', keep: true })).toEqual([{ op: 'move', items: ['rh-work'], to: 'rh-other' }]);
    expect(operationsFor(set, { kind: 'move', to: null })).toEqual([{ op: 'move', items: ['rh-set'], to: null }]);
    expect(operationsFor(unit, { kind: 'move', to: 'rh-work2' })).toEqual([{ op: 'move', items: ['rh-unit'], to: 'rh-work2' }]);
    expect(operationsFor(work, { kind: 'move-up' })).toEqual([{ op: 'move-up', items: ['rh-work'], from: 'rh-set' }]);
    expect(operationsFor(set, { kind: 'move-up' })).toEqual([{ op: 'move-up', items: ['rh-set'] }]);
    expect(operationsFor(set, { kind: 'create-set', name: { he: 'חדש' }, slug: 'new' })).toEqual([{ op: 'create-set', key: 's1', name: { he: 'חדש' }, slug: 'new', parent: 'rh-set' }]);
    expect(operationsFor(work, { kind: 'merge', into: 'rh-dup' })).toEqual([{ op: 'merge', from: 'rh-work', into: 'rh-dup' }]);
    expect(operationsFor(set, { kind: 'delete-set' })).toEqual([{ op: 'delete-set', item: 'rh-set' }]);
  });

  it('previews, then sends one suggestion, through the site’s own addresses', async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const answer = url.endsWith('/preview') ? { title: 't', summary: ['s'], items: [], redirects: [], warnings: [] } : { suggestion: { id: 7, number: 12, status: 'open', title: 't' }, merged: false, mayApprove: true };
      return new Response(JSON.stringify(answer), { status: 200 });
    };
    const api = organizeCalls(fake);
    const ops = operationsFor(work, { kind: 'rename', name: { he: 'שם' }, slug: null });
    await api.preview(ops);
    const sent = await api.send(ops, undefined, '  because  ');
    await api.approve(sent.suggestion.id);
    expect(calls).toEqual([
      { url: '/_/organize/preview', method: 'POST', body: { operations: ops } },
      { url: '/_/organize', method: 'POST', body: { operations: ops, description: 'because' } },
      { url: '/_/suggestions/7/approve', method: 'POST', body: {} },
    ]);
    expect(suggestionPath(sent)).toEqual({ path: '/suggestions/12' });
    expect(suggestionPath({ ...sent, suggestion: { ...sent.suggestion, number: null } })).toEqual({ path: '/review', query: { s: '7' } });
    await expect(organizeCalls(async () => new Response(JSON.stringify({ message: 'sign in first' }), { status: 401 })).send(ops)).rejects.toThrow('sign in first');
  });
});

describe('long links and ids', () => {
  it('are shown short, as the host and "…", or cut with "…"', () => {
    expect(shortLabel(DRIVE)).toBe('drive.google.com/…');
    expect(shortLabel('https://www.sefaria.org/')).toBe('sefaria.org');
    expect(shortLabel('1AiUDxZ71bhoTPlPoTvPqh53hp9w9VikbXXXXXXXX')).toBe('1AiUDxZ71bhoTPlPoTvPqh5…');
    expect(shortLabel('12345')).toBe('12345');
  });

  it('are kept from overflowing by the item page’s styles', () => {
    const css = readFileSync(`${webRoot}/app/styles/items.css`, 'utf8');
    expect(css).toMatch(/\.side \{\s*min-width: 0;\s*overflow-wrap: anywhere;/);
    expect(css).toMatch(/\.side \.sources \.meta,[\s\S]*?text-overflow: ellipsis;/);
  });
});

describe('the actions on a set’s and a sefer’s page', () => {
  let handle: (request: Request) => Promise<Response>;
  let signedIn: (request: Request) => Promise<Response>;
  const ids: Record<string, EntityId> = {};

  beforeAll(async () => {
    if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
    const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
    const { catalog, set } = await freshCatalog();
    ids.set = set;
    ids.other = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'אוצרות', en: 'Otzros' }, slug: 'otzros', policy: 'moderated', keepers: [] }, '/sets/otzros');
    ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר לעריכה', en: 'A sefer' }, slug: 'edit-sample', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set], sources: [{ source: 'other', sourceId: DRIVE, url: DRIVE }] }, '/edit-sample');
    await add(catalog, 'mendy', 'keeper', 'unit', { work: ids.work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה א' } }, '/edit-sample/1');
    const api = createApp({ catalog, reportSalt: 'test', siteUrl: SITE });
    handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
    const asMendy = createApp({ catalog, reportSalt: 'test', siteUrl: SITE, authenticate: () => 'mendy' });
    signedIn = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(asMendy.request(input, init)) });
  }, 120_000);

  it('puts "…" in the page’s head and on each row, leading to the organizer without script', async () => {
    const work = await (await handle(new Request(`${SITE}/edit-sample`))).text();
    expect(work).toContain('class="btn icon edit-more"');
    expect(work).toContain(`href="/organize?root=${ids.work}"`);
    expect(work).toContain('aria-label="עוד פעולות"');
    // Each sicha in the contents has its own "…".
    expect(work).toMatch(/class="e-line"[\s\S]*?שיחה א[\s\S]*?class="btn ghost icon sm row-edit"[^>]*aria-label="פעולות על שיחה א"/);
    // The sources' long Drive address is a short label; the link keeps all of it.
    expect(work).toContain('drive.google.com/…');
    expect(work).toContain(`href="${DRIVE}"`);
    expect(work).toContain(`title="${DRIVE}"`);
    const set = await (await handle(new Request(`${SITE}/farbrengens?lang=en`))).text();
    expect(set).toContain('aria-label="More actions"');
    expect(set).toContain('aria-label="Actions for A sefer"');
    expect(set).toContain(`href="/organize?root=${ids.set}&amp;lang=en"`);
  });

  it('previews a move through the site, and sends it as one suggestion for review', async () => {
    const operations = operationsFor({ id: ids.work!, type: 'work', label: 'A sefer', parent: ids.set! }, { kind: 'move', to: ids.other! });
    const json = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations }) };
    const preview = (await (await handle(new Request(`${SITE}/_/organize/preview`, json))).json()) as { summary: string[]; items: Array<{ id: string }> };
    expect(preview.summary[0]).toContain('Otzros');
    expect(preview.items.map((i) => i.id)).toEqual([ids.work]);
    expect((await handle(new Request(`${SITE}/_/organize`, json))).status).toBe(401);
    const sent = await signedIn(new Request(`${SITE}/_/organize`, json));
    expect(sent.status).toBe(201);
    const body = (await sent.json()) as { suggestion: { status: string; number: number | null }; merged: boolean };
    expect(body.merged).toBe(false);
    expect(body.suggestion.status).toBe('open');
  });
});
