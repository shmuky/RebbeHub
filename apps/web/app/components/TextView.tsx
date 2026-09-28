import type { Entity } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';

interface SegmentData {
  kind: 'heading' | 'paragraph' | 'footnote' | 'note' | 'quote';
  content: string;
  proofread: 0 | 1 | 2;
  origin?: { by: string; checked?: boolean };
}

/**
 * A text, paragraph by paragraph. Each paragraph is anchored by its
 * permanent id (`#rh-…`), so a citation links to it through any number of
 * edits; ¶ numbers are only how it is counted today. Machine text is marked
 * until a person has checked it.
 */
export function TextView({ segments, language, withheld }: { segments: Entity[]; language: string; withheld?: string }) {
  const lang = useLang();
  if (withheld) return <p className="notice">{t(lang, 'textWithheld')}</p>;
  const machine = segments.some((s) => (s.data as unknown as SegmentData).origin && !(s.data as unknown as SegmentData).origin?.checked);
  let n = 0;
  return (
    <div>
      {machine ? <p className="notice machine">{t(lang, 'machineText')}</p> : null}
      <div className="text-body" lang={language} dir={language === 'en' ? 'ltr' : 'rtl'}>
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
            </p>
          );
        })}
      </div>
    </div>
  );
}
