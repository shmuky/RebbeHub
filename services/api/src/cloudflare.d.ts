/**
 * The little of the Workers runtime's own module the API uses: a named
 * entrypoint class (worker.ts). Declared here rather than taking all of
 * @cloudflare/workers-types, whose globals would clash with the DOM's.
 */
declare module 'cloudflare:workers' {
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected ctx: { waitUntil(promise: Promise<unknown>): void };
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
