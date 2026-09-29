import { useState } from 'react';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { Icon } from '../ui/Icon.js';
import { Panel } from '../ui/primitives.js';

/** "Embed on another site": the code to paste, and a button to copy it. */
export function EmbedCode({ entity, lang, siteUrl }: { entity: Pick<Entity, 'id'>; lang: Lang; siteUrl: string }) {
  const [copied, setCopied] = useState(false);
  const code = `<iframe src="${siteUrl.replace(/\/$/, '')}/embed/${entity.id}${lang === 'en' ? '?lang=en' : ''}" width="100%" height="320" style="border:0" loading="lazy" title="RebbeHub"></iframe>`;
  return (
    <Panel id="embed" icon="embed" title={t(lang, 'embedOnSite')}>
      <div className="stack">
        <textarea className="code-box" readOnly value={code} rows={3} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label={t(lang, 'embedOnSite')} />
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(code).catch(() => {});
              setCopied(true);
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} />
            {copied ? t(lang, 'copied') : t(lang, 'copyCode')}
          </button>
        </div>
      </div>
    </Panel>
  );
}
