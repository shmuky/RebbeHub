/**
 * The API described for people and tools (OpenAPI 3.1). Item data follows
 * the JSON Schemas served at /v1/types, which are the catalog's own.
 */

const json = (schema: Record<string, unknown> = { type: 'object' }) => ({ content: { 'application/json': { schema } } });
const ok = (description: string, schema?: Record<string, unknown>) => ({ '200': { description, ...json(schema) } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^rh-[0-9a-z]+$' } };
const numParam = (name: string, where: 'path' | 'query' = 'path') => ({ name, in: where, required: where === 'path', schema: { type: 'integer', minimum: 0 } });
const q = (name: string, description: string) => ({ name, in: 'query', required: false, description, schema: { type: 'string' } });
const signedIn = [{ session: [] }];

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'RebbeHub API',
    version: '0.1.0',
    description:
      'The open, community-edited index of Chabad Torah and media. Reading needs nothing. Reporting a problem needs no account. Suggesting and reviewing need a signed-in account. Errors are `{ error, message }` with the HTTP status of their kind.',
    license: { name: 'AGPL-3.0-only (code); CC0-1.0 (catalog facts); CC-BY-SA-4.0 (community text)' },
  },
  components: {
    securitySchemes: { session: { type: 'http', scheme: 'bearer', description: 'Sign-in arrives in phase 2.' } },
    schemas: {
      Entity: {
        type: 'object',
        required: ['id', 'type', 'rev', 'data'],
        properties: { id: { type: 'string' }, type: { type: 'string' }, path: { type: ['string', 'null'] }, rev: { type: 'integer' }, data: { type: 'object' } },
      },
    },
  },
  paths: {
    '/v1': { get: { summary: 'About this API and the current commit', responses: ok('Name, version and head commit') } },
    '/v1/types': { get: { summary: 'Every kind of item and its JSON Schema', responses: ok('Types and schemas') } },
    '/v1/entities': {
      get: {
        summary: 'Items on main, by type and set, a page at a time',
        parameters: [q('type', 'An entity type'), q('set', 'A set id'), q('after', 'The `next` of the previous page'), numParam('limit', 'query')],
        responses: ok('A page of items'),
      },
    },
    '/v1/entities/{id}': { get: { summary: 'One item, on main or as of a commit', parameters: [idParam, numParam('at', 'query')], responses: ok('The item', { $ref: '#/components/schemas/Entity' }) } },
    '/v1/entities/{id}/history': { get: { summary: 'Every merged change to an item, newest first', parameters: [idParam], responses: ok('History') } },
    '/v1/entities/{id}/backlinks': { get: { summary: 'Items that point at this one', parameters: [idParam, q('field', 'Only links in this field'), q('type', 'Only items of this type')], responses: ok('Backlinks') } },
    '/v1/entities/{id}/restore': { post: { summary: 'Suggest restoring an earlier version', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['rev'], properties: { rev: { type: 'integer' } } }), responses: { '201': { description: 'The suggestion made' } } } },
    '/v1/revisions/{rev}': { get: { summary: 'One stored version of an item', parameters: [numParam('rev')], responses: ok('The revision') } },
    '/v1/resolve': { get: { summary: 'The item at a readable path (old paths redirect)', parameters: [{ ...q('path', 'A path such as /likkutei-sichos/12'), required: true }], responses: ok('Its id and current path') } },
    '/v1/search': { get: { summary: 'Search names, text and dates in Hebrew or English', parameters: [{ ...q('q', 'The query'), required: true }, q('type', 'Only this type'), numParam('limit', 'query')], responses: ok('Results, and the date the query names if any') } },
    '/v1/dates/parse': { get: { summary: 'Read a Hebrew date as people write it', parameters: [{ ...q('q', 'e.g. יו"ד שבט תשכ"ב or 10 Shvat 5722'), required: true }], responses: ok('The date key') } },
    '/v1/editions': { get: { summary: 'Catalog editions (dated snapshots) and their dumps', responses: ok('Editions') } },
    '/v1/commits': { get: { summary: 'Commits to main after a given one, with what each changed', parameters: [numParam('since', 'query'), numParam('limit', 'query')], responses: ok('Commits') } },
    '/v1/scans/{id}/text': { get: { summary: "A page of a scan's text: the community page, else the seed layer's; each line with its proofread level, and the scan's layers", parameters: [idParam, numParam('page', 'query')], responses: ok('The page') } },
    '/v1/scans/{id}/progress': { get: { summary: 'How far each page of a scan is proofread (0, 1 or 2)', parameters: [idParam], responses: ok('Pages and levels') } },
    '/v1/scans/{id}/text/fix': { post: { summary: 'Fix one line (a suggestion)', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['page', 'line', 'text'] }), responses: { '201': { description: 'The suggestion' } } } },
    '/v1/scans/{id}/text/confirm': { post: { summary: 'This page is right: raise it a proofreading level, with any fixes (a suggestion)', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['page'], properties: { page: { type: 'integer' }, fixes: { type: 'object', additionalProperties: { type: 'string' } } } }), responses: { '201': { description: 'The suggestion' } } } },
    '/v1/scans/{id}/ocr': { post: { summary: 'Upload your own OCR of a scan (hOCR, ALTO or plain text with form feeds between pages) as a new layer', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['content', 'engine'], properties: { content: { type: 'string' }, format: { enum: ['hocr', 'alto', 'text'] }, engine: { type: 'object', required: ['name', 'version'] }, firstPage: { type: 'integer', minimum: 1 } } }), responses: { '201': { description: 'The suggestion, with pages and lines read' } } } },
    '/v1/scans/{id}/text/seed': { post: { summary: 'Keepers: seed the community text from this OCR layer (checked lines are kept)', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['layer'] }), responses: { '201': { description: 'The suggestion' } } } },
    '/v1/units/{id}/printings': { get: { summary: 'The printings of a unit whose text the catalog has, to compare', parameters: [idParam], responses: ok('Printings') } },
    '/v1/compare': { get: { summary: 'Compare two printings word by word (Hebrew-aware)', parameters: [{ ...q('a', 'text:<id> or scan:<id>:<from>-<to>'), required: true }, { ...q('b', 'The other printing'), required: true }], responses: ok('Runs of same, removed and added words') } },
    '/v1/recordings/{id}/transcript': { get: { summary: "A recording's transcript, with its sync by paragraph and word", parameters: [idParam], responses: ok('The transcript') } },
    '/v1/recordings/{id}/sync/anchor': { post: { summary: 'The Rebbe is saying this line now: set a paragraph (or word) at atMs, lock it, move what follows', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['segment', 'atMs'], properties: { segment: { type: 'string' }, atMs: { type: 'integer' }, word: { type: 'integer' } } }), responses: { '201': { description: 'The suggestion and the spans as they now stand' } } } },
    '/v1/recordings/{id}/sync/confirm': { post: { summary: 'The sync is right: mark every paragraph checked', security: signedIn, parameters: [idParam], responses: { '201': { description: 'The suggestion' } } } },
    '/v1/recordings/{id}/hanacha': { get: { summary: 'The hanacha synced to this recording, paragraph by paragraph', parameters: [idParam], responses: ok('The hanacha and its sync') } },
    '/v1/projects/{slug}': { get: { summary: 'A project, its progress and what is left to do', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: ok('The project') } },
    '/v1/projects/{slug}/next': { post: { summary: 'Hand me the next item nobody holds (held for you for a few hours)', security: signedIn, parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: ok('The item, or null') } },
    '/v1/reports': {
      post: {
        summary: 'Report a problem (no account needed)',
        requestBody: json({
          type: 'object',
          required: ['reason'],
          properties: {
            entityId: { type: 'string' },
            reason: { enum: ['wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other'] },
            note: { type: 'string', maxLength: 2000 },
            captcha: { type: 'string' },
          },
        }),
        responses: { '201': { description: 'The report id' }, '429': { description: 'Too many reports from one address' } },
      },
      get: { summary: "A set's inbox of reports", security: signedIn, parameters: [q('set', 'A set id'), q('status', 'open, resolved or dismissed')], responses: ok('Reports') },
    },
    '/v1/reports/{id}/close': { post: { summary: 'Resolve or dismiss a report (keepers)', security: signedIn, parameters: [numParam('id')], responses: ok('Closed') } },
    '/v1/suggestions': {
      get: { summary: 'Suggestions, by status or author', parameters: [q('status', 'draft, open, merged, sent_back, withdrawn'), q('author', 'An account id'), q('postReview', 'true: live changes awaiting review')], responses: ok('Suggestions') },
      post: { summary: 'Start a suggestion', security: signedIn, requestBody: json({ type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, project: { type: 'integer' } } }), responses: { '201': { description: 'The draft' } } },
    },
    '/v1/suggestions/{id}': { get: { summary: 'The review view: each item before and after, and clashes with main', parameters: [numParam('id')], responses: ok('The suggestion') } },
    '/v1/suggestions/{id}/items': {
      put: {
        summary: 'Add or change one item in a draft suggestion',
        security: signedIn,
        parameters: [numParam('id')],
        requestBody: json({ type: 'object', required: ['type', 'data'], properties: { id: { type: 'string' }, type: { type: 'string' }, data: { type: ['object', 'null'] }, path: { type: ['string', 'null'] } } }),
        responses: ok('The item id'),
      },
    },
    '/v1/suggestions/{id}/submit': { post: { summary: 'Send for review (runs the automatic checks)', security: signedIn, parameters: [numParam('id')], responses: ok('The suggestion with its checks') } },
    '/v1/suggestions/{id}/approve': { post: { summary: 'Approve and merge (keepers of its sets, stewards)', security: signedIn, parameters: [numParam('id')], responses: { ...ok('The commit'), '409': { description: 'Clashes that need a decision' } } } },
    '/v1/suggestions/{id}/send-back': { post: { summary: 'Send back with a note', security: signedIn, parameters: [numParam('id')], responses: ok('Sent back') } },
    '/v1/suggestions/{id}/withdraw': { post: { summary: 'Withdraw your suggestion', security: signedIn, parameters: [numParam('id')], responses: ok('Withdrawn') } },
    '/v1/suggestions/{id}/revert': { post: { summary: 'Undo a merged suggestion', security: signedIn, parameters: [numParam('id')], responses: ok('The revert') } },
    '/v1/follows': { post: { summary: 'Follow or unfollow an item, set, project or suggestion', security: signedIn, responses: ok('Done') } },
  },
} as const;
