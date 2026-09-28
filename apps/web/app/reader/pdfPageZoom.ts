// Taken from Sichos-Kodesh (apps/web/src/pdf/pdfPageZoom.ts), with renderPdf.ts; keep them in step.
/** Pinch-zoom cap for the whole document - matches how far real PDF viewers let you zoom in on the fine print. */
const MAX_PINCH_SCALE = 3;

/** A one-finger drag needs to move at least this many px before it counts as a deliberate pan - otherwise the inevitable few px of jitter at the start of every touch would shift the page. */
const DRAG_THRESHOLD_PX = 8;

export interface ZoomablePage {
  wrapper: HTMLDivElement;
  baseWidth: number;
  baseHeight: number;
}

export interface PdfZoomHandle {
  /**
   * A page just scrolled far enough off-screen for the caller's own
   * IntersectionObserver to release its canvas - resize its wrapper back
   * to the *current* zoom level (not necessarily 1x - the rest of the
   * document may still be zoomed) so its layout stays consistent with
   * every other page while it's empty; the caller's own lazy-render path
   * re-renders its canvas at the current resolution next time it scrolls
   * back into view.
   */
  resizeOffscreenPage: (page: ZoomablePage) => void;
}

interface ZoomCallbacks {
  /** The pinch just ended at `scale` (>1) - re-render every currently-rendered page's canvas at that resolution for real sharpness instead of a stretched-out fit-width bitmap. */
  onSettle: (scale: number) => void;
  /** The document is back to 1x (pinched back down) - re-render every currently-rendered page's canvas back at the normal fit-width resolution right away. */
  onReset: () => void;
}

interface Anchor {
  pageIndex: number;
  /** Where within that page's box the anchor sits, as a 0-1 fraction of its current width/height - recomputed against each page's live size, so it stays correct as the page grows during the gesture. */
  fx: number;
  fy: number;
}

/**
 * Lets a user pinch-zoom the whole document in place, instead of the
 * browser's native pinch gesture zooming the entire visual viewport
 * (header, back button, everything). PdfViewerScreen disables native
 * pinch-zoom (via the viewport meta tag) while it's mounted, so a
 * two-finger gesture here only ever reaches this code, never the
 * browser's own zoom.
 *
 * Zoom applies to every page together, not just the one under your
 * fingers: one shared scale/pan state, applied to every page's wrapper on
 * every frame of the gesture, keeps the whole document zoomed together as
 * you scroll through it, the way an actual PDF reader behaves - otherwise
 * scrolling while zoomed in would snap back to a different, unzoomed page
 * the moment it scrolled into view.
 *
 * Growing a page's box in place (its own layout width/height, not a CSS
 * `transform: scale()`) shifts everything below it in the document and has
 * no anchor of its own, so left alone it reads as the page jumping around
 * under your fingers rather than zooming into the spot you pinched. To
 * counter that, a pinch records which page (and where within it) sits at
 * the two touches' midpoint when the gesture starts, then after every
 * resize, scrolls and pans by whatever it takes to put that same point
 * back under the touches' current midpoint - the same anchoring a native
 * pinch-zoom gesture gives you for free via `transform-origin`, done by
 * hand here since the live zoom works by resizing boxes, not transforming
 * them.
 *
 * Ending a pinch hands the new scale to `onSettle` so the caller can
 * re-render every currently-visible page's canvas at real resolution
 * instead of a stretched fit-width bitmap; pinching back down to 1x calls
 * `onReset` to drop them back to the standard fit-width render. Pages
 * that are off-screen (no canvas resident right now) aren't touched by
 * either - `resizeOffscreenPage` just keeps their empty wrapper sized to
 * the current zoom level so scrolling past them doesn't visually jump,
 * and the caller's own lazy-render path renders them at whatever the
 * current zoom happens to be once they're actually scrolled into view.
 *
 * A one-finger drag pans freely once zoomed (any direction, not locked to
 * one axis) - horizontal movement adjusts `panX` (a CSS transform, since
 * the document's own horizontal scroll is disabled so a zoomed page can't
 * drag the header/back-link off-screen with it), vertical movement drives
 * `window.scrollBy` directly (the document really is taller once zoomed,
 * so real scroll is what actually reveals the rest of it). While unzoomed,
 * this code never touches a one-finger touch at all, so normal vertical
 * scrolling (`touch-action: pan-y`, index.css) is untouched.
 */
export function attachPdfZoom(container: HTMLElement, pages: ZoomablePage[], callbacks: ZoomCallbacks): PdfZoomHandle {
  let scale = 1;
  let panX = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchAnchor: Anchor | null = null;
  let dragLast: { x: number; y: number } | null = null;
  let dragEngaged = false;
  // A touchscreen can deliver pointermove events faster than the display
  // repaints, and each one used to do a full pass over every page's DOM
  // node (`applyLiveStyle`) plus a native `window.scrollBy` (which itself
  // fires the caller's IntersectionObserver, cascading into pdf.js
  // render/cancel calls) - real, uncapped work per raw input event, not
  // per frame. Coalescing to one pass per animation frame keeps the same
  // visual result (still updates every frame the display can actually
  // show) while capping how often that cascade can fire during a fast
  // real-world gesture.
  let pendingFrame = false;

  function containerWidth(): number {
    return pages[0]?.baseWidth ?? (container.clientWidth || 400);
  }

  function clampPanX(nextScale: number, nextPanX: number): number {
    const overflow = Math.max(0, (containerWidth() * nextScale - containerWidth()) / 2);
    return Math.max(-overflow, Math.min(overflow, nextPanX));
  }

  function styleFor(page: ZoomablePage): void {
    page.wrapper.style.width = `${page.baseWidth * scale}px`;
    page.wrapper.style.height = `${page.baseHeight * scale}px`;
    page.wrapper.style.transform = panX ? `translateX(${panX}px)` : '';
  }

  function applyLiveStyle(): void {
    pages.forEach(styleFor);
  }

  /** Which page (and where within it) currently sits at viewport point `(x, y)`, if any - the basis for anchoring a pinch to the spot the user actually touched. */
  function findAnchor(x: number, y: number): Anchor | null {
    for (let i = 0; i < pages.length; i++) {
      const rect = pages[i]!.wrapper.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        return { pageIndex: i, fx: rect.width > 0 ? (x - rect.left) / rect.width : 0.5, fy: rect.height > 0 ? (y - rect.top) / rect.height : 0.5 };
      }
    }
    return null;
  }

  /** Where `anchor`'s recorded spot is on screen right now - compared against the touches' current midpoint to know how far the page needs to scroll/pan to put it back there. */
  function anchorClientPos(anchor: Anchor): { x: number; y: number } | null {
    const page = pages[anchor.pageIndex];
    if (!page) return null;
    const rect = page.wrapper.getBoundingClientRect();
    return { x: rect.left + anchor.fx * rect.width, y: rect.top + anchor.fy * rect.height };
  }

  function endGesture(): void {
    if (pointers.size > 0) return;
    dragLast = null;
    dragEngaged = false;
    pinchAnchor = null;
    if (scale <= 1.02) {
      scale = 1;
      panX = 0;
      applyLiveStyle();
      callbacks.onReset();
      return;
    }
    callbacks.onSettle(scale);
  }

  container.addEventListener('pointerdown', (e) => {
    // setPointerCapture can throw if the pointerId isn't currently active;
    // catching it keeps the rest of this handler running instead of
    // aborting pointer tracking entirely.
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort only - tracking still proceeds without capture.
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      pinchStartScale = scale;
      pinchAnchor = findAnchor((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      dragLast = null;
    } else if (pointers.size === 1 && scale > 1) {
      const [p] = [...pointers.values()];
      dragLast = { x: p!.x, y: p!.y };
      dragEngaged = false;
    }
  });

  /** Runs at most once per animation frame - reads whatever the *latest* pointer positions are at that point, not the ones from whichever raw event happened to schedule it, so several pointermove events arriving in the same frame collapse into one update instead of one each. */
  function applyPendingFrame(): void {
    pendingFrame = false;

    if (pointers.size === 2 && pinchStartDist > 0) {
      const [a, b] = [...pointers.values()];
      const midX = (a!.x + b!.x) / 2;
      const midY = (a!.y + b!.y) / 2;
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      scale = Math.min(MAX_PINCH_SCALE, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      applyLiveStyle();

      if (pinchAnchor) {
        const now = anchorClientPos(pinchAnchor);
        if (now) {
          window.scrollBy(0, now.y - midY);
          panX = clampPanX(scale, panX + (midX - now.x));
          applyLiveStyle();
        }
      }
      return;
    }

    if (pointers.size === 1 && dragLast && scale > 1) {
      const [p] = [...pointers.values()];
      const dx = p!.x - dragLast.x;
      const dy = p!.y - dragLast.y;

      if (!dragEngaged) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        dragEngaged = true;
      }

      panX = clampPanX(scale, panX + dx);
      applyLiveStyle();
      window.scrollBy(0, -dy);
      dragLast = { x: p!.x, y: p!.y };
    }
  }

  container.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Only a pinch or a drag-while-zoomed is this code's gesture to claim -
    // an ordinary one-finger scroll while unzoomed must keep working as a
    // native scroll, so preventDefault (and scheduling any work at all)
    // stays conditional on the same checks applyPendingFrame itself uses.
    const isPinch = pointers.size === 2 && pinchStartDist > 0;
    const isZoomedDrag = pointers.size === 1 && dragLast && scale > 1;
    if (!isPinch && !isZoomedDrag) return;

    e.preventDefault();
    if (!pendingFrame) {
      pendingFrame = true;
      requestAnimationFrame(applyPendingFrame);
    }
  });

  function onPointerEnd(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      // Dropped from a pinch to a single finger still down mid-gesture -
      // resync to that finger's current position so the next move computes
      // a delta from here, not from wherever it happened to be when the
      // pinch itself started.
      const [remaining] = [...pointers.values()];
      dragLast = remaining ? { x: remaining.x, y: remaining.y } : null;
      dragEngaged = true;
      pinchStartDist = 0;
      pinchAnchor = null;
    } else if (pointers.size === 0) {
      pinchStartDist = 0;
    }
    endGesture();
  }
  container.addEventListener('pointerup', onPointerEnd);
  container.addEventListener('pointercancel', onPointerEnd);

  return {
    resizeOffscreenPage(page: ZoomablePage) {
      styleFor(page);
    },
  };
}
