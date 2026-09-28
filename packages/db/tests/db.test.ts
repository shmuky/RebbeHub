import { describe, expect, it } from 'vitest';
import { migrate } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';

describe('migrations', () => {
  it('create the catalog schema once, and are idempotent', async () => {
    const db = await openPGlite();
    expect(await migrate(db)).toEqual([1]);
    expect(await migrate(db)).toEqual([]);
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
      'path_redirect',
      'project',
      'project_head',
      'report',
      'review',
      'revision',
      'schema_migration',
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
