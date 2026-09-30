/**
 * Links to PDFs on Google Drive, as the catalog stores them: the file's
 * own address on Drive (`https://drive.google.com/file/d/<id>/view`), the
 * link the mafteiach and Otzros HaRebbe give. The site reads a Drive file
 * through RebbeHub's own API (`GET /v1/drive/<id>`, services/api), so what
 * is stored says where the file really is, not how it is fetched.
 *
 * Imports before this stored the address of Sichos-Kodesh's media proxy
 * instead (`https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/<id>?…`);
 * `rebbehub relink-drive` (services/jobs) suggests the Drive link in
 * their place, with `relinkDrive` below.
 */

/** Sichos-Kodesh's media proxy: JEM's recordings are still played through it (`/jem-audio/<file>`); Drive files no longer are. */
export const SICHOS_KODESH_MEDIA_PROXY = 'https://sichos-kodesh-media-proxy.shmuky.workers.dev';

const PROXY_HOST = new URL(SICHOS_KODESH_MEDIA_PROXY).hostname;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,64}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export interface DriveFileRef {
  id: string;
  resourceKey?: string;
}

/** A Drive file's own address, with its resource key when it needs one (links shared before 2021). */
export const driveLink = (file: DriveFileRef): string =>
  `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view${file.resourceKey ? `?resourcekey=${encodeURIComponent(file.resourceKey)}` : ''}`;

/** The Drive file a media proxy address reads (`…workers.dev/drive/<id>?filename=…&resourcekey=…`), or null. */
export function proxiedDriveFile(url: string): DriveFileRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== PROXY_HOST) return null;
  const id = /^\/drive\/([^/]+)$/.exec(u.pathname)?.[1];
  if (!id || !DRIVE_ID.test(id)) return null;
  const resourceKey = u.searchParams.get('resourcekey');
  return { id, ...(resourceKey && RESOURCE_KEY.test(resourceKey) ? { resourceKey } : {}) };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: Json): value is { [key: string]: Json } => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An item's data with every media proxy address of a Drive file replaced
 * by the file's own Drive link; everything else (a link's `origin`, its
 * label, JEM's recordings) as it was. Where a list then holds the same
 * link twice (an Otzros page's `reader` copy beside its `drive` copy),
 * the converted one is dropped and the one that was already there stays.
 * Null when nothing in it points at the proxy.
 */
export function relinkDrive(data: Json): { data: Json; links: number } | null {
  let links = 0;
  const convert = (value: Json): Json => {
    if (typeof value === 'string') {
      const file = proxiedDriveFile(value);
      if (!file) return value;
      links++;
      return driveLink(file);
    }
    if (Array.isArray(value)) {
      const before = value.map((item) => (isObject(item) && typeof item.url === 'string' ? item.url : null));
      const out = value.map(convert);
      const kept = new Set(before.filter((url): url is string => url !== null && !proxiedDriveFile(url)));
      return out.filter((item, i) => {
        const was = before[i];
        if (!was || !proxiedDriveFile(was) || !isObject(item) || typeof item.url !== 'string') return true;
        if (kept.has(item.url)) return false; // the same file is listed already, as it is on Drive
        kept.add(item.url);
        return true;
      });
    }
    if (isObject(value)) {
      const out: { [key: string]: Json } = {};
      for (const [key, v] of Object.entries(value)) out[key] = convert(v);
      return out;
    }
    return value;
  };
  const out = convert(data);
  return links ? { data: out, links } : null;
}
