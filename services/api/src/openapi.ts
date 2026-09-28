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
    '/v1/search/moments': {
      get: {
        summary: 'Where the words are: lines on scans\' pages (open at the line) and paragraphs of texts and transcripts (open at the moment heard)',
        parameters: [{ ...q('q', 'The query'), required: true }, numParam('limit', 'query')],
        responses: ok('Moments, each saying whether a machine read it and nobody has checked it'),
      },
    },
    '/v1/search/similar': {
      get: {
        summary: 'Search by meaning (embeddings); every result is the machine\'s guess. `available` is false until it is set up',
        parameters: [{ ...q('q', 'A question or an idea, in Hebrew, Yiddish or English'), required: true }, q('types', 'Some of unit, event, segment, text-page, work'), numParam('limit', 'query')],
        responses: ok('Results with their score'),
      },
    },
    '/v1/entities/{id}/relations': { get: { summary: 'An item\'s links both ways: cites, printed in, based on, cited by', parameters: [idParam], responses: ok('Relations, each marked when found by machine and not yet checked') } },
    '/v1/health': { get: { summary: 'The health of the catalog: coverage per year and set, unchecked pages, unsynced recordings, dead links, the oldest open suggestions', parameters: [numParam('limit', 'query')], responses: ok('Health') } },
    '/oai': { get: { summary: 'OAI-PMH 2.0 for libraries (oai_dc records of sefarim, sichos, farbrengens, printings, recordings), when switched on', parameters: [{ ...q('verb', 'Identify, ListMetadataFormats, ListSets, ListIdentifiers, ListRecords, GetRecord'), required: true }], responses: { '200': { description: 'OAI-PMH XML', content: { 'text/xml': {} } } } } },
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
    '/v1/suggestions/{id}': { get: { summary: "The review view: each item before and after, clashes with main, and the reviewer's advice (machine-written, `machine: true`)", parameters: [numParam('id')], responses: ok('The suggestion') } },
    '/v1/suggestions/{id}/review-live': {
      post: {
        summary: 'Review a live change after it went live: keep it (approve) or undo it (revert)',
        security: signedIn,
        parameters: [numParam('id')],
        requestBody: json({ type: 'object', required: ['verdict'], properties: { verdict: { enum: ['approve', 'revert'] }, note: { type: 'string' } } }),
        responses: ok('Kept, or the suggestion that undoes it'),
      },
    },
    '/v1/takedowns': {
      post: {
        summary: 'Ask for a file to stop being served (no account needed); stewards answer within 3 days',
        requestBody: json({
          type: 'object',
          required: ['target', 'name', 'email', 'relation', 'statement'],
          properties: {
            target: { type: 'string', description: 'The address of its page on the site, an id, or the file address' },
            name: { type: 'string' },
            email: { type: 'string' },
            relation: { enum: ['rights-holder', 'family', 'representative', 'other'] },
            statement: { type: 'string', minLength: 10, maxLength: 4000 },
            captcha: { type: 'string' },
          },
        }),
        responses: { '201': { description: 'The request id' }, '429': { description: 'Too many requests from one address' } },
      },
    },
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
