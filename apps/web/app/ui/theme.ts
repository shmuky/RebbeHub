import { useSyncExternalStore } from 'react';

/**
 * Light, dark, or as the device is: the reader's choice, kept in this
 * browser and set on <html data-theme> before the page is drawn (the
 * script below runs in <head>), so a dark page never flashes white. The
 * same for the face the words of the Torah are set in.
 */

export type Theme = 'light' | 'dark' | 'auto';
export type TextFont = 'frank' | 'david' | 'noto';

const THEME_KEY = 'rebbehub.theme';
const FONT_KEY = 'rebbehub.text-font';

/** Runs in <head> before anything is drawn. Kept tiny and free of imports. */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);var f=localStorage.getItem('${FONT_KEY}');if(f==='david'||f==='noto')d.setAttribute('data-text-font',f)}catch(e){}})();`;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A private window: the choice holds for this visit.
  }
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  write(THEME_KEY, theme === 'auto' ? null : theme);
  notify();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => {
      const t = read(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'auto';
    },
    () => 'auto',
  );
}

export function setTextFont(font: TextFont): void {
  const root = document.documentElement;
  if (font === 'frank') root.removeAttribute('data-text-font');
  else root.setAttribute('data-text-font', font);
  write(FONT_KEY, font === 'frank' ? null : font);
  notify();
}

export function useTextFont(): TextFont {
  return useSyncExternalStore(
    subscribe,
    () => {
      const f = read(FONT_KEY);
      return f === 'david' || f === 'noto' ? f : 'frank';
    },
    () => 'frank',
  );
}
