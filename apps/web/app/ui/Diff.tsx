import type { ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { diffStat, wordDiff, type DiffPart } from '../lib/wordDiff.js';
import { Icon, type IconName } from './Icon.js';

/**
 * A change as a reviewer reads it: the words taken out struck in red, the
 * words put in green, in the passage itself. Text of the Torah is set in
 * its own face; everything else (a date, a name) in the site's.
 */

export function InlineDiff({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((p, i) => (p.kind === 'del' ? <del key={i}>{p.text}</del> : p.kind === 'ins' ? <ins key={i}>{p.text}</ins> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** "+2 −2 words" */
export function DiffStat({ parts, lang }: { parts: DiffPart[]; lang: Lang }) {
  const { added, removed } = diffStat(parts);
  return (
    <span className="diff-stat" dir="ltr">
      <span className="a">+{added}</span>
      <span className="d">−{removed}</span>
      <span>{tu(lang, 'words')}</span>
    </span>
  );
}

/** One passage, before and after, marked word by word. `n` is its number in the margin (a se'if, a line). */
export function DiffSegment({ before, after, n, context, torah = true }: { before: string; after?: string; n?: ReactNode; context?: boolean; torah?: boolean }) {
  const parts = after === undefined ? [{ kind: 'same' as const, text: before }] : wordDiff(before, after);
  return (
    <div className={context ? 'diff-seg ctx' : 'diff-seg'}>
      <span className="n">{n ?? ''}</span>
      <div className={torah ? 't torah' : 't'}>
        <InlineDiff parts={parts} />
      </div>
    </div>
  );
}

/**
 * A box of changed passages with a header: what was changed, where, and
 * how many words. `children` are DiffSegment / FieldDiff rows; `note`
 * goes beneath (the line in the scan, the machine's check).
 */
export function DiffBox({ title, where, icon = 'file', stat, actions, children, note, id }: { title: ReactNode; where?: ReactNode; icon?: IconName; stat?: ReactNode; actions?: ReactNode; children: ReactNode; note?: ReactNode; id?: string }) {
  return (
    <section className="diff" id={id}>
      <header className="diff-h">
        <Icon name={icon} />
        <b>{title}</b>
        {where ? <span className="subtle">{where}</span> : null}
        {stat || actions ? (
          <span className="end">
            {stat}
            {actions}
          </span>
        ) : null}
      </header>
      {children}
      {note ? <div className="diff-note">{note}</div> : null}
    </section>
  );
}

/**
 * A field changed (a date, a name): its name, what it was and what it is,
 * the two lines marked where they differ.
 */
export function FieldDiff({ name, before, after, torah }: { name: ReactNode; before: string; after: string; torah?: boolean }) {
  const parts = wordDiff(before, after);
  const was = parts.filter((p) => p.kind !== 'ins');
  const now = parts.filter((p) => p.kind !== 'del');
  const empty = (s: string) => s === '' || s === '—';
  return (
    <div className="diff-field">
      <div className="k">{name}</div>
      <div className={torah ? 'v torah' : 'v'}>
        {!empty(before) ? (
          <div className="diff-line was">
            <span>
              <InlineDiff parts={was} />
            </span>
          </div>
        ) : null}
        {!empty(after) ? (
          <div className="diff-line now">
            <span>
              <InlineDiff parts={now} />
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { wordDiff, diffStat };
