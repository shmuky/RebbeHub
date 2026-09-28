import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { ExportGate, type Catalog, type EntityView } from '@rebbehub/core';
import type { EntityId, TextData } from '@rebbehub/model';
import { signManifest, type KeyPair, type Signature } from './signing.js';
import { toSichosKodeshRelease } from './sichosKodesh.js';

/**
 * A catalog edition's dumps (docs/plans/rebbehub.md, section 6): the whole
 * catalog as of the edition's commit, as
 *
 *   rebbehub-<tag>.sqlite         every item in one table, ready to query
 *   rebbehub-<tag>.jsonl.gz       one item per line
 *   rebbehub-<tag>.parquet        the same table, for data tools (DuckDB,
 *                                 pandas, Spark): id, type, path, rev and
 *                                 the item's data as JSON
 *   sichos-kodesh-<tag>.json      the works release Sichos-Kodesh builds from
 *   manifest.json                 names, sizes and sha256 of the above, signed
 *
 * with the same rights gate as the git mirror: words whose source does
 * not allow copies are left out and listed as withheld.
 */

export interface DumpFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface DumpManifest {
  format: 'rebbehub-dump';
  formatVersion: 1;
  tag: string;
  commit: number;
  createdAt: string;
  counts: Record<string, number>;
  withheld: number;
  files: DumpFile[];
  licences: { facts: string; community: string; sources: string };
  signature?: Signature;
}

async function describeFile(dir: string, name: string): Promise<DumpFile> {
  const bytes = await readFile(join(dir, name));
  return { name, bytes: (await stat(join(dir, name))).size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Every exportable item as of `at`, with words the gate withholds taken out. */
async function* exportable(catalog: Catalog, at: number, gate: ExportGate, withheld: Array<{ id: EntityId; reason: string }>): AsyncGenerator<EntityView> {
  let after: EntityId | undefined;
  for (;;) {
    const page = await catalog.snapshot(at, { after, limit: 1000 });
    if (page.length === 0) return;
    for (const view of page) {
      if (view.type === 'segment') {
        const reason = await gate.textWithheld((view.data as { text: EntityId }).text);
        if (reason) {
          withheld.push({ id: view.id, reason });
          continue;
        }
      } else if (view.type === 'text') {
        await gate.textWithheld(view.id, view.data as unknown as TextData);
      } else if (view.type === 'text-page') {
        const reason = await gate.layerWithheld((view.data as { layer: EntityId }).layer);
        if (reason) {
          withheld.push({ id: view.id, reason });
          yield { ...view, data: { ...(view.data as object), lines: [] } };
          continue;
        }
      }
      yield view;
    }
    after = page[page.length - 1]!.id;
  }
}

export async function writeDump(catalog: Catalog, outDir: string, options: { tag: string; at: number; key?: KeyPair; now?: Date }): Promise<DumpManifest> {
  await mkdir(outDir, { recursive: true });
  const gate = new ExportGate(catalog, options.at);
  const withheld: Array<{ id: EntityId; reason: string }> = [];
  const counts: Record<string, number> = {};
  const jsonlName = `rebbehub-${options.tag}.jsonl.gz`;
  const sqliteName = `rebbehub-${options.tag}.sqlite`;
  const sichosName = `sichos-kodesh-${options.tag}.json`;
  const parquetName = `rebbehub-${options.tag}.parquet`;

  // node:sqlite is loaded only here, so nothing else in the package needs it.
  const { DatabaseSync } = await import('node:sqlite');
  await rm(join(outDir, sqliteName), { force: true });
  const sqlite = new DatabaseSync(join(outDir, sqliteName));
  sqlite.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entity (id TEXT PRIMARY KEY, type TEXT NOT NULL, path TEXT, rev INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE withheld (id TEXT PRIMARY KEY, reason TEXT NOT NULL);
    BEGIN;
  `);
  const insert = sqlite.prepare('INSERT INTO entity (id, type, path, rev, data) VALUES (?, ?, ?, ?, ?)');
  const forSichos: EntityView[] = [];
  const parquet = await parquetTable(join(outDir, parquetName), { tag: options.tag, commit: options.at });

  const lines = async function* () {
    for await (const view of exportable(catalog, options.at, gate, withheld)) {
      counts[view.type] = (counts[view.type] ?? 0) + 1;
      const data = JSON.stringify(view.data);
      insert.run(view.id, view.type, view.path, view.rev, data);
      await parquet.add(view.id, view.type, view.path, view.rev, data);
      if (view.type === 'author' || view.type === 'work' || view.type === 'unit' || view.type === 'event') forSichos.push(view);
      yield `${JSON.stringify({ id: view.id, type: view.type, path: view.path, rev: view.rev, data: view.data })}\n`;
    }
  };
  await pipeline(Readable.from(lines()), createGzip(), createWriteStream(join(outDir, jsonlName)));
  await parquet.finish();

  const insertWithheld = sqlite.prepare('INSERT OR REPLACE INTO withheld (id, reason) VALUES (?, ?)');
  for (const w of withheld) insertWithheld.run(w.id, w.reason);
  const createdAt = (options.now ?? new Date()).toISOString();
  const insertMeta = sqlite.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries({ format: 'rebbehub-dump', formatVersion: '1', tag: options.tag, commit: String(options.at), createdAt })) insertMeta.run(k, v);
  sqlite.exec('COMMIT; CREATE INDEX entity_type ON entity (type); CREATE INDEX entity_path ON entity (path);');
  sqlite.close();

  await writeFile(join(outDir, sichosName), `${JSON.stringify(toSichosKodeshRelease(forSichos, { tag: options.tag, commit: options.at }))}\n`);

  let manifest: DumpManifest = {
    format: 'rebbehub-dump',
    formatVersion: 1,
    tag: options.tag,
    commit: options.at,
    createdAt,
    counts,
    withheld: withheld.length,
    files: [await describeFile(outDir, sqliteName), await describeFile(outDir, jsonlName), await describeFile(outDir, parquetName), await describeFile(outDir, sichosName)],
    licences: { facts: 'CC0-1.0', community: 'CC-BY-SA-4.0', sources: 'each text keeps the licence in its `licence` field' },
  };
  if (options.key) manifest = signManifest(manifest, options.key);
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * The Parquet file, written a row group at a time as items stream past,
 * so a catalog of millions of items never has to be held at once. `data`
 * is JSON (Parquet's JSON logical type), as in the SQLite file.
 */
async function parquetTable(path: string, meta: { tag: string; commit: number }) {
  // Loaded only here, as node:sqlite is.
  const { ParquetWriter, fileWriter, schemaFromColumnData } = await import('hyparquet-writer');
  const ROWS = 10_000;
  const columns = () => ({ id: [] as string[], type: [] as string[], path: [] as Array<string | null>, rev: [] as bigint[], data: [] as string[] });
  let batch = columns();
  const columnData = (b: ReturnType<typeof columns>) => [
    { name: 'id', data: b.id, type: 'STRING' as const, nullable: false },
    { name: 'type', data: b.type, type: 'STRING' as const, nullable: false },
    { name: 'path', data: b.path, type: 'STRING' as const, nullable: true },
    { name: 'rev', data: b.rev, type: 'INT64' as const, nullable: false },
    { name: 'data', data: b.data, type: 'JSON' as const, nullable: false },
  ];
  const writer = new ParquetWriter({
    writer: fileWriter(path),
    schema: schemaFromColumnData({ columnData: columnData(columns()) }),
    kvMetadata: [
      { key: 'format', value: 'rebbehub-dump' },
      { key: 'tag', value: meta.tag },
      { key: 'commit', value: String(meta.commit) },
    ],
  });
  const flush = async () => {
    if (batch.id.length === 0) return;
    await writer.write({ columnData: columnData(batch), rowGroupSize: ROWS });
    batch = columns();
  };
  return {
    async add(id: string, type: string, path: string | null, rev: number, data: string) {
      batch.id.push(id);
      batch.type.push(type);
      batch.path.push(path);
      batch.rev.push(BigInt(rev));
      batch.data.push(data);
      if (batch.id.length >= ROWS) await flush();
    },
    async finish() {
      await flush();
      await writer.finish();
    },
  };
}
