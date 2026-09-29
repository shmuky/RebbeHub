import { Link } from 'react-router';
import { DOC_PAGES } from '../lib/developerDocs.js';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';

/** The developer docs' own few words and their list of pages (routes/developers.tsx, routes/developers-reference.tsx). */

/** The page's own few words, in both languages (the docs themselves are English). */
export function words(lang: Lang) {
  return lang === 'he'
    ? { developers: 'למפתחים', pages: 'דפי התיעוד', reference: 'מדריך ה-API האינטראקטיבי', edit: 'עריכת הדף ב-GitHub', onThisPage: 'בדף הזה', englishOnly: 'התיעוד למפתחים כתוב באנגלית.' }
    : { developers: 'Developers', pages: 'The docs', reference: 'Interactive API reference', edit: 'Edit this page on GitHub', onThisPage: 'On this page', englishOnly: '' };
}

export function DocsNav({ lang, current }: { lang: Lang; current: string | null }) {
  const w = words(lang);
  return (
    <nav className="dev-docs-nav" aria-label={w.pages}>
      <ul>
        {DOC_PAGES.map((p) => (
          <li key={p.slug}>
            <Link to={href(`/developers${p.slug ? `/${p.slug}` : ''}`, lang)} aria-current={current === p.slug ? 'page' : undefined}>
              {p.title}
            </Link>
          </li>
        ))}
        <li>
          <Link to={href('/developers/reference', lang)} aria-current={current === 'reference' ? 'page' : undefined}>
            {w.reference}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

