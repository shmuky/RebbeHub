import { one, type Db } from '@rebbehub/db';
import type { Json } from './merge.js';

/**
 * The Google Drive files the catalog links to (migration 0020): every
 * Drive file address in an item on main, kept as main changes. The API
 * reads a public Drive file for the site's reader and player
 * (`GET /v1/drive/<id>`, services/api/src/drive.ts) only when it is one of
 * these, so it is never a way to fetch any file from Drive.
 *
 * Found in any of the shapes the catalog has held them: the file's own
 * address (`drive.google.com/file/d/<id>/view`, `…/open?id=<id>`,
 * `…/uc?id=<id>`), and Sichos-Kodesh's media proxy's
 * (`…workers.dev/drive/<id>`), which older imports stored. A resource key
 * with it is kept, since Drive gives such a file only with its key.
 */

const DRIVE_ID = /^[A-Za-z0-9_-]{10,64}$/;
const RESOURCE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export interface DriveFileLink {
  id: string;
  resourceKey: string | null;
}

/** The Drive file an address is, or null. */
export function driveFileOf(url: string): DriveFileLink | null {
  if (!url.includes('drive')) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let id: string | null | undefined = null;
  if (u.hostname === 'drive.google.com' || u.hostname === 'docs.google.com' || u.hostname === 'drive.usercontent.google.com') {
    id = /\/file\/d\/([^/]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
  } else if (u.hostname.endsWith('.workers.dev')) {
    id = /^\/drive\/([^/]+)$/.exec(u.pathname)?.[1];
  }
  if (!id || !DRIVE_ID.test(id)) return null;
  const key = u.searchParams.get('resourcekey');
  return { id, resourceKey: key && RESOURCE_KEY.test(key) ? key : null };
}

/** Every Drive file an item's data links to, once each (with a resource key when any of its links has one). */
export function driveFilesOf(data: Json | null): DriveFileLink[] {
  const found = new Map<string, DriveFileLink>();
  const walk = (value: Json | null | undefined) => {
    if (typeof value === 'string') {
      const file = driveFileOf(value);
      if (file && (!found.has(file.id) || (file.resourceKey && !found.get(file.id)!.resourceKey))) found.set(file.id, file);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(data);
  return [...found.values()];
}

/** A Drive file the catalog links to, with its resource key; null when no item on main links to it. */
export async function knownDriveFile(db: Db, fileId: string): Promise<DriveFileLink | null> {
  if (!DRIVE_ID.test(fileId)) return null;
  const row = await one<{ file_id: string; resource_key: string | null }>(
    db,
    'SELECT file_id, resource_key FROM drive_file WHERE file_id = $1 ORDER BY resource_key IS NULL LIMIT 1',
    [fileId],
  );
  return row ? { id: row.file_id, resourceKey: row.resource_key } : null;
}
