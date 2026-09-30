import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toHebrewNumeral } from '@rebbehub/hebrew';
import { orderKeys } from '@rebbehub/model';
import { driveLink } from './driveLinks.js';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { workPath } from './sichosKodeshWorks.js';

/**
 * Every sicha of Likkutei Sichos that the Chabad Library has not typed,
 * from the list Sichos-Kodesh's app is built from
 * (apps/mobile/src/catalog/data/library/likkuteiSichos.json, made from
 * mafteiach.app): a page per sicha, at its volume and the printed page it
 * starts on (/likkutei-sichos/2/293 is vol 2 p. 293), linking to its PDF on
 * Google Drive and, where there is one, the PDF of its Hebrew translation.
 * The words come later, from reading the scan, labelled as machine-read
 * until a person checks them. Read from a Sichos-Kodesh checkout at run
 * time; RebbeHub keeps no copy.
 */

/** The volumes the Chabad Library typed: their pages come from chabadLibrary.ts, a page per printed page. */
export const TYPED_VOLUMES = new Set([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);

/** Sichos-Kodesh's library item (its packages/catalog/src/library/types.ts), as far as this reads it. */
export interface LikkuteiSichosItem {
  id: string;
  label: string;
  volume: number;
  page: number;
  sectionLabel: string;
  sectionLabelEn?: string;
  supplement?: boolean;
  refs: Array<{ kind: string; sourceId: string; role: string; label?: string }>;
}

export async function readLikkuteiSichos(from: string): Promise<LikkuteiSichosItem[]> {
  const file = join(from, 'apps/mobile/src/catalog/data/library/likkuteiSichos.json');
  return (JSON.parse(await readFile(file, 'utf8')) as { items: LikkuteiSichosItem[] }).items;
}

export function likkuteiSichosImporter(input: LikkuteiSichosItem[] | (() => Promise<LikkuteiSichosItem[]>)): Importer {
  return {
    id: 'likkutei-sichos',
    bot: { id: 'bot:likkutei-sichos', displayName: 'Likkutei Sichos PDFs importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const all = typeof input === 'function' ? await input() : input;
      // The 39 volumes (the מילואים, printed as a 40th, wait for their own place), in print order.
      const items = all
        .filter((i) => i.volume >= 1 && i.volume <= 39 && !i.supplement && !TYPED_VOLUMES.has(i.volume) && Number.isInteger(i.page) && i.page > 0)
        .sort((a, b) => a.volume - b.volume || a.page - b.page);
      // Before the Chabad Library's volumes 30-39, whose keys start at "00Q": "000…" sorts ahead of all of them.
      const orders = orderKeys(items.length).map((key) => `000${key}`);
      // A parsha or moed with more than one sicha in a volume numbers them: בראשית א, בראשית ב.
      const inSection = new Map<string, number>();
      for (const i of items) inSection.set(`${i.volume}/${i.sectionLabel}`, (inSection.get(`${i.volume}/${i.sectionLabel}`) ?? 0) + 1);
      const seen = new Map<string, number>();
      for (const [n, item] of items.entries()) {
        const section = `${item.volume}/${item.sectionLabel}`;
        const nth = (seen.get(section) ?? 0) + 1;
        seen.set(section, nth);
        const name = inSection.get(section)! > 1 ? `${item.sectionLabel} ${toHebrewNumeral(nth).replace(/[׳״]/g, '')}` : item.sectionLabel;
        const editions = item.refs
          .filter((r) => r.kind === 'pdf' && (r.role === 'sicha' || r.role === 'translated'))
          .map((r) => ({
            source: 'mafteiach',
            sourceId: r.sourceId,
            kind: 'pdf',
            licence: 'facts-and-links',
            role: r.role,
            label: r.role === 'translated' ? 'תרגום ללשון הקודש' : 'drive',
            ...(r.role === 'translated' ? { language: 'he' } : {}),
            url: driveLink({ id: r.sourceId }),
          }));
        if (!editions.some((e) => e.role === 'sicha')) continue;
        yield {
          key: `likkutei-sichos:${item.volume}:${item.page}`,
          type: 'unit',
          path: `${workPath('likkutei-sichos')}/${item.volume}/${item.page}`,
          data: {
            work: ref('sichos-kodesh-work:likkutei-sichos'),
            position: [
              { level: 'volume', value: String(item.volume), label: { he: `חלק ${toHebrewNumeral(item.volume)}` } },
              { level: 'sicha', value: String(item.page), label: { he: `עמ' ${item.page}` } },
            ],
            order: orders[n]!,
            label: { he: name, ...(item.sectionLabelEn ? { en: inSection.get(section)! > 1 ? `${item.sectionLabelEn} ${nth}` : item.sectionLabelEn } : {}) },
            externalIds: { mafteiach: `likkut_sicha_${item.volume}_${item.page}` },
            editions,
          },
        };
      }
    },
  };
}
