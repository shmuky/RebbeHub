import { one, type Db } from '@rebbehub/db';
import type { EntityId, EntityType } from '@rebbehub/model';
import type { Catalog, EntityView, RevisionRow } from './catalog.js';
import { ExportGate } from './gate.js';
import { momentOf, type Moment } from './moments.js';

/**
 * Search by meaning (the plan, section 9: "pgvector embeddings for 'find
 * sichos about this idea'"). Each item's words are turned by a model into
 * a vector, kept in `embedding`; a question is turned the same way, and
 * the items nearest to it are found. What it finds is the machine's
 * guess, always labelled so; nothing here changes the catalog.
 *
 * The model is multilingual (BGE-M3 on Cloudflare Workers AI), so Hebrew,
 * Yiddish and English questions find the same sichos. It needs
 * CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN; without them the job
 * does not run and the site does not offer this kind of search.
 */

export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
/** BGE-M3's size; the pgvector index (migration 0010) is built for it. */
export const EMBEDDING_DIMENSIONS = 1024;

/** The kinds of item whose words are embedded: sichos and other units, farbrengens, paragraphs, and scans' pages. */
export const EMBEDDED_TYPES: readonly EntityType[] = ['unit', 'event', 'segment', 'text-page', 'work'];

export interface Embedder {
  model: string;
  /** One vector per text, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Embeddings on Cloudflare Workers AI, through its REST API (so the same code runs in the jobs and on the API's Worker). */
export function workersAiEmbedder(input: { accountId: string; token: string; model?: string; fetch?: typeof fetch }): Embedder {
  const model = input.model ?? EMBEDDING_MODEL;
  return {
    model,
    async embed(texts) {
      if (texts.length === 0) return [];
      const response = await (input.fetch ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texts }),
      });
      const body = (await response.json().catch(() => ({}))) as { success?: boolean; errors?: unknown; result?: { data?: number[][] } };
      if (!response.ok || !body.success || !body.result?.data) throw new Error(`Workers AI: ${response.status} ${JSON.stringify(body.errors ?? body)}`);
      return body.result.data;
    },
  };
}

/** The embedder the environment allows, or null while its keys are not set. */
export function embedderFromEnv(env: Record<string, string | undefined>): Embedder | null {
  return env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN ? workersAiEmbedder({ accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_AI_TOKEN }) : null;
}

/** A vector of length one, so the dot product of two is their cosine. */
export function unitVector(vector: readonly number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? [...vector] : vector.map((x) => x / norm);
}

const MAX_CHARS = 2000;
const clip = (text: string) => (text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text);
const nameText = (name: unknown): string => (name && typeof name === 'object' ? Object.values(name as Record<string, string>).filter((v) => typeof v === 'string').join(' · ') : '');

/**
 * The words of an item that say what it is about, as the model reads
 * them: a unit's name and page, a farbrengen's title and outline, a
 * paragraph, a page of a scan. Null when there is nothing to read.
 */
export function embeddingInput(view: Pick<EntityView, 'type' | 'data'>): string | null {
  const d = view.data as Record<string, unknown>;
  const body = typeof d.body === 'string' ? d.body.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/[=']{2,}/g, ' ') : '';
  let text = '';
  switch (view.type) {
    case 'unit':
      text = [nameText(d.label), body].filter(Boolean).join('\n');
      break;
    case 'event':
      text = [nameText(d.title), typeof d.occasion === 'string' ? d.occasion : '', body].filter(Boolean).join('\n');
      break;
    case 'work':
      text = [nameText(d.title), nameText(d.description), body].filter(Boolean).join('\n');
      break;
    case 'segment':
      text = typeof d.content === 'string' ? d.content : '';
      break;
    case 'text-page':
      text = Array.isArray(d.lines) ? (d.lines as Array<{ text?: string }>).map((l) => l.text ?? '').join(' ') : '';
      break;
    default:
      return null;
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length >= 3 ? clip(text) : null;
}

/** The machine_pass job that remembers items with nothing to embed. */
const passJob = (model: string) => `embed:${model}`;

/** Whether this database has pgvector switched on (Neon); remembered per database. */
const vectorSupport = new WeakMap<Db, Promise<boolean>>();
export function hasPgvector(db: Db): Promise<boolean> {
  let known = vectorSupport.get(db);
  if (!known) {
    known = one<{ on: boolean }>(db, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS on").then((r) => Boolean(r?.on)).catch(() => false);
    vectorSupport.set(db, known);
  }
  return known;
}

/** Items on main whose words have not been embedded by `model`, or have changed since. */
export async function itemsToEmbed(catalog: Catalog, options: { model: string; types?: readonly EntityType[]; limit?: number }): Promise<EntityView[]> {
  const { rows } = await catalog.db.query<RevisionRow>(
    `SELECT r.* FROM entity e JOIN revision r ON r.id = e.main_rev
     LEFT JOIN embedding m ON m.entity_id = e.id AND m.model = $2
     WHERE e.type = ANY($1::text[]) AND NOT e.deleted AND r.data IS NOT NULL AND (m.entity_id IS NULL OR m.rev <> e.main_rev)
       AND NOT EXISTS (SELECT 1 FROM machine_pass p WHERE p.job = $3 AND p.entity_id = e.id AND p.rev = e.main_rev)
     ORDER BY e.id LIMIT ${Math.min(Math.max(options.limit ?? 500, 1), 50_000)}`,
    [options.types ?? EMBEDDED_TYPES, options.model, passJob(options.model)],
  );
  return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
}

/**
 * Embeds what has not been embedded yet, a batch at a time. Words whose
 * rights forbid copies are not sent anywhere: such an item is embedded by
 * its name alone, or not at all.
 */
export async function embedItems(catalog: Catalog, embedder: Embedder, options: { limit?: number; batch?: number; log?: (line: string) => void } = {}): Promise<{ embedded: number; skipped: number }> {
  const log = options.log ?? (() => {});
  const gate = new ExportGate(catalog);
  const items = await itemsToEmbed(catalog, { model: embedder.model, limit: options.limit });
  const batchSize = Math.min(Math.max(options.batch ?? 50, 1), 100);
  let embedded = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch: Array<{ view: EntityView; text: string }> = [];
    for (const item of items.slice(i, i + batchSize)) {
      const shown = await gate.redact(item);
      const text = embeddingInput(shown);
      if (text) batch.push({ view: item, text });
      else {
        // Nothing to read: remembered as done at this revision, so it is not asked again until it changes.
        await catalog.db.query(
          `INSERT INTO machine_pass (job, entity_id, rev) VALUES ($1, $2, $3) ON CONFLICT (job, entity_id) DO UPDATE SET rev = EXCLUDED.rev, at = now()`,
          [passJob(embedder.model), item.id, item.rev],
        );
        skipped++;
      }
    }
    const vectors = await embedder.embed(batch.map((b) => b.text));
    if (vectors.length !== batch.length) throw new Error(`the model gave ${vectors.length} vectors for ${batch.length} texts`);
    for (const [j, { view }] of batch.entries()) {
      const vector = vectors[j]!;
      if (vector.length !== EMBEDDING_DIMENSIONS && embedder.model === EMBEDDING_MODEL) throw new Error(`expected ${EMBEDDING_DIMENSIONS} numbers from ${embedder.model}, got ${vector.length}`);
      await catalog.db.query(
        `INSERT INTO embedding (entity_id, rev, model, vector) VALUES ($1, $2, $3, $4::real[])
         ON CONFLICT (entity_id) DO UPDATE SET rev = EXCLUDED.rev, model = EXCLUDED.model, vector = EXCLUDED.vector, created_at = now()`,
        [view.id, view.rev, embedder.model, unitVector(vector)],
      );
      embedded++;
    }
    log(`embedded ${embedded} of ${items.length}`);
  }
  return { embedded, skipped };
}

/** One item found by meaning: how near it is (cosine, 1 is the same), and for a page or a paragraph, the moment to open. */
export interface SimilarItem {
  score: number;
  item: EntityView & { withheld?: string };
  moment: Moment | null;
  /** Always true: the machine chose this, not a person. */
  machine: true;
}

/** The items whose meaning is nearest to `query`, best first. */
export async function searchSimilar(catalog: Catalog, embedder: Embedder, query: string, options: { limit?: number; types?: readonly EntityType[] } = {}): Promise<SimilarItem[]> {
  const text = query.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!text) return [];
  const [vector] = await embedder.embed([text]);
  if (!vector) return [];
  return nearest(catalog, embedder.model, unitVector(vector), options);
}

/** The items nearest to a vector (of length one) made by `model`. */
export async function nearest(catalog: Catalog, model: string, vector: readonly number[], options: { limit?: number; types?: readonly EntityType[] } = {}): Promise<SimilarItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const types = options.types ?? EMBEDDED_TYPES;
  const pgvector = model === EMBEDDING_MODEL && vector.length === EMBEDDING_DIMENSIONS && (await hasPgvector(catalog.db));
  // With pgvector the index answers; without it the vectors are compared in plain SQL, which is fine for a catalog of this size.
  const score = pgvector ? `1 - ((m.vector::vector(${EMBEDDING_DIMENSIONS})) <=> $1::real[]::vector(${EMBEDDING_DIMENSIONS}))` : '(SELECT sum(a * b) FROM unnest(m.vector, $1::real[]) AS t(a, b))';
  const order = pgvector ? `(m.vector::vector(${EMBEDDING_DIMENSIONS})) <=> $1::real[]::vector(${EMBEDDING_DIMENSIONS})` : 'score DESC';
  const { rows } = await catalog.db.query<{ id: EntityId; score: number }>(
    `SELECT m.entity_id AS id, ${score} AS score FROM embedding m JOIN entity e ON e.id = m.entity_id
     WHERE m.model = $2 AND cardinality(m.vector) = $4 AND e.type = ANY($3::text[]) AND NOT e.deleted AND e.main_rev IS NOT NULL
     ORDER BY ${order} LIMIT ${limit}`,
    [vector, model, types, vector.length],
  );
  const gate = new ExportGate(catalog);
  const views = new Map((await catalog.getMany(rows.map((r) => r.id))).map((v) => [v.id, v]));
  const out: SimilarItem[] = [];
  for (const row of rows) {
    const view = views.get(row.id);
    if (!view) continue;
    out.push({ score: Math.round(Number(row.score) * 1000) / 1000, item: await gate.redact(view), moment: await momentOf(catalog, view, [], gate), machine: true });
  }
  return out;
}

/** How much of the catalog has been embedded, for the health page. */
export async function embeddingCoverage(catalog: Catalog, model = EMBEDDING_MODEL): Promise<{ embedded: number; waiting: number }> {
  const row = await one<{ embedded: number; waiting: number }>(
    catalog.db,
    `SELECT count(*) FILTER (WHERE m.entity_id IS NOT NULL AND m.rev = e.main_rev)::int AS embedded,
            count(*) FILTER (WHERE (m.entity_id IS NULL OR m.rev <> e.main_rev)
              AND NOT EXISTS (SELECT 1 FROM machine_pass p WHERE p.job = $3 AND p.entity_id = e.id AND p.rev = e.main_rev))::int AS waiting
     FROM entity e LEFT JOIN embedding m ON m.entity_id = e.id AND m.model = $2
     WHERE e.type = ANY($1::text[]) AND NOT e.deleted AND e.main_rev IS NOT NULL`,
    [EMBEDDED_TYPES, model, passJob(model)],
  );
  return row ?? { embedded: 0, waiting: 0 };
}
