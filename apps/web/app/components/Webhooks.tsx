import { useCallback, useEffect, useState } from 'react';
import { t, type Lang } from '../lib/i18n.js';
import { Icon } from '../ui/Icon.js';
import { Box, Label } from '../ui/primitives.js';

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
    <Box
      as="section"
      id="webhooks"
      className="set-box"
      header={
        <>
          <Icon name="link" />
          <h2>{t(lang, 'webhooks')}</h2>
        </>
      }
    >
      <p className="set-intro">{t(lang, 'webhooksIntro')}</p>
      {hooks.length ? (
        <ul className="rows">
          {hooks.map((h) => (
            <li key={h.id} className="row">
              <Icon name="link" />
              <span className="row-main">
                <span className="row-title mono" dir="ltr">
                  {h.url}
                </span>
                <span className="row-sub">
                  {h.active ? (h.failures ? `${h.failures} × ${h.lastError ?? ''}` : <Label size="sm" tone="sync">{t(lang, 'webhookOk')}</Label>) : <Label size="sm" tone="scan">{t(lang, 'webhookOff')}</Label>}
                </span>
              </span>
              <button type="button" className="btn sm danger" onClick={async () => void (await call(`webhooks/${h.id}`, 'DELETE').then(load))}>
                {t(lang, 'remove')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {secret ? (
        <div className="set-pad">
          <div className="alert positive" role="status">
            <Icon name="check" />
            <div className="grow">
              {t(lang, 'webhookSecret')}
              <div className="secret-line">
                <code dir="ltr">{secret}</code>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <form
        className="form set-form set-inline"
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
        <label className="field grow">
          {t(lang, 'webhookUrl')}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" dir="ltr" required />
        </label>
        <button type="submit" className="btn">
          <Icon name="plus" />
          {t(lang, 'add')}
        </button>
        {error ? (
          <div className="alert negative set-inline-full" role="alert">
            <Icon name="warn" />
            <div>{error}</div>
          </div>
        ) : null}
      </form>
    </Box>
  );
}
