/**
 * The API described for people and tools (OpenAPI 3.1): the developer
 * docs' reference (/developers/reference), the typed client
 * (packages/client, generated from this) and anyone's own tools read it.
 * A test fails when a route is missing here or this names a route that is
 * not there (services/api/tests/openapi.test.ts).
 *
 * Operations are written as a list and turned into the document below, so
 * each says in one place who may call it, what it takes and what it gives.
 * Item data follows the JSON Schemas served at /v1/types, which are the
 * catalog's own.
 */

type Schema = Record<string, unknown>;

/** Who may call an operation. */
type Access =
  /** Anyone, no account. */
  | 'public'
  /** Anyone; signed in (a token or a session), a little more (no captcha, no hourly limit). */
  | 'optional'
  /** A signed-in person: a token with the read scope, or a session. */
  | 'read'
  /** A signed-in person: a token with the write scope, or a session. */
  | 'write'
  /** Only from the site's own pages, with its session: sign-in, tokens, stewards' tools. */
  | 'site';

interface Param {
  name: string;
  in: 'path' | 'query' | 'header';
  description?: string;
  required?: boolean;
  schema: Schema;
  example?: unknown;
}

interface Operation {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  params?: Param[];
  body?: Schema | { raw: string; description: string };
  /** The success answer: its status (200), what it is, and its schema (JSON unless `type` says otherwise). */
  ok?: { status?: number; description: string; schema?: Schema; type?: string };
  /** Other answers worth naming (a 409 with clashes, a 429). */
  also?: Record<string, string>;
  /** Pages with a cursor: `next` in the answer, `cursor` (and `limit`) to ask for the next page. */
  paged?: boolean;
  deprecated?: boolean;
}

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...extra });
const str = (description?: string, extra: Schema = {}): Schema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const int = (description?: string, extra: Schema = {}): Schema => ({ type: 'integer', ...(description ? { description } : {}), ...extra });
const bool = (description?: string): Schema => ({ type: 'boolean', ...(description ? { description } : {}) });
const arr = (items: Schema, description?: string): Schema => ({ type: 'array', items, ...(description ? { description } : {}) });
const any = (description?: string): Schema => ({ type: 'object', additionalProperties: true, ...(description ? { description } : {}) });
const nullable = (schema: Schema): Schema => ({ oneOf: [schema, { type: 'null' }] });

const ID_PATTERN = '^[rR][hH]-[0-9A-Za-z-]+$';
const idSchema = str('A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works)', { pattern: ID_PATTERN, examples: ['rh-7k2m9q4d'] });
const sha256Schema = str('A file, named by its sha256', { pattern: '^[0-9a-f]{64}$' });

const path = (name: string, schema: Schema, description?: string): Param => ({ name, in: 'path', required: true, schema, ...(description ? { description } : {}) });
const query = (name: string, schema: Schema, description?: string, required = false): Param => ({ name, in: 'query', required, schema, ...(description ? { description } : {}) });
const idParam = path('id', idSchema);
const numberParam = (name: string, description: string) => path(name, int(description, { minimum: 1 }));
const usernameParam = path('username', str('A handle, without the @', { pattern: '^[A-Za-z0-9][A-Za-z0-9-]{0,38}[A-Za-z0-9]$' }));
const slugParam = path('slug', str('A project\'s short name', { pattern: '^[a-z0-9-]+$' }));
const limitParam = (max: number, fallback: number) => query('limit', int(undefined, { minimum: 1, maximum: max, default: fallback }), `How many (at most ${max})`);

const OK = obj({ ok: { const: true } }, ['ok']);
const ENTITY_TYPES_NOTE = 'set, author, work, unit, event, publication, scan, contents-map, text-layer, text-page, text, segment, recording, alignment, alignment-span, relation, person, place, topic, source, schema';

// ------------------------------------------------------------------ the operations

const OPERATIONS: Operation[] = [
  // About
  { method: 'get', path: '/', operationId: 'root', tag: 'About', summary: 'Redirects to /v1', access: 'public', ok: { status: 302, description: 'To /v1' } },
  { method: 'get', path: '/v1', operationId: 'about', tag: 'About', summary: 'About this API: its version, the latest commit, where the docs are', access: 'public', ok: { description: 'About', schema: ref('About') } },
  { method: 'get', path: '/openapi.json', operationId: 'openapi', tag: 'About', summary: 'This document', access: 'public', ok: { description: 'OpenAPI 3.1', schema: any() } },
  { method: 'get', path: '/llms.txt', operationId: 'llmsTxt', tag: 'Agents', summary: 'A short guide for AI agents (llms.txt)', access: 'public', ok: { description: 'Markdown', type: 'text/plain' } },
  { method: 'get', path: '/v1/types', operationId: 'types', tag: 'Items', summary: 'Every kind of item and its JSON Schema', access: 'public', ok: { description: 'Types and schemas', schema: obj({ types: arr(obj({ type: str(), schema: any() }, ['type', 'schema'])) }, ['types']) } },
  { method: 'get', path: '/v1/stats', operationId: 'stats', tag: 'About', summary: 'How many items of each type, and the latest commit', access: 'public', ok: { description: 'Counts', schema: obj({ head: int(), counts: { type: 'object', additionalProperties: { type: 'integer' } } }, ['head', 'counts']) } },
  { method: 'get', path: '/v1/community', operationId: 'community', tag: 'About', summary: 'The community page in numbers: the latest merges, reports and suggestions waiting, people, gaps', access: 'public', params: [limitParam(50, 8)], ok: { description: 'Numbers and the latest merges', schema: any() } },
  { method: 'get', path: '/v1/health', operationId: 'health', tag: 'About', summary: 'The health of the catalog: coverage per year and set, unchecked pages, unsynced recordings, dead links, the oldest open suggestions', access: 'public', params: [limitParam(500, 20)], ok: { description: 'Health', schema: any() } },

  // Items
  { method: 'get', path: '/v1/entities', operationId: 'listItems', tag: 'Items', summary: 'Items on main, by type and set, in path order, a page at a time', access: 'public', paged: true, params: [query('type', str(`One of ${ENTITY_TYPES_NOTE}`)), query('set', idSchema, 'Only items in this set'), query('after', str(), 'Deprecated: the same as cursor'), limitParam(500, 50)], ok: { description: 'A page of items', schema: ref('ItemPage') } },
  { method: 'get', path: '/v1/entities/batch', operationId: 'getItems', tag: 'Items', summary: 'Several items at once, in the order asked (missing ones left out)', access: 'public', params: [query('ids', str('Comma separated, at most 200'), 'The ids', true)], ok: { description: 'The items', schema: obj({ items: arr(ref('Item')) }, ['items']) } },
  { method: 'get', path: '/v1/entities/{id}', operationId: 'getItem', tag: 'Items', summary: 'One item, on main or as of a commit', description: 'Words whose rights forbid copies are left out, and `withheld` says why.', access: 'public', params: [idParam, query('at', int(undefined, { minimum: 0 }), 'A commit\'s seq: the item as it was then')], ok: { description: 'The item', schema: ref('Item') } },
  { method: 'get', path: '/v1/entities/{id}/children', operationId: 'listChildren', tag: 'Items', summary: "An item's children in their own order (a work's units, a text's paragraphs), a page at a time", access: 'public', paged: true, params: [idParam, query('field', str(undefined, { pattern: '^[a-z][a-zA-Z]*$' }), 'The children\'s field that points at this item (work, text, event…)', true), query('type', str(), 'The children\'s type (unit, segment, recording…)', true), query('after', str(), 'Deprecated: the same as cursor'), limitParam(1000, 100)], ok: { description: 'A page of children', schema: ref('ItemPage') } },
  { method: 'get', path: '/v1/entities/{id}/linked/counts', operationId: 'linkedCounts', tag: 'Items', summary: 'What points at an item, by type and field, with how many of each', access: 'public', params: [idParam], ok: { description: 'The groups, largest first', schema: obj({ groups: arr(obj({ type: str(), field: str(), count: int() }, ['type', 'field', 'count'])) }, ['groups']) } },
  { method: 'get', path: '/v1/entities/{id}/linked', operationId: 'listLinked', tag: 'Items', summary: 'One group of what points at an item, in its own order, a page at a time, with the total', access: 'public', paged: true, params: [idParam, query('field', str(undefined, { pattern: '^[a-z][a-zA-Z]*$' }), 'The field that points here (work, event, sets…)', true), query('type', str(), 'Only items of this type'), query('after', str(), 'Deprecated: the same as cursor'), limitParam(500, 100)], ok: { description: 'A page of items and the total', schema: obj({ items: arr(ref('Item')), total: int(), next: nullable(str('Pass back as cursor for the next page; null on the last')) }, ['items', 'total', 'next']) } },
  { method: 'get', path: '/v1/entities/{id}/history', operationId: 'itemHistory', tag: 'Items', summary: 'Every merged change to an item, newest first: who, when, and what changed field by field', access: 'public', params: [idParam], ok: { description: 'History', schema: obj({ history: arr(any()) }, ['history']) } },
  { method: 'get', path: '/v1/entities/{id}/backlinks', operationId: 'itemBacklinks', tag: 'Items', summary: 'Items that point at this one', access: 'public', params: [idParam, query('field', str(), 'Only links in this field'), query('type', str(), 'Only items of this type')], ok: { description: 'Backlinks', schema: obj({ backlinks: arr(obj({ from: idSchema, type: str(), field: str(), path: nullable(str()) }, ['from', 'type', 'field', 'path'])) }, ['backlinks']) } },
  { method: 'get', path: '/v1/entities/{id}/relations', operationId: 'itemRelations', tag: 'Items', summary: "An item's links both ways: cites, printed in, based on, cited by", description: 'Each is `machine: true` while a machine found it and no person has checked it.', access: 'public', params: [idParam], ok: { description: 'Relations', schema: obj({ relations: arr(any()) }, ['relations']) } },
  { method: 'post', path: '/v1/entities/{id}/restore', operationId: 'restoreItem', tag: 'Suggestions', summary: 'Suggest restoring an earlier version of an item', access: 'write', params: [idParam], body: obj({ rev: int('The revision to restore') }, ['rev']), ok: { status: 201, description: 'The suggestion made', schema: obj({ suggestion: int() }, ['suggestion']) } },
  { method: 'get', path: '/v1/revisions/{rev}', operationId: 'getRevision', tag: 'Items', summary: 'One stored version of an item', access: 'public', params: [numberParam('rev', 'A revision id')], ok: { description: 'The revision', schema: any() } },
  { method: 'get', path: '/v1/resolve', operationId: 'resolvePath', tag: 'Items', summary: 'The item at a readable path (an old path answers with where it moved)', access: 'public', params: [query('path', str(undefined, { examples: ['/events/5742-05-10'] }), 'A path such as /likkutei-sichos/12/3', true)], ok: { description: 'Its id and current path', schema: obj({ id: idSchema, redirected: bool(), path: nullable(str()) }, ['id', 'redirected', 'path']) } },
  { method: 'get', path: '/v1/events', operationId: 'listEvents', tag: 'Items', summary: 'Farbrengens and other events by Hebrew date, each with how many recordings it has', access: 'public', params: [query('within', str(undefined, { pattern: '^\\d{4}(-(0[1-9]|1[0-2]|06A|06B))?$' }), 'A year (5742) or a month (5742-05)'), query('day', str(), 'A day of any year (05-10), or several, comma separated'), query('dates', str(), 'Exact dates, comma separated (5742-05-10,5743-05-10)'), query('missing', { enum: ['recordings', 'texts'] }, 'Only those without'), limitParam(2000, 500)], ok: { description: 'Events', schema: obj({ items: arr(ref('Item')) }, ['items']) } },
  { method: 'get', path: '/v1/refcounts', operationId: 'refCounts', tag: 'Items', summary: 'How many items point at each item through a field (field=work&type=unit: each work\'s units)', access: 'public', params: [query('field', str(), 'The field', true), query('type', str(), 'Only items of this type')], ok: { description: 'Counts by id', schema: obj({ counts: { type: 'object', additionalProperties: { type: 'integer' } } }, ['counts']) } },
  { method: 'get', path: '/v1/sitemap', operationId: 'sitemaps', tag: 'Items', summary: 'Every sitemap there is: each kind of item with a page of its own, in pages of pageSize items (id order), with when each page last changed', description: 'What the site\'s /sitemap.xml is made from. Kinds: set, author, person, work, unit, event, publication, recording.', access: 'public', ok: { description: 'The sitemaps', schema: obj({ pageSize: int(), sitemaps: arr(obj({ type: str(), page: int(undefined, { minimum: 1 }), count: int(), lastmod: nullable(str(undefined, { format: 'date-time' })) }, ['type', 'page', 'count', 'lastmod'])) }, ['pageSize', 'sitemaps']) } },
  { method: 'get', path: '/v1/sitemap/{type}/{page}', operationId: 'sitemapPage', tag: 'Items', summary: "One sitemap's items: their ids, paths and when each last changed", access: 'public', params: [path('type', str('A kind of item with a page of its own', { enum: ['set', 'author', 'person', 'work', 'unit', 'event', 'publication', 'recording'] })), path('page', int('From 1', { minimum: 1 }))], ok: { description: 'The items', schema: obj({ type: str(), page: int(), items: arr(obj({ id: idSchema, path: nullable(str()), lastmod: nullable(str(undefined, { format: 'date-time' })) }, ['id', 'path', 'lastmod'])) }, ['type', 'page', 'items']) } },
  { method: 'get', path: '/v1/works/{id}/outline', operationId: 'workOutline', tag: 'Items', summary: "A work's volumes (its top-level parts), with how many units each holds", access: 'public', params: [idParam], ok: { description: 'Parts', schema: obj({ parts: arr(obj({ value: str(), label: nullable(any()), units: int() })) }, ['parts']) } },
  { method: 'get', path: '/v1/works/{id}/parts/{part}', operationId: 'workPart', tag: 'Items', summary: 'The units of one volume of a work', access: 'public', params: [idParam, path('part', str(), 'The volume, as the outline names it'), limitParam(1000, 1000)], ok: { description: 'Units', schema: obj({ items: arr(ref('Item')) }, ['items']) } },
  { method: 'get', path: '/v1/missing', operationId: 'missing', tag: 'Projects', summary: 'The Missing board: farbrengens without a recording or a text, sefarim without a scan, files lost upstream', access: 'public', params: [query('kind', { enum: ['recordings', 'texts', 'scans', 'files'] }, 'What is missing', true), query('within', str(), 'For recordings and texts: a year or a month'), limitParam(500, 50)], ok: { description: 'What is missing', schema: obj({ kind: str(), total: int(), items: arr(any()) }, ['kind', 'total', 'items']) } },
  { method: 'get', path: '/v1/commits', operationId: 'listCommits', tag: 'Items', summary: 'Every merge to main after a given one, in order, with what each changed: the way to follow the catalog without webhooks', access: 'public', paged: true, params: [query('since', int(undefined, { minimum: 0 }), 'Start after this commit\'s seq (0: from the start)'), limitParam(100, 20)], ok: { description: 'Commits', schema: obj({ commits: arr(ref('Commit')), next: nullable(str()) }, ['commits', 'next']) } },
  { method: 'get', path: '/v1/dates/parse', operationId: 'parseDate', tag: 'Search', summary: 'Read a Hebrew date as people write it', access: 'public', params: [query('q', str(undefined, { examples: ['יו"ד שבט תשכ"ב', '10 Shvat 5722'] }), 'The date', true)], ok: { description: 'The date key, in Hebrew and English', schema: obj({ ok: bool(), key: str(), he: str(), en: str() }, ['ok']) }, also: { '422': 'Not a date' } },

  // Search
  { method: 'get', path: '/v1/search', operationId: 'search', tag: 'Search', summary: 'Search names, text and dates, in Hebrew or English', description: 'Ranked by relevance, not paged: ask for more with limit. A query that names a Hebrew date also answers with the date.', access: 'public', params: [query('q', str(), 'The query', true), query('type', str(), 'Only this type'), limitParam(100, 20)], ok: { description: 'Results, and the date the query names if any', schema: obj({ query: str(), date: nullable(obj({ key: str(), he: str(), en: str() })), results: arr(ref('Item')) }, ['query', 'date', 'results']) } },
  { method: 'get', path: '/v1/search/moments', operationId: 'searchMoments', tag: 'Search', summary: "Where the words are: lines on scans' pages (open at the line) and paragraphs of texts and transcripts (open at the moment heard)", access: 'public', params: [query('q', str(), 'The words', true), limitParam(100, 20)], ok: { description: 'Moments, each saying whether a machine read it and nobody has checked it', schema: obj({ query: str(), moments: arr(any()) }, ['query', 'moments']) } },
  { method: 'get', path: '/v1/search/similar', operationId: 'searchSimilar', tag: 'Search', summary: "Search by meaning (embeddings); every result is the machine's guess", description: '`available` is false until it is set up on the server.', access: 'public', params: [query('q', str(undefined, { maxLength: 1000 }), 'A question or an idea, in Hebrew, Yiddish or English', true), query('types', str(), 'Some of unit, event, segment, text-page, work, comma separated'), limitParam(50, 10)], ok: { description: 'Results with their score', schema: obj({ query: str(), available: bool(), machine: { const: true }, model: str(), results: arr(any()) }, ['query', 'available', 'results']) } },

  // Texts
  { method: 'get', path: '/v1/scans/{id}/text', operationId: 'scanText', tag: 'Texts', summary: "A page of a scan's text: the community page, else the seed layer's; each line with its proofread level", description: 'Lines nobody has checked are machine reading (`checked: false`). Withheld when the scan may not be served.', access: 'public', params: [idParam, query('page', int(undefined, { minimum: 1, default: 1 }), 'The page')], ok: { description: 'The page', schema: ref('ScanTextPage') } },
  { method: 'get', path: '/v1/scans/{id}/progress', operationId: 'scanProgress', tag: 'Texts', summary: 'How far each page of a scan is proofread (0, 1 or 2)', access: 'public', params: [idParam], ok: { description: 'Pages and levels', schema: obj({ pages: int(), levels: arr(int(undefined, { minimum: 0, maximum: 2 })) }, ['pages', 'levels']) } },
  { method: 'post', path: '/v1/scans/{id}/text/fix', operationId: 'fixScanLine', tag: 'Texts', summary: 'Fix one line of a scan\'s text (a suggestion)', access: 'write', params: [idParam], body: obj({ page: int(), line: str('The line\'s id'), text: str() }, ['page', 'line', 'text']), ok: { status: 201, description: 'The suggestion', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/scans/{id}/text/confirm', operationId: 'confirmScanPage', tag: 'Texts', summary: 'This page is right: raise it a proofreading level, with any fixes (a suggestion)', access: 'write', params: [idParam], body: obj({ page: int(), fixes: { type: 'object', additionalProperties: { type: 'string' }, description: 'Line id to its right text' } }, ['page']), ok: { status: 201, description: 'The suggestion', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/scans/{id}/ocr', operationId: 'uploadOcr', tag: 'Texts', summary: 'Upload your own OCR of a scan (hOCR, ALTO, or plain text with form feeds between pages) as a new layer', access: 'write', params: [idParam], body: obj({ content: str(), format: { enum: ['hocr', 'alto', 'text'] }, engine: obj({ name: str(), version: str() }, ['name', 'version']), firstPage: int(undefined, { minimum: 1 }), language: str() }, ['content', 'engine']), ok: { status: 201, description: 'The suggestion, with pages and lines read', schema: any() } },
  { method: 'post', path: '/v1/scans/{id}/text/seed', operationId: 'seedScanText', tag: 'Texts', summary: 'Keepers: seed the community text from this OCR layer (checked lines are kept)', access: 'write', params: [idParam], body: obj({ layer: idSchema }, ['layer']), ok: { status: 201, description: 'The suggestion', schema: ref('Suggestion') } },
  { method: 'get', path: '/v1/units/{id}/printings', operationId: 'unitPrintings', tag: 'Texts', summary: 'The printings of a unit whose text the catalog has, to compare', access: 'public', params: [idParam], ok: { description: 'Printings', schema: obj({ printings: arr(any()) }, ['printings']) } },
  { method: 'get', path: '/v1/compare', operationId: 'comparePrintings', tag: 'Texts', summary: 'Compare two printings word by word (Hebrew-aware)', access: 'public', params: [query('a', str(), 'text:<id> or scan:<id>:<from>-<to>', true), query('b', str(), 'The other printing', true)], ok: { description: 'Runs of same, removed and added words', schema: any() } },
  { method: 'post', path: '/v1/units/{id}/translations', operationId: 'addTranslation', tag: 'Texts', summary: 'Suggest a translation of a unit, as its own text', access: 'write', params: [idParam], body: obj({ language: str(), credit: str(), licence: { enum: ['public-domain', 'cc0', 'cc-by', 'cc-by-nc'] }, translationOf: idSchema, content: str('A blank line between paragraphs'), machine: str('The tool, when a machine translated it') }, ['language', 'credit', 'content']), ok: { status: 201, description: 'The suggestion made', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/translations/fix', operationId: 'fixTranslation', tag: 'Texts', summary: 'Suggest a fix to one paragraph of a translation', access: 'write', body: obj({ segment: idSchema, content: str() }, ['segment', 'content']), ok: { status: 201, description: 'The suggestion made', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/hanachos/text', operationId: 'addHanachaText', tag: 'Texts', summary: "A hanacha's words for a farbrengen or sicha (or a new farbrengen), a paragraph to a segment", description: 'Words of unsure rights are kept and not shown until a steward decides.', access: 'write', body: obj({ for: idSchema, eventTitle: str('For a farbrengen the catalog lacks: its name'), eventDate: str('With eventTitle: its date key'), content: str('A blank line between paragraphs'), rights: { enum: ['mine', 'public-domain', 'free', 'unsure'] }, language: str(), credit: str() }, ['content', 'rights']), ok: { status: 201, description: 'The suggestion sent for review, and the text', schema: obj({ suggestion: int(), text: idSchema, event: nullable(idSchema), publication: nullable(idSchema) }, ['suggestion', 'text']) } },
  { method: 'get', path: '/v1/texts/{sha256}', operationId: 'getSourceText', tag: 'Texts', summary: 'A text of a sefer as its source gave it (one chapter or letter, an HTML article)', access: 'public', params: [path('sha256', sha256Schema)], ok: { description: 'HTML, shown as a document (sandboxed)', type: 'text/html' } },

  // Media
  { method: 'get', path: '/v1/recordings/{id}/transcript', operationId: 'recordingTranscript', tag: 'Media', summary: "A recording's transcript, with its sync by paragraph and word", description: 'A paragraph is machine hearing until a person checks it (`checked`).', access: 'public', params: [idParam], ok: { description: 'The transcript', schema: ref('Transcript') } },
  { method: 'post', path: '/v1/recordings/{id}/transcript/fix', operationId: 'fixTranscript', tag: 'Media', summary: 'Fix the words of one paragraph of a transcript (a suggestion)', access: 'write', params: [idParam], body: obj({ segment: idSchema, content: str() }, ['segment', 'content']), ok: { status: 201, description: 'The suggestion', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/recordings/{id}/sync/anchor', operationId: 'anchorSync', tag: 'Media', summary: 'The Rebbe is saying this line now: set a paragraph (or word) at atMs, lock it, move what follows', access: 'write', params: [idParam], body: obj({ segment: idSchema, atMs: int(), word: int() }, ['segment', 'atMs']), ok: { status: 201, description: 'The suggestion and the spans as they now stand', schema: any() } },
  { method: 'post', path: '/v1/recordings/{id}/sync/confirm', operationId: 'confirmSync', tag: 'Media', summary: 'The sync is right: mark every paragraph checked', access: 'write', params: [idParam], ok: { status: 201, description: 'The suggestion', schema: ref('Suggestion') } },
  { method: 'get', path: '/v1/recordings/{id}/hanacha', operationId: 'recordingHanacha', tag: 'Media', summary: 'The hanacha synced to this recording, paragraph by paragraph', access: 'public', params: [idParam], ok: { description: 'The hanacha and its sync', schema: any() } },

  // Files
  { method: 'get', path: '/v1/files/{sha256}', operationId: 'getFile', tag: 'Files', summary: "A file's size, rights and address, what was made from it, and its page fix", access: 'public', params: [path('sha256', sha256Schema)], ok: { description: 'The file', schema: ref('File') } },
  { method: 'get', path: '/v1/files/{sha256}/similar', operationId: 'similarFiles', tag: 'Files', summary: "Held files that look like this one (the same scan or recording in other bytes): a machine's guess", access: 'public', params: [path('sha256', sha256Schema)], ok: { description: 'Similar files, with the items that use each', schema: any() } },
  { method: 'get', path: '/v1/page-fixes/drive/{id}', operationId: 'driveFix', tag: 'Files', summary: 'What a PDF on Google Drive needs to read straight, by its Drive id, or the reading copy to open instead', access: 'public', params: [path('id', str('A Google Drive file id', { pattern: '^[\\w-]{10,}$' }))], ok: { description: 'The page fix', schema: any() } },
  { method: 'get', path: '/v1/drive/{id}', operationId: 'driveFile', tag: 'Files', summary: "A Google Drive file the catalog links to (a hanacha's PDF, an Otzros scan), read for the site's reader and player", description: 'Only files an item links to. Supports Range requests; the whole file is kept at the edge for a week. Files over the size RebbeHub passes on (300 MB) answer 413.', access: 'public', params: [path('id', str('A Google Drive file id', { pattern: '^[\\w-]{10,64}$' }))], ok: { description: 'The bytes', type: 'application/octet-stream' }, also: { '206': 'Part of the bytes (Range)', '404': 'No item links to this file', '413': 'Too large to pass on', '429': 'Too many files read from Drive this minute', '502': 'Google Drive did not give the file' } },
  { method: 'get', path: '/objects/{sha256}', operationId: 'getObject', tag: 'Files', summary: "A file's bytes, while its rights let it be served", description: 'Supports Range requests. `X-Credit` carries the credit the rights ask for.', access: 'public', params: [path('sha256', sha256Schema)], ok: { description: 'The bytes', type: 'application/octet-stream' }, also: { '206': 'Part of the bytes (Range)', '416': 'A range outside the file' } },
  { method: 'get', path: '/manifests/{collection}/{name}', operationId: 'getManifest', tag: 'Files', summary: 'A published manifest: reading copies, page fixes (facts about files, open like the catalog)', access: 'public', params: [path('collection', str(undefined, { pattern: '^[a-z0-9-]+$' })), path('name', str('ends in .json', { pattern: '^[a-z0-9-]+\\.json$' }))], ok: { description: 'The manifest', schema: any() } },
  { method: 'get', path: '/v1/scans/{id}/pages', operationId: 'scanPages', tag: 'Files', summary: "A served scan's page images and thumbnails, and its IIIF manifest", access: 'public', params: [idParam], ok: { description: 'Pages', schema: any() } },
  { method: 'get', path: '/manifests/iiif/{file}', operationId: 'iiifManifest', tag: 'Libraries', summary: 'A served scan as a IIIF Presentation 3 manifest, for any IIIF viewer', access: 'public', params: [path('file', str('The scan\'s id and .json', { pattern: '^rh-[0-9a-z]+\\.json$' }))], ok: { description: 'The manifest', type: 'application/ld+json', schema: any() } },
  { method: 'post', path: '/v1/uploads', operationId: 'upload', tag: 'Files', summary: "Add a file: a recording of a farbrengen; a hanacha's PDF for a farbrengen or sicha; a scan (another scan of a printing, a new printing of a sefer, a teshura); or other material (a new sefer, a letter, a document)", description: 'The file is the body, with its Content-Type (audio/…, application/pdf). A recording or hanacha may name a farbrengen the catalog lacks (eventTitle and eventDate) instead of `for`. New accounts wait a day, and everyone adds so many a day.', access: 'write', params: [query('what', { enum: ['recording', 'hanacha', 'scan', 'document'] }, 'What it is', true), query('for', idSchema, 'The farbrengen, sicha, sefer, printing or Teshuros set it is added to'), query('eventTitle', str(undefined, { maxLength: 300 }), 'For a recording or hanacha of a farbrengen the catalog lacks: its name'), query('eventDate', str(undefined, { examples: ['5742-05-10'] }), 'With eventTitle: its date key'), query('kind', { enum: ['bilti-mugah', 'mugah', 'maamar', 'hagahos', 'hosofos', 'english', 'other'], default: 'bilti-mugah' }, 'For a hanacha: what kind'), query('set', idSchema, 'For a document: the set it belongs in'), query('author', idSchema, 'For a new sefer: its author'), query('genre', str(), 'For a new sefer: its genre'), query('unit', idSchema, 'For a letter: the letter the catalog has that it reproduces'), query('rights', { enum: ['mine', 'free', 'public-domain', 'unsure'] }, 'What you know of its rights', true), query('as', { enum: ['scan-of', 'printing', 'teshura', 'sefer', 'letter', 'document'] }, 'For a scan: scan-of, printing or teshura. For a document: sefer, letter or document'), query('title', str(), 'Its name'), query('publication', idSchema, 'For scan-of: the printing'), query('publisher', str(), 'For a printing'), query('year', str(), 'For a printing: a Hebrew or civil year'), query('printing', int(), 'For a printing: 1 for the first'), query('families', str(), 'For a teshura: its families, as printed'), query('simcha', str(), 'For a teshura: wedding, bar-mitzvah, and so on'), query('date', str(), "For a teshura: the simcha's date key; for a letter or document, its date")], body: { raw: 'application/octet-stream', description: 'The file' }, ok: { status: 201, description: 'Stored, and a suggestion sent for review', schema: any() }, also: { '200': 'We already have this file: where it is', '429': 'The day\'s allowance is used' } },
  { method: 'post', path: '/v1/uploads/check', operationId: 'checkUpload', tag: 'Files', summary: 'Before an upload: whether we have it (its sha256, a few page hashes) and what it likely is', access: 'write', body: obj({ for: idSchema, sha256: str(), pageHashes: arr(nullable(str())), title: str() }, ['for']), ok: { description: "The guess, files already held that look like it, and the sefer's printings", schema: any() } },
  { method: 'post', path: '/v1/uploads/propose', operationId: 'proposeUpload', tag: 'Files', summary: "Before adding something new: the machine's guess of what it is and where it belongs, from its name (a date in it, words of a title), and files already held that look like it", access: 'write', body: obj({ what: { enum: ['hanacha', 'recording', 'document'] }, name: str('Its file name or title'), sha256: sha256Schema, pageHashes: arr(nullable(str())) }, ['what']), ok: { description: 'The date read, what it likely is, the items it may belong to, and where the file already is', schema: any() } },
  { method: 'get', path: '/v1/files/{sha256}/about', operationId: 'fileAbout', tag: 'Files', summary: "A file's own page: its rights, where it came from, what was made from it, and what uses it", access: 'public', params: [path('sha256', sha256Schema), limitParam(500, 100)], ok: { description: 'The file, and the items using it with their total', schema: any() } },
  { method: 'get', path: '/v1/covers', operationId: 'covers', tag: 'Files', summary: "Sefarim's covers, drawn from their title pages, while their PDFs are served or linked", description: 'A cover is `machine: true` until a person chose its page. A cover drawn from a PDF RebbeHub only links to is served; the PDF is not (its file page links to the source).', access: 'public', params: [query('ids', str('Comma separated, at most 200'), 'The sefarim')], ok: { description: 'Covers by id (none for a sefer without one)', schema: obj({ covers: { type: 'object', additionalProperties: ref('Cover') } }, ['covers']) } },
  { method: 'get', path: '/v1/works/{id}/cover', operationId: 'workCover', tag: 'Files', summary: "A sefer's cover, the page a person chose, and the PDFs (served, or linked) its title page may be chosen from", access: 'public', params: [idParam], ok: { description: 'The cover and its sources', schema: obj({ work: idSchema, chosen: nullable(obj({ file: sha256Schema, page: int() }, ['file', 'page'])), cover: nullable(ref('Cover')), sources: arr(any()) }, ['work', 'chosen', 'cover', 'sources']) } },

  // Suggestions
  { method: 'get', path: '/v1/suggestions', operationId: 'listSuggestions', tag: 'Suggestions', summary: 'Suggestions, oldest sent first, by status or author; with `state`, the list of conversations, newest first (numbers, reviewers, approvals, the issues each closes) with counts', access: 'public', paged: true, params: [query('status', { enum: ['draft', 'open', 'merged', 'sent_back', 'withdrawn'] }), query('state', { enum: ['open', 'closed', 'all'] }, 'The conversation list: open (waiting or sent back) or closed (merged or withdrawn)'), query('author', str(), 'An account id, or (with state) a handle'), query('reviewer', str(), 'With state: asked to review, or reviewed (a handle)'), query('q', str(), 'With state: words in the title, or #number'), query('postReview', { enum: ['true', 'false'] }, 'true: live changes waiting to be reviewed after'), limitParam(500, 50)], ok: { description: 'Suggestions (with state: SuggestionListItem, people and counts)', schema: obj({ suggestions: arr({ oneOf: [ref('Suggestion'), ref('SuggestionListItem')] }), people: any('Who is named, by account id: name and handle'), counts: obj({ open: int(), closed: int() }), next: nullable(str()) }, ['suggestions', 'next']) } },
  { method: 'post', path: '/v1/suggestions', operationId: 'createSuggestion', tag: 'Suggestions', summary: 'Start a suggestion (a draft): add items to it, then submit it', access: 'write', body: obj({ title: str(), description: str(), project: int() }, ['title']), ok: { status: 201, description: 'The draft', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/suggestions/quick', operationId: 'suggestFix', tag: 'Suggestions', summary: 'Suggest a fix in one step: a new version of one item, with a few words on why, sent for review', access: 'write', body: obj({ entityId: idSchema, data: any("The item's whole new data"), title: str(undefined, { maxLength: 200 }), note: str(undefined, { maxLength: 2000 }) }, ['entityId', 'data']), ok: { status: 201, description: 'The suggestion with its checks', schema: ref('Suggestion') } },
  { method: 'get', path: '/v1/suggestions/{id}', operationId: 'getSuggestion', tag: 'Suggestions', summary: "The review view: each item before and after, clashes with main, and the reviewer's advice (machine-written, `machine: true`)", access: 'optional', params: [numberParam('id', 'The suggestion')], ok: { description: 'The suggestion', schema: any() } },
  { method: 'patch', path: '/v1/suggestions/{id}', operationId: 'editSuggestion', tag: 'Suggestions', summary: 'Change the title or description of your suggestion (@mentions and "Fixes #12" are read again)', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ title: str(undefined, { maxLength: 200 }), description: str() }), ok: { description: 'The suggestion', schema: any() } },
  { method: 'get', path: '/v1/suggestions/{id}/conversation', operationId: 'suggestionConversation', tag: 'Suggestions', summary: "A suggestion's timeline (comments, reviews, events), the reviewers asked, and the issues it closes", access: 'optional', params: [numberParam('id', 'The suggestion')], ok: { description: 'The conversation', schema: obj({ number: int(), timeline: arr(any()), people: any(), reviewRequests: arr(any()), fixes: arr(any()), subscribed: bool() }, ['number', 'timeline']) } },
  { method: 'post', path: '/v1/suggestions/{id}/comments', operationId: 'commentOnSuggestion', tag: 'Suggestions', summary: 'Comment on a suggestion, answer a comment, or comment on one field of one item', description: '@handles are told (their inbox), and #12 links to that suggestion or issue.', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ body: str(undefined, { minLength: 1, maxLength: 10000 }), parent: int('The comment this answers'), anchor: obj({ entity: idSchema, field: str() }, ['entity', 'field']) }, ['body']), ok: { status: 201, description: 'The comment id', schema: obj({ id: int() }, ['id']) } },
  { method: 'post', path: '/v1/suggestions/{id}/reviews', operationId: 'reviewSuggestion', tag: 'Suggestions', summary: 'Review: approve (it goes into the catalog, where you may merge it), request changes (sent back), or comment; with comments on fields', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ verdict: { enum: ['approve', 'request_changes', 'comment'] }, body: str(), comments: arr(obj({ entity: idSchema, field: str(), body: str() }, ['entity', 'field', 'body'])), resolutions: any('For each item, how each clashing field is settled') }, ['verdict']), ok: { status: 201, description: 'The review, the new status, and the commit when approved', schema: any() }, also: { '409': 'Clashes that need a decision' } },
  { method: 'post', path: '/v1/suggestions/{id}/review-requests', operationId: 'requestReview', tag: 'Suggestions', summary: 'Ask people to review (asking again asks again)', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ reviewers: arr(str('A handle'), 'Handles') }, ['reviewers']), ok: { status: 201, description: 'Who was asked', schema: obj({ requested: arr(str()) }, ['requested']) } },
  { method: 'delete', path: '/v1/suggestions/{id}/review-requests/{username}', operationId: 'removeReviewRequest', tag: 'Suggestions', summary: 'Stop asking someone to review', access: 'write', params: [numberParam('id', 'The suggestion'), usernameParam], ok: { description: 'Done', schema: OK } },
  { method: 'put', path: '/v1/suggestions/{id}/items', operationId: 'putSuggestionItem', tag: 'Suggestions', summary: 'Add or change one item in a draft suggestion (data null deletes it)', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ id: idSchema, type: str(), data: { type: ['object', 'null'] }, path: { type: ['string', 'null'] } }, ['type', 'data']), ok: { description: 'The item id', schema: obj({ id: idSchema }, ['id']) } },
  { method: 'post', path: '/v1/suggestions/{id}/submit', operationId: 'submitSuggestion', tag: 'Suggestions', summary: 'Send for review (runs the automatic checks)', access: 'write', params: [numberParam('id', 'The suggestion')], ok: { description: 'The suggestion with its checks', schema: ref('Suggestion') } },
  { method: 'post', path: '/v1/suggestions/{id}/approve', operationId: 'approveSuggestion', tag: 'Suggestions', summary: 'Approve and merge (keepers of its sets, stewards)', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ resolutions: any('For each item, how each clashing field is settled'), note: str() }), ok: { description: 'The commit', schema: obj({ commit: nullable(int()) }) }, also: { '409': 'Clashes that need a decision' } },
  { method: 'post', path: '/v1/suggestions/{id}/send-back', operationId: 'sendBackSuggestion', tag: 'Suggestions', summary: 'Send back with a note', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ note: str() }), ok: { description: 'Sent back', schema: OK } },
  { method: 'post', path: '/v1/suggestions/{id}/review-live', operationId: 'reviewLive', tag: 'Suggestions', summary: 'Review a live change after it went live: keep it (approve) or undo it (revert)', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ verdict: { enum: ['approve', 'revert'] }, note: str() }, ['verdict']), ok: { description: 'Kept, or the suggestion that undoes it', schema: any() } },
  { method: 'post', path: '/v1/suggestions/{id}/withdraw', operationId: 'withdrawSuggestion', tag: 'Suggestions', summary: 'Withdraw your suggestion', access: 'write', params: [numberParam('id', 'The suggestion')], ok: { description: 'Withdrawn', schema: OK } },
  { method: 'post', path: '/v1/suggestions/{id}/revert', operationId: 'revertSuggestion', tag: 'Suggestions', summary: 'Undo a merged suggestion (a new suggestion that reverses it)', access: 'write', params: [numberParam('id', 'The suggestion')], body: obj({ reason: str() }), ok: { description: 'The revert', schema: obj({ changeset: int(), commit: nullable(int()) }) } },
  { method: 'post', path: '/v1/suggestions/words', operationId: 'suggestWords', tag: 'Suggestions', summary: "A page's words fixed segment by segment: one segment's new words, a segment added after it or taken out, or a page's first words, sent for review", access: 'write', body: obj({ entityId: idSchema, change: { enum: ['edit', 'add', 'remove', 'start'] }, version: str(), segment: str(), text: arr(any(), 'Runs: { text, marks?, href? }, { note }, { marker }, { br: true }'), before: arr(any(), 'The segment as the person saw it; a change since answers 409'), kind: { enum: ['paragraph', 'heading', 'verse', 'item'] }, language: str(), title: str(), note: str() }, ['entityId', 'change']), ok: { status: 201, description: 'The suggestion sent for review (merged at once where its author may)', schema: any() }, also: { '409': 'The segment changed since it was opened' } },
  { method: 'post', path: '/v1/suggestions/contents-map', operationId: 'mapContents', tag: 'Suggestions', summary: 'Map pages of a publication to the unit they hold (an existing unit, a new one, or words)', access: 'write', body: obj({ publication: idSchema, pages: obj({ from: int(), to: int(), scheme: { enum: ['printed', 'pdf'] } }, ['from', 'to']), unit: idSchema, newUnit: obj({ work: idSchema, label: any(), date: str() }), label: any() }, ['publication', 'pages']), ok: { status: 201, description: 'The suggestion sent for review', schema: any() } },

  // Talk
  { method: 'get', path: '/v1/entities/{id}/talk', operationId: 'itemTalk', tag: 'Talk', summary: "An item's talk page: the conversation about it", access: 'public', params: [idParam], ok: { description: 'Comments, oldest first, replies by parent', schema: obj({ talk: arr(ref('Comment')) }, ['talk']) } },
  { method: 'post', path: '/v1/entities/{id}/talk', operationId: 'commentOnItem', tag: 'Talk', summary: "Comment on an item's talk page", access: 'write', params: [idParam], body: obj({ body: str(undefined, { minLength: 1, maxLength: 10000 }), parent: int('The comment this answers') }, ['body']), ok: { status: 201, description: 'The comment id', schema: obj({ id: int() }, ['id']) } },
  { method: 'post', path: '/v1/comments/{id}/hide', operationId: 'hideComment', tag: 'Talk', summary: 'Hide a comment (its author, or a steward)', access: 'write', params: [numberParam('id', 'The comment')], ok: { description: 'Hidden', schema: OK } },
  { method: 'patch', path: '/v1/comments/{id}', operationId: 'editComment', tag: 'Talk', summary: 'Change your own comment (on a talk page, a suggestion or an issue)', access: 'write', params: [numberParam('id', 'The comment')], body: obj({ body: str(undefined, { minLength: 1, maxLength: 10000 }) }, ['body']), ok: { description: 'Done', schema: OK } },
  { method: 'post', path: '/v1/comments/{id}/resolve', operationId: 'resolveComment', tag: 'Suggestions', summary: "Resolve (or unresolve) a comment on a suggestion's field", access: 'write', params: [numberParam('id', 'The comment')], body: obj({ resolved: bool('false to unresolve') }), ok: { description: 'Done', schema: OK } },

  // Reports
  { method: 'post', path: '/v1/reports', operationId: 'report', tag: 'Reports', summary: 'Report a problem (no account needed: a captcha and an hourly limit instead)', access: 'optional', body: obj({ entityId: idSchema, reason: { enum: ['wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other'] }, note: str(undefined, { maxLength: 10000 }), title: str('A title of its own, as an issue', { maxLength: 200 }), captcha: str('A Turnstile token, when not signed in') }, ['reason']), ok: { status: 201, description: 'The report id, and its number as an issue (#12)', schema: obj({ id: int(), number: nullable(int()) }, ['id', 'number']) }, also: { '429': 'Too many reports from one address' } },
  { method: 'get', path: '/v1/reports', operationId: 'listReports', tag: 'Reports', summary: "A set's inbox of reports (stewards, and the set's keepers)", access: 'read', params: [query('set', idSchema, 'A set'), query('status', { enum: ['open', 'resolved', 'dismissed'] })], ok: { description: 'Reports, never who sent them', schema: obj({ reports: arr(any()), items: arr(ref('Item')) }, ['reports', 'items']) } },
  { method: 'post', path: '/v1/reports/{id}/close', operationId: 'closeReport', tag: 'Reports', summary: 'Resolve or dismiss a report (keepers)', access: 'write', params: [numberParam('id', 'The report')], body: obj({ outcome: { enum: ['resolved', 'dismissed'] }, changeset: int('The suggestion that fixed it'), note: str() }, ['outcome']), ok: { description: 'Closed', schema: OK } },
  { method: 'post', path: '/v1/takedowns', operationId: 'requestTakedown', tag: 'Reports', summary: 'Ask for a file to stop being served (no account needed); stewards answer within two weeks', access: 'public', body: obj({ target: str('The address of its page, an id, or the file address'), name: str(), email: str(), relation: { enum: ['rights-holder', 'family', 'representative', 'other'] }, statement: str(undefined, { minLength: 10, maxLength: 4000 }), captcha: str() }, ['target', 'name', 'email', 'relation', 'statement']), ok: { status: 201, description: 'The request id', schema: obj({ id: int(), answerWithinDays: int() }, ['id']) }, also: { '429': 'Too many requests from one address' } },
  { method: 'post', path: '/v1/teshuros/{id}/family-request', operationId: 'familyRequest', tag: 'Reports', summary: "A family's request that a teshura not be shown (no account needed): its scans stop being served at once, and stewards review it", access: 'optional', params: [idParam], body: obj({ relation: str(), note: str(), contact: str(), captcha: str() }), ok: { status: 201, description: 'The report id and how many files were paused', schema: obj({ report: int(), paused: int() }, ['report', 'paused']) }, also: { '429': 'Too many requests from one address' } },

  // Issues (reports kept like GitHub's issues: public, except reports of rights or of something offensive)
  { method: 'get', path: '/v1/issues', operationId: 'listIssues', tag: 'Issues', summary: 'Issues, newest first, with open and closed counts; private ones only for those who may read them', access: 'optional', paged: true, params: [query('state', { enum: ['open', 'closed', 'all'] }, 'open (the default), closed or all'), query('label', str(), 'Label names, comma separated'), query('type', { enum: ['wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other'] }, 'The kind of report'), query('set', idSchema, 'Only about items in this set'), query('entity', idSchema, 'Only about this item'), query('assignee', str(), 'A handle, or none'), query('author', str(), 'A handle'), query('q', str(), 'Words, or #number'), query('before', int(undefined, { minimum: 1 }), 'Deprecated: the same as a cursor, as a number'), limitParam(100, 30)], ok: { description: 'A page of issues', schema: obj({ items: arr(ref('Issue')), people: any(), counts: obj({ open: int(), closed: int() }, ['open', 'closed']), next: nullable(str()) }, ['items', 'counts', 'next']) } },
  { method: 'post', path: '/v1/issues', operationId: 'openIssue', tag: 'Issues', summary: 'Open an issue (about an item, or the catalog at large)', description: 'Reports of rights or of something offensive are private: stewards and the set\'s keepers read them.', access: 'write', body: obj({ title: str(undefined, { minLength: 1, maxLength: 200 }), body: str(undefined, { maxLength: 10000 }), type: { enum: ['wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other'] }, entityId: idSchema, labels: arr(str()), private: bool('Keep it for stewards and keepers') }, ['title']), ok: { status: 201, description: 'The issue', schema: ref('Issue') } },
  { method: 'get', path: '/v1/issues/templates', operationId: 'issueTemplates', tag: 'Issues', summary: 'The kinds of issue and the words each starts with', access: 'public', ok: { description: 'Templates', schema: obj({ templates: arr(any()) }, ['templates']) } },
  { method: 'get', path: '/v1/issues/{number}', operationId: 'getIssue', tag: 'Issues', summary: 'An issue, its timeline, what the reader may do, and the suggestions that close it', access: 'optional', params: [numberParam('number', 'The issue')], ok: { description: 'The issue', schema: obj({ issue: ref('Issue'), rights: any(), timeline: arr(any()), people: any() }, ['issue']) } },
  { method: 'patch', path: '/v1/issues/{number}', operationId: 'editIssue', tag: 'Issues', summary: 'Change its title or words (its author, keepers, stewards)', access: 'write', params: [numberParam('number', 'The issue')], body: obj({ title: str(undefined, { maxLength: 200 }), body: str() }), ok: { description: 'The issue', schema: any() } },
  { method: 'post', path: '/v1/issues/{number}/state', operationId: 'setIssueState', tag: 'Issues', summary: 'Close as completed or not planned, or reopen', access: 'write', params: [numberParam('number', 'The issue')], body: obj({ state: { enum: ['open', 'completed', 'not_planned'] }, note: str(undefined, { maxLength: 2000 }) }, ['state']), ok: { description: 'The issue', schema: any() } },
  { method: 'put', path: '/v1/issues/{number}/labels', operationId: 'setIssueLabels', tag: 'Issues', summary: 'Set its labels (keepers, stewards, trusted people)', access: 'write', params: [numberParam('number', 'The issue')], body: obj({ labels: arr(str()) }, ['labels']), ok: { description: 'The issue', schema: any() } },
  { method: 'put', path: '/v1/issues/{number}/assignees', operationId: 'setIssueAssignees', tag: 'Issues', summary: 'Set who it is assigned to (yourself; others when you may triage)', access: 'write', params: [numberParam('number', 'The issue')], body: obj({ assignees: arr(str('A handle')) }, ['assignees']), ok: { description: 'The issue', schema: any() } },
  { method: 'post', path: '/v1/issues/{number}/visibility', operationId: 'setIssueVisibility', tag: 'Issues', summary: 'Make it private or public (stewards and keepers)', access: 'write', params: [numberParam('number', 'The issue')], body: obj({ private: bool() }, ['private']), ok: { description: 'The issue', schema: any() } },
  { method: 'post', path: '/v1/issues/{number}/comments', operationId: 'commentOnIssue', tag: 'Issues', summary: 'Comment on an issue, or answer a comment', description: '@handles are told (their inbox), and #12 links to that suggestion or issue.', access: 'write', params: [numberParam('number', 'The issue')], body: obj({ body: str(undefined, { minLength: 1, maxLength: 10000 }), parent: int('The comment this answers') }, ['body']), ok: { status: 201, description: 'The comment id', schema: obj({ id: int() }, ['id']) } },
  { method: 'get', path: '/v1/labels', operationId: 'listLabels', tag: 'Issues', summary: 'Every label and how many open issues carry it', access: 'public', ok: { description: 'Labels', schema: obj({ labels: arr(any()) }, ['labels']) } },
  { method: 'post', path: '/v1/labels', operationId: 'createLabel', tag: 'Issues', summary: 'Make a label (stewards)', access: 'write', body: obj({ name: str(undefined, { pattern: '^[a-z0-9][a-z0-9 -]{0,38}[a-z0-9]$' }), description: str(), color: str('Six hex digits', { pattern: '^[0-9a-f]{6}$' }) }, ['name']), ok: { status: 201, description: 'The label', schema: any() } },

  // People and conversations by name and number
  { method: 'get', path: '/v1/people', operationId: 'searchPeople', tag: 'People', summary: 'People to @mention: handles that start with, or names that contain, what is typed; those in the conversation first', access: 'public', params: [query('q', str(), 'What follows the @'), query('ids', str(), 'Account ids, comma separated (at most 100): who each is, instead of a search'), query('thread', str(undefined, { pattern: '^(changeset|report):[0-9]+$' }), 'changeset:<id> or report:<id>'), limitParam(20, 8)], ok: { description: 'People', schema: obj({ people: arr(any()) }, ['people']) } },
  { method: 'get', path: '/v1/people/{username}', operationId: 'getProfile', tag: 'People', summary: "A person's public page: who they are, their counts and recent activity (an old handle finds them too, with `movedFrom`)", access: 'public', params: [usernameParam, limitParam(100, 30)], ok: { description: 'The profile', schema: any() } },
  { method: 'get', path: '/v1/threads', operationId: 'searchThreads', tag: 'People', summary: 'Suggestions and issues to #mention, by number or words', access: 'optional', params: [query('q', str(), 'What follows the #'), limitParam(20, 8)], ok: { description: 'Threads', schema: obj({ threads: arr(obj({ kind: { enum: ['changeset', 'report'] }, number: int(), title: str(), state: str() })) }, ['threads']) } },
  { method: 'get', path: '/v1/threads/{number}', operationId: 'threadByNumber', tag: 'People', summary: 'Which of the two #12 is: a suggestion or an issue, and its id', access: 'optional', params: [numberParam('number', 'The number after #')], ok: { description: 'What it is', schema: obj({ kind: { enum: ['suggestion', 'issue'] }, number: int(), id: int() }, ['kind', 'number', 'id']) } },

  // Inbox
  { method: 'get', path: '/v1/inbox', operationId: 'inbox', tag: 'Inbox', summary: 'Your inbox, newest first: mentions, review requests, assignments and what you follow', access: 'read', paged: true, params: [query('filter', { enum: ['unread', 'all', 'mention', 'review_requested', 'assigned', 'author', 'comment', 'review', 'state', 'followed'] }, 'unread, all, or one reason'), query('before', str(undefined, { format: 'date-time' }), 'Deprecated: lines older than this time; use cursor'), limitParam(100, 50)], ok: { description: 'Inbox lines and the unread count', schema: obj({ items: arr(ref('InboxLine')), unread: int(), next: nullable(str()) }, ['items', 'unread', 'next']) } },
  { method: 'get', path: '/v1/inbox/count', operationId: 'inboxCount', tag: 'Inbox', summary: 'How many inbox lines are unread', access: 'read', ok: { description: 'The count', schema: obj({ unread: int() }, ['unread']) } },
  { method: 'post', path: '/v1/inbox/read', operationId: 'markInboxRead', tag: 'Inbox', summary: 'Mark inbox lines read (or unread): by id, by conversation, or all', access: 'write', body: obj({ ids: arr(int()), subject: obj({ kind: { enum: ['changeset', 'report', 'entity', 'project'] }, id: str() }, ['kind', 'id']), all: bool(), unread: bool('true: mark them unread') }), ok: { description: 'How many changed, and the unread count', schema: obj({ changed: int(), unread: int() }, ['changed', 'unread']) } },

  // Projects
  { method: 'get', path: '/v1/projects', operationId: 'listProjects', tag: 'Projects', summary: 'Projects working through a gap, with their progress', access: 'public', params: [query('status', { enum: ['open', 'merged', 'closed'] })], ok: { description: 'Projects', schema: obj({ projects: arr(any()) }, ['projects']) } },
  { method: 'post', path: '/v1/projects', operationId: 'createProject', tag: 'Projects', summary: 'Open a project on a gap (farbrengens without recordings or texts, recordings to sync, pages to proofread)', access: 'write', body: obj({ slug: str(undefined, { pattern: '^[a-z0-9-]+$' }), name: str(), goal: str(), set: idSchema, missing: { enum: ['recordings', 'texts', 'sync', 'proofreading'] }, within: str(), scan: idSchema, level: { enum: [1, 2] } }, ['slug', 'name']), ok: { status: 201, description: 'The project', schema: obj({ id: int(), slug: str() }, ['id', 'slug']) } },
  { method: 'get', path: '/v1/projects/{slug}', operationId: 'getProject', tag: 'Projects', summary: 'A project, its progress and what is left to do', access: 'public', params: [slugParam], ok: { description: 'The project', schema: obj({ project: any(), next: arr(ref('Item')), todo: arr(any()) }, ['project', 'next', 'todo']) } },
  { method: 'post', path: '/v1/projects/{slug}/next', operationId: 'claimNext', tag: 'Projects', summary: 'Hand me the next item nobody holds (held for you for a few hours)', access: 'write', params: [slugParam], ok: { description: 'The item, or null', schema: obj({ item: nullable(any()) }, ['item']) } },
  { method: 'post', path: '/v1/projects/{slug}/release', operationId: 'releaseClaim', tag: 'Projects', summary: 'Let go of an item you held', access: 'write', params: [slugParam], body: obj({ item: str() }, ['item']), ok: { description: 'Released', schema: OK } },
  { method: 'post', path: '/v1/projects/{slug}/close', operationId: 'closeProject', tag: 'Projects', summary: 'Close a project (its keepers, stewards)', access: 'write', params: [slugParam], ok: { description: 'Closed', schema: OK } },

  // Personal
  { method: 'get', path: '/v1/follows', operationId: 'listFollows', tag: 'Personal', summary: 'What you follow, the items themselves, and what changed in them lately', access: 'read', params: [limitParam(100, 20)], ok: { description: 'Follows and the feed', schema: obj({ follows: arr(any()), items: arr(ref('Item')), feed: arr(any()) }, ['follows', 'items', 'feed']) } },
  { method: 'post', path: '/v1/follows', operationId: 'follow', tag: 'Personal', summary: 'Follow or unfollow an item, set, project, suggestion or issue', access: 'write', body: obj({ kind: { enum: ['entity', 'set', 'project', 'changeset', 'report'] }, id: str(), on: bool('false to unfollow') }, ['kind', 'id']), ok: { description: 'Done', schema: OK } },
  { method: 'get', path: '/v1/places', operationId: 'listPlaces', tag: 'Personal', summary: 'Where you stopped reading and listening lately (never cached)', access: 'read', params: [query('kind', { enum: ['read', 'listen'] }), query('key', str(), 'One thing only'), limitParam(60, 20)], ok: { description: 'Places', schema: obj({ places: arr(any()) }, ['places']) } },
  { method: 'put', path: '/v1/places', operationId: 'savePlace', tag: 'Personal', summary: 'Keep where you stopped in one thing', access: 'write', body: obj({ kind: { enum: ['read', 'listen'] }, key: str(), title: str(), sub: str(), href: str(), place: any() }, ['kind', 'key', 'title', 'href', 'place']), ok: { description: 'The place kept', schema: any() } },
  { method: 'delete', path: '/v1/places', operationId: 'forgetPlace', tag: 'Personal', summary: 'Forget one place', access: 'write', params: [query('kind', { enum: ['read', 'listen'] }, undefined, true), query('key', str(), 'The thing', true)], ok: { description: 'Forgotten', schema: OK } },

  // Webhooks
  { method: 'get', path: '/v1/webhooks', operationId: 'listWebhooks', tag: 'Webhooks', summary: 'Your webhooks: addresses every merge is posted to', access: 'read', ok: { description: 'Webhooks', schema: obj({ webhooks: arr(any()) }, ['webhooks']) } },
  { method: 'post', path: '/v1/webhooks', operationId: 'createWebhook', tag: 'Webhooks', summary: 'Add a webhook (up to five); its signing secret is shown this once', access: 'write', body: obj({ url: str('https://…', { format: 'uri' }) }, ['url']), ok: { status: 201, description: 'The webhook and its secret', schema: any() } },
  { method: 'delete', path: '/v1/webhooks/{id}', operationId: 'deleteWebhook', tag: 'Webhooks', summary: 'Remove a webhook', access: 'write', params: [numberParam('id', 'The webhook')], ok: { description: 'Removed', schema: OK } },

  // Tokens (site only: a token never makes tokens)
  { method: 'get', path: '/v1/tokens', operationId: 'listTokens', tag: 'Tokens', summary: 'Your API tokens (their prefixes only), revoked ones marked', access: 'site', ok: { description: 'Tokens', schema: obj({ tokens: arr(ref('ApiToken')) }, ['tokens']) } },
  { method: 'post', path: '/v1/tokens', operationId: 'createToken', tag: 'Tokens', summary: 'Make an API token; the token itself is shown this once', access: 'site', body: obj({ name: str('What uses it', { minLength: 1, maxLength: 80 }), scopes: arr({ enum: ['read', 'write'] }, 'Default: read'), expiresInDays: int(undefined, { minimum: 1, maximum: 3650 }) }, ['name']), ok: { status: 201, description: 'The token, and what is kept of it', schema: { allOf: [ref('ApiToken'), obj({ token: str('rhp_… - keep it secret') }, ['token'])] } } },
  { method: 'delete', path: '/v1/tokens/{id}', operationId: 'revokeToken', tag: 'Tokens', summary: 'Revoke a token; it stops working at once', access: 'site', params: [path('id', str(undefined, { pattern: '^tok-[\\w-]+$' }))], ok: { description: 'Revoked', schema: OK } },

  // Mirrors and dumps
  { method: 'get', path: '/v1/mirrors', operationId: 'mirrors', tag: 'Mirrors', summary: 'Everything a mirror needs: the git mirror, the release keys, every edition and its dumps', access: 'public', ok: { description: 'Mirrors', schema: any() } },
  { method: 'get', path: '/v1/editions', operationId: 'editions', tag: 'Mirrors', summary: 'Catalog editions (dated snapshots) and their dumps, each with its size, sha256 and address', access: 'public', ok: { description: 'Editions', schema: obj({ editions: arr(any()) }, ['editions']) } },
  { method: 'get', path: '/v1/editions/{tag}/manifest.json', operationId: 'editionManifest', tag: 'Mirrors', summary: "An edition's signed manifest (Ed25519), exactly as signed", access: 'public', params: [path('tag', str(undefined, { examples: ['2026.40'] }))], ok: { description: 'The manifest', schema: any() } },
  { method: 'get', path: '/v1/editions/{tag}/SHA256SUMS', operationId: 'editionChecksums', tag: 'Mirrors', summary: "An edition's checksums, for sha256sum -c", access: 'public', params: [path('tag', str())], ok: { description: 'Checksums', type: 'text/plain' } },
  { method: 'get', path: '/dumps/{tag}/{name}', operationId: 'getDump', tag: 'Mirrors', summary: "One of an edition's dumps (SQLite, JSON Lines, Parquet)", access: 'public', params: [path('tag', str()), path('name', str())], ok: { description: 'The dump', type: 'application/octet-stream' } },

  // Libraries
  { method: 'get', path: '/oai', operationId: 'oai', tag: 'Libraries', summary: 'OAI-PMH 2.0 for libraries (oai_dc records), when switched on', access: 'public', params: [query('verb', { enum: ['Identify', 'ListMetadataFormats', 'ListSets', 'ListIdentifiers', 'ListRecords', 'GetRecord'] }, undefined, true), query('metadataPrefix', str()), query('identifier', str()), query('from', str()), query('until', str()), query('set', str()), query('resumptionToken', str())], ok: { description: 'OAI-PMH XML', type: 'text/xml' } },
  { method: 'post', path: '/oai', operationId: 'oaiPost', tag: 'Libraries', summary: 'OAI-PMH, the same arguments sent as a form', access: 'public', body: { raw: 'application/x-www-form-urlencoded', description: 'verb and the other arguments' }, ok: { description: 'OAI-PMH XML', type: 'text/xml' } },

  // Agents
  { method: 'post', path: '/mcp', operationId: 'mcp', tag: 'Agents', summary: 'The Model Context Protocol server (Streamable HTTP, JSON answers, no sessions)', description: 'Tools: search, get_item, list_children, get_text, suggest_fix (with a write token). Send JSON-RPC 2.0; see docs/developers/agents.md.', access: 'optional', body: any('A JSON-RPC 2.0 message, or a batch'), ok: { description: 'The JSON-RPC answer', schema: any() }, also: { '202': 'Only notifications were sent: nothing to answer' } },
  { method: 'get', path: '/mcp', operationId: 'mcpStream', tag: 'Agents', summary: 'Not offered: this server opens no event stream', access: 'public', ok: { status: 405, description: 'POST only' } },
  { method: 'delete', path: '/mcp', operationId: 'mcpEnd', tag: 'Agents', summary: 'Not offered: there are no sessions to end', access: 'public', ok: { status: 405, description: 'POST only' } },

  // Sign-in (the site's own pages)
  { method: 'get', path: '/v1/auth/me', operationId: 'me', tag: 'Sign-in', summary: 'Who is signed in, with their passkeys, Google accounts, emails and notifications', access: 'site', ok: { description: 'The person, or null', schema: any() } },
  { method: 'post', path: '/v1/auth/passkey/register/options', operationId: 'passkeyRegisterOptions', tag: 'Sign-in', summary: 'A new account: the options for making a passkey', access: 'site', body: obj({ name: str(), username: str('A handle; else one is made from the name') }, ['name']), ok: { description: 'WebAuthn options and a challenge id', schema: any() } },
  { method: 'post', path: '/v1/auth/passkey/register/verify', operationId: 'passkeyRegisterVerify', tag: 'Sign-in', summary: 'A new account: the passkey made, checked; signs in', access: 'site', body: any(), ok: { status: 201, description: 'The person', schema: any() } },
  { method: 'post', path: '/v1/auth/passkey/add/options', operationId: 'passkeyAddOptions', tag: 'Sign-in', summary: 'Another passkey for this account: its options', access: 'site', ok: { description: 'WebAuthn options', schema: any() } },
  { method: 'post', path: '/v1/auth/passkey/add/verify', operationId: 'passkeyAddVerify', tag: 'Sign-in', summary: 'Another passkey for this account, checked and kept', access: 'site', body: any(), ok: { description: 'Added', schema: any() } },
  { method: 'get', path: '/v1/auth/username', operationId: 'checkUsername', tag: 'Sign-in', summary: 'Whether a handle can be had, and a free one suggested from a name', access: 'site', params: [query('name', str(), 'The handle wanted'), query('from', str(), 'A name to suggest one from')], ok: { description: 'Whether it is free, why not, and a suggestion', schema: any() } },
  { method: 'post', path: '/v1/auth/username', operationId: 'setUsername', tag: 'Sign-in', summary: 'Choose a new handle; the old one keeps leading to you (never with a token)', access: 'site', body: obj({ username: str() }, ['username']), ok: { description: 'The person', schema: any() } },
  { method: 'post', path: '/v1/auth/name', operationId: 'rename', tag: 'Sign-in', summary: 'Change the name you go by', access: 'site', body: obj({ name: str() }, ['name']), ok: { description: 'The person', schema: any() } },
  { method: 'post', path: '/v1/auth/passkey/sign-in/options', operationId: 'passkeySignInOptions', tag: 'Sign-in', summary: 'Signing in with a passkey: its options', access: 'site', ok: { description: 'WebAuthn options', schema: any() } },
  { method: 'post', path: '/v1/auth/passkey/sign-in/verify', operationId: 'passkeySignInVerify', tag: 'Sign-in', summary: 'Signing in with a passkey: checked; signs in', access: 'site', body: any(), ok: { description: 'The person', schema: any() } },
  { method: 'get', path: '/v1/auth/google/start', operationId: 'googleStart', tag: 'Sign-in', summary: 'Signing in with Google: off to Google', access: 'site', params: [query('return', str(), 'Where on the site to come back to')], ok: { status: 302, description: 'To Google' } },
  { method: 'get', path: '/v1/auth/google/callback', operationId: 'googleCallback', tag: 'Sign-in', summary: 'Signing in with Google: back from Google', access: 'site', params: [query('state', str()), query('code', str())], ok: { status: 302, description: 'Back to the site, signed in' } },
  { method: 'post', path: '/v1/auth/email/start', operationId: 'emailStart', tag: 'Sign-in', summary: 'Signing in by email: send a link', access: 'site', body: obj({ email: str(), return: str(), lang: str() }, ['email']), ok: { description: 'Sent', schema: any() }, also: { '429': 'Too many links for this address' } },
  { method: 'post', path: '/v1/auth/email/check', operationId: 'emailCheck', tag: 'Sign-in', summary: 'Signing in by email: what a link is for, before using it', access: 'site', body: obj({ token: str() }, ['token']), ok: { description: 'The address and whether it has an account', schema: any() } },
  { method: 'post', path: '/v1/auth/email/verify', operationId: 'emailVerify', tag: 'Sign-in', summary: 'Signing in by email: use the link; signs in', access: 'site', body: obj({ token: str(), name: str(), username: str('For a new account: a handle') }, ['token']), ok: { description: 'The person', schema: any() } },
  { method: 'post', path: '/v1/auth/notifications', operationId: 'setNotifications', tag: 'Sign-in', summary: 'Email about what you follow: off, a daily digest, or at once', access: 'site', body: obj({ mode: { enum: ['off', 'daily', 'immediate'] }, email: str(), lang: str() }, ['mode']), ok: { description: 'The setting', schema: any() } },
  { method: 'post', path: '/v1/auth/email/unsubscribe', operationId: 'unsubscribe', tag: 'Sign-in', summary: 'Stop email updates, from the link in any of them (no sign-in)', access: 'public', params: [query('token', str())], body: obj({ token: str() }), ok: { description: 'Stopped', schema: obj({ stopped: bool() }) } },
  { method: 'post', path: '/v1/auth/sign-out', operationId: 'signOut', tag: 'Sign-in', summary: 'Sign out this browser', access: 'site', ok: { description: 'Signed out', schema: any() } },

  // Stewards (the site's own pages)
  { method: 'get', path: '/v1/admin/people', operationId: 'listPeople', tag: 'Stewards', summary: 'Everyone with an account (stewards)', access: 'site', params: [query('q', str(), 'A name or id')], ok: { description: 'People', schema: any() } },
  { method: 'post', path: '/v1/admin/people/{id}/role', operationId: 'setRole', tag: 'Stewards', summary: 'Appoint or remove a steward or admin (admins)', access: 'site', params: [path('id', str(undefined, { pattern: '^u-[0-9a-z]+$' }))], body: obj({ steward: bool(), admin: bool() }), ok: { description: 'Done', schema: OK } },
  { method: 'post', path: '/v1/admin/people/{id}/suspend', operationId: 'suspend', tag: 'Stewards', summary: 'Suspend or restore an account (its API tokens are revoked)', access: 'site', params: [path('id', str(undefined, { pattern: '^u-[0-9a-z]+$' }))], body: obj({ on: bool(), reason: str() }), ok: { description: 'Done', schema: OK } },
  { method: 'get', path: '/v1/admin/takedowns', operationId: 'listTakedowns', tag: 'Stewards', summary: 'Takedown requests, with the files each points at', access: 'site', params: [query('status', { enum: ['open', 'resolved', 'dismissed'] })], ok: { description: 'Takedowns', schema: any() } },
  { method: 'post', path: '/v1/admin/files/{sha256}/takedown', operationId: 'takeDown', tag: 'Stewards', summary: 'Take a file down: kept privately, no longer served', access: 'site', params: [path('sha256', sha256Schema)], body: obj({ report: int() }), ok: { description: 'Taken down', schema: any() } },
];

// ------------------------------------------------------------------ shared schemas

const SCHEMAS: Record<string, Schema> = {
  ApiError: obj(
    {
      error: { enum: ['bad-request', 'unauthorized', 'forbidden', 'not-found', 'conflict', 'invalid', 'rate-limited', 'internal', 'state', 'too-large', 'upstream'], description: 'What kind of error, for programs' },
      message: str('What went wrong, for people'),
      detail: { description: 'More, when there is more (a check that failed, the clashes of a merge)' },
      conflicts: arr(any(), 'For a merge that clashes'),
    },
    ['error', 'message'],
  ),
  About: obj({ name: str(), version: str(), head: int('The latest commit\'s seq'), docs: str(), developers: str(), mcp: str(), licence: any() }, ['name', 'version', 'head']),
  Item: obj(
    {
      id: idSchema,
      type: str(),
      path: nullable(str()),
      rev: int('The revision shown'),
      data: any("The item's data, as its type's JSON Schema (/v1/types) says"),
      withheld: str('Set when its words are held back for rights: the item is listed, its text is not served'),
      recordings: int('For events: how many recordings it has'),
    },
    ['id', 'type', 'path', 'rev', 'data'],
  ),
  ItemPage: obj({ items: arr(ref('Item')), next: nullable(str('Pass back as cursor for the next page; null on the last')) }, ['items', 'next']),
  Commit: obj({ seq: int(), at: str(undefined, { format: 'date-time' }), message: str(), mergedBy: str(), author: str(), changes: arr(obj({ id: idSchema, type: str(), path: nullable(str()), rev: int(), data: nullable(any()) })) }, ['seq', 'at', 'message', 'mergedBy', 'author', 'changes']),
  Suggestion: obj(
    {
      id: int(),
      title: str(),
      description: nullable(str()),
      author: str(),
      status: { enum: ['draft', 'open', 'merged', 'sent_back', 'withdrawn'] },
      kind: str(),
      project_id: nullable(int()),
      base_commit: int(),
      merged_commit: nullable(int()),
      post_review: { enum: ['pending', 'done', null] },
      checks: arr(obj({ check: str(), status: { enum: ['pass', 'fail', 'warn'] }, message: str() })),
      created_at: str(),
      submitted_at: nullable(str()),
      closed_at: nullable(str()),
    },
    ['id', 'title', 'author', 'status'],
  ),
  SuggestionListItem: obj({ id: int(), number: int(), title: str(), status: { enum: ['draft', 'open', 'merged', 'sent_back', 'withdrawn'] }, kind: str(), author: str(), createdAt: str(), submittedAt: nullable(str()), closedAt: nullable(str()), comments: int(), reviewers: arr(str()), approvals: int(), changesRequested: bool(), fixes: arr(int(), 'Issues it closes, by number') }, ['id', 'number', 'title', 'status', 'author']),
  Issue: obj(
    {
      id: int(),
      number: int('Its number, shared with suggestions: #12'),
      title: nullable(str()),
      typeTitle: obj({ he: str(), en: str() }),
      type: str(),
      state: { enum: ['open', 'closed'] },
      stateReason: { enum: ['completed', 'not_planned', null] },
      body: nullable(str()),
      private: bool(),
      author: nullable(str('An account id; null for a reader without an account')),
      entity: nullable(any()),
      set: nullable(str()),
      labels: arr(obj({ name: str(), description: nullable(str()), color: str() })),
      assignees: arr(str()),
      comments: int(),
      createdAt: str(),
      updatedAt: nullable(str()),
      closedAt: nullable(str()),
      closedBy: nullable(str()),
      closedBySuggestion: nullable(int()),
    },
    ['id', 'number', 'type', 'state', 'private', 'labels', 'assignees', 'createdAt'],
  ),
  InboxLine: obj({ id: int(), reason: { enum: ['mention', 'review_requested', 'assigned', 'author', 'comment', 'review', 'state', 'followed'] }, subject: any('What it is about: a suggestion or issue (number, title, state) or an item\'s talk page (path, name)'), actor: nullable(str()), actorName: nullable(str()), actorUsername: nullable(str()), count: int(), detail: any(), at: str(), read: bool() }, ['id', 'reason', 'subject', 'count', 'at', 'read']),
  Comment: obj({ id: int(), parent: nullable(int()), author: str(), authorName: str(), body: nullable(str()), at: str(), hidden: bool() }, ['id', 'author', 'body', 'at']),
  ScanTextPage: obj(
    {
      scan: idSchema,
      page: int(),
      pages: int(),
      machine: bool('Still an OCR page, untouched by people'),
      engine: nullable(obj({ name: str(), version: str() })),
      level: int('Proofread: 0 not yet, 1 once, 2 twice', { minimum: 0, maximum: 2 }),
      lines: arr(obj({ id: str(), text: str(), checked: bool('false: machine reading nobody has checked'), level: int() }, ['id', 'text', 'checked'])),
      layers: arr(any()),
    },
    ['scan', 'page', 'pages', 'lines'],
  ),
  Transcript: obj(
    {
      recording: idSchema,
      text: idSchema,
      language: str(),
      alignment: nullable(idSchema),
      granularity: { enum: ['word', 'paragraph', null] },
      paragraphs: arr(obj({ id: idSchema, content: str(), startMs: nullable(int()), endMs: nullable(int()), words: nullable(arr(any())), locked: bool(), checked: bool('false: machine hearing nobody has checked'), syncChecked: bool() }, ['id', 'content', 'checked'])),
    },
    ['recording', 'text', 'paragraphs'],
  ),
  File: obj({ sha256: str(), bytes: int(), mime: str(), rights: { enum: ['open', 'credit', 'link', 'preserved'] }, credit: nullable(str()), url: nullable(str('Where its bytes are served; null while its rights keep it private')), derivations: arr(any()), pageFix: nullable(any()), pageImages: int() }, ['sha256', 'bytes', 'mime', 'rights', 'url']),
  Cover: obj(
    {
      file: sha256Schema,
      page: int('The PDF page drawn', { minimum: 1 }),
      machine: bool('true: a machine chose the title page and no person has yet'),
      reasons: arr(str()),
      credit: nullable(str()),
      image: obj({ url: str(), width: int(), height: int() }, ['url', 'width', 'height']),
      thumb: obj({ url: str(), width: int(), height: int() }, ['url', 'width', 'height']),
    },
    ['file', 'page', 'machine', 'image', 'thumb'],
  ),
  ApiToken: obj({ id: str(), name: str(), prefix: str('Its first characters, to recognise it'), scopes: arr({ enum: ['read', 'write'] }), createdAt: str(), lastUsedAt: nullable(str()), expiresAt: nullable(str()), revokedAt: nullable(str()) }, ['id', 'name', 'prefix', 'scopes', 'createdAt']),
};

// ------------------------------------------------------------------ the document

const SECURITY: Record<Access, Array<Record<string, string[]>> | undefined> = {
  public: undefined,
  optional: [{}, { token: [] }, { session: [] }],
  read: [{ token: ['read'] }, { session: [] }],
  write: [{ token: ['write'] }, { session: [] }],
  site: [{ session: [] }],
};

const ERROR_RESPONSES: Record<string, string> = {
  '400': 'A mistake in the request (an id that is not one, a missing field)',
  '401': 'Not signed in, or a token that is not valid',
  '403': 'Not allowed: a read-only token, or not a keeper',
  '404': 'Not there, or withheld for its rights',
  '429': 'Too many requests: wait (Retry-After) or send a token',
};

function operationObject(op: Operation): Record<string, unknown> {
  const errors = (codes: string[]) => Object.fromEntries(codes.map((code) => [code, { $ref: `#/components/responses/${code}` }]));
  const params = [...(op.params ?? [])];
  if (op.paged) params.push(query('cursor', str(), 'The `next` of the page before'));
  const okStatus = String(op.ok?.status ?? 200);
  const okType = op.ok?.type ?? 'application/json';
  const responses: Record<string, unknown> = {
    [okStatus]: {
      description: op.ok?.description ?? 'Done',
      ...(op.ok && (op.ok.schema || op.ok.type) && !['302', '405'].includes(okStatus) ? { content: { [okType]: { schema: op.ok.schema ?? (okType.includes('json') ? any() : { type: 'string' }) } } } : {}),
      ...(op.paged ? { headers: { Link: { description: 'rel="next": the next page', schema: { type: 'string' } } } } : {}),
    },
  };
  for (const [code, description] of Object.entries(op.also ?? {})) responses[code] = code === '429' || code === '409' || code === '422' ? { description, content: { 'application/json': { schema: ref('ApiError') } } } : { description };
  Object.assign(responses, errors(['400', '404', '429'].filter((code) => !(code in responses))));
  if (op.access !== 'public' && op.access !== 'optional') Object.assign(responses, errors(['401', '403']));
  responses.default = { description: 'Any other error, in the same shape', content: { 'application/json': { schema: ref('ApiError') } } };

  const body = op.body
    ? 'raw' in op.body
      ? { required: true, description: op.body.description, content: { [op.body.raw as string]: { schema: { type: 'string', format: 'binary' } } } }
      : { required: Array.isArray(op.body.required) && op.body.required.length > 0, content: { 'application/json': { schema: op.body } } }
    : undefined;
  const who =
    op.access === 'site'
      ? 'Only from the site\'s own pages, signed in; an API token cannot do this.'
      : op.access === 'write'
        ? 'Signed in: an API token with the write scope, or the site\'s session.'
        : op.access === 'read'
          ? 'Signed in: an API token (read scope is enough), or the site\'s session.'
          : op.access === 'optional'
            ? 'No account needed; signed in, a little more.'
            : undefined;
  return {
    operationId: op.operationId,
    tags: [op.tag],
    summary: op.summary,
    ...(op.description || who ? { description: [op.description, who].filter(Boolean).join('\n\n') } : {}),
    ...(SECURITY[op.access] ? { security: SECURITY[op.access] } : {}),
    'x-access': op.access,
    ...(op.paged ? { 'x-paged': true } : {}),
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: body } : {}),
    responses,
    ...(op.deprecated ? { deprecated: true } : {}),
  };
}

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) (paths[op.path] ??= {})[op.method] = operationObject(op);
  return paths;
}

export const API_TAGS = [
  { name: 'About', description: 'This API, the catalog in numbers' },
  { name: 'Items', description: 'Every sefer, sicha, letter, farbrengen, printing, scan and recording: by id, path, type, set and date, with history' },
  { name: 'Search', description: 'By names and dates, inside the words, and by meaning' },
  { name: 'Texts', description: "Scans' texts line by line, printings compared, translations" },
  { name: 'Media', description: 'Transcripts and their sync' },
  { name: 'Files', description: 'File bytes (while their rights allow), page images, uploads' },
  { name: 'Suggestions', description: 'Every change is a suggestion, checked and reviewed' },
  { name: 'Talk', description: 'The conversation on each page' },
  { name: 'Reports', description: 'Reporting a problem, takedowns, families\' requests' },
  { name: 'Issues', description: 'Reports kept like issues: titles, labels, assignees, comments, closing' },
  { name: 'People', description: 'Handles and profiles; people and conversations to @mention and #mention' },
  { name: 'Inbox', description: 'What concerns you: mentions, review requests, assignments, what you follow' },
  { name: 'Projects', description: 'Group efforts through a gap, the Missing board' },
  { name: 'Personal', description: 'What you follow, where you stopped' },
  { name: 'Webhooks', description: 'Every merge posted to your address, signed' },
  { name: 'Tokens', description: 'Personal API tokens, made on the account page' },
  { name: 'Mirrors', description: 'Editions and their signed dumps' },
  { name: 'Libraries', description: 'OAI-PMH and IIIF' },
  { name: 'Agents', description: 'llms.txt and the MCP server' },
  { name: 'Sign-in', description: "The site's own sign-in; listed for completeness, not for other clients" },
  { name: 'Stewards', description: "The stewards' tools on the site; listed for completeness" },
];

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'RebbeHub API',
    version: '1.0.0',
    summary: 'The open, community-edited index of Chabad Torah and media',
    description:
      'Reading needs nothing. Reporting a problem needs no account. Suggesting and reviewing need a signed-in person: a personal API token (`Authorization: Bearer rhp_…`, made on the account page) or the site\'s session. What a token sends is a suggestion, reviewed like any other.\n\n' +
      'Errors are `{ error, message, detail? }` with the HTTP status of their kind. Lists that page answer `next`; pass it back as `cursor`. JSON answers carry an ETag (send If-None-Match for a 304). Requests are limited per address and, with a token, per token (RateLimit-Policy; 429 with Retry-After). Words a machine read or heard are marked until a person checks them. /v1 changes only by adding; see the developer docs.',
    license: { name: 'AGPL-3.0-only (code); CC0-1.0 (catalog facts); CC-BY-SA-4.0 (community text)', identifier: 'AGPL-3.0-only' },
    contact: { name: 'RebbeHub', url: 'https://github.com/shmuky/RebbeHub' },
  },
  externalDocs: { description: 'Developer docs', url: 'https://rebbehub.org/developers' },
  servers: [{ url: 'https://api.rebbehub.org', description: 'RebbeHub' }],
  tags: API_TAGS,
  components: {
    securitySchemes: {
      token: { type: 'http', scheme: 'bearer', bearerFormat: 'rhp_…', description: 'A personal API token from the account page, with the read or write scope.' },
      session: { type: 'apiKey', in: 'cookie', name: '__Host-rh_session', description: "The site's own session, from its own pages only." },
    },
    schemas: SCHEMAS,
    responses: Object.fromEntries(Object.entries(ERROR_RESPONSES).map(([code, description]) => [code, { description, content: { 'application/json': { schema: ref('ApiError') } } }])),
  },
  paths: buildPaths(),
} as const;

/** The operations as written, for the generated client and the docs. */
export { OPERATIONS };
export type { Access, Operation };
