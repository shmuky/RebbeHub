import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidDateKey } from '@rebbehub/hebrew';
import { jemAudioUrl, type EventLink, type EventLinkKind, type LocalName } from '@rebbehub/model';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { SICHOS_KODESH_MEDIA_PROXY } from './driveLinks.js';
import { mafteiachBody, mafteiachLinks, type MafteiachRecord } from './mafteiachIndex.js';

export { SICHOS_KODESH_MEDIA_PROXY };

/**
 * Every farbrengen Sichos-Kodesh knows, with its recordings and its
 * hanachos: the per-year catalog its app is built from
 * (apps/web/src/catalog/data/<year>.json, made by its packages/catalog from
 * the mafteiach.app crawl). Read from a Sichos-Kodesh checkout at run time -
 * RebbeHub keeps no copy - and turned into events, one recording per part,
 * and links to the PDFs. The audio and the PDFs stay where they are: each
 * PDF is linked at its own address on Google Drive (driveLinks.ts), which
 * the site reads through RebbeHub's API; the recordings play from JEM's
 * own CDN, the files ashreinu.app plays.
 */

/** Sichos-Kodesh's catalog schema 1 (its packages/catalog/src/types.ts), as far as this reads it. */
interface CatalogAudio {
  workerFilename: string;
  durationMs: number;
  kind?: 'shiur' | 'chazara';
  chapterName?: string;
  chapterNameHe?: string;
}
interface CatalogPdf {
  section: 'mugah' | 'biltiMugah' | 'maamorim' | 'hagahos' | 'hosofos';
  label: string;
  driveFileId: string;
  resourceKey?: string;
}
export interface CatalogEntry {
  occasionId: number;
  hebrewYear: number;
  /** `5711-05-10`, with a letter for a second occasion that day (`5711-01-09b`) and day `00` when unknown. */
  hebrewDate: string;
  occasionLabel: string;
  occasionLabelEn?: string;
  audio: CatalogAudio[];
  pdfs: CatalogPdf[];
}

export const FARBRENGENS_SET = { key: 'rebbehub-set:farbrengens', path: '/sets/farbrengens', name: { he: 'התוועדויות', en: 'Farbrengens' } } as const;

const LINK_KINDS: Record<CatalogPdf['section'], EventLinkKind> = {
  mugah: 'mugah',
  biltiMugah: 'bilti-mugah',
  maamorim: 'maamar',
  hagahos: 'hagahos',
  hosofos: 'hosofos',
};

/** Hanachos first, as the app shows them, then the rest in Sichos-Kodesh's order, then what only the index has. */
const LINK_ORDER: EventLinkKind[] = ['bilti-mugah', 'mugah', 'maamar', 'hagahos', 'hosofos', 'english', 'video', 'audio', 'other'];

const DATE = /^(\d{4})-(0[1-9]|1[0-2]|06A|06B)-(\d{2})([a-z]?)$/;

/** The date key and the order among the day's events, from mafteiach's date (`5711-01-09b` → `5711-01-09`, 1). */
export function occasionDate(hebrewDate: string): { date: string; order: number; path: string } | null {
  const m = DATE.exec(hebrewDate);
  if (!m) return null;
  const [, year, month, day, letter] = m;
  // A day mafteiach knows but the calendar lacks (30 Elul in a year whose Elul has 29 days) keeps only its month.
  const day_ = `${year}-${month}-${day}`;
  const date = day !== '00' && isValidDateKey(day_) ? day_ : `${year}-${month}`;
  const order = letter ? letter.charCodeAt(0) - 'a'.charCodeAt(0) : 0;
  return { date, order, path: `/events/${hebrewDate.toLowerCase()}` };
}

/** The exact file on Google Drive, as mafteiach links it. */
export const driveOrigin = (pdf: Pick<CatalogPdf, 'driveFileId' | 'resourceKey'>) =>
  `https://drive.google.com/file/d/${encodeURIComponent(pdf.driveFileId)}/view${pdf.resourceKey ? `?resourcekey=${encodeURIComponent(pdf.resourceKey)}` : ''}`;

/** A JEM recording's address: the file on Ashreinu's CDN, where JEM serves it (model's jemAudio.ts). */
export const audioUrl = (file: string) => jemAudioUrl(file);

/** A PDF's address on the media proxy, as imports before stored it (`rebbehub relink-drive` replaces these with `driveOrigin`). */
export const pdfUrl = (pdf: Pick<CatalogPdf, 'driveFileId' | 'resourceKey'>, proxy = SICHOS_KODESH_MEDIA_PROXY) =>
  `${proxy}/drive/${encodeURIComponent(pdf.driveFileId)}?filename=${encodeURIComponent(pdf.driveFileId)}.pdf${pdf.resourceKey ? `&resourcekey=${encodeURIComponent(pdf.resourceKey)}` : ''}`;

/** Names are kept to the catalog's 500 characters, cut at a word. */
const MAX_NAME = 500;
const clip = (text: string) => (text.length <= MAX_NAME ? text : `${text.slice(0, text.lastIndexOf(' ', MAX_NAME - 1) > 0 ? text.lastIndexOf(' ', MAX_NAME - 1) : MAX_NAME - 1)}…`);
const localName = (he: string, en?: string): LocalName => (en ? { he: clip(he), en: clip(en) } : { he: clip(he) });

/** Reads every year of the catalog from a Sichos-Kodesh checkout. */
export async function readSichosKodeshOccasions(root: string): Promise<CatalogEntry[]> {
  const dir = join(root, 'apps/web/src/catalog/data');
  const files = (await readdir(dir)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`no catalog years in ${dir}: is ${root} a Sichos-Kodesh checkout?`);
  const entries: CatalogEntry[] = [];
  for (const file of files) entries.push(...(JSON.parse(await readFile(join(dir, file), 'utf8')) as CatalogEntry[]));
  return entries;
}

/**
 * With `mafteiach` (a crawl of the index, mafteiachIndex.ts), every farbrengen
 * also gets the index's links the catalog left out, and its content outline
 * as the page's words; a farbrengen only the index knows gets a page too.
 */
export function sichosKodeshOccasionsImporter(
  input: CatalogEntry[] | (() => Promise<CatalogEntry[]>),
  options: { mafteiach?: MafteiachRecord[] | (() => Promise<MafteiachRecord[]>) } = {},
): Importer {
  return {
    id: 'sichos-kodesh-occasions',
    bot: { id: 'bot:sichos-kodesh-occasions', displayName: 'Sichos-Kodesh farbrengens importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const entries = typeof input === 'function' ? await input() : input;
      const index = new Map((typeof options.mafteiach === 'function' ? await options.mafteiach() : (options.mafteiach ?? [])).map((r) => [r.id, r]));
      // A farbrengen only the index knows is still a farbrengen: it comes in with nothing but what the index has.
      const known = new Set(entries.map((e) => e.occasionId));
      for (const r of index.values()) {
        if (!known.has(r.id)) entries.push({ occasionId: r.id, hebrewYear: r.hebrewYear, hebrewDate: r.hebrewDate, occasionLabel: r.occasionLabel, audio: [], pdfs: [] });
      }
      yield { key: FARBRENGENS_SET.key, type: 'set', path: FARBRENGENS_SET.path, data: { name: FARBRENGENS_SET.name, slug: 'farbrengens', policy: 'moderated', keepers: [] } };
      for (const entry of entries) {
        const when = occasionDate(entry.hebrewDate);
        if (!when) continue; // a date mafteiach itself could not place
        const key = `mafteiach-occasion:${entry.occasionId}`;
        const record = index.get(entry.occasionId);
        const drive = (driveFileId: string, url: string) => driveOrigin({ driveFileId, resourceKey: new URL(url).searchParams.get('resourcekey') ?? undefined });
        const links: EventLink[] = [
          // The file on Drive, as the mafteiach links it, is both where it is read from and its origin.
          ...entry.pdfs.map((pdf) => ({ kind: LINK_KINDS[pdf.section] ?? 'other', label: localName(pdf.label), url: driveOrigin(pdf), source: 'mafteiach' as const, origin: driveOrigin(pdf) })),
          ...(record ? mafteiachLinks(record, new Set(entry.pdfs.map((p) => p.driveFileId)), drive) : []),
        ].sort((a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind));
        const body = record ? mafteiachBody(record) : null;
        yield {
          key,
          type: 'event',
          path: when.path,
          data: {
            kind: 'farbrengen',
            title: localName(entry.occasionLabel, entry.occasionLabelEn),
            date: when.date,
            ...(when.order ? { order: when.order } : {}),
            ...(links.length ? { links } : {}),
            ...(body ?? {}),
            sets: [ref(FARBRENGENS_SET.key)],
            externalIds: { mafteiach: String(entry.occasionId) },
            sources: [{ source: 'mafteiach', sourceId: String(entry.occasionId) }],
          },
        };
        for (const [i, audio] of entry.audio.entries()) {
          const he = audio.chapterNameHe ?? audio.chapterName ?? `חלק ${i + 1}`;
          yield {
            key: `mafteiach-recording:${entry.occasionId}/${i + 1}`,
            type: 'recording',
            data: {
              event: ref(key),
              title: localName(he, audio.chapterName),
              url: audioUrl(audio.workerFilename),
              durationMs: audio.durationMs,
              part: i + 1,
              // A shiur or chazara is someone else's voice; without `kind` it is the Rebbe's own.
              ...(audio.kind ? { note: audio.kind } : { language: 'yi' }),
              sources: [{ source: 'jem', sourceId: audio.workerFilename }],
            },
          };
        }
      }
    },
  };
}
