import { existsSync } from 'node:fs';
import { isValidDateKey, toHebrewNumeral } from '@rebbehub/hebrew';
import type { EventKind, LocalName } from '@rebbehub/model';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { audioUrl, FARBRENGENS_SET, occasionDate, SICHOS_KODESH_MEDIA_PROXY, type CatalogEntry } from './sichosKodeshOccasions.js';

/**
 * JEM's own catalog of the Rebbe's recordings (the "ccdb" behind
 * ashreinu.app), as Sichos-Kodesh's packages/jem-index crawls it into a
 * SQLite file (`jem.db`: every event of every year, its sub-events, and
 * their recordings; about 2,900 events and 8,100 recordings). JEM's
 * catalog is wider than the farbrengens: davening, rallies, yechidus,
 * sichos on their own.
 *
 * Each JEM event that is a farbrengen RebbeHub already has (from
 * Sichos-Kodesh's catalog) gives that farbrengen whatever recordings it
 * still lacks; one that shares a recording with it is the same farbrengen
 * for certain, and otherwise a JEM farbrengen is the one on its date when
 * each has one. Every other JEM event gets a page of its own. Each
 * recording links to the recording in the Ashreinu app, and is heard
 * through Sichos-Kodesh's media proxy as its app hears them. The crawl is made at
 * import time (.github/workflows/import.yml); RebbeHub keeps no copy.
 */

export const JEM_SET = { key: 'rebbehub-set:jem', path: '/sets/jem', name: { he: 'הקלטות JEM', en: 'JEM recordings' } } as const;
export const ASHREINU = 'https://ashreinu.app';

export interface JemNode {
  id: number;
  parentId: number | null;
  name: string;
  type: string;
  hebrewYear: number | null;
  hebrewMonth: number | null;
  hebrewDay: number | null;
  afterNightfall: boolean;
}
export interface JemRecording {
  eventId: number;
  recordingId: number;
  name: string;
  durationMs: number;
  url: string;
}
export interface JemIndex {
  nodes: JemNode[];
  recordings: JemRecording[];
}

/** Reads jem-index's database (`jem.db`). */
export async function readJemIndex(file: string): Promise<JemIndex> {
  if (!existsSync(file)) throw new Error(`no JEM index at ${file}: crawl it with Sichos-Kodesh's packages/jem-index first`);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const nodes = db
      .prepare('SELECT id, parent_id, name, type, hebrew_year, hebrew_month, hebrew_day, after_nightfall FROM events ORDER BY id')
      .all()
      .map((r) => ({
        id: Number(r.id),
        parentId: r.parent_id === null ? null : Number(r.parent_id),
        name: String(r.name ?? ''),
        type: String(r.type ?? ''),
        hebrewYear: r.hebrew_year === null ? null : Number(r.hebrew_year),
        hebrewMonth: r.hebrew_month === null ? null : Number(r.hebrew_month),
        hebrewDay: r.hebrew_day === null ? null : Number(r.hebrew_day),
        afterNightfall: Number(r.after_nightfall ?? 0) === 1,
      }));
    const recordings = db
      .prepare('SELECT event_id, ccdb_recording_id, name, duration_ms, url FROM audio_recordings ORDER BY event_id, ccdb_recording_id')
      .all()
      .map((r) => ({ eventId: Number(r.event_id), recordingId: Number(r.ccdb_recording_id), name: String(r.name ?? ''), durationMs: Number(r.duration_ms ?? 0), url: String(r.url) }));
    return { nodes, recordings };
  } finally {
    db.close();
  }
}

/**
 * A JEM date as a date key. JEM numbers the months from Tishrei with both
 * Adars always counted (6 Adar I, 7 Adar or Adar II, 8 Nisan ... 13 Elul),
 * as Sichos-Kodesh's catalog reads them.
 */
export function jemDate(year: number | null, month: number | null, day: number | null): string | null {
  if (!year || !month || month < 1 || month > 13) return null;
  const tokens = month <= 5 ? [String(month).padStart(2, '0')] : month === 6 ? ['06A', '06'] : month === 7 ? ['06B', '06'] : [String(month - 1).padStart(2, '0')];
  for (const token of tokens) {
    const key = day ? `${year}-${token}-${String(day).padStart(2, '0')}` : `${year}-${token}`;
    if (isValidDateKey(key)) return key;
  }
  return isValidDateKey(String(year)) ? String(year) : null;
}

/** JEM's player at one event of a tree, as the Ashreinu app itself links it (`https://ashreinu.app/#/player/parentEvent~1_event~2`). */
export const jemPlayerUrl = (root: number, event: number) => `${ASHREINU}/#/player/parentEvent~${root}_event~${event}`;

/** Older imports' form of that link (`https://ashreinu.app/player?parentEvent=1&event=2`), not the one the app's own share links use. */
const OLD_PLAYER = /^https:\/\/ashreinu\.app\/player\?parentEvent=(\d+)&event=(\d+)$/;

/** A recording's file name on JEM's CDN (`JEMSK0001.mp3`): the same name Sichos-Kodesh's catalog plays. */
export const jemFilename = (url: string) => decodeURIComponent(url.split('?')[0]!.split('/').pop() ?? '');

/** The kind of event, from JEM's type (`Farbrengen`, `Sicha`, `Ma'amar`, `Yechidus`, `Shacharis` ...). */
export function jemKind(type: string): EventKind {
  if (/farbrengen/i.test(type)) return 'farbrengen';
  if (/ma.?amar/i.test(type)) return 'maamar';
  if (/sicha/i.test(type)) return 'sicha';
  if (/yechidus|audience/i.test(type)) return 'yechidus';
  if (/rally|kinus|convention/i.test(type)) return 'kinus';
  if (/wedding|simcha|bris|bar mitzvah/i.test(type)) return 'simcha';
  return 'other';
}

/** A part's name, in Hebrew where JEM's name is one of the usual ones (`Sicha 3` → `שיחה ג׳`). */
export function partName(name: string): LocalName {
  const en = name.trim().slice(0, 500) || 'Recording';
  const sicha = /^Sicha (\d{1,3})$/i.exec(en);
  if (sicha) return { he: `שיחה ${toHebrewNumeral(Number(sicha[1]))}`, en };
  if (/^ma.?amar$/i.test(en)) return { he: 'מאמר', en };
  return { he: en, en };
}

export interface JemInput {
  jem: JemIndex;
  /** The farbrengens RebbeHub has from Sichos-Kodesh's catalog (sichosKodeshOccasions.ts). */
  occasions: Array<Pick<CatalogEntry, 'occasionId' | 'hebrewDate' | 'audio'>>;
}

interface Tree {
  root: JemNode;
  date: string | null;
  /** Every recording under it, the root's own first, each file once. */
  recordings: JemRecording[];
}

function trees(jem: JemIndex): Tree[] {
  const byId = new Map(jem.nodes.map((n) => [n.id, n]));
  const rootOf = (node: JemNode): JemNode => {
    let at = node;
    for (let guard = 0; at.parentId !== null && byId.has(at.parentId) && guard < 20; guard++) at = byId.get(at.parentId)!;
    return at;
  };
  const out = new Map<number, Tree>();
  for (const node of jem.nodes) {
    if (rootOf(node) === node) out.set(node.id, { root: node, date: jemDate(node.hebrewYear, node.hebrewMonth, node.hebrewDay), recordings: [] });
  }
  const depth = (node: JemNode) => (node.parentId === null ? 0 : 1);
  const sorted = [...jem.recordings].sort((a, b) => {
    const na = byId.get(a.eventId);
    const nb = byId.get(b.eventId);
    return (na ? depth(na) : 1) - (nb ? depth(nb) : 1) || a.eventId - b.eventId || a.recordingId - b.recordingId;
  });
  const seen = new Set<string>();
  for (const recording of sorted) {
    const node = byId.get(recording.eventId);
    if (!node) continue;
    const tree = out.get(rootOf(node).id)!;
    const file = jemFilename(recording.url);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    tree.recordings.push(recording);
  }
  return [...out.values()].sort((a, b) => a.root.id - b.root.id);
}

/** A date to the day (`5714-06B-14`), not only a month or a year. */
const fullDate = (key: string) => /^\d{4}-[0-9AB]{2,3}-\d{2}$/.test(key);

/**
 * Which farbrengen each JEM event is: one sharing a recording with it,
 * or else, on a date where JEM and the catalog have the same number of
 * farbrengens, the one in the same place in the day.
 */
export function matchFarbrengens(input: JemInput): Map<number, number> {
  const all = trees(input.jem);
  const byFile = new Map<string, number>();
  for (const o of input.occasions) for (const a of o.audio) byFile.set(a.workerFilename, o.occasionId);
  const matched = new Map<number, number>();
  const taken = new Set<number>();
  for (const tree of all) {
    const occasion = tree.recordings.map((r) => byFile.get(jemFilename(r.url))).find((id) => id !== undefined);
    if (occasion !== undefined && !taken.has(occasion)) {
      matched.set(tree.root.id, occasion);
      taken.add(occasion);
    }
  }
  const occasionsOn = new Map<string, Array<{ id: number; order: number }>>();
  for (const o of input.occasions) {
    const when = occasionDate(o.hebrewDate);
    if (!when || !fullDate(when.date) || taken.has(o.occasionId)) continue;
    occasionsOn.set(when.date, [...(occasionsOn.get(when.date) ?? []), { id: o.occasionId, order: when.order }]);
  }
  const jemOn = new Map<string, Tree[]>();
  for (const tree of all) {
    if (matched.has(tree.root.id) || !tree.date || !fullDate(tree.date) || jemKind(tree.root.type) !== 'farbrengen') continue;
    jemOn.set(tree.date, [...(jemOn.get(tree.date) ?? []), tree]);
  }
  for (const [date, jems] of jemOn) {
    const ours = (occasionsOn.get(date) ?? []).sort((a, b) => a.order - b.order);
    if (ours.length !== jems.length) continue;
    jems.sort((a, b) => Number(a.root.afterNightfall) - Number(b.root.afterNightfall) || a.root.id - b.root.id);
    jems.forEach((tree, i) => matched.set(tree.root.id, ours[i]!.id));
  }
  return matched;
}

export function jemImporter(input: JemInput | (() => Promise<JemInput>), options: { proxy?: string } = {}): Importer {
  const proxy = options.proxy ?? SICHOS_KODESH_MEDIA_PROXY;
  return {
    id: 'jem',
    bot: { id: 'bot:jem', displayName: 'JEM recordings importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const data = typeof input === 'function' ? await input() : input;
      const matched = matchFarbrengens(data);
      const known = new Set(data.occasions.flatMap((o) => o.audio.map((a) => a.workerFilename)));
      const partsOf = new Map(data.occasions.map((o) => [o.occasionId, o.audio.length]));
      const nodes = new Map(data.jem.nodes.map((n) => [n.id, n]));
      yield { key: JEM_SET.key, type: 'set', path: JEM_SET.path, data: { name: JEM_SET.name, slug: 'jem', policy: 'moderated', keepers: [] } };
      for (const tree of trees(data.jem)) {
        const { root } = tree;
        const occasion = matched.get(root.id);
        const fresh = tree.recordings.filter((r) => !known.has(jemFilename(r.url)));
        let eventKey: string;
        if (occasion !== undefined) {
          if (!fresh.length) continue; // the farbrengen already has every recording JEM has
          eventKey = `mafteiach-occasion:${occasion}`;
        } else {
          if (!tree.recordings.length) continue;
          eventKey = `jem-event:${root.id}`;
          const kind = jemKind(root.type);
          const name = root.name.trim() || root.type || `JEM ${root.id}`;
          yield {
            key: eventKey,
            type: 'event',
            path: `/events/jem/${root.id}`,
            data: {
              kind,
              title: { he: name.slice(0, 500), en: name.slice(0, 500) },
              ...(tree.date ? { date: tree.date } : {}),
              ...(root.afterNightfall ? { order: 1 } : {}),
              links: [{ kind: 'audio', label: { he: 'JEM (אשרינו)', en: 'JEM (Ashreinu)' }, url: jemPlayerUrl(root.id, root.id), source: 'jem' }],
              sets: kind === 'farbrengen' ? [ref(JEM_SET.key), ref(FARBRENGENS_SET.key)] : [ref(JEM_SET.key)],
              externalIds: { jem: String(root.id) },
              sources: [{ source: 'jem', sourceId: String(root.id), url: jemPlayerUrl(root.id, root.id), note: root.type.slice(0, 200) || undefined }],
            },
          };
        }
        const first = occasion !== undefined ? (partsOf.get(occasion) ?? 0) : 0;
        // The Rebbe speaking is Yiddish; davening and the rest are left unsaid.
        const spoken = occasion !== undefined || ['farbrengen', 'sicha', 'maamar', 'yechidus', 'kinus'].includes(jemKind(root.type));
        for (const [i, recording] of (occasion !== undefined ? fresh : tree.recordings).entries()) {
          const file = jemFilename(recording.url);
          const node = nodes.get(recording.eventId);
          yield {
            key: `jem-audio:${file.replace(/\.[a-z0-9]+$/i, '')}`,
            type: 'recording',
            data: {
              event: ref(eventKey),
              title: partName(recording.name || node?.name || ''),
              url: audioUrl(file, proxy),
              ...(recording.durationMs > 0 ? { durationMs: recording.durationMs } : {}),
              part: first + i + 1,
              ...(spoken ? { language: 'yi' } : {}),
              externalIds: { 'jem-recording': String(recording.recordingId), 'jem-event': String(recording.eventId) },
              sources: [{ source: 'jem', sourceId: file, url: jemPlayerUrl(root.id, recording.eventId) }],
            },
          };
        }
      }
    },
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * An item's data with every link to JEM's player in the older form
 * replaced by the Ashreinu app's own; everything else (the audio, still
 * heard through the media proxy) as it was. Null when nothing in it needs
 * it. `rebbehub relink-jem` (services/jobs) sends these.
 */
export function relinkJem(data: Json): { data: Json; links: number } | null {
  let links = 0;
  const convert = (value: Json): Json => {
    if (typeof value === 'string') {
      const player = OLD_PLAYER.exec(value);
      const url = player ? jemPlayerUrl(Number(player[1]), Number(player[2])) : null;
      if (!url) return value;
      links++;
      return url;
    }
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, convert(v)]));
    return value;
  };
  const out = convert(data);
  return links ? { data: out, links } : null;
}
