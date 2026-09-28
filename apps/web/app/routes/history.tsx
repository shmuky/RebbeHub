import { data, Link } from 'react-router';
import type { Route } from './+types/history';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/** Who changed an item, when, and who approved it: every version is kept. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang, siteUrl, entity, history: await api.history(entity.id) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${t(lang, 'history')}: ${labelOf(entity, lang)}`, path: `/history/${entity.id}`, lang, siteUrl, noindex: true });
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { lang, entity, history } = loaderData;
  const when = (at: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
  return (
    <>
      <ol className="breadcrumbs">
        <li>
          <Link to={href(itemPath(entity), lang)}>{labelOf(entity, lang)}</Link>
        </li>
      </ol>
      <h1>
        {t(lang, 'historyOf')} {labelOf(entity, lang)}
      </h1>
      <ul className="list">
        {history.map((h) => (
          <li key={h.commit}>
            <div className="row">
              <span>
                <strong>{h.message}</strong>
                <br />
                <span className="card-meta">
                  {t(lang, 'changedBy')} {h.author}
                  {h.mergedBy !== h.author ? `, ${t(lang, 'approvedBy')} ${h.mergedBy}` : ''}
                </span>
              </span>
              <span className="meta">
                {when(h.at)} · {t(lang, 'version')} {h.rev}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
