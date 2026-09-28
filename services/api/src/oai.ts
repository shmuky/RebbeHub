import type { Context, Hono } from 'hono';
import { ExportGate, type Catalog, type EntityView } from '@rebbehub/core';
import { dateKeyToGregorian, describeDateKey } from '@rebbehub/hebrew';
import type { EntityId, EntityType } from '@rebbehub/model';

/**
 * OAI-PMH 2.0 for libraries (the plan, section 10: "later OAI-PMH for
 * libraries"). A library's harvester asks "what changed since" and gets
 * the catalog's sefarim, sichos, farbrengens, printings and recordings as
 * Dublin Core records, a page at a time, deletions included (every change
 * is kept, so a deleted item is reported as deleted, never forgotten).
 * Catalog facts are CC0, so every record may be copied.
 *
 * It is switched on by an address for the repository's administrators
 * (OAI_ADMIN_EMAIL), which the protocol requires in every Identify.
 */

export interface OaiOptions {
  /** The repository administrators' address, which Identify must name. */
  adminEmail: string;
  /** The site's address, for each record's link and the identifiers' namespace (`oai:rebbehub.org:rh-…`). */
  siteUrl?: string;
  /** Records per page before a resumption token. */
  pageSize?: number;
}

/** The kinds of item harvested, and what Dublin Core calls each. */
const RECORD_TYPES: Record<string, string> = { work: 'Text', unit: 'Text', event: 'Event', publication: 'Text', recording: 'Sound' };
const TYPES = Object.keys(RECORD_TYPES) as EntityType[];
const VERBS = ['Identify', 'ListMetadataFormats', 'ListSets', 'ListIdentifiers', 'ListRecords', 'GetRecord'] as const;
const ARGS: Record<(typeof VERBS)[number], { required: string[]; optional: string[]; exclusive?: string }> = {
  Identify: { required: [], optional: [] },
  ListMetadataFormats: { required: [], optional: ['identifier'] },
  ListSets: { required: [], optional: [], exclusive: 'resumptionToken' },
  ListIdentifiers: { required: ['metadataPrefix'], optional: ['from', 'until', 'set'], exclusive: 'resumptionToken' },
  ListRecords: { required: ['metadataPrefix'], optional: ['from', 'until', 'set'], exclusive: 'resumptionToken' },
  GetRecord: { required: ['identifier', 'metadataPrefix'], optional: [] },
};

const xml = (text: unknown): string =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 cannot hold.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const stamp = (at: Date | string) => new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');

class OaiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Token {
  prefix: string;
  from?: string;
  until?: string;
  set?: string;
  /** The last record of the page before: its commit and id. */
  seq: number;
  id: string;
}

const encodeToken = (t: Token) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(t))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function decodeToken(raw: string): Token {
  try {
    const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
    const t = JSON.parse(new TextDecoder().decode(bytes)) as Token;
    if (typeof t.prefix !== 'string' || typeof t.seq !== 'number' || typeof t.id !== 'string') throw new Error('shape');
    return t;
  } catch {
    throw new OaiError('badResumptionToken', 'The resumption token is not one this repository gave.');
  }
}

/** A from/until argument as a time; a day alone means its start (from) or its end (until). */
function readDate(value: string | undefined, end: boolean): string | undefined {
  if (value === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T${end ? '23:59:59' : '00:00:00'}Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return value;
  throw new OaiError('badArgument', `"${value}" is not a date (YYYY-MM-DD or YYYY-MM-DDThh:mm:ssZ).`);
}

interface Row {
  id: EntityId;
  type: EntityType;
  path: string | null;
  deleted: boolean;
  seq: number;
  at: string;
  data: Record<string, unknown> | null;
  sets: string[] | null;
}

export function oaiRoutes(app: Hono, catalog: Catalog, options: OaiOptions): void {
  const site = (options.siteUrl ?? 'https://rebbehub.org').replace(/\/$/, '');
  const namespace = new URL(site).host;
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 500);
  const oaiId = (id: string) => `oai:${namespace}:${id}`;
  const readOaiId = (identifier: string): EntityId => {
    const match = new RegExp(`^oai:${namespace.replace(/\./g, '\\.')}:(rh-[0-9a-hjkmnp-tv-z]{6,16})$`).exec(identifier);
    if (!match) throw new OaiError('idDoesNotExist', `No item is known as ${identifier}.`);
    return match[1] as EntityId;
  };

  /** Records changed within the bounds, in the order of the commits that last changed them. */
  async function records(where: { id?: EntityId; from?: string; until?: string; set?: string; after?: { seq: number; id: string } }, limit: number): Promise<Row[]> {
    const params: unknown[] = [TYPES];
    const clauses = ['e.type = ANY($1::text[])', 'e.updated_seq IS NOT NULL'];
    if (where.id) clauses.push(`e.id = $${params.push(where.id)}`);
    if (where.from) clauses.push(`c.at >= $${params.push(where.from)}::timestamptz`);
    if (where.until) clauses.push(`c.at < ($${params.push(where.until)}::timestamptz + interval '1 second')`);
    if (where.set) {
      const [kind, value] = where.set.split(':');
      if (kind === 'type' && value) clauses.push(`e.type = $${params.push(value)}`);
      else if (kind === 'set' && value) clauses.push(`EXISTS (SELECT 1 FROM entity_ref s WHERE s.from_id = e.id AND s.field = 'sets' AND s.to_id = $${params.push(value)})`);
      else if (kind !== 'type' && kind !== 'set') throw new OaiError('badArgument', `There is no set ${where.set}.`);
    }
    if (where.after) clauses.push(`(e.updated_seq, e.id) > ($${params.push(where.after.seq)}::bigint, $${params.push(where.after.id)}::text)`);
    const { rows } = await catalog.db.query<Row>(
      `SELECT e.id, e.type, e.path, e.deleted, e.updated_seq AS seq, c.at, r.data,
              (SELECT array_agg(s.to_id ORDER BY s.to_id) FROM entity_ref s WHERE s.from_id = e.id AND s.field = 'sets') AS sets
       FROM entity e JOIN commit c ON c.seq = e.updated_seq LEFT JOIN revision r ON r.id = e.main_rev
       WHERE ${clauses.join(' AND ')} ORDER BY e.updated_seq, e.id LIMIT ${limit}`,
      params,
    );
    return rows;
  }

  function header(row: Row): string {
    const deleted = row.deleted || row.data === null;
    const specs = deleted ? [] : [`type:${row.type}`, ...(row.sets ?? []).map((s) => `set:${s}`)];
    return `<header${deleted ? ' status="deleted"' : ''}><identifier>${oaiId(row.id)}</identifier><datestamp>${stamp(row.at)}</datestamp>${specs.map((s) => `<setSpec>${xml(s)}</setSpec>`).join('')}</header>`;
  }

  /** The Dublin Core of a page of records, with the names of the items they point at fetched once. */
  async function dublinCore(rows: Row[]): Promise<Map<string, string>> {
    const gate = new ExportGate(catalog);
    const wanted = new Set<string>();
    for (const row of rows) {
      const d = row.data ?? {};
      for (const key of ['work', 'event', 'authors', 'events', 'reprintOf'])
        for (const v of [d[key]].flat()) if (typeof v === 'string' && v.startsWith('rh-')) wanted.add(v);
    }
    const refs = new Map<string, EntityView>((await catalog.getMany([...wanted] as EntityId[])).map((v) => [v.id, v]));
    // A unit's work's authors are its creators too.
    const authorIds = new Set<string>();
    for (const r of refs.values()) if (r.type === 'work') for (const a of ((r.data as { authors?: string[] }).authors ?? [])) authorIds.add(a);
    for (const a of await catalog.getMany([...authorIds].filter((a) => !refs.has(a)) as EntityId[])) refs.set(a.id, a);

    const nameOf = (id: unknown) => {
      const ref = typeof id === 'string' ? refs.get(id) : undefined;
      const d = (ref?.data ?? {}) as Record<string, { he?: string; en?: string } | undefined>;
      return d.title ?? d.name ?? d.label ?? null;
    };
    const url = (id: string, path: string | null | undefined) => `${site}${path ?? `/${id}`}`;
    const out = new Map<string, string>();
    for (const row of rows) {
      if (!row.data) continue;
      const shown = (await gate.redact({ id: row.id, type: row.type, path: row.path, rev: 0, data: row.data as never })).data as Record<string, unknown>;
      const el: string[] = [];
      const add = (name: string, value: unknown, lang?: string) => {
        if (value !== undefined && value !== null && value !== '') el.push(`<dc:${name}${lang ? ` xml:lang="${lang}"` : ''}>${xml(value)}</dc:${name}>`);
      };
      const local = (name: string, value: unknown) => {
        if (value && typeof value === 'object') for (const [lang, text] of Object.entries(value as Record<string, string>)) if (typeof text === 'string') add(name, text, lang);
      };
      local('title', shown.title ?? shown.label ?? shown.name);
      const work = row.type === 'unit' || row.type === 'publication' ? refs.get(String(shown.work ?? '')) : row.type === 'work' ? { data: shown } : undefined;
      for (const author of ((work?.data as { authors?: string[] } | undefined)?.authors ?? [])) local('creator', nameOf(author));
      if (typeof shown.publisher === 'string') add('publisher', shown.publisher);
      const date = typeof shown.date === 'string' ? shown.date : undefined;
      if (date) {
        add('date', dateKeyToGregorian(date) ?? date);
        add('coverage', describeDateKey(date, 'he'), 'he');
        add('coverage', describeDateKey(date, 'en'), 'en');
      } else if (typeof shown.gregorianYear === 'number') add('date', shown.gregorianYear);
      add('type', RECORD_TYPES[row.type]);
      add('identifier', url(row.id, row.path));
      add('identifier', row.id);
      if (row.type === 'unit' && shown.work) {
        const w = refs.get(String(shown.work));
        add('relation', url(String(shown.work), w?.path));
        local('source', nameOf(shown.work));
      }
      for (const e of [shown.event, shown.events].flat()) if (typeof e === 'string') add('relation', url(e, refs.get(e)?.path));
      if (typeof shown.language === 'string') add('language', shown.language);
      else add('language', 'he');
      if (typeof shown.url === 'string') add('relation', shown.url);
      add('rights', 'Catalog record: CC0-1.0. The works themselves keep their own rights.');
      out.set(
        row.id,
        `<metadata><oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">${el.join('')}</oai_dc:dc></metadata>`,
      );
    }
    return out;
  }

  const handle = async (base: string, args: Record<string, string>): Promise<string> => {
    const verb = args.verb as (typeof VERBS)[number];
    const echo = Object.entries(args)
      .filter(([k]) => ['verb', 'identifier', 'metadataPrefix', 'from', 'until', 'set', 'resumptionToken'].includes(k))
      .map(([k, v]) => ` ${k}="${xml(v)}"`)
      .join('');
    const wrap = (body: string, echoArgs = true) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd"><responseDate>${stamp(new Date())}</responseDate><request${echoArgs ? echo : ''}>${xml(base)}</request>${body}</OAI-PMH>\n`;
    try {
      if (!VERBS.includes(verb)) throw new OaiError('badVerb', args.verb ? `${args.verb} is not an OAI-PMH verb.` : 'Say which verb.');
      const spec = ARGS[verb];
      const given = Object.keys(args).filter((k) => k !== 'verb');
      for (const k of given) if (![...spec.required, ...spec.optional, ...(spec.exclusive ? [spec.exclusive] : [])].includes(k)) throw new OaiError('badArgument', `${verb} does not take ${k}.`);
      if (spec.exclusive && args[spec.exclusive] !== undefined) {
        if (given.length > 1) throw new OaiError('badArgument', `${spec.exclusive} comes alone.`);
      } else for (const k of spec.required) if (!args[k]) throw new OaiError('badArgument', `${verb} needs ${k}.`);

      switch (verb) {
        case 'Identify': {
          const first = await catalog.db.query<{ at: string }>('SELECT min(at) AS at FROM commit');
          return wrap(
            `<Identify><repositoryName>RebbeHub</repositoryName><baseURL>${xml(base)}</baseURL><protocolVersion>2.0</protocolVersion><adminEmail>${xml(options.adminEmail)}</adminEmail><earliestDatestamp>${stamp(first.rows[0]?.at ?? new Date(0))}</earliestDatestamp><deletedRecord>persistent</deletedRecord><granularity>YYYY-MM-DDThh:mm:ssZ</granularity><description><oai-identifier xmlns="http://www.openarchives.org/OAI/2.0/oai-identifier" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai-identifier http://www.openarchives.org/OAI/2.0/oai-identifier.xsd"><scheme>oai</scheme><repositoryIdentifier>${xml(namespace)}</repositoryIdentifier><delimiter>:</delimiter><sampleIdentifier>oai:${xml(namespace)}:rh-7k2m9q4d</sampleIdentifier></oai-identifier></description></Identify>`,
          );
        }
        case 'ListMetadataFormats': {
          if (args.identifier) {
            const [row] = await records({ id: readOaiId(args.identifier) }, 1);
            if (!row) throw new OaiError('idDoesNotExist', `No item is known as ${args.identifier}.`);
          }
          return wrap(
            '<ListMetadataFormats><metadataFormat><metadataPrefix>oai_dc</metadataPrefix><schema>http://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema><metadataNamespace>http://www.openarchives.org/OAI/2.0/oai_dc/</metadataNamespace></metadataFormat></ListMetadataFormats>',
          );
        }
        case 'ListSets': {
          if (args.resumptionToken) throw new OaiError('badResumptionToken', 'The list of sets comes whole.');
          const sets = await catalog.list({ type: 'set', limit: 500 });
          const name = (d: unknown) => {
            const n = (d as { name?: { he?: string; en?: string } }).name;
            return n?.en ? `${n.he ?? ''} (${n.en})` : (n?.he ?? '');
          };
          const typeSets = TYPES.map((t) => `<set><setSpec>type:${t}</setSpec><setName>Items of type ${t}</setName></set>`).join('');
          const catalogSets = sets.map((s) => `<set><setSpec>set:${s.id}</setSpec><setName>${xml(name(s.data))}</setName></set>`).join('');
          return wrap(`<ListSets><set><setSpec>type</setSpec><setName>By kind of item</setName></set>${typeSets}<set><setSpec>set</setSpec><setName>By set</setName></set>${catalogSets}</ListSets>`);
        }
        case 'GetRecord': {
          if (args.metadataPrefix !== 'oai_dc') throw new OaiError('cannotDisseminateFormat', 'Records are given as oai_dc.');
          const [row] = await records({ id: readOaiId(args.identifier!) }, 1);
          if (!row) throw new OaiError('idDoesNotExist', `No item is known as ${args.identifier}.`);
          const meta = await dublinCore([row]);
          return wrap(`<GetRecord><record>${header(row)}${meta.get(row.id) ?? ''}</record></GetRecord>`);
        }
        case 'ListIdentifiers':
        case 'ListRecords': {
          const token = args.resumptionToken ? decodeToken(args.resumptionToken) : null;
          const prefix = token?.prefix ?? args.metadataPrefix!;
          if (prefix !== 'oai_dc') throw new OaiError('cannotDisseminateFormat', 'Records are given as oai_dc.');
          const from = token ? token.from : readDate(args.from, false);
          const until = token ? token.until : readDate(args.until, true);
          if (args.from && args.until && args.from.length !== args.until.length) throw new OaiError('badArgument', 'from and until must be given to the same precision.');
          if (from && until && from > until) throw new OaiError('badArgument', 'from is after until.');
          const set = token ? token.set : args.set;
          const rows = await records({ from, until, set, after: token ? { seq: token.seq, id: token.id } : undefined }, pageSize + 1);
          if (rows.length === 0) throw new OaiError('noRecordsMatch', 'No records match.');
          const page = rows.slice(0, pageSize);
          const last = page[page.length - 1]!;
          const next = rows.length > pageSize ? encodeToken({ prefix, from, until, set, seq: Number(last.seq), id: last.id }) : null;
          const resumption = token || next ? `<resumptionToken>${next ?? ''}</resumptionToken>` : '';
          if (verb === 'ListIdentifiers') return wrap(`<ListIdentifiers>${page.map(header).join('')}${resumption}</ListIdentifiers>`);
          const meta = await dublinCore(page);
          return wrap(`<ListRecords>${page.map((r) => `<record>${header(r)}${meta.get(r.id) ?? ''}</record>`).join('')}${resumption}</ListRecords>`);
        }
      }
    } catch (error) {
      if (error instanceof OaiError) {
        // A bad verb or argument echoes no arguments, as the protocol asks.
        const plain = error.code === 'badVerb' || error.code === 'badArgument';
        return wrap(`<error code="${error.code}">${xml(error.message)}</error>`, !plain);
      }
      throw error;
    }
    throw new OaiError('badVerb', 'Say which verb.');
  };

  const serve = async (c: Context, args: Record<string, string>) => {
    const url = new URL(c.req.url);
    const body = await handle(`${url.origin}${url.pathname}`, args);
    return c.body(body, 200, { 'Content-Type': 'text/xml; charset=utf-8' });
  };
  app.get('/oai', (c) => serve(c, c.req.query()));
  app.post('/oai', async (c) => serve(c, Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]))));
}
