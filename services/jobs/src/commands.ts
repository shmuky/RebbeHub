import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Catalog } from '@rebbehub/core';
import { connectPostgres, one, type Db } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';
import { readSichosKodeshOccasions, readSichosKodeshWorks, runImport, sichosKodeshOccasionsImporter, sichosKodeshWorksImporter, type Importer } from '@rebbehub/importers';
import { clearMirror, directorySink, exportCommits, exportSnapshot, generateKeyPair, writeDump, type KeyPair } from '@rebbehub/mirror';
import { BUILTIN_SCHEMAS, SchemaRegistry } from '@rebbehub/model';
import { commitAll, git } from './git.js';

export interface Context {
  log: (line: string) => void;
  /** DATABASE_URL, or a PGlite folder. */
  database?: string;
}

export async function openDatabase(database?: string): Promise<Db> {
  // On a build server (CI is set there), a missing DATABASE_URL is a mistake, never a cue to use a local database.
  if (!database && !process.env.DATABASE_URL && process.env.CI) throw new Error('DATABASE_URL is not set: add it to this build as a secret (docs/deploy.md)');
  const target = database ?? process.env.DATABASE_URL ?? '.data/pglite';
  return /^postgres(ql)?:\/\//.test(target) ? connectPostgres(target) : openPGlite(target);
}

async function withCatalog<T>(ctx: Context, fn: (catalog: Catalog) => Promise<T>): Promise<T> {
  const db = await openDatabase(ctx.database);
  try {
    const catalog = new Catalog(db);
    await catalog.init();
    return await fn(catalog);
  } finally {
    await db.close();
  }
}

/**
 * The branch whose builds may change the production database. Cloudflare's
 * builds also build every other branch as a preview, and a preview must
 * never migrate the database for code that has not been merged.
 */
export const PRODUCTION_BRANCH = 'main';

/** Why this build must not migrate, or null when it may. */
export function migrationSkipReason(env: Record<string, string | undefined> = process.env): string | null {
  const branch = env.WORKERS_CI_BRANCH;
  if (env.WORKERS_CI && branch && branch !== PRODUCTION_BRANCH) return `a preview build of branch ${branch}; only builds of ${PRODUCTION_BRANCH} migrate the database`;
  return null;
}

/** Creates or updates the schema and seeds the built-in schemas. */
export async function migrateCommand(ctx: Context): Promise<void> {
  const skip = migrationSkipReason();
  if (skip) {
    ctx.log(`not migrating: ${skip}`);
    return;
  }
  await withCatalog(ctx, async (catalog) => ctx.log(`database ready; main is at commit ${await catalog.head()}`));
}

/**
 * What people have made in the catalog: a suggestion from anyone but an
 * importer bot (merged, open or draft), a report, a comment, a follow, a
 * file. SQL, so the import can check it again inside the transaction that
 * replaces the catalog.
 */
export const PEOPLE_MADE_SQL = `SELECT EXISTS (SELECT 1 FROM changeset c JOIN account a ON a.id = c.author WHERE c.author <> 'system' AND NOT a.is_bot)
  OR EXISTS (SELECT 1 FROM report) OR EXISTS (SELECT 1 FROM comment) OR EXISTS (SELECT 1 FROM follow) OR EXISTS (SELECT 1 FROM file)
  OR EXISTS (SELECT 1 FROM project)`;

/**
 * Whether everything in the catalog came from importers, so it can be
 * rebuilt from its sources next to the code and copied in whole
 * (scripts/import-catalog.sh), instead of updated item by item across the
 * internet, which takes hours. Once people have added anything, it never is.
 */
export async function catalogIsRebuildable(db: Db): Promise<boolean> {
  const row = await one<{ people: boolean }>(db, `${PEOPLE_MADE_SQL} AS people`);
  return !row!.people;
}

/**
 * SQL that stops a transaction unless the catalog is still rebuildable,
 * locking out new suggestions, reports and comments until it ends. The
 * whole-catalog copy runs it first, so it can never replace anything
 * people have made.
 */
export const REBUILD_GUARD_SQL = `LOCK TABLE changeset, report, comment, follow, file, project IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF (${PEOPLE_MADE_SQL}) THEN RAISE EXCEPTION 'people have added to the catalog; not replacing it'; END IF; END $$;`;

/** Prints `rebuildable` or `not-rebuildable`, for scripts; with `guard`, prints REBUILD_GUARD_SQL instead. */
export async function rebuildableCommand(ctx: Context, input: { guard?: boolean } = {}): Promise<void> {
  if (input.guard) return ctx.log(REBUILD_GUARD_SQL);
  await withCatalog(ctx, async (catalog) => ctx.log((await catalogIsRebuildable(catalog.db)) ? 'rebuildable' : 'not-rebuildable'));
}

/** Checks that every built-in schema can be used. */
export async function schemaCheckCommand(ctx: Context): Promise<void> {
  const registry = SchemaRegistry.builtin();
  for (const type of Object.keys(BUILTIN_SCHEMAS)) registry.validate(type, {});
  ctx.log(`${registry.types().length} entity types, every schema usable`);
}

export async function accountCommand(ctx: Context, input: { id: string; name: string; steward?: boolean; bot?: boolean }): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    await catalog.createAccount({ id: input.id, displayName: input.name, isBot: input.bot });
    if (input.steward) await catalog.db.query('UPDATE account SET is_steward = TRUE WHERE id = $1', [input.id]);
    ctx.log(`account ${input.id}${input.steward ? ' (steward)' : ''} ready`);
  });
}

/** The importers `rebbehub import` runs, each reading a Sichos-Kodesh checkout. */
export const IMPORTERS: Record<string, (from: string) => Importer> = {
  'sichos-kodesh-works': (from) => sichosKodeshWorksImporter(() => readSichosKodeshWorks(from)),
  'sichos-kodesh-occasions': (from) => sichosKodeshOccasionsImporter(() => readSichosKodeshOccasions(from)),
};

export async function importCommand(ctx: Context, input: { source: string; from: string; approveAs?: string; dryRun?: boolean; chunkSize?: number }): Promise<void> {
  const make = IMPORTERS[input.source];
  if (!make) throw new Error(`unknown importer "${input.source}" (known: ${Object.keys(IMPORTERS).join(', ')})`);
  await withCatalog(ctx, async (catalog) => {
    const importer = make(input.from);
    const result = await runImport(catalog, importer, { approveAs: input.approveAs, dryRun: input.dryRun, chunkSize: input.chunkSize, log: ctx.log });
    ctx.log(`${input.dryRun ? 'would create' : 'created'} ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}; kept ${result.keptHumanEdits} human edits; suggestions: ${result.changesets.join(', ') || 'none'}`);
  });
}

/**
 * Brings a git mirror up to date: the commits since the one in its COMMIT
 * file, one git commit each; `full` rewrites it from scratch at the head.
 */
export async function mirrorCommand(ctx: Context, input: { dir: string; full?: boolean; git?: boolean; limit?: number }): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    await mkdir(input.dir, { recursive: true });
    if (input.git && !existsSync(join(input.dir, '.git'))) await git(input.dir, ['init', '-q', '-b', 'main']);
    const sink = directorySink(input.dir);
    const commitFile = join(input.dir, 'COMMIT');
    const since = !input.full && existsSync(commitFile) ? Number((await readFile(commitFile, 'utf8')).trim()) : null;
    if (since === null) {
      await clearMirror(input.dir);
      const head = await catalog.head();
      const stats = await exportSnapshot(catalog, sink, head);
      if (input.git) await commitAll(input.dir, { message: `Catalog as of commit ${head}`, author: 'rebbehub', mergedBy: 'rebbehub', at: new Date().toISOString(), seq: head });
      ctx.log(`wrote the catalog at commit ${head}: ${stats.entities} items, ${stats.texts} texts, ${stats.alignments} alignments, ${stats.withheld} withheld`);
      return;
    }
    let count = 0;
    const last = await exportCommits(
      catalog,
      sink,
      since,
      async (commit) => {
        count++;
        if (input.git) await commitAll(input.dir, commit);
      },
      input.limit,
    );
    ctx.log(count === 0 ? `up to date at commit ${since}` : `exported ${count} commits, now at ${last}`);
  });
}

export async function editionCommand(ctx: Context, input: { by: string; tag?: string; notes?: string }): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    const edition = await catalog.tagEdition(input.by, { tag: input.tag, notes: input.notes });
    ctx.log(`catalog edition ${edition.tag} at commit ${edition.commit}`);
  });
}

export async function dumpCommand(ctx: Context, input: { tag: string; out: string; keyFile?: string }): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    const edition = (await catalog.editions()).find((e) => e.tag === input.tag);
    if (!edition) throw new Error(`no catalog edition ${input.tag}; tag one first`);
    const key = input.keyFile ? (JSON.parse(await readFile(input.keyFile, 'utf8')) as KeyPair) : undefined;
    const manifest = await writeDump(catalog, input.out, { tag: input.tag, at: edition.commit_seq, key });
    await catalog.setEditionManifest(input.tag, manifest);
    ctx.log(`dumps of ${input.tag} in ${input.out}${key ? `, signed with key ${key.keyId}` : ' (unsigned: give --key to sign)'}`);
  });
}

export async function keygenCommand(ctx: Context, input: { out: string }): Promise<void> {
  if (existsSync(input.out)) throw new Error(`${input.out} exists; refusing to overwrite a key`);
  const key = generateKeyPair();
  await writeFile(input.out, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  ctx.log(`key ${key.keyId} written to ${input.out} (keep it secret). Public key: ${key.publicKey}`);
}
