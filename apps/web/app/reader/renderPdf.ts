// Taken from Sichos-Kodesh (apps/web/src/pdf/renderPdf.ts), so both read PDFs the same way; keep them in step.
// RebbeHub's own addition: pages drawn through their page fixes (./pageFix.ts).
// The polyfill must run before pdf.js is touched (see polyfills.ts).
import './polyfills.js';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { canvasClip, canvasTransform, type Matrix, type PageFix } from './pageFix.js';
import { attachPdfZoom } from './pdfPageZoom.js';
import type { ZoomablePage } from './pdfPageZoom.js';
// Vite's `?url` import gives the worker script a fetchable URL in the
// built bundle; pdf.js requires its own worker thread even though it's
// only used from this one place.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdfjs-dist must stay >=6.2.108: versions >=5.6.83 and <6.2.108 have a
// high-severity advisory ("Arbitrary JavaScript execution upon opening a
// malicious PDF", GHSA-hq66-cqwq-w95j), which matters here since this app
// renders whatever PDF a Drive link points to. Even patched versions call
// `Map.prototype.getOrInsertComputed` internally with no fallback, and
// that method is missing on plenty of browsers still in use today, so
// downgrading within the patched range doesn't avoid the gap.
// `./polyfills.ts` (imported first, above) supplies it when missing.

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Served from public/pdf-wasm, public/pdf-cmaps, public/pdf-standard-fonts -
// copied there from node_modules/pdfjs-dist at dev/build time by
// vite.config.ts's copyPdfAssets, since pdf.js fetches each of these by a
// hardcoded filename appended to the base URL, not via a normal JS import.
const BASE_URL = import.meta.env.BASE_URL;

/**
 * Loads by URL (pdf.js does its own fetch) rather than this app awaiting a
 * full `response.arrayBuffer()` and handing pdf.js the complete bytes, so
 * pdf.js can start parsing as bytes stream in instead of waiting for the
 * whole file to download.
 *
 * `disableRange: true` is deliberate, and has a different reason now than
 * it used to. services/media-proxy's `/drive/:fileId` route genuinely
 * supports Range today (it forwards a client's Range header to Drive's own
 * file-serving endpoint, which really honors it - confirmed directly: a
 * ranged request comes back 206 with the correct slice and Content-Range,
 * and a plain request correctly declares `Accept-Ranges: bytes`, matching
 * every requirement pdf.js's own range-capability check looks for). But
 * turning range mode on here (`disableRange` unset) reproducibly hangs
 * pdf.js's document-loading promise forever once it decides range is
 * available - confirmed with direct browser-context fetches replaying the
 * exact same plain-then-ranged request sequence pdf.js would make, which
 * complete correctly outside of pdf.js, so the network/CORS/Worker side is
 * not at fault. The hang is inside pdf.js's own chunked-stream/worker
 * message-passing pipeline in this app's bundling setup and wasn't
 * root-caused before deciding to ship the (real, verified) Worker fix
 * without flipping this flag - a load that always finishes beats one that
 * might load faster but can also hang indefinitely. Revisit once that's
 * understood, ideally testing against the real deployed Worker rather than
 * local `wrangler dev`, which uses a different (Miniflare) runtime than
 * Cloudflare's actual edge.
 *
 * Returns the loading task itself, not just its resolved document -
 * `PDFDocumentProxy` (what `task.promise` resolves to) has no `destroy()`
 * of its own, only the lighter-weight `cleanup()`; only the loading task
 * can actually tear down the document's worker transport once the caller's
 * done with it (see PdfViewerScreen's unmount cleanup), so callers need to
 * hold onto it rather than just awaiting `.promise` and discarding it.
 */
export function loadPdfDocument(url: string, onProgress?: (p: { loaded: number; total: number }) => void): PDFDocumentLoadingTask {
  const task = pdfjsLib.getDocument({
    url,
    // The API's files open only with the site's cookie while RebbeHub is private (services/api/src/lock.ts).
    withCredentials: /^https:\/\/api\.rebbehub\.org\//.test(url),
    disableRange: true,
    wasmUrl: `${BASE_URL}pdf-wasm/`,
    cMapUrl: `${BASE_URL}pdf-cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE_URL}pdf-standard-fonts/`,
  });
  if (onProgress) task.onProgress = onProgress;
  return task;
}

// Device pixel ratios run past 3 on plenty of Android phones. Each
// canvas's backing-store memory scales with the *square* of this factor
// (width x height x 4 bytes/pixel), so left uncapped, a multi-page
// document's canvases can add up to hundreds of MB and crash a mobile
// browser tab, not just slow it down. 2x already reads sharp, so capping
// here trades a marginal sharpness gain for staying within memory budget.
const MAX_DPR = 2;

/**
 * A pinch-zoomed page's total resolution multiplier over its fit-width
 * scale, once the gesture settles - reasonable even though every
 * currently-rendered page gets boosted together (see pdfPageZoom.ts's
 * whole-document zoom), since only a handful of pages are ever resident
 * at once (the lazy-render/release cycle below keeps it that way
 * regardless of zoom level).
 */
const MAX_BOOST_MULTIPLIER = 4;

/**
 * A fast scroll fires many IntersectionObserver callbacks in quick
 * succession, each wanting to render a page that another callback,
 * milliseconds later, wants released again before the first render even
 * finishes. Delaying a *render* by this long (releases stay immediate, so
 * memory is freed right away either way) means a page that's only
 * fleetingly scrolled past is usually released again before its render
 * was ever scheduled, instead of every fleeting pass kicking off its own
 * doc.getPage()/page.render() call.
 */
const RENDER_DEBOUNCE_MS = 120;

/**
 * A page's very first render, relative to its normal fit-width `cssScale`
 * (1x, no device-pixel-ratio multiplier at all) - deliberately small and
 * cheap rather than the real `dpr`/zoom-scaled render, since a fast,
 * continuous scroll can still settle on several pages long enough to clear
 * `RENDER_DEBOUNCE_MS` above one after another; a full-resolution canvas
 * for each of those (most of which get scrolled past again a moment later
 * anyway) is exactly the memory pressure that crashes the tab. A page
 * still on screen after `QUALITY_UPGRADE_DELAY_MS` gets re-rendered at the
 * real resolution - see `scheduleQualityUpgrade`.
 */
const LOW_QUALITY_SCALE_FACTOR = 0.4;

/** How long a page has to stay actually on screen (not just past the initial render debounce) before it's worth spending its full-resolution render - see `LOW_QUALITY_SCALE_FACTOR`. */
const QUALITY_UPGRADE_DELAY_MS = 500;

interface PageEntry extends ZoomablePage {
  cssScale: number;
}

/**
 * Renders a PDF's pages lazily, one canvas per page, as they scroll near
 * the viewport - not all of them upfront. A page far off-screen has its
 * canvas released back to a same-sized placeholder (freeing its backing
 * -store memory) rather than staying resident forever; scrolling back to
 * it re-renders on demand. This, together with the `MAX_DPR` cap above,
 * is what keeps a multi-page document from exhausting memory on a mobile
 * tab: rendering every page unconditionally keeps every canvas alive for
 * the life of the screen.
 *
 * Also wires up `pdfPageZoom.ts`'s whole-document pinch-zoom: every
 * currently-rendered page re-renders at up to `MAX_BOOST_MULTIPLIER` its
 * fit-width resolution once a pinch settles (real sharpness, not a
 * stretched fit-width bitmap), together, so scrolling through a zoomed
 * document doesn't snap back to an unzoomed page the moment it scrolls
 * into view. Pinching back down to 1x drops every rendered page back to
 * the standard fit-width render the same way.
 *
 * Resolves once the first page's low-quality render has committed (see
 * `LOW_QUALITY_SCALE_FACTOR`, so the screen has content to show as fast as
 * possible), not once every page has, and not even once the first page's
 * full-quality upgrade has - the rest render as the user scrolls or stays
 * put. `isCancelled` doubles as the teardown signal: once it returns true
 * the IntersectionObserver disconnects itself on its next callback, so
 * callers don't need to hold a separate handle to it.
 *
 * Every render is tagged with a per-page generation number that `release`
 * bumps. A page's render is asynchronous (`doc.getPage()` +
 * `page.render()`), so the same page can scroll back off-screen and get
 * released while its render is still in flight; without the generation
 * guard, that stale render would finish and re-attach its canvas to a
 * wrapper meant to stay empty, and repeated fast scrolling could pile up
 * canvases faster than the browser reclaims their memory. A render only
 * ever commits its canvas if its generation is still the current one for
 * that page - the same guard is what makes the low-quality-then-upgrade
 * sequence safe too, since a page released between its two renders simply
 * never gets the (now-stale) upgrade committed.
 *
 * The generation counter alone stops a stale render from ever being
 * *committed*, but not from *running* - pdf.js keeps decoding content
 * streams and filling the canvas bitmap for as long as its own
 * `RenderTask` is left alive, generation check or not, and that work costs
 * real CPU and memory the whole time. Fast reversing scroll (down-up-down)
 * can start many renders in quick succession while few of them get the
 * chance to finish, leaving several genuinely in flight and consuming
 * memory at once. `release` below also calls `RenderTask.cancel()` on
 * whatever's still running for that page, so an abandoned render actually
 * stops instead of just being ignored.
 *
 * `onZoomChange`, when given, fires `true` once a pinch settles and
 * `false` once the document is back to 1x - PdfViewerScreen uses it to
 * drop the screen's own side padding and width cap while zoomed, so
 * panning around a zoomed page has the full screen to work with instead of
 * the normal reading-width column.
 */
export async function renderPdfPages(
  doc: PDFDocumentProxy,
  container: HTMLElement,
  isCancelled: () => boolean,
  onZoomChange?: (zoomed: boolean) => void,
  /** Pages to draw through their page fix (turned level, or placed and cut as a reading copy), by page number. */
  fixes?: ReadonlyMap<number, PageFix>,
): Promise<void> {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const containerWidth = container.clientWidth || 400;

  const pages: PageEntry[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    if (isCancelled()) return;
    const page = await doc.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const cssScale = containerWidth / unscaledViewport.width;
    const fitViewport = page.getViewport({ scale: cssScale * dpr });

    // Sized up front (before any canvas exists) so the container's total
    // scroll height is correct immediately - pages rendering in later
    // doesn't shift the ones already on screen.
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page';
    const baseWidth = containerWidth;
    const baseHeight = fitViewport.height / dpr;
    wrapper.style.width = `${baseWidth}px`;
    wrapper.style.height = `${baseHeight}px`;
    container.appendChild(wrapper);
    pages.push({ wrapper, baseWidth, baseHeight, cssScale });
  }

  const renderGeneration: number[] = pages.map(() => 0);
  const pendingRenderTimers: Array<ReturnType<typeof setTimeout> | null> = pages.map(() => null);
  const pendingUpgradeTimers: Array<ReturnType<typeof setTimeout> | null> = pages.map(() => null);
  /** Whatever pdf.js `RenderTask` is actually running for a page right now, if any - see `release`'s own comment above for why this needs to exist alongside the generation counter, not instead of it. */
  const activeRenderTasks: Array<RenderTask | null> = pages.map(() => null);
  // The current effective resolution multiplier over each page's fit-width
  // `cssScale` - `dpr` at rest, boosted (up to `MAX_BOOST_MULTIPLIER`)
  // while the document is pinch-zoomed, so a page that scrolls into view
  // *while* still zoomed renders sharp immediately instead of fit-width
  // and then needing a second re-render.
  let currentRenderScale = dpr;

  async function renderCanvasAtScale(index: number, scale: number, generation: number): Promise<void> {
    const entry = pages[index];
    if (!entry || isCancelled() || renderGeneration[index] !== generation) return;
    const page = await doc.getPage(index + 1);
    if (isCancelled() || renderGeneration[index] !== generation) return;

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const fix = fixes?.get(index + 1);
    const viewportMatrix = viewport.transform as Matrix;
    const renderTask = page.render({ canvas, viewport, ...(fix ? { transform: canvasTransform(viewportMatrix, fix.transform as Matrix) } : {}) });
    activeRenderTasks[index] = renderTask;
    try {
      await renderTask.promise;
    } catch {
      return; // Cancelled (by `release`, below, or pdf.js itself superseding this render) or failed - nothing to commit.
    } finally {
      // Only clear this page's slot if it's still *this* task's - a newer
      // render for the same page (e.g. the quality upgrade, or a fresh
      // renderInto after a re-render/re-release cycle) may already have
      // installed its own task there by the time this one's promise
      // settles, and that one is still genuinely running.
      if (activeRenderTasks[index] === renderTask) activeRenderTasks[index] = null;
    }
    if (isCancelled() || renderGeneration[index] !== generation) return;
    if (fix?.clip) paintOutside(ctx, canvasClip(viewportMatrix, fix.clip), canvas.width, canvas.height);
    entry.wrapper.replaceChildren(canvas);
  }

  /** Schedules the upgrade to `currentRenderScale` once a page's cheap low-quality render has committed - a no-op if the page gets released (scrolled away) again before the delay elapses, since `release` bumps `renderGeneration` and this checks it before ever calling `renderCanvasAtScale`. */
  function scheduleQualityUpgrade(index: number, generation: number): void {
    if (isCancelled() || renderGeneration[index] !== generation) return;
    pendingUpgradeTimers[index] = setTimeout(() => {
      pendingUpgradeTimers[index] = null;
      if (isCancelled() || renderGeneration[index] !== generation) return;
      const entry = pages[index];
      if (!entry) return;
      void renderCanvasAtScale(index, entry.cssScale * currentRenderScale, generation);
    }, QUALITY_UPGRADE_DELAY_MS);
  }

  function renderInto(index: number): Promise<void> {
    const entry = pages[index];
    if (!entry || isCancelled() || entry.wrapper.firstChild) return Promise.resolve();
    const generation = ++renderGeneration[index]!;
    return renderCanvasAtScale(index, entry.cssScale * LOW_QUALITY_SCALE_FACTOR, generation).then(() => scheduleQualityUpgrade(index, generation));
  }

  function release(index: number): void {
    const timer = pendingRenderTimers[index];
    if (timer != null) {
      clearTimeout(timer);
      pendingRenderTimers[index] = null;
    }
    const upgradeTimer = pendingUpgradeTimers[index];
    if (upgradeTimer != null) {
      clearTimeout(upgradeTimer);
      pendingUpgradeTimers[index] = null;
    }
    // Stops the actual in-progress decode/paint work, not just its
    // eventual result from being committed (see this function's own doc
    // comment above) - `cancel()` rejects the task's own `.promise`, which
    // `renderCanvasAtScale`'s catch block already handles as a no-op.
    const activeTask = activeRenderTasks[index];
    if (activeTask) {
      activeTask.cancel();
      activeRenderTasks[index] = null;
    }
    renderGeneration[index]!++;
    const entry = pages[index];
    if (entry) {
      // Zeroing the canvas's own dimensions before detaching it, not just
      // `replaceChildren()` alone - removing a <canvas> from the DOM
      // doesn't force the browser to free its (potentially large,
      // DPR-squared-sized) backing-store bitmap immediately, only once GC
      // gets around to it. Under fast repeated scrolling, many pages get
      // released in quick succession, so if GC lags even briefly behind
      // that, several full-size canvases' worth of memory can pile up at
      // once, on top of what the generation-based render cancellation
      // above already prevents.
      const canvas = entry.wrapper.querySelector('canvas');
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      entry.wrapper.replaceChildren();
      zoom.resizeOffscreenPage(entry);
    }
    // Zeroing this app's own canvas above only frees *its* backing-store
    // bitmap - pdf.js keeps its own page-level cache of decoded resources
    // (fonts, images, operator lists) bound to whatever was actually
    // rendered for this page, alive independently until told to clean it
    // up, which nothing here ever did. Over a long fast-scrolling session
    // through a huge/image-heavy document, that cache accumulates across
    // every page ever rendered - never shrinking even though every one of
    // those pages' own canvases are already empty - and can eventually
    // exhaust the tab's memory on its own (a real, distinct cause from the
    // canvas-backing-store growth the comment above already guards
    // against). `doc.getPage` is a cheap cache lookup once a page's
    // already been fetched once (not a re-parse - every page was fetched
    // up front, above), and `cleanup()` is pdf.js's own safe, standard way
    // to evict a page's resources without destroying the page object
    // itself (the same thing pdf.js's own reference viewer does for pages
    // scrolled out of its render buffer) - a no-op if nothing was actually
    // rendered for this page, or if pdf.js judges it unsafe to clean up
    // right now (e.g. a cancellation still settling).
    void doc
      .getPage(index + 1)
      .then((page) => page.cleanup())
      .catch(() => {});
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (isCancelled()) {
        observer.disconnect();
        return;
      }
      for (const entry of entries) {
        const index = pages.findIndex((p) => p.wrapper === entry.target);
        if (index === -1) continue;
        if (entry.isIntersecting) {
          if (pendingRenderTimers[index] != null) continue;
          pendingRenderTimers[index] = setTimeout(() => {
            pendingRenderTimers[index] = null;
            void renderInto(index);
          }, RENDER_DEBOUNCE_MS);
        } else {
          release(index);
        }
      }
    },
    // Keeps roughly a screen's worth of pages rendered ahead/behind the
    // visible area, so scrolling doesn't visibly outrun rendering.
    { rootMargin: '100% 0px' },
  );

  /** Every page whose wrapper currently has a canvas resident - the only ones worth re-rendering when the zoom level changes; an off-screen page with no canvas will simply render at `currentRenderScale` whenever it's next scrolled into view. */
  function renderedIndexes(): number[] {
    return pages.reduce<number[]>((acc, entry, index) => {
      if (entry.wrapper.firstChild) acc.push(index);
      return acc;
    }, []);
  }

  const zoom = attachPdfZoom(container, pages, {
    onSettle: (pinchScale) => {
      currentRenderScale = Math.min(dpr * pinchScale, MAX_BOOST_MULTIPLIER);
      for (const index of renderedIndexes()) {
        const entry = pages[index]!;
        const generation = ++renderGeneration[index]!;
        void renderCanvasAtScale(index, entry.cssScale * currentRenderScale, generation);
      }
      onZoomChange?.(true);
    },
    onReset: () => {
      currentRenderScale = dpr;
      for (const index of renderedIndexes()) {
        const entry = pages[index]!;
        const generation = ++renderGeneration[index]!;
        void renderCanvasAtScale(index, entry.cssScale * currentRenderScale, generation);
      }
      onZoomChange?.(false);
    },
  });

  pages.forEach(({ wrapper }) => observer.observe(wrapper));

  await renderInto(0);
}

/** Paints the page's white over everything outside `[x, y, width, height]`: the cut of a reading copy's placing. */
function paintOutside(ctx: CanvasRenderingContext2D, [x, y, w, h]: [number, number, number, number], width: number, height: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, Math.max(0, y));
  ctx.fillRect(0, y + h, width, Math.max(0, height - y - h));
  ctx.fillRect(0, y, Math.max(0, x), h);
  ctx.fillRect(x + w, y, Math.max(0, width - x - w), h);
  ctx.restore();
}
