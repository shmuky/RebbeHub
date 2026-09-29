import type { Route } from './+types/mirrors';
import type { MirrorsInfo } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { Box, EmptyState, Label } from '../ui/primitives.js';
import '../styles/pages/info.css';

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
  onThisPage: { he: 'בדף הזה', en: 'On this page' },
  licence: { he: 'רישיון', en: 'Licence' },
  licences: [
    { he: 'עובדות הקטלוג', en: 'Catalog facts', id: 'CC0' },
    { he: 'טקסט קהילתי', en: 'Community text', id: 'CC BY-SA' },
  ],
  ownLicence: { he: 'טקסט ממקור אחר שומר על הרישיון שלו.', en: 'A text from elsewhere keeps its own licence.' },
  latest: { he: 'אחרונה', en: 'latest' },
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
  const when = (at: string) => new Date(at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US');
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
          {!mirrors ? (
            <div className="alert negative" role="status">
              <Icon name="warn" />
              {W.unavailable[lang]}
            </div>
          ) : null}

          <section id="git" aria-labelledby="git-h">
            <h2 className="h-side" id="git-h">
              <Icon name="code" className="subtle" />
              {W.git[lang]}
            </h2>
            <p className="muted mirror-say">{W.gitText[lang]}</p>
            {mirrors?.git.length ? (
              <pre className="mirror-code" dir="ltr">
                {mirrors.git.map((url) => `git clone ${url}`).join('\n')}
              </pre>
            ) : (
              <div className="box">
                <EmptyState compact icon="code" title={W.gitSoon[lang]} />
              </div>
            )}
          </section>

          <section id="editions" aria-labelledby="editions-h">
            <h2 className="h-side" id="editions-h">
              <Icon name="database" className="subtle" />
              {W.editions[lang]}
              {mirrors?.editions.length ? <span className="count">{mirrors.editions.length}</span> : null}
            </h2>
            <p className="muted mirror-say">{W.editionsText[lang]}</p>
            {mirrors?.editions.length ? (
              <div className="stack">
                {mirrors.editions.map((e, i) => (
                  <Box
                    key={e.tag}
                    as="section"
                    className="edition"
                    header={
                      <>
                        <Icon name="database" className="subtle" />
                        <b className="mono" dir="ltr">
                          {e.tag}
                        </b>
                        {i === 0 ? <Label tone="sync">{W.latest[lang]}</Label> : null}
                        <span className="end muted small">
                          {`${when(e.created_at)} · ${W.commit[lang]} ${e.commit_seq}`}
                        </span>
                      </>
                    }
                  >
                    {e.notes ? <p className="edition-notes">{e.notes}</p> : null}
                    {e.dumps ? (
                      <>
                        <ul className="edition-files" dir="ltr">
                          {e.dumps.files.map((f) => (
                            <li key={f.name} className="row">
                              <Icon name="down" className="subtle" />
                              <span className="grow edition-file">
                                <a href={f.url} download>
                                  {f.name}
                                </a>
                                <code className="edition-sha" title={f.sha256}>{`sha256 ${f.sha256}`}</code>
                              </span>
                              <span className="row-end num subtle" dir="ltr">{size(f.bytes, lang)}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="box-f edition-f">
                          <span className="edition-sig">
                            <Icon name={e.dumps.signature ? 'shield' : 'warn'} className="subtle" />
                            {e.dumps.signature ? <span>{`${W.signed[lang]} ${e.dumps.signature.keyId}`}</span> : W.unsigned[lang]}
                          </span>
                          <span className="end" dir="ltr">
                            <a href={e.dumps.manifest}>manifest.json</a>
                            {' · '}
                            <a href={e.dumps.sha256sums}>SHA256SUMS</a>
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="edition-notes muted">{W.noFiles[lang]}</p>
                    )}
                  </Box>
                ))}
              </div>
            ) : (
              <div className="box">
                <EmptyState compact icon="database" title={W.none[lang]} />
              </div>
            )}
          </section>

          <section id="keys" aria-labelledby="keys-h">
            <h2 className="h-side" id="keys-h">
              <Icon name="shield" className="subtle" />
              {W.keys[lang]}
            </h2>
            <p className="muted mirror-say">{W.keysText[lang]}</p>
            {mirrors?.keys.length ? (
              <Box as="ul">
                {mirrors.keys.map((k) => (
                  <li key={k.keyId} className="row mirror-key" dir="ltr">
                    <Icon name="lock" className="subtle" />
                    <span className="grow">
                      <b className="mono">{`${k.alg} ${k.keyId}`}</b>
                      <code className="file-hash">{k.publicKey}</code>
                    </span>
                  </li>
                ))}
              </Box>
            ) : (
              <div className="box">
                <EmptyState compact icon="shield" title={W.keysNone[lang]} />
              </div>
            )}
          </section>

          <section id="how" aria-labelledby="how-h">
            <h2 className="h-side" id="how-h">
              <Icon name="mirror" className="subtle" />
              {W.how[lang]}
            </h2>
            <p className="muted mirror-say">{W.howText[lang]}</p>
            <pre className="mirror-code" dir="ltr">
              {`git clone https://github.com/shmuky/RebbeHub && cd RebbeHub && npm ci
npm run rebbehub -- mirror-pull --api ${apiUrl} --out /srv/rebbehub --key ${pin}
# or by hand, for one edition:
curl -O ${apiUrl}/v1/editions/<tag>/SHA256SUMS && sha256sum -c SHA256SUMS`}
            </pre>
          </section>

          {mirrors?.others.length ? (
            <section id="others" aria-labelledby="others-h">
              <h2 className="h-side" id="others-h">
                <Icon name="globe" className="subtle" />
                {W.others[lang]}
              </h2>
              <Box as="ul">
                {mirrors.others.map((o) => (
                  <li key={o.url}>
                    <a className="row" href={o.url}>
                      <Icon name="globe" />
                      <span className="grow row-title">{o.name}</span>
                      <span className="row-end subtle" dir="ltr">
                        {o.url.replace(/^https?:\/\//, '')}
                      </span>
                    </a>
                  </li>
                ))}
              </Box>
            </section>
          ) : null}
        </div>

        <aside className="side" aria-label={W.onThisPage[lang]}>
          <section>
            <h4>{W.onThisPage[lang]}</h4>
            <ul className="side-list help-now">
              <li>
                <a href="#git">
                  <Icon name="code" />
                  <span className="grow">{W.git[lang]}</span>
                </a>
              </li>
              <li>
                <a href="#editions">
                  <Icon name="database" />
                  <span className="grow">{W.editions[lang]}</span>
                  {mirrors ? <span className="num subtle">{mirrors.editions.length}</span> : null}
                </a>
              </li>
              <li>
                <a href="#keys">
                  <Icon name="shield" />
                  <span className="grow">{W.keys[lang]}</span>
                </a>
              </li>
              <li>
                <a href="#how">
                  <Icon name="mirror" />
                  <span className="grow">{W.how[lang]}</span>
                </a>
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
            <p className="muted small">{W.ownLicence[lang]}</p>
          </section>
          <section>
            <h4>JSON</h4>
            <p className="muted small">
              {W.api[lang]}{' '}
              <a href={`${apiUrl}/v1/mirrors`} dir="ltr" className="mono">{`${apiUrl}/v1/mirrors`}</a>
            </p>
            <p className="small">
              <a href="https://github.com/shmuky/RebbeHub/blob/main/docs/mirrors.md" dir="ltr">
                docs/mirrors.md
              </a>
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
