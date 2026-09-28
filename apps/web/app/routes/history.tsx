import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/history';
import { ChangeTable } from '../components/ChangeTable.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { personName } from '../lib/people.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * History: every version of an item, who changed what and who approved
 * it, the change itself in words, and "restore this version", which sends
 * the older version for review like any suggestion. Nothing is ever lost.
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

function RestoreButton({ entityId, rev, lang }: { entityId: string; rev: number; lang: Lang }) {
  const [state, setState] = useState<{ busy?: boolean; sent?: number; error?: string }>({});
  if (state.sent)
    return (
      <p className="row-sub" role="status">
        {t(lang, 'restoreSent')} <Link to={href('/review', lang, { s: String(state.sent) })}>{t(lang, 'suggestSee')}</Link>
      </p>
    );
  return (
    <>
      <button
        type="button"
        className="link-button"
        disabled={state.busy}
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
        {t(lang, 'restoreVersion')}
      </button>
      {state.error ? <span role="alert"> {state.error}</span> : null}
    </>
  );
}

export default function History({ loaderData }: Route.ComponentProps) {
  const { lang, entity, history } = loaderData;
  const account = useAccount();
  const when = (at: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
  return (
    <>
      <ol className="breadcrumbs">
        <li>
          <Link to={href(itemPath(entity), lang)}>{labelOf(entity, lang)}</Link>
        </li>
      </ol>
      <h1>
        {t(lang, 'historyOf')} {labelOf(entity, lang)}
      </h1>
      <p className="subtitle">{t(lang, 'historyIntro')}</p>
      <ol className="history">
        {history.map((h, i) => (
          <li key={h.commit} className="history-entry">
            <p className="history-title">
              <strong>{h.message}</strong>
              {i === 0 ? <span className="badge">{t(lang, 'currentVersion')}</span> : null}
            </p>
            <p className="row-sub" suppressHydrationWarning>
              {t(lang, 'changedBy')} {personName(h.author, h.authorName, lang)}
              {h.mergedBy !== h.author ? `, ${t(lang, 'approvedBy')} ${personName(h.mergedBy, h.mergedByName, lang)}` : ''} · {when(h.at)}
            </p>
            {h.created ? <p className="row-sub">{t(lang, 'versionCreated')}</p> : h.deleted ? <p className="row-sub">{t(lang, 'versionDeleted')}</p> : <ChangeTable changes={h.changes} lang={lang} />}
            {i > 0 && account && !h.deleted ? <RestoreButton entityId={entity.id} rev={h.rev} lang={lang} /> : null}
          </li>
        ))}
      </ol>
    </>
  );
}
