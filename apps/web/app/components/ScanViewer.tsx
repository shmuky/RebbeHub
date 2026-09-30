import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { FileInfo, ScanPages } from '../lib/api.js';
import { Link } from 'react-router';
import { readHref } from '../routes/read.js';
import { t } from '../lib/i18n.js';
import { st } from '../lib/scanStrings.js';
import { useLang } from '../lib/useLang.js';

/**
 * A scan, read in the site's own reader at a page (the recording keeps
 * playing). Where the jobs have drawn its pages (page images, plan
 * section 8), the page itself is shown here, with a strip of thumbnails
 * and the scan's IIIF manifest for any library viewer. Scans RebbeHub may
 * not serve are linked at their source instead.
 */
export function ScanViewer({
  file,
  title,
  sourceLink,
  pageLabels,
  pages,
  initialPage = 1,
}: {
  /** The file to read; a Drive copy has only its address and credit. */
  file: Pick<FileInfo, 'url' | 'credit'> | null;
  title: string;
  sourceLink: string | null;
  pageLabels?: Array<{ pdfPage: number; printed: string }>;
  pages?: ScanPages;
  initialPage?: number;
}) {
  const lang = useLang();
  const [page, setPage] = useState(initialPage);
  if (!file?.url) {
    return (
      <div className="notice">
        <p>{t(lang, 'scanLinkOnly')}</p>
        {sourceLink ? (
          <a className="btn" href={sourceLink} rel="noopener" target="_blank">
            {t(lang, 'openAtSource')}
          </a>
        ) : null}
      </div>
    );
  }
  // The printed page number shown at a PDF page, from where the book's numbering starts.
  const label = (() => {
    const start = [...(pageLabels ?? [])].filter((l) => l.pdfPage <= page).sort((a, b) => b.pdfPage - a.pdfPage)[0];
    return start && page === start.pdfPage ? start.printed : null;
  })();
  const images = pages?.pages ?? [];
  const last = images.length ? images[images.length - 1]!.page : null;
  const shown = images.find((p) => p.page === page) ?? null;
  // In Hebrew the next page is to the left, as in a sefer.
  const [Back, Forward] = lang === 'he' ? [ChevronRight, ChevronLeft] : [ChevronLeft, ChevronRight];
  return (
    <div className="scan-viewer">
      <form
        className="scan-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(new FormData(e.currentTarget).get('page'));
          if (Number.isInteger(value) && value > 0) {
            setPage(last ? Math.min(value, last) : value);
          }
        }}
      >
        {images.length ? (
          <button type="button" className="btn" aria-label={st(lang, 'previousPage')} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <Back size={18} aria-hidden="true" />
          </button>
        ) : null}
        <label>
          {t(lang, 'page')}{' '}
          <input name="page" type="number" min={1} max={last ?? undefined} defaultValue={page} key={page} inputMode="numeric" />
          {last ? ` ${st(lang, 'pageOf')} ${last}` : ''}
        </label>
        {images.length ? (
          <button type="button" className="btn" aria-label={st(lang, 'nextPage')} disabled={last !== null && page >= last} onClick={() => setPage(page + 1)}>
            <Forward size={18} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="btn">
            →
          </button>
        )}
        {label ? <span className="card-meta">({label})</span> : null}
        <a href={file.url} rel="noopener" target="_blank">
          PDF
        </a>
        {pages?.manifest ? (
          <a href={pages.manifest} rel="noopener" target="_blank" title={st(lang, 'iiif')}>
            IIIF
          </a>
        ) : null}
        {file.credit ? <span className="card-meta">{`© ${file.credit}`}</span> : null}
      </form>
      {shown ? (
        <figure className="scan-page">
          <img src={shown.image} width={shown.width} height={shown.height} alt={`${title}, ${t(lang, 'page')} ${shown.page}`} />
        </figure>
      ) : null}
      {images.length > 1 ? (
        <ol className="scan-thumbs" aria-label={st(lang, 'pageImages')}>
          {images.map((p) => (
            <li key={p.page}>
              <button type="button" aria-current={p.page === page ? 'page' : undefined} onClick={() => setPage(p.page)} aria-label={`${t(lang, 'page')} ${p.page}`}>
                {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" /> : <span>{p.page}</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <Link className="btn read-button" to={readHref({ url: file.url, title, page }, lang)}>
        <BookOpen size={20} aria-hidden="true" /> {t(lang, 'readScan')} {page > 1 ? `(${t(lang, 'page')} ${page})` : ''}
      </Link>
    </div>
  );
}
