import type { Context, Hono } from 'hono';
import { addHanachaText, getFile, itemsUsingFile, proposeNewMaterial, registerFile, similarScans, suggestDocument, suggestHanachaPdf, suggestRecording, teshuraCredit, teshurosSetId, uploadAllowance, type Catalog, type EntityView, type HanachaTextRights, type Json, type Place } from '@rebbehub/core';
import { one } from '@rebbehub/db';
import { isValidDateKey, parseHebrewYear } from '@rebbehub/hebrew';
import type { EntityId, EventLinkKind, FileClass, Genre, Licence } from '@rebbehub/model';
import { GENRES, isEntityId, mayServe } from '@rebbehub/model';
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
 *
 * "Add something new" (/add on the site) brings what the catalog does not
 * have yet, guessed first too (POST /v1/uploads/propose): a hanacha's PDF
 * (`what=hanacha`) for a farbrengen or a sicha, a recording of a
 * farbrengen the catalog lacks (`eventTitle`, `eventDate`), or other
 * material (`what=document`, `as` sefer, letter or document); a hanacha's
 * words go to POST /v1/hanachos/text. What becomes of each is in
 * core/contribute.ts.
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

/**
 * A hanacha's PDF: served only when its uploader wrote it or it is anyone's;
 * a hanacha printed for free distribution, or one they are unsure of, is a
 * hanacha as docs/rights.md has them - linked, and a copy kept privately.
 */
const HANACHA_RIGHTS: Record<RightsStatement, { licence: Licence; fileClass?: FileClass }> = {
  mine: { licence: 'cc0' },
  'public-domain': { licence: 'public-domain' },
  free: { licence: 'unknown', fileClass: 'hanacha' },
  unsure: { licence: 'unknown', fileClass: 'hanacha' },
};

const HANACHA_KINDS: readonly EventLinkKind[] = ['bilti-mugah', 'mugah', 'maamar', 'hagahos', 'hosofos', 'english', 'other'];

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

export function uploadRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, stores: UploadOptions | undefined, filesBase: (c: Context) => string | null = () => null): void {
  const maxBytes = stores?.maxBytes ?? 50 * 1024 * 1024;

  /** New accounts wait a day before adding files, and everyone adds so many a day (core, permissions.ts). */
  const mayAdd = async (by: string, adding: number) => {
    const account = await catalog.account(by);
    if (!account) throw new HttpError(403, 'sign in to do this');
    const seen = await one<{ age_hours: number | null; files: number; bytes: string | number }>(
      catalog.db,
      `SELECT (SELECT extract(epoch FROM now() - p.created_at) / 3600 FROM auth.person p WHERE p.id = $1)::float8 AS age_hours,
              count(s.*)::int AS files, coalesce(sum(f.bytes), 0)::bigint AS bytes
       FROM file_source s JOIN file f ON f.sha256 = s.sha256 WHERE s.uploaded_by = $1 AND s.created_at > now() - interval '1 day'`,
      [by],
    );
    const allowed = uploadAllowance(account, { accountAgeHours: seen?.age_hours ?? null, filesToday: seen?.files ?? 0, bytesToday: Number(seen?.bytes ?? 0), adding });
    if (!allowed.ok) throw new HttpError(allowed.reason === 'hold' || allowed.reason === 'suspended' ? 403 : 429, allowed.message);
  };

  /** Where a new hanacha or recording goes: an item named by `for`, or a new farbrengen (`eventTitle`, `eventDate`). */
  const placeFrom = (query: (name: string) => string): Place | null => {
    const target = query('for');
    if (isEntityId(target)) return { target: target as EntityId };
    const title = query('eventTitle');
    const date = query('eventDate');
    if (!title && !date) return null;
    if (!title || !date || !isValidDateKey(date)) throw new HttpError(400, 'a new farbrengen needs its name (eventTitle) and its date (eventDate, 5742-05-10)');
    return { newEvent: { title: title.slice(0, 300), date } };
  };

  app.post('/v1/uploads', async (c) => {
    const by = await signedIn(c);
    if (!stores) throw new HttpError(422, 'uploads are not set up on this server');
    const query = (name: string) => (c.req.query(name) ?? '').trim();
    const what = c.req.query('what');
    const target = query('for');
    const statement = c.req.query('rights') as RightsStatement | undefined;
    const title = query('title').slice(0, 300);
    if (what !== 'recording' && what !== 'scan' && what !== 'hanacha' && what !== 'document') throw new HttpError(400, 'what is recording, scan, hanacha or document');
    const place = what === 'recording' || what === 'hanacha' ? placeFrom(query) : null;
    if ((what === 'recording' || what === 'hanacha') && !place) throw new HttpError(400, 'say which farbrengen or sicha it belongs to (for), or name a new farbrengen (eventTitle, eventDate)');
    if (what === 'scan' && !isEntityId(target)) throw new HttpError(400, 'say which item the file belongs to (for)');
    if (!statement || !(statement in RIGHTS_STATEMENTS)) throw new HttpError(400, `rights is one of ${Object.keys(RIGHTS_STATEMENTS).join(', ')}`);
    const mime = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (what === 'recording' && !AUDIO.test(mime)) throw new HttpError(400, 'a recording is an audio file');
    if (what !== 'recording' && mime !== 'application/pdf') throw new HttpError(400, `a ${what} is a PDF`);
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (declared > maxBytes) throw new HttpError(422, `files up to ${Math.round(maxBytes / 1024 / 1024)} MB for now`);
    await mayAdd(by, declared);

    const item = isEntityId(target) ? await catalog.get(target as EntityId) : null;
    if (isEntityId(target) && !item) throw new HttpError(404, `no item ${target}`);
    if (what === 'recording' && item && item.type !== 'event') throw new HttpError(400, 'a recording is added to a farbrengen');
    if (what === 'hanacha' && item && item.type !== 'event' && item.type !== 'unit') throw new HttpError(400, 'a hanacha is added to a farbrengen or a sicha');
    const teshurosSet = await teshurosSetId();
    // What the scan is: as the person confirmed it, else what the page it was added from says.
    let kind: ScanKind | null = null;
    let publication: EntityView | null = null;
    if (what === 'scan') {
      if (!item) throw new HttpError(404, `no item ${target}`);
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
    // Other material: a new sefer, a letter, or a document of another kind (core/contribute.ts).
    const documentAs = what === 'document' ? (c.req.query('as') ?? 'document') : null;
    if (documentAs && !['sefer', 'letter', 'document'].includes(documentAs)) {
      throw new HttpError(400, 'as is sefer, letter or document (a teshura, or a printing of a sefer the catalog has, is added as a scan to the Teshuros set or the sefer)');
    }
    if (documentAs && !title) throw new HttpError(400, 'say what it is called, as printed on it (title)');
    const genre = query('genre');
    if (genre && !GENRES.includes(genre as Genre)) throw new HttpError(400, `genre is one of ${GENRES.join(', ')}`);
    const linkKind = (query('kind') || 'bilti-mugah') as EventLinkKind;
    if (what === 'hanacha' && !HANACHA_KINDS.includes(linkKind)) throw new HttpError(400, `kind is one of ${HANACHA_KINDS.join(', ')}`);
    const families = kind === 'teshura' ? familiesOf(query('families')) : [];
    if (kind === 'teshura' && families.length === 0) throw new HttpError(400, 'a teshura needs its families, as printed on it');
    const simchaDate = query('date');
    if (simchaDate && !isValidDateKey(simchaDate)) throw new HttpError(400, `${simchaDate} is not a date`);
    const simchaKind = query('simcha') || 'wedding';
    if (kind === 'teshura' && !(SIMCHOS as readonly string[]).includes(simchaKind)) throw new HttpError(400, `simcha is one of ${SIMCHOS.join(', ')}`);
    const printingNumber = query('printing');
    if (printingNumber && !/^[1-9]\d{0,2}$/.test(printingNumber)) throw new HttpError(400, 'printing is a number (1 for the first)');
    const year = kind === 'printing' || documentAs ? yearFields(query('year')) : {};

    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) throw new HttpError(400, 'the file is empty');
    if (bytes.byteLength > maxBytes) throw new HttpError(422, `files up to ${Math.round(maxBytes / 1024 / 1024)} MB for now`);
    const sha256 = await sha256Of(bytes);

    // We already have it: say where, and add nothing twice.
    if (await getFile(catalog.db, sha256)) return c.json({ sha256, existed: true, usedBy: (await itemsUsingFile(catalog.db, sha256)).map((i) => ({ id: i.id, type: i.type, path: i.path })) });

    const rights: { licence: Licence; fileClass?: FileClass; note: string } = what === 'hanacha' ? { ...HANACHA_RIGHTS[statement], note: RIGHTS_STATEMENTS[statement].note } : RIGHTS_STATEMENTS[statement];
    // A teshura's scan is a teshura's, whatever the uploader was unsure of: served with credit to its families (docs/rights.md).
    const fileClass: FileClass = kind === 'teshura' ? 'teshura-scan' : (rights.fileClass ?? (what === 'recording' ? 'recording' : 'other'));
    const itemData = (item?.data ?? {}) as Record<string, unknown>;
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
    const served = mayServe(file.rights_state) && file.storage_tier === 'public';
    const done = (suggestion: number, extra: Record<string, unknown> = {}) => c.json({ sha256, existed: false, as: kind ?? documentAs ?? what, rights: file.rights_state, served, suggestion, ...extra }, 201);

    // Then the suggestion that adds it to the catalog.
    if (what === 'recording') {
      const made = await suggestRecording(catalog, by, { file: sha256, place: place!, title: title || ((itemData.title as { he?: string } | undefined)?.he ?? '') });
      return done(made.suggestion.id, { event: made.event });
    }
    if (what === 'hanacha') {
      const base = filesBase(c);
      const made = await suggestHanachaPdf(catalog, by, { file: sha256, place: place!, kind: linkKind, title, licence: rights.licence, servedUrl: served && base ? `${base}/objects/${sha256}` : undefined });
      return done(made.suggestion.id, { publication: made.publication, event: made.event });
    }
    if (documentAs) {
      const made = await suggestDocument(catalog, by, {
        file: sha256,
        as: documentAs as 'sefer' | 'letter' | 'document',
        title,
        date: simchaDate || undefined,
        set: isEntityId(query('set')) ? (query('set') as EntityId) : undefined,
        author: isEntityId(query('author')) ? (query('author') as EntityId) : undefined,
        genre: (genre || undefined) as Genre | undefined,
        publisher: query('publisher') || undefined,
        year,
        unit: isEntityId(query('unit')) ? (query('unit') as EntityId) : undefined,
      });
      return done(made.suggestion.id, { publication: made.publication, work: made.work });
    }
    const name = title || ((itemData.title as { he?: string } | undefined)?.he ?? '');
    // In the item's sets, so their keepers review it; a teshura in the Teshuros set.
    const setsOf = (data: Record<string, unknown>) => (Array.isArray(data.sets) && data.sets.length ? { sets: data.sets as Json } : {});
    let suggestion;
    if (kind === 'scan-of') {
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
        data: { kind: 'teshura', title: { he: teshuraTitle }, simcha, ...(simchaDate ? { date: simchaDate } : {}), ...(item!.type === 'work' ? { work: item!.id } : {}), ...inSet } as Json,
      });
      await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication: pub, file: sha256, completeness: 'unknown' } as Json });
    } else {
      suggestion = await catalog.createChangeset(by, { title: `הוספת דפוס: ${name}` });
      const pub = await catalog.putRevision(suggestion.id, by, {
        type: 'publication',
        data: {
          kind: 'book-volume',
          title: { he: name || 'סריקה' },
          work: item!.id,
          ...(query('publisher') ? { publisher: query('publisher').slice(0, 300) } : {}),
          ...year,
          ...(printingNumber ? { printing: Number(printingNumber) } : {}),
          ...setsOf(itemData),
        } as Json,
      });
      await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication: pub, file: sha256, completeness: 'unknown' } as Json });
    }
    const sent = await catalog.submit(suggestion.id, by);
    return done(sent.id);
  });

  // Before adding something new: what it most likely is and where it belongs, from its name (and, for a PDF, its measurements). A machine's guess.
  app.post('/v1/uploads/propose', async (c) => {
    await signedIn(c);
    const input = await c.req.json<{ what?: string; name?: string; sha256?: string; pageHashes?: unknown[] }>().catch(() => ({}) as Record<string, undefined>);
    if (input.what !== 'hanacha' && input.what !== 'recording' && input.what !== 'document') throw new HttpError(400, 'what is hanacha, recording or document');
    const sha256 = typeof input.sha256 === 'string' && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
    const usedBy = sha256 && (await getFile(catalog.db, sha256)) ? (await itemsUsingFile(catalog.db, sha256)).map((i) => ({ id: i.id, type: i.type, path: i.path })) : [];
    const hashes = (Array.isArray(input.pageHashes) ? input.pageHashes : []).slice(0, 64).map((h) => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null));
    const similar = hashes.some(Boolean)
      ? await Promise.all(
          (await similarScans(catalog.db, hashes, { exclude: sha256 ?? undefined })).map(async (s) => ({
            ...s,
            items: (await itemsUsingFile(catalog.db, s.sha256)).map((i) => ({ id: i.id, type: i.type, path: i.path })),
          })),
        )
      : [];
    const proposal = await proposeNewMaterial(catalog, { what: input.what, name: typeof input.name === 'string' ? input.name : '' });
    return c.json({ ...proposal, usedBy, similar });
  });

  // A hanacha's words (pasted, or read from a text file in the browser): a text of kind hanacha, for review.
  app.post('/v1/hanachos/text', async (c) => {
    const by = await signedIn(c);
    const input = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!input || typeof input !== 'object') throw new HttpError(400, 'the request body must be JSON');
    const place = placeFrom((name) => String(input[name] ?? '').trim());
    if (!place) throw new HttpError(400, 'say which farbrengen or sicha it is of (for), or name a new farbrengen (eventTitle, eventDate)');
    await mayAdd(by, 0);
    const made = await addHanachaText(catalog, by, {
      place,
      content: String(input.content ?? ''),
      rights: String(input.rights ?? '') as HanachaTextRights,
      language: typeof input.language === 'string' ? input.language : undefined,
      credit: typeof input.credit === 'string' ? input.credit : undefined,
    });
    return c.json({ suggestion: made.suggestion.id, text: made.text, event: made.event, publication: made.publication }, 201);
  });
}
