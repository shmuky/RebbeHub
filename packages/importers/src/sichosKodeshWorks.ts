import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { joinPath, orderKeys, slugify, type Genre, type LocalName } from '@rebbehub/model';
import { ref, type ImportRecord, type Importer } from './importer.js';

/**
 * The works Sichos-Kodesh already knows (its catalog schema 3, as its
 * `build-catalog-works` writes it to apps/mobile/src/catalog/data/works):
 * authors, the ~80 works of its registry with their sources, and the units
 * of every work imported so far. Read from a Sichos-Kodesh checkout at run
 * time - RebbeHub keeps no copy - and turned into sets (one per genre),
 * authors, works and units. The phone's ids ride along in `externalIds`,
 * so the release RebbeHub builds back for Sichos-Kodesh keeps them.
 */

/** Sichos-Kodesh's catalog schema 3 (its packages/catalog/src/works/types.ts), as far as this reads it. */
interface CatalogNames {
  he: string;
  en: string;
}
interface CatalogWorkSource {
  source: string;
  sourceId: string;
  kind: 'text' | 'scan' | 'pdf' | 'audio' | 'video';
  language?: 'he' | 'en' | 'yi';
  licence: string;
  rights: string;
  credit?: string;
  version?: string;
}
interface CatalogWorksIndex {
  authors: Array<{ id: string; name: CatalogNames; rebbe?: number }>;
  works: Array<{ id: string; title: CatalogNames; authors: string[]; genre: string; levels: string[]; collection?: string; sources: CatalogWorkSource[] }>;
}
type CatalogContentsEntry = { unitId: string } | { title: CatalogNames; entries: CatalogContentsEntry[] };
interface CatalogWorkContents {
  workId: string;
  contents: CatalogContentsEntry[];
  units: Array<{ id: string; label: string; labelEn?: string; ref?: string; editions: Array<{ source: number; sha256?: string; bytes?: number }> }>;
}

export const GENRE_NAMES: Record<Genre, LocalName> = {
  chassidus: { he: 'חסידות', en: 'Chassidus' },
  maamarim: { he: 'מאמרים', en: 'Maamarim' },
  sichos: { he: 'שיחות', en: 'Sichos' },
  igros: { he: 'אגרות', en: 'Letters' },
  halacha: { he: 'הלכה', en: 'Halacha' },
  siddur: { he: 'סידור', en: 'Siddur' },
  minhagim: { he: 'מנהגים', en: 'Minhagim' },
  history: { he: 'תולדות', en: 'History' },
  diaries: { he: 'יומנים', en: 'Diaries' },
  recordings: { he: 'הקלטות', en: 'Recordings' },
};

/** First path segments the site keeps for itself; a work with one of these names lives under /works/. */
const RESERVED = new Set(['events', 'sets', 'authors', 'people', 'places', 'topics', 'search', 'schemas', 'api', 'projects', 'suggestions', 'reports', 'history', 'teshuros', 'about', 'works', 'sources']);

const workPath = (id: string) => (RESERVED.has(id) ? `/works/${id}` : `/${id}`);

export interface SichosKodeshWorksInput {
  index: CatalogWorksIndex;
  contents: CatalogWorkContents[];
}

/** Reads the works from a Sichos-Kodesh checkout (or any folder laid out like its data/works). */
export async function readSichosKodeshWorks(root: string): Promise<SichosKodeshWorksInput> {
  const dir = root.endsWith('works') ? root : join(root, 'apps/mobile/src/catalog/data/works');
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8')) as CatalogWorksIndex;
  const contents: CatalogWorkContents[] = [];
  for (const name of (await readdir(join(dir, 'contents'))).filter((n) => n.endsWith('.json')).sort()) {
    contents.push(JSON.parse(await readFile(join(dir, 'contents', name), 'utf8')) as CatalogWorkContents);
  }
  return { index, contents };
}

function* unitRecords(work: CatalogWorksIndex['works'][number], contents: CatalogWorkContents): Generator<ImportRecord> {
  const units = new Map(contents.units.map((u) => [u.id, u]));
  const placed: Array<{ unitId: string; position: Array<{ level: string; value: string; label?: LocalName }> }> = [];
  const walk = (entries: CatalogContentsEntry[], trail: Array<{ level: string; value: string; label?: LocalName }>) => {
    entries.forEach((entry, i) => {
      const level = work.levels[trail.length] ?? (('entries' in entry) ? 'part' : 'unit');
      if ('entries' in entry) walk(entry.entries, [...trail, { level, value: String(i + 1), label: { he: entry.title.he, en: entry.title.en } }]);
      else placed.push({ unitId: entry.unitId, position: [...trail, { level, value: String(i + 1) }] });
    });
  };
  walk(contents.contents, []);
  const orders = orderKeys(placed.length);
  for (const [i, { unitId, position }] of placed.entries()) {
    const unit = units.get(unitId);
    if (!unit) continue;
    const label: LocalName = { he: unit.label };
    if (unit.labelEn) label.en = unit.labelEn;
    yield {
      key: `sichos-kodesh-unit:${work.id}/${unit.id}`,
      type: 'unit',
      path: joinPath(workPath(work.id).slice(1), ...position.map((p) => p.value)),
      data: {
        work: ref(`sichos-kodesh-work:${work.id}`),
        position,
        order: orders[i]!,
        label,
        externalIds: { 'sichos-kodesh-unit': unit.id },
        editions: unit.editions
          .map((e) => work.sources[e.source])
          .filter((s): s is CatalogWorkSource => s !== undefined)
          .map((s) => {
            const edition: Record<string, string> = { source: s.source, sourceId: unit.ref ?? unit.id, kind: s.kind, licence: s.licence };
            if (s.language) edition.language = s.language;
            if (s.version) edition.version = s.version;
            if (s.credit) edition.credit = s.credit;
            return edition;
          }),
      },
    };
  }
}

export function sichosKodeshWorksImporter(input: SichosKodeshWorksInput | (() => Promise<SichosKodeshWorksInput>)): Importer {
  return {
    id: 'sichos-kodesh-works',
    bot: { id: 'bot:sichos-kodesh-works', displayName: 'Sichos-Kodesh works importer' },
    async *records() {
      const { index, contents } = typeof input === 'function' ? await input() : input;
      const genres = [...new Set(index.works.map((w) => w.genre))].sort() as Genre[];
      for (const genre of genres) {
        yield { key: `rebbehub-set:${genre}`, type: 'set', path: `/sets/${genre}`, data: { name: GENRE_NAMES[genre] ?? { he: genre, en: genre }, slug: genre, policy: 'moderated', keepers: [] } };
      }
      for (const author of index.authors) {
        const data: Record<string, unknown> = { name: author.name, kind: 'rebbe', slug: author.id, externalIds: { 'sichos-kodesh-author': author.id } };
        if (author.rebbe) data.rebbe = author.rebbe;
        yield { key: `sichos-kodesh-author:${author.id}`, type: 'author', path: `/authors/${slugify(author.id)}`, data };
      }
      for (const work of index.works) {
        const externalIds: Record<string, string> = { 'sichos-kodesh-work': work.id };
        if (work.collection) externalIds['sichos-kodesh-collection'] = work.collection;
        yield {
          key: `sichos-kodesh-work:${work.id}`,
          type: 'work',
          path: workPath(work.id),
          data: {
            title: work.title,
            slug: work.id,
            authors: work.authors.map((a) => ref(`sichos-kodesh-author:${a}`)),
            genre: work.genre,
            levels: work.levels,
            sets: [ref(`rebbehub-set:${work.genre}`)],
            externalIds,
            sourceCopies: work.sources.map((s) => {
              const copy: Record<string, string> = { source: s.source, sourceId: s.sourceId, kind: s.kind, licence: s.licence };
              if (s.language) copy.language = s.language;
              if (s.credit) copy.credit = s.credit;
              if (s.version) copy.version = s.version;
              return copy;
            }),
          },
        };
      }
      const works = new Map(index.works.map((w) => [w.id, w]));
      for (const c of contents) {
        const work = works.get(c.workId);
        if (work) yield* unitRecords(work, c);
      }
    },
  };
}
