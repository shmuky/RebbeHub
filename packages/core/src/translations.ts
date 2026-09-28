import { LANGUAGES, orderKeys, type EntityId, type Language, type Licence } from '@rebbehub/model';
import type { Catalog, ChangesetRow } from './catalog.js';
import { invalid, notFound } from './errors.js';
import type { Json } from './merge.js';

/**
 * Translations (the plan, section 12, phase 6): a unit's words in another
 * language, as a text of their own (`kind: 'translation'`) beside the
 * original, with its language, who made it (credit) and its rights
 * (licence). The site shows them with a language switcher.
 *
 * A translation comes in as a Suggestion, like any other text: its
 * paragraphs become segments with permanent ids, reviewed and merged by
 * the set's keepers, and fixed later paragraph by paragraph. A
 * translation a machine made is labelled so, paragraph by paragraph,
 * until a person has checked each one (`origin`).
 */

/**
 * The rights a translation may be added with: the translator's own work
 * (no licence: community text, CC BY-SA like every correction), or a
 * published translation whose licence lets RebbeHub keep and serve a copy.
 * Anything else (a publisher's all-rights-reserved translation, a site's
 * terms) is not pasted in at all; it is linked as a copy elsewhere.
 */
export const TRANSLATION_LICENCES: readonly Licence[] = ['public-domain', 'cc0', 'cc-by', 'cc-by-nc'];

/** At most this many paragraphs are added in one suggestion. */
export const MAX_TRANSLATION_PARAGRAPHS = 400;

export interface NewTranslation {
  unit: EntityId;
  language: string;
  /** Who translated it, as it should be credited: `Translated by Rabbi Eliyahu Touger`, `Sefaria community translation`. */
  credit: string;
  /** Unset for the translator's own work (community text). */
  licence?: string;
  /** The text it translates, when the unit has more than one. */
  translationOf?: EntityId;
  /** The whole translation; a blank line between paragraphs. */
  content: string;
  /** Made by a machine (the engine or tool, e.g. `mt:google-translate`): labelled until each paragraph is checked. */
  machine?: string;
}

/** Paragraphs of pasted text: split at blank lines, spaces tidied, empties dropped. */
export function paragraphsOf(content: string): string[] {
  return content
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, ' ').trim())
    .filter(Boolean);
}

/** Sends a new translation of a unit for review. Returns the suggestion, submitted. */
export async function addTranslation(catalog: Catalog, by: string, input: NewTranslation): Promise<ChangesetRow> {
  if (!(LANGUAGES as readonly string[]).includes(input.language)) throw invalid(`a translation's language is one of ${LANGUAGES.join(', ')}`);
  const credit = (input.credit ?? '').replace(/\s+/g, ' ').trim();
  if (!credit || credit.length > 300) throw invalid('say who translated it (credit), in up to 300 characters');
  if (input.licence !== undefined && !TRANSLATION_LICENCES.includes(input.licence as Licence)) {
    throw invalid(`a translation is the translator's own (no licence) or one of ${TRANSLATION_LICENCES.join(', ')}; others are linked, not copied (docs/rights.md)`);
  }
  if (input.machine !== undefined && !/^[\w:.@-]{1,100}$/.test(input.machine)) throw invalid('name the machine translation tool in letters, digits and : . @ -');
  const paragraphs = paragraphsOf(input.content ?? '');
  if (paragraphs.length === 0) throw invalid('a translation needs its words');
  if (paragraphs.length > MAX_TRANSLATION_PARAGRAPHS) throw invalid(`up to ${MAX_TRANSLATION_PARAGRAPHS} paragraphs in one suggestion`);
  if (paragraphs.some((p) => p.length > 20_000)) throw invalid('a paragraph is at most 20,000 characters');

  const unit = await catalog.get(input.unit);
  if (!unit || unit.type !== 'unit') throw notFound(`unit ${input.unit}`);
  if (input.translationOf) {
    const original = await catalog.get(input.translationOf);
    if (!original || original.type !== 'text' || (original.data as { unit?: string }).unit !== unit.id) throw notFound(`a text of this unit ${input.translationOf}`);
  }

  const language = input.language as Language;
  const suggestion = await catalog.createChangeset(by, { title: `תרגום (${language})`, description: `${language} translation: ${credit}` });
  const text = await catalog.putRevision(suggestion.id, by, {
    type: 'text',
    data: {
      kind: 'translation',
      unit: unit.id,
      language,
      ...(input.translationOf ? { translationOf: input.translationOf } : {}),
      ...(input.licence ? { licence: input.licence } : {}),
      credit,
    } as Json,
  });
  const orders = orderKeys(paragraphs.length);
  for (const [i, content] of paragraphs.entries()) {
    await catalog.putRevision(suggestion.id, by, {
      type: 'segment',
      data: { text, order: orders[i]!, kind: 'paragraph', content, proofread: 0, ...(input.machine ? { origin: { by: input.machine, checked: false } } : {}) } as Json,
    });
  }
  return catalog.submit(suggestion.id, by);
}

/**
 * Fixes one paragraph of a unit's translation as a Suggestion: the words as
 * the person would have them, marked checked (a machine paragraph so fixed
 * is no longer labelled). Only translations are fixed here; a scan's text
 * has "Fix this line", a transcript its own fix.
 */
export async function fixTranslation(catalog: Catalog, by: string, input: { segment: EntityId; content: string }): Promise<ChangesetRow> {
  const content = (input.content ?? '').replace(/\s+/g, ' ').trim();
  if (!content || content.length > 20_000) throw invalid('a paragraph of 1 to 20,000 characters');
  const segment = await catalog.get(input.segment);
  if (!segment || segment.type !== 'segment') throw notFound(`paragraph ${input.segment}`);
  const data = segment.data as Record<string, unknown> & { text: EntityId; origin?: Record<string, unknown> };
  const text = await catalog.get(data.text);
  if (!text || (text.data as { kind?: string }).kind !== 'translation') throw notFound(`a paragraph of a translation ${input.segment}`);
  const suggestion = await catalog.createChangeset(by, { title: `תיקון תרגום (${(text.data as { language: string }).language})` });
  await catalog.putRevision(suggestion.id, by, {
    id: segment.id,
    type: 'segment',
    data: { ...data, content, proofread: 1, ...(data.origin ? { origin: { ...data.origin, checked: true } } : {}) } as Json,
  });
  return catalog.submit(suggestion.id, by);
}
