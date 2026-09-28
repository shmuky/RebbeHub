import { describe, expect, it } from 'vitest';
import { datesOf, parseSmartQuery, parshaWeek } from '../app/lib/smartSearch.js';

describe('smart search', () => {
  it('reads a parsha and a year, in Hebrew or English, with or without "parshas"', () => {
    expect(parseSmartQuery('בשלח תשל״ו')).toEqual({ parsha: 'Beshalach', year: 5736, rest: '' });
    expect(parseSmartQuery('parshas Beshalach 5736')).toEqual({ parsha: 'Beshalach', year: 5736, rest: '' });
    expect(parseSmartQuery('פרשת חיי שרה').parsha).toBe('Chayei Sara');
  });

  it('forgives a mistyped parsha, but not a word that is close to two', () => {
    expect(parseSmartQuery('Beshalah').parsha).toBe('Beshalach');
    expect(parseSmartQuery('תניא')).toEqual({ rest: 'תניא' });
  });

  it('reads chagim, Chabad days and days of a month', () => {
    expect(parseSmartQuery('יו״ד שבט').day?.tokens).toEqual(['05-10']);
    expect(parseSmartQuery('חנוכה תשמ״ב')).toMatchObject({ day: { label: 'חנוכה' }, year: 5742 });
    expect(parseSmartQuery('כ״ח סיון').day?.tokens).toEqual(['09-28']);
    expect(parseSmartQuery('14 adar').day?.tokens).toEqual(['06-14', '06B-14']);
  });

  it('keeps the words it does not understand for searching names', () => {
    expect(parseSmartQuery('ליקוטי שיחות תשל״ו')).toEqual({ year: 5736, rest: 'ליקוטי שיחות' });
  });

  it('turns a parsha into the days of its week, and a day and year into dates', () => {
    const week = parshaWeek('Beshalach', 5736);
    expect(week).toHaveLength(7);
    expect(week[6]).toBe('5736-05-15'); // Shabbos Shira, 15 Shevat 5736
    // Purim is in Adar in a plain year (5742) and in Adar II in a leap year (5744).
    expect(datesOf({ day: { label: 'פורים', tokens: ['06-14', '06B-14'] }, year: 5742, rest: '' })).toEqual(['5742-06-14']);
    expect(datesOf({ day: { label: 'פורים', tokens: ['06-14', '06B-14'] }, year: 5744, rest: '' })).toEqual(['5744-06B-14']);
  });
});
