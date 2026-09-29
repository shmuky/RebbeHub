import type { Context, Hono } from 'hono';
import { ENTITY_TYPES, allSegments, inlineText, isPageText } from '@rebbehub/model';
import { mcpChallenge } from './oauth.js';
import { mcpInnerCalls, tokenGrantOf } from './tokens.js';

/**
 * RebbeHub for AI agents: a Model Context Protocol server at /mcp
 * (docs/developers/agents.md). Reading needs no account. A writing tool
 * (suggest_fix, open_issue) asks for the person the way the MCP
 * authorization spec says: without a token, HTTP 401 with
 * WWW-Authenticate naming the Protected Resource Metadata (oauth.ts), so
 * a client set to "sign in when needed" (claude.ai) asks the person to
 * connect and tries again; with a token that may only read, HTTP 403
 * `insufficient_scope` asking for `read write` (step-up). A personal API
 * token works as well as an OAuth one.
 *
 * It speaks MCP's Streamable HTTP transport
 * without sessions: every POST is one JSON-RPC message (or a batch) and is
 * answered with JSON; there is no event stream to open (GET is 405).
 *
 * Written by hand rather than with the official SDK: the SDK's HTTP
 * transport wants Node's request objects or a stateful session, and this
 * server needs neither. Every tool calls the API's own routes, with the
 * caller's token, so an agent reads exactly what anyone reads, words
 * withheld for rights stay withheld, and a fix it sends is a suggestion
 * reviewed like any other.
 */


/**
 * The words a unit keeps in its own body, one version (the language asked
 * for, or the first), paragraph by paragraph, with the source's credit
 * line. Segments a machine made and no person checked are marked.
 */
function pageWords(item: any, language: string | undefined): { text: string; structured: unknown } {
  const body = item.data.body;
  if (!isPageText(body)) return { text: String(body), structured: { unit: item.id, body } };
  const version = body.versions.find((v) => !language || v.language === language || v.id === language);
  if (!version) throw new ToolError(`no text of ${item.id} in ${language}; it has ${body.versions.map((v) => v.language).join(', ')}`);
  const unchecked = (origin: any) => Boolean(origin && !origin.checked);
  const paragraphs = [...allSegments(version.segments), ...(version.notes ?? [])]
    .map((segment) => ({ id: segment.id, kind: segment.kind, content: inlineText(segment.text).trim(), machine: unchecked(segment.origin) || unchecked(version.origin) }))
    .filter((p) => p.content);
  const credit = version.credit ? `\n\n${version.credit}${version.url ? ` (${version.url})` : ''}` : '';
  const machine = paragraphs.some((p) => p.machine);
  return {
    text: `${paragraphs.map((p) => `${p.machine ? '[machine] ' : ''}${p.content}`).join('\n\n')}${credit}${machine ? `\n\n${MACHINE_NOTE}` : ''}`,
    structured: { unit: item.id, language: version.language, credit: version.credit ?? null, url: version.url ?? null, paragraphs },
  };
}

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_SERVER_NAME = 'rebbehub';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  run(args: Record<string, unknown>, call: ApiCall): Promise<ToolResult>;
}

interface ToolResult {
  text: string;
  structured?: Record<string, unknown>;
}

/** A call to the API's own routes, as the agent (its token, if it sent one). */
type ApiCall = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

class ToolError extends Error {}

const ID = { type: 'string', pattern: '^[rR][hH]-[0-9A-Za-z-]+$', description: 'A RebbeHub id, rh-…' };

async function need(call: ApiCall, method: string, path: string, body?: unknown): Promise<any> {
  const answer = await call(method, path, body);
  if (answer.status >= 400) throw new ToolError(`${answer.body?.message ?? `the API answered ${answer.status}`} (${answer.body?.error ?? answer.status})`);
  return answer.body;
}

/** What an item is called, in Hebrew and English where it has both. */
function nameOf(item: { id: string; type: string; data?: any }): string {
  const d = item.data ?? {};
  const local = d.name ?? d.title ?? d.label;
  if (local && typeof local === 'object') return [local.he, local.en].filter(Boolean).join(' / ') || item.id;
  if (typeof local === 'string') return local;
  if (d.date) return `${item.type} of ${d.date}`;
  if (d.page) return `${item.type} page ${d.page}`;
  return item.id;
}

/**
 * Which children an item has, by its type: the field that points at it and
 * the type of the children. A set lists its items instead.
 */
export const CHILDREN_BY_TYPE: Record<string, { field: string; type: string }> = {
  work: { field: 'work', type: 'unit' },
  text: { field: 'text', type: 'segment' },
  event: { field: 'event', type: 'recording' },
  publication: { field: 'publication', type: 'scan' },
  scan: { field: 'scan', type: 'text-layer' },
  'text-layer': { field: 'layer', type: 'text-page' },
  recording: { field: 'recording', type: 'alignment' },
  alignment: { field: 'alignment', type: 'alignment-span' },
};

/** The reminder every text answer carries where a machine made the words and no person has checked them. */
const MACHINE_NOTE = 'Lines marked [machine] were read or heard by a machine (OCR or transcription) and no person has checked them yet; do not quote them as the Rebbe\'s words without saying so.';

function tools(siteUrl: string): Tool[] {
  const site = siteUrl.replace(/\/+$/, '');
  const summary = (item: any) => ({ id: item.id, type: item.type, name: nameOf(item), path: item.path ?? null, url: `${site}${item.path ?? `/${item.id}`}`, ...(item.withheld ? { withheld: item.withheld } : {}) });

  return [
    {
      name: 'search',
      title: 'Search RebbeHub',
      description:
        'Search the catalog of Chabad Torah and media (sefarim, sichos, letters, farbrengens, recordings, scans) by name or date, in Hebrew or English; or, with where="words", find the lines of scans and paragraphs of texts and transcripts that hold the words. Hebrew dates are understood (יו"ד שבט תשכ"ב, 10 Shevat 5722).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 500 },
          where: { enum: ['names', 'words'], default: 'names', description: 'names: items by their names and dates; words: inside texts, scans and transcripts' },
          type: { enum: [...ENTITY_TYPES], description: 'Only items of this type (names only)' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const query = String(args.query ?? '').trim();
        if (!query) throw new ToolError('give a query');
        const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 50);
        if (args.where === 'words') {
          const found = await need(call, 'GET', `/v1/search/moments?q=${encodeURIComponent(query)}&limit=${limit}`);
          const moments = (found.moments as any[]).map((m) =>
            m.kind === 'scan-line'
              ? { kind: m.kind, scan: m.scan, page: m.page, text: m.line.text, machine: m.machine, url: `${site}/text/${m.scan}?page=${m.page}&line=${encodeURIComponent(m.line.id)}` }
              : { kind: m.kind, text: m.snippet, unit: m.unit, recording: m.recording, event: m.event, startMs: m.startMs, machine: m.machine },
          );
          const lines = moments.map((m) => `- ${m.machine ? '[machine] ' : ''}${m.text}  (${m.kind === 'scan-line' ? `scan ${m.scan}, page ${m.page}` : [m.unit, m.recording, m.event].filter(Boolean).join(', ')}${m.startMs != null ? `, at ${Math.round(m.startMs / 1000)}s` : ''})`);
          return { text: moments.length ? `${lines.join('\n')}\n\n${moments.some((m) => m.machine) ? MACHINE_NOTE : ''}`.trim() : 'Nothing found inside the texts.', structured: { query, moments } };
        }
        const type = typeof args.type === 'string' ? `&type=${encodeURIComponent(args.type)}` : '';
        const found = await need(call, 'GET', `/v1/search?q=${encodeURIComponent(query)}&limit=${limit}${type}`);
        const results = (found.results as any[]).map(summary);
        const date = found.date ? `The query names the date ${found.date.en} (${found.date.he}, key ${found.date.key}).\n` : '';
        return { text: results.length ? `${date}${results.map((r) => `- ${r.name} (${r.type}, ${r.id}) ${r.url}`).join('\n')}` : `${date}Nothing found.`, structured: { query, date: found.date, results } };
      },
    },
    {
      name: 'get_item',
      title: 'Get an item',
      description: "One item of the catalog with all its data, by its id (rh-…) or its readable path (/likkutei-sichos/12/3, /events/5742-05-10). Items whose words are withheld for rights are listed with `withheld` saying why.",
      inputSchema: { type: 'object', properties: { id: ID, path: { type: 'string', description: 'A readable path, starting with /' } }, additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        let id = typeof args.id === 'string' ? args.id : undefined;
        if (!id && typeof args.path === 'string') id = (await need(call, 'GET', `/v1/resolve?path=${encodeURIComponent(args.path)}`)).id;
        if (!id) throw new ToolError('give an id or a path');
        const item = await need(call, 'GET', `/v1/entities/${encodeURIComponent(id)}`);
        return { text: `${nameOf(item)} (${item.type}, ${item.id}) ${summary(item).url}\n${JSON.stringify(item.data, null, 1)}`, structured: { ...summary(item), rev: item.rev, data: item.data } };
      },
    },
    {
      name: 'list_children',
      title: 'List what an item holds',
      description:
        "What is under an item, in order: a sefer's sichos or letters, a text's paragraphs, a farbrengen's recordings, a printing's scans, a set's items. The kind of children is chosen by the item's type unless field and type are given. Pages come a few at a time; pass `next` back as cursor.",
      inputSchema: {
        type: 'object',
        properties: {
          id: ID,
          field: { type: 'string', description: 'The field of the children that points at the item (work, text, event…)' },
          type: { enum: [...ENTITY_TYPES], description: 'The type of the children' },
          cursor: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const id = String(args.id ?? '');
        const limit = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200);
        const cursor = typeof args.cursor === 'string' && args.cursor ? `&cursor=${encodeURIComponent(args.cursor)}` : '';
        let field = typeof args.field === 'string' ? args.field : undefined;
        let type = typeof args.type === 'string' ? args.type : undefined;
        let page: { items: any[]; next: string | null };
        if (!field || !type) {
          const parent = await need(call, 'GET', `/v1/entities/${encodeURIComponent(id)}`);
          if (parent.type === 'set') {
            page = await need(call, 'GET', `/v1/entities?set=${encodeURIComponent(parent.id)}&limit=${limit}${cursor}`);
            return listed(page, `the items of the set ${nameOf(parent)}`);
          }
          const known = CHILDREN_BY_TYPE[parent.type];
          if (!known) {
            const { backlinks } = await need(call, 'GET', `/v1/entities/${encodeURIComponent(parent.id)}/backlinks`);
            const items = (backlinks as any[]).slice(0, limit).map((b) => ({ id: b.from, type: b.type, field: b.field, path: b.path, url: `${site}${b.path ?? `/${b.from}`}` }));
            return { text: items.length ? `Items that point at ${nameOf(parent)}:\n${items.map((i) => `- ${i.type} ${i.id} (by ${i.field}) ${i.url}`).join('\n')}` : `Nothing points at ${nameOf(parent)}.`, structured: { items, next: null } };
          }
          field ??= known.field;
          type ??= known.type;
        }
        page = await need(call, 'GET', `/v1/entities/${encodeURIComponent(id)}/children?field=${encodeURIComponent(field)}&type=${encodeURIComponent(type)}&limit=${limit}${cursor}`);
        return listed(page, `${type} items under ${id}`);

        function listed(found: { items: any[]; next: string | null }, what: string): ToolResult {
          const items = found.items.map(summary);
          const more = found.next ? `\nMore: call again with cursor "${found.next}".` : '';
          return { text: items.length ? `${what}:\n${items.map((i) => `- ${i.name} (${i.type}, ${i.id})${i.withheld ? ' [withheld]' : ''}`).join('\n')}${more}` : `No ${what}.`, structured: { items, next: found.next } };
        }
      },
    },
    {
      name: 'get_text',
      title: 'Get the words',
      description:
        "The words of an item: a sicha's or letter's text (by its unit or text id), a page of a scan's text (OCR, proofread line by line), or a recording's transcript with when each paragraph is heard. Words a machine read or heard, and no person has checked, are marked [machine]. Texts whose rights do not allow copies are withheld.",
      inputSchema: {
        type: 'object',
        properties: { id: ID, page: { type: 'integer', minimum: 1, description: "For a scan: the page (default 1)" }, language: { type: 'string', description: 'For a unit: the language of the text wanted (he, en…), when it has several' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const item = await need(call, 'GET', `/v1/entities/${encodeURIComponent(String(args.id ?? ''))}`);
        if (item.withheld) throw new ToolError(`the words of ${item.id} are withheld: ${item.withheld}`);
        if (item.type === 'scan') {
          const page = await need(call, 'GET', `/v1/scans/${item.id}/text?page=${Math.max(Number(args.page ?? 1) || 1, 1)}`);
          const lines = (page.lines as any[]).map((l) => `${l.checked ? '' : '[machine] '}${l.text}`);
          return { text: `Scan ${item.id}, page ${page.page} of ${page.pages} (proofread ${page.level} time${page.level === 1 ? '' : 's'}):\n${lines.join('\n')}${page.lines.some((l: any) => !l.checked) ? `\n\n${MACHINE_NOTE}` : ''}`, structured: page };
        }
        if (item.type === 'recording') {
          const transcript = await need(call, 'GET', `/v1/recordings/${item.id}/transcript`);
          const paragraphs = transcript.paragraphs as any[];
          const at = (ms: number | null | undefined) => (ms == null ? '' : `[${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}] `);
          // A transcript's paragraph is the machine's hearing until a person checks its words.
          const machine = paragraphs.some((p) => !p.checked);
          return { text: `${paragraphs.map((p) => `${at(p.startMs)}${p.checked ? '' : '[machine] '}${p.content}`).join('\n\n')}${machine ? `\n\n${MACHINE_NOTE}` : ''}`, structured: transcript };
        }
        let textId: string | undefined;
        if (item.type === 'text') textId = item.id;
        else if (item.type === 'unit') {
          const { backlinks } = await need(call, 'GET', `/v1/entities/${item.id}/backlinks?field=unit&type=text`);
          const texts = (await Promise.all((backlinks as any[]).slice(0, 20).map((b) => need(call, 'GET', `/v1/entities/${b.from}`).catch(() => null)))).filter((t) => t && !t.withheld);
          const language = typeof args.language === 'string' ? args.language : undefined;
          const chosen = texts.find((t) => !language || t.data?.language === language) ?? null;
          // A page imported with its words (the Chabad Library's, Sefaria's) keeps them on the unit itself.
          if (!chosen && item.data?.body) return pageWords(item, language);
          if (!chosen) throw new ToolError(texts.length ? `no text of ${item.id} in ${language}; it has ${[...new Set(texts.map((t) => t.data?.language))].join(', ')}` : `the catalog has no text of ${item.id} that may be shown`);
          textId = chosen.id;
        } else throw new ToolError(`get_text reads units, texts, scans and recordings; ${item.id} is a ${item.type}. Try list_children to find them.`);
        const paragraphs: any[] = [];
        let next: string | null = null;
        do {
          const page = await need(call, 'GET', `/v1/entities/${textId}/children?field=text&type=segment&limit=200${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
          paragraphs.push(...page.items);
          next = page.next;
        } while (next && paragraphs.length < 2000);
        if (paragraphs.some((p) => p.withheld)) throw new ToolError('this text is withheld for its rights');
        const machine = (p: any) => Boolean(p.data?.origin && !p.data.origin.checked);
        const body = paragraphs.map((p) => `${machine(p) ? '[machine] ' : ''}${p.data?.content ?? ''}`).join('\n\n');
        return { text: `${body}${paragraphs.some(machine) ? `\n\n${MACHINE_NOTE}` : ''}`, structured: { text: textId, paragraphs: paragraphs.map((p) => ({ id: p.id, content: p.data?.content ?? '', machine: machine(p) })) } };
      },
    },
    {
      name: 'suggest_fix',
      title: 'Suggest a fix',
      description:
        "Suggest a correction to one item: the fields to change (a field set to null is removed), with a short title and why. It becomes a suggestion under your account, checked and reviewed by the item's keepers like any other; nothing changes until they approve. Needs your RebbeHub account with the write scope: without it, the server asks your client to connect (OAuth), or send an API token.",
      inputSchema: {
        type: 'object',
        properties: {
          id: ID,
          changes: { type: 'object', description: "The fields of the item's data to set, as get_item shows them", additionalProperties: true },
          title: { type: 'string', maxLength: 200, description: 'What the fix is, in a few words' },
          note: { type: 'string', maxLength: 2000, description: 'Why, and the source for it' },
        },
        required: ['id', 'changes', 'title'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async run(args, call) {
        if (!args.changes || typeof args.changes !== 'object' || Array.isArray(args.changes)) throw new ToolError('give changes: an object of the fields to set');
        const item = await need(call, 'GET', `/v1/entities/${encodeURIComponent(String(args.id ?? ''))}`);
        if (item.withheld) throw new ToolError(`${item.id} is withheld for its rights; suggest on the site`);
        const data: Record<string, unknown> = { ...item.data };
        for (const [field, value] of Object.entries(args.changes as Record<string, unknown>)) {
          if (value === null) delete data[field];
          else data[field] = value;
        }
        const made = await need(call, 'POST', '/v1/suggestions/quick', { entityId: item.id, data, title: args.title, note: args.note });
        const status = made.status === 'merged' ? 'merged at once (the set lets your fixes go live; it will still be reviewed after)' : `sent for review (${made.status})`;
        return { text: `Suggestion ${made.id} for ${nameOf(item)}: ${status}. ${site}/review?s=${made.id}`, structured: { suggestion: made.id, status: made.status, checks: made.checks, url: `${site}/review?s=${made.id}` } };
      },
    },
    {
      name: 'list_issues',
      title: 'List issues',
      description:
        "Issues people opened about the catalog (a wrong fact, a missing page, a bad scan…), newest first: open ones by default, or about one item. Suggestions that fix one say \"Fixes #12\". Private issues (rights, offensive) are left out.",
      inputSchema: {
        type: 'object',
        properties: {
          state: { enum: ['open', 'closed', 'all'], default: 'open' },
          item: { ...ID, description: 'Only issues about this item' },
          q: { type: 'string', maxLength: 200, description: 'Words in the title, or #number' },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const params = new URLSearchParams({ state: String(args.state ?? 'open'), limit: String(Math.min(Math.max(Number(args.limit) || 20, 1), 50)) });
        if (typeof args.item === 'string') params.set('entity', args.item);
        if (typeof args.q === 'string' && args.q.trim()) params.set('q', args.q.trim());
        const page = await need(call, 'GET', `/v1/issues?${params}`);
        const issues = (page.items as any[]).map((i) => ({ number: i.number, title: i.title ?? i.typeTitle?.en ?? i.type, type: i.type, state: i.state, labels: (i.labels ?? []).map((l: any) => l.name), item: i.entity?.id ?? null, url: `${site}/issues/${i.number}` }));
        const text = issues.length ? issues.map((i) => `#${i.number} [${i.state}] ${i.title}${i.labels.length ? ` (${i.labels.join(', ')})` : ''} ${i.url}`).join('\n') : 'No issues.';
        return { text, structured: { issues, counts: page.counts } };
      },
    },
    {
      name: 'open_issue',
      title: 'Open an issue',
      description:
        'Open an issue about an item or the catalog: what is wrong or missing, for people to look into. It is public (reports of rights or of something offensive go to stewards only). @handles in the words are told; #12 links to that suggestion or issue. Needs your RebbeHub account with the write scope: without it, the server asks your client to connect (OAuth), or send an API token. To change an item yourself, use suggest_fix.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          body: { type: 'string', maxLength: 10000, description: 'What is wrong, and the source that shows it' },
          type: { enum: ['wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other'], default: 'other' },
          item: { ...ID, description: 'The item it is about, if one' },
        },
        required: ['title'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async run(args, call) {
        const made = await need(call, 'POST', '/v1/issues', { title: args.title, body: args.body, type: args.type ?? 'other', entityId: typeof args.item === 'string' ? args.item : undefined });
        const number = made.issue?.number ?? made.number;
        return { text: `Issue #${number} opened. ${site}/issues/${number}`, structured: { number, url: `${site}/issues/${number}` } };
      },
    },
    {
      name: 'suggest_items',
      title: 'Add or change items',
      description:
        "Add new items, or change or delete several at once, as one suggestion: what the site's editor does, many items at a time. Each item is its type and its whole data (as get_item shows data; schemas are at /schemas/<type>), with id to change an existing one (data null deletes it) and path for a new item's readable path. Up to 200 items a call: pass the suggestion id back as `suggestion` with submit false to keep adding to one suggestion, and submit it with the last call. New items get their ids here, in the order given. Reviewed by the keepers like any suggestion; a steward may approve it with approve_suggestion. Needs a RebbeHub API token with the write scope.",
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              properties: {
                type: { enum: [...ENTITY_TYPES] },
                data: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }], description: "The item's whole data; null deletes it" },
                id: { ...ID, description: 'An existing item to change, or an id for a new one; left out, a new id is made' },
                path: { type: 'string', description: "A new item's readable path, starting with /" },
              },
              required: ['type', 'data'],
              additionalProperties: false,
            },
          },
          suggestion: { type: 'integer', description: 'A suggestion made by an earlier call, still a draft, to add these items to' },
          submit: { type: 'boolean', default: true, description: 'Send it for review after these items; false keeps it a draft to add more' },
          ...SUGGESTION_WORDS,
        },
        required: ['items'],
        additionalProperties: false,
      },
      annotations: WRITE,
      async run(args, call) {
        if (!Array.isArray(args.items) || args.items.length === 0) throw new ToolError('give items: a list of { type, data, id?, path? }');
        if (args.items.length > 200) throw new ToolError('at most 200 items a call; keep adding to the same suggestion');
        let suggestion = typeof args.suggestion === 'number' ? args.suggestion : null;
        if (suggestion === null) {
          const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : `Add ${args.items.length} item${args.items.length === 1 ? '' : 's'}`;
          suggestion = (await need(call, 'POST', '/v1/suggestions', { title, description: typeof args.note === 'string' ? args.note : undefined })).id as number;
        }
        const made: { id: string; type: string; path: string | null }[] = [];
        for (const [i, item] of (args.items as any[]).entries()) {
          if (!item || typeof item !== 'object' || typeof item.type !== 'string' || item.data === undefined) throw new ToolError(`item ${i + 1}: give type and data (suggestion ${suggestion} keeps the ${i} before it)`);
          const answer = await call('PUT', `/v1/suggestions/${suggestion}/items`, { type: item.type, data: item.data, id: item.id, path: item.path });
          if (answer.status >= 400) throw new ToolError(`item ${i + 1}: ${answer.body?.message ?? `the API answered ${answer.status}`} (suggestion ${suggestion} keeps the ${i} before it; fix it and call again with suggestion ${suggestion})`);
          made.push({ id: answer.body.id, type: item.type, path: item.path ?? null });
        }
        const url = `${site}/review?s=${suggestion}`;
        if (args.submit === false) return { text: `Suggestion ${suggestion}: ${made.length} item${made.length === 1 ? '' : 's'} added, still a draft. ${url}`, structured: { suggestion, status: 'draft', items: made, url } };
        const sent = await need(call, 'POST', `/v1/suggestions/${suggestion}/submit`);
        const failed = (sent.checks ?? []).filter((c: any) => c.status === 'fail');
        const status = sent.status === 'merged' ? 'merged at once (the set lets your changes go live; it will still be reviewed after)' : `sent for review (${sent.status})`;
        return {
          text: [`Suggestion ${suggestion}: ${status}; ${made.length} item${made.length === 1 ? '' : 's'} in this call. ${url}`, ...failed.map((c: any) => `Failed check: ${c.message}`)].join('\n'),
          structured: { suggestion, status: sent.status, items: made, checks: sent.checks ?? [], url },
        };
      },
    },
    {
      name: 'approve_suggestion',
      title: 'Approve a suggestion',
      description: "Approve a suggestion sent for review, merging it into the catalog, when you may (its sets' keepers, or a steward). With a short note for the record.",
      inputSchema: { type: 'object', properties: { suggestion: { type: 'integer' }, note: { type: 'string', maxLength: 2000 } }, required: ['suggestion'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        const merged = await need(call, 'POST', `/v1/suggestions/${Number(args.suggestion)}/approve`, { note: typeof args.note === 'string' ? args.note : undefined });
        return { text: `Suggestion ${args.suggestion} approved and merged${merged.commit != null ? ` (commit ${merged.commit})` : ''}.`, structured: { suggestion: args.suggestion, commit: merged.commit ?? null } };
      },
    },
    ...machineTools(site),
    ...organizeTools(site),
  ];
}

/**
 * The machines' tools (core/machineWork.ts): asking for a scan to be read
 * or a recording transcribed, and seeing where the requests stand. The
 * machines are free CPU engines; what they make is labelled until checked.
 */
function machineTools(site: string): Tool[] {
  const line = (r: any) => `#${r.id} ${r.kind === 'ocr' ? 'read' : 'transcribe'} ${r.item}: ${r.status}${r.position ? `, ${r.position} in line` : ''}${r.note ? ` (${r.note})` : ''} ${site}/${r.item}`;
  return [
    {
      name: 'ask_machine',
      title: 'Ask the machine to read or transcribe',
      description:
        "Ask RebbeHub's machines to read a scan (kind ocr: Hebrew OCR, line by line, so its words can be searched and proofread) or to transcribe a recording (kind transcript: the Rebbe's Yiddish heard by a model trained on his voice, synced paragraph by paragraph). The work is queued and done on free machines, usually within a day (at once where the site is set up for it); its words are marked [machine] until people check them. Asking for what already waits joins that request. Needs the write scope.",
      inputSchema: { type: 'object', properties: { kind: { enum: ['ocr', 'transcript'] }, item: { ...ID, description: 'The scan (ocr) or recording (transcript)' } }, required: ['kind', 'item'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const made = await need(call, 'POST', '/v1/machine/requests', { kind: args.kind, item: args.item });
        const r = made.request;
        const when = made.startsAtOnce ? 'The machine is starting now.' : 'The machine takes it on its next run.';
        return { text: `${made.created ? 'Asked' : 'Already asked'}: ${line(r)}. ${when}`, structured: { request: r, created: made.created, startsAtOnce: made.startsAtOnce } };
      },
    },
    {
      name: 'machine_queue',
      title: "See the machines' queue",
      description: 'What waits for the machines (OCR of scans, transcripts of recordings), in the order they will be taken, and what they did lately; or the requests for one item. With no arguments, also how much is left for them.',
      inputSchema: { type: 'object', properties: { kind: { enum: ['ocr', 'transcript'] }, item: ID, status: { enum: ['waiting', 'running', 'done', 'failed'] }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }, additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const params = new URLSearchParams({ limit: String(Math.min(Math.max(Number(args.limit) || 20, 1), 100)) });
        for (const key of ['kind', 'item', 'status']) if (typeof args[key] === 'string') params.set(key, args[key] as string);
        const [{ requests }, summary] = await Promise.all([need(call, 'GET', `/v1/machine/requests?${params}`), args.item ? null : need(call, 'GET', '/v1/machine')]);
        const head = summary
          ? [`OCR: ${summary.ocr.waiting} waiting, ${summary.ocr.backlog} served scans not read yet.`, `Transcripts: ${summary.transcript.waiting} waiting, ${summary.transcript.backlog} served recordings not transcribed yet.`]
          : [];
        return { text: [...head, ...(requests as any[]).map(line)].join('\n') || 'No requests.', structured: { requests, ...(summary ? { summary } : {}) } };
      },
    },
    {
      name: 'training_data',
      title: "See the next Rebbe Whisper's training data",
      description: 'How much training data people have made by checking transcripts: clips and hours (gold: words and timing checked by a person; silver: words checked, timing by machine), train and test hours, what was left out and why. With since, the hours checked since then (what a new training round would add). The clips themselves: GET /v1/machine/training/clips.',
      inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'A date, like 2026-09-29' } }, additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const since = typeof args.since === 'string' ? `?since=${encodeURIComponent(args.since)}` : '';
        const s = await need(call, 'GET', `/v1/machine/training${since}`);
        const text = [
          `${s.clips} clips, ${s.hours} hours from ${s.recordings} recordings (${s.gold} gold, ${s.silver} silver); train ${s.trainHours} h, test ${s.testHours} h.`,
          ...(s.newHours === null ? [] : [`${s.newHours} hours checked since ${args.since}.`]),
          ...Object.entries(s.skipped as Record<string, number>).map(([reason, n]) => `Left out, ${reason}: ${n}.`),
        ].join('\n');
        return { text, structured: s };
      },
    },
  ];
}

/** A place among siblings, as the organize tools take it. */
const POSITION = {
  description: 'Where among its siblings: "start", "end" (the default), { "after": id } or { "before": id }',
  oneOf: [{ enum: ['start', 'end'] }, { type: 'object', properties: { after: ID }, required: ['after'], additionalProperties: false }, { type: 'object', properties: { before: ID }, required: ['before'], additionalProperties: false }],
};
const LOCAL_NAME = { type: 'object', properties: { he: { type: 'string', maxLength: 300 }, en: { type: 'string', maxLength: 300 } }, additionalProperties: false };
const SUGGESTION_WORDS = {
  title: { type: 'string', maxLength: 200, description: "The suggestion's title (made from the change when left out)" },
  note: { type: 'string', maxLength: 2000, description: 'Why, for the reviewers' },
};
const ORGANIZE_NOTE =
  ' It becomes one suggestion under your account, reviewed by the keepers of the sets it touches (stewards for sets themselves); nothing changes until it is approved, and old paths redirect after. Needs a RebbeHub API token with the write scope. preview_organize shows the change first.';
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const OPERATIONS = {
  type: 'array',
  minItems: 1,
  maxItems: 200,
  items: { type: 'object', properties: { op: { enum: ['move', 'move-up', 'rename', 'reorder', 'create-set', 'delete-set', 'merge', 'split'] } }, required: ['op'], additionalProperties: true },
  description:
    'Done in order; items are ids, or new:<key> for a set made earlier in the plan. move { items, to, from?, mode?, position? }, move-up { items, from? }, rename { item, name?, slug?, path? }, reorder { items, parent?, position? }, create-set { key?, name, slug, parent?, items? }, delete-set { item }, merge { from, into }, split { work, units? or range: { from, to }, title, slug }.',
};

/**
 * The organize tools: each makes one plan of operations (core/organize.ts)
 * and sends it through the API's POST /v1/organize as the agent, so what it
 * does is one suggestion, reviewed like anyone's.
 */
function organizeTools(site: string): Tool[] {
  const send = async (call: ApiCall, operations: unknown[], args: Record<string, unknown>): Promise<ToolResult> => {
    const made = await need(call, 'POST', '/v1/organize', { operations, title: typeof args.title === 'string' ? args.title : undefined, description: typeof args.note === 'string' ? args.note : undefined });
    const s = made.suggestion;
    const url = s.number != null ? `${site}/suggestions/${s.number}` : `${site}/review?s=${s.id}`;
    const preview = made.preview;
    const lines = [
      `Suggestion ${s.number != null ? `#${s.number}` : s.id} "${s.title}": ${made.merged ? 'merged' : `sent for review (${s.status})`}. ${url}`,
      ...preview.summary.map((line: string) => `- ${line}`),
      `${preview.items.length} item${preview.items.length === 1 ? '' : 's'} changed${preview.redirects.length ? `; ${preview.redirects.length} old path${preview.redirects.length === 1 ? '' : 's'} will redirect once approved` : ''}.`,
      ...preview.warnings.map((w: string) => `Note: ${w}`),
    ];
    return {
      text: lines.join('\n'),
      structured: { suggestion: s.id, number: s.number ?? null, status: s.status, merged: made.merged, url, summary: preview.summary, items: preview.items.length, redirects: preview.redirects, forwards: preview.forwards, warnings: preview.warnings, created: preview.created },
    };
  };
  const ids = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === 'string')) throw new ToolError('give items: a list of ids');
    return value as string[];
  };
  const ITEMS = { type: 'array', items: ID, minItems: 1, maxItems: 5000 };
  const label = (n: any) => [n.name?.he, n.name?.en].filter(Boolean).join(' / ') || n.id;
  const counts = (n: any) => Object.entries(n.counts ?? {}).map(([k, v]) => `${v} ${k}`).join(', ');

  return [
    {
      name: 'get_tree',
      title: 'See the tree',
      description:
        "The catalog as a tree, for organizing it: the top sets (no root), or one set or sefer, with the sets under it, the sefarim and other items in it (sefarim first, in their order) and how much each holds (sets, items, units). depth goes further down (a set's sefarim's units at depth 2).",
      inputSchema: { type: 'object', properties: { root: { ...ID, description: 'A set or sefer; left out, the top sets' }, depth: { type: 'integer', minimum: 0, maximum: 4, default: 1 }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } }, additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        const params = new URLSearchParams();
        if (typeof args.root === 'string') params.set('root', args.root);
        if (args.depth !== undefined) params.set('depth', String(Math.min(Math.max(Number(args.depth) || 0, 0), 4)));
        if (args.limit !== undefined) params.set('limit', String(Math.min(Math.max(Number(args.limit) || 100, 1), 500)));
        const tree = await need(call, 'GET', `/v1/tree?${params}`);
        const lines: string[] = [];
        const walk = (nodes: any[], indent: string) => {
          for (const n of nodes) {
            lines.push(`${indent}- ${label(n)} (${n.type}, ${n.id}${n.path ? `, ${n.path}` : ''})${counts(n) ? ` [${counts(n)}]` : ''}`);
            if (n.children) walk(n.children, `${indent}  `);
            if (n.more) lines.push(`${indent}  … ${n.more} more`);
          }
        };
        if (tree.root) lines.push(`${label(tree.root)} (${tree.root.type}, ${tree.root.id}) [${counts(tree.root)}]`);
        walk(tree.children, tree.root ? '  ' : '');
        if (!tree.root && tree.more) lines.push(`… ${tree.more} more top sets`);
        return { text: lines.length ? lines.join('\n') : 'Nothing here.', structured: tree };
      },
    },
    {
      name: 'preview_organize',
      title: 'Preview organizing',
      description:
        'See what a plan of organizing operations would change, item by item, without saving anything: the fields that change, the paths that move and redirect, notes. Send the same operations with organize (or use the single-step tools) to make the suggestion.',
      inputSchema: { type: 'object', properties: { operations: OPERATIONS }, required: ['operations'], additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, call) {
        if (!Array.isArray(args.operations) || args.operations.length === 0) throw new ToolError('give operations: a list of { op, … }');
        const preview = await need(call, 'POST', '/v1/organize/preview', { operations: args.operations });
        const lines = [
          `Would make one suggestion: "${preview.title}"`,
          ...preview.summary.map((l: string) => `- ${l}`),
          ...preview.items.slice(0, 50).map((i: any) => `  ${i.deleted ? 'delete' : i.isNew ? 'new' : 'change'} ${i.type} ${i.name} (${i.id})${i.pathBefore !== i.path ? `: ${i.pathBefore ?? '-'} → ${i.path ?? '-'}` : ''}${i.changes.length ? `; ${i.changes.map((c: any) => c.path).join(', ')}` : ''}`),
          preview.items.length > 50 ? `  … and ${preview.items.length - 50} more items` : '',
          ...preview.warnings.map((w: string) => `Note: ${w}`),
        ].filter(Boolean);
        return { text: lines.join('\n'), structured: preview };
      },
    },
    {
      name: 'organize',
      title: 'Organize (a whole plan)',
      description: `Send a plan of organizing operations (as preview_organize takes them) as one suggestion: several moves, renames and merges reviewed together.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { operations: OPERATIONS, ...SUGGESTION_WORDS }, required: ['operations'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        if (!Array.isArray(args.operations) || args.operations.length === 0) throw new ToolError('give operations: a list of { op, … }');
        return send(call, args.operations, args);
      },
    },
    {
      name: 'move_items',
      title: 'Move items',
      description: `Move items under a new parent: sefarim (or any items) into a set (with from, out of that set; mode "only" makes it their one set); to null with from takes them out of that set; a set under another set, or to the top (to null); sichos (units) to another sefer, at the end or at a position, their paths moving along; a printing to another sefer, a scan to another printing, a recording to another farbrengen. A set never goes under its own descendant.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { items: ITEMS, to: { oneOf: [ID, { type: 'null' }], description: 'The new parent, or null (to the top, or out of `from`)' }, from: { ...ID, description: 'The set they leave' }, mode: { enum: ['add', 'only'], default: 'add' }, position: POSITION, ...SUGGESTION_WORDS }, required: ['items', 'to'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        return send(call, [{ op: 'move', items: ids(args.items), to: args.to ?? null, from: args.from, mode: args.mode, position: args.position }], args);
      },
    },
    {
      name: 'move_up',
      title: 'Move up a level',
      description: `Move items one level up the tree: a set to its parent's parent (the top, when its parent is a top set); a sefer out of a set into that set's parent set (from says which set, when it is in several).${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { items: ITEMS, from: { ...ID, description: 'The set they move up out of' }, ...SUGGESTION_WORDS }, required: ['items'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        return send(call, [{ op: 'move-up', items: ids(args.items), from: args.from }], args);
      },
    },
    {
      name: 'rename_item',
      title: 'Rename an item',
      description: `Give an item (a set, a sefer, a sicha…) a new name in Hebrew and/or English, and optionally a new slug (the last part of its path; a set's slug too) or a whole new path. The old path redirects, and paths made from it (a sefer's sichos) move along.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { item: ID, name: LOCAL_NAME, slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }, path: { type: 'string', description: 'A whole new path, starting with /' }, ...SUGGESTION_WORDS }, required: ['item'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        return send(call, [{ op: 'rename', item: args.item, name: args.name, slug: args.slug, path: args.path }], args);
      },
    },
    {
      name: 'reorder_children',
      title: 'Put items in order',
      description: `Put siblings in order: a sefer's sichos, the sefarim of a set, the sets under a set (parent null for the top sets). Without position, the items take the places they hold now in the order given (give the whole list for a whole new order); with it, they go together to the start, the end, or beside a sibling. Only the items whose place changes are changed.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { items: ITEMS, parent: { oneOf: [ID, { type: 'null' }], description: 'Whose children they are, where it is not clear (a sefer in two sets); null for the top sets' }, position: POSITION, ...SUGGESTION_WORDS }, required: ['items'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        return send(call, [{ op: 'reorder', items: ids(args.items), parent: args.parent, position: args.position }], args);
      },
    },
    {
      name: 'create_set',
      title: 'Make a set',
      description: `Make a new set, under a parent set or at the top, kept like its parent (the same keepers and policy), optionally moving items into it at once. Its path is /sets/<slug>.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { name: { ...LOCAL_NAME, required: ['he'] }, slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }, parent: { ...ID, description: 'The set it goes under' }, description: LOCAL_NAME, items: { ...ITEMS, description: 'Items to move into it' }, ...SUGGESTION_WORDS }, required: ['name', 'slug'], additionalProperties: false },
      annotations: WRITE,
      async run(args, call) {
        return send(call, [{ op: 'create-set', key: 'set', name: args.name, slug: args.slug, parent: args.parent, description: args.description, items: args.items }], args);
      },
    },
    {
      name: 'delete_set',
      title: 'Remove an empty set',
      description: `Remove a set that holds nothing (no sets under it, no items in it; move them out first). Its path then leads to its parent set.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { item: ID, ...SUGGESTION_WORDS }, required: ['item'], additionalProperties: false },
      annotations: { ...WRITE, destructiveHint: true },
      async run(args, call) {
        return send(call, [{ op: 'delete-set', item: args.item }], args);
      },
    },
    {
      name: 'merge_items',
      title: 'Merge duplicates',
      description: `Merge a duplicate into the item to keep (both of one type: two sefarim, two sets, two sichos…): everything under or pointing at the duplicate moves to the one kept, what it lacks is taken from the duplicate (external ids, sets, editions joined), and the duplicate is deleted, its paths leading to the one kept. For sorting a library's books into sefarim already in the catalog.${ORGANIZE_NOTE}`,
      inputSchema: { type: 'object', properties: { from: { ...ID, description: 'The duplicate, deleted' }, into: { ...ID, description: 'The item kept' }, ...SUGGESTION_WORDS }, required: ['from', 'into'], additionalProperties: false },
      annotations: { ...WRITE, destructiveHint: true },
      async run(args, call) {
        return send(call, [{ op: 'merge', from: args.from, into: args.into }], args);
      },
    },
  ];
}

/**
 * A writing tool called by someone who may not write: answered at the HTTP
 * level (401, or 403 for a token that may only read), so the client asks
 * the person to connect, or to allow writing, and calls again.
 */
class NeedsSignIn extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'this tool sends a suggestion as you: connect your RebbeHub account (OAuth) or send an API token with the write scope' : 'this connection may only read: connect again and allow sending suggestions (the write scope)');
  }
}

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } });

export function mcpRoutes(app: Hono, options: { siteUrl: string; version: string }): void {
  const list = tools(options.siteUrl);
  const byName = new Map(list.map((t) => [t.name, t]));

  const handle = async (message: JsonRpcRequest, call: ApiCall, may: { signedIn: boolean; write: boolean }) => {
    const { id, method, params = {} } = message;
    switch (method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '');
        return {
          protocolVersion: (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, title: 'RebbeHub', version: options.version, websiteUrl: `${options.siteUrl.replace(/\/+$/, '')}/developers` },
          instructions:
            'RebbeHub is the open, community-edited index of Chabad Torah and media. Search, read items and their words; ids are rh-… and never change. Words marked [machine] were read or heard by a machine and not yet checked. suggest_fix (write scope; you will be asked to connect your RebbeHub account) makes a suggestion under the connected person\'s account that people review before anything changes; suggest_items (write scope) adds, changes or deletes many items in one suggestion, and approve_suggestion approves one when you may; list_issues shows what people reported, and open_issue (write scope) reports a problem for people to look into. ask_machine (write scope) asks for a scan to be read by OCR or a recording transcribed; machine_queue shows where those requests stand, and training_data how much training data people\'s checking has made for the next transcription model. To organize the catalog, get_tree shows it; move_items, move_up, rename_item, reorder_children, create_set, delete_set, merge_items and organize (write scope) each make one suggestion that people review; preview_organize shows the change first.',
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: list.map(({ run: _run, ...tool }) => tool) };
      case 'tools/call': {
        const tool = byName.get(String(params.name ?? ''));
        if (!tool) return rpcError(id, -32602, `no tool named "${String(params.name)}"; see tools/list`);
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'arguments must be an object');
        if (!tool.annotations.readOnlyHint && !may.write) throw new NeedsSignIn(may.signedIn ? 403 : 401);
        try {
          const result = await tool.run(args, call);
          return { content: [{ type: 'text', text: result.text }], ...(result.structured ? { structuredContent: result.structured as Json } : {}), isError: false };
        } catch (error) {
          if (error instanceof ToolError) return { content: [{ type: 'text', text: error.message }], isError: true };
          throw error;
        }
      }
      case 'resources/list':
        return { resources: [] };
      case 'prompts/list':
        return { prompts: [] };
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  };

  app.get('/mcp', (c) => c.json({ error: 'bad-request', message: 'this MCP server answers POST only (Streamable HTTP, no event stream); see /llms.txt' }, 405, { Allow: 'POST' }));
  app.delete('/mcp', (c) => c.json({ error: 'bad-request', message: 'there are no sessions to end' }, 405, { Allow: 'POST' }));

  app.post('/mcp', async (c: Context) => {
    const version = c.req.header('MCP-Protocol-Version');
    if (version && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)) return c.json(rpcError(null, -32600, `unsupported MCP-Protocol-Version ${version}`), 400);
    const grant = tokenGrantOf(c);
    const may = { signedIn: Boolean(grant), write: Boolean(grant?.scopes.includes('write')) };
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'parse error: the body must be JSON-RPC 2.0'), 400);
    }
    const authorization = c.req.header('Authorization');
    const origin = new URL(c.req.url).origin;
    const call: ApiCall = async (method, path, body) => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (authorization) headers.authorization = authorization;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const request = new Request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      // A token given for the MCP server alone may make its tools' calls, and only those (tokens.ts).
      mcpInnerCalls.add(request);
      const response = await app.request(request);
      return { status: response.status, body: await response.json().catch(() => null) };
    };

    const messages = Array.isArray(payload) ? payload : [payload];
    const answers = [];
    for (const raw of messages) {
      const message = raw as JsonRpcRequest;
      if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        // A response or something else from the client needs no answer; a malformed request does.
        if (message && typeof message === 'object' && 'id' in message && !('result' in message) && !('error' in message)) answers.push(rpcError(message.id, -32600, 'invalid request'));
        continue;
      }
      if (message.id === undefined) continue; // a notification (notifications/initialized…): nothing to say back
      let result;
      try {
        result = await handle(message, call, may);
      } catch (error) {
        if (!(error instanceof NeedsSignIn)) throw error;
        // Step-up (MCP authorization, "Scope Challenge Handling"): the client connects, or asks for more, and calls again.
        const challenge = error.status === 401 ? mcpChallenge(c) : mcpChallenge(c, { code: 'insufficient_scope', description: error.message });
        return c.json(rpcError(message.id, -32001, error.message), error.status, { 'WWW-Authenticate': challenge, 'Cache-Control': 'no-store' });
      }
      answers.push(result && typeof result === 'object' && 'error' in result && 'jsonrpc' in result ? result : { jsonrpc: '2.0', id: message.id, result });
    }
    if (answers.length === 0) return c.body(null, 202);
    return c.json(Array.isArray(payload) ? answers : answers[0], 200, { 'Cache-Control': 'no-store' });
  });
}
