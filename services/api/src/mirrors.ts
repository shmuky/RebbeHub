import type { Context, Hono } from 'hono';
import { CatalogError, type Catalog } from '@rebbehub/core';
import type { FileStore } from './app.js';

/**
 * Mirrors (the plan, section 12, phase 6; docs/mirrors.md): everything
 * anyone needs to keep a full copy of RebbeHub's catalog, at addresses
 * that do not change.
 *
 *   GET /v1/mirrors                          the git mirror, the release keys, every edition's dumps
 *   GET /v1/editions                         every catalog edition, each dump with its size, sha256 and address
 *   GET /v1/editions/<tag>/manifest.json     an edition's signed manifest, exactly as signed
 *   GET /v1/editions/<tag>/SHA256SUMS        the same checksums for `sha256sum -c`
 *   GET /dumps/<tag>/<name>                  a dump's bytes, kept in the public bucket at dumps/<tag>/<name>
 *
 * A mirror checks the manifest's Ed25519 signature against a key it
 * pinned (never only the key this API names), then every file's sha256
 * against the manifest; `rebbehub mirror-pull` does both.
 */

export interface MirrorOptions {
  /** Where the git mirror (the catalog as files, one commit per merge) can be cloned from. */
  gitUrls?: string[];
  /** Where dumps are served, as `<base>/<tag>/<name>`; unset, this API's own `/dumps`. */
  dumpsBaseUrl?: string;
  /** The release keys editions are signed with (Ed25519, base64 public keys). Public halves only. */
  publicKeys?: string[];
  /** Other places that keep a full copy, as their keepers ask to be listed. */
  others?: Array<{ name: string; url: string }>;
}

interface ManifestFile {
  name: string;
  bytes: number;
  sha256: string;
}

interface Manifest {
  tag: string;
  commit: number;
  createdAt: string;
  files: ManifestFile[];
  signature?: { alg: string; keyId: string; sig: string };
}

/** The key id pack-format and packages/mirror use: the first 16 hex characters of SHA-512 of the public key. */
export async function keyIdOf(publicKeyBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(publicKeyBase64), (ch) => ch.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const manifestOf = (value: unknown): Manifest | null => {
  const m = (typeof value === 'string' ? JSON.parse(value) : value) as Manifest | null;
  return m && Array.isArray(m.files) ? m : null;
};

export function mirrorRoutes(app: Hono, catalog: Catalog, options: { mirrors?: MirrorOptions; files?: FileStore }): void {
  const mirrors = options.mirrors ?? {};
  const dumpsBase = (c: Context) => (mirrors.dumpsBaseUrl ?? `${new URL(c.req.url).origin}/dumps`).replace(/\/$/, '');

  const editions = async (c: Context) =>
    (await catalog.editions()).map((e) => {
      const manifest = manifestOf(e.manifest);
      const base = `${dumpsBase(c)}/${encodeURIComponent(e.tag)}`;
      return {
        tag: e.tag,
        commit_seq: Number(e.commit_seq),
        created_at: new Date(e.created_at).toISOString(),
        notes: e.notes,
        manifest: e.manifest ?? null,
        // An edition is tagged before its dumps are made; until then it has none.
        dumps: manifest
          ? {
              files: manifest.files.map((f) => ({ ...f, url: `${base}/${encodeURIComponent(f.name)}` })),
              manifest: `${new URL(c.req.url).origin}/v1/editions/${encodeURIComponent(e.tag)}/manifest.json`,
              sha256sums: `${new URL(c.req.url).origin}/v1/editions/${encodeURIComponent(e.tag)}/SHA256SUMS`,
              signature: manifest.signature ? { alg: manifest.signature.alg, keyId: manifest.signature.keyId } : null,
            }
          : null,
      };
    });

  const editionManifest = async (tag: string): Promise<Manifest> => {
    const edition = (await catalog.editions()).find((e) => e.tag === tag);
    const manifest = edition ? manifestOf(edition.manifest) : null;
    if (!manifest) throw new CatalogError('not-found', `no dumps of edition ${tag}`);
    return manifest;
  };

  app.get('/v1/editions', async (c) => c.json({ editions: await editions(c) }, 200, { 'Cache-Control': 'public, max-age=300' }));

  app.get('/v1/editions/:tag/manifest.json', async (c) => c.json(await editionManifest(c.req.param('tag')), 200, { 'Cache-Control': 'public, max-age=300' }));

  app.get('/v1/editions/:tag/SHA256SUMS', async (c) => {
    const manifest = await editionManifest(c.req.param('tag'));
    return c.body(manifest.files.map((f) => `${f.sha256}  ${f.name}\n`).join(''), 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  });

  app.get('/v1/mirrors', async (c) =>
    c.json(
      {
        git: mirrors.gitUrls ?? [],
        dumps: dumpsBase(c),
        keys: await Promise.all((mirrors.publicKeys ?? []).map(async (publicKey) => ({ alg: 'ed25519', keyId: await keyIdOf(publicKey), publicKey }))),
        others: mirrors.others ?? [],
        editions: await editions(c),
        licences: { facts: 'CC0-1.0', community: 'CC-BY-SA-4.0', sources: 'each text keeps the licence in its `licence` field' },
        docs: 'https://github.com/shmuky/RebbeHub/blob/main/docs/mirrors.md',
      },
      200,
      { 'Cache-Control': 'public, max-age=300' },
    ),
  );

  // A dump's bytes: only the files an edition's manifest names, so nothing else in the bucket is reachable here.
  app.get('/dumps/:tag/:name', async (c) => {
    const tag = c.req.param('tag');
    const name = c.req.param('name');
    if (!options.files || !/^[\w.-]+$/.test(tag)) throw new CatalogError('not-found', 'no such dump');
    const manifest = await editionManifest(tag);
    const file = manifest.files.find((f) => f.name === name);
    if (!file) throw new CatalogError('not-found', 'no such dump');
    const object = await options.files.get(`dumps/${tag}/${name}`);
    if (!object) throw new CatalogError('not-found', 'this dump is listed but not uploaded yet');
    const mime = name.endsWith('.gz') ? 'application/gzip' : name.endsWith('.json') ? 'application/json' : name.endsWith('.sqlite') ? 'application/vnd.sqlite3' : 'application/octet-stream';
    return c.body(object.body, 200, {
      'Content-Type': mime,
      'Content-Length': String(file.bytes),
      'Content-Disposition': `attachment; filename="${name}"`,
      // An edition's dumps never change once made.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${file.sha256}"`,
    });
  });
}
