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
    '/v1/editions': { get: { summary: 'Catalog editions (dated snapshots) and their dumps, each with its size, sha256 and address', responses: ok('Editions') } },
    '/v1/editions/{tag}/manifest.json': { get: { summary: "An edition's signed manifest (Ed25519), exactly as signed", parameters: [{ name: 'tag', in: 'path', required: true, schema: { type: 'string' } }], responses: ok('The manifest') } },
    '/v1/editions/{tag}/SHA256SUMS': { get: { summary: "An edition's checksums, for sha256sum -c", parameters: [{ name: 'tag', in: 'path', required: true, schema: { type: 'string' } }], responses: ok('Checksums') } },
    '/v1/mirrors': { get: { summary: 'Everything a mirror needs: the git mirror, the release keys, every edition and its dumps', responses: ok('Mirrors') } },
    '/v1/places': {
      get: { summary: 'Where you stopped reading and listening lately', security: signedIn, parameters: [q('kind', 'read or listen'), q('key', 'One thing only'), numParam('limit', 'query')], responses: ok('Places') },
      put: { summary: 'Keep where you stopped in one thing', security: signedIn, requestBody: json({ type: 'object', required: ['kind', 'key', 'title', 'href', 'place'], properties: { kind: { enum: ['read', 'listen'] }, key: { type: 'string' }, title: { type: 'string' }, sub: { type: 'string' }, href: { type: 'string' }, place: { type: 'object' } } }), responses: ok('The place kept') },
      delete: { summary: 'Forget one place', security: signedIn, parameters: [q('kind', 'read or listen'), q('key', 'The thing')], responses: ok('Forgotten') },
    },
    '/v1/units/{id}/translations': { post: { summary: 'Suggest a translation of a unit, as its own text', security: signedIn, parameters: [idParam], requestBody: json({ type: 'object', required: ['language', 'credit', 'content'], properties: { language: { type: 'string' }, credit: { type: 'string' }, licence: { enum: ['public-domain', 'cc0', 'cc-by', 'cc-by-nc'] }, translationOf: { type: 'string' }, content: { type: 'string', description: 'A blank line between paragraphs' }, machine: { type: 'string', description: 'The tool, when a machine translated it' } } }), responses: { '201': { description: 'The suggestion made' } } } },
    '/v1/translations/fix': { post: { summary: 'Suggest a fix to one paragraph of a translation', security: signedIn, requestBody: json({ type: 'object', required: ['segment', 'content'], properties: { segment: { type: 'string' }, content: { type: 'string' } } }), responses: { '201': { description: 'The suggestion made' } } } },
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
        summary: 'Ask for a file to stop being served (no account needed); stewards answer within two weeks',
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
    '/v1/suggestions/words': {
      post: {
        summary: "A page's words fixed segment by segment: one segment's new words, a segment added after it or taken out, or a page's first words, sent for review",
        security: signedIn,
        requestBody: json({
          type: 'object',
          required: ['entityId', 'change'],
          properties: {
            entityId: { type: 'string' },
            change: { enum: ['edit', 'add', 'remove', 'start'] },
            version: { type: 'string' },
            segment: { type: 'string' },
            text: { type: 'array', items: { type: 'object' }, description: 'Runs: { text, marks?, href? }, { note }, { marker }, { br: true }' },
            before: { type: 'array', items: { type: 'object' }, description: 'The segment as the person saw it; a change since answers 409' },
            kind: { enum: ['paragraph', 'heading', 'verse', 'item'] },
            language: { type: 'string' },
            title: { type: 'string' },
            note: { type: 'string' },
          },
        }),
        responses: { '201': { description: 'The suggestion sent for review (merged at once where its author may)' }, '409': { description: 'The segment changed since it was opened' } },
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
