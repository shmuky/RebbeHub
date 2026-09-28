import { describe, expect, it } from 'vitest';
import { Catalog } from '@rebbehub/core';
import { catalogIsEmpty } from '../src/commands.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

describe('an empty catalog', () => {
  it('holds only the built-in schemas, and suggestions not yet merged', async () => {
    const { db } = await freshCatalog();
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const catalog = new Catalog(db);
    await catalog.init();
    expect(await catalogIsEmpty(db)).toBe(true);

    await catalog.createAccount({ id: 'bot:import', displayName: 'An importer', isBot: true });
    const cs = await catalog.createChangeset('bot:import', { title: 'Half an import' });
    await catalog.putRevision(cs.id, 'bot:import', { type: 'set', data: { name: { he: 'ספרים', en: 'Books' }, slug: 'books', policy: 'open' } });
    expect(await catalogIsEmpty(db)).toBe(true);
  });

  it('is not empty once anything is merged', async () => {
    const { db } = await freshCatalog();
    expect(await catalogIsEmpty(db)).toBe(false);
  });
});
