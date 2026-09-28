import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { keyIdFor, verifyManifest, type DumpManifest, type TrustedKeys } from '@rebbehub/mirror';

/**
 * Keeping a mirror of RebbeHub (docs/mirrors.md): pulls every catalog
 * edition's dumps from an API's /v1/mirrors into a folder that any web
 * server can serve as it is,
 *
 *   <out>/editions.json                  what is here, newest first
 *   <out>/<tag>/manifest.json            the edition's signed manifest
 *   <out>/<tag>/SHA256SUMS               for `sha256sum -c`
 *   <out>/<tag>/<dump files>
 *
 * and checks each one on the way: the manifest's signature against the
 * keys the mirror pinned, then every file's sha256 against the manifest.
 * A file that does not match is never kept. An edition already here and
 * whole is left alone, so it runs from cron as often as one likes.
 */

export interface MirrorEdition {
  tag: string;
  commit_seq: number;
  created_at: string;
  dumps: { files: Array<{ name: string; bytes: number; sha256: string; url: string }>; manifest: string } | null;
}

export interface MirrorIndex {
  git: string[];
  keys: Array<{ alg: string; keyId: string; publicKey: string }>;
  editions: MirrorEdition[];
}

export interface PullOptions {
  /** The API, e.g. https://api.rebbehub.org */
  api: string;
  out: string;
  /** Pinned release keys (base64 Ed25519 public keys). Without any, the keys the API names are trusted, and it says so. */
  keys?: string[];
  /** Only this edition, or only the newest (`latest`). Unset, all of them. */
  tag?: string;
  /** Keep editions whose manifest is not signed (never by default). */
  allowUnsigned?: boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface PullResult {
  pulled: string[];
  kept: string[];
  failed: Array<{ tag: string; reason: string }>;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Downloads to a temporary name, hashing as it goes; renamed into place only when the hash is right. */
async function download(fetcher: typeof fetch, url: string, path: string, sha256: string): Promise<void> {
  const response = await fetcher(url);
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const hash = createHash('sha256');
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const partial = `${path}.partial`;
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), tap, createWriteStream(partial));
  const got = hash.digest('hex');
  if (got !== sha256) {
    await rm(partial, { force: true });
    throw new Error(`${url}: sha256 ${got} is not the manifest's ${sha256}`);
  }
  await rename(partial, path);
}

export async function pullMirror(options: PullOptions): Promise<PullResult> {
  const fetcher = options.fetch ?? fetch;
  const log = options.log ?? (() => undefined);
  const api = options.api.replace(/\/$/, '');
  const indexResponse = await fetcher(`${api}/v1/mirrors`);
  if (!indexResponse.ok) throw new Error(`${api}/v1/mirrors answered ${indexResponse.status}`);
  const index = (await indexResponse.json()) as MirrorIndex;

  const trusted: TrustedKeys = {};
  for (const key of options.keys ?? []) trusted[keyIdFor(key)] = key;
  if (!options.keys?.length) {
    for (const key of index.keys) trusted[key.keyId] = key.publicKey;
    log(`no key pinned: trusting the keys ${api} names (${index.keys.map((k) => k.keyId).join(', ') || 'none'}); pin one with --key`);
  }

  let editions = index.editions.filter((e) => e.dumps);
  if (options.tag === 'latest') editions = editions.slice(0, 1);
  else if (options.tag) editions = editions.filter((e) => e.tag === options.tag);

  await mkdir(options.out, { recursive: true });
  const result: PullResult = { pulled: [], kept: [], failed: [] };
  for (const edition of editions) {
    const dir = join(options.out, edition.tag);
    try {
      if (!/^[\w.-]+$/.test(edition.tag)) throw new Error('an edition tag of letters, digits, . and -');
      const manifestResponse = await fetcher(edition.dumps!.manifest);
      if (!manifestResponse.ok) throw new Error(`its manifest answered ${manifestResponse.status}`);
      const manifest = (await manifestResponse.json()) as DumpManifest;
      if (manifest.tag !== edition.tag) throw new Error(`its manifest is for ${manifest.tag}`);
      const verdict = verifyManifest(manifest, trusted);
      if (!verdict.ok && !(verdict.reason === 'unsigned' && options.allowUnsigned)) throw new Error(`its manifest's signature: ${verdict.reason}`);

      await mkdir(dir, { recursive: true });
      let fetched = 0;
      for (const file of manifest.files) {
        if (!/^[\w.-]+$/.test(file.name)) throw new Error(`a file name ${file.name}`);
        const path = join(dir, file.name);
        if (existsSync(path) && (await sha256OfFile(path)) === file.sha256) continue;
        const listed = edition.dumps!.files.find((f) => f.name === file.name);
        if (!listed) throw new Error(`${file.name} is in the manifest but has no address`);
        await download(fetcher, listed.url, path, file.sha256);
        fetched++;
      }
      await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(join(dir, 'SHA256SUMS'), manifest.files.map((f) => `${f.sha256}  ${f.name}\n`).join(''));
      (fetched ? result.pulled : result.kept).push(edition.tag);
      log(`${edition.tag}: ${fetched ? `pulled ${fetched} files` : 'already here'}, ${verdict.ok ? `signed by ${verdict.keyId}` : 'unsigned'}, every sha256 checked`);
    } catch (error) {
      result.failed.push({ tag: edition.tag, reason: (error as Error).message });
      log(`${edition.tag}: not kept - ${(error as Error).message}`);
    }
  }

  // What this mirror holds, for its own visitors and for other mirrors.
  const here = [];
  for (const edition of index.editions) {
    const manifestPath = join(options.out, edition.tag, 'manifest.json');
    if (!/^[\w.-]+$/.test(edition.tag) || !existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DumpManifest;
    here.push({ tag: manifest.tag, commit: manifest.commit, createdAt: manifest.createdAt, files: manifest.files, signature: manifest.signature ? { keyId: manifest.signature.keyId } : null });
  }
  await writeFile(join(options.out, 'editions.json'), `${JSON.stringify({ from: api, git: index.git, editions: here }, null, 2)}\n`);
  return result;
}
