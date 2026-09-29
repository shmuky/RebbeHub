import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pageLevel, reseedLines, type Catalog, type Json } from '@rebbehub/core';
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
 *
 * A second engine, `kraken` (RebbeHub's own Kraken model), reads only the
 * index books (מפתח ענינים), which it reads far better than Tesseract.
 * Where Tesseract read one first, Kraken's reading takes the place of
 * Tesseract's in the same machine layer, the way a newer version's
 * reading does (see readScans).
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
  /**
   * Other engines whose machine layer this one takes over when it reads a
   * scan they read: it reads the scans it is for so much better that its
   * reading should be the one people proofread. Their reading stays in the
   * layer's history.
   */
  replaces?: string[];
  /** Reads only index books (indexBooks), the pages it was trained on. */
  indexBooksOnly?: boolean;
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

/**
 * RebbeHub's Kraken model for the two-column subject indexes (מפתח ענינים)
 * of Likkutei Sichos (services/jobs/kraken/lines.py): on a volume it never
 * trained on it read 610 of 615 page references right, against
 * Tesseract's 593. `model` is the model file, kept private in R2 at
 * models/rebbehub-kraken-v<N>/; the layer names the model by that folder,
 * with the kraken package's version, so a newer model re-reads with
 * `reread`. Needs `pip install kraken` and Tesseract, which finds the lines
 * Kraken reads (`tessdata`: another folder of Tesseract models).
 */
export function kraken(input: { model: string; python?: string; script?: string; tessdata?: string }): OcrEngine {
  const script = input.script ?? fileURLToPath(new URL('../kraken/lines.py', import.meta.url));
  const python = input.python ?? 'python3';
  const folder = basename(dirname(input.model));
  const model = /^rebbehub-kraken-v\d+$/.test(folder) ? folder : basename(input.model).replace(/\.[^.]+$/, '');
  return {
    name: 'kraken-index',
    replaces: [tesseract.name],
    indexBooksOnly: true,
    async version() {
      const { stdout } = await run(python, ['-c', "import importlib.metadata as m; print(m.version('kraken'))"]);
      return `${model} kraken-${stdout.trim()}`;
    },
    async pages(pdf, dir) {
      // Grey at 300 dpi, as the model was trained.
      await run('pdftoppm', ['-r', '300', '-gray', '-png', pdf, join(dir, 'page')], { maxBuffer: 1 << 26 });
      return pageImages(dir);
    },
    async lines(image) {
      const { stdout } = await run(python, [script, '--model', input.model, ...(input.tessdata ? ['--tessdata', input.tessdata] : []), image], { maxBuffer: 1 << 26 });
      return JSON.parse(stdout.trim().split('\n').at(-1) || '[]') as TextLine[];
    },
  };
}

/** The page images pdftoppm made in `dir`, in page order. */
async function pageImages(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((f) => f.startsWith('page') && f.endsWith('.png'))
    .sort((a, b) => Number(/(\d+)\.png$/.exec(a)![1]) - Number(/(\d+)\.png$/.exec(b)![1]))
    .map((f) => join(dir, f));
}

/** What marks an index book in its publication's or work's Hebrew title: מפתח, and so מפתחות. */
export const INDEX_TITLE = 'מפתח';

/**
 * Served scans that have no machine layer yet, the newest first (a scan
 * just added is read the next night); with `replaces`, also those these
 * other engines read; with `reread`, those this engine read in another
 * version. `indexBooks`: only scans of index books, whose publication's or
 * work's Hebrew title has מפתח in it (a scan named by `scan` is taken as
 * it is, since a person chose it).
 */
export async function scansToRead(
  catalog: Catalog,
  options: { scan?: EntityId; limit?: number; reread?: { name: string; version: string }; replaces?: string[]; indexBooks?: boolean } = {},
): Promise<Array<{ id: EntityId; file: string; sets: EntityId[] }>> {
  const params: unknown[] = [];
  const only = options.scan ? `AND e.id = $${params.push(options.scan)}` : '';
  const machineLayer = (engine: string) => `EXISTS (
         SELECT 1 FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
         JOIN revision lr ON lr.id = l.main_rev
         WHERE x.to_id = e.id AND x.field = 'scan' AND lr.data->>'kind' = 'machine-ocr'${engine})`;
  const which = options.reread
    ? `AND ${machineLayer(` AND lr.data->'engine'->>'name' = $${params.push(options.reread.name)} AND lr.data->'engine'->>'version' <> $${params.push(options.reread.version)}`)}`
    : options.replaces?.length
      ? `AND (NOT ${machineLayer('')} OR ${machineLayer(` AND lr.data->'engine'->>'name' = ANY($${params.push(options.replaces)}::text[])`)})`
      : `AND NOT ${machineLayer('')}`;
  // Two joins by id, only when asked: the publication, and the work it is.
  const index =
    options.indexBooks && !options.scan
      ? {
          join: `JOIN entity p ON p.id = r.data->>'publication' JOIN revision pr ON pr.id = p.main_rev
     LEFT JOIN entity w ON w.id = pr.data->>'work' LEFT JOIN revision wr ON wr.id = w.main_rev`,
          where: `AND (pr.data->'title'->>'he' LIKE $${params.push(`%${INDEX_TITLE}%`)} OR wr.data->'title'->>'he' LIKE $${params.length})`,
        }
      : { join: '', where: '' };
  const { rows } = await catalog.db.query<{ id: EntityId; file: string; sets: EntityId[] | null }>(
    `SELECT e.id, r.data->>'file' AS file, ARRAY(SELECT jsonb_array_elements_text(coalesce(r.data->'sets', '[]'::jsonb))) AS sets
     FROM entity e JOIN revision r ON r.id = e.main_rev JOIN file f ON f.sha256 = r.data->>'file' ${index.join}
     WHERE e.type = 'scan' AND NOT e.deleted AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit') ${only} ${index.where}
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
 *
 * An engine for index books only (`kraken`) makes its own pass, as
 * `reread` does, and leaves the queue of scans people asked for to the
 * engine that reads every scan: a request it took for a scan that is not
 * an index book would be settled as one the machine cannot read. Its pass
 * takes the index books nobody has read, and those Tesseract read, newest
 * first.
 *
 * Where it replaces another engine's reading, there is still one machine
 * layer, not two: it takes over the layer Tesseract made, with its own
 * name and version, as a newer version of Tesseract would. That keeps
 * every page to one machine reading for readers, search and proofreading,
 * and Tesseract's reading stays in the layer's history. The community
 * pages seeded from that layer take the new lines, except every line a
 * person checked, which is kept as they left it (reseedLines). A
 * community text keepers seeded from another layer (an uploaded OCR) is
 * left alone. Tesseract never takes a layer back: its passes look only
 * for scans with no machine layer, or with its own in an older version.
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
  if (input.reread || engine.indexBooksOnly) {
    // Re-reading is its own pass over what an older version read, and an index-books engine's is over index
    // books (see above); requests are for scans never read, and wait for the engine that reads every scan.
    if (!input.reread && input.requestedOnly) return done;
    const scans = await scansToRead(catalog, {
      scan: input.scan,
      limit: input.limit,
      indexBooks: engine.indexBooksOnly,
      ...(input.reread ? { reread: { name: engine.name, version } } : { replaces: engine.replaces }),
    });
    const failed: Array<{ item: EntityId; error: string }> = [];
    for (const scan of scans) {
      try {
        await readOne(scan);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`${scan.id}: failed: ${message}`);
        failed.push({ item: scan.id, error: message });
      }
    }
    failIfAny(failed);
    return done;
  }
  const { failed } = await machineRun(catalog, 'ocr', {
    item: input.scan,
    limit: input.limit ?? 10,
    sweep: !input.requestedOnly,
    log,
    find: ({ item, limit }) => scansToRead(catalog, { scan: item, limit, replaces: engine.replaces }),
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
      const before = await layersOfScan(catalog, scan.id);
      // The machine layer this reading goes into: its own from an older version, or one it replaces.
      const old = before.find((l) => l.kind === 'machine-ocr' && l.engine && (l.engine.name === engine.name || engine.replaces?.includes(l.engine.name)));
      const layer = await catalog.putRevision(suggestion.id, OCR_BOT, {
        ...(old ? { id: old.id } : {}),
        type: 'text-layer',
        data: { scan: scan.id, kind: 'machine-ocr', engine: { name: engine.name, version }, language: 'he' } as Json,
      });
      const community = before.find((l) => l.kind === 'community');
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
