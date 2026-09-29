/**
 * The API reference's operations, read from the API's own OpenAPI
 * document (GET /openapi.json), with an example of each in curl and in
 * TypeScript (@rebbehub/client). Used by /developers/reference and
 * /llms-full.txt, so both say what the API says.
 */

export type Schema = Record<string, any>;

export interface ApiParam {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema: Schema;
}

export interface ApiOperation {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string | null;
  access: 'public' | 'optional' | 'read' | 'write' | 'site';
  paged: boolean;
  params: ApiParam[];
  body: { type: string; schema: Schema; required: boolean } | null;
  deprecated: boolean;
}

export interface OpenApiDocument {
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  tags?: Array<{ name: string; description?: string }>;
  components?: { schemas?: Record<string, Schema> };
  paths: Record<string, Record<string, any>>;
}

/** Every operation, in the document's order of tags, then paths. */
export function operationsOf(doc: OpenApiDocument): ApiOperation[] {
  const order = new Map((doc.tags ?? []).map((t, i) => [t.name, i]));
  const ops: ApiOperation[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const [type, media] = Object.entries((op.requestBody?.content ?? {}) as Record<string, { schema: Schema }>)[0] ?? [];
      ops.push({
        id: op.operationId,
        method: method.toUpperCase(),
        path,
        tag: op.tags?.[0] ?? 'Other',
        summary: op.summary ?? '',
        description: op.description ?? null,
        access: op['x-access'] ?? 'public',
        paged: Boolean(op['x-paged']),
        params: op.parameters ?? [],
        body: type ? { type, schema: media!.schema, required: Boolean(op.requestBody.required) } : null,
        deprecated: Boolean(op.deprecated),
      });
    }
  }
  return ops.sort((a, b) => (order.get(a.tag) ?? 99) - (order.get(b.tag) ?? 99));
}

/** What a schema's value may look like, for an example. */
export function exampleOf(schema: Schema | undefined, name = '', doc?: OpenApiDocument, depth = 0): unknown {
  if (!schema || depth > 4) return null;
  if (schema.$ref) return exampleOf(doc?.components?.schemas?.[String(schema.$ref).split('/').pop()!], name, doc, depth + 1);
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf || schema.anyOf) return exampleOf((schema.oneOf ?? schema.anyOf)[0], name, doc, depth + 1);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'string') {
    if (schema.pattern?.includes('rh-') || schema.pattern?.includes('[hH]-')) return 'rh-7k2m9q4d';
    if (schema.pattern === '^[0-9a-f]{64}$') return '<sha256>';
    if (name === 'q' || name === 'query') return 'יו"ד שבט';
    if (name === 'title') return 'Fix the date';
    if (name === 'note') return 'As printed in Sichos Kodesh';
    return `<${name || 'text'}>`;
  }
  if (type === 'integer' || type === 'number') return schema.minimum ?? 1;
  if (type === 'boolean') return true;
  if (type === 'array') return [exampleOf(schema.items, name, doc, depth + 1)];
  if (type === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of (schema.required ?? []) as string[]) out[key] = exampleOf(schema.properties?.[key], key, doc, depth + 1);
    return out;
  }
  return null;
}

/** The operation's path with example values in it, and its required query. */
export function examplePath(op: ApiOperation, doc?: OpenApiDocument): string {
  let path = op.path;
  for (const p of op.params.filter((p) => p.in === 'path')) path = path.replace(`{${p.name}}`, String(exampleOf(p.schema, p.name, doc)));
  const query = op.params.filter((p) => p.in === 'query' && p.required).map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(String(exampleOf(p.schema, p.name, doc)))}`);
  return query.length ? `${path}?${query.join('&')}` : path;
}

const needsToken = (op: ApiOperation) => op.access === 'read' || op.access === 'write';

export function curlExample(op: ApiOperation, base: string, doc?: OpenApiDocument): string {
  const parts = [`curl${op.method === 'GET' ? '' : ` -X ${op.method}`} '${base}${examplePath(op, doc)}'`];
  if (needsToken(op)) parts.push(`-H "Authorization: Bearer $REBBEHUB_TOKEN"`);
  if (op.body?.type.includes('json')) {
    parts.push(`-H 'Content-Type: application/json'`);
    parts.push(`-d '${JSON.stringify(exampleOf(op.body.schema, '', doc)).replace(/'/g, "'\\''")}'`);
  } else if (op.body) parts.push(`-H 'Content-Type: ${op.body.type === 'application/octet-stream' ? 'application/pdf' : op.body.type}' --data-binary @file`);
  return parts.join(' \\\n  ');
}

export function typescriptExample(op: ApiOperation, doc?: OpenApiDocument): string {
  const input: Record<string, unknown> = {};
  for (const p of op.params.filter((p) => p.required)) input[p.name] = exampleOf(p.schema, p.name, doc);
  if (op.body?.type.includes('json')) input.body = exampleOf(op.body.schema, '', doc);
  else if (op.body) Object.assign(input, { body: '<the file>', contentType: 'application/pdf' });
  const args = Object.keys(input).length ? JSON.stringify(input, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:').replace('"<the file>"', 'file') : '';
  const setup = `import { RebbeHub } from '@rebbehub/client';\n\nconst rh = new RebbeHub(${needsToken(op) ? '{ token: process.env.REBBEHUB_TOKEN }' : ''});\n`;
  if (op.paged) return `${setup}for await (const item of rh.all('${op.id}', ${args || '{}'})) {\n  console.log(item);\n}`;
  return `${setup}const answer = await rh.${op.id}(${args});`;
}

/** Who may call it, in words. */
export function accessLabel(op: ApiOperation): string {
  switch (op.access) {
    case 'public':
      return 'No account needed';
    case 'optional':
      return 'No account needed; signed in, a little more';
    case 'read':
      return 'A token (read scope) or the site session';
    case 'write':
      return 'A token with the write scope, or the site session';
    case 'site':
      return "The site's own pages only; not for tokens";
  }
}
