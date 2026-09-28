import type { EntityType } from '@rebbehub/model';

/**
 * The site reads the catalog through the public API (services/api), like
 * any other client would: nothing the site shows is out of reach of anyone
 * else. `fetch` is injectable so tests (and a Worker with a service
 * binding) can call the API without the network.
 */

export interface Entity<T = Record<string, unknown>> {
  id: string;
  type: EntityType | string;
  path: string | null;
  rev: number;
  data: T;
  /** Set when the words are held back by rights: the item is listed, its text is not served. */
  withheld?: string;
}

export interface HistoryEntry {
  commit: number;
  at: string;
  message: string;
  mergedBy: string;
  changeset: number;
  author: string;
  rev: number;
  deleted: boolean;
}

export interface Backlink {
  from: string;
  type: string;
  field: string;
  path: string | null;
}

export interface FileInfo {
  sha256: string;
  bytes: number;
  mime: string;
  rights: 'open' | 'credit' | 'link' | 'preserved';
  credit: string | null;
  url: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class RebbeHubApi {
  constructor(
    readonly baseUrl: string,
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
  ) {}

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const response = await this.fetcher(`${this.baseUrl}${path}${query ? `?${query}` : ''}`, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new ApiError(response.status, body.message ?? response.statusText);
    }
    return (await response.json()) as T;
  }

  /**
   * Passes a browser's request through to the API as it is (sign-in):
   * its method, body, cookie and Origin go, and the API's answer comes back
   * whole, Set-Cookie and all.
   */
  async forward(path: string, request: Request): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' });
    for (const name of ['content-type', 'cookie', 'origin', 'user-agent', 'x-forwarded-proto']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('x-forwarded-proto')) headers.set('x-forwarded-proto', new URL(request.url).protocol.replace(':', ''));
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    // A redirect (to Google and back) is the browser's to follow, not ours.
    return this.fetcher(`${this.baseUrl}${path}${new URL(request.url).search}`, { method: request.method, headers, body, redirect: 'manual' });
  }

  /** Null when there is nothing there. */
  private async maybe<T>(promise: Promise<T>): Promise<T | null> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  info() {
    return this.get<{ name: string; version: string; head: number }>('/v1');
  }

  stats() {
    return this.get<{ head: number; counts: Record<string, number> }>('/v1/stats');
  }

  entity<T = Record<string, unknown>>(id: string) {
    return this.maybe(this.get<Entity<T>>(`/v1/entities/${encodeURIComponent(id)}`));
  }

  async entities(ids: readonly string[]): Promise<Map<string, Entity>> {
    const unique = [...new Set(ids)].filter((id) => /^rh-[0-9a-z]+$/.test(id));
    const out = new Map<string, Entity>();
    for (let i = 0; i < unique.length; i += 200) {
      const { items } = await this.get<{ items: Entity[] }>('/v1/entities/batch', { ids: unique.slice(i, i + 200).join(',') });
      for (const item of items) out.set(item.id, item);
    }
    return out;
  }

  list(options: { type?: string; set?: string; after?: string; limit?: number }) {
    return this.get<{ items: Entity[]; next: string | null }>('/v1/entities', options);
  }

  children(id: string, field: string, type: string, options: { after?: string; limit?: number } = {}) {
    return this.get<{ items: Entity[]; next: string | null }>(`/v1/entities/${encodeURIComponent(id)}/children`, { field, type, ...options });
  }

  /** The community page in numbers: the latest merges, reports waiting, people, and what the catalog lacks. */
  community(limit?: number) {
    return this.get<{
      recent: Array<{ seq: number; at: string; message: string; author: string; authorName: string; authorIsBot: boolean; mergedBy: string; mergedByName: string | null; changes: number }>;
      openReports: number;
      people: number;
      gaps: { events: number; eventsWithoutRecordings: number; eventsWithoutTexts: number };
    }>('/v1/community', { limit });
  }

  /** How many items point at each item through a field (`work` + `unit`: each work's units). */
  async refCounts(field: string, type?: string): Promise<Record<string, number>> {
    return (await this.get<{ counts: Record<string, number> }>('/v1/refcounts', { field, type })).counts;
  }

  /** A work's volumes, with how many units each holds. */
  async workOutline(id: string) {
    return (await this.get<{ parts: Array<{ value: string; label: { he: string; en?: string } | null; units: number }> }>(`/v1/works/${encodeURIComponent(id)}/outline`)).parts;
  }

  /** The units of one volume of a work. */
  async workPart(id: string, part: string) {
    return (await this.get<{ items: Entity[] }>(`/v1/works/${encodeURIComponent(id)}/parts/${encodeURIComponent(part)}`)).items;
  }

  async backlinks(id: string, options: { field?: string; type?: string } = {}) {
    return (await this.get<{ backlinks: Backlink[] }>(`/v1/entities/${encodeURIComponent(id)}/backlinks`, options)).backlinks;
  }

  async history(id: string) {
    return (await this.get<{ history: HistoryEntry[] }>(`/v1/entities/${encodeURIComponent(id)}/history`)).history;
  }

  resolve(path: string) {
    return this.maybe(this.get<{ id: string; redirected: boolean; path: string | null }>('/v1/resolve', { path }));
  }

  search(q: string, options: { type?: string; limit?: number } = {}) {
    return this.get<{ query: string; date: { key: string; he: string; en: string } | null; results: Entity[] }>('/v1/search', { q, ...options });
  }

  /** Events by date, each with how many recordings it has: within a year or month, on days of any year (`05-10`), or on exact dates. */
  async events(options: { within?: string; day?: string | readonly string[]; dates?: readonly string[]; missing?: 'recordings' | 'texts'; limit?: number }) {
    const list = (v: string | readonly string[] | undefined) => (v === undefined ? undefined : typeof v === 'string' ? v : v.join(','));
    return (await this.get<{ items: Array<Entity & { recordings: number }> }>('/v1/events', { within: options.within, day: list(options.day), dates: list(options.dates), missing: options.missing, limit: options.limit })).items;
  }

  file(sha256: string) {
    return this.maybe(this.get<FileInfo>(`/v1/files/${sha256}`));
  }

  async report(input: { entityId?: string; reason: string; note?: string }, forwardedFor?: string): Promise<{ id: number }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
    const response = await this.fetcher(`${this.baseUrl}/v1/reports`, { method: 'POST', headers, body: JSON.stringify(input) });
    const body = (await response.json().catch(() => ({}))) as { id?: number; message?: string };
    if (!response.ok) throw new ApiError(response.status, body.message ?? response.statusText);
    return { id: body.id! };
  }
}
