import { one } from '@rebbehub/db';
import type { EntityId, ProofreadLevel, TextLine } from '@rebbehub/model';
import type { Catalog, ChangesetRow } from './catalog.js';
import { forbidden, invalid, notFound } from './errors.js';
import type { Json } from './merge.js';
import { parseOcr, sniffOcrFormat, type OcrFormat } from './ocrFormats.js';

/**
 * A scan's text, page by page (the plan, section 7: "Fix this line"). OCR
 * layers (the machine's, and any people uploaded) are kept as they came;
 * people's fixes go to the scan's community layer, which is seeded from one
 * of them, the one its keepers pick. The community page for a PDF page is
 * made on the first fix by copying the seed's lines. What a reader sees is
 * the community page where there is one, else the seed's, and every line
 * nobody has checked is marked as machine reading.
 *
 * Pages change colour as they are checked: a page is proofread once when
 * every line on it has been checked by someone, twice when a second person
 * has read it through again.
 */

export interface ScanTextLayer {
  id: EntityId;
  kind: 'machine-ocr' | 'uploaded-ocr' | 'community';
  engine: { name: string; version: string } | null;
  uploadedBy: string | null;
  /** The OCR layer the community text is seeded from. */
  seeds: boolean;
}

export interface ScanTextPage {
  scan: EntityId;
  page: number;
  /** How many pages have text. */
  pages: number;
  /** The page shown: the community one when it exists. */
  pageId: EntityId | null;
  /** Whether what is shown is still an OCR page, untouched by people. */
  machine: boolean;
  /** The engine of the layer the text is seeded from. */
  engine: { name: string; version: string } | null;
  /** How far this page is proofread: 0 not yet, 1 once, 2 twice. */
  level: ProofreadLevel;
  lines: Array<TextLine & { checked: boolean; level: ProofreadLevel }>;
  /** Every text layer of the scan, the seed marked. */
  layers: ScanTextLayer[];
}

interface Layer {
  id: EntityId;
  kind: 'machine-ocr' | 'uploaded-ocr' | 'community';
  engine?: { name: string; version: string };
  seededFrom?: EntityId;
  uploadedBy?: string;
}

async function layersOf(catalog: Catalog, scan: EntityId): Promise<Layer[]> {
  const { rows } = await catalog.db.query<{ id: EntityId; data: Omit<Layer, 'id'> }>(
    `SELECT l.id, lr.data FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
     JOIN revision lr ON lr.id = l.main_rev WHERE x.to_id = $1 AND x.field = 'scan' ORDER BY l.id`,
    [scan],
  );
  return rows.map((r) => ({ id: r.id, kind: r.data.kind, engine: r.data.engine, seededFrom: r.data.seededFrom, uploadedBy: r.data.uploadedBy }));
}

/** The OCR layer the community text is seeded from: the one its keepers picked, else the machine's, else an uploaded one. */
function seedOf(layers: Layer[]): Layer | undefined {
  const community = layers.find((l) => l.kind === 'community');
  const picked = community?.seededFrom ? layers.find((l) => l.id === community.seededFrom && l.kind !== 'community') : undefined;
  return picked ?? layers.find((l) => l.kind === 'machine-ocr') ?? layers.find((l) => l.kind === 'uploaded-ocr');
}

async function pageOf(catalog: Catalog, layer: EntityId, page: number): Promise<{ id: EntityId; lines: TextLine[]; proofread: ProofreadLevel } | null> {
  const row = await one<{ id: EntityId; lines: TextLine[]; proofread: ProofreadLevel | null }>(
    catalog.db,
    `SELECT p.id, pr.data->'lines' AS lines, (pr.data->>'proofread')::int AS proofread FROM entity_ref x JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted
     JOIN revision pr ON pr.id = p.main_rev WHERE x.to_id = $1 AND x.field = 'layer' AND (pr.data->>'page')::int = $2 LIMIT 1`,
    [layer, page],
  );
  return row ? { id: row.id, lines: row.lines, proofread: (row.proofread ?? 0) as ProofreadLevel } : null;
}

/** Each page of a layer that has one, with how far it is proofread. */
async function pagesOf(catalog: Catalog, layer: EntityId): Promise<Map<number, { id: EntityId; proofread: ProofreadLevel }>> {
  const { rows } = await catalog.db.query<{ id: EntityId; page: number; proofread: number | null }>(
    `SELECT p.id, (pr.data->>'page')::int AS page, (pr.data->>'proofread')::int AS proofread FROM entity_ref x JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted
     JOIN revision pr ON pr.id = p.main_rev WHERE x.to_id = $1 AND x.field = 'layer'`,
    [layer],
  );
  return new Map(rows.map((r) => [Number(r.page), { id: r.id, proofread: (r.proofread ?? 0) as ProofreadLevel }]));
}

async function pageCount(catalog: Catalog, layers: EntityId[]): Promise<number> {
  const row = await one<{ n: number }>(
    catalog.db,
    `SELECT coalesce(max((pr.data->>'page')::int), 0)::int AS n FROM entity_ref x JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted
     JOIN revision pr ON pr.id = p.main_rev WHERE x.to_id = ANY($1::text[]) AND x.field = 'layer'`,
    [layers],
  );
  return row?.n ?? 0;
}

const levelOf = (line: TextLine): ProofreadLevel => (line.proofread ?? 0) as ProofreadLevel;

/** A page is proofread as far as its least checked line. */
export function pageLevel(lines: readonly TextLine[]): ProofreadLevel {
  if (!lines.length) return 0;
  return Math.min(...lines.map(levelOf)) as ProofreadLevel;
}

/** One page of a scan's text, as a reader sees it; null when the scan has not been read. */
export async function scanText(catalog: Catalog, scan: EntityId, page: number): Promise<ScanTextPage | null> {
  const layers = await layersOf(catalog, scan);
  const seed = seedOf(layers);
  if (!seed) return null;
  const community = layers.find((l) => l.kind === 'community');
  const pages = await pageCount(catalog, [seed.id, ...(community ? [community.id] : [])]);
  const fixed = community ? await pageOf(catalog, community.id, page) : null;
  const read = fixed ?? (await pageOf(catalog, seed.id, page));
  const lines = read?.lines ?? [];
  return {
    scan,
    page,
    pages,
    pageId: read?.id ?? null,
    machine: !fixed,
    engine: seed.engine ?? null,
    level: fixed ? pageLevel(lines) : 0,
    lines: lines.map((l) => ({ ...l, checked: levelOf(l) > 0, level: levelOf(l) })),
    layers: layers.map((l) => ({ id: l.id, kind: l.kind, engine: l.engine ?? null, uploadedBy: l.uploadedBy ?? null, seeds: l.id === seed.id })),
  };
}

/**
 * How far each page of a scan is proofread, for the page strip on the
 * scan's text and for proofreading projects: `levels[0]` is page 1.
 * Null when the scan has not been read.
 */
export async function scanProgress(catalog: Catalog, scan: EntityId): Promise<{ pages: number; levels: ProofreadLevel[] } | null> {
  const layers = await layersOf(catalog, scan);
  const seed = seedOf(layers);
  if (!seed) return null;
  const community = layers.find((l) => l.kind === 'community');
  const pages = await pageCount(catalog, [seed.id, ...(community ? [community.id] : [])]);
  const fixed = community ? await pagesOf(catalog, community.id) : new Map();
  return { pages, levels: Array.from({ length: pages }, (_, i) => fixed.get(i + 1)?.proofread ?? 0) };
}

function overlaps(a: TextLine['box'], b: TextLine['box']): boolean {
  if (!a || !b) return false;
  const vertical = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const horizontal = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  return vertical > 0.5 * Math.min(a[3], b[3]) && horizontal > 0;
}

/**
 * A page read afresh (a better engine, or the layer keepers picked
 * instead), laid under what people have checked: every line a person
 * checked stays as they left it, and the new reading fills the rest.
 * A new line that stands where a checked line stands is dropped; without
 * positions, the line at the same place in order is. Re-reading never
 * touches a human-checked line.
 */
export function reseedLines(current: readonly TextLine[], fresh: readonly TextLine[]): TextLine[] {
  const kept = current.map((l, i) => ({ line: l, i })).filter(({ line }) => levelOf(line) > 0);
  if (!kept.length) return fresh.map((l) => ({ ...l, proofread: 0 }));
  const positioned = kept.every(({ line }) => line.box) && fresh.every((l) => l.box);
  const taken = new Set(kept.map(({ line }) => line.id));
  const out: Array<{ line: TextLine; at: number }> = kept.map(({ line, i }) => ({ line, at: positioned ? line.box![1] : i }));
  let n = 0;
  for (const [i, line] of fresh.entries()) {
    const replaced = positioned ? kept.some((k) => overlaps(k.line.box, line.box)) : kept.some((k) => k.i === i);
    if (replaced) continue;
    let id = line.id;
    while (taken.has(id)) id = `n${++n}`;
    taken.add(id);
    // The checked line wins a tie in order.
    out.push({ line: { ...line, id, proofread: 0 }, at: (positioned ? line.box![1] : i) + 1e-6 });
  }
  return out.sort((a, b) => a.at - b.at).map((o) => o.line);
}

/**
 * "Fix this line": sends a corrected line of a scan's page for review, on
 * the community page (made from the seed's page the first time). The line
 * is marked checked. Returns the suggestion, submitted.
 */
export async function fixLine(catalog: Catalog, by: string, input: { scan: EntityId; page: number; line: string; text: string }): Promise<ChangesetRow> {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 2000) throw invalid('a line of 1 to 2000 characters');
  const { community, existing, source } = await communityPage(catalog, input.scan, input.page);
  const line = source.lines.find((l) => l.id === input.line);
  if (!line) throw notFound(`line ${input.line} on page ${input.page}`);
  const lines = source.lines.map((l) => (l.id === input.line ? { ...l, text, proofread: Math.max(1, levelOf(l)) as ProofreadLevel } : l));
  const suggestion = await catalog.createChangeset(by, { title: `תיקון שורה, עמוד ${input.page}` });
  await catalog.putRevision(suggestion.id, by, {
    id: existing?.id,
    type: 'text-page',
    data: { layer: community.id, page: input.page, lines, proofread: pageLevel(lines) } as unknown as Json,
  });
  return catalog.submit(suggestion.id, by);
}

async function communityPage(catalog: Catalog, scan: EntityId, page: number) {
  const layers = await layersOf(catalog, scan);
  const seed = seedOf(layers);
  const community = layers.find((l) => l.kind === 'community');
  if (!seed || !community) throw notFound(`a text of scan ${scan}`);
  const existing = await pageOf(catalog, community.id, page);
  const source = existing ?? (await pageOf(catalog, seed.id, page));
  if (!source) throw notFound(`page ${page} of scan ${scan}`);
  return { community, existing, source };
}

/**
 * "This page is right": a reader who has read a page through against the
 * scan raises it a level (unchecked to proofread once, once to twice),
 * with any lines they fixed on the way. The second reading is someone
 * else's: whoever first brought the page to proofread-once cannot also
 * make it proofread-twice.
 */
export async function confirmPage(catalog: Catalog, by: string, input: { scan: EntityId; page: number; fixes?: Record<string, string> }): Promise<ChangesetRow> {
  const { community, existing, source } = await communityPage(catalog, input.scan, input.page);
  const from = existing ? pageLevel(existing.lines) : 0;
  if (from >= 2) throw invalid('this page is already proofread twice');
  const to = (from + 1) as ProofreadLevel;
  if (to === 2 && existing) {
    const first = await one<{ author: string }>(
      catalog.db,
      `SELECT r.author FROM commit_change cc JOIN revision r ON r.id = cc.rev_id
       WHERE cc.entity_id = $1 AND (r.data->>'proofread')::int >= 1 ORDER BY cc.commit_seq LIMIT 1`,
      [existing.id],
    );
    if (first?.author === by) throw forbidden('a page is proofread the second time by someone else');
  }
  const fixes = input.fixes ?? {};
  for (const [id, text] of Object.entries(fixes)) {
    if (!source.lines.some((l) => l.id === id)) throw notFound(`line ${id} on page ${input.page}`);
    if (!text.trim() || text.length > 2000) throw invalid('a line of 1 to 2000 characters');
  }
  const lines = source.lines.map((l) => ({
    ...l,
    ...(fixes[l.id] !== undefined ? { text: fixes[l.id]!.replace(/\s+/g, ' ').trim() } : {}),
    proofread: Math.max(to, levelOf(l)) as ProofreadLevel,
  }));
  const suggestion = await catalog.createChangeset(by, { title: `הגהה ${to === 1 ? 'ראשונה' : 'שניה'}, עמוד ${input.page}` });
  await catalog.putRevision(suggestion.id, by, {
    id: existing?.id,
    type: 'text-page',
    data: { layer: community.id, page: input.page, lines, proofread: pageLevel(lines) } as unknown as Json,
  });
  return catalog.submit(suggestion.id, by);
}

/** The most an upload may hold: pages, and characters in all. */
export const OCR_UPLOAD_LIMITS = { pages: 3000, chars: 20_000_000 };

/**
 * Someone's own OCR of a scan (hOCR, ALTO or plain text; the plan,
 * section 7): a new `uploaded-ocr` layer with the engine and version they
 * name, page by page from `firstPage`, sent for review like any
 * suggestion. It never changes the community text by itself; a keeper
 * picks it to seed the community text (chooseSeed). A scan with no text
 * yet gets its community layer with it, seeded from it.
 */
export async function uploadOcr(
  catalog: Catalog,
  by: string,
  input: { scan: EntityId; content: string; format?: OcrFormat; engine: { name: string; version: string }; firstPage?: number; language?: string },
): Promise<ChangesetRow & { pages: number; lines: number }> {
  const scan = await catalog.get(input.scan);
  if (!scan || scan.type !== 'scan') throw notFound(`scan ${input.scan}`);
  if (input.content.length > OCR_UPLOAD_LIMITS.chars) throw invalid(`an upload of up to ${OCR_UPLOAD_LIMITS.chars.toLocaleString('en')} characters`);
  const name = input.engine.name?.trim().slice(0, 80);
  const version = input.engine.version?.trim().slice(0, 40);
  if (!name || !version) throw invalid("name the OCR program and its version, so the layer says what read it");
  const firstPage = input.firstPage ?? 1;
  if (!Number.isInteger(firstPage) || firstPage < 1) throw invalid('firstPage is a page number, from 1');
  const format = input.format ?? sniffOcrFormat(input.content);
  const pages = parseOcr(format, input.content);
  if (!pages.length || pages.every((p) => !p.lines.length)) throw invalid(`no text found in this ${format === 'text' ? 'text' : format.toUpperCase()}`);
  if (pages.length > OCR_UPLOAD_LIMITS.pages) throw invalid(`up to ${OCR_UPLOAD_LIMITS.pages} pages at a time`);
  const layers = await layersOf(catalog, input.scan);
  const language = input.language ?? 'he';
  const suggestion = await catalog.createChangeset(by, { title: `OCR שהועלה: ${name} ${version}` });
  const layer = await catalog.putRevision(suggestion.id, by, {
    type: 'text-layer',
    data: { scan: input.scan, kind: 'uploaded-ocr', engine: { name, version }, uploadedBy: by, language } as Json,
  });
  if (!layers.some((l) => l.kind === 'community')) {
    await catalog.putRevision(suggestion.id, by, { type: 'text-layer', data: { scan: input.scan, kind: 'community', seededFrom: layer, language } as Json });
  }
  let lines = 0;
  for (const [i, page] of pages.entries()) {
    if (!page.lines.length) continue;
    lines += page.lines.length;
    await catalog.putRevision(suggestion.id, by, { type: 'text-page', data: { layer, page: firstPage + i, lines: page.lines, proofread: 0 } as unknown as Json });
  }
  const submitted = await catalog.submit(suggestion.id, by);
  return { ...submitted, pages: pages.length, lines };
}

/** Whether `by` keeps one of the scan's sets, or is a steward. */
async function keepsScan(catalog: Catalog, by: string, scan: EntityId): Promise<boolean> {
  const account = await catalog.account(by);
  if (!account) return false;
  if (account.is_steward) return true;
  const entity = await catalog.get(scan);
  if (!entity) return false;
  const sets = await catalog.setsOf(catalog.db, 'scan', entity.data);
  return sets.some((s) => s.keepers.includes(by));
}

/**
 * Keepers pick which OCR layer seeds the community text (the plan,
 * section 7). Pages people have already worked on keep every line they
 * checked and take the rest from the new seed (reseedLines); pages nobody
 * touched simply show the new seed. A suggestion, reviewed by another
 * keeper; a steward's goes straight in.
 */
export async function chooseSeed(catalog: Catalog, by: string, input: { scan: EntityId; layer: EntityId }): Promise<ChangesetRow> {
  if (!(await keepsScan(catalog, by, input.scan))) throw forbidden("the scan's keepers pick which text seeds its community text");
  const layers = await layersOf(catalog, input.scan);
  const chosen = layers.find((l) => l.id === input.layer);
  if (!chosen || chosen.kind === 'community') throw notFound(`an OCR layer ${input.layer} of scan ${input.scan}`);
  const community = layers.find((l) => l.kind === 'community');
  const suggestion = await catalog.createChangeset(by, { title: `הטקסט הקהילתי מתוך ${chosen.engine?.name ?? chosen.id}` });
  if (!community) {
    await catalog.putRevision(suggestion.id, by, { type: 'text-layer', data: { scan: input.scan, kind: 'community', seededFrom: chosen.id, language: 'he' } as Json });
  } else {
    if (seedOf(layers)?.id === chosen.id) throw invalid('the community text is already seeded from that layer');
    const current = await catalog.get(community.id);
    await catalog.putRevision(suggestion.id, by, { id: community.id, type: 'text-layer', data: { ...(current!.data as Record<string, Json>), seededFrom: chosen.id } });
    for (const [page, { id }] of await pagesOf(catalog, community.id)) {
      const [now, fresh] = await Promise.all([pageOf(catalog, community.id, page), pageOf(catalog, chosen.id, page)]);
      if (!now || !fresh) continue;
      const lines = reseedLines(now.lines, fresh.lines);
      await catalog.putRevision(suggestion.id, by, { id, type: 'text-page', data: { layer: community.id, page, lines, proofread: pageLevel(lines) } as unknown as Json });
    }
  }
  const submitted = await catalog.submit(suggestion.id, by);
  const account = await catalog.account(by);
  if (account?.is_steward && submitted.status === 'open') await catalog.merge(suggestion.id, by, {}, 'Seed chosen by a steward');
  return catalog.changeset(suggestion.id);
}
