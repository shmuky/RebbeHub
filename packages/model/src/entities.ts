import type { DateKey } from '@rebbehub/hebrew';
import type { RightsState } from './rights.js';
import type { EntityId } from './ids.js';
import type { EditionKind, Genre, Licence, SourceId } from './works.js';

/**
 * Every kind of item RebbeHub holds, as the data of one revision of one
 * entity (docs/plans/rebbehub.md, section 4). The JSON Schemas in
 * schemas/ say the same thing for the store, which validates every
 * suggestion against them; a test keeps the two in step.
 *
 * Content (what was said or written): Author, Work, Unit, Event.
 * Print (what exists on paper and in files): Publication, Scan, ContentsMap.
 * Text (the words, versioned per page and per segment): TextLayer,
 * TextPage, Text, Segment.
 * Media: Recording, Alignment, AlignmentSpan (a transcript is a Text).
 * Glue: Relation, Person, Place, Topic, Source, Set, and Schema itself.
 */

export type EntityType =
  | 'set'
  | 'author'
  | 'work'
  | 'unit'
  | 'event'
  | 'publication'
  | 'scan'
  | 'contents-map'
  | 'text-layer'
  | 'text-page'
  | 'text'
  | 'segment'
  | 'recording'
  | 'alignment'
  | 'alignment-span'
  | 'relation'
  | 'person'
  | 'place'
  | 'topic'
  | 'source'
  | 'schema';

export const ENTITY_TYPES: readonly EntityType[] = [
  'set',
  'author',
  'work',
  'unit',
  'event',
  'publication',
  'scan',
  'contents-map',
  'text-layer',
  'text-page',
  'text',
  'segment',
  'recording',
  'alignment',
  'alignment-span',
  'relation',
  'person',
  'place',
  'topic',
  'source',
  'schema',
];

/** A name in the languages it has; Hebrew first, English when someone has given one. */
export interface LocalName {
  he: string;
  en?: string;
  yi?: string;
}

export type Language = 'he' | 'en' | 'yi' | 'ar' | 'ru' | 'fr' | 'es';

/**
 * Where RebbeHub learned something: the Sichos-Kodesh sources, plus the
 * places people and bots bring things from.
 */
export type CatalogSourceId = SourceId | 'contribution' | 'nli' | 'kehot' | 'chabad-org' | 'youtube' | 'archive-org' | 'otzar-hachochma' | 'library-of-agudas-chassidei-chabad' | 'other';

/** Provenance of a fact or a file (the archive's `sources` row, as data). */
export interface SourceRef {
  source: CatalogSourceId;
  /** The source's own id for the thing. */
  sourceId?: string;
  url?: string;
  /** ISO time the fact was read. */
  fetchedAt?: string;
  etag?: string;
  note?: string;
}

/** The ids other systems know a thing by: `{ 'mafteiach-occasion': '1234', 'sichos-kodesh-work': 'tanya', hebrewbooks: '14063' }`. */
export type ExternalIds = Record<string, string>;

/** Who made a thing, when a machine did: labelled until a person checks it, and never shown as the Rebbe's words before that. */
export interface MachineOrigin {
  /** The bot or engine: `ocr:tesseract-heb@5.3`, `importer:mafteiach`, `align:whisperx@3`. */
  by: string;
  /** Set once a person has checked it. */
  checked?: boolean;
}

/** Proofread level: 0 raw machine output, 1 checked once, 2 checked twice. */
export type ProofreadLevel = 0 | 1 | 2;

/** The fields every catalog item may carry. */
export interface CommonFields {
  /** The sets it belongs to. */
  sets?: EntityId[];
  externalIds?: ExternalIds;
  sources?: SourceRef[];
  topics?: EntityId[];
  note?: string;
  /**
   * The page itself, as wikitext: a letter's words, a chapter's text, a
   * farbrengen's outline. Everything in the catalog is a page people read
   * and edit, as on a wiki; the other fields are its infobox.
   */
  body?: string;
  /** Where the body came from, when an importer brought it: the source, how, its licence and credit. */
  bodySource?: BodySource;
}

/** The record of where a page's words were imported from (`mafteiach`, the Igros app, Sefaria). */
export interface BodySource {
  source: CatalogSourceId;
  /** The index or tool it came through: `mafteiach-index`, `igros-index`, `sefaria-index`. */
  via?: string;
  sourceId?: string;
  url?: string;
  /** RebbeHub's own copy of the text as the source gave it (`/v1/texts/<sha256>`), kept on RebbeHub's storage. */
  copy?: string;
  licence?: string;
  credit?: string;
  /** What may be done with the words (docs/rights.md): shown and exported when `open` or `credit`, withheld otherwise. */
  rights?: RightsState;
  /** ISO time it was imported. */
  importedAt?: string;
}

// ---------------------------------------------------------------- glue

export type SetPolicy = 'open' | 'moderated' | 'locked';

/** A Set (סט): what a person browses, with its keepers and its policy. The "repository" of GitHub. */
export interface SetData extends CommonFields {
  name: LocalName;
  slug: string;
  description?: LocalName;
  /** open: trusted people's line fixes go live; moderated (default): everything reviewed; locked: rights not cleared, nothing served. */
  policy: SetPolicy;
  /** Account ids of the set keepers, who approve suggestions here. */
  keepers: string[];
  /** The set this one sits under, for large collections (Farbrengens → Farbrengens 5742). */
  parent?: EntityId;
}

export type AuthorKind = 'rebbe' | 'chossid' | 'editor' | 'family' | 'institution' | 'unknown';

export interface AuthorData extends CommonFields {
  name: LocalName;
  kind: AuthorKind;
  /** The Rebbe's place in the line of Chabad Rebbeim, 1 (the Alter Rebbe) to 7. */
  rebbe?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Its Sichos-Kodesh author id (`alter-rebbe`), kept so releases convert back. */
  slug?: string;
  born?: DateKey;
  passed?: DateKey;
}

export interface PersonData extends CommonFields {
  name: LocalName;
  aliases?: string[];
  born?: DateKey;
  passed?: DateKey;
  /** The author entity, when this person also wrote. */
  author?: EntityId;
}

export interface PlaceData extends CommonFields {
  name: LocalName;
  aliases?: string[];
  /** `770`, `Crown Heights`, `Lubavitch`, `Rostov`. */
  kind?: 'city' | 'building' | 'region' | 'country' | 'other';
  within?: EntityId;
  geo?: { lat: number; lon: number };
}

export interface TopicData extends CommonFields {
  name: LocalName;
  aliases?: string[];
  broader?: EntityId;
}

export interface SourceData {
  key: CatalogSourceId;
  name: LocalName;
  url?: string;
  /** What its terms let us do by default with what it holds. */
  licence: Licence;
  terms?: string;
  credit?: string;
}

/** A kind of entity, as data: new kinds of item are a schema change through the same review, not a code release. */
export interface SchemaData {
  /** The entity type it governs. */
  entityType: string;
  label: LocalName;
  /** A JSON Schema (2020-12) for the type's data. */
  jsonSchema: Record<string, unknown>;
  /** Bumped on every accepted change; a revision records the version it was checked against. */
  version: number;
}

// ---------------------------------------------------------------- content

/** One source's copy of a work, as Sichos-Kodesh lists it (`WorkSource`), with RebbeHub's wider source ids. */
export interface WorkSourceData {
  source: CatalogSourceId;
  sourceId: string;
  kind: EditionKind;
  language?: Language;
  licence: Licence;
  credit?: string;
  version?: string;
}

export interface WorkData extends CommonFields {
  title: LocalName;
  /** Its Sichos-Kodesh work id (`likkutei-sichos`): stable, and the first segment of its units' paths. */
  slug: string;
  authors: EntityId[];
  genre: Genre;
  /** Its structure, outermost first: `['volume', 'parsha', 'sicha']`; empty until its units are known. */
  levels: string[];
  sourceCopies?: WorkSourceData[];
  description?: LocalName;
}

/** A unit's place in its work, one step per level: `{ level: 'volume', value: '12' }`. */
export interface PositionStep {
  level: string;
  value: string;
  label?: LocalName;
}

/** One source's copy of one unit (Sichos-Kodesh's `Edition`, with provenance of RebbeHub's own). */
export interface EditionData {
  source: CatalogSourceId;
  sourceId: string;
  kind: EditionKind;
  licence: Licence;
  role?: string;
  label?: string;
  language?: Language;
  version?: string;
  credit?: string;
  url?: string;
}

/** What a person reads or hears: a sicha, a maamar, a letter, a chapter, a story, a diary entry. */
export interface UnitData extends CommonFields {
  work: EntityId;
  /** Its place in the work, outermost first, one step per level of the work. */
  position: PositionStep[];
  /** A fractional sort key among its siblings, so a unit is inserted without renumbering the rest. */
  order: string;
  label: LocalName;
  date?: DateKey;
  /** The events it belongs to (a sicha to its farbrengen, a letter to its date). */
  events?: EntityId[];
  editions?: EditionData[];
}

export type EventKind = 'farbrengen' | 'sicha' | 'maamar' | 'yechidus' | 'letter' | 'simcha' | 'kinus' | 'other';

/** Something that happened on a day: a farbrengen, a yechidus, a simcha, the writing of a letter. */
export interface EventData extends CommonFields {
  kind: EventKind;
  title: LocalName;
  date?: DateKey;
  /** For events spanning days. */
  dateEnd?: DateKey;
  place?: EntityId;
  /** The occasion, as Sichos-Kodesh's occasion identity names it (`yud-shvat`, `shabbos-parshas-bo`). */
  occasion?: string;
  people?: EntityId[];
  /** Order among events of the same day (a Shabbos farbrengen before a motzei Shabbos one). */
  order?: number;
  /** Its documents kept where they are, hanachos first: RebbeHub links to them and holds no copy (docs/rights.md). */
  links?: EventLink[];
}

/** What an event's document is: the edited text, the unedited hanacha, a maamar, the Rebbe's glosses, additions. */
export type EventLinkKind = 'mugah' | 'bilti-mugah' | 'maamar' | 'hagahos' | 'hosofos' | 'english' | 'audio' | 'video' | 'other';

export const EVENT_LINK_KINDS: readonly EventLinkKind[] = ['mugah', 'bilti-mugah', 'maamar', 'hagahos', 'hosofos', 'english', 'audio', 'video', 'other'];

/** One document or recording of an event, where it is: a PDF of a hanacha (through a proxy), a book on HebrewBooks, a video on YouTube or JEM. */
export interface EventLink {
  kind: EventLinkKind;
  label: LocalName;
  url: string;
  source?: CatalogSourceId;
}

// ---------------------------------------------------------------- print

export type PublicationKind = 'book-volume' | 'kovetz' | 'periodical-issue' | 'booklet' | 'teshura' | 'manuscript' | 'other';

/** The simcha a teshura was printed for. */
export interface Simcha {
  kind: 'wedding' | 'bar-mitzvah' | 'bris' | 'upsherenish' | 'hachnasas-sefer-torah' | 'yahrzeit' | 'other';
  /** The families, as printed on the title page. */
  families: string[];
  date?: DateKey;
  place?: string;
}

export interface PublicationIdentifiers {
  hebrewbooks?: string;
  nli?: string;
  isbn?: string[];
  oclc?: string;
  otzar?: string;
}

/** A printed thing: a volume, a kovetz, an issue, a booklet, a teshura. The same work printed by two publishers is two publications. */
export interface PublicationData extends CommonFields {
  kind: PublicationKind;
  title: LocalName;
  /** The work it is (a volume) or mostly holds. */
  work?: EntityId;
  /** Its volume or issue number, as printed. */
  volume?: string;
  publisher?: string;
  placePrinted?: string;
  /** The Hebrew year (or date) on the title page. */
  date?: DateKey;
  gregorianYear?: number;
  /** Which printing (1 for the first). */
  printing?: number;
  pageCount?: number;
  identifiers?: PublicationIdentifiers;
  simcha?: Simcha;
  /** The earlier publication this one reprints, if any. */
  reprintOf?: EntityId;
}

export type ScanCompleteness = 'complete' | 'partial' | 'unknown';

/** One PDF of one publication, stored once by its sha256. */
export interface ScanData extends CommonFields {
  publication: EntityId;
  /** The file (in the `file` table) this scan is. */
  file: string;
  pageCount?: number;
  completeness: ScanCompleteness;
  /** Chosen by keepers: the scan shown first. */
  preferred?: boolean;
  quality?: 'good' | 'fair' | 'poor';
  /** Pages the book numbers differently from the PDF: `{ pdfPage: 5, printed: 'א' }` from where numbering starts. */
  pageLabels?: Array<{ pdfPage: number; printed: string }>;
}

/** Pages of a publication ↔ a unit: "pp. 12–15 of this teshura reproduce the letter of 5 Tishrei 5720". */
export interface ContentsMapData {
  publication: EntityId;
  /** Printed (or PDF) page range, inclusive. */
  pages: { from: number; to: number; scheme: 'printed' | 'pdf' };
  unit?: EntityId;
  /** What is there, when it is not (yet) a unit. */
  label?: LocalName;
  origin?: MachineOrigin;
}

// ---------------------------------------------------------------- text

export type TextLayerKind = 'machine-ocr' | 'uploaded-ocr' | 'community';

/** The text of one scan, page by page. Only the community layer is edited; OCR layers are kept as they came. */
export interface TextLayerData {
  scan: EntityId;
  kind: TextLayerKind;
  /** The OCR engine and version, so pages can be re-read when engines improve. */
  engine?: { name: string; version: string };
  /** The layer the community text was seeded from. */
  seededFrom?: EntityId;
  language?: Language;
  uploadedBy?: string;
}

/** One line of a page, where it stands on the image. Ids are stable within the page, so two people fixing different lines never clash. */
export interface TextLine {
  id: string;
  text: string;
  /** x, y, width, height as fractions (0-1) of the page image. */
  box?: [number, number, number, number];
  proofread?: ProofreadLevel;
}

/** One page of a text layer: the unit of versioning for scan text. */
export interface TextPageData {
  layer: EntityId;
  /** PDF page, from 1. */
  page: number;
  lines: TextLine[];
  proofread: ProofreadLevel;
}

export type TextKind = 'edition' | 'transcript' | 'translation' | 'hanacha';

/** The text of a unit (or a recording's transcript), segmented into paragraphs. */
export interface TextData {
  kind: TextKind;
  /** The unit it is the text of. */
  unit?: EntityId;
  /** The printing it comes from, so printings can be compared. */
  publication?: EntityId;
  /** For a transcript: the recording. */
  recording?: EntityId;
  language: Language;
  /** For a translation: the text it translates. */
  translationOf?: EntityId;
  licence?: Licence;
  credit?: string;
}

export type SegmentKind = 'heading' | 'paragraph' | 'footnote' | 'note' | 'quote';

/**
 * One paragraph of a text: the unit of versioning for unit text. Its id
 * never changes, so a citation (`LS 12:3 ¶4`) resolves to it through any
 * number of edits; ¶4 is only how it is numbered today.
 */
export interface SegmentData {
  text: EntityId;
  order: string;
  kind: SegmentKind;
  content: string;
  proofread: ProofreadLevel;
  /** Where it stands in a scan, when known. */
  page?: { scan: EntityId; page: number; lines?: string[] };
  origin?: MachineOrigin;
}

// ---------------------------------------------------------------- media

export type VideoProvider = 'youtube' | 'jem' | 'chabad-org' | 'vimeo' | 'other';

/** A video kept where it is, with where in it this recording's event starts. */
export interface VideoLink {
  provider: VideoProvider;
  url: string;
  startMs?: number;
  endMs?: number;
}

/** An audio recording of an event (several per event: sources, qualities, parts), plus its videos elsewhere. */
export interface RecordingData extends CommonFields {
  event?: EntityId;
  title: LocalName;
  /** The audio file, by sha256, when RebbeHub holds it. */
  file?: string;
  /** Or where it is heard, when RebbeHub links rather than holds it. */
  url?: string;
  durationMs?: number;
  /** Which part of the event, when it is recorded in parts. */
  part?: number;
  language?: Language;
  videos?: VideoLink[];
}

export type AlignmentGranularity = 'word' | 'paragraph';

/** A recording synced to a text: word-level against a verbatim transcript, paragraph-level against a hanacha. */
export interface AlignmentData {
  recording: EntityId;
  text: EntityId;
  granularity: AlignmentGranularity;
  engine?: { name: string; version: string };
}

/** Where one segment is heard: the unit of versioning for sync. A span a person fixed is locked against re-runs. */
export interface AlignmentSpanData {
  alignment: EntityId;
  segment: EntityId;
  startMs: number;
  endMs: number;
  /** Word timings for word-level sync: character offsets into the segment. */
  words?: Array<{ from: number; to: number; startMs: number; endMs: number }>;
  locked?: boolean;
  origin?: MachineOrigin;
}

// ---------------------------------------------------------------- relations

export type RelationKind = 'based-on' | 'printed-in' | 'translation-of' | 'answer-to' | 'cites' | 'same-recording-as' | 'reproduces';

/** A typed edge between two entities. */
export interface RelationData {
  kind: RelationKind;
  from: EntityId;
  to: EntityId;
  /** Where in `from`, when it is a place in a text (a segment). */
  at?: EntityId;
  note?: string;
  origin?: MachineOrigin;
}

// ---------------------------------------------------------------- the map

export interface EntityDataByType {
  set: SetData;
  author: AuthorData;
  work: WorkData;
  unit: UnitData;
  event: EventData;
  publication: PublicationData;
  scan: ScanData;
  'contents-map': ContentsMapData;
  'text-layer': TextLayerData;
  'text-page': TextPageData;
  text: TextData;
  segment: SegmentData;
  recording: RecordingData;
  alignment: AlignmentData;
  'alignment-span': AlignmentSpanData;
  relation: RelationData;
  person: PersonData;
  place: PlaceData;
  topic: TopicData;
  source: SourceData;
  schema: SchemaData;
}

export type EntityData = EntityDataByType[EntityType];

/** An entity as the store returns it: its permanent id, type, path and the data of the revision asked for. */
export interface Entity<T extends EntityType = EntityType> {
  id: EntityId;
  type: T;
  path?: string;
  data: EntityDataByType[T];
  /** The revision this data is. */
  rev: string;
}
