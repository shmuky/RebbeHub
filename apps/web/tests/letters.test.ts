import { describe, expect, it } from 'vitest';
import type { PageSegment, PageText } from '@rebbehub/model';
import { isGreeting, letterOpening, shapeLetter } from '../app/lib/letters.js';

/** A letter's page (5b, 5d) shows the date and addressee its own first lines give, and sets those lines as a letter prints them. */
describe("a letter's opening lines", () => {
  const p = (id: string, text: string): PageSegment => ({ id, kind: 'paragraph', text: [{ text }] });
  const page = (...segments: PageSegment[]): PageText => ({ profile: 'sichos-kodesh', versions: [{ id: 'he', language: 'he', segments }] }) as unknown as PageText;
  const letter = page(p('1', 'ב"ה, ב\' ניסן, תשי"ז'), p('2', 'ברוקלין.'), p('3', "האברך מנחם בן ציון שי'"), p('4', 'שלום וברכה!'), p('5', 'לאחרי הפסק ארוך נתקבל מכתבו'));

  it('reads the date, the place and the addressee', () => {
    expect(letterOpening(letter)).toEqual({ date: 'ב\' ניסן, תשי"ז', place: 'ברוקלין', to: "האברך מנחם בן ציון שי'", end: ['1', '2'] });
  });

  it('sets the date and place lines at the end, and knows the greeting', () => {
    const shaped = shapeLetter(letter, letterOpening(letter)!);
    expect(shaped.versions[0]!.segments.map((s) => Boolean(s.end))).toEqual([true, true, false, false, false]);
    expect(isGreeting(letter.versions[0]!.segments[3]!)).toBe(true);
    expect(isGreeting(letter.versions[0]!.segments[4]!)).toBe(false);
  });

  it('leaves a text that does not open as a letter alone', () => {
    expect(letterOpening(page(p('1', 'בס"ד. שיחת שבת'), p('2', 'שלום וברכה!')))).toBeNull();
    expect(letterOpening(page(p('1', 'ב"ה'), p('2', 'הנה'.repeat(40)), p('3', 'שלום וברכה!')))).toBeNull();
    expect(letterOpening(page(p('1', 'ב"ה, ט"ו שבט'), p('2', 'פתיחה בלי ברכה')))).toBeNull();
  });
});
