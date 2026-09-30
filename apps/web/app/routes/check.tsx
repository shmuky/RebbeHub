import { Link } from 'react-router';
import type { Route } from './+types/check';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, nameOf, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageTitle } from '../components/ReviewHero.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { Bar, Box, EmptyState, MachineLabel, RelativeTime } from '../ui/primitives.js';
import '../styles/pages/projects.css';

/**
 * What the machines wrote that nobody checked yet: farbrengens the
 * transcription bot heard, with paragraphs no person has checked, pages
 * whose words OCR read (a subject index read from its scan), with lines
 * nobody checked, and scans the OCR bot read, with pages nobody proofread.
 * The newest first, so what the bots did last night is at the top. Each row
 * leads to where it is checked: a farbrengen's transcript, a page's edit
 * page with the scan beside it, a scan's text. What people check
 * becomes the training data for the next models (docs/transcription.md).
 * One API call, kept at the edge for five minutes.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const list = await api.toCheck(100);
  return { lang, siteUrl, list };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: w(loaderData.lang, 'title'), description: w(loaderData.lang, 'intro'), path: '/check', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  title: { he: 'לבדוק מה שהמכונה כתבה', en: 'Check what the machines wrote' },
  intro: {
    he: 'תמלולים והקלדות (OCR) שהמכונה עשתה ואדם עוד לא בדק, החדשים ראשונים. כל בדיקה מתקנת את האתר ומלמדת את הדגם הבא.',
    en: 'Transcripts and OCR the machines made that no person has checked yet, the newest first. Every check fixes the site and teaches the next model.',
  },
  transcripts: { he: 'תמלולים של הקלטות', en: 'Transcripts of recordings' },
  scans: { he: 'סריקות שנקראו במכונה (OCR)', en: 'Scans read by machine (OCR)' },
  texts: { he: 'עמודים שנקראו מסריקה', en: 'Pages read from a scan' },
  textsSay: { he: 'כל שורה נבדקת מול עמוד הסריקה שלצידה: "נכון" או תיקון במקום.', en: 'Each line is checked against the page of the scan beside it: "Right", or a fix in place.' },
  entries: { he: 'שורות לבדוק', en: 'lines to check' },
  notChecked: { he: 'טרם נבדק', en: 'not checked yet' },
  noTexts: { he: 'אין עמודים שמחכים לבדיקה', en: 'No pages wait for a check' },
  paragraphs: { he: 'פסקאות לבדוק', en: 'paragraphs to check' },
  pages: { he: 'עמודים לבדוק', en: 'pages to check' },
  of: { he: 'מתוך', en: 'of' },
  checked: { he: 'נבדקו', en: 'checked' },
  made: { he: 'נכתב', en: 'made' },
  noTranscripts: { he: 'אין תמלולים שמחכים לבדיקה', en: 'No transcripts wait for a check' },
  noScans: { he: 'אין סריקות שמחכות לבדיקה', en: 'No scans wait for a check' },
  more: { he: 'ועוד {n}', en: 'and {n} more' },
  how: { he: 'איך בודקים', en: 'How to check' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

export default function Check({ loaderData }: Route.ComponentProps) {
  const { lang, list } = loaderData;
  const { totals } = list;
  const texts = list.texts ?? [];
  const more = (shown: number, all: number) => (all > shown ? <p className="subtle tiny">{w(lang, 'more').replace('{n}', num(all - shown, lang))}</p> : undefined);

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{w(lang, 'title')}</h1>
              <p className="lede">{w(lang, 'intro')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/help', lang)}>
                <Icon name="info" />
                {w(lang, 'how')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="wrap">
        <section aria-labelledby="transcripts">
          <h2 className="h-block" id="transcripts">
            <Icon name="audio" className="subtle" />
            {w(lang, 'transcripts')}
            <span className="count">{num(totals.paragraphs, lang)}</span>
          </h2>
          <Box footer={more(list.transcripts.length, totals.transcripts)}>
            {list.transcripts.length ? (
              <ul className="hl-long">
                {list.transcripts.map((f) => (
                  <li key={f.event}>
                    <Link className="row hover" to={href(f.path ?? `/${f.event}`, lang, { tab: 'text' })}>
                      <Icon name="audio" />
                      <span className="row-main">
                        <span className="row-title">{nameOf(f.title, lang) || (f.date ? dateLabel(f.date, lang, { civil: false }) : f.event)}</span>
                        <span className="row-sub">
                          {f.date && nameOf(f.title, lang) ? `${dateLabel(f.date, lang, { civil: false })} · ` : ''}
                          {num(f.paragraphs - f.checked, lang)} {w(lang, 'paragraphs')} · {w(lang, 'made')} <RelativeTime at={f.made} lang={lang} />
                        </span>
                        <Bar value={f.checked} max={f.paragraphs} label={`${num(f.checked, lang)} ${w(lang, 'of')} ${num(f.paragraphs, lang)} ${w(lang, 'checked')}`} />
                      </span>
                      <MachineLabel lang={lang} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon="check" title={w(lang, 'noTranscripts')} />
            )}
          </Box>
        </section>

        <section aria-labelledby="texts">
          <h2 className="h-block" id="texts">
            <Icon name="file" className="subtle" />
            {w(lang, 'texts')}
            <span className="count">{num(totals.entries || totals.texts, lang)}</span>
          </h2>
          <p className="muted">{w(lang, 'textsSay')}</p>
          <Box footer={more(texts.length, totals.texts)}>
            {texts.length ? (
              <ul className="hl-long">
                {texts.map((p) => (
                  <li key={p.entity}>
                    <Link className="row hover" to={href(`/edit/${p.entity}`, lang)}>
                      <Icon name="file" />
                      <span className="row-main">
                        <span className="row-title">{pageTitle(p, lang)}</span>
                        <span className="row-sub">
                          {p.segments ? `${num(p.segments - p.checked, lang)} ${w(lang, 'entries')}` : w(lang, 'notChecked')} · {w(lang, 'made')} <RelativeTime at={p.made} lang={lang} />
                        </span>
                        {p.segments ? <Bar value={p.checked} max={p.segments} label={`${num(p.checked, lang)} ${w(lang, 'of')} ${num(p.segments, lang)} ${w(lang, 'checked')}`} /> : null}
                      </span>
                      <MachineLabel lang={lang} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon="check" title={w(lang, 'noTexts')} />
            )}
          </Box>
        </section>

        <section aria-labelledby="scans">
          <h2 className="h-block" id="scans">
            <Icon name="scan" className="subtle" />
            {w(lang, 'scans')}
            <span className="count">{num(totals.pages, lang)}</span>
          </h2>
          <Box footer={more(list.scans.length, totals.scans)}>
            {list.scans.length ? (
              <ul className="hl-long">
                {list.scans.map((s) => (
                  <li key={s.scan}>
                    <Link className="row hover" to={href(`/text/${s.scan}`, lang)}>
                      <Icon name="scan" />
                      <span className="row-main">
                        <span className="row-title">{nameOf(s.title, lang) || s.scan}</span>
                        <span className="row-sub">
                          {num(s.pages - s.checked, lang)} {w(lang, 'pages')} · {w(lang, 'made')} <RelativeTime at={s.made} lang={lang} />
                        </span>
                        <Bar value={s.checked} max={s.pages} label={`${num(s.checked, lang)} ${w(lang, 'of')} ${num(s.pages, lang)} ${w(lang, 'checked')}`} />
                      </span>
                      <MachineLabel lang={lang} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon="check" title={w(lang, 'noScans')} />
            )}
          </Box>
        </section>
      </div>
    </>
  );
}
