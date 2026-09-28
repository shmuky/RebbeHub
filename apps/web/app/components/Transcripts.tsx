import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { clockOf, tn } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';
import { usePlayer, type Track } from '../player/PlayerProvider.js';

/**
 * A farbrengen's transcripts, part by part, synced to its recordings (the
 * plan: "the player highlights the words as they are spoken"). The
 * paragraph being heard is marked and kept in view; tapping a paragraph
 * plays from there. Paragraphs the machine heard and nobody checked are
 * marked as such, and a signed-in listener fixes one as they hear it.
 * A search hit opens here at its paragraph (`?at=`), lit up, with a
 * button to play from the moment it is heard.
 */

interface Paragraph {
  id: string;
  content: string;
  startMs: number | null;
  endMs: number | null;
  checked: boolean;
}

interface Transcript {
  recording: string;
  language: string;
  paragraphs: Paragraph[];
}

async function send<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

function Para({ recording, paragraph, active, found, onPlay, lang, canFix }: { recording: string; paragraph: Paragraph; active: boolean; found: boolean; onPlay: () => void; lang: Lang; canFix: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  useEffect(() => {
    if (found) ref.current?.scrollIntoView({ block: 'center' });
  }, [found]);

  if (editing !== null)
    return (
      <li ref={ref} className="transcript-para editing">
        <textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={4} dir="auto" autoFocus />
        <div className="actions">
          <button
            type="button"
            disabled={!editing.trim() || editing.trim() === paragraph.content}
            onClick={async () => {
              try {
                await send(`recordings/${recording}/transcript/fix`, { segment: paragraph.id, content: editing });
                setSent(true);
                setEditing(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {t(lang, 'sendForReview')}
          </button>
          <button type="button" className="secondary" onClick={() => setEditing(null)}>
            {t(lang, 'cancel')}
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </li>
    );
  return (
    <li ref={ref} id={`p-${paragraph.id}`} className={['transcript-para', active ? 'active' : '', found ? 'found' : '', paragraph.checked ? '' : 'unchecked'].filter(Boolean).join(' ')}>
      <button type="button" className="transcript-text" onClick={onPlay} dir="auto">
        {paragraph.content}
      </button>
      {found ? (
        <button type="button" className="link-button" onClick={onPlay}>
          {tn(lang, 'playFromHere')}
          {paragraph.startMs !== null ? ` (${clockOf(paragraph.startMs)})` : ''}
        </button>
      ) : null}
      {sent ? <span className="row-sub">{t(lang, 'lineSent')}</span> : null}
      {canFix && !sent ? (
        <button type="button" className="link-button" onClick={() => setEditing(paragraph.content)}>
          {t(lang, 'fixLine')}
        </button>
      ) : null}
    </li>
  );
}

export function Transcripts({ tracks, lang }: { tracks: Track[]; lang: Lang }) {
  const player = usePlayer();
  const account = useAccount();
  const [params] = useSearchParams();
  const found = params.get('at');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const ids = tracks.map((tr) => tr.id).join(',');

  useEffect(() => {
    let live = true;
    // Most recordings have no transcript yet; those answer "not found" and are left out.
    void Promise.all(tracks.map((tr) => send<Transcript>(`recordings/${tr.id}/transcript`).catch(() => null))).then((all) => {
      if (live) setTranscripts(all.filter((x): x is Transcript => x !== null));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (!transcripts.length) return null;
  const nowMs = player.time * 1000;
  const unchecked = transcripts.some((tr) => tr.paragraphs.some((p) => !p.checked));
  return (
    <section id="transcript" className="transcripts">
      <h2 className="section-header">{t(lang, 'transcript')}</h2>
      {unchecked ? <p className="note machine-note">{t(lang, 'machineTranscript')}</p> : null}
      {transcripts.map((tr) => {
        const index = tracks.findIndex((track) => track.id === tr.recording);
        const playing = player.current?.id === tr.recording;
        return (
          <div key={tr.recording}>
            {transcripts.length > 1 ? <h3>{tracks[index]?.title}</h3> : null}
            <ol className="transcript">
              {tr.paragraphs.map((p) => (
                <Para
                  key={p.id}
                  recording={tr.recording}
                  paragraph={p}
                  lang={lang}
                  canFix={Boolean(account)}
                  found={p.id === found}
                  active={playing && p.startMs !== null && p.endMs !== null && nowMs >= p.startMs && nowMs < p.endMs}
                  onPlay={() => (playing ? player.seek((p.startMs ?? 0) / 1000) : player.play(tracks, index, (p.startMs ?? 0) / 1000))}
                />
              ))}
            </ol>
          </div>
        );
      })}
      {account === null ? (
        <p className="row-sub">
          {t(lang, 'fixTranscriptSignIn')} <Link to={href('/signin', lang)}>{t(lang, 'signIn')}</Link>
        </p>
      ) : null}
    </section>
  );
}
