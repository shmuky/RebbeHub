import { useState } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/project';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import type { ProjectItem } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Progress, focusText } from './projects.js';

/**
 * One project: its goal, how far it has come, and what is next to do. A
 * signed-in helper asks for "the next one" and is handed a farbrengen, a
 * recording to sync or a page to proofread that nobody else holds, kept
 * for them for a few hours (the plan, section 7).
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const found = await api.project(params.slug);
  if (!found) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, ...found, todo: found.todo ?? [] };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.project.name, path: `/projects/${loaderData.project.slug}`, lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

/** Where an item is worked on: a farbrengen's page, its transcript, or the page of the scan's text. */
export function itemHref(item: ProjectItem, lang: Lang): string {
  if (item.kind === 'page') return href(`/text/${item.id}`, lang, { page: String(item.page) });
  if (item.kind === 'recording') return `${href(`/${item.event ?? item.id}`, lang)}#transcript`;
  return href(`/${item.id}`, lang);
}

function itemLabel(item: ProjectItem, lang: Lang): string {
  if (item.kind === 'page') return `${t(lang, 'page')} ${item.page}`;
  const title = nameOf(item.title ?? undefined, lang);
  const date = item.date ? dateLabel(item.date, lang, { civil: false }) : '';
  return [title, date].filter(Boolean).join(' · ');
}

function NextOne({ slug, lang }: { slug: string; lang: Lang }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'busy' | 'none'>('idle');
  const [error, setError] = useState<string | null>(null);
  return (
    <p>
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          setError(null);
          try {
            const { item } = await postJson<{ item: ProjectItem | null }>(`projects/${slug}/next`);
            if (!item) return setState('none');
            navigate(itemHref(item, lang));
          } catch (e) {
            setState('idle');
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {t(lang, 'giveMeNext')}
      </button>
      {state === 'none' ? <span className="row-sub"> {t(lang, 'nothingLeft')}</span> : null}
      {error ? <span role="alert"> {error}</span> : null}
    </p>
  );
}

export default function ProjectPage({ loaderData }: Route.ComponentProps) {
  const { lang, project, next, todo } = loaderData;
  const account = useAccount();
  const byEvent = project.focus.missing === 'recordings' || project.focus.missing === 'texts';
  const hint = { recordings: 'nextToDoRecordings', texts: 'nextToDoTexts', sync: 'nextToDoSync', proofreading: 'nextToDoProofreading' } as const;
  return (
    <>
      <ol className="breadcrumbs">
        <li>
          <Link to={href('/projects', lang)}>{t(lang, 'projectsTitle')}</Link>
        </li>
      </ol>
      <h1>{project.name}</h1>
      <p className="subtitle">{project.goal ?? focusText(project, lang)}</p>
      <Progress project={project} lang={lang} />
      {project.status === 'open' ? (
        <section>
          <h2 className="section-header">{t(lang, 'nextToDo')}</h2>
          <p className="row-sub">{t(lang, hint[project.focus.missing])}</p>
          {account ? <NextOne slug={project.slug} lang={lang} /> : null}
          {byEvent ? (
            <EventRows events={next as EventItem[]} sub={(e) => dateLabel(eventData(e).date, lang, { civil: false })} />
          ) : (
            <ul className="rows">
              {todo.map((item) => (
                <li key={item.item} className="row">
                  <span className="row-main">
                    <Link className="row-title" to={itemHref(item, lang)}>
                      {itemLabel(item, lang)}
                    </Link>
                    {item.claimedBy ? <span className="row-sub">{item.claimedBy === account?.person.id ? t(lang, 'yours') : t(lang, 'heldBy')}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="note">{t(lang, 'projectClosed')}</p>
      )}
      {project.creatorName ? <p className="row-sub">{t(lang, 'openedBy')} {project.creatorName}</p> : null}
    </>
  );
}
