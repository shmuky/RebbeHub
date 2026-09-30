import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('search', 'routes/search.tsx'),
  route('sets', 'routes/sets.tsx'),
  route('calendar/:year?/:month?', 'routes/calendar.tsx'),
  // The day's learning: Chitas' Tanya and Hayom Yom, today or any day (`/daily/2026-09-30`).
  route('daily/:date?', 'routes/daily.tsx'),
  route('about', 'routes/about.tsx'),
  // Asking for a file to stop being served (rights holders, families): no account needed.
  route('takedown', 'routes/takedown.tsx'),
  route('help', 'routes/help.tsx'),
  route('history/:id', 'routes/history.tsx'),
  // Every page's talk page and its editing, beside its history (the wiki model).
  route('talk/:id', 'routes/talk.tsx'),
  route('edit/:id', 'routes/edit.tsx'),
  // A sefer's shaar file, the README of a sefer (docs/shaar.md): the file as it is written, and its editor.
  route('shaar/:id', 'routes/shaar.tsx'),
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
  // What the command palette finds as one types.
  route('_/find', 'routes/find.ts'),
  route('_/steward/*', 'routes/admin-pass.ts'),
  // People and conversations: @mentions, #numbers, reviews, issues and the inbox.
  route('_/threads/*', 'routes/threads-pass.ts'),
  // Organizing the catalog: moving, renaming, ordering and merging, as one suggestion.
  route('organize', 'routes/organize.tsx'),
  route('_/organize/*', 'routes/organize-pass.ts'),
  route('admin', 'routes/admin.tsx'),
  route('review', 'routes/review.tsx'),
  // What the machines (OCR, transcription) wrote that nobody checked yet, the newest first: the home page links to it.
  route('check', 'routes/check.tsx'),
  route('mafteach', 'routes/mafteach.tsx'),
  route('missing', 'routes/missing.tsx'),
  route('health', 'routes/health.tsx'),
  // Whether the site, the API, the MCP server and the database are up, from the API's checks every five minutes.
  route('status', 'routes/status.tsx'),
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
  // Connecting an app (Claude, another MCP client) to your account: the API's OAuth sends you here to say yes or no.
  route('oauth/consent', 'routes/oauth-consent.tsx'),
  route('_/oauth/*', 'routes/oauth-pass.ts'),
  // Suggestions as conversations and Reports as Issues, numbered together (#12), like pull requests and issues.
  route('suggestions', 'routes/suggestions-list.tsx'),
  route('suggestions/:number', 'routes/suggestion.tsx'),
  route('issues', 'routes/issues.tsx'),
  route('issues/new', 'routes/issue-new.tsx'),
  route('issues/:number', 'routes/issue.tsx'),
  // A person's page by their handle, and what is waiting for the signed-in person.
  route('u/:username', 'routes/profile.tsx'),
  route('inbox', 'routes/inbox.tsx'),
  // Your settings, a page for each part (profile, signing in, email, following, AI apps, developers), as GitHub's are.
  route('account/:section?', 'routes/account.tsx'),
  // Connecting Claude, ChatGPT or another AI app to RebbeHub, for anyone: copy one address, say yes.
  route('connect', 'routes/connect.tsx'),
  // For developers and AI agents: the docs, the interactive API reference, and llms.txt.
  route('developers/reference', 'routes/developers-reference.tsx'),
  route('developers/:page?', 'routes/developers.tsx'),
  route('llms.txt', 'routes/llms.ts', { id: 'llms' }),
  route('llms-full.txt', 'routes/llms.ts', { id: 'llms-full' }),
  route('robots.txt', 'routes/robots.ts'),
  // Where to report a security problem, and the site as a search engine of the browser's own.
  route('.well-known/security.txt', 'routes/security-txt.ts'),
  route('opensearch.xml', 'routes/opensearch.ts'),
  route('sitemap.xml', 'routes/sitemap-index.ts'),
  // Sitemaps: the site's own pages, and each kind of item a page at a time (`/sitemaps/unit-3.xml`).
  route('sitemaps/:name.xml', 'routes/sitemap.ts'),
  // Every item has a readable path (`/likkutei-sichos/12/3`) and a permanent one (`/rh-7k2m9q4d`).
  route('*', 'routes/item.tsx'),
] satisfies RouteConfig;
