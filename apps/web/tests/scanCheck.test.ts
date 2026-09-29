import { describe, expect, it } from 'vitest';
import type { PageText } from '@rebbehub/model';
import { scanPages, scannedVersion } from '../app/lib/scanPages.js';

/**
 * A page of the machine-read subject index, checked against its scan: its
 * source markers say which page of the scan each segment was read from.
 */

const ocr = { by: 'ocr:kraken-maftechos-r4' };
const index: PageText = {
  profile: 'plain',
  versions: [
    {
      id: 'he',
      language: 'he',
      url: 'https://drive.google.com/file/d/1mndi0ZWHOx10XXiLT2sS8rYgeFGrg1kU/view',
      segments: [
        { id: 't1', kind: 'heading', level: 2, text: [{ text: '(המשך)' }], origin: ocr },
        { id: 't1.1', kind: 'paragraph', text: [{ text: '12' }, { text: '.' }], origin: ocr },
        { id: 't2', kind: 'heading', level: 2, text: [{ marker: 'סריקה 4' }, { text: 'אב ובן' }], origin: ocr },
        { id: 't2.1', kind: 'paragraph', text: [{ text: '27', href: '/read?src=https://drive.google.com/open?id=x' }, { text: ' (בן ממשיך).' }], origin: { ...ocr, checked: true } },
        { id: 't3', kind: 'heading', level: 2, text: [{ marker: 'סריקה 5' }, { text: 'אבות' }], origin: ocr },
      ],
    },
  ],
};

describe('checking a machine-read index against its scan', () => {
  it('finds the scan page of each segment from the markers before it', () => {
    expect(Object.fromEntries(scanPages(index, 'he'))).toEqual({ t1: 1, 't1.1': 1, t2: 4, 't2.1': 4, t3: 5 });
  });

  it('opens beside the scan only a version with its scan address and words not yet checked', () => {
    expect(scannedVersion(index)).toEqual({ id: 'he', url: index.versions[0]!.url });
    const { url: _url, ...noScan } = index.versions[0]!;
    expect(scannedVersion({ ...index, versions: [noScan] })).toBeNull();
    const allChecked = { ...index.versions[0]!, segments: index.versions[0]!.segments.map((s) => ({ ...s, origin: { ...ocr, checked: true } })) };
    expect(scannedVersion({ ...index, versions: [allChecked] })).toBeNull();
  });

});
