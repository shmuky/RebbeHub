import { beforeEach, describe, expect, it } from 'vitest';
import { Catalog, CatalogError, TRUST_THRESHOLD, UnresolvedConflictError, getFile, registerFile, setRights } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { add, freshCatalog, yudShvat } from './helpers.js';

let catalog: Catalog;
let set: EntityId;

beforeEach(async () => {
  ({ catalog, set } = await freshCatalog());
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CatalogError) return error.code;
    if (error instanceof UnresolvedConflictError) return 'unresolved';
    throw error;
  }
  return 'ok';
};

describe('a suggestion', () => {
  it('seeds the built-in schemas as items of the catalog', async () => {
    const schema = await catalog.resolvePath('/schemas/event');
    expect(schema).not.toBeNull();
    expect((await catalog.history(schema!.id))[0]!.commit).toBe(1);
  });

  it('goes from draft to review to main, with history, path and search', async () => {
    const cs = await catalog.createChangeset('mendy', { title: 'Add Yud Shvat 5742' });
    const id = await catalog.putRevision(cs.id, 'mendy', { type: 'event', data: yudShvat(set), path: '/events/5742-05-10' });
    expect(await catalog.get(id)).toBeNull(); // not on main until approved

    const submitted = await catalog.submit(cs.id, 'mendy');
    expect(submitted.status).toBe('open');
    expect(submitted.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(submitted.checks.some((c) => c.check === 'dates' && c.status === 'pass')).toBe(true);

    const view = await catalog.review(cs.id);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]!.before).toBeNull();

    const { commit } = await catalog.merge(cs.id, 'keeper');
    expect(commit).toBeGreaterThan(1);
    expect((await catalog.get(id))!.data).toMatchObject({ date: '5742-05-10' });
    expect(await catalog.resolvePath('/events/5742-05-10')).toEqual({ id, redirected: false, path: '/events/5742-05-10' });
    expect((await catalog.history(id)).map((h) => h.author)).toEqual(['mendy']);
    expect((await catalog.backlinks(set)).map((b) => b.from)).toContain(id);

    // Found by how people write the date, in either language.
    for (const query of ['י׳ שבט תשמ״ב', 'יו"ד שבט', '10 shevat 5742', 'Yud Shvat']) {
      expect((await catalog.search(query)).map((e) => e.id)).toContain(id);
    }
  });

  it('is approved only by a keeper of its set or a steward, and never by its author or a bot', async () => {
    const cs = await catalog.createChangeset('mendy', { title: 'Add' });
    await catalog.putRevision(cs.id, 'mendy', { type: 'event', data: yudShvat(set) });
    await catalog.submit(cs.id, 'mendy');
    expect(await codeOf(catalog.merge(cs.id, 'mendy'))).toBe('forbidden');
    expect(await codeOf(catalog.merge(cs.id, 'chaim'))).toBe('forbidden');
    expect(await codeOf(catalog.merge(cs.id, 'bot:mafteiach'))).toBe('forbidden');
    expect(await codeOf(catalog.merge(cs.id, 'shmuly'))).toBe('ok');
  });

  it('cannot be edited once sent, but can after being sent back', async () => {
    const cs = await catalog.createChangeset('mendy', { title: 'Add' });
    const id = await catalog.putRevision(cs.id, 'mendy', { type: 'event', data: yudShvat(set) });
    await catalog.submit(cs.id, 'mendy');
    expect(await codeOf(catalog.putRevision(cs.id, 'mendy', { id, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } }))).toBe('state');
    await catalog.sendBack(cs.id, 'keeper', 'Which printing says 11?');
    await catalog.putRevision(cs.id, 'mendy', { id, type: 'event', data: { ...yudShvat(set), occasion: 'yud-shvat' } });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'keeper');
    expect((await catalog.get(id))!.data).toMatchObject({ occasion: 'yud-shvat' });
  });

  it('runs the automatic checks, and failing ones block the merge', async () => {
    const cs = await catalog.createChangeset('mendy', { title: 'Bad' });
    await catalog.putRevision(cs.id, 'mendy', { type: 'event', data: { ...yudShvat(set), date: '5742-04-30' } }); // Teves has 29 days
    await catalog.putRevision(cs.id, 'mendy', { type: 'unit', data: { work: 'rh-zzzzzzzz', position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה' } } });
    const submitted = await catalog.submit(cs.id, 'mendy');
    const failed = submitted.checks.filter((c) => c.status === 'fail').map((c) => c.check);
    expect(failed).toEqual(expect.arrayContaining(['dates', 'references']));
    expect(await codeOf(catalog.merge(cs.id, 'shmuly'))).toBe('invalid');
  });

  it('warns the reviewer about a likely duplicate', async () => {
    await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), externalIds: { 'mafteiach-occasion': '4567' } });
    const cs = await catalog.createChangeset('chaim', { title: 'Add again' });
    await catalog.putRevision(cs.id, 'chaim', { type: 'event', data: { ...yudShvat(set), externalIds: { 'mafteiach-occasion': '4567' } } });
    const submitted = await catalog.submit(cs.id, 'chaim');
    expect(submitted.checks.find((c) => c.check === 'duplicates')?.status).toBe('warn');
  });
});

describe('merging', () => {
  it('merges two suggestions to different fields of one item silently', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const a = await catalog.createChangeset('mendy', { title: 'English title' });
    await catalog.putRevision(a.id, 'mendy', { id, type: 'event', data: { ...yudShvat(set), title: { he: 'יו״ד שבט תשמ״ב', en: 'Yud Shevat 5742' } } });
    const b = await catalog.createChangeset('chaim', { title: 'Occasion' });
    await catalog.putRevision(b.id, 'chaim', { id, type: 'event', data: { ...yudShvat(set), occasion: 'yud-shvat' } });
    await catalog.submit(a.id, 'mendy');
    await catalog.submit(b.id, 'chaim');
    await catalog.merge(a.id, 'keeper');
    await catalog.merge(b.id, 'keeper');
    expect((await catalog.get(id))!.data).toMatchObject({ title: { en: 'Yud Shevat 5742' }, occasion: 'yud-shvat' });
  });

  it('asks the reviewer to choose when two suggestions clash', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const a = await catalog.createChangeset('mendy', { title: '11 Shvat' });
    await catalog.putRevision(a.id, 'mendy', { id, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } });
    const b = await catalog.createChangeset('chaim', { title: '12 Shvat' });
    await catalog.putRevision(b.id, 'chaim', { id, type: 'event', data: { ...yudShvat(set), date: '5742-05-12' } });
    await catalog.submit(a.id, 'mendy');
    await catalog.submit(b.id, 'chaim');
    await catalog.merge(a.id, 'keeper');

    const view = await catalog.review(b.id);
    expect(view.entries[0]!.conflicts).toEqual([{ path: '/date', base: '5742-05-10', ours: '5742-05-11', theirs: '5742-05-12' }]);
    expect(await codeOf(catalog.merge(b.id, 'keeper'))).toBe('unresolved');
    await catalog.merge(b.id, 'keeper', { [id]: { '/date': { take: 'theirs' } } });
    expect((await catalog.get(id))!.data).toMatchObject({ date: '5742-05-12' });
  });

  it('keeps an old path working as a redirect', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/yud-shvat-5742');
    const cs = await catalog.createChangeset('mendy', { title: 'Path by date' });
    await catalog.putRevision(cs.id, 'mendy', { id, type: 'event', data: yudShvat(set), path: '/events/5742-05-10' });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'keeper');
    expect(await catalog.resolvePath('/events/yud-shvat-5742')).toEqual({ id, redirected: true, path: '/events/5742-05-10' });
  });

  it('refuses a path that is taken', async () => {
    await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
    const cs = await catalog.createChangeset('chaim', { title: 'Same path' });
    await catalog.putRevision(cs.id, 'chaim', { type: 'event', data: yudShvat(set), path: '/events/5742-05-10' });
    const submitted = await catalog.submit(cs.id, 'chaim');
    expect(submitted.checks.find((c) => c.check === 'path')?.status).toBe('fail');
  });
});

describe('history and revert', () => {
  it('reverts a merged suggestion in one step, keeping later unrelated changes', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const bad = await catalog.createChangeset('chaim', { title: 'Wrong date' });
    await catalog.putRevision(bad.id, 'chaim', { id, type: 'event', data: { ...yudShvat(set), date: '5742-05-15' } });
    await catalog.submit(bad.id, 'chaim');
    await catalog.merge(bad.id, 'keeper');
    const later = await catalog.createChangeset('mendy', { title: 'Occasion' });
    await catalog.putRevision(later.id, 'mendy', { id, type: 'event', data: { ...yudShvat(set), date: '5742-05-15', occasion: 'yud-shvat' } });
    await catalog.submit(later.id, 'mendy');
    await catalog.merge(later.id, 'keeper');

    const revert = await catalog.revert(bad.id, 'keeper', 'The date is 10 Shvat');
    expect(revert.commit).not.toBeNull();
    expect((await catalog.get(id))!.data).toMatchObject({ date: '5742-05-10', occasion: 'yud-shvat' });
    expect((await catalog.account('chaim'))!.reverted_count).toBe(1);
    expect((await catalog.history(id)).length).toBe(4);
  });

  it('reverting the creation of an item deletes it', async () => {
    const cs = await catalog.createChangeset('mendy', { title: 'Add' });
    const id = await catalog.putRevision(cs.id, 'mendy', { type: 'event', data: yudShvat(set), path: '/events/x' });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'keeper');
    await catalog.revert(cs.id, 'keeper');
    expect(await catalog.get(id)).toBeNull();
    expect(await catalog.resolvePath('/events/x')).toBeNull();
  });

  it('restores any earlier version, and shows the catalog as of any commit', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const firstRev = (await catalog.get(id))!.rev;
    const firstCommit = await catalog.head();
    const cs = await catalog.createChangeset('chaim', { title: 'Change' });
    await catalog.putRevision(cs.id, 'chaim', { id, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } });
    await catalog.submit(cs.id, 'chaim');
    await catalog.merge(cs.id, 'keeper');
    expect((await catalog.get(id, { at: firstCommit }))!.data).toMatchObject({ date: '5742-05-10' });

    const restore = await catalog.restore(id, firstRev, 'mendy');
    await catalog.merge(restore, 'keeper');
    expect((await catalog.get(id))!.data).toMatchObject({ date: '5742-05-10' });
  });
});

describe('projects', () => {
  it('collect suggestions in an overlay and merge into main as one commit', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const project = await catalog.createProject('keeper', { slug: 'sync-5742', name: 'Sync the 5742 farbrengens', set });
    const cs = await catalog.createChangeset('chaim', { title: 'Occasion', project });
    await catalog.putRevision(cs.id, 'chaim', { id, type: 'event', data: { ...yudShvat(set), occasion: 'yud-shvat' } });
    const newId = await catalog.putRevision(cs.id, 'chaim', { type: 'event', data: { ...yudShvat(set), date: '5742-05-11', title: { he: 'י״א שבט' } } });
    await catalog.submit(cs.id, 'chaim');
    await catalog.merge(cs.id, 'keeper');

    expect((await catalog.get(id))!.data).not.toHaveProperty('occasion');
    expect((await catalog.get(id, { project }))!.data).toMatchObject({ occasion: 'yud-shvat' });
    expect(await catalog.get(newId)).toBeNull();

    // Main moves on meanwhile; the project merges on top of it.
    const main = await catalog.createChangeset('mendy', { title: 'English' });
    await catalog.putRevision(main.id, 'mendy', { id, type: 'event', data: { ...yudShvat(set), title: { he: 'יו״ד שבט תשמ״ב', en: 'Yud Shevat' } } });
    await catalog.submit(main.id, 'mendy');
    await catalog.merge(main.id, 'keeper');
    expect(await catalog.projectConflicts(project)).toEqual([]);

    const before = await catalog.head();
    const seq = await catalog.mergeProject(project, 'keeper');
    expect(seq).toBe(before + 1);
    expect((await catalog.get(id))!.data).toMatchObject({ occasion: 'yud-shvat', title: { en: 'Yud Shevat' } });
    expect(await catalog.get(newId)).not.toBeNull();
  });
});

describe('reports', () => {
  it('need no account, land in the set inbox, and are closed by its keeper', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const report = await catalog.report({ entityId: id, reason: 'wrong-fact', note: 'The date is wrong', reporterHash: 'abc' });
    const inbox = (await catalog.reports({ set })) as Array<{ id: number }>;
    expect(inbox.map((r) => r.id)).toEqual([report]);
    expect(await codeOf(catalog.closeReport(report, 'chaim', 'dismissed'))).toBe('forbidden');
    await catalog.closeReport(report, 'keeper', 'resolved', { note: 'fixed' });
    expect(await catalog.reports({ set })).toEqual([]);
    expect((await catalog.auditLog({ kind: 'report', id: String(report) })).map((a) => a.action)).toEqual(['report.resolved']);
  });

  it('tell followers of the item and of its set', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await catalog.follow('chaim', { kind: 'entity', id });
    await catalog.follow('keeper', { kind: 'set', id: set });
    expect(await catalog.followersOfEntity(id)).toEqual(['chaim', 'keeper']);
  });
});

describe('trust', () => {
  it(`makes a contributor trusted after ${TRUST_THRESHOLD} approved suggestions, whose line fixes in open sets then go live`, async () => {
    const open = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'לקוטי שיחות' }, slug: 'ls', policy: 'open', keepers: ['keeper'] });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'לקוטי שיחות' }, slug: 'likkutei-sichos', authors: [], genre: 'sichos', levels: ['volume', 'sicha'], sets: [open] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '1' }], order: 'V', label: { he: 'חלק א, שיחה א' } });
    const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit, language: 'he' });
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'V', kind: 'paragraph', content: 'בראשית ברא', proofread: 0 });
    for (let i = 0; (await catalog.account('mendy'))!.trust !== 'trusted'; i++) {
      await add(catalog, 'mendy', 'keeper', 'topic', { name: { he: `נושא ${i}` }, sets: [open] });
    }
    expect((await catalog.account('mendy'))!.approved_count).toBe(TRUST_THRESHOLD);

    const fix = await catalog.createChangeset('mendy', { title: 'Fix a line' });
    await catalog.putRevision(fix.id, 'mendy', { id: segment, type: 'segment', data: { text, order: 'V', kind: 'paragraph', content: 'בראשית ברא אלקים', proofread: 1 } });
    const live = await catalog.submit(fix.id, 'mendy');
    expect(live.status).toBe('merged');
    expect(live.post_review).toBe('pending');
    expect((await catalog.get(segment))!.data).toMatchObject({ content: 'בראשית ברא אלקים' });
    expect((await catalog.listChangesets({ postReview: true })).map((c) => c.id)).toEqual([fix.id]);
    await catalog.reviewLive(fix.id, 'keeper', 'approve');
    expect(await catalog.listChangesets({ postReview: true })).toEqual([]);

    // Catalog facts stay moderated even for trusted people.
    const fact = await catalog.createChangeset('mendy', { title: 'Rename' });
    await catalog.putRevision(fact.id, 'mendy', { id: work, type: 'work', data: { title: { he: 'לקו״ש' }, slug: 'likkutei-sichos', authors: [], genre: 'sichos', levels: ['volume', 'sicha'], sets: [open] } });
    expect((await catalog.submit(fact.id, 'mendy')).status).toBe('open');
  });
});

describe('schema as data', () => {
  it('lets stewards add a new kind of item without a code release', async () => {
    const maaneh = { type: 'object', properties: { text: { type: 'string', minLength: 1 }, sets: { type: 'array' } }, required: ['text'], additionalProperties: false };
    const cs = await catalog.createChangeset('mendy', { title: 'Add maaneh' });
    await catalog.putRevision(cs.id, 'mendy', { type: 'schema', data: { entityType: 'maaneh', label: { he: 'מענה', en: 'Maaneh' }, jsonSchema: maaneh, version: 1 } });
    await catalog.submit(cs.id, 'mendy');
    expect(await codeOf(catalog.merge(cs.id, 'keeper'))).toBe('forbidden');
    await catalog.merge(cs.id, 'shmuly');
    const id = await add(catalog, 'mendy', 'shmuly', 'maaneh' as never, { text: 'נת׳ ות״ח' });
    expect((await catalog.get(id))!.type).toBe('maaneh');
  });
});

describe('editions, snapshots and files', () => {
  it('tags weekly editions and reads the catalog as of each', async () => {
    const id = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    expect(await catalog.tagEdition('shmuly')).toEqual({ tag: '2026.40', commit: await catalog.head() });
    expect((await catalog.tagEdition('shmuly')).tag).toBe('2026.40.1');
    expect(await codeOf(catalog.tagEdition('keeper'))).toBe('forbidden');
    const snapshot = await catalog.snapshot(await catalog.head(), { limit: 10_000 });
    expect(snapshot.map((e) => e.id)).toContain(id);
    expect(snapshot.filter((e) => e.type === 'schema')).toHaveLength(21);
    const commits = await catalog.commitsSince(0);
    expect(commits[0]!.message).toBe('Built-in schemas');
  });

  it('stores a file once, with rights, and a takedown stops serving it', async () => {
    const sha256 = 'c'.repeat(64);
    const first = await registerFile(catalog.db, { sha256, bytes: 1000, mime: 'application/pdf', source: 'contribution', licence: 'unknown', fileClass: 'teshura-scan', held: true, uploadedBy: 'mendy', attestation: 'printed for free distribution' });
    expect(first).toMatchObject({ existed: false, file: { rights_state: 'credit', storage_tier: 'public' } });
    expect((await registerFile(catalog.db, { sha256, bytes: 1000, mime: 'application/pdf', source: 'contribution', licence: 'unknown', held: true })).existed).toBe(true);
    await expect(setRights(catalog.db, 'keeper', sha256, 'preserved', 'family request')).rejects.toThrow(CatalogError);
    await setRights(catalog.db, 'shmuly', sha256, 'preserved', 'family request');
    expect(await getFile(catalog.db, sha256)).toMatchObject({ rights_state: 'preserved', storage_tier: 'preservation' });
    await expect(registerFile(catalog.db, { sha256: 'd'.repeat(64), bytes: 1, mime: 'application/x-msdownload', source: 'contribution', licence: 'unknown', held: true })).rejects.toThrow('not accepted');
  });
});
