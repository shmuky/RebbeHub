import { Link } from 'react-router';
import type { Route } from './+types/sets';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, setPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  return { lang: langFrom(request), siteUrl, sets: (await api.list({ type: 'set', limit: 500 })).items };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'tabLibrary'), path: '/sets', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export default function Sets({ loaderData }: Route.ComponentProps) {
  const { lang, sets } = loaderData;
  return (
    <>
      <h1>{t(lang, 'tabLibrary')}</h1>
      <ul className="cards">
        {sets.map((set) => (
          <li key={set.id}>
            <Link className="card" to={href(setPath(set), lang)}>
              <span className="card-title">{labelOf(set, lang)}</span>
              {(set.data as { description?: { he: string; en?: string } }).description ? <span className="card-meta">{nameOf((set.data as { description?: { he: string; en?: string } }).description, lang)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
