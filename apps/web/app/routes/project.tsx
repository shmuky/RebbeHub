import { data, Form, Link, redirect, useNavigation } from 'react-router';
import type { Route } from './+types/project';
import type { Entity, ProjectItem } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, Breadcrumbs, EmptyState, RelativeTime, StatusBadge, Tooltip, cx } from '../ui/primitives.js';
import { FocusLabel, Progress, focusText, percent, pw } from './projects.js';
import '../styles/pages/projects.css';

/**
 * One project: its goal, how far it has come, and what is next to do. A
 * signed-in helper asks for "the next one" and is handed a farbrengen, a
 * recording to sync or a page to proofread that nobody else holds, kept
 * for them for a few hours (the plan, section 7); they can let it go
 * again, and a steward can close the project. Each of these is a plain
 * form to this page, so it works before (and without) the page's script.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const found = await api.project(params.slug);
  if (!found) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, ...found, todo: found.todo ?? [] };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { project, lang, siteUrl } = loaderData;
  return pageMeta({ title: project.name, description: project.goal ?? focusText(project, lang), path: `/projects/${project.slug}`, lang, siteUrl });
}

type ActionResult = { none: true } | { error: string } | null;

/** "Give me the next one", "Let it go" and "Close the project", sent to the API as the person who pressed them. */
export async function action({ request, params, context }: Route.ActionArgs): Promise<ActionResult | Response> {
  const { api } = siteOf(context);
  const lang = langFrom(request);
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const slug = params.slug;
  const call = async (path: string, body: unknown = {}) => {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const name of ['cookie', 'origin', 'user-agent', 'x-forwarded-proto']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // Sent from the site's root, so the page's own query (?lang=en) is not passed on.
    const response = await api.forward(path, new Request(new URL('/', request.url), { method: 'POST', headers, body: JSON.stringify(body) }));
    const json = (await response.json().catch(() => ({}))) as { item?: ProjectItem | null; message?: string };
    if (!response.ok) throw new Error(response.status === 401 ? w(lang, 'signInToTake') : (json.message ?? response.statusText));
    return json;
  };
  try {
    if (intent === 'next') {
      const { item } = await call(`/v1/projects/${encodeURIComponent(slug)}/next`);
      return item ? redirect(itemHref(item, lang)) : { none: true };
    }
    if (intent === 'release') {
      await call(`/v1/projects/${encodeURIComponent(slug)}/release`, { item: String(form.get('item') ?? '') });
      return null;
    }
    if (intent === 'close') {
      await call(`/v1/projects/${encodeURIComponent(slug)}/close`);
      return null;
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  throw data('unknown action', { status: 400 });
}

/** Where an item is worked on: a farbrengen's page, its transcript, or the page of the scan's text. */
export function itemHref(item: ProjectItem, lang: Lang): string {
  if (item.kind === 'page') return href(`/text/${item.id}`, lang, { page: String(item.page) });
  if (item.kind === 'recording') return `${href(`/${item.event ?? item.id}`, lang)}#transcript`;
  return href(`/${item.id}`, lang);
}

const W = {
  goal: { he: 'המטרה', en: 'The goal' },
  details: { he: 'פרטים', en: 'Details' },
  worksThrough: { he: 'עובר על', en: 'Works through' },
  year: { he: 'שנה', en: 'Year' },
  allYears: { he: 'כל השנים', en: 'Every year' },
  opened: { he: 'נפתח', en: 'Opened' },
  keepers: { he: 'אחראים', en: 'Keepers' },
  progress: { he: 'התקדמות', en: 'Progress' },
  left: { he: 'נשארו', en: 'left' },
  yoursNow: { he: 'שמור לכם', en: 'Kept for you' },
  heldNow: { he: 'מישהו עובד על זה', en: 'Someone is on it' },
  heldTip: { he: 'שמור למי שלקח אותו, עד שלוש שעות', en: 'Kept for whoever took it, for up to three hours' },
  letGo: { he: 'שחרור', en: 'Let go' },
  letGoTip: { he: 'להחזיר לערימה, כדי שמישהו אחר יוכל לקחת', en: 'Put it back, so someone else can take it' },
  open: { he: 'פתיחה', en: 'Open' },
  close: { he: 'סגירת הפרויקט', en: 'Close the project' },
  signInToTake: { he: 'התחברו כדי לקחת פריט', en: 'Sign in to take one' },
  claimNote: { he: 'הפריט שתקבלו נשמר לכם לשלוש שעות, כדי ששניים לא יעבדו על אותו דבר.', en: 'The item you get is kept for you for three hours, so two people never work on the same one.' },
  allDone: { he: 'הכל נעשה. תודה לכל מי שעזר.', en: 'All done. Thank you to everyone who helped.' },
  page: { he: 'עמוד', en: 'Page' },
  level: { he: 'רמת הגהה', en: 'Proofread' },
  shown: { he: 'מוצגים הראשונים', en: 'The first shown' },
  closedOn: { he: 'הפרויקט סגור: אין מה לחלק.', en: 'The project is closed: nothing to hand out.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

function itemTitle(item: ProjectItem, lang: Lang): string {
  if (item.kind === 'page') return `${w(lang, 'page')} ${num(item.page ?? 0, lang)}`;
  return nameOf(item.title ?? undefined, lang) || item.id || item.item;
}

function itemSub(item: ProjectItem, lang: Lang): string {
  if (item.kind === 'page') return `${w(lang, 'level')}: ${t(lang, item.level === 1 ? 'proofread1' : item.level === 2 ? 'proofread2' : 'proofread0')}`;
  return item.date ? dateLabel(item.date, lang, { civil: false }) : '';
}

const KIND_ICON: Record<ProjectItem['kind'], IconName> = { event: 'cal', recording: 'audio', page: 'scan' };

export default function ProjectPage({ loaderData, actionData }: Route.ComponentProps) {
  const { lang, project, next, todo } = loaderData;
  const account = useAccount();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle' && navigation.formMethod === 'POST';
  const byPath = new Map((next as Entity[]).map((e) => [e.id, e]));
  const hint = { recordings: 'nextToDoRecordings', texts: 'nextToDoTexts', sync: 'nextToDoSync', proofreading: 'nextToDoProofreading' } as const;
  const isOpen = project.status === 'open';
  const left = Math.max(0, project.total - project.done);
  const result = actionData as ActionResult | undefined;
  const mine = (item: ProjectItem) => Boolean(account && item.claimedBy === account.person.id);
  const keepers = (project as typeof project & { keepers?: string[] }).keepers ?? [];
  const opened = project.createdAt;

  const linkOf = (item: ProjectItem) => {
    const entity = item.kind === 'event' && item.id ? byPath.get(item.id) : undefined;
    return entity ? href(itemPath(entity), lang) : itemHref(item, lang);
  };

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <Breadcrumbs lang={lang} items={[{ label: t(lang, 'projectsTitle'), to: href('/projects', lang) }, { label: project.name }]} />
          <div className="phead-row">
            <div>
              <h1 className="page-title">{project.name}</h1>
              <div className="pmeta">
                <StatusBadge state={isOpen ? 'open' : project.status === 'merged' ? 'approved' : 'closed'} icon={isOpen ? 'target' : project.status === 'merged' ? 'check' : 'x'}>
                  {pw(lang, isOpen ? 'stateOpen' : project.status === 'merged' ? 'stateMerged' : 'stateClosed')}
                </StatusBadge>
                <FocusLabel project={project} lang={lang} />
                <span>
                  {focusText(project, lang)}
                  {opened ? (
                    <>
                      {' · '}
                      {pw(lang, 'openedAgo')} <RelativeTime at={opened} lang={lang} />
                    </>
                  ) : null}
                  {project.creatorName ? (
                    <>
                      {` ${pw(lang, 'by')} `}
                      <b>{project.creatorName}</b>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
            {isOpen ? (
              <div className="phead-acts">
                {account === null ? (
                  <Link className="btn primary" to={href('/signin', lang, { return: `/projects/${project.slug}` })}>
                    <Icon name="user" />
                    {w(lang, 'signInToTake')}
                  </Link>
                ) : (
                  <Form method="post" replace>
                    <input type="hidden" name="intent" value="next" />
                    <button type="submit" className="btn primary" disabled={busy}>
                      {busy && navigation.formData?.get('intent') === 'next' ? <Icon name="loader" className="spin" /> : <Icon name="arrow" className="flip" />}
                      {t(lang, 'giveMeNext')}
                    </button>
                  </Form>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="wrap cols pj-cols">
        <div className="stack">
          {result && 'none' in result ? (
            <p className="alert info" role="status">
              <Icon name="info" />
              {t(lang, 'nothingLeft')}
            </p>
          ) : null}
          {result && 'error' in result ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {result.error}
            </p>
          ) : null}

          <Box
            className="pj-overview"
            header={
              <>
                <Icon name="pulse" className="subtle" />
                {w(lang, 'progress')}
                <span className="end muted num">
                  {num(left, lang)} {w(lang, 'left')}
                </span>
              </>
            }
          >
            <div className="box-b">
              <p className="pj-big">
                <b>{percent(project)}%</b>
                <span className="muted">
                  {num(project.done, lang)} {pw(lang, 'of')} {num(project.total, lang)} {pw(lang, 'done')}
                </span>
              </p>
              <Progress project={project} lang={lang} className="pj-overview-bar" />
              {project.goal ? <p className="pj-goal">{project.goal}</p> : null}
            </div>
          </Box>

          {isOpen ? (
            <Box
              className="pj-todo"
              header={
                <>
                  <Icon name="inbox" className="subtle" />
                  {t(lang, 'nextToDo')}
                  {todo.length ? <span className="count">{num(todo.length, lang)}</span> : null}
                </>
              }
              footer={
                <>
                  <Icon name="info" className="subtle" />
                  <span className="muted">{t(lang, hint[project.focus.missing])}</span>
                </>
              }
            >
              {todo.length === 0 ? (
                <EmptyState compact icon="check" title={w(lang, 'allDone')} />
              ) : (
                <ul>
                  {todo.map((item) => {
                    const held = Boolean(item.claimedBy);
                    return (
                      <li key={item.item} className={cx('pj-item', mine(item) && 'mine')}>
                        <Icon name={KIND_ICON[item.kind]} className="subtle" />
                        <div className="pj-main">
                          <Link className="pj-item-title" to={linkOf(item)}>
                            {itemTitle(item, lang)}
                          </Link>
                          {itemSub(item, lang) ? <span className="pj-sub">{itemSub(item, lang)}</span> : null}
                        </div>
                        {held ? (
                          mine(item) ? (
                            <span className="pj-claim mine">
                              <Icon name="lock" size={14} />
                              {w(lang, 'yoursNow')}
                              <Form method="post" replace>
                                <input type="hidden" name="intent" value="release" />
                                <input type="hidden" name="item" value={item.item} />
                                <Tooltip text={w(lang, 'letGoTip')}>
                                  <button type="submit" className="btn sm ghost" disabled={busy}>
                                    {w(lang, 'letGo')}
                                  </button>
                                </Tooltip>
                              </Form>
                            </span>
                          ) : (
                            <Tooltip text={w(lang, 'heldTip')}>
                              <span className="pj-claim" tabIndex={0}>
                                <Icon name="clock" size={14} />
                                {w(lang, 'heldNow')}
                              </span>
                            </Tooltip>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Box>
          ) : (
            <p className="alert">
              <Icon name="lock" />
              {t(lang, 'projectClosed')}
            </p>
          )}
        </div>

        <aside className="side" aria-label={w(lang, 'details')}>
          <section>
            <h2>{w(lang, 'details')}</h2>
            <dl>
              <dt>{w(lang, 'worksThrough')}</dt>
              <dd>{t(lang, `missing_${project.focus.missing}`)}</dd>
              {project.focus.missing !== 'proofreading' ? (
                <>
                  <dt>{w(lang, 'year')}</dt>
                  <dd>
                    {project.focus.within ? (
                      <Link to={href(`/calendar/${project.focus.within.slice(0, 4)}`, lang)}>{yearLabel(Number(project.focus.within.slice(0, 4)), lang)}</Link>
                    ) : (
                      w(lang, 'allYears')
                    )}
                  </dd>
                </>
              ) : project.focus.scan ? (
                <>
                  <dt>{t(lang, 'proofreadScan')}</dt>
                  <dd>
                    <Link to={href(`/text/${project.focus.scan}`, lang)} className="mono">
                      {project.focus.scan}
                    </Link>
                  </dd>
                </>
              ) : null}
              {opened ? (
                <>
                  <dt>{w(lang, 'opened')}</dt>
                  <dd>
                    <RelativeTime at={opened} lang={lang} />
                  </dd>
                </>
              ) : null}
              {project.creatorName ? (
                <>
                  <dt>{t(lang, 'openedBy')}</dt>
                  <dd>{project.creatorName}</dd>
                </>
              ) : null}
              {keepers.length ? (
                <>
                  <dt>{w(lang, 'keepers')}</dt>
                  <dd>
                    {keepers.map((k, i) => (
                      <span key={k}>
                        {i ? ', ' : ''}
                        <Link to={href(`/u/${k}`, lang)}>@{k}</Link>
                      </span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          <section>
            <h2>{pw(lang, 'howTitle')}</h2>
            <p className="muted">{isOpen ? w(lang, 'claimNote') : w(lang, 'closedOn')}</p>
          </section>
          <section>
            <ul className="side-list">
              <li>
                <Icon name="target" className="subtle" />
                <Link className="grow" to={href('/missing', lang, project.focus.missing === 'recordings' || project.focus.missing === 'texts' ? { kind: project.focus.missing, year: project.focus.within?.slice(0, 4) } : {})}>
                  {pw(lang, 'allMissing')}
                </Link>
              </li>
              <li>
                <Icon name="layers" className="subtle" />
                <Link className="grow" to={href('/projects', lang)}>
                  {t(lang, 'projectsTitle')}
                </Link>
              </li>
            </ul>
          </section>
          {isOpen && account?.person.steward ? (
            <section>
              <Form method="post" replace>
                <input type="hidden" name="intent" value="close" />
                <button type="submit" className="btn sm danger" disabled={busy}>
                  <Icon name="x" />
                  {w(lang, 'close')}
                </button>
              </Form>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
