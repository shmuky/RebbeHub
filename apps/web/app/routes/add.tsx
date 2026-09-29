import { useState } from 'react';
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

/**
 * Adding what the catalog does not have yet (`/add`), in three steps: say
 * what it is (a hanacha, a recording, or a sefer, letter or document) and
 * give the file or the words; the machine proposes where it belongs, from
 * the date and the words in its name (labelled as the machine's); the
 * person confirms or picks another place - or a farbrengen the catalog
 * lacks - says whose the rights are, and sends it. What they send is a
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const asked = url.searchParams.get('what');
  const what: What = (WHATS as string[]).includes(asked ?? '') ? (asked as What) : 'hanacha';
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

function candidateLabel(c: Candidate, lang: Lang) {
  return `${c.label ? nameOf(c.label, lang) : c.id}${c.date ? ` · ${dateLabel(c.date, lang)}` : ''}`;
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

  if (account === null) {
    return (
      <article>
        <h1>{ps(lang, 'addNew')}</h1>
        <p>
          <Link to={href('/signin', lang, { return: '/add' })}>{ps(lang, 'signInToAdd')}</Link>
        </p>
      </article>
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
      <article>
        <h1>{ps(lang, 'addNew')}</h1>
        <p role="status">
          {ps(lang, 'added')} <Link to={href('/review', lang, { s: String(sent) })}>#{sent}</Link>
        </p>
      </article>
    );
  }

  const candidates = proposal?.candidates ?? [];
  const printingOf = proposal?.as === 'printing' ? candidates.filter((c) => c.type === 'work') : [];
  const needsPlace = what !== 'document';
  const ready = (textMode ? content.trim().length > 0 : file !== null) && (!needsPlace || (place && (place !== 'new' || (eventTitle && /^\d{4}-\w{2,3}-\d{2}$/.test(eventDate))))) && (what !== 'document' || (name || file));

  return (
    <article className="add-new">
      <h1>{ps(lang, 'addNew')}</h1>
      <p>{ps(lang, 'addNewHow')}</p>

      <form onSubmit={proposal ? send : propose}>
        <fieldset>
          <legend>{ps(lang, 'whatIsIt')}</legend>
          {WHATS.map((w) => (
            <label key={w}>
              <input type="radio" name="what" value={w} checked={what === w} onChange={() => (setWhat(w), setProposal(null))} />{' '}
              {ps(lang, w === 'hanacha' ? 'aHanacha' : w === 'recording' ? 'aRecording' : 'aDocument')}
            </label>
          ))}
        </fieldset>

        {what === 'hanacha' ? (
          <fieldset>
            <label>
              <input type="radio" name="form" checked={!asText} onChange={() => setAsText(false)} /> {ps(lang, 'asFile')}
            </label>
            <label>
              <input type="radio" name="form" checked={asText} onChange={() => setAsText(true)} /> {ps(lang, 'asText')}
            </label>
          </fieldset>
        ) : null}

        {textMode ? (
          <>
            <label>
              {ps(lang, 'theWords')}
              <textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} dir="auto" />
            </label>
            <label>
              {ps(lang, 'orTextFile')}
              <input type="file" accept="text/plain,.txt,.md" onChange={async (e) => setContent(await (e.target.files?.[0]?.text() ?? Promise.resolve(content)))} />
            </label>
          </>
        ) : (
          <label>
            {what === 'recording' ? typeName('recording', lang) : 'PDF'}
            <input type="file" accept={accept} onChange={(e) => (setFile(e.target.files?.[0] ?? null), setProposal(null))} />
          </label>
        )}
        <label>
          {ps(lang, 'nameIt')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} dir="auto" placeholder={file ? nameOfFile(file.name) : ''} />
        </label>

        {existing ? (
          <div role="status" className="note">
            <p>{ps(lang, 'haveIt')}</p>
            <ul>
              {existing.map((u) => (
                <li key={u.id}>
                  <Link to={href(u.path ?? `/${u.id}`, lang)}>{`${typeName(u.type, lang)} ${u.id}`}</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {proposal ? (
          <>
            <fieldset>
              <legend>
                {ps(lang, 'itBelongs')} <small className="row-sub">({ps(lang, 'machineProposes')}{proposal.date ? ` · ${ps(lang, 'dateRead')}: ${dateLabel(proposal.date, lang)}` : ''})</small>
              </legend>
              {given && !candidates.some((c) => c.id === given.id) ? (
                <label>
                  <input type="radio" name="place" checked={place === given.id} onChange={() => setPlace(given.id)} /> {labelOf(given, lang)}
                </label>
              ) : null}
              {candidates
                .filter((c) => what !== 'document' || (documentAs === 'letter' && c.type === 'unit'))
                .map((c) => (
                  <label key={c.id}>
                    <input type="radio" name="place" checked={place === c.id} onChange={() => setPlace(c.id)} /> {candidateLabel(c, lang)}{' '}
                    <Link to={href(c.path ?? `/${c.id}`, lang)} target="_blank">
                      ↗
                    </Link>
                  </label>
                ))}
              {needsPlace ? (
                <>
                  <label>
                    <input type="radio" name="place" checked={place === 'new'} onChange={() => setPlace('new')} /> {ps(lang, 'newFarbrengen')}
                  </label>
                  {place === 'new' ? (
                    <>
                      <label>
                        {ps(lang, 'newFarbrengenTitle')}
                        <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} required maxLength={300} dir="auto" />
                      </label>
                      <label>
                        {ps(lang, 'newFarbrengenDate')}
                        <input value={eventDate} onChange={(e) => setEventDate(e.target.value)} required pattern="\d{4}-\w{2,3}-\d{2}" dir="ltr" />
                      </label>
                    </>
                  ) : null}
                </>
              ) : null}
            </fieldset>

            {what === 'document' ? (
              <fieldset>
                <legend>{ps(lang, 'documentAs')}</legend>
                {(['sefer', 'letter', 'document'] as const).map((a) => (
                  <label key={a}>
                    <input type="radio" name="as" checked={documentAs === a} onChange={() => setDocumentAs(a)} /> {ps(lang, a === 'sefer' ? 'asSefer' : a === 'letter' ? 'asLetter' : 'asOther')}
                  </label>
                ))}
                {printingOf.length ? (
                  <p className="note">
                    {ps(lang, 'alreadyKnown')}{' '}
                    {printingOf.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 ? ', ' : ''}
                        <Link to={href(c.path ?? `/${c.id}`, lang)}>{candidateLabel(c, lang)}</Link>
                      </span>
                    ))}
                  </p>
                ) : null}
                <label>
                  {typeName('set', lang)}
                  <select value={set} onChange={(e) => setSet(e.target.value)}>
                    <option value="">—</option>
                    {sets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {labelOf(s, lang)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {lang === 'he' ? 'שנה' : 'Year'}
                  <input value={year} onChange={(e) => setYear(e.target.value)} maxLength={20} dir="auto" />
                </label>
              </fieldset>
            ) : null}

            {what === 'hanacha' && !textMode ? (
              <label>
                {ps(lang, 'hanachaKind')}
                <select value={kind} onChange={(e) => setKind(e.target.value as (typeof HANACHA_KINDS)[number])}>
                  {HANACHA_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {textMode ? (
              <label>
                {ps(lang, 'credit')}
                <input value={credit} onChange={(e) => setCredit(e.target.value)} maxLength={300} dir="auto" />
              </label>
            ) : null}

            <fieldset>
              <legend>{ps(lang, 'rightsQuestion')}</legend>
              {(['mine', 'public-domain', 'free', 'unsure'] as const).map((r) => (
                <label key={r}>
                  <input type="radio" name="rights" checked={rights === r} onChange={() => setRights(r)} />{' '}
                  {ps(lang, r === 'mine' ? 'rightsMine' : r === 'public-domain' ? 'rightsPublicDomain' : r === 'free' ? 'rightsFree' : 'rightsUnsure')}
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={busy || !ready}>
              {ps(lang, 'addIt')}
            </button>
          </>
        ) : (
          <button type="submit" disabled={busy || (textMode ? !content.trim() : !file && !name)}>
            {busy ? ps(lang, 'proposing') : ps(lang, 'propose')}
          </button>
        )}
        {given ? (
          <p className="row-sub">
            <Link to={href(itemPath(given), lang)}>{labelOf(given, lang)}</Link>
          </p>
        ) : null}
        {error ? <p role="alert">{`${ps(lang, 'failed')} ${error}`}</p> : null}
      </form>
    </article>
  );
}
