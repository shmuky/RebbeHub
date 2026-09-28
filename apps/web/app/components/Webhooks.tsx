import { useCallback, useEffect, useState } from 'react';
import { t, type Lang } from '../lib/i18n.js';

/**
 * For developers: addresses every merge to the catalog is posted to,
 * signed (docs/api.md, Webhooks). The secret for checking signatures is
 * shown once, when the address is added.
 */

interface Hook {
  id: number;
  url: string;
  active: boolean;
  failures: number;
  lastError: string | null;
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

export function Webhooks({ lang }: { lang: Lang }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setHooks((await call<{ webhooks: Hook[] }>('webhooks').catch(() => ({ webhooks: [] }))).webhooks), []);
  useEffect(() => void load(), [load]);

  return (
    <details className="report">
      <summary>{t(lang, 'webhooks')}</summary>
      <p className="row-sub">{t(lang, 'webhooksIntro')}</p>
      <ul className="rows">
        {hooks.map((h) => (
          <li key={h.id} className="row">
            <span className="row-main">
              <span className="row-title" dir="ltr">
                {h.url}
              </span>
              <span className="row-sub">{h.active ? (h.failures ? `${h.failures} × ${h.lastError ?? ''}` : t(lang, 'webhookOk')) : t(lang, 'webhookOff')}</span>
            </span>
            <button type="button" className="link-button" onClick={async () => void (await call(`webhooks/${h.id}`, 'DELETE').then(load))}>
              {t(lang, 'remove')}
            </button>
          </li>
        ))}
      </ul>
      {secret ? (
        <p className="note" role="status">
          {t(lang, 'webhookSecret')} <code dir="ltr">{secret}</code>
        </p>
      ) : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const made = await call<{ secret: string }>('webhooks', 'POST', { url });
            setSecret(made.secret);
            setUrl('');
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <label>
          {t(lang, 'webhookUrl')}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" dir="ltr" required />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <button type="submit">{t(lang, 'add')}</button>
        </div>
      </form>
    </details>
  );
}
