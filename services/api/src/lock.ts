/**
 * RebbeHub is private for now (Shmuly, 2 October 2026): the site, the API,
 * the MCP server and the files open only for him. Everyone else gets the
 * lock page (the site) or 401 (the API).
 *
 * One password opens it. The browser never keeps the password itself, only
 * its key (`keyOf`), in a cookie on rebbehub.org and its subdomains, so the
 * site, the API's files and the reader all see it. GitHub's jobs send the
 * same key in a header. The Workers keep only the key's hash
 * (`LOCK_KEY_HASH` in wrangler.toml, safe to publish: the password is long
 * and random), or the password itself when it is set as the secret
 * `LOCK_PASSWORD`, which wins; changing that secret on both Workers changes
 * the password and signs every browser out.
 *
 * Signed-in callers that are not a browser with the key (his MCP connector,
 * his API tokens) are let in only as one of the owners: platform admins, and
 * the accounts named in `OWNER_ACCOUNTS`.
 */

export const LOCK_COOKIE = '__Secure-rh_lock';
export const LOCK_HEADER = 'x-rebbehub-key';
/** Said on every answer the lock gave instead of the page, so the status checks know the Worker itself answered. */
export const LOCKED_HEADER = 'x-rebbehub-locked';

export interface LockEnv {
  /** The password, as a secret; wins over LOCK_KEY_HASH. */
  LOCK_PASSWORD?: string;
  /** The sha256 of the password's key (wrangler.toml [vars]). */
  LOCK_KEY_HASH?: string;
}

const encoder = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a password opens: the browser's cookie and the jobs' header carry this, never the password. */
export const keyOf = (password: string): Promise<string> => sha256(`rebbehub-lock:${password}`);

/** The hash a key must have, or null when nothing is locked (local work, tests). */
export async function lockOf(env: LockEnv): Promise<string | null> {
  if (env.LOCK_PASSWORD) return sha256(await keyOf(env.LOCK_PASSWORD));
  const hash = env.LOCK_KEY_HASH?.trim().toLowerCase();
  return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** The key a request carries: in the header (jobs, the site's own calls) or the cookie (a browser). */
export function keyFrom(request: Request): string | null {
  const header = request.headers.get(LOCK_HEADER)?.trim().toLowerCase();
  if (header) return header;
  const cookie = new RegExp(`(?:^|;\\s*)${LOCK_COOKIE}=([0-9a-f]{64})`).exec(request.headers.get('cookie') ?? '');
  return cookie?.[1] ?? null;
}

/** Whether `key` opens the lock, compared in constant time. */
export async function opens(key: string | null, lock: string): Promise<boolean> {
  if (!key || !/^[0-9a-f]{64}$/.test(key)) return false;
  const hash = await sha256(key);
  let diff = hash.length ^ lock.length;
  for (let i = 0; i < Math.min(hash.length, lock.length); i++) diff |= hash.charCodeAt(i) ^ lock.charCodeAt(i);
  return diff === 0;
}

/** The request's key, when it opens the lock. */
export async function openedBy(request: Request, lock: string): Promise<string | null> {
  const key = keyFrom(request);
  return (await opens(key, lock)) ? key : null;
}

/** The accounts named as owners, besides platform admins (`OWNER_ACCOUNTS`, comma separated). */
export const ownersFrom = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Requests that already showed the key at the Worker's door: the app does not ask who they are. */
export const unlocked = new WeakSet<Request>();
