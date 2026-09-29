import { describe, expect, it } from 'vitest';
import {
  compareDateKeys,
  dateKeyFromGregorian,
  dateKeyToGregorian,
  dateKeyWithin,
  describeDateKey,
  normalizeSearchText,
  parseDateText,
  parseHebrewYear,
  toHebrewNumeral,
  validateDateKey,
} from '@rebbehub/hebrew';

describe('Hebrew numerals', () => {
  it('writes years and days as they are printed', () => {
    expect(toHebrewNumeral(5742)).toBe('תשמ״ב');
    expect(toHebrewNumeral(10)).toBe('י׳');
    expect(toHebrewNumeral(15)).toBe('ט״ו');
    expect(toHebrewNumeral(16)).toBe('ט״ז');
    expect(toHebrewNumeral(5715)).toBe('תשט״ו');
    expect(toHebrewNumeral(5742, { keepThousands: true })).toBe('ה׳תשמ״ב');
  });

  it('reads years in every usual form', () => {
    expect(parseHebrewYear('תשמ"ב')).toBe(5742);
    expect(parseHebrewYear('תשמ״ב')).toBe(5742);
    expect(parseHebrewYear("ה'תשמ\"ב")).toBe(5742);
    expect(parseHebrewYear('5742')).toBe(5742);
    expect(parseHebrewYear('abc')).toBeNull();
  });
});

describe('date keys', () => {
  it('checks Adar against the year', () => {
    expect(validateDateKey('5742-06-14').ok).toBe(true);
    expect(validateDateKey('5741-06-14').ok).toBe(false); // 5741 is a leap year
    expect(validateDateKey('5741-06B-14').ok).toBe(true);
    expect(validateDateKey('5742-06A-14').ok).toBe(false);
  });

  it('checks the length of the month', () => {
    expect(validateDateKey('5742-05-30').ok).toBe(true); // Shevat has 30 days
    expect(validateDateKey('5742-04-30').ok).toBe(false); // Teves has 29
    expect(validateDateKey('5742-13-01').ok).toBe(false);
    expect(validateDateKey('5742').ok).toBe(true);
    expect(validateDateKey('5742-05').ok).toBe(true);
  });

  it('converts to and from the civil calendar', () => {
    // Yud Shevat 5711: 17 January 1951.
    expect(dateKeyToGregorian('5711-05-10')).toBe('1951-01-17');
    expect(dateKeyFromGregorian('1951-01-17')).toBe('5711-05-10');
    // Purim 5741 (a leap year) fell in Adar II.
    expect(dateKeyFromGregorian('1981-03-20')).toBe('5741-06B-14');
  });

  it('sorts in calendar order, not string order', () => {
    const keys = ['5741-07-01', '5741-06B-14', '5741-06A-14', '5741-01-01', '5741', '5741-12'];
    expect([...keys].sort(compareDateKeys)).toEqual(['5741', '5741-01-01', '5741-06A-14', '5741-06B-14', '5741-07-01', '5741-12']);
  });

  it('tells whether a day falls in a month or year', () => {
    expect(dateKeyWithin('5742-05-10', '5742')).toBe(true);
    expect(dateKeyWithin('5742-05-10', '5742-05')).toBe(true);
    expect(dateKeyWithin('5742-05-10', '5742-06')).toBe(false);
    expect(dateKeyWithin('57421', '5742')).toBe(false);
  });

  it('describes a key in both languages', () => {
    expect(describeDateKey('5742-05-10', 'he')).toBe('י׳ שבט תשמ״ב');
    expect(describeDateKey('5742-05-10', 'en')).toBe('10 Shevat 5742');
    expect(describeDateKey('5741-06B', 'en')).toBe('Adar II 5741');
  });
});

describe('parseDateText', () => {
  it.each([
    ['יו"ד שבט תשכ"ב', '5722-05-10'],
    ["י' שבט ה'תשכ\"ב", '5722-05-10'],
    ['10 Shvat 5722', '5722-05-10'],
    ['Shvat 10, 5722', '5722-05-10'],
    ['the 10th of Shevat 5722', '5722-05-10'],
    ['Shevat 5722', '5722-05'],
    ['5722', '5722'],
    ['5722-05-10', '5722-05-10'],
    ['י"ג תמוז תשמ"ז', '5747-10-13'],
    ['14 Adar II 5741', '5741-06B-14'],
    ['ט"ו אדר ב\' תשמ"א', '5741-06B-15'],
  ])('%s → %s', (text, key) => {
    expect(parseDateText(text)).toEqual({ ok: true, key });
  });

  it('refuses a plain Adar in a leap year and impossible days', () => {
    expect(parseDateText('14 Adar 5741').ok).toBe(false);
    expect(parseDateText('30 Teves 5742').ok).toBe(false);
    expect(parseDateText('hello').ok).toBe(false);
  });
});

describe('normalizeSearchText', () => {
  it('matches the Sichos-Kodesh contract', () => {
    expect(normalizeSearchText('לקוטי שיחות, ח"ב')).toBe('לקוטי שיחות חב');
    expect(normalizeSearchText('בְּרֵאשִׁית')).toBe('בראשית');
    expect(normalizeSearchText('Likkutei  Sichos!')).toBe('likkutei sichos');
  });
});

describe('words that add up to a year', () => {
  it('reads only letters running from largest to smallest as a year', () => {
    expect(parseDateText('באתי').ok).toBe(false);
    expect(parseDateText('תשמב')).toMatchObject({ ok: true, key: '5742' });
  });
});
