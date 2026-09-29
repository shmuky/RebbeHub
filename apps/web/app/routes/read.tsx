import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/read';
import type { PageFixInfo, RebbeHubApi } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { accountPlaces, localPlace, recordPlace } from '../lib/places.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { PDF_COLORS, pdfCssFilter, resolvedColors, setPdfLook, usePdfLook, usePrefersDark, type PdfColors } from '../reader/look.js';
import { fixesByPage } from '../reader/pageFix.js';
import { Icon } from '../ui/Icon.js';
import { Bar, EmptyState, cx } from '../ui/primitives.js';
import '../styles/pages/reader.css';

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
 *
 * A scan RebbeHub has measured opens straightened (its page fix): its
 * reading copy when RebbeHub serves one, otherwise the file itself with its
 * leaning pages drawn turned level. "As scanned" shows it as it is.
 *
 * As in Sichos-Kodesh's reader, the pages can be shown dark (white on
 * black; by default when the device is in dark mode), on sepia or grey
 * paper, and with stronger contrast (reader/look.ts). And it reopens where
 * the reader stopped (lib/places.ts): in this browser, and on the account
 * of a signed-in reader, so the phone opens where the computer left off.
 */

const MEDIA_PROXY_HOST = 'sichos-kodesh-media-proxy.shmuky.workers.dev';
const ALLOWED_HOSTS = [MEDIA_PROXY_HOST, 'api.rebbehub.org', 'files.rebbehub.org'];

function allowed(src: string, apiBase: string): boolean {
  try {
    const url = new URL(src);
    const own = new URL(apiBase);
    return (url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname)) || url.host === own.host;
  } catch {
    return false;
  }
}

/** What a PDF on Drive (through the media proxy) needs to read straight; reading goes on without it if the API cannot say. */
async function pageFixFor(api: RebbeHubApi, src: string): Promise<{ readingCopy: string | null; pages: PageFixInfo['pages'] } | null> {
  const url = new URL(src);
  const id = /^\/drive\/([\w-]{10,})$/.exec(url.pathname)?.[1];
  if (url.hostname !== MEDIA_PROXY_HOST || !id) return null;
  try {
    const fix = await api.pageFix(id);
    if (fix?.verdict !== 'fixed') return null;
    if (fix.readingCopy && allowed(fix.readingCopy, api.baseUrl)) return { readingCopy: fix.readingCopy, pages: [] };
    return fixesByPage(fix.pages).size ? { readingCopy: null, pages: fix.pages } : null;
  } catch {
    return null;
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { siteUrl, api } = siteOf(context);
  const url = new URL(request.url);
  const src = url.searchParams.get('src') ?? '';
  if (!allowed(src, api.baseUrl)) throw data('not found', { status: 404 });
  return {
    fix: await pageFixFor(api, src),
    lang: langFrom(request),
    siteUrl,
    src,
    title: (url.searchParams.get('title') ?? '').slice(0, 200),
    sub: (url.searchParams.get('sub') ?? '').slice(0, 200),
    page: Math.max(1, Number(url.searchParams.get('page')) || 1),
    // A page named in the address (a citation) is opened there; otherwise where the reader stopped.
    pageAsked: Number(url.searchParams.get('page')) > 0,
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

type LoadState = { status: 'loading'; percent: number | null } | { status: 'ready'; pages: number } | { status: 'error' };

const WORDS = {
  pagesLook: { he: 'צבע הדפים', en: 'Page colours' },
  auto: { he: 'אוטומטי', en: 'Auto' },
  autoHint: { he: 'כהים כשהמכשיר במצב כהה', en: 'Dark when the device is' },
  original: { he: 'כפי שנסרקו', en: 'As scanned' },
  sepia: { he: 'ספיה', en: 'Sepia' },
  gray: { he: 'אפור', en: 'Grey' },
  dark: { he: 'כהים', en: 'Dark' },
  contrast: { he: 'ניגודיות', en: 'Contrast' },
  contrastHint: { he: 'ניגודיות חזקה, לסריקה דהויה', en: 'Stronger contrast, for a faint scan' },
  resumed: { he: 'נפתח בעמוד', en: 'Opened at page' },
  resumedTail: { he: ', היכן שהפסקתם.', en: ', where you stopped.' },
  fromStart: { he: 'מההתחלה', en: 'From the start' },
  page: { he: 'עמ׳', en: 'p.' },
  of: { he: 'מתוך', en: 'of' },
  toolbar: { he: 'כלי הקריאה', en: 'Reading tools' },
  original_file: { he: 'הקובץ', en: 'File' },
} as const;

/** The page at the top of the screen: the first whose foot is still below the reader's toolbar. */
function pageInView(container: HTMLElement): number {
  const pages = container.children;
  const edge = (document.querySelector('.reader-bar')?.getBoundingClientRect().bottom ?? 72) + 8;
  for (let i = 0; i < pages.length; i++) if (pages[i]!.getBoundingClientRect().bottom > edge) return i + 1;
  return pages.length || 1;
}

export default function Read({ loaderData }: Route.ComponentProps) {
  const { src, title, sub, page, pageAsked, fix } = loaderData;
  const lang = useLang();
  const account = useAccount();
  // Straightened unless the reader asks to see the scan as it is.
  const [straight, setStraight] = useState(true);
  const shown = fix?.readingCopy && straight ? fix.readingCopy : src;
  const fixes = useMemo(() => (fix && !fix.readingCopy && straight ? fixesByPage(fix.pages) : undefined), [fix, straight]);
  const navigate = useNavigate();
  const pages = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading', percent: null });
  const [zoomed, setZoomed] = useState(false);
  // The paper's colours (reader/look.ts), as Sichos-Kodesh's reader offers them.
  const look = usePdfLook();
  const colors = resolvedColors(look.colors, usePrefersDark());
  // Where the reader is, so drawing the pages again (straightened or not) keeps the place, and where it opened.
  const current = useRef<number | null>(pageAsked ? page : null);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  // The page at the top of the screen, for the toolbar's count.
  const [at, setAt] = useState(pageAsked ? page : 1);
  const moved = useRef(false);

  // A pinch zooms the page (reader/pdfPageZoom.ts), not the whole site: native pinch zoom is off while reading.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const original = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    return () => {
      if (original != null) meta?.setAttribute('content', original);
    };
  }, []);

  const goTo = (n: number) => {
    const box = pages.current?.children[n - 1];
    if (box) window.scrollTo(0, window.scrollY + box.getBoundingClientRect().top - (document.querySelector('.reader-bar')?.getBoundingClientRect().bottom ?? 0) - 12);
    current.current = n;
    setAt(n);
  };

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    setState({ status: 'loading', percent: null });
    setZoomed(false);
    (async () => {
      try {
        // pdf.js loads only here, in the browser, when something is read.
        const { loadPdfDocument, renderPdfPages } = await import('../reader/renderPdf.js');
        const loading = loadPdfDocument(shown, ({ loaded, total }) => {
          if (!cancelled) setState({ status: 'loading', percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null });
        });
        task = loading;
        const doc = await loading.promise;
        if (cancelled || !pages.current) return;
        pages.current.innerHTML = '';
        await renderPdfPages(doc, pages.current, () => cancelled, (now) => !cancelled && setZoomed(now), fixes);
        if (cancelled) return;
        // The page asked for, or the one being read before the pages were drawn again, or where this browser
        // stopped last time: every page's box has its final height by now.
        let at = current.current;
        if (at === null) {
          const saved = Number(localPlace('read', src)?.place.page);
          if (saved > 1 && saved <= doc.numPages) {
            at = saved;
            setResumedAt(saved);
          }
        }
        if (at && at > 1) goTo(Math.min(at, doc.numPages));
        setState({ status: 'ready', pages: doc.numPages });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goTo and src are steady for one document
  }, [shown, fixes]);

  // Signed in: where the account stopped (another device), when that is later than this browser's place and
  // the reader has not moved yet.
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready || !account || pageAsked) return;
    let live = true;
    void accountPlaces({ kind: 'read', key: src, limit: 1 }).then(([remote]) => {
      const local = localPlace('read', src);
      const saved = Number(remote?.place.page);
      if (!live || !remote || moved.current || (local && local.updatedAt >= remote.updatedAt) || !(saved > 1) || saved === current.current) return;
      goTo(saved);
      setResumedAt(saved);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, account, src, pageAsked]);

  // Where the reader is, kept as they read: in this browser, and on the account when signed in.
  const total = state.status === 'ready' ? state.pages : 0;
  useEffect(() => {
    if (!total || !pages.current) return;
    const container = pages.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const record = (flush: boolean) => {
      const at = pageInView(container);
      current.current = at;
      setAt(at);
      recordPlace({ kind: 'read', key: src, title: title || src, sub, href: readHref({ url: src, title, sub }, lang), place: { page: at, pages: total } }, { sync: Boolean(account), flush });
    };
    let frame = 0;
    const onScroll = () => {
      moved.current = true;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setAt(pageInView(container));
        });
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        record(false);
      }, 1000);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      if (moved.current) record(true);
    };
  }, [total, src, title, sub, lang, account]);

  const total_ = state.status === 'ready' ? state.pages : null;
  return (
    <div className={cx('pdf-viewer-screen', zoomed && 'zoomed', colors === 'dark' && 'pdf-dark')} style={{ '--pdf-filter': pdfCssFilter(colors, look.contrast) } as CSSProperties}>
      <header className="reader-bar">
        <div className="reader-bar-in">
          <button type="button" className="btn ghost icon" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} aria-label={t(lang, 'back')} title={t(lang, 'back')}>
            <Icon name="back" className="flip-ltr" />
          </button>
          <div className="reader-titles">
            <h1 className="reader-title">{title || t(lang, 'readScan')}</h1>
            {sub ? <p className="reader-sub">{sub}</p> : null}
          </div>
          <span className="reader-count" aria-live="polite">
            {total_ ? (
              <>
                {WORDS.page[lang]} <b>{at}</b> {WORDS.of[lang]} {total_}
              </>
            ) : null}
          </span>
          <a className="btn sm reader-file" href={src} target="_blank" rel="noreferrer" title={t(lang, 'openOriginal')}>
            <Icon name="external" size={14} />
            <span>{WORDS.original_file[lang]}</span>
          </a>
        </div>
        <div className="reader-tools" role="toolbar" aria-label={WORDS.toolbar[lang]}>
          <span className="reader-tools-label">{WORDS.pagesLook[lang]}</span>
          <div className="segmented reader-colors" role="group" aria-label={WORDS.pagesLook[lang]}>
            {PDF_COLORS.map((c) => (
              <button key={c} type="button" aria-pressed={look.colors === c} onClick={() => setPdfLook({ colors: c as PdfColors })} title={c === 'auto' ? WORDS.autoHint[lang] : undefined}>
                <i className={`paper ${c}`} aria-hidden="true" />
                {WORDS[c][lang]}
              </button>
            ))}
          </div>
          <button type="button" className="btn sm toggle" aria-pressed={look.contrast} onClick={() => setPdfLook({ contrast: !look.contrast })} title={WORDS.contrastHint[lang]}>
            <Icon name="sun" size={14} />
            {WORDS.contrast[lang]}
          </button>
          {fix ? (
            <button type="button" className="btn sm toggle reader-straighten" aria-pressed={!straight} onClick={() => setStraight(!straight)}>
              <Icon name="scan" size={14} />
              {t(lang, straight ? 'showAsScanned' : 'showStraightened')}
            </button>
          ) : null}
        </div>
      </header>
      {resumedAt && ready ? (
        <div className="reader-note">
          <p className="alert info reader-resumed" role="status">
            <Icon name="history" />
            <span>
              {WORDS.resumed[lang]} {resumedAt}
              {WORDS.resumedTail[lang]}{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  window.scrollTo(0, 0);
                  current.current = 1;
                  setAt(1);
                  setResumedAt(null);
                }}
              >
                {WORDS.fromStart[lang]}
              </button>
            </span>
          </p>
        </div>
      ) : null}
      <div className="pdf-viewer-status">
        {state.status === 'loading' ? (
          <div className="pdf-loading" role="status">
            <p>
              <Icon name="loader" className="spin" /> {t(lang, 'openingPdf')}
              {state.percent != null ? ` ${state.percent}%` : ''}
            </p>
            {state.percent != null ? <Bar value={state.percent} label={t(lang, 'openingPdf')} /> : null}
          </div>
        ) : null}
        {state.status === 'error' ? (
          <EmptyState
            icon="warn"
            title={t(lang, 'readerFailed')}
            actions={
              <a className="btn primary" href={src} target="_blank" rel="noreferrer">
                <Icon name="external" />
                {t(lang, 'openOriginal')}
              </a>
            }
          />
        ) : null}
      </div>
      <div ref={pages} className="pdf-pages" />
      {state.status === 'ready' ? (
        <p className="pdf-viewer-foot">
          <a href={src} target="_blank" rel="noreferrer">
            {t(lang, 'openOriginal')}
          </a>{' '}
          · <Link to="/">RebbeHub</Link>
        </p>
      ) : null}
    </div>
  );
}
