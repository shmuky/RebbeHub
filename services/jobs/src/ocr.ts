import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { notRecentlyFailedSql, pageLevel, reseedLines, type Catalog, type Json } from '@rebbehub/core';
import type { EntityId, TextLine } from '@rebbehub/model';
import { failIfAny, machineRun } from './machineQueue.js';

/**
 * Machine OCR (the plan, section 7: "every new scan gets machine OCR
 * automatically"). Each served scan with no machine layer yet is read page
 * by page with Tesseract (Hebrew), and its lines, with where each stands on
 * the page, become a `machine-ocr` text layer: one text page per PDF page,
 * proofread level 0. Machine output is always labelled as such until a
 * person checks it; the bot never merges its own work, a steward does.
 *
 * When the engine improves, `reread` reads again the scans an older
 * version read (the plan, section 9: "engine and version stored with each
 * layer so pages can be re-OCRed when engines improve, without touching
 * human-checked lines"): the machine layer gets the new reading, and the
 * community pages seeded from it take the new lines everywhere except
 * where a person checked a line.
 */

const run = promisify(execFile);

export const OCR_BOT = 'bot:ocr';

/** Reads one page image into lines. Replaced in tests. */
export interface OcrEngine {
  name: string;
  version(): Promise<string>;
  /** Renders a PDF to page images, in page order. */
  pages(pdf: string, dir: string): Promise<string[]>;
  lines(image: string): Promise<TextLine[]>;
}

/**
 * Tesseract's TSV (level, page, block, paragraph, line, word, left, top,
 * width, height, confidence, text) as lines: words gathered by block,
 * paragraph and line, their boxes joined, each as fractions of the page.
 */
export function linesFromTsv(tsv: string): TextLine[] {
  const rows = tsv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter((c) => c.length >= 12);
  const page = rows.find((c) => c[0] === '1');
  const pageWidth = Number(page?.[8] ?? 0) || 1;
  const pageHeight = Number(page?.[9] ?? 0) || 1;
  const byLine = new Map<string, { words: string[]; left: number; top: number; right: number; bottom: number }>();
  for (const c of rows) {
    if (c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    if (!text) continue;
    const key = `${c[2]}.${c[3]}.${c[4]}`;
    const [left, top, width, height] = [Number(c[6]), Number(c[7]), Number(c[8]), Number(c[9])];
    const line = byLine.get(key) ?? { words: [], left, top, right: left + width, bottom: top + height };
    line.words.push(text);
    line.left = Math.min(line.left, left);
    line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, left + width);
    line.bottom = Math.max(line.bottom, top + height);
    byLine.set(key, line);
  }
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return [...byLine.values()].map((l, i) => ({
    id: `l${i + 1}`,
    text: l.words.join(' '),
    box: [round(l.left / pageWidth), round(l.top / pageHeight), round((l.right - l.left) / pageWidth), round((l.bottom - l.top) / pageHeight)],
  }));
}

export const tesseract: OcrEngine = {
  name: 'tesseract-heb',
  async version() {
    const { stdout } = await run('tesseract', ['--version']);
    return /tesseract\s+(\S+)/.exec(stdout)?.[1] ?? 'unknown';
  },
  async pages(pdf, dir) {
    await run('pdftoppm', ['-r', '200', '-png', pdf, join(dir, 'page')], { maxBuffer: 1 << 26 });
    return (await readdir(dir))
      .filter((f) => f.startsWith('page') && f.endsWith('.png'))
      .sort((a, b) => Number(/(\d+)\.png$/.exec(a)![1]) - Number(/(\d+)\.png$/.exec(b)![1]))
      .map((f) => join(dir, f));
  },
  async lines(image) {
    const { stdout } = await run('tesseract', [image, 'stdout', '-l', 'heb', 'tsv'], { maxBuffer: 1 << 26 });
    return linesFromTsv(stdout);
  },
};

/** Served scans that have no machine layer yet, the newest first (a scan just added is read the next night); with `reread`, those this engine read in another version. */
export async function scansToRead(catalog: Catalog, options: { scan?: EntityId; limit?: number; reread?: { name: string; version: string } } = {}): Promise<Array<{ id: EntityId; file: string; sets: EntityId[] }>> {
  const params: unknown[] = [];
  // The sweep leaves a scan it failed on lately; one asked for by name is always tried.
  const only = options.scan ? `AND e.id = $${params.push(options.scan)}` : `AND ${notRecentlyFailedSql('ocr', 'e.id')}`;
  const which = options.reread
    ? `AND EXISTS (
         SELECT 1 FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
         JOIN revision lr ON lr.id = l.main_rev
         WHERE x.to_id = e.id AND x.field = 'scan' AND lr.data->>'kind' = 'machine-ocr'
           AND lr.data->'engine'->>'name' = $${params.push(options.reread.name)} AND lr.data->'engine'->>'version' <> $${params.push(options.reread.version)})`
    : `AND NOT EXISTS (
         SELECT 1 FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
         JOIN revision lr ON lr.id = l.main_rev
         WHERE x.to_id = e.id AND x.field = 'scan' AND lr.data->>'kind' = 'machine-ocr')`;
  const { rows } = await catalog.db.query<{ id: EntityId; file: string; sets: EntityId[] | null }>(
    `SELECT e.id, r.data->>'file' AS file, ARRAY(SELECT jsonb_array_elements_text(coalesce(r.data->'sets', '[]'::jsonb))) AS sets
     FROM entity e JOIN revision r ON r.id = e.main_rev JOIN file f ON f.sha256 = r.data->>'file'
     WHERE e.type = 'scan' AND NOT e.deleted AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit') ${only}
       ${which}
     ORDER BY e.created_at DESC, e.id LIMIT ${Math.min(options.limit ?? 10, 1000)}`,
    params,
  );
  return rows.map((r) => ({ id: r.id, file: r.file, sets: r.sets ?? [] }));
}

/**
 * Reads the scans and adds each one's machine layer as a suggestion by
 * the OCR bot, approved by `approveAs` (a steward). `fetchFile` gets a
 * file's bytes by sha256 (from the API's /objects/, in production).
 */
export async function readScans(
  catalog: Catalog,
  input: {
    approveAs: string;
    fetchFile: (sha256: string) => Promise<Uint8Array>;
    engine?: OcrEngine;
    scan?: EntityId;
    limit?: number;
    reread?: boolean;
    /** Only what people asked for (core/machineWork.ts), not the newest scans nobody asked for too. */
    requestedOnly?: boolean;
    log?: (line: string) => void;
  },
): Promise<Array<{ scan: EntityId; pages: number; lines: number }>> {
  const engine = input.engine ?? tesseract;
  const log = input.log ?? (() => {});
  await catalog.createAccount({ id: OCR_BOT, displayName: 'Machine OCR', isBot: true });
  const version = await engine.version();
  const done: Array<{ scan: EntityId; pages: number; lines: number }> = [];
  if (input.reread) {
    // Re-reading is its own pass over what an older version read; requests are for scans never read.
    for (const scan of await scansToRead(catalog, { scan: input.scan, limit: input.limit, reread: { name: engine.name, version } })) await readOne(scan);
    return done;
  }
  const { failed } = await machineRun(catalog, 'ocr', {
    item: input.scan,
    limit: input.limit ?? 10,
    sweep: !input.requestedOnly,
    log,
    find: ({ item, limit }) => scansToRead(catalog, { scan: item, limit }),
    work: readOne,
  });
  failIfAny(failed);
  return done;

  async function readOne(scan: { id: EntityId; file: string }): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'rebbehub-ocr-'));
    try {
      const pdf = join(dir, 'scan.pdf');
      await writeFile(pdf, await input.fetchFile(scan.file));
      const images = await engine.pages(pdf, dir);
      const suggestion = await catalog.createChangeset(OCR_BOT, { title: `Machine OCR of ${scan.id} (${engine.name} ${version})` });
      const before = input.reread ? await layersOfScan(catalog, scan.id) : null;
      const old = before?.find((l) => l.kind === 'machine-ocr' && l.engine?.name === engine.name);
      const layer = await catalog.putRevision(suggestion.id, OCR_BOT, {
        ...(old ? { id: old.id } : {}),
        type: 'text-layer',
        data: { scan: scan.id, kind: 'machine-ocr', engine: { name: engine.name, version }, language: 'he' } as Json,
      });
      const community = before?.find((l) => l.kind === 'community');
      // The community layer beside it, seeded from it: people's line fixes go there, never into the machine's reading.
      if (!community) await catalog.putRevision(suggestion.id, OCR_BOT, { type: 'text-layer', data: { scan: scan.id, kind: 'community', seededFrom: layer, language: 'he' } as Json });
      // Re-reading: the community pages seeded from this layer take the new lines, except where a person checked one.
      const reseed = community && (community.seededFrom === layer || !community.seededFrom) ? await pagesOfLayer(catalog, community.id) : new Map<number, { id: EntityId; lines: TextLine[] }>();
      const oldPages = old ? await pagesOfLayer(catalog, old.id) : new Map<number, { id: EntityId; lines: TextLine[] }>();
      let lines = 0;
      for (const [i, image] of images.entries()) {
        const pageLines = await engine.lines(image);
        lines += pageLines.length;
        await catalog.putRevision(suggestion.id, OCR_BOT, { ...(oldPages.has(i + 1) ? { id: oldPages.get(i + 1)!.id } : {}), type: 'text-page', data: { layer, page: i + 1, lines: pageLines, proofread: 0 } as unknown as Json });
        const fixed = reseed.get(i + 1);
        if (fixed && community) {
          const merged = reseedLines(fixed.lines, pageLines);
          await catalog.putRevision(suggestion.id, OCR_BOT, { id: fixed.id, type: 'text-page', data: { layer: community.id, page: i + 1, lines: merged, proofread: pageLevel(merged) } as unknown as Json });
        }
      }
      await catalog.submit(suggestion.id, OCR_BOT);
      await catalog.merge(suggestion.id, input.approveAs, {}, 'Machine OCR, labelled as such until checked');
      log(`${scan.id}: ${images.length} pages, ${lines} lines`);
      done.push({ scan: scan.id, pages: images.length, lines });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

async function layersOfScan(catalog: Catalog, scan: EntityId): Promise<Array<{ id: EntityId; kind: string; engine?: { name: string; version: string }; seededFrom?: EntityId }>> {
  const { rows } = await catalog.db.query<{ id: EntityId; data: { kind: string; engine?: { name: string; version: string }; seededFrom?: EntityId } }>(
    `SELECT l.id, lr.data FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
     JOIN revision lr ON lr.id = l.main_rev WHERE x.to_id = $1 AND x.field = 'scan' ORDER BY l.id`,
    [scan],
  );
  return rows.map((r) => ({ id: r.id, ...r.data }));
}

async function pagesOfLayer(catalog: Catalog, layer: EntityId): Promise<Map<number, { id: EntityId; lines: TextLine[] }>> {
  const { rows } = await catalog.db.query<{ id: EntityId; page: number; lines: TextLine[] }>(
    `SELECT p.id, (pr.data->>'page')::int AS page, pr.data->'lines' AS lines FROM entity_ref x JOIN entity p ON p.id = x.from_id AND p.type = 'text-page' AND NOT p.deleted
     JOIN revision pr ON pr.id = p.main_rev WHERE x.to_id = $1 AND x.field = 'layer'`,
    [layer],
  );
  return new Map(rows.map((r) => [Number(r.page), { id: r.id, lines: r.lines }]));
}
