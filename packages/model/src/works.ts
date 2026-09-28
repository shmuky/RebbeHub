/**
 * The works contract of Sichos-Kodesh (its packages/works/src/types.ts),
 * which RebbeHub's model grew from and which the Sichos-Kodesh apps build
 * their library from. These types are kept exactly as that package states
 * them, so Sichos-Kodesh can import them from here and a RebbeHub release
 * converts to them without loss (release/sichosKodesh.ts in
 * @rebbehub/mirror). Change them only together with Sichos-Kodesh.
 *
 * One deliberate difference: `Work.collection` is a plain string here,
 * since the phone's library collection ids belong to Sichos-Kodesh's own
 * catalog package.
 */

export interface Names {
  he: string;
  en: string;
}

export interface Author {
  /** Stable, lower-case: `alter-rebbe`, `the-rebbe`. */
  id: string;
  name: Names;
  /** The Rebbe's place in the line of Chabad Rebbeim, 1 (the Alter Rebbe) to 7. */
  rebbe?: number;
}

export type Genre = 'chassidus' | 'maamarim' | 'sichos' | 'igros' | 'halacha' | 'siddur' | 'minhagim' | 'history' | 'diaries' | 'recordings';

export const GENRES: readonly Genre[] = ['chassidus', 'maamarim', 'sichos', 'igros', 'halacha', 'siddur', 'minhagim', 'history', 'diaries', 'recordings'];

/** Where a copy comes from. */
export type SourceId = 'mafteiach' | 'jem' | 'chabadlibrary' | 'sefaria' | 'hebrewbooks' | 'igros-app';

export const SOURCE_IDS: readonly SourceId[] = ['mafteiach', 'jem', 'chabadlibrary', 'sefaria', 'hebrewbooks', 'igros-app'];

/**
 * What its source lets us do with a copy, as the source states it.
 * `facts-and-links`: an index of dates, names and links to files hosted
 * elsewhere (mafteiach.app, JEM).
 */
export type Licence = 'facts-and-links' | 'public-domain' | 'cc0' | 'cc-by' | 'cc-by-nc' | 'free-to-read' | 'site-terms' | 'commercial' | 'unknown';

export const LICENCES: readonly Licence[] = ['facts-and-links', 'public-domain', 'cc0', 'cc-by', 'cc-by-nc', 'free-to-read', 'site-terms', 'commercial', 'unknown'];

export type EditionKind = 'text' | 'scan' | 'pdf' | 'audio' | 'video';

export const EDITION_KINDS: readonly EditionKind[] = ['text', 'scan', 'pdf', 'audio', 'video'];

/** One source's copy of a work. */
export interface WorkSource {
  source: SourceId;
  sourceId: string;
  kind: EditionKind;
  language?: 'he' | 'en' | 'yi';
  licence: Licence;
  credit?: string;
  version?: string;
}

export interface Work {
  /** Stable: `tanya`, `likkutei-sichos`. */
  id: string;
  title: Names;
  /** Author ids; empty for a collection of many hands. */
  authors: string[];
  genre: Genre;
  /** Its structure, outermost first: `['volume', 'sicha']`. */
  levels: string[];
  collection?: string;
  sources: WorkSource[];
}

/** A text object: one edition's text of one unit, stored by the sha256 of its bytes. */
export interface TextObjectRef {
  sha256: string;
  bytes: number;
}

/** One source's copy of one unit. */
export interface Edition {
  source: SourceId;
  sourceId: string;
  kind: EditionKind;
  licence: Licence;
  role?: string;
  label?: string;
  language?: 'he' | 'en' | 'yi';
  version?: string;
  credit?: string;
  text?: TextObjectRef;
}

/** What a person reads or hears: a letter, a maamar, a sicha, a chapter. */
export interface Unit {
  id: string;
  workId: string;
  /** In Hebrew, its place in the work without the work's title: `ליקוטי אמרים, פרק א׳`. */
  label: string;
  labelEn?: string;
  hebrewYear?: number;
  hebrewDate?: string;
  /** The farbrengen(s) it belongs to (mafteiach occasion ids). */
  occasionIds?: number[];
  editions: Edition[];
}

/** Whether a copy may leave the machine it was built on. */
export type RightsDecision = 'ship' | 'ship-with-credit' | 'link-only' | 'local-only';

export interface ContentsNode {
  title: Names;
  entries: ContentsEntry[];
}

export type ContentsEntry = { unitId: string } | ContentsNode;

/** What an importer produces for one work. */
export interface ImportedWork {
  workId: string;
  source: SourceId;
  contents: ContentsEntry[];
  units: Unit[];
}
