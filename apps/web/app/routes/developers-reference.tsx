import { useState } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/developers-reference';
import { DocsNav, words } from '../components/DevDocs.js';
import { accessLabel, curlExample, exampleOf, operationsOf, typescriptExample, type ApiOperation, type OpenApiDocument } from '../lib/apiExamples.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The interactive API reference (/developers/reference): every operation
 * the API's own OpenAPI document lists, grouped as it groups them, with
 * its parameters, who may call it, examples in curl and TypeScript, and a
 * form to try it against the API from this page (with a token, pasted
 * here and never kept).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const doc = await api.openapi<OpenApiDocument>();
  return { lang, siteUrl, doc, apiBase: api.baseUrl };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl } = loaderData;
  return pageMeta({ title: `${words(lang).reference} · ${words(lang).developers}`, description: 'Every route of the RebbeHub API, with examples in curl and TypeScript, tried from the page.', path: '/developers/reference', lang, siteUrl });
}

function schemaText(schema: unknown): string {
  return JSON.stringify(schema, null, 2);
}

/** One operation's form: its parameters and body, sent from the reader's browser to the API. */
function TryIt({ op, apiBase, token, doc }: { op: ApiOperation; apiBase: string; token: string; doc: OpenApiDocument }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(op.params.filter((p) => p.in !== 'header').map((p) => [p.name, p.required ? String(exampleOf(p.schema, p.name, doc) ?? '') : ''])),
  );
  const [body, setBody] = useState(() => (op.body?.type.includes('json') ? JSON.stringify(exampleOf(op.body.schema, '', doc), null, 2) : ''));
  const [answer, setAnswer] = useState<{ status: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (op.access === 'site' || (op.body && !op.body.type.includes('json'))) return null;

  const send = async () => {
    setBusy(true);
    try {
      let path = op.path;
      const query = new URLSearchParams();
      for (const p of op.params) {
        const value = values[p.name] ?? '';
        if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(value));
        else if (p.in === 'query' && value !== '') query.set(p.name, value);
      }
      const headers: Record<string, string> = { accept: 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      if (op.body) headers['content-type'] = 'application/json';
      const response = await fetch(`${apiBase}${path}${query.size ? `?${query}` : ''}`, { method: op.method, headers, body: op.body ? body : undefined });
      const text = await response.text();
      let shown = text;
      try {
        shown = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON (XML, text): shown as it came.
      }
      setAnswer({ status: response.status, text: shown.length > 20_000 ? `${shown.slice(0, 20_000)}\n…` : shown });
    } catch (error) {
      setAnswer({ status: 0, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="dev-try"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {op.params.filter((p) => p.in !== 'header').map((p) => (
        <label key={p.name}>
          <span>
            <code>{p.name}</code>
            {p.required ? ' *' : ''}
          </span>
          <input value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} dir="auto" />
        </label>
      ))}
      {op.body ? (
        <label>
          <span>body</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(12, body.split('\n').length + 1)} dir="ltr" spellCheck={false} />
        </label>
      ) : null}
      <div>
        <button type="submit" disabled={busy}>
          {busy ? 'Sending…' : `Send ${op.method}`}
        </button>
      </div>
      {answer ? (
        <pre dir="ltr" className="dev-answer" aria-live="polite">
          <code>{`${answer.status || 'Failed'}\n${answer.text}`}</code>
        </pre>
      ) : null}
    </form>
  );
}

export default function Reference({ loaderData }: Route.ComponentProps) {
  const { lang, doc, apiBase } = loaderData;
  const w = words(lang);
  const [token, setToken] = useState('');
  const ops = operationsOf(doc);
  const tags = (doc.tags ?? []).filter((t) => ops.some((o) => o.tag === t.name));
  const base = apiBase.replace(/\/+$/, '');
  return (
    <div className="dev-docs">
      <p className="subtitle">
        <Link to={href('/developers', lang)}>{w.developers}</Link>
        {w.englishOnly ? ` · ${w.englishOnly}` : ''}
      </p>
      <DocsNav lang={lang} current="reference" />
      <article className="dev-docs-page" dir="ltr" lang="en">
        <h1>API reference</h1>
        <p>
          {doc.info.title} {doc.info.version}, from <a href={`${base}/openapi.json`}>{base}/openapi.json</a>. Reading needs nothing; for what needs a
          signed-in person, paste a <Link to="/developers/auth">token</Link> here. It is sent only to the API, and forgotten when you leave the page.
        </p>
        <label className="dev-token">
          <span>Token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="rhp_…" autoComplete="off" />
        </label>
        <nav aria-label="Groups">
          <p>
            {tags.map((t, i) => (
              <span key={t.name}>
                {i ? ' · ' : ''}
                <a href={`#${t.name.toLowerCase()}`}>{t.name}</a>
              </span>
            ))}
          </p>
        </nav>
        {tags.map((t) => (
          <section key={t.name} id={t.name.toLowerCase()}>
            <h2>{t.name}</h2>
            {t.description ? <p className="row-sub">{t.description}</p> : null}
            {ops
              .filter((o) => o.tag === t.name)
              .map((op) => (
                <details key={`${op.method} ${op.path}`} id={op.id} className="dev-op">
                  <summary>
                    <code>
                      {op.method} {op.path}
                    </code>{' '}
                    {op.summary}
                    {op.deprecated ? ' (deprecated)' : ''}
                  </summary>
                  <p>
                    <b>{accessLabel(op)}.</b> {op.paged ? 'Paged: pass `next` back as cursor. ' : ''}
                    <code>{op.id}</code>
                  </p>
                  {op.description ? <p>{op.description}</p> : null}
                  {op.params.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Parameter</th>
                            <th>In</th>
                            <th>Type</th>
                            <th>What</th>
                          </tr>
                        </thead>
                        <tbody>
                          {op.params.map((p) => (
                            <tr key={`${p.in}${p.name}`}>
                              <td>
                                <code>{p.name}</code>
                                {p.required ? ' *' : ''}
                              </td>
                              <td>{p.in}</td>
                              <td>
                                <code>{p.schema.enum ? p.schema.enum.join(' | ') : String(p.schema.type ?? '')}</code>
                              </td>
                              <td>{p.description ?? p.schema.description ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {op.body ? (
                    <details>
                      <summary>Body ({op.body.type})</summary>
                      <pre dir="ltr">
                        <code>{schemaText(op.body.schema)}</code>
                      </pre>
                    </details>
                  ) : null}
                  <p>curl</p>
                  <pre dir="ltr">
                    <code>{curlExample(op, base, doc)}</code>
                  </pre>
                  {op.access !== 'site' && !op.summary.startsWith('Not offered') && op.path !== '/' ? (
                    <>
                      <p>TypeScript</p>
                      <pre dir="ltr">
                        <code>{typescriptExample(op, doc)}</code>
                      </pre>
                    </>
                  ) : null}
                  <TryIt op={op} apiBase={base} token={token} doc={doc} />
                </details>
              ))}
          </section>
        ))}
      </article>
    </div>
  );
}
