import { one } from '@rebbehub/db';
import type { EntityId, TextLine } from '@rebbehub/model';
import type { Catalog, ChangesetRow } from './catalog.js';
import { invalid, notFound } from './errors.js';
import type { Json } from './merge.js';

/**
 * A scan's text, page by page (the plan, section 7: "Fix this line"). The
 * machine layer (OCR) is kept as it came; people's fixes go to the scan's
 * community layer, whose page for a PDF page is made on the first fix by
 * copying the machine's lines. What a reader sees is the community page
 * where there is one, else the machine's, and every line nobody has
 * checked is marked as machine reading.
 */

export interface ScanTextPage {
  scan: EntityId;
  page: number;
  /** How many pages the machine read. */
  pages: number;
  /** The page shown: the community one when it exists. */
  pageId: EntityId | null;
  /** Whether what is shown is still the machine's page, untouched by people. */
  machine: boolean;
  engine: { name: string; version: string } | null;
  lines: Array<TextLine & { checked: boolean }>;
}

interface Layer {
  id: EntityId;
  kind: 'machine-ocr' | 'uploaded-ocr' | 'community';
  engine?: { name: string; version: string };
}

async function layersOf(catalog: Catalog, scan: EntityId): Promise<Layer[]> {
  const { rows } = await catalog.db.query<{ id: EntityId; data: { kind: Layer['kind']; engine?: Layer['engine'] } }>(
    `SELECT l.id, lr.data FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
     JOIN revision lr ON lr.id = l.main_rev WHERE x.to_id = $1 AND x.field = 'scan' ORDER BY l.id`,
    [scan],
  );
  return rows.map((r) => ({ id: r.id, kind: r.data.kind, engine: r.data.engine }));
}

async function pageOf(catalog: Catalog, layer: EntityId, page: number): Promise<{ id: EntityId; lines: TextLine[] } | null> {
  const row = await one<{ id: EntityId; lines: TextLine[] }>(
    catalog.db,
    `SELECT p.id, pr.data->'lines' AS lines FROM entity_ref x JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted
     JOIN revision pr ON pr.id = p.main_rev WHERE x.to_id = $1 AND x.field = 'layer' AND (pr.data->>'page')::int = $2 LIMIT 1`,
    [layer, page],
  );
  return row ?? null;
}

async function pageCount(catalog: Catalog, layer: EntityId): Promise<number> {
  const row = await one<{ n: number }>(
    catalog.db,
    `SELECT coalesce(max((pr.data->>'page')::int), 0)::int AS n FROM entity_ref x JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted
     JOIN revision pr ON pr.id = p.main_rev WHERE x.to_id = $1 AND x.field = 'layer'`,
    [layer],
  );
  return row?.n ?? 0;
}

/** One page of a scan's text, as a reader sees it; null when the scan has not been read. */
export async function scanText(catalog: Catalog, scan: EntityId, page: number): Promise<ScanTextPage | null> {
  const layers = await layersOf(catalog, scan);
  const machine = layers.find((l) => l.kind === 'machine-ocr' || l.kind === 'uploaded-ocr');
  if (!machine) return null;
  const community = layers.find((l) => l.kind === 'community');
  const pages = await pageCount(catalog, machine.id);
  const fixed = community ? await pageOf(catalog, community.id, page) : null;
  const read = fixed ?? (await pageOf(catalog, machine.id, page));
  return {
    scan,
    page,
    pages,
    pageId: read?.id ?? null,
    machine: !fixed,
    engine: machine.engine ?? null,
    lines: (read?.lines ?? []).map((l) => ({ ...l, checked: (l.proofread ?? 0) > 0 })),
  };
}

/**
 * "Fix this line": sends a corrected line of a scan's page for review, on
 * the community page (made from the machine's page the first time). The
 * line is marked checked. Returns the suggestion, submitted.
 */
export async function fixLine(catalog: Catalog, by: string, input: { scan: EntityId; page: number; line: string; text: string }): Promise<ChangesetRow> {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 2000) throw invalid('a line of 1 to 2000 characters');
  const layers = await layersOf(catalog, input.scan);
  const machine = layers.find((l) => l.kind === 'machine-ocr' || l.kind === 'uploaded-ocr');
  const community = layers.find((l) => l.kind === 'community');
  if (!machine || !community) throw notFound(`a text of scan ${input.scan}`);
  const existing = await pageOf(catalog, community.id, input.page);
  const source = existing ?? (await pageOf(catalog, machine.id, input.page));
  if (!source) throw notFound(`page ${input.page} of scan ${input.scan}`);
  if (!source.lines.some((l) => l.id === input.line)) throw notFound(`line ${input.line} on page ${input.page}`);
  const lines = source.lines.map((l) => (l.id === input.line ? { ...l, text, proofread: 1 as const } : l));
  const suggestion = await catalog.createChangeset(by, { title: `תיקון שורה, עמוד ${input.page}` });
  await catalog.putRevision(suggestion.id, by, {
    id: existing?.id,
    type: 'text-page',
    // The page counts as checked once every line on it is.
    data: { layer: community.id, page: input.page, lines, proofread: lines.every((l) => (l.proofread ?? 0) > 0) ? 1 : 0 } as unknown as Json,
  });
  return catalog.submit(suggestion.id, by);
}

export interface TranscriptView {
  recording: EntityId;
  text: EntityId;
  language: string;
  /** Its paragraphs in order, each with where it is heard, and whether a person has checked it. */
  paragraphs: Array<{ id: EntityId; content: string; startMs: number | null; endMs: number | null; checked: boolean; by: string | null }>;
}

/** A recording's transcript with its sync, paragraph by paragraph; null when it has none. */
export async function recordingTranscript(catalog: Catalog, recording: EntityId): Promise<TranscriptView | null> {
  const text = await one<{ id: EntityId; language: string }>(
    catalog.db,
    `SELECT t.id, tr.data->>'language' AS language FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted
     JOIN revision tr ON tr.id = t.main_rev WHERE x.to_id = $1 AND x.field = 'recording' AND tr.data->>'kind' = 'transcript' ORDER BY t.id LIMIT 1`,
    [recording],
  );
  if (!text) return null;
  const { rows } = await catalog.db.query<{ id: EntityId; content: string; proofread: number; origin: { by?: string; checked?: boolean } | null; order: string; start_ms: string | null; end_ms: string | null }>(
    `SELECT s.id, sr.data->>'content' AS content, (sr.data->>'proofread')::int AS proofread, sr.data->'origin' AS origin, sr.data->>'order' AS "order",
            (SELECT spr.data->>'startMs' FROM entity_ref y JOIN entity sp ON sp.id = y.from_id AND sp.type = 'alignment-span' AND NOT sp.deleted
              JOIN revision spr ON spr.id = sp.main_rev WHERE y.to_id = s.id AND y.field = 'segment' LIMIT 1) AS start_ms,
            (SELECT spr.data->>'endMs' FROM entity_ref y JOIN entity sp ON sp.id = y.from_id AND sp.type = 'alignment-span' AND NOT sp.deleted
              JOIN revision spr ON spr.id = sp.main_rev WHERE y.to_id = s.id AND y.field = 'segment' LIMIT 1) AS end_ms
     FROM entity_ref x JOIN entity s ON s.id = x.from_id AND s.type = 'segment' AND NOT s.deleted
     JOIN revision sr ON sr.id = s.main_rev WHERE x.to_id = $1 AND x.field = 'text'`,
    [text.id],
  );
  rows.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return {
    recording,
    text: text.id,
    language: text.language,
    paragraphs: rows.map((r) => ({
      id: r.id,
      content: r.content,
      startMs: r.start_ms === null ? null : Number(r.start_ms),
      endMs: r.end_ms === null ? null : Number(r.end_ms),
      checked: r.proofread > 0 || Boolean(r.origin?.checked),
      by: r.origin?.by ?? null,
    })),
  };
}

/** Fixes a paragraph of a transcript as a suggestion: its words as the person heard them, marked checked. */
export async function fixParagraph(catalog: Catalog, by: string, input: { segment: EntityId; content: string }): Promise<ChangesetRow> {
  const content = input.content.replace(/\s+/g, ' ').trim();
  if (!content || content.length > 20_000) throw invalid('a paragraph of 1 to 20,000 characters');
  const segment = await catalog.get(input.segment);
  if (!segment || segment.type !== 'segment') throw notFound(`paragraph ${input.segment}`);
  const data = segment.data as Record<string, unknown> & { origin?: Record<string, unknown> };
  const suggestion = await catalog.createChangeset(by, { title: 'תיקון תמלול' });
  await catalog.putRevision(suggestion.id, by, {
    id: segment.id,
    type: 'segment',
    data: { ...data, content, proofread: 1, ...(data.origin ? { origin: { ...data.origin, checked: true } } : {}) } as Json,
  });
  return catalog.submit(suggestion.id, by);
}
