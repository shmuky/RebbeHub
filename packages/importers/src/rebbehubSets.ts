import { TESHUROS_SET } from '@rebbehub/core';
import type { Importer } from './importer.js';

/**
 * The sets RebbeHub keeps itself, not read from any source: today the
 * Teshuros set (the plan, sections 1 and 8), where teshuros people add
 * are gathered. Its scans are served with credit to the families, who can
 * ask for one to be taken down (docs/rights.md). Made like any import, so
 * a rebuilt catalog has it too, with the same id.
 */
export function rebbehubSetsImporter(): Importer {
  return {
    id: 'rebbehub-sets',
    bot: { id: 'bot:rebbehub-sets', displayName: 'RebbeHub sets' },
    *records() {
      yield {
        key: TESHUROS_SET.key,
        type: 'set',
        path: TESHUROS_SET.path,
        data: { name: TESHUROS_SET.name, slug: 'teshuros', description: TESHUROS_SET.description, policy: 'moderated', keepers: [] },
      };
    },
  };
}
