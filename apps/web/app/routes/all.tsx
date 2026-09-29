import { data, Link } from 'react-router';
import type { Route } from './+types/all';
import { ItemList } from '../components/ItemLink.js';
import { allHref } from '../components/Linked.js';
import { PageTabs } from '../components/PageTabs.js';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, typeName } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { count, groupName, ps } from '../lib/pageStrings.js';
import { pageMeta } from '../lib/seo.js';

/**
 * All of what belongs to an item, one kind at a time: every sefer of a set,
 * every sicha of a sefer, every recording of a farbrengen, a page of 100 at
 * a time in its own order, with where the page is in the whole ("101–200
 * of 1,204"). Without a kind, the kinds, each with how many there are.
 */

const PAGE = 100;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  const field = url.searchParams.get('field');
  const type = url.searchParams.get('type') ?? undefined;
  const groups = await api.linkedCounts(entity.id);
  if (!field) return { lang, siteUrl, entity, groups, field: null, type: null, page: null, from: 0 };
  const after = url.searchParams.get('after') ?? undefined;
  // How many came before this page, carried along so the page can say where it is.
  const from = Math.max(0, Number(url.searchParams.get('from') ?? 0) || 0);
  const page = await api.linked(entity.id, { field, type, after, limit: PAGE });
  return { lang, siteUrl, entity, groups, field, type: type ?? null, page, from };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'RebbeHub' }];
  const { entity, lang, siteUrl, field, type } = loaderData;
  const what = field ? groupName(type ?? '', field, lang) : ps(lang, 'belongsHere');
  return pageMeta({ title: `${what} · ${labelOf(entity as Entity, lang)}`, path: `/all/${entity.id}`, lang, siteUrl, noindex: Boolean(loaderData.page?.items.length === 0) });
}

/** What a row says at its end: a date, a part, a page range, whichever the item has. */
function rowMeta(item: Pick<Entity, 'type' | 'data'>, lang: 'he' | 'en'): string | null {
  const d = item.data as { date?: string; part?: number; pages?: { from: number; to: number }; page?: number };
  if (d.pages) return `${d.pages.from}–${d.pages.to}`;
  if (d.part) return `${ps(lang, 'part')} ${d.part}`;
  if (typeof d.page === 'number') return String(d.page);
  if (typeof d.date === 'string') return dateLabel(d.date, lang, { civil: false });
  return typeName(item.type, lang);
}

export default function All({ loaderData }: Route.ComponentProps) {
  const { lang, field, type, page, from, groups } = loaderData;
  const entity = loaderData.entity as Entity;
  const back = href(itemPath(entity), lang);
  const items = (page?.items ?? []) as Entity[];
  return (
    <article>
      <PageTabs entity={entity} lang={lang} current="page" />
      <ol className="breadcrumbs">
        <li>
          <Link to={back}>{labelOf(entity, lang)}</Link>
        </li>
        {field ? (
          <li>
            <Link to={href(`/all/${entity.id}`, lang)}>{ps(lang, 'belongsHere')}</Link>
          </li>
        ) : null}
      </ol>
      <h1>{field ? groupName(type ?? '', field, lang) : ps(lang, 'belongsHere')}</h1>
      {!field ? (
        groups.length ? (
          <ul className="list">
            {groups.map((g) => (
              <li key={`${g.type}:${g.field}`}>
                <Link to={allHref(entity.id, g, lang)}>
                  <span>{groupName(g.type, g.field, lang)}</span>
                  <span className="meta">{count(g.count, lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>{ps(lang, 'nothingHere')}</p>
        )
      ) : page && page.total ? (
        <>
          <p className="subtitle" role="status">
            {`${count(from + 1, lang)}–${count(from + items.length, lang)} ${ps(lang, 'of')} ${count(page.total, lang)}`}
          </p>
          <ItemList items={items} meta={(item) => rowMeta(item, lang)} />
          <div className="pager">
            {from > 0 ? (
              <Link className="button secondary" to={href(`/all/${entity.id}`, lang, { field, type: type ?? undefined })}>
                {ps(lang, 'firstPage')}
              </Link>
            ) : null}
            {page.next ? (
              <Link className="button secondary" to={href(`/all/${entity.id}`, lang, { field, type: type ?? undefined, after: page.next, from: String(from + items.length) })}>
                {ps(lang, 'nextPage')}
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <p>{ps(lang, 'nothingHere')}</p>
      )}
    </article>
  );
}
