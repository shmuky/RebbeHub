import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/history';
import { ChangeRows, wordsStat } from '../components/ChangeDiff.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { personName } from '../lib/people.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { AgentBy, Avatar, EmptyState, Label, RelativeTime } from '../ui/primitives.js';
import { Timeline, TimelineComment } from '../ui/Timeline.js';
import { ItemSubpage } from '../views/ItemSubpage.js';
import '../styles/pages/contribute.css';

/**
 * History: every version of an item, newest first, down one line as a
 * pull request's commits are: who changed it and in what words, who
 * approved it and when, and the change itself (the words that changed
 * marked, any other field by its name). "Restore this version" sends the
 * older version for review like any Suggestion. Nothing is ever lost.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang, siteUrl, entity, history: await api.history(entity.id) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${t(lang, 'history')}: ${labelOf(entity, lang)}`, path: `/history/${entity.id}`, lang, siteUrl, noindex: true });
}

const W = {
  version: { he: 'גרסה', en: 'Version' },
  versions: { he: 'גרסאות', en: 'versions' },
  who: { he: 'מי שינה כאן', en: 'Who changed it' },
  about: { he: 'על ההיסטוריה', en: 'About the history' },
  aboutText: {
    he: 'כל שינוי שאושר נשמר כגרסה. החזרה של גרסה ישנה היא הצעה כמו כל הצעה: אחראי האוסף רואים אותה ומאשרים.',
    en: 'Every approved change is kept as a version. Restoring an older one is a Suggestion like any other: the keepers see it and approve.',
  },
  talk: { he: 'לדבר על הדף', en: 'Talk about the page' },
  empty: { he: 'לפריט הזה עוד אין גרסאות.', en: 'This item has no versions yet.' },
  restoring: { he: 'שולח…', en: 'Sending…' },
  wrote: { he: 'שינה', en: 'changed it' },
  bot: { he: 'ייבוא', en: 'import' },
} as const;

function RestoreButton({ entityId, rev, lang }: { entityId: string; rev: number; lang: Lang }) {
  const [state, setState] = useState<{ busy?: boolean; sent?: number; error?: string }>({});
  if (state.sent)
    return (
      <span className="hist-sent" role="status">
        <Icon name="check" />
        {t(lang, 'restoreSent')} <Link to={href('/review', lang, { s: String(state.sent) })}>{t(lang, 'suggestSee')}</Link>
      </span>
    );
  return (
    <>
      <button
        type="button"
        className="btn sm"
        disabled={state.busy}
        aria-busy={state.busy || undefined}
        onClick={async () => {
          setState({ busy: true });
          const response = await fetch(`/_/steward/entities/${entityId}/restore`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ rev }),
          });
          const body = (await response.json().catch(() => ({}))) as { suggestion?: number; message?: string };
          setState(response.ok ? { sent: body.suggestion } : { error: body.message ?? response.statusText });
        }}
      >
        <Icon name="history" />
        {state.busy ? W.restoring[lang] : t(lang, 'restoreVersion')}
      </button>
      {state.error ? (
        <span className="hist-error" role="alert">
          <Icon name="warn" /> {state.error}
        </span>
      ) : null}
    </>
  );
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { lang, entity, history } = loaderData;
  const account = useAccount();
  // Everyone who changed it, most changes first.
  const people = new Map<string, { name: string; bot: boolean; n: number }>();
  for (const h of history) {
    const was = people.get(h.author);
    people.set(h.author, { name: personName(h.author, h.authorName, lang), bot: h.authorIsBot, n: (was?.n ?? 0) + 1 });
  }
  const who = [...people.entries()].sort((a, b) => b[1].n - a[1].n);
  return (
    <ItemSubpage
      entity={entity}
      lang={lang}
      current="history"
      here={t(lang, 'history')}
      sub={t(lang, 'historyIntro')}
      side={
        <>
          <section>
            <h4>{W.about[lang]}</h4>
            <p className="muted">{W.aboutText[lang]}</p>
            <p className="side-count">
              <b>{num(history.length, lang)}</b> {W.versions[lang]}
            </p>
          </section>
          {who.length ? (
            <section>
              <h4>{W.who[lang]}</h4>
              <ul className="side-list">
                {who.map(([id, p]) => (
                  <li key={id}>
                    <Avatar name={p.name} id={id} size="xs" bot={p.bot} />
                    <span className="grow">{p.name}</span>
                    <span className="num subtle">{num(p.n, lang)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <Link to={href(`/talk/${entity.id}`, lang)} className="side-link">
              <Icon name="discuss" />
              {W.talk[lang]}
            </Link>
          </section>
        </>
      }
    >
      {history.length === 0 ? (
        <EmptyState icon="history" title={W.empty[lang]} />
      ) : (
        <Timeline className="hist" label={t(lang, 'history')}>
          {history.map((h, i) => {
            const author = personName(h.author, h.authorName, lang);
            const approver = personName(h.mergedBy, h.mergedByName, lang);
            const stat = h.created || h.deleted ? null : wordsStat(h.changes, lang);
            return (
              <TimelineComment
                key={h.commit}
                id={`v${h.rev}`}
                author={author}
                authorId={h.author}
                bot={h.authorIsBot || Boolean(h.via)}
                header={
                  <>
                    <AgentBy via={h.via} lang={lang} who={author}>
                      <b>{author}</b>
                    </AgentBy>
                    <span className="hist-msg">{h.message}</span>
                    <span className="subtle">
                      · <RelativeTime at={h.at} lang={lang} />
                    </span>
                  </>
                }
                role={
                  <>
                    {stat}
                    {i === 0 ? <Label tone="sync">{t(lang, 'currentVersion')}</Label> : <a className="hist-rev num" href={`#v${h.rev}`}>{`${W.version[lang]} ${num(history.length - i, lang)}`}</a>}
                  </>
                }
                footer={
                  (h.mergedBy !== h.author || (i > 0 && account && !h.deleted)) ? (
                    <>
                      {h.mergedBy !== h.author ? (
                        <span className="hist-approved">
                          <Icon name="check" size={14} />
                          {t(lang, 'approvedBy')} <b>{approver}</b>
                        </span>
                      ) : null}
                      {i > 0 && account && !h.deleted ? (
                        <span className="end">
                          <RestoreButton entityId={entity.id} rev={h.rev} lang={lang} />
                        </span>
                      ) : null}
                    </>
                  ) : undefined
                }
              >
                {h.created ? (
                  <p className="hist-note">
                    <Icon name="plus" /> {t(lang, 'versionCreated')}
                  </p>
                ) : h.deleted ? (
                  <p className="hist-note">
                    <Icon name="trash" /> {t(lang, 'versionDeleted')}
                  </p>
                ) : (
                  <div className="hist-changes">
                    <ChangeRows changes={h.changes} lang={lang} />
                  </div>
                )}
              </TimelineComment>
            );
          })}
        </Timeline>
      )}
    </ItemSubpage>
  );
}
