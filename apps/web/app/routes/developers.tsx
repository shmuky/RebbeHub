import { Link } from 'react-router';
import type { Route } from './+types/developers';
import { siteOf } from '../lib/context.server.js';
import { DocsNav, words } from '../components/DevDocs.js';
import { DOC_PAGES, REPOSITORY, docPage } from '../lib/developerDocs.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The developer docs (/developers, /developers/<page>): the repository's
 * docs, one page each, beside the interactive reference. The words are
 * the files' own (English); the page around them follows the site's
 * language.
 */
export function loader({ params, request, context }: Route.LoaderArgs) {
  const { siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const page = docPage(params.page ?? '');
  if (!page) throw new Response('Not found', { status: 404 });
  return { lang, siteUrl, page };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { page, lang, siteUrl } = loaderData;
  return pageMeta({ title: page.slug ? `${page.title} · ${words(lang).developers}` : words(lang).developers, description: page.summary, path: `/developers${page.slug ? `/${page.slug}` : ''}`, lang, siteUrl });
}

export default function Developers({ loaderData }: Route.ComponentProps) {
  const { lang, page } = loaderData;
  const w = words(lang);
  const contents = page.headings.filter((h) => h.depth === 2);
  return (
    <div className="dev-docs">
      <p className="subtitle">
        <Link to={href('/developers', lang)}>{w.developers}</Link>
        {w.englishOnly ? ` · ${w.englishOnly}` : ''}
      </p>
      <DocsNav lang={lang} current={page.slug} />
      <article className="dev-docs-page" dir="ltr" lang="en">
        {contents.length > 2 ? (
          <details className="dev-docs-contents">
            <summary>{w.onThisPage}</summary>
            <ul>
              {contents.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div dangerouslySetInnerHTML={{ __html: page.html }} />
        {page.slug === '' ? (
          <ul className="dev-docs-index">
            {DOC_PAGES.filter((p) => p.slug).map((p) => (
              <li key={p.slug}>
                <Link to={`/developers/${p.slug}`}>{p.title}</Link> - {p.summary}
              </li>
            ))}
            <li>
              <Link to="/developers/reference">Interactive API reference</Link> - every route, with examples, tried from this page
            </li>
          </ul>
        ) : null}
        <p className="dev-docs-edit">
          <a href={`${REPOSITORY}/edit/main/${page.file}`} rel="noopener">
            {w.edit}
          </a>
        </p>
      </article>
    </div>
  );
}
