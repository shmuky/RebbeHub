import type { Db, QueryResult } from './db.js';

interface PGliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: PGliteTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface PGliteTx {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

class TxDb implements Db {
  constructor(private readonly tx: PGliteTx) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return { rows: (await this.tx.query<T>(sql, [...params])).rows };
  }

  async exec(sql: string): Promise<void> {
    await this.tx.exec(sql);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}
}

class PGliteDb implements Db {
  constructor(private readonly pglite: PGliteLike) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return { rows: (await this.pglite.query<T>(sql, [...params])).rows };
  }

  async exec(sql: string): Promise<void> {
    await this.pglite.exec(sql);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.pglite.transaction((tx) => fn(new TxDb(tx)));
  }

  close(): Promise<void> {
    return this.pglite.close();
  }
}

/**
 * A database in this process: in memory, or kept in `dataDir` between
 * runs. Needs the optional `@electric-sql/pglite` package.
 */
export async function openPGlite(dataDir?: string): Promise<Db> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const pglite = await PGlite.create(dataDir, {
    // int8 as numbers, as the node-postgres adapter does.
    parsers: { [types.INT8]: (value: string) => Number(value) },
  });
  return new PGliteDb(pglite as unknown as PGliteLike);
}
