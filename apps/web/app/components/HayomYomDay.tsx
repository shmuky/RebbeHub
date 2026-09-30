import type { HayomYomShiurim } from '@rebbehub/hebrew';
import { isPageText, type PageSegment, type PageText } from '@rebbehub/model';
import type { ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';
import { PageWords } from './PageWords.js';
import '../styles/pages/hayom-yom.css';

/**
 * A day of Hayom Yom set as the book prints it: a row with the weekday,
 * the day (as the entry is titled) and the year; the day's shiurim, Chumash,
 * Tehillim and Tanya, under "שיעורים."; then its words, justified, and a
 * rule under the day. The weekday, the year and the shiurim are worked out
 * from the calendar of 5703 (@rebbehub/hebrew's hayomYom.ts), and the Tanya line names
 * the day's chapter, as the book's own first and last words of it are not
 * in the catalog yet.
 */
export function HayomYomDay({ title, body, shiurim, lang, actions }: { title: string; body: unknown; shiurim: HayomYomShiurim | null; lang: Lang; actions?: ReactNode }) {
  return (
    <article className="hy-day" lang="he" dir="rtl">
      <header className="hy-head">
        <span className="hy-weekday">{shiurim?.weekday}</span>
        <h3 className="hy-date">{title}</h3>
        <span className="hy-year">{shiurim?.year}</span>
      </header>
      {shiurim ? (
        <div className="hy-shiurim">
          <span className="hy-shiurim-title">שיעורים.</span>
          <span className="hy-shiur-name">חומש:</span>
          <span>{shiurim.chumash}</span>
          <span className="hy-shiur-name">תהלים:</span>
          <span>{shiurim.tehillim}</span>
          {shiurim.tanya ? (
            <>
              <span className="hy-shiur-name">תניא:</span>
              <span>{shiurim.tanya.label}.</span>
            </>
          ) : null}
        </div>
      ) : null}
      {isPageText(body) ? <PageWords page={spaced(body)} lang={lang} /> : null}
      {actions ? <div className="hy-actions">{actions}</div> : null}
    </article>
  );
}

/** chabadlibrary.org's text now and then runs a word on after a comma (`לטובה,צריך`); the book has a space there. */
function spaced(page: PageText): PageText {
  const fix = (s: PageSegment): PageSegment => ({
    ...s,
    text: s.text?.map((run) => ('text' in run ? { ...run, text: run.text.replace(/([א-ת]),(?=[א-ת])/g, '$1, ') } : run)),
    children: s.children?.map(fix),
  });
  return { ...page, versions: page.versions.map((v) => ({ ...v, segments: v.segments.map(fix) })) };
}
