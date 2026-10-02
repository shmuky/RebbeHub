/**
 * RebbeHub's logo (design/RebbeHub Logo Guidelines.dc.html): a tall book in
 * the accent colour with a Latin R on it, and the name beside it. The book
 * comes first in the line, so on a Hebrew page it stands on the right with
 * its rounder edge facing out, and on an English one on the left; the R and
 * the name are never mirrored. Below a 20px book the name is left out.
 */
export function Logo({ size = 24, name = true }: { size?: number; name?: boolean }) {
  return (
    <span className="logo" style={{ '--w': `${size}px` } as React.CSSProperties}>
      <span className="logo-book" aria-hidden="true">
        R
      </span>
      {name && size >= 20 ? (
        <span className="logo-name" dir="ltr">
          RebbeHub
        </span>
      ) : null}
    </span>
  );
}
