import type { Lang } from './i18n.js';

/** The importers by what they bring, in the page's language, instead of their account names. */
export const BOT_NAMES: Record<string, { he: string; en: string }> = {
  'bot:sichos-kodesh-works': { he: 'יבואן הספרים', en: 'The sefarim importer' },
  'bot:sichos-kodesh-occasions': { he: 'יבואן ההתוועדויות', en: 'The farbrengens importer' },
};

/** Who someone is, as a page says it: an importer by what it brings, a person by their name. */
export function personName(id: string, name: string | null | undefined, lang: Lang): string {
  return BOT_NAMES[id]?.[lang] ?? name ?? id;
}
