import type { Db } from './db.js';
import * as catalog from './migrations/0001_catalog.js';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/** Every migration, in order. A migration is never edited once released; a change is a new one. */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'catalog', up: catalog.up }];

/** Applies the migrations `db` has not had yet, each in its own transaction. Returns the versions applied. */
export async function migrate(db: Db): Promise<number[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query<{ version: number }>('SELECT version FROM schema_migration');
  const done = new Set(rows.map((r) => r.version));
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(migration.up);
      await tx.query('INSERT INTO schema_migration (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
    });
    applied.push(migration.version);
  }
  return applied;
}

/** Creates yearly partitions of `revision` for the years given, so the default partition stays small. */
export async function ensureRevisionPartitions(db: Db, years: readonly number[]): Promise<void> {
  for (const year of years) {
    await db.exec(
      `CREATE TABLE IF NOT EXISTS revision_${year} PARTITION OF revision FOR VALUES FROM ('${year}-01-01') TO ('${year + 1}-01-01')`,
    );
  }
}
