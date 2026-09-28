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
  mergedByName: string | null;
  changeset: number;
  author: string;
  authorName: string | null;
  authorIsBot: boolean;
  rev: number;
  deleted: boolean;
  created: boolean;
  changes: Array<{ path: string; before?: unknown; after?: unknown }>;
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

/**
 * What a PDF needs to read straight (the API's page fixes): each page it
 * changes, drawn through `transform` (a PDF matrix) and, for a reading
 * copy's placing, cut to `clip`; or the reading copy RebbeHub serves.
 */
export interface PageFixInfo {
  sha256: string;
  encoder: string;
  verdict: 'fixed' | 'as-is' | 'failed';
  reason: string | null;
  pages: Array<{ page: number; angle?: number; transform?: number[]; clip?: number[] }>;
  readingCopy: string | null;
}

/** One comment on a talk page. */
export interface TalkComment {
  id: number;
  parent: number | null;
  author: string;
  authorName: string;
  body: string | null;
  at: string;
  hidden: boolean;
}

/** One page of a scan's text, as GET /v1/scans/:id/text gives it. */
export interface ScanText {
  scan: string;
  page: number;
  pages: number;
  machine: boolean;
  engine: { name: string; version: string } | null;
  lines: Array<{ id: string; text: string; checked: boolean }>;
}

/** A project working through a gap, with its progress. */
/** A file Sichos-Kodesh's archive wants and upstream would not give. */
export interface ArchiveGap {
  collection: string;
  item_id: string;
  kind: string;
  role: string;
  source: string;
  url: string;
  label: string | null;
  hebrew_date: string | null;
  status: 'unresolved' | 'error';
  http_status: number | null;
  checked_at: string | null;
  entity: Entity | null;
}

export interface Project {
  id: number;
  slug: string;
  name: string;
  goal: string | null;
  set: string | null;
  status: 'open' | 'merged' | 'closed';
  focus: { missing: 'recordings' | 'texts'; within?: string };
  creatorName: string | null;
  createdAt: string;
  total: number;
  done: number;
}

/** Where a search's words are: a line on a scan's page, or a paragraph of a text or transcript (with when it is heard). */
export type Moment =
  | { kind: 'scan-line'; id: string; scan: string; publication: string | null; page: number; line: { id: string; text: string }; hits: string[]; machine: boolean }
  | {
      kind: 'paragraph';
      id: string;
      text: string;
      textKind: string;
      unit: string | null;
      recording: string | null;
      event: string | null;
      startMs: number | null;
      snippet: string;
      hits: string[];
      machine: boolean;
    };

/** One item found by meaning: always the machine's choice. */
export interface SimilarItem {
  score: number;
  item: Entity;
  moment: Moment | null;
  machine: true;
}

/** One of an item's links, seen from the item. */
export interface RelationLink {
  id: string;
  kind: string;
  direction: 'in' | 'out';
  other: string;
  at: string | null;
  note: string | null;
  machine: boolean;
}

/** The health of the catalog, as GET /v1/health gives it. */
export interface CatalogHealth {
  years: Array<{ year: number; events: number; withRecording: number; withText: number; withTranscript: number }>;
  sets: Array<{ id: string; path: string | null; name: { he: string; en?: string } | null; items: number; byType: Record<string, number> }>;
  pages: { total: number; checked: number };
  uncheckedScans: Array<{ scan: string; publication: string | null; title: { he: string; en?: string } | null; pages: number; checked: number }>;
  recordings: { total: number; transcribed: number; synced: number };
  unsynced: Array<{ id: string; path: string | null; title: { he: string; en?: string } | null; event: string | null }>;
  openSuggestions: Array<{ id: number; title: string; author: string; authorName: string; authorIsBot: boolean; submittedAt: string }>;
  links: { checked: number; dead: number; lastChecked: string | null };
  deadLinks: Array<{ url: string; status: number | null; error: string | null; checkedAt: string; failingSince: string | null; entities: string[] }>;
  embeddings: { embedded: number; waiting: number };
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

  /** Like `forward`, for a file: the body streams through as bytes, never read as text. */
  async forwardUpload(path: string, request: Request): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' });
    for (const name of ['content-type', 'content-length', 'cookie', 'origin', 'user-agent', 'x-forwarded-proto']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('x-forwarded-proto')) headers.set('x-forwarded-proto', new URL(request.url).protocol.replace(':', ''));
    return this.fetcher(`${this.baseUrl}${path}${new URL(request.url).search}`, { method: 'POST', headers, body: request.body, duplex: 'half' } as RequestInit);
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
  /** The Missing board: farbrengens without recordings or texts (of a year), or sefarim without a scan. */
  missing(kind: 'recordings' | 'texts' | 'scans', options: { within?: string; limit?: number } = {}) {
    return this.get<{ kind: string; total: number; items: Entity[] }>('/v1/missing', { kind, within: options.within, limit: options.limit });
  }

  /** The files Sichos-Kodesh's archive could not get from upstream, each with its item when RebbeHub has it. */
  missingFiles(options: { limit?: number } = {}) {
    return this.get<{ kind: 'files'; total: number; items: ArchiveGap[] }>('/v1/missing', { kind: 'files', limit: options.limit });
  }

  projects() {
    return this.get<{ projects: Project[] }>('/v1/projects');
  }

  project(slug: string) {
    return this.maybe(this.get<{ project: Project; next: Entity[] }>(`/v1/projects/${encodeURIComponent(slug)}`));
  }

  community(limit?: number) {
    return this.get<{
      recent: Array<{ seq: number; at: string; message: string; author: string; authorName: string; authorIsBot: boolean; mergedBy: string; mergedByName: string | null; changes: number }>;
      openReports: number;
      openSuggestions: number;
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

  /** Where the words are in the texts: lines on scans, paragraphs of transcripts. */
  async moments(q: string, limit?: number) {
    return (await this.get<{ moments: Moment[] }>('/v1/search/moments', { q, limit })).moments;
  }

  /** Search by meaning; `available` is false until it is set up. */
  similar(q: string, options: { types?: string[]; limit?: number } = {}) {
    return this.get<{ available: boolean; model?: string; results: SimilarItem[] }>('/v1/search/similar', { q, types: options.types?.join(','), limit: options.limit });
  }

  /** An item's links both ways: what it cites, where it was printed, what cites it. */
  async relations(id: string) {
    return (await this.get<{ relations: RelationLink[] }>(`/v1/entities/${encodeURIComponent(id)}/relations`)).relations;
  }

  health() {
    return this.get<CatalogHealth>('/v1/health');
  }

  /** Events by date, each with how many recordings it has: within a year or month, on days of any year (`05-10`), or on exact dates. */
  async events(options: { within?: string; day?: string | readonly string[]; dates?: readonly string[]; missing?: 'recordings' | 'texts'; limit?: number }) {
    const list = (v: string | readonly string[] | undefined) => (v === undefined ? undefined : typeof v === 'string' ? v : v.join(','));
    return (await this.get<{ items: Array<Entity & { recordings: number }> }>('/v1/events', { within: options.within, day: list(options.day), dates: list(options.dates), missing: options.missing, limit: options.limit })).items;
  }

  /** One page of a scan's text; null when the scan has not been read, or its text is withheld. */
  scanText(scan: string, page: number) {
    return this.maybe(this.get<ScanText>(`/v1/scans/${encodeURIComponent(scan)}/text`, { page }));
  }

  /** A page's talk page: the conversation about it. */
  talk(id: string) {
    return this.get<{ talk: TalkComment[] }>(`/v1/entities/${encodeURIComponent(id)}/talk`);
  }

  file(sha256: string) {
    return this.maybe(this.get<FileInfo>(`/v1/files/${sha256}`));
  }

  /** What a PDF on Google Drive needs to read straight, by its Drive id; null when nothing is known of it. */
  pageFix(driveFileId: string) {
    return this.maybe(this.get<PageFixInfo>(`/v1/page-fixes/drive/${encodeURIComponent(driveFileId)}`));
  }

  async report(input: { entityId?: string; reason: string; note?: string }, forwardedFor?: string): Promise<{ id: number }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
    const response = await this.fetcher(`${this.baseUrl}/v1/reports`, { method: 'POST', headers, body: JSON.stringify(input) });
    const body = (await response.json().catch(() => ({}))) as { id?: number; message?: string };
    if (!response.ok) throw new ApiError(response.status, body.message ?? response.statusText);
    return { id: body.id! };
  }

  /** A takedown request from the public form (no account), with the asker's address for rate limits. */
  async takedown(input: { target: string; name: string; email: string; relation: string; statement: string }, forwardedFor?: string): Promise<{ id: number }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
    const response = await this.fetcher(`${this.baseUrl}/v1/takedowns`, { method: 'POST', headers, body: JSON.stringify(input) });
    const body = (await response.json().catch(() => ({}))) as { id?: number; message?: string };
    if (!response.ok) throw new ApiError(response.status, body.message ?? response.statusText);
    return { id: body.id! };
  }
  /** What a mirror needs: the git mirror, the release keys, every edition's dumps (services/api/src/mirrors.ts). */
  async mirrors() {
    return this.get<MirrorsInfo>('/v1/mirrors');
  }
}

export interface MirrorsInfo {
  git: string[];
  dumps: string;
  keys: Array<{ alg: string; keyId: string; publicKey: string }>;
  others: Array<{ name: string; url: string }>;
  editions: Array<{
    tag: string;
    commit_seq: number;
    created_at: string;
    notes: string | null;
    dumps: { files: Array<{ name: string; bytes: number; sha256: string; url: string }>; manifest: string; sha256sums: string; signature: { alg: string; keyId: string } | null } | null;
  }>;
}
