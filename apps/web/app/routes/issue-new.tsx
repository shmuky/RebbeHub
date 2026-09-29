import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Route } from './+types/issue-new';
import { Composer } from '../components/threads/Composer.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threads, type Issue, type IssueTemplate } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Opening an issue, as GitHub's templates do it: first what kind of
 * problem it is (each kind starts the words with the questions a keeper
 * will ask), then a title and the details, with @ and # as anywhere.
 * `?type=` skips the first step and `?item=` says which item it is about,
 * so an item page can link straight here. Issues about rights or
 * offensive content are private; every other one is public.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'דיווח חדש' : 'New issue', path: '/issues/new', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

export default function NewIssue() {
  const lang = useLang();
  const account = useAccount();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [templates, setTemplates] = useState<IssueTemplate[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [item, setItem] = useState(params.get('item') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = params.get('type');
  const template = templates.find((t) => t.type === type) ?? null;

  useEffect(() => {
    void threads<{ templates: IssueTemplate[] }>('issues/templates').then((r) => setTemplates(r.templates), () => undefined);
  }, []);
  // A kind's questions fill the box, unless something is written there already.
  useEffect(() => {
    if (template) setBody((now) => (now.trim() && !templates.some((t) => t.template[lang] === now) ? now : template.template[lang]));
  }, [template, templates, lang]);

  if (account === null) {
    return (
      <p className="note">
        <Link to={href('/signin', lang, { return: `/issues/new${params.size ? `?${params}` : ''}` })}>{tt(lang, 'signInToJoin')}</Link>
      </p>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const entityId = /rh-[0-9a-z]{6,16}/.exec(item.trim().toLowerCase())?.[0];
      const issue = await threads<Issue>('issues', { body: { title: title.trim(), body: body.trim(), type, entityId } });
      navigate(href(`/issues/${issue.number}`, lang));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const choose = (to: string | null) => {
    const next = new URLSearchParams(params);
    if (to) next.set('type', to);
    else next.delete('type');
    setParams(next);
  };

  return (
    <div className="th-page" style={{ maxInlineSize: '48rem' }}>
      <h1>{tt(lang, 'newIssue')}</h1>
      {!template ? (
        <>
          <h2 style={{ fontSize: '1.1rem' }}>{tt(lang, 'issueType')}</h2>
          <div className="th-type-grid">
            {templates.map((t) => (
              <button key={t.type} type="button" onClick={() => choose(t.type)}>
                <strong>
                  {t.private ? <Lock size={12} aria-hidden="true" /> : null} {t.label[lang]}
                </strong>
                <small>{t.template[lang].split('\n')[0] || '…'}</small>
              </button>
            ))}
          </div>
          <p className="th-hint">{tt(lang, 'publicNote')}</p>
        </>
      ) : (
        <form
          className="th-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p className="th-meta">
            {tt(lang, 'typeOf')}: <strong>{template.label[lang]}</strong> ·{' '}
            <button type="button" className="link-button" onClick={() => choose(null)}>
              {tt(lang, 'edit')}
            </button>
          </p>
          {template.private ? (
            <p className="th-private" style={{ justifySelf: 'start' }}>
              <Lock size={12} aria-hidden="true" /> {tt(lang, 'privateType')}
            </p>
          ) : null}
          <label>
            {tt(lang, 'title')}
            <input type="text" className="th-title-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus dir="auto" />
          </label>
          <label>
            {tt(lang, 'aboutItem')}
            <input type="text" value={item} onChange={(e) => setItem(e.target.value)} placeholder={tt(lang, 'itemIdHint')} dir="ltr" />
          </label>
          <Composer lang={lang} value={body} onChange={setBody} placeholder={tt(lang, 'body')} error={error} />
          <div className="th-buttons">
            <button type="submit" disabled={busy || !title.trim() || !account}>
              {tt(lang, 'submitIssue')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
