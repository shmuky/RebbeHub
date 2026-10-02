import type { HayomYomShiurim } from '@rebbehub/hebrew';
import { inlineText, isPageText, type PageSegment, type PageText } from '@rebbehub/model';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { PageWords } from './PageWords.js';
import '../styles/pages/hayom-yom.css';

/**
 * A day of Hayom Yom set as the book prints it: a row with the weekday,
 * the day (as the entry is titled) and the year; the day's notices that the
 * book puts above the shiurim; the shiurim, Chumash, Tehillim and Tanya,
 * under "שיעורים.", each a link to its words; the notices it puts right after them; then its words,
 * justified, each paragraph's first line indented. Notices are in italics. The weekday, the year, the
 * shiurim and which of the day's first paragraphs are notices are worked
 * out from the calendar of 5703 and the scan of the book (@rebbehub/hebrew's
 * hayomYom.ts).
 *
 * What the book prints that the day's text source lacks is kept in the day's
 * own words, by the ids of its segments: `lead-…` above the day's head (the
 * letter before the first day), `pre-…` among the notices (a Shabbos's
 * haftorah), `after-…` among those after the shiurim, `tanya` the Tanya line as printed (its first and last words),
 * `close-…` after the words (the blessing that ends the book). Until they
 * are there, the Tanya line names the day's chapter.
 */
export function HayomYomDay({ title, body, shiurim, lang, actions }: { title: string; body: unknown; shiurim: HayomYomShiurim | null; lang: Lang; actions?: ReactNode }) {
  const parts = split(isPageText(body) ? spaced(body) : null, shiurim?.before ?? 0, shiurim?.after ?? 0);
  return (
    <article className="hy-day" lang="he" dir="rtl">
      {parts.lead.length ? (
        <div className="hy-lead">
          <Lines segments={parts.lead} />
        </div>
      ) : null}
      <header className="hy-head">
        <span className="hy-weekday">{shiurim?.weekday}</span>
        <h3 className="hy-date">{title}</h3>
        <span className="hy-year">{shiurim?.year}</span>
      </header>
      {parts.pre.length ? (
        <div className="hy-pre">
          <Lines segments={parts.pre} />
        </div>
      ) : null}
      {shiurim ? (
        <div className="hy-shiurim">
          <span className="hy-shiurim-title">שיעורים.</span>
          <span className="hy-shiur-name">חומש:</span>
          <span>{shiurim.chumashRef ? <Link className="hy-shiur-link" to={shiur(shiurim.chumashRef, true, lang, shiurim.chumash)}>{shiurim.chumash}</Link> : shiurim.chumash}</span>
          <span className="hy-shiur-name">תהלים:</span>
          <span>
            {shiurim.tehillimParts.map((part, i) => (
              <span key={i}>
                {i ? ' ' : null}
                {part.ref ? (
                  <Link className="hy-shiur-link" to={shiur(part.ref, false, lang, `תהלים ${part.text}`)}>
                    {part.text}
                  </Link>
                ) : (
                  part.text
                )}
              </span>
            ))}
          </span>
          {parts.tanya || shiurim.tanya ? (
            <>
              <span className="hy-shiur-name">תניא:</span>
              <TanyaLink shiurim={shiurim} lang={lang}>
                {parts.tanya ? <Lines segments={[parts.tanya]} as="span" /> : <span>{shiurim.tanya!.label}.</span>}
              </TanyaLink>
            </>
          ) : null}
        </div>
      ) : null}
      {parts.after.length ? (
        <div className="hy-after">
          <Lines segments={parts.after} />
        </div>
      ) : null}
      {parts.words ? <PageWords page={parts.words} lang={lang} /> : null}
      {parts.close.length ? (
        <div className="hy-close">
          <span className="hy-close-mark" aria-hidden="true">
            *
          </span>
          <Lines segments={parts.close} />
        </div>
      ) : null}
      {actions ? <div className="hy-actions">{actions}</div> : null}
    </article>
  );
}

/** Chumash (with Rashi) and Tehillim on the shiurim page, cut to what the book says to learn: the aliyah, not its whole chapter. */
const shiur = (ref: string, rashi: boolean, lang: Lang, title: string) => href('/shiurim', lang, { ref, rashi: rashi ? '1' : undefined, title: title.replace(/\.$/, '') });

/** The Tanya line, to where the day's Tanya starts on its chapter's page. */
function TanyaLink({ shiurim, lang, children }: { shiurim: HayomYomShiurim; lang: Lang; children: ReactNode }) {
  const tanya = shiurim.tanya;
  if (!tanya?.path) return <>{children}</>;
  return (
    <Link className="hy-shiur-link" to={`${href(tanya.path, lang)}#s-${tanya.segment}`}>
      {children}
    </Link>
  );
}

interface Parts {
  lead: PageSegment[];
  pre: PageSegment[];
  after: PageSegment[];
  tanya: PageSegment | null;
  close: PageSegment[];
  words: PageText | null;
}

/** The day's words, parted as the book sets them: what goes above its head, its notices before and after the shiurim, its Tanya line, its words, and what follows them. */
function split(page: PageText | null, before: number, after: number): Parts {
  const out: Parts = { lead: [], pre: [], after: [], tanya: null, close: [], words: null };
  if (!page) return out;
  const [first, ...others] = page.versions;
  if (!first) return out;
  const rest: PageSegment[] = [];
  let notices = before;
  // The notices after the shiurim are the paragraphs right after those before them.
  for (const s of first.segments) {
    if (s.id.startsWith('lead-')) out.lead.push(s);
    else if (s.id.startsWith('pre-')) out.pre.push(s);
    else if (s.id.startsWith('after-')) out.after.push(s);
    else if (s.id === 'tanya') out.tanya = s;
    else if (s.id.startsWith('close-')) out.close.push(s);
    else if (notices > 0 && s.kind === 'paragraph') {
      out.pre.push(s);
      notices--;
    } else if (after > 0 && s.kind === 'paragraph') {
      out.after.push(s);
      after--;
    } else rest.push(s);
  }
  out.words = rest.length ? { ...page, versions: [{ ...first, segments: rest }, ...others] } : null;
  return out;
}

/** Lines the book sets apart from the day's words: each a line of its own, a heading bold; marked while a machine read it and nobody checked it. */
function Lines({ segments, as = 'div' }: { segments: PageSegment[]; as?: 'div' | 'span' }) {
  const Tag = as;
  return (
    <>
      {segments.map((s) => (
        <Tag key={s.id} id={`s-${s.id}`} className={`hy-line${s.kind === 'heading' ? ' hy-line-heading' : ''}${s.origin && !s.origin.checked ? ' machine' : ''}`} title={s.origin && !s.origin.checked ? 'נקרא בידי מכונה ועדיין לא נבדק' : undefined}>
          {inlineText(s.text)
            .split('\n')
            .map((line, i) => (
              <span key={i} className="hy-line-part">
                {line}
              </span>
            ))}
        </Tag>
      ))}
    </>
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
