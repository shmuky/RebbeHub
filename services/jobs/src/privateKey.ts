import { createHash } from 'node:crypto';

/**
 * While RebbeHub is private (services/api/src/lock.ts), the jobs' own
 * reads of rebbehub.org and api.rebbehub.org (scans, recordings, page
 * fixes, mirrors) carry the lock's key. It is made from the password in
 * REBBEHUB_PASSWORD (a repository secret); without it they go as anyone,
 * and are turned away.
 */
const password = process.env.REBBEHUB_PASSWORD?.trim();
if (password) {
  const key = createHash('sha256').update(`rebbehub-lock:${password}`).digest('hex');
  const ours = (url: URL) => url.protocol === 'https:' && (url.hostname === 'rebbehub.org' || url.hostname.endsWith('.rebbehub.org'));
  const plain = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!ours(url)) return plain(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-rebbehub-key', key);
    return plain(input, { ...init, headers });
  };
}
