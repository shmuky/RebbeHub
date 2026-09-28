import { existsSync } from 'node:fs';
import type { EntityType } from '@rebbehub/model';
import type { ImportRecord, Importer } from './importer.js';

/**
 * Sichos-Kodesh's archive (its services/archive): every file the indexers
 * know, fetched once from JEM's CDN and Google Drive and kept under the
 * sha256 of its bytes, in a small Git-like SQLite index (`index.sqlite`:
 * commits, objects, sources, wanted, refs). It runs on Sichos-Kodesh's own
 * server, so this reads a copy of that index given at run time
 * (SK_ARCHIVE_DB).
 *
 * Its history becomes RebbeHub's: each of the archive's commits is one
 * suggestion by this bot, adding to each item it touched the record of
 * the file the archive keeps for it - where it was fetched from, when, its
 * sha256 and size - so an item's page and history say which exact file
 * is its recording or its hanacha. Its `wanted` list (what every item
 * should have) names the files upstream would not give; those feed the
 * Missing board (`archiveGaps`, loaded by `rebbehub archive-gaps`).
 *
 * The Maanos are in the archive, kept but not cleared: nothing of them is
 * read here.
 */

/** One file an archive commit gave an item. */
export interface ArchiveRef {
  commitId: string;
  collection: string;
  itemId: string;
  kind: 'audio' | 'pdf' | 'text';
  sourceId: string;
  role: string;
  sha256: string;
  bytes: number;
  source: string | null;
  url: string | null;
  fetchedAt: string | null;
  etag: string | null;
}
export interface ArchiveCommit {
  id: string;
  author: string;
  message: string;
  createdAt: string;
}
/** A file upstream would not give the archive (`sk-archive report-unresolved`). */
export interface ArchiveGap {
  collection: string;
  itemId: string;
  kind: string;
  sourceId: string;
  role: string;
  source: string;
  url: string;
  label: string | null;
  hebrewDate: string | null;
  status: 'unresolved' | 'error';
  httpStatus: number | null;
  error: string | null;
  attempts: number;
  checkedAt: string | null;
}
export interface ArchiveIndex {
  commits: ArchiveCommit[];
  refs: ArchiveRef[];
  gaps: ArchiveGap[];
}

/** Collections that are never read: their rights are not cleared. */
const GATED = new Set(['maanos']);

/** Reads the archive's index (`raw/index.sqlite`), commits on main only. */
export async function readArchiveIndex(file: string): Promise<ArchiveIndex> {
  if (!existsSync(file)) throw new Error(`no archive index at ${file}`);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
    const commits = db
      .prepare("SELECT id, author, message, created_at FROM commits WHERE status = 'main' ORDER BY created_at, id")
      .all()
      .map((r) => ({ id: String(r.id), author: String(r.author), message: String(r.message), createdAt: String(r.created_at) }));
    const refs = db
      .prepare(
        `SELECT r.commit_id, r.collection, r.item_id, r.kind, r.source_id, r.role, r.sha256, o.bytes, w.source, w.url, s.fetched_at, s.etag
         FROM refs r JOIN objects o ON o.sha256 = r.sha256 JOIN commits c ON c.id = r.commit_id AND c.status = 'main'
         LEFT JOIN wanted w ON w.collection = r.collection AND w.item_id = r.item_id AND w.kind = r.kind AND w.source_id = r.source_id AND w.role = r.role
         LEFT JOIN sources s ON s.source = w.source AND s.url = w.url
         WHERE r.removed_commit IS NULL
         ORDER BY c.created_at, r.commit_id, r.collection, r.item_id, r.role`,
      )
      .all()
      .filter((r) => !GATED.has(String(r.collection)))
      .map((r) => ({
        commitId: String(r.commit_id),
        collection: String(r.collection),
        itemId: String(r.item_id),
        kind: String(r.kind) as ArchiveRef['kind'],
        sourceId: String(r.source_id),
        role: String(r.role ?? ''),
        sha256: String(r.sha256),
        bytes: Number(r.bytes ?? 0),
        source: str(r.source),
        url: str(r.url),
        fetchedAt: str(r.fetched_at),
        etag: str(r.etag),
      }));
    const gaps = db
      .prepare(
        `SELECT w.collection, w.item_id, w.kind, w.source_id, w.role, w.source, w.url, w.label, w.hebrew_date, s.status, s.http_status, s.error, s.attempts, s.fetched_at
         FROM wanted w JOIN sources s ON s.source = w.source AND s.url = w.url
         WHERE s.status IN ('unresolved', 'error')
           AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.collection = w.collection AND r.item_id = w.item_id AND r.kind = w.kind AND r.source_id = w.source_id AND r.role = w.role AND r.removed_commit IS NULL)
         ORDER BY w.collection, w.hebrew_date, w.item_id, w.role`,
      )
      .all()
      .filter((r) => !GATED.has(String(r.collection)))
      .map((r) => ({
        collection: String(r.collection),
        itemId: String(r.item_id),
        kind: String(r.kind),
        sourceId: String(r.source_id),
        role: String(r.role ?? ''),
        source: String(r.source),
        url: String(r.url),
        label: str(r.label),
        hebrewDate: str(r.hebrew_date),
        status: String(r.status) as ArchiveGap['status'],
        httpStatus: r.http_status === null ? null : Number(r.http_status),
        error: str(r.error),
        attempts: Number(r.attempts ?? 0),
        checkedAt: str(r.fetched_at),
      }));
    return { commits, refs, gaps };
  } finally {
    db.close();
  }
}

/**
 * The RebbeHub item an archive item is, by the key its own importer gave
 * it: a farbrengen's hanacha is on its event, its recording is its part,
 * a JEM recording is the JEM importer's, a sefer's text is its unit's.
 * Items RebbeHub has no page for (the Likkutei Sichos pages, the yomanim)
 * have none.
 */
export function archiveTarget(item: { collection: string; itemId: string; kind: string; sourceId: string; role: string }):{ key: string; type: EntityType } | null {
  switch (item.collection) {
    case 'farbrengens':
      if (!/^\d+$/.test(item.itemId)) return null;
      if (item.kind === 'audio' && /^\d+$/.test(item.role)) return { key: `mafteiach-recording:${item.itemId}/${Number(item.role) + 1}`, type: 'recording' };
      return { key: `mafteiach-occasion:${item.itemId}`, type: 'event' };
    case 'jemEvents':
      return item.kind === 'audio' && item.sourceId ? { key: `jem-audio:${item.sourceId.replace(/\.[a-z0-9]+$/i, '')}`, type: 'recording' } : null;
    case 'works':
      return /^[a-z0-9-]+\/.+$/.test(item.itemId) ? { key: `sichos-kodesh-unit:${item.itemId}`, type: 'unit' } : null;
    case 'igros': {
      const id = /^(?:igros:)?(\d+[a-z]?(?:-\d+)?)$/.exec(item.itemId)?.[1];
      return id ? { key: `sichos-kodesh-unit:igros-kodesh-rebbe/${id}`, type: 'unit' } : null;
    }
    default:
      return null;
  }
}

const iso = (value: string | null) => {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
};

/** The record, on an item, of the file the archive keeps for it. */
export function archiveSourceRef(r: ArchiveRef): Record<string, string> {
  const out: Record<string, string> = {
    source: r.source === 'jem' ? 'jem' : 'other',
    sourceId: r.sourceId.slice(0, 500),
    note: `Kept in Sichos-Kodesh's archive: sha256 ${r.sha256}, ${r.bytes} bytes${r.role && r.kind !== 'audio' ? ` (${r.role})` : ''}`,
  };
  if (r.url && /^https?:\/\//.test(r.url)) out.url = r.url.slice(0, 2000);
  const fetched = iso(r.fetchedAt);
  if (fetched) out.fetchedAt = fetched;
  if (r.etag) out.etag = r.etag.slice(0, 500);
  return out;
}

export function archiveImporter(input: ArchiveIndex | (() => Promise<ArchiveIndex>)): Importer {
  return {
    id: 'archive',
    bot: { id: 'bot:sk-archive', displayName: "Sichos-Kodesh's archive" },
    async *records(): AsyncIterable<ImportRecord> {
      const index = typeof input === 'function' ? await input() : input;
      const commits = new Map(index.commits.map((c) => [c.id, c]));
      // The refs of one commit, by the item they add to, in the archive's order.
      let current: string | null = null;
      let items = new Map<string, { type: EntityType; sources: Array<Record<string, string>> }>();
      const flush = function* (): Generator<ImportRecord> {
        const commit = current ? commits.get(current) : undefined;
        if (!commit) return;
        const group = { key: commit.id, title: `Sichos-Kodesh archive: ${commit.message} (${commit.author}, ${commit.createdAt.slice(0, 10)})` };
        for (const [key, item] of items) yield { key, type: item.type, patch: 'add', group, data: { sources: item.sources } };
      };
      for (const r of index.refs) {
        if (r.commitId !== current) {
          yield* flush();
          current = r.commitId;
          items = new Map();
        }
        const target = archiveTarget(r);
        if (!target) continue;
        const item = items.get(target.key) ?? { type: target.type, sources: [] };
        item.sources.push(archiveSourceRef(r));
        items.set(target.key, item);
      }
      yield* flush();
    },
  };
}
