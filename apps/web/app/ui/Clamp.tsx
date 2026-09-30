import { useState, type ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';

/**
 * A long text's beginning, with a button for the rest: a bot's description
 * of a suggestion can run to pages, and a reviewer reads its first lines to
 * know what it is (Shmuly, 30 Tishrei: "just beginning if too long").
 */
export function Clamp({ text, lang, limit = 400, render }: { text: string; lang: Lang; limit?: number; render: (text: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit || open) return <>{render(text)}</>;
  // Cut at the last line or word break before the limit, so no word is split.
  const cut = text.slice(0, limit);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
  return (
    <>
      {render(`${(at > limit / 2 ? cut.slice(0, at) : cut).trimEnd()}…`)}
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        {lang === 'he' ? 'להציג הכול' : 'Show all'}
      </button>
    </>
  );
}
