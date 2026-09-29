import { Link } from 'react-router';
import type { Entity, LinkGroup } from '../lib/api.js';
import { SOURCE_NAMES, href, shortLabel, sourceUrl } from '../lib/links.js';
import type { Lang } from '../lib/i18n.js';
import { count, groupName, ps } from '../lib/pageStrings.js';

/**
 * What every item's page ends with: everything that points at it, a line
 * for each kind with how many there are, each leading to the whole list a
 * page at a time (routes/all.tsx). So a set lists every sefer, a sefer
 * every printing, a farbrengen every recording and hanacha, and no list on
 * the page above ends without saying how much more there is. Links both
 * ways are Relations' to show, so they are left out here.
 */

/** Groups the page shows in full elsewhere, or that are not a reader's (sync spans). */
const HIDDEN = new Set(['relation', 'alignment-span', 'schema']);

export const allHref = (id: string, group: Pick<LinkGroup, 'field' | 'type'>, lang: Lang) => href(`/all/${id}`, lang, { field: group.field, type: group.type });

export function Linked({ entity, groups, lang }: { entity: Pick<Entity, 'id'>; groups: LinkGroup[]; lang: Lang }) {
  const shown = groups.filter((g) => !HIDDEN.has(g.type) && g.count > 0);
  if (!shown.length) return null;
  return (
    <section className="linked">
      <h2>{ps(lang, 'belongsHere')}</h2>
      <ul className="list">
        {shown.map((g) => (
          <li key={`${g.type}:${g.field}`}>
            <Link to={allHref(entity.id, g, lang)}>
              <span>{groupName(g.type, g.field, lang)}</span>
              <span className="meta">{count(g.count, lang)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "All 1,204": the line under a list the page shows only the start of. */
export function SeeAll({ id, group, shown, lang }: { id: string; group: LinkGroup | undefined; shown: number; lang: Lang }) {
  if (!group || group.count <= shown) return null;
  return (
    <p className="see-all">
      <Link to={allHref(id, group, lang)}>
        {ps(lang, 'showing')} {count(shown, lang)} {ps(lang, 'of')} {count(group.count, lang)} · {ps(lang, 'listedHere')}
      </Link>
    </p>
  );
}

type SourceRef = { source: string; sourceId?: string; url?: string; fetchedAt?: string; note?: unknown };

/** Where an item came from (its `sources`), and what it is called elsewhere (`externalIds`), as links where the address is known. */
export function Sources({ data, lang }: { data: Record<string, unknown>; lang: Lang }) {
  const sources = (Array.isArray(data.sources) ? data.sources : []) as SourceRef[];
  const external = Object.entries((data.externalIds ?? {}) as Record<string, string>);
  if (!sources.length && !external.length) return null;
  const name = (source: string) => SOURCE_NAMES[source]?.[lang] ?? source;
  return (
    <section className="sources">
      <h2>{ps(lang, 'sources')}</h2>
      <ul className="list">
        {sources.map((s, i) => {
          const link = s.url ?? (s.sourceId ? sourceUrl({ source: s.source, sourceId: s.sourceId }) : null);
          // A long id or address (a Drive folder's link) is shown short; the whole of it stays in the link and its title.
          const body = (
            <>
              <span className="src-name">
                {name(s.source)}
                {s.sourceId ? <span className="src-id">
                    {' · '}
                    <bdi dir="ltr">{shortLabel(s.sourceId)}</bdi>
                  </span> : null}
              </span>
              {s.fetchedAt ? <span className="meta">{`${ps(lang, 'fetched')} ${s.fetchedAt.slice(0, 10)}`}</span> : null}
            </>
          );
          const title = link ?? s.sourceId;
          return (
            <li key={`s${i}`}>
              {link ? (
                <a href={link} target="_blank" rel="noopener" title={title}>
                  {body}
                </a>
              ) : (
                <div className="row" title={title}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
        {external.map(([source, id]) => {
          const link = sourceUrl({ source, sourceId: id });
          const body = (
            <>
              <span className="src-name">{name(source)}</span>
              <span className="meta src-id" dir="ltr">
                {shortLabel(String(id))}
              </span>
            </>
          );
          return (
            <li key={`x${source}`}>
              {link ? (
                <a href={link} target="_blank" rel="noopener" title={link}>
                  {body}
                </a>
              ) : (
                <div className="row" title={String(id)}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
