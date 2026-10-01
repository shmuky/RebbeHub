import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { Logo } from './Logo.js';

/** The foot of every page: what RebbeHub is, and where its code, copies and rules are. */
export function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-brand">
          <Logo size={16} name={false} />
          <p>{tu(lang, 'footOpen')}</p>
        </div>
        <nav aria-label={lang === 'he' ? 'קישורים' : 'Links'}>
          <Link to={href('/about', lang)}>{tu(lang, 'about')}</Link>
          <Link to={href('/help', lang)}>{tu(lang, 'contribute')}</Link>
          <Link to={href('/missing', lang)}>{tu(lang, 'missing')}</Link>
          <Link to={href('/health', lang)}>{tu(lang, 'health')}</Link>
          <Link to={href('/status', lang)}>{lang === 'he' ? 'מצב האתר' : 'Status'}</Link>
          <Link to={href('/suggestions', lang)}>{tu(lang, 'navSuggestions')}</Link>
          <Link to={href('/issues', lang)}>{tu(lang, 'navReports')}</Link>
          <Link to={href('/mirrors', lang)}>{tu(lang, 'mirrors')}</Link>
          <Link to={href('/developers', lang)}>{lang === 'he' ? 'למפתחים' : 'Developers'}</Link>
          <Link to={href('/takedown', lang)}>{tu(lang, 'takedown')}</Link>
          <a href="https://github.com/shmuky/RebbeHub">{tu(lang, 'code')}</a>
        </nav>
      </div>
    </footer>
  );
}
