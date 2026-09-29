import { GeneratedMethods, OPERATIONS, type OperationId, type Operations, type PagedOperationId } from './generated.js';

/**
 * The RebbeHub API from TypeScript (docs/developers/client.md). Every
 * method is generated from the API's OpenAPI document; this file only
 * makes the calls: the address, the token, errors, and walking pages.
 *
 *   const rh = new RebbeHub({ token: process.env.REBBEHUB_TOKEN });
 *   const { results } = await rh.search({ q: 'יו"ד שבט תשי"א' });
 *   for await (const unit of rh.all('listChildren', { id, field: 'work', type: 'unit' })) …
 */

export interface RebbeHubOptions {
  /** The API's address. Default https://api.rebbehub.org. */
  baseUrl?: string;
  /** A personal API token (rhp_…) from the account page; reading needs none. */
  token?: string;
  /** Another fetch (a test's, a Worker's service binding). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Added to every request's User-Agent, to say who is calling (e.g. "my-app/1.0"). */
  userAgent?: string;
}

/** An error the API answered: its status, its code (`not-found`, `rate-limited`…), and its message. */
export class RebbeHubError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
    /** For 429: how many seconds to wait. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'RebbeHubError';
  }
}

interface Meta {
  method: string;
  path: string;
  pathParams: readonly string[];
  query: readonly string[];
  body: string | null;
  answer: 'json' | 'text' | 'raw';
  items?: string;
}

export class RebbeHub extends GeneratedMethods {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetcher: NonNullable<RebbeHubOptions['fetch']>;
  private readonly userAgent?: string;

  constructor(options: RebbeHubOptions = {}) {
    super();
    this.baseUrl = (options.baseUrl ?? 'https://api.rebbehub.org').replace(/\/+$/, '');
    this.token = options.token;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.userAgent = options.userAgent;
  }

  /** Calls one operation by its id, with its path and query parameters (and `body`) in one object. */
  protected async call<K extends OperationId>(operation: K, input: Operations[K]['input']): Promise<Operations[K]['output']> {
    const meta = OPERATIONS[operation] as Meta;
    const values = (input ?? {}) as Record<string, unknown>;
    let path = meta.path;
    for (const name of meta.pathParams) {
      const value = values[name];
      if (value === undefined || value === null || value === '') throw new TypeError(`${operation} needs ${name}`);
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    }
    const search = new URLSearchParams();
    for (const name of meta.query) {
      const value = values[name];
      if (value !== undefined && value !== null) search.set(name, String(value));
    }
    const headers: Record<string, string> = { accept: meta.answer === 'json' ? 'application/json' : '*/*' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.userAgent) headers['user-agent'] = `${this.userAgent} rebbehub-client`;
    let body: BodyInit | undefined;
    if (meta.body && values.body !== undefined) {
      if (meta.body === 'json') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(values.body);
      } else {
        headers['content-type'] = typeof values.contentType === 'string' ? values.contentType : meta.body;
        body = values.body as BodyInit;
      }
    }
    const query = search.toString();
    const response = await this.fetcher(`${this.baseUrl}${path}${query ? `?${query}` : ''}`, { method: meta.method, headers, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
    if (!response.ok && response.status !== 304) {
      const error = (await response.json().catch(() => ({}))) as { error?: string; message?: string; detail?: unknown };
      const wait = Number(response.headers.get('retry-after'));
      throw new RebbeHubError(response.status, error.error ?? 'error', error.message ?? response.statusText, error.detail, Number.isFinite(wait) && wait > 0 ? wait : undefined);
    }
    if (meta.answer === 'raw') return response as Operations[K]['output'];
    if (meta.answer === 'text') return (await response.text()) as Operations[K]['output'];
    return (await response.json()) as Operations[K]['output'];
  }

  /** Every page of a paged list, one after the other, from the first (or from `cursor`). */
  async *pages<K extends PagedOperationId>(operation: K, input: Operations[K]['input']): AsyncGenerator<Operations[K]['output']> {
    let cursor = (input as { cursor?: string }).cursor;
    do {
      const page = await this.call(operation, { ...input, ...(cursor ? { cursor } : {}) } as Operations[K]['input']);
      yield page;
      cursor = (page as { next?: string | null }).next ?? undefined;
    } while (cursor);
  }

  /** Every item of a paged list, fetching pages as they are needed. */
  async *all<K extends PagedOperationId>(operation: K, input: Operations[K]['input']): AsyncGenerator<ItemOf<Operations[K]['output']>> {
    const key = (OPERATIONS[operation] as Meta).items!;
    for await (const page of this.pages(operation, input)) yield* (page as unknown as Record<string, Array<ItemOf<Operations[K]["output"]>>>)[key]!;
  }
}

/** The kind of item a page holds. */
export type ItemOf<Page> = Page extends { items: Array<infer T> } ? T : Page extends { commits: Array<infer T> } ? T : Page extends { suggestions: Array<infer T> } ? T : unknown;
