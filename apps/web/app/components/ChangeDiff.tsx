import type { ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';
import { wordDiff } from '../lib/wordDiff.js';
import { DiffBox, DiffSegment, DiffStat, FieldDiff } from '../ui/Diff.js';
import type { IconName } from '../ui/Icon.js';
import { fieldName, foldChanges, foldedName, moreChanges, valueText } from './ChangeTable.js';

/**
 * A change to one item as a reviewer reads it (the review queue, an item's
 * history): the item's name over the change; words of a page changed word
 * by word in the Torah face, with the segment in the margin; any other
 * field (a date, a name) by its name, what it was and what it is. Never
 * JSON, never a raw field diff.
 */

export interface Change {
  path: string;
  before?: unknown;
  after?: unknown;
}

/** Whether a change is to the words of a page (a segment's runs), not to a field. */
const isWords = (path: string) => path.startsWith('/body/');

/** The segment a change is in, for the margin: `3`, `14.3`. */
function segmentOf(path: string, lang: Lang): string {
  const name = fieldName(path, lang).split(' › ');
  return name.length > 2 ? name[name.length - 1]! : '';
}

export function ChangeRows({ changes, lang }: { changes: Change[]; lang: Lang }) {
  const folded = foldChanges(changes);
  return (
    <>
      {folded.rows.map((c) =>
        isWords(c.path) ? (
          <DiffSegment key={c.path} n={segmentOf(c.path, lang)} before={valueText(c.path, c.before, lang).replace(/^—$/, '')} after={valueText(c.path, c.after, lang).replace(/^—$/, '')} />
        ) : (
          <FieldDiff key={c.path} name={foldedName(c, lang)} before={valueText(c.path, c.before, lang)} after={valueText(c.path, c.after, lang)} />
        ),
      )}
      {folded.hidden ? <p className="subtle small pad">{moreChanges(folded.hidden, lang)}</p> : null}
    </>
  );
}

/** How many words a set of changes to a page's words adds and takes out, or null when none is to words. */
export function wordsStat(changes: Change[], lang: Lang): ReactNode {
  const words = changes.filter((c) => isWords(c.path));
  if (!words.length) return null;
  const parts = words.flatMap((c) => wordDiff(valueText(c.path, c.before, lang).replace(/^—$/, ''), valueText(c.path, c.after, lang).replace(/^—$/, '')));
  return <DiffStat parts={parts} lang={lang} />;
}

export function ChangeDiff({ title, where, changes, lang, icon, note, actions }: { title: ReactNode; where?: ReactNode; changes: Change[]; lang: Lang; icon?: IconName; note?: ReactNode; actions?: ReactNode }) {
  return (
    <DiffBox title={title} where={where} icon={icon} stat={wordsStat(changes, lang)} note={note} actions={actions}>
      <ChangeRows changes={changes} lang={lang} />
    </DiffBox>
  );
}
