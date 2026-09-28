/**
 * The one thing the rest of RebbeHub needs from a database: run a
 * statement with parameters, run a script, and run a function in a
 * transaction. Adapters: node-postgres (production on Neon, Workers
 * through Hyperdrive) and PGlite (Postgres compiled to WebAssembly, for
 * tests and for trying RebbeHub locally with nothing installed).
 */
export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** Runs a script of several statements, without parameters. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in a transaction: committed when it returns, rolled back when it throws. Nested calls join the outer transaction. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The first row, or null. */
export async function one<T>(db: Db, sql: string, params?: readonly unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}
