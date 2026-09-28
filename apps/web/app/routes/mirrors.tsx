import type { Route } from './+types/mirrors';
import type { MirrorsInfo } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';

/**
 * Download everything, and keep a copy (the plan: "It belongs to the
 * community... so it can never be locked away"; phase 6: mirrors). The
 * git mirror, every catalog edition's dumps with their sizes and sha256,
 * the keys they are signed with, and how to keep a mirror of it all up to
 * date (docs/mirrors.md). Read from the API's /v1/mirrors.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  let mirrors: MirrorsInfo | null = null;
  try {
    mirrors = await api.mirrors();
  } catch {
    mirrors = null;
  }
  return { lang: langFrom(request), siteUrl, apiUrl: api.baseUrl, mirrors };
}

const W = {
  title: { he: 'הורדה ואתרי מראה', en: 'Download and mirror' },
  intro: {
    he: 'כל הקטלוג פתוח: כל אחד יכול להוריד אותו, לשמור עותק מלא ולהגיש אותו מאתר משלו. עובדות הקטלוג ב-CC0, טקסט קהילתי (תיקונים, תרגומים, סנכרון) ב-CC BY-SA, וכל טקסט ממקור אחר שומר על הרישיון שלו. קבצים (סריקות, הקלטות) אינם בהורדה - רק הגיבובים שלהם.',
    en: 'The whole catalog is open: anyone may download it, keep a full copy and serve it from a site of their own. Catalog facts are CC0, community text (corrections, translations, sync) CC BY-SA, and a text from elsewhere keeps its own licence. Files (scans, recordings) are not in the download, only their hashes.',
  },
  git: { he: 'מראת git', en: 'The git mirror' },
  gitText: {
    he: 'כל הקטלוג כקבצים: קובץ JSON לכל פריט, טקסטים כ-Markdown, סנכרון כ-WebVTT, ו-commit אחד לכל שינוי שאושר.',
    en: 'The whole catalog as files: one JSON file per item, texts as Markdown, sync as WebVTT, and one commit for every approved change.',
  },
  gitSoon: { he: 'כתובת המראה תפורסם כאן כשתעלה.', en: 'Its address is listed here once it is up.' },
  editions: { he: 'מהדורות הקטלוג', en: 'Catalog editions' },
  editionsText: {
    he: 'כל שבוע נחתמת מהדורה: כל הקטלוג כפי שהיה ברגע אחד, כ-SQLite וכ-JSON Lines, עם manifest חתום (Ed25519) ו-sha256 לכל קובץ.',
    en: 'Each week an edition is signed: the whole catalog as it was at one moment, as SQLite and JSON Lines, with a signed manifest (Ed25519) and the sha256 of every file.',
  },
  none: { he: 'עוד אין מהדורה עם קבצים להורדה.', en: 'No edition has files to download yet.' },
  commit: { he: 'שינוי', en: 'commit' },
  signed: { he: 'חתום במפתח', en: 'signed with key' },
  unsigned: { he: 'לא חתום', en: 'unsigned' },
  noFiles: { he: 'הקבצים בהכנה', en: 'files being made' },
  keys: { he: 'מפתחות החתימה', en: 'Signing keys' },
  keysText: {
    he: 'החלק הציבורי של המפתחות שהמהדורות נחתמות בהם. אתר מראה נועל את המפתח אצלו ובודק כל מהדורה מולו.',
    en: 'The public halves of the keys editions are signed with. A mirror pins the key on its side and checks every edition against it.',
  },
  keysNone: { he: 'המפתח יפורסם כאן עם המהדורה החתומה הראשונה.', en: 'The key is listed here with the first signed edition.' },
  how: { he: 'איך מקימים מראה', en: 'How to run a mirror' },
  howText: {
    he: 'הפקודה מורידה כל מהדורה, בודקת את החתימה ואת ה-sha256 של כל קובץ, ומשאירה תיקייה שכל שרת אינטרנט יכול להגיש כמו שהיא. מריצים אותה מ-cron כמה שרוצים: מה שכבר קיים לא יורד שוב.',
    en: 'The command pulls every edition, checks its signature and the sha256 of every file, and leaves a folder any web server can serve as it is. Run it from cron as often as you like: what is already there is not pulled again.',
  },
  others: { he: 'אתרי מראה', en: 'Mirrors' },
  api: { he: 'הכול גם כ-JSON:', en: 'All of this as JSON:' },
  unavailable: { he: 'לא הצלחנו לקרוא את הרשימה כרגע.', en: 'The list could not be read just now.' },
} as const;

function size(bytes: number, lang: Lang): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: u ? 1 : 0 })} ${units[u]}`;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: W.title[loaderData.lang], description: W.intro[loaderData.lang], path: '/mirrors', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export default function Mirrors({ loaderData }: Route.ComponentProps) {
  const { lang, mirrors, apiUrl } = loaderData;
  const pin = mirrors?.keys[0]?.publicKey ?? '<public key>';
  return (
    <article className="mirrors">
      <h1>{W.title[lang]}</h1>
      <p>{W.intro[lang]}</p>
      {!mirrors ? <p className="notice">{W.unavailable[lang]}</p> : null}

      <h2>{W.git[lang]}</h2>
      <p>{W.gitText[lang]}</p>
      {mirrors?.git.length ? (
        <pre dir="ltr">{mirrors.git.map((url) => `git clone ${url}`).join('\n')}</pre>
      ) : (
        <p className="row-sub">{W.gitSoon[lang]}</p>
      )}

      <h2>{W.editions[lang]}</h2>
      <p>{W.editionsText[lang]}</p>
      {mirrors?.editions.length ? (
        <ul className="rows editions">
          {mirrors.editions.map((e) => (
            <li key={e.tag}>
              <h3>
                {e.tag}{' '}
                <span className="row-sub">
                  · {new Date(e.created_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')} · {W.commit[lang]} {e.commit_seq}
                  {e.dumps ? ` · ${e.dumps.signature ? `${W.signed[lang]} ${e.dumps.signature.keyId}` : W.unsigned[lang]}` : ` · ${W.noFiles[lang]}`}
                </span>
              </h3>
              {e.notes ? <p>{e.notes}</p> : null}
              {e.dumps ? (
                <table className="checksums" dir="ltr">
                  <tbody>
                    {e.dumps.files.map((f) => (
                      <tr key={f.name}>
                        <td>
                          <a href={f.url} download>
                            {f.name}
                          </a>
                        </td>
                        <td>{size(f.bytes, lang)}</td>
                        <td>
                          <code title={f.sha256}>{`sha256 ${f.sha256}`}</code>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3}>
                        <a href={e.dumps.manifest}>manifest.json</a> · <a href={e.dumps.sha256sums}>SHA256SUMS</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="row-sub">{W.none[lang]}</p>
      )}

      <h2>{W.keys[lang]}</h2>
      <p>{W.keysText[lang]}</p>
      {mirrors?.keys.length ? (
        <ul className="list" dir="ltr">
          {mirrors.keys.map((k) => (
            <li key={k.keyId}>
              <div className="row">
                <code>
                  {k.alg} {k.keyId}: {k.publicKey}
                </code>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="row-sub">{W.keysNone[lang]}</p>
      )}

      <h2>{W.how[lang]}</h2>
      <p>{W.howText[lang]}</p>
      <pre dir="ltr">
        {`git clone https://github.com/shmuky/RebbeHub && cd RebbeHub && npm ci
npm run rebbehub -- mirror-pull --api ${apiUrl} --out /srv/rebbehub --key ${pin}
# or by hand, for one edition:
curl -O ${apiUrl}/v1/editions/<tag>/SHA256SUMS && sha256sum -c SHA256SUMS`}
      </pre>

      {mirrors?.others.length ? (
        <>
          <h2>{W.others[lang]}</h2>
          <ul className="list">
            {mirrors.others.map((o) => (
              <li key={o.url}>
                <a href={o.url}>{o.name}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="row-sub">
        {W.api[lang]} <a href={`${apiUrl}/v1/mirrors`}>{`${apiUrl}/v1/mirrors`}</a> · <a href="https://github.com/shmuky/RebbeHub/blob/main/docs/mirrors.md">docs/mirrors.md</a>
      </p>
    </article>
  );
}
