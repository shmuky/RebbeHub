import {
  changeSegment,
  findSegment,
  inlineText,
  isEntityId,
  isPageText,
  LANGUAGES,
  mayExport,
  newSegmentId,
  tidyInline,
  type EntityId,
  type Language,
  type PageInline,
  type PageSegment,
  type PageSegmentKind,
  type PageText,
  type RightsState,
} from '@rebbehub/model';
import type { Catalog, ChangesetRow } from './catalog.js';
import { CatalogError, badState, forbidden, invalid, notFound } from './errors.js';
import { withStructuredBody } from './legacyWords.js';
import type { Json } from './merge.js';

/**
 * Fixing a page's words segment by segment: a person opens one segment,
 * changes its words in place, and the change goes for review as a
 * Suggestion of its own, like a fixed line of a scan. Only that segment
 * changes, so two people fixing different segments of one page never
 * clash, and the reviewer sees just the segment before and after.
 *
 *   edit    a segment's new words
 *   add     a new segment after this one (a paragraph, heading, verse or item)
 *   remove  this segment
 *   start   the first words of a page that has none
 *   check   a machine's segment is right as it is (read against its scan): it stays, checked
 */
export type WordsChange = 'edit' | 'add' | 'remove' | 'start' | 'check';

export interface WordsInput {
  entity: EntityId;
  change: WordsChange;
  /** The version (`he`, `en`) and segment it is in; not for `start`. */
  version?: string;
  segment?: string;
  /** The segment's new words (edit, add, start). */
  text?: PageInline[];
  /** What the segment's words were when the person opened it, so a change made since is never overwritten. */
  before?: PageInline[];
  /** A new segment's kind (add). */
  kind?: PageSegmentKind;
  /** The language of a page's first words (start). */
  language?: Language;
  title?: string;
  note?: string;
}

const ADDABLE = new Set<PageSegmentKind>(['paragraph', 'heading', 'verse', 'item']);
const MAX_SEGMENT_CHARS = 50_000;

function words(text: PageInline[] | undefined): PageInline[] {
  if (!Array.isArray(text)) throw invalid('give the words as a list of runs');
  const runs = tidyInline(text);
  // Printed line ends alone are not words.
  if (!runs.some((run) => !('eol' in run))) throw invalid('a segment needs words; to take it out, remove it');
  if (inlineText(runs).length > MAX_SEGMENT_CHARS) throw invalid(`a segment of up to ${MAX_SEGMENT_CHARS.toLocaleString('en')} characters`);
  return runs;
}

const sameWords = (a: PageInline[] | undefined, b: PageInline[] | undefined) => JSON.stringify(tidyInline(a ?? [])) === JSON.stringify(tidyInline(b ?? []));

/** Sends one segment's change for review. Returns the suggestion (merged at once when its author's changes go live there). */
export async function suggestWords(catalog: Catalog, by: string, input: WordsInput): Promise<ChangesetRow> {
  if (!isEntityId(input.entity)) throw invalid('say which item these words are on');
  const entity = await catalog.get(input.entity);
  if (!entity) throw notFound(`item ${input.entity}`);
  const data = withStructuredBody(entity.data as Record<string, unknown>);
  const source = data.bodySource as { rights?: RightsState } | undefined;
  // Words whose source forbids copies are not shown, so nobody edits them either.
  if (source?.rights && !mayExport(source.rights)) throw forbidden("its source's terms do not allow copies of these words");

  let page: PageText;
  if (input.change === 'start') {
    if (isPageText(data.body) && data.body.versions.some((v) => v.segments.length)) throw badState('this page already has words; fix them segment by segment');
    const language = input.language && (LANGUAGES as readonly string[]).includes(input.language) ? input.language : 'he';
    page = { profile: 'plain', versions: [{ id: language, language, segments: [{ id: 'p1', kind: 'paragraph', text: words(input.text) }] }] };
  } else {
    if (!isPageText(data.body)) throw notFound('words on this page');
    const version = data.body.versions.find((v) => v.id === input.version);
    if (!version) throw notFound(`version "${input.version}" of this page`);
    const found = input.segment ? findSegment(version, input.segment) : null;
    if (!found) throw notFound(`segment "${input.segment}"`);
    if (input.before !== undefined && !sameWords(input.before, found.segment.text)) {
      throw new CatalogError('conflict', 'this segment has changed since you opened it; open it again to see it as it is now');
    }
    try {
      if (input.change === 'edit') {
        const text = words(input.text);
        if (sameWords(text, found.segment.text)) throw badState('the words are the same as they are now');
        page = changeSegment(data.body, version.id, found.segment.id, { text });
      } else if (input.change === 'add') {
        const kind = input.kind && ADDABLE.has(input.kind) ? input.kind : found.segment.kind === 'section' || found.segment.kind === 'note' ? 'paragraph' : found.segment.kind;
        const segment: PageSegment = { id: newSegmentId(version), kind, ...(kind === 'heading' ? { level: 2 as const } : {}), text: words(input.text) };
        page = changeSegment(data.body, version.id, found.segment.id, { after: segment });
      } else if (input.change === 'remove') {
        page = changeSegment(data.body, version.id, found.segment.id, { remove: true });
      } else if (input.change === 'check') {
        if (!found.segment.origin) throw badState('a person wrote this segment; there is nothing to check');
        if (found.segment.origin.checked) throw badState('this segment is checked already');
        page = changeSegment(data.body, version.id, found.segment.id, { check: true });
      } else throw invalid('the change is edit, add, remove, start or check');
    } catch (error) {
      if (error instanceof RangeError) throw notFound(error.message);
      throw error;
    }
  }

  const title = (input.title ?? '').trim().slice(0, 200) || 'A fix to the words';
  const suggestion = await catalog.createChangeset(by, { title, description: input.note?.trim().slice(0, 2000) || undefined });
  await catalog.putRevision(suggestion.id, by, { id: entity.id, type: entity.type, data: { ...data, body: page } as unknown as Json });
  return catalog.submit(suggestion.id, by);
}

/**
 * Turns every page body still kept as a string (from before words had
 * structure) into structured words, as system changes of `batch` pages
 * each, so a large catalog is done in steps and can be stopped and run
 * again: each run takes up only what is left. Returns how many pages it
 * changed.
 */
export async function convertLegacyBodies(catalog: Catalog, options: { batch?: number; log?: (line: string) => void } = {}): Promise<number> {
  const batch = Math.min(Math.max(options.batch ?? 500, 1), 5000);
  const log = options.log ?? (() => {});
  let done = 0;
  for (;;) {
    const { rows } = await catalog.db.query<{ id: EntityId; type: string; data: Record<string, unknown> }>(
      // Versions with a string body (migration 0015 indexes them) that are what main holds now.
      `SELECT e.id, e.type, r.data FROM revision r JOIN entity e ON e.main_rev = r.id
       WHERE jsonb_typeof(r.data->'body') = 'string' AND NOT e.deleted ORDER BY e.id LIMIT ${batch}`,
    );
    if (!rows.length) break;
    const cs = await catalog.createChangeset('system', { title: `Page words as structure (${done + 1}-${done + rows.length})`, kind: 'import' });
    for (const row of rows) {
      await catalog.putRevision(cs.id, 'system', { id: row.id, type: row.type as never, data: withStructuredBody(row.data) as unknown as Json });
    }
    await catalog.submit(cs.id, 'system');
    await catalog.merge(cs.id, 'system');
    done += rows.length;
    log(`${done} pages' words now structured`);
  }
  return done;
}
