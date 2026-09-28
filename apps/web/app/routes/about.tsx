import type { Route } from './+types/about';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';

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

export default function About({ loaderData }: Route.ComponentProps) {
  const { lang } = loaderData;
  return (
    <>
      <h1>{t(lang, 'about')}</h1>
      {TEXT[lang].map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p>
        <a href="https://github.com/shmuky/RebbeHub">GitHub</a> · <a href="https://github.com/shmuky/RebbeHub/blob/main/CONTRIBUTING.md">{t(lang, 'help')}</a> ·{' '}
        <a href="https://github.com/shmuky/RebbeHub/blob/main/GOVERNANCE.md">Governance</a>
      </p>
    </>
  );
}
