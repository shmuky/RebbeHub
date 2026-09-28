import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHebrewYear } from '@rebbehub/hebrew';
import type { Genre, LocalName } from '@rebbehub/model';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { GENRE_NAMES } from './sichosKodeshWorks.js';

/**
 * The Chabad shelf of HebrewBooks.org: every scanned sefer HebrewBooks
 * holds by one of the Rebbeim, and every other Chabad book there, as
 * Sichos-Kodesh's packages/hebrewbooks-index reads it from Otzaria's public
 * HebrewBooks catalog and packages/works places each series with its sefer
 * (the shelf.json its works catalog carries). Each book becomes a
 * publication on RebbeHub with its HebrewBooks id, linking to its page
 * there; the scans stay at HebrewBooks, which its terms allow and nothing
 * more (docs/rights.md: HebrewBooks is link-only whatever else is said).
 *
 * A series Sichos-Kodesh placed with a sefer it knows is printings of that
 * sefer; any other series becomes a sefer of its own, so its volumes are
 * found together.
 */

export const HEBREWBOOKS = 'https://hebrewbooks.org';
export const HEBREWBOOKS_SET = { key: 'rebbehub-set:hebrewbooks', path: '/sets/hebrewbooks', name: { he: 'היברו בוקס: מדף חב״ד', en: 'HebrewBooks: the Chabad shelf' } } as const;

/** One scan on the shelf: facts and a link, never the scan (Sichos-Kodesh's `ShelfScan`). */
export interface ShelfScan {
  id: number;
  title: string;
  volume?: string;
  /** Where and when it was printed, as listed: `ניו יורק, תשכ״ז`. */
  printed?: string;
  pages?: number;
}
export interface ShelfSeries {
  title: string;
  /** The sefer of Sichos-Kodesh's registry it was placed with. */
  workId?: string;
  /** In a fresh shelf (hebrewbooks-index's own output): its matching key. */
  key?: string;
  scans: ShelfScan[];
}
export interface HebrewBooksShelf {
  catalogVersion: string;
  authors: Array<{ authorId: string | null; series: ShelfSeries[] }>;
}

export interface HebrewBooksInput {
  shelf: HebrewBooksShelf;
  /** The authors Sichos-Kodesh's registry knows, so only those are referred to. */
  authors: Set<string>;
}

const quotes = (text: string) => text.replace(/[״׳"'`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * A shelf read afresh from the latest Otzaria catalog (hebrewbooks-index's
 * `import-hebrewbooks`), with each series placed as the committed shelf
 * placed it: the placing is curated in Sichos-Kodesh's registry, not here.
 */
export function placeLikeCommitted(fresh: HebrewBooksShelf, committed: HebrewBooksShelf): HebrewBooksShelf {
  const placed = new Map<string, string>();
  for (const author of committed.authors) for (const s of author.series) if (s.workId) placed.set(`${author.authorId}\u0000${quotes(s.title)}`, s.workId);
  return {
    catalogVersion: fresh.catalogVersion,
    authors: fresh.authors.map((author) => ({
      authorId: author.authorId,
      series: author.series.map(({ key: _key, ...s }) => {
        const workId = s.workId ?? placed.get(`${author.authorId}\u0000${quotes(s.title)}`);
        return workId ? { ...s, workId } : s;
      }),
    })),
  };
}

/**
 * Reads the shelf from a Sichos-Kodesh checkout; with `fresh` (a shelf
 * hebrewbooks-index made from the latest Otzaria download), that one,
 * placed as the checkout's is.
 */
export async function readHebrewBooks(root: string, fresh?: string): Promise<HebrewBooksInput> {
  const dir = root.endsWith('works') ? root : join(root, 'apps/mobile/src/catalog/data/works');
  const committed = JSON.parse(await readFile(join(dir, 'shelf.json'), 'utf8')) as HebrewBooksShelf;
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8')) as { authors: Array<{ id: string }> };
  const shelf = fresh && existsSync(fresh) ? placeLikeCommitted(JSON.parse(await readFile(fresh, 'utf8')) as HebrewBooksShelf, committed) : committed;
  return { shelf, authors: new Set(index.authors.map((a) => a.id)) };
}

/** Where and when a book was printed: `ניו יורק, תשכ״ז` → the place and the year 5727. */
export function printedAt(printed: string | undefined): { place?: string; year?: number } {
  if (!printed) return {};
  const parts = printed.split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const year = /^(ה[׳'])?[תשרק][א-ת״׳"']{1,5}$/.test(last) ? parseHebrewYear(last) : null;
  const valid = year !== null && year >= 5300 && year <= 5850;
  const place = (valid ? parts.slice(0, -1) : parts).join(', ');
  return { ...(place ? { place: place.slice(0, 300) } : {}), ...(valid ? { year: year! } : {}) };
}

/** A series' kind of sefer, from its title, for the genre shelves. */
export function genreOfTitle(title: string): Genre {
  if (/אגרות|מכתב/.test(title)) return 'igros';
  if (/שיחות|התוועדויות|תורת מנחם|שיחו״ק/.test(title)) return 'sichos';
  if (/מאמר|דרושי|אור התורה|תורה אור|לקוטי תורה/.test(title)) return 'maamarim';
  if (/שלחן|שולחן|הלכ|פסקי|שו״ת/.test(title)) return 'halacha';
  if (/סדור|סידור|תפל/.test(title)) return 'siddur';
  if (/מנהג/.test(title)) return 'minhagim';
  if (/יומן|רשימ/.test(title)) return 'diaries';
  if (/תולדות|זכרונות|ספר השיחות|בית רבי/.test(title)) return 'history';
  return 'chassidus';
}

const short = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const clip = (text: string) => text.slice(0, 500);

export function hebrewBooksImporter(input: HebrewBooksInput | (() => Promise<HebrewBooksInput>)): Importer {
  return {
    id: 'hebrewbooks',
    bot: { id: 'bot:hebrewbooks', displayName: 'HebrewBooks shelf importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const { shelf, authors } = typeof input === 'function' ? await input() : input;
      yield { key: HEBREWBOOKS_SET.key, type: 'set', path: HEBREWBOOKS_SET.path, data: { name: HEBREWBOOKS_SET.name, slug: 'hebrewbooks', policy: 'moderated', keepers: [] } };
      const works: ImportRecord[] = [];
      const publications: ImportRecord[] = [];
      const genres = new Set<Genre>();
      const seen = new Set<number>();
      for (const author of shelf.authors) {
        for (const series of author.series) {
          let workKey: string;
          if (series.workId) workKey = `sichos-kodesh-work:${series.workId}`;
          else {
            const id = short(`${author.authorId ?? 'other'}\u0000${quotes(series.title)}`);
            const genre = genreOfTitle(series.title);
            genres.add(genre);
            workKey = `hebrewbooks-series:${id}`;
            works.push({
              key: workKey,
              type: 'work',
              path: `/hebrewbooks/series/${id}`,
              data: {
                title: { he: clip(series.title) },
                slug: `hebrewbooks-${id}`,
                authors: author.authorId && authors.has(author.authorId) ? [ref(`sichos-kodesh-author:${author.authorId}`)] : [],
                genre,
                levels: ['volume'],
                sets: [ref(`rebbehub-set:${genre}`), ref(HEBREWBOOKS_SET.key)],
                sourceCopies: [{ source: 'hebrewbooks', sourceId: series.title, kind: 'scan', licence: 'site-terms' }],
              },
            });
          }
          for (const scan of series.scans) {
            if (seen.has(scan.id)) continue; // a book the catalog lists under two authors is one publication
            seen.add(scan.id);
            const { place, year } = printedAt(scan.printed);
            publications.push({
              key: `hebrewbooks:${scan.id}`,
              type: 'publication',
              path: `/hebrewbooks/${scan.id}`,
              data: {
                kind: 'book-volume',
                title: { he: clip(scan.title) } satisfies LocalName,
                work: ref(workKey),
                ...(scan.volume ? { volume: scan.volume.slice(0, 50) } : {}),
                ...(place ? { placePrinted: place } : {}),
                ...(year ? { date: String(year) } : {}),
                ...(scan.pages && scan.pages > 0 ? { pageCount: scan.pages } : {}),
                identifiers: { hebrewbooks: String(scan.id) },
                sets: [ref(HEBREWBOOKS_SET.key)],
                externalIds: { hebrewbooks: String(scan.id) },
                sources: [{ source: 'hebrewbooks', sourceId: String(scan.id), url: `${HEBREWBOOKS}/${scan.id}`, note: `Otzaria's HebrewBooks catalog, version ${shelf.catalogVersion}` }],
              },
            });
          }
        }
      }
      // The genre sets, as the works importer makes them (the same records: nothing changes if they are there).
      for (const genre of [...genres].sort()) yield { key: `rebbehub-set:${genre}`, type: 'set', path: `/sets/${genre}`, data: { name: GENRE_NAMES[genre], slug: genre, policy: 'moderated', keepers: [] } };
      yield* works;
      yield* publications;
    },
  };
}
