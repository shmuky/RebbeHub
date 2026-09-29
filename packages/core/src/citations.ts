import { one } from '@rebbehub/db';
import { parseDateText, parseHebrewNumeral, type DateKey } from '@rebbehub/hebrew';
import { pageTextPlain, type EntityId, type RelationData, type RelationKind } from '@rebbehub/model';
import type { Catalog, RevisionRow } from './catalog.js';
import type { Json } from './merge.js';
import { withStructuredBody } from './legacyWords.js';

/**
 * Cross-linking (the plan, section 9: "detect citations in text ('ראה
 * לקו"ש חי"ב') and propose Relations, so each page shows 'Printed in…',
 * 'Based on this farbrengen', 'Cited by…'"). A machine reads the texts,
 * the pages of scans and the pages of sichos and farbrengens for the ways
 * sefarim are cited, finds what each citation points at in the catalog,
 * and proposes each link as a Relation in a Suggestion by the citations
 * bot. A keeper approves or sends it back like any other; a link sent
 * back is never proposed again. Until a person checks it, a link says it
 * was found by machine.
 */

export const CITATIONS_BOT = 'bot:citations';
const PASS = 'citations';
const ENGINE = 'citations@1';

/** What a citation points at: a place in a sefer, or the farbrengen of a day. */
export type CitationTarget = { work: string; volume?: number; page?: number; letter?: number } | { date: DateKey };

export interface Citation {
  kind: Extract<RelationKind, 'cites' | 'based-on' | 'printed-in'>;
  /** The citation as written. */
  text: string;
  index: number;
  target: CitationTarget;
}

const Q = '["״]';
const G = "['׳]";
const NUM = `(?:[א-ת]{1,4}(?:${Q}[א-ת]|${G})?|\\d{1,4})`;

/** The sefarim cited by name and volume, by their Sichos-Kodesh ids. */
const WORKS: Array<{ work: string; name: string; others?: { work: string; name: string } }> = [
  { work: 'likkutei-sichos', name: `(?:לקו${Q}ש|לקוטי[\\s-]שיחות|ליקוטי[\\s-]שיחות)` },
  // The Rebbe's letters, unless the Frierdiker Rebbe's are named.
  {
    work: 'igros-kodesh-rebbe',
    name: `(?:אג${Q}ק|אגרות[\\s-]קודש)`,
    others: { work: 'igros-kodesh-frierdiker-rebbe', name: `\\s+(?:אדמו${Q}ר\\s+)?(?:מהוריי${Q}צ|מוהריי${Q}צ|הריי${Q}צ|מהריי${Q}צ)` },
  },
  { work: 'toras-menachem', name: `(?:תו${Q}מ|תורת[\\s-]מנחם)` },
  { work: 'sefer-hamaamarim-melukat', name: `(?:סה${Q}מ[\\s-]מלוקט|ספר[\\s-]המאמרים[\\s-]מלוקט)` },
];

/** A volume as sefarim write it: חי"ב, ח"ג, חלק יב, ח' יב, כרך 12. */
const VOLUME = `\\s*,?\\s*(?:ח(?<v1>[א-ת]{0,2})${Q}(?<v2>[א-ת])|(?:חלק|כרך|ח${G})\\s*(?<vn>${NUM}))`;
const PAGE = `(?:\\s*,?\\s*(?:עמ${G}?|ע${G}|עמוד|עמודים)\\s*(?<page>${NUM}))?`;
const LETTER = `(?:\\s*,?\\s*(?:אגרת|מכתב)\\s*(?<letter>${NUM}))?`;
/** Words before a citation that make it where the thing was printed. */
const PRINTED = /(?:נדפס|נדפסה|נדפסו|נעתק|נעתקה|הודפס|הודפסה)\s*(?:גם\s*)?(?:ב|ל)?\s*$/;
const SICHA = new RegExp(`(?<![א-ת])(?:[ובל])?(?<from>מ)?(?:ה)?(?:שיחת|שיחות|התוועדות|מאמר)\\s+(?<rest>[^.;:()\\[\\]\\n]{3,80})`, 'g');
/** Words before a date that are not the date. */
const DAY_WORDS = new Set(['יום', 'ליל', 'מוצאי', 'מוצש', 'אור', 'ל', 'ביום', 'בליל', 'שבת', 'שק', 'קודש']);

const numeral = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const n = /^\d+$/.test(value) ? Number(value) : parseHebrewNumeral(value);
  return n !== null && n > 0 ? n : undefined;
};

/**
 * The citations in a text: sefarim by volume (and page or letter), and
 * sichos and farbrengens by their date. `ראה לקו"ש חי"ב עמ' 123` cites;
 * `נדפס בלקו"ש ח"ג` says where this was printed; `משיחת י"ט כסלו תשכ"ב`
 * says which farbrengen this is based on.
 */
export function findCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const w of WORKS) {
    const re = new RegExp(`(?<![א-ת])(?<pre>[ובהלמשכ]{0,2})${w.name}(?<others>${w.others?.name ?? '(?!)'})?${VOLUME}${PAGE}${LETTER}`, 'g');
    for (const m of text.matchAll(re)) {
      const g = m.groups ?? {};
      const volume = g.vn !== undefined ? numeral(g.vn) : numeral(`${g.v1 ?? ''}${g.v2 ?? ''}`);
      if (volume === undefined || volume > 200) continue;
      const pre = g.pre?.length ?? 0;
      // "נדפס ב" just before it: this is where the thing was printed.
      const before = text.slice(Math.max(0, m.index! - 24), m.index! + pre);
      out.push({
        kind: PRINTED.test(before) ? 'printed-in' : 'cites',
        text: m[0].slice(pre).trim(),
        index: m.index! + pre,
        target: { work: g.others ? w.others!.work : w.work, volume, page: numeral(g.page), letter: numeral(g.letter) },
      });
    }
  }
  for (const m of text.matchAll(SICHA)) {
    const date = dateIn(m.groups!.rest!);
    if (!date) continue;
    out.push({ kind: m.groups!.from ? 'based-on' : 'cites', text: `${m[0].slice(0, m[0].length - m.groups!.rest!.length)}${date.text}`.trim(), index: m.index!, target: { date: date.key } });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The first full date (day, month and year) at the start of `rest`, skipping words like יום and ליל. */
function dateIn(rest: string): { key: DateKey; text: string } | null {
  const words = rest.split(/\s+/).filter(Boolean).slice(0, 8);
  for (let start = 0; start < Math.min(3, words.length); start++) {
    if (start > 0 && !DAY_WORDS.has(words[start - 1]!.replace(/[׳״"']/g, ''))) break;
    for (let n = Math.min(4, words.length - start); n >= 3; n--) {
      const candidate = words.slice(start, start + n).join(' ');
      const parsed = parseDateText(candidate);
      if (parsed.ok && /^\d{4}-\w{2,3}-\d{2}$/.test(parsed.key)) return { key: parsed.key, text: words.slice(0, start + n).join(' ') };
    }
  }
  return null;
}

/** What a citation points at in the catalog, most precise first: a letter, a volume's printing, the farbrengen, else the sefer. */
export async function resolveCitation(catalog: Catalog, target: CitationTarget): Promise<EntityId | null> {
  if ('date' in target) {
    const row = await one<{ id: EntityId }>(
      catalog.db,
      `SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'event' AND NOT e.deleted AND r.data->>'date' = $1
       ORDER BY (r.data->>'kind' = 'farbrengen') DESC, coalesce((r.data->>'order')::int, 0), e.id LIMIT 1`,
      [target.date],
    );
    return row?.id ?? null;
  }
  const work = await one<{ id: EntityId }>(
    catalog.db,
    "SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'work' AND NOT e.deleted AND r.data->>'slug' = $1 LIMIT 1",
    [target.work],
  );
  if (!work) return null;
  if (target.volume !== undefined && target.letter !== undefined) {
    const { rows } = await catalog.db.query<{ id: EntityId; volume: string; letter: string }>(
      `SELECT e.id, r.data->'position'->0->>'value' AS volume, r.data->'position'->1->>'value' AS letter
       FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'unit' AND NOT e.deleted JOIN revision r ON r.id = e.main_rev
       WHERE x.to_id = $1 AND x.field = 'work' AND jsonb_array_length(r.data->'position') >= 2`,
      [work.id],
    );
    const hit = rows.find((r) => numeral(r.volume) === target.volume && numeral(r.letter) === target.letter);
    if (hit) return hit.id;
  }
  if (target.volume !== undefined) {
    const { rows } = await catalog.db.query<{ id: EntityId; volume: string | null }>(
      `SELECT e.id, r.data->>'volume' AS volume FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'publication' AND NOT e.deleted
       JOIN revision r ON r.id = e.main_rev WHERE x.to_id = $1 AND x.field = 'work' ORDER BY e.id`,
      [work.id],
    );
    const hit = rows.find((r) => r.volume !== null && numeral(r.volume.replace(/[^0-9א-ת]/g, '')) === target.volume);
    if (hit) return hit.id;
  }
  return work.id;
}

/** How a citation is described on the link: as written, with the page of the scan it was read on. */
function noteOf(citation: Citation, where?: { page?: number }): string {
  return `${citation.text}${where?.page ? ` (עמוד ${where.page} בסריקה)` : ''}`.slice(0, 300);
}

interface Source {
  id: EntityId;
  rev: number;
  /** The item the citation is made by. */
  from: EntityId;
  /** The paragraph it is in, when it is one. */
  at?: EntityId;
  page?: number;
  text: string;
}

/** The items a machine has not read for citations at their current revision. */
async function sourcesToRead(catalog: Catalog, limit: number): Promise<Source[]> {
  const { rows } = await catalog.db.query<RevisionRow & { owner_unit: EntityId | null; owner_recording: EntityId | null; scan: EntityId | null; publication: EntityId | null }>(
    `SELECT r.*, tr.data->>'unit' AS owner_unit, tr.data->>'recording' AS owner_recording, lr.data->>'scan' AS scan, sr.data->>'publication' AS publication
     FROM entity e JOIN revision r ON r.id = e.main_rev
     LEFT JOIN entity t ON e.type = 'segment' AND t.id = r.data->>'text' LEFT JOIN revision tr ON tr.id = t.main_rev
     LEFT JOIN entity l ON e.type = 'text-page' AND l.id = r.data->>'layer' LEFT JOIN revision lr ON lr.id = l.main_rev
     LEFT JOIN entity s ON s.id = lr.data->>'scan' LEFT JOIN revision sr ON sr.id = s.main_rev
     WHERE e.type IN ('segment', 'text-page', 'unit', 'event') AND NOT e.deleted AND r.data IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM machine_pass p WHERE p.job = $1 AND p.entity_id = e.id AND p.rev = e.main_rev)
     ORDER BY e.id LIMIT ${Math.min(Math.max(limit, 1), 100_000)}`,
    [PASS],
  );
  return rows.map((r) => {
    const d = r.data as Record<string, unknown>;
    switch (r.entity_type) {
      case 'segment':
        return { id: r.entity_id, rev: r.id, from: r.owner_unit ?? r.owner_recording ?? (d.text as EntityId), at: r.entity_id, text: String(d.content ?? '') };
      case 'text-page':
        return {
          id: r.entity_id,
          rev: r.id,
          from: r.publication ?? r.scan ?? r.entity_id,
          page: Number(d.page),
          text: Array.isArray(d.lines) ? (d.lines as Array<{ text?: string }>).map((l) => l.text ?? '').join(' ') : '',
        };
      default:
        return { id: r.entity_id, rev: r.id, from: r.entity_id, text: pageTextPlain(withStructuredBody(d).body) };
    }
  });
}

/** Whether this link was ever proposed, by anyone: merged, waiting, or sent back. */
async function alreadyProposed(catalog: Catalog, kind: string, from: EntityId, to: EntityId): Promise<boolean> {
  const row = await one(
    catalog.db,
    "SELECT 1 FROM revision WHERE entity_type = 'relation' AND data->>'from' = $1 AND data->>'to' = $2 AND data->>'kind' = $3 LIMIT 1",
    [from, to, kind],
  );
  return row !== null;
}

/**
 * Reads what has not been read yet for citations, and proposes the links
 * it finds in Suggestions by the citations bot, up to `perSuggestion`
 * each. With `approveAs`, a steward approves them at once (as the import
 * does); without, they wait in the review queue.
 */
export async function proposeCitations(
  catalog: Catalog,
  options: { approveAs?: string; limit?: number; perSuggestion?: number; log?: (line: string) => void } = {},
): Promise<{ read: number; found: number; proposed: number; suggestions: number[] }> {
  const log = options.log ?? (() => {});
  await catalog.createAccount({ id: CITATIONS_BOT, displayName: 'Citations (machine)', isBot: true });
  const sources = await sourcesToRead(catalog, options.limit ?? 5000);
  const perSuggestion = Math.min(Math.max(options.perSuggestion ?? 100, 1), 500);
  const resolved = new Map<string, EntityId | null>();
  const pending: RelationData[] = [];
  const seen = new Set<string>();
  let found = 0;
  for (const source of sources) {
    for (const citation of findCitations(source.text)) {
      found++;
      const key = JSON.stringify(citation.target);
      if (!resolved.has(key)) resolved.set(key, await resolveCitation(catalog, citation.target));
      const to = resolved.get(key);
      if (!to || to === source.from || to === source.id) continue;
      const edge = `${citation.kind} ${source.from} ${to}`;
      if (seen.has(edge) || (await alreadyProposed(catalog, citation.kind, source.from, to))) continue;
      seen.add(edge);
      pending.push({ kind: citation.kind, from: source.from, to, ...(source.at ? { at: source.at } : {}), note: noteOf(citation, source), origin: { by: ENGINE } });
    }
  }
  const suggestions: number[] = [];
  for (let i = 0; i < pending.length; i += perSuggestion) {
    const batch = pending.slice(i, i + perSuggestion);
    const suggestion = await catalog.createChangeset(CITATIONS_BOT, {
      title: `קישורי מראי מקומות (${batch.length}), נמצאו במכונה`,
      description: 'Citations found in the text by machine: each links a page to what it cites, where it was printed, or the farbrengen it is based on. Check them before approving.',
    });
    for (const relation of batch) await catalog.putRevision(suggestion.id, CITATIONS_BOT, { type: 'relation', data: relation as unknown as Json });
    await catalog.submit(suggestion.id, CITATIONS_BOT);
    if (options.approveAs) await catalog.merge(suggestion.id, options.approveAs, {}, 'Citations found by machine, labelled as such until checked');
    suggestions.push(suggestion.id);
    log(`suggestion ${suggestion.id}: ${batch.length} links`);
  }
  // Remembered only now, so a run that fails part way reads them again.
  for (const source of sources) {
    await catalog.db.query('INSERT INTO machine_pass (job, entity_id, rev) VALUES ($1, $2, $3) ON CONFLICT (job, entity_id) DO UPDATE SET rev = EXCLUDED.rev, at = now()', [PASS, source.id, source.rev]);
  }
  return { read: sources.length, found, proposed: pending.length, suggestions };
}

/** One link of an item, seen from the item: what it cites (out) or what cites it (in). */
export interface RelationView {
  id: EntityId;
  kind: RelationKind;
  direction: 'out' | 'in';
  /** The item at the other end. */
  other: EntityId;
  at: EntityId | null;
  note: string | null;
  /** Found by a machine, and no person has checked it. */
  machine: boolean;
}

/** An item's links on main, both ways. */
export async function relationsOf(catalog: Catalog, id: EntityId, limit = 500): Promise<RelationView[]> {
  const { rows } = await catalog.db.query<{ id: EntityId; data: RelationData }>(
    `SELECT DISTINCT rel.id, r.data FROM entity_ref x JOIN entity rel ON rel.id = x.from_id AND rel.type = 'relation' AND NOT rel.deleted
     JOIN revision r ON r.id = rel.main_rev WHERE x.to_id = $1 AND x.field IN ('from', 'to') ORDER BY rel.id LIMIT ${Math.min(Math.max(limit, 1), 2000)}`,
    [id],
  );
  return rows.map(({ id: relId, data }) => ({
    id: relId,
    kind: data.kind,
    direction: data.from === id ? 'out' : 'in',
    other: data.from === id ? data.to : data.from,
    at: data.at ?? null,
    note: data.note ?? null,
    machine: Boolean(data.origin && !data.origin.checked),
  }));
}
