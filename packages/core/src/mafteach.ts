import { normalizeSearchText, toHebrewNumeral, unfinal } from '@rebbehub/hebrew';
import type { PageInline, PageSegment, PageVersion } from '@rebbehub/model';
import type { Catalog } from './catalog.js';

/**
 * A sefer's whole subject index on one page, gathered from the index's own
 * pages (one a volume, as the per-volume pages hold them): every topic once,
 * with each volume's places under it, each place its context (the words
 * the index prints beside the page number) and its links, the sicha's PDF
 * at that page and the sicha's own page here. Nothing is stored for it:
 * a fix on the index pages shows here once they change.
 *
 * Words a machine read and no person checked stay labelled (`machine`),
 * volume by volume.
 */

export interface MafteachPlace {
  /** The page the index names, and the last page of a range. */
  page: number;
  to?: number;
  /** The index's own words for what is on that page. */
  context?: string;
  /** The sicha's PDF, the page of the PDF where this place is, and the sicha's name. */
  pdf?: string;
  at?: number;
  sicha?: string;
  /** The sicha's page here, when the catalog has it. */
  text?: string;
}

export interface MafteachVolume {
  volume: number;
  label: string;
  /** The index page of that volume, where its words are fixed. */
  path: string | null;
  /** Read by a machine, and not yet checked by a person. */
  machine: boolean;
  places: MafteachPlace[];
}

export interface MafteachTopic {
  topic: string;
  letter: string;
  volumes: MafteachVolume[];
}

export interface Mafteach {
  index: { id: string; path: string | null; title: unknown };
  /** Each first letter and how many topics under it, in order. */
  letters: Array<{ letter: string; topics: number }>;
  totals: { topics: number; places: number; volumes: number };
  /** The topics asked for: one letter's, or those a search found. */
  topics: MafteachTopic[];
  /** How many topics the letter or the search holds in all; `topics` are those from `offset`, up to `limit` topics or `places` places. */
  found: number;
  offset: number;
  /** The offset of the next topics, or null at the end. */
  next: number | null;
}

interface Built {
  index: Mafteach['index'];
  topics: Array<MafteachTopic & { key: string; words: string }>;
  totals: Mafteach['totals'];
}

const cache = new Map<string, { stamp: string; built: Built }>();

/** A topic as a key: the same topic printed a little differently in two volumes (quotes, a final letter) meets once. */
const keyOf = (topic: string) => unfinal(normalizeSearchText(topic));
const LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת';

/** The index's runs of one volume's paragraph as places: `126 (context). 194.` */
export function placesOf(runs: readonly PageInline[], textOf: (pdf: string) => string | undefined): MafteachPlace[] {
  const places: MafteachPlace[] = [];
  for (const run of runs) {
    if (!('text' in run)) continue;
    const pages = /^(\d+)(?:-(\d+))?$/.exec(run.text.trim());
    if (pages) {
      const place: MafteachPlace = { page: Number(pages[1]) };
      // A range the reading mangled (337-0) keeps its first page alone.
      if (pages[2] && Number(pages[2]) > place.page) place.to = Number(pages[2]);
      if (run.href) {
        // The index links the reader (`/read?page=&title=&src=`): kept as its parts, the PDF's own address and the page in it.
        const query = new URLSearchParams(run.href.slice(run.href.indexOf('?') + 1));
        const src = query.get('src') ?? '';
        const drive = driveId(src);
        place.pdf = drive ? `https://drive.google.com/file/d/${drive}/view` : src || run.href;
        const at = Number(query.get('page'));
        if (Number.isInteger(at) && at > 1) place.at = at;
        const sicha = query.get('title')?.trim();
        if (sicha) place.sicha = sicha;
        const text = textOf(src);
        if (text) place.text = text;
      }
      places.push(place);
      continue;
    }
    const context = /^\s*\((.*)\)\s*$/s.exec(run.text);
    const last = places[places.length - 1];
    if (context && last && !last.context) last.context = context[1]!.trim();
  }
  return places;
}

/** A Drive file's id, from any of its link shapes (`/file/d/<id>/view`, `open?id=<id>`). */
export function driveId(url: string): string | null {
  return /\/d\/([\w-]{10,})/.exec(url)?.[1] ?? /[?&]id=([\w-]{10,})/.exec(url)?.[1] ?? null;
}

async function build(catalog: Catalog, indexId: string, seferId: string | null): Promise<Built> {
  const [head, units, sichos] = await Promise.all([
    catalog.db.query<{ path: string | null; title: unknown }>(`SELECT e.path, r.data->'title' AS title FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.id = $1`, [indexId]),
    catalog.db.query<{ path: string | null; position: Array<{ value?: string }> | null; version: PageVersion | null }>(
      `SELECT e.path, r.data->'position' AS position, r.data->'body'->'versions'->0 AS version
       FROM revision r JOIN entity e ON e.id = r.entity_id AND e.main_rev = r.id AND NOT e.deleted
       WHERE r.data->>'work' = $1 AND e.type = 'unit'`,
      [indexId],
    ),
    // The sefer's sichos by their PDF, for each place's link to the sicha's own page.
    seferId
      ? catalog.db.query<{ path: string; url: string }>(
          `SELECT e.path, ed->>'url' AS url
           FROM revision r JOIN entity e ON e.id = r.entity_id AND e.main_rev = r.id AND NOT e.deleted,
                jsonb_array_elements(CASE WHEN jsonb_typeof(r.data->'editions') = 'array' THEN r.data->'editions' ELSE '[]'::jsonb END) ed
           WHERE r.data->>'work' = $1 AND e.type = 'unit' AND e.path IS NOT NULL AND ed->>'kind' = 'pdf'`,
          [seferId],
        )
      : Promise.resolve({ rows: [] as Array<{ path: string; url: string }> }),
  ]);
  const byDrive = new Map<string, string>();
  for (const row of sichos.rows) {
    const id = driveId(row.url);
    if (id && !byDrive.has(id)) byDrive.set(id, row.path);
  }
  const textOf = (pdf: string) => {
    const id = driveId(pdf);
    return id ? byDrive.get(id) : undefined;
  };

  const topics = new Map<string, { forms: Map<string, number>; volumes: MafteachVolume[] }>();
  let places = 0;
  const volumes = new Set<number>();
  for (const unit of units.rows) {
    const volume = Number(unit.position?.[0]?.value);
    if (!Number.isInteger(volume) || !unit.version?.segments) continue;
    volumes.add(volume);
    const machineVersion = Boolean(unit.version.origin && !unit.version.origin.checked);
    let topic: string | null = null;
    for (const segment of unit.version.segments as PageSegment[]) {
      const words = (segment.text ?? []).map((run) => ('text' in run ? run.text : '')).join('').trim();
      if (segment.kind === 'heading') {
        topic = words || null;
        continue;
      }
      if (segment.kind !== 'paragraph' || !topic || topic === '(המשך)') continue;
      const found = placesOf(segment.text ?? [], textOf);
      if (!found.length) continue;
      const key = keyOf(topic);
      if (!key) continue;
      const entry = topics.get(key) ?? { forms: new Map<string, number>(), volumes: [] as MafteachVolume[] };
      topics.set(key, entry);
      entry.forms.set(topic, (entry.forms.get(topic) ?? 0) + 1);
      const machine = machineVersion || Boolean(segment.origin && !segment.origin.checked);
      const same = entry.volumes.find((v) => v.volume === volume);
      if (same) {
        same.places.push(...found);
        same.machine ||= machine;
      } else entry.volumes.push({ volume, label: `חלק ${toHebrewNumeral(volume)}`, path: unit.path, machine, places: found });
      places += found.length;
    }
  }
  const built: Built['topics'] = [...topics].map(([key, { forms, volumes: vols }]) => {
    // The form most volumes print; between equals, the plainer (shorter) one, so the page reads the same however the rows come.
    const topic = [...forms].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], 'he'))[0]![0];
    vols.sort((a, b) => a.volume - b.volume);
    const words = normalizeSearchText([topic, ...vols.flatMap((v) => v.places.map((p) => `${p.context ?? ''} ${p.sicha ?? ''}`))].join(' '));
    return { topic, key, letter: LETTERS.includes(key[0]!) ? key[0]! : '#', volumes: vols, words: unfinal(words) };
  });
  built.sort((a, b) => a.key.localeCompare(b.key, 'he'));
  return {
    index: { id: indexId, path: head.rows[0]?.path ?? null, title: head.rows[0]?.title ?? null },
    topics: built,
    totals: { topics: built.length, places, volumes: volumes.size },
  };
}

/**
 * The index at `indexId` (a work whose units are its volumes' index pages),
 * each place linked to the sicha's page in `seferId` when there is one.
 * Built once and kept until an index page or a sicha changes: one small
 * statement answers whether it did.
 */
export async function mafteach(catalog: Catalog, indexId: string, options: { seferId?: string | null; letter?: string; q?: string; limit?: number; places?: number; offset?: number } = {}): Promise<Mafteach | null> {
  const seferId = options.seferId ?? null;
  const stamp = await catalog.db.query<{ stamp: string | null }>(
    `SELECT (SELECT max(e.main_rev) FROM entity e WHERE e.id = $1)::text || ':' ||
            coalesce((SELECT max(r.id) FROM revision r JOIN entity e ON e.main_rev = r.id WHERE r.data->>'work' = ANY($2)), 0)::text AS stamp`,
    [indexId, seferId ? [indexId, seferId] : [indexId]],
  );
  const now = stamp.rows[0]?.stamp;
  if (!now) return null;
  const at = `${indexId}|${seferId ?? ''}`;
  let hit = cache.get(at);
  if (!hit || hit.stamp !== now) {
    hit = { stamp: now, built: await build(catalog, indexId, seferId) };
    cache.set(at, hit);
  }
  const { built } = hit;
  const letters: Mafteach['letters'] = [];
  for (const t of built.topics) {
    const last = letters[letters.length - 1];
    if (last?.letter === t.letter) last.topics++;
    else letters.push({ letter: t.letter, topics: 1 });
  }
  const strip = ({ key: _key, words: _words, ...t }: Built['topics'][number]): MafteachTopic => t;
  const limit = options.limit ?? 60;
  const offset = options.offset ?? 0;
  // A page holds up to `limit` topics, and stops sooner at `places` places (a topic like Shabbos has hundreds), never at none.
  const budget = options.places ?? 400;
  const page = (found: Built['topics']) => {
    const topics: MafteachTopic[] = [];
    let places = 0;
    for (const t of found.slice(offset, offset + limit)) {
      const count = t.volumes.reduce((n, v) => n + v.places.length, 0);
      if (topics.length && places + count > budget) break;
      topics.push(strip(t));
      places += count;
    }
    const end = offset + topics.length;
    return { index: built.index, letters, totals: built.totals, topics, found: found.length, offset, next: end < found.length ? end : null };
  };
  const q = unfinal(normalizeSearchText(options.q ?? ''));
  if (q) {
    const terms = q.split(' ');
    const has = (text: string) => terms.every((term) => text.includes(term));
    // The topic of that very name first, then those whose name begins with it, then those holding it, then those where only a place's context or sicha does.
    const rank = (t: Built['topics'][number]) => (t.key === q ? 0 : t.key.startsWith(q) ? 1 : 2);
    const named = built.topics.filter((t) => has(t.key)).sort((a, b) => rank(a) - rank(b));
    return page([...named, ...built.topics.filter((t) => !has(t.key) && has(t.words))]);
  }
  const letter = options.letter && letters.some((l) => l.letter === options.letter) ? options.letter : letters[0]?.letter;
  return page(built.topics.filter((t) => t.letter === letter));
}
