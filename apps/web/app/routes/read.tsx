import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/read';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';
import { useLang } from '../lib/useLang.js';

/**
 * Reading a PDF in the site itself: a hanacha, a scan, the scan behind a
 * text. The pages are drawn by pdf.js with Sichos-Kodesh's own renderer
 * (reader/renderPdf.ts: lazy pages, memory kept low on phones, pinch zoom),
 * and the site's player keeps playing, so one can listen and read
 * together. As in Sichos-Kodesh's PDF screen, native pinch zoom is off
 * while reading, so a pinch zooms the page, not the whole site.
 *
 *   /read?src=<pdf address>&title=<name>&sub=<event · date>&page=<n>
 *
 * Only files RebbeHub serves, or the Sichos-Kodesh media proxy links to,
 * are opened here.
 */

const ALLOWED_HOSTS = ['sichos-kodesh-media-proxy.shmuky.workers.dev', 'api.rebbehub.org', 'files.rebbehub.org'];

function allowed(src: string, apiBase: string): boolean {
  try {
    const url = new URL(src);
    const own = new URL(apiBase);
    return (url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname)) || url.host === own.host;
  } catch {
    return false;
  }
}

export function loader({ request, context }: Route.LoaderArgs) {
  const { siteUrl, api } = siteOf(context);
  const url = new URL(request.url);
  const src = url.searchParams.get('src') ?? '';
  if (!allowed(src, api.baseUrl)) throw data('not found', { status: 404 });
  return {
    lang: langFrom(request),
    siteUrl,
    src,
    title: (url.searchParams.get('title') ?? '').slice(0, 200),
    sub: (url.searchParams.get('sub') ?? '').slice(0, 200),
    page: Math.max(1, Number(url.searchParams.get('page')) || 1),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.title || t(loaderData.lang, 'readScan'), path: '/read', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

/** An address that opens a PDF in the reader. */
export function readHref(doc: { url: string; title: string; sub?: string; page?: number }, lang: 'he' | 'en'): string {
  const q = new URLSearchParams({ src: doc.url, title: doc.title });
  if (doc.sub) q.set('sub', doc.sub);
  if (doc.page && doc.page > 1) q.set('page', String(doc.page));
  if (lang === 'en') q.set('lang', 'en');
  return `/read?${q}`;
}

type LoadState = { status: 'loading'; percent: number | null } | { status: 'ready' } | { status: 'error' };

export default function Read({ loaderData }: Route.ComponentProps) {
  const { src, title, sub, page } = loaderData;
  const lang = useLang();
  const navigate = useNavigate();
  const pages = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading', percent: null });
  const [zoomed, setZoomed] = useState(false);

  // A pinch zooms the page (reader/pdfPageZoom.ts), not the whole site: native pinch zoom is off while reading.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const original = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    return () => {
      if (original != null) meta?.setAttribute('content', original);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    setState({ status: 'loading', percent: null });
    setZoomed(false);
    (async () => {
      try {
        // pdf.js loads only here, in the browser, when something is read.
        const { loadPdfDocument, renderPdfPages } = await import('../reader/renderPdf.js');
        const loading = loadPdfDocument(src, ({ loaded, total }) => {
          if (!cancelled) setState({ status: 'loading', percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null });
        });
        task = loading;
        const doc = await loading.promise;
        if (cancelled || !pages.current) return;
        pages.current.innerHTML = '';
        await renderPdfPages(doc, pages.current, () => cancelled, (now) => !cancelled && setZoomed(now));
        if (cancelled) return;
        // The page asked for: every page's box has its final height by now.
        if (page > 1) pages.current.children[Math.min(page, doc.numPages) - 1]?.scrollIntoView({ block: 'start' });
        setState({ status: 'ready' });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [src, page]);

  return (
    <div className={zoomed ? 'pdf-viewer-screen zoomed' : 'pdf-viewer-screen'}>
      <header className="reader-head">
        <button type="button" className="link-button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          {lang === 'he' ? '→' : '←'} {t(lang, 'back')}
        </button>
        <h1>{title}</h1>
        {sub ? <p className="subtitle">{sub}</p> : null}
      </header>
      <div className="pdf-viewer-status">
        {state.status === 'loading' ? (
          <p className="subtitle pdf-loading">
            <Loader2 className="pdf-loading-spinner" size={16} aria-hidden="true" /> {t(lang, 'openingPdf')}
            {state.percent != null ? ` ${state.percent}%` : ''}
          </p>
        ) : null}
        {state.status === 'error' ? (
          <>
            <p>{t(lang, 'readerFailed')}</p>
            <a className="button" href={src} target="_blank" rel="noreferrer">
              {t(lang, 'openOriginal')}
            </a>
          </>
        ) : null}
      </div>
      <div ref={pages} className="pdf-pages" />
      {state.status === 'ready' ? (
        <p className="pdf-viewer-status row-sub">
          <a href={src} target="_blank" rel="noreferrer">
            {t(lang, 'openOriginal')}
          </a>{' '}
          · <Link to="/">RebbeHub</Link>
        </p>
      ) : null}
    </div>
  );
}
