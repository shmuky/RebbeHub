import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/add';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, nameOf, typeName, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { ps } from '../lib/pageStrings.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Breadcrumbs, ChoiceList, EmptyState, MachineLabel, cx } from '../ui/primitives.js';
import '../styles/pages/contribute.css';

/**
 * Adding what the catalog does not have yet (`/add`), as an assistant
 * would, one step at a time: say what it is (a hanacha, a recording, or a
 * sefer, letter or document) and give the file or the words; the machine
 * proposes where it belongs, from the date and the words in its name, and
 * says it is the machine's proposal; the person confirms it or picks
 * another place - or a farbrengen the catalog lacks - says whose the
 * rights are, sees what will be sent, and sends it. What they send is a
 * Suggestion, for the set's keepers to approve, like every change.
 */

type What = 'hanacha' | 'recording' | 'document';
type Rights = 'mine' | 'public-domain' | 'free' | 'unsure';

interface Candidate {
  id: string;
  type: string;
  path: string | null;
  label: { he: string; en?: string } | null;
  date: string | null;
  why: 'date' | 'name';
}

interface Proposal {
  machine: true;
  date: string | null;
  as: 'sefer' | 'printing' | 'teshura' | 'letter' | 'document' | null;
  candidates: Candidate[];
  usedBy: Array<{ id: string; type: string; path: string | null }>;
}

const WHATS: What[] = ['hanacha', 'recording', 'document'];
const HANACHA_KINDS = ['bilti-mugah', 'mugah', 'maamar', 'hagahos', 'hosofos', 'english', 'other'] as const;

const W = {
  help: { he: 'איך לעזור', en: 'How to help' },
  step: { he: 'שלב', en: 'Step' },
  whatHints: {
    hanacha: { he: 'PDF, או הטקסט עצמו', en: 'A PDF, or the words themselves' },
    recording: { he: 'קובץ שמע', en: 'An audio file' },
    document: { he: 'PDF של ספר, הדפסה, מכתב או תשורה', en: 'A PDF of a sefer, printing, letter or teshura' },
  },
  theFile: { he: 'הקובץ', en: 'The file' },
  theText: { he: 'הטקסט', en: 'The words' },
  pick: { he: 'בחירת קובץ', en: 'Choose a file' },
  pickHint: { he: 'או גררו אותו לכאן', en: 'or drop it here' },
  replace: { he: 'החלפה', en: 'Replace' },
  accepts: { audio: { he: 'MP3, M4A, OGG, WAV, FLAC', en: 'MP3, M4A, OGG, WAV, FLAC' }, pdf: { he: 'PDF', en: 'PDF' } },
  optional: { he: 'לא חובה', en: 'optional' },
  waitPlace: { he: 'כשתתנו קובץ או שם, המכונה תקרא אותו ותציע כאן מקום.', en: 'Once you give a file or a name, the machine reads it and proposes a place here.' },
  waitRights: { he: 'אחרי שהמקום נבחר.', en: 'Once the place is chosen.' },
  next: { he: 'המשך: איפה זה שייך', en: 'Next: where it belongs' },
  reading: { he: 'המכונה קוראת את השם והתאריך…', en: 'The machine is reading the name and date…' },
  proposalSays: { he: 'לפי מה שנקרא בשם, נראה שזה שייך לכאן. אפשר לאשר או לבחור מקום אחר.', en: 'From what was read in the name, it looks like it belongs here. Confirm it, or pick another place.' },
  noCandidate: { he: 'המכונה לא מצאה מקום מתאים. בחרו התוועדות חדשה, או תנו שם עם תאריך ונסו שוב.', en: 'The machine found no place that fits. Choose a new farbrengen, or give a name with a date and try again.' },
  byDate: { he: 'לפי התאריך', en: 'by the date' },
  byName: { he: 'לפי השם', en: 'by the name' },
  best: { he: 'ההצעה של המכונה', en: "The machine's pick" },
  given: { he: 'הדף שממנו באתם', en: 'The page you came from' },
  set: { he: 'באיזה סט', en: 'Which set' },
  noSet: { he: 'עוד לא יודע', en: 'Not sure yet' },
  year: { he: 'שנה', en: 'Year' },
  summary: { he: 'מה נשלח', en: 'What will be sent' },
  what: { he: 'מה', en: 'What' },
  where: { he: 'לאן', en: 'Where' },
  rights: { he: 'זכויות', en: 'Rights' },
  file: { he: 'קובץ', en: 'File' },
  words: { he: 'מילים', en: 'words' },
  sendNote: { he: 'נשלח כהצעה. אחראי האוסף רואים אותה ומאשרים; עד אז היא לא מופיעה באתר.', en: 'It goes as a Suggestion. The keepers see it and approve; until then it is not on the site.' },
  sending: { he: 'שולח…', en: 'Sending…' },
  doneTitle: { he: 'נשלח לבדיקה', en: 'Sent for review' },
  doneText: { he: 'ההצעה ממתינה לאחראי האוסף. תקבלו הודעה כשתאושר.', en: 'The Suggestion is waiting for the keepers. You will hear when it is approved.' },
  see: { he: 'לראות את ההצעה', en: 'See the Suggestion' },
  another: { he: 'להוסיף עוד', en: 'Add another' },
  afterTitle: { he: 'מה קורה אחרי', en: 'What happens next' },
  after: {
    he: ['הקובץ נשמר פעם אחת, לפי טביעת האצבע שלו (sha256): אותו קובץ לא נשמר פעמיים.', 'אחראי האוסף בודקים שהוא במקום הנכון ומאשרים.', 'מכונות מכינות ממנו עותק לקריאה ותמונות עמודים, ומסמנות את מה שעשו כשל מכונה.'],
    en: ['The file is kept once, by its fingerprint (sha256): the same file is never kept twice.', 'The keepers check it is in the right place and approve.', 'Machines make a reading copy and page images from it, and mark what they made as machine output.'],
  },
  signIn: { he: 'היכנסו כדי להוסיף', en: 'Sign in to add' },
  signInText: { he: 'כניסה אחת, בלי סיסמה. כל מה שמוסיפים נשלח לבדיקה בשמכם.', en: 'Once, with no password. Everything you add is sent for review in your name.' },
  kinds: {
    'bilti-mugah': { he: 'בלתי מוגה', en: 'Unedited' },
    mugah: { he: 'מוגה', en: 'Edited by the Rebbe' },
    maamar: { he: 'מאמר', en: 'Maamar' },
    hagahos: { he: 'הגהות', en: 'Hagahos' },
    hosofos: { he: 'הוספות', en: 'Additions' },
    english: { he: 'תרגום לאנגלית', en: 'English translation' },
    other: { he: 'אחר', en: 'Other' },
  },
} as const;

const WHAT_ICON: Record<What, IconName> = { hanacha: 'file', recording: 'audio', document: 'book' };

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const asked = url.searchParams.get('what');
  // A sefer, a letter or a document is one kind of file here.
  const what: What = asked === 'sefer' || asked === 'letter' ? 'document' : (WHATS as string[]).includes(asked ?? '') ? (asked as What) : 'hanacha';
  const target = url.searchParams.get('for');
  const place = target ? await api.entity(target) : null;
  const sets = (await api.list({ type: 'set', limit: 200 })).items;
  return { lang, siteUrl, what, place, sets };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'RebbeHub' }];
  return pageMeta({ title: ps(loaderData.lang, 'addNew'), path: '/add', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

async function sha256Of(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle || file.size > 200 * 1024 * 1024) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const nameOfFile = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ');

const sizeOf = (bytes: number, lang: Lang) => {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

function candidateLabel(c: Candidate, lang: Lang) {
  return c.label ? nameOf(c.label, lang) : c.id;
}

/** One step of the assistant: its number (a check once it is done), its question, and what it asks for. */
function Step({ n, title, done, current, children, aside }: { n: number; title: ReactNode; done?: boolean; current?: boolean; children?: ReactNode; aside?: ReactNode }) {
  return (
    <li className={cx('step', done && 'done', current && 'current')} aria-current={current ? 'step' : undefined}>
      <span className="step-n" aria-hidden="true">
        {done ? <Icon name="check" size={14} /> : n}
      </span>
      <div className="step-b">
        <h2 className="step-h">
          {title}
          {aside ? <span className="end">{aside}</span> : null}
        </h2>
        {children}
      </div>
    </li>
  );
}

export default function Add({ loaderData }: Route.ComponentProps) {
  const { lang } = loaderData;
  const given = loaderData.place as Entity | null;
  const sets = loaderData.sets as Entity[];
  const account = useAccount();
  const [what, setWhat] = useState<What>(loaderData.what);
  const [asText, setAsText] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [place, setPlace] = useState<string>(given?.id ?? '');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [documentAs, setDocumentAs] = useState<'sefer' | 'letter' | 'document'>('sefer');
  const [set, setSet] = useState('');
  const [year, setYear] = useState('');
  const [kind, setKind] = useState<(typeof HANACHA_KINDS)[number]>('bilti-mugah');
  const [credit, setCredit] = useState('');
  const [rights, setRights] = useState<Rights>('mine');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [existing, setExisting] = useState<Array<{ id: string; type: string; path: string | null }> | null>(null);
  const [dragging, setDragging] = useState(false);

  const head = (
    <div className="phead">
      <div className="wrap">
        <Breadcrumbs items={[{ label: W.help[lang], to: href('/help', lang) }, { label: ps(lang, 'addNew') }]} lang={lang} />
        <h1 className="page-title">{ps(lang, 'addNew')}</h1>
        <p className="lede">{ps(lang, 'addNewHow')}</p>
      </div>
    </div>
  );

  if (account === null) {
    return (
      <>
        {head}
        <div className="wrap page">
          <div className="box add-gate">
            <EmptyState icon="lock" title={W.signIn[lang]} actions={<Link className="btn primary" to={href('/signin', lang, { return: '/add' })}>{ps(lang, 'signInToAdd')}</Link>}>
              {W.signInText[lang]}
            </EmptyState>
          </div>
        </div>
      </>
    );
  }

  const textMode = what === 'hanacha' && asText;
  const accept = what === 'recording' ? 'audio/*' : 'application/pdf';

  async function propose(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sha256 = file ? await sha256Of(file) : null;
      const response = await fetch('/_/uploads/propose', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ what, name: name || (file ? nameOfFile(file.name) : ''), sha256 }),
      });
      const body = (await response.json().catch(() => ({}))) as Proposal & { message?: string };
      if (!response.ok) throw new Error(body.message ?? response.statusText);
      setProposal(body);
      setExisting(body.usedBy.length ? body.usedBy : null);
      if (!given) setPlace(body.candidates[0]?.id ?? (what === 'document' ? '' : 'new'));
      if (body.date && !eventDate) setEventDate(body.date);
      if (!eventTitle) setEventTitle(name || (file ? nameOfFile(file.name) : ''));
      if (body.as === 'letter' || body.as === 'document' || body.as === 'sefer') setDocumentAs(body.as);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const newEvent = place === 'new';
    try {
      let response: Response;
      if (textMode) {
        response = await fetch('/_/hanachos/text', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ ...(newEvent ? { eventTitle, eventDate } : { for: place }), content, rights, credit: credit || undefined }),
        });
      } else {
        if (!file) throw new Error('—');
        const title = name || nameOfFile(file.name);
        const query: Record<string, string> = { what, rights, title };
        if (what === 'document') {
          query.as = documentAs;
          if (set) query.set = set;
          if (year) query.year = year;
          if (documentAs === 'letter' && place && place !== 'new') query.unit = place;
          if (proposal?.date) query.date = proposal.date;
        } else if (newEvent) {
          query.eventTitle = eventTitle;
          query.eventDate = eventDate;
        } else {
          query.for = place;
        }
        if (what === 'hanacha') query.kind = kind;
        response = await fetch(`/_/uploads?${new URLSearchParams(query)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || accept, accept: 'application/json' }, body: file });
      }
      const body = (await response.json().catch(() => ({}))) as { suggestion?: number; existed?: boolean; usedBy?: Array<{ id: string; type: string; path: string | null }>; message?: string };
      if (!response.ok) throw new Error(body.message ?? response.statusText);
      if (body.existed) setExisting(body.usedBy ?? []);
      else setSent(body.suggestion ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) {
    return (
      <>
        {head}
        <div className="wrap page">
          <div className="box add-done" role="status">
            <span className="add-done-mark">
              <Icon name="check" size={22} />
            </span>
            <h2>
              {W.doneTitle[lang]} <span className="num subtle">#{sent}</span>
            </h2>
            <p className="muted">{W.doneText[lang]}</p>
            <p className="muted small">
              {ps(lang, 'added')} <Link to={href('/review', lang, { s: String(sent) })}>#{sent}</Link>
            </p>
            <div className="btn-row">
              <Link className="btn primary" to={href('/review', lang, { s: String(sent) })}>
                <Icon name="suggest" />
                {W.see[lang]}
              </Link>
              <a className="btn" href={href('/add', lang)}>
                <Icon name="plus" />
                {W.another[lang]}
              </a>
            </div>
          </div>
        </div>
      </>
    );
  }

  const candidates = proposal?.candidates ?? [];
  const printingOf = proposal?.as === 'printing' ? candidates.filter((c) => c.type === 'work') : [];
  const needsPlace = what !== 'document';
  const hasInput = textMode ? content.trim().length > 0 : file !== null;
  const ready = hasInput && (!needsPlace || (place && (place !== 'new' || (eventTitle && /^\d{4}-\w{2,3}-\d{2}$/.test(eventDate))))) && (what !== 'document' || (name || file));
  const shownCandidates = candidates.filter((c) => what !== 'document' || (documentAs === 'letter' && c.type === 'unit'));
  const reset = () => (setProposal(null), setExisting(null));
  const pickFile = (f: File | null) => (setFile(f), reset());

  const placeName = (() => {
    if (place === 'new') return `${ps(lang, 'newFarbrengen')}${eventTitle ? `: ${eventTitle}` : ''}`;
    if (given && place === given.id) return labelOf(given, lang);
    const c = candidates.find((x) => x.id === place);
    return c ? candidateLabel(c, lang) : null;
  })();
  const rightsWord = ps(lang, rights === 'mine' ? 'rightsMine' : rights === 'public-domain' ? 'rightsPublicDomain' : rights === 'free' ? 'rightsFree' : 'rightsUnsure');
  const whatWord = (w: What) => ps(lang, w === 'hanacha' ? 'aHanacha' : w === 'recording' ? 'aRecording' : 'aDocument');

  return (
    <>
      {head}
      <div className="wrap cols add">
        <form className="add-main" onSubmit={proposal ? send : propose}>
          <ol className="assist">
            <Step n={1} title={ps(lang, 'whatIsIt')} done>
              <fieldset className="what-cards">
                <legend className="visually-hidden">{ps(lang, 'whatIsIt')}</legend>
                {WHATS.map((w) => (
                  <label key={w} className={cx('what-card', what === w && 'on')}>
                    <input type="radio" name="what" value={w} checked={what === w} onChange={() => (setWhat(w), reset())} />
                    <Icon name={WHAT_ICON[w]} size={18} />
                    <span>
                      <b>{whatWord(w)}</b>
                      <span className="hint">{W.whatHints[w][lang]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {what === 'hanacha' ? (
                <div className="segmented add-form" role="radiogroup" aria-label={ps(lang, 'aHanacha')}>
                  <label>
                    <input type="radio" name="form" checked={!asText} onChange={() => (setAsText(false), reset())} />
                    {ps(lang, 'asFile')}
                  </label>
                  <label>
                    <input type="radio" name="form" checked={asText} onChange={() => (setAsText(true), reset())} />
                    {ps(lang, 'asText')}
                  </label>
                </div>
              ) : null}
            </Step>

            <Step n={2} title={textMode ? W.theText[lang] : W.theFile[lang]} done={hasInput} current={!hasInput}>
              {textMode ? (
                <div className="stack">
                  <label className="field">
                    <span className="field-label">{ps(lang, 'theWords')}</span>
                    <textarea className="add-text" rows={10} value={content} onChange={(e) => (setContent(e.target.value), reset())} dir="auto" />
                  </label>
                  <label className="field add-textfile">
                    <span className="field-label">{ps(lang, 'orTextFile')}</span>
                    <input type="file" accept="text/plain,.txt,.md" onChange={async (e) => setContent(await (e.target.files?.[0]?.text() ?? Promise.resolve(content)))} />
                  </label>
                </div>
              ) : (
                <label
                  className={cx('drop', dragging && 'over', file && 'has')}
                  onDragOver={(e) => (e.preventDefault(), setDragging(true))}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) pickFile(dropped);
                  }}
                >
                  <input className="visually-hidden" type="file" accept={accept} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                  {file ? (
                    <>
                      <Icon name={what === 'recording' ? 'audio' : 'file'} size={22} />
                      <span className="drop-main">
                        <b dir="auto">{file.name}</b>
                        <span className="subtle num">{sizeOf(file.size, lang)}</span>
                      </span>
                      <span className="btn sm">{W.replace[lang]}</span>
                    </>
                  ) : (
                    <>
                      <Icon name="upload" size={22} />
                      <span className="drop-main">
                        <b>{W.pick[lang]}</b>
                        <span className="subtle">
                          {W.pickHint[lang]} · {what === 'recording' ? W.accepts.audio[lang] : W.accepts.pdf[lang]}
                        </span>
                      </span>
                    </>
                  )}
                </label>
              )}
              <label className="field add-name">
                <span className="field-label">
                  {ps(lang, 'nameIt')} <span className="hint">· {W.optional[lang]}</span>
                </span>
                <input value={name} onChange={(e) => (setName(e.target.value), reset())} maxLength={300} dir="auto" placeholder={file ? nameOfFile(file.name) : ''} />
              </label>
              {!proposal ? (
                <div className="form-actions">
                  <button type="submit" className="btn primary" disabled={busy || (textMode ? !content.trim() : !file && !name)} aria-busy={busy || undefined}>
                    {busy ? <Icon name="loader" className="spin" /> : <Icon name="wand" />}
                    {busy ? W.reading[lang] : W.next[lang]}
                  </button>
                </div>
              ) : null}
            </Step>

            <Step n={3} title={what === 'document' ? ps(lang, 'documentAs') : ps(lang, 'itBelongs')} done={Boolean(proposal && (needsPlace ? place : true))} current={Boolean(proposal) && !place && needsPlace}>
              {!proposal ? (
                <p className="subtle step-wait">{W.waitPlace[lang]}</p>
              ) : (
                <div className="stack">
                  {existing ? (
                    <div className="alert info" role="status">
                      <Icon name="info" />
                      <div>
                        <p>{ps(lang, 'haveIt')}</p>
                        <ul className="add-have">
                          {existing.map((u) => (
                            <li key={u.id}>
                              <Link to={href(u.path ?? `/${u.id}`, lang)}>{`${typeName(u.type, lang)} ${u.id}`}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}

                  {/* The machine's proposal: said to be the machine's, for the person to confirm. */}
                  <div className="proposal">
                    <div className="proposal-h">
                      <MachineLabel lang={lang}>{ps(lang, 'machineProposes')}</MachineLabel>
                      {proposal.date ? (
                        <span className="subtle">
                          {ps(lang, 'dateRead')}: <b>{dateLabel(proposal.date, lang)}</b>
                        </span>
                      ) : null}
                    </div>
                    {needsPlace || (what === 'document' && documentAs === 'letter') ? (
                      <p className="proposal-say">{shownCandidates.length ? W.proposalSays[lang] : W.noCandidate[lang]}</p>
                    ) : null}
                  </div>

                  {what === 'document' ? (
                    <ChoiceList
                      name="as"
                      legend={ps(lang, 'documentAs')}
                      value={documentAs}
                      onChange={(v) => setDocumentAs(v as typeof documentAs)}
                      options={(['sefer', 'letter', 'document'] as const).map((a) => ({ value: a, label: ps(lang, a === 'sefer' ? 'asSefer' : a === 'letter' ? 'asLetter' : 'asOther'), hint: proposal.as === a ? W.best[lang] : undefined }))}
                    />
                  ) : null}

                  {needsPlace || shownCandidates.length ? (
                    <fieldset className="places">
                      <legend className="visually-hidden">{ps(lang, 'itBelongs')}</legend>
                      {given && !candidates.some((c) => c.id === given.id) ? (
                        <label className={cx('place', place === given.id && 'on')}>
                          <input type="radio" name="place" checked={place === given.id} onChange={() => setPlace(given.id)} />
                          <span className="place-main">
                            <b>{labelOf(given, lang)}</b>
                            <span className="subtle">
                              {typeName(given.type, lang)} · {W.given[lang]}
                            </span>
                          </span>
                        </label>
                      ) : null}
                      {shownCandidates.map((c, i) => (
                        <label key={c.id} className={cx('place', place === c.id && 'on')}>
                          <input type="radio" name="place" checked={place === c.id} onChange={() => setPlace(c.id)} />
                          <span className="place-main">
                            <b>{candidateLabel(c, lang)}</b>
                            <span className="subtle">
                              {typeName(c.type, lang)}
                              {c.date ? ` · ${dateLabel(c.date, lang)}` : ''} · {c.why === 'date' ? W.byDate[lang] : W.byName[lang]}
                            </span>
                          </span>
                          {i === 0 ? <span className="machine-label sm">{W.best[lang]}</span> : null}
                          <Link className="place-open" to={href(c.path ?? `/${c.id}`, lang)} target="_blank" aria-label={candidateLabel(c, lang)}>
                            <Icon name="external" size={14} />
                          </Link>
                        </label>
                      ))}
                      {needsPlace ? (
                        <label className={cx('place', place === 'new' && 'on')}>
                          <input type="radio" name="place" checked={place === 'new'} onChange={() => setPlace('new')} />
                          <span className="place-main">
                            <b>{ps(lang, 'newFarbrengen')}</b>
                          </span>
                          <Icon name="plus" className="subtle" />
                        </label>
                      ) : null}
                      {needsPlace && place === 'new' ? (
                        <div className="form-row place-new">
                          <label className="field">
                            <span className="field-label">{ps(lang, 'newFarbrengenTitle')}</span>
                            <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} required maxLength={300} dir="auto" />
                          </label>
                          <label className="field">
                            <span className="field-label">{ps(lang, 'newFarbrengenDate')}</span>
                            <input value={eventDate} onChange={(e) => setEventDate(e.target.value)} required pattern="\d{4}-\w{2,3}-\d{2}" dir="ltr" />
                            {/^\d{4}-\w{2,3}-\d{2}$/.test(eventDate) ? <span className="hint">{dateLabel(eventDate, lang)}</span> : null}
                          </label>
                        </div>
                      ) : null}
                    </fieldset>
                  ) : null}

                  {what === 'document' ? (
                    <>
                      {printingOf.length ? (
                        <p className="alert info">
                          <Icon name="book" />
                          <span>
                            {ps(lang, 'alreadyKnown')}{' '}
                            {printingOf.map((c, i) => (
                              <span key={c.id}>
                                {i > 0 ? ', ' : ''}
                                <Link to={href(c.path ?? `/${c.id}`, lang)}>{candidateLabel(c, lang)}</Link>
                              </span>
                            ))}
                          </span>
                        </p>
                      ) : null}
                      <div className="field">
                        <span className="field-label">{W.set[lang]}</span>
                        <ChoiceList name="set" legend={W.set[lang]} inline value={set} onChange={setSet} options={[{ value: '', label: W.noSet[lang] }, ...sets.map((s) => ({ value: s.id, label: labelOf(s, lang) }))]} />
                      </div>
                      <label className="field add-year">
                        <span className="field-label">
                          {W.year[lang]} <span className="hint">· {W.optional[lang]}</span>
                        </span>
                        <input value={year} onChange={(e) => setYear(e.target.value)} maxLength={20} dir="auto" placeholder={lang === 'he' ? 'תשמ״ב' : '5742'} />
                      </label>
                    </>
                  ) : null}

                  {what === 'hanacha' && !textMode ? (
                    <div className="field">
                      <span className="field-label">{ps(lang, 'hanachaKind')}</span>
                      <ChoiceList name="kind" legend={ps(lang, 'hanachaKind')} inline value={kind} onChange={(v) => setKind(v as (typeof HANACHA_KINDS)[number])} options={HANACHA_KINDS.map((k) => ({ value: k, label: W.kinds[k][lang] }))} />
                    </div>
                  ) : null}
                  {textMode ? (
                    <label className="field">
                      <span className="field-label">{ps(lang, 'credit')}</span>
                      <input value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={300} dir="auto" />
                    </label>
                  ) : null}
                </div>
              )}
            </Step>

            <Step n={4} title={ps(lang, 'rightsQuestion')} done={Boolean(proposal)}>
              {proposal ? (
                <ChoiceList
                  name="rights"
                  legend={ps(lang, 'rightsQuestion')}
                  value={rights}
                  onChange={(v) => setRights(v as Rights)}
                  options={(['mine', 'public-domain', 'free', 'unsure'] as const).map((r) => ({ value: r, label: ps(lang, r === 'mine' ? 'rightsMine' : r === 'public-domain' ? 'rightsPublicDomain' : r === 'free' ? 'rightsFree' : 'rightsUnsure') }))}
                />
              ) : (
                <p className="subtle step-wait">{W.waitRights[lang]}</p>
              )}
            </Step>

            <Step n={5} title={W.summary[lang]} current={Boolean(ready)}>
              {proposal ? (
                <div className="box add-summary">
                  <dl className="facts">
                    <dt>{W.what[lang]}</dt>
                    <dd>
                      {whatWord(what)}
                      {what === 'hanacha' && !textMode ? ` · ${W.kinds[kind][lang]}` : ''}
                      {what === 'document' ? ` · ${ps(lang, documentAs === 'sefer' ? 'asSefer' : documentAs === 'letter' ? 'asLetter' : 'asOther')}` : ''}
                    </dd>
                    <dt>{textMode ? W.theText[lang] : W.file[lang]}</dt>
                    <dd dir="auto">{textMode ? `${content.trim().split(/\s+/).filter(Boolean).length.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')} ${W.words[lang]}` : file ? `${name || nameOfFile(file.name)} · ${sizeOf(file.size, lang)}` : '—'}</dd>
                    {needsPlace ? (
                      <>
                        <dt>{W.where[lang]}</dt>
                        <dd>{placeName ?? '—'}</dd>
                      </>
                    ) : null}
                    <dt>{W.rights[lang]}</dt>
                    <dd>{rightsWord}</dd>
                  </dl>
                  <div className="box-f add-send">
                    <span className="subtle">{W.sendNote[lang]}</span>
                    <button type="submit" className="btn primary" disabled={busy || !ready} aria-busy={busy || undefined}>
                      {busy ? <Icon name="loader" className="spin" /> : <Icon name="upload" />}
                      {busy ? W.sending[lang] : ps(lang, 'addIt')}
                    </button>
                  </div>
                </div>
              ) : null}
            </Step>
          </ol>
          {error ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              <span>{`${ps(lang, 'failed')} ${error}`}</span>
            </p>
          ) : null}
        </form>

        <aside className="side" aria-label={W.afterTitle[lang]}>
          {given ? (
            <section>
              <h4>{W.given[lang]}</h4>
              <Link className="side-link" to={href(itemPath(given), lang)}>
                <Icon name={given.type === 'event' ? 'cal' : 'file'} />
                {labelOf(given, lang)}
              </Link>
            </section>
          ) : null}
          <section>
            <h4>{W.afterTitle[lang]}</h4>
            <ol className="edit-steps">
              {W.after[lang].map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
