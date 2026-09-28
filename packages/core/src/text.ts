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
