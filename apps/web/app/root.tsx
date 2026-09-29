import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useRouteLoaderData, type LinksFunction } from 'react-router';
import type { Route } from './+types/root';
import { dir, langFrom, t, type Lang } from './lib/i18n.js';
import { tu } from './lib/i18nUi.js';
import { href } from './lib/links.js';
import { useLang } from './lib/useLang.js';
import { siteOf } from './lib/context.server.js';
import { PlayerBar } from './player/PlayerBar.js';
import { PlayerProvider } from './player/PlayerProvider.js';
import { useServiceWorker } from './lib/pwa.js';
import { Header } from './ui/Header.js';
import { Footer } from './ui/Footer.js';
import { ToastProvider } from './ui/Toast.js';
import { EmptyState } from './ui/primitives.js';
import { THEME_SCRIPT } from './ui/theme.js';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/items.css';
import './styles/pages/farbrengen.css';

export const links: LinksFunction = () => [
  // Sichos-Kodesh's faces, self-hosted (styles/fonts.css): the UI's two are fetched early, the rest when used.
  { rel: 'preload', href: '/fonts/noto-sans-hebrew-400.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: '/fonts/noto-sans-hebrew-700.woff2', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  // Installable as an app, with an offline shell (public/sw.js, registered in lib/pwa.ts).
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const lang = langFrom(request);
  return { lang, siteUrl: siteOf(context).siteUrl };
}

export function headers() {
  // Pages change when the catalog does; let caches keep them briefly and serve stale while refreshing.
  // No other site may frame them (sign-in and review among them); /embed says otherwise for itself.
  return { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600', 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData('root') as { lang?: Lang } | undefined;
  const lang = data?.lang ?? 'he';
  // An embed is the item alone, in another site's frame: no menus, no player bar.
  const embedded = useLocation().pathname.startsWith('/embed/');
  useServiceWorker(!embedded);
  return (
    <html lang={lang} dir={dir(lang)}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#15171a" media="(prefers-color-scheme: dark)" />
        {/* The reader's own light or dark, set before anything is drawn. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body className={embedded ? 'embedded' : undefined}>
        {embedded ? (
          <main id="main">{children}</main>
        ) : (
          <ToastProvider>
            <a className="skip-link" href="#main">
              {tu(lang, 'skip')}
            </a>
            <PlayerProvider>
              <Header lang={lang} />
              <main id="main">{children}</main>
              <Footer lang={lang} />
              <PlayerBar />
            </PlayerProvider>
          </ToastProvider>
        )}
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
    <div className="wrap narrow page">
      <div className="box error-box">
        <EmptyState
          icon={notFound ? 'search' : 'warn'}
          title={<span className="message-title">{t(lang, notFound ? 'notFound' : 'error')}</span>}
          actions={
            <>
              <Link className="btn primary" to={href('/', lang)}>
                {t(lang, 'home')}
              </Link>
              <Link className="btn" to={href('/search', lang)}>
                {tu(lang, 'searchShort')}
              </Link>
            </>
          }
        >
          {t(lang, notFound ? 'notFoundText' : 'errorText')}
        </EmptyState>
      </div>
    </div>
  );
}
