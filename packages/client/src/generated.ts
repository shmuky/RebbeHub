// Generated from the RebbeHub OpenAPI document by packages/client/scripts/generate.ts.
// Do not edit by hand: run `npm run generate -w @rebbehub/client`.
/* eslint-disable */

/** The API version this client was generated from. */
export const API_VERSION = "1.0.0";

/** Sent by an agent for its author, not by their own hands; null otherwise. The site shows it as "Claude · for @person". */
export type Via = {
  /** A personal API token, or an app connected with OAuth */
  kind: "token" | "oauth";
  /** The token (tok-…) or the connection (oac-…) */
  id: string;
  /** The token's name, or the app's (Claude) */
  name: string;
  /** A connected app's client id */
  client?: string;
};

export type ApiError = {
  /** What kind of error, for programs */
  error: "bad-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "invalid" | "rate-limited" | "internal" | "state" | "too-large" | "upstream";
  /** What went wrong, for people */
  message: string;
  /** More, when there is more (a check that failed, the clashes of a merge) */
  detail?: unknown;
  /** For a merge that clashes */
  conflicts?: Array<Record<string, unknown>>;
};

export type StatusReport = {
  /** When the checks last ran */
  checkedAt: string;
  state: CheckState;
  checks: Array<{
    id: CheckId;
    state: CheckState;
    ms: number | null;
    detail: string | null;
  }>;
  quota: {
    /** Queries through Hyperdrive since 00:00 UTC */
    used: number;
    limit: number | null;
    resetsAt: string;
    runsOutAt: string | null;
  } | null;
  workers?: Array<{
    /** The Worker's name */
    script: string;
    /** Requests since 00:00 UTC */
    requests: number;
    /** Of them, ended by the runtime with an error */
    errors: number;
    /** Of them, stopped for going over the CPU allowance (error 1102) */
    exceeded: number;
    cpuP50Ms: number | null;
    cpuP99Ms: number | null;
  }> | null;
  /** Oldest first, at most 90 */
  days: Array<{
    /** YYYY-MM-DD, UTC */
    date: string;
    checks: Record<string, {
      runs: number;
      up: number;
      degraded: number;
      down: number;
    }>;
  }>;
  /** Newest first, at most 30 */
  incidents: Array<{
    check: CheckId;
    state: "degraded" | "down";
    from: string;
    to: string | null;
    detail: string | null;
  }>;
};

export type CheckId = "site" | "api" | "mcp" | "database" | "quota" | "workers" | "jobs";

/** unknown: not checked this time; it counts for nothing */
export type CheckState = "up" | "degraded" | "down" | "unknown";

export type About = {
  name: string;
  version: string;
  /** The latest commit's seq */
  head: number;
  docs?: string;
  developers?: string;
  /** The MCP server */
  mcp?: string;
  licence?: Record<string, unknown>;
};

export type Item = {
  /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
  id: string;
  type: string;
  path: string | null;
  /** The revision shown */
  rev: number;
  /** The item's data, as its type's JSON Schema (/v1/types) says. In a list, without `body` (the words a page keeps in itself, kilobytes each): read the item by id, or several with /v1/entities/batch, for them */
  data: Record<string, unknown>;
  /** Set when its words are held back for rights: the item is listed, its text is not served */
  withheld?: string;
  /** For events: how many recordings it has */
  recordings?: number;
};

export type ItemPage = {
  items: Array<Item>;
  next: string | null;
};

export type AppCatalogManifest = {
  /** 1, 2 or 3 */
  schemaVersion: number;
  /** X.Y.Z: 2.<commit>.0, or 0.<commit>.0 while a part is missing */
  version: string;
  releasedAt: string;
  /** Where its catalog.json is */
  url: string;
  bytes: number;
  sha256: string;
  years: Array<number>;
  occasions: number;
  changelog: Array<{
    version: string;
    date: string;
    en: Array<string>;
    he: Array<string>;
  }>;
  /** v2 and v3: items per library collection */
  collections?: Record<string, number>;
  /** v3: how many works, and how many units their contents have */
  works?: {
    works: number;
    units: number;
  };
  /** Parts RebbeHub does not hold yet (farbrengens, library, works) */
  missing?: Array<string>;
};

export type Commit = {
  seq: number;
  at: string;
  message: string;
  mergedBy: string;
  author: string;
  via?: Via | null;
  /** How many items it changed in all */
  changed: number;
  types: Array<string>;
  changes: Array<{
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    id?: string;
    type?: string;
    path?: string | null;
    rev?: number;
    data?: Record<string, unknown> | null;
  }>;
};

export type TreeNode = {
  /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
  id: string;
  type: string;
  path: string | null;
  name: Record<string, unknown> | null;
  order?: string | null;
  counts: {
    /** Sets under it */
    sets?: number;
    /** Items in it (a set) */
    items?: number;
    /** Units of it (a sefer) */
    units?: number;
  };
  children?: Array<TreeNode>;
  /** Children left out past the limit */
  more?: number;
};

/** One step of a plan. Items are ids (rh-…), or new:<key> for a set made earlier in the same plan. Positions are "start", "end", { after: id } or { before: id }. - move { items, to, from?, mode?: add | only, position? }: into a set (a sefer joins it, leaving `from` when given); `to: null` with `from` takes it out; a set under a set or to the top (to: null); a unit to another work, a printing to a work, a scan to a printing, a recording to an event. - move-up { items, from? }: a set to its parent's parent; an item out of a set into that set's parent. - rename { item, name?: { he?, en? }, slug?, path? }: old paths redirect, and paths made from it (a sefer's units) move along. - reorder { items, parent?, position? }: without position, the items take the places they hold in the order given. - create-set { key?, name: { he, en? }, slug, parent?, description?, items? } - delete-set { item }: only a set that holds nothing. - merge { from, into }: everything under or pointing at `from` moves to `into`; `from` is deleted and its paths lead to `into`. - split { work, units? | range: { from, to }, title: { he, en? }, slug }: units into a new sefer. */
export type OrganizeOperation = {
  op: "move" | "move-up" | "rename" | "reorder" | "create-set" | "delete-set" | "merge" | "split";
  items?: Array<string>;
  item?: string;
  to?: string | null;
  from?: string;
  into?: string;
  mode?: "add" | "only";
  position?: "start" | "end" | {
    after: string;
  } | {
    before: string;
  };
  parent?: string | null;
  /** { he, en } */
  name?: Record<string, unknown>;
  /** { he, en } */
  title?: Record<string, unknown>;
  slug?: string;
  path?: string;
  key?: string;
  /** { he, en } */
  description?: Record<string, unknown>;
  work?: string;
  units?: Array<string>;
  range?: {
    from: string;
    to: string;
  };
};

export type OrganizePlan = {
  /** Done in order, each seeing what the ones before it did */
  operations: Array<OrganizeOperation>;
  /** The suggestion's title; made from the operations when left out */
  title?: string;
  description?: string;
  /** Keep it a draft instead of sending it for review (organize only) */
  draft?: boolean;
  /** Approve it at once where you may approve it yourself (organize only) */
  apply?: boolean;
};

export type OrganizePreview = {
  title: string;
  /** One line per operation */
  summary: Array<string>;
  items: Array<{
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    id: string;
    type: string;
    name?: string;
    isNew?: boolean;
    deleted?: boolean;
    pathBefore?: string | null;
    path?: string | null;
    changes: Array<{
      path?: string;
      before?: unknown;
      after?: unknown;
    }>;
  }>;
  /** Old paths and where they lead once approved */
  redirects: Array<{
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    id?: string;
    from?: string;
    to?: string | null;
  }>;
  /** Items merged into others */
  forwards: Array<{
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    from?: string;
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    to?: string;
  }>;
  warnings: Array<string>;
  /** The new sets, by their key */
  created?: Record<string, unknown>;
};

export type Suggestion = {
  id: number;
  title: string;
  description?: string | null;
  author: string;
  via?: Via | null;
  status: "draft" | "open" | "merged" | "sent_back" | "withdrawn";
  kind?: string;
  project_id?: number | null;
  base_commit?: number;
  merged_commit?: number | null;
  post_review?: "pending" | "done" | null;
  /** The checks that did not pass, of this page's items and of the whole; `checkCounts` counts them all */
  checks?: Array<{
    check?: string;
    status?: "pass" | "fail" | "warn";
    message?: string;
  }>;
  /** All its checks, by status */
  checkCounts?: {
    pass: number;
    warn: number;
    fail: number;
  };
  created_at?: string;
  submitted_at?: string | null;
  closed_at?: string | null;
  number?: number | null;
  /** How many items it changes */
  items?: number;
};

export type SuggestionListItem = {
  id: number;
  number: number;
  title: string;
  status: "draft" | "open" | "merged" | "sent_back" | "withdrawn";
  kind?: string;
  author: string;
  createdAt?: string;
  submittedAt?: string | null;
  closedAt?: string | null;
  comments?: number;
  reviewers?: Array<string>;
  approvals?: number;
  changesRequested?: boolean;
  /** Issues it closes, by number */
  fixes?: Array<number>;
  via?: Via | null;
  /** The kinds of items it changes */
  types?: Array<string>;
  /** The first item it changes, by id */
  first?: string | null;
};

export type Issue = {
  id: number;
  /** Its number, shared with suggestions: #12 */
  number: number;
  title?: string | null;
  typeTitle?: {
    he?: string;
    en?: string;
  };
  type: string;
  state: "open" | "closed";
  stateReason?: "completed" | "not_planned" | null;
  body?: string | null;
  private: boolean;
  author?: string | null;
  via?: Via | null;
  entity?: Record<string, unknown> | null;
  set?: string | null;
  labels: Array<{
    name?: string;
    description?: string | null;
    color?: string;
  }>;
  assignees: Array<string>;
  comments?: number;
  createdAt: string;
  updatedAt?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
  closedBySuggestion?: number | null;
};

export type InboxLine = {
  id: number;
  reason: "mention" | "review_requested" | "assigned" | "author" | "comment" | "review" | "state" | "followed";
  /** What it is about: a suggestion or issue (number, title, state) or an item's talk page (path, name) */
  subject: Record<string, unknown>;
  actor?: string | null;
  actorName?: string | null;
  actorUsername?: string | null;
  count: number;
  detail?: Record<string, unknown>;
  at: string;
  read: boolean;
};

export type Comment = {
  id: number;
  parent?: number | null;
  author: string;
  authorName?: string;
  body: string | null;
  at: string;
  hidden?: boolean;
};

export type ScanTextPage = {
  /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
  scan: string;
  page: number;
  pages: number;
  /** Still an OCR page, untouched by people */
  machine?: boolean;
  engine?: {
    name?: string;
    version?: string;
  } | null;
  /** Proofread: 0 not yet, 1 once, 2 twice */
  level?: number;
  lines: Array<{
    id: string;
    text: string;
    /** false: machine reading nobody has checked */
    checked: boolean;
    level?: number;
  }>;
  layers?: Array<Record<string, unknown>>;
};

export type MachineRequest = {
  id: number;
  kind: "ocr" | "transcript";
  /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
  item: string;
  requestedBy?: string;
  status: "waiting" | "running" | "done" | "failed";
  note?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  position?: number | null;
};

export type Transcript = {
  /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
  recording: string;
  /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
  text: string;
  language?: string;
  alignment?: string | null;
  granularity?: "word" | "paragraph" | null;
  paragraphs: Array<{
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    id: string;
    content: string;
    startMs?: number | null;
    endMs?: number | null;
    words?: Array<Record<string, unknown>> | null;
    locked?: boolean;
    /** false: machine hearing nobody has checked */
    checked: boolean;
    /** a person fixed some words but did not check the whole paragraph */
    edited?: boolean;
    syncChecked?: boolean;
  }>;
};

export type File = {
  sha256: string;
  bytes: number;
  mime: string;
  rights: "open" | "credit" | "link" | "preserved";
  credit?: string | null;
  url: string | null;
  derivations?: Array<Record<string, unknown>>;
  pageFix?: Record<string, unknown> | null;
  pageImages?: number;
};

export type Cover = {
  /** A file, named by its sha256 */
  file: string;
  /** The PDF page drawn */
  page: number;
  /** true: a machine chose the title page and no person has yet */
  machine: boolean;
  reasons?: Array<string>;
  credit?: string | null;
  image: {
    url: string;
    width: number;
    height: number;
  };
  thumb: {
    url: string;
    width: number;
    height: number;
  };
};

export type ApiToken = {
  id: string;
  /** A personal token, or an app connected with OAuth (its name is the app's) */
  kind: "personal" | "oauth";
  name: string;
  /** Its first characters, to recognise it */
  prefix: string;
  scopes: Array<"read" | "write">;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  client?: {
    id: string;
    name: string;
    uri?: string | null;
    host?: string | null;
  };
};

export type ProtectedResource = {
  resource: string;
  authorization_servers: Array<string>;
  scopes_supported?: Array<string>;
  bearer_methods_supported?: Array<string>;
  resource_name?: string;
  resource_documentation?: string;
};

/** Every operation: what it takes and what it answers. */
export interface Operations {
  /** About this API: its version, the latest commit, where the docs are */
  about: {
    input: Record<string, never>;
    output: About;
  };
  /** A hanacha's words for a farbrengen or sicha (or a new farbrengen), a paragraph to a segment */
  addHanachaText: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        for?: string;
        /** For a farbrengen the catalog lacks: its name */
        eventTitle?: string;
        /** With eventTitle: its date key */
        eventDate?: string;
        /** A blank line between paragraphs */
        content: string;
        rights: "mine" | "public-domain" | "free" | "unsure";
        language?: string;
        credit?: string;
      };
    };
    output: {
      suggestion: number;
      /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
      text: string;
      event?: string | null;
      publication?: string | null;
    };
  };
  /** Suggest a translation of a unit, as its own text */
  addTranslation: {
    input: {
      id: string;
      body: {
        language: string;
        credit: string;
        licence?: "public-domain" | "cc0" | "cc-by" | "cc-by-nc";
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        translationOf?: string;
        /** A blank line between paragraphs */
        content: string;
        /** The tool, when a machine translated it */
        machine?: string;
      };
    };
    output: Suggestion;
  };
  /** The Rebbe is saying this line now: set a paragraph (or word) at atMs, lock it, move what follows */
  anchorSync: {
    input: {
      id: string;
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        segment: string;
        atMs: number;
        word?: number;
      };
    };
    output: Record<string, unknown>;
  };
  /** The phone app's APK: redirects to Sichos-Kodesh's app server */
  appAndroidDownload: {
    input: {
      abi: "arm64-v8a" | "armeabi-v7a" | "universal";
    };
    output: Response;
  };
  /** The phone app's newest release: redirects to Sichos-Kodesh's app server */
  appAndroidLatest: {
    input: Record<string, never>;
    output: Response;
  };
  /** The apps' catalog changelog alone */
  appCatalogChangelog: {
    input: {
      schema: "v1" | "v2" | "v3";
    };
    output: Array<{
      version: string;
      date: string;
      en: Array<string>;
      he: Array<string>;
    }>;
  };
  /** Redirects to the served release's catalog.json */
  appCatalogLatest: {
    input: {
      schema: "v1" | "v2" | "v3";
    };
    output: Response;
  };
  /** The Sichos Kodesh apps' catalog manifest: the served release's version, size, sha256 and address */
  appCatalogManifest: {
    input: {
      schema: "v1" | "v2" | "v3";
    };
    output: AppCatalogManifest;
  };
  /** The apps' catalog: the farbrengens by year (v1), with the library (v2) and the works (v3) */
  appCatalogRelease: {
    input: {
      schema: "v1" | "v2" | "v3";
      version: string;
    };
    output: Record<string, unknown>;
  };
  /** Approve and merge (keepers of its sets, stewards) */
  approveSuggestion: {
    input: {
      id: number;
      body?: {
        /** For each item, how each clashing field is settled: {item: {field: {take: "ours" (the site) | "theirs" (the suggestion)}}}; `*` stands for every item or every field not named */
        resolutions?: Record<string, unknown>;
        note?: string;
      };
    };
    output: {
      commit?: number | null;
    };
  };
  /** A text of a sefer, where the apps look for it (the same as /v1/texts/{sha256}) */
  appSourceText: {
    input: {
      sha256: string;
    };
    output: string;
  };
  /** Authorization Server Metadata (RFC 8414): the endpoints, scopes read and write, PKCE S256, registration and Client ID Metadata Documents */
  authorizationServer: {
    input: Record<string, never>;
    output: Record<string, unknown>;
  };
  /** The catalog as a tree: the top sets (or one set or sefer), the sets and items under them, and how much each holds */
  catalogTree: {
    input: {
      /** A set or a sefer (work); left out, the top sets */
      root?: string;
      /** How many levels down */
      depth?: number;
      /** How many (at most 500) */
      limit?: number;
    };
    output: {
      root: TreeNode | null;
      children: Array<TreeNode>;
      /** Children left out past the limit */
      more: number;
    };
  };
  /** Before an upload: whether we have it (its sha256, a few page hashes) and what it likely is */
  checkUpload: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        for: string;
        sha256?: string;
        pageHashes?: Array<string | null>;
        title?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Hand me the next item nobody holds (held for you for a few hours) */
  claimNext: {
    input: {
      slug: string;
    };
    output: {
      item: Record<string, unknown> | null;
    };
  };
  /** Close a project (its keepers, stewards) */
  closeProject: {
    input: {
      slug: string;
    };
    output: {
      ok: true;
    };
  };
  /** Resolve or dismiss a report (keepers) */
  closeReport: {
    input: {
      id: number;
      body: {
        outcome: "resolved" | "dismissed";
        /** The suggestion that fixed it */
        changeset?: number;
        note?: string;
      };
    };
    output: {
      ok: true;
    };
  };
  /** Comment on an issue, or answer a comment */
  commentOnIssue: {
    input: {
      number: number;
      body: {
        body: string;
        /** The comment this answers */
        parent?: number;
      };
    };
    output: {
      id: number;
    };
  };
  /** Comment on an item's talk page */
  commentOnItem: {
    input: {
      id: string;
      body: {
        body: string;
        /** The comment this answers */
        parent?: number;
      };
    };
    output: {
      id: number;
    };
  };
  /** Comment on a suggestion, answer a comment, or comment on one field of one item */
  commentOnSuggestion: {
    input: {
      id: number;
      body: {
        body: string;
        /** The comment this answers */
        parent?: number;
        anchor?: {
          /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
          entity: string;
          field: string;
        };
      };
    };
    output: {
      id: number;
    };
  };
  /** The community page in numbers: the latest merges, reports and suggestions waiting, people, gaps */
  community: {
    input: {
      /** How many (at most 50) */
      limit?: number;
    };
    output: Record<string, unknown>;
  };
  /** Compare two printings word by word (Hebrew-aware) */
  comparePrintings: {
    input: {
      /** text:<id> or scan:<id>:<from>-<to> */
      a: string;
      /** The other printing */
      b: string;
    };
    output: Record<string, unknown>;
  };
  /** This page is right: raise it a proofreading level, with any fixes (a suggestion) */
  confirmScanPage: {
    input: {
      id: string;
      body: {
        page: number;
        /** Line id to its right text */
        fixes?: Record<string, string>;
      };
    };
    output: Suggestion;
  };
  /** The sync is right: mark every paragraph checked */
  confirmSync: {
    input: {
      id: string;
    };
    output: Suggestion;
  };
  /** Sefarim's covers, drawn from their title pages, while their PDFs are served or linked */
  covers: {
    input: {
      /** The sefarim */
      ids?: string;
    };
    output: {
      covers: Record<string, Cover>;
    };
  };
  /** Make a label (stewards) */
  createLabel: {
    input: {
      body: {
        name: string;
        description?: string;
        /** Six hex digits */
        color?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Open a project on a gap (farbrengens without recordings or texts, recordings to sync, pages to proofread) */
  createProject: {
    input: {
      body: {
        slug: string;
        name: string;
        goal?: string;
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        set?: string;
        missing?: "recordings" | "texts" | "sync" | "proofreading";
        within?: string;
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        scan?: string;
        level?: 1 | 2;
      };
    };
    output: {
      id: number;
      slug: string;
    };
  };
  /** Start a suggestion (a draft): add items to it, then submit it */
  createSuggestion: {
    input: {
      body: {
        title: string;
        description?: string;
        project?: number;
      };
    };
    output: Suggestion;
  };
  /** Add a webhook (up to five); its signing secret is shown this once */
  createWebhook: {
    input: {
      body: {
        /** https://… */
        url: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Remove a webhook */
  deleteWebhook: {
    input: {
      id: number;
    };
    output: {
      ok: true;
    };
  };
  /** A Google Drive file the catalog links to (a hanacha's PDF, an Otzros scan), read for the site's reader and player */
  driveFile: {
    input: {
      id: string;
    };
    output: Response;
  };
  /** What a PDF on Google Drive needs to read straight, by its Drive id, or the reading copy to open instead */
  driveFix: {
    input: {
      id: string;
    };
    output: Record<string, unknown>;
  };
  /** Change your own comment (on a talk page, a suggestion or an issue) */
  editComment: {
    input: {
      id: number;
      body: {
        body: string;
      };
    };
    output: {
      ok: true;
    };
  };
  /** An edition's checksums, for sha256sum -c */
  editionChecksums: {
    input: {
      tag: string;
    };
    output: string;
  };
  /** An edition's signed manifest (Ed25519), exactly as signed */
  editionManifest: {
    input: {
      tag: string;
    };
    output: Record<string, unknown>;
  };
  /** Catalog editions (dated snapshots) and their dumps, each with its size, sha256 and address */
  editions: {
    input: Record<string, never>;
    output: {
      editions: Array<Record<string, unknown>>;
    };
  };
  /** Change its title or words (its author, keepers, stewards) */
  editIssue: {
    input: {
      number: number;
      body?: {
        title?: string;
        body?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Change the title or description of your suggestion (@mentions and "Fixes #12" are read again) */
  editSuggestion: {
    input: {
      id: number;
      body?: {
        title?: string;
        description?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** A family's request that a teshura not be shown (no account needed): its scans stop being served at once, and stewards review it */
  familyRequest: {
    input: {
      id: string;
      body?: {
        relation?: string;
        note?: string;
        contact?: string;
        captcha?: string;
      };
    };
    output: {
      report: number;
      paused: number;
    };
  };
  /** A file's own page: its rights, where it came from, what was made from it, and what uses it */
  fileAbout: {
    input: {
      sha256: string;
      /** How many (at most 500) */
      limit?: number;
    };
    output: Record<string, unknown>;
  };
  /** Fix one line of a scan's text (a suggestion) */
  fixScanLine: {
    input: {
      id: string;
      body: {
        page: number;
        /** The line's id */
        line: string;
        text: string;
      };
    };
    output: Suggestion;
  };
  /** Fix the words of one paragraph of a transcript (a suggestion) */
  fixTranscript: {
    input: {
      id: string;
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        segment: string;
        content: string;
        /** false: only some words were fixed; the paragraph stays machine hearing (default true) */
        complete?: boolean;
      };
    };
    output: Suggestion;
  };
  /** Suggest a fix to one paragraph of a translation */
  fixTranslation: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        segment: string;
        content: string;
      };
    };
    output: Suggestion;
  };
  /** Follow or unfollow an item, set, project, suggestion or issue */
  follow: {
    input: {
      body: {
        kind: "entity" | "set" | "project" | "changeset" | "report";
        id: string;
        /** false to unfollow */
        on?: boolean;
      };
    };
    output: {
      ok: true;
    };
  };
  /** Forget one place */
  forgetPlace: {
    input: {
      kind: "read" | "listen";
      /** The thing */
      key: string;
    };
    output: {
      ok: true;
    };
  };
  /** One of an edition's dumps (SQLite, JSON Lines, Parquet) */
  getDump: {
    input: {
      tag: string;
      name: string;
    };
    output: Response;
  };
  /** A file's size, rights and address, what was made from it, and its page fix */
  getFile: {
    input: {
      sha256: string;
    };
    output: File;
  };
  /** Several files at once, in the order asked (missing ones left out) */
  getFiles: {
    input: {
      /** The files */
      ids: string;
    };
    output: {
      items: Array<File>;
    };
  };
  /** An issue, its timeline, what the reader may do, and the suggestions that close it */
  getIssue: {
    input: {
      number: number;
    };
    output: {
      issue: Issue;
      rights?: Record<string, unknown>;
      timeline?: Array<Record<string, unknown>>;
      people?: Record<string, unknown>;
    };
  };
  /** One item, on main or as of a commit */
  getItem: {
    input: {
      id: string;
      /** A commit's seq: the item as it was then */
      at?: number;
    };
    output: Item;
  };
  /** Several items at once, in the order asked (missing ones left out) */
  getItems: {
    input: {
      /** The ids */
      ids: string;
    };
    output: {
      items: Array<Item>;
    };
  };
  /** A published manifest: reading copies, page fixes (facts about files, open like the catalog) */
  getManifest: {
    input: {
      collection: string;
      name: string;
    };
    output: Record<string, unknown>;
  };
  /** A file's bytes, while its rights let it be served */
  getObject: {
    input: {
      sha256: string;
    };
    output: Response;
  };
  /** A person's public page: who they are, their counts and recent activity (an old handle finds them too, with `movedFrom`) */
  getProfile: {
    input: {
      username: string;
      /** How many (at most 100) */
      limit?: number;
    };
    output: Record<string, unknown>;
  };
  /** A project, its progress and what is left to do */
  getProject: {
    input: {
      slug: string;
    };
    output: {
      project: Record<string, unknown>;
      next: Array<Item>;
      todo: Array<Record<string, unknown>>;
    };
  };
  /** One stored version of an item */
  getRevision: {
    input: {
      rev: number;
    };
    output: Record<string, unknown>;
  };
  /** A text of a sefer as its source gave it (one chapter or letter, an HTML article) */
  getSourceText: {
    input: {
      sha256: string;
    };
    output: string;
  };
  /** The review view: each item before and after, clashes with main, and the reviewer's advice (machine-written, `machine: true`). A page of items at a time (`entries`, from `offset`), with `total`, `next` (the offset of the next page, or null) and, with summary=1, `summary`: the items grouped by how they change ("500 units: links on the media proxy became links on Drive"), with a few examples of each */
  getSuggestion: {
    input: {
      id: number;
      /** Items to skip: the `next` of the page before */
      offset?: number;
      /** How many (at most 200) */
      limit?: number;
      /** With 1: also `summary`, every item grouped by how it changes (all of them are read and compared for it) */
      summary?: "1";
      /** With 1: each item's facts, not its words (`before` and `after` without `body`; what changed is whole in `changes`), for a feed */
      brief?: "1";
    };
    output: Record<string, unknown>;
  };
  /** The health of the catalog: coverage per year and set, unchecked pages, unsynced recordings, dead links, the oldest open suggestions */
  health: {
    input: {
      /** How many (at most 500) */
      limit?: number;
    };
    output: Record<string, unknown>;
  };
  /** Hide a comment (its author, or a steward) */
  hideComment: {
    input: {
      id: number;
    };
    output: {
      ok: true;
    };
  };
  /** A served scan as a IIIF Presentation 3 manifest, for any IIIF viewer */
  iiifManifest: {
    input: {
      file: string;
    };
    output: Record<string, unknown>;
  };
  /** Your inbox, newest first: mentions, review requests, assignments and what you follow */
  inbox: {
    input: {
      /** unread, all, or one reason */
      filter?: "unread" | "all" | "mention" | "review_requested" | "assigned" | "author" | "comment" | "review" | "state" | "followed";
      /** Deprecated: lines older than this time; use cursor */
      before?: string;
      /** How many (at most 100) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: {
      items: Array<InboxLine>;
      unread: number;
      next: string | null;
    };
  };
  /** How many inbox lines are unread */
  inboxCount: {
    input: Record<string, never>;
    output: {
      unread: number;
    };
  };
  /** The kinds of issue and the words each starts with */
  issueTemplates: {
    input: Record<string, never>;
    output: {
      templates: Array<Record<string, unknown>>;
    };
  };
  /** Items that point at this one */
  itemBacklinks: {
    input: {
      id: string;
      /** Only links in this field */
      field?: string;
      /** Only items of this type */
      type?: string;
    };
    output: {
      backlinks: Array<{
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        from: string;
        type: string;
        field: string;
        path: string | null;
      }>;
    };
  };
  /** Every merged change to an item, newest first: who, when, and what changed field by field */
  itemHistory: {
    input: {
      id: string;
    };
    output: {
      history: Array<Record<string, unknown>>;
    };
  };
  /** An item's links both ways: cites, printed in, based on, cited by */
  itemRelations: {
    input: {
      id: string;
    };
    output: {
      relations: Array<Record<string, unknown>>;
    };
  };
  /** An item's talk page: the conversation about it */
  itemTalk: {
    input: {
      id: string;
    };
    output: {
      talk: Array<Comment>;
    };
  };
  /** What points at an item, by type and field, with how many of each */
  linkedCounts: {
    input: {
      id: string;
    };
    output: {
      groups: Array<{
        type: string;
        field: string;
        count: number;
      }>;
    };
  };
  /** One group of what points at each of several items, a few of each in the group's order: what a list needs of every row in one request (a sefer's sichos' texts, a farbrengen's sichos' words) */
  linkedOfEach: {
    input: {
      /** The items */
      ids: string;
      /** The field that points at them (unit, text, publication…) */
      field: string;
      /** Only items of this type */
      type?: string;
      /** How many (at most 500) */
      limit?: number;
    };
    output: {
      linked: Record<string, Array<Item>>;
    };
  };
  /** An item's children in their own order (a work's units, a text's paragraphs), a page at a time */
  listChildren: {
    input: {
      id: string;
      /** The children's field that points at this item (work, text, event…) */
      field: string;
      /** The children's type (unit, segment, recording…) */
      type: string;
      /** Deprecated: the same as cursor */
      after?: string;
      /** How many (at most 1000) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: ItemPage;
  };
  /** Every merge to main after a given one, in order, with what each changed: the way to follow the catalog without webhooks */
  listCommits: {
    input: {
      /** Start after this commit's seq (0: from the start) */
      since?: number;
      /** How many (at most 100) */
      limit?: number;
      /** Carry only so many of each commit's changes (an import's has thousands); `changed` and `types` still count them all */
      changes?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: {
      commits: Array<Commit>;
      next: string | null;
    };
  };
  /** Farbrengens and other events by Hebrew date, each with how many recordings it has */
  listEvents: {
    input: {
      /** A year (5742) or a month (5742-05) */
      within?: string;
      /** A day of any year (05-10), or several, comma separated */
      day?: string;
      /** Exact dates, comma separated (5742-05-10,5743-05-10) */
      dates?: string;
      /** Only those without */
      missing?: "recordings" | "texts";
      /** With 1: each event's facts with each link's kind alone, not its label and pages, for a calendar's rows (well under half the bytes) */
      brief?: "1";
      /** How many (at most 2000) */
      limit?: number;
    };
    output: {
      items: Array<Item>;
    };
  };
  /** What you follow, the items themselves, and what changed in them lately */
  listFollows: {
    input: {
      /** How many (at most 100) */
      limit?: number;
    };
    output: {
      follows: Array<Record<string, unknown>>;
      items: Array<Item>;
      feed: Array<Record<string, unknown>>;
    };
  };
  /** Issues, newest first, with open and closed counts; private ones only for those who may read them */
  listIssues: {
    input: {
      /** open (the default), closed or all */
      state?: "open" | "closed" | "all";
      /** Label names, comma separated */
      label?: string;
      /** The kind of report */
      type?: "wrong-fact" | "missing-page" | "bad-scan" | "audio-problem" | "wrong-text" | "duplicate" | "rights" | "offensive" | "other";
      /** Only about items in this set */
      set?: string;
      /** Only about this item */
      entity?: string;
      /** A handle, or none */
      assignee?: string;
      /** A handle */
      author?: string;
      /** Words, or #number */
      q?: string;
      /** Deprecated: the same as a cursor, as a number */
      before?: number;
      /** How many (at most 100) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: {
      items: Array<Issue>;
      people?: Record<string, unknown>;
      counts: {
        open: number;
        closed: number;
      };
      next: string | null;
    };
  };
  /** Items on main, by type and set, in path order, a page at a time */
  listItems: {
    input: {
      type?: string;
      /** Only items in this set */
      set?: string;
      /** Deprecated: the same as cursor */
      after?: string;
      /** How many (at most 500) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: ItemPage;
  };
  /** Every label and how many open issues carry it */
  listLabels: {
    input: Record<string, never>;
    output: {
      labels: Array<Record<string, unknown>>;
    };
  };
  /** One group of what points at an item, in its own order, a page at a time, with the total */
  listLinked: {
    input: {
      id: string;
      /** The field that points here (work, event, sets…) */
      field: string;
      /** Only items of this type */
      type?: string;
      /** Deprecated: the same as cursor */
      after?: string;
      /** How many (at most 500) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: {
      items: Array<Item>;
      total: number;
      next: string | null;
    };
  };
  /** Where you stopped reading and listening lately (never cached) */
  listPlaces: {
    input: {
      kind?: "read" | "listen";
      /** One thing only */
      key?: string;
      /** How many (at most 60) */
      limit?: number;
    };
    output: {
      places: Array<Record<string, unknown>>;
    };
  };
  /** Projects working through a gap, with their progress */
  listProjects: {
    input: {
      status?: "open" | "merged" | "closed";
    };
    output: {
      projects: Array<Record<string, unknown>>;
    };
  };
  /** A set's inbox of reports (stewards, and the set's keepers) */
  listReports: {
    input: {
      /** A set */
      set?: string;
      status?: "open" | "resolved" | "dismissed";
    };
    output: {
      reports: Array<Record<string, unknown>>;
      items: Array<Item>;
    };
  };
  /** Suggestions, oldest sent first, by status or author; with `state`, the list of conversations, newest first (numbers, reviewers, approvals, the issues each closes) with counts */
  listSuggestions: {
    input: {
      status?: "draft" | "open" | "merged" | "sent_back" | "withdrawn";
      /** The conversation list: open (waiting or sent back) or closed (merged or withdrawn) */
      state?: "open" | "closed" | "all";
      /** An account id, or (with state) a handle */
      author?: string;
      /** With state: asked to review, or reviewed (a handle) */
      reviewer?: string;
      /** With state: words in the title, or #number */
      q?: string;
      /** With state: only suggestions that change these items, or what is in them (a sefer's sichos and their texts, a sicha's paragraphs, a farbrengen's sichos) */
      about?: string;
      /** true: live changes waiting to be reviewed after */
      postReview?: "true" | "false";
      /** How many (at most 500) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: {
      suggestions: Array<Suggestion | SuggestionListItem>;
      /** Who is named, by account id: name and handle */
      people?: Record<string, unknown>;
      counts?: {
        open?: number;
        closed?: number;
      };
      next: string | null;
    };
  };
  /** Your webhooks: addresses every merge is posted to */
  listWebhooks: {
    input: Record<string, never>;
    output: {
      webhooks: Array<Record<string, unknown>>;
    };
  };
  /** A short guide for AI agents (llms.txt) */
  llmsTxt: {
    input: Record<string, never>;
    output: string;
  };
  /** Requests for the machines, the waiting ones in the order they are taken */
  machineRequests: {
    input: {
      kind?: "ocr" | "transcript";
      status?: "waiting" | "running" | "done" | "failed";
      /** Requests for one item */
      item?: string;
      items?: string;
      /** How many (at most 200) */
      limit?: number;
    };
    output: {
      requests: Array<MachineRequest>;
    };
  };
  /** What waits for the machines (OCR, transcription), what is left for them, and what they did this week */
  machineSummary: {
    input: Record<string, never>;
    output: Record<string, unknown>;
  };
  /** What the machines wrote that no person has checked yet: farbrengens with unchecked transcript paragraphs, scans with pages read by OCR and not yet proofread, the newest first */
  machineToCheck: {
    input: {
      /** How many (at most 200) */
      limit?: number;
    };
    output: {
      transcripts: Array<{
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        event: string;
        path: string | null;
        title: Record<string, unknown>;
        date: string | null;
        paragraphs: number;
        checked: number;
        /** When the machine last wrote a transcript of it */
        made: string;
      }>;
      scans: Array<{
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        scan: string;
        publication: string | null;
        title: Record<string, unknown>;
        pages: number;
        checked: number;
        made: string;
      }>;
      totals: {
        transcripts: number;
        paragraphs: number;
        scans: number;
        pages: number;
      };
    };
  };
  /** Map pages of a publication to the unit they hold (an existing unit, a new one, or words) */
  mapContents: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        publication: string;
        pages: {
          from: number;
          to: number;
          scheme?: "printed" | "pdf";
        };
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        unit?: string;
        newUnit?: {
          /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
          work?: string;
          label?: Record<string, unknown>;
          date?: string;
        };
        label?: Record<string, unknown>;
      };
    };
    output: Record<string, unknown>;
  };
  /** Mark inbox lines read (or unread): by id, by conversation, or all */
  markInboxRead: {
    input: {
      body?: {
        ids?: Array<number>;
        subject?: {
          kind: "changeset" | "report" | "entity" | "project";
          id: string;
        };
        all?: boolean;
        /** true: mark them unread */
        unread?: boolean;
      };
    };
    output: {
      changed: number;
      unread: number;
    };
  };
  /** The Model Context Protocol server (Streamable HTTP, JSON answers, no sessions) */
  mcp: {
    input: {
      body?: Record<string, unknown>;
    };
    output: Record<string, unknown>;
  };
  /** The MCP server's Protected Resource Metadata (RFC 9728), named in its 401's WWW-Authenticate */
  mcpProtectedResource: {
    input: Record<string, never>;
    output: ProtectedResource;
  };
  /** Everything a mirror needs: the git mirror, the release keys, every edition and its dumps */
  mirrors: {
    input: Record<string, never>;
    output: Record<string, unknown>;
  };
  /** The Missing board: farbrengens without a recording or a text, sefarim without a scan, files lost upstream */
  missing: {
    input: {
      /** What is missing */
      kind: "recordings" | "texts" | "scans" | "files";
      /** For recordings and texts: a year or a month */
      within?: string;
      /** How many (at most 500) */
      limit?: number;
    };
    output: {
      kind: string;
      total: number;
      items: Array<Record<string, unknown>>;
    };
  };
  /** OAI-PMH 2.0 for libraries (oai_dc records), when switched on */
  oai: {
    input: {
      verb: "Identify" | "ListMetadataFormats" | "ListSets" | "ListIdentifiers" | "ListRecords" | "GetRecord";
      metadataPrefix?: string;
      identifier?: string;
      from?: string;
      until?: string;
      set?: string;
      resumptionToken?: string;
    };
    output: string;
  };
  /** OAI-PMH, the same arguments sent as a form */
  oaiPost: {
    input: {
      body: Blob | ArrayBuffer | Uint8Array | ReadableStream;
      /** The body's type (audio/mpeg, application/pdf…); default application/x-www-form-urlencoded */
      contentType?: string;
    };
    output: string;
  };
  /** Start connecting (authorization code with PKCE): the person is sent to the site's consent page, then back to the app */
  oauthAuthorize: {
    input: {
      response_type: "code";
      client_id: string;
      redirect_uri?: string;
      scope?: string;
      state?: string;
      code_challenge: string;
      code_challenge_method: "S256";
      resource?: string;
      ui_locales?: string;
    };
    output: Response;
  };
  /** Register an app (RFC 7591): its name and redirect addresses; a secret only if it asks for one */
  oauthRegister: {
    input: {
      body: {
        client_name?: string;
        client_uri?: string;
        /** https, http://localhost, or an app's own scheme */
        redirect_uris: Array<string>;
        token_endpoint_auth_method?: "none" | "client_secret_post" | "client_secret_basic";
        grant_types?: Array<string>;
        response_types?: Array<string>;
      };
    };
    output: Record<string, unknown>;
  };
  /** Revoke an access or refresh token (RFC 7009): the whole connection ends */
  oauthRevoke: {
    input: {
      body: Blob | ArrayBuffer | Uint8Array | ReadableStream;
      /** The body's type (audio/mpeg, application/pdf…); default application/x-www-form-urlencoded */
      contentType?: string;
    };
    output: Response;
  };
  /** Trade a code (with its PKCE verifier) or a refresh token for an access token (an hour) and a new refresh token */
  oauthToken: {
    input: {
      body: Blob | ArrayBuffer | Uint8Array | ReadableStream;
      /** The body's type (audio/mpeg, application/pdf…); default application/x-www-form-urlencoded */
      contentType?: string;
    };
    output: {
      /** rho_… */
      access_token: string;
      token_type: "Bearer";
      expires_in: number;
      /** rhr_… */
      refresh_token: string;
      scope: string;
    };
  };
  /** This document */
  openapi: {
    input: Record<string, never>;
    output: Record<string, unknown>;
  };
  /** Open an issue (about an item, or the catalog at large) */
  openIssue: {
    input: {
      body: {
        title: string;
        body?: string;
        type?: "wrong-fact" | "missing-page" | "bad-scan" | "audio-problem" | "wrong-text" | "duplicate" | "rights" | "offensive" | "other";
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        entityId?: string;
        labels?: Array<string>;
        /** Keep it for stewards and keepers */
        private?: boolean;
      };
    };
    output: Issue;
  };
  /** Organize the catalog: a plan becomes one suggestion, sent for review (apply: true approves it at once where you may approve it yourself) */
  organize: {
    input: {
      body?: OrganizePlan;
    };
    output: {
      suggestion: Suggestion;
      merged: boolean;
      /** Whether you may approve it yourself */
      mayApprove?: boolean;
      preview: OrganizePreview;
    };
  };
  /** Read a Hebrew date as people write it */
  parseDate: {
    input: {
      /** The date */
      q: string;
    };
    output: {
      ok: boolean;
      key?: string;
      he?: string;
      en?: string;
    };
  };
  /** What a plan of moves, renames, orderings, new sets and merges would change, item by item, saved nowhere */
  previewOrganize: {
    input: {
      body?: OrganizePlan;
    };
    output: OrganizePreview;
  };
  /** Before adding something new: the machine's guess of what it is and where it belongs, from its name (a date in it, words of a title), and files already held that look like it */
  proposeUpload: {
    input: {
      body: {
        what: "hanacha" | "recording" | "document";
        /** Its file name or title */
        name?: string;
        /** A file, named by its sha256 */
        sha256?: string;
        pageHashes?: Array<string | null>;
      };
    };
    output: Record<string, unknown>;
  };
  /** The API's Protected Resource Metadata (RFC 9728): which authorization server gives its tokens */
  protectedResource: {
    input: Record<string, never>;
    output: ProtectedResource;
  };
  /** Add or change one item in a draft suggestion (data null deletes it) */
  putSuggestionItem: {
    input: {
      id: number;
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        id?: string;
        type: string;
        data: Record<string, unknown> | null;
        path?: string | null;
      };
    };
    output: {
      /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
      id: string;
    };
  };
  /** The hanacha synced to this recording, paragraph by paragraph */
  recordingHanacha: {
    input: {
      id: string;
    };
    output: Record<string, unknown>;
  };
  /** Several recordings' synced hanachos at once (a farbrengen's parts), by recording; those with none are left out */
  recordingsHanacha: {
    input: {
      /** The recordings */
      ids: string;
    };
    output: {
      items: Record<string, Record<string, unknown>>;
    };
  };
  /** A recording's transcript, with its sync by paragraph and word */
  recordingTranscript: {
    input: {
      id: string;
    };
    output: Transcript;
  };
  /** How many items point at each item through a field (field=work&type=unit: each work's units) */
  refCounts: {
    input: {
      /** The field */
      field: string;
      /** Only items of this type */
      type?: string;
    };
    output: {
      counts: Record<string, number>;
    };
  };
  /** Let go of an item you held */
  releaseClaim: {
    input: {
      slug: string;
      body: {
        item: string;
      };
    };
    output: {
      ok: true;
    };
  };
  /** Stop asking someone to review */
  removeReviewRequest: {
    input: {
      id: number;
      username: string;
    };
    output: {
      ok: true;
    };
  };
  /** Undo a withdrawal: your suggestion is open for review again (its checks run again) */
  reopenSuggestion: {
    input: {
      id: number;
    };
    output: Suggestion;
  };
  /** Report a problem (no account needed: a captcha and an hourly limit instead) */
  report: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        entityId?: string;
        reason: "wrong-fact" | "missing-page" | "bad-scan" | "audio-problem" | "wrong-text" | "duplicate" | "rights" | "offensive" | "other";
        note?: string;
        /** A title of its own, as an issue */
        title?: string;
        /** A Turnstile token, when not signed in */
        captcha?: string;
      };
    };
    output: {
      id: number;
      number: number | null;
    };
  };
  /** Ask the machine to read a scan (ocr) or transcribe a recording (transcript) */
  requestMachineWork: {
    input: {
      body: {
        kind: "ocr" | "transcript";
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        item: string;
      };
    };
    output: {
      request: MachineRequest;
      created: boolean;
      startsAtOnce: boolean;
    };
  };
  /** Ask people to review (asking again asks again) */
  requestReview: {
    input: {
      id: number;
      body: {
        /** Handles */
        reviewers: Array<string>;
      };
    };
    output: {
      requested: Array<string>;
    };
  };
  /** Ask for a file to stop being served (no account needed); stewards answer within two weeks */
  requestTakedown: {
    input: {
      body: {
        /** The address of its page, an id, or the file address */
        target: string;
        name: string;
        email: string;
        relation: "rights-holder" | "family" | "representative" | "other";
        statement: string;
        captcha?: string;
      };
    };
    output: {
      id: number;
      answerWithinDays?: number;
    };
  };
  /** Resolve (or unresolve) a comment on a suggestion's field */
  resolveComment: {
    input: {
      id: number;
      body?: {
        /** false to unresolve */
        resolved?: boolean;
      };
    };
    output: {
      ok: true;
    };
  };
  /** The item at a readable path (an old path answers with where it moved) */
  resolvePath: {
    input: {
      /** A path such as /likkutei-sichos/12/3 */
      path: string;
    };
    output: {
      /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
      id: string;
      redirected: boolean;
      path: string | null;
    };
  };
  /** Suggest restoring an earlier version of an item */
  restoreItem: {
    input: {
      id: string;
      body: {
        /** The revision to restore */
        rev: number;
      };
    };
    output: {
      suggestion: number;
    };
  };
  /** Undo a merged suggestion (a new suggestion that reverses it) */
  revertSuggestion: {
    input: {
      id: number;
      body?: {
        reason?: string;
      };
    };
    output: {
      changeset?: number;
      commit?: number | null;
    };
  };
  /** Review a live change after it went live: keep it (approve) or undo it (revert) */
  reviewLive: {
    input: {
      id: number;
      body: {
        verdict: "approve" | "revert";
        note?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Review: approve (it goes into the catalog, where you may merge it), request changes (sent back), or comment; with comments on fields */
  reviewSuggestion: {
    input: {
      id: number;
      body: {
        verdict: "approve" | "request_changes" | "comment";
        body?: string;
        comments?: Array<{
          /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
          entity: string;
          field: string;
          body: string;
        }>;
        /** For each item, how each clashing field is settled: {item: {field: {take: "ours" (the site) | "theirs" (the suggestion)}}}; `*` stands for every item or every field not named */
        resolutions?: Record<string, unknown>;
      };
    };
    output: Record<string, unknown>;
  };
  /** What crawlers may read on the API: the guides and the files, not the routes */
  robotsTxt: {
    input: Record<string, never>;
    output: string;
  };
  /** Redirects to /v1 */
  root: {
    input: Record<string, never>;
    output: Response;
  };
  /** Keep where you stopped in one thing */
  savePlace: {
    input: {
      body: {
        kind: "read" | "listen";
        key: string;
        title: string;
        sub?: string;
        href: string;
        place: Record<string, unknown>;
      };
    };
    output: Record<string, unknown>;
  };
  /** A served scan's page images and thumbnails, and its IIIF manifest */
  scanPages: {
    input: {
      id: string;
    };
    output: Record<string, unknown>;
  };
  /** How far each page of a scan is proofread (0, 1 or 2) */
  scanProgress: {
    input: {
      id: string;
    };
    output: {
      pages: number;
      levels: Array<number>;
    };
  };
  /** A page of a scan's text: the community page, else the seed layer's; each line with its proofread level */
  scanText: {
    input: {
      id: string;
      /** The page */
      page?: number;
    };
    output: ScanTextPage;
  };
  /** Search names, text and dates, in Hebrew or English */
  search: {
    input: {
      /** The query */
      q: string;
      /** Only this type */
      type?: string;
      /** How many (at most 100) */
      limit?: number;
    };
    output: {
      query: string;
      date: {
        key?: string;
        he?: string;
        en?: string;
      } | null;
      results: Array<Item>;
    };
  };
  /** Where the words are: lines on scans' pages (open at the line) and paragraphs of texts and transcripts (open at the moment heard) */
  searchMoments: {
    input: {
      /** The words */
      q: string;
      /** How many (at most 100) */
      limit?: number;
    };
    output: {
      query: string;
      moments: Array<Record<string, unknown>>;
    };
  };
  /** People to @mention: handles that start with, or names that contain, what is typed; those in the conversation first */
  searchPeople: {
    input: {
      /** What follows the @ */
      q?: string;
      /** Account ids, comma separated (at most 100): who each is, instead of a search */
      ids?: string;
      /** changeset:<id> or report:<id> */
      thread?: string;
      /** How many (at most 20) */
      limit?: number;
    };
    output: {
      people: Array<Record<string, unknown>>;
    };
  };
  /** Search by meaning (embeddings); every result is the machine's guess */
  searchSimilar: {
    input: {
      /** A question or an idea, in Hebrew, Yiddish or English */
      q: string;
      /** Some of unit, event, segment, text-page, work, comma separated */
      types?: string;
      /** How many (at most 50) */
      limit?: number;
    };
    output: {
      query: string;
      available: boolean;
      machine?: true;
      model?: string;
      results: Array<Record<string, unknown>>;
    };
  };
  /** Suggestions and issues to #mention, by number or words */
  searchThreads: {
    input: {
      /** What follows the # */
      q?: string;
      /** How many (at most 20) */
      limit?: number;
    };
    output: {
      threads: Array<{
        kind?: "changeset" | "report";
        number?: number;
        title?: string;
        state?: string;
      }>;
    };
  };
  /** Keepers: seed the community text from this OCR layer (checked lines are kept) */
  seedScanText: {
    input: {
      id: string;
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        layer: string;
      };
    };
    output: Suggestion;
  };
  /** Send back with a note */
  sendBackSuggestion: {
    input: {
      id: number;
      body?: {
        note?: string;
      };
    };
    output: {
      ok: true;
    };
  };
  /** Set who it is assigned to (yourself; others when you may triage) */
  setIssueAssignees: {
    input: {
      number: number;
      body: {
        assignees: Array<string>;
      };
    };
    output: Record<string, unknown>;
  };
  /** Set its labels (keepers, stewards, trusted people) */
  setIssueLabels: {
    input: {
      number: number;
      body: {
        labels: Array<string>;
      };
    };
    output: Record<string, unknown>;
  };
  /** Close as completed or not planned, or reopen */
  setIssueState: {
    input: {
      number: number;
      body: {
        state: "open" | "completed" | "not_planned";
        note?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Make it private or public (stewards and keepers) */
  setIssueVisibility: {
    input: {
      number: number;
      body: {
        private: boolean;
      };
    };
    output: Record<string, unknown>;
  };
  /** Held files that look like this one (the same scan or recording in other bytes): a machine's guess */
  similarFiles: {
    input: {
      sha256: string;
    };
    output: Record<string, unknown>;
  };
  /** One sitemap's items: their ids, paths and when each last changed */
  sitemapPage: {
    input: {
      type: "set" | "author" | "person" | "work" | "unit" | "event" | "publication" | "recording";
      page: number;
    };
    output: {
      type: string;
      page: number;
      items: Array<{
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        id: string;
        path: string | null;
        lastmod: string | null;
      }>;
    };
  };
  /** Every sitemap there is: each kind of item with a page of its own, in pages of pageSize items (id order), with when each page last changed */
  sitemaps: {
    input: Record<string, never>;
    output: {
      pageSize: number;
      sitemaps: Array<{
        type: string;
        page: number;
        count: number;
        lastmod: string | null;
      }>;
    };
  };
  /** How many items of each type, and the latest commit */
  stats: {
    input: Record<string, never>;
    output: {
      head: number;
      counts: Record<string, number>;
    };
  };
  /** Whether RebbeHub is up: the last checks of the site, the API, the MCP server, the database, its daily query allowance, the Workers' load and the scheduled jobs, with 90 days of them and the latest incidents */
  status: {
    input: Record<string, never>;
    output: {
      now: string;
      report: StatusReport | null;
    };
  };
  /** Send for review (runs the automatic checks) */
  submitSuggestion: {
    input: {
      id: number;
    };
    output: Suggestion;
  };
  /** Suggest a fix in one step: a new version of one item, with a few words on why, sent for review */
  suggestFix: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        entityId: string;
        /** The item's whole new data */
        data: Record<string, unknown>;
        title?: string;
        note?: string;
      };
    };
    output: Suggestion;
  };
  /** A suggestion's timeline (comments, reviews, events), the reviewers asked, and the issues it closes */
  suggestionConversation: {
    input: {
      id: number;
    };
    output: {
      number: number;
      timeline: Array<Record<string, unknown>>;
      people?: Record<string, unknown>;
      reviewRequests?: Array<Record<string, unknown>>;
      fixes?: Array<Record<string, unknown>>;
      subscribed?: boolean;
    };
  };
  /** A page's words fixed segment by segment: one segment's new words, a segment added after it or taken out, a page's first words, or a machine's segment checked as right (`check`), sent for review */
  suggestWords: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        entityId: string;
        change: "edit" | "add" | "remove" | "start" | "check";
        version?: string;
        segment?: string;
        /** Runs: { text, marks?, href? }, { note }, { marker }, { br: true } */
        text?: Array<Record<string, unknown>>;
        /** The segment as the person saw it; a change since answers 409 */
        before?: Array<Record<string, unknown>>;
        kind?: "paragraph" | "heading" | "verse" | "item";
        language?: string;
        title?: string;
        note?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** How many paragraphs each of several texts has, and how many of them a person checked */
  textsProgress: {
    input: {
      /** The texts */
      ids: string;
    };
    output: {
      progress: Record<string, {
        paragraphs: number;
        checked: number;
      }>;
    };
  };
  /** Which of the two #12 is: a suggestion or an issue, and its id */
  threadByNumber: {
    input: {
      number: number;
    };
    output: {
      kind: "suggestion" | "issue";
      number: number;
      id: number;
    };
  };
  /** The training clips, one JSON object a line, as the training script reads them (audio, start, end, text, split) */
  trainingClips: {
    input: Record<string, never>;
    output: Record<string, unknown>;
  };
  /** The next Rebbe Whisper's training data so far: every transcript paragraph a person checked, as clips */
  trainingSummary: {
    input: {
      /** A date: also count the hours checked since then */
      since?: string;
    };
    output: {
      clips: number;
      hours: number;
      gold: number;
      silver: number;
      trainHours: number;
      testHours: number;
      recordings: number;
      newHours: number | null;
      skipped: Record<string, unknown>;
      /** What the next model waits for: hours and farbrengens checked since the last one, against the target, and the farbrengens to check next (the most wanted first) */
      goal: Record<string, unknown>;
    };
  };
  /** Everything that happened to a recording's transcript, newest first */
  transcriptHistory: {
    input: {
      id: string;
      limit?: number;
    };
    output: {
      history: Array<Record<string, unknown>>;
    };
  };
  /** Every kind of item and its JSON Schema */
  types: {
    input: Record<string, never>;
    output: {
      types: Array<{
        type: string;
        schema: Record<string, unknown>;
      }>;
    };
  };
  /** The printings of a unit whose text the catalog has, to compare */
  unitPrintings: {
    input: {
      id: string;
    };
    output: {
      printings: Array<Record<string, unknown>>;
    };
  };
  /** Stop email updates, from the link in any of them (no sign-in) */
  unsubscribe: {
    input: {
      token?: string;
      body?: {
        token?: string;
      };
    };
    output: {
      stopped?: boolean;
    };
  };
  /** Add a file: a recording of a farbrengen; a hanacha's PDF for a farbrengen or sicha; a scan (another scan of a printing, a new printing of a sefer, a teshura); or other material (a new sefer, a letter, a document) */
  upload: {
    input: {
      /** What it is */
      what: "recording" | "hanacha" | "scan" | "document";
      /** The farbrengen, sicha, sefer, printing or Teshuros set it is added to */
      for?: string;
      /** For a recording or hanacha of a farbrengen the catalog lacks: its name */
      eventTitle?: string;
      /** With eventTitle: its date key */
      eventDate?: string;
      /** For a hanacha: what kind */
      kind?: "bilti-mugah" | "mugah" | "maamar" | "hagahos" | "hosofos" | "english" | "other";
      /** For a document: the set it belongs in */
      set?: string;
      /** For a new sefer: its author */
      author?: string;
      /** For a new sefer: its genre */
      genre?: string;
      /** For a letter: the letter the catalog has that it reproduces */
      unit?: string;
      /** What you know of its rights */
      rights: "mine" | "free" | "public-domain" | "unsure";
      /** For a scan: scan-of, printing or teshura. For a document: sefer, letter or document */
      as?: "scan-of" | "printing" | "teshura" | "sefer" | "letter" | "document";
      /** Its name */
      title?: string;
      /** For scan-of: the printing */
      publication?: string;
      /** For a printing */
      publisher?: string;
      /** For a printing: a Hebrew or civil year */
      year?: string;
      /** For a printing: 1 for the first */
      printing?: number;
      /** For a teshura: its families, as printed */
      families?: string;
      /** For a teshura: wedding, bar-mitzvah, and so on */
      simcha?: string;
      /** For a teshura: the simcha's date key; for a letter or document, its date */
      date?: string;
      body: Blob | ArrayBuffer | Uint8Array | ReadableStream;
      /** The body's type (audio/mpeg, application/pdf…); default application/octet-stream */
      contentType?: string;
    };
    output: Response;
  };
  /** Upload your own OCR of a scan (hOCR, ALTO, or plain text with form feeds between pages) as a new layer */
  uploadOcr: {
    input: {
      id: string;
      body: {
        content: string;
        format?: "hocr" | "alto" | "text";
        engine: {
          name: string;
          version: string;
        };
        firstPage?: number;
        language?: string;
      };
    };
    output: Record<string, unknown>;
  };
  /** Withdraw your suggestion */
  withdrawSuggestion: {
    input: {
      id: number;
    };
    output: {
      ok: true;
    };
  };
  /** A sefer's cover, the page a person chose, and the PDFs (served, or linked) its title page may be chosen from */
  workCover: {
    input: {
      id: string;
    };
    output: {
      /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
      work: string;
      chosen: {
        /** A file, named by its sha256 */
        file: string;
        page: number;
      } | null;
      cover: Cover | null;
      sources: Array<Record<string, unknown>>;
    };
  };
  /** A work's volumes (its top-level parts), with how many units each holds */
  workOutline: {
    input: {
      id: string;
    };
    output: {
      parts: Array<{
        value?: string;
        label?: Record<string, unknown> | null;
        units?: number;
      }>;
    };
  };
  /** The units of one volume of a work */
  workPart: {
    input: {
      id: string;
      /** The volume, as the outline names it */
      part: string;
      /** How many (at most 1000) */
      limit?: number;
    };
    output: {
      items: Array<Item>;
    };
  };
}

/** How each operation is called. */
export const OPERATIONS = {
  about: {"method":"GET","path":"/v1","pathParams":[],"query":[],"body":null,"answer":"json"},
  addHanachaText: {"method":"POST","path":"/v1/hanachos/text","pathParams":[],"query":[],"body":"json","answer":"json"},
  addTranslation: {"method":"POST","path":"/v1/units/{id}/translations","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  anchorSync: {"method":"POST","path":"/v1/recordings/{id}/sync/anchor","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  appAndroidDownload: {"method":"GET","path":"/v1/app/v1/app/android/download/{abi}","pathParams":["abi"],"query":[],"body":null,"answer":"raw"},
  appAndroidLatest: {"method":"GET","path":"/v1/app/v1/app/android/latest.json","pathParams":[],"query":[],"body":null,"answer":"raw"},
  appCatalogChangelog: {"method":"GET","path":"/v1/app/{schema}/catalog/changelog.json","pathParams":["schema"],"query":[],"body":null,"answer":"json"},
  appCatalogLatest: {"method":"GET","path":"/v1/app/{schema}/catalog/latest/catalog.json","pathParams":["schema"],"query":[],"body":null,"answer":"raw"},
  appCatalogManifest: {"method":"GET","path":"/v1/app/{schema}/catalog/manifest.json","pathParams":["schema"],"query":[],"body":null,"answer":"json"},
  appCatalogRelease: {"method":"GET","path":"/v1/app/{schema}/catalog/{version}/catalog.json","pathParams":["schema","version"],"query":[],"body":null,"answer":"json"},
  approveSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/approve","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  appSourceText: {"method":"GET","path":"/v1/app/v3/texts/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"text"},
  authorizationServer: {"method":"GET","path":"/.well-known/oauth-authorization-server","pathParams":[],"query":[],"body":null,"answer":"json"},
  catalogTree: {"method":"GET","path":"/v1/tree","pathParams":[],"query":["root","depth","limit"],"body":null,"answer":"json"},
  checkUpload: {"method":"POST","path":"/v1/uploads/check","pathParams":[],"query":[],"body":"json","answer":"json"},
  claimNext: {"method":"POST","path":"/v1/projects/{slug}/next","pathParams":["slug"],"query":[],"body":null,"answer":"json"},
  closeProject: {"method":"POST","path":"/v1/projects/{slug}/close","pathParams":["slug"],"query":[],"body":null,"answer":"json"},
  closeReport: {"method":"POST","path":"/v1/reports/{id}/close","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  commentOnIssue: {"method":"POST","path":"/v1/issues/{number}/comments","pathParams":["number"],"query":[],"body":"json","answer":"json"},
  commentOnItem: {"method":"POST","path":"/v1/entities/{id}/talk","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  commentOnSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/comments","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  community: {"method":"GET","path":"/v1/community","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  comparePrintings: {"method":"GET","path":"/v1/compare","pathParams":[],"query":["a","b"],"body":null,"answer":"json"},
  confirmScanPage: {"method":"POST","path":"/v1/scans/{id}/text/confirm","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  confirmSync: {"method":"POST","path":"/v1/recordings/{id}/sync/confirm","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  covers: {"method":"GET","path":"/v1/covers","pathParams":[],"query":["ids"],"body":null,"answer":"json"},
  createLabel: {"method":"POST","path":"/v1/labels","pathParams":[],"query":[],"body":"json","answer":"json"},
  createProject: {"method":"POST","path":"/v1/projects","pathParams":[],"query":[],"body":"json","answer":"json"},
  createSuggestion: {"method":"POST","path":"/v1/suggestions","pathParams":[],"query":[],"body":"json","answer":"json"},
  createWebhook: {"method":"POST","path":"/v1/webhooks","pathParams":[],"query":[],"body":"json","answer":"json"},
  deleteWebhook: {"method":"DELETE","path":"/v1/webhooks/{id}","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  driveFile: {"method":"GET","path":"/v1/drive/{id}","pathParams":["id"],"query":[],"body":null,"answer":"raw"},
  driveFix: {"method":"GET","path":"/v1/page-fixes/drive/{id}","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  editComment: {"method":"PATCH","path":"/v1/comments/{id}","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  editionChecksums: {"method":"GET","path":"/v1/editions/{tag}/SHA256SUMS","pathParams":["tag"],"query":[],"body":null,"answer":"text"},
  editionManifest: {"method":"GET","path":"/v1/editions/{tag}/manifest.json","pathParams":["tag"],"query":[],"body":null,"answer":"json"},
  editions: {"method":"GET","path":"/v1/editions","pathParams":[],"query":[],"body":null,"answer":"json"},
  editIssue: {"method":"PATCH","path":"/v1/issues/{number}","pathParams":["number"],"query":[],"body":"json","answer":"json"},
  editSuggestion: {"method":"PATCH","path":"/v1/suggestions/{id}","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  familyRequest: {"method":"POST","path":"/v1/teshuros/{id}/family-request","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  fileAbout: {"method":"GET","path":"/v1/files/{sha256}/about","pathParams":["sha256"],"query":["limit"],"body":null,"answer":"json"},
  fixScanLine: {"method":"POST","path":"/v1/scans/{id}/text/fix","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  fixTranscript: {"method":"POST","path":"/v1/recordings/{id}/transcript/fix","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  fixTranslation: {"method":"POST","path":"/v1/translations/fix","pathParams":[],"query":[],"body":"json","answer":"json"},
  follow: {"method":"POST","path":"/v1/follows","pathParams":[],"query":[],"body":"json","answer":"json"},
  forgetPlace: {"method":"DELETE","path":"/v1/places","pathParams":[],"query":["kind","key"],"body":null,"answer":"json"},
  getDump: {"method":"GET","path":"/dumps/{tag}/{name}","pathParams":["tag","name"],"query":[],"body":null,"answer":"raw"},
  getFile: {"method":"GET","path":"/v1/files/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"json"},
  getFiles: {"method":"GET","path":"/v1/files/batch","pathParams":[],"query":["ids"],"body":null,"answer":"json"},
  getIssue: {"method":"GET","path":"/v1/issues/{number}","pathParams":["number"],"query":[],"body":null,"answer":"json"},
  getItem: {"method":"GET","path":"/v1/entities/{id}","pathParams":["id"],"query":["at"],"body":null,"answer":"json"},
  getItems: {"method":"GET","path":"/v1/entities/batch","pathParams":[],"query":["ids"],"body":null,"answer":"json"},
  getManifest: {"method":"GET","path":"/manifests/{collection}/{name}","pathParams":["collection","name"],"query":[],"body":null,"answer":"json"},
  getObject: {"method":"GET","path":"/objects/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"raw"},
  getProfile: {"method":"GET","path":"/v1/people/{username}","pathParams":["username"],"query":["limit"],"body":null,"answer":"json"},
  getProject: {"method":"GET","path":"/v1/projects/{slug}","pathParams":["slug"],"query":[],"body":null,"answer":"json"},
  getRevision: {"method":"GET","path":"/v1/revisions/{rev}","pathParams":["rev"],"query":[],"body":null,"answer":"json"},
  getSourceText: {"method":"GET","path":"/v1/texts/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"text"},
  getSuggestion: {"method":"GET","path":"/v1/suggestions/{id}","pathParams":["id"],"query":["offset","limit","summary","brief"],"body":null,"answer":"json"},
  health: {"method":"GET","path":"/v1/health","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  hideComment: {"method":"POST","path":"/v1/comments/{id}/hide","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  iiifManifest: {"method":"GET","path":"/manifests/iiif/{file}","pathParams":["file"],"query":[],"body":null,"answer":"json"},
  inbox: {"method":"GET","path":"/v1/inbox","pathParams":[],"query":["filter","before","limit","cursor"],"body":null,"answer":"json","items":"items"},
  inboxCount: {"method":"GET","path":"/v1/inbox/count","pathParams":[],"query":[],"body":null,"answer":"json"},
  issueTemplates: {"method":"GET","path":"/v1/issues/templates","pathParams":[],"query":[],"body":null,"answer":"json"},
  itemBacklinks: {"method":"GET","path":"/v1/entities/{id}/backlinks","pathParams":["id"],"query":["field","type"],"body":null,"answer":"json"},
  itemHistory: {"method":"GET","path":"/v1/entities/{id}/history","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  itemRelations: {"method":"GET","path":"/v1/entities/{id}/relations","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  itemTalk: {"method":"GET","path":"/v1/entities/{id}/talk","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  linkedCounts: {"method":"GET","path":"/v1/entities/{id}/linked/counts","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  linkedOfEach: {"method":"GET","path":"/v1/entities/batch/linked","pathParams":[],"query":["ids","field","type","limit"],"body":null,"answer":"json"},
  listChildren: {"method":"GET","path":"/v1/entities/{id}/children","pathParams":["id"],"query":["field","type","after","limit","cursor"],"body":null,"answer":"json","items":"items"},
  listCommits: {"method":"GET","path":"/v1/commits","pathParams":[],"query":["since","limit","changes","cursor"],"body":null,"answer":"json","items":"commits"},
  listEvents: {"method":"GET","path":"/v1/events","pathParams":[],"query":["within","day","dates","missing","brief","limit"],"body":null,"answer":"json"},
  listFollows: {"method":"GET","path":"/v1/follows","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  listIssues: {"method":"GET","path":"/v1/issues","pathParams":[],"query":["state","label","type","set","entity","assignee","author","q","before","limit","cursor"],"body":null,"answer":"json","items":"items"},
  listItems: {"method":"GET","path":"/v1/entities","pathParams":[],"query":["type","set","after","limit","cursor"],"body":null,"answer":"json","items":"items"},
  listLabels: {"method":"GET","path":"/v1/labels","pathParams":[],"query":[],"body":null,"answer":"json"},
  listLinked: {"method":"GET","path":"/v1/entities/{id}/linked","pathParams":["id"],"query":["field","type","after","limit","cursor"],"body":null,"answer":"json","items":"items"},
  listPlaces: {"method":"GET","path":"/v1/places","pathParams":[],"query":["kind","key","limit"],"body":null,"answer":"json"},
  listProjects: {"method":"GET","path":"/v1/projects","pathParams":[],"query":["status"],"body":null,"answer":"json"},
  listReports: {"method":"GET","path":"/v1/reports","pathParams":[],"query":["set","status"],"body":null,"answer":"json"},
  listSuggestions: {"method":"GET","path":"/v1/suggestions","pathParams":[],"query":["status","state","author","reviewer","q","about","postReview","limit","cursor"],"body":null,"answer":"json","items":"suggestions"},
  listWebhooks: {"method":"GET","path":"/v1/webhooks","pathParams":[],"query":[],"body":null,"answer":"json"},
  llmsTxt: {"method":"GET","path":"/llms.txt","pathParams":[],"query":[],"body":null,"answer":"text"},
  machineRequests: {"method":"GET","path":"/v1/machine/requests","pathParams":[],"query":["kind","status","item","items","limit"],"body":null,"answer":"json"},
  machineSummary: {"method":"GET","path":"/v1/machine","pathParams":[],"query":[],"body":null,"answer":"json"},
  machineToCheck: {"method":"GET","path":"/v1/machine/to-check","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  mapContents: {"method":"POST","path":"/v1/suggestions/contents-map","pathParams":[],"query":[],"body":"json","answer":"json"},
  markInboxRead: {"method":"POST","path":"/v1/inbox/read","pathParams":[],"query":[],"body":"json","answer":"json"},
  mcp: {"method":"POST","path":"/mcp","pathParams":[],"query":[],"body":"json","answer":"json"},
  mcpProtectedResource: {"method":"GET","path":"/.well-known/oauth-protected-resource/mcp","pathParams":[],"query":[],"body":null,"answer":"json"},
  mirrors: {"method":"GET","path":"/v1/mirrors","pathParams":[],"query":[],"body":null,"answer":"json"},
  missing: {"method":"GET","path":"/v1/missing","pathParams":[],"query":["kind","within","limit"],"body":null,"answer":"json"},
  oai: {"method":"GET","path":"/oai","pathParams":[],"query":["verb","metadataPrefix","identifier","from","until","set","resumptionToken"],"body":null,"answer":"text"},
  oaiPost: {"method":"POST","path":"/oai","pathParams":[],"query":[],"body":"application/x-www-form-urlencoded","answer":"text"},
  oauthAuthorize: {"method":"GET","path":"/oauth/authorize","pathParams":[],"query":["response_type","client_id","redirect_uri","scope","state","code_challenge","code_challenge_method","resource","ui_locales"],"body":null,"answer":"raw"},
  oauthRegister: {"method":"POST","path":"/oauth/register","pathParams":[],"query":[],"body":"json","answer":"json"},
  oauthRevoke: {"method":"POST","path":"/oauth/revoke","pathParams":[],"query":[],"body":"application/x-www-form-urlencoded","answer":"raw"},
  oauthToken: {"method":"POST","path":"/oauth/token","pathParams":[],"query":[],"body":"application/x-www-form-urlencoded","answer":"json"},
  openapi: {"method":"GET","path":"/openapi.json","pathParams":[],"query":[],"body":null,"answer":"json"},
  openIssue: {"method":"POST","path":"/v1/issues","pathParams":[],"query":[],"body":"json","answer":"json"},
  organize: {"method":"POST","path":"/v1/organize","pathParams":[],"query":[],"body":"json","answer":"json"},
  parseDate: {"method":"GET","path":"/v1/dates/parse","pathParams":[],"query":["q"],"body":null,"answer":"json"},
  previewOrganize: {"method":"POST","path":"/v1/organize/preview","pathParams":[],"query":[],"body":"json","answer":"json"},
  proposeUpload: {"method":"POST","path":"/v1/uploads/propose","pathParams":[],"query":[],"body":"json","answer":"json"},
  protectedResource: {"method":"GET","path":"/.well-known/oauth-protected-resource","pathParams":[],"query":[],"body":null,"answer":"json"},
  putSuggestionItem: {"method":"PUT","path":"/v1/suggestions/{id}/items","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  recordingHanacha: {"method":"GET","path":"/v1/recordings/{id}/hanacha","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  recordingsHanacha: {"method":"GET","path":"/v1/recordings/batch/hanacha","pathParams":[],"query":["ids"],"body":null,"answer":"json"},
  recordingTranscript: {"method":"GET","path":"/v1/recordings/{id}/transcript","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  refCounts: {"method":"GET","path":"/v1/refcounts","pathParams":[],"query":["field","type"],"body":null,"answer":"json"},
  releaseClaim: {"method":"POST","path":"/v1/projects/{slug}/release","pathParams":["slug"],"query":[],"body":"json","answer":"json"},
  removeReviewRequest: {"method":"DELETE","path":"/v1/suggestions/{id}/review-requests/{username}","pathParams":["id","username"],"query":[],"body":null,"answer":"json"},
  reopenSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/reopen","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  report: {"method":"POST","path":"/v1/reports","pathParams":[],"query":[],"body":"json","answer":"json"},
  requestMachineWork: {"method":"POST","path":"/v1/machine/requests","pathParams":[],"query":[],"body":"json","answer":"json"},
  requestReview: {"method":"POST","path":"/v1/suggestions/{id}/review-requests","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  requestTakedown: {"method":"POST","path":"/v1/takedowns","pathParams":[],"query":[],"body":"json","answer":"json"},
  resolveComment: {"method":"POST","path":"/v1/comments/{id}/resolve","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  resolvePath: {"method":"GET","path":"/v1/resolve","pathParams":[],"query":["path"],"body":null,"answer":"json"},
  restoreItem: {"method":"POST","path":"/v1/entities/{id}/restore","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  revertSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/revert","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  reviewLive: {"method":"POST","path":"/v1/suggestions/{id}/review-live","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  reviewSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/reviews","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  robotsTxt: {"method":"GET","path":"/robots.txt","pathParams":[],"query":[],"body":null,"answer":"text"},
  root: {"method":"GET","path":"/","pathParams":[],"query":[],"body":null,"answer":"raw"},
  savePlace: {"method":"PUT","path":"/v1/places","pathParams":[],"query":[],"body":"json","answer":"json"},
  scanPages: {"method":"GET","path":"/v1/scans/{id}/pages","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  scanProgress: {"method":"GET","path":"/v1/scans/{id}/progress","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  scanText: {"method":"GET","path":"/v1/scans/{id}/text","pathParams":["id"],"query":["page"],"body":null,"answer":"json"},
  search: {"method":"GET","path":"/v1/search","pathParams":[],"query":["q","type","limit"],"body":null,"answer":"json"},
  searchMoments: {"method":"GET","path":"/v1/search/moments","pathParams":[],"query":["q","limit"],"body":null,"answer":"json"},
  searchPeople: {"method":"GET","path":"/v1/people","pathParams":[],"query":["q","ids","thread","limit"],"body":null,"answer":"json"},
  searchSimilar: {"method":"GET","path":"/v1/search/similar","pathParams":[],"query":["q","types","limit"],"body":null,"answer":"json"},
  searchThreads: {"method":"GET","path":"/v1/threads","pathParams":[],"query":["q","limit"],"body":null,"answer":"json"},
  seedScanText: {"method":"POST","path":"/v1/scans/{id}/text/seed","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  sendBackSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/send-back","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  setIssueAssignees: {"method":"PUT","path":"/v1/issues/{number}/assignees","pathParams":["number"],"query":[],"body":"json","answer":"json"},
  setIssueLabels: {"method":"PUT","path":"/v1/issues/{number}/labels","pathParams":["number"],"query":[],"body":"json","answer":"json"},
  setIssueState: {"method":"POST","path":"/v1/issues/{number}/state","pathParams":["number"],"query":[],"body":"json","answer":"json"},
  setIssueVisibility: {"method":"POST","path":"/v1/issues/{number}/visibility","pathParams":["number"],"query":[],"body":"json","answer":"json"},
  similarFiles: {"method":"GET","path":"/v1/files/{sha256}/similar","pathParams":["sha256"],"query":[],"body":null,"answer":"json"},
  sitemapPage: {"method":"GET","path":"/v1/sitemap/{type}/{page}","pathParams":["type","page"],"query":[],"body":null,"answer":"json"},
  sitemaps: {"method":"GET","path":"/v1/sitemap","pathParams":[],"query":[],"body":null,"answer":"json"},
  stats: {"method":"GET","path":"/v1/stats","pathParams":[],"query":[],"body":null,"answer":"json"},
  status: {"method":"GET","path":"/v1/status","pathParams":[],"query":[],"body":null,"answer":"json"},
  submitSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/submit","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  suggestFix: {"method":"POST","path":"/v1/suggestions/quick","pathParams":[],"query":[],"body":"json","answer":"json"},
  suggestionConversation: {"method":"GET","path":"/v1/suggestions/{id}/conversation","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  suggestWords: {"method":"POST","path":"/v1/suggestions/words","pathParams":[],"query":[],"body":"json","answer":"json"},
  textsProgress: {"method":"GET","path":"/v1/texts/batch/progress","pathParams":[],"query":["ids"],"body":null,"answer":"json"},
  threadByNumber: {"method":"GET","path":"/v1/threads/{number}","pathParams":["number"],"query":[],"body":null,"answer":"json"},
  trainingClips: {"method":"GET","path":"/v1/machine/training/clips","pathParams":[],"query":[],"body":null,"answer":"json"},
  trainingSummary: {"method":"GET","path":"/v1/machine/training","pathParams":[],"query":["since"],"body":null,"answer":"json"},
  transcriptHistory: {"method":"GET","path":"/v1/recordings/{id}/transcript/history","pathParams":["id"],"query":["limit"],"body":null,"answer":"json"},
  types: {"method":"GET","path":"/v1/types","pathParams":[],"query":[],"body":null,"answer":"json"},
  unitPrintings: {"method":"GET","path":"/v1/units/{id}/printings","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  unsubscribe: {"method":"POST","path":"/v1/auth/email/unsubscribe","pathParams":[],"query":["token"],"body":"json","answer":"json"},
  upload: {"method":"POST","path":"/v1/uploads","pathParams":[],"query":["what","for","eventTitle","eventDate","kind","set","author","genre","unit","rights","as","title","publication","publisher","year","printing","families","simcha","date"],"body":"application/octet-stream","answer":"raw"},
  uploadOcr: {"method":"POST","path":"/v1/scans/{id}/ocr","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  withdrawSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/withdraw","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  workCover: {"method":"GET","path":"/v1/works/{id}/cover","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  workOutline: {"method":"GET","path":"/v1/works/{id}/outline","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  workPart: {"method":"GET","path":"/v1/works/{id}/parts/{part}","pathParams":["id","part"],"query":["limit"],"body":null,"answer":"json"},
} as const;

export type OperationId = keyof Operations;
/** Operations whose answers come a page at a time. */
export type PagedOperationId = "inbox" | "listChildren" | "listCommits" | "listIssues" | "listItems" | "listLinked" | "listSuggestions";

/** A typed method for every operation; the calls themselves are in client.ts. */
export abstract class GeneratedMethods {
  protected abstract call<K extends OperationId>(operation: K, input: Operations[K]["input"]): Promise<Operations[K]["output"]>;

  /** About this API: its version, the latest commit, where the docs are (GET /v1) */
  about(): Promise<Operations['about']['output']> {
    return this.call('about', {} as Operations['about']['input']);
  }

  /** A hanacha's words for a farbrengen or sicha (or a new farbrengen), a paragraph to a segment (POST /v1/hanachos/text) */
  addHanachaText(input: Operations['addHanachaText']['input']): Promise<Operations['addHanachaText']['output']> {
    return this.call('addHanachaText', input ?? {} as Operations['addHanachaText']['input']);
  }

  /** Suggest a translation of a unit, as its own text (POST /v1/units/{id}/translations) */
  addTranslation(input: Operations['addTranslation']['input']): Promise<Operations['addTranslation']['output']> {
    return this.call('addTranslation', input ?? {} as Operations['addTranslation']['input']);
  }

  /** The Rebbe is saying this line now: set a paragraph (or word) at atMs, lock it, move what follows (POST /v1/recordings/{id}/sync/anchor) */
  anchorSync(input: Operations['anchorSync']['input']): Promise<Operations['anchorSync']['output']> {
    return this.call('anchorSync', input ?? {} as Operations['anchorSync']['input']);
  }

  /** The phone app's APK: redirects to Sichos-Kodesh's app server (GET /v1/app/v1/app/android/download/{abi}) */
  appAndroidDownload(input: Operations['appAndroidDownload']['input']): Promise<Operations['appAndroidDownload']['output']> {
    return this.call('appAndroidDownload', input ?? {} as Operations['appAndroidDownload']['input']);
  }

  /** The phone app's newest release: redirects to Sichos-Kodesh's app server (GET /v1/app/v1/app/android/latest.json) */
  appAndroidLatest(): Promise<Operations['appAndroidLatest']['output']> {
    return this.call('appAndroidLatest', {} as Operations['appAndroidLatest']['input']);
  }

  /** The apps' catalog changelog alone (GET /v1/app/{schema}/catalog/changelog.json) */
  appCatalogChangelog(input: Operations['appCatalogChangelog']['input']): Promise<Operations['appCatalogChangelog']['output']> {
    return this.call('appCatalogChangelog', input ?? {} as Operations['appCatalogChangelog']['input']);
  }

  /** Redirects to the served release's catalog.json (GET /v1/app/{schema}/catalog/latest/catalog.json) */
  appCatalogLatest(input: Operations['appCatalogLatest']['input']): Promise<Operations['appCatalogLatest']['output']> {
    return this.call('appCatalogLatest', input ?? {} as Operations['appCatalogLatest']['input']);
  }

  /** The Sichos Kodesh apps' catalog manifest: the served release's version, size, sha256 and address (GET /v1/app/{schema}/catalog/manifest.json) */
  appCatalogManifest(input: Operations['appCatalogManifest']['input']): Promise<Operations['appCatalogManifest']['output']> {
    return this.call('appCatalogManifest', input ?? {} as Operations['appCatalogManifest']['input']);
  }

  /** The apps' catalog: the farbrengens by year (v1), with the library (v2) and the works (v3) (GET /v1/app/{schema}/catalog/{version}/catalog.json) */
  appCatalogRelease(input: Operations['appCatalogRelease']['input']): Promise<Operations['appCatalogRelease']['output']> {
    return this.call('appCatalogRelease', input ?? {} as Operations['appCatalogRelease']['input']);
  }

  /** Approve and merge (keepers of its sets, stewards) (POST /v1/suggestions/{id}/approve) */
  approveSuggestion(input: Operations['approveSuggestion']['input']): Promise<Operations['approveSuggestion']['output']> {
    return this.call('approveSuggestion', input ?? {} as Operations['approveSuggestion']['input']);
  }

  /** A text of a sefer, where the apps look for it (the same as /v1/texts/{sha256}) (GET /v1/app/v3/texts/{sha256}) */
  appSourceText(input: Operations['appSourceText']['input']): Promise<Operations['appSourceText']['output']> {
    return this.call('appSourceText', input ?? {} as Operations['appSourceText']['input']);
  }

  /** Authorization Server Metadata (RFC 8414): the endpoints, scopes read and write, PKCE S256, registration and Client ID Metadata Documents (GET /.well-known/oauth-authorization-server) */
  authorizationServer(): Promise<Operations['authorizationServer']['output']> {
    return this.call('authorizationServer', {} as Operations['authorizationServer']['input']);
  }

  /** The catalog as a tree: the top sets (or one set or sefer), the sets and items under them, and how much each holds (GET /v1/tree) */
  catalogTree(input?: Operations['catalogTree']['input']): Promise<Operations['catalogTree']['output']> {
    return this.call('catalogTree', input ?? {} as Operations['catalogTree']['input']);
  }

  /** Before an upload: whether we have it (its sha256, a few page hashes) and what it likely is (POST /v1/uploads/check) */
  checkUpload(input: Operations['checkUpload']['input']): Promise<Operations['checkUpload']['output']> {
    return this.call('checkUpload', input ?? {} as Operations['checkUpload']['input']);
  }

  /** Hand me the next item nobody holds (held for you for a few hours) (POST /v1/projects/{slug}/next) */
  claimNext(input: Operations['claimNext']['input']): Promise<Operations['claimNext']['output']> {
    return this.call('claimNext', input ?? {} as Operations['claimNext']['input']);
  }

  /** Close a project (its keepers, stewards) (POST /v1/projects/{slug}/close) */
  closeProject(input: Operations['closeProject']['input']): Promise<Operations['closeProject']['output']> {
    return this.call('closeProject', input ?? {} as Operations['closeProject']['input']);
  }

  /** Resolve or dismiss a report (keepers) (POST /v1/reports/{id}/close) */
  closeReport(input: Operations['closeReport']['input']): Promise<Operations['closeReport']['output']> {
    return this.call('closeReport', input ?? {} as Operations['closeReport']['input']);
  }

  /** Comment on an issue, or answer a comment (POST /v1/issues/{number}/comments) */
  commentOnIssue(input: Operations['commentOnIssue']['input']): Promise<Operations['commentOnIssue']['output']> {
    return this.call('commentOnIssue', input ?? {} as Operations['commentOnIssue']['input']);
  }

  /** Comment on an item's talk page (POST /v1/entities/{id}/talk) */
  commentOnItem(input: Operations['commentOnItem']['input']): Promise<Operations['commentOnItem']['output']> {
    return this.call('commentOnItem', input ?? {} as Operations['commentOnItem']['input']);
  }

  /** Comment on a suggestion, answer a comment, or comment on one field of one item (POST /v1/suggestions/{id}/comments) */
  commentOnSuggestion(input: Operations['commentOnSuggestion']['input']): Promise<Operations['commentOnSuggestion']['output']> {
    return this.call('commentOnSuggestion', input ?? {} as Operations['commentOnSuggestion']['input']);
  }

  /** The community page in numbers: the latest merges, reports and suggestions waiting, people, gaps (GET /v1/community) */
  community(input?: Operations['community']['input']): Promise<Operations['community']['output']> {
    return this.call('community', input ?? {} as Operations['community']['input']);
  }

  /** Compare two printings word by word (Hebrew-aware) (GET /v1/compare) */
  comparePrintings(input: Operations['comparePrintings']['input']): Promise<Operations['comparePrintings']['output']> {
    return this.call('comparePrintings', input ?? {} as Operations['comparePrintings']['input']);
  }

  /** This page is right: raise it a proofreading level, with any fixes (a suggestion) (POST /v1/scans/{id}/text/confirm) */
  confirmScanPage(input: Operations['confirmScanPage']['input']): Promise<Operations['confirmScanPage']['output']> {
    return this.call('confirmScanPage', input ?? {} as Operations['confirmScanPage']['input']);
  }

  /** The sync is right: mark every paragraph checked (POST /v1/recordings/{id}/sync/confirm) */
  confirmSync(input: Operations['confirmSync']['input']): Promise<Operations['confirmSync']['output']> {
    return this.call('confirmSync', input ?? {} as Operations['confirmSync']['input']);
  }

  /** Sefarim's covers, drawn from their title pages, while their PDFs are served or linked (GET /v1/covers) */
  covers(input?: Operations['covers']['input']): Promise<Operations['covers']['output']> {
    return this.call('covers', input ?? {} as Operations['covers']['input']);
  }

  /** Make a label (stewards) (POST /v1/labels) */
  createLabel(input: Operations['createLabel']['input']): Promise<Operations['createLabel']['output']> {
    return this.call('createLabel', input ?? {} as Operations['createLabel']['input']);
  }

  /** Open a project on a gap (farbrengens without recordings or texts, recordings to sync, pages to proofread) (POST /v1/projects) */
  createProject(input: Operations['createProject']['input']): Promise<Operations['createProject']['output']> {
    return this.call('createProject', input ?? {} as Operations['createProject']['input']);
  }

  /** Start a suggestion (a draft): add items to it, then submit it (POST /v1/suggestions) */
  createSuggestion(input: Operations['createSuggestion']['input']): Promise<Operations['createSuggestion']['output']> {
    return this.call('createSuggestion', input ?? {} as Operations['createSuggestion']['input']);
  }

  /** Add a webhook (up to five); its signing secret is shown this once (POST /v1/webhooks) */
  createWebhook(input: Operations['createWebhook']['input']): Promise<Operations['createWebhook']['output']> {
    return this.call('createWebhook', input ?? {} as Operations['createWebhook']['input']);
  }

  /** Remove a webhook (DELETE /v1/webhooks/{id}) */
  deleteWebhook(input: Operations['deleteWebhook']['input']): Promise<Operations['deleteWebhook']['output']> {
    return this.call('deleteWebhook', input ?? {} as Operations['deleteWebhook']['input']);
  }

  /** A Google Drive file the catalog links to (a hanacha's PDF, an Otzros scan), read for the site's reader and player (GET /v1/drive/{id}) */
  driveFile(input: Operations['driveFile']['input']): Promise<Operations['driveFile']['output']> {
    return this.call('driveFile', input ?? {} as Operations['driveFile']['input']);
  }

  /** What a PDF on Google Drive needs to read straight, by its Drive id, or the reading copy to open instead (GET /v1/page-fixes/drive/{id}) */
  driveFix(input: Operations['driveFix']['input']): Promise<Operations['driveFix']['output']> {
    return this.call('driveFix', input ?? {} as Operations['driveFix']['input']);
  }

  /** Change your own comment (on a talk page, a suggestion or an issue) (PATCH /v1/comments/{id}) */
  editComment(input: Operations['editComment']['input']): Promise<Operations['editComment']['output']> {
    return this.call('editComment', input ?? {} as Operations['editComment']['input']);
  }

  /** An edition's checksums, for sha256sum -c (GET /v1/editions/{tag}/SHA256SUMS) */
  editionChecksums(input: Operations['editionChecksums']['input']): Promise<Operations['editionChecksums']['output']> {
    return this.call('editionChecksums', input ?? {} as Operations['editionChecksums']['input']);
  }

  /** An edition's signed manifest (Ed25519), exactly as signed (GET /v1/editions/{tag}/manifest.json) */
  editionManifest(input: Operations['editionManifest']['input']): Promise<Operations['editionManifest']['output']> {
    return this.call('editionManifest', input ?? {} as Operations['editionManifest']['input']);
  }

  /** Catalog editions (dated snapshots) and their dumps, each with its size, sha256 and address (GET /v1/editions) */
  editions(): Promise<Operations['editions']['output']> {
    return this.call('editions', {} as Operations['editions']['input']);
  }

  /** Change its title or words (its author, keepers, stewards) (PATCH /v1/issues/{number}) */
  editIssue(input: Operations['editIssue']['input']): Promise<Operations['editIssue']['output']> {
    return this.call('editIssue', input ?? {} as Operations['editIssue']['input']);
  }

  /** Change the title or description of your suggestion (@mentions and "Fixes #12" are read again) (PATCH /v1/suggestions/{id}) */
  editSuggestion(input: Operations['editSuggestion']['input']): Promise<Operations['editSuggestion']['output']> {
    return this.call('editSuggestion', input ?? {} as Operations['editSuggestion']['input']);
  }

  /** A family's request that a teshura not be shown (no account needed): its scans stop being served at once, and stewards review it (POST /v1/teshuros/{id}/family-request) */
  familyRequest(input: Operations['familyRequest']['input']): Promise<Operations['familyRequest']['output']> {
    return this.call('familyRequest', input ?? {} as Operations['familyRequest']['input']);
  }

  /** A file's own page: its rights, where it came from, what was made from it, and what uses it (GET /v1/files/{sha256}/about) */
  fileAbout(input: Operations['fileAbout']['input']): Promise<Operations['fileAbout']['output']> {
    return this.call('fileAbout', input ?? {} as Operations['fileAbout']['input']);
  }

  /** Fix one line of a scan's text (a suggestion) (POST /v1/scans/{id}/text/fix) */
  fixScanLine(input: Operations['fixScanLine']['input']): Promise<Operations['fixScanLine']['output']> {
    return this.call('fixScanLine', input ?? {} as Operations['fixScanLine']['input']);
  }

  /** Fix the words of one paragraph of a transcript (a suggestion) (POST /v1/recordings/{id}/transcript/fix) */
  fixTranscript(input: Operations['fixTranscript']['input']): Promise<Operations['fixTranscript']['output']> {
    return this.call('fixTranscript', input ?? {} as Operations['fixTranscript']['input']);
  }

  /** Suggest a fix to one paragraph of a translation (POST /v1/translations/fix) */
  fixTranslation(input: Operations['fixTranslation']['input']): Promise<Operations['fixTranslation']['output']> {
    return this.call('fixTranslation', input ?? {} as Operations['fixTranslation']['input']);
  }

  /** Follow or unfollow an item, set, project, suggestion or issue (POST /v1/follows) */
  follow(input: Operations['follow']['input']): Promise<Operations['follow']['output']> {
    return this.call('follow', input ?? {} as Operations['follow']['input']);
  }

  /** Forget one place (DELETE /v1/places) */
  forgetPlace(input: Operations['forgetPlace']['input']): Promise<Operations['forgetPlace']['output']> {
    return this.call('forgetPlace', input ?? {} as Operations['forgetPlace']['input']);
  }

  /** One of an edition's dumps (SQLite, JSON Lines, Parquet) (GET /dumps/{tag}/{name}) */
  getDump(input: Operations['getDump']['input']): Promise<Operations['getDump']['output']> {
    return this.call('getDump', input ?? {} as Operations['getDump']['input']);
  }

  /** A file's size, rights and address, what was made from it, and its page fix (GET /v1/files/{sha256}) */
  getFile(input: Operations['getFile']['input']): Promise<Operations['getFile']['output']> {
    return this.call('getFile', input ?? {} as Operations['getFile']['input']);
  }

  /** Several files at once, in the order asked (missing ones left out) (GET /v1/files/batch) */
  getFiles(input: Operations['getFiles']['input']): Promise<Operations['getFiles']['output']> {
    return this.call('getFiles', input ?? {} as Operations['getFiles']['input']);
  }

  /** An issue, its timeline, what the reader may do, and the suggestions that close it (GET /v1/issues/{number}) */
  getIssue(input: Operations['getIssue']['input']): Promise<Operations['getIssue']['output']> {
    return this.call('getIssue', input ?? {} as Operations['getIssue']['input']);
  }

  /** One item, on main or as of a commit (GET /v1/entities/{id}) */
  getItem(input: Operations['getItem']['input']): Promise<Operations['getItem']['output']> {
    return this.call('getItem', input ?? {} as Operations['getItem']['input']);
  }

  /** Several items at once, in the order asked (missing ones left out) (GET /v1/entities/batch) */
  getItems(input: Operations['getItems']['input']): Promise<Operations['getItems']['output']> {
    return this.call('getItems', input ?? {} as Operations['getItems']['input']);
  }

  /** A published manifest: reading copies, page fixes (facts about files, open like the catalog) (GET /manifests/{collection}/{name}) */
  getManifest(input: Operations['getManifest']['input']): Promise<Operations['getManifest']['output']> {
    return this.call('getManifest', input ?? {} as Operations['getManifest']['input']);
  }

  /** A file's bytes, while its rights let it be served (GET /objects/{sha256}) */
  getObject(input: Operations['getObject']['input']): Promise<Operations['getObject']['output']> {
    return this.call('getObject', input ?? {} as Operations['getObject']['input']);
  }

  /** A person's public page: who they are, their counts and recent activity (an old handle finds them too, with `movedFrom`) (GET /v1/people/{username}) */
  getProfile(input: Operations['getProfile']['input']): Promise<Operations['getProfile']['output']> {
    return this.call('getProfile', input ?? {} as Operations['getProfile']['input']);
  }

  /** A project, its progress and what is left to do (GET /v1/projects/{slug}) */
  getProject(input: Operations['getProject']['input']): Promise<Operations['getProject']['output']> {
    return this.call('getProject', input ?? {} as Operations['getProject']['input']);
  }

  /** One stored version of an item (GET /v1/revisions/{rev}) */
  getRevision(input: Operations['getRevision']['input']): Promise<Operations['getRevision']['output']> {
    return this.call('getRevision', input ?? {} as Operations['getRevision']['input']);
  }

  /** A text of a sefer as its source gave it (one chapter or letter, an HTML article) (GET /v1/texts/{sha256}) */
  getSourceText(input: Operations['getSourceText']['input']): Promise<Operations['getSourceText']['output']> {
    return this.call('getSourceText', input ?? {} as Operations['getSourceText']['input']);
  }

  /** The review view: each item before and after, clashes with main, and the reviewer's advice (machine-written, `machine: true`). A page of items at a time (`entries`, from `offset`), with `total`, `next` (the offset of the next page, or null) and, with summary=1, `summary`: the items grouped by how they change ("500 units: links on the media proxy became links on Drive"), with a few examples of each (GET /v1/suggestions/{id}) */
  getSuggestion(input: Operations['getSuggestion']['input']): Promise<Operations['getSuggestion']['output']> {
    return this.call('getSuggestion', input ?? {} as Operations['getSuggestion']['input']);
  }

  /** The health of the catalog: coverage per year and set, unchecked pages, unsynced recordings, dead links, the oldest open suggestions (GET /v1/health) */
  health(input?: Operations['health']['input']): Promise<Operations['health']['output']> {
    return this.call('health', input ?? {} as Operations['health']['input']);
  }

  /** Hide a comment (its author, or a steward) (POST /v1/comments/{id}/hide) */
  hideComment(input: Operations['hideComment']['input']): Promise<Operations['hideComment']['output']> {
    return this.call('hideComment', input ?? {} as Operations['hideComment']['input']);
  }

  /** A served scan as a IIIF Presentation 3 manifest, for any IIIF viewer (GET /manifests/iiif/{file}) */
  iiifManifest(input: Operations['iiifManifest']['input']): Promise<Operations['iiifManifest']['output']> {
    return this.call('iiifManifest', input ?? {} as Operations['iiifManifest']['input']);
  }

  /** Your inbox, newest first: mentions, review requests, assignments and what you follow (GET /v1/inbox) */
  inbox(input?: Operations['inbox']['input']): Promise<Operations['inbox']['output']> {
    return this.call('inbox', input ?? {} as Operations['inbox']['input']);
  }

  /** How many inbox lines are unread (GET /v1/inbox/count) */
  inboxCount(): Promise<Operations['inboxCount']['output']> {
    return this.call('inboxCount', {} as Operations['inboxCount']['input']);
  }

  /** The kinds of issue and the words each starts with (GET /v1/issues/templates) */
  issueTemplates(): Promise<Operations['issueTemplates']['output']> {
    return this.call('issueTemplates', {} as Operations['issueTemplates']['input']);
  }

  /** Items that point at this one (GET /v1/entities/{id}/backlinks) */
  itemBacklinks(input: Operations['itemBacklinks']['input']): Promise<Operations['itemBacklinks']['output']> {
    return this.call('itemBacklinks', input ?? {} as Operations['itemBacklinks']['input']);
  }

  /** Every merged change to an item, newest first: who, when, and what changed field by field (GET /v1/entities/{id}/history) */
  itemHistory(input: Operations['itemHistory']['input']): Promise<Operations['itemHistory']['output']> {
    return this.call('itemHistory', input ?? {} as Operations['itemHistory']['input']);
  }

  /** An item's links both ways: cites, printed in, based on, cited by (GET /v1/entities/{id}/relations) */
  itemRelations(input: Operations['itemRelations']['input']): Promise<Operations['itemRelations']['output']> {
    return this.call('itemRelations', input ?? {} as Operations['itemRelations']['input']);
  }

  /** An item's talk page: the conversation about it (GET /v1/entities/{id}/talk) */
  itemTalk(input: Operations['itemTalk']['input']): Promise<Operations['itemTalk']['output']> {
    return this.call('itemTalk', input ?? {} as Operations['itemTalk']['input']);
  }

  /** What points at an item, by type and field, with how many of each (GET /v1/entities/{id}/linked/counts) */
  linkedCounts(input: Operations['linkedCounts']['input']): Promise<Operations['linkedCounts']['output']> {
    return this.call('linkedCounts', input ?? {} as Operations['linkedCounts']['input']);
  }

  /** One group of what points at each of several items, a few of each in the group's order: what a list needs of every row in one request (a sefer's sichos' texts, a farbrengen's sichos' words) (GET /v1/entities/batch/linked) */
  linkedOfEach(input: Operations['linkedOfEach']['input']): Promise<Operations['linkedOfEach']['output']> {
    return this.call('linkedOfEach', input ?? {} as Operations['linkedOfEach']['input']);
  }

  /** An item's children in their own order (a work's units, a text's paragraphs), a page at a time (GET /v1/entities/{id}/children) */
  listChildren(input: Operations['listChildren']['input']): Promise<Operations['listChildren']['output']> {
    return this.call('listChildren', input ?? {} as Operations['listChildren']['input']);
  }

  /** Every merge to main after a given one, in order, with what each changed: the way to follow the catalog without webhooks (GET /v1/commits) */
  listCommits(input?: Operations['listCommits']['input']): Promise<Operations['listCommits']['output']> {
    return this.call('listCommits', input ?? {} as Operations['listCommits']['input']);
  }

  /** Farbrengens and other events by Hebrew date, each with how many recordings it has (GET /v1/events) */
  listEvents(input?: Operations['listEvents']['input']): Promise<Operations['listEvents']['output']> {
    return this.call('listEvents', input ?? {} as Operations['listEvents']['input']);
  }

  /** What you follow, the items themselves, and what changed in them lately (GET /v1/follows) */
  listFollows(input?: Operations['listFollows']['input']): Promise<Operations['listFollows']['output']> {
    return this.call('listFollows', input ?? {} as Operations['listFollows']['input']);
  }

  /** Issues, newest first, with open and closed counts; private ones only for those who may read them (GET /v1/issues) */
  listIssues(input?: Operations['listIssues']['input']): Promise<Operations['listIssues']['output']> {
    return this.call('listIssues', input ?? {} as Operations['listIssues']['input']);
  }

  /** Items on main, by type and set, in path order, a page at a time (GET /v1/entities) */
  listItems(input?: Operations['listItems']['input']): Promise<Operations['listItems']['output']> {
    return this.call('listItems', input ?? {} as Operations['listItems']['input']);
  }

  /** Every label and how many open issues carry it (GET /v1/labels) */
  listLabels(): Promise<Operations['listLabels']['output']> {
    return this.call('listLabels', {} as Operations['listLabels']['input']);
  }

  /** One group of what points at an item, in its own order, a page at a time, with the total (GET /v1/entities/{id}/linked) */
  listLinked(input: Operations['listLinked']['input']): Promise<Operations['listLinked']['output']> {
    return this.call('listLinked', input ?? {} as Operations['listLinked']['input']);
  }

  /** Where you stopped reading and listening lately (never cached) (GET /v1/places) */
  listPlaces(input?: Operations['listPlaces']['input']): Promise<Operations['listPlaces']['output']> {
    return this.call('listPlaces', input ?? {} as Operations['listPlaces']['input']);
  }

  /** Projects working through a gap, with their progress (GET /v1/projects) */
  listProjects(input?: Operations['listProjects']['input']): Promise<Operations['listProjects']['output']> {
    return this.call('listProjects', input ?? {} as Operations['listProjects']['input']);
  }

  /** A set's inbox of reports (stewards, and the set's keepers) (GET /v1/reports) */
  listReports(input?: Operations['listReports']['input']): Promise<Operations['listReports']['output']> {
    return this.call('listReports', input ?? {} as Operations['listReports']['input']);
  }

  /** Suggestions, oldest sent first, by status or author; with `state`, the list of conversations, newest first (numbers, reviewers, approvals, the issues each closes) with counts (GET /v1/suggestions) */
  listSuggestions(input?: Operations['listSuggestions']['input']): Promise<Operations['listSuggestions']['output']> {
    return this.call('listSuggestions', input ?? {} as Operations['listSuggestions']['input']);
  }

  /** Your webhooks: addresses every merge is posted to (GET /v1/webhooks) */
  listWebhooks(): Promise<Operations['listWebhooks']['output']> {
    return this.call('listWebhooks', {} as Operations['listWebhooks']['input']);
  }

  /** A short guide for AI agents (llms.txt) (GET /llms.txt) */
  llmsTxt(): Promise<Operations['llmsTxt']['output']> {
    return this.call('llmsTxt', {} as Operations['llmsTxt']['input']);
  }

  /** Requests for the machines, the waiting ones in the order they are taken (GET /v1/machine/requests) */
  machineRequests(input?: Operations['machineRequests']['input']): Promise<Operations['machineRequests']['output']> {
    return this.call('machineRequests', input ?? {} as Operations['machineRequests']['input']);
  }

  /** What waits for the machines (OCR, transcription), what is left for them, and what they did this week (GET /v1/machine) */
  machineSummary(): Promise<Operations['machineSummary']['output']> {
    return this.call('machineSummary', {} as Operations['machineSummary']['input']);
  }

  /** What the machines wrote that no person has checked yet: farbrengens with unchecked transcript paragraphs, scans with pages read by OCR and not yet proofread, the newest first (GET /v1/machine/to-check) */
  machineToCheck(input?: Operations['machineToCheck']['input']): Promise<Operations['machineToCheck']['output']> {
    return this.call('machineToCheck', input ?? {} as Operations['machineToCheck']['input']);
  }

  /** Map pages of a publication to the unit they hold (an existing unit, a new one, or words) (POST /v1/suggestions/contents-map) */
  mapContents(input: Operations['mapContents']['input']): Promise<Operations['mapContents']['output']> {
    return this.call('mapContents', input ?? {} as Operations['mapContents']['input']);
  }

  /** Mark inbox lines read (or unread): by id, by conversation, or all (POST /v1/inbox/read) */
  markInboxRead(input?: Operations['markInboxRead']['input']): Promise<Operations['markInboxRead']['output']> {
    return this.call('markInboxRead', input ?? {} as Operations['markInboxRead']['input']);
  }

  /** The Model Context Protocol server (Streamable HTTP, JSON answers, no sessions) (POST /mcp) */
  mcp(input?: Operations['mcp']['input']): Promise<Operations['mcp']['output']> {
    return this.call('mcp', input ?? {} as Operations['mcp']['input']);
  }

  /** The MCP server's Protected Resource Metadata (RFC 9728), named in its 401's WWW-Authenticate (GET /.well-known/oauth-protected-resource/mcp) */
  mcpProtectedResource(): Promise<Operations['mcpProtectedResource']['output']> {
    return this.call('mcpProtectedResource', {} as Operations['mcpProtectedResource']['input']);
  }

  /** Everything a mirror needs: the git mirror, the release keys, every edition and its dumps (GET /v1/mirrors) */
  mirrors(): Promise<Operations['mirrors']['output']> {
    return this.call('mirrors', {} as Operations['mirrors']['input']);
  }

  /** The Missing board: farbrengens without a recording or a text, sefarim without a scan, files lost upstream (GET /v1/missing) */
  missing(input: Operations['missing']['input']): Promise<Operations['missing']['output']> {
    return this.call('missing', input ?? {} as Operations['missing']['input']);
  }

  /** OAI-PMH 2.0 for libraries (oai_dc records), when switched on (GET /oai) */
  oai(input: Operations['oai']['input']): Promise<Operations['oai']['output']> {
    return this.call('oai', input ?? {} as Operations['oai']['input']);
  }

  /** OAI-PMH, the same arguments sent as a form (POST /oai) */
  oaiPost(input: Operations['oaiPost']['input']): Promise<Operations['oaiPost']['output']> {
    return this.call('oaiPost', input ?? {} as Operations['oaiPost']['input']);
  }

  /** Start connecting (authorization code with PKCE): the person is sent to the site's consent page, then back to the app (GET /oauth/authorize) */
  oauthAuthorize(input: Operations['oauthAuthorize']['input']): Promise<Operations['oauthAuthorize']['output']> {
    return this.call('oauthAuthorize', input ?? {} as Operations['oauthAuthorize']['input']);
  }

  /** Register an app (RFC 7591): its name and redirect addresses; a secret only if it asks for one (POST /oauth/register) */
  oauthRegister(input: Operations['oauthRegister']['input']): Promise<Operations['oauthRegister']['output']> {
    return this.call('oauthRegister', input ?? {} as Operations['oauthRegister']['input']);
  }

  /** Revoke an access or refresh token (RFC 7009): the whole connection ends (POST /oauth/revoke) */
  oauthRevoke(input: Operations['oauthRevoke']['input']): Promise<Operations['oauthRevoke']['output']> {
    return this.call('oauthRevoke', input ?? {} as Operations['oauthRevoke']['input']);
  }

  /** Trade a code (with its PKCE verifier) or a refresh token for an access token (an hour) and a new refresh token (POST /oauth/token) */
  oauthToken(input: Operations['oauthToken']['input']): Promise<Operations['oauthToken']['output']> {
    return this.call('oauthToken', input ?? {} as Operations['oauthToken']['input']);
  }

  /** This document (GET /openapi.json) */
  openapi(): Promise<Operations['openapi']['output']> {
    return this.call('openapi', {} as Operations['openapi']['input']);
  }

  /** Open an issue (about an item, or the catalog at large) (POST /v1/issues) */
  openIssue(input: Operations['openIssue']['input']): Promise<Operations['openIssue']['output']> {
    return this.call('openIssue', input ?? {} as Operations['openIssue']['input']);
  }

  /** Organize the catalog: a plan becomes one suggestion, sent for review (apply: true approves it at once where you may approve it yourself) (POST /v1/organize) */
  organize(input?: Operations['organize']['input']): Promise<Operations['organize']['output']> {
    return this.call('organize', input ?? {} as Operations['organize']['input']);
  }

  /** Read a Hebrew date as people write it (GET /v1/dates/parse) */
  parseDate(input: Operations['parseDate']['input']): Promise<Operations['parseDate']['output']> {
    return this.call('parseDate', input ?? {} as Operations['parseDate']['input']);
  }

  /** What a plan of moves, renames, orderings, new sets and merges would change, item by item, saved nowhere (POST /v1/organize/preview) */
  previewOrganize(input?: Operations['previewOrganize']['input']): Promise<Operations['previewOrganize']['output']> {
    return this.call('previewOrganize', input ?? {} as Operations['previewOrganize']['input']);
  }

  /** Before adding something new: the machine's guess of what it is and where it belongs, from its name (a date in it, words of a title), and files already held that look like it (POST /v1/uploads/propose) */
  proposeUpload(input: Operations['proposeUpload']['input']): Promise<Operations['proposeUpload']['output']> {
    return this.call('proposeUpload', input ?? {} as Operations['proposeUpload']['input']);
  }

  /** The API's Protected Resource Metadata (RFC 9728): which authorization server gives its tokens (GET /.well-known/oauth-protected-resource) */
  protectedResource(): Promise<Operations['protectedResource']['output']> {
    return this.call('protectedResource', {} as Operations['protectedResource']['input']);
  }

  /** Add or change one item in a draft suggestion (data null deletes it) (PUT /v1/suggestions/{id}/items) */
  putSuggestionItem(input: Operations['putSuggestionItem']['input']): Promise<Operations['putSuggestionItem']['output']> {
    return this.call('putSuggestionItem', input ?? {} as Operations['putSuggestionItem']['input']);
  }

  /** The hanacha synced to this recording, paragraph by paragraph (GET /v1/recordings/{id}/hanacha) */
  recordingHanacha(input: Operations['recordingHanacha']['input']): Promise<Operations['recordingHanacha']['output']> {
    return this.call('recordingHanacha', input ?? {} as Operations['recordingHanacha']['input']);
  }

  /** Several recordings' synced hanachos at once (a farbrengen's parts), by recording; those with none are left out (GET /v1/recordings/batch/hanacha) */
  recordingsHanacha(input: Operations['recordingsHanacha']['input']): Promise<Operations['recordingsHanacha']['output']> {
    return this.call('recordingsHanacha', input ?? {} as Operations['recordingsHanacha']['input']);
  }

  /** A recording's transcript, with its sync by paragraph and word (GET /v1/recordings/{id}/transcript) */
  recordingTranscript(input: Operations['recordingTranscript']['input']): Promise<Operations['recordingTranscript']['output']> {
    return this.call('recordingTranscript', input ?? {} as Operations['recordingTranscript']['input']);
  }

  /** How many items point at each item through a field (field=work&type=unit: each work's units) (GET /v1/refcounts) */
  refCounts(input: Operations['refCounts']['input']): Promise<Operations['refCounts']['output']> {
    return this.call('refCounts', input ?? {} as Operations['refCounts']['input']);
  }

  /** Let go of an item you held (POST /v1/projects/{slug}/release) */
  releaseClaim(input: Operations['releaseClaim']['input']): Promise<Operations['releaseClaim']['output']> {
    return this.call('releaseClaim', input ?? {} as Operations['releaseClaim']['input']);
  }

  /** Stop asking someone to review (DELETE /v1/suggestions/{id}/review-requests/{username}) */
  removeReviewRequest(input: Operations['removeReviewRequest']['input']): Promise<Operations['removeReviewRequest']['output']> {
    return this.call('removeReviewRequest', input ?? {} as Operations['removeReviewRequest']['input']);
  }

  /** Undo a withdrawal: your suggestion is open for review again (its checks run again) (POST /v1/suggestions/{id}/reopen) */
  reopenSuggestion(input: Operations['reopenSuggestion']['input']): Promise<Operations['reopenSuggestion']['output']> {
    return this.call('reopenSuggestion', input ?? {} as Operations['reopenSuggestion']['input']);
  }

  /** Report a problem (no account needed: a captcha and an hourly limit instead) (POST /v1/reports) */
  report(input: Operations['report']['input']): Promise<Operations['report']['output']> {
    return this.call('report', input ?? {} as Operations['report']['input']);
  }

  /** Ask the machine to read a scan (ocr) or transcribe a recording (transcript) (POST /v1/machine/requests) */
  requestMachineWork(input: Operations['requestMachineWork']['input']): Promise<Operations['requestMachineWork']['output']> {
    return this.call('requestMachineWork', input ?? {} as Operations['requestMachineWork']['input']);
  }

  /** Ask people to review (asking again asks again) (POST /v1/suggestions/{id}/review-requests) */
  requestReview(input: Operations['requestReview']['input']): Promise<Operations['requestReview']['output']> {
    return this.call('requestReview', input ?? {} as Operations['requestReview']['input']);
  }

  /** Ask for a file to stop being served (no account needed); stewards answer within two weeks (POST /v1/takedowns) */
  requestTakedown(input: Operations['requestTakedown']['input']): Promise<Operations['requestTakedown']['output']> {
    return this.call('requestTakedown', input ?? {} as Operations['requestTakedown']['input']);
  }

  /** Resolve (or unresolve) a comment on a suggestion's field (POST /v1/comments/{id}/resolve) */
  resolveComment(input: Operations['resolveComment']['input']): Promise<Operations['resolveComment']['output']> {
    return this.call('resolveComment', input ?? {} as Operations['resolveComment']['input']);
  }

  /** The item at a readable path (an old path answers with where it moved) (GET /v1/resolve) */
  resolvePath(input: Operations['resolvePath']['input']): Promise<Operations['resolvePath']['output']> {
    return this.call('resolvePath', input ?? {} as Operations['resolvePath']['input']);
  }

  /** Suggest restoring an earlier version of an item (POST /v1/entities/{id}/restore) */
  restoreItem(input: Operations['restoreItem']['input']): Promise<Operations['restoreItem']['output']> {
    return this.call('restoreItem', input ?? {} as Operations['restoreItem']['input']);
  }

  /** Undo a merged suggestion (a new suggestion that reverses it) (POST /v1/suggestions/{id}/revert) */
  revertSuggestion(input: Operations['revertSuggestion']['input']): Promise<Operations['revertSuggestion']['output']> {
    return this.call('revertSuggestion', input ?? {} as Operations['revertSuggestion']['input']);
  }

  /** Review a live change after it went live: keep it (approve) or undo it (revert) (POST /v1/suggestions/{id}/review-live) */
  reviewLive(input: Operations['reviewLive']['input']): Promise<Operations['reviewLive']['output']> {
    return this.call('reviewLive', input ?? {} as Operations['reviewLive']['input']);
  }

  /** Review: approve (it goes into the catalog, where you may merge it), request changes (sent back), or comment; with comments on fields (POST /v1/suggestions/{id}/reviews) */
  reviewSuggestion(input: Operations['reviewSuggestion']['input']): Promise<Operations['reviewSuggestion']['output']> {
    return this.call('reviewSuggestion', input ?? {} as Operations['reviewSuggestion']['input']);
  }

  /** What crawlers may read on the API: the guides and the files, not the routes (GET /robots.txt) */
  robotsTxt(): Promise<Operations['robotsTxt']['output']> {
    return this.call('robotsTxt', {} as Operations['robotsTxt']['input']);
  }

  /** Redirects to /v1 (GET /) */
  root(): Promise<Operations['root']['output']> {
    return this.call('root', {} as Operations['root']['input']);
  }

  /** Keep where you stopped in one thing (PUT /v1/places) */
  savePlace(input: Operations['savePlace']['input']): Promise<Operations['savePlace']['output']> {
    return this.call('savePlace', input ?? {} as Operations['savePlace']['input']);
  }

  /** A served scan's page images and thumbnails, and its IIIF manifest (GET /v1/scans/{id}/pages) */
  scanPages(input: Operations['scanPages']['input']): Promise<Operations['scanPages']['output']> {
    return this.call('scanPages', input ?? {} as Operations['scanPages']['input']);
  }

  /** How far each page of a scan is proofread (0, 1 or 2) (GET /v1/scans/{id}/progress) */
  scanProgress(input: Operations['scanProgress']['input']): Promise<Operations['scanProgress']['output']> {
    return this.call('scanProgress', input ?? {} as Operations['scanProgress']['input']);
  }

  /** A page of a scan's text: the community page, else the seed layer's; each line with its proofread level (GET /v1/scans/{id}/text) */
  scanText(input: Operations['scanText']['input']): Promise<Operations['scanText']['output']> {
    return this.call('scanText', input ?? {} as Operations['scanText']['input']);
  }

  /** Search names, text and dates, in Hebrew or English (GET /v1/search) */
  search(input: Operations['search']['input']): Promise<Operations['search']['output']> {
    return this.call('search', input ?? {} as Operations['search']['input']);
  }

  /** Where the words are: lines on scans' pages (open at the line) and paragraphs of texts and transcripts (open at the moment heard) (GET /v1/search/moments) */
  searchMoments(input: Operations['searchMoments']['input']): Promise<Operations['searchMoments']['output']> {
    return this.call('searchMoments', input ?? {} as Operations['searchMoments']['input']);
  }

  /** People to @mention: handles that start with, or names that contain, what is typed; those in the conversation first (GET /v1/people) */
  searchPeople(input?: Operations['searchPeople']['input']): Promise<Operations['searchPeople']['output']> {
    return this.call('searchPeople', input ?? {} as Operations['searchPeople']['input']);
  }

  /** Search by meaning (embeddings); every result is the machine's guess (GET /v1/search/similar) */
  searchSimilar(input: Operations['searchSimilar']['input']): Promise<Operations['searchSimilar']['output']> {
    return this.call('searchSimilar', input ?? {} as Operations['searchSimilar']['input']);
  }

  /** Suggestions and issues to #mention, by number or words (GET /v1/threads) */
  searchThreads(input?: Operations['searchThreads']['input']): Promise<Operations['searchThreads']['output']> {
    return this.call('searchThreads', input ?? {} as Operations['searchThreads']['input']);
  }

  /** Keepers: seed the community text from this OCR layer (checked lines are kept) (POST /v1/scans/{id}/text/seed) */
  seedScanText(input: Operations['seedScanText']['input']): Promise<Operations['seedScanText']['output']> {
    return this.call('seedScanText', input ?? {} as Operations['seedScanText']['input']);
  }

  /** Send back with a note (POST /v1/suggestions/{id}/send-back) */
  sendBackSuggestion(input: Operations['sendBackSuggestion']['input']): Promise<Operations['sendBackSuggestion']['output']> {
    return this.call('sendBackSuggestion', input ?? {} as Operations['sendBackSuggestion']['input']);
  }

  /** Set who it is assigned to (yourself; others when you may triage) (PUT /v1/issues/{number}/assignees) */
  setIssueAssignees(input: Operations['setIssueAssignees']['input']): Promise<Operations['setIssueAssignees']['output']> {
    return this.call('setIssueAssignees', input ?? {} as Operations['setIssueAssignees']['input']);
  }

  /** Set its labels (keepers, stewards, trusted people) (PUT /v1/issues/{number}/labels) */
  setIssueLabels(input: Operations['setIssueLabels']['input']): Promise<Operations['setIssueLabels']['output']> {
    return this.call('setIssueLabels', input ?? {} as Operations['setIssueLabels']['input']);
  }

  /** Close as completed or not planned, or reopen (POST /v1/issues/{number}/state) */
  setIssueState(input: Operations['setIssueState']['input']): Promise<Operations['setIssueState']['output']> {
    return this.call('setIssueState', input ?? {} as Operations['setIssueState']['input']);
  }

  /** Make it private or public (stewards and keepers) (POST /v1/issues/{number}/visibility) */
  setIssueVisibility(input: Operations['setIssueVisibility']['input']): Promise<Operations['setIssueVisibility']['output']> {
    return this.call('setIssueVisibility', input ?? {} as Operations['setIssueVisibility']['input']);
  }

  /** Held files that look like this one (the same scan or recording in other bytes): a machine's guess (GET /v1/files/{sha256}/similar) */
  similarFiles(input: Operations['similarFiles']['input']): Promise<Operations['similarFiles']['output']> {
    return this.call('similarFiles', input ?? {} as Operations['similarFiles']['input']);
  }

  /** One sitemap's items: their ids, paths and when each last changed (GET /v1/sitemap/{type}/{page}) */
  sitemapPage(input: Operations['sitemapPage']['input']): Promise<Operations['sitemapPage']['output']> {
    return this.call('sitemapPage', input ?? {} as Operations['sitemapPage']['input']);
  }

  /** Every sitemap there is: each kind of item with a page of its own, in pages of pageSize items (id order), with when each page last changed (GET /v1/sitemap) */
  sitemaps(): Promise<Operations['sitemaps']['output']> {
    return this.call('sitemaps', {} as Operations['sitemaps']['input']);
  }

  /** How many items of each type, and the latest commit (GET /v1/stats) */
  stats(): Promise<Operations['stats']['output']> {
    return this.call('stats', {} as Operations['stats']['input']);
  }

  /** Whether RebbeHub is up: the last checks of the site, the API, the MCP server, the database, its daily query allowance, the Workers' load and the scheduled jobs, with 90 days of them and the latest incidents (GET /v1/status) */
  status(): Promise<Operations['status']['output']> {
    return this.call('status', {} as Operations['status']['input']);
  }

  /** Send for review (runs the automatic checks) (POST /v1/suggestions/{id}/submit) */
  submitSuggestion(input: Operations['submitSuggestion']['input']): Promise<Operations['submitSuggestion']['output']> {
    return this.call('submitSuggestion', input ?? {} as Operations['submitSuggestion']['input']);
  }

  /** Suggest a fix in one step: a new version of one item, with a few words on why, sent for review (POST /v1/suggestions/quick) */
  suggestFix(input: Operations['suggestFix']['input']): Promise<Operations['suggestFix']['output']> {
    return this.call('suggestFix', input ?? {} as Operations['suggestFix']['input']);
  }

  /** A suggestion's timeline (comments, reviews, events), the reviewers asked, and the issues it closes (GET /v1/suggestions/{id}/conversation) */
  suggestionConversation(input: Operations['suggestionConversation']['input']): Promise<Operations['suggestionConversation']['output']> {
    return this.call('suggestionConversation', input ?? {} as Operations['suggestionConversation']['input']);
  }

  /** A page's words fixed segment by segment: one segment's new words, a segment added after it or taken out, a page's first words, or a machine's segment checked as right (`check`), sent for review (POST /v1/suggestions/words) */
  suggestWords(input: Operations['suggestWords']['input']): Promise<Operations['suggestWords']['output']> {
    return this.call('suggestWords', input ?? {} as Operations['suggestWords']['input']);
  }

  /** How many paragraphs each of several texts has, and how many of them a person checked (GET /v1/texts/batch/progress) */
  textsProgress(input: Operations['textsProgress']['input']): Promise<Operations['textsProgress']['output']> {
    return this.call('textsProgress', input ?? {} as Operations['textsProgress']['input']);
  }

  /** Which of the two #12 is: a suggestion or an issue, and its id (GET /v1/threads/{number}) */
  threadByNumber(input: Operations['threadByNumber']['input']): Promise<Operations['threadByNumber']['output']> {
    return this.call('threadByNumber', input ?? {} as Operations['threadByNumber']['input']);
  }

  /** The training clips, one JSON object a line, as the training script reads them (audio, start, end, text, split) (GET /v1/machine/training/clips) */
  trainingClips(): Promise<Operations['trainingClips']['output']> {
    return this.call('trainingClips', {} as Operations['trainingClips']['input']);
  }

  /** The next Rebbe Whisper's training data so far: every transcript paragraph a person checked, as clips (GET /v1/machine/training) */
  trainingSummary(input?: Operations['trainingSummary']['input']): Promise<Operations['trainingSummary']['output']> {
    return this.call('trainingSummary', input ?? {} as Operations['trainingSummary']['input']);
  }

  /** Everything that happened to a recording's transcript, newest first (GET /v1/recordings/{id}/transcript/history) */
  transcriptHistory(input: Operations['transcriptHistory']['input']): Promise<Operations['transcriptHistory']['output']> {
    return this.call('transcriptHistory', input ?? {} as Operations['transcriptHistory']['input']);
  }

  /** Every kind of item and its JSON Schema (GET /v1/types) */
  types(): Promise<Operations['types']['output']> {
    return this.call('types', {} as Operations['types']['input']);
  }

  /** The printings of a unit whose text the catalog has, to compare (GET /v1/units/{id}/printings) */
  unitPrintings(input: Operations['unitPrintings']['input']): Promise<Operations['unitPrintings']['output']> {
    return this.call('unitPrintings', input ?? {} as Operations['unitPrintings']['input']);
  }

  /** Stop email updates, from the link in any of them (no sign-in) (POST /v1/auth/email/unsubscribe) */
  unsubscribe(input?: Operations['unsubscribe']['input']): Promise<Operations['unsubscribe']['output']> {
    return this.call('unsubscribe', input ?? {} as Operations['unsubscribe']['input']);
  }

  /** Add a file: a recording of a farbrengen; a hanacha's PDF for a farbrengen or sicha; a scan (another scan of a printing, a new printing of a sefer, a teshura); or other material (a new sefer, a letter, a document) (POST /v1/uploads) */
  upload(input: Operations['upload']['input']): Promise<Operations['upload']['output']> {
    return this.call('upload', input ?? {} as Operations['upload']['input']);
  }

  /** Upload your own OCR of a scan (hOCR, ALTO, or plain text with form feeds between pages) as a new layer (POST /v1/scans/{id}/ocr) */
  uploadOcr(input: Operations['uploadOcr']['input']): Promise<Operations['uploadOcr']['output']> {
    return this.call('uploadOcr', input ?? {} as Operations['uploadOcr']['input']);
  }

  /** Withdraw your suggestion (POST /v1/suggestions/{id}/withdraw) */
  withdrawSuggestion(input: Operations['withdrawSuggestion']['input']): Promise<Operations['withdrawSuggestion']['output']> {
    return this.call('withdrawSuggestion', input ?? {} as Operations['withdrawSuggestion']['input']);
  }

  /** A sefer's cover, the page a person chose, and the PDFs (served, or linked) its title page may be chosen from (GET /v1/works/{id}/cover) */
  workCover(input: Operations['workCover']['input']): Promise<Operations['workCover']['output']> {
    return this.call('workCover', input ?? {} as Operations['workCover']['input']);
  }

  /** A work's volumes (its top-level parts), with how many units each holds (GET /v1/works/{id}/outline) */
  workOutline(input: Operations['workOutline']['input']): Promise<Operations['workOutline']['output']> {
    return this.call('workOutline', input ?? {} as Operations['workOutline']['input']);
  }

  /** The units of one volume of a work (GET /v1/works/{id}/parts/{part}) */
  workPart(input: Operations['workPart']['input']): Promise<Operations['workPart']['output']> {
    return this.call('workPart', input ?? {} as Operations['workPart']['input']);
  }
}
