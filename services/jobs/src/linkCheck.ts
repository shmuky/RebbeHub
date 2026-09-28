import type { Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';

/**
 * Dead links (the plan, section 9, health dashboards; section 7: "link
 * alive?"). RebbeHub links to more than it holds: hanachos on Drive,
 * books on HebrewBooks, recordings and videos elsewhere. This finds every
 * address the catalog links to, asks each whether it still answers, and
 * keeps the answer in `link_check` for the health page. Each run checks
 * the addresses checked longest ago first, so a large catalog is gone
 * through a part at a time.
 */

/** The fields that hold an address to check. */
const URL_KEYS = new Set(['url', 'origin']);

/** Every http(s) address in an item's data, under the keys that hold links. */
export function linksIn(data: unknown): string[] {
  const out = new Set<string>();
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (URL_KEYS.has(key) && /^https?:\/\/[^\s]+$/.test(value)) out.add(value);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(data, '');
  return [...out];
}

/** Every address the catalog links to on main, with the items that link to it. */
export async function collectLinks(catalog: Catalog): Promise<Map<string, EntityId[]>> {
  const links = new Map<string, EntityId[]>();
  let after = '';
  for (;;) {
    const { rows } = await catalog.db.query<{ id: EntityId; data: unknown }>(
      `SELECT e.id, r.data FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE NOT e.deleted AND e.type NOT IN ('segment', 'text-page', 'alignment-span', 'schema') AND e.id > $1
         AND r.data::text LIKE '%http%' ORDER BY e.id LIMIT 2000`,
      [after],
    );
    if (rows.length === 0) return links;
    for (const row of rows) for (const url of linksIn(row.data)) links.set(url, [...(links.get(url) ?? []), row.id]);
    after = rows[rows.length - 1]!.id;
  }
}

export interface LinkAnswer {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/**
 * Whether an address still answers: a HEAD request, and where a server
 * will not answer HEAD, a GET of its first byte. Redirects are followed;
 * anything below 400 is alive.
 */
export async function checkLink(url: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<LinkAnswer> {
  const doFetch = options.fetch ?? fetch;
  const ask = async (method: 'HEAD' | 'GET') => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await doFetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'RebbeHub link check (https://rebbehub.org)', ...(method === 'GET' ? { range: 'bytes=0-0' } : {}) },
      });
      await response.body?.cancel().catch(() => {});
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await ask('HEAD');
    if (status === 405 || status === 403 || status === 501 || status === 400) status = await ask('GET');
    return { ok: status < 400, status, error: status < 400 ? null : `answered ${status}` };
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? 'no answer in time' : (error as Error).message;
    return { ok: false, status: null, error: message.slice(0, 500) };
  }
}

/**
 * Checks up to `limit` of the catalog's links (never checked, then
 * checked longest ago), `concurrency` at a time, and records the answers.
 * Addresses the catalog no longer links to are forgotten.
 */
export async function checkLinks(
  catalog: Catalog,
  options: { limit?: number; concurrency?: number; fetch?: typeof fetch; log?: (line: string) => void } = {},
): Promise<{ links: number; checked: number; dead: number }> {
  const log = options.log ?? (() => {});
  const links = await collectLinks(catalog);
  const urls = [...links.keys()];
  const db = catalog.db;
  await db.query('DELETE FROM link_check WHERE NOT (url = ANY($1::text[]))', [urls]);
  const { rows: known } = await db.query<{ url: string; checked_at: string }>('SELECT url, checked_at FROM link_check');
  const last = new Map(known.map((k) => [k.url, new Date(k.checked_at).getTime()]));
  const due = urls.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0) || (a < b ? -1 : 1)).slice(0, Math.max(options.limit ?? 500, 0));

  let dead = 0;
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const url = due[next++]!;
      const answer = await checkLink(url, { fetch: options.fetch });
      // Asked to slow down: that says nothing about the link. It keeps its last answer and is asked first next time.
      if (answer.status === 429) {
        log(`slowed down: ${url}`);
        continue;
      }
      if (!answer.ok) {
        dead++;
        log(`dead: ${url} (${answer.error})`);
      }
      await db.query(
        `INSERT INTO link_check (url, entity_ids, status, ok, error, checked_at, failing_since) VALUES ($1, $2, $3, $4, $5, now(), CASE WHEN $4 THEN NULL ELSE now() END)
         ON CONFLICT (url) DO UPDATE SET entity_ids = EXCLUDED.entity_ids, status = EXCLUDED.status, ok = EXCLUDED.ok, error = EXCLUDED.error, checked_at = now(),
           failing_since = CASE WHEN EXCLUDED.ok THEN NULL ELSE coalesce(link_check.failing_since, now()) END`,
        [url, links.get(url) ?? [], answer.status, answer.ok, answer.error],
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(options.concurrency ?? 6, 1), 32) }, worker));
  return { links: urls.length, checked: due.length, dead };
}
