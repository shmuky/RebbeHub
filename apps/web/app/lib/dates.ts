import { dateKeyToGregorian, datePrecision, describeDateKey, parseDateKey, toHebrewNumeral } from '@rebbehub/hebrew';
import type { Lang } from './i18n.js';

/** A date key as people read it, with the civil date for a full day: `י׳ שבט תשמ״ב (3.2.1982)`. */
export function dateLabel(key: string | undefined, lang: Lang, options: { civil?: boolean } = {}): string {
  if (!key || !parseDateKey(key)) return key ?? '';
  const hebrew = describeDateKey(key, lang);
  if (options.civil === false || datePrecision(key) !== 'day') return hebrew;
  const civil = dateKeyToGregorian(key);
  if (!civil) return hebrew;
  const [y, m, d] = civil.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const formatted = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  return `${hebrew} (${formatted})`;
}

export const yearLabel = (year: number, lang: Lang) => (lang === 'he' ? toHebrewNumeral(year) : String(year));
