import { describe, expect, it } from 'vitest';
import { teshurosSetId, TESHUROS_SET } from '@rebbehub/core';
import { rebbehubSetsImporter, runImport } from '@rebbehub/importers';
import { freshCatalog } from '../../core/tests/helpers.js';

describe('the sets RebbeHub keeps itself', () => {
  it('makes the Teshuros set at /teshuros, with the id uploads look for, once', async () => {
    const { catalog } = await freshCatalog();
    const first = await runImport(catalog, rebbehubSetsImporter(), { approveAs: 'shmuly' });
    expect(first.created).toBe(1);
    const set = await catalog.get(await teshurosSetId());
    expect(set).toMatchObject({ type: 'set', path: TESHUROS_SET.path, data: { slug: 'teshuros', policy: 'moderated', name: { he: 'תשורות' } } });
    expect((await runImport(catalog, rebbehubSetsImporter(), { approveAs: 'shmuly' })).unchanged).toBe(1);
  });
});
