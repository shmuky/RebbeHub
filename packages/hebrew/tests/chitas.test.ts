import { HDate } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import { chitasChumash, chumashPortion, dailyTehillim } from '@rebbehub/hebrew';

const on = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return chitasChumash(new HDate(new Date(y!, m! - 1, d!)));
};

describe("Chitas' Chumash and Tehillim", () => {
  it('learns the week\'s parsha an aliyah a day, from Sunday', () => {
    expect(chumashPortion('Bo', 1)).toMatchObject({ book: 'Exodus', ref: 'Exodus 10:1-11' });
    // 3 Elul 5786, a Sunday: Ki Seitzei's first.
    expect(on('2026-08-16')).toMatchObject({ label: 'תצא, ראשון עם פירש״י', ref: 'Deuteronomy 21:10-21' });
    // A combined parsha's week learns both together.
    expect(on('2027-07-12')).toMatchObject({ parsha: 'Chukat-Balak', label: 'חוקת-בלק, שני עם פירש״י' });
  });

  it('keeps the festivals\' ways: the next parsha in a festival\'s week, V\'zos Habracha to Simchas Torah, then Bereishis from its start', () => {
    // Pesach 5787's week learns Acharei, and so does the week after it.
    expect(on('2027-04-22')?.parsha).toBe('Achrei Mot');
    expect(on('2027-04-25')?.parsha).toBe('Achrei Mot');
    // After Shabbos Haazinu, V'zos Habracha; Simchas Torah its sixth and seventh.
    expect(on('2026-09-20')).toMatchObject({ parsha: 'Vezot Haberakhah', aliyos: [1, 1] });
    expect(on('2026-10-04')).toMatchObject({ label: 'וזאת הברכה, ששי ושביעי עם פירש״י', ref: 'Deuteronomy 33:27-34:12' });
    expect(on('2026-10-05')).toMatchObject({ label: 'בראשית, עד שני עם פירש״י', ref: 'Genesis 1:1-2:19' });
    expect(on('2026-10-11')?.parsha).toBe('Noach');
  });

  it("reads the month's Tehillim, the 29th of a short month to the end", () => {
    expect(dailyTehillim('08', 29, 29)).toEqual([{ text: 'קמ-קנ.', ref: 'Psalms 140-150' }]);
    expect(dailyTehillim('07', 29, 30)).toEqual([{ text: 'קמ-קמד.', ref: 'Psalms 140-144' }]);
    expect(dailyTehillim('07', 26, 30)[0]!.ref).toBe('Psalms 119:97-176');
  });
});
