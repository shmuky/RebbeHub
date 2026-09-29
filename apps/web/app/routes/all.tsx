import { data, Link } from 'react-router';
import type { Route } from './+types/all';
import { allHref } from '../components/Linked.js';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, typeName, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { count, groupName, ps } from '../lib/pageStrings.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { EmptyState, cx } from '../ui/primitives.js';
import { ItemSubpage } from '../views/ItemSubpage.js';
import '../styles/pages/info.css';

/**
 * All of what belongs to an item, one kind at a time: every sefer of a set,
 * every sicha of a sefer, every recording of a farbrengen, a page of 100 at
 * a time in its own order, with where the page is in the whole ("101–200
 * of 1,204"). Without a kind, the kinds, each with how many there are; with
 * one, the other kinds stay beside the list to move between them.
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

const TYPE_ICON: Record<string, IconName> = { work: 'book', unit: 'file', publication: 'book', scan: 'scan', recording: 'audio', event: 'cal', person: 'user', author: 'user', text: 'file', set: 'layers' };

/** What a row says at its end: a date, a part, a page range, whichever the item has. */
function rowMeta(item: Pick<Entity, 'type' | 'data'>, lang: Lang): string | null {
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
  const items = (page?.items ?? []) as Entity[];
  const title = field ? groupName(type ?? '', field, lang) : ps(lang, 'belongsHere');
  const where = page && page.total ? `${count(from + 1, lang)}–${count(from + items.length, lang)} ${ps(lang, 'of')} ${count(page.total, lang)}` : null;
  const kinds = (
    <ul className="box all-kinds">
      {groups.map((g) => {
        const on = g.field === field && (g.type ?? null) === (type ?? null);
        return (
          <li key={`${g.type}:${g.field}`}>
            <Link className={cx('row', on && 'current')} to={allHref(entity.id, g, lang)} aria-current={on ? 'page' : undefined}>
              <Icon name={TYPE_ICON[g.type] ?? 'layers'} />
              <span className="grow">{groupName(g.type, g.field, lang)}</span>
              <span className="num">{count(g.count, lang)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <ItemSubpage
      entity={entity}
      lang={lang}
      current="all"
      here={field ? title : ps(lang, 'belongsHere')}
      sub={field ? ps(lang, 'belongsHere') : undefined}
      narrowSide
      side={
        field && groups.length > 1 ? (
          <section>
            <h4>
              <Link to={href(`/all/${entity.id}`, lang)}>{ps(lang, 'belongsHere')}</Link>
            </h4>
            {kinds}
          </section>
        ) : undefined
      }
    >
      {!field ? (
        groups.length ? (
          kinds
        ) : (
          <EmptyState icon="layers" title={ps(lang, 'nothingHere')} />
        )
      ) : page && page.total ? (
        <>
          <div className="box">
            <div className="box-h">
              <Icon name={TYPE_ICON[type ?? ''] ?? 'layers'} />
              {title}
              <span className="end muted num" role="status">
                {where}
              </span>
            </div>
            <ol className="all-rows" start={from + 1}>
              {items.map((item, i) => (
                <li key={item.id}>
                  <Link className="row" to={href(itemPath(item), lang)}>
                    <span className="num all-n">{count(from + i + 1, lang)}</span>
                    <span className="grow row-title">{labelOf(item, lang)}</span>
                    <span className="row-end subtle">{rowMeta(item, lang)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
          {from > 0 || page.next ? (
            <nav className="pager all-pager" aria-label={ps(lang, 'pages')}>
              {from > 0 ? (
                <Link className="edge" to={href(`/all/${entity.id}`, lang, { field, type: type ?? undefined })}>
                  <Icon name="chevr" className="flip-ltr" size={14} />
                  {ps(lang, 'firstPage')}
                </Link>
              ) : null}
              {page.next ? (
                <Link className="edge" rel="next" to={href(`/all/${entity.id}`, lang, { field, type: type ?? undefined, after: page.next, from: String(from + items.length) })}>
                  {ps(lang, 'nextPage')}
                  <Icon name="chev" className="flip-ltr" size={14} />
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <EmptyState icon="layers" title={ps(lang, 'nothingHere')} />
      )}
    </ItemSubpage>
  );
}
