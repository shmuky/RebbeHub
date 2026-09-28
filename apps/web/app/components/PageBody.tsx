import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { Wikitext } from './Wikitext.js';

interface BodySource {
  source: string;
  via?: string;
  url?: string;
  copy?: string;
  licence?: string;
  credit?: string;
  importedAt?: string;
}

/** The page's own words (its wikitext body), and, when an importer brought them, the record of where from. */
export function PageBody({ entity, lang }: { entity: Pick<Entity, 'data'>; lang: Lang }) {
  const d = entity.data as { body?: string; bodySource?: BodySource };
  if (!d.body?.trim()) return null;
  const s = d.bodySource;
  return (
    <section className="page-body">
      <Wikitext text={d.body} lang={lang} />
      {s ? (
        <p className="body-source row-sub">
          {t(lang, 'importedFrom')} <b>{s.via ?? s.source}</b>
          {s.credit ? ` · ${s.credit}` : ''}
          {s.licence ? ` · ${s.licence}` : ''}
          {s.url ? (
            <>
              {' · '}
              <a href={s.url} target="_blank" rel="noopener">
                {t(lang, 'atTheSource')}
              </a>
            </>
          ) : null}
          {s.copy ? (
            <>
              {' · '}
              <a href={s.copy} target="_blank" rel="noopener">
                {t(lang, 'keptCopy')}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
