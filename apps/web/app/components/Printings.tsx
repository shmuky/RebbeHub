import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { nameOf, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { st } from '../lib/scanStrings.js';

type D = { kind?: string; title?: { he: string; en?: string }; publisher?: string; placePrinted?: string; date?: string; gregorianYear?: number; printing?: number; volume?: string; simcha?: { families?: string[] } };

/**
 * A sefer's printings (the plan, section 4: "every printing of every
 * book"): each one's publisher and place, its year, which printing, and
 * how many scans of it RebbeHub has, in the order they came out.
 */
export function Printings({ publications, scanCounts, lang }: { publications: Entity[]; scanCounts?: Record<string, number>; lang: Lang }) {
  if (!publications.length) return null;
  return (
    <table className="printings">
      <thead>
        <tr>
          <th>{st(lang, 'printingsHead')}</th>
          <th>{st(lang, 'publisher')}</th>
          <th>{st(lang, 'year')}</th>
          <th>{st(lang, 'scansCount')}</th>
        </tr>
      </thead>
      <tbody>
        {publications.map((p) => {
          const d = p.data as D;
          const scans = scanCounts?.[p.id] ?? 0;
          return (
            <tr key={p.id}>
              <td>
                <Link to={href(itemPath(p), lang)}>{nameOf(d.title, lang) || p.id}</Link>
                {d.volume ? ` · ${d.volume}` : ''}
                {d.printing ? ` · ${st(lang, 'printingNo')} ${d.printing}` : ''}
                {d.simcha?.families?.length ? ` · ${d.simcha.families.join(' – ')}` : ''}
              </td>
              <td>{[d.publisher, d.placePrinted].filter(Boolean).join(', ')}</td>
              <td>{[d.date ? dateLabel(d.date, lang, { civil: false }) : null, d.gregorianYear].filter(Boolean).join(' · ')}</td>
              <td className="card-meta">{scans ? scans : st(lang, 'noScanYet')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
