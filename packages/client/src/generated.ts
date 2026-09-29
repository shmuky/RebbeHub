// Generated from the RebbeHub OpenAPI document by packages/client/scripts/generate.ts.
// Do not edit by hand: run `npm run generate -w @rebbehub/client`.
/* eslint-disable */

/** The API version this client was generated from. */
export const API_VERSION = "1.0.0";

export type ApiError = {
  /** What kind of error, for programs */
  error: "bad-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "invalid" | "rate-limited" | "internal" | "state";
  /** What went wrong, for people */
  message: string;
  /** More, when there is more (a check that failed, the clashes of a merge) */
  detail?: unknown;
  /** For a merge that clashes */
  conflicts?: Array<Record<string, unknown>>;
};

export type About = {
  name: string;
  version: string;
  /** The latest commit's seq */
  head: number;
  docs?: string;
  developers?: string;
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
  /** The item's data, as its type's JSON Schema (/v1/types) says */
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

export type Commit = {
  seq: number;
  at: string;
  message: string;
  mergedBy: string;
  author: string;
  changes: Array<{
    /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
    id?: string;
    type?: string;
    path?: string | null;
    rev?: number;
    data?: Record<string, unknown> | null;
  }>;
};

export type Suggestion = {
  id: number;
  title: string;
  description?: string | null;
  author: string;
  status: "draft" | "open" | "merged" | "sent_back" | "withdrawn";
  kind?: string;
  project_id?: number | null;
  base_commit?: number;
  merged_commit?: number | null;
  post_review?: "pending" | "done" | null;
  checks?: Array<{
    check?: string;
    status?: "pass" | "fail" | "warn";
    message?: string;
  }>;
  created_at?: string;
  submitted_at?: string | null;
  closed_at?: string | null;
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

export type ApiToken = {
  id: string;
  name: string;
  /** Its first characters, to recognise it */
  prefix: string;
  scopes: Array<"read" | "write">;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
};

/** Every operation: what it takes and what it answers. */
export interface Operations {
  /** About this API: its version, the latest commit, where the docs are */
  about: {
    input: Record<string, never>;
    output: About;
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
  /** Approve and merge (keepers of its sets, stewards) */
  approveSuggestion: {
    input: {
      id: number;
      body?: {
        /** For each item, how each clashing field is settled */
        resolutions?: Record<string, unknown>;
        note?: string;
      };
    };
    output: {
      commit?: number | null;
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
  /** What a PDF on Google Drive needs to read straight, by its Drive id, or the reading copy to open instead */
  driveFix: {
    input: {
      id: string;
    };
    output: Record<string, unknown>;
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
  /** Follow or unfollow an item, set, project or suggestion */
  follow: {
    input: {
      body: {
        kind: "entity" | "set" | "project" | "changeset";
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
  /** The review view: each item before and after, clashes with main, and the reviewer's advice (machine-written, `machine: true`) */
  getSuggestion: {
    input: {
      id: number;
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
  /** Suggestions, oldest sent first, by status or author */
  listSuggestions: {
    input: {
      status?: "draft" | "open" | "merged" | "sent_back" | "withdrawn";
      /** An account id */
      author?: string;
      /** true: live changes waiting to be reviewed after */
      postReview?: "true" | "false";
      /** How many (at most 500) */
      limit?: number;
      /** The `next` of the page before */
      cursor?: string;
    };
    output: {
      suggestions: Array<Suggestion>;
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
  /** The Model Context Protocol server (Streamable HTTP, JSON answers, no sessions) */
  mcp: {
    input: {
      body?: Record<string, unknown>;
    };
    output: Record<string, unknown>;
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
  /** This document */
  openapi: {
    input: Record<string, never>;
    output: Record<string, unknown>;
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
  /** Report a problem (no account needed: a captcha and an hourly limit instead) */
  report: {
    input: {
      body: {
        /** A permanent id: rh- and letters and digits (read forgivingly: RH-7K2M-9Q4D works) */
        entityId?: string;
        reason: "wrong-fact" | "missing-page" | "bad-scan" | "audio-problem" | "wrong-text" | "duplicate" | "rights" | "offensive" | "other";
        note?: string;
        /** A Turnstile token, when not signed in */
        captcha?: string;
      };
    };
    output: {
      id: number;
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
  /** Held files that look like this one (the same scan or recording in other bytes): a machine's guess */
  similarFiles: {
    input: {
      sha256: string;
    };
    output: Record<string, unknown>;
  };
  /** How many items of each type, and the latest commit */
  stats: {
    input: Record<string, never>;
    output: {
      head: number;
      counts: Record<string, number>;
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
  /** Add a recording to a farbrengen, or a scan: another scan of a printing, a new printing of a sefer, or a new teshura */
  upload: {
    input: {
      /** What it is */
      what: "recording" | "scan";
      /** The farbrengen, sefer, printing or Teshuros set it is added to */
      for: string;
      /** What you know of its rights */
      rights: "mine" | "free" | "public-domain" | "unsure";
      as?: "scan-of" | "printing" | "teshura";
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
      /** For a teshura: the simcha's date key */
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
  addTranslation: {"method":"POST","path":"/v1/units/{id}/translations","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  anchorSync: {"method":"POST","path":"/v1/recordings/{id}/sync/anchor","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  approveSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/approve","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  checkUpload: {"method":"POST","path":"/v1/uploads/check","pathParams":[],"query":[],"body":"json","answer":"json"},
  claimNext: {"method":"POST","path":"/v1/projects/{slug}/next","pathParams":["slug"],"query":[],"body":null,"answer":"json"},
  closeProject: {"method":"POST","path":"/v1/projects/{slug}/close","pathParams":["slug"],"query":[],"body":null,"answer":"json"},
  closeReport: {"method":"POST","path":"/v1/reports/{id}/close","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  commentOnItem: {"method":"POST","path":"/v1/entities/{id}/talk","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  community: {"method":"GET","path":"/v1/community","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  comparePrintings: {"method":"GET","path":"/v1/compare","pathParams":[],"query":["a","b"],"body":null,"answer":"json"},
  confirmScanPage: {"method":"POST","path":"/v1/scans/{id}/text/confirm","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  confirmSync: {"method":"POST","path":"/v1/recordings/{id}/sync/confirm","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  createProject: {"method":"POST","path":"/v1/projects","pathParams":[],"query":[],"body":"json","answer":"json"},
  createSuggestion: {"method":"POST","path":"/v1/suggestions","pathParams":[],"query":[],"body":"json","answer":"json"},
  createWebhook: {"method":"POST","path":"/v1/webhooks","pathParams":[],"query":[],"body":"json","answer":"json"},
  deleteWebhook: {"method":"DELETE","path":"/v1/webhooks/{id}","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  driveFix: {"method":"GET","path":"/v1/page-fixes/drive/{id}","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  editionChecksums: {"method":"GET","path":"/v1/editions/{tag}/SHA256SUMS","pathParams":["tag"],"query":[],"body":null,"answer":"text"},
  editionManifest: {"method":"GET","path":"/v1/editions/{tag}/manifest.json","pathParams":["tag"],"query":[],"body":null,"answer":"json"},
  editions: {"method":"GET","path":"/v1/editions","pathParams":[],"query":[],"body":null,"answer":"json"},
  familyRequest: {"method":"POST","path":"/v1/teshuros/{id}/family-request","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  fixScanLine: {"method":"POST","path":"/v1/scans/{id}/text/fix","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  fixTranscript: {"method":"POST","path":"/v1/recordings/{id}/transcript/fix","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  fixTranslation: {"method":"POST","path":"/v1/translations/fix","pathParams":[],"query":[],"body":"json","answer":"json"},
  follow: {"method":"POST","path":"/v1/follows","pathParams":[],"query":[],"body":"json","answer":"json"},
  forgetPlace: {"method":"DELETE","path":"/v1/places","pathParams":[],"query":["kind","key"],"body":null,"answer":"json"},
  getDump: {"method":"GET","path":"/dumps/{tag}/{name}","pathParams":["tag","name"],"query":[],"body":null,"answer":"raw"},
  getFile: {"method":"GET","path":"/v1/files/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"json"},
  getItem: {"method":"GET","path":"/v1/entities/{id}","pathParams":["id"],"query":["at"],"body":null,"answer":"json"},
  getItems: {"method":"GET","path":"/v1/entities/batch","pathParams":[],"query":["ids"],"body":null,"answer":"json"},
  getManifest: {"method":"GET","path":"/manifests/{collection}/{name}","pathParams":["collection","name"],"query":[],"body":null,"answer":"json"},
  getObject: {"method":"GET","path":"/objects/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"raw"},
  getProject: {"method":"GET","path":"/v1/projects/{slug}","pathParams":["slug"],"query":[],"body":null,"answer":"json"},
  getRevision: {"method":"GET","path":"/v1/revisions/{rev}","pathParams":["rev"],"query":[],"body":null,"answer":"json"},
  getSourceText: {"method":"GET","path":"/v1/texts/{sha256}","pathParams":["sha256"],"query":[],"body":null,"answer":"text"},
  getSuggestion: {"method":"GET","path":"/v1/suggestions/{id}","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  health: {"method":"GET","path":"/v1/health","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  hideComment: {"method":"POST","path":"/v1/comments/{id}/hide","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  iiifManifest: {"method":"GET","path":"/manifests/iiif/{file}","pathParams":["file"],"query":[],"body":null,"answer":"json"},
  itemBacklinks: {"method":"GET","path":"/v1/entities/{id}/backlinks","pathParams":["id"],"query":["field","type"],"body":null,"answer":"json"},
  itemHistory: {"method":"GET","path":"/v1/entities/{id}/history","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  itemRelations: {"method":"GET","path":"/v1/entities/{id}/relations","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  itemTalk: {"method":"GET","path":"/v1/entities/{id}/talk","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  listChildren: {"method":"GET","path":"/v1/entities/{id}/children","pathParams":["id"],"query":["field","type","after","limit","cursor"],"body":null,"answer":"json","items":"items"},
  listCommits: {"method":"GET","path":"/v1/commits","pathParams":[],"query":["since","limit","cursor"],"body":null,"answer":"json","items":"commits"},
  listEvents: {"method":"GET","path":"/v1/events","pathParams":[],"query":["within","day","dates","missing","limit"],"body":null,"answer":"json"},
  listFollows: {"method":"GET","path":"/v1/follows","pathParams":[],"query":["limit"],"body":null,"answer":"json"},
  listItems: {"method":"GET","path":"/v1/entities","pathParams":[],"query":["type","set","after","limit","cursor"],"body":null,"answer":"json","items":"items"},
  listPlaces: {"method":"GET","path":"/v1/places","pathParams":[],"query":["kind","key","limit"],"body":null,"answer":"json"},
  listProjects: {"method":"GET","path":"/v1/projects","pathParams":[],"query":["status"],"body":null,"answer":"json"},
  listReports: {"method":"GET","path":"/v1/reports","pathParams":[],"query":["set","status"],"body":null,"answer":"json"},
  listSuggestions: {"method":"GET","path":"/v1/suggestions","pathParams":[],"query":["status","author","postReview","limit","cursor"],"body":null,"answer":"json","items":"suggestions"},
  listWebhooks: {"method":"GET","path":"/v1/webhooks","pathParams":[],"query":[],"body":null,"answer":"json"},
  llmsTxt: {"method":"GET","path":"/llms.txt","pathParams":[],"query":[],"body":null,"answer":"text"},
  mapContents: {"method":"POST","path":"/v1/suggestions/contents-map","pathParams":[],"query":[],"body":"json","answer":"json"},
  mcp: {"method":"POST","path":"/mcp","pathParams":[],"query":[],"body":"json","answer":"json"},
  mirrors: {"method":"GET","path":"/v1/mirrors","pathParams":[],"query":[],"body":null,"answer":"json"},
  missing: {"method":"GET","path":"/v1/missing","pathParams":[],"query":["kind","within","limit"],"body":null,"answer":"json"},
  oai: {"method":"GET","path":"/oai","pathParams":[],"query":["verb","metadataPrefix","identifier","from","until","set","resumptionToken"],"body":null,"answer":"text"},
  oaiPost: {"method":"POST","path":"/oai","pathParams":[],"query":[],"body":"application/x-www-form-urlencoded","answer":"text"},
  openapi: {"method":"GET","path":"/openapi.json","pathParams":[],"query":[],"body":null,"answer":"json"},
  parseDate: {"method":"GET","path":"/v1/dates/parse","pathParams":[],"query":["q"],"body":null,"answer":"json"},
  putSuggestionItem: {"method":"PUT","path":"/v1/suggestions/{id}/items","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  recordingHanacha: {"method":"GET","path":"/v1/recordings/{id}/hanacha","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  recordingTranscript: {"method":"GET","path":"/v1/recordings/{id}/transcript","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  refCounts: {"method":"GET","path":"/v1/refcounts","pathParams":[],"query":["field","type"],"body":null,"answer":"json"},
  releaseClaim: {"method":"POST","path":"/v1/projects/{slug}/release","pathParams":["slug"],"query":[],"body":"json","answer":"json"},
  report: {"method":"POST","path":"/v1/reports","pathParams":[],"query":[],"body":"json","answer":"json"},
  requestTakedown: {"method":"POST","path":"/v1/takedowns","pathParams":[],"query":[],"body":"json","answer":"json"},
  resolvePath: {"method":"GET","path":"/v1/resolve","pathParams":[],"query":["path"],"body":null,"answer":"json"},
  restoreItem: {"method":"POST","path":"/v1/entities/{id}/restore","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  revertSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/revert","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  reviewLive: {"method":"POST","path":"/v1/suggestions/{id}/review-live","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  root: {"method":"GET","path":"/","pathParams":[],"query":[],"body":null,"answer":"raw"},
  savePlace: {"method":"PUT","path":"/v1/places","pathParams":[],"query":[],"body":"json","answer":"json"},
  scanPages: {"method":"GET","path":"/v1/scans/{id}/pages","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  scanProgress: {"method":"GET","path":"/v1/scans/{id}/progress","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  scanText: {"method":"GET","path":"/v1/scans/{id}/text","pathParams":["id"],"query":["page"],"body":null,"answer":"json"},
  search: {"method":"GET","path":"/v1/search","pathParams":[],"query":["q","type","limit"],"body":null,"answer":"json"},
  searchMoments: {"method":"GET","path":"/v1/search/moments","pathParams":[],"query":["q","limit"],"body":null,"answer":"json"},
  searchSimilar: {"method":"GET","path":"/v1/search/similar","pathParams":[],"query":["q","types","limit"],"body":null,"answer":"json"},
  seedScanText: {"method":"POST","path":"/v1/scans/{id}/text/seed","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  sendBackSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/send-back","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  similarFiles: {"method":"GET","path":"/v1/files/{sha256}/similar","pathParams":["sha256"],"query":[],"body":null,"answer":"json"},
  stats: {"method":"GET","path":"/v1/stats","pathParams":[],"query":[],"body":null,"answer":"json"},
  submitSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/submit","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  suggestFix: {"method":"POST","path":"/v1/suggestions/quick","pathParams":[],"query":[],"body":"json","answer":"json"},
  types: {"method":"GET","path":"/v1/types","pathParams":[],"query":[],"body":null,"answer":"json"},
  unitPrintings: {"method":"GET","path":"/v1/units/{id}/printings","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  unsubscribe: {"method":"POST","path":"/v1/auth/email/unsubscribe","pathParams":[],"query":["token"],"body":"json","answer":"json"},
  upload: {"method":"POST","path":"/v1/uploads","pathParams":[],"query":["what","for","rights","as","title","publication","publisher","year","printing","families","simcha","date"],"body":"application/octet-stream","answer":"raw"},
  uploadOcr: {"method":"POST","path":"/v1/scans/{id}/ocr","pathParams":["id"],"query":[],"body":"json","answer":"json"},
  withdrawSuggestion: {"method":"POST","path":"/v1/suggestions/{id}/withdraw","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  workOutline: {"method":"GET","path":"/v1/works/{id}/outline","pathParams":["id"],"query":[],"body":null,"answer":"json"},
  workPart: {"method":"GET","path":"/v1/works/{id}/parts/{part}","pathParams":["id","part"],"query":["limit"],"body":null,"answer":"json"},
} as const;

export type OperationId = keyof Operations;
/** Operations whose answers come a page at a time. */
export type PagedOperationId = "listChildren" | "listCommits" | "listItems" | "listSuggestions";

/** A typed method for every operation; the calls themselves are in client.ts. */
export abstract class GeneratedMethods {
  protected abstract call<K extends OperationId>(operation: K, input: Operations[K]["input"]): Promise<Operations[K]["output"]>;

  /** About this API: its version, the latest commit, where the docs are (GET /v1) */
  about(): Promise<Operations['about']['output']> {
    return this.call('about', {} as Operations['about']['input']);
  }

  /** Suggest a translation of a unit, as its own text (POST /v1/units/{id}/translations) */
  addTranslation(input: Operations['addTranslation']['input']): Promise<Operations['addTranslation']['output']> {
    return this.call('addTranslation', input ?? {} as Operations['addTranslation']['input']);
  }

  /** The Rebbe is saying this line now: set a paragraph (or word) at atMs, lock it, move what follows (POST /v1/recordings/{id}/sync/anchor) */
  anchorSync(input: Operations['anchorSync']['input']): Promise<Operations['anchorSync']['output']> {
    return this.call('anchorSync', input ?? {} as Operations['anchorSync']['input']);
  }

  /** Approve and merge (keepers of its sets, stewards) (POST /v1/suggestions/{id}/approve) */
  approveSuggestion(input: Operations['approveSuggestion']['input']): Promise<Operations['approveSuggestion']['output']> {
    return this.call('approveSuggestion', input ?? {} as Operations['approveSuggestion']['input']);
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

  /** Comment on an item's talk page (POST /v1/entities/{id}/talk) */
  commentOnItem(input: Operations['commentOnItem']['input']): Promise<Operations['commentOnItem']['output']> {
    return this.call('commentOnItem', input ?? {} as Operations['commentOnItem']['input']);
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

  /** What a PDF on Google Drive needs to read straight, by its Drive id, or the reading copy to open instead (GET /v1/page-fixes/drive/{id}) */
  driveFix(input: Operations['driveFix']['input']): Promise<Operations['driveFix']['output']> {
    return this.call('driveFix', input ?? {} as Operations['driveFix']['input']);
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

  /** A family's request that a teshura not be shown (no account needed): its scans stop being served at once, and stewards review it (POST /v1/teshuros/{id}/family-request) */
  familyRequest(input: Operations['familyRequest']['input']): Promise<Operations['familyRequest']['output']> {
    return this.call('familyRequest', input ?? {} as Operations['familyRequest']['input']);
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

  /** Follow or unfollow an item, set, project or suggestion (POST /v1/follows) */
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

  /** The review view: each item before and after, clashes with main, and the reviewer's advice (machine-written, `machine: true`) (GET /v1/suggestions/{id}) */
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

  /** Items on main, by type and set, in path order, a page at a time (GET /v1/entities) */
  listItems(input?: Operations['listItems']['input']): Promise<Operations['listItems']['output']> {
    return this.call('listItems', input ?? {} as Operations['listItems']['input']);
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

  /** Suggestions, oldest sent first, by status or author (GET /v1/suggestions) */
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

  /** Map pages of a publication to the unit they hold (an existing unit, a new one, or words) (POST /v1/suggestions/contents-map) */
  mapContents(input: Operations['mapContents']['input']): Promise<Operations['mapContents']['output']> {
    return this.call('mapContents', input ?? {} as Operations['mapContents']['input']);
  }

  /** The Model Context Protocol server (Streamable HTTP, JSON answers, no sessions) (POST /mcp) */
  mcp(input?: Operations['mcp']['input']): Promise<Operations['mcp']['output']> {
    return this.call('mcp', input ?? {} as Operations['mcp']['input']);
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

  /** This document (GET /openapi.json) */
  openapi(): Promise<Operations['openapi']['output']> {
    return this.call('openapi', {} as Operations['openapi']['input']);
  }

  /** Read a Hebrew date as people write it (GET /v1/dates/parse) */
  parseDate(input: Operations['parseDate']['input']): Promise<Operations['parseDate']['output']> {
    return this.call('parseDate', input ?? {} as Operations['parseDate']['input']);
  }

  /** Add or change one item in a draft suggestion (data null deletes it) (PUT /v1/suggestions/{id}/items) */
  putSuggestionItem(input: Operations['putSuggestionItem']['input']): Promise<Operations['putSuggestionItem']['output']> {
    return this.call('putSuggestionItem', input ?? {} as Operations['putSuggestionItem']['input']);
  }

  /** The hanacha synced to this recording, paragraph by paragraph (GET /v1/recordings/{id}/hanacha) */
  recordingHanacha(input: Operations['recordingHanacha']['input']): Promise<Operations['recordingHanacha']['output']> {
    return this.call('recordingHanacha', input ?? {} as Operations['recordingHanacha']['input']);
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

  /** Report a problem (no account needed: a captcha and an hourly limit instead) (POST /v1/reports) */
  report(input: Operations['report']['input']): Promise<Operations['report']['output']> {
    return this.call('report', input ?? {} as Operations['report']['input']);
  }

  /** Ask for a file to stop being served (no account needed); stewards answer within two weeks (POST /v1/takedowns) */
  requestTakedown(input: Operations['requestTakedown']['input']): Promise<Operations['requestTakedown']['output']> {
    return this.call('requestTakedown', input ?? {} as Operations['requestTakedown']['input']);
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

  /** Search by meaning (embeddings); every result is the machine's guess (GET /v1/search/similar) */
  searchSimilar(input: Operations['searchSimilar']['input']): Promise<Operations['searchSimilar']['output']> {
    return this.call('searchSimilar', input ?? {} as Operations['searchSimilar']['input']);
  }

  /** Keepers: seed the community text from this OCR layer (checked lines are kept) (POST /v1/scans/{id}/text/seed) */
  seedScanText(input: Operations['seedScanText']['input']): Promise<Operations['seedScanText']['output']> {
    return this.call('seedScanText', input ?? {} as Operations['seedScanText']['input']);
  }

  /** Send back with a note (POST /v1/suggestions/{id}/send-back) */
  sendBackSuggestion(input: Operations['sendBackSuggestion']['input']): Promise<Operations['sendBackSuggestion']['output']> {
    return this.call('sendBackSuggestion', input ?? {} as Operations['sendBackSuggestion']['input']);
  }

  /** Held files that look like this one (the same scan or recording in other bytes): a machine's guess (GET /v1/files/{sha256}/similar) */
  similarFiles(input: Operations['similarFiles']['input']): Promise<Operations['similarFiles']['output']> {
    return this.call('similarFiles', input ?? {} as Operations['similarFiles']['input']);
  }

  /** How many items of each type, and the latest commit (GET /v1/stats) */
  stats(): Promise<Operations['stats']['output']> {
    return this.call('stats', {} as Operations['stats']['input']);
  }

  /** Send for review (runs the automatic checks) (POST /v1/suggestions/{id}/submit) */
  submitSuggestion(input: Operations['submitSuggestion']['input']): Promise<Operations['submitSuggestion']['output']> {
    return this.call('submitSuggestion', input ?? {} as Operations['submitSuggestion']['input']);
  }

  /** Suggest a fix in one step: a new version of one item, with a few words on why, sent for review (POST /v1/suggestions/quick) */
  suggestFix(input: Operations['suggestFix']['input']): Promise<Operations['suggestFix']['output']> {
    return this.call('suggestFix', input ?? {} as Operations['suggestFix']['input']);
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

  /** Add a recording to a farbrengen, or a scan: another scan of a printing, a new printing of a sefer, or a new teshura (POST /v1/uploads) */
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

  /** A work's volumes (its top-level parts), with how many units each holds (GET /v1/works/{id}/outline) */
  workOutline(input: Operations['workOutline']['input']): Promise<Operations['workOutline']['output']> {
    return this.call('workOutline', input ?? {} as Operations['workOutline']['input']);
  }

  /** The units of one volume of a work (GET /v1/works/{id}/parts/{part}) */
  workPart(input: Operations['workPart']['input']): Promise<Operations['workPart']['output']> {
    return this.call('workPart', input ?? {} as Operations['workPart']['input']);
  }
}
