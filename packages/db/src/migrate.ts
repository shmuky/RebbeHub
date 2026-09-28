import type { Db } from './db.js';
import * as catalog from './migrations/0001_catalog.js';
import * as pageFixes from './migrations/0002_page_fixes.js';
import * as auth from './migrations/0003_auth.js';
import * as google from './migrations/0004_google.js';
import * as steward from './migrations/0005_steward.js';
import * as admin from './migrations/0006_admin.js';
import * as projectFocus from './migrations/0007_project_focus.js';
import * as webhooks from './migrations/0008_webhooks.js';
import * as network from './migrations/0010_network.js';
import * as emailNotifyAdvice from './migrations/0011_email_notify_advice.js';
import * as readingPlaces from './migrations/0014_reading_places.js';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/** Every migration, in order. A migration is never edited once released; a change is a new one. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'catalog', up: catalog.up },
  { version: 2, name: 'page fixes', up: pageFixes.up },
  { version: 3, name: 'auth', up: auth.up },
  { version: 4, name: 'google', up: google.up },
  { version: 5, name: 'steward', up: steward.up },
  { version: 6, name: 'admin', up: admin.up },
  { version: 7, name: 'project-focus', up: projectFocus.up },
  { version: 8, name: 'webhooks', up: webhooks.up },
  { version: 10, name: 'network', up: network.up },
  { version: 11, name: 'email-notify-advice', up: emailNotifyAdvice.up },
  { version: 14, name: 'reading-places', up: readingPlaces.up },
];

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
