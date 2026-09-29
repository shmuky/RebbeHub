import { createHash } from 'node:crypto';
import { COVER_SAMPLE_PAGES, COVER_THUMB_WIDTH, COVER_WIDTH, chooseTitlePage, coversWanted, lookOfPage, recordCover, type Catalog, type CoverSource, type GreyPage } from '@rebbehub/core';
import type { Db } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { pageTexts, renderPageImages, renderPages, type EncodedImage } from '@rebbehub/pdf-fix';
import type { ObjectStore } from './readingCopies.js';

/**
 * `rebbehub covers`: each sefer's cover from its title page (core/covers.ts
 * says how the page is found). For every sefer with a PDF RebbeHub serves
 * and no cover yet - or whose keeper chose another page since - the first
 * pages of its best PDF are drawn small and read (the PDF's own words, or
 * the machine OCR of the scan where there is one), the title page chosen,
 * and that page drawn at a sefer page's size and a shelf's, into the
 * public bucket by sha256, recorded as derivations of the PDF. A page a
 * keeper chose is drawn as it is, and is the person's choice from then on.
 */

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface CoversInput {
  /** A served file's bytes by sha256 (the API's /objects/). */
  fetchFile: (sha256: string) => Promise<Uint8Array>;
  /** The public bucket: pictures are put at `objects/<sha256>`. */
  store: ObjectStore;
  work?: EntityId;
  limit?: number;
  /** Draw again the covers an older version of the tool drew. */
  again?: boolean;
  /** Replaced in tests: the first pages drawn in grey, and the words on them. */
  sample?: (pdf: Uint8Array, pages: number[]) => AsyncIterable<{ page: number; bitmap: GreyPage }>;
  texts?: (pdf: Uint8Array, pages: number[]) => Promise<Array<{ page: number; text: string }>>;
  /** Replaced in tests: one page drawn as a cover and a thumbnail. */
  draw?: (pdf: Uint8Array, page: number) => Promise<{ image: EncodedImage; thumb: EncodedImage } | null>;
  log?: (line: string) => void;
}

const defaultSample = async function* (pdf: Uint8Array, pages: number[]) {
  // Small is enough to see where the ink is: about 200 pixels across a page.
  for await (const page of renderPages(pdf, { pages, scale: 0.3 })) yield { page: page.number, bitmap: page.bitmap };
};

const defaultDraw = async (pdf: Uint8Array, page: number) => {
  for await (const drawn of renderPageImages(pdf, { pages: [page], width: COVER_WIDTH, thumbWidth: COVER_THUMB_WIDTH, quality: 85 })) return { image: drawn.image, thumb: drawn.thumb };
  return null;
};

/** The machine OCR of a scan's first pages, where the jobs have read it: the words when the PDF has none of its own. */
export async function ocrTexts(db: Db, scan: EntityId, pages: number[]): Promise<Map<number, string>> {
  const { rows } = await db.query<{ page: number; lines: Array<{ text?: string }> }>(
    `SELECT (pr.data->>'page')::int AS page, pr.data->'lines' AS lines
     FROM entity l JOIN revision lr ON lr.id = l.main_rev
     JOIN entity_ref x ON x.to_id = l.id AND x.field = 'layer' JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted JOIN revision pr ON pr.id = p.main_rev
     WHERE l.type = 'text-layer' AND NOT l.deleted AND lr.data->>'scan' = $1 AND (pr.data->>'page')::int = ANY($2::int[])
     ORDER BY CASE lr.data->>'kind' WHEN 'community' THEN 0 WHEN 'uploaded-ocr' THEN 1 ELSE 2 END`,
    [scan, pages],
  );
  const out = new Map<number, string>();
  for (const row of rows) if (!out.has(row.page)) out.set(row.page, (row.lines ?? []).map((l) => l.text ?? '').join(' '));
  return out;
}

/** Draws the covers of sefarim that want one; see above. */
export async function makeCovers(catalog: Catalog, input: CoversInput): Promise<Array<{ work: EntityId; file: string; page: number; machine: boolean }>> {
  const log = input.log ?? (() => {});
  const sample = input.sample ?? defaultSample;
  const readTexts = input.texts ?? ((pdf: Uint8Array, pages: number[]) => pageTexts(pdf, pages));
  const draw = input.draw ?? defaultDraw;
  const done: Array<{ work: EntityId; file: string; page: number; machine: boolean }> = [];
  for (const wanted of await coversWanted(catalog.db, { work: input.work, limit: input.limit, again: input.again })) {
    // A page a keeper chose, from a PDF that may be served, is drawn as it is.
    const chosenSource = wanted.chosen ? wanted.sources.find((s) => s.sha256 === wanted.chosen!.file) : undefined;
    if (wanted.chosen && !chosenSource) log(`${wanted.work}: the page chosen is in a PDF not served here; the machine chooses meanwhile`);
    const source: CoverSource | undefined = chosenSource ?? wanted.sources[0];
    if (!source) continue;
    try {
      const pdf = await input.fetchFile(source.sha256);
      let page: number;
      let score: number | null = null;
      let reasons: string[] = [];
      let chosenBy: 'machine' | 'person' = 'machine';
      if (chosenSource) {
        page = wanted.chosen!.page;
        chosenBy = 'person';
        reasons = ['chosen by a person'];
      } else {
        const numbers = Array.from({ length: COVER_SAMPLE_PAGES }, (_, i) => i + 1);
        const words = new Map((await readTexts(pdf, numbers).catch(() => [])).map((t) => [t.page, t.text]));
        const ocr = source.via === 'scan' ? await ocrTexts(catalog.db, source.item, numbers) : new Map<number, string>();
        const looks = [];
        for await (const drawn of sample(pdf, numbers)) looks.push(lookOfPage(drawn.page, drawn.bitmap, words.get(drawn.page) || ocr.get(drawn.page) || ''));
        ({ page, score, reasons } = chooseTitlePage(looks));
      }
      let pictures = await draw(pdf, page);
      if (!pictures && chosenBy === 'person') {
        log(`${wanted.work}: the PDF has no page ${page}; page 1 instead`);
        page = 1;
        chosenBy = 'machine';
        reasons = ['page 1'];
        pictures = await draw(pdf, 1);
      }
      if (!pictures) {
        log(`${wanted.work}: nothing could be drawn from ${source.sha256}`);
        continue;
      }
      const kept: Record<'image' | 'thumb', { sha256: string; bytes: number; width: number; height: number }> = {} as never;
      for (const which of ['image', 'thumb'] as const) {
        const picture = pictures[which];
        const sha256 = sha256Of(picture.bytes);
        if (!(await input.store.has(`objects/${sha256}`))) await input.store.put(`objects/${sha256}`, picture.bytes, 'image/jpeg');
        kept[which] = { sha256, bytes: picture.bytes.byteLength, width: picture.width, height: picture.height };
      }
      await recordCover(catalog.db, { entity: wanted.work, src: source.sha256, page, chosenBy, score, reasons, image: kept.image, thumb: kept.thumb });
      log(`${wanted.work}: page ${page} of ${source.sha256.slice(0, 12)} (${chosenBy === 'person' ? 'chosen by a person' : `machine: ${reasons.join(', ')}`})`);
      done.push({ work: wanted.work, file: source.sha256, page, machine: chosenBy === 'machine' });
    } catch (error) {
      log(`${wanted.work}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return done;
}
