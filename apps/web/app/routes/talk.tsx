import { useState } from 'react';
import { data, Link, useRevalidator } from 'react-router';
import type { Route } from './+types/talk';
import { PageTabs } from '../components/PageTabs.js';
import { PlainWords } from '../components/PlainWords.js';
import type { TalkComment } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * A page's talk page (the wiki model): the conversation about the page,
 * beside it and its history. Anyone reads it; a signed-in person writes,
 * answers a comment, or hides their own. Comments are plain words; web
 * addresses, item ids and site paths in them become links.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, entity, talk: (await api.talk(entity.id)).talk };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${t(lang, 'tabTalk')}: ${labelOf(entity, lang)}`, path: `/talk/${entity.id}`, lang, siteUrl });
}

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

function Composer({ entityId, parent, lang, onDone }: { entityId: string; parent?: number; lang: Lang; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="talk-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await send(`entities/${entityId}/talk`, { body: text, parent });
          setText('');
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={parent ? 2 : 4} dir="auto" placeholder={t(lang, parent ? 'talkReplyHint' : 'talkNewHint')} required />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={busy || !text.trim()}>
        {t(lang, parent ? 'talkReply' : 'talkPost')}
      </button>
    </form>
  );
}

function Thread({ comments, parent, entityId, lang, me, onChange }: { comments: TalkComment[]; parent: number | null; entityId: string; lang: Lang; me: { id: string; steward?: boolean } | null; onChange: () => void }) {
  const [replying, setReplying] = useState<number | null>(null);
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const here = comments.filter((c) => c.parent === parent);
  if (!here.length) return null;
  return (
    <ol className={parent === null ? 'talk' : 'talk talk-replies'}>
      {here.map((c) => (
        <li key={c.id} className="talk-comment" id={`c${c.id}`}>
          <p className="row-sub" suppressHydrationWarning>
            <b>{c.authorName}</b> · {when(c.at)}
          </p>
          {c.hidden ? <p className="row-sub">{t(lang, 'talkHidden')}</p> : <PlainWords text={c.body ?? ''} lang={lang} />}
          {me && !c.hidden ? (
            <p className="talk-actions">
              <button type="button" className="link-button" onClick={() => setReplying(replying === c.id ? null : c.id)}>
                {t(lang, 'talkReply')}
              </button>
              {c.author === me.id || me.steward ? (
                <button type="button" className="link-button" onClick={async () => void (await send(`comments/${c.id}/hide`, {}).then(onChange))}>
                  {t(lang, 'talkHide')}
                </button>
              ) : null}
            </p>
          ) : null}
          {replying === c.id ? (
            <Composer
              entityId={entityId}
              parent={c.id}
              lang={lang}
              onDone={() => {
                setReplying(null);
                onChange();
              }}
            />
          ) : null}
          <Thread comments={comments} parent={c.id} entityId={entityId} lang={lang} me={me} onChange={onChange} />
        </li>
      ))}
    </ol>
  );
}

export default function Talk({ loaderData }: Route.ComponentProps) {
  const { lang, entity, talk } = loaderData;
  const account = useAccount();
  const revalidator = useRevalidator();
  const me = account ? { id: account.person.id, steward: account.person.steward } : null;
  return (
    <>
      <PageTabs entity={entity} lang={lang} current="talk" />
      <h1>
        {t(lang, 'tabTalk')}: {labelOf(entity, lang)}
      </h1>
      <p className="subtitle">{t(lang, 'talkIntro')}</p>
      {talk.length === 0 ? <p>{t(lang, 'talkEmpty')}</p> : null}
      <Thread comments={talk} parent={null} entityId={entity.id} lang={lang} me={me} onChange={() => revalidator.revalidate()} />
      {account ? (
        <section>
          <h2 className="section-header">{t(lang, 'talkNew')}</h2>
          <Composer entityId={entity.id} lang={lang} onDone={() => revalidator.revalidate()} />
        </section>
      ) : account === null ? (
        <p className="note">
          {t(lang, 'talkSignIn')} <Link to={href('/signin', lang, { return: `/talk/${entity.id}` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : null}
    </>
  );
}
