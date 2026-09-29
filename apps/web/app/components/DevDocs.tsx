import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { DOC_PAGES } from '../lib/developerDocs.js';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { cx } from '../ui/primitives.js';

/**
 * The developer docs' frame (routes/developers.tsx and
 * developers-reference.tsx), read the way people read Stripe's and
 * GitHub's: the pages in groups down the start, the page in the middle,
 * what is on it down the end. Code comes in boxes with the language and a
 * Copy button; a curl example beside its TypeScript twin is one box with
 * two tabs, and choosing one language chooses it everywhere (kept in this
 * browser). The tabs are radio buttons, so they work without script.
 */

/** The page's own few words, in both languages (the docs themselves are English). */
export function words(lang: Lang) {
  return lang === 'he'
    ? { developers: 'למפתחים', pages: 'דפי התיעוד', reference: 'מדריך ה-API האינטראקטיבי', edit: 'עריכת הדף ב-GitHub', onThisPage: 'בדף הזה', englishOnly: 'התיעוד למפתחים כתוב באנגלית.', menu: 'תפריט התיעוד' }
    : { developers: 'Developers', pages: 'The docs', reference: 'Interactive API reference', edit: 'Edit this page on GitHub', onThisPage: 'On this page', englishOnly: '', menu: 'Docs menu' };
}

/** The pages in groups, in reading order; `reference` is the interactive reference. */
export const DOC_GROUPS: Array<{ title: string; slugs: string[] }> = [
  { title: 'Get started', slugs: ['', 'getting-started', 'auth', 'api'] },
  { title: 'Using the API', slugs: ['endpoints', 'reference', 'suggestions', 'rate-limits', 'webhooks'] },
  { title: 'The catalog', slugs: ['data-model', 'rights', 'dumps', 'oai-pmh'] },
  { title: 'Tools', slugs: ['client', 'agents'] },
];

export const DOC_ICONS: Record<string, IconName> = {
  '': 'home',
  'getting-started': 'arrow',
  auth: 'key',
  api: 'info',
  endpoints: 'layers',
  reference: 'code',
  suggestions: 'suggest',
  'rate-limits': 'clock',
  webhooks: 'bell',
  'data-model': 'database',
  rights: 'shield',
  dumps: 'down',
  'oai-pmh': 'book',
  client: 'code',
  agents: 'bot',
};

const REFERENCE = { slug: 'reference', title: 'API reference', summary: 'Every route, with examples, tried from the page' };

/** A page by its slug, the reference among them. */
export function docEntry(slug: string): { slug: string; title: string; summary: string } | undefined {
  return slug === 'reference' ? REFERENCE : DOC_PAGES.find((p) => p.slug === slug);
}

/** The pages in the nav's order: for "previous" and "next" at a page's foot. */
export const DOC_ORDER = DOC_GROUPS.flatMap((g) => g.slugs);

const docHref = (slug: string, lang: Lang) => href(`/developers${slug ? `/${slug}` : ''}`, lang);

/** Where agents and machines read from: llms.txt, the whole docs in one file, the OpenAPI document, the MCP server. */
export function MachineLinks({ apiBase }: { apiBase: string }) {
  return (
    <ul className="dv-machine">
      <li>
        <a href="/llms.txt">
          <Icon name="bot" />
          <span>llms.txt</span>
        </a>
      </li>
      <li>
        <a href="/llms-full.txt">
          <Icon name="file" />
          <span>llms-full.txt</span>
        </a>
      </li>
      <li>
        <a href={`${apiBase}/openapi.json`}>
          <Icon name="code" />
          <span>openapi.json</span>
        </a>
      </li>
      <li>
        <a href={`${apiBase}/mcp`}>
          <Icon name="link" />
          <span>MCP server</span>
        </a>
      </li>
    </ul>
  );
}

export function DocsNav({ lang, current, apiBase }: { lang: Lang; current: string | null; apiBase: string }) {
  const w = words(lang);
  return (
    <nav className="dv-nav-list" aria-label={w.pages}>
      {DOC_GROUPS.map((group) => (
        <div key={group.title} className="dv-group">
          <h2>{group.title}</h2>
          <ul>
            {group.slugs.map((slug) => {
              const page = docEntry(slug);
              if (!page) return null;
              return (
                <li key={slug}>
                  <Link to={docHref(slug, lang)} aria-current={current === slug ? 'page' : undefined}>
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="dv-group">
        <h2>For AI agents</h2>
        <MachineLinks apiBase={apiBase} />
      </div>
    </nav>
  );
}

/**
 * The frame: the nav (a disclosure on a phone), the page, and its
 * contents beside it. The docs are English, so the frame reads left to
 * right whatever the site's language; a line above says so in Hebrew.
 */
export function DocsShell({ lang, current, apiBase, toc, children }: { lang: Lang; current: string; apiBase: string; toc?: ReactNode; children: ReactNode }) {
  const w = words(lang);
  const page = docEntry(current);
  return (
    <div className="dv">
      {w.englishOnly ? (
        <p className="dv-lang" dir="rtl" lang="he">
          <Icon name="globe" />
          {w.englishOnly}
        </p>
      ) : null}
      <div className="dv-grid" dir="ltr" lang="en">
        <aside className="dv-nav">
          <details className="dv-menu">
            <summary>
              <Icon name="menu" />
              <span>{page?.title ?? w.developers}</span>
              <Icon name="chevd" className="chev" size={14} />
            </summary>
            <DocsNav lang={lang} current={current} apiBase={apiBase} />
          </details>
          <div className="dv-nav-wide">
            <Link className="dv-home" to={docHref('', lang)}>
              <Icon name="code" />
              Developers
            </Link>
            <DocsNav lang={lang} current={current} apiBase={apiBase} />
          </div>
        </aside>
        <div className="dv-page">{children}</div>
        {toc ? <aside className="dv-toc">{toc}</aside> : null}
      </div>
    </div>
  );
}

/** "On this page": the page's headings, the one being read marked as it scrolls. */
export function OnThisPage({ headings, title }: { headings: Array<{ id: string; text: string; depth: number }>; title: string }) {
  if (headings.length < 2) return null;
  return (
    <nav className="dv-toc-in" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {headings.map((h) => (
          <li key={h.id} className={cx(h.depth > 2 && 'sub')}>
            <a href={`#${h.id}`} data-toc={h.id}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Previous and next, at a page's foot. */
export function PrevNext({ lang, current }: { lang: Lang; current: string }) {
  const i = DOC_ORDER.indexOf(current);
  const prev = i > 0 ? docEntry(DOC_ORDER[i - 1]!) : undefined;
  const next = i >= 0 && i < DOC_ORDER.length - 1 ? docEntry(DOC_ORDER[i + 1]!) : undefined;
  if (!prev && !next) return null;
  return (
    <nav className="dv-prevnext" aria-label="Pages">
      {prev ? (
        <Link to={docHref(prev.slug, lang)} rel="prev">
          <span className="k">Previous</span>
          <span className="t">
            <Icon name="chevr" className="flip" size={14} />
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={docHref(next.slug, lang)} rel="next" className="next">
          <span className="k">Next</span>
          <span className="t">
            {next.title}
            <Icon name="chevr" size={14} />
          </span>
        </Link>
      ) : null}
    </nav>
  );
}

/* ------------------------------------------------------------ code */

const LANGUAGES: Record<string, string> = { sh: 'Shell', bash: 'Shell', ts: 'TypeScript', typescript: 'TypeScript', js: 'JavaScript', json: 'JSON', http: 'HTTP', html: 'HTML', cron: 'cron', xml: 'XML', sql: 'SQL', '': 'Text' };

/** A code sample's name on its tab: `curl` for a shell line that is one, else the language. */
export function languageName(language: string, code: string): string {
  if ((language === 'sh' || language === 'bash') && /^\s*curl\b/.test(code)) return 'curl';
  return LANGUAGES[language] ?? language;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeHtml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const COPY = '<button type="button" class="dv-copy" data-copy hidden><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg><span>Copy</span></button>';

/**
 * The docs' HTML (lib/markdown.ts) made ready to read: each code block in
 * a box with its language and a Copy button, a shell example followed by
 * its TypeScript twin as one box with a tab each, and a link beside each
 * heading. The HTML is the renderer's own, already escaped; only its
 * shapes are matched here.
 */
export function decorateDocHtml(html: string): string {
  let group = 0;
  const block = /<pre dir="ltr"><code(?: class="language-([\w-]+)")?>((?:(?!<\/code>)[\s\S])*)<\/code><\/pre>/g;
  const pair = new RegExp(`${block.source}\\s*${block.source}`, 'g');
  let out = html.replace(pair, (whole, l1: string | undefined, c1: string, l2: string | undefined, c2: string) => {
    const a = l1 ?? '';
    const b = l2 ?? '';
    if (!((a === 'sh' || a === 'bash') && (b === 'ts' || b === 'typescript'))) return whole;
    group += 1;
    return tabsHtml(`g${group}`, [
      { label: languageName(a, unescapeHtml(c1)), language: a, html: c1 },
      { label: languageName(b, unescapeHtml(c2)), language: b, html: c2 },
    ]);
  });
  out = out.replace(block, (_, l: string | undefined, code: string) => {
    const language = l ?? '';
    return `<div class="dv-code"><div class="dv-code-h"><span class="dv-code-l">${escapeHtml(languageName(language, unescapeHtml(code)))}</span>${COPY}</div><pre dir="ltr"><code${language ? ` class="language-${language}"` : ''}>${code}</code></pre></div>`;
  });
  out = out.replace(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g, (_, depth: string, id: string, inner: string) => `<h${depth} id="${id}">${inner}<a class="dv-anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>`);
  return out;
}

/** Tabs as radio buttons and labels, so they switch without script. */
function tabsHtml(name: string, samples: Array<{ label: string; language: string; html: string }>): string {
  const heads = samples
    .map((s, i) => `<input type="radio" class="dv-tab-in" name="dv-${name}" id="dv-${name}-${i}" value="${escapeHtml(s.label)}"${i === 0 ? ' checked' : ''}><label for="dv-${name}-${i}" data-lang="${escapeHtml(s.label)}">${escapeHtml(s.label)}</label>`)
    .join('');
  const panes = samples.map((s) => `<pre dir="ltr" class="dv-pane"><code${s.language ? ` class="language-${s.language}"` : ''}>${s.html}</code></pre>`).join('');
  return `<div class="dv-code dv-tabs">${heads}<div class="dv-code-h dv-tabs-h"><span class="dv-tabs-l"></span>${COPY}</div>${panes}</div>`;
}

/** The same boxes, drawn by React for code the page makes (the reference's examples). */
export function CodeSamples({ name, samples }: { name: string; samples: Array<{ label: string; language: string; code: string }> }) {
  if (samples.length === 1) {
    const s = samples[0]!;
    return (
      <div className="dv-code">
        <div className="dv-code-h">
          <span className="dv-code-l">{s.label}</span>
          <CopyButton />
        </div>
        <pre dir="ltr">
          <code className={s.language ? `language-${s.language}` : undefined}>{s.code}</code>
        </pre>
      </div>
    );
  }
  return (
    <div className="dv-code dv-tabs">
      {samples.map((s, i) => (
        <Fragment key={s.label}>
          <input type="radio" className="dv-tab-in" name={`dv-${name}`} id={`dv-${name}-${i}`} value={s.label} defaultChecked={i === 0} />
          <label htmlFor={`dv-${name}-${i}`} data-lang={s.label}>
            {s.label}
          </label>
        </Fragment>
      ))}
      <div className="dv-code-h dv-tabs-h">
        <span className="dv-tabs-l" />
        <CopyButton />
      </div>
      {samples.map((s) => (
        <pre key={s.label} dir="ltr" className="dv-pane">
          <code className={s.language ? `language-${s.language}` : undefined}>{s.code}</code>
        </pre>
      ))}
    </div>
  );
}

/** Shown once script runs, since only script can copy. */
function CopyButton() {
  const [js, setJs] = useState(false);
  useEffect(() => setJs(true), []);
  return (
    <button type="button" className="dv-copy" data-copy hidden={!js}>
      <Icon name="copy" />
      <span>Copy</span>
    </button>
  );
}

const PREFERRED = 'rh-docs-language';

/**
 * What the docs do once script runs: Copy buttons appear and copy their
 * box's code; choosing curl or TypeScript in one box chooses it in every
 * box (and next time); "On this page" marks the heading being read.
 */
export function useDocsBehaviour(root: React.RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-copy]')) b.hidden = false;

    const choose = (label: string) => {
      for (const input of el.querySelectorAll<HTMLInputElement>('.dv-tab-in')) if (input.value === label) input.checked = true;
    };
    try {
      const saved = localStorage.getItem(PREFERRED);
      if (saved) choose(saved);
    } catch {
      // No storage (a private window): the first tab stays chosen.
    }

    const onClick = async (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
      if (!button) return;
      const box = button.closest('.dv-code');
      const pre = box?.classList.contains('dv-tabs')
        ? [...box.querySelectorAll<HTMLElement>('.dv-pane')][[...box.querySelectorAll<HTMLInputElement>('.dv-tab-in')].findIndex((i) => i.checked)]
        : box?.querySelector('pre');
      if (!pre) return;
      try {
        await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ''));
        const label = button.querySelector('span');
        if (label) {
          label.textContent = 'Copied';
          button.classList.add('done');
          setTimeout(() => {
            label.textContent = 'Copy';
            button.classList.remove('done');
          }, 1600);
        }
      } catch {
        // The browser would not let the page write to the clipboard; the code is there to select.
      }
    };
    const onChange = (event: Event) => {
      const input = event.target as HTMLInputElement;
      if (!input.classList?.contains('dv-tab-in')) return;
      choose(input.value);
      try {
        localStorage.setItem(PREFERRED, input.value);
      } catch {
        // Not kept; chosen for this page only.
      }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);

    // "On this page": the last heading above the top third of the screen.
    const links = [...el.querySelectorAll<HTMLAnchorElement>('[data-toc]')];
    const headings = links.map((a) => document.getElementById(a.dataset.toc!)).filter((h): h is HTMLElement => Boolean(h));
    let frame = 0;
    const mark = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let current = headings[0]?.id;
      for (const h of headings) if (h.getBoundingClientRect().top < line) current = h.id;
      for (const a of links) a.setAttribute('aria-current', a.dataset.toc === current ? 'true' : 'false');
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(mark);
    };
    if (headings.length) {
      mark();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('change', onChange);
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root, key]);
}

/** A ref and the behaviour, for a page's root element. */
export function useDocsRoot<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useDocsBehaviour(ref, key);
  return ref;
}
