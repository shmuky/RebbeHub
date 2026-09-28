import { useEffect } from 'react';

/**
 * The site as an installable app (the plan, section 10: "PWA"): the web
 * app manifest (public/manifest.webmanifest) says how it installs, and the
 * service worker (public/sw.js) keeps the app's files and the pages read,
 * so it opens without a connection. Registered once the page has loaded,
 * so it never slows the first page down; not in development, where Vite
 * serves files that change on every save.
 */
export function useServiceWorker(on: boolean): void {
  useEffect(() => {
    if (!on || !import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, [on]);
}
