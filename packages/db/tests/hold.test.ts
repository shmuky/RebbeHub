import { describe, expect, it } from 'vitest';
import { CATALOG_HELD, connectPostgres, holdCatalog, isCatalogHeld, migrate, waitingWhileHeld } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';

describe('holding the catalog for an import', () => {
  it('puts the write check on every catalog table, and writes go on while nobody holds it', async () => {
    const db = await openPGlite();
    await migrate(db);
    const { rows } = await db.query<{ name: string; held: boolean }>(
      `SELECT c.relname AS name, EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = 'catalog_write_check') AS held
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`,
    );
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.held).map((r) => r.name)).toEqual([]);
    await db.query("INSERT INTO account (id, display_name) VALUES ('mendy', 'Mendy')");
    expect((await db.query('SELECT id FROM account')).rows).toHaveLength(2);
  });

  it('knows a refused write by its code', () => {
    expect(isCatalogHeld({ code: CATALOG_HELD })).toBe(true);
    expect(isCatalogHeld(new Error('else'))).toBe(false);
  });

  // Two connections need a real server: PGlite is one session, which never waits for itself.
  const url = process.env.REBBEHUB_TEST_DATABASE_URL;
  it.skipIf(!url)('refuses writes while held, lets the copy back through, and the jobs wait it out', async () => {
    const db = connectPostgres(url!, { max: 4 });
    try {
      await db.exec('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await migrate(db);
      const holder = connectPostgres(url!, { max: 1 });
      let letGo = () => {};
      const until = new Promise<void>((resolve) => (letGo = resolve));
      let held = () => {};
      const isHeld = new Promise<void>((resolve) => (held = resolve));
      const holding = holdCatalog(holder, { until, held });
      await isHeld;

      // Reads go on; a write is refused, and nothing of it is written.
      expect((await db.query('SELECT count(*)::int AS n FROM account')).rows).toEqual([{ n: 1 }]);
      const refused = await db.query("INSERT INTO account (id, display_name) VALUES ('mendy', 'Mendy')").catch((e) => e);
      expect(isCatalogHeld(refused)).toBe(true);
      // The import's own copy back is let through.
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL rebbehub.import = 'on'");
        await tx.query("INSERT INTO account (id, display_name) VALUES ('bot:import', 'An importer')");
      });
      // A job's write waits, and is saved once the import lets go.
      const waiting = waitingWhileHeld(db, { everyMs: 50 }).query("INSERT INTO account (id, display_name) VALUES ('chaim', 'Chaim')");
      await new Promise((resolve) => setTimeout(resolve, 200));
      letGo();
      await holding;
      await waiting;
      expect((await db.query<{ id: string }>('SELECT id FROM account ORDER BY id')).rows.map((r) => r.id)).toEqual(['bot:import', 'chaim', 'system']);
      await holder.close();
    } finally {
      await db.close();
    }
  });
});
