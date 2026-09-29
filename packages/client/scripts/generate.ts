/**
 * Writes packages/client/src/generated.ts from the API's OpenAPI document
 * (services/api/src/openapi.ts): a type for every schema, and for every
 * operation a people and scripts may call (not the site's own sign-in and
 * stewards' tools) its input, its answer and a typed method.
 *
 *   npm run generate -w @rebbehub/client
 *
 * A test fails when the file is not what this writes now
 * (packages/client/tests/client.test.ts), so the client never drifts from
 * the API.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OPENAPI } from '../../../services/api/src/openapi.js';

type Schema = Record<string, any>;

interface ParamObject {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema: Schema;
}

interface OperationObject {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  'x-access': string;
  'x-paged'?: boolean;
  parameters?: ParamObject[];
  requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: Schema }> }>;
  deprecated?: boolean;
}

const quote = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

/** A JSON Schema as a TypeScript type. */
export function typeOf(schema: Schema | undefined, indent = ''): string {
  if (!schema || Object.keys(schema).length === 0) return 'unknown';
  if (schema.$ref) return String(schema.$ref).split('/').pop()!;
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ');
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map((s: Schema) => typeOf(s, indent)).join(' | ');
  if (schema.allOf) return schema.allOf.map((s: Schema) => typeOf(s, indent)).join(' & ');
  if (Array.isArray(schema.type)) return schema.type.map((t: string) => typeOf({ ...schema, type: t }, indent)).join(' | ');
  switch (schema.type) {
    case 'string':
      return schema.format === 'binary' ? 'Blob | ArrayBuffer | Uint8Array | ReadableStream' : 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${typeOf(schema.items, indent)}>`;
    case 'object': {
      const props = Object.entries((schema.properties ?? {}) as Record<string, Schema>);
      const required = new Set<string>(schema.required ?? []);
      const rest = schema.additionalProperties;
      if (props.length === 0) return rest && typeof rest === 'object' ? `Record<string, ${typeOf(rest, indent)}>` : 'Record<string, unknown>';
      const inner = `${indent}  `;
      const lines = props.map(([key, value]) => `${doc(value, inner)}${inner}${quote(key)}${required.has(key) ? '' : '?'}: ${typeOf(value, inner)};`);
      if (rest === true) lines.push(`${inner}[key: string]: unknown;`);
      return `{\n${lines.join('\n')}\n${indent}}`;
    }
    default:
      return 'unknown';
  }
}

function doc(schema: Schema | { description?: string }, indent: string): string {
  const text = schema.description;
  return text ? `${indent}/** ${String(text).replace(/\*\//g, '* /').replace(/\n+/g, ' ')} */\n` : '';
}

function answerOf(op: OperationObject): { kind: 'json' | 'text' | 'raw'; type: string } {
  const [status, response] = Object.entries(op.responses).find(([code]) => /^2\d\d$/.test(code)) ?? [];
  const content = response?.content ?? {};
  const [type, media] = Object.entries(content)[0] ?? [];
  if (!status || !type) return { kind: 'raw', type: 'Response' };
  if (/json/.test(type)) return { kind: 'json', type: typeOf(media!.schema, '  ') };
  if (/^text\//.test(type) || /xml/.test(type)) return { kind: 'text', type: 'string' };
  return { kind: 'raw', type: 'Response' };
}

/** Whether a people and scripts may call it with a token (the site's own sign-in and stewards' tools are left out). */
const forClients = (op: OperationObject) => op['x-access'] !== 'site' && !Object.keys(op.responses).some((code) => code === '405');

export function generate(): string {
  const out: string[] = [];
  out.push('// Generated from the RebbeHub OpenAPI document by packages/client/scripts/generate.ts.');
  out.push('// Do not edit by hand: run `npm run generate -w @rebbehub/client`.');
  out.push('/* eslint-disable */');
  out.push('');
  out.push(`/** The API version this client was generated from. */`);
  out.push(`export const API_VERSION = ${JSON.stringify(OPENAPI.info.version)};`);
  out.push('');

  for (const [name, schema] of Object.entries(OPENAPI.components.schemas as Record<string, Schema>)) {
    out.push(`${doc(schema, '')}export type ${name} = ${typeOf(schema)};`);
    out.push('');
  }

  const ops: Array<{ op: OperationObject; method: string; path: string }> = [];
  for (const [path, methods] of Object.entries(OPENAPI.paths as Record<string, Record<string, OperationObject>>)) {
    for (const [method, op] of Object.entries(methods)) if (forClients(op)) ops.push({ op, method: method.toUpperCase(), path });
  }
  ops.sort((a, b) => a.op.operationId.localeCompare(b.op.operationId));

  out.push('/** Every operation: what it takes and what it answers. */');
  out.push('export interface Operations {');
  for (const { op } of ops) {
    const params = op.parameters ?? [];
    const fields: string[] = [];
    for (const p of params) fields.push(`${doc(p, '      ')}      ${quote(p.name)}${p.required ? '' : '?'}: ${typeOf(p.schema, '      ')};`);
    const body = op.requestBody ? Object.values(op.requestBody.content)[0]!.schema : undefined;
    if (body) fields.push(`      body${op.requestBody!.required ? '' : '?'}: ${typeOf(body, '      ')};`);
    const bodyType = op.requestBody ? Object.keys(op.requestBody.content)[0]! : '';
    if (body && !/json/.test(bodyType)) fields.push(`      /** The body's type (audio/mpeg, application/pdf…); default ${bodyType} */\n      contentType?: string;`);
    out.push(`${doc({ description: op.summary }, '  ')}  ${op.operationId}: {`);
    out.push(fields.length ? `    input: {\n${fields.join('\n')}\n    };` : '    input: Record<string, never>;');
    out.push(`    output: ${answerOf(op).type.replace(/\n/g, '\n  ')};`);
    out.push('  };');
  }
  out.push('}');
  out.push('');

  out.push('/** How each operation is called. */');
  out.push('export const OPERATIONS = {');
  for (const { op, method, path } of ops) {
    const params = op.parameters ?? [];
    const body = op.requestBody ? Object.keys(op.requestBody.content)[0]! : null;
    const answer = answerOf(op);
    let items: string | null = null;
    if (op['x-paged'] && answer.kind === 'json') {
      const schema = (Object.values(op.responses).find((r) => r.content)?.content?.['application/json']?.schema ?? {}) as Schema;
      const resolved = schema.$ref ? (OPENAPI.components.schemas as Record<string, Schema>)[String(schema.$ref).split('/').pop()!]! : schema;
      items = Object.entries((resolved.properties ?? {}) as Record<string, Schema>).find(([, s]) => s.type === 'array')?.[0] ?? null;
    }
    const meta = {
      method,
      path,
      path_: params.filter((p) => p.in === 'path').map((p) => p.name),
      query: params.filter((p) => p.in === 'query').map((p) => p.name),
      body: body === null ? null : /json/.test(body) ? 'json' : body,
      answer: answer.kind,
      ...(items ? { items } : {}),
    };
    out.push(`  ${op.operationId}: ${JSON.stringify(meta).replace('"path_"', '"pathParams"')},`);
  }
  out.push('} as const;');
  out.push('');
  out.push('export type OperationId = keyof Operations;');
  out.push('/** Operations whose answers come a page at a time. */');
  out.push(`export type PagedOperationId = ${ops.filter(({ op }) => op['x-paged']).map(({ op }) => JSON.stringify(op.operationId)).join(' | ') || 'never'};`);
  out.push('');

  out.push('/** A typed method for every operation; the calls themselves are in client.ts. */');
  out.push('export abstract class GeneratedMethods {');
  out.push('  protected abstract call<K extends OperationId>(operation: K, input: Operations[K]["input"]): Promise<Operations[K]["output"]>;');
  for (const { op, method, path } of ops) {
    const hasInput = Boolean(op.parameters?.length || op.requestBody);
    const optional = hasInput && !(op.parameters ?? []).some((p) => p.required) && !op.requestBody?.required;
    const signature = hasInput ? `input${optional ? '?' : ''}: Operations['${op.operationId}']['input']` : '';
    out.push('');
    out.push(`  /** ${op.summary.replace(/\*\//g, '* /')} (${method} ${path})${op.deprecated ? ' @deprecated' : ''} */`);
    out.push(`  ${op.operationId}(${signature}): Promise<Operations['${op.operationId}']['output']> {`);
    out.push(`    return this.call('${op.operationId}', ${hasInput ? `input ?? {}` : '{}'} as Operations['${op.operationId}']['input']);`);
    out.push('  }');
  }
  out.push('}');
  out.push('');
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = fileURLToPath(new URL('../src/generated.ts', import.meta.url));
  await writeFile(target, generate());
  console.log(`wrote ${target}`);
}
