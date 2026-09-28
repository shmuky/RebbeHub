import { data, Form, Link } from 'react-router';
import type { Route } from './+types/compare';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * Compare printings (the plan, section 9): two printings of one sicha or
 * letter, word by word, on one page. What only the first has is struck
 * through, what only the second has is underlined; niqqud, geresh and
 * final letters are no difference. Machine text is labelled as such, since
 * a misreading looks like a difference.
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

export default function Compare({ loaderData }: Route.ComponentProps) {
  const { lang, unit, printings, a, b, comparison } = loaderData;
  const num = (n: number) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
  return (
    <>
      <ol className="breadcrumbs">
        <li>
          <Link to={href(itemPath(unit), lang)}>{labelOf(unit, lang)}</Link>
        </li>
      </ol>
      <h1>{t(lang, 'comparePrintings')}</h1>
      <p className="subtitle">{t(lang, 'compareIntro')}</p>
      {printings.length < 2 ? (
        <p className="note">{t(lang, 'noPrintings')}</p>
      ) : (
        <Form method="get" className="compare-pick">
          {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
          <select name="a" defaultValue={a ?? undefined} aria-label="1">
            {printings.map((p) => (
              <option key={p.key} value={p.key}>
                {nameOf(p.label, lang)}
              </option>
            ))}
          </select>
          <span>{t(lang, 'compareWith')}</span>
          <select name="b" defaultValue={b ?? undefined} aria-label="2">
            {printings.map((p) => (
              <option key={p.key} value={p.key}>
                {nameOf(p.label, lang)}
              </option>
            ))}
          </select>
          <button type="submit">{t(lang, 'compareGo')}</button>
        </Form>
      )}
      {comparison ? (
        <>
          {!comparison.a.checked || !comparison.b.checked ? <p className="note machine-note">{t(lang, 'comparedMachine')}</p> : null}
          <p className="compare-counts row-sub">
            {num(comparison.same)} {t(lang, 'wordsSame')} · <del>{t(lang, 'onlyInFirst')}</del> {num(comparison.removed)} · <ins>{t(lang, 'onlyInSecond')}</ins> {num(comparison.added)}
          </p>
          <div className="compare-text text-body" dir="rtl" lang="he">
            {comparison.runs.map((run, i) =>
              run.op === 'same' ? (
                <span key={i}>{run.text} </span>
              ) : run.op === 'removed' ? (
                <del key={i}>{run.text} </del>
              ) : (
                <ins key={i}>{run.text} </ins>
              ),
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
