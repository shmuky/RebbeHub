import { useMemo, useState } from 'react';
import { data, Link } from 'react-router';
import { SHAAR_SECTIONS, readShaar } from '@rebbehub/model';
import type { Route } from './+types/shaar';
import { SentNote, type SentSuggestion } from '../components/SegmentEditor.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { MachineLabel } from '../ui/primitives.js';
import { ItemSubpage } from '../views/ItemSubpage.js';
import '../styles/pages/contribute.css';

const WORDS = {
  shaar: { he: 'שער', en: 'Shaar' },
  help: {
    he: 'השער של ספר הוא כמו README במאגר: קובץ אחד, כתוב אותו דבר בכל ספר, שהקטלוג יודע לקרוא. למעלה, בין שתי שורות של ---, השדות הקבועים; אחריהם הפרקים, כל אחד תחת כותרת קבועה.',
    en: "A sefer's shaar is what a README is to a repository: one file, written the same way for every sefer, that the catalog knows how to read. At the top, between two --- lines, its fixed fields; after them its sections, each under a fixed heading.",
  },
  machine: { he: 'השער הזה נעשה מנתוני הקטלוג. קראו אותו, תקנו והשלימו, ושלחו: מאז הוא נחשב שנקרא בידי אדם.', en: 'The catalog made this shaar from its data. Read it, fix and fill it in, and send it: from then on it counts as read by a person.' },
  edit: { he: 'עריכה', en: 'Edit' },
  send: { he: 'שליחה לבדיקה', en: 'Send for review' },
  cancel: { he: 'ביטול', en: 'Cancel' },
  what: { he: 'מה שיניתם, בשורה אחת', en: 'What you changed, in a line' },
  title: { he: 'השער', en: 'The shaar' },
  line: { he: 'שורה', en: 'Line' },
  good: { he: 'הקטלוג קורא את הקובץ.', en: 'The catalog can read the file.' },
  changedSince: { he: 'השער השתנה מאז שפתחתם אותו. טענו את הדף מחדש כדי לראות אותו כפי שהוא עכשיו.', en: 'The shaar changed since you opened it. Load the page again to see it as it is now.' },
  fields: { he: 'השדות', en: 'The fields' },
  sections: { he: 'הפרקים', en: 'The sections' },
  rules: { he: 'הכללים המלאים', en: 'The full rules' },
  back: { he: 'חזרה לספר', en: 'Back to the sefer' },
} as const;

/** The header's fields, what each holds. */
const FIELDS: Array<[string, { he: string; en: string }]> = [
  ['shaar', { he: 'גרסת הכללים: 1', en: 'The rules’ version: 1' }],
  ['title / title-en', { he: 'שם הספר, בעברית ובאנגלית', en: 'The sefer’s name, in Hebrew and English' }],
  ['subtitle / subtitle-en', { he: 'השורה השנייה בשער', en: 'The title page’s second line' }],
  ['by', { he: 'מחבר, במזהה שלו (rh-…), שורה לכל אחד', en: 'An author, by his id (rh-…), a line each' }],
  ['by-line / by-line-en', { he: 'המחבר כפי שהשער קורא לו', en: 'The author as the title page names him' }],
  ['genre', { he: 'סוג הספר: sichos, maamarim, chassidus…', en: 'The kind of sefer: sichos, maamarim, chassidus…' }],
];

/**
 * A sefer's shaar file (docs/shaar.md): the file as it is written, and,
 * signed in, the file to edit, read as it is typed so every line the
 * catalog cannot read is named before it is sent. It goes for review as a
 * Suggestion of its own.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const [entity, file] = await Promise.all([api.entity(params.id), api.shaar(params.id)]);
  if (!entity || entity.type !== 'work' || !file) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl, entity, file };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, entity } = loaderData;
  return pageMeta({ title: `${WORDS.shaar[lang]}: ${labelOf(entity, lang)}`, path: `/shaar/${entity.id}`, lang, siteUrl, noindex: true });
}

export default function Shaar({ loaderData }: Route.ComponentProps) {
  const { lang, entity, file } = loaderData;
  const account = useAccount();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(file.text);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentSuggestion | null>(null);
  const reading = useMemo(() => readShaar(text), [text]);
  const withheld = Boolean((entity as { withheld?: string }).withheld);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/_/suggestions/shaar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ entityId: entity.id, text, before: file.text, title: WORDS.title[lang], note: note.trim() || undefined }),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: number; status?: string; message?: string };
      if (response.status === 409) throw new Error(WORDS.changedSince[lang]);
      if (!response.ok) throw new Error(json.message ?? t(lang, 'error'));
      setSent({ id: json.id!, status: json.status ?? 'open' });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ItemSubpage
      entity={entity}
      lang={lang}
      current="edit"
      here={WORDS.shaar[lang]}
      side={
        <>
          <section>
            <h4>{WORDS.fields[lang]}</h4>
            <dl className="shaar-rules">
              {FIELDS.map(([key, what]) => (
                <div key={key}>
                  <dt>
                    <code>{key}</code>
                  </dt>
                  <dd>{what[lang]}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h4>{WORDS.sections[lang]}</h4>
            <ol className="edit-steps">
              {SHAAR_SECTIONS.map((s) => (
                <li key={s.key}>
                  <code>
                    ## {s.he} | {s.en}
                  </code>
                </li>
              ))}
            </ol>
            <a className="side-link" href="https://github.com/shmuky/RebbeHub/blob/main/docs/shaar.md" rel="noopener" target="_blank">
              <Icon name="file" />
              {WORDS.rules[lang]}
            </a>
          </section>
        </>
      }
    >
      <p className="alert info">
        <Icon name="file" />
        <span>{WORDS.help[lang]}</span>
      </p>
      {file.machine && !sent ? (
        <p>
          <MachineLabel lang={lang}>{WORDS.machine[lang]}</MachineLabel>
        </p>
      ) : null}
      {sent ? (
        <p className="alert positive">
          <Icon name="check" />
          <SentNote sent={sent} lang={lang} />
        </p>
      ) : null}
      {editing ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (reading.ok) void send();
          }}
        >
          <textarea className="shaar-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} disabled={busy} aria-label={WORDS.shaar[lang]} />
          {reading.ok ? (
            <p className="subtle">
              <Icon name="check" /> {WORDS.good[lang]}
            </p>
          ) : (
            <ul className="shaar-problems" role="status">
              {reading.problems.map((problem, i) => (
                <li key={i}>
                  {WORDS.line[lang]} {problem.line}: {problem[lang]}
                </li>
              ))}
            </ul>
          )}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={WORDS.what[lang]} maxLength={2000} disabled={busy} />
          {error ? <p className="alert">{error}</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={busy || !reading.ok || (text === file.text && !file.machine)}>
              {WORDS.send[lang]}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>
              {WORDS.cancel[lang]}
            </button>
          </div>
        </form>
      ) : (
        <>
          <pre className="shaar-text">{sent ? text : file.text}</pre>
          <div className="form-actions">
            {account === null ? (
              <span className="subtle">
                {t(lang, 'editSignIn')} <Link to={href('/signin', lang, { return: `/shaar/${entity.id}` })}>{t(lang, 'signIn')}</Link>
              </span>
            ) : account && !withheld && !sent ? (
              <button type="button" className="btn primary" onClick={() => setEditing(true)}>
                <Icon name="pencil" />
                {WORDS.edit[lang]}
              </button>
            ) : null}
            <Link className="btn" to={href(itemPath(entity), lang)}>
              {WORDS.back[lang]}
            </Link>
          </div>
        </>
      )}
    </ItemSubpage>
  );
}
