import { describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { authFor } from '../src/auth.js';
import { API_TAGS, OPENAPI, OPERATIONS } from '../src/openapi.js';

/**
 * The OpenAPI description and the routes are kept in step: a route nobody
 * documented, or a documented route that is gone, fails here. The app is
 * made with every optional part switched on, so every route is there.
 */

const store = { get: async () => null };
const writer = { put: async () => {} };
const app = createApp({
  catalog: {} as Catalog,
  auth: authFor('https://rebbehub.org', { clientId: 'client', clientSecret: 'secret' }),
  oai: { adminEmail: 'admins@example.test' },
  uploads: { public: writer, preservation: writer },
  files: store,
  texts: { store, writer },
  mirrors: { gitUrls: [], publicKeys: [] },
});

/** Hono's `/v1/entities/:id` and `/x/:file{rh-[0-9a-z]+\.json}` as OpenAPI's `/v1/entities/{id}` and `/x/{file}`. */
const openApiPath = (path: string) => path.replace(/:(\w+)(\{(?:[^{}]|\{[^{}]*\})*\})?/g, '{$1}');

const routes = [...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method.toLowerCase()} ${openApiPath(r.path)}`))].sort();
const documented = Object.entries(OPENAPI.paths)
  .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method} ${path}`))
  .sort();

describe('the OpenAPI description', () => {
  it('documents every route', () => {
    expect(routes.filter((r) => !documented.includes(r))).toEqual([]);
  });

  it('documents no route that is not there', () => {
    expect(documented.filter((d) => !routes.includes(d))).toEqual([]);
  });

  it('is well formed: unique operation ids, known tags, every path parameter declared, every reference resolved', () => {
    const ids = OPERATIONS.map((o) => o.operationId);
    expect(ids.length).toBe(new Set(ids).size);
    const tags = new Set(API_TAGS.map((t) => t.name));
    for (const [path, methods] of Object.entries(OPENAPI.paths)) {
      const inTemplate = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const [method, op] of Object.entries(methods as Record<string, { tags: string[]; parameters?: Array<{ name: string; in: string; required?: boolean }>; responses: Record<string, unknown> }>)) {
        const where = `${method} ${path}`;
        expect(op.tags.every((t) => tags.has(t)), where).toBe(true);
        const declared = (op.parameters ?? []).filter((p) => p.in === 'path');
        expect(declared.map((p) => p.name).sort(), where).toEqual(inTemplate);
        expect(declared.every((p) => p.required), where).toBe(true);
        expect(op.responses.default, where).toBeDefined();
      }
    }
    const text = JSON.stringify(OPENAPI);
    for (const [, kind, name] of text.matchAll(/"#\/components\/(schemas|responses)\/([\w]+)"/g)) {
      expect((OPENAPI.components as Record<string, Record<string, unknown>>)[kind!]![name!], `${kind}/${name}`).toBeDefined();
    }
  });

  it('is served, and says who may call what', async () => {
    const response = await app.request('/openapi.json');
    const spec = (await response.json()) as any;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/v1/suggestions/quick'].post.security).toEqual([{ token: ['write'] }, { session: [] }]);
    expect(spec.paths['/v1/tokens'].post.security).toEqual([{ session: [] }]);
    expect('security' in spec.paths['/v1/search'].get).toBe(false);
    expect(spec.paths['/v1/entities'].get.parameters.map((p: { name: string }) => p.name)).toContain('cursor');
  });
});
