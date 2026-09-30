import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageVersion } from '@rebbehub/model';
import { TanyaPrint } from '../app/components/TanyaPrint.js';

/**
 * Tanya set as the book prints it: the chapter's "פרק" run into its first
 * line, a paragraph only at a bold opening word, the daily-learning marks
 * taken out of the words, an approbation's heading and signature apart.
 * The words are invented for the test.
 */

const html = (path: string, label: string, segments: PageVersion['segments']) =>
  renderToStaticMarkup(createElement(TanyaPrint, { version: { id: 'he', language: 'he', segments }, path, label, lang: 'he' }));

describe('TanyaPrint', () => {
  it('runs a chapter into one block, opening with its פרק and first word', () => {
    const out = html('/tanya/1/4', 'חלק ראשון; ליקוטי אמרים, פרק א׳', [
      { id: '1', n: 1, kind: 'verse', text: [{ marker: '[מ: כד כסלו]' }, { text: ' ' }, { text: 'פָּתַח', marks: ['b'] }, { text: ' מִלִּים.' }] },
      { id: '2', n: 2, kind: 'verse', text: [{ text: 'עוֹד מִלִּים.' }] },
      { id: '3', n: 3, kind: 'verse', text: [{ text: '[מ: כה כסלו] ' }, { text: 'חָדָשׁ', marks: ['b'] }, { text: ' פִּסְקָה.' }] },
    ]);
    expect(out.match(/<p class="tp-p/g)).toHaveLength(2);
    expect(out).toContain('<b class="tp-perek">פרק א</b>');
    expect(out).toContain('<b class="tp-open">פתח</b>');
    expect(out).toContain('<span class="tp-mark">[מ: כה כסלו]</span>');
    expect(out).toContain('id="s-2"');
    expect(out).not.toMatch(/[ְ-ּ]/);
  });

  it('sets an approbation with its heading lines and signature apart', () => {
    const out = html('/tanya/1/2/1', 'חלק ראשון; ליקוטי אמרים, הסכמות, פרק א׳', [
      { id: '1', n: 1, kind: 'verse', text: [{ text: 'הסכמת', marks: ['b'] }] },
      { id: '2', n: 2, kind: 'verse', text: [{ text: 'הרב ' }, { text: 'פלוני', marks: ['b'] }, { text: ':' }] },
      { id: '3', n: 3, kind: 'verse', text: [{ text: 'הנה ראיתי את הכתבים.' }] },
      { id: '4', n: 4, kind: 'verse', text: [{ text: 'הקטן ' }, { text: 'פלוני', marks: ['b'] }] },
    ]);
    expect(out.match(/class="tp-head"/g)).toHaveLength(2);
    expect(out).toContain('<b class="tp-open">הנה</b>');
    expect(out).toContain('class="tp-sign"');
  });
});
