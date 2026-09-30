/**
 * Files on Google Drive the catalog links to (a hanacha's PDF, an Otzros
 * scan, a recording). The catalog keeps each file's own Drive address; the
 * reader and the player read its bytes through RebbeHub's API
 * (`GET /v1/drive/<id>`), which answers other pages and parts of a file as
 * Drive does not. An address on Sichos-Kodesh's media proxy, which older
 * imports stored, is read the same way until `rebbehub relink-drive`
 * replaces it.
 */

const DRIVE_ID = /^[\w-]{10,64}$/;

/** The Drive file id of an address, or null when it is not one. */
export function driveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | null | undefined = null;
    if (u.hostname === 'drive.google.com') id = /^\/file\/d\/([^/]+)/.exec(u.pathname)?.[1] ?? (u.pathname === '/open' || u.pathname === '/uc' ? u.searchParams.get('id') : null);
    else if (u.hostname === 'sichos-kodesh-media-proxy.shmuky.workers.dev') id = /^\/drive\/([^/]+)$/.exec(u.pathname)?.[1];
    return id && DRIVE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Where the reader or player fetches a Drive file's bytes: the API's own route. Null when the address is not a Drive file. */
export function driveReadUrl(url: string, apiBase: string): string | null {
  const id = driveFileId(url);
  return id ? `${apiBase.replace(/\/+$/, '')}/v1/drive/${id}` : null;
}

/**
 * A printing's PDF copy on Drive, when one of its sources is a Drive file
 * (the Otzros library's PDFs, added as printings of the sefer they copy):
 * read in the site's reader like a scan, though RebbeHub keeps no file of it.
 */
export function driveCopyOf(sources: unknown): { url: string; credit: string | null } | null {
  if (!Array.isArray(sources)) return null;
  for (const s of sources as Array<{ url?: unknown; note?: unknown }>) {
    if (typeof s?.url === 'string' && driveFileId(s.url)) return { url: s.url, credit: typeof s.note === 'string' ? s.note : null };
  }
  return null;
}
