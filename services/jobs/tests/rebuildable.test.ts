import { describe, expect, it } from 'vitest';
import { Catalog } from '@rebbehub/core';
import { catalogIsRebuildable } from '../src/commands.js';
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

  it('is not rebuildable once people have added to it', async () => {
    const { db } = await freshCatalog();
    expect(await catalogIsRebuildable(db)).toBe(false);
  });
});
