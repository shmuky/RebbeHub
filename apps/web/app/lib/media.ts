/**
 * Recordings the catalog links through Sichos-Kodesh's media proxy (JEM's
 * audio) are played through the site itself while RebbeHub is private: the
 * proxy has no public address of its own any more, and the site's Worker
 * reaches it by a service binding, behind the lock (server/worker.ts).
 */
const MEDIA_PROXY = 'sichos-kodesh-media-proxy.shmuky.workers.dev';

export function playable(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname === MEDIA_PROXY ? `/_/media${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}
