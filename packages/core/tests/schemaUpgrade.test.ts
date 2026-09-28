import { describe, expect, it } from 'vitest';
import { BUILTIN_SCHEMA_VERSION } from '@rebbehub/model';
import { freshCatalog } from './helpers.js';

describe('built-in schema upgrades', () => {
  it('brings an older catalog up to the built-in schemas once, as one system change', async () => {
    const { catalog } = await freshCatalog();
    const head = await catalog.head();
    await catalog.init();
    expect(await catalog.head()).toBe(head); // up to date: nothing to do

    // A catalog made before this version: its schema items say so.
    await catalog.db.query(`UPDATE revision SET data = jsonb_set(data, '{version}', '1'), hash = 'old-' || hash WHERE entity_type = 'schema'`);
    await catalog.init();
    expect(await catalog.head()).toBe(head + 1);
    const [latest] = await catalog.commitsSince(head, 1);
    expect(latest).toMatchObject({ message: `Built-in schemas, version ${BUILTIN_SCHEMA_VERSION}`, author: 'system' });
    await catalog.init();
    expect(await catalog.head()).toBe(head + 1);
  });
});
