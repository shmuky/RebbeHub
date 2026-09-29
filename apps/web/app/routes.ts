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
  // Where you stopped reading and listening, and translations sent for review.
  route('_/places', 'routes/places.ts'),
  route('_/translations/*', 'routes/translations-pass.ts'),
  route('_/uploads/check', 'routes/uploads-check.ts'),
  route('_/uploads/propose', 'routes/uploads-propose.ts'),
  route('_/hanachos/text', 'routes/hanachos-text.ts'),
  // Adding what the catalog lacks (a hanacha, a recording, a sefer), guided; all that belongs to an item, a page at a time; a file's own page.
  route('add', 'routes/add.tsx'),
  route('all/:id', 'routes/all.tsx'),
  route('files/:sha256', 'routes/file.tsx'),
  route('_/lookup', 'routes/lookup.ts'),
  route('_/steward/*', 'routes/admin-pass.ts'),
  // People and conversations: @mentions, #numbers, reviews, issues and the inbox.
  route('_/threads/*', 'routes/threads-pass.ts'),
  route('admin', 'routes/admin.tsx'),
  route('review', 'routes/review.tsx'),
  route('missing', 'routes/missing.tsx'),
  route('health', 'routes/health.tsx'),
  // Reading a PDF in the site, the player still playing.
  route('read', 'routes/read.tsx'),
  // What other sites embed: the only page they may frame.
  route('embed/:id', 'routes/embed.tsx'),
  route('text/:scan', 'routes/text.tsx'),
  route('compare/:unit', 'routes/compare.tsx'),
  route('projects', 'routes/projects.tsx'),
  // How to keep a full copy of the catalog: the git mirror, every edition's dumps with their checksums.
  route('mirrors', 'routes/mirrors.tsx'),
  route('projects/:slug', 'routes/project.tsx'),
  route('signin', 'routes/signin.tsx'),
  // Suggestions as conversations and Reports as Issues, numbered together (#12), like pull requests and issues.
  route('suggestions', 'routes/suggestions-list.tsx'),
  route('suggestions/:number', 'routes/suggestion.tsx'),
  route('issues', 'routes/issues.tsx'),
  route('issues/new', 'routes/issue-new.tsx'),
  route('issues/:number', 'routes/issue.tsx'),
  // A person's page by their handle, and what is waiting for the signed-in person.
  route('u/:username', 'routes/profile.tsx'),
  route('inbox', 'routes/inbox.tsx'),
  route('account', 'routes/account.tsx'),
  // For developers and AI agents: the docs, the interactive API reference, and llms.txt.
  route('developers/reference', 'routes/developers-reference.tsx'),
  route('developers/:page?', 'routes/developers.tsx'),
  route('llms.txt', 'routes/llms.ts', { id: 'llms' }),
  route('llms-full.txt', 'routes/llms.ts', { id: 'llms-full' }),
  route('robots.txt', 'routes/robots.ts'),
  route('sitemap.xml', 'routes/sitemap-index.ts'),
  route('sitemaps/:type.xml', 'routes/sitemap.ts'),
  // Every item has a readable path (`/likkutei-sichos/12/3`) and a permanent one (`/rh-7k2m9q4d`).
  route('*', 'routes/item.tsx'),
] satisfies RouteConfig;
