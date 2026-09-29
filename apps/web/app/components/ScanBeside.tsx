import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { Link } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { Icon } from '../ui/Icon.js';

const WORDS = {
  scan: { he: 'הסריקה', en: 'The scan' },
  page: { he: 'עמוד', en: 'Page' },
  of: { he: 'מתוך', en: 'of' },
  prev: { he: 'העמוד הקודם', en: 'Previous page' },
  next: { he: 'העמוד הבא', en: 'Next page' },
  zoomIn: { he: 'הגדלה', en: 'Zoom in' },
  zoomOut: { he: 'הקטנה', en: 'Zoom out' },
  loading: { he: 'הסריקה נטענת', en: 'Loading the scan' },
  failed: { he: 'הסריקה לא נטענה.', en: "The scan didn't load." },
  open: { he: 'לפתוח בקורא', en: 'Open in the reader' },
} as const;

/**
 * One page of a scan, drawn by pdf.js beside the words read from it, so
 * each segment is checked against the page itself. The file is loaded
 * once; turning pages and zooming only draw again. `file` is where its
 * bytes are read (a Drive file through RebbeHub's API), `src` its own
 * address, for the reader.
 */
export function ScanBeside({ file, src, title, page, lang, onPage }: { file: string; src: string; title: string; page: number; lang: Lang; onPage: (page: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let live = true;
    void (async () => {
      try {
        const { loadPdfDocument } = await import('../reader/renderPdf.js');
        task = loadPdfDocument(file, ({ loaded, total }) => live && total > 0 && setProgress(Math.round((loaded / total) * 100)));
        const loaded = await task.promise;
        if (live) setDoc(loaded);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [file]);

  const pages = doc?.numPages ?? 0;
  const shown = pages ? Math.min(Math.max(page, 1), pages) : page;

  useEffect(() => {
    const el = box.current;
    if (!doc || !el) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void (async () => {
      const p = await doc.getPage(shown);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const width = (el.clientWidth || 400) * zoom;
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: (width / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      task = p.render({ canvas, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (!cancelled) el.replaceChildren(canvas);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, shown, zoom]);

  return (
    <div className="scan-beside" aria-label={WORDS.scan[lang]}>
      <div className="scan-bar">
        <button type="button" className="btn sm icon" onClick={() => onPage(shown - 1)} disabled={!doc || shown <= 1} aria-label={WORDS.prev[lang]} title={WORDS.prev[lang]}>
          <Icon name="chevr" />
        </button>
        <span className="num scan-at">
          {WORDS.page[lang]} {num(shown, lang)}
          {pages ? ` ${WORDS.of[lang]} ${num(pages, lang)}` : ''}
        </span>
        <button type="button" className="btn sm icon" onClick={() => onPage(shown + 1)} disabled={!doc || shown >= pages} aria-label={WORDS.next[lang]} title={WORDS.next[lang]}>
          <Icon name="chev" />
        </button>
        <span className="scan-zoom">
          <button type="button" className="btn sm icon" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label={WORDS.zoomOut[lang]} title={WORDS.zoomOut[lang]}>
            <Icon name="minus" />
          </button>
          <button type="button" className="btn sm icon" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} disabled={zoom >= 3} aria-label={WORDS.zoomIn[lang]} title={WORDS.zoomIn[lang]}>
            <Icon name="plus" />
          </button>
        </span>
        <Link className="btn sm ghost" to={href('/read', lang, { src, title, page: String(shown) })} target="_blank">
          {WORDS.open[lang]}
        </Link>
      </div>
      <div className="scan-page" dir="ltr">
        <div ref={box} className="scan-canvas" />
        {!doc && !failed ? (
          <p className="subtle scan-note" role="status">
            {WORDS.loading[lang]}
            {progress !== null ? ` · ${num(progress, lang)}%` : '…'}
          </p>
        ) : null}
        {failed ? <p className="alert negative scan-note">{WORDS.failed[lang]} {t(lang, 'error')}</p> : null}
      </div>
    </div>
  );
}
