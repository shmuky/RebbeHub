import { LOCK_COOKIE, LOCKED_HEADER, keyOf, lockOf, openedBy, opens, type LockEnv } from '@rebbehub/api';

/**
 * The site's door while RebbeHub is private (services/api/src/lock.ts):
 * without the key, every address answers the lock page, which asks for the
 * password once and keeps its key in a cookie for a year. The cookie is on
 * rebbehub.org and its subdomains, so the API's files (scans, recordings,
 * PDFs) open for the same browser.
 *
 * Phones that installed the site as an app hold its pages in their service
 * worker; the lock answers them a service worker that throws those copies
 * away and leaves.
 */

interface RateLimit {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface DoorEnv extends LockEnv {
  SITE_URL: string;
  /** Password tries an address may make a minute (wrangler.toml). */
  RATE_LIMIT_LOCK?: RateLimit;
}

const NOT_KEPT = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', [LOCKED_HEADER]: '1' };

/** A service worker that drops every copy the old one kept, unregisters itself and reloads its pages. */
const FORGET = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) await caches.delete(name);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`;

const escape = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function lockPage(next: string, wrong: boolean, status = 401): Response {
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>RebbeHub</title>
<style>
:root{color-scheme:light dark;--bg:#faf8f4;--fg:#1d1b18;--muted:#6b665e;--line:#d8d2c7;--accent:#1f4e79}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece8e1;--muted:#a39d93;--line:#3a3732;--accent:#8db7e0}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
form{width:100%;max-width:320px;display:grid;gap:12px}
h1{font-size:22px;margin:0}p{margin:0;color:var(--muted)}
input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit}
button{background:var(--accent);border-color:var(--accent);color:var(--bg);cursor:pointer}
.wrong{color:#b3261e}
</style></head><body>
<form method="post" action="/_/lock">
<h1>RebbeHub</h1><p>Private for now.</p>
${wrong ? '<p class="wrong">That password is not right.</p>' : ''}
<input type="hidden" name="next" value="${escape(next)}">
<input type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus>
<button type="submit">Open</button>
</form></body></html>`;
  return new Response(html, { status, headers: { ...NOT_KEPT, 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Only a path on this site, never somewhere else. */
const safeNext = (value: unknown) => (typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/');

/** The cookie's domain: the site's, so its subdomains (the API) see it too; none on another host (workers.dev). */
function cookieFor(key: string, request: Request, siteUrl: string): string {
  const host = new URL(request.url).hostname;
  const site = new URL(siteUrl).hostname;
  const domain = host === site || host.endsWith(`.${site}`) ? `; Domain=${site}` : '';
  return `${LOCK_COOKIE}=${key}${domain}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`;
}

/**
 * What the door answers, or null when the request may go in. `opened` gets the
 * key, for the site's own questions to the API.
 */
export async function door(request: Request, env: DoorEnv, opened: (key: string) => void): Promise<Response | null> {
  const lock = await lockOf(env);
  if (!lock) return null;
  const url = new URL(request.url);
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { ...NOT_KEPT, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (url.pathname === '/_/lock' && request.method === 'POST') {
    const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const form = await request.formData().catch(() => null);
    const next = safeNext(form?.get('next'));
    if (env.RATE_LIMIT_LOCK && !(await env.RATE_LIMIT_LOCK.limit({ key: address })).success) {
      return new Response('Too many tries; wait a minute.', { status: 429, headers: { ...NOT_KEPT, 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const password = form?.get('password');
    const key = typeof password === 'string' && password ? await keyOf(password.trim()) : null;
    const right = key && (await opens(key, lock)) ? key : null;
    if (!right) return lockPage(next, true);
    return new Response(null, { status: 303, headers: { ...NOT_KEPT, Location: next, 'Set-Cookie': cookieFor(right, request, env.SITE_URL) } });
  }
  const key = await openedBy(request, lock);
  if (key) {
    opened(key);
    return null;
  }
  if (url.pathname === '/sw.js') return new Response(FORGET, { headers: { ...NOT_KEPT, 'Content-Type': 'text/javascript; charset=utf-8' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('RebbeHub is private for now.', { status: 401, headers: { ...NOT_KEPT, 'Content-Type': 'text/plain; charset=utf-8' } });
  return lockPage(`${url.pathname}${url.search}`, false);
}

/** Whatever the door let in says it is not for search engines or shared caches. */
export function privately(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  const said = out.headers.get('Cache-Control') ?? '';
  if (/\bpublic\b/.test(said)) out.headers.set('Cache-Control', said.replace(/\bpublic\b/, 'private').replace(/,?\s*s-maxage=\d+/, ''));
  return out;
}
