import { describe, expect, it } from 'vitest';
import { Catalog, createApiToken, createPerson } from '@rebbehub/core';
import { catalogIsRebuildable, catalogMarkSql, markGuardSql } from '../src/commands.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

describe('a rebuildable catalog', () => {
  it('holds only the built-in schemas and what importers made', async () => {
    const { db } = await freshCatalog();
    await db.exec('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const catalog = new Catalog(db);
    await catalog.init();
    expect(await catalogIsRebuildable(db)).toBe(true);

    // An importer's suggestion, approved by a steward.
    await catalog.createAccount({ id: 'shmuly', displayName: 'Shmuly' });
    await db.query("UPDATE account SET is_steward = TRUE WHERE id = 'shmuly'");
    await catalog.createAccount({ id: 'bot:import', displayName: 'An importer', isBot: true });
    const cs = await catalog.createChangeset('bot:import', { title: 'An import' });
    await catalog.putRevision(cs.id, 'bot:import', { type: 'set', data: { name: { he: 'ספרים', en: 'Books' }, slug: 'books', policy: 'open', keepers: [] } });
    await catalog.submit(cs.id, 'bot:import');
    await catalog.merge(cs.id, 'shmuly');
    expect(await catalogIsRebuildable(db)).toBe(true);

    // A person's suggestion, even one not yet sent, is theirs to keep.
    await catalog.createAccount({ id: 'mendy', displayName: 'Mendy' });
    await catalog.createChangeset('mendy', { title: 'A fix' });
    expect(await catalogIsRebuildable(db)).toBe(false);
  });

  it('is not rebuildable once a person made a token or chose a handle', async () => {
    const { db } = await freshCatalog();
    await db.exec('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await new Catalog(db).init();
    const person = await createPerson(db, 'Mendy');
    expect(await catalogIsRebuildable(db)).toBe(true);
    await db.query('UPDATE auth.person SET username_changed_at = now() WHERE id = $1', [person.id]);
    expect(await catalogIsRebuildable(db)).toBe(false);
    await db.query('UPDATE auth.person SET username_changed_at = NULL WHERE id = $1', [person.id]);
    await createApiToken(db, person.id, { name: 'script', scopes: ['read'] });
    expect(await catalogIsRebuildable(db)).toBe(false);
  });

  it('is not rebuildable once people have added to it', async () => {
    const { db } = await freshCatalog();
    expect(await catalogIsRebuildable(db)).toBe(false);
  });
});

describe("a catalog's mark", () => {
  it('stays the same while nothing changes, and moves with anything people do', async () => {
    const { db, catalog } = await freshCatalog();
    const mark = async () => (await db.query<{ mark: string }>(await catalogMarkSql(db))).rows[0]!.mark;
    const before = await mark();
    expect(before).toMatch(/^[0-9a-f]{32}$/);
    expect(await mark()).toBe(before);
    await catalog.createAccount({ id: 'yossi', displayName: 'Yossi' });
    expect(await mark()).not.toBe(before);
  });

  it('guards a copy: the SQL stops unless the catalog still has the mark', async () => {
    const { db, catalog } = await freshCatalog();
    const mark = (await db.query<{ mark: string }>(await catalogMarkSql(db))).rows[0]!.mark;
    const guard = await markGuardSql(db, mark);
    await db.transaction(async (tx) => void (await tx.exec(guard)));
    await catalog.createAccount({ id: 'yossi', displayName: 'Yossi' });
    await expect(db.transaction(async (tx) => void (await tx.exec(guard)))).rejects.toThrow(/changed while the import ran/);
    await expect(markGuardSql(db, 'not a mark')).rejects.toThrow();
  });
});
