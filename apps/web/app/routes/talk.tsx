import { useState } from 'react';
import { data, Link, useRevalidator } from 'react-router';
import type { Route } from './+types/talk';
import { PlainWords } from '../components/PlainWords.js';
import type { TalkComment } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { Avatar, EmptyState, RelativeTime } from '../ui/primitives.js';
import { ReviewBox } from '../ui/ReviewBox.js';
import { Timeline, TimelineBlock, TimelineComment } from '../ui/Timeline.js';
import { ItemSubpage } from '../views/ItemSubpage.js';
import { p } from '../views/itemParts.js';
import '../styles/pages/contribute.css';

/**
 * A page's talk page (the wiki model): the conversation about the page,
 * beside it and its history, as threads - each topic a card, its answers
 * under it. Anyone reads it; a signed-in person opens a topic, answers
 * one, or hides their own. Comments are plain words: web addresses, item
 * ids, site paths, @people and #numbers in them become links.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, entity, talk: (await api.talk(entity.id)).talk };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity, talk } = loaderData;
  // An empty talk page says nothing its item's page does not: kept out of search until someone writes on it.
  return pageMeta({ title: `${t(lang, 'tabTalk')}: ${labelOf(entity, lang)}`, path: `/talk/${entity.id}`, lang, siteUrl, noindex: !talk.some((c) => !c.hidden) });
}

const W = {
  topics: { he: 'נושאים', en: 'topics' },
  comments: { he: 'תגובות', en: 'comments' },
  people: { he: 'משתתפים', en: 'Taking part' },
  about: { he: 'דף השיחה', en: 'The talk page' },
  howLinks: { he: '‎@שם מזכיר אדם, ‎#12 מקשר להצעה או לדיווח, וכתובת או מזהה פריט הופכים לקישור.', en: '@name mentions a person, #12 links a suggestion or report, and an address or item id becomes a link.' },
  history: { he: 'ההיסטוריה של הדף', en: 'The page’s history' },
  suggestions: { he: 'הצעות ודיווחים', en: 'Suggestions and reports' },
  started: { he: 'פתח נושא', en: 'started a topic' },
  answered: { he: 'השיב', en: 'replied' },
  replies: { he: 'תשובות', en: 'replies' },
  hint: { he: 'אפשר לכתוב ‎@שם ו־‎#מספר', en: 'You can write @name and #number' },
} as const;

async function send(path: string, body: unknown) {
  const response = await fetch(`/_/steward/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
}

type Me = { id: string; name: string; steward?: boolean };

/** Writing: a new topic at the foot of the page, or an answer inside a thread. */
function Composer({ entityId, parent, lang, me, onDone, onCancel }: { entityId: string; parent?: number; lang: Lang; me: Me; onDone: () => void; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ReviewBox
      lang={lang}
      me={{ name: me.name, id: me.id }}
      name={parent ? `reply-${parent}` : 'topic'}
      title={parent ? t(lang, 'talkReply') : t(lang, 'talkNew')}
      placeholder={t(lang, parent ? 'talkReplyHint' : 'talkNewHint')}
      footnote={
        <span className="subtle">
          <Icon name="info" size={14} /> {W.hint[lang]}
        </span>
      }
      busy={busy}
      error={error}
      choices={[{ value: 'post', label: '', hint: '', submit: t(lang, parent ? 'talkReply' : 'talkPost'), tone: 'primary', icon: 'discuss', needsNote: true }]}
      extra={
        onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            {t(lang, 'cancel')}
          </button>
        ) : undefined
      }
      onSubmit={async (_choice, note) => {
        setBusy(true);
        setError(null);
        try {
          await send(`entities/${entityId}/talk`, { body: note, parent });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          throw err;
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/** Every answer under a topic, in the order written, however deep it was nested. */
function answersOf(comments: TalkComment[], root: number): TalkComment[] {
  const out: TalkComment[] = [];
  const walk = (parent: number) => {
    for (const c of comments.filter((x) => x.parent === parent)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(root);
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
}

function Words({ c, lang }: { c: TalkComment; lang: Lang }) {
  return c.hidden ? <p className="talk-hidden">{t(lang, 'talkHidden')}</p> : <PlainWords text={c.body ?? ''} lang={lang} className="talk-words" />;
}

function Actions({ c, lang, me, onReply, onChange }: { c: TalkComment; lang: Lang; me: Me | null; onReply: () => void; onChange: () => void }) {
  if (!me || c.hidden) return null;
  return (
    <span className="talk-acts">
      <button type="button" className="link-button" onClick={onReply}>
        {t(lang, 'talkReply')}
      </button>
      {c.author === me.id || me.steward ? (
        <button type="button" className="link-button muted" onClick={async () => void (await send(`comments/${c.id}/hide`, {}).then(onChange))}>
          {t(lang, 'talkHide')}
        </button>
      ) : null}
    </span>
  );
}

function Topic({ c, comments, entityId, lang, me, onChange }: { c: TalkComment; comments: TalkComment[]; entityId: string; lang: Lang; me: Me | null; onChange: () => void }) {
  const [replying, setReplying] = useState<number | null>(null);
  const answers = answersOf(comments, c.id);
  const reply = (id: number) => () => setReplying(replying === id ? null : id);
  const composer = (parent: number) =>
    replying === parent && me ? (
      <div className="talk-compose">
        <Composer
          entityId={entityId}
          parent={parent}
          lang={lang}
          me={me}
          onCancel={() => setReplying(null)}
          onDone={() => {
            setReplying(null);
            onChange();
          }}
        />
      </div>
    ) : null;
  return (
    <TimelineComment
      id={`c${c.id}`}
      author={c.authorName}
      authorId={c.author}
      mine={me?.id === c.author}
      header={
        <>
          <b>{c.authorName}</b>
          <span>{W.started[lang]}</span>
          <a className="subtle" href={`#c${c.id}`}>
            <RelativeTime at={c.at} lang={lang} />
          </a>
        </>
      }
      role={answers.length ? <span className="subtle num">{`${num(answers.length, lang)} ${W.replies[lang]}`}</span> : undefined}
    >
      <Words c={c} lang={lang} />
      <Actions c={c} lang={lang} me={me} onReply={reply(c.id)} onChange={onChange} />
      {composer(c.id)}
      {answers.length ? (
        <ol className="talk-answers">
          {answers.map((a) => (
            <li key={a.id} id={`c${a.id}`} className="talk-answer">
              <Avatar name={a.authorName} id={a.author} size="sm" />
              <div className="talk-answer-b">
                <p className="talk-answer-h">
                  <b>{a.authorName}</b>{' '}
                  <a className="subtle" href={`#c${a.id}`}>
                    <RelativeTime at={a.at} lang={lang} />
                  </a>
                </p>
                <Words c={a} lang={lang} />
                <Actions c={a} lang={lang} me={me} onReply={reply(a.id)} onChange={onChange} />
                {composer(a.id)}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </TimelineComment>
  );
}

export default function Talk({ loaderData }: Route.ComponentProps) {
  const { lang, entity, talk } = loaderData;
  const account = useAccount();
  const revalidator = useRevalidator();
  const me: Me | null = account ? { id: account.person.id, name: account.person.displayName, steward: account.person.steward } : null;
  const topics = talk.filter((c) => c.parent === null);
  const shown = talk.filter((c) => !c.hidden);
  const people = new Map<string, string>();
  for (const c of shown) people.set(c.author, c.authorName);
  const refresh = () => void revalidator.revalidate();
  return (
    <ItemSubpage
      entity={entity}
      lang={lang}
      current="talk"
      here={p(lang, 'talk')}
      counts={{ talk: shown.length }}
      side={
        <>
          <section>
            <h4>{W.about[lang]}</h4>
            <p className="muted">{t(lang, 'talkIntro')}</p>
            <p className="side-count">
              <b>{num(topics.length, lang)}</b> {W.topics[lang]} · <b>{num(shown.length, lang)}</b> {W.comments[lang]}
            </p>
          </section>
          {people.size ? (
            <section>
              <h4>{W.people[lang]}</h4>
              <ul className="side-list">
                {[...people].map(([id, name]) => (
                  <li key={id}>
                    <Avatar name={name} id={id} size="xs" />
                    <span className="grow">{name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <p className="muted small">{W.howLinks[lang]}</p>
            <Link to={href(`/history/${entity.id}`, lang)} className="side-link">
              <Icon name="history" />
              {W.history[lang]}
            </Link>
          </section>
        </>
      }
    >
      {topics.length === 0 ? <EmptyState icon="discuss" title={t(lang, 'talkEmpty')} compact>{t(lang, 'talkIntro')}</EmptyState> : null}
      <Timeline className="talk" label={t(lang, 'tabTalk')}>
        {topics.map((c) => (
          <Topic key={c.id} c={c} comments={talk} entityId={entity.id} lang={lang} me={me} onChange={refresh} />
        ))}
        {me ? (
          <TimelineBlock className="talk-new">
            <Composer entityId={entity.id} lang={lang} me={me} onDone={refresh} />
          </TimelineBlock>
        ) : null}
      </Timeline>
      {account === null ? (
        <p className="alert info">
          <Icon name="lock" />
          <span>
            {t(lang, 'talkSignIn')} <Link to={href('/signin', lang, { return: `/talk/${entity.id}` })}>{t(lang, 'signIn')}</Link>
          </span>
        </p>
      ) : null}
    </ItemSubpage>
  );
}
