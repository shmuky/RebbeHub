import { describe, expect, it } from 'vitest';
import { volumeLines } from '../app/lib/workView.server.js';

/** The column beside a sicha on a wide screen: the rest of its volume, as a reader looks for it. */
describe('the rest of a volume beside a sicha', () => {
  const vol = { level: 'volume', value: '30', label: { he: 'כרך ל' } };
  const piece = (parsha: [string, string], sicha: string, n: string) => ({ id: `rh-${parsha[0]}${sicha}${n}`, type: 'unit', path: `/ls/30/${parsha[0]}/${sicha}/${n}`, rev: 1, data: { label: { he: n }, position: [vol, { level: 'parsha', value: parsha[0], label: { he: parsha[1] } }, { level: 'sicha', value: sicha, label: { he: `שיחה ${sicha}` } }, { level: 'piece', value: n }] } });

  it('lists the sichos of a volume kept in numbered pieces, each once, under its parsha', () => {
    const units = [piece(['1', 'בראשית'], 'א', '1'), piece(['1', 'בראשית'], 'א', '2'), piece(['1', 'בראשית'], 'ב', '1'), piece(['2', 'נח'], 'א', '1')];
    expect(volumeLines(units, units[1]!, 'he')).toEqual([
      { group: 'בראשית', label: 'שיחה א', path: '/ls/30/1/א/1', current: true },
      { group: 'בראשית', label: 'שיחה ב', path: '/ls/30/1/ב/1', current: false },
      { group: 'נח', label: 'שיחה א', path: '/ls/30/2/א/1', current: false },
    ]);
  });

  it("shortens a chapter's name that repeats its volume's", () => {
    const part = { level: 'part', value: '1', label: { he: 'חלק ראשון; ליקוטי אמרים' } };
    const chapter = (n: string, name: string) => ({ id: `rh-t${n}`, type: 'unit', path: `/tanya/1/${n}`, rev: 1, data: { label: { he: `חלק ראשון; ליקוטי אמרים, ${name}` }, position: [part, { level: 'chapter', value: n }] } });
    const units = [chapter('3', 'פרק א׳'), chapter('4', 'פרק ב׳')];
    expect(volumeLines(units, units[0]!, 'he').map((x) => [x.label, x.current])).toEqual([
      ['פרק א׳', true],
      ['פרק ב׳', false],
    ]);
  });
});
