import pg from 'pg';
import type { Db, QueryResult } from './db.js';

// Postgres int8 (ids, commit numbers) as JavaScript numbers: they stay far below 2^53.
pg.types.setTypeParser(20, (value) => Number(value));

class ClientDb implements Db {
  constructor(private readonly client: pg.PoolClient) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.client.query(sql, params as unknown[]);
    return { rows: result.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}
}

class PoolDb implements Db {
  constructor(private readonly pool: pg.Pool) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params as unknown[]);
    return { rows: result.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new ClientDb(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/** A database over node-postgres: `postgres://…` (Neon, a local server) or a Hyperdrive connection string. */
export function connectPostgres(connectionString: string, options: { max?: number } = {}): Db {
  return new PoolDb(new pg.Pool({ connectionString, max: options.max ?? 10 }));
}
