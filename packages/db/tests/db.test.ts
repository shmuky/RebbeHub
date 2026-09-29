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
    expect(auth.rows.map((r) => r.table_name)).toEqual(['api_token', 'challenge', 'email_address', 'email_link', 'google_account', 'notification', 'notification_setting', 'oauth_client', 'oauth_connection', 'oauth_request', 'passkey', 'person', 'reading_place', 'session', 'username_redirect']);
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE 'revision_%' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'account',
      'archive_gap',
      'audit_log',
      'catalog_edition',
      'changeset',
      'changeset_advice',
      'comment',
      'commit',
      'commit_change',
      'cover',
      'derivation',
      'drive_file',
      'embedding',
      'entity',
      'entity_external_id',
      'entity_forward',
      'entity_ref',
      'family_request',
      'file',
      'file_fingerprint',
      'file_page',
      'file_source',
      'follow',
      'label',
      'link_check',
      'machine_pass',
      'mention',
      'page_fix',
      'path_redirect',
      'project',
      'project_claim',
      'project_head',
      'report',
      'report_assignee',
      'report_label',
      'review',
      'review_request',
      'revision',
      'schema_migration',
      'takedown',
      'thread_event',
      'thread_link',
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

  it('gives everyone a handle and every suggestion and report a number, once (migration 0016)', async () => {
    const db = await openPGlite();
    // The database as it was before: people, a suggestion, an import and a report.
    for (const m of MIGRATIONS.filter((m) => m.version < 16)) await db.exec(m.up);
    await db.exec(`INSERT INTO auth.person (id, display_name) VALUES
      ('u-aaaaaaaaaa', 'מנחם מענדל'), ('u-bbbbbbbbbb', 'Mendy Cohen'), ('u-cccccccccc', 'mendy cohen'), ('u-dddddddddd', 'Admin'), ('u-eeeeeeeeee', '!!')`);
    await db.exec("INSERT INTO account (id, display_name) VALUES ('u-bbbbbbbbbb', 'Mendy Cohen')");
    await db.exec("INSERT INTO changeset (title, author, kind) VALUES ('An import', 'system', 'import'), ('A fix', 'u-bbbbbbbbbb', 'suggestion')");
    await db.exec("INSERT INTO report (reason, note) VALUES ('other', 'sent when reports were private')");
    await db.transaction((tx) => tx.exec(MIGRATIONS.find((m) => m.version === 16)!.up));

    const people = await db.query<{ id: string; username: string }>('SELECT id, username FROM auth.person ORDER BY id');
    expect(people.rows.map((r) => r.username)).toEqual(['mnchm-mandl', 'mendy-cohen', 'mendy-cohen-cccccccccc', 'reader-dddddddddd', 'reader-eeeeeeeeee']);
    expect((await db.query('SELECT kind, number FROM changeset ORDER BY id')).rows).toEqual([{ kind: 'import', number: null }, { kind: 'suggestion', number: 1 }]);
    expect((await db.query('SELECT number, private FROM report')).rows).toEqual([{ number: 2, private: true }]);

    // From then on: the next number, whichever kind; a person made without a handle is given one.
    await db.exec("INSERT INTO report (reason) VALUES ('other'); INSERT INTO changeset (title, author) VALUES ('Another', 'system'); INSERT INTO auth.person (id, display_name) VALUES ('u-ffffffffff', 'x')");
    expect((await db.query("SELECT number FROM report WHERE note IS NULL")).rows).toEqual([{ number: 3 }]);
    expect((await db.query("SELECT number FROM changeset WHERE title = 'Another'")).rows).toEqual([{ number: 4 }]);
    expect((await db.query("SELECT username FROM auth.person WHERE id = 'u-ffffffffff'")).rows).toEqual([{ username: 'reader-ffffffffff' }]);
    // Handles are unique whatever their case.
    await expect(db.exec("UPDATE auth.person SET username = 'MENDY-COHEN' WHERE id = 'u-aaaaaaaaaa'")).rejects.toThrow();
    await db.close();
  });
});
