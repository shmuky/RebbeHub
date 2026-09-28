import { useState } from 'react';
import type { FileInfo } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';

/**
 * A scan, opened in the browser's own PDF viewer at a page. Scans RebbeHub
 * may not serve are linked at their source instead (plan section 8). IIIF
 * manifests and a page-image viewer come with uploads (phase 3).
 */
export function ScanViewer({ file, title, sourceLink, pageLabels, initialPage = 1 }: { file: FileInfo | null; title: string; sourceLink: string | null; pageLabels?: Array<{ pdfPage: number; printed: string }>; initialPage?: number }) {
  const lang = useLang();
  const [page, setPage] = useState(initialPage);
  if (!file?.url) {
    return (
      <div className="notice">
        <p>{t(lang, 'scanLinkOnly')}</p>
        {sourceLink ? (
          <a className="button secondary" href={sourceLink} rel="noopener" target="_blank">
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
  return (
    <div className="scan-viewer">
      <form
        className="scan-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          const value = Number(new FormData(e.currentTarget).get('page'));
          if (Number.isInteger(value) && value > 0) setPage(value);
        }}
      >
        <label>
          {t(lang, 'page')}{' '}
          <input name="page" type="number" min={1} defaultValue={page} key={page} inputMode="numeric" />
        </label>
        <button type="submit" className="secondary">
          →
        </button>
        {label ? <span className="card-meta">({label})</span> : null}
        <a href={file.url} rel="noopener" target="_blank">
          PDF
        </a>
        {file.credit ? <span className="card-meta">{`© ${file.credit}`}</span> : null}
      </form>
      <iframe key={page} src={`${file.url}#page=${page}`} title={`${title} - ${t(lang, 'page')} ${page}`} loading="lazy" />
    </div>
  );
}
