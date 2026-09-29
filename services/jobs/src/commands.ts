import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Catalog, convertLegacyBodies } from '@rebbehub/core';
import { connectPostgres, one, type Db } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';
import {
  OTZROS_FOLDER,
  archiveImporter,
  archiveTarget,
  chabadLibraryImporter,
  crawlChabadLibrary,
  crawlSefaria,
  driveLibraryImporter,
  hebrewBooksImporter,
  idForKey,
  igrosImporter,
  jemImporter,
  libraryWorks,
  listDriveFolder,
  mayKeepText,
  readArchiveIndex,
  readChabadLibrary,
  readHebrewBooks,
  readIgrosBuild,
  readJemIndex,
  readMafteiachCrawl,
  readSefariaCrawl,
  readSichosKodeshOccasions,
  readSichosKodeshWorks,
  rebbehubSetsImporter,
  runImport,
  sefariaClient,
  sefariaImporter,
  sichosKodeshOccasionsImporter,
  sichosKodeshSefariaTitles,
  sichosKodeshWorksImporter,
  type DriveFolder,
  type Importer,
  type LibraryTree,
  type SefariaCrawl,
} from '@rebbehub/importers';
import { clearMirror, directorySink, exportCommits, exportSnapshot, generateKeyPair, writeDump, type KeyPair } from '@rebbehub/mirror';
import { BUILTIN_SCHEMAS, SchemaRegistry } from '@rebbehub/model';
import { commitAll, git } from './git.js';
import { pullMirror } from './mirrorPull.js';
import { collectPageFixes, loadPageFixes, makePageFixes, OTZROS_COLLECTION, otzrosPdfs, pageFixesKey, pageFixesUrl, registerPageFixes } from './pageFixes.js';
import { ARCHIVE_OBJECTS_URL, archivePdfs, collectManifest, loadManifest, makeReadingCopies, MANIFEST_KEY, MANIFEST_URL, R2Store, registerReadingCopies, type ObjectStore, sichosKodeshScans } from './readingCopies.js';

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

export async function withCatalog<T>(ctx: Context, fn: (catalog: Catalog) => Promise<T>): Promise<T> {
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
 * importer bot (merged, open or draft), a report or issue (with its labels
 * and assignees), a comment, a review's words or a request for one, a
 * mention, a follow, a label, anything that happened in a conversation, a
 * file someone uploaded, a steward's rights decision on a file, a cover a
 * person chose, a project, a webhook; and, kept with the person in `auth`
 * but made for the catalog, an API token, an inbox line, a handle the
 * person chose. Files the import registers itself (the Sichos Kodesh scans and their reading
 * copies) are rebuilt with it. SQL, so the import can check it again
 * inside the transaction that replaces the catalog.
 */
export const PEOPLE_MADE_SQL = `SELECT EXISTS (SELECT 1 FROM changeset c JOIN account a ON a.id = c.author WHERE c.author <> 'system' AND NOT a.is_bot)
  OR EXISTS (SELECT 1 FROM report) OR EXISTS (SELECT 1 FROM comment) OR EXISTS (SELECT 1 FROM follow)
  OR EXISTS (SELECT 1 FROM file_source WHERE uploaded_by IS NOT NULL) OR EXISTS (SELECT 1 FROM audit_log WHERE action = 'file.rights')
  OR EXISTS (SELECT 1 FROM project) OR EXISTS (SELECT 1 FROM webhook)
  OR EXISTS (SELECT 1 FROM thread_event e JOIN account a ON a.id = e.actor WHERE NOT a.is_bot AND e.actor <> 'system') OR EXISTS (SELECT 1 FROM label WHERE created_by IS NOT NULL)
  OR EXISTS (SELECT 1 FROM review r JOIN account a ON a.id = r.reviewer WHERE NOT a.is_bot AND r.reviewer <> 'system' AND length(trim(coalesce(r.body, ''))) > 0) OR EXISTS (SELECT 1 FROM review_request)
  OR EXISTS (SELECT 1 FROM mention) OR EXISTS (SELECT 1 FROM thread_link) OR EXISTS (SELECT 1 FROM report_label) OR EXISTS (SELECT 1 FROM report_assignee)
  OR EXISTS (SELECT 1 FROM cover WHERE chosen_by = 'person')
  OR EXISTS (SELECT 1 FROM auth.api_token) OR EXISTS (SELECT 1 FROM auth.notification)
  OR EXISTS (SELECT 1 FROM auth.username_redirect) OR EXISTS (SELECT 1 FROM auth.person WHERE username_changed_at IS NOT NULL)`;

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
export const REBUILD_GUARD_SQL = `LOCK TABLE changeset, report, comment, review, review_request, mention, thread_link, report_label, report_assignee, follow, file, cover, project, webhook, thread_event, label, auth.api_token, auth.notification, auth.username_redirect IN ACCESS EXCLUSIVE MODE;
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

/**
 * Turns the pages whose words are still one string of wiki markup (from
 * before built-in schemas version 5) into structured words, as system
 * changes of `chunk` pages each. Safe to stop and run again: it takes up
 * what is left. Until it has run, the API shows those pages as structured
 * words anyway (they are read the same way on the way out).
 */
export async function convertBodiesCommand(ctx: Context, input: { chunk?: number } = {}): Promise<void> {
  await withCatalog(ctx, async (catalog) => {
    const done = await convertLegacyBodies(catalog, { batch: input.chunk, log: ctx.log });
    ctx.log(done ? `${done} pages' words turned into structured words` : 'every page already has structured words');
  });
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
  // With the words of every unit whose rights let it ship, from Sichos-Kodesh's published archive through
  // RebbeHub's API (REBBEHUB_API_URL, default the live one; REBBEHUB_NO_TEXTS=1 leaves them out).
  'sichos-kodesh-works': (from) =>
    sichosKodeshWorksImporter(() => readSichosKodeshWorks(from, { texts: !process.env.REBBEHUB_NO_TEXTS, api: process.env.REBBEHUB_API_URL, log: (line) => console.log(line) })),
  // With MAFTEIACH_DATA (a crawl of mafteiach.app by Sichos-Kodesh's packages/mafteiach-index), every link and content outline the index has.
  // The sets RebbeHub keeps itself (the Teshuros set); `--from` is not used.
  'rebbehub-sets': () => rebbehubSetsImporter(),
  // Otzros HaRebbe's Drive library of seforim, listed from Drive at run time (`--from` is not used).
  otzros: () => driveLibraryImporter(() => listDriveFolder(OTZROS_FOLDER, { log: (line) => console.log(line) })),
  // With CHABADLIBRARY_TREE (the contents `rebbehub crawl-library` gathered), a page for every chapter in the library,
  // with its words where the crawl kept them (`--texts`).
  chabadlibrary: (from) => {
    if (!process.env.CHABADLIBRARY_TREE) throw new Error('CHABADLIBRARY_TREE is not set: run rebbehub crawl-library first');
    return chabadLibraryImporter(() => readChabadLibrary(from, process.env.CHABADLIBRARY_TREE!, { api: process.env.REBBEHUB_API_URL }));
  },
  'sichos-kodesh-occasions': (from) =>
    sichosKodeshOccasionsImporter(() => readSichosKodeshOccasions(from), { mafteiach: process.env.MAFTEIACH_DATA && existsSync(process.env.MAFTEIACH_DATA) ? () => readMafteiachCrawl(process.env.MAFTEIACH_DATA!) : undefined }),
  // The Chabad shelf of HebrewBooks, link-only: the one Sichos-Kodesh's works catalog carries, or with HEBREWBOOKS_SHELF
  // one read afresh from the latest Otzaria catalog by its packages/hebrewbooks-index.
  hebrewbooks: (from) => hebrewBooksImporter(() => readHebrewBooks(from, process.env.HEBREWBOOKS_SHELF)),
  // With JEM_DB (a crawl of JEM's catalog by Sichos-Kodesh's packages/jem-index), JEM's recordings, on the farbrengens they belong to.
  jem: (from) => {
    const db = need('JEM_DB', 'a crawl of JEM by Sichos-Kodesh\'s packages/jem-index (jem.db)');
    return jemImporter(async () => ({ jem: await readJemIndex(db), occasions: await farbrengens(from) }));
  },
  // With SEFARIA_DATA (what `rebbehub crawl-sefaria` read), Sefaria's Chabad books that Sichos-Kodesh does not publish.
  sefaria: (from) => {
    const dir = need('SEFARIA_DATA', 'the folder `rebbehub crawl-sefaria` wrote');
    return sefariaImporter(async () => ({ ...(await readSefariaCrawl(dir)), authors: await skAuthors(from), api: process.env.REBBEHUB_API_URL }));
  },
  // With IGROS_DATA (Sichos-Kodesh's build-igros output, from the Igros app's files), each letter's date.
  igros: () => {
    const dir = need('IGROS_DATA', "the folder Sichos-Kodesh's build-igros wrote from the Igros app's files");
    return igrosImporter(() => readIgrosBuild(dir));
  },
  // With SK_ARCHIVE_DB (a copy of Sichos-Kodesh's archive index), the archive's history, one suggestion per commit.
  archive: () => {
    const db = need('SK_ARCHIVE_DB', "a copy of Sichos-Kodesh's archive index (raw/index.sqlite)");
    return archiveImporter(() => readArchiveIndex(db));
  },
};

function need(name: string, what: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: give ${what}`);
  return value;
}

/** Sichos-Kodesh's author ids, from its works registry. */
async function skAuthors(from: string): Promise<Set<string>> {
  const dir = from.endsWith('works') ? from : join(from, 'apps/mobile/src/catalog/data/works');
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8')) as { authors: Array<{ id: string }> };
  return new Set(index.authors.map((a) => a.id));
}

/** The farbrengens the occasions importer brings: Sichos-Kodesh's catalog, and with MAFTEIACH_DATA the ones only the index knows. */
async function farbrengens(from: string) {
  const entries = await readSichosKodeshOccasions(from);
  const crawl = process.env.MAFTEIACH_DATA;
  if (crawl && existsSync(crawl)) {
    const known = new Set(entries.map((e) => e.occasionId));
    for (const r of await readMafteiachCrawl(crawl)) if (!known.has(r.id)) entries.push({ occasionId: r.id, hebrewYear: r.hebrewYear, hebrewDate: r.hebrewDate, occasionLabel: r.occasionLabel, audio: [], pdfs: [] });
  }
  return entries;
}

/**
 * Reads Sefaria's Chabad books that Sichos-Kodesh does not publish into
 * `out`, asking Sefaria only for what `cache` does not have; with `keep`,
 * puts each text with a licence that lets it be kept on RebbeHub's own
 * storage (`texts/<sha256>` in rebbehub-public), once.
 */
export async function crawlSefariaCommand(ctx: Context, input: { from: string; out: string; cache?: string; keep?: boolean; only?: string[]; bucket?: string }): Promise<void> {
  const exclude = await sichosKodeshSefariaTitles(input.from);
  const client = sefariaClient({ cacheDir: input.cache });
  const crawl = await crawlSefaria({ out: input.out, exclude, client, only: input.only, log: ctx.log });
  if (!input.keep) return;
  const kept = await keepSefariaTexts(crawl, input.out, r2(input.bucket ?? 'rebbehub-public'), ctx.log);
  await writeFile(join(input.out, 'crawl.json'), JSON.stringify(crawl));
  ctx.log(`${kept.stored} texts stored, ${kept.already} already there`);
}

/** Stores each kept text of a crawl as `texts/<sha256>`, checked against its hash, and marks it kept. */
export async function keepSefariaTexts(crawl: SefariaCrawl, dir: string, store: ObjectStore, log: (line: string) => void = () => {}): Promise<{ stored: number; already: number }> {
  let stored = 0;
  let already = 0;
  const done = new Set<string>();
  for (const book of crawl.books) {
    for (const unit of book.units) {
      for (const text of unit.texts) {
        if (!text.sha256 || !mayKeepText(text.licence)) continue;
        if (!done.has(text.sha256)) {
          const key = `texts/${text.sha256}`;
          const bytes = new Uint8Array(await readFile(join(dir, 'texts', `${text.sha256}.html`)));
          if (createHash('sha256').update(bytes).digest('hex') !== text.sha256) throw new Error(`${key}: the file does not match its hash`);
          if (await store.has(key)) already++;
          else {
            await store.put(key, bytes, 'text/html; charset=utf-8');
            if (++stored % 500 === 0) log(`${stored} texts stored`);
          }
          done.add(text.sha256);
        }
        text.kept = true;
      }
    }
  }
  return { stored, already };
}

/**
 * Loads the files Sichos-Kodesh's archive wants and could not get (from a
 * copy of its index) into the Missing board, each with the RebbeHub item
 * it belongs to.
 */
export async function archiveGapsCommand(ctx: Context, input: { db: string }): Promise<void> {
  const { gaps } = await readArchiveIndex(input.db);
  await withCatalog(ctx, async (catalog) => {
    const rows = await Promise.all(
      gaps.map(async (g) => {
        const target = archiveTarget(g);
        return {
          collection: g.collection,
          item_id: g.itemId,
          kind: g.kind,
          source_id: g.sourceId,
          role: g.role,
          entity_id: target ? await idForKey(target.key) : null,
          source: g.source,
          url: g.url,
          label: g.label,
          hebrew_date: g.hebrewDate,
          status: g.status,
          http_status: g.httpStatus,
          error: g.error,
          attempts: g.attempts,
          checked_at: g.checkedAt,
        };
      }),
    );
    ctx.log(`${await catalog.loadArchiveGaps(rows)} files the archive could not get, on the Missing board`);
  });
}

/**
 * Crawls chabadlibrary.org's contents for every work of Sichos-Kodesh's
 * registry in the library, into `out`, continuing an earlier crawl there,
 * for `minutes` at most (the importer takes what is known so far). With
 * `texts`, each page's text too, as `texts/<sha256>.html` beside `out`;
 * with `keep`, each of those is put on RebbeHub's own storage
 * (`texts/<sha256>` in rebbehub-public), once.
 */
export async function crawlLibraryCommand(ctx: Context, input: { from: string; out: string; minutes?: number; texts?: boolean; keep?: boolean; bucket?: string }): Promise<void> {
  const dir = input.from.endsWith('works') ? input.from : join(input.from, 'apps/mobile/src/catalog/data/works');
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8'));
  // A work Sichos-Kodesh has chapters for keeps those; its contents in the library are not needed.
  const withContents = new Set((await readdir(join(dir, 'contents'))).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)));
  const roots = libraryWorks(index, withContents).map((w) => w.root);
  const tree = existsSync(input.out) ? JSON.parse(await readFile(input.out, 'utf8')) : { nodes: {} };
  const save = async (t: unknown) => writeFile(input.out, JSON.stringify(t));
  const deadline = input.minutes ? Date.now() + input.minutes * 60_000 : undefined;
  const textsDir = join(input.out, '..', 'texts');
  if (input.texts) await mkdir(textsDir, { recursive: true });
  const texts = input.texts ? (sha256: string, html: string) => writeFile(join(textsDir, `${sha256}.html`), html) : undefined;
  await crawlChabadLibrary(roots, tree, { deadline, log: ctx.log, save, texts });
  if (!input.keep) return;
  const kept = await keepLibraryTexts(tree, textsDir, r2(input.bucket ?? 'rebbehub-public'), ctx.log);
  await save(tree);
  ctx.log(`${kept.stored} texts stored, ${kept.already} already there`);
}

/** Stores each page text of a library crawl as `texts/<sha256>`, checked against its hash, and marks it kept. */
export async function keepLibraryTexts(tree: LibraryTree, dir: string, store: ObjectStore, log: (line: string) => void = () => {}): Promise<{ stored: number; already: number }> {
  let stored = 0;
  let already = 0;
  for (const node of Object.values(tree.nodes)) {
    if (!node.sha256 || node.kept) continue;
    const file = join(dir, `${node.sha256}.html`);
    if (!existsSync(file)) continue;
    const key = `texts/${node.sha256}`;
    const bytes = new Uint8Array(await readFile(file));
    if (createHash('sha256').update(bytes).digest('hex') !== node.sha256) throw new Error(`${key}: the file does not match its hash`);
    if (await store.has(key)) already++;
    else {
      await store.put(key, bytes, 'text/html; charset=utf-8');
      if (++stored % 1000 === 0) log(`${stored} texts stored`);
    }
    node.kept = true;
  }
  return { stored, already };
}

export async function importCommand(ctx: Context, input: { source: string; from: string; approveAs?: string; dryRun?: boolean; chunkSize?: number }): Promise<void> {
  const make = IMPORTERS[input.source];
  if (!make) throw new Error(`unknown importer "${input.source}" (known: ${Object.keys(IMPORTERS).join(', ')})`);
  await withCatalog(ctx, async (catalog) => {
    const importer = make(input.from);
    const result = await runImport(catalog, importer, { approveAs: input.approveAs, dryRun: input.dryRun, chunkSize: input.chunkSize, log: ctx.log });
    ctx.log(`${input.dryRun ? 'would create' : 'created'} ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}${result.skipped ? `, skipped ${result.skipped} (not in the catalog yet)` : ''}; kept ${result.keptHumanEdits} human edits; suggestions: ${result.changesets.join(', ') || 'none'}`);
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

export async function dumpCommand(ctx: Context, input: { tag: string; out: string; keyFile?: string; upload?: boolean; bucket?: string }): Promise<void> {
  // Checked first, so a long dump never ends in "cannot upload".
  const store = input.upload ? r2(input.bucket ?? 'rebbehub-public') : null;
  await withCatalog(ctx, async (catalog) => {
    const edition = (await catalog.editions()).find((e) => e.tag === input.tag);
    if (!edition) throw new Error(`no catalog edition ${input.tag}; tag one first`);
    const key = input.keyFile ? (JSON.parse(await readFile(input.keyFile, 'utf8')) as KeyPair) : undefined;
    const manifest = await writeDump(catalog, input.out, { tag: input.tag, at: edition.commit_seq, key });
    // Uploaded before the manifest is recorded: an edition lists its dumps only once mirrors can fetch them.
    if (store) {
      for (const file of [...manifest.files.map((f) => f.name), 'manifest.json']) {
        const mime = file.endsWith('.gz') ? 'application/gzip' : file.endsWith('.json') ? 'application/json' : 'application/vnd.sqlite3';
        await store.put(`dumps/${input.tag}/${file}`, new Uint8Array(await readFile(join(input.out, file))), mime);
        ctx.log(`uploaded dumps/${input.tag}/${file}`);
      }
    }
    await catalog.setEditionManifest(input.tag, manifest);
    ctx.log(`dumps of ${input.tag} in ${input.out}${key ? `, signed with key ${key.keyId}` : ' (unsigned: give --key to sign)'}${store ? ', and in R2 for /dumps' : ''}`);
  });
}

/** Keeps a mirror's copy of every edition's dumps, checked (mirrorPull.ts; docs/mirrors.md). */
export async function mirrorPullCommand(ctx: Context, input: { api?: string; out: string; keys?: string[]; tag?: string; allowUnsigned?: boolean }): Promise<void> {
  const result = await pullMirror({ api: input.api ?? 'https://api.rebbehub.org', out: input.out, keys: input.keys, tag: input.tag, allowUnsigned: input.allowUnsigned, log: ctx.log });
  ctx.log(`pulled ${result.pulled.length}, already here ${result.kept.length}, failed ${result.failed.length}`);
  if (result.failed.length) throw new Error(`not kept: ${result.failed.map((f) => `${f.tag} (${f.reason})`).join('; ')}`);
}

export async function keygenCommand(ctx: Context, input: { out: string }): Promise<void> {
  if (existsSync(input.out)) throw new Error(`${input.out} exists; refusing to overwrite a key`);
  const key = generateKeyPair();
  await writeFile(input.out, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  ctx.log(`key ${key.keyId} written to ${input.out} (keep it secret). Public key: ${key.publicKey}`);
}

function r2(bucket: string): R2Store {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a token with R2 edit rights)');
  return new R2Store(accountId, bucket, token);
}

/** Makes the Sichos Kodesh scans' reading copies from Sichos-Kodesh's archive into the public bucket (docs/operations.md). */
export async function readingCopiesMakeCommand(
  ctx: Context,
  input: { from: string; work: string; shard?: string; limit?: number; archive?: string; sourceBucket?: string; bucket?: string },
): Promise<void> {
  const scans = await sichosKodeshScans(input.from);
  const shard = input.shard?.split('/').map(Number) as [number, number] | undefined;
  if (shard && !(shard.length === 2 && shard[0]! >= 0 && shard[0]! < shard[1]!)) throw new Error('--shard is i/n, as 0/4');
  ctx.log(`${scans.length} Sichos Kodesh scans in the catalog${shard ? `; this is part ${shard[0]} of ${shard[1]}` : ''}`);
  const result = await makeReadingCopies({
    scans,
    archive: await archivePdfs(input.archive ?? ARCHIVE_OBJECTS_URL),
    source: r2(input.sourceBucket ?? 'sichos-kodesh-archive'),
    target: r2(input.bucket ?? 'rebbehub-public'),
    work: input.work,
    ...(shard ? { shard } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    log: ctx.log,
  });
  ctx.log(JSON.stringify(result));
}

/** Puts the parts together into the manifest, and publishes it next to the files. */
export async function readingCopiesPublishCommand(ctx: Context, input: { from: string; work: string; bucket?: string }): Promise<void> {
  const manifest = await collectManifest(input.work, await sichosKodeshScans(input.from));
  const text = JSON.stringify(manifest);
  await writeFile(join(input.work, 'manifest.json'), text);
  await r2(input.bucket ?? 'rebbehub-public').put(MANIFEST_KEY, new TextEncoder().encode(text), 'application/json');
  const copies = manifest.files.filter((entry) => entry.readingCopy).length;
  ctx.log(`published ${MANIFEST_KEY}: ${manifest.files.length} scans, ${copies} reading copies, ${manifest.files.length - copies} left as they are`);
}

/** Records the published manifest in the catalog (every import runs this). */
export async function readingCopiesRegisterCommand(ctx: Context, input: { manifest?: string }): Promise<void> {
  const manifest = await loadManifest(input.manifest ?? MANIFEST_URL);
  if (!manifest) {
    ctx.log('no reading copies published yet: nothing to register');
    return;
  }
  const db = await openDatabase(ctx.database);
  try {
    await registerReadingCopies(db, manifest, ctx.log);
  } finally {
    await db.close();
  }
}

/**
 * The Otzros library's PDFs, as its importer lists them from Drive. The
 * listing is kept in the work folder, so every shard of a run, and its
 * publish, work from the same list.
 */
async function otzrosList(ctx: Context, work: string) {
  const file = join(work, 'otzros-tree.json');
  let tree: DriveFolder;
  try {
    tree = JSON.parse(await readFile(file, 'utf8')) as DriveFolder;
  } catch {
    tree = await listDriveFolder(OTZROS_FOLDER, { log: ctx.log });
    await mkdir(work, { recursive: true });
    await writeFile(file, JSON.stringify(tree));
  }
  return otzrosPdfs(tree);
}

/** Measures the Otzros library's PDFs for page fixes (docs/operations.md); a run reads only what earlier runs have not. */
export async function pageFixesMakeCommand(ctx: Context, input: { work: string; shard?: string; limit?: number }): Promise<void> {
  const pdfs = await otzrosList(ctx, input.work);
  const shard = input.shard?.split('/').map(Number) as [number, number] | undefined;
  if (shard && !(shard.length === 2 && shard[0]! >= 0 && shard[0]! < shard[1]!)) throw new Error('--shard is i/n, as 0/4');
  ctx.log(`${pdfs.length} PDFs in the Otzros library${shard ? `; this is part ${shard[0]} of ${shard[1]}` : ''}`);
  const result = await makePageFixes({ pdfs, work: input.work, ...(shard ? { shard } : {}), ...(input.limit !== undefined ? { limit: input.limit } : {}), log: ctx.log });
  ctx.log(JSON.stringify(result));
}

/** Puts the parts together into the manifest, and publishes it in the public bucket. */
export async function pageFixesPublishCommand(ctx: Context, input: { work: string; bucket?: string }): Promise<void> {
  const manifest = await collectPageFixes(input.work, OTZROS_COLLECTION, await otzrosList(ctx, input.work));
  const text = JSON.stringify(manifest);
  await writeFile(join(input.work, 'manifest.json'), text);
  await r2(input.bucket ?? 'rebbehub-public').put(pageFixesKey(OTZROS_COLLECTION), new TextEncoder().encode(text), 'application/json');
  const count = (verdict: string) => manifest.files.filter((entry) => entry.verdict === verdict).length;
  ctx.log(`published ${pageFixesKey(OTZROS_COLLECTION)}: ${manifest.files.length} PDFs, ${count('fixed')} with pages to turn, ${count('as-is')} as they are, ${count('failed')} failed`);
}

/** Records the published manifest in the catalog (every import runs this). */
export async function pageFixesRegisterCommand(ctx: Context, input: { manifest?: string }): Promise<void> {
  const manifest = await loadPageFixes(input.manifest ?? pageFixesUrl(OTZROS_COLLECTION));
  if (!manifest) {
    ctx.log('no page fixes published yet: nothing to register');
    return;
  }
  const db = await openDatabase(ctx.database);
  try {
    await registerPageFixes(db, manifest, ctx.log);
  } finally {
    await db.close();
  }
}
