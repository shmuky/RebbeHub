import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A row of years that scrolls sideways, opening with the chosen year in
 * view (a strip of forty years would otherwise hide it off the edge).
 */
export function YearStrip({ children }: { children: ReactNode }) {
  const strip = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('.year-chip.on');
    const list = strip.current;
    if (!on || !list) return;
    // Scroll the strip alone, never the page.
    const offset = on.offsetLeft - list.offsetLeft - (list.clientWidth - on.clientWidth) / 2;
    list.scrollLeft = offset;
  });
  return (
    <ul className="year-strip" ref={strip}>
      {children}
    </ul>
  );
}
