import { describe, expect, it } from 'vitest';
import { neighbourLabel } from '../app/components/ChapterNav.js';

/** A sicha's back and forth names where each button goes: its volume too, when that is another volume. */
describe("a sicha's back and forth", () => {
  const volume = (n: string) => ({ level: 'volume', value: n, label: { he: `חלק ${n}`, en: `Volume ${n}` } });
  const unit = (v: string | null, n: string) => ({ id: `rh-${v ?? 'x'}${n}`, type: 'unit', data: { label: { he: `שיחה ${n}` }, position: v ? [volume(v), { level: 'sicha', value: n }] : [{ level: 'sicha', value: n }] } });

  it('names a sicha in the same volume by its own name', () => {
    expect(neighbourLabel(unit('1', '2'), unit('1', '1'), 'he')).toBe('שיחה 2');
    expect(neighbourLabel(unit(null, '2'), unit(null, '1'), 'he')).toBe('שיחה 2');
  });

  it("adds the volume's name across a volume's end", () => {
    expect(neighbourLabel(unit('2', '1'), unit('1', '30'), 'he')).toBe('חלק 2, שיחה 1');
    expect(neighbourLabel(unit('2', '1'), unit('1', '30'), 'en')).toBe('Volume 2, שיחה 1');
  });

  it('calls a piece of a sicha kept in numbered pieces by its sicha', () => {
    const piece = (parsha: string, sicha: string, n: string) => ({ id: `rh-${parsha}${sicha}${n}`, type: 'unit', data: { label: { he: n }, position: [volume('30'), { level: 'parsha', value: parsha, label: { he: parsha === '1' ? 'בראשית' : 'נח' } }, { level: 'sicha', value: sicha, label: { he: `שיחה ${sicha}` } }, { level: 'piece', value: n }] } });
    expect(neighbourLabel(piece('1', 'א', '2'), piece('1', 'א', '1'), 'he')).toBe('שיחה א (2)');
    expect(neighbourLabel(piece('2', 'א', '1'), piece('1', 'ב', '8'), 'he')).toBe('נח, שיחה א');
  });
});
