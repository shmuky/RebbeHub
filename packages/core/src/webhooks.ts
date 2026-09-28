import { one } from '@rebbehub/db';
import type { Catalog } from './catalog.js';
import { forbidden, invalid, notFound } from './errors.js';
import { ExportGate } from './gate.js';

/**
 * Webhooks: every merge to the catalog, posted to the addresses people
 * registered (migration 0008). A delivery is a POST of
 * `{ "commits": [...] }`, the same commits `GET /v1/commits` lists (words
 * withheld for rights left out), signed in `X-RebbeHub-Signature` as
 * `sha256=<HMAC-SHA256 of the body with the hook's secret>`. Commits go in
 * order; a hook is sent the next ones only after the last were taken, and
 * after 20 failures in a row it is switched off.
 */

export const MAX_HOOKS_PER_ACCOUNT = 5;
export const MAX_FAILURES = 20;

export interface WebhookRow {
  id: number;
  url: string;
  active: boolean;
  lastSeq: number;
  failures: number;
  lastError: string | null;
  createdAt: string;
}

function toRow(r: { id: number | string; url: string; active: boolean; last_seq: number | string; failures: number; last_error: string | null; created_at: Date | string }): WebhookRow {
  return { id: Number(r.id), url: r.url, active: r.active, lastSeq: Number(r.last_seq), failures: r.failures, lastError: r.last_error, createdAt: new Date(r.created_at).toISOString() };
}

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Registers an address; the secret is returned this once, for checking signatures. Deliveries start from the next merge. */
export async function createWebhook(catalog: Catalog, by: string, url: string): Promise<WebhookRow & { secret: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('a webhook address is a full https:// address');
  }
  if (parsed.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(parsed.hostname)) throw invalid('a webhook address is a public https:// address');
  const count = await one<{ n: number }>(catalog.db, 'SELECT count(*)::int AS n FROM webhook WHERE account_id = $1', [by]);
  if ((count?.n ?? 0) >= MAX_HOOKS_PER_ACCOUNT) throw forbidden(`up to ${MAX_HOOKS_PER_ACCOUNT} webhooks an account`);
  const secret = randomSecret();
  const row = await one<Parameters<typeof toRow>[0]>(
    catalog.db,
    'INSERT INTO webhook (account_id, url, secret, last_seq) VALUES ($1, $2, $3, (SELECT coalesce(max(seq), 0) FROM commit)) RETURNING *',
    [by, parsed.toString(), secret],
  );
  return { ...toRow(row!), secret };
}

export async function listWebhooks(catalog: Catalog, by: string): Promise<WebhookRow[]> {
  const { rows } = await catalog.db.query<Parameters<typeof toRow>[0]>('SELECT * FROM webhook WHERE account_id = $1 ORDER BY id', [by]);
  return rows.map(toRow);
}

export async function deleteWebhook(catalog: Catalog, by: string, id: number): Promise<void> {
  const row = await one<{ id: number }>(catalog.db, 'DELETE FROM webhook WHERE id = $1 AND account_id = $2 RETURNING id', [id, by]);
  if (!row) throw notFound(`webhook ${id}`);
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Sends each active hook the commits it has not taken yet, up to `batch` at a time. Run every few minutes. */
export async function deliverWebhooks(catalog: Catalog, options: { fetch?: typeof fetch; batch?: number } = {}): Promise<Array<{ id: number; delivered: number; error?: string }>> {
  const send = options.fetch ?? fetch;
  const { rows } = await catalog.db.query<{ id: number; url: string; secret: string; last_seq: number | string; failures: number }>(
    'SELECT id, url, secret, last_seq, failures FROM webhook WHERE active AND last_seq < (SELECT coalesce(max(seq), 0) FROM commit) ORDER BY id',
  );
  const gate = new ExportGate(catalog);
  const results: Array<{ id: number; delivered: number; error?: string }> = [];
  for (const hook of rows) {
    const commits = await catalog.commitsSince(Number(hook.last_seq), options.batch ?? 20);
    for (const commit of commits) {
      commit.changes = await Promise.all(commit.changes.map(async (change) => (change.data === null ? change : { ...change, data: (await gate.redact({ ...change, data: change.data })).data })));
    }
    const body = JSON.stringify({ commits });
    let error: string | undefined;
    try {
      const response = await send(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'RebbeHub-Webhooks', 'X-RebbeHub-Signature': await sign(hook.secret, body) },
        body,
        redirect: 'manual',
      });
      if (!response.ok) error = `answered ${response.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) {
      await catalog.db.query('UPDATE webhook SET failures = failures + 1, last_error = $2, active = failures + 1 < $3 WHERE id = $1', [hook.id, error.slice(0, 500), MAX_FAILURES]);
      results.push({ id: Number(hook.id), delivered: 0, error });
    } else {
      await catalog.db.query('UPDATE webhook SET last_seq = $2, failures = 0, last_error = NULL WHERE id = $1', [hook.id, commits.at(-1)!.seq]);
      results.push({ id: Number(hook.id), delivered: commits.length });
    }
  }
  return results;
}
