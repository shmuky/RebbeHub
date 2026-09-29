import { useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { st } from '../lib/scanStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { Panel } from '../ui/primitives.js';

/**
 * "Map a teshura" (the plan, section 7): mark "pp. 3–8 are a letter from
 * 5718" and link the unit the catalog has, or make it (a letter printed
 * here for the first time becomes a unit of its sefer), or say in words
 * what is there. Sent as a suggestion for the set's keepers, like any fix.
 */

type Found = { id: string; path: string | null; label: string; date: string | null };
type How = 'existing' | 'new' | 'words';

/** A search box that picks one item of a type, through /_/lookup. */
function Pick({ type, lang, chosen, onChoose }: { type: 'unit' | 'work'; lang: Lang; chosen: Found | null; onChoose: (item: Found | null) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  async function search() {
    if (!q.trim()) return;
    const response = await fetch(href('/_/lookup', lang, { q: q.trim(), type }), { headers: { accept: 'application/json' } });
    setFound(response.ok ? ((await response.json()) as { items: Found[] }).items : []);
  }
  if (chosen) {
    return (
      <p>
        <strong>{chosen.label}</strong>{' '}
        <button type="button" className="btn" onClick={() => onChoose(null)}>
          ✕
        </button>
      </p>
    );
  }
  return (
    <div>
      <label className="field">
        {st(lang, type === 'unit' ? 'searchUnit' : 'searchSefer')}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          dir="auto"
        />
      </label>
      <button type="button" className="btn" onClick={() => void search()}>
        {t(lang, 'search')}
      </button>
      {found.length ? (
        <ul className="lookup-results">
          {found.map((item) => (
            <li key={item.id}>
              <button type="button" className="btn" onClick={() => onChoose(item)}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ContentsForm({ publication, lang }: { publication: Pick<Entity, 'id' | 'path'>; lang: Lang }) {
  const account = useAccount();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scheme, setScheme] = useState<'printed' | 'pdf'>('printed');
  const [how, setHow] = useState<How>('existing');
  const [unit, setUnit] = useState<Found | null>(null);
  const [work, setWork] = useState<Found | null>(null);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { publication: publication.id, pages: { from: Number(from), to: Number(to || from), scheme } };
    if (how === 'existing') body.unit = unit?.id;
    else if (how === 'new') body.newUnit = { work: work?.id, label: { he: label.trim() }, ...(date.trim() ? { date: date.trim() } : {}) };
    else body.label = { he: label.trim() };
    try {
      const response = await fetch('/_/suggestions/contents-map', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as { suggestion?: number; message?: string };
      if (!response.ok) throw new Error(json.message ?? response.statusText);
      setSent(json.suggestion ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const here = publication.path ?? `/${publication.id}`;
  const ready = Number(from) >= 1 && (how === 'existing' ? unit !== null : how === 'new' ? work !== null && label.trim() !== '' : label.trim() !== '');
  return (
    <Panel id="map-pages" icon="layers" title={st(lang, 'mapPages')}>
      {account === null ? (
        <p>
          {t(lang, 'uploadSignIn')} <Link to={href('/signin', lang, { return: `${here}#map-pages` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : sent !== null ? (
        <p role="status">
          {st(lang, 'mapSent')} <Link to={href('/review', lang, { s: String(sent) })}>{t(lang, 'suggestSee')}</Link>
        </p>
      ) : (
        <form onSubmit={send} className="form stack">
          <p className="hint">{st(lang, 'mapHow')}</p>
          <div className="form-row">
          <label className="field">
            {st(lang, 'fromPage')}
            <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" required />
          </label>
          <label className="field">
            {st(lang, 'toPage')}
            <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" />
          </label>
          </div>
          <fieldset className="field">
            <legend>{st(lang, 'scheme')}</legend>
            <div className="choices inline">
              {(['printed', 'pdf'] as const).map((k) => (
                <label key={k} className="choice">
                  <input type="radio" name="scheme" value={k} checked={scheme === k} onChange={() => setScheme(k)} />
                  <span>
                    <b>{st(lang, k === 'printed' ? 'scheme_printed' : 'scheme_pdf')}</b>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>{st(lang, 'choose')}</legend>
            <div className="choices">
              {(['existing', 'new', 'words'] as const).map((h) => (
                <label key={h} className="choice">
                  <input type="radio" name="how" value={h} checked={how === h} onChange={() => setHow(h)} />
                  <span>
                    <b>{st(lang, h === 'existing' ? 'mapExisting' : h === 'new' ? 'mapNew' : 'mapWords')}</b>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {how === 'existing' ? <Pick type="unit" lang={lang} chosen={unit} onChoose={setUnit} /> : null}
          {how === 'new' ? (
            <>
              <p className="hint">{st(lang, 'inSefer')}</p>
              <Pick type="work" lang={lang} chosen={work} onChoose={setWork} />
              <label className="field">
                {st(lang, 'unitName')}
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={300} dir="auto" required />
              </label>
              <label className="field">
                {st(lang, 'unitDate')}
                <input value={date} onChange={(e) => setDate(e.target.value)} maxLength={12} dir="ltr" placeholder="5718-01-05" pattern="\d{4}(-(0[1-9]|1[0-3]|06A|06B)(-\d{2})?)?" />
              </label>
            </>
          ) : null}
          {how === 'words' ? (
            <label className="field">
              {st(lang, 'description')}
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={300} dir="auto" required />
            </label>
          ) : null}
          {error ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={!ready || busy}>
              {t(lang, 'sendForReview')}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}
