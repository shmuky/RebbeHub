import type { Context, Hono } from 'hono';
import { getFile, registerFile, type Catalog, type Json } from '@rebbehub/core';
import type { EntityId, FileClass, Licence } from '@rebbehub/model';
import { isEntityId, mayServe } from '@rebbehub/model';
import { HttpError } from './app.js';

/**
 * "Add a recording" and "Add a scan" (the plan, section 7): a signed-in
 * person sends a file with the item it belongs to and a rights statement.
 * The file is stored once, by its sha256 ("we already have this — here"),
 * in the public bucket when its rights let it be served and in the
 * preservation bucket when they do not (never served); then a suggestion
 * adds it to the catalog, for the set's keepers to approve like any other.
 */

export interface ObjectWriter {
  put(key: string, bytes: ArrayBuffer, mime: string): Promise<void>;
}

export interface UploadOptions {
  public: ObjectWriter;
  preservation: ObjectWriter;
  /** The largest file taken in one request; Workers hold it in memory to hash it. */
  maxBytes?: number;
}

/** What the uploader says about the file's rights, and what the rights policy (docs/rights.md) makes of it. */
export const RIGHTS_STATEMENTS = {
  // I scanned or recorded it myself and give it freely.
  mine: { licence: 'cc0', note: 'I made this copy myself and give it freely (CC0).' },
  // Printed or recorded for free distribution (a teshura, a free booklet): served with credit.
  free: { licence: 'unknown', fileClass: 'teshura-scan', note: 'It was printed or recorded for free distribution.' },
  // Old enough, or released, to be anyone's.
  'public-domain': { licence: 'public-domain', note: 'It is in the public domain.' },
  // Not sure: kept privately until a steward decides.
  unsure: { licence: 'unknown', note: 'I am not sure who holds its rights.' },
} as const satisfies Record<string, { licence: Licence; fileClass?: FileClass; note: string }>;

export type RightsStatement = keyof typeof RIGHTS_STATEMENTS;

const AUDIO = /^audio\/(mpeg|mp4|ogg|opus|wav|x-wav|flac|webm|aac)$/;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uploadRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, stores: UploadOptions | undefined): void {
  const maxBytes = stores?.maxBytes ?? 50 * 1024 * 1024;

  /** Where a file is already used: the items whose `file` is it. */
  const usedBy = async (sha256: string) => {
    const { rows } = await catalog.db.query<{ id: string; type: string; path: string | null }>(
      "SELECT e.id, e.type, e.path FROM entity e JOIN revision r ON r.id = e.main_rev WHERE r.data->>'file' = $1 AND NOT e.deleted LIMIT 10",
      [sha256],
    );
    return rows;
  };

  app.post('/v1/uploads', async (c) => {
    const by = await signedIn(c);
    if (!stores) throw new HttpError(422, 'uploads are not set up on this server');
    const what = c.req.query('what');
    const target = c.req.query('for') ?? '';
    const statement = c.req.query('rights') as RightsStatement | undefined;
    const title = (c.req.query('title') ?? '').trim().slice(0, 300);
    if (what !== 'recording' && what !== 'scan') throw new HttpError(400, 'what is recording or scan');
    if (!isEntityId(target)) throw new HttpError(400, 'say which item the file belongs to (for)');
    if (!statement || !(statement in RIGHTS_STATEMENTS)) throw new HttpError(400, `rights is one of ${Object.keys(RIGHTS_STATEMENTS).join(', ')}`);
    const mime = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (what === 'recording' && !AUDIO.test(mime)) throw new HttpError(400, 'a recording is an audio file');
    if (what === 'scan' && mime !== 'application/pdf') throw new HttpError(400, 'a scan is a PDF');
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (declared > maxBytes) throw new HttpError(422, `files up to ${Math.round(maxBytes / 1024 / 1024)} MB for now`);

    const item = await catalog.get(target as EntityId);
    if (!item) throw new HttpError(404, `no item ${target}`);
    if (what === 'recording' && item.type !== 'event') throw new HttpError(400, 'a recording is added to a farbrengen');
    if (what === 'scan' && item.type !== 'work') throw new HttpError(400, 'a scan is added to a sefer');

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) throw new HttpError(400, 'the file is empty');
    if (bytes.byteLength > maxBytes) throw new HttpError(422, `files up to ${Math.round(maxBytes / 1024 / 1024)} MB for now`);
    const sha256 = await sha256Of(bytes);

    // We already have it: say where, and add nothing twice.
    if (await getFile(catalog.db, sha256)) return c.json({ sha256, existed: true, usedBy: await usedBy(sha256) });

    const rights = RIGHTS_STATEMENTS[statement];
    const fileClass: FileClass = 'fileClass' in rights ? rights.fileClass : what === 'recording' ? 'recording' : 'other';
    const itemData = item.data as Record<string, unknown>;
    // The bytes first, where their rights put them (named by content, so a retry writes the same object).
    const { file } = await registerFile(catalog.db, {
      sha256,
      bytes: bytes.byteLength,
      mime,
      source: 'contribution',
      licence: rights.licence,
      fileClass,
      uploadedBy: by,
      attestation: rights.note,
      held: true,
    });
    if (file.storage_tier === 'public') await stores.public.put(`objects/${sha256}`, bytes, mime);
    else await stores.preservation.put(`objects/${sha256}`, bytes, mime);

    // Then the suggestion that adds it to the catalog.
    const name = title || ((itemData.title as { he?: string } | undefined)?.he ?? '');
    // In the item's sets, so their keepers review it.
    const sets = Array.isArray(itemData.sets) ? { sets: itemData.sets as Json } : {};
    const suggestion = await catalog.createChangeset(by, { title: what === 'recording' ? `הוספת הקלטה: ${name}` : `הוספת סריקה: ${name}` });
    if (what === 'recording') {
      await catalog.putRevision(suggestion.id, by, { type: 'recording', data: { event: item.id, title: { he: name || 'הקלטה' }, file: sha256, ...sets } as Json });
    } else {
      const publication = await catalog.putRevision(suggestion.id, by, {
        type: 'publication',
        data: { kind: 'book-volume', title: { he: name || 'סריקה' }, work: item.id, ...sets } as Json,
      });
      await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication, file: sha256, completeness: 'unknown', ...sets } as Json });
    }
    const sent = await catalog.submit(suggestion.id, by);
    return c.json({ sha256, existed: false, rights: file.rights_state, served: mayServe(file.rights_state) && file.storage_tier === 'public', suggestion: sent.id }, 201);
  });
}
