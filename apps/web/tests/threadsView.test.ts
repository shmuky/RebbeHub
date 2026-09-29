import { describe, expect, it } from 'vitest';
import { apiParams, issueKeys, lineOf, queryOf, questionsOf } from '../app/lib/issueTokens.js';
import { parseTokens, withToken, words } from '../app/lib/tokens.js';
import { diffStat, wordDiff } from '../app/lib/wordDiff.js';
import { initials } from '../app/lib/initials.js';

/**
 * The pieces the suggestion and report pages are drawn from: a change
 * marked word by word, the search line's filters, and the initials in a
 * person's circle.
 */

describe('a change, word by word', () => {
  it('marks only the word that changed, and keeps the marks around it in place', () => {
    const parts = wordDiff('כמו שכתוב בפסוק, ויאמר.', 'כמו שכתוב בפסוק, ויאמרו.');
    expect(parts.filter((p) => p.kind !== 'same')).toEqual([
      { kind: 'del', text: 'ויאמר' },
      { kind: 'ins', text: 'ויאמרו' },
    ]);
    expect(parts.map((p) => (p.kind === 'ins' ? '' : p.text)).join('')).toBe('כמו שכתוב בפסוק, ויאמר.');
    expect(diffStat(parts)).toEqual({ added: 1, removed: 1 });
  });

  it('keeps a word with gershayim whole', () => {
    const parts = wordDiff('בשנת תשי״א', 'בשנת תשי״ב');
    expect(parts.find((p) => p.kind === 'del')?.text).toBe('תשי״א');
    expect(parts.find((p) => p.kind === 'ins')?.text).toBe('תשי״ב');
  });

  it('says nothing changed when nothing did', () => {
    expect(wordDiff('אותו דבר', 'אותו דבר')).toEqual([{ kind: 'same', text: 'אותו דבר' }]);
    expect(wordDiff('', '')).toEqual([]);
  });
});

describe("the reports' search line", () => {
  const keys = issueKeys([{ name: 'scan', color: '#bf8700', description: null, open: 3 } as never], [{ type: 'wrong-text', label: { he: 'טעות בטקסט', en: 'Wrong text' }, template: { he: '', en: '' }, private: false }], [
    { id: 'rh-igros', he: 'אגרות קודש', en: 'Igros Kodesh' },
  ]);

  it('keeps a quoted name whole, but not a year written with gershayim', () => {
    expect(words('אוסף:"אגרות קודש" תשי״א').map((w) => w.text)).toEqual(['אוסף:"אגרות קודש"', 'תשי״א']);
    const parsed = parseTokens('אוסף:"אגרות קודש" תשי״א', keys);
    expect(parsed.filters.set).toEqual(['rh-igros']);
    expect(parsed.text).toBe('תשי״א');
  });

  it('reads filters in either language and opens on the open reports', () => {
    const line = lineOf(new URLSearchParams('label=scan'), keys, 'he');
    expect(line).toBe('מצב:פתוח תווית:סריקה');
    const q = queryOf('state:closed label:scan assignee:@levi author:@me פסוק', keys);
    expect(q).toMatchObject({ state: 'closed', label: ['scan'], assignee: 'levi', author: '@me', text: 'פסוק', sort: 'new' });
    expect(apiParams(q, 'shmuly')).toEqual({ state: 'closed', label: 'scan', assignee: 'levi', author: 'shmuly', q: 'פסוק' });
    // Someone with no handle asks without "mine".
    expect(apiParams(queryOf('author:@me', keys), null)).toEqual({ state: 'open' });
  });

  it('writes a filter in the page language, replacing the one it had', () => {
    expect(withToken('מצב:פתוח פסוק', keys, 'state', 'closed', 'he')).toBe('מצב:טופל פסוק');
    expect(withToken('מצב:פתוח', keys, 'set', 'rh-igros', 'he')).toBe('אוסף:"אגרות קודש" מצב:פתוח');
  });

  it("gives a kind of report its questions in one line", () => {
    expect(questionsOf('איפה (עמוד, שורה או פסקה):\n\nמה כתוב:\n\nמה צריך להיות:\n')).toBe('איפה (עמוד, שורה או פסקה) · מה כתוב · מה צריך להיות');
  });
});

describe("a person's initials", () => {
  it('takes the first and last names, with gershayim between Hebrew letters, and leaves out titles', () => {
    expect(initials('ר׳ יוסף הכהן')).toBe('י״ה');
    expect(initials('מ. גולדברג')).toBe('מ״ג');
    expect(initials('Levi Yitzchak')).toBe('LY');
    expect(initials('Rabbi Levi Yitzchak Cohen')).toBe('LC');
    expect(initials('')).toBe('?');
  });
});
