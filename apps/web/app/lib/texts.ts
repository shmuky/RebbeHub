import type { Entity } from './api.js';

/**
 * Which of a unit's texts to show (components/Translations.tsx): the one
 * whose language the address names (`?tl=en`), else the first original
 * (not a translation), else whatever there is.
 */
export function chooseText(texts: Entity[], asked: string | null): Entity | undefined {
  const kind = (x: Entity) => (x.data as { kind?: string }).kind;
  const originals = texts.filter((x) => kind(x) !== 'translation');
  return texts.find((x) => (x.data as { language?: string }).language === asked) ?? originals[0] ?? texts[0];
}
