import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What a change was sent through, when not the person's own hands: one of
 * their personal API tokens (a script) or an app they connected with OAuth
 * (Claude, another agent). Kept on each suggestion, comment, issue and
 * review (migration 0021, `via`), so the site shows it as the agent's work
 * for the person - "Claude · for @shmuly" - the way machine output is
 * labelled until a person checks it.
 *
 * The API says which token a request came with once (services/api/src/tokens.ts,
 * `actingVia`), and everything the request writes picks it up here, so no
 * route has to pass it along by hand. Nothing else sets it: work done on
 * the site's own pages, and the importers' bots, have none.
 */
export interface Via {
  kind: 'token' | 'oauth';
  /** The token (`tok-…`) or the connection (`oac-…`). */
  id: string;
  /** The token's name, or the app's name as it calls itself. */
  name: string;
  /** For a connected app: its client id. */
  client?: string;
}

const current = new AsyncLocalStorage<Via>();

/** Runs `work` with every row it writes marked as sent through `via`. */
export function actingVia<T>(via: Via | null, work: () => Promise<T>): Promise<T> {
  return via ? current.run(via, work) : work();
}

/** What the work under way was sent through, or null for a person's own hands. */
export function currentVia(): Via | null {
  return current.getStore() ?? null;
}

/** The `via` column's value for a row written now: JSON, or null. */
export function viaColumn(): string | null {
  const via = currentVia();
  return via ? JSON.stringify(via) : null;
}
