import type { Db } from './db.js';
import * as catalog from './migrations/0001_catalog.js';
import * as pageFixes from './migrations/0002_page_fixes.js';
import * as auth from './migrations/0003_auth.js';
import * as google from './migrations/0004_google.js';
import * as steward from './migrations/0005_steward.js';
import * as admin from './migrations/0006_admin.js';
import * as projectFocus from './migrations/0007_project_focus.js';
import * as webhooks from './migrations/0008_webhooks.js';
import * as archiveGaps from './migrations/0009_archive_gaps.js';
import * as network from './migrations/0010_network.js';
import * as emailNotifyAdvice from './migrations/0011_email_notify_advice.js';
import * as scansAndTeshuros from './migrations/0012_scans_and_teshuros.js';
import * as projectClaims from './migrations/0013_project_claims.js';
import * as readingPlaces from './migrations/0014_reading_places.js';
import * as pageWords from './migrations/0015_page_words.js';
import * as peopleAndThreads from './migrations/0016_people_and_threads.js';
import * as covers from './migrations/0017_covers.js';
import * as apiTokens from './migrations/0018_api_tokens.js';
import * as listingIndexes from './migrations/0019_listing_indexes.js';
import * as driveFiles from './migrations/0020_drive_files.js';
import * as oauth from './migrations/0021_oauth.js';
import * as entityForward from './migrations/0022_entity_forward.js';
import * as machineRequests from './migrations/0023_machine_requests.js';
import * as searchVector from './migrations/0024_search_vector.js';
import * as dropSearchExpressionIndex from './migrations/0025_drop_search_expression_index.js';
import * as revisionAbout from './migrations/0026_revision_about.js';

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
  { version: 9, name: 'archive-gaps', up: archiveGaps.up },
  { version: 10, name: 'network', up: network.up },
  { version: 11, name: 'email-notify-advice', up: emailNotifyAdvice.up },
  { version: 12, name: 'scans-and-teshuros', up: scansAndTeshuros.up },
  { version: 13, name: 'project-claims', up: projectClaims.up },
  { version: 14, name: 'reading-places', up: readingPlaces.up },
  { version: 15, name: 'page-words', up: pageWords.up },
  { version: 16, name: 'people-and-threads', up: peopleAndThreads.up },
  { version: 17, name: 'covers', up: covers.up },
  { version: 18, name: 'api-tokens', up: apiTokens.up },
  { version: 19, name: 'listing-indexes', up: listingIndexes.up },
  { version: 20, name: 'drive-files', up: driveFiles.up },
  { version: 21, name: 'oauth', up: oauth.up },
  { version: 22, name: 'entity-forward', up: entityForward.up },
  { version: 23, name: 'machine-requests', up: machineRequests.up },
  { version: 24, name: 'search-vector', up: searchVector.up },
  { version: 25, name: 'drop-search-expression-index', up: dropSearchExpressionIndex.up },
  { version: 26, name: 'revision-about', up: revisionAbout.up },
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
