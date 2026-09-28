import type { LocalName } from '@rebbehub/model';
import type { Entity } from './api.js';
import { dateLabel } from './dates.js';
import { nameOf, typeName, type Lang } from './i18n.js';

/** What an item is called, in the page's language, whatever its type. */
export function labelOf(item: Pick<Entity, 'type' | 'data' | 'id'>, lang: Lang): string {
  const d = item.data as { name?: LocalName; title?: LocalName; label?: LocalName; date?: string; page?: number; kind?: string };
  const named = nameOf(d.name ?? d.title ?? d.label, lang);
  if (named) return named;
  if (item.type === 'text-page' && d.page) return `${typeName(item.type, lang)} ${d.page}`;
  if (d.date) return `${typeName(item.type, lang)} · ${dateLabel(d.date, lang, { civil: false })}`;
  return `${typeName(item.type, lang)} ${item.id}`;
}

/** A short description for search engines and previews. */
export function describe(item: Pick<Entity, 'type' | 'data' | 'id'>, lang: Lang): string {
  const d = item.data as { description?: LocalName; date?: string };
  const parts = [typeName(item.type, lang), labelOf(item, lang)];
  if (d.date) parts.push(dateLabel(d.date, lang));
  const described = nameOf(d.description, lang);
  return described ? `${parts.join(' · ')}. ${described}` : parts.join(' · ');
}
