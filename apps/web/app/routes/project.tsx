import { data, Link } from 'react-router';
import type { Route } from './+types/project';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Progress, focusText } from './projects.js';

/** One project: its goal, how far it has come, and the next farbrengens to work on. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const found = await api.project(params.slug);
  if (!found) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, ...found };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.project.name, path: `/projects/${loaderData.project.slug}`, lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export default function ProjectPage({ loaderData }: Route.ComponentProps) {
  const { lang, project, next } = loaderData;
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
          <p className="row-sub">{t(lang, project.focus.missing === 'recordings' ? 'nextToDoRecordings' : 'nextToDoTexts')}</p>
          <EventRows events={next as EventItem[]} sub={(e) => dateLabel(eventData(e).date, lang, { civil: false })} />
        </section>
      ) : (
        <p className="note">{t(lang, 'projectClosed')}</p>
      )}
      {project.creatorName ? <p className="row-sub">{t(lang, 'openedBy')} {project.creatorName}</p> : null}
    </>
  );
}
