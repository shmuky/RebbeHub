import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Entity } from '../lib/api.js';
import { languageName, t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { chooseText } from '../lib/texts.js';
import { useAccount } from '../lib/useAccount.js';
import { TextView } from './TextView.js';

/**
 * A unit's texts, one language at a time (the plan, phase 6:
 * translations). The original comes first; each translation is a text of
 * its own with its language, who made it and its rights, and the reader
 * switches between them with plain links (`?tl=en`), so each language has
 * its own address and works without JavaScript. Below, a signed-in reader
 * adds a translation, sent for review like any Suggestion.
 */

interface TextData {
  kind: 'edition' | 'transcript' | 'translation' | 'hanacha';
  language: string;
  licence?: string;
  credit?: string;
  translationOf?: string;
}

const W = {
  text: { he: 'הטקסט', en: 'Text' },
  translation: { he: 'תרגום', en: 'Translation' },
  languages: { he: 'שפות', en: 'Languages' },
  original: { he: 'מקור', en: 'original' },
  by: { he: 'תרגום:', en: 'Translated by' },
  add: { he: 'הוספת תרגום', en: 'Add a translation' },
  signIn: { he: 'כדי להוסיף תרגום צריך להיכנס.', en: 'To add a translation, sign in.' },
  language: { he: 'שפה', en: 'Language' },
  credit: { he: 'מי תרגם (כפי שיופיע בקרדיט)', en: 'Who translated it (as it should be credited)' },
  creditHint: { he: 'למשל: תרגום של הרב … / Sefaria community translation', en: 'e.g. Translated by Rabbi … / Sefaria community translation' },
  rights: { he: 'של מי התרגום?', en: 'Whose translation is it?' },
  content: { he: 'התרגום (שורה ריקה בין פסקה לפסקה)', en: 'The translation (a blank line between paragraphs)' },
  machine: { he: 'זה תרגום ממוחשב (יסומן כך עד שאדם יבדוק כל פסקה)', en: 'A machine made this translation (it is marked so until a person checks each paragraph)' },
  tool: { he: 'איזה כלי', en: 'Which tool' },
  sent: { he: 'התרגום נשלח לבדיקה.', en: 'The translation was sent for review.' },
  see: { he: 'לראות אותו', en: 'See it' },
  how: {
    he: 'מדביקים רק תרגום שמותר להעתיק: שלכם, או כזה שבעליו התירו (נחלת הכלל, CC). תרגום של הוצאה שכל הזכויות שמורות לה - מוסיפים כקישור, לא כטקסט.',
    en: "Paste only a translation that may be copied: your own, or one its owner allows (public domain, CC). A publisher's all-rights-reserved translation is added as a link, not as text.",
  },
} as const;

const RIGHTS: Array<{ value: string; he: string; en: string }> = [
  { value: '', he: 'שלי - אני מתרגם/ת (CC BY-SA, כמו כל תיקון)', en: 'Mine - I translated it (CC BY-SA, like every correction)' },
  { value: 'public-domain', he: 'נחלת הכלל', en: 'Public domain' },
  { value: 'cc0', he: 'CC0', en: 'CC0' },
  { value: 'cc-by', he: 'CC BY (עם קרדיט)', en: 'CC BY (with credit)' },
  { value: 'cc-by-nc', he: 'CC BY-NC (עם קרדיט, לא מסחרי)', en: 'CC BY-NC (with credit, non-commercial)' },
];

const LICENCE_NAMES: Record<string, string> = { 'public-domain': 'Public domain', cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-nc': 'CC BY-NC', 'facts-and-links': '', 'free-to-read': '', 'site-terms': '', commercial: '', unknown: '' };

const TRANSLATION_LANGUAGES = ['en', 'yi', 'he', 'ru', 'fr', 'es', 'ar'];

const dataOf = (text: Entity) => text.data as unknown as TextData;

function AddTranslation({ unit, lang }: { unit: Entity; lang: Lang }) {
  const account = useAccount();
  const [language, setLanguage] = useState('en');
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState('');
  const [content, setContent] = useState('');
  const [machine, setMachine] = useState(false);
  const [tool, setTool] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const here = unit.path ?? `/${unit.id}`;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const response = await fetch(`/_/translations/units/${unit.id}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ language, credit, licence: licence || undefined, content, machine: machine ? `mt:${tool.trim().replace(/[^\w:.@-]+/g, '-') || 'unnamed'}` : undefined }),
    }).catch(() => null);
    setSending(false);
    const body = ((await response?.json().catch(() => null)) ?? {}) as { id?: number; message?: string };
    if (response?.ok && body.id) setSent(body.id);
    else setError(body.message ?? t(lang, 'error'));
  }

  return (
    <details className="report upload" id="add-translation">
      <summary>{W.add[lang]}</summary>
      {account === null ? (
        <p>
          {W.signIn[lang]} <Link to={href('/signin', lang, { return: `${here}#add-translation` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : sent ? (
        <p role="status">
          {W.sent[lang]} <Link to={href('/review', lang, { s: String(sent) })}>{W.see[lang]}</Link>
        </p>
      ) : (
        <form onSubmit={send}>
          <label>
            {W.language[lang]}{' '}
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {TRANSLATION_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, lang)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {W.credit[lang]}
            <input value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={300} dir="auto" placeholder={W.creditHint[lang]} required />
          </label>
          <fieldset className="rights-choice">
            <legend>{W.rights[lang]}</legend>
            {RIGHTS.map((r) => (
              <label key={r.value || 'mine'}>
                <input type="radio" name="licence" value={r.value} checked={licence === r.value} onChange={() => setLicence(r.value)} /> {r[lang]}
              </label>
            ))}
          </fieldset>
          <label>
            {W.content[lang]}
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} dir="auto" lang={language} required />
          </label>
          <label>
            <input type="checkbox" checked={machine} onChange={(e) => setMachine(e.target.checked)} /> {W.machine[lang]}
          </label>
          {machine ? (
            <label>
              {W.tool[lang]}
              <input value={tool} onChange={(e) => setTool(e.target.value)} maxLength={60} dir="ltr" placeholder="google-translate" />
            </label>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <div>
            <button type="submit" disabled={sending || !credit.trim() || !content.trim()}>
              {t(lang, 'sendForReview')}
            </button>
          </div>
          <p className="row-sub">{W.how[lang]}</p>
        </form>
      )}
    </details>
  );
}

export function UnitTexts({ unit, texts, segments, lang }: { unit: Entity; texts: Entity[]; segments: Record<string, Entity[]>; lang: Lang }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const shown = chooseText(texts, params.get('tl'));
  // One link per language, the original first.
  const languages = [...new Map([...texts].sort((a, b) => Number(dataOf(a).kind === 'translation') - Number(dataOf(b).kind === 'translation')).map((x) => [dataOf(x).language, x])).values()];
  const linkTo = (text: Entity) => {
    const q = new URLSearchParams(params);
    if (dataOf(text).kind === 'translation') q.set('tl', dataOf(text).language);
    else q.delete('tl');
    const qs = q.toString();
    return `${location.pathname}${qs ? `?${qs}` : ''}`;
  };
  const d = shown ? dataOf(shown) : null;
  // Every text in the language shown: an original may come from several printings or hanachos.
  const same = shown ? texts.filter((x) => dataOf(x).language === d!.language && (dataOf(x).kind === 'translation') === (d!.kind === 'translation')) : [];
  return (
    <>
      {shown && d ? (
        <section id="text">
          <h2>
            {d.kind === 'translation' ? W.translation[lang] : W.text[lang]} <span className="card-meta">({languageName(d.language, lang)})</span>
          </h2>
          {languages.length > 1 ? (
            <nav className="text-languages row-sub" aria-label={W.languages[lang]}>
              {languages.map((x, i) => (
                <span key={x.id}>
                  {i > 0 ? ' · ' : ''}
                  {dataOf(x).language === d.language ? (
                    <b aria-current="true">{languageName(dataOf(x).language, lang)}</b>
                  ) : (
                    <Link to={linkTo(x)} hrefLang={dataOf(x).language} preventScrollReset>
                      {languageName(dataOf(x).language, lang)}
                    </Link>
                  )}
                  {dataOf(x).kind !== 'translation' ? ` (${W.original[lang]})` : ''}
                </span>
              ))}
            </nav>
          ) : null}
          {same.map((text) => {
            const td = dataOf(text);
            const words = segments[text.id] ?? [];
            const translation = td.kind === 'translation';
            return (
              <div key={text.id} className="unit-text">
                {translation && (td.credit || td.licence !== undefined) ? (
                  <p className="row-sub text-credit">
                    {td.credit ?? ''}
                    {td.licence && LICENCE_NAMES[td.licence] ? ` · ${LICENCE_NAMES[td.licence]}` : !td.licence ? ' · CC BY-SA' : ''}
                  </p>
                ) : null}
                <TextView segments={words} language={td.language} withheld={words.some((s) => s.withheld) ? 'withheld' : undefined} fixable={translation} translation={translation} />
              </div>
            );
          })}
        </section>
      ) : null}
      <AddTranslation unit={unit} lang={lang} />
    </>
  );
}
