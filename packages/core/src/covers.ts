import { one, type Db } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { recordDerivation } from './files.js';
import { invalid } from './errors.js';

/**
 * A sefer's cover from its title page, the shaar (migration 0017). The
 * jobs' `covers` looks at the first pages of the sefer's best PDF RebbeHub
 * serves, finds the title page - the first real page that is neither
 * blank nor a cover sheet, going by how much ink a page holds, where it
 * stands, and the words on it ("ספר", a publisher's line, a year) - and
 * draws it at two sizes. Where nothing looks like a title page, page 1.
 *
 * The machine's choice is labelled as the machine's until a person picks
 * a page, which they do through a suggestion that sets the work's `cover`
 * (reviewed like any other); the jobs then draw the page the person chose.
 *
 * Covers come only from PDFs RebbeHub may serve (open or credit, in the
 * public bucket), and are derivations of them, so a takedown takes the
 * cover down with the file (docs/rights.md). A book RebbeHub only links to
 * keeps its drawn cover.
 */

/** The covers' version, as their derivations' `encoder`: bumped whenever a cover would come out differently. */
export const COVER_ENCODER = 'cover@1';

/** How many pages from the start are looked at for the title page. */
export const COVER_SAMPLE_PAGES = 10;

/** Pixels across the cover shown on a sefer's page, and across the small one on a shelf. */
export const COVER_WIDTH = 480;
export const COVER_THUMB_WIDTH = 180;

/** A page drawn in grey, one byte a pixel (what @rebbehub/pdf-fix renders). */
export interface GreyPage {
  width: number;
  height: number;
  gray: Uint8Array;
}

/** What a page looks like, as far as finding the title page goes. */
export interface PageLook {
  page: number;
  /** The share of the page (inside a margin that scanners soil) that is ink. */
  ink: number;
  /** Where the ink's weight stands across the page, 0 (left) to 1 (right). */
  centre: number;
  /** Bands of ink down the page: roughly its lines. */
  lines: number;
  /** The share of the page's height that has ink on it. */
  spread: number;
  /** Its words, from the PDF's own text or a machine reading of it; empty when there are none. */
  text: string;
}

/** A page's ink, where it stands, and its lines, from its grey picture; `text` is added by whoever has it. */
export function lookOfPage(page: number, bitmap: GreyPage, text = ''): PageLook {
  const { width: W, height: H, gray } = bitmap;
  // Scanners leave dark edges; the title is never there.
  const x0 = Math.floor(W * 0.06);
  const x1 = Math.ceil(W * 0.94);
  const y0 = Math.floor(H * 0.05);
  const y1 = Math.ceil(H * 0.95);
  let dark = 0;
  let mass = 0;
  let inked = 0;
  let bands = 0;
  let inBand = false;
  const rowNeed = Math.max(1, Math.round((x1 - x0) * 0.01));
  for (let y = y0; y < y1; y++) {
    let row = 0;
    for (let x = x0; x < x1; x++) {
      if (gray[y * W + x]! < 140) {
        row++;
        mass += x;
      }
    }
    dark += row;
    const has = row >= rowNeed;
    if (has) inked++;
    if (has && !inBand) bands++;
    inBand = has;
  }
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  return {
    page,
    ink: dark / area,
    centre: dark ? (mass / dark - x0) / Math.max(1, x1 - x0) : 0.5,
    lines: bands,
    spread: inked / Math.max(1, y1 - y0),
    text: text.replace(/\s+/g, ' ').trim(),
  };
}

const PUBLISHER = /הוצאת|הוצאה|קה["״]?ת|אוצר החסידים|ברוקלין|כפר חב["״]?ד|נ\.?\s?י\.?|ניו יורק|ירושלים|תל אביב|Kehot|Publication Society|Brooklyn|New York|Published|Otzar/i;
const SEFER = /(^|[\s"״'׳])(ספר|ספרי|קונטרס|לקוטי|לקוטי|שיחות|אגרות|מאמרי|תורת|תורה אור|לקוטי תורה|סידור|תניא)([\s"״'׳]|$)/;
const YEAR = /(^|\s)(ה['׳])?ת[שר][א-ת]?["״][א-ת](\s|$)|(^|\s)(18|19|20)\d\d(\s|$)|שנת\s/;
const COPYRIGHT = /ISBN|©|Copyright|All rights reserved|כל הזכויות שמורות|נדפס ב|Printed in/i;

/**
 * How much a page looks like a title page: sparse and centred, a few
 * lines, "ספר" or a sefer's name, a publisher and a year; not blank, not a
 * dark cover sheet, not a page of body text or of copyright. The reasons
 * are kept with the cover, so a person sees why the machine chose it.
 */
export function titlePageScore(look: PageLook): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (look.ink < 0.003) return { score: -100, reasons: ['blank'] };
  if (look.ink > 0.45) return { score: -50, reasons: ['dark cover sheet'] };
  let score = 0;
  if (look.ink <= 0.09) {
    score += 2;
    reasons.push('sparse');
  } else if (look.ink > 0.14) {
    score -= 2;
    reasons.push('dense');
  }
  if (Math.abs(look.centre - 0.5) < 0.06) {
    score += 1;
    reasons.push('centred');
  }
  if (look.lines >= 2 && look.lines <= 18 && look.spread < 0.6) {
    score += 1;
    reasons.push('few lines');
  } else if (look.lines > 28 || look.spread > 0.75) {
    score -= 2;
    reasons.push('full page of text');
  }
  const words = look.text ? look.text.split(' ').length : 0;
  if (look.text) {
    if (SEFER.test(look.text)) {
      score += 2;
      reasons.push('sefer');
    }
    if (PUBLISHER.test(look.text)) {
      score += 2;
      reasons.push('publisher line');
    }
    if (YEAR.test(look.text)) {
      score += 1;
      reasons.push('year');
    }
    if (COPYRIGHT.test(look.text)) {
      score -= 3;
      reasons.push('copyright page');
    }
    if (words > 180) {
      score -= 2;
      reasons.push('body text');
    }
  }
  // The title page comes early: a later page must look more like one.
  score -= (look.page - 1) * 0.15;
  return { score: Math.round(score * 100) / 100, reasons };
}

/**
 * The title page among the first pages: the one that looks most like one;
 * where none does, the first page that is neither blank nor a dark cover
 * sheet; where there is none of those either, page 1.
 */
export function chooseTitlePage(looks: readonly PageLook[]): { page: number; score: number; reasons: string[] } {
  const scored = looks.map((look) => ({ look, ...titlePageScore(look) })).sort((a, b) => a.look.page - b.look.page);
  const best = [...scored].sort((a, b) => b.score - a.score || a.look.page - b.look.page)[0];
  if (best && best.score > 0) return { page: best.look.page, score: best.score, reasons: best.reasons };
  const real = scored.find((s) => s.score > -50);
  if (real) return { page: real.look.page, score: real.score, reasons: [...real.reasons, 'first real page'] };
  return { page: 1, score: 0, reasons: ['page 1'] };
}

// ---------------------------------------------------------------- where a cover can come from

/** A PDF a sefer's cover can be drawn from, best first. */
export interface CoverSource {
  sha256: string;
  /** Through a scan of one of its printings, or a PDF linked from one of its units. */
  via: 'scan' | 'unit';
  /** The scan or unit. */
  item: EntityId;
}

/** Served PDFs (open or credit, in the public bucket): the only ones a cover is drawn from. */
const SERVED = `f.mime = 'application/pdf' AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit')`;

/**
 * Every served PDF of each work in `works`: the scans of its printings
 * (the preferred first, then complete ones, then the oldest printing),
 * then the PDFs its units link to that RebbeHub holds (a unit's edition
 * on Google Drive whose file the catalog registered), in the units' order.
 */
function sourcesSql(works: string): string {
  return `
    WITH drive AS (
      SELECT DISTINCT ON (substring(s.url from '/file/d/([A-Za-z0-9_-]{10,})')) substring(s.url from '/file/d/([A-Za-z0-9_-]{10,})') AS drive_id, f.sha256
      FROM file_source s JOIN file f ON f.sha256 = s.sha256
      WHERE s.url LIKE 'https://drive.google.com/file/d/%' AND ${SERVED}
      ORDER BY 1, s.created_at
    ), found AS (
      SELECT x.to_id AS work, 'scan' AS via, sc.id AS item, sr.data->>'file' AS sha256,
             CASE WHEN (sr.data->>'preferred')::boolean IS TRUE THEN 0 WHEN sr.data->>'completeness' = 'complete' THEN 1 ELSE 2 END AS rank,
             coalesce(pr.data->>'date', (pr.data->>'gregorianYear')::int + 3760 || '', '9999') AS sub
      FROM entity_ref x
      JOIN entity p ON p.id = x.from_id AND p.type = 'publication' AND NOT p.deleted AND p.main_rev IS NOT NULL JOIN revision pr ON pr.id = p.main_rev
      JOIN entity_ref y ON y.to_id = p.id AND y.field = 'publication'
      JOIN entity sc ON sc.id = y.from_id AND sc.type = 'scan' AND NOT sc.deleted AND sc.main_rev IS NOT NULL JOIN revision sr ON sr.id = sc.main_rev
      WHERE x.field = 'work' AND x.to_id IN (${works})
      UNION ALL
      SELECT x.to_id, 'unit', u.id, d.sha256, 3, coalesce(ur.data->>'order', '')
      FROM entity_ref x
      JOIN entity u ON u.id = x.from_id AND u.type = 'unit' AND NOT u.deleted AND u.main_rev IS NOT NULL JOIN revision ur ON ur.id = u.main_rev
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ur.data->'editions') = 'array' THEN ur.data->'editions' ELSE '[]'::jsonb END) ed
      JOIN drive d ON d.drive_id = substring(ed->>'url' from '/(?:drive|file/d)/([A-Za-z0-9_-]{10,})')
      WHERE x.field = 'work' AND x.to_id IN (${works})
    )
    SELECT found.work, found.via, found.item, found.sha256 FROM found JOIN file f ON f.sha256 = found.sha256
    WHERE ${SERVED}
    ORDER BY found.work, found.rank, found.sub COLLATE "C", found.item`;
}

/** The PDFs a work's cover can be drawn from, best first, each file once. */
export async function coverSources(db: Db, work: EntityId): Promise<CoverSource[]> {
  const { rows } = await db.query<{ via: 'scan' | 'unit'; item: EntityId; sha256: string }>(sourcesSql('$1'), [work]);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.sha256) && seen.add(r.sha256)).map((r) => ({ sha256: r.sha256, via: r.via, item: r.item }));
}

/** A work that wants its cover drawn: what a person chose, if anything, and where the pages can come from. */
export interface CoverWanted {
  work: EntityId;
  /** The page a person chose (the work's `cover`), when they chose one. */
  chosen: { file: string; page: number } | null;
  sources: CoverSource[];
}

/**
 * Works whose cover is still to be drawn, a batch at a time: those with a
 * served PDF and no cover yet, those whose person-chosen page is not the
 * one drawn, and (with `again`) those drawn by an older version of the tool.
 */
export async function coversWanted(db: Db, options: { work?: EntityId; limit?: number; again?: boolean } = {}): Promise<CoverWanted[]> {
  const params: unknown[] = [];
  const only = options.work ? `AND e.id = $${params.push(options.work)}` : '';
  const stale = options.again ? `OR c.encoder <> $${params.push(COVER_ENCODER)}` : '';
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
  const wanted = `SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev LEFT JOIN cover c ON c.entity_id = e.id
     WHERE e.type = 'work' AND NOT e.deleted ${only}
       AND (c.entity_id IS NULL
            OR (r.data ? 'cover' AND (c.chosen_by <> 'person' OR c.src_sha256 <> r.data->'cover'->>'file' OR c.page <> (r.data->'cover'->>'page')::int))
            OR (NOT r.data ? 'cover' AND c.chosen_by = 'person')
            ${stale})`;
  const { rows } = await db.query<{ work: EntityId }>(`SELECT DISTINCT s.work FROM (${sourcesSql(wanted)}) s ORDER BY s.work LIMIT ${limit}`, params);
  const out: CoverWanted[] = [];
  for (const { work } of rows) {
    const row = await one<{ chosen: { file?: unknown; page?: unknown } | null }>(db, "SELECT r.data->'cover' AS chosen FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.id = $1", [work]);
    const chosen = row?.chosen && typeof row.chosen.file === 'string' && Number.isInteger(row.chosen.page) ? { file: row.chosen.file, page: row.chosen.page as number } : null;
    out.push({ work, chosen, sources: await coverSources(db, work) });
  }
  return out;
}

export interface CoverPicture {
  sha256: string;
  bytes: number;
  width: number;
  height: number;
}

export interface NewCover {
  entity: EntityId;
  /** The PDF it was drawn from. */
  src: string;
  page: number;
  chosenBy: 'machine' | 'person';
  score?: number | null;
  reasons?: string[];
  image: CoverPicture;
  thumb: CoverPicture;
  encoder?: string;
}

/** Records a cover: its two pictures as derivations of the PDF (so they keep its rights), and which page it is. Drawn again, it replaces the old. */
export async function recordCover(db: Db, input: NewCover): Promise<void> {
  if (!Number.isInteger(input.page) || input.page < 1) throw invalid('pages are numbered from 1');
  const encoder = input.encoder ?? COVER_ENCODER;
  await recordDerivation(db, { src: input.src, profile: `cover/${input.page}`, sha256: input.image.sha256, bytes: input.image.bytes, mime: 'image/jpeg', encoder });
  await recordDerivation(db, { src: input.src, profile: `cover-thumb/${input.page}`, sha256: input.thumb.sha256, bytes: input.thumb.bytes, mime: 'image/jpeg', encoder });
  await db.query(
    `INSERT INTO cover (entity_id, src_sha256, page, chosen_by, score, reasons, image_sha256, image_width, image_height, thumb_sha256, thumb_width, thumb_height, encoder)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (entity_id) DO UPDATE SET src_sha256 = EXCLUDED.src_sha256, page = EXCLUDED.page, chosen_by = EXCLUDED.chosen_by, score = EXCLUDED.score,
       reasons = EXCLUDED.reasons, image_sha256 = EXCLUDED.image_sha256, image_width = EXCLUDED.image_width, image_height = EXCLUDED.image_height,
       thumb_sha256 = EXCLUDED.thumb_sha256, thumb_width = EXCLUDED.thumb_width, thumb_height = EXCLUDED.thumb_height, encoder = EXCLUDED.encoder, made_at = now()`,
    [
      input.entity,
      input.src,
      input.page,
      input.chosenBy,
      input.score ?? null,
      (input.reasons ?? []).map((r) => r.slice(0, 100)).slice(0, 20),
      input.image.sha256,
      input.image.width,
      input.image.height,
      input.thumb.sha256,
      input.thumb.width,
      input.thumb.height,
      encoder,
    ],
  );
}

/** A cover as it is shown: its pictures (by sha256), the page it is, and whether a machine chose it. */
export interface CoverView {
  entity: EntityId;
  file: string;
  page: number;
  /** True until a person has chosen the page. */
  machine: boolean;
  reasons: string[];
  image: { sha256: string; width: number; height: number };
  thumb: { sha256: string; width: number; height: number };
  /** The credit its PDF is served with, when it has one. */
  credit: string | null;
}

/** The covers of these items that may be shown: those whose pictures are still served (a takedown hides them). */
export async function coversOf(db: Db, ids: readonly string[]): Promise<Record<string, CoverView>> {
  if (ids.length === 0) return {};
  const { rows } = await db.query<{
    entity_id: EntityId;
    src_sha256: string;
    page: number;
    chosen_by: string;
    reasons: string[];
    image_sha256: string;
    image_width: number;
    image_height: number;
    thumb_sha256: string;
    thumb_width: number;
    thumb_height: number;
    credit: string | null;
  }>(
    `SELECT c.*, src.credit FROM cover c
     JOIN file src ON src.sha256 = c.src_sha256 JOIN file i ON i.sha256 = c.image_sha256 JOIN file t ON t.sha256 = c.thumb_sha256
     WHERE c.entity_id = ANY($1::text[])
       AND src.rights_state IN ('open', 'credit') AND i.rights_state IN ('open', 'credit') AND i.storage_tier = 'public' AND t.rights_state IN ('open', 'credit') AND t.storage_tier = 'public'`,
    [[...new Set(ids)].slice(0, 500)],
  );
  return Object.fromEntries(
    rows.map((r) => [
      r.entity_id,
      {
        entity: r.entity_id,
        file: r.src_sha256,
        page: r.page,
        machine: r.chosen_by !== 'person',
        reasons: r.reasons ?? [],
        image: { sha256: r.image_sha256, width: r.image_width, height: r.image_height },
        thumb: { sha256: r.thumb_sha256, width: r.thumb_width, height: r.thumb_height },
        credit: r.credit,
      },
    ]),
  );
}

/** How many pages a PDF has, when the jobs have measured it. */
export async function pdfPageCount(db: Db, sha256: string): Promise<number | null> {
  return (await one<{ pages: number | null }>(db, "SELECT pages FROM file_fingerprint WHERE sha256 = $1 AND kind = 'pdf-pages'", [sha256]))?.pages ?? null;
}
