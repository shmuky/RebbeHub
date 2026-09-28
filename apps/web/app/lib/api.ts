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

  async events(options: { within?: string; day?: string; limit?: number }) {
    return (await this.get<{ items: Entity[] }>('/v1/events', options)).items;
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
