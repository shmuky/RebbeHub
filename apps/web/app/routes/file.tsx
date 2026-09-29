import { data, Link } from 'react-router';
import type { Route } from './+types/file';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, typeName, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { SOURCE_NAMES, href, itemPath } from '../lib/links.js';
import { count, ps } from '../lib/pageStrings.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, Breadcrumbs, EmptyState, Label, MachineLabel } from '../ui/primitives.js';
import '../styles/pages/info.css';

/**
 * A file's own page (`/files/<sha256>`): a file is kept once, by its
 * sha256, whatever uses it. What it is, what its rights let the site do
 * with it (open it here, or only keep it), where it came from, what the
 * jobs made from it (a reading copy, page images, a cover - a machine's
 * work, said so) and measured in it, and every item that uses it. Who
 * uploaded it is not said.
 */

const RIGHTS: Record<string, { he: string; en: string; tone: 'sync' | 'text' | 'scan' | 'meta' }> = {
  open: { he: 'פתוח: מוצג ומותר להורדה', en: 'Open: shown, and free to download', tone: 'sync' },
  credit: { he: 'מוצג עם קרדיט', en: 'Shown, with credit', tone: 'text' },
  link: { he: 'קישור בלבד: שמור אצלנו ואינו מוצג', en: 'Link only: kept here, not shown', tone: 'scan' },
  preserved: { he: 'שמור לשימור בלבד', en: 'Preserved only', tone: 'meta' },
};

const W = {
  pdf: { he: 'קובץ PDF', en: 'PDF file' },
  audio: { he: 'קובץ שמע', en: 'Audio file' },
  image: { he: 'תמונה', en: 'Image' },
  text: { he: 'קובץ טקסט', en: 'Text file' },
  other: { he: 'קובץ', en: 'File' },
  details: { he: 'פרטים', en: 'Details' },
  credit: { he: 'קרדיט', en: 'Credit' },
  kept: { he: 'נשמר פעם אחת, לפי טביעת האצבע שלו (sha256), מה שלא יהיה המשתמש בו.', en: 'Kept once, by its fingerprint (sha256), whatever uses it.' },
  minutes: { he: 'דק׳', en: 'min' },
  nothingUses: { he: 'אף פריט עוד לא משתמש בקובץ הזה.', en: 'No item uses this file yet.' },
} as const;

const size = (bytes: number, lang: Lang) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: 1 })} ${units[unit]}`;
};

const kindOf = (mime: string): { word: keyof typeof W; icon: IconName } =>
  mime === 'application/pdf' ? { word: 'pdf', icon: 'file' } : mime.startsWith('audio/') ? { word: 'audio', icon: 'audio' } : mime.startsWith('image/') ? { word: 'image', icon: 'scan' } : mime.startsWith('text/') ? { word: 'text', icon: 'file' } : { word: 'other', icon: 'file' };

const TYPE_ICON: Record<string, IconName> = { work: 'book', unit: 'file', publication: 'book', scan: 'scan', recording: 'audio', event: 'cal', text: 'file' };

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
  const kind = kindOf(file.mime);
  const rights = RIGHTS[file.rights];
  const measured = [
    file.measured?.pages ? `${count(file.measured.pages, lang)} ${ps(lang, 'pages')}` : null,
    file.measured?.durationMs ? `${count(Math.round(file.measured.durationMs / 60000), lang)} ${W.minutes[lang]}` : null,
    file.pageImages ? `${count(file.pageImages, lang)} ${ps(lang, 'pageImagesMade')}` : null,
  ].filter(Boolean);
  return (
    <>
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs items={[{ label: ps(lang, 'filePage') }, { label: <span className="mono">{file.sha256.slice(0, 12)}</span> }]} lang={lang} />
          <div className="phead-row">
            <div>
              <h1 className="page-title">
                {W[kind.word][lang]} <span className="num mono file-sha" dir="ltr">{`${file.sha256.slice(0, 16)}…`}</span>
              </h1>
              <div className="facts-row">
                <span>
                  <Icon name={kind.icon} className="subtle" />
                  <b>{file.mime}</b>
                </span>
                <span>
                  <Icon name="database" className="subtle" />
                  <b dir="ltr">{size(file.bytes, lang)}</b>
                </span>
                {measured.length ? (
                  <span>
                    <Icon name="layers" className="subtle" />
                    {measured.join(' · ')}
                  </span>
                ) : null}
                <span>
                  <Icon name="shield" className="subtle" />
                  {rights ? <Label tone={rights.tone}>{rights[lang]}</Label> : file.rights}
                </span>
              </div>
            </div>
            <div className="phead-acts">
              {file.url ? (
                <a className="btn primary" href={file.url} target="_blank" rel="noopener">
                  <Icon name="external" />
                  {ps(lang, 'open')}
                </a>
              ) : (
                <span className="file-kept">
                  <Icon name="lock" />
                  {ps(lang, 'notServed')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="wrap cols file">
        <div className="stack-lg">
          <section>
            <h2 className="h-side">
              {ps(lang, 'usedBy')} <span className="count">{count(file.usedBy.total, lang)}</span>
            </h2>
            {items.length ? (
              <Box as="ul">
                {items.map((i) => (
                  <li key={i.id}>
                    <Link className="row" to={href(itemPath(i), lang)}>
                      <Icon name={TYPE_ICON[i.type] ?? 'file'} />
                      <span className="grow row-title">{labelOf(i, lang)}</span>
                      <span className="row-end subtle">{typeName(i.type, lang)}</span>
                    </Link>
                  </li>
                ))}
              </Box>
            ) : (
              <div className="box">
                <EmptyState compact icon="file" title={W.nothingUses[lang]} />
              </div>
            )}
            {file.usedBy.total > items.length ? <p className="see-all muted">{`${ps(lang, 'showing')} ${count(items.length, lang)} ${ps(lang, 'of')} ${count(file.usedBy.total, lang)}`}</p> : null}
          </section>

          {file.covers.length ? (
            <section>
              <h2 className="h-side">{ps(lang, 'coverOf')}</h2>
              <Box as="ul">
                {file.covers.map((c) => {
                  const work = coverItems[c.entity] as Entity | undefined;
                  return (
                    <li key={c.entity}>
                      <Link className="row" to={href(work?.path ?? `/${c.entity}`, lang)}>
                        <Icon name="book" />
                        <span className="grow row-title">{work ? String((work.data as { title?: { he?: string } }).title?.he ?? c.entity) : c.entity}</span>
                        <span className="row-end subtle">{`${ps(lang, 'pageNumber')} ${c.page}`}</span>
                        {c.machine ? <MachineLabel lang={lang} size="sm">{ps(lang, 'coverMachine')}</MachineLabel> : <span className="subtle small">{ps(lang, 'coverPerson')}</span>}
                      </Link>
                    </li>
                  );
                })}
              </Box>
            </section>
          ) : null}

          {file.derivations.length || file.derivedFrom.length ? (
            <section>
              <h2 className="h-side">{ps(lang, 'madeFrom')}</h2>
              <Box
                as="section"
                header={
                  <>
                    <Icon name="bot" className="subtle" />
                    <span className="muted">{ps(lang, 'machineNote')}</span>
                    <span className="end">
                      <MachineLabel lang={lang} size="sm" />
                    </span>
                  </>
                }
              >
                <ul>
                  {file.derivedFrom.map((d) => (
                    <li key={`from${d.sha256}${d.profile}`}>
                      <Link className="row" to={href(`/files/${d.sha256}`, lang)}>
                        <Icon name="arrow" className="flip-ltr" />
                        <span className="grow">
                          {ps(lang, 'madeOf')} <span className="mono">{d.sha256.slice(0, 12)}</span>
                        </span>
                        <span className="row-end mono subtle">{d.profile}</span>
                      </Link>
                    </li>
                  ))}
                  {file.derivations.map((d) => (
                    <li key={`to${d.sha256}${d.profile}`}>
                      <Link className="row" to={href(`/files/${d.sha256}`, lang)}>
                        <Icon name="file" />
                        <span className="grow mono">{d.sha256.slice(0, 12)}</span>
                        <span className="row-end mono subtle" dir="ltr">{`${d.profile} · ${d.encoder}`}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Box>
            </section>
          ) : null}

          {file.sources.length ? (
            <section>
              <h2 className="h-side">{ps(lang, 'cameFrom')}</h2>
              <Box as="ul">
                {file.sources.map((s, i) => {
                  const body = (
                    <>
                      <Icon name={s.url ? 'globe' : 'upload'} />
                      <span className="grow">
                        {SOURCE_NAMES[s.source]?.[lang] ?? s.source}
                        {s.uploaded ? <span className="subtle"> · {ps(lang, 'uploadedBySomeone')}</span> : null}
                      </span>
                      <span className="row-end num subtle">{(s.fetchedAt ?? s.at).slice(0, 10)}</span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {s.url ? (
                        <a className="row" href={s.url} target="_blank" rel="noopener">
                          {body}
                        </a>
                      ) : (
                        <div className="row">{body}</div>
                      )}
                    </li>
                  );
                })}
              </Box>
            </section>
          ) : null}
        </div>

        <aside className="side" aria-label={W.details[lang]}>
          <section>
            <h4>{W.details[lang]}</h4>
            <dl>
              <dt>{ps(lang, 'type')}</dt>
              <dd className="mono">{file.mime}</dd>
              <dt>{ps(lang, 'size')}</dt>
              <dd>
                <bdi dir="ltr">{size(file.bytes, lang)}</bdi>
              </dd>
              <dt>{ps(lang, 'rights')}</dt>
              <dd>{rights?.[lang] ?? file.rights}</dd>
              {file.credit ? (
                <>
                  <dt>{W.credit[lang]}</dt>
                  <dd>{file.credit}</dd>
                </>
              ) : null}
              {measured.length ? (
                <>
                  <dt>{ps(lang, 'measured')}</dt>
                  <dd>{measured.join(' · ')}</dd>
                </>
              ) : null}
            </dl>
          </section>
          <section>
            <h4>sha256</h4>
            <code className="file-hash" dir="ltr">
              {file.sha256}
            </code>
            <p className="muted small file-why">{W.kept[lang]}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
