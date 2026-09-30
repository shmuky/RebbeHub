import { describe, expect, it } from 'vitest';
import { hayomYomShiurim, hayomYomShiurimOf, tanyaChapter, tanyaPath } from '@rebbehub/hebrew';

/**
 * The head of each day of Hayom Yom as the book prints it, checked against
 * the scan of the book (Otzros): the days here are ones whose print shows
 * each rule.
 */
describe('Hayom Yom as printed', () => {
  it('heads a day with its weekday and year, and a Sunday with the parsha\'s first portion', () => {
    // 4 Shevat 5703: "יום ראשון · ד שבט · ה'תש"ג", Bo, Tehillim 23-28, Tanya chapter 17.
    expect(hayomYomShiurim('05', 4)).toEqual({
      hebrew: '5703-05-04',
      weekday: 'יום ראשון',
      year: 'ה׳תש״ג',
      chumash: 'בא, פרשה ראשונה עם פירש״י.',
      chumashRef: 'Exodus 10:1-11',
      tehillim: 'כג-כח.',
      tehillimParts: [{ text: 'כג-כח.', ref: 'Psalms 23-28' }],
      tanya: { unit: 'Tanya, Part I; Likkutei Amarim 17', path: '/tanya/1/20', segment: '1', next: { unit: 'Tanya, Part I; Likkutei Amarim 17', segment: '4' }, label: 'פרק יז' },
      before: 0,
      after: 0,
    });
    // Shabbos Mevarchim Teves: "מברכים ר״ח טבת" above the shiurim; Purim's three notices.
    expect(hayomYomShiurim('03', 26)?.before).toBe(1);
    expect(hayomYomShiurim('06B', 14)?.before).toBe(3);
    // Some days' notices come right after the shiurim instead, or as well.
    expect(hayomYomShiurim('01', 2)).toMatchObject({ before: 1, after: 1 });
    expect(hayomYomShiurim('04', 18)).toMatchObject({ before: 0, after: 2 });
    expect(hayomYomShiurim('05', 10)).toMatchObject({ weekday: 'שבת', chumash: 'בא, שביעי עם פירש״י.', tehillim: 'נה-נט.' });
    // The first day, 19 Kislev 5703, a Shabbos; the last, 18 Kislev 5704.
    expect(hayomYomShiurim('03', 19)).toMatchObject({ weekday: 'שבת', year: 'ה׳תש״ג', chumash: 'וישלח, שביעי עם פירש״י.', tehillim: 'צ-צו.' });
    expect(hayomYomShiurim('03', 18)).toMatchObject({ weekday: 'יום רביעי', year: 'ה׳תש״ד', chumash: 'וישב, רביעי עם פירש״י.' });
  });

  it('keeps the print\'s ways: a festival\'s week, V\'zos Habracha to Simchas Torah, shortened names', () => {
    expect(hayomYomShiurim('07', 15)?.chumash).toBe('אחרי מות, שלישי עם פירש״י.');
    expect(hayomYomShiurim('01', 11)?.chumash).toBe('ברכה, פרשה ראשונה עם פירש״י.');
    expect(hayomYomShiurim('01', 23)?.chumash).toBe('ברכה, ששי ושביעי עם פירש״י.');
    expect(hayomYomShiurim('01', 24)?.chumash).toBe('בראשית, כל הסדרה עם פירש״י.');
    expect(hayomYomShiurim('10', 22)?.chumash).toBe('מטו״ס, פרשה ראשונה עם פירש״י.');
    expect(hayomYomShiurim('02', 3)?.chumash).toBe('לך לך, שני עם פירש״י.');
  });

  it("sets Tehillim by the month, 119 in halves, Elul's three more a day, and Yom Kippur's by its times", () => {
    expect(hayomYomShiurim('04', 29)?.tehillim).toBe('קמ-קנ.');
    expect(hayomYomShiurim('05', 30)?.tehillim).toBe('קמה-קנ.');
    expect(hayomYomShiurim('07', 25)?.tehillim).toBe('קיט, אשרי . . . מצותך מאד.');
    expect(hayomYomShiurim('12', 1)?.tehillim).toBe('א-ט. א-ג.');
    expect(hayomYomShiurim('01', 3)?.tehillim).toBe('יח-כב. צד-צו.');
    expect(hayomYomShiurim('01', 10)?.tehillim).toBe('נה-נט. קודם כל נדרי: קטו-קכג. קודם השינה: קכד-קלב. אחר מוסף: קלג-קמא. אחר נעילה: קמב-קנ.');
  });

  it('has no day the book has not, and finds an entry\'s day from its section and title', () => {
    expect(hayomYomShiurim('04', 30)).toBeNull();
    expect(hayomYomShiurim('03', 25)).toMatchObject({ year: 'ה׳תש״ג' });
    expect(hayomYomShiurimOf({ position: [{ level: 'day', value: '12', label: { he: '<h2>תשרי</h2>' } }], label: { he: '<h3>יט תשרי, ג דחוהמ"ס</h3>' } })).toMatchObject({ weekday: 'יום שני', year: 'ה׳תש״ד' });
    expect(hayomYomShiurimOf({ label: { he: 'x' } })).toBeNull();
  });

  it("names Tanya's chapters in Hebrew", () => {
    expect(tanyaChapter('Part IV; Iggeret HaKodesh 22')).toBe('אגה״ק, כב');
    expect(tanyaChapter('Part II; Shaar HaYichud VehaEmunah 7')).toBe('שעהיוה״א, פרק ז');
    expect(tanyaChapter('Part I; Likkutei Amarim, Title Page')).toBe('שער הספר');
  });
});

describe('Hayom Yom\'s shiurim, to their words', () => {
  it('names each line\'s portion, so the head can link to it', () => {
    // Shabbos 10 Shevat: Bo's seventh; Simchas Torah and Shabbos Bereishis.
    expect(hayomYomShiurim('05', 10)?.chumashRef).toBe('Exodus 13:1-16');
    expect(hayomYomShiurim('01', 23)?.chumashRef).toBe('Deuteronomy 33:27-34:12');
    expect(hayomYomShiurim('01', 24)?.chumashRef).toBe('Genesis 1:1-6:8');
    // Elul adds three chapters a day; the 25th reads 119's first half.
    expect(hayomYomShiurim('12', 2)?.tehillimParts).toEqual([
      { text: 'י-יז.', ref: 'Psalms 10-17' },
      { text: 'ד-ו.', ref: 'Psalms 4-6' },
    ]);
    expect(hayomYomShiurim('07', 25)?.tehillimParts[0]?.ref).toBe('Psalms 119:1-96');
    expect(hayomYomShiurim('01', 10)?.tehillimParts.map((p) => p.ref)).toEqual(['Psalms 55-59', 'Psalms 115-123', 'Psalms 124-132', 'Psalms 133-141', 'Psalms 142-150']);
  });

  it('finds each Tanya chapter\'s page', () => {
    expect(tanyaPath('Part I; Likkutei Amarim, Title Page')).toBe('/tanya/1/1');
    expect(tanyaPath('Part I; Likkutei Amarim, Approbation 2')).toBe('/tanya/1/2/2');
    expect(tanyaPath('Part I; Likkutei Amarim 31')).toBe('/tanya/1/34');
    expect(tanyaPath('Part II; Shaar HaYichud VehaEmunah 3')).toBe('/tanya/2/4');
    expect(tanyaPath('Part IV; Iggeret HaKodesh 22')).toBe('/tanya/4/22');
  });
});
