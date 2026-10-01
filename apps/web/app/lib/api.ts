import type { Issue, IssueLabel, IssueRights, IssueTemplate, People, SuggestionListItem, TimelineItem, Via } from './threads.js';
import type { EntityType, LocalName } from '@rebbehub/model';

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
  /** Sent by an agent for its author (a token, a connected app). */
  via?: Via | null;
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
  /** How many of a served PDF's pages have page images (the jobs' `page-images`). */
  pageImages?: number;
}

/** A hanacha synced to a recording: its paragraphs, each with where it is heard (GET /v1/recordings/:id/hanacha). */
export interface HanachaSync {
  text: string;
  alignment: string;
  paragraphs: Array<{ id: string; content: string; startMs: number | null; endMs: number | null; checked: boolean }>;
}

/** A served scan's page images, and its IIIF manifest (GET /v1/scans/:id/pages). */
export interface ScanPages {
  scan: string;
  manifest: string | null;
  pages: Array<{ page: number; width: number; height: number; image: string; thumbnail: string | null }>;
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
  /** How far the page is proofread: 0 not yet, 1 once, 2 twice. */
  level: 0 | 1 | 2;
  lines: Array<{ id: string; text: string; checked: boolean; level: 0 | 1 | 2 }>;
  layers: Array<{ id: string; kind: 'machine-ocr' | 'uploaded-ocr' | 'community'; engine: { name: string; version: string } | null; uploadedBy: string | null; seeds: boolean }>;
}

/** One thing to do in a project, as GET /v1/projects/:slug lists them. */
export interface ProjectItem {
  item: string;
  kind: 'event' | 'recording' | 'page';
  id: string | null;
  page?: number;
  date?: string | null;
  title?: LocalName | null;
  event?: string | null;
  level?: number;
  claimedBy?: string | null;
}

/** A printing of a unit whose text can be compared. */
export interface Printing {
  key: string;
  label: LocalName;
  publication: string | null;
  kind: 'text' | 'scan';
  checked: boolean;
}

/** Two printings compared word by word. */
export interface Comparison {
  a: { key: string; checked: boolean };
  b: { key: string; checked: boolean };
  runs: Array<{ op: 'same' | 'removed' | 'added'; text: string }>;
  same: number;
  removed: number;
  added: number;
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
  focus: { missing: 'recordings' | 'texts' | 'sync' | 'proofreading'; within?: string; scan?: string; level?: 1 | 2 };
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
/** A group of items pointing at one item through one field (a set's sefarim, a farbrengen's recordings). */
export interface LinkGroup {
  type: string;
  field: string;
  count: number;
}

/** A sefer's cover, drawn from a page of a served PDF; `machine` until a person chose the page. */
export interface Cover {
  file: string;
  page: number;
  machine: boolean;
  reasons: string[];
  credit: string | null;
  image: { url: string; width: number; height: number };
  thumb: { url: string; width: number; height: number };
}

export interface WorkCover {
  work: string;
  chosen: { file: string; page: number } | null;
  cover: Cover | null;
  sources: Array<{ sha256: string; via: string; item: string; pages: number | null }>;
}

export interface FileAbout {
  sha256: string;
  bytes: number;
  mime: string;
  rights: FileInfo['rights'];
  credit: string | null;
  storage: string;
  url: string | null;
  createdAt: string;
  sources: Array<{ source: string; url: string | null; fetchedAt: string | null; attestation: string | null; uploaded: boolean; at: string }>;
  derivations: Array<{ profile: string; sha256: string; bytes: number; encoder: string }>;
  derivedFrom: Array<{ profile: string; sha256: string }>;
  measured: { kind: 'pdf-pages' | 'audio'; pages: number | null; durationMs: number | null; encoder: string } | null;
  pageImages: number;
  pageFix: { verdict: string; reason: string | null; encoder: string } | null;
  covers: Array<{ entity: string; page: number; machine: boolean }>;
  usedBy: { total: number; items: Entity[] };
}

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

/** What the machines wrote that no person has checked yet, as GET /v1/machine/to-check gives it, the newest first. */
/** A place a subject index names: the page, the index's own words for it, the sicha's PDF at that page and its page here. */
export interface MafteachPlace {
  page: number;
  to?: number;
  context?: string;
  pdf?: string;
  at?: number;
  sicha?: string;
  text?: string;
}

/** A sefer's whole subject index (GET /v1/mafteach): one letter's topics or a search's, each volume's places under each. */
export interface Mafteach {
  index: { id: string; path: string | null; title: unknown };
  letters: Array<{ letter: string; topics: number }>;
  totals: { topics: number; places: number; volumes: number };
  topics: Array<{ topic: string; letter: string; volumes: Array<{ volume: number; label: string; path: string | null; machine: boolean; places: MafteachPlace[] }> }>;
  found: number;
  offset: number;
  next: number | null;
}

export interface MachineToCheck {
  transcripts: Array<{ event: string; path: string | null; title: { he: string; en?: string } | null; date: string | null; paragraphs: number; checked: number; made: string }>;
  scans: Array<{ scan: string; publication: string | null; title: { he: string; en?: string } | null; pages: number; checked: number; made: string }>;
  /** Pages whose words a machine read (a subject index read from its scan), checked on their edit page. */
  texts: Array<{ entity: string; type: string; path: string | null; title: { he: string; en?: string } | null; label: { he: string; en?: string } | null; segments: number; checked: number; made: string }>;
  totals: { transcripts: number; paragraphs: number; scans: number; pages: number; texts: number; entries: number };
}

/** Whether RebbeHub is up, as GET /v1/status gives it (services/api/src/status.ts). */
export type CheckId = 'site' | 'api' | 'mcp' | 'database' | 'quota' | 'workers' | 'jobs';
export type CheckState = 'up' | 'degraded' | 'down' | 'unknown';
/** One Worker's load today: its requests, how many were stopped for CPU (error 1102), and the CPU a request takes. */
export interface WorkerLoad {
  script: string;
  requests: number;
  errors: number;
  exceeded: number;
  cpuP50Ms: number | null;
  cpuP99Ms: number | null;
}
export interface StatusReport {
  checkedAt: string;
  state: CheckState;
  checks: Array<{ id: CheckId; state: CheckState; ms: number | null; detail: string | null }>;
  quota: { used: number; limit: number | null; resetsAt: string; runsOutAt: string | null } | null;
  /** Missing in reports made before it was measured. */
  workers?: WorkerLoad[] | null;
  days: Array<{ date: string; checks: Partial<Record<CheckId, { runs: number; up: number; degraded: number; down: number }>> }>;
  incidents: Array<{ check: CheckId; state: 'degraded' | 'down'; from: string; to: string | null; detail: string | null }>;
}

/** A suggestion as GET /v1/suggestions lists it. */
export interface SuggestionRow {
  id: number;
  /** Its #number, shared with issues; imports have none. */
  number?: number | null;
  title: string;
  description: string | null;
  author: string;
  status: 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn';
  kind: 'suggestion' | 'import' | 'revert' | 'live';
  post_review: 'pending' | 'done' | null;
  project_id?: number | null;
  submitted_at: string | null;
  created_at: string;
  closed_at?: string | null;
  merged_commit?: number | null;
  /** On its page: the checks that did not pass, of that page's items and of the whole, and the count of all of them. A list carries neither. */
  checks?: Array<{ check: string; status: 'pass' | 'warn' | 'fail'; message: string; entityId?: string; path?: string }>;
  checkCounts?: { pass: number; warn: number; fail: number };
  /** Sent by an agent for its author (a token, a connected app). */
  via?: Via | null;
  /** How many items it changes (in the API's list). */
  items?: number;
}

/** Items a suggestion changes in the same way ("500 units: links on the media proxy became links on Drive"), with a few to look at. */
export interface ChangeGroup {
  type: string;
  kind: 'new' | 'deleted' | 'changed';
  count: number;
  /** Each field's place, and what it was and became: a kind ("text", "list", "none") or "link:" and the sites the links point to. */
  fields: Array<{ path: string; before: string; after: string }>;
  examples: string[];
}

/** One change a suggestion makes to one item. */
export interface SuggestionEntry {
  entityId: string;
  type: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: Array<{ path: string; before?: unknown; after?: unknown }>;
  conflicts: unknown[];
  withheld?: string;
}

/** A suggestion as GET /v1/suggestions/:id gives it, for its page. */
export interface SuggestionDetail {
  changeset: SuggestionRow;
  entries: SuggestionEntry[];
  reviews: Array<{ reviewer: string; verdict: 'approve' | 'send_back' | 'comment'; body: string | null; created_at: string }>;
  names: Record<string, string>;
  /** The items its changes point at (a part moved to another sefer), by what they are called. */
  items?: Record<string, { type: string; data: Record<string, unknown> }>;
  files: Record<string, { url: string | null; mime: string; bytes: number; rights: string; similar?: Array<{ kind: 'same' | 'shares'; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null }> }> }>;
  mayApprove: boolean;
  mayApproveReason?: string | null;
  mine: boolean;
  /** The reviewer's advice, written by a machine (null until one has been written). */
  advice: { summary: string; model: string; at: string; machine: true } | null;
  /** `entries` is a page of the items, from `offset`: how many there are in all, and where the next page starts (null: none). */
  total?: number;
  offset?: number;
  next?: number | null;
  /** Every item, grouped by how it changes. */
  summary?: ChangeGroup[];
  /** Who wrote it: a person, or a bot. */
  people?: Record<string, { name: string; username: string | null; bot: boolean }>;
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

  /** Every sitemap there is: each kind of item with a page, cut into pages, with when each last changed. */
  sitemaps() {
    return this.get<{ pageSize: number; sitemaps: Array<{ type: string; page: number; count: number; lastmod: string | null }> }>('/v1/sitemap');
  }

  /** One sitemap's items; null when there is no such page. */
  sitemapPage(type: string, page: number) {
    return this.maybe(this.get<{ items: Array<{ id: string; path: string | null; lastmod: string | null }> }>(`/v1/sitemap/${encodeURIComponent(type)}/${page}`));
  }

  /** The API's own description of itself (OpenAPI 3.1), for the developer docs. */
  openapi<T = Record<string, unknown>>() {
    return this.get<T>('/openapi.json');
  }

  /** The catalog as a tree (for organizing it): the top sets, or one set or sefer with what is under it and how much each holds. */
  tree(root?: string, depth = 1, limit = 500) {
    return this.get<{ root: import('./organize.js').TreeNode | null; children: import('./organize.js').TreeNode[]; more: number }>('/v1/tree', { root, depth, limit });
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

  /** `shelf`: what a shelf lists, without the additions that belong on a sefer's page (core additions.ts). */
  list(options: { type?: string; set?: string; after?: string; limit?: number; shelf?: boolean }) {
    const { shelf, ...rest } = options;
    return this.get<{ items: Entity[]; next: string | null }>('/v1/entities', { ...rest, shelf: shelf ? 1 : undefined });
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
    return this.maybe(this.get<{ project: Project; next: Entity[]; todo: ProjectItem[] }>(`/v1/projects/${encodeURIComponent(slug)}`));
  }

  /** How far each page of a scan is proofread; null when it has not been read. */
  scanProgress(scan: string) {
    return this.maybe(this.get<{ pages: number; levels: Array<0 | 1 | 2> }>(`/v1/scans/${encodeURIComponent(scan)}/progress`));
  }

  /** The printings of a unit whose text the catalog has. */
  async printings(unit: string) {
    return (await this.get<{ printings: Printing[] }>(`/v1/units/${encodeURIComponent(unit)}/printings`)).printings;
  }

  /** Two printings compared word by word; null when one of them is not there (or withheld). */
  compare(a: string, b: string) {
    return this.maybe(this.get<Comparison>('/v1/compare', { a, b }));
  }

  community(limit?: number) {
    return this.get<{
      recent: Array<{ seq: number; at: string; message: string; author: string; authorName: string; authorIsBot: boolean; via?: Via | null; mergedBy: string; mergedByName: string | null; changes: number }>;
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

  /** A day's learning (Chitas: Tanya cut to the day's portion, Chumash and Tehillim; Hayom Yom; the Rambam's three tracks), for a civil day: one read. */
  daily(date: string) {
    return this.get<DailyLearning>('/v1/daily', { date });
  }

  /** A work's volumes, with how many units each holds. */
  async workOutline(id: string) {
    return (await this.get<{ parts: Array<{ value: string; label: { he: string; en?: string } | null; units: number }> }>(`/v1/works/${encodeURIComponent(id)}/outline`)).parts;
  }

  /** The units of one volume of a work. */
  async workPart(id: string, part: string) {
    return (await this.get<{ items: Entity[] }>(`/v1/works/${encodeURIComponent(id)}/parts/${encodeURIComponent(part)}`)).items;
  }

  /** The units just before and after a unit in its work's order, across volumes: a sicha's back and forth. */
  unitNeighbours(id: string) {
    return this.get<{ previous: Entity | null; next: Entity | null }>(`/v1/units/${encodeURIComponent(id)}/neighbours`);
  }

  /** One group of what points at each of several items, a few of each, in one request (a sefer's sichos' texts): by item, in the group's order. */
  async linkedOfEach(ids: readonly string[], options: { field: string; type?: string; limit?: number }): Promise<Map<string, Entity[]>> {
    const unique = [...new Set(ids)].filter((id) => /^rh-[0-9a-z]+$/.test(id));
    const out = new Map<string, Entity[]>();
    for (let i = 0; i < unique.length; i += 200) {
      const { linked } = await this.get<{ linked: Record<string, Entity[]> }>('/v1/entities/batch/linked', { ids: unique.slice(i, i + 200).join(','), ...options });
      for (const [id, items] of Object.entries(linked)) out.set(id, items);
    }
    return out;
  }

  /** How many paragraphs each of several texts has and how many a person checked, in one request; texts without any are left out. */
  async textsProgress(ids: readonly string[]): Promise<Map<string, { paragraphs: number; checked: number }>> {
    const unique = [...new Set(ids)].filter((id) => /^rh-[0-9a-z]+$/.test(id));
    const out = new Map<string, { paragraphs: number; checked: number }>();
    for (let i = 0; i < unique.length; i += 200) {
      const { progress } = await this.get<{ progress: Record<string, { paragraphs: number; checked: number }> }>('/v1/texts/batch/progress', { ids: unique.slice(i, i + 200).join(',') });
      for (const [id, p] of Object.entries(progress)) out.set(id, p);
    }
    return out;
  }

  async backlinks(id: string, options: { field?: string; type?: string } = {}) {
    return (await this.get<{ backlinks: Backlink[] }>(`/v1/entities/${encodeURIComponent(id)}/backlinks`, options)).backlinks;
  }

  /** What points at an item, by type and field, with how many of each (an item page's "all of it"). */
  async linkedCounts(id: string) {
    return (await this.get<{ groups: LinkGroup[] }>(`/v1/entities/${encodeURIComponent(id)}/linked/counts`)).groups;
  }

  /** One group of what points at an item, in its own order, a page at a time, with the total. */
  linked(id: string, options: { field: string; type?: string; after?: string; limit?: number }) {
    const { after, ...rest } = options;
    return this.get<{ items: Entity[]; total: number; next: string | null }>(`/v1/entities/${encodeURIComponent(id)}/linked`, { ...rest, cursor: after });
  }

  /** Sefarim's covers from their title pages, by id; none for those without one. */
  async covers(ids: readonly string[]): Promise<Record<string, Cover>> {
    const unique = [...new Set(ids)].filter((id) => /^rh-[0-9a-z]+$/.test(id));
    const out: Record<string, Cover> = {};
    for (let i = 0; i < unique.length; i += 200) Object.assign(out, (await this.get<{ covers: Record<string, Cover> }>('/v1/covers', { ids: unique.slice(i, i + 200).join(',') })).covers);
    return out;
  }

  /** A sefer's cover and the served PDFs a keeper may choose its title page from. */
  workCover(id: string) {
    return this.maybe(this.get<WorkCover>(`/v1/works/${encodeURIComponent(id)}/cover`));
  }

  /** A sefer's shaar file (docs/shaar.md), and whether the catalog made it. */
  shaar(id: string) {
    return this.maybe(this.get<{ text: string; machine: boolean }>(`/v1/entities/${encodeURIComponent(id)}/shaar`));
  }

  /** A file's own page. */
  fileAbout(sha256: string, limit?: number) {
    return this.maybe(this.get<FileAbout>(`/v1/files/${encodeURIComponent(sha256)}/about`, { limit }));
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

  /** A sefer's whole subject index gathered from its volumes' index pages: one letter's topics, or a search's. */
  mafteach(params: { index: string; sefer?: string; letter?: string; q?: string; limit?: number; places?: number; offset?: number }) {
    return this.get<Mafteach>('/v1/mafteach', params);
  }

  toCheck(limit?: number) {
    return this.get<MachineToCheck>('/v1/machine/to-check', { limit });
  }

  /** The status checks' last report; it never asks the database. */
  status() {
    return this.get<{ now: string; report: StatusReport | null }>('/v1/status');
  }

  /**
   * Events by date, each with how many recordings it has: within a year or month, on days of any year (`05-10`), or on
   * exact dates. `brief` keeps of each one's links the kind alone: what a row shows, at well under half the bytes.
   */
  async events(options: { within?: string; day?: string | readonly string[]; dates?: readonly string[]; missing?: 'recordings' | 'texts'; limit?: number; brief?: boolean }) {
    const list = (v: string | readonly string[] | undefined) => (v === undefined ? undefined : typeof v === 'string' ? v : v.join(','));
    return (await this.get<{ items: Array<Entity & { recordings: number }> }>('/v1/events', { within: options.within, day: list(options.day), dates: list(options.dates), missing: options.missing, limit: options.limit, brief: options.brief ? '1' : undefined })).items;
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

  /** Several files in one request (a farbrengen's parts, a printing's scans), by sha256; missing ones left out. */
  async files(sha256s: readonly string[]): Promise<Map<string, FileInfo>> {
    const ids = [...new Set(sha256s)].slice(0, 200);
    if (ids.length === 0) return new Map();
    const { items } = await this.get<{ items: FileInfo[] }>('/v1/files/batch', { ids: ids.join(',') });
    return new Map(items.map((f) => [f.sha256, f]));
  }

  /** A served scan's page images; null when it has none or is not served. */
  scanPages(scan: string) {
    return this.maybe(this.get<ScanPages>(`/v1/scans/${encodeURIComponent(scan)}/pages`));
  }

  /** A family's request that a teshura not be shown (no account needed, like a report). */
  async familyRequest(teshura: string, input: { relation?: string; note?: string; contact?: string }, forwardedFor?: string): Promise<{ report: number; paused: number }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
    const response = await this.fetcher(`${this.baseUrl}/v1/teshuros/${encodeURIComponent(teshura)}/family-request`, { method: 'POST', headers, body: JSON.stringify(input) });
    const body = (await response.json().catch(() => ({}))) as { report?: number; paused?: number; message?: string };
    if (!response.ok) throw new ApiError(response.status, body.message ?? response.statusText);
    return { report: body.report!, paused: body.paused ?? 0 };
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
  /** Suggestions, oldest first (public): by status, author, or those live and waiting for review after. */
  async suggestions(options: { status?: string; author?: string; postReview?: boolean; limit?: number } = {}) {
    return (await this.get<{ suggestions: SuggestionRow[] }>('/v1/suggestions', { status: options.status, author: options.author, postReview: options.postReview ? 'true' : undefined, limit: options.limit })).suggestions;
  }

  /** One suggestion with a page of its changes (25 unless `limit` says), reviews and who wrote them; null when there is none. */
  /** A suggestion's review view, a page of items at a time; `summary` (every item grouped by how it changes) only when asked, since it reads them all. */
  /** A page of a suggestion's items; `summary` groups every item by how it changes (the review page), `brief` gives each item's facts without its words (a feed). */
  suggestion(id: number, options: { offset?: number; limit?: number; summary?: boolean; brief?: boolean } = {}) {
    const { summary, brief, ...rest } = options;
    return this.maybe(this.get<SuggestionDetail>(`/v1/suggestions/${id}`, { ...rest, ...(summary ? { summary: '1' } : {}), ...(brief ? { brief: '1' } : {}) }));
  }

  /** The commits after `since`, oldest first, each with the items it changed (as they became), or with `changes` only so many of them (`changed` and `types` count them all). */
  async commits(since: number, limit = 20, changes?: number) {
    return (await this.get<{ commits: Array<{ seq: number; at: string; message: string; mergedBy: string; author: string; via?: Via | null; changed?: number; types?: string[]; changes: Array<{ id: string; type: string; path: string | null; rev: number; data: Record<string, unknown> | null }> }> }>('/v1/commits', { since, limit, changes })).commits;
  }

  /** What a mirror needs: the git mirror, the release keys, every edition's dumps (services/api/src/mirrors.ts). */
  async mirrors() {
    return this.get<MirrorsInfo>('/v1/mirrors');
  }

  /** Issues, newest first, with open and closed counts (public ones, and private ones the asker may read). */
  issues(options: { state?: 'open' | 'closed' | 'all'; label?: string; type?: string; set?: string; entity?: string; assignee?: string; author?: string; q?: string; limit?: number; cursor?: string } = {}) {
    return this.get<{ items: Issue[]; people: People; counts: { open: number; closed: number }; next: string | null }>('/v1/issues', options);
  }

  /** Suggestions as conversations, newest first by number, with reviewers and approvals and open and closed counts. */
  conversations(options: { state?: 'open' | 'closed' | 'all'; author?: string; reviewer?: string; q?: string; about?: readonly string[]; limit?: number; cursor?: string } = {}) {
    // `about`: only suggestions that change these items, or what is in them (the API matches them in one query).
    const { about, ...rest } = options;
    return this.get<{ suggestions: SuggestionListItem[]; people: People; counts: { open: number; closed: number }; next: string | null }>('/v1/suggestions', { state: 'open', ...rest, ...(about?.length ? { about: about.join(',') } : {}) });
  }

  /** Who these accounts are (a set's keepers): name and handle; an API from before handles gives none. */
  async peopleByIds(ids: readonly string[]) {
    if (!ids.length) return [];
    return (await this.get<{ people: Array<{ id: string; username: string | null; displayName: string; bot: boolean }> }>('/v1/people', { ids: [...new Set(ids)].join(',') }).catch(() => ({ people: [] }))).people;
  }

  /** One issue with its conversation, as someone not signed in sees it; null when there is none (or it is private). */
  issue(number: number) {
    return this.maybe(
      this.get<{ issue: Issue; rights: IssueRights; timeline: TimelineItem[]; people: People; fixedBy: Array<{ number: number; title: string; status: string }>; subscribed: boolean }>(`/v1/issues/${number}`).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 403) return null;
        throw error;
      }),
    );
  }

  /** What #n is: a suggestion or an issue (they share one numbering); null when nothing has it. */
  threadByNumber(number: number) {
    return this.maybe(this.get<{ kind: 'suggestion' | 'issue'; number: number; id: number }>(`/v1/threads/${number}`));
  }

  /** The hanacha synced to a recording, paragraph by paragraph with where each is heard; null when none is. */
  hanachaSync(recording: string) {
    return this.maybe(this.get<HanachaSync>(`/v1/recordings/${encodeURIComponent(recording)}/hanacha`));
  }

  /** The same for several recordings (a farbrengen's parts) in one request, by recording; those with none are left out. */
  async hanachaSyncs(recordings: readonly string[]): Promise<Map<string, HanachaSync>> {
    const ids = [...new Set(recordings)].slice(0, 200);
    if (ids.length === 0) return new Map();
    const { items } = await this.get<{ items: Record<string, HanachaSync> }>('/v1/recordings/batch/hanacha', { ids: ids.join(',') });
    return new Map(Object.entries(items));
  }

  /** The kinds of issue, each with the words it starts with. */
  async issueTemplates() {
    return (await this.get<{ templates: IssueTemplate[] }>('/v1/issues/templates')).templates;
  }

  /** Every label, with how many open issues carry it. */
  async labels() {
    return (await this.get<{ labels: Array<IssueLabel & { open: number }> }>('/v1/labels')).labels;
  }

  /** A person's page by their handle (an old handle finds them too, with `movedFrom`); null when nobody has it. */
  person(username: string) {
    return this.maybe(this.get<Profile>(`/v1/people/${encodeURIComponent(username)}`, { limit: 40 }));
  }
}

export interface Profile {
  person: { id: string; username: string; displayName: string; since: string; steward: boolean; admin: boolean; trust: 'contributor' | 'trusted'; suspended: boolean };
  movedFrom?: string;
  counts: { suggestions: number; merged: number; reviews: number; issues: number; comments: number };
  activity: Array<{
    kind: 'suggestion' | 'review' | 'issue' | 'comment';
    at: string;
    thread: { kind: 'changeset' | 'report' | 'entity'; id: string; number: number | null; title: string | null; state: string | null; path: string | null };
    verdict?: string;
    excerpt?: string;
    via?: Via;
  }>;
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

/** One of the day's shiurim that the API names rather than gives: in Hebrew, and by Sefaria's references. */
export interface RambamShiur {
  label: string;
  refs: string[];
  /** Each reference's page on RebbeHub, once the catalog has it. */
  paths?: Array<string | null>;
}

export interface DailyLearning {
  date: string;
  hebrew: string;
  tanya: Array<Entity & { from: string; to: string | null }>;
  hayomYom: Entity[];
  chumash?: { label: string; ref: string; path?: string | null; rashi?: string | null } | null;
  tehillim?: Array<{ text: string; ref: string | null; path?: string | null }>;
  rambam?: { three: RambamShiur; one: RambamShiur; mitzvos: RambamShiur | null };
}
