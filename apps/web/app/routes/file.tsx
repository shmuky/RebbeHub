import { data, Link } from 'react-router';
import type { Route } from './+types/file';
import { ItemList } from '../components/ItemLink.js';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, typeName } from '../lib/i18n.js';
import { SOURCE_NAMES, href } from '../lib/links.js';
import { count, ps } from '../lib/pageStrings.js';
import { pageMeta } from '../lib/seo.js';

/**
 * A file's own page (`/files/<sha256>`): a file is kept once, by its
 * sha256, whatever uses it. What it is, what its rights let the site do
 * with it (open it here, or only keep it), where it came from, what the
 * jobs made from it (a reading copy, page images, a cover) and measured in
 * it, and every item that uses it. Who uploaded it is not said.
 */

const RIGHTS: Record<string, { he: string; en: string }> = {
  open: { he: 'פתוח: מוצג ומותר להורדה', en: 'Open: shown, and free to download' },
  credit: { he: 'מוצג עם קרדיט', en: 'Shown, with credit' },
  link: { he: 'קישור בלבד: שמור אצלנו ואינו מוצג', en: 'Link only: kept here, not shown' },
  preserved: { he: 'שמור לשימור בלבד', en: 'Preserved only' },
};

const size = (bytes: number, lang: 'he' | 'en') => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: 1 })} ${units[unit]}`;
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  if (!/^[0-9a-f]{64}$/.test(params.sha256)) throw data('not found', { status: 404 });
  const file = await api.fileAbout(params.sha256, 200);
  if (!file) throw data('not found', { status: 404 });
  const covers = file.covers.length ? await api.entities(file.covers.map((c) => c.entity)) : new Map<string, Entity>();
  return { lang, siteUrl, file, coverItems: Object.fromEntries(covers) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'RebbeHub' }];
  const { file, lang, siteUrl } = loaderData;
  return pageMeta({ title: `${ps(lang, 'filePage')} ${file.sha256.slice(0, 12)}`, path: `/files/${file.sha256}`, lang, siteUrl, noindex: true });
}

export default function FilePage({ loaderData }: Route.ComponentProps) {
  const { lang, file, coverItems } = loaderData;
  const items = file.usedBy.items as Entity[];
  return (
    <article>
      <p className="kicker">{ps(lang, 'filePage')}</p>
      <h1>
        <code>{file.sha256.slice(0, 16)}…</code>
      </h1>
      <dl className="facts">
        <dt>sha256</dt>
        <dd>
          <code style={{ wordBreak: 'break-all' }}>{file.sha256}</code>
        </dd>
        <dt>{ps(lang, 'type')}</dt>
        <dd>{file.mime}</dd>
        <dt>{ps(lang, 'size')}</dt>
        <dd>{size(file.bytes, lang)}</dd>
        <dt>{ps(lang, 'rights')}</dt>
        <dd>
          {RIGHTS[file.rights]?.[lang] ?? file.rights}
          {file.credit ? ` · ${file.credit}` : ''}
        </dd>
        {file.measured ? (
          <>
            <dt>{ps(lang, 'measured')}</dt>
            <dd>
              {file.measured.pages ? `${count(file.measured.pages, lang)} ${ps(lang, 'pages')}` : ''}
              {file.measured.durationMs ? `${Math.round(file.measured.durationMs / 60000)} min` : ''}
              {file.pageImages ? ` · ${count(file.pageImages, lang)} ${ps(lang, 'pageImagesMade')}` : ''}
            </dd>
          </>
        ) : null}
      </dl>
      {file.url ? (
        <p>
          <a className="button" href={file.url} target="_blank" rel="noopener">
            {ps(lang, 'open')}
          </a>
        </p>
      ) : (
        <p className="row-sub">{ps(lang, 'notServed')}</p>
      )}

      <section>
        <h2>{ps(lang, 'usedBy')}</h2>
        {items.length ? <ItemList items={items} meta={(i) => typeName(i.type, lang)} /> : <p>{ps(lang, 'nothingHere')}</p>}
        {file.usedBy.total > items.length ? <p className="see-all">{`${ps(lang, 'showing')} ${count(items.length, lang)} ${ps(lang, 'of')} ${count(file.usedBy.total, lang)}`}</p> : null}
      </section>

      {file.covers.length ? (
        <section>
          <h2>{ps(lang, 'coverOf')}</h2>
          <ul className="list">
            {file.covers.map((c) => {
              const work = coverItems[c.entity] as Entity | undefined;
              return (
                <li key={c.entity}>
                  <Link to={href(work?.path ?? `/${c.entity}`, lang)}>
                    <span>{work ? String((work.data as { title?: { he?: string } }).title?.he ?? c.entity) : c.entity}</span>
                    <span className="meta">{`${ps(lang, 'pageNumber')} ${c.page} · ${c.machine ? ps(lang, 'coverMachine') : ps(lang, 'coverPerson')}`}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {file.sources.length ? (
        <section>
          <h2>{ps(lang, 'cameFrom')}</h2>
          <ul className="list">
            {file.sources.map((s, i) => {
              const body = (
                <>
                  <span>
                    {SOURCE_NAMES[s.source]?.[lang] ?? s.source}
                    {s.uploaded ? ` · ${ps(lang, 'uploadedBySomeone')}` : ''}
                  </span>
                  <span className="meta">{(s.fetchedAt ?? s.at).slice(0, 10)}</span>
                </>
              );
              return <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noopener">{body}</a> : <div className="row">{body}</div>}</li>;
            })}
          </ul>
        </section>
      ) : null}

      {file.derivations.length || file.derivedFrom.length ? (
        <section>
          <h2>{ps(lang, 'madeFrom')}</h2>
          <ul className="list">
            {file.derivedFrom.map((d) => (
              <li key={`from${d.sha256}${d.profile}`}>
                <Link to={href(`/files/${d.sha256}`, lang)}>
                  <span>{`${ps(lang, 'madeOf')} ${d.sha256.slice(0, 12)}`}</span>
                  <span className="meta">{d.profile}</span>
                </Link>
              </li>
            ))}
            {file.derivations.map((d) => (
              <li key={`to${d.sha256}${d.profile}`}>
                <Link to={href(`/files/${d.sha256}`, lang)}>
                  <span>{d.sha256.slice(0, 12)}</span>
                  <span className="meta">{`${d.profile} · ${d.encoder}`}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="row-sub">{ps(lang, 'machineNote')}</p>
        </section>
      ) : null}
    </article>
  );
}
