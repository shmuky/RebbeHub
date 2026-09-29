import { createHash } from 'node:crypto';
import {
  COVER_SAMPLE_PAGES,
  COVER_THUMB_WIDTH,
  COVER_WIDTH,
  chooseTitlePage,
  coverFetchFailed,
  coversWanted,
  getFile,
  lookOfPage,
  recordCover,
  registerFile,
  type Catalog,
  type CoverSource,
  type CoverToFetch,
  type GreyPage,
} from '@rebbehub/core';
import type { Db } from '@rebbehub/db';
import { defaultRightsState, keepsPreservationCopy, mayServe, type CatalogSourceId, type EntityId } from '@rebbehub/model';
import { pageTexts, renderPageImages, renderPages, type EncodedImage } from '@rebbehub/pdf-fix';
import { downloadDrive } from './pageFixes.js';
import type { ObjectStore } from './readingCopies.js';

/**
 * `rebbehub covers`: each sefer's cover from its title page (core/covers.ts
 * says how the page is found). For every sefer with a PDF and no cover
 * yet - or whose keeper chose another page since - the first pages of its
 * best PDF are drawn small and read (the PDF's own words, or the machine
 * OCR of the scan where there is one), the title page chosen, and that
 * page drawn at a sefer page's size and a shelf's, into the public bucket
 * by sha256, recorded as derivations of the PDF. A page a keeper chose is
 * drawn as it is, and is the person's choice from then on.
 *
 * The best PDF is one RebbeHub serves. A sefer whose PDFs are only linked
 * (the Otzros library on Drive, a printing's scan on HebrewBooks) gets its
 * cover from one of those: the PDF is fetched from its link, checked
 * against its sha256, and kept in the preservation bucket (never served),
 * as an upload marked "not sure" is; the cover is served, and the sefer's
 * page links to the source for the PDF itself (the owner's decision,
 * 2026-09-29: "we store everything; link in public"). A PDF whose rights
 * keep no copy is not fetched, and the log says so.
 */

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** What HebrewBooks' scans are credited as, on the covers drawn from them. */
export const HEBREWBOOKS_CREDIT = 'HebrewBooks.org';

export interface CoversInput {
  /** A served file's bytes by sha256 (the API's /objects/). */
  fetchFile: (sha256: string) => Promise<Uint8Array>;
  /** The public bucket: pictures are put at `objects/<sha256>`. */
  store: ObjectStore;
  /** The preservation bucket, where a linked PDF's copy is kept at `objects/<sha256>` and read back; without it, sefarim whose PDFs are only linked wait. */
  preservation?: ObjectStore;
  /** An outside PDF's bytes from its link (Drive, HebrewBooks); replaced in tests. */
  fetchLinked?: (url: string) => Promise<Uint8Array>;
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

/** A linked PDF's bytes from its link: a Drive file as Drive gives it to anyone with the link, anything else as its address answers. */
export async function downloadLinked(url: string, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const drive = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]{10,})/.exec(url);
  if (drive) {
    const resourceKey = new URL(url).searchParams.get('resourcekey');
    return downloadDrive({ driveFileId: drive[1]!, ...(resourceKey ? { resourceKey } : {}) }, fetchFn);
  }
  const response = await fetchFn(url, { headers: { 'user-agent': 'RebbeHub covers (https://rebbehub.org)' } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A site that will not give the file answers with a page, not an error.
  if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF') === -1) throw new Error(`${url} did not give a PDF`);
  return bytes;
}

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

/** Keeps a fetched PDF in the preservation bucket, and records that the catalog holds it now (from where it was fetched). */
async function keepCopy(db: Db, preservation: ObjectStore, bytes: Uint8Array, from: { source: CatalogSourceId; url: string; licence?: 'site-terms' | 'unknown'; credit?: string }) {
  const sha256 = sha256Of(bytes);
  if (!(await preservation.has(`objects/${sha256}`))) await preservation.put(`objects/${sha256}`, bytes, 'application/pdf');
  const { file } = await registerFile(db, {
    sha256,
    bytes: bytes.byteLength,
    mime: 'application/pdf',
    source: from.source,
    licence: from.licence ?? 'unknown',
    url: from.url,
    ...(from.credit ? { credit: from.credit } : {}),
    held: true,
  });
  return file;
}

/**
 * A linked PDF the catalog knows: the copy in the preservation bucket, or
 * else fetched from one of its links, checked against its sha256 and kept
 * there. Null when there is no copy to be had.
 */
async function linkedBytes(db: Db, sha256: string, input: CoversInput & { preservation: ObjectStore }, fetchLinked: (url: string) => Promise<Uint8Array>, log: (line: string) => void, work: EntityId): Promise<Uint8Array | null> {
  const file = await getFile(db, sha256);
  if (!file) return null;
  if (file.storage_tier === 'preservation') {
    const kept = await input.preservation.get(`objects/${sha256}`);
    if (kept) return kept;
  }
  if (!keepsPreservationCopy(file.rights_state)) {
    log(`${work}: ${sha256.slice(0, 12)} is ${file.rights_state}, and its rights keep no copy: not fetched, no cover from it`);
    return null;
  }
  const { rows } = await db.query<{ source: CatalogSourceId; url: string }>("SELECT source, url FROM file_source WHERE sha256 = $1 AND url ~ '^https?://' ORDER BY created_at", [sha256]);
  if (!rows.length) log(`${work}: ${sha256.slice(0, 12)} has no link to fetch it from`);
  for (const from of rows) {
    try {
      const bytes = await fetchLinked(from.url);
      if (sha256Of(bytes) !== sha256) {
        log(`${work}: ${from.url} gives another file now; not kept`);
        continue;
      }
      await keepCopy(db, input.preservation, bytes, from);
      log(`${work}: kept ${sha256.slice(0, 12)} from ${from.url} in the preservation bucket`);
      return bytes;
    } catch (error) {
      log(`${work}: ${from.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}

/**
 * A printing's scan on HebrewBooks, fetched and kept (a `link` file: its
 * cover served, the PDF never). One that cannot be fetched is not tried
 * again until its publication changes.
 */
async function fetchHebrewBooks(
  db: Db,
  toFetch: CoverToFetch[],
  preservation: ObjectStore,
  fetchLinked: (url: string) => Promise<Uint8Array>,
  log: (line: string) => void,
  work: EntityId,
): Promise<{ source: CoverSource; pdf: Uint8Array } | null> {
  const state = defaultRightsState({ source: 'hebrewbooks', licence: 'site-terms' });
  if (!mayServe(state) && !keepsPreservationCopy(state)) {
    log(`${work}: HebrewBooks' rights keep no copy: not fetched, no cover`);
    return null;
  }
  for (const scan of toFetch) {
    let pdf: Uint8Array;
    try {
      pdf = await fetchLinked(scan.url);
    } catch (error) {
      log(`${work}: ${scan.url}: ${error instanceof Error ? error.message : String(error)}; not tried again until ${scan.item} changes`);
      await coverFetchFailed(db, scan.item);
      continue;
    }
    const file = await keepCopy(db, preservation, pdf, { source: 'hebrewbooks', url: scan.url, licence: 'site-terms', credit: HEBREWBOOKS_CREDIT });
    log(`${work}: kept ${file.sha256.slice(0, 12)} from ${scan.url} in the preservation bucket`);
    // The same PDF may be known already, and taken down: then it gives no cover.
    if (!mayServe(file.rights_state) && file.rights_state !== 'link') {
      log(`${work}: ${file.sha256.slice(0, 12)} is ${file.rights_state}: no cover from it`);
      continue;
    }
    return { source: { sha256: file.sha256, via: 'publication', item: scan.item, linked: file.rights_state === 'link' }, pdf };
  }
  return null;
}

/** Draws the covers of sefarim that want one; see above. */
export async function makeCovers(catalog: Catalog, input: CoversInput): Promise<Array<{ work: EntityId; file: string; page: number; machine: boolean }>> {
  const log = input.log ?? (() => {});
  const sample = input.sample ?? defaultSample;
  const readTexts = input.texts ?? ((pdf: Uint8Array, pages: number[]) => pageTexts(pdf, pages));
  const draw = input.draw ?? defaultDraw;
  const fetchLinked = input.fetchLinked ?? ((url: string) => downloadLinked(url));
  const done: Array<{ work: EntityId; file: string; page: number; machine: boolean }> = [];
  let waiting = 0;
  for (const wanted of await coversWanted(catalog.db, { work: input.work, limit: input.limit, again: input.again })) {
    // A page a keeper chose, from a PDF a cover may come from, is drawn as it is.
    const chosenSource = wanted.chosen ? wanted.sources.find((s) => s.sha256 === wanted.chosen!.file) : undefined;
    if (wanted.chosen && !chosenSource) log(`${wanted.work}: the page chosen is in a PDF no cover may come from; the machine chooses meanwhile`);
    let source: CoverSource | undefined = chosenSource ?? wanted.sources[0];
    const linked = !source || source.linked;
    if (linked && !input.preservation) {
      waiting += 1;
      continue;
    }
    try {
      let pdf: Uint8Array | null;
      if (!source) {
        const fetched = await fetchHebrewBooks(catalog.db, wanted.toFetch, input.preservation!, fetchLinked, log, wanted.work);
        if (!fetched) continue;
        source = fetched.source;
        pdf = fetched.pdf;
      } else if (source.linked) {
        pdf = await linkedBytes(catalog.db, source.sha256, { ...input, preservation: input.preservation! }, fetchLinked, log, wanted.work);
        if (!pdf) continue;
      } else {
        pdf = await input.fetchFile(source.sha256);
      }
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
      log(
        `${wanted.work}: page ${page} of ${source.sha256.slice(0, 12)}${source.linked ? ' (linked)' : ''} (${chosenBy === 'person' ? 'chosen by a person' : `machine: ${reasons.join(', ')}`})`,
      );
      done.push({ work: wanted.work, file: source.sha256, page, machine: chosenBy === 'machine' });
    } catch (error) {
      log(`${wanted.work}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (waiting) log(`${waiting} sefarim whose PDFs are only linked wait: give the preservation bucket to keep their PDFs and draw their covers`);
  return done;
}
