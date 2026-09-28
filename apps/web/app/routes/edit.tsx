import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/edit';
import { PageTabs } from '../components/PageTabs.js';
import { SuggestFix, canSuggestFix } from '../components/SuggestFix.js';
import { Wikitext } from '../components/Wikitext.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * Editing a page (the wiki model): its words in wikitext, with a preview,
 * sent for review with a line on what changed; its name and date in the
 * fields below. Nothing goes live before the set's keepers approve, and
 * every version stays in the history.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, entity };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${t(lang, 'tabEdit')}: ${labelOf(entity, lang)}`, path: `/edit/${entity.id}`, lang, siteUrl, noindex: true });
}

export default function Edit({ loaderData }: Route.ComponentProps) {
  const { lang, entity } = loaderData;
  const account = useAccount();
  const original = ((entity.data as { body?: string }).body ?? '').toString();
  const [body, setBody] = useState(original);
  const [summary, setSummary] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const withheld = Boolean((entity as { withheld?: string }).withheld);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/_/suggestions/quick', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ entityId: entity.id, data: { ...(entity.data as object), body }, title: summary.trim() || t(lang, 'editDefaultSummary') }),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: number; message?: string };
      if (!response.ok) throw new Error(json.message ?? response.statusText);
      setSent(json.id!);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTabs entity={entity} lang={lang} current="edit" />
      <h1>
        {t(lang, 'tabEdit')}: {labelOf(entity, lang)}
      </h1>
      {account === null ? (
        <p className="note">
          {t(lang, 'editSignIn')} <Link to={href('/signin', lang, { return: `/edit/${entity.id}` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : withheld ? (
        <p className="note">{t(lang, 'withheldChange')}</p>
      ) : sent !== null ? (
        <p className="note" role="status">
          {t(lang, 'suggestSent')} <Link to={href('/review', lang, { s: String(sent) })}>{t(lang, 'suggestSee')}</Link>
        </p>
      ) : (
        <form className="wiki-editor" onSubmit={save}>
          <div className="page-tabs editor-tabs">
            <button type="button" className={preview ? 'secondary' : ''} onClick={() => setPreview(false)}>
              {t(lang, 'editSource')}
            </button>
            <button type="button" className={preview ? '' : 'secondary'} onClick={() => setPreview(true)}>
              {t(lang, 'editPreview')}
            </button>
          </div>
          {preview ? (
            <div className="wiki-preview">{body.trim() ? <Wikitext text={body} lang={lang} /> : <p className="row-sub">{t(lang, 'editEmpty')}</p>}</div>
          ) : (
            <textarea className="wiki-source" value={body} onChange={(e) => setBody(e.target.value)} rows={18} dir="auto" spellCheck={false} />
          )}
          <p className="row-sub">{t(lang, 'editHelp')}</p>
          <label>
            {t(lang, 'editSummary')}
            <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} dir="auto" placeholder={t(lang, 'editSummaryHint')} />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div>
            <button type="submit" disabled={busy || body === original}>
              {busy ? t(lang, 'waiting') : t(lang, 'sendForReview')}
            </button>
          </div>
        </form>
      )}
      {account && canSuggestFix(entity) ? <SuggestFix entity={entity} lang={lang} /> : null}
    </>
  );
}
