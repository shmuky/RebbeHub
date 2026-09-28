import { useState } from 'react';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

interface SegmentData {
  kind: 'heading' | 'paragraph' | 'footnote' | 'note' | 'quote';
  content: string;
  proofread: 0 | 1 | 2;
  origin?: { by: string; checked?: boolean };
}

const FIX_WORDS = {
  machineTranslation: {
    he: 'תרגום ממוחשב שטרם נבדק בידי אדם - פסקאות שלא נבדקו מסומנות.',
    en: 'Machine translation, not yet checked by a person - the paragraphs nobody has checked are marked.',
  },
} as const;

/**
 * "Fix" beside a paragraph of a translation, for a signed-in reader: the
 * paragraph opens as a box, and the fix goes for review as a Suggestion
 * (/_/translations/fix), like a fixed line of a scan.
 */
function FixParagraph({ segment, content, lang }: { segment: string; content: string; lang: Lang }) {
  const account = useAccount();
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;
  if (sent) return <span className="row-sub"> · {t(lang, 'lineSent')}</span>;
  if (editing === null)
    return (
      <button type="button" className="link-button segment-fix" onClick={() => setEditing(content)}>
        {t(lang, 'fixLine')}
      </button>
    );
  return (
    <span className="segment-editing">
      <textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={4} dir="auto" autoFocus />
      <span className="actions">
        <button
          type="button"
          disabled={!editing.trim() || editing.trim() === content}
          onClick={async () => {
            setError(null);
            const response = await fetch('/_/translations/fix', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ segment, content: editing }),
            }).catch(() => null);
            if (response?.ok) {
              setSent(true);
              setEditing(null);
            } else setError(((await response?.json().catch(() => null)) as { message?: string } | null)?.message ?? t(lang, 'error'));
          }}
        >
          {t(lang, 'sendForReview')}
        </button>
        <button type="button" className="secondary" onClick={() => setEditing(null)}>
          {t(lang, 'cancel')}
        </button>
      </span>
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}

/**
 * A text, paragraph by paragraph. Each paragraph is anchored by its
 * permanent id (`#rh-…`), so a citation links to it through any number of
 * edits; ¶ numbers are only how it is counted today. Machine text is marked
 * until a person has checked it. A translation's paragraphs can be fixed
 * in place (`fixable`).
 */
export function TextView({ segments, language, withheld, fixable, translation }: { segments: Entity[]; language: string; withheld?: string; fixable?: boolean; translation?: boolean }) {
  const lang = useLang();
  if (withheld) return <p className="notice">{t(lang, 'textWithheld')}</p>;
  const machine = segments.some((s) => (s.data as unknown as SegmentData).origin && !(s.data as unknown as SegmentData).origin?.checked);
  let n = 0;
  return (
    <div>
      {machine ? <p className="notice machine">{translation ? FIX_WORDS.machineTranslation[lang] : t(lang, 'machineText')}</p> : null}
      <div className="text-body" lang={language} dir={language === 'he' || language === 'yi' || language === 'ar' ? 'rtl' : 'ltr'}>
        {segments.map((segment) => {
          const data = segment.data as unknown as SegmentData;
          const unchecked = data.origin && !data.origin.checked;
          if (data.kind === 'heading') {
            return (
              <h3 key={segment.id} id={segment.id} className="segment">
                {data.content}
              </h3>
            );
          }
          n++;
          return (
            <p key={segment.id} id={segment.id} className={`segment${unchecked ? ' machine' : ''}`} data-proofread={data.proofread}>
              <a className="segment-anchor" href={`#${segment.id}`} aria-label={`¶${n}`}>
                ¶{n}
              </a>
              {data.content}
              {fixable ? (
                <>
                  {' '}
                  <FixParagraph segment={segment.id} content={data.content} lang={lang} />
                </>
              ) : null}
            </p>
          );
        })}
      </div>
    </div>
  );
}
