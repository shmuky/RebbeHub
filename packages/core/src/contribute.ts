import { isValidDateKey, normalizeSearchText, parseDateText } from '@rebbehub/hebrew';
import { EVENT_LINK_KINDS, GENRES, LANGUAGES, isEntityId, newId, orderKeys, type EntityId, type EventLinkKind, type Genre, type Language, type Licence, type LocalName } from '@rebbehub/model';
import type { Catalog, ChangesetRow, EntityView } from './catalog.js';
import { invalid, notFound } from './errors.js';
import type { Json } from './merge.js';
import { paragraphsOf } from './translations.js';

/**
 * Adding what the catalog does not have yet (the plan, section 7: "uploads
 * guess first and ask second"): a hanacha of a farbrengen or a sicha, as a
 * PDF or as its words; a recording; or other material - a sefer the catalog
 * does not know, a teshura, a letter, a document. The person gives a file
 * (or the words) and its name; the machine proposes what it is and where it
 * belongs - the farbrengen on the date the name gives, a sefer of that name
 * - and the person confirms or picks another place. Everything joins the
 * catalog through one Suggestion, reviewed like any other; the machine's
 * proposal is only ever a proposal, and says so.
 *
 * The file itself is kept by the API's upload (services/api/src/uploads.ts)
 * - stored once by sha256, where its rights put it - before the items that
 * name it are made here.
 */

// ---------------------------------------------------------------- what it is and where it belongs

/** A date in a file's name or title: `הנחה יו"ד שבט תשכ"ב.pdf`, `10_Shvat_5722`, `5722-05-10`. The most precise one found. */
export function findDateIn(text: string): string | null {
  const key = /\b(\d{4}-(0[1-9]|1[0-2]|06A|06B)(-(0[1-9]|[12]\d|30))?)\b/.exec(text);
  if (key && isValidDateKey(key[1]!)) return key[1]!;
  const tokens = text
    .replace(/\.(pdf|mp3|m4a|wav|ogg|opus|flac|txt)$/i, '')
    .replace(/[_\-–.,()[\]]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 40);
  let best: { key: string; precision: number } | null = null;
  for (let size = Math.min(6, tokens.length); size >= 1; size--) {
    for (let at = 0; at + size <= tokens.length; at++) {
      const parsed = parseDateText(tokens.slice(at, at + size).join(' '));
      if (!parsed.ok) continue;
      const precision = parsed.key.split('-').length;
      if (!best || precision > best.precision) best = { key: parsed.key, precision };
    }
    if (best && best.precision === 3) break;
  }
  // A bare number is a year only when it looks like one of the Rebbe's years, not a page or a part.
  if (best && best.precision === 1 && !/^5[67]\d\d$/.test(best.key)) return null;
  return best?.key ?? null;
}

/** What people add through the guided flow. */
export type NewMaterialKind = 'hanacha' | 'recording' | 'document';

/** What the machine takes other material to be. */
export type DocumentKind = 'sefer' | 'printing' | 'teshura' | 'letter' | 'document';

export interface PlaceCandidate {
  id: EntityId;
  type: string;
  path: string | null;
  label: LocalName | null;
  date: string | null;
  /** Why it is offered: `date` (on the date the name gives), `name` (its name matches). */
  why: 'date' | 'name';
}

export interface NewMaterialProposal {
  /** Always true: the machine's guess, for a person to confirm. */
  machine: true;
  what: NewMaterialKind;
  /** The date the name gives, if any. */
  date: string | null;
  /** For other material: what it most likely is. */
  as: DocumentKind | null;
  /** Where it most likely belongs, best first; the person may pick another or make a new one. */
  candidates: PlaceCandidate[];
}

const labelOf = (view: EntityView): LocalName | null => {
  const d = view.data as { title?: LocalName; label?: LocalName; name?: LocalName };
  return d.title ?? d.label ?? d.name ?? null;
};

const candidate = (view: EntityView, why: PlaceCandidate['why']): PlaceCandidate => ({
  id: view.id,
  type: view.type,
  path: view.path,
  label: labelOf(view),
  date: ((view.data as { date?: string }).date as string | undefined) ?? null,
  why,
});

/** The words of a name worth searching by: without the file's extension, dates, and words like "hanacha". */
function searchWords(name: string): string {
  return normalizeSearchText(name.replace(/\.(pdf|mp3|m4a|wav|ogg|opus|flac|txt)$/i, '').replace(/[_\-–.,()[\]]+/g, ' '))
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !['הנחה', 'הנחת', 'hanacha', 'hanachah', 'recording', 'הקלטה', 'pdf', 'scan', 'סריקה'].includes(w))
    .slice(0, 8)
    .join(' ');
}

/** Items whose names hold the words; failing that, the first words only (a name often ends in a volume or a part the catalog words differently). */
async function searchBy(catalog: Catalog, words: string, type: 'event' | 'unit' | 'work', limit: number): Promise<EntityView[]> {
  const all = words.split(' ');
  for (let n = all.length; n >= Math.min(2, all.length); n--) {
    const found = await catalog.search(all.slice(0, n).join(' '), { type, limit });
    if (found.length) return found;
  }
  return [];
}

/**
 * Proposes what an addition is and where it belongs, from its name: a
 * hanacha or a recording goes to the farbrengen (or sicha) on the date its
 * name gives, else to one whose name matches; other material is a teshura,
 * a letter, a new printing of a sefer the catalog has, or a new sefer,
 * with the sefarim whose names match.
 */
export async function proposeNewMaterial(catalog: Catalog, input: { what: NewMaterialKind; name: string }): Promise<NewMaterialProposal> {
  const name = (input.name ?? '').slice(0, 300);
  const date = findDateIn(name);
  const words = searchWords(name);
  const candidates: PlaceCandidate[] = [];
  const add = (views: EntityView[], why: PlaceCandidate['why']) => {
    for (const v of views) if (!candidates.some((c) => c.id === v.id)) candidates.push(candidate(v, why));
  };
  if (input.what === 'hanacha' || input.what === 'recording') {
    if (date) {
      const exact = date.split('-').length === 3;
      add(await catalog.events(exact ? { dates: [date], limit: 20 } : { within: date, limit: 20 }), 'date');
      if (input.what === 'hanacha' && exact) {
        const { rows } = await catalog.db.query<{ id: EntityId }>(
          "SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'unit' AND NOT e.deleted AND r.data->>'date' = $1 ORDER BY r.data->>'order' COLLATE \"C\" LIMIT 10",
          [date],
        );
        add(await catalog.getMany(rows.map((r) => r.id)), 'date');
      }
    }
    if (words) {
      add(await searchBy(catalog, words, 'event', 8), 'name');
      if (input.what === 'hanacha') add(await searchBy(catalog, words, 'unit', 5), 'name');
    }
    return { machine: true, what: input.what, date, as: null, candidates: candidates.slice(0, 20) };
  }
  let as: DocumentKind = 'sefer';
  if (/תשורה|teshura|tshura|teshurah/i.test(name)) as = 'teshura';
  else if (/מכתב|אגרת|אגרות|letter|michtav|igeres/i.test(name)) as = 'letter';
  if (words) add(await searchBy(catalog, words, 'work', 8), 'name');
  // A sefer the catalog has, by name: a new printing of it, not a new sefer.
  if (as === 'sefer' && candidates.length) as = 'printing';
  if (as === 'letter' && date?.split('-').length === 3) {
    const { rows } = await catalog.db.query<{ id: EntityId }>(
      "SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'unit' AND NOT e.deleted AND r.data->>'date' = $1 LIMIT 10",
      [date],
    );
    add(await catalog.getMany(rows.map((r) => r.id)), 'date');
  }
  return { machine: true, what: 'document', date, as, candidates: candidates.slice(0, 20) };
}

// ---------------------------------------------------------------- making it, as one suggestion

/** A farbrengen (or other event) the catalog does not have yet, made with what is added to it. */
export interface NewEvent {
  title: string;
  date: string;
  kind?: 'farbrengen' | 'sicha' | 'maamar' | 'yechidus' | 'kinus' | 'other';
}

/** Where an addition goes: an item the catalog has, or a new farbrengen. */
export type Place = { target: EntityId } | { newEvent: NewEvent };

export interface NewHanachaPdf {
  file: string;
  /** Where RebbeHub serves it, when its rights let it be served; unset, it is kept privately and listed only. */
  servedUrl?: string;
  place: Place;
  /** Which kind of text it is: `bilti-mugah` (unedited, the usual), `mugah`, a maamar, glosses, additions. */
  kind?: EventLinkKind;
  title?: string;
  /** The licence its uploader's rights statement gave, for the unit's edition. */
  licence: Licence;
}

export interface NewRecording {
  file: string;
  place: Place;
  title?: string;
}

export interface NewDocument {
  file: string;
  as: 'sefer' | 'letter' | 'document';
  title: string;
  date?: string;
  /** The set it belongs in, so its keepers review it. */
  set?: EntityId;
  /** For a new sefer: its author and kind. */
  author?: EntityId;
  genre?: Genre;
  publisher?: string;
  year?: { date?: string; gregorianYear?: number };
  /** For a letter: the letter the catalog has that this reproduces. */
  unit?: EntityId;
}

const clip = (text: string, n = 300) => text.replace(/\s+/g, ' ').trim().slice(0, n);

/** The item a place names (a farbrengen or a sicha), or the new farbrengen to make. */
async function placeOf(catalog: Catalog, place: Place, allowed: readonly string[]): Promise<{ item: EntityView | null; newEvent: NewEvent | null }> {
  if ('target' in place) {
    if (!isEntityId(place.target)) throw invalid(`"${place.target}" is not an id`);
    const item = await catalog.get(place.target);
    if (!item || !allowed.includes(item.type)) throw notFound(`a ${allowed.join(' or ')} ${place.target}`);
    return { item, newEvent: null };
  }
  const e = place.newEvent;
  if (!e?.title?.trim()) throw invalid('a new farbrengen needs its name');
  if (!e.date || !isValidDateKey(e.date)) throw invalid('a new farbrengen needs its date (5742-05-10)');
  return { item: null, newEvent: e };
}

/** Makes the new farbrengen in the suggestion, in the Farbrengens set when the catalog has it. */
async function makeEvent(catalog: Catalog, suggestion: number, by: string, e: NewEvent, links: Json[] = []): Promise<EntityId> {
  return catalog.putRevision(suggestion, by, {
    type: 'event',
    data: { kind: e.kind ?? 'farbrengen', title: { he: clip(e.title) }, date: e.date, ...(links.length ? { links } : {}), ...(await farbrengensSet(catalog)) } as Json,
  });
}

const farbrengensSet = async (catalog: Catalog): Promise<{ sets?: Json }> => {
  const id = (await catalog.resolvePath('/sets/farbrengens'))?.id;
  return id ? { sets: [id] } : {};
};

const setsOf = (view: EntityView | null): { sets?: Json } => {
  const sets = (view?.data as { sets?: unknown } | undefined)?.sets;
  return Array.isArray(sets) && sets.length ? { sets: sets as Json } : {};
};

const nameOf = (view: EntityView | null, fallback: string) => ((view?.data as { title?: LocalName; label?: LocalName } | undefined)?.title ?? (view?.data as { label?: LocalName } | undefined)?.label)?.he ?? fallback;

/**
 * A hanacha's PDF for a farbrengen or a sicha: a printing of its own (a
 * booklet) with the scan, "based on" the farbrengen or sicha; and, where
 * RebbeHub serves the file, a link to it on the farbrengen's page (or a
 * copy on the sicha's), so it opens in the site's reader like the rest.
 */
export async function suggestHanachaPdf(catalog: Catalog, by: string, input: NewHanachaPdf): Promise<{ suggestion: ChangesetRow; publication: EntityId; scan: EntityId; event: EntityId | null }> {
  const kind = input.kind ?? 'bilti-mugah';
  if (!(EVENT_LINK_KINDS as readonly string[]).includes(kind) || kind === 'audio' || kind === 'video') throw invalid('a hanacha is mugah, bilti-mugah, a maamar, hagahos, hosofos, english or other');
  const { item, newEvent } = await placeOf(catalog, input.place, ['event', 'unit']);
  const title = clip(input.title ?? '') || `הנחה: ${newEvent ? clip(newEvent.title) : nameOf(item, '')}`.trim();
  const suggestion = await catalog.createChangeset(by, { title: `הוספת הנחה: ${title}` });
  const link: Json | null = input.servedUrl ? { kind, label: { he: title }, url: input.servedUrl, source: 'contribution' } : null;
  const target = item?.id ?? (await makeEvent(catalog, suggestion.id, by, newEvent!, link ? [link] : []));
  const date = newEvent?.date ?? ((item?.data as { date?: string } | undefined)?.date as string | undefined);
  const publication = await catalog.putRevision(suggestion.id, by, {
    type: 'publication',
    data: { kind: 'booklet', title: { he: title }, ...(date ? { date } : {}), ...setsOf(item) } as Json,
  });
  const scan = await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication, file: input.file, completeness: 'unknown' } as Json });
  await catalog.putRevision(suggestion.id, by, { type: 'relation', data: { kind: 'based-on', from: publication, to: target } as Json });
  if (link && item?.type === 'event') {
    const links = (((item.data as { links?: unknown }).links as Json[] | undefined) ?? []).slice();
    links.push(link);
    await catalog.putRevision(suggestion.id, by, { id: item.id, type: 'event', data: { ...(item.data as Record<string, Json>), links } as Json });
  } else if (link && item?.type === 'unit') {
    const editions = (((item.data as { editions?: unknown }).editions as Json[] | undefined) ?? []).slice();
    editions.push({ source: 'contribution', sourceId: input.file, kind: 'pdf', licence: input.licence, label: title, url: input.servedUrl! });
    await catalog.putRevision(suggestion.id, by, { id: item.id, type: 'unit', data: { ...(item.data as Record<string, Json>), editions } as Json });
  }
  return { suggestion: await catalog.submit(suggestion.id, by), publication, scan, event: item?.type === 'event' ? item.id : newEvent ? target : null };
}

/** A recording of a farbrengen the catalog has, or of a new one made with it; the next part of it. */
export async function suggestRecording(catalog: Catalog, by: string, input: NewRecording): Promise<{ suggestion: ChangesetRow; recording: EntityId; event: EntityId }> {
  const { item, newEvent } = await placeOf(catalog, input.place, ['event']);
  const name = clip(input.title ?? '') || 'הקלטה';
  const suggestion = await catalog.createChangeset(by, { title: `הוספת הקלטה: ${newEvent ? clip(newEvent.title) : nameOf(item, name)}` });
  const event = item?.id ?? (await makeEvent(catalog, suggestion.id, by, newEvent!));
  const parts = item ? (await catalog.backlinks(item.id, { field: 'event', type: 'recording', limit: 1000 })).length : 0;
  const recording = await catalog.putRevision(suggestion.id, by, {
    type: 'recording',
    data: { event, title: { he: name }, file: input.file, part: parts + 1, ...(item ? setsOf(item) : await farbrengensSet(catalog)) } as Json,
  });
  return { suggestion: await catalog.submit(suggestion.id, by), recording, event };
}

/**
 * Other material: a sefer the catalog does not know (the sefer and its
 * first printing, with the scan), a letter (a printing of its own that
 * reproduces the letter the catalog has, when one was picked), or a
 * document of any other kind. A teshura, or a new printing of a sefer the
 * catalog has, goes through "Add a scan" on the Teshuros set or the sefer.
 */
export async function suggestDocument(catalog: Catalog, by: string, input: NewDocument): Promise<{ suggestion: ChangesetRow; publication: EntityId; scan: EntityId; work: EntityId | null }> {
  const title = clip(input.title ?? '');
  if (!title) throw invalid('say what it is called, as printed on it');
  if (!['sefer', 'letter', 'document'].includes(input.as)) throw invalid('it is a sefer, a letter or a document');
  if (input.date !== undefined && !isValidDateKey(input.date)) throw invalid(`${input.date} is not a date`);
  if (input.genre !== undefined && !GENRES.includes(input.genre)) throw invalid(`a sefer's kind is one of ${GENRES.join(', ')}`);
  const set = input.set ? await catalog.get(input.set) : null;
  if (input.set && (!set || set.type !== 'set')) throw notFound(`set ${input.set}`);
  const author = input.author ? await catalog.get(input.author) : null;
  if (input.author && (!author || author.type !== 'author')) throw notFound(`author ${input.author}`);
  const unit = input.unit ? await catalog.get(input.unit) : null;
  if (input.unit && (!unit || unit.type !== 'unit')) throw notFound(`letter ${input.unit}`);
  const sets = set ? { sets: [set.id] } : {};
  const words = { sefer: 'ספר', letter: 'מכתב', document: 'מסמך' }[input.as];
  const suggestion = await catalog.createChangeset(by, { title: `הוספת ${words}: ${title}` });
  let work: EntityId | null = null;
  if (input.as === 'sefer') {
    work = await catalog.putRevision(suggestion.id, by, {
      type: 'work',
      data: { title: { he: title }, slug: `sefer-${newId().slice(3)}`, authors: author ? [author.id] : [], genre: input.genre ?? 'chassidus', levels: ['volume'], ...sets } as Json,
    });
  }
  const publication = await catalog.putRevision(suggestion.id, by, {
    type: 'publication',
    data: {
      kind: input.as === 'sefer' ? 'book-volume' : 'other',
      title: { he: title },
      ...(work ? { work } : {}),
      ...(input.publisher ? { publisher: clip(input.publisher) } : {}),
      ...(input.date ? { date: input.date } : (input.year ?? {})),
      ...sets,
    } as Json,
  });
  const scan = await catalog.putRevision(suggestion.id, by, { type: 'scan', data: { publication, file: input.file, completeness: 'unknown' } as Json });
  if (unit) await catalog.putRevision(suggestion.id, by, { type: 'relation', data: { kind: 'reproduces', from: publication, to: unit.id } as Json });
  return { suggestion: await catalog.submit(suggestion.id, by), publication, scan, work };
}

// ---------------------------------------------------------------- a hanacha's words

/** What the person says of a hanacha's words, and the licence it gives them (docs/rights.md, Uploads). */
export const HANACHA_TEXT_RIGHTS = {
  // I wrote this hanacha myself and give it freely: community text, served (CC BY-SA, as every correction).
  mine: undefined,
  'public-domain': 'public-domain',
  // Printed for free distribution, or not sure: kept, not shown, until a steward decides.
  free: 'unknown',
  unsure: 'unknown',
} as const satisfies Record<string, Licence | undefined>;

export type HanachaTextRights = keyof typeof HANACHA_TEXT_RIGHTS;

export const MAX_HANACHA_PARAGRAPHS = 2000;

export interface NewHanachaText {
  place: Place;
  content: string;
  rights: HanachaTextRights;
  language?: string;
  /** Who wrote it, when they want it said: `R' Yoel Kahn`. */
  credit?: string;
}

/**
 * A hanacha's words, pasted or from a text file: a text of kind
 * `hanacha`, its paragraphs segments with permanent ids. A sicha's text
 * is of that sicha; a farbrengen's is "based on" the farbrengen, which is
 * how its recordings find it to sync to (sync.ts, `hanachaOf`). Words
 * whose rights are unsure are kept and not shown until a steward decides.
 */
export async function addHanachaText(catalog: Catalog, by: string, input: NewHanachaText): Promise<{ suggestion: ChangesetRow; text: EntityId; event: EntityId | null; publication: EntityId | null }> {
  if (!(input.rights in HANACHA_TEXT_RIGHTS)) throw invalid(`rights is one of ${Object.keys(HANACHA_TEXT_RIGHTS).join(', ')}`);
  const language = (input.language ?? 'he') as Language;
  if (!(LANGUAGES as readonly string[]).includes(language)) throw invalid(`language is one of ${LANGUAGES.join(', ')}`);
  const paragraphs = paragraphsOf(input.content ?? '');
  if (paragraphs.length === 0) throw invalid('a hanacha needs its words');
  if (paragraphs.length > MAX_HANACHA_PARAGRAPHS) throw invalid(`up to ${MAX_HANACHA_PARAGRAPHS} paragraphs in one suggestion`);
  if (paragraphs.some((p) => p.length > 20_000)) throw invalid('a paragraph is at most 20,000 characters');
  const { item, newEvent } = await placeOf(catalog, input.place, ['event', 'unit']);
  const licence = HANACHA_TEXT_RIGHTS[input.rights];
  const credit = input.credit ? clip(input.credit) : '';
  const suggestion = await catalog.createChangeset(by, { title: `הנחה (${paragraphs.length} פסקאות): ${newEvent ? clip(newEvent.title) : nameOf(item, '')}` });
  const event = item?.type === 'event' ? item.id : newEvent ? await makeEvent(catalog, suggestion.id, by, newEvent) : null;
  // A sicha's hanacha is of the sicha, so its sefer's keepers review it. A
  // farbrengen's is a printing of its own (a booklet, like a hanacha's PDF)
  // in the farbrengen's sets, so their keepers review it.
  const title = `הנחה: ${newEvent ? clip(newEvent.title) : nameOf(item, '')}`.trim();
  const date = newEvent?.date ?? ((item?.data as { date?: string } | undefined)?.date as string | undefined);
  const publication =
    item?.type === 'unit'
      ? null
      : await catalog.putRevision(suggestion.id, by, {
          type: 'publication',
          data: { kind: 'booklet', title: { he: title }, ...(date ? { date } : {}), ...(item ? setsOf(item) : await farbrengensSet(catalog)) } as Json,
        });
  const text = await catalog.putRevision(suggestion.id, by, {
    type: 'text',
    data: {
      kind: 'hanacha',
      ...(item?.type === 'unit' ? { unit: item.id } : { publication }),
      language,
      ...(licence ? { licence } : {}),
      ...(credit ? { credit } : {}),
    } as Json,
  });
  const orders = orderKeys(paragraphs.length);
  for (const [i, content] of paragraphs.entries()) {
    await catalog.putRevision(suggestion.id, by, { type: 'segment', data: { text, order: orders[i]!, kind: 'paragraph', content, proofread: 0 } as Json });
  }
  if (event) await catalog.putRevision(suggestion.id, by, { type: 'relation', data: { kind: 'based-on', from: text, to: event } as Json });
  return { suggestion: await catalog.submit(suggestion.id, by), text, event, publication };
}
