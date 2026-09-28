import { Link } from 'react-router';
import type { Entity, RelationLink } from '../lib/api.js';
import type { Lang } from '../lib/i18n.js';
import { relationHeading, tn } from '../lib/i18nNetwork.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';

/**
 * An item's links (the plan, section 9: "each page shows 'Printed in…',
 * 'Based on this farbrengen', 'Cited by…'"), grouped by what they say,
 * seen from this page. A link a machine found that no person has checked
 * says so.
 */

/** The order the groups are shown in: where it is from first, then what it cites, then what cites it. */
const ORDER = ['out:printed-in', 'out:based-on', 'in:printed-in', 'in:based-on', 'out:cites', 'in:cites', 'out:reproduces', 'in:reproduces', 'out:translation-of', 'in:translation-of', 'out:answer-to', 'in:answer-to'];

export function Relations({ relations, refs, lang }: { relations: RelationLink[]; refs: Record<string, Entity>; lang: Lang }) {
  const shown = relations.filter((r) => refs[r.other]);
  if (!shown.length) return null;
  const groups = new Map<string, RelationLink[]>();
  for (const r of shown) groups.set(`${r.direction}:${r.kind}`, [...(groups.get(`${r.direction}:${r.kind}`) ?? []), r]);
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
  return (
    <section className="relations" aria-label={tn(lang, 'links')}>
      {keys.map((key) => {
        const [direction, kind] = key.split(':') as ['in' | 'out', string];
        return (
          <div key={key}>
            <h2 className="section-header">{relationHeading(kind, direction, lang)}</h2>
            <ul className="list">
              {groups.get(key)!.map((r) => {
                const other = refs[r.other]!;
                const to = r.direction === 'in' && r.at ? `${href(itemPath(other), lang)}#${r.at}` : href(itemPath(other), lang);
                return (
                  <li key={r.id}>
                    <Link to={to}>
                      <span>{labelOf(other, lang)}</span>
                      <span className="meta">
                        {r.note ? <span dir="rtl">{r.note}</span> : null}
                        {r.machine ? <span className="unchecked">{r.note ? ' · ' : ''}{tn(lang, 'foundByMachine')}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {shown.some((r) => r.machine) ? <p className="row-sub">{tn(lang, 'machineLinks')}</p> : null}
    </section>
  );
}
