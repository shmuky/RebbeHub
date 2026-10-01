import type { Db } from './db.js';

/**
 * Holding the catalog still while an import runs (scripts/import-catalog.sh).
 *
 * An import copies the live catalog next to itself, imports into the copy
 * and copies the result back, and only if nothing changed meanwhile, so no
 * one's work is lost. Before this, any write in those minutes (a
 * Suggestion, an approval, a transcript the nightly run finished, the
 * reviewer's advice) stopped the import, and every thread had to be asked
 * to pause first. Now the import holds the catalog: it takes
 * CATALOG_HOLD_LOCK, and every write to a catalog table checks that lock
 * first (`auth.catalog_write_check`, migration 0028). A write that comes
 * while it is held is refused with CATALOG_HELD, which the API answers as
 * 503 with Retry-After and the jobs wait out; nothing is half written.
 * Reads go on as always.
 */

/** The advisory lock an import holds while it runs; every write takes it shared. */
export const CATALOG_HOLD_LOCK = 7_265_001;

/** The SQLSTATE of a write refused because an import holds the catalog. */
export const CATALOG_HELD = 'RH503';

/** Whether `error` is a write refused because an import holds the catalog. */
export function isCatalogHeld(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === CATALOG_HELD;
}

/**
 * Puts the write check on every catalog table that lacks it (partitions
 * share their parent's). Migration 0028 runs it, and `migrate` again after
 * any migration, so a table added later is held too.
 */
export const HOLD_EVERY_TABLE_SQL = /* sql */ `
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = 'catalog_write_check')
  LOOP
    EXECUTE format('CREATE TRIGGER catalog_write_check BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION auth.catalog_write_check()', t);
  END LOOP;
END $$;`;

/**
 * Holds the catalog on `db` until `until` settles: waits up to `waitSeconds`
 * for writes already under way to finish, then calls `held`. Held in one
 * transaction on one connection, so if this process dies the database lets
 * go at once.
 */
export async function holdCatalog(db: Db, options: { waitSeconds?: number; held?: () => void; until: Promise<unknown> }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL lock_timeout = '${Math.max(1, Math.round(options.waitSeconds ?? 120))}s'`);
    await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_HOLD_LOCK]);
    options.held?.();
    // Asking the database something now and then keeps the connection from being dropped as idle.
    let done = false;
    const settled = options.until.finally(() => {
      done = true;
    });
    while (!done) await Promise.race([settled, tx.query('SELECT pg_sleep(1)')]);
  });
}

/**
 * The same database, waiting while an import holds the catalog: a write it
 * refuses is tried again, a whole transaction at a time, every `everyMs`
 * for up to `forMs`. For jobs that run for hours beside an import (the
 * nightly transcription), so their work is saved when the import is done.
 */
export function waitingWhileHeld(db: Db, options: { everyMs?: number; forMs?: number; log?: (line: string) => void } = {}): Db {
  const every = options.everyMs ?? 30_000;
  const limit = options.forMs ?? 60 * 60_000;
  const retry = async <T>(work: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    let told = false;
    for (;;) {
      try {
        return await work();
      } catch (error) {
        if (!isCatalogHeld(error) || Date.now() - started + every > limit) throw error;
        if (!told) options.log?.('an import holds the catalog: waiting to save until it is done');
        told = true;
        await new Promise((resolve) => setTimeout(resolve, every));
      }
    }
  };
  return {
    query: (sql, params) => retry(() => db.query(sql, params)),
    exec: (sql) => retry(() => db.exec(sql)),
    transaction: (fn) => retry(() => db.transaction(fn)),
    close: () => db.close(),
  };
}
