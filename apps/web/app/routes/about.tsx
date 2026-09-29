import { Link } from 'react-router';
import type { Route } from './+types/about';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box } from '../ui/primitives.js';
import '../styles/pages/info.css';

/**
 * What RebbeHub is, in a few plain sentences; how a change gets in (a
 * Report or a Suggestion, the keepers Approve, the history keeps it); and
 * where its code, rules and full copy are.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: siteOf(context).siteUrl };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'about'), path: '/about', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const TEXT = {
  he: [
    'RebbeHub הוא המפתח הפתוח הגדול לתורת חב״ד ולהקלטותיה, הנבנה בידי הקהל: כל ספר וכל הוצאה שלו, כל סריקה, הטקסט של כל אחד מהם, כל התוועדות וכל הקלטה.',
    'כל אחד יכול לדווח על טעות או להציע תיקון; אחראי כל אוסף מאשרים; וכל שינוי נשמר בהיסטוריה, כך ששום דבר אינו אובד.',
    'הקטלוג כולו פתוח ומיוצא לציבור, כדי שלעולם לא יינעל.',
  ],
  en: [
    'RebbeHub is the biggest open index of Chabad Torah and media, built by the community: every sefer and every printing of it, every scan, the text of each, every farbrengen and every recording.',
    "Anyone can report a mistake or suggest a fix; each set's keepers approve; and every change is kept in the history, so nothing is ever lost.",
    'The whole catalog is exported openly, so it can never be locked away.',
  ],
};

const W = {
  how: { he: 'איך שינוי נכנס', en: 'How a change gets in' },
  steps: [
    { icon: 'report', he: ['דיווח', 'מישהו מוצא טעות ואומר במשפט אחד מה לא נכון. בלי חשבון.'], en: ['Report', 'Someone finds a mistake and says in a sentence what is wrong. No account needed.'] },
    { icon: 'suggest', he: ['הצעה', 'מישהו מתקן: מילה בטקסט, תאריך, מראה מקום. התיקון נשלח לבדיקה.'], en: ['Suggestion', 'Someone fixes it: a word, a date, a source. The fix is sent for review.'] },
    { icon: 'check', he: ['אישור', 'אחראי האוסף בודקים מול המקור ומאשרים, או מחזירים עם הערה.'], en: ['Approve', 'The keepers check it against the source and approve, or send it back with a note.'] },
    { icon: 'history', he: ['היסטוריה', 'כל גרסה נשמרת, ואפשר תמיד לחזור לקודמת.'], en: ['History', 'Every version is kept, and an earlier one can always be restored.'] },
  ] as Array<{ icon: IconName; he: [string, string]; en: [string, string] }>,
  links: { he: 'קישורים', en: 'Links' },
  code: { he: 'הקוד', en: 'The code' },
  contributing: { he: 'איך תורמים', en: 'Contributing' },
  governance: { he: 'איך מחליטים', en: 'Governance' },
  mirrors: { he: 'הורדה ואתרי מראה', en: 'Download and mirror' },
  developers: { he: 'למפתחים', en: 'For developers' },
  takedown: { he: 'בקשת הסרה', en: 'Takedown request' },
  licence: { he: 'רישיון', en: 'Licence' },
  licences: [
    { he: 'עובדות הקטלוג', en: 'Catalog facts', id: 'CC0' },
    { he: 'טקסט שהקהילה כתבה', en: 'Words the community wrote', id: 'CC BY-SA' },
    { he: 'הקוד', en: 'The code', id: 'AGPL-3.0' },
  ],
} as const;

export default function About({ loaderData }: Route.ComponentProps) {
  const { lang } = loaderData;
  const [first, ...rest] = TEXT[lang];
  return (
    <>
      <div className="phead">
        <div className="wrap">
          <h1 className="page-title">{t(lang, 'about')}</h1>
          <p className="lede">{first}</p>
        </div>
      </div>
      <div className="wrap cols about">
        <div className="stack-lg">
          <div className="prose">
            {rest.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <section>
            <h2 className="h-side">{W.how[lang]}</h2>
            <Box as="ol" className="how-steps">
              {W.steps.map((s, i) => (
                <li key={i} className="row">
                  <span className="way-icon">
                    <Icon name={s.icon} />
                  </span>
                  <div className="row-main">
                    <b className="row-title">{s[lang][0]}</b>
                    <span className="row-sub">{s[lang][1]}</span>
                  </div>
                </li>
              ))}
            </Box>
          </section>
        </div>
        <aside className="side" aria-label={W.links[lang]}>
          <section>
            <h4>{W.links[lang]}</h4>
            <ul className="side-list help-now">
              <li>
                <a href="https://github.com/shmuky/RebbeHub">
                  <Icon name="code" />
                  <span className="grow">{W.code[lang]}</span>
                  <span className="subtle">GitHub</span>
                </a>
              </li>
              <li>
                <a href="https://github.com/shmuky/RebbeHub/blob/main/CONTRIBUTING.md">
                  <Icon name="heart" />
                  <span className="grow">{W.contributing[lang]}</span>
                </a>
              </li>
              <li>
                <a href="https://github.com/shmuky/RebbeHub/blob/main/GOVERNANCE.md">
                  <Icon name="users" />
                  <span className="grow">{W.governance[lang]}</span>
                </a>
              </li>
              <li>
                <Link to={href('/help', lang)}>
                  <Icon name="help" />
                  <span className="grow">{t(lang, 'help')}</span>
                </Link>
              </li>
              <li>
                <Link to={href('/mirrors', lang)}>
                  <Icon name="down" />
                  <span className="grow">{W.mirrors[lang]}</span>
                </Link>
              </li>
              <li>
                <Link to={href('/developers', lang)}>
                  <Icon name="embed" />
                  <span className="grow">{W.developers[lang]}</span>
                </Link>
              </li>
              <li>
                <Link to={href('/takedown', lang)}>
                  <Icon name="flag" />
                  <span className="grow">{W.takedown[lang]}</span>
                </Link>
              </li>
            </ul>
          </section>
          <section>
            <h4>{W.licence[lang]}</h4>
            <dl>
              {W.licences.map((l) => (
                <div key={l.id} className="dl-row">
                  <dt>{l[lang]}</dt>
                  <dd>
                    <bdi className="mono">{l.id}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
