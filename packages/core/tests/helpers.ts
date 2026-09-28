import { connectPostgres, type Db } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';
import { Catalog, type Json } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';

let shared: Promise<Db> | null = null;

/**
 * A fresh catalog in memory, with a steward, a keeper, two contributors
 * and a bot, and one moderated set kept by the keeper. One PGlite per test
 * file (starting one takes seconds), emptied for every test. With
 * REBBEHUB_TEST_DATABASE_URL set, a real Postgres server instead (CI runs
 * both); its public schema is dropped, so never point it at real data.
 */
export async function freshCatalog() {
  const url = process.env.REBBEHUB_TEST_DATABASE_URL;
  shared ??= url ? Promise.resolve(connectPostgres(url, { max: 4 })) : openPGlite();
  const db = await shared;
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const catalog = new Catalog(db, { now: () => new Date('2026-09-28T12:00:00Z') });
  await catalog.init();
  await catalog.createAccount({ id: 'shmuly', displayName: 'Shmuly' });
  await catalog.db.query("UPDATE account SET is_steward = TRUE WHERE id = 'shmuly'");
  await catalog.createAccount({ id: 'keeper', displayName: 'Set keeper' });
  await catalog.createAccount({ id: 'mendy', displayName: 'Mendy' });
  await catalog.createAccount({ id: 'chaim', displayName: 'Chaim' });
  await catalog.createAccount({ id: 'bot:mafteiach', displayName: 'mafteiach importer', isBot: true });

  const setup = await catalog.createChangeset('shmuly', { title: 'Set up Farbrengens' });
  const set = await catalog.putRevision(setup.id, 'shmuly', {
    type: 'set',
    data: { name: { he: 'התוועדויות', en: 'Farbrengens' }, slug: 'farbrengens', policy: 'moderated', keepers: ['keeper'] },
    path: '/farbrengens',
  });
  await catalog.submit(setup.id, 'shmuly');
  await catalog.merge(setup.id, 'shmuly');
  return { db, catalog, set };
}

/** Suggests one item and merges it, as `author` then `reviewer`. */
export async function add(catalog: Catalog, author: string, reviewer: string, type: Parameters<Catalog['putRevision']>[2]['type'], data: Json, path?: string): Promise<EntityId> {
  const cs = await catalog.createChangeset(author, { title: `Add ${type}` });
  const id = await catalog.putRevision(cs.id, author, { type, data, path });
  await catalog.submit(cs.id, author);
  const after = await catalog.changeset(cs.id);
  if (after.status !== 'merged') await catalog.merge(cs.id, reviewer);
  return id;
}

export const yudShvat = (set: EntityId) => ({ kind: 'farbrengen', title: { he: 'יו״ד שבט תשמ״ב', en: 'Yud Shvat 5742' }, date: '5742-05-10', sets: [set] });
