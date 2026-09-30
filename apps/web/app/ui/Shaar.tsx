import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from './primitives.js';

/**
 * A sefer's title page (the shaar), set as a printed one is: the kind of
 * book, its name large, the volume, a rule, whose words, the publisher and
 * the year. When a real title page has been photographed (`image`), that
 * is shown instead, in the same frame. Words only from the catalog: never
 * an invented cover.
 */
export function Shaar({
  title,
  kind,
  part,
  subtitle,
  by,
  publisher,
  place,
  year,
  image,
  size,
  to,
  caption,
  label,
}: {
  title: string;
  kind?: string;
  part?: string;
  /** The title page's second line, from the sefer's shaar file. */
  subtitle?: string;
  by?: ReactNode;
  publisher?: string;
  place?: string;
  year?: string;
  image?: string | null;
  size?: 'sm' | 'md';
  to?: string;
  caption?: ReactNode;
  label?: string;
}) {
  const body = image ? (
    <img className="shaar-img" src={image} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className="shaar-frame">
      {kind && !size ? <span className="shaar-kind">{kind}</span> : null}
      <span className="shaar-title">{title}</span>
      {subtitle && !size ? <span className="shaar-part">{subtitle}</span> : null}
      {part && size !== 'sm' ? <span className="shaar-part">{part}</span> : null}
      {!size ? (
        <>
          <span className="shaar-rule" />
          {by ? <span className="shaar-by">{by}</span> : null}
          {publisher ? <span className="shaar-foot">{publisher}</span> : null}
          {place ? <span className="shaar-year">{place}</span> : null}
          {year ? <span className="shaar-year">{year}</span> : null}
        </>
      ) : null}
    </span>
  );
  const shaar = to ? (
    <Link to={to} className={cx('shaar', size, image && 'has-img')} aria-label={label ?? title}>
      {body}
    </Link>
  ) : (
    <span className={cx('shaar', size, image && 'has-img')} role="img" aria-label={label ?? title}>
      {body}
    </span>
  );
  if (!caption) return shaar;
  return (
    <figure className="shaar-fig">
      {shaar}
      <figcaption className="shaar-cap">{caption}</figcaption>
    </figure>
  );
}

/** A page drawn in lines, for a hanacha or scan whose image is not shown here. */
export function PageThumb({ seed = 1 }: { seed?: number }) {
  const lines = 10 + (seed % 3);
  return (
    <span className="page-thumb" aria-hidden="true">
      <span className="hd" style={{ width: `${40 + ((seed * 13) % 35)}%` }} />
      {Array.from({ length: lines }, (_, i) => (
        <b key={i} style={(i * 7 + seed) % 5 === 0 ? { width: `${60 + ((i * 11 + seed) % 35)}%` } : undefined} />
      ))}
    </span>
  );
}
