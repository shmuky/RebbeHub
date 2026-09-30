import { describe, expect, it } from 'vitest';
import { likkuteiSichosImporter, type LikkuteiSichosItem } from '@rebbehub/importers';

const pdf = (sourceId: string, role = 'sicha') => ({ kind: 'pdf', sourceId, role });
const ITEMS: LikkuteiSichosItem[] = [
  { id: '2:301', label: '', volume: 2, page: 301, sectionLabel: 'חה"ש', refs: [pdf('b')] },
  { id: '1:1', label: '', volume: 1, page: 1, sectionLabel: 'בראשית', sectionLabelEn: 'Bereishis', refs: [pdf('a'), pdf('a-he', 'translated')] },
  { id: '1:4', label: '', volume: 1, page: 4, sectionLabel: 'בראשית', sectionLabelEn: 'Bereishis', refs: [pdf('a2')] },
  { id: '30:1', label: '', volume: 30, page: 1, sectionLabel: 'בראשית', refs: [pdf('typed')] },
  { id: '40:1', label: '', volume: 40, page: 1, sectionLabel: 'מילואים', supplement: true, refs: [pdf('supplement')] },
  { id: '3:747', label: '', volume: 3, page: 747, sectionLabel: 'שמות', refs: [pdf('only-translated', 'translated')] },
];

describe('Likkutei Sichos PDFs', () => {
  it('makes a page per sicha the Chabad Library has not typed, at its volume and printed page, in print order', async () => {
    const records = [];
    for await (const r of likkuteiSichosImporter(ITEMS).records()) records.push(r);
    expect(records.map((r) => r.path)).toEqual(['/likkutei-sichos/1/1', '/likkutei-sichos/1/4', '/likkutei-sichos/2/301']);
    expect(records[0]!.data).toMatchObject({
      label: { he: 'בראשית א', en: 'Bereishis 1' },
      position: [{ level: 'volume', value: '1', label: { he: 'חלק א׳' } }, { level: 'sicha', value: '1' }],
      editions: [
        { source: 'mafteiach', sourceId: 'a', kind: 'pdf', role: 'sicha', url: 'https://drive.google.com/file/d/a/view' },
        { source: 'mafteiach', sourceId: 'a-he', kind: 'pdf', role: 'translated', language: 'he' },
      ],
    });
    expect(records[2]!.data).toMatchObject({ label: { he: 'חה"ש' } });
    // Sorted ahead of the Chabad Library's pages (whose keys start at "00Q"), and in order among themselves.
    const orders = records.map((r) => (r.data as { order: string }).order);
    expect([...orders].sort()).toEqual(orders);
    expect(orders.every((o) => o < '00Q')).toBe(true);
  });
});
