import { Link } from 'react-router';
import { SHAAR_SECTIONS, shaarBlocks, shaarFromCatalog, shaarIsEmpty, type ShaarRun, type WorkData, type WorkShaar } from '@rebbehub/model';
import type { Entity } from '../lib/api.js';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { Icon } from '../ui/Icon.js';
import { MachineLabel } from '../ui/primitives.js';

const WORDS = {
  shaar: { he: 'שער', en: 'Shaar' },
  edit: { he: 'עריכת השער', en: 'Edit the shaar' },
  write: { he: 'כתיבת השער', en: 'Write the shaar' },
  machine: { he: 'נעשה מנתוני הקטלוג, עוד לא נקרא בידי אדם', en: 'Made from the catalog; no person has read it yet' },
  none: { he: 'לספר הזה עוד אין שער: מה הוא, איך הוא בנוי, ההדפסות והמקורות שלו.', en: 'This sefer has no shaar yet: what it is, how it is built, its printings and its sources.' },
} as const;

/** A sefer's shaar as it is kept, or, for one no person wrote, as the catalog makes it (model/shaar.ts). */
export function shaarOf(data: Pick<WorkData, 'shaar' | 'description' | 'levels'>): WorkShaar {
  return data.shaar ?? shaarFromCatalog(data);
}

/** Whether no person has read a sefer's shaar yet. */
export const shaarIsMachine = (shaar: WorkShaar): boolean => Boolean(shaar.origin && !shaar.origin.checked);

function Runs({ runs }: { runs: ShaarRun[] }) {
  return (
    <>
      {runs.map((run, i) =>
        'br' in run ? (
          <br key={i} />
        ) : 'href' in run ? (
          run.href.startsWith('/') ? (
            <Link key={i} to={run.href}>
              {run.text}
            </Link>
          ) : (
            <a key={i} href={run.href} rel="nofollow noopener" target="_blank">
              {run.text}
            </a>
          )
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A sefer's shaar on its page, as a repository's README is under its
 * files: its sections under their headings, and a way to edit it. Words
 * only, never markup: the file has none to draw.
 */
export function ShaarFile({ work, lang }: { work: Pick<Entity, 'id' | 'data'>; lang: Lang }) {
  const shaar = shaarOf(work.data as unknown as WorkData);
  const edit = href(`/shaar/${work.id}`, lang);
  if (shaarIsEmpty(shaar))
    return (
      <div className="box help-note shaar-none">
        <Icon name="file" className="subtle" />
        <span className="grow">{WORDS.none[lang]}</span>
        <Link className="btn sm" to={edit}>
          {WORDS.write[lang]}
        </Link>
      </div>
    );
  return (
    <section className="box shaar-file" id="shaar" aria-labelledby="shaar-h">
      <div className="box-h">
        <Icon name="file" className="subtle" />
        <h2 id="shaar-h">{WORDS.shaar[lang]}</h2>
        {shaarIsMachine(shaar) ? <MachineLabel lang={lang} size="sm">{WORDS.machine[lang]}</MachineLabel> : null}
        <Link className="btn icon sm end" to={edit} aria-label={WORDS.edit[lang]} title={WORDS.edit[lang]}>
          <Icon name="pencil" />
        </Link>
      </div>
      <div className="shaar-body">
        {SHAAR_SECTIONS.filter((s) => shaar.sections?.[s.key]).map((s) => (
          <section key={s.key} className="shaar-section">
            <h3>{s[lang]}</h3>
            {shaarBlocks(shaar.sections![s.key]!).map((block, i) =>
              block.kind === 'paragraph' ? (
                <p key={i}>
                  <Runs runs={block.runs} />
                </p>
              ) : (
                <ul key={i}>
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <Runs runs={item} />
                    </li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
        {!shaar.sections || !Object.values(shaar.sections).some(Boolean) ? (
          <p className="subtle">{[shaar.subtitle?.[lang] ?? shaar.subtitle?.he, shaar.byLine?.[lang] ?? shaar.byLine?.he].filter(Boolean).join(' · ')}</p>
        ) : null}
      </div>
    </section>
  );
}
