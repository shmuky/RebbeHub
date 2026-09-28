import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteLoaderData, type LinksFunction } from 'react-router';
import type { Route } from './+types/root';
import { dir, langFrom, t, type Lang } from './lib/i18n.js';
import { href } from './lib/links.js';
import { useLang } from './lib/useLang.js';
import { siteOf } from './lib/context.server.js';
import { AppNav } from './components/AppNav.js';
import { PlayerBar } from './player/PlayerBar.js';
import { PlayerProvider } from './player/PlayerProvider.js';
import './app.css';

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700&family=Noto+Sans+Hebrew:wght@400;600;700&family=Noto+Sans:wght@400;600;700&display=swap' },
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

function TopBar({ lang }: { lang: Lang }) {
  return (
    <header className="top-bar">
      <Link to={href('/', lang)} className="brand" aria-label={t(lang, 'home')}>
        <span className="brand-mark" aria-hidden="true">
          ר
        </span>
        <span className="brand-name">RebbeHub</span>
      </Link>
      <LanguageSwitch lang={lang} />
    </header>
  );
}

function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="site-footer">
      <div>
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
        <PlayerProvider>
          <div className="app">
            <AppNav lang={lang} />
            <div className="app-main">
              <TopBar lang={lang} />
              <main id="main" className="screen">
                {children}
              </main>
              <Footer lang={lang} />
            </div>
          </div>
          <div className="bottom-bars">
            <PlayerBar />
          </div>
        </PlayerProvider>
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
