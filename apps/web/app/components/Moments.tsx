import { Link } from 'react-router';
import type { Entity, Moment } from '../lib/api.js';
import type { Lang } from '../lib/i18n.js';
import { clockOf, tn } from '../lib/i18nNetwork.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { Icon } from '../ui/Icon.js';
import { MachineLabel } from '../ui/primitives.js';

/**
 * Search hits that land on the moment: a line on a scan's page opens the
 * page's text at that line, lit up; a paragraph of a transcript opens its
 * farbrengen at that paragraph, ready to play from where it is heard.
 * What a machine read or heard and nobody has checked says so.
 */

/** The words of `text` with those found marked, as the search matched them. */
export function Marked({ text, hits }: { text: string; hits: readonly string[] }) {
  const found = new Set(hits);
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) => (found.has(part) ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

/** Where a moment opens. */
export function momentHref(moment: Moment, refs: Record<string, Entity>, lang: Lang): string | null {
  if (moment.kind === 'scan-line') return `${href(`/text/${moment.scan}`, lang, { page: String(moment.page), line: moment.line.id })}#line-${moment.line.id}`;
  const event = moment.event ? refs[moment.event] : undefined;
  if (moment.recording && event) return `${href(itemPath(event), lang, { at: moment.id })}#p-${moment.id}`;
  const unit = moment.unit ? refs[moment.unit] : undefined;
  if (unit) return `${href(itemPath(unit), lang)}#${moment.id}`;
  return `${href(`/${moment.text}`, lang)}#${moment.id}`;
}

/** The ids a list of moments names, whose names it shows. */
export const momentRefs = (moments: readonly Moment[]): string[] =>
  moments.flatMap((m) => (m.kind === 'scan-line' ? [m.publication ?? m.scan] : [m.event, m.unit, m.recording].filter((x): x is string => Boolean(x))));

function where(moment: Moment, refs: Record<string, Entity>, lang: Lang): string {
  if (moment.kind === 'scan-line') {
    const publication = refs[moment.publication ?? moment.scan];
    return `${publication ? labelOf(publication, lang) : moment.scan} · ${tn(lang, 'onScanPage')} ${moment.page}`;
  }
  const owner = (moment.event && refs[moment.event]) || (moment.unit && refs[moment.unit]) || null;
  const name = owner ? labelOf(owner, lang) : tn(lang, moment.textKind === 'transcript' ? 'transcriptOf' : 'textOf');
  const recording = moment.recording ? refs[moment.recording] : undefined;
  return [name, recording ? labelOf(recording, lang) : null, moment.startMs !== null ? `${tn(lang, 'heardAt')}${clockOf(moment.startMs)}` : null].filter(Boolean).join(' · ');
}

/**
 * Moments as rows in a box: the words found, set as the text is, and
 * where they are. Machine output nobody checked carries its label.
 */
export function MomentRows({ moments, refs, lang }: { moments: readonly Moment[]; refs: Record<string, Entity>; lang: Lang }) {
  return (
    <ol className="box moments">
      {moments.map((m) => {
        const to = momentHref(m, refs, lang);
        const words = m.kind === 'scan-line' ? m.line.text : m.snippet;
        return (
          <li key={m.id} className={m.machine ? 'row moment machine-row' : 'row moment'}>
            <Icon name={m.kind === 'scan-line' ? 'scan' : m.recording ? 'audio' : 'file'} className="subtle" />
            <div className="row-main">
              <p className="moment-words torah" dir="auto">
                {to ? (
                  <Link to={to}>
                    <Marked text={words} hits={m.hits} />
                  </Link>
                ) : (
                  <Marked text={words} hits={m.hits} />
                )}
              </p>
              <p className="row-sub">
                {where(m, refs, lang)}
                {m.machine ? (
                  <>
                    {' '}
                    <MachineLabel lang={lang} size="sm">
                      {tn(lang, m.kind === 'paragraph' && m.textKind === 'transcript' ? 'machineHeard' : 'machineRead')}
                    </MachineLabel>
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
