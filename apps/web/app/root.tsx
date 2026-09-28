import { Form, isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteLoaderData, type LinksFunction } from 'react-router';
import type { Route } from './+types/root';
import { dir, langFrom, t, type Lang } from './lib/i18n.js';
import { href } from './lib/links.js';
import { useLang } from './lib/useLang.js';
import { siteOf } from './lib/context.server.js';
import './app.css';

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700&family=Noto+Sans+Hebrew:wght@400;500;600&family=Noto+Sans:wght@400;500;600&display=swap' },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const lang = langFrom(request);
  return { lang, siteUrl: siteOf(context).siteUrl };
}

export function headers() {
  // Pages change when the catalog does; let caches keep them briefly and serve stale while refreshing.
  return { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' };
}

function LanguageSwitch({ lang }: { lang: Lang }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (lang === 'he') params.set('lang', 'en');
  else params.delete('lang');
  const qs = params.toString();
  return (
    <a className="lang-switch" href={qs ? `${location.pathname}?${qs}` : location.pathname} hrefLang={lang === 'he' ? 'en' : 'he'} lang={lang === 'he' ? 'en' : 'he'}>
      {t(lang, 'language')}
    </a>
  );
}

function Header({ lang }: { lang: Lang }) {
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <Link to={href('/', lang)} className="brand" aria-label={t(lang, 'home')}>
          <span className="brand-mark" aria-hidden="true">
            ר
          </span>
          <span className="brand-name">RebbeHub</span>
        </Link>
        <nav className="main-nav" aria-label={lang === 'he' ? 'ניווט ראשי' : 'Main'}>
          <Link to={href('/sets', lang)}>{t(lang, 'sets')}</Link>
          <Link to={href('/calendar', lang)}>{t(lang, 'calendar')}</Link>
          <Link to={href('/about', lang)}>{t(lang, 'about')}</Link>
          <LanguageSwitch lang={lang} />
        </nav>
      </div>
      <div className="wrap">
        <Form method="get" action="/search" className="search-form" role="search">
          <label className="visually-hidden" htmlFor="q">
            {t(lang, 'search')}
          </label>
          <input id="q" name="q" type="search" placeholder={t(lang, 'searchPlaceholder')} enterKeyHint="search" />
          {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
          <button type="submit">{t(lang, 'search')}</button>
        </Form>
      </div>
    </header>
  );
}

function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <p>{t(lang, 'footerOpen')}</p>
        <p>
          <a href="https://github.com/shmuky/RebbeHub">{t(lang, 'code')}</a> · <a href="https://github.com/shmuky/RebbeHub/blob/main/CONTRIBUTING.md">{t(lang, 'help')}</a> ·{' '}
          <Link to={href('/about', lang)}>{t(lang, 'about')}</Link>
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData('root') as { lang?: Lang } | undefined;
  const lang = data?.lang ?? 'he';
  return (
    <html lang={lang} dir={dir(lang)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {lang === 'he' ? 'דלג לתוכן' : 'Skip to content'}
        </a>
        <Header lang={lang} />
        <main id="main" className="wrap">
          {children}
        </main>
        <Footer lang={lang} />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const lang = useLang();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <section className="message">
      <h1>{t(lang, notFound ? 'notFound' : 'error')}</h1>
      <p>{t(lang, notFound ? 'notFoundText' : 'errorText')}</p>
      <p>
        <Link to={href('/', lang)}>{t(lang, 'home')}</Link>
      </p>
    </section>
  );
}
