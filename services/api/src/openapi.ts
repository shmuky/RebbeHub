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
    '/v1/files/{sha256}/similar': {
      get: {
        summary: "Held files that look like this one (the same scan or recording in other bytes): a machine's guess from page hashes and audio fingerprints",
        parameters: [{ name: 'sha256', in: 'path', required: true, schema: { type: 'string' } }],
        responses: ok('Similar files, with the items that use each'),
      },
    },
    '/v1/scans/{id}/pages': { get: { summary: "A served scan's page images and thumbnails, and its IIIF manifest", parameters: [idParam], responses: ok('Pages') } },
    '/manifests/iiif/{id}.json': { get: { summary: 'A served scan as a IIIF Presentation 3 manifest, for any IIIF viewer', parameters: [idParam], responses: ok('The manifest') } },
    '/v1/uploads': {
      post: {
        summary: 'Add a recording to a farbrengen, or a scan: another scan of a printing, a new printing of a sefer, or a new teshura (the file is the body)',
        security: signedIn,
        parameters: [
          { ...q('what', 'recording or scan'), required: true },
          { ...q('for', 'The farbrengen, sefer, printing or Teshuros set it is added to'), required: true },
          { ...q('rights', 'mine, free, public-domain or unsure'), required: true },
          q('as', 'scan-of, printing or teshura'),
          q('title', 'Its name'),
          q('publication', 'For scan-of: the printing'),
          q('publisher', 'For a printing'),
          q('year', 'For a printing: a Hebrew or civil year'),
          q('printing', 'For a printing: 1 for the first'),
          q('families', 'For a teshura: its families, as printed'),
          q('simcha', 'For a teshura: wedding, bar-mitzvah, and so on'),
          q('date', "For a teshura: the simcha's date key"),
        ],
        responses: { '201': { description: 'Stored, and a suggestion sent for review' }, '200': { description: 'We already have this file: where it is' } },
      },
    },
    '/v1/uploads/check': {
      post: {
        summary: 'Before an upload: whether we have it (its sha256, a few page hashes) and what it likely is',
        security: signedIn,
        requestBody: json({ type: 'object', required: ['for'], properties: { for: { type: 'string' }, sha256: { type: 'string' }, pageHashes: { type: 'array', items: { type: ['string', 'null'] } }, title: { type: 'string' } } }),
        responses: ok("The guess, files already held that look like it, and the sefer's printings"),
      },
    },
    '/v1/suggestions/contents-map': {
      post: {
        summary: 'Map pages of a publication to the unit they hold (an existing unit, a new one, or words)',
        security: signedIn,
        requestBody: json({
          type: 'object',
          required: ['publication', 'pages'],
          properties: {
            publication: { type: 'string' },
            pages: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' }, scheme: { enum: ['printed', 'pdf'] } } },
            unit: { type: 'string' },
            newUnit: { type: 'object', properties: { work: { type: 'string' }, label: { type: 'object' }, date: { type: 'string' } } },
            label: { type: 'object' },
          },
        }),
        responses: { '201': { description: 'The suggestion sent for review' } },
      },
    },
    '/v1/teshuros/{id}/family-request': {
      post: {
        summary: "A family's request that a teshura not be shown (no account needed): its scans stop being served at once, and stewards review it",
        parameters: [idParam],
        requestBody: json({ type: 'object', properties: { relation: { type: 'string' }, note: { type: 'string' }, contact: { type: 'string' }, captcha: { type: 'string' } } }),
        responses: { '201': { description: 'The report id and how many files were paused' }, '429': { description: 'Too many requests from one address' } },
      },
    },
  },
} as const;
