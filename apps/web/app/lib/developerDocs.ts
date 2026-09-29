import { renderMarkdown } from './markdown.js';

/**
 * The developer docs (/developers): the repository's own docs/*.md, built
 * into the site so the pages and the files never differ. A page here is a
 * file there; the rest of docs/ opens on GitHub.
 */

const FILES = import.meta.glob('../../../../docs/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const REPOSITORY = 'https://github.com/shmuky/RebbeHub';

export interface DocPage {
  slug: string;
  /** The file, from the repository's root. */
  file: string;
  title: string;
  /** One line, for the list of pages and llms.txt. */
  summary: string;
}

/** The pages, in reading order. */
export const DOC_PAGES: readonly DocPage[] = [
  { slug: '', file: 'docs/developers/index.md', title: 'Overview', summary: 'What the API, the dumps and the agent tools offer, and the promises they keep' },
  { slug: 'getting-started', file: 'docs/developers/getting-started.md', title: 'Getting started', summary: 'Your first requests, in curl and TypeScript' },
  { slug: 'auth', file: 'docs/developers/auth.md', title: 'Tokens and signing in', summary: 'Personal API tokens, their scopes, and what a token may never do' },
  { slug: 'api', file: 'docs/developers/api.md', title: 'Conventions', summary: 'Stability, errors, pages and cursors, caching, CORS' },
  { slug: 'endpoints', file: 'docs/api.md', title: 'The endpoints', summary: 'A guide to the routes, by what they are for' },
  { slug: 'suggestions', file: 'docs/developers/suggestions.md', title: 'Sending suggestions', summary: 'How a change is made through the API, checked and reviewed' },
  { slug: 'data-model', file: 'docs/data-model.md', title: 'The data model', summary: 'Every kind of item, ids and paths, Hebrew dates, order' },
  { slug: 'rights', file: 'docs/rights.md', title: 'Rights', summary: 'What may be served and copied, and what is only listed' },
  { slug: 'rate-limits', file: 'docs/developers/rate-limits.md', title: 'Rate limits', summary: 'How much, per address and per token, and being a good citizen' },
  { slug: 'webhooks', file: 'docs/developers/webhooks.md', title: 'Webhooks', summary: 'Every approved change posted to you, signed' },
  { slug: 'dumps', file: 'docs/mirrors.md', title: 'Dumps and mirrors', summary: 'The whole catalog: signed editions, the git mirror, running a mirror' },
  { slug: 'oai-pmh', file: 'docs/developers/oai-pmh.md', title: 'OAI-PMH and IIIF', summary: 'For libraries: Dublin Core records, and IIIF manifests of scans' },
  { slug: 'agents', file: 'docs/developers/agents.md', title: 'AI agents', summary: 'llms.txt and the MCP server: search, read and suggest' },
  { slug: 'client', file: 'docs/developers/client.md', title: 'TypeScript client', summary: '@rebbehub/client, generated from the OpenAPI document' },
];

/** A file's text, by its path from the repository's root. */
export function docSource(file: string): string | null {
  const key = Object.keys(FILES).find((k) => k.replace(/^(\.\.\/)+/, '') === file);
  return key ? FILES[key]! : null;
}

/** docs/a/b.md and ../c.md, as seen from `from`, resolved from the repository's root. */
function resolveFrom(from: string, href: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const piece of href.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.' && piece !== '') parts.push(piece);
  }
  return parts.join('/');
}

/** Where a link in a doc goes on the site: a page of these docs, the site itself, or the file on GitHub. */
export function linkFor(from: string, href: string): string {
  if (/^(https?:|mailto:|#)/.test(href) || href.startsWith('/')) return href;
  const [path, hash] = href.split('#');
  const file = resolveFrom(from, path!);
  const page = DOC_PAGES.find((p) => p.file === file);
  if (page) return `/developers${page.slug ? `/${page.slug}` : ''}${hash ? `#${hash}` : ''}`;
  return `${REPOSITORY}/blob/main/${file}${hash ? `#${hash}` : ''}`;
}

export function docPage(slug: string): (DocPage & { html: string; headings: Array<{ depth: number; text: string; id: string }> }) | null {
  const page = DOC_PAGES.find((p) => p.slug === slug);
  const source = page ? docSource(page.file) : null;
  if (!page || source === null) return null;
  const { html, headings } = renderMarkdown(source, { link: (href) => linkFor(page.file, href) });
  return { ...page, html, headings };
}
