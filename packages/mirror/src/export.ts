import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Catalog, EntityView } from '@rebbehub/core';
import type { AlignmentData, EntityId, SegmentData, TextData } from '@rebbehub/model';
import { ExportGate } from './gate.js';
import { EMBEDDED_TYPES, entityFile, syncFile, textFile } from './layout.js';
import { renderAlignment, renderEntity, renderText, stableJson } from './render.js';

/** Where exported files go: a directory on disk, or anything else that can hold files. */
export interface FileSink {
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function directorySink(root: string): FileSink {
  return {
    async write(path, content) {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    },
    async remove(path) {
      await rm(join(root, path), { force: true });
    },
  };
}

/** A sink in memory, for tests and for building a mirror to upload elsewhere. */
export function memorySink(): FileSink & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async write(path, content) {
      files.set(path, content);
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

export interface ExportStats {
  entities: number;
  texts: number;
  alignments: number;
  withheld: number;
}

const MIRROR_README = `# RebbeHub catalog

The whole RebbeHub catalog, exported from https://rebbehub.org after every
merge. Clone it, diff it, fork it: it belongs to the community.

- \`entities/<type>/<shard>/<id>.json\` - one item per file: its permanent
  id, type, readable path, revision and data.
- \`texts/<shard>/<id>.md\` - a text with its segments; each segment is
  anchored by its permanent id (\`#rh-…\`), so citations never break.
- \`sync/<shard>/<id>.vtt\` - a recording synced to a text, as WebVTT.
- \`COMMIT\` - the last RebbeHub commit this export includes.

Machine-made text and sync are labelled (\`machine=…\`) until a person has
checked them. Never quote them as the Rebbe's words before that.

## Licences

- Catalog facts: CC0 1.0.
- Community text, corrections and sync: CC BY-SA 4.0.
- Texts from other sources keep their own licence (the \`licence\` field of
  each text). Texts whose source does not allow copies are listed but
  their words are not exported.
- Files (scans, recordings) are not in this repository; items refer to
  them by sha256.
`;

class Exporter {
  private readonly gate: ExportGate;
  stats: ExportStats = { entities: 0, texts: 0, alignments: 0, withheld: 0 };

  constructor(
    private readonly catalog: Catalog,
    private readonly sink: FileSink,
    private readonly at: number,
  ) {
    this.gate = new ExportGate(catalog, at);
  }

  async writeEntity(view: EntityView): Promise<void> {
    if (EMBEDDED_TYPES.has(view.type)) return;
    if (view.type === 'text-page') {
      const withheld = await this.gate.layerWithheld((view.data as { layer: EntityId }).layer);
      if (withheld) {
        this.stats.withheld++;
        await this.sink.write(entityFile(view.type, view.id), stableJson({ id: view.id, type: view.type, path: view.path, rev: view.rev, withheld, data: { ...(view.data as object), lines: [] } }));
        this.stats.entities++;
        return;
      }
    }
    await this.sink.write(entityFile(view.type, view.id), renderEntity(view));
    this.stats.entities++;
    if (view.type === 'text') await this.writeText(view);
    if (view.type === 'alignment') await this.writeAlignment(view);
  }

  async writeText(text: EntityView): Promise<void> {
    const withheld = await this.gate.textWithheld(text.id, text.data as unknown as TextData);
    const segments = withheld ? [] : await this.catalog.childrenAt(this.at, 'segment', 'text', text.id);
    if (withheld) this.stats.withheld++;
    await this.sink.write(textFile(text.id), renderText(text, segments, withheld ? { withheld } : {}));
    this.stats.texts++;
  }

  async writeAlignment(alignment: EntityView): Promise<void> {
    const data = alignment.data as unknown as AlignmentData;
    const withheld = await this.gate.textWithheld(data.text);
    const spans = await this.catalog.childrenAt(this.at, 'alignment-span', 'alignment', alignment.id);
    const segments = withheld ? [] : await this.catalog.childrenAt(this.at, 'segment', 'text', data.text);
    await this.sink.write(syncFile(alignment.id), renderAlignment(alignment, spans, new Map(segments.map((s) => [s.id, s]))));
    this.stats.alignments++;
  }

  async rerenderText(id: EntityId): Promise<void> {
    const text = await this.catalog.get(id, { at: this.at });
    if (text) await this.writeText(text);
  }

  async rerenderAlignment(id: EntityId): Promise<void> {
    const alignment = await this.catalog.get(id, { at: this.at });
    if (alignment) await this.writeAlignment(alignment);
  }
}

/** Writes the whole catalog as of commit `at`. Start from an empty directory (or `clearMirror` it). */
export async function exportSnapshot(catalog: Catalog, sink: FileSink, at: number): Promise<ExportStats> {
  const exporter = new Exporter(catalog, sink, at);
  await sink.write('README.md', MIRROR_README);
  let after: EntityId | undefined;
  for (;;) {
    const page = await catalog.snapshot(at, { after, limit: 1000 });
    if (page.length === 0) break;
    for (const view of page) await exporter.writeEntity(view);
    after = page[page.length - 1]!.id;
  }
  await sink.write('COMMIT', `${at}\n`);
  return exporter.stats;
}

/** Removes everything an export writes, keeping the rest (`.git`). */
export async function clearMirror(root: string): Promise<void> {
  for (const dir of ['entities', 'texts', 'sync']) await rm(join(root, dir), { recursive: true, force: true });
}

export interface ExportedCommit {
  seq: number;
  at: string;
  message: string;
  author: string;
  mergedBy: string;
  stats: ExportStats;
}

/**
 * Applies the commits after `since` one at a time, calling `afterEach` once
 * each is written, so the mirror can record one git commit per RebbeHub
 * commit with its author, date and message.
 */
export async function exportCommits(catalog: Catalog, sink: FileSink, since: number, afterEach?: (commit: ExportedCommit) => Promise<void>, limit = 1000): Promise<number> {
  let last = since;
  for (const commit of await catalog.commitsSince(since, limit)) {
    const exporter = new Exporter(catalog, sink, commit.seq);
    const texts = new Set<EntityId>();
    const alignments = new Set<EntityId>();
    for (const change of commit.changes) {
      if (change.data === null) {
        await sink.remove(entityFile(change.type, change.id));
        if (change.type === 'text') await sink.remove(textFile(change.id));
        if (change.type === 'alignment') await sink.remove(syncFile(change.id));
      } else {
        await exporter.writeEntity({ id: change.id, type: change.type, path: change.path, rev: change.rev, data: change.data });
      }
      // A segment or span lives in its parent's file: re-render the parent (the one it was in, and the one it is in now).
      if (change.type === 'segment' || change.type === 'alignment-span') {
        const field = change.type === 'segment' ? 'text' : 'alignment';
        const before = await catalog.get(change.id, { at: commit.seq - 1 });
        for (const version of [change.data, before?.data]) {
          const parent = (version as Record<string, unknown> | null | undefined)?.[field];
          if (typeof parent === 'string') (change.type === 'segment' ? texts : alignments).add(parent as EntityId);
        }
      }
    }
    for (const id of texts) {
      await exporter.rerenderText(id);
      // Cues carry the segments' words, so the text's alignments follow.
      for (const link of await catalog.backlinks(id, { field: 'text', type: 'alignment' })) alignments.add(link.from);
    }
    for (const id of alignments) await exporter.rerenderAlignment(id);
    await sink.write('COMMIT', `${commit.seq}\n`);
    last = commit.seq;
    await afterEach?.({ seq: commit.seq, at: commit.at, message: commit.message, author: commit.author, mergedBy: commit.mergedBy, stats: exporter.stats });
  }
  return last;
}

export type { SegmentData };
