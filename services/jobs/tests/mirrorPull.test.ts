import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, writeDump } from '@rebbehub/mirror';
import { createApp, type FileStore } from '../../api/src/app.js';
import { pullMirror } from '../src/mirrorPull.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/** The public bucket as a folder: dumps/<tag>/<name> are the files `rebbehub dump --upload` puts there. */
function folderStore(dir: string): FileStore {
  return {
    async get(key) {
      const [prefix, tag, name] = key.split('/');
      if (prefix !== 'dumps' || !tag || !name || !existsSync(join(dir, name))) return null;
      const bytes = await readFile(join(dir, name));
      return { body: new Response(bytes).body!, size: bytes.length };
    },
  };
}

describe('mirrors', () => {
  it('list every edition with its dumps, and a mirror pulls them, checking signature and sha256', async () => {
    const { catalog, set } = await freshCatalog();
    await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const { tag, commit } = await catalog.tagEdition('shmuly', { tag: '2026.40' });
    const key = generateKeyPair(new Uint8Array(32).fill(7));
    const dumps = await mkdtemp(join(tmpdir(), 'rh-dumps-'));
    const manifest = await writeDump(catalog, dumps, { tag, at: commit, key });
    await catalog.setEditionManifest(tag, manifest);

    const app = createApp({ catalog, files: folderStore(dumps), mirrors: { gitUrls: ['https://github.com/rebbehub/catalog.git'], publicKeys: [key.publicKey] } });
    const fetcher = ((input: string | URL | Request) => app.request(String(input))) as typeof fetch;

    const index = (await (await app.request('https://api.test/v1/mirrors')).json()) as any;
    expect(index.git).toEqual(['https://github.com/rebbehub/catalog.git']);
    expect(index.keys).toEqual([{ alg: 'ed25519', keyId: key.keyId, publicKey: key.publicKey }]);
    expect(index.editions[0].dumps.signature).toEqual({ alg: 'ed25519', keyId: key.keyId });
    expect(index.editions[0].dumps.files.map((f: { url: string }) => f.url)).toContain(`https://api.test/dumps/2026.40/rebbehub-2026.40.sqlite`);
    const sums = await (await app.request('https://api.test/v1/editions/2026.40/SHA256SUMS')).text();
    expect(sums).toContain(`${manifest.files[0]!.sha256}  ${manifest.files[0]!.name}\n`);
    expect((await app.request('https://api.test/dumps/2026.40/not-listed.txt')).status).toBe(404);

    // A mirror that pinned the key pulls everything, and has nothing to do the second time.
    const out = await mkdtemp(join(tmpdir(), 'rh-mirror-'));
    expect(await pullMirror({ api: 'https://api.test', out, keys: [key.publicKey], fetch: fetcher })).toEqual({ pulled: ['2026.40'], kept: [], failed: [] });
    expect(await readFile(join(out, '2026.40', 'SHA256SUMS'), 'utf8')).toBe(sums);
    expect(JSON.parse(await readFile(join(out, 'editions.json'), 'utf8')).editions[0]).toMatchObject({ tag: '2026.40', signature: { keyId: key.keyId } });
    expect(await pullMirror({ api: 'https://api.test', out, keys: [key.publicKey], fetch: fetcher })).toEqual({ pulled: [], kept: ['2026.40'], failed: [] });

    // Another key, or bytes changed on the way, and nothing is kept.
    const other = generateKeyPair(new Uint8Array(32).fill(9));
    const elsewhere = await mkdtemp(join(tmpdir(), 'rh-mirror-'));
    expect((await pullMirror({ api: 'https://api.test', out: elsewhere, keys: [other.publicKey], fetch: fetcher })).failed).toEqual([{ tag: '2026.40', reason: "its manifest's signature: unknown-key" }]);
    await writeFile(join(dumps, manifest.files[0]!.name), 'not the dump');
    const third = await mkdtemp(join(tmpdir(), 'rh-mirror-'));
    const tampered = await pullMirror({ api: 'https://api.test', out: third, keys: [key.publicKey], fetch: fetcher });
    expect(tampered.failed[0]!.reason).toMatch(/sha256 .* is not the manifest's/);
    expect(existsSync(join(third, '2026.40', manifest.files[0]!.name))).toBe(false);
  });
});
