import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { Icon } from './Icon.js';
import { Logo } from './Logo.js';

const F = {
  read: { he: 'קריאה', en: 'Read' },
  help: { he: 'להשתתף', en: 'Take part' },
  site: { he: 'האתר', en: 'The site' },
  index: { he: 'מפתח ענינים ללקוטי שיחות', en: 'Likkutei Sichos index' },
  status: { he: 'מצב האתר', en: 'Status' },
  developers: { he: 'למפתחים', en: 'Developers' },
  links: { he: 'קישורים', en: 'Links' },
} as const;

/**
 * The foot of every page: what RebbeHub is, and its pages in three short
 * columns (reading, taking part, the site itself), as a site's foot lists
 * them; under them one quiet line with the source code. On a phone the
 * columns sit two to a row.
 */
export function Footer({ lang }: { lang: Lang }) {
  const groups: Array<{ title: string; links: Array<{ to: string; label: string }> }> = [
    {
      title: F.read[lang],
      links: [
        { to: '/sets', label: tu(lang, 'navLibrary') },
        { to: '/daily', label: tu(lang, 'navDaily') },
        { to: '/calendar', label: tu(lang, 'navListen') },
        { to: '/mafteach', label: F.index[lang] },
      ],
    },
    {
      title: F.help[lang],
      links: [
        { to: '/help', label: tu(lang, 'contribute') },
        { to: '/suggestions', label: tu(lang, 'navSuggestions') },
        { to: '/issues', label: tu(lang, 'navReports') },
        { to: '/projects', label: tu(lang, 'navProjects') },
        { to: '/missing', label: tu(lang, 'missing') },
      ],
    },
    {
      title: F.site[lang],
      links: [
        { to: '/about', label: tu(lang, 'about') },
        { to: '/health', label: tu(lang, 'health') },
        { to: '/status', label: F.status[lang] },
        { to: '/mirrors', label: tu(lang, 'mirrors') },
        { to: '/developers', label: F.developers[lang] },
        { to: '/takedown', label: tu(lang, 'takedown') },
      ],
    },
  ];
  return (
    <footer className="site-footer">
      <div className="wrap foot-grid">
        <div className="foot-brand">
          <Link to={href('/', lang)} className="foot-logo">
            <Logo size={22} />
          </Link>
          <p>{tu(lang, 'footOpen')}</p>
        </div>
        <nav className="foot-cols" aria-label={F.links[lang]}>
          {groups.map((g) => (
            <section key={g.title} className="foot-col">
              <h2>{g.title}</h2>
              {g.links.map((l) => (
                <Link key={l.to} to={href(l.to, lang)}>
                  {l.label}
                </Link>
              ))}
            </section>
          ))}
        </nav>
      </div>
      <div className="wrap">
        <div className="foot-base">
          <span>RebbeHub</span>
          <a href="https://github.com/shmuky/RebbeHub">
            <Icon name="code" size={14} />
            {tu(lang, 'code')}
          </a>
        </div>
      </div>
    </footer>
  );
}
