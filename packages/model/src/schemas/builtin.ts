import { EVENT_LINK_KINDS, type EntityType, type LocalName } from '../entities.js';
import { EDITION_KINDS, GENRES, LICENCES, SOURCE_IDS } from '../works.js';

/**
 * The built-in schema of every entity type: JSON Schema 2020-12, one
 * self-contained document per type. They seed the store's `schema`
 * entities; from then on a schema is changed like any other item, by a
 * suggestion that stewards approve (docs/plans/rebbehub.md, section 4,
 * "Schema as data"). The TypeScript types in entities.ts say the same, and
 * tests/schemas.test.ts keeps them in step.
 */

type JsonSchema = Record<string, unknown>;

export const CATALOG_SOURCE_IDS = [
  ...SOURCE_IDS,
  'contribution',
  'nli',
  'kehot',
  'chabad-org',
  'youtube',
  'archive-org',
  'otzar-hachochma',
  'library-of-agudas-chassidei-chabad',
  'other',
] as const;

export const LANGUAGES = ['he', 'en', 'yi', 'ar', 'ru', 'fr', 'es'] as const;

const ref = (name: string): JsonSchema => ({ $ref: `#/$defs/${name}` });
const arrayOf = (items: JsonSchema, extra: JsonSchema = {}): JsonSchema => ({ type: 'array', items, ...extra });
const str = (extra: JsonSchema = {}): JsonSchema => ({ type: 'string', ...extra });
const int = (extra: JsonSchema = {}): JsonSchema => ({ type: 'integer', ...extra });
const enumOf = (values: readonly (string | number)[]): JsonSchema => ({ enum: [...values] });

const DEFS: Record<string, JsonSchema> = {
  entityId: str({ pattern: '^rh-[0-9a-hjkmnp-tv-z]{6,16}$' }),
  dateKey: str({ pattern: '^\\d{4}(-(0[1-9]|1[0-2]|06A|06B)(-(0[1-9]|[12]\\d|30))?)?$' }),
  sha256: str({ pattern: '^[0-9a-f]{64}$' }),
  url: str({ pattern: '^https?://', maxLength: 2000 }),
  text: str({ minLength: 1, maxLength: 2000 }),
  localName: {
    type: 'object',
    properties: { he: str({ minLength: 1, maxLength: 500 }), en: str({ maxLength: 500 }), yi: str({ maxLength: 500 }) },
    required: ['he'],
    additionalProperties: false,
  },
  licence: enumOf(LICENCES),
  editionKind: enumOf(EDITION_KINDS),
  language: enumOf(LANGUAGES),
  catalogSourceId: enumOf(CATALOG_SOURCE_IDS),
  proofread: enumOf([0, 1, 2]),
  sourceRef: {
    type: 'object',
    properties: {
      source: ref('catalogSourceId'),
      sourceId: str({ maxLength: 500 }),
      url: ref('url'),
      fetchedAt: str({ format: 'date-time' }),
      etag: str({ maxLength: 500 }),
      note: ref('text'),
    },
    required: ['source'],
    additionalProperties: false,
  },
  externalIds: { type: 'object', additionalProperties: str({ minLength: 1, maxLength: 200 }), propertyNames: { pattern: '^[a-z0-9-]+$' } },
  machineOrigin: {
    type: 'object',
    properties: { by: str({ minLength: 1, maxLength: 200 }), checked: { type: 'boolean' } },
    required: ['by'],
    additionalProperties: false,
  },
  engine: {
    type: 'object',
    properties: { name: str({ minLength: 1 }), version: str({ minLength: 1 }) },
    required: ['name', 'version'],
    additionalProperties: false,
  },
};

/** The fields every catalog item may carry (entities.ts `CommonFields`). */
const COMMON: Record<string, JsonSchema> = {
  sets: arrayOf(ref('entityId'), { uniqueItems: true }),
  externalIds: ref('externalIds'),
  sources: arrayOf(ref('sourceRef')),
  topics: arrayOf(ref('entityId'), { uniqueItems: true }),
  note: str({ maxLength: 5000 }),
  // The page as wikitext (entities.ts, CommonFields.body), and where an importer brought it from.
  body: str({ maxLength: 2_000_000 }),
  bodySource: {
    type: 'object',
    properties: {
      source: ref('catalogSourceId'),
      via: str({ maxLength: 100 }),
      sourceId: str({ maxLength: 500 }),
      url: ref('url'),
      copy: ref('url'),
      licence: str({ maxLength: 100 }),
      credit: str({ maxLength: 500 }),
      rights: { enum: ['open', 'credit', 'link', 'preserved'] },
      importedAt: str({ format: 'date-time' }),
    },
    required: ['source'],
    additionalProperties: false,
  },
};

function entitySchema(type: EntityType, title: string, properties: Record<string, JsonSchema>, required: string[], options: { common?: boolean } = {}): JsonSchema {
  // A deep copy each: the validator remembers sub-schemas by object, and
  // shared pieces would otherwise resolve against the first schema's $id.
  return structuredClone({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://rebbehub.org/schemas/${type}.json`,
    title,
    type: 'object',
    properties: options.common === false ? properties : { ...COMMON, ...properties },
    required,
    additionalProperties: false,
    $defs: DEFS,
  });
}

const position = {
  type: 'object',
  properties: { level: str({ minLength: 1, maxLength: 50 }), value: str({ minLength: 1, maxLength: 100 }), label: ref('localName') },
  required: ['level', 'value'],
  additionalProperties: false,
};

const edition = {
  type: 'object',
  properties: {
    source: ref('catalogSourceId'),
    sourceId: str({ minLength: 1 }),
    kind: ref('editionKind'),
    licence: ref('licence'),
    role: str(),
    label: str(),
    language: ref('language'),
    version: str(),
    credit: str(),
    url: ref('url'),
  },
  required: ['source', 'sourceId', 'kind', 'licence'],
  additionalProperties: false,
};

const workSource = {
  type: 'object',
  properties: {
    source: ref('catalogSourceId'),
    sourceId: str({ minLength: 1 }),
    kind: ref('editionKind'),
    language: ref('language'),
    licence: ref('licence'),
    credit: str(),
    version: str(),
  },
  required: ['source', 'sourceId', 'kind', 'licence'],
  additionalProperties: false,
};

const vocabulary = (type: EntityType, title: string, extra: Record<string, JsonSchema> = {}) =>
  entitySchema(type, title, { name: ref('localName'), aliases: arrayOf(str({ minLength: 1 })), ...extra }, ['name']);

const fractionalOrder = str({ pattern: '^[0-9A-Za-z]+$', maxLength: 64 });

/**
 * The built-in schemas' own version. A catalog whose schema items are
 * older takes the new ones at start-up (Catalog.init), as one system
 * change in the history. 2: every page's `body` (wikitext) and `bodySource`.
 * 3: an event's English, audio and video links. 4: each link's exact file at its source (`origin`).
 * 5: a sefer's cover, the page of a PDF a person chose as its title page.
 */
export const BUILTIN_SCHEMA_VERSION = 5;

export const BUILTIN_SCHEMAS: Record<EntityType, JsonSchema> = {
  set: entitySchema(
    'set',
    'Set',
    {
      name: ref('localName'),
      slug: str({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
      description: ref('localName'),
      policy: enumOf(['open', 'moderated', 'locked']),
      keepers: arrayOf(str({ minLength: 1 }), { uniqueItems: true }),
      parent: ref('entityId'),
    },
    ['name', 'slug', 'policy', 'keepers'],
  ),
  author: entitySchema(
    'author',
    'Author',
    {
      name: ref('localName'),
      kind: enumOf(['rebbe', 'chossid', 'editor', 'family', 'institution', 'unknown']),
      rebbe: enumOf([1, 2, 3, 4, 5, 6, 7]),
      slug: str({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
      born: ref('dateKey'),
      passed: ref('dateKey'),
    },
    ['name', 'kind'],
  ),
  work: entitySchema(
    'work',
    'Work',
    {
      title: ref('localName'),
      slug: str({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
      authors: arrayOf(ref('entityId'), { uniqueItems: true }),
      genre: enumOf(GENRES),
      levels: arrayOf(str({ pattern: '^[a-z][a-z0-9-]*$' })),
      sourceCopies: arrayOf(workSource),
      description: ref('localName'),
      cover: {
        type: 'object',
        properties: { file: ref('sha256'), page: int({ minimum: 1, maximum: 100000 }) },
        required: ['file', 'page'],
        additionalProperties: false,
      },
    },
    ['title', 'slug', 'authors', 'genre', 'levels'],
  ),
  unit: entitySchema(
    'unit',
    'Unit',
    {
      work: ref('entityId'),
      position: arrayOf(position, { minItems: 1 }),
      order: fractionalOrder,
      label: ref('localName'),
      date: ref('dateKey'),
      events: arrayOf(ref('entityId'), { uniqueItems: true }),
      editions: arrayOf(edition),
    },
    ['work', 'position', 'order', 'label'],
  ),
  event: entitySchema(
    'event',
    'Event',
    {
      kind: enumOf(['farbrengen', 'sicha', 'maamar', 'yechidus', 'letter', 'simcha', 'kinus', 'other']),
      title: ref('localName'),
      date: ref('dateKey'),
      dateEnd: ref('dateKey'),
      place: ref('entityId'),
      occasion: str({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
      people: arrayOf(ref('entityId'), { uniqueItems: true }),
      order: int({ minimum: 0 }),
      links: arrayOf({
        type: 'object',
        properties: { kind: enumOf(EVENT_LINK_KINDS), label: ref('localName'), url: ref('url'), source: ref('catalogSourceId'), origin: ref('url') },
        required: ['kind', 'label', 'url'],
        additionalProperties: false,
      }),
    },
    ['kind', 'title'],
  ),
  publication: entitySchema(
    'publication',
    'Publication',
    {
      kind: enumOf(['book-volume', 'kovetz', 'periodical-issue', 'booklet', 'teshura', 'manuscript', 'other']),
      title: ref('localName'),
      work: ref('entityId'),
      volume: str({ maxLength: 50 }),
      publisher: str({ maxLength: 300 }),
      placePrinted: str({ maxLength: 300 }),
      date: ref('dateKey'),
      gregorianYear: int({ minimum: 1500, maximum: 2200 }),
      printing: int({ minimum: 1 }),
      pageCount: int({ minimum: 1 }),
      identifiers: {
        type: 'object',
        properties: { hebrewbooks: str(), nli: str(), isbn: arrayOf(str({ pattern: '^[0-9X-]{10,17}$' })), oclc: str(), otzar: str() },
        additionalProperties: false,
      },
      simcha: {
        type: 'object',
        properties: {
          kind: enumOf(['wedding', 'bar-mitzvah', 'bris', 'upsherenish', 'hachnasas-sefer-torah', 'yahrzeit', 'other']),
          families: arrayOf(str({ minLength: 1 }), { minItems: 1 }),
          date: ref('dateKey'),
          place: str(),
        },
        required: ['kind', 'families'],
        additionalProperties: false,
      },
      reprintOf: ref('entityId'),
    },
    ['kind', 'title'],
  ),
  scan: entitySchema(
    'scan',
    'Scan',
    {
      publication: ref('entityId'),
      file: ref('sha256'),
      pageCount: int({ minimum: 1 }),
      completeness: enumOf(['complete', 'partial', 'unknown']),
      preferred: { type: 'boolean' },
      quality: enumOf(['good', 'fair', 'poor']),
      pageLabels: arrayOf({
        type: 'object',
        properties: { pdfPage: int({ minimum: 1 }), printed: str({ minLength: 1 }) },
        required: ['pdfPage', 'printed'],
        additionalProperties: false,
      }),
    },
    ['publication', 'file', 'completeness'],
  ),
  'contents-map': entitySchema(
    'contents-map',
    'Contents map entry',
    {
      publication: ref('entityId'),
      pages: {
        type: 'object',
        properties: { from: int({ minimum: 1 }), to: int({ minimum: 1 }), scheme: enumOf(['printed', 'pdf']) },
        required: ['from', 'to', 'scheme'],
        additionalProperties: false,
      },
      unit: ref('entityId'),
      label: ref('localName'),
      origin: ref('machineOrigin'),
    },
    ['publication', 'pages'],
    { common: false },
  ),
  'text-layer': entitySchema(
    'text-layer',
    'Text layer',
    {
      scan: ref('entityId'),
      kind: enumOf(['machine-ocr', 'uploaded-ocr', 'community']),
      engine: ref('engine'),
      seededFrom: ref('entityId'),
      language: ref('language'),
      uploadedBy: str(),
    },
    ['scan', 'kind'],
    { common: false },
  ),
  'text-page': entitySchema(
    'text-page',
    'Text page',
    {
      layer: ref('entityId'),
      page: int({ minimum: 1 }),
      lines: arrayOf({
        type: 'object',
        properties: {
          id: str({ pattern: '^[0-9A-Za-z]+$', maxLength: 32 }),
          text: str({ maxLength: 2000 }),
          box: arrayOf({ type: 'number', minimum: 0, maximum: 1 }, { minItems: 4, maxItems: 4 }),
          proofread: ref('proofread'),
        },
        required: ['id', 'text'],
        additionalProperties: false,
      }),
      proofread: ref('proofread'),
    },
    ['layer', 'page', 'lines', 'proofread'],
    { common: false },
  ),
  text: entitySchema(
    'text',
    'Text',
    {
      kind: enumOf(['edition', 'transcript', 'translation', 'hanacha']),
      unit: ref('entityId'),
      publication: ref('entityId'),
      recording: ref('entityId'),
      language: ref('language'),
      translationOf: ref('entityId'),
      licence: ref('licence'),
      credit: str(),
    },
    ['kind', 'language'],
    { common: false },
  ),
  segment: entitySchema(
    'segment',
    'Segment',
    {
      text: ref('entityId'),
      order: fractionalOrder,
      kind: enumOf(['heading', 'paragraph', 'footnote', 'note', 'quote']),
      content: str({ maxLength: 100_000 }),
      proofread: ref('proofread'),
      page: {
        type: 'object',
        properties: { scan: ref('entityId'), page: int({ minimum: 1 }), lines: arrayOf(str()) },
        required: ['scan', 'page'],
        additionalProperties: false,
      },
      origin: ref('machineOrigin'),
    },
    ['text', 'order', 'kind', 'content', 'proofread'],
    { common: false },
  ),
  recording: entitySchema(
    'recording',
    'Recording',
    {
      event: ref('entityId'),
      title: ref('localName'),
      file: ref('sha256'),
      url: ref('url'),
      durationMs: int({ minimum: 0 }),
      part: int({ minimum: 1 }),
      language: ref('language'),
      videos: arrayOf({
        type: 'object',
        properties: {
          provider: enumOf(['youtube', 'jem', 'chabad-org', 'vimeo', 'other']),
          url: ref('url'),
          startMs: int({ minimum: 0 }),
          endMs: int({ minimum: 0 }),
        },
        required: ['provider', 'url'],
        additionalProperties: false,
      }),
    },
    ['title'],
  ),
  alignment: entitySchema(
    'alignment',
    'Alignment',
    { recording: ref('entityId'), text: ref('entityId'), granularity: enumOf(['word', 'paragraph']), engine: ref('engine') },
    ['recording', 'text', 'granularity'],
    { common: false },
  ),
  'alignment-span': entitySchema(
    'alignment-span',
    'Alignment span',
    {
      alignment: ref('entityId'),
      segment: ref('entityId'),
      startMs: int({ minimum: 0 }),
      endMs: int({ minimum: 0 }),
      words: arrayOf({
        type: 'object',
        properties: { from: int({ minimum: 0 }), to: int({ minimum: 0 }), startMs: int({ minimum: 0 }), endMs: int({ minimum: 0 }) },
        required: ['from', 'to', 'startMs', 'endMs'],
        additionalProperties: false,
      }),
      locked: { type: 'boolean' },
      origin: ref('machineOrigin'),
    },
    ['alignment', 'segment', 'startMs', 'endMs'],
    { common: false },
  ),
  relation: entitySchema(
    'relation',
    'Relation',
    {
      kind: enumOf(['based-on', 'printed-in', 'translation-of', 'answer-to', 'cites', 'same-recording-as', 'reproduces']),
      from: ref('entityId'),
      to: ref('entityId'),
      at: ref('entityId'),
      note: str({ maxLength: 2000 }),
      origin: ref('machineOrigin'),
    },
    ['kind', 'from', 'to'],
    { common: false },
  ),
  person: vocabulary('person', 'Person', { born: ref('dateKey'), passed: ref('dateKey'), author: ref('entityId') }),
  place: vocabulary('place', 'Place', {
    kind: enumOf(['city', 'building', 'region', 'country', 'other']),
    within: ref('entityId'),
    geo: {
      type: 'object',
      properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 } },
      required: ['lat', 'lon'],
      additionalProperties: false,
    },
  }),
  topic: vocabulary('topic', 'Topic', { broader: ref('entityId') }),
  source: entitySchema(
    'source',
    'Source',
    { key: ref('catalogSourceId'), name: ref('localName'), url: ref('url'), licence: ref('licence'), terms: str(), credit: str() },
    ['key', 'name', 'licence'],
    { common: false },
  ),
  schema: entitySchema(
    'schema',
    'Schema',
    {
      entityType: str({ pattern: '^[a-z][a-z0-9-]*$' }),
      label: ref('localName'),
      jsonSchema: { type: 'object' },
      version: int({ minimum: 1 }),
    },
    ['entityType', 'label', 'jsonSchema', 'version'],
    { common: false },
  ),
};

export const ENTITY_LABELS: Record<EntityType, LocalName> = {
  set: { he: 'סט', en: 'Set' },
  author: { he: 'מחבר', en: 'Author' },
  work: { he: 'חיבור', en: 'Work' },
  unit: { he: 'יחידה', en: 'Unit' },
  event: { he: 'אירוע', en: 'Event' },
  publication: { he: 'הוצאה', en: 'Publication' },
  scan: { he: 'סריקה', en: 'Scan' },
  'contents-map': { he: 'מפתח תוכן', en: 'Contents map' },
  'text-layer': { he: 'שכבת טקסט', en: 'Text layer' },
  'text-page': { he: 'עמוד טקסט', en: 'Text page' },
  text: { he: 'טקסט', en: 'Text' },
  segment: { he: 'פסקה', en: 'Segment' },
  recording: { he: 'הקלטה', en: 'Recording' },
  alignment: { he: 'סנכרון', en: 'Sync' },
  'alignment-span': { he: 'קטע סנכרון', en: 'Sync span' },
  relation: { he: 'קשר', en: 'Relation' },
  person: { he: 'אדם', en: 'Person' },
  place: { he: 'מקום', en: 'Place' },
  topic: { he: 'נושא', en: 'Topic' },
  source: { he: 'מקור', en: 'Source' },
  schema: { he: 'סכמה', en: 'Schema' },
};
