import type { Route } from './+types/models';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { MODEL_FAMILIES, MODELS_LICENCE, STATE_NAME, type L, type ModelFamily, type ScoreTable } from '../lib/models.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, Label } from '../ui/primitives.js';
import '../styles/pages/info.css';
import '../styles/pages/projects.css';

/**
 * RebbeHub's own models (the Likkutei Sichos reader, the Miram detector,
 * the Whisper that hears the Rebbe) and how good each one is, on a test it
 * never learned from (docs/models.md). Only their descriptions and scores
 * are published; the models are not released. The numbers live in
 * lib/models.ts, under that page's own licence, so a new score is one edit.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: siteOf(context).siteUrl };
}

const W = {
  title: { he: 'המודלים ומדדי הביצוע', en: 'Models and benchmarks' },
  intro: {
    he: 'RebbeHub קורא סריקות ושומע הקלטות במודלים משלו. כאן כתוב מה כל אחד עושה, איזה מהם בשימוש, ואיך הוא הצליח במבחן שלא למד ממנו. המודלים הם של RebbeHub ואינם משוחררים; רק התיאורים והציונים מתפרסמים.',
    en: 'RebbeHub reads scans and hears recordings with models of its own. Here is what each one does, which one is in use, and how it did on a test it never learned from. The models are RebbeHub’s own and are not released; only their descriptions and scores are published.',
  },
  machine: {
    he: 'כל מה שמודל כותב מסומן באתר כפלט מכונה עד שאדם בודק אותו, יהיה הציון טוב ככל שיהיה.',
    en: 'Whatever a model writes stays labelled on the site as machine output until a person checks it, however good its score.',
  },
  models: { he: 'המודלים', en: 'The models' },
  weak: { he: 'נקודות חולשה', en: 'Weak spots' },
  onThisPage: { he: 'בדף הזה', en: 'On this page' },
  licence: { he: 'רישיון', en: 'Licence' },
  docs: { he: 'תיעוד', en: 'Docs' },
  more: { he: 'כל הטבלאות, עם סוגי הטעויות והכיול:', en: 'Every table, with the kinds of mistakes and the calibration:' },
} as const;

const ICONS: Record<ModelFamily['id'], IconName> = { ocr: 'scan', miram: 'eye', whisper: 'mic' };

const say = (text: string | L, lang: Lang) => (typeof text === 'string' ? text : text[lang]);

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: W.title[loaderData.lang], description: W.intro[loaderData.lang], path: '/models', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

/** One benchmark as a plain printed table: the test it was scored on above it, a note under it. */
function Scores({ table, lang }: { table: ScoreTable; lang: Lang }) {
  return (
    <section id={table.id} aria-labelledby={`${table.id}-h`} className="stack">
      <h3 id={`${table.id}-h`}>{table.title[lang]}</h3>
      <p className="muted mirror-say">{table.test[lang]}</p>
      <div className="table-scroll">
        <table className="health-table">
          <thead>
            <tr>
              {table.columns.map((col, i) => (
                <th key={i} scope="col">
                  {col[lang]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                <th scope="row">
                  {typeof row.name === 'string' ? (
                    <bdi className="mono" dir="ltr">
                      {row.state === 'inUse' ? <b>{row.name}</b> : row.name}
                    </bdi>
                  ) : row.state === 'inUse' ? (
                    <b>{row.name[lang]}</b>
                  ) : (
                    row.name[lang]
                  )}
                  {row.state ? (
                    <span className="subtle">
                      {' '}
                      {STATE_NAME[row.state][lang]}
                    </span>
                  ) : null}
                </th>
                {row.cells.map((cell, j) => (
                  <td key={j} className="num" dir={typeof cell === 'string' ? 'ltr' : undefined}>
                    {row.state === 'inUse' ? <b>{say(cell, lang)}</b> : say(cell, lang)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note ? <p className="muted small">{table.note[lang]}</p> : null}
    </section>
  );
}

export default function Models({ loaderData }: Route.ComponentProps) {
  const { lang } = loaderData;
  return (
    <>
      <div className="phead">
        <div className="wrap">
          <h1 className="page-title">{W.title[lang]}</h1>
          <p className="lede">{W.intro[lang]}</p>
        </div>
      </div>
      <div className="wrap cols mirrors">
        <div className="stack-lg">
          <p className="muted mirror-say">{W.machine[lang]}</p>

          {MODEL_FAMILIES.map((family) => (
            <section key={family.id} id={family.id} aria-labelledby={`${family.id}-h`} className="stack-lg">
              <h2 className="h-side" id={`${family.id}-h`}>
                <Icon name={ICONS[family.id]} className="subtle" />
                {family.title[lang]}
              </h2>
              <p className="muted mirror-say">{family.intro[lang]}</p>
              <Box as="ul">
                {family.models.map((m) => (
                  <li key={m.name} className="row">
                    <Icon name="bot" className="subtle" />
                    <span className="grow">
                      <b className="mono" dir="ltr">
                        {m.name}
                      </b>
                      <span className="row-sub">{m.does[lang]}</span>
                    </span>
                    {m.state === 'inUse' ? <Label tone="sync">{STATE_NAME[m.state][lang]}</Label> : <Label>{STATE_NAME[m.state][lang]}</Label>}
                  </li>
                ))}
              </Box>
              {family.tables.map((table) => (
                <Scores key={table.id} table={table} lang={lang} />
              ))}
              <section aria-labelledby={`${family.id}-weak-h`}>
                <h3 id={`${family.id}-weak-h`}>{W.weak[lang]}</h3>
                <ul className="mirror-say">
                  {family.weak.map((w, i) => (
                    <li key={i}>{w[lang]}</li>
                  ))}
                </ul>
                {family.next ? <p className="mirror-say">{family.next[lang]}</p> : null}
              </section>
            </section>
          ))}

          <p className="muted small" id="licence">
            {MODELS_LICENCE[lang]}
          </p>
        </div>

        <aside className="side" aria-label={W.onThisPage[lang]}>
          <section>
            <h4>{W.onThisPage[lang]}</h4>
            <ul className="side-list help-now">
              {MODEL_FAMILIES.map((family) => (
                <li key={family.id}>
                  <a href={`#${family.id}`}>
                    <Icon name={ICONS[family.id]} />
                    <span className="grow">{family.title[lang]}</span>
                    <span className="num subtle">{family.models.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h4>{W.licence[lang]}</h4>
            <p className="muted small">{MODELS_LICENCE[lang]}</p>
          </section>
          <section>
            <h4>{W.docs[lang]}</h4>
            <p className="muted small">{W.more[lang]}</p>
            <p className="small">
              <a href="https://github.com/shmuky/RebbeHub/blob/main/docs/models.md" dir="ltr">
                docs/models.md
              </a>
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
