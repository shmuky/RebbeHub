import { useState } from 'react';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';

/** "Embed on another site": the code to paste, and a button to copy it. */
export function EmbedCode({ entity, lang, siteUrl }: { entity: Pick<Entity, 'id'>; lang: Lang; siteUrl: string }) {
  const [copied, setCopied] = useState(false);
  const code = `<iframe src="${siteUrl.replace(/\/$/, '')}/embed/${entity.id}${lang === 'en' ? '?lang=en' : ''}" width="100%" height="320" style="border:0" loading="lazy" title="RebbeHub"></iframe>`;
  return (
    <details className="report embed-code">
      <summary>{t(lang, 'embedOnSite')}</summary>
      <textarea readOnly value={code} rows={3} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
      <div>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(code).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? t(lang, 'copied') : t(lang, 'copyCode')}
        </button>
      </div>
    </details>
  );
}
