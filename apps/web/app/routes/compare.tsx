import { data, Link } from 'react-router';
import type { Route } from './+types/compare';
import type { Printing } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import type { DiffPart } from '../lib/wordDiff.js';
import { DiffBox, DiffStat, InlineDiff } from '../ui/Diff.js';
import { Icon } from '../ui/Icon.js';
import { Breadcrumbs, EmptyState, MachineLabel, MachineNote, StatusBadge } from '../ui/primitives.js';
import '../styles/pages/text.css';

/**
 * Compare printings (the plan, section 9): two printings of one sicha or
 * letter, word by word, on one page. What only the first has is struck
 * through in red, what only the second has is marked in green, as a
 * suggestion's change is; niqqud, geresh and final letters are no
 * difference. The two are picked from the list of printings, first and
 * second, by links (the page works without script). Machine text is
 * labelled as such, since a misreading looks like a difference.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const unit = await api.entity(params.unit);
  if (!unit || unit.type !== 'unit') throw data('not found', { status: 404 });
  const printings = await api.printings(unit.id);
  const search = new URL(request.url).searchParams;
  const a = search.get('a') ?? printings[0]?.key ?? null;
  const b = search.get('b') ?? printings.find((p) => p.key !== a)?.key ?? null;
  const comparison = a && b && a !== b ? await api.compare(a, b) : null;
  return { lang, siteUrl, unit, printings, a, b, comparison };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, unit } = loaderData;
  return pageMeta({ title: `${t(lang, 'comparePrintings')} · ${labelOf(unit, lang)}`, path: `/compare/${unit.id}`, lang, siteUrl, noindex: true });
}

const W = {
  printings: { he: 'הדפוסים', en: 'Printings' },
  pickTwo: { he: 'בחרו ראשון ושני', en: 'Pick a first and a second' },
  first: { he: 'ראשון', en: 'First' },
  second: { he: 'שני', en: 'Second' },
  asFirst: { he: 'להשוות כראשון', en: 'Compare as the first' },
  asSecond: { he: 'להשוות כשני', en: 'Compare as the second' },
  kindText: { he: 'טקסט', en: 'Text' },
  kindScan: { he: 'עמודי סריקה', en: 'Scanned pages' },
  checked: { he: 'נבדק', en: 'Checked' },
  swap: { he: 'החלפת הצדדים', en: 'Swap sides' },
  same: { he: 'זהים', en: 'The same' },
  identical: { he: 'שני הדפוסים זהים מילה במילה.', en: 'The two printings are the same, word for word.' },
  pickOther: { he: 'בחרו שני דפוסים שונים.', en: 'Pick two different printings.' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const OP_KIND = { same: 'same', removed: 'del', added: 'ins' } as const;

/**
 * The runs as passages to read: a new one after a sentence ends once it
 * has some length, so the margin numbers say where in the text a
 * difference is.
 */
function passages(runs: Array<{ op: 'same' | 'removed' | 'added'; text: string }>): DiffPart[][] {
  const out: DiffPart[][] = [];
  let current: DiffPart[] = [];
  let words = 0;
  for (const run of runs) {
    const kind = OP_KIND[run.op];
    const text = run.text.replace(/\s+/g, ' ').trim();
    const pieces = kind === 'same' ? text.split(/(?<=[.:;])\s+/) : [text];
    pieces.forEach((piece, i) => {
      if (!piece) return;
      current.push({ kind, text: `${piece} ` });
      words += piece.split(/\s+/).length;
      const ended = kind === 'same' && (i < pieces.length - 1 || /[.:;]$/.test(piece));
      if (ended && words >= 24) {
        out.push(current);
        current = [];
        words = 0;
      }
    });
  }
  if (current.length) out.push(current);
  return out;
}

export default function Compare({ loaderData }: Route.ComponentProps) {
  const { lang, unit, a, b, comparison } = loaderData;
  const printings = loaderData.printings as Printing[];
  const label = (key: string | null) => nameOf(printings.find((p) => p.key === key)?.label, lang) || key || '';
  // A link that makes `key` the first (or second) printing, swapping when it already is the other.
  const pickTo = (key: string, side: 'a' | 'b') => {
    const next = side === 'a' ? { a: key, b: key === b ? (a ?? undefined) : (b ?? undefined) } : { a: key === a ? (b ?? undefined) : (a ?? undefined), b: key };
    return href(`/compare/${unit.id}`, lang, next);
  };
  const parts: DiffPart[] = comparison ? comparison.runs.map((r) => ({ kind: OP_KIND[r.op], text: r.text })) : [];
  const unchecked = comparison && (!comparison.a.checked || !comparison.b.checked);
  return (
    <div className="compare-page">
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs lang={lang} items={[{ label: labelOf(unit, lang), to: href(itemPath(unit), lang) }, { label: t(lang, 'comparePrintings') }]} />
          <div className="phead-row">
            <div>
              <h1 className="page-title torah">{labelOf(unit, lang)}</h1>
              <p className="lede">{t(lang, 'compareIntro')}</p>
            </div>
            {comparison ? (
              <div className="phead-acts">
                <Link className="btn" to={href(`/compare/${unit.id}`, lang, { a: b ?? undefined, b: a ?? undefined })} preventScrollReset>
                  <Icon name="sort" />
                  {w(lang, 'swap')}
                </Link>
              </div>
            ) : null}
          </div>
          <div className="phead-pad" />
        </div>
      </div>

      <div className="wrap page stack-lg">
        {printings.length < 2 ? (
          <EmptyState icon="compare" title={t(lang, 'noPrintings')}>
            <Link to={href(itemPath(unit), lang)}>{labelOf(unit, lang)}</Link>
          </EmptyState>
        ) : (
          <section className="box printing-rows" aria-labelledby="printings-h">
            <div className="box-h">
              <Icon name="layers" className="subtle" />
              <span id="printings-h">{w(lang, 'printings')}</span>
              <span className="count">{num(printings.length, lang)}</span>
              <span className="end muted small">{w(lang, 'pickTwo')}</span>
            </div>
            {printings.map((p) => (
              <div key={p.key} className={`row${p.key === a ? ' current-a' : ''}${p.key === b ? ' current-b' : ''}`}>
                {p.key === a ? <span className="side-ab a">{lang === 'he' ? 'א' : '1'}</span> : p.key === b ? <span className="side-ab b">{lang === 'he' ? 'ב' : '2'}</span> : <Icon name={p.kind === 'scan' ? 'scan' : 'book'} className="subtle" />}
                <span className="row-main">
                  <span className="row-title torah">{nameOf(p.label, lang)}</span>
                  <span className="row-sub">{p.kind === 'scan' ? w(lang, 'kindScan') : w(lang, 'kindText')}</span>
                </span>
                {p.checked ? (
                  <StatusBadge state="approved" size="sm" icon="check">
                    {w(lang, 'checked')}
                  </StatusBadge>
                ) : (
                  <MachineLabel lang={lang} size="sm" />
                )}
                <nav className="pick" aria-label={nameOf(p.label, lang)}>
                  <Link className="a" to={pickTo(p.key, 'a')} aria-current={p.key === a ? 'true' : undefined} title={w(lang, 'asFirst')} preventScrollReset replace>
                    {w(lang, 'first')}
                  </Link>
                  <Link className="b" to={pickTo(p.key, 'b')} aria-current={p.key === b ? 'true' : undefined} title={w(lang, 'asSecond')} preventScrollReset replace>
                    {w(lang, 'second')}
                  </Link>
                </nav>
              </div>
            ))}
          </section>
        )}

        {printings.length >= 2 && a && b && a === b ? <EmptyState icon="compare" title={w(lang, 'pickOther')} compact /> : null}

        {comparison ? (
          <section className="stack" aria-label={t(lang, 'comparePrintings')}>
            {unchecked ? <MachineNote>{t(lang, 'comparedMachine')}</MachineNote> : null}
            <p className="compare-key">
              <span>
                <b>{num(comparison.same, lang)}</b> {t(lang, 'wordsSame')}
              </span>
              <span>
                <del>{t(lang, 'onlyInFirst')}</del> <b>{num(comparison.removed, lang)}</b>
              </span>
              <span>
                <ins>{t(lang, 'onlyInSecond')}</ins> <b>{num(comparison.added, lang)}</b>
              </span>
            </p>
            <div className="compare-body">
              <DiffBox
                icon="compare"
                title={
                  <span className="compare-h">
                    <b>
                      <span className="side-ab a">{lang === 'he' ? 'א' : '1'}</span>
                      {label(a)}
                    </b>{' '}
                    <Icon name="arrow" className="flip-ltr subtle" size={14} />{' '}
                    <b>
                      <span className="side-ab b">{lang === 'he' ? 'ב' : '2'}</span>
                      {label(b)}
                    </b>
                  </span>
                }
                stat={<DiffStat parts={parts} lang={lang} />}
              >
                {comparison.removed === 0 && comparison.added === 0 ? (
                  <div className="diff-seg">
                    <span className="n" />
                    <div className="t">{w(lang, 'identical')}</div>
                  </div>
                ) : null}
                <div dir="rtl" lang="he">
                  {passages(comparison.runs).map((passage, i) => (
                    <div key={i} className={passage.some((x) => x.kind !== 'same') ? 'diff-seg' : 'diff-seg same'}>
                      <span className="n">{num(i + 1, lang)}</span>
                      <div className="t torah">
                        <InlineDiff parts={passage} />
                      </div>
                    </div>
                  ))}
                </div>
              </DiffBox>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
