import { describe, expect, it } from 'vitest';
import { alignAroundLocks, alignParagraphs, alignWords, diffWords, heardWords, matchWords, parseAlto, parseHocr, parsePlainText, pdfPagesOf, remapper, reseedLines, sniffOcrFormat, wordKey } from '@rebbehub/core';

describe('words, compared the Hebrew way', () => {
  it('treats niqqud, geresh, gershayim and final letters typed plain as the same word', () => {
    expect(wordKey('שָׁלוֹם')).toBe(wordKey('שלום'));
    expect(wordKey('ה״ה')).toBe(wordKey('ה"ה'));
    expect(wordKey('כך')).toBe(wordKey('ככ'));
    expect(wordKey('—')).toBe('');
  });

  it('finds the longest common run of words, even over long texts', () => {
    const a = ['א', 'ב', 'ג', 'ד', 'ה'];
    const b = ['א', 'ג', 'ד', 'ו', 'ה'];
    expect(matchWords(a, b)).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
      [4, 4],
    ]);
    // Six thousand words each, with changes scattered: anchors keep it fast and exact.
    const long = Array.from({ length: 6000 }, (_, i) => `w${i}`);
    const other = long.filter((_, i) => i % 97 !== 5).map((w, i) => (i % 211 === 3 ? 'x' : w));
    const pairs = matchWords(long, other);
    expect(pairs.length).toBeGreaterThan(5900);
    for (const [i, j] of pairs) expect(long[i]).toBe(other[j]);
  });
});

describe('compare printings', () => {
  it('shows what one printing has that the other does not, word by word', () => {
    const runs = diffWords('ויאמר משה אל העם, אל תיראו', 'וַיֹּאמֶר משה אל כל העם אל תיראו כי');
    expect(runs).toEqual([
      { op: 'same', text: 'וַיֹּאמֶר משה אל' },
      { op: 'added', text: 'כל' },
      { op: 'same', text: 'העם אל תיראו' },
      { op: 'added', text: 'כי' },
    ]);
    expect(diffWords('א ב ג', 'א ד ג')).toEqual([
      { op: 'same', text: 'א' },
      { op: 'removed', text: 'ב' },
      { op: 'added', text: 'ד' },
      { op: 'same', text: 'ג' },
    ]);
  });
});

describe('contents maps as PDF pages', () => {
  it('takes PDF ranges as they are, and finds printed ones through the page labels', () => {
    const labels = [
      { pdfPage: 3, printed: '1' },
      { pdfPage: 4, printed: '2' },
      { pdfPage: 5, printed: '3' },
    ];
    expect(pdfPagesOf({ from: 7, to: 9, scheme: 'pdf' }, undefined)).toEqual({ from: 7, to: 9 });
    expect(pdfPagesOf({ from: 1, to: 3, scheme: 'printed' }, labels)).toEqual({ from: 3, to: 5 });
    expect(pdfPagesOf({ from: 1, to: 9, scheme: 'printed' }, labels)).toBeNull();
    expect(pdfPagesOf({ from: 1, to: 2, scheme: 'printed' }, undefined)).toBeNull();
  });
});

describe('uploaded OCR formats', () => {
  it('reads hOCR pages and lines, with where each line stands', () => {
    const hocr = `<html><head><meta name="ocr-system" content="tesseract 5.3"/></head><body>
      <div class="ocr_page" title="image x.png; bbox 0 0 1000 2000; ppageno 0">
        <span class="ocr_line" title="bbox 400 100 800 140; baseline 0 0"><span class="ocrx_word" title="bbox 600 100 800 140">בס&quot;ד</span> <span class="ocrx_word">שיחה</span></span>
        <span class="ocr_line" title="bbox 500 200 800 250"><span class="ocrx_word">א.</span></span>
      </div>
      <div class='ocr_page' title='bbox 0 0 1000 1000'><span class='ocr_header' title='bbox 0 0 500 100'>כותרת</span></div>
    </body></html>`;
    expect(sniffOcrFormat(hocr)).toBe('hocr');
    expect(parseHocr(hocr)).toEqual([
      {
        lines: [
          { id: 'l1', text: 'בס"ד שיחה', box: [0.4, 0.05, 0.4, 0.02] },
          { id: 'l2', text: 'א.', box: [0.5, 0.1, 0.3, 0.025] },
        ],
      },
      { lines: [{ id: 'l1', text: 'כותרת', box: [0, 0, 0.5, 0.1] }] },
    ]);
  });

  it('reads ALTO pages and lines', () => {
    const alto = `<?xml version="1.0"?><alto xmlns="http://www.loc.gov/standards/alto/ns-v4#"><Layout>
      <Page ID="p1" WIDTH="2000" HEIGHT="4000" PHYSICAL_IMG_NR="1"><PrintSpace>
        <TextLine ID="l1" HPOS="200" VPOS="400" WIDTH="1000" HEIGHT="100"><String CONTENT="לקוטי"/><SP/><String CONTENT="שיחות"/></TextLine>
      </PrintSpace></Page></Layout></alto>`;
    expect(sniffOcrFormat(alto)).toBe('alto');
    expect(parseAlto(alto)).toEqual([{ lines: [{ id: 'l1', text: 'לקוטי שיחות', box: [0.1, 0.1, 0.5, 0.025] }] }]);
  });

  it('reads plain text, pages parted by form feeds', () => {
    expect(parsePlainText('שורה א\n\nשורה ב\fעמוד ב\n\f')).toEqual([{ lines: [{ id: 'l1', text: 'שורה א' }, { id: 'l2', text: 'שורה ב' }] }, { lines: [{ id: 'l1', text: 'עמוד ב' }] }]);
  });
});

describe('re-reading never touches checked lines', () => {
  it('keeps checked lines where they stand and fills the rest from the new reading', () => {
    const current = [
      { id: 'l1', text: 'בס"ד', box: [0.4, 0.05, 0.4, 0.02] as [number, number, number, number], proofread: 1 as const },
      { id: 'l2', text: 'שיחח', box: [0.5, 0.1, 0.3, 0.025] as [number, number, number, number] },
    ];
    const fresh = [
      { id: 'l1', text: 'בסייד', box: [0.41, 0.05, 0.39, 0.02] as [number, number, number, number] },
      { id: 'l2', text: 'שיחה', box: [0.5, 0.1, 0.3, 0.025] as [number, number, number, number] },
      { id: 'l3', text: 'חדש', box: [0.5, 0.2, 0.3, 0.025] as [number, number, number, number] },
    ];
    expect(reseedLines(current, fresh).map((l) => [l.id, l.text, l.proofread ?? 0])).toEqual([
      ['l1', 'בס"ד', 1],
      ['l2', 'שיחה', 0],
      ['l3', 'חדש', 0],
    ]);
    // Without positions, by order.
    expect(reseedLines([{ id: 'l1', text: 'א' }, { id: 'l2', text: 'ב!', proofread: 2 }], [{ id: 'l1', text: 'אא' }, { id: 'l2', text: 'בב' }]).map((l) => l.text)).toEqual(['אא', 'ב!']);
  });
});

describe('forced alignment', () => {
  it("times a corrected transcript's words from what was heard", () => {
    const heard = heardWords([
      { startMs: 0, endMs: 3000, text: 'x', words: [{ text: 'לחיים', startMs: 0, endMs: 1000 }, { text: 'עס', startMs: 1000, endMs: 1500 }, { text: 'שטייט', startMs: 1500, endMs: 3000 }] },
      { startMs: 4000, endMs: 6000, text: 'אין פסוק' }, // no word times: shared by length
    ]);
    expect(heard.map((h) => [h.text, h.startMs, h.endMs])).toEqual([
      ['לחיים', 0, 1000],
      ['עס', 1000, 1500],
      ['שטייט', 1500, 3000],
      ['אין', 4000, 4857],
      ['פסוק', 4857, 6000],
    ]);
    // A person wrote "שטייט דאך" where the machine heard "שטייט": "דאך" gets the time between its neighbours.
    const timed = alignWords(['לחיים!', 'עס שטייט דאך אין פסוק'], heard)!;
    expect(timed[0]).toEqual({ startMs: 0, endMs: 1000, words: [{ from: 0, to: 6, startMs: 0, endMs: 1000 }] });
    expect(timed[1]!.words.map((w) => [w.startMs, w.endMs])).toEqual([
      [1000, 1500],
      [1500, 3000],
      [3000, 4000],
      [4000, 4857],
      [4857, 6000],
    ]);
    expect(alignWords(['שלום'], [{ text: 'אחר', startMs: 0, endMs: 1 }])).toBeNull();
  });

  it('aligns only between the paragraphs a person locked', () => {
    const heard = [
      { text: 'א', startMs: 0, endMs: 1000 },
      { text: 'ב', startMs: 1000, endMs: 2000 },
      { text: 'א', startMs: 5000, endMs: 6000 },
    ];
    const out = alignAroundLocks([{ content: 'א' }, { content: 'ב', locked: { startMs: 1000, endMs: 4000 } }, { content: 'א' }], heard);
    expect(out[0]!.startMs).toBe(0);
    expect(out[1]).toBeNull();
    expect(out[2]!.startMs).toBe(5000);
  });

  it('stretches what follows a fix up to the next locked paragraph', () => {
    const move = remapper(10_000, 12_000, 20_000);
    expect([move(5_000), move(10_000), move(15_000), move(20_000), move(25_000)]).toEqual([7_000, 12_000, 16_000, 20_000, 25_000]);
    expect(remapper(10_000, 12_000, null)(15_000)).toBe(17_000);
  });
});

describe('hanacha paragraphs by similarity', () => {
  it('finds where each paragraph of the hanacha is said, in order, skipping one never said', () => {
    const paragraphs = ['בענין הגאולה והמשיח בימינו', 'וזהו מה שכתוב בפרשת השבוע אודות התורה', 'פסקה שלא נאמרה כלל בהתוועדות', 'ולכן צריך להוסיף בצדקה ובמעשים טובים'];
    const said = [
      ...'דער ענין פון גאולה און משיח בימינו ממש'.split(' '),
      ...'און דאס איז וואס עס שטייט אין פרשת השבוע וועגן תורה'.split(' '),
      ...'דעריבער דארף מען מוסיף זיין אין צדקה און מעשים טובים'.split(' '),
    ].map((text, i) => ({ text, startMs: i * 1000, endMs: i * 1000 + 900 }));
    const out = alignParagraphs(paragraphs, said, { piece: 5 });
    expect(out[0]!.startMs).toBe(0);
    expect(out[1]!.startMs).toBeGreaterThanOrEqual(5_000);
    expect(out[1]!.startMs).toBeLessThan(out[3]!.startMs);
    expect(out[2]).toBeNull();
    expect(out[3]!.endMs).toBe(said.at(-1)!.endMs);
  });
});
