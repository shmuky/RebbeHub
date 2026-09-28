import type { Context, Hono } from 'hono';
import { getFile, itemsUsingFile, registerFile, teshuraCredit, teshurosSetId, uploadAllowance, type Catalog, type EntityView, type Json } from '@rebbehub/core';
import { one } from '@rebbehub/db';
import { isValidDateKey, parseHebrewYear } from '@rebbehub/hebrew';
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
 *
 * A scan is one of three things, which the form guesses first (POST
 * /v1/uploads/check) and the person confirms (`as`):
 *   scan-of   another scan of a publication the catalog has
 *   printing  a new printing of a sefer: a publication and its scan
 *   teshura   a new teshura, in the Teshuros set, credited to its families
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

export type ScanKind = 'scan-of' | 'printing' | 'teshura';

const AUDIO = /^audio\/(mpeg|mp4|ogg|opus|wav|x-wav|flac|webm|aac)$/;
const SIMCHOS = ['wedding', 'bar-mitzvah', 'bris', 'upsherenish', 'hachnasas-sefer-torah', 'yahrzeit', 'other'] as const;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A year as people give it (`תשמ"ב`, `5742`, `1982`), as a publication's `date` or `gregorianYear`. */
export function yearFields(text: string | undefined): { date?: string; gregorianYear?: number } {
  const value = (text ?? '').trim();
  if (!value) return {};
  if (/^(1[5-9]|2[01])\d\d$/.test(value)) return { gregorianYear: Number(value) };
  if (isValidDateKey(value)) return { date: value };
  const year = parseHebrewYear(value);
  if (year && year >= 5500 && year < 5900) return { date: String(year) };
  throw new HttpError(400, `"${value}" is not a year (תשמ"ב, 5742 or 1982)`);
}

/** Families as typed: "כהן – לוי", "Cohen, Levi", or one to a line. */
export function familiesOf(text: string | undefined): string[] {
  return (text ?? '')
    .split(/\s*(?:[,–—\n]|\s-\s)\s*/)
    .map((f) => f.trim().slice(0, 100))
    .filter((f) => f.length > 0)
    .slice(0, 6);
}

export function uploadRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, stores: UploadOptions | undefined): void {
  const maxBytes = stores?.maxBytes ?? 50 * 1024 * 1024;

  app.post('/v1/uploads', async (c) => {
    const by = await signedIn(c);
    if (!stores) throw new HttpError(422, 'uploads are not set up on this server');
    const query = (name: string) => (c.req.query(name) ?? '').trim();
    const what = c.req.query('what');
    const target = query('for');
    const statement = c.req.query('rights') as RightsStatement | undefined;
    const title = query('title').slice(0, 300);
    if (what !== 'recording' && what !== 'scan') throw new HttpError(400, 'what is recording or scan');
    if (!isEntityId(target)) throw new HttpError(400, 'say which item the file belongs to (for)');
    if (!statement || !(statement in RIGHTS_STATEMENTS)) throw new HttpError(400, `rights is one of ${Object.keys(RIGHTS_STATEMENTS).join(', ')}`);
    const mime = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (what === 'recording' && !AUDIO.test(mime)) throw new HttpError(400, 'a recording is an audio file');
    if (what === 'scan' && mime !== 'application/pdf') throw new HttpError(400, 'a scan is a PDF');
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (declared > maxBytes) throw new HttpError(422, `files up to ${Math.round(maxBytes / 1024 / 1024)} MB for now`);

    // New accounts wait a day before adding files, and everyone adds so many a day (core, permissions.ts).
    const account = await catalog.account(by);
    if (!account) throw new HttpError(403, 'sign in to do this');
    const seen = await one<{ age_hours: number | null; files: number; bytes: string | number }>(
      catalog.db,
      `SELECT (SELECT extract(epoch FROM now() - p.created_at) / 3600 FROM auth.person p WHERE p.id = $1)::float8 AS age_hours,
              count(s.*)::int AS files, coalesce(sum(f.bytes), 0)::bigint AS bytes
       FROM file_source s JOIN file f ON f.sha256 = s.sha256 WHERE s.uploaded_by = $1 AND s.created_at > now() - interval '1 day'`,
      [by],
    );
    const allowed = uploadAllowance(account, { accountAgeHours: seen?.age_hours ?? null, filesToday: seen?.files ?? 0, bytesToday: Number(seen?.bytes ?? 0), adding: declared });
    if (!allowed.ok) throw new HttpError(allowed.reason === 'hold' || allowed.reason === 'suspended' ? 403 : 429, allowed.message);

    const item = await catalog.get(target as EntityId);
    if (!item) throw new HttpError(404, `no item ${target}`);
    const teshurosSet = await teshurosSetId();
    // What the scan is: as the person confirmed it, else what the page it was added from says.
    let kind: ScanKind | null = null;
    let publication: EntityView | null = null;
    if (what === 'recording') {
      if (item.type !== 'event') throw new HttpError(400, 'a recording is added to a farbrengen');
    } else {
      const asked = c.req.query('as') as ScanKind | undefined;
      if (asked && !['scan-of', 'printing', 'teshura'].includes(asked)) throw new HttpError(400, 'as is scan-of, printing or teshura');
      kind = asked ?? (item.type === 'publication' ? 'scan-of' : item.id === teshurosSet ? 'teshura' : item.type === 'work' ? 'printing' : null);
      if (item.type !== 'work' && item.type !== 'publication' && item.id !== teshurosSet) throw new HttpError(400, 'a scan is added to a sefer, a printing, or the Teshuros set');
      if (kind === 'scan-of') {
        const pubId = item.type === 'publication' ? item.id : query('publication');
        publication = isEntityId(pubId) ? await catalog.get(pubId as EntityId) : null;
        if (!publication || publication.type !== 'publication') throw new HttpError(400, 'say which printing this is a scan of (publication)');
      } else if (kind === 'printing' && item.type !== 'work') {
        throw new HttpError(400, 'a new printing is added to its sefer');
      }
    }
    const families = kind === 'teshura' ? familiesOf(query('families')) : [];
    if (kind === 'teshura' && families.length === 0) throw new HttpError(400, 'a teshura needs its families, as printed on it');
    const simchaDate = query('date');
    if (simchaDate && !isValidDateKey(simchaDate)) throw new HttpError(400, `${simchaDate} is not a date`);
    const simchaKind = query('simcha') || 'wedding';
    if (kind === 'teshura' && !(SIMCHOS as readonly string[]).includes(simchaKind)) throw new HttpError(400, `simcha is one of ${SIMCHOS.join(', ')}`);
    const printingNumber = query('printing');
    if (printingNumber && !/^[1-9]\d{0,2}$/.test(printingNumber)) throw new HttpError(400, 'printing is a number (1 for the first)');
    const year = kind === 'printing' ? yearFields(query('year')) : {};

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) throw new HttpError(400, 'the file is empty');
    if (bytes.byteLength > maxBytes) throw new HttpError(422, `files up to ${Math.round(maxBytes / 1024 / 1024)} MB for now`);
    const sha256 = await sha256Of(bytes);

    // We already have it: say where, and add nothing twice.
    if (await getFile(catalog.db, sha256)) return c.json({ sha256, existed: true, usedBy: (await itemsUsingFile(catalog.db, sha256)).map((i) => ({ id: i.id, type: i.type, path: i.path })) });

    const rights = RIGHTS_STATEMENTS[statement];
    // A teshura's scan is a teshura's, whatever the uploader was unsure of: served with credit to its families (docs/rights.md).
    const fileClass: FileClass = kind === 'teshura' ? 'teshura-scan' : 'fileClass' in rights ? rights.fileClass : what === 'recording' ? 'recording' : 'other';
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
      credit: kind === 'teshura' ? teshuraCredit(families) : undefined,
      held: true,
    });
    if (file.storage_tier === 'public') await stores.public.put(`objects/${sha256}`, bytes, mime);
    else await stores.preservation.put(`objects/${sha256}`, bytes, mime);

    // Then the suggestion that adds it to the catalog.
    const name = title || ((itemData.title as { he?: string } | undefined)?.he ?? '');
    // In the item's sets, so their keepers review it; a teshura in the Teshuros set.
    const setsOf = (data: Record<string, unknown>) => (Array.isArray(data.sets) && data.sets.length ? { sets: data.sets as Json } : {});
    let suggestion;
    if (what === 'recording') {
      suggestion = await catalog.createChangeset(by, { title: `הוספת הקלטה: ${name}` });
      await catalog.putRevision(suggestion.id, by, { type: 'recording', data: { event: item.id, title: { he: name || 'הקלטה' }, file: sha256, ...setsOf(itemData) } as Json });
    } else if (kind === 'scan-of') {
      const pubData = publication!.data as { title?: { he?: string } };
      suggestion = await catalog.createChangeset(by, { title: `סריקה נוספת: ${pubData.title?.he ?? name}` });
      await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication: publication!.id, file: sha256, completeness: 'unknown' } as Json });
    } else if (kind === 'teshura') {
      const inSet = (await catalog.get(teshurosSet)) ? { sets: [teshurosSet] } : setsOf(itemData);
      const teshuraTitle = title || `תשורה – ${families.join(' – ')}`;
      suggestion = await catalog.createChangeset(by, { title: `הוספת תשורה: ${teshuraTitle}` });
      const simcha = { kind: simchaKind, families, ...(simchaDate ? { date: simchaDate } : {}), ...(query('place') ? { place: query('place').slice(0, 200) } : {}) };
      const pub = await catalog.putRevision(suggestion.id, by, {
        type: 'publication',
        data: { kind: 'teshura', title: { he: teshuraTitle }, simcha, ...(simchaDate ? { date: simchaDate } : {}), ...(item.type === 'work' ? { work: item.id } : {}), ...inSet } as Json,
      });
      await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication: pub, file: sha256, completeness: 'unknown' } as Json });
    } else {
      suggestion = await catalog.createChangeset(by, { title: `הוספת דפוס: ${name}` });
      const pub = await catalog.putRevision(suggestion.id, by, {
        type: 'publication',
        data: {
          kind: 'book-volume',
          title: { he: name || 'סריקה' },
          work: item.id,
          ...(query('publisher') ? { publisher: query('publisher').slice(0, 300) } : {}),
          ...year,
          ...(printingNumber ? { printing: Number(printingNumber) } : {}),
          ...setsOf(itemData),
        } as Json,
      });
      await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication: pub, file: sha256, completeness: 'unknown' } as Json });
    }
    const sent = await catalog.submit(suggestion.id, by);
    return c.json({ sha256, existed: false, as: kind, rights: file.rights_state, served: mayServe(file.rights_state) && file.storage_tier === 'public', suggestion: sent.id }, 201);
  });
}
