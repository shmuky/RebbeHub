import type { Route } from './+types/llms';
import { accessLabel, operationsOf, type OpenApiDocument } from '../lib/apiExamples.js';
import { siteOf } from '../lib/context.server.js';
import { DOC_PAGES, docSource } from '../lib/developerDocs.js';

/**
 * For AI agents (llmstxt.org): /llms.txt says in a page what RebbeHub is
 * and where everything is; /llms-full.txt is every developer page and the
 * API's routes in one file, to hand an agent as context. Both are made
 * from the same docs and OpenAPI document as /developers.
 */

const API_FALLBACK = 'https://api.rebbehub.org';

export function llmsTxt(site: string, api: string): string {
  const pages = DOC_PAGES.map((p) => `- [${p.title}](${site}/developers${p.slug ? `/${p.slug}` : ''}): ${p.summary}`).join('\n');
  return `# RebbeHub

> The open, community-edited index of Chabad Torah and media: every sefer and printing, every sicha and letter, every farbrengen and recording, with scans and texts, from the Baal Shem Tov to today. Everything is readable without an account through a public API, and every change is a suggestion that people review, like a pull request (comments, reviews, #12 numbers). Problems are reported as issues (labels, assignees; public except reports of rights or of something offensive), and people have handles (@mendy) to mention and an inbox.

Ids (rh-7k2m9q4d) are permanent; paths (/likkutei-sichos/12/3, /events/5742-05-10) are readable and may move. Dates are Hebrew date keys (5742-05-10 is 10 Shevat 5742; months count from Tishrei). Names are { he, en }. Words a machine read (OCR) or heard (transcription) are marked (checked: false, machine: true, origin) until a person checks them: say so when you quote them. Words whose rights forbid copies are listed but withheld.

## API

- [OpenAPI 3.1](${api}/openapi.json): every route
- [Interactive reference](${site}/developers/reference)
- [MCP server](${api}/mcp): Streamable HTTP, tools search, get_item, list_children, get_text, suggest_fix, list_issues, open_issue. Reading needs no account; suggesting and opening issues need the person's account with the write scope: the server answers 401 with WWW-Authenticate so clients connect with OAuth (the person approves on rebbehub.org), or send a personal token (Authorization: Bearer rhp_…)
- [Everything in one file](${site}/llms-full.txt)

## Docs

${pages}

## Optional

- [Download and mirror](${site}/mirrors): the whole catalog as signed dumps
- [Source code](https://github.com/shmuky/RebbeHub) (AGPL-3.0)
`;
}

export async function llmsFullTxt(site: string, api: string, doc: OpenApiDocument | null): Promise<string> {
  const parts = [llmsTxt(site, api)];
  for (const page of DOC_PAGES) {
    const source = docSource(page.file);
    if (source) parts.push(`\n---\n\n<!-- ${site}/developers${page.slug ? `/${page.slug}` : ''} (${page.file}) -->\n\n${source.trim()}\n`);
  }
  if (doc) {
    const ops = operationsOf(doc).filter((o) => o.access !== 'site');
    const lines = ops.map((o) => {
      const params = o.params.map((p) => `${p.name}${p.required ? '' : '?'} (${p.in})`).join(', ');
      return `- \`${o.method} ${o.path}\` ${o.id}: ${o.summary}. ${accessLabel(o)}.${params ? ` Parameters: ${params}.` : ''}${o.body ? ' Takes a JSON body.' : ''}${o.paged ? ' Paged (cursor).' : ''}`;
    });
    parts.push(`\n---\n\n# Every route (${doc.info.title} ${doc.info.version}, ${api})\n\n${lines.join('\n')}\n`);
  }
  return parts.join('');
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const site = siteUrl.replace(/\/+$/, '');
  const apiBase = /^https?:\/\//.test(api.baseUrl) ? api.baseUrl.replace(/\/+$/, '') : API_FALLBACK;
  const full = new URL(request.url).pathname.endsWith('llms-full.txt');
  const body = full ? await llmsFullTxt(site, apiBase, await api.openapi<OpenApiDocument>().catch(() => null)) : llmsTxt(site, apiBase);
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
