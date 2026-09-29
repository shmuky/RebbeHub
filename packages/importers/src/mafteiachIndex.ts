import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { plainInline, type EventLink, type EventLinkKind, type LocalName, type PageSegment, type PageText } from '@rebbehub/model';

/**
 * Everything mafteiach.app's index has for a farbrengen, as Sichos-Kodesh's
 * crawler (its packages/mafteiach-index, `npm run crawl`) writes it: one
 * JSON file per Hebrew year. Sichos-Kodesh's app keeps only the Google
 * Drive PDFs and the JEM recordings it can play; RebbeHub keeps every
 * link besides - HebrewBooks, chabad.org, sie.org, YouTube, JEM videos,
 * the English translations, the reshimos - and the index's own content
 * outline (תוכן ענינים) and additions as the page's words, recorded as
 * imported from the mafteiach index. The crawl is made at import time
 * (.github/workflows/import.yml); RebbeHub keeps no copy.
 */

export const MAFTEIACH = 'https://www.mafteiach.app';

interface LinkRef {
  label: string;
  url: string;
  group?: string;
}
interface LinkSection {
  links: LinkRef[];
}
interface NoteSection {
  text: string | null;
  links: LinkRef[];
}
export interface MafteiachRecord {
  id: number;
  hebrewYear: number;
  hebrewDate: string;
  isPreNesius: boolean;
  occasionLabel: string;
  detail: {
    biltiMugah: LinkSection;
    mugah: LinkSection;
    maamorim: LinkSection;
    english: LinkSection;
    hagahos: LinkSection;
    audio: LinkSection;
    video: LinkSection & { youtubeIds: string[] };
    tochenInyanim: NoteSection;
    hosofos: NoteSection;
  };
}

/** Reads a crawl's year files (`<year>.json`). */
export async function readMafteiachCrawl(dir: string): Promise<MafteiachRecord[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`no mafteiach crawl in ${dir}`);
  const records: MafteiachRecord[] = [];
  for (const file of files) records.push(...(JSON.parse(await readFile(join(dir, file), 'utf8')) as MafteiachRecord[]));
  return records;
}

/** Where a farbrengen is on mafteiach.app: its year's page (the site has no page of its own for one; years before 5710 share one). */
export const mafteiachPage = (record: Pick<MafteiachRecord, 'hebrewYear'>) => `${MAFTEIACH}/all/by_year/${record.hebrewYear < 5710 ? '5690_5710' : record.hebrewYear}`;

/** A Google Drive file's id, in either of the shapes mafteiach links it (`/file/d/<id>/…`, `open?id=<id>`). */
export function driveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'drive.google.com') return null;
    const id = /\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
    return id && /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** mafteiach's labels carry its page's icon names and line breaks ("ראה מאמר\n expand_more"). */
const tidy = (text: string) => text.replace(/\bexpand_(more|less)\b/g, '').replace(/\s+/g, ' ').trim();

const SECTIONS: Array<[keyof MafteiachRecord['detail'], EventLinkKind]> = [
  ['biltiMugah', 'bilti-mugah'],
  ['mugah', 'mugah'],
  ['maamorim', 'maamar'],
  ['hagahos', 'hagahos'],
  ['hosofos', 'hosofos'],
  ['english', 'english'],
  ['audio', 'audio'],
  ['video', 'video'],
];

/**
 * Every link the index has for a farbrengen that is not already among
 * `known` (the Drive files Sichos-Kodesh's catalog brought). Drive PDFs are
 * read through `drive` (the media proxy, so they open in the site's own
 * reader); every other link goes where it is.
 */
export function mafteiachLinks(record: MafteiachRecord, known: Set<string>, drive: (fileId: string, url: string) => string): EventLink[] {
  const out: EventLink[] = [];
  const seen = new Set<string>();
  const add = (kind: EventLinkKind, label: string, url: string, origin?: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ kind, label: { he: label.slice(0, 500) }, url, source: 'mafteiach', ...(origin && origin !== url ? { origin } : {}) });
  };
  for (const [section, kind] of SECTIONS) {
    for (const link of (record.detail[section] as LinkSection | undefined)?.links ?? []) {
      const label = tidy([link.group, link.label].filter(Boolean).join(' · ')) || kind;
      const url = link.url.startsWith('/') ? `${MAFTEIACH}${link.url}` : link.url;
      if (!/^https?:\/\//.test(url)) continue;
      const fileId = driveFileId(url);
      if (fileId && known.has(fileId)) continue;
      add(kind, label, fileId ? drive(fileId, url) : url, url);
    }
  }
  for (const id of record.detail.video?.youtubeIds ?? []) {
    if (/^[\w-]{6,20}$/.test(id)) add('video', 'YouTube', `https://www.youtube.com/watch?v=${id}`);
  }
  return out;
}

/**
 * Plain text as an outline section: its title, then one item per line,
 * taken literally; a line the index numbers (`1. הפיכת העינוי`) keeps its
 * number as the item's.
 */
function outlineSection(id: string, title: string, text: string): PageSegment {
  const children: PageSegment[] = [];
  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const numbered = /^(\d{1,4})[.)]\s+(.+)$/.exec(line);
    children.push({ id: `${id}.${children.length + 1}`, kind: 'item', ...(numbered ? { n: Number(numbered[1]) } : {}), text: plainInline(numbered ? numbered[2]! : line) });
  }
  return { id, kind: 'section', text: plainInline(title), children };
}

/** The index's content outline and additions, as the page's words (an outline), and the record of where they came from. */
export function mafteiachBody(record: MafteiachRecord): { body: PageText; bodySource: Record<string, string> } | null {
  const segments: PageSegment[] = [];
  const outline = record.detail.tochenInyanim?.text?.trim();
  const additions = record.detail.hosofos?.text?.trim();
  if (outline) segments.push(outlineSection('contents', OUTLINE.he, outline));
  if (additions) segments.push(outlineSection('additions', ADDITIONS.he, additions));
  if (!segments.length) return null;
  return {
    body: { profile: 'outline', versions: [{ id: 'he', language: 'he', segments }] },
    bodySource: { source: 'mafteiach', via: 'mafteiach-index', sourceId: String(record.id), url: mafteiachPage(record), credit: 'mafteiach.app', rights: 'credit' },
  };
}

const OUTLINE: LocalName = { he: 'תוכן ענינים', en: 'Contents' };
const ADDITIONS: LocalName = { he: 'הוספות', en: 'Additions' };
