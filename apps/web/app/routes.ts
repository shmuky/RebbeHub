import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('search', 'routes/search.tsx'),
  route('sets', 'routes/sets.tsx'),
  route('calendar/:year?/:month?', 'routes/calendar.tsx'),
  route('about', 'routes/about.tsx'),
  // Asking for a file to stop being served (rights holders, families): no account needed.
  route('takedown', 'routes/takedown.tsx'),
  route('help', 'routes/help.tsx'),
  route('history/:id', 'routes/history.tsx'),
  // Every page's talk page and its editing, beside its history (the wiki model).
  route('talk/:id', 'routes/talk.tsx'),
  route('edit/:id', 'routes/edit.tsx'),
  // A farbrengen's recordings as the player's queue, for play buttons on lists. `_` is never in an item's path.
  route('_/tracks/:id', 'routes/tracks.ts'),
  // Sign-in, passed through to the API's /v1/auth/* so the session cookie is the site's own.
  route('_/auth/*', 'routes/auth.ts'),
  // Suggestions and their review, passed through the same way.
  route('_/suggestions/*', 'routes/suggestions.ts'),
  route('_/follows', 'routes/follows.ts'),
  route('_/uploads', 'routes/uploads.ts'),
  route('_/steward/*', 'routes/admin-pass.ts'),
  route('admin', 'routes/admin.tsx'),
  route('review', 'routes/review.tsx'),
  route('missing', 'routes/missing.tsx'),
  route('health', 'routes/health.tsx'),
  // Reading a PDF in the site, the player still playing.
  route('read', 'routes/read.tsx'),
  // What other sites embed: the only page they may frame.
  route('embed/:id', 'routes/embed.tsx'),
  route('text/:scan', 'routes/text.tsx'),
  route('projects', 'routes/projects.tsx'),
  route('projects/:slug', 'routes/project.tsx'),
  route('signin', 'routes/signin.tsx'),
  route('account', 'routes/account.tsx'),
  route('robots.txt', 'routes/robots.ts'),
  route('sitemap.xml', 'routes/sitemap-index.ts'),
  route('sitemaps/:type.xml', 'routes/sitemap.ts'),
  // Every item has a readable path (`/likkutei-sichos/12/3`) and a permanent one (`/rh-7k2m9q4d`).
  route('*', 'routes/item.tsx'),
] satisfies RouteConfig;
