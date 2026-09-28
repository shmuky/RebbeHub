import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';

describe('migrations', () => {
  it('create the catalog schema once, and are idempotent', async () => {
    const db = await openPGlite();
    expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await migrate(db)).toEqual([]);
    // Sign-in is kept apart from the catalog (migrations 0003 to 0005).
    const auth = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' ORDER BY table_name");
    expect(auth.rows.map((r) => r.table_name)).toEqual(['challenge', 'google_account', 'passkey', 'person', 'reading_place', 'session']);
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE 'revision_%' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'account',
      'audit_log',
      'catalog_edition',
      'changeset',
      'comment',
      'commit',
      'commit_change',
      'derivation',
      'entity',
      'entity_external_id',
      'entity_ref',
      'file',
      'file_source',
      'follow',
      'page_fix',
      'path_redirect',
      'project',
      'project_head',
      'report',
      'review',
      'revision',
      'schema_migration',
      'webhook',
    ]);
    await db.close();
  });

  it('rolls a failed transaction back', async () => {
    const db = await openPGlite();
    await migrate(db);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO account (id, display_name) VALUES ('a', 'A')");
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    const { rows } = await db.query("SELECT id FROM account WHERE id = 'a'");
    expect(rows).toEqual([]);
    await db.close();
  });
});
