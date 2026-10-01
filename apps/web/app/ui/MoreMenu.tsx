import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { Icon, type IconName } from './Icon.js';
import '../styles/more.css';

export interface MoreLink {
  to: string;
  icon: IconName;
  label: string;
  count?: number;
}

/**
 * A page's one ⋯ (design/README.md: "power features live behind one ⋯ menu
 * per page"): its links, then its buttons (follow, edit). A plain
 * <details>, so it opens without script too.
 */
export function MoreMenu({ links, actions, lang }: { links: MoreLink[]; actions?: ReactNode; lang: Lang }) {
  const label = lang === 'he' ? 'עוד' : 'More';
  return (
    <details className="more">
      <summary className="ib" aria-label={label} title={label}>
        <Icon name="more" />
      </summary>
      <div className="more-menu" role="list">
        {links.map((x) => (
          <Link key={x.to} role="listitem" to={x.to}>
            <Icon name={x.icon} size={18} className="subtle" />
            <span className="grow">{x.label}</span>
            {x.count ? <span className="subtle num">{num(x.count, lang)}</span> : null}
          </Link>
        ))}
        {actions ? <div className="more-actions">{actions}</div> : null}
      </div>
    </details>
  );
}
