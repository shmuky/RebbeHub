import { Link } from 'react-router';
import type { Route } from './+types/developers';
import { siteOf } from '../lib/context.server.js';
import { DOC_GROUPS, DOC_ICONS, DocsShell, MachineLinks, OnThisPage, PrevNext, decorateDocHtml, docEntry, useDocsRoot, words } from '../components/DevDocs.js';
import { REPOSITORY, docPage } from '../lib/developerDocs.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import '../styles/pages/developers.css';

/**
 * The developer docs (/developers, /developers/<page>): the repository's
 * docs, one page each, beside the interactive reference. The words are
 * the files' own (English); the frame around them says so in the site's
 * language. The overview adds the pages as a map, and where agents read.
 */

const API_FALLBACK = 'https://api.rebbehub.org';

export function loader({ params, request, context }: Route.LoaderArgs) {
  const { siteUrl, api } = siteOf(context);
  const lang = langFrom(request);
  const page = docPage(params.page ?? '');
  if (!page) throw new Response('Not found', { status: 404 });
  const apiBase = /^https?:\/\//.test(api.baseUrl) ? api.baseUrl.replace(/\/+$/, '') : API_FALLBACK;
  // The title is the page's own first heading; the rest of the page follows it.
  const html = decorateDocHtml(page.html.replace(/^<h1 id="[^"]*">[\s\S]*?<\/h1>\n?/, ''));
  const title = page.headings.find((h) => h.depth === 1)?.text ?? page.title;
  return { lang, siteUrl, apiBase, page: { ...page, html }, title };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { page, lang, siteUrl } = loaderData;
  return pageMeta({ title: page.slug ? `${page.title} · ${words(lang).developers}` : words(lang).developers, description: page.summary, path: `/developers${page.slug ? `/${page.slug}` : ''}`, lang, siteUrl });
}

/** The overview's map of the docs: each group, each page with its line. */
function DocsMap({ lang }: { lang: 'he' | 'en' }) {
  return (
    <div className="dv-map">
      {DOC_GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className="dv-map-h">{group.title}</h2>
          <ul>
            {group.slugs
              .filter((slug) => slug !== '')
              .map((slug) => {
                const p = docEntry(slug)!;
                return (
                  <li key={slug}>
                    <Link to={href(`/developers/${slug}`, lang)}>
                      <Icon name={DOC_ICONS[slug] ?? 'file'} />
                      <span>
                        <b>{p.title}</b>
                        <span>{p.summary}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function Developers({ loaderData }: Route.ComponentProps) {
  const { lang, page, title, apiBase } = loaderData;
  const w = words(lang);
  const root = useDocsRoot<HTMLDivElement>(page.slug);
  const contents = page.headings.filter((h) => h.depth === 2 || h.depth === 3);
  const entry = docEntry(page.slug);
  const group = DOC_GROUPS.find((g) => g.slugs.includes(page.slug));
  return (
    <div ref={root}>
      <DocsShell lang={lang} current={page.slug} apiBase={apiBase} toc={<OnThisPage headings={contents} title="On this page" />}>
        <article className="dv-article">
          <header className="dv-head">
            <p className="dv-kicker">
              <Link to={href('/developers', lang)}>Developers</Link>
              {page.slug && group ? (
                <>
                  <Icon name="chevr" size={12} />
                  <span>{group.title}</span>
                </>
              ) : null}
            </p>
            <h1>{title}</h1>
            {page.slug && entry ? <p className="dv-lede">{entry.summary}.</p> : null}
          </header>

          {page.slug === '' ? (
            <div className="dv-start">
              <Link className="btn primary" to={href('/developers/getting-started', lang)}>
                Get started
                <Icon name="arrow" />
              </Link>
              <Link className="btn" to={href('/developers/reference', lang)}>
                <Icon name="code" />
                API reference
              </Link>
            </div>
          ) : null}

          <div className="dv-prose" dangerouslySetInnerHTML={{ __html: page.html }} />

          {page.slug === '' ? (
            <>
              <DocsMap lang={lang} />
              <section className="dv-agents">
                <h2 className="dv-map-h">For AI agents and machines</h2>
                <p>
                  Hand an agent <a href="/llms.txt">/llms.txt</a> (where everything is) or <a href="/llms-full.txt">/llms-full.txt</a> (every page here and every route, in one file), or connect it to the{' '}
                  <Link to={href('/developers/agents', lang)}>MCP server</Link>.
                </p>
                <MachineLinks apiBase={apiBase} />
              </section>
            </>
          ) : null}

          <footer className="dv-foot">
            <a className="dv-edit" href={`${REPOSITORY}/edit/main/${page.file}`} rel="noopener">
              <Icon name="pencil" />
              {w.edit}
            </a>
            <span className="subtle mono">{page.file}</span>
          </footer>
          <PrevNext lang={lang} current={page.slug} />
        </article>
      </DocsShell>
    </div>
  );
}
