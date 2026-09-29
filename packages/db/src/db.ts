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

/** What a request cost the database: how many statements it sent, and how long it waited for them together. */
export interface DbCost {
  statements: number;
  ms: number;
}

/**
 * The same database, counting what a request costs it: every statement
 * (a transaction's BEGIN and COMMIT too, since Hyperdrive counts them; a
 * script as one) and the time waited on each, for the Server-Timing
 * header every answer carries (docs/operations.md, "The statement
 * budget"). Made once per request, so the count is that request's own.
 */
export function measured(db: Db, cost: DbCost = { statements: 0, ms: 0 }, inTransaction = false): Db & { cost: DbCost } {
  const timed = async <T>(work: () => Promise<T>): Promise<T> => {
    cost.statements++;
    const started = performance.now();
    try {
      return await work();
    } finally {
      cost.ms += performance.now() - started;
    }
  };
  return {
    cost,
    query<T>(sql: string, params?: readonly unknown[]) {
      return timed(() => db.query<T>(sql, params));
    },
    exec(sql: string) {
      return timed(() => db.exec(sql));
    },
    transaction<T>(fn: (tx: Db) => Promise<T>) {
      // The outermost transaction's BEGIN and COMMIT; a nested one joins it.
      if (!inTransaction) cost.statements += 2;
      return db.transaction((tx) => fn(measured(tx, cost, true)));
    },
    close: () => db.close(),
  };
}

/** The first row, or null. */
export async function one<T>(db: Db, sql: string, params?: readonly unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}
