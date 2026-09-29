import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';
import { describeOperation, dropBefore, groupsOf, moveBy, planOf, slugFrom, toggleSelect, type TreeNode } from '../app/lib/organize.js';

/**
 * The organizing view: picking rows (shift for a range), putting them in
 * order by dragging or the keyboard, the plan it all becomes; and the page
 * itself, drawn over a small catalog, with its calls passed to the API.
 */

const node = (id: string, type = 'work'): TreeNode => ({ id, type, path: `/${id}`, name: { he: id }, order: null, counts: {} });

describe('picking and ordering rows', () => {
  it('picks one row, or a range with shift, and turns a range off the same way', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'];
    let state = toggleSelect(rows, new Set(), 'b', false, null);
    state = toggleSelect(rows, state.selected, 'd', true, state.anchor);
    expect([...state.selected].sort()).toEqual(['b', 'c', 'd']);
    state = toggleSelect(rows, state.selected, 'c', true, 'd');
    expect([...state.selected]).toEqual(['b']);
    expect([...toggleSelect(rows, state.selected, 'b', false, 'b').selected]).toEqual([]);
  });

  it('moves picked rows together by the keyboard and by dragging', () => {
    expect(moveBy(['a', 'b', 'c', 'd'], ['b', 'c'], -1)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveBy(['a', 'b', 'c', 'd'], ['b', 'c'], 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveBy(['a', 'b'], ['a'], -1)).toEqual(['a', 'b']);
    expect(dropBefore(['a', 'b', 'c', 'd'], ['d', 'a'], 'c')).toEqual(['b', 'a', 'd', 'c']);
    expect(dropBefore(['a', 'b', 'c'], ['a'], null)).toEqual(['b', 'c', 'a']);
    expect(dropBefore(['a', 'b', 'c'], ['a'], 'a')).toEqual(['a', 'b', 'c']);
  });

  it('makes the plan: the chosen operations, then each list put in a new order, without what was moved away', () => {
    const root = node('rh-root', 'set');
    const groups = groupsOf(root, [node('rh-s1', 'set'), node('rh-w1'), node('rh-w2'), node('rh-w3'), node('rh-e1', 'event')]);
    expect(groups.map((g) => [g.key, g.orderable])).toEqual([
      ['sets', true],
      ['works', true],
      ['others', false],
    ]);
    const plan = planOf([{ op: 'move', items: ['rh-w2'], to: 'rh-other', from: 'rh-root' }], groups, { works: ['rh-w3', 'rh-w2', 'rh-w1'] });
    expect(plan).toEqual([
      { op: 'move', items: ['rh-w2'], to: 'rh-other', from: 'rh-root' },
      { op: 'reorder', items: ['rh-w3', 'rh-w1'], parent: 'rh-root' },
    ]);
    // Unchanged lists add nothing; the top sets are ordered with no parent.
    expect(planOf([], groups, { works: ['rh-w1', 'rh-w2', 'rh-w3'] })).toEqual([]);
    expect(planOf([], groupsOf(null, [node('a', 'set'), node('b', 'set')]), { sets: ['b', 'a'] })).toEqual([{ op: 'reorder', items: ['b', 'a'], parent: null }]);
    const name = (id: string) => ({ 'rh-w2': 'Tanya', 'rh-other': 'Chassidus' })[id] ?? id;
    expect(describeOperation(plan[0]!, name, 'en')).toBe('Move Tanya into Chassidus');
    expect(describeOperation({ op: 'merge', from: 'rh-w2', into: 'rh-other' }, name, 'he')).toBe('מיזוג Tanya אל Chassidus');
    expect(slugFrom('Likkutei Sichos, vol. 12')).toBe('likkutei-sichos-vol-12');
  });
});

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';

describe('the organizing page', () => {
  let handle: (request: Request) => Promise<Response>;
  const ids: Record<string, EntityId> = {};

  beforeAll(async () => {
    if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
    const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
    const { catalog, set } = await freshCatalog();
    ids.set = set;
    ids.child = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'תת סט', en: 'A subset' }, slug: 'sub', parent: set, policy: 'moderated', keepers: [] }, '/sets/sub');
    ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר לסידור', en: 'A sefer' }, slug: 'org-sample', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/org-sample');
    await add(catalog, 'mendy', 'keeper', 'unit', { work: ids.work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה א' } }, '/org-sample/1');
    const api = createApp({ catalog, reportSalt: 'test', siteUrl: SITE });
    handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
  }, 120_000);

  it('shows the top sets, a set\'s sets and sefarim, and a sefer\'s units as rows to pick', async () => {
    const top = await handle(new Request(`${SITE}/organize`));
    expect(top.status).toBe(200);
    const topHtml = await top.text();
    expect(topHtml).toContain('סידור הקטלוג');
    expect(topHtml).toContain('התוועדויות');
    const page = await handle(new Request(`${SITE}/organize?root=${ids.set}&lang=en`));
    const html = await page.text();
    expect(html).toContain('Organize: Farbrengens');
    expect(html).toContain('A subset');
    expect(html).toContain('A sefer');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Move to…');
    expect(html).toContain('Drag to reorder');
    const work = await (await handle(new Request(`${SITE}/organize?root=${ids.work}`))).text();
    expect(work).toContain('שיחה א');
    expect(work).toContain('/org-sample/1');
    expect((await handle(new Request(`${SITE}/organize?root=rh-zzzzzzzz`))).status).toBe(404);
    // The set's own page leads here.
    const setPage = await handle(new Request(`${SITE}/farbrengens`));
    expect(await setPage.text()).toContain(`/organize?root=${ids.set}`);
  });

  it('passes previews and tree reads to the API, and nothing else', async () => {
    const preview = await handle(
      new Request(`${SITE}/_/organize/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operations: [{ op: 'rename', item: ids.work, name: { en: 'Renamed' } }] }) }),
    );
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { summary: string[] }).summary).toEqual(['Rename ספר לסידור / A sefer to ספר לסידור / Renamed']);
    const tree = await handle(new Request(`${SITE}/_/organize/tree?root=${ids.set}`));
    expect(((await tree.json()) as { root: { id: string } }).root.id).toBe(ids.set);
    expect((await handle(new Request(`${SITE}/_/organize/elsewhere`))).status).toBe(404);
    expect((await handle(new Request(`${SITE}/_/organize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"operations":[]}' }))).status).toBe(401);
  });
});
