import { createHash } from 'node:crypto';
import { orderKeys, type Genre, type LocalName } from '@rebbehub/model';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { pdfUrl, SICHOS_KODESH_MEDIA_PROXY } from './sichosKodeshOccasions.js';
import { GENRE_NAMES } from './sichosKodeshWorks.js';

/**
 * Otzros HaRebbe's library of Lubavitch seforim (ספרי ליובאוויטש): a
 * public Google Drive folder of PDFs, a folder per sefer. Each folder that
 * holds PDFs becomes a sefer on RebbeHub and each PDF a page of it, linking
 * to its exact file on Drive and read in the site's own reader through
 * Sichos-Kodesh's media proxy. Nothing is copied: the folders are listed
 * at import time from Drive's public folder view.
 */

export const OTZROS_FOLDER: DriveEntry = { title: 'ספרי ליובאוויטש', id: '0B_WSU737WJ1ffjFrTGFlMjBDdW44eU1yNkpLOHJHY0JRTWh3dU5BcFhZMV81Zmphc1J6VDQ', resourceKey: '0-OGquHQDd2VMz957qpqEEGA' };

export const OTZROS_SET = { key: 'rebbehub-set:otzros', path: '/sets/otzros', name: { he: 'ספרי ליובאוויטש (אוצרות הרבי)', en: 'Lubavitch seforim (Otzros HaRebbe)' } } as const;

export interface DriveEntry {
  id: string;
  title: string;
  resourceKey?: string;
}
export interface DriveFolder extends DriveEntry {
  folders: DriveFolder[];
  files: DriveEntry[];
}

const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** One folder's entries, from Drive's public folder view. */
export function parseFolderView(html: string): { folders: DriveEntry[]; files: DriveEntry[] } {
  const folders: DriveEntry[] = [];
  const files: DriveEntry[] = [];
  for (const m of html.matchAll(/<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)) {
    const [, id, link, title] = m;
    const href = decode(link!);
    const resourceKey = /[?&]resourcekey=([\w-]+)/.exec(href)?.[1];
    const entry: DriveEntry = { id: id!, title: decode(title!).trim(), ...(resourceKey ? { resourceKey } : {}) };
    if (href.includes('/folders/')) folders.push(entry);
    else files.push(entry);
  }
  return { folders, files };
}

/** The whole folder tree under `root`, a few folders at a time. */
export async function listDriveFolder(root: DriveEntry, options: { fetch?: typeof fetch; concurrency?: number; log?: (line: string) => void } = {}): Promise<DriveFolder> {
  const get = options.fetch ?? fetch;
  let read = 0;
  const list = async (entry: DriveEntry): Promise<DriveFolder> => {
    const url = `https://drive.google.com/embeddedfolderview?id=${entry.id}${entry.resourceKey ? `&resourcekey=${entry.resourceKey}` : ''}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await get(url);
        if (!response.ok) throw new Error(`answered ${response.status}`);
        const { folders, files } = parseFolderView(await response.text());
        if (++read % 200 === 0) options.log?.(`${read} Drive folders listed`);
        return { ...entry, files, folders: folders.map((f) => ({ ...f, folders: [], files: [] })) };
      } catch (error) {
        if (attempt >= 4) throw new Error(`Drive folder ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  };
  const top: DriveFolder = { ...root, folders: [], files: [] };
  const queue: DriveFolder[] = [top];
  let busy = 0;
  // A few workers; each lists one folder and queues its sub-folders, until none is left and none is being listed.
  await Promise.all(
    Array.from({ length: options.concurrency ?? 4 }, async () => {
      for (;;) {
        const folder = queue.shift();
        if (!folder) {
          if (!busy) return;
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        busy++;
        try {
          Object.assign(folder, await list(folder));
          queue.push(...folder.folders);
        } finally {
          busy--;
        }
      }
    }),
  );
  options.log?.(`${read} Drive folders listed`);
  return top;
}

/** The library's top folders ("1. תורת כ"ק אד"ש" …), as genres. */
function genreOf(top: string): Genre {
  if (/תורת כ"ק|אד"ש/.test(top)) return 'sichos';
  if (/הלכה|מנהג/.test(top)) return 'halacha';
  if (/בית הרב|תולדות|סיפורים|שונות/.test(top)) return 'history';
  return 'chassidus';
}

const short = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12);
const clip = (text: string) => text.slice(0, 500);
/** "05 בראשית.pdf" → "05 בראשית". */
const nameOf = (file: string) => file.replace(/\.pdf$/i, '').trim() || file;
const natural = new Intl.Collator('he', { numeric: true });

export const driveViewUrl = (file: DriveEntry) => `https://drive.google.com/file/d/${file.id}/view${file.resourceKey ? `?resourcekey=${file.resourceKey}` : ''}`;

export function driveLibraryImporter(input: DriveFolder | (() => Promise<DriveFolder>), options: { proxy?: string } = {}): Importer {
  const proxy = options.proxy ?? SICHOS_KODESH_MEDIA_PROXY;
  return {
    id: 'otzros',
    bot: { id: 'bot:otzros', displayName: 'Otzros HaRebbe library importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const root = typeof input === 'function' ? await input() : input;
      yield { key: OTZROS_SET.key, type: 'set', path: OTZROS_SET.path, data: { name: OTZROS_SET.name, slug: 'otzros', policy: 'moderated', keepers: [] } };
      const genres = new Set<Genre>();
      const works: ImportRecord[] = [];
      const units: ImportRecord[] = [];
      const walk = (folder: DriveFolder, trail: string[], genre: Genre) => {
        const pdfs = folder.files.filter((f) => /\.pdf$/i.test(f.title)).sort((a, b) => natural.compare(a.title, b.title));
        if (pdfs.length) {
          genres.add(genre);
          const key = `otzros-work:${folder.id}`;
          const slug = `otzros-${short(folder.id)}`;
          const path = `/otzros/${short(folder.id)}`;
          // A folder named only by a year or a number ("5727") is named with the folder it is in.
          const bare = !/[\p{L}]/u.test(folder.title.replace(/^\d+[.)]\s*/, '')) && trail.length > 0;
          const title: LocalName = { he: clip(bare ? `${trail[trail.length - 1]!.replace(/^\d+[.)]\s*/, '')} ${folder.title}` : folder.title) };
          works.push({
            key,
            type: 'work',
            path,
            data: {
              title,
              slug,
              authors: [],
              genre,
              levels: ['volume'],
              sets: [ref(`rebbehub-set:${genre}`), ref(OTZROS_SET.key)],
              ...(trail.length ? { description: { he: clip(trail.join(' / ')) } } : {}),
              externalIds: { 'drive-folder': folder.id },
              // The folder on Drive, as the copy's id: a link is its own address.
              sourceCopies: [{ source: 'other', sourceId: `https://drive.google.com/drive/folders/${folder.id}${folder.resourceKey ? `?resourcekey=${folder.resourceKey}` : ''}`, kind: 'pdf', licence: 'free-to-read', credit: 'אוצרות הרבי' }],
            },
          });
          const orders = orderKeys(pdfs.length);
          pdfs.forEach((file, i) => {
            units.push({
              key: `otzros-unit:${file.id}`,
              type: 'unit',
              path: `${path}/${i + 1}`,
              data: {
                work: ref(key),
                position: [{ level: 'volume', value: String(i + 1) }],
                order: orders[i]!,
                label: { he: clip(pdfs.length === 1 ? folder.title : nameOf(file.title)) },
                externalIds: { 'drive-file': file.id },
                editions: [
                  // Read in the site's reader through the media proxy; the exact file on Drive is the source.
                  { source: 'other', sourceId: file.id, kind: 'pdf', licence: 'free-to-read', credit: 'אוצרות הרבי', label: 'reader', url: pdfUrl({ driveFileId: file.id, resourceKey: file.resourceKey }, proxy) },
                  { source: 'other', sourceId: file.id, kind: 'pdf', licence: 'free-to-read', credit: 'אוצרות הרבי', label: 'drive', url: driveViewUrl(file) },
                ],
              },
            });
          });
        }
        for (const sub of [...folder.folders].sort((a, b) => natural.compare(a.title, b.title))) walk(sub, [...trail, folder.title], genre);
      };
      for (const top of root.folders) walk(top, [], genreOf(top.title));
      // The genre sets, as the works importer makes them (the same records: nothing changes if they are there).
      for (const genre of genres) yield { key: `rebbehub-set:${genre}`, type: 'set', path: `/sets/${genre}`, data: { name: GENRE_NAMES[genre], slug: genre, policy: 'moderated', keepers: [] } };
      yield* works;
      yield* units;
    },
  };
}
