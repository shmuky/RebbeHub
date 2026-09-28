/*
 * RebbeHub's service worker: the site installs as an app (the plan,
 * section 10: "PWA") and opens without a connection.
 *
 * - The app's own files (/assets/*, named by their content) are kept for
 *   good once fetched; the reader's pdf.js files, icons and fonts are kept
 *   and refreshed in the background.
 * - Pages (and the data React Router fetches for them) come from the
 *   network first; each page opened is kept, so a page read once opens
 *   again offline. With neither, the offline page says so.
 * - Nothing personal is kept: /_/ (sign-in, suggestions, places) and
 *   every other site (the API, scans, recordings) pass straight through.
 *
 * Change VERSION when this file's rules change; old caches are dropped.
 */
const VERSION = 'v1';
const SHELL = `rebbehub-shell-${VERSION}`;
const PAGES = `rebbehub-pages-${VERSION}`;
const MAX_PAGES = 80;
const PRECACHE = ['/offline.html', '/favicon.svg', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(PRECACHE);
      // The home page too, when it can be had; the site works without it.
      await caches
        .open(PAGES)
        .then((pages) => pages.add('/'))
        .catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith('rebbehub-') && name !== SHELL && name !== PAGES) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function networkFirst(request, fallback) {
  const pages = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await pages.put(request, response.clone());
      void trim(pages, MAX_PAGES);
    }
    return response;
  } catch (error) {
    const kept = await pages.match(request, { ignoreVary: true });
    if (kept) return kept;
    if (fallback) {
      const offline = await caches.match(fallback);
      if (offline) return offline;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const shell = await caches.open(SHELL);
  const kept = await shell.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') await shell.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const shell = await caches.open(SHELL);
  const kept = await shell.match(request);
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await shell.put(request, response.clone());
    return response;
  });
  if (kept) {
    event.waitUntil(fresh.catch(() => undefined));
    return kept;
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Personal answers and passed-through calls are never kept.
  if (url.pathname.startsWith('/_/') || url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/offline.html'));
  } else if (url.pathname.endsWith('.data')) {
    // What React Router fetches when moving between pages in the app.
    event.respondWith(networkFirst(request, null));
  } else if (/^\/(pdf-|icon-|favicon|apple-touch-icon|manifest\.webmanifest)/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
