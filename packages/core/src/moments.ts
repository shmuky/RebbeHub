import { normalizeSearchText } from '@rebbehub/hebrew';
import type { EntityId, TextLine } from '@rebbehub/model';
import type { Catalog, EntityView } from './catalog.js';
import { ExportGate } from './gate.js';
import { toTsQuery } from './searchText.js';

/**
 * Search that lands on the moment (the plan, section 9: "hits open the
 * scan at the highlighted line, or the recording at the spoken moment").
 * The built-in search finds the pages of scans and the paragraphs of
 * texts whose words match; each is turned into the place a reader should
 * open: the line on a scan's page, or the paragraph of a recording's
 * transcript with the time it is heard. What a machine read or heard and
 * nobody has checked says so. Words whose rights forbid copies are left
 * out, as everywhere else.
 */

/** A found line on a scan's page: open `/text/<scan>?page=<page>` at `line`. */
export interface ScanLineMoment {
  kind: 'scan-line';
  /** The text page found (community or machine). */
  id: EntityId;
  scan: EntityId;
  publication: EntityId | null;
  page: number;
  line: { id: string; text: string };
  /** The words of the line that match, as written there, to mark. */
  hits: string[];
  /** Still as the machine read it: nobody has checked this line. */
  machine: boolean;
}

/** A found paragraph of a text: a transcript's, with where it is heard, or a unit's. */
export interface ParagraphMoment {
  kind: 'paragraph';
  /** The segment found. */
  id: EntityId;
  text: EntityId;
  textKind: string;
  unit: EntityId | null;
  recording: EntityId | null;
  event: EntityId | null;
  /** Where in the recording it is heard, when the transcript is synced. */
  startMs: number | null;
  /** The words around the match. */
  snippet: string;
  hits: string[];
  machine: boolean;
}

export type Moment = ScanLineMoment | ParagraphMoment;

/** The query's words as the index holds them. */
export function queryWords(query: string): string[] {
  return normalizeSearchText(query)
    .split(' ')
    .filter((w) => w.length > 0)
    .slice(0, 12);
}

/** The words of `text` (as written) that match the query's words, each as a prefix, as the search does. */
export function matchingWords(text: string, words: readonly string[]): string[] {
  if (words.length === 0) return [];
  return text.split(/\s+/).filter((token) => {
    const norm = normalizeSearchText(token);
    return norm.length > 0 && norm.split(' ').some((part) => words.some((w) => part.startsWith(w)));
  });
}

/** The line of a page that answers the query best: the one with most of its words; the first such. */
export function bestLine<T extends { text: string }>(lines: readonly T[], words: readonly string[]): { line: T; hits: string[] } | null {
  let best: { line: T; hits: string[]; score: number } | null = null;
  for (const line of lines) {
    const hits = matchingWords(line.text, words);
    const found = new Set(words.filter((w) => hits.some((h) => normalizeSearchText(h).split(' ').some((p) => p.startsWith(w)))));
    if (found.size > 0 && (!best || found.size > best.score)) best = { line, hits, score: found.size };
  }
  return best ? { line: best.line, hits: best.hits } : null;
}

/** About `size` words of `content` around its first match, with an ellipsis where it was cut. */
export function snippetOf(content: string, words: readonly string[], size = 40): string {
  const tokens = content.split(/\s+/).filter(Boolean);
  if (tokens.length <= size) return tokens.join(' ');
  const first = tokens.findIndex((t) => matchingWords(t, words).length > 0);
  const start = Math.max(0, (first < 0 ? 0 : first) - Math.floor(size / 3));
  const end = Math.min(tokens.length, start + size);
  return `${start > 0 ? '… ' : ''}${tokens.slice(start, end).join(' ')}${end < tokens.length ? ' …' : ''}`;
}

interface PageRow {
  id: EntityId;
  layer: EntityId;
  page: number;
  lines: Array<TextLine>;
  layer_kind: string;
  scan: EntityId;
  publication: EntityId | null;
}

interface SegmentRow {
  id: EntityId;
  text: EntityId;
  content: string;
  proofread: number;
  checked: boolean | null;
  text_kind: string;
  unit: EntityId | null;
  recording: EntityId | null;
  event: EntityId | null;
  start_ms: string | null;
}

/** The moment an item found by search stands for, or null when it is not a page of a scan or a paragraph (or its words are withheld). */
export async function momentOf(catalog: Catalog, view: EntityView, words: readonly string[], gate = new ExportGate(catalog)): Promise<Moment | null> {
  if (view.type === 'text-page') {
    const [row] = await pageRows(catalog, [view.id]);
    return row ? pageMoment(row, words, gate) : null;
  }
  if (view.type === 'segment') {
    const [row] = await segmentRows(catalog, [view.id]);
    return row ? segmentMoment(row, words, gate) : null;
  }
  return null;
}

async function pageRows(catalog: Catalog, ids: readonly EntityId[]): Promise<PageRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await catalog.db.query<PageRow>(
    `SELECT p.id, pr.data->>'layer' AS layer, (pr.data->>'page')::int AS page, pr.data->'lines' AS lines,
            lr.data->>'kind' AS layer_kind, lr.data->>'scan' AS scan, sr.data->>'publication' AS publication
     FROM entity p JOIN revision pr ON pr.id = p.main_rev
     JOIN entity l ON l.id = pr.data->>'layer' JOIN revision lr ON lr.id = l.main_rev
     LEFT JOIN entity s ON s.id = lr.data->>'scan' LEFT JOIN revision sr ON sr.id = s.main_rev
     WHERE p.id = ANY($1::text[]) AND p.type = 'text-page' AND NOT p.deleted`,
    [ids],
  );
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

async function segmentRows(catalog: Catalog, ids: readonly EntityId[]): Promise<SegmentRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await catalog.db.query<SegmentRow>(
    `SELECT s.id, sr.data->>'text' AS text, sr.data->>'content' AS content, coalesce((sr.data->>'proofread')::int, 0) AS proofread,
            (sr.data->'origin'->>'checked')::boolean AS checked, tr.data->>'kind' AS text_kind,
            tr.data->>'unit' AS unit, tr.data->>'recording' AS recording, rr.data->>'event' AS event,
            (SELECT spr.data->>'startMs' FROM entity_ref y JOIN entity sp ON sp.id = y.from_id AND sp.type = 'alignment-span' AND NOT sp.deleted
               JOIN revision spr ON spr.id = sp.main_rev WHERE y.to_id = s.id AND y.field = 'segment' LIMIT 1) AS start_ms
     FROM entity s JOIN revision sr ON sr.id = s.main_rev
     JOIN entity t ON t.id = sr.data->>'text' JOIN revision tr ON tr.id = t.main_rev
     LEFT JOIN entity r ON r.id = tr.data->>'recording' LEFT JOIN revision rr ON rr.id = r.main_rev
     WHERE s.id = ANY($1::text[]) AND s.type = 'segment' AND NOT s.deleted`,
    [ids],
  );
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

async function pageMoment(row: PageRow, words: readonly string[], gate: ExportGate): Promise<ScanLineMoment | null> {
  if (await gate.layerWithheld(row.layer)) return null;
  const lines = row.lines ?? [];
  const best = bestLine(lines, words) ?? (lines[0] ? { line: lines[0], hits: [] } : null);
  if (!best) return null;
  return {
    kind: 'scan-line',
    id: row.id,
    scan: row.scan,
    publication: row.publication,
    page: row.page,
    line: { id: best.line.id, text: best.line.text },
    hits: best.hits,
    machine: row.layer_kind !== 'community' || (best.line.proofread ?? 0) === 0,
  };
}

async function segmentMoment(row: SegmentRow, words: readonly string[], gate: ExportGate): Promise<ParagraphMoment | null> {
  if (await gate.textWithheld(row.text)) return null;
  return {
    kind: 'paragraph',
    id: row.id,
    text: row.text,
    textKind: row.text_kind,
    unit: row.unit,
    recording: row.recording,
    event: row.event,
    startMs: row.start_ms === null ? null : Number(row.start_ms),
    snippet: snippetOf(row.content ?? '', words),
    hits: matchingWords(row.content ?? '', words),
    machine: row.proofread === 0 && !row.checked,
  };
}

/**
 * The places in scans and texts where the query's words are: lines on
 * scans' pages and paragraphs of texts and transcripts, best first.
 */
export async function searchMoments(catalog: Catalog, query: string, options: { limit?: number } = {}): Promise<Moment[]> {
  const tsQuery = toTsQuery(query);
  if (!tsQuery) return [];
  const words = queryWords(query);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const { rows } = await catalog.db.query<{ id: EntityId; type: 'text-page' | 'segment' }>(
    `SELECT e.id, e.type FROM entity e
     WHERE e.type IN ('text-page', 'segment') AND NOT e.deleted AND e.main_rev IS NOT NULL
       AND to_tsvector('simple', coalesce(e.search_text, '')) @@ to_tsquery('simple', $1)
     ORDER BY ts_rank(to_tsvector('simple', coalesce(e.search_text, '')), to_tsquery('simple', $1)) DESC, e.id
     LIMIT ${limit * 2}`,
    [tsQuery],
  );
  const gate = new ExportGate(catalog);
  const pages = new Map((await pageRows(catalog, rows.filter((r) => r.type === 'text-page').map((r) => r.id))).map((r) => [r.id, r]));
  const segments = new Map((await segmentRows(catalog, rows.filter((r) => r.type === 'segment').map((r) => r.id))).map((r) => [r.id, r]));
  // A scan read by the machine and fixed by people has two pages for one page of print: the people's is shown.
  const seenPage = new Set<string>();
  const out: Moment[] = [];
  const communityFirst = [...pages.values()].sort((a, b) => Number(b.layer_kind === 'community') - Number(a.layer_kind === 'community'));
  const shownPage = new Map<string, EntityId>();
  for (const p of communityFirst) {
    const key = `${p.scan}:${p.page}`;
    if (!shownPage.has(key)) shownPage.set(key, p.id);
  }
  for (const r of rows) {
    if (out.length >= limit) break;
    if (r.type === 'text-page') {
      const row = pages.get(r.id);
      if (!row) continue;
      const key = `${row.scan}:${row.page}`;
      if (seenPage.has(key) || shownPage.get(key) !== row.id) continue;
      seenPage.add(key);
      const moment = await pageMoment(row, words, gate);
      if (moment) out.push(moment);
    } else {
      const row = segments.get(r.id);
      const moment = row ? await segmentMoment(row, words, gate) : null;
      if (moment) out.push(moment);
    }
  }
  return out;
}
