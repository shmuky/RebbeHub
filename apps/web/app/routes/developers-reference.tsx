import { useState } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/developers-reference';
import { CodeSamples, DocsShell, PrevNext, useDocsRoot, words } from '../components/DevDocs.js';
import { accessLabel, curlExample, exampleOf, operationsOf, typescriptExample, type ApiOperation, type OpenApiDocument } from '../lib/apiExamples.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { cx } from '../ui/primitives.js';
import '../styles/pages/developers.css';

/**
 * The interactive API reference (/developers/reference): every operation
 * the API's own OpenAPI document lists, grouped as it groups them. Each
 * reads as Stripe's do: on the start side its method and path, who may
 * call it, its parameters and body; on the end side its example in curl
 * and TypeScript, and a form to try it against the API from this page
 * (with a token, pasted here and never kept).
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

const ACCESS: Record<ApiOperation['access'], { icon: IconName; tone: string }> = {
  public: { icon: 'globe', tone: 'public' },
  optional: { icon: 'globe', tone: 'public' },
  read: { icon: 'key', tone: 'token' },
  write: { icon: 'key', tone: 'token' },
  site: { icon: 'lock', tone: 'site' },
};

function Method({ method }: { method: string }) {
  return <span className={cx('dv-method', method.toLowerCase())}>{method}</span>;
}

/** One operation's form: its parameters and body, sent from the reader's browser to the API. */
function TryIt({ op, apiBase, token, doc }: { op: ApiOperation; apiBase: string; token: string; doc: OpenApiDocument }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(op.params.filter((p) => p.in !== 'header').map((p) => [p.name, p.required ? String(exampleOf(p.schema, p.name, doc) ?? '') : ''])),
  );
  const [body, setBody] = useState(() => (op.body?.type.includes('json') ? JSON.stringify(exampleOf(op.body.schema, '', doc), null, 2) : ''));
  const [answer, setAnswer] = useState<{ status: number; text: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (op.access === 'site' || (op.body && !op.body.type.includes('json'))) return null;

  const send = async () => {
    setBusy(true);
    const started = performance.now();
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
      setAnswer({ status: response.status, text: shown.length > 20_000 ? `${shown.slice(0, 20_000)}\n…` : shown, ms: Math.round(performance.now() - started) });
    } catch (error) {
      setAnswer({ status: 0, text: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) });
    } finally {
      setBusy(false);
    }
  };

  const fields = op.params.filter((p) => p.in !== 'header');
  return (
    <details className="dv-try">
      <summary>
        <Icon name="play" size={12} />
        Try it
        <Icon name="chevd" className="chev" size={14} />
      </summary>
      <form
        className="dv-try-b"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {fields.map((p) => (
          <label key={p.name} className="dv-field">
            <span>
              <code>{p.name}</code>
              {p.required ? <em>required</em> : null}
              <span className="subtle">{p.in}</span>
            </span>
            <input value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} dir="auto" spellCheck={false} />
          </label>
        ))}
        {op.body ? (
          <label className="dv-field">
            <span>
              <code>body</code>
              <span className="subtle">application/json</span>
            </span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(12, body.split('\n').length + 1)} dir="ltr" spellCheck={false} />
          </label>
        ) : null}
        <div className="dv-try-f">
          <button type="submit" className="btn primary sm" disabled={busy}>
            {busy ? <Icon name="loader" className="spin" /> : <Icon name="play" size={12} />}
            {busy ? 'Sending…' : `Send ${op.method}`}
          </button>
          {!token && (op.access === 'read' || op.access === 'write') ? <span className="subtle">Needs a token (above)</span> : null}
        </div>
        {answer ? (
          <div className="dv-answer" aria-live="polite">
            <div className="dv-answer-h">
              <span className={cx('dv-status', answer.status >= 200 && answer.status < 300 ? 'ok' : 'bad')}>{answer.status || 'Failed'}</span>
              <span className="subtle">{answer.ms} ms</span>
            </div>
            <pre dir="ltr">
              <code>{answer.text}</code>
            </pre>
          </div>
        ) : null}
      </form>
    </details>
  );
}

function Operation({ op, base, token, doc }: { op: ApiOperation; base: string; token: string; doc: OpenApiDocument }) {
  const access = ACCESS[op.access];
  const typescript = op.access !== 'site' && !op.summary.startsWith('Not offered') && op.path !== '/';
  const samples = [{ label: 'curl', language: 'sh', code: curlExample(op, base, doc) }, ...(typescript ? [{ label: 'TypeScript', language: 'ts', code: typescriptExample(op, doc) }] : [])];
  return (
    <section id={op.id} className="dv-op">
      <div className="dv-op-doc">
        <h3>
          {op.summary}
          {op.deprecated ? <span className="dv-deprecated">Deprecated</span> : null}
          <a className="dv-anchor" href={`#${op.id}`} aria-label="Link to this route">
            #
          </a>
        </h3>
        <p className="dv-route">
          <Method method={op.method} />
          <code>
            {op.method} {op.path}
          </code>
        </p>
        <p className="dv-meta">
          <span className={cx('dv-access', access.tone)}>
            <Icon name={access.icon} size={13} />
            {accessLabel(op)}
          </span>
          {op.paged ? (
            <span className="dv-access">
              <Icon name="layers" size={13} />
              Paged: pass <code>next</code> back as <code>cursor</code>
            </span>
          ) : null}
          <span className="dv-opid mono">{op.id}</span>
        </p>
        {op.description ? <p className="dv-desc">{op.description}</p> : null}
        {op.params.length ? (
          <div className="dv-params">
            <h4>Parameters</h4>
            <ul>
              {op.params.map((p) => (
                <li key={`${p.in}${p.name}`}>
                  <div className="dv-param-h">
                    <code className="dv-pname">{p.name}</code>
                    <span className="dv-ptype">{p.schema.enum ? p.schema.enum.join(' | ') : String(p.schema.type ?? '')}</span>
                    <span className="dv-pin">{p.in}</span>
                    {p.required ? <span className="dv-req">required</span> : null}
                  </div>
                  {p.description ?? p.schema.description ? <p>{p.description ?? p.schema.description}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {op.body ? (
          <details className="dv-body">
            <summary>
              <Icon name="chevr" size={12} className="chev" />
              Body <span className="subtle">{op.body.type}</span>
              {op.body.required ? <span className="dv-req">required</span> : null}
            </summary>
            <pre dir="ltr">
              <code>{schemaText(op.body.schema)}</code>
            </pre>
          </details>
        ) : null}
      </div>
      <div className="dv-op-code">
        <CodeSamples name={op.id} samples={samples} />
        <TryIt op={op} apiBase={base} token={token} doc={doc} />
      </div>
    </section>
  );
}

export default function Reference({ loaderData }: Route.ComponentProps) {
  const { lang, doc, apiBase } = loaderData;
  const [token, setToken] = useState('');
  const root = useDocsRoot<HTMLDivElement>('reference');
  const ops = operationsOf(doc);
  const tags = (doc.tags ?? []).filter((t) => ops.some((o) => o.tag === t.name));
  const base = apiBase.replace(/\/+$/, '');
  const shownBase = /^https?:\/\//.test(base) ? base : 'https://api.rebbehub.org';

  const toc = (
    <nav className="dv-toc-in" aria-label="Groups">
      <h2>Groups</h2>
      <ul>
        {tags.map((t) => (
          <li key={t.name}>
            <a href={`#${t.name.toLowerCase()}`} data-toc={t.name.toLowerCase()}>
              {t.name}
              <span className="n">{ops.filter((o) => o.tag === t.name).length}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div ref={root}>
      <DocsShell lang={lang} current="reference" apiBase={shownBase} toc={toc}>
        <article className="dv-article dv-ref">
          <header className="dv-head">
            <p className="dv-kicker">
              <Link to={href('/developers', lang)}>Developers</Link>
              <Icon name="chevr" size={12} />
              <span>Using the API</span>
            </p>
            <h1>API reference</h1>
            <p className="dv-lede">
              {doc.info.title} {doc.info.version}: {ops.length} routes in {tags.length} groups, read from the API&apos;s own <a href={`${base}/openapi.json`}>OpenAPI document</a>.
            </p>
          </header>

          <div className="dv-intro">
            <div className="dv-intro-row">
              <span className="k">Base URL</span>
              <code className="dv-base">{shownBase}</code>
            </div>
            <div className="dv-intro-row">
              <span className="k">Reading</span>
              <span>Needs nothing: no account, no key.</span>
            </div>
            <label className="dv-intro-row dv-token">
              <span className="k">Token</span>
              <span className="dv-token-in">
                <Icon name="key" />
                <input type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="rhp_…" autoComplete="off" spellCheck={false} />
              </span>
            </label>
            <p className="dv-intro-note">
              For what needs a signed-in person, paste a <Link to={href('/developers/auth', lang)}>personal token</Link>. It is sent only to the API, and forgotten when you leave the page.
            </p>
          </div>

          {tags.map((t) => (
            <section key={t.name} id={t.name.toLowerCase()} className="dv-tag">
              <h2>
                {t.name}
                <a className="dv-anchor" href={`#${t.name.toLowerCase()}`} aria-label="Link to this group">
                  #
                </a>
              </h2>
              {t.description ? <p className="dv-tag-desc">{t.description}</p> : null}
              <ul className="dv-tag-index">
                {ops
                  .filter((o) => o.tag === t.name)
                  .map((op) => (
                    <li key={`${op.method} ${op.path}`}>
                      <a href={`#${op.id}`}>
                        <Method method={op.method} />
                        <code>{op.path}</code>
                        <span className="subtle">{op.summary}</span>
                      </a>
                    </li>
                  ))}
              </ul>
              {ops
                .filter((o) => o.tag === t.name)
                .map((op) => (
                  <Operation key={`${op.method} ${op.path}`} op={op} base={base} token={token} doc={doc} />
                ))}
            </section>
          ))}
          <PrevNext lang={lang} current="reference" />
        </article>
      </DocsShell>
    </div>
  );
}
