import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import { useAccount } from '../lib/useAccount.js';
import { usePlayer, type Track } from '../player/PlayerProvider.js';

/**
 * A farbrengen's transcripts, part by part, synced to its recordings (the
 * plan: "the player highlights the words as they are spoken"). The
 * paragraph being heard is marked and kept in view, and within it the word
 * being said; tapping a paragraph plays from there. When the sync drifts,
 * a listener taps "Said now" on the paragraph the Rebbe is saying: it is
 * set to this moment and locked, and what follows moves with it (the
 * plan's "fix a drifting line in two taps"). Paragraphs and sync the
 * machine made and nobody checked are marked as such; a signed-in listener
 * fixes a paragraph's words as they hear them. Where the farbrengen's
 * hanacha is synced too, it follows the player the same way.
 */

interface Word {
  from: number;
  to: number;
  startMs: number;
  endMs: number;
}

interface Paragraph {
  id: string;
  content: string;
  startMs: number | null;
  endMs: number | null;
  words?: Word[] | null;
  locked?: boolean;
  checked: boolean;
  syncChecked?: boolean;
}

interface Transcript {
  recording: string;
  language: string;
  alignment?: string | null;
  paragraphs: Paragraph[];
}

interface Hanacha {
  recording: string;
  paragraphs: Array<{ id: string; content: string; startMs: number | null; endMs: number | null; checked: boolean }>;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

/** Where the audio is, in milliseconds, updated many times a second while this recording plays, for word by word highlighting. */
function useNowMs(playing: boolean): number {
  const player = usePlayer();
  const [ms, setMs] = useState(player.time * 1000);
  useEffect(() => {
    if (!playing || !player.playing) {
      setMs(player.time * 1000);
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (at: number) => {
      if (at - last > 80) {
        last = at;
        setMs(player.now() * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player.playing, player.time, player]);
  return ms;
}

/** A paragraph's words, the one being said marked, the ones already said a little set apart. */
function Spoken({ content, words, nowMs }: { content: string; words: Word[]; nowMs: number }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [i, w] of words.entries()) {
    if (w.from > at) out.push(content.slice(at, w.from));
    const state = nowMs >= w.startMs && nowMs < Math.max(w.endMs, w.startMs + 1) ? 'spoken now' : nowMs >= w.endMs ? 'said' : '';
    out.push(
      <span key={i} className={state ? `word ${state}` : 'word'}>
        {content.slice(w.from, w.to)}
      </span>,
    );
    at = w.to;
  }
  if (at < content.length) out.push(content.slice(at));
  return <>{out}</>;
}

function Para({
  recording,
  paragraph,
  active,
  nowMs,
  playing,
  onPlay,
  onAnchored,
  lang,
  canFix,
}: {
  recording: string;
  paragraph: Paragraph;
  active: boolean;
  nowMs: number;
  playing: boolean;
  onPlay: () => void;
  onAnchored: (spans: Array<{ segment: string; startMs: number; endMs: number; words: Word[] | null; locked: boolean }>) => void;
  lang: Lang;
  canFix: boolean;
}) {
  const player = usePlayer();
  const ref = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState<'text' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

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
                await postJson(`recordings/${recording}/transcript/fix`, { segment: paragraph.id, content: editing });
                setSent('text');
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

  // "The Rebbe is saying this now": the moment is taken at the tap, before anything is sent.
  async function saidNow() {
    const atMs = Math.round(player.now() * 1000);
    setError(null);
    try {
      const fix = await postJson<{ spans: Array<{ segment: string; startMs: number; endMs: number; words: Word[] | null; locked: boolean }> }>(`recordings/${recording}/sync/anchor`, { segment: paragraph.id, atMs });
      onAnchored(fix.spans);
      setSent('sync');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const classes = ['transcript-para', active ? 'active' : '', paragraph.checked ? '' : 'unchecked', paragraph.syncChecked === false ? 'sync-unchecked' : ''].filter(Boolean).join(' ');
  return (
    <li ref={ref} className={classes}>
      <button type="button" className="transcript-text" onClick={onPlay} dir="auto">
        {active && paragraph.words?.length ? <Spoken content={paragraph.content} words={paragraph.words} nowMs={nowMs} /> : paragraph.content}
      </button>
      <span className="transcript-actions">
        {sent ? <span className="row-sub">{t(lang, sent === 'sync' ? 'syncFixed' : 'lineSent')}</span> : null}
        {canFix && playing && paragraph.startMs !== null && sent !== 'sync' ? (
          <button type="button" className="link-button said-now" onClick={saidNow} title={t(lang, 'saidNowHint')}>
            {t(lang, 'saidNow')}
          </button>
        ) : null}
        {canFix && !sent ? (
          <button type="button" className="link-button" onClick={() => setEditing(paragraph.content)}>
            {t(lang, 'fixLine')}
          </button>
        ) : null}
      </span>
      {error ? <p role="alert">{error}</p> : null}
    </li>
  );
}

function ConfirmSync({ recording, lang }: { recording: string; lang: Lang }) {
  const [state, setState] = useState<'idle' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'sent') return <p className="row-sub">{t(lang, 'pageSent')}</p>;
  return (
    <p className="confirm-page">
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await postJson(`recordings/${recording}/sync/confirm`);
            setState('sent');
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {t(lang, 'syncIsRight')}
      </button>
      <span className="row-sub"> {t(lang, 'syncIsRightHint')}</span>
      {error ? <span role="alert"> {error}</span> : null}
    </p>
  );
}

const within = (nowMs: number, p: { startMs: number | null; endMs: number | null }) => p.startMs !== null && p.endMs !== null && nowMs >= p.startMs && nowMs < p.endMs;

export function Transcripts({ tracks, lang }: { tracks: Track[]; lang: Lang }) {
  const player = usePlayer();
  const account = useAccount();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [hanachos, setHanachos] = useState<Hanacha[]>([]);
  const ids = tracks.map((tr) => tr.id).join(',');
  const playingHere = tracks.some((tr) => tr.id === player.current?.id);
  const nowMs = useNowMs(playingHere);

  useEffect(() => {
    let live = true;
    // Most recordings have no transcript yet; those answer "not found" and are left out.
    void Promise.all(tracks.map((tr) => get<Transcript>(`recordings/${tr.id}/transcript`).catch(() => null))).then((all) => {
      if (live) setTranscripts(all.filter((x): x is Transcript => x !== null));
    });
    void Promise.all(tracks.map((tr) => get<Omit<Hanacha, 'recording'>>(`recordings/${tr.id}/hanacha`).then((h) => ({ ...h, recording: tr.id })).catch(() => null))).then((all) => {
      if (live) setHanachos(all.filter((x): x is Hanacha => x !== null));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // A fix to the sync, followed at once: the spans as they now stand replace the old ones.
  function anchored(recording: string, spans: Array<{ segment: string; startMs: number; endMs: number; words: Word[] | null; locked: boolean }>) {
    const bySegment = new Map(spans.map((s) => [s.segment, s]));
    setTranscripts((all) =>
      all.map((tr) =>
        tr.recording !== recording
          ? tr
          : { ...tr, paragraphs: tr.paragraphs.map((p) => (bySegment.has(p.id) ? { ...p, ...bySegment.get(p.id)!, syncChecked: bySegment.get(p.id)!.locked || p.syncChecked } : p)) },
      ),
    );
  }

  if (!transcripts.length && !hanachos.length) return null;
  const unchecked = transcripts.some((tr) => tr.paragraphs.some((p) => !p.checked));
  const syncUnchecked = transcripts.some((tr) => tr.paragraphs.some((p) => p.syncChecked === false));
  return (
    <section id="transcript" className="transcripts">
      <h2 className="section-header">{t(lang, 'transcript')}</h2>
      {unchecked ? <p className="note machine-note">{t(lang, 'machineTranscript')}</p> : null}
      {syncUnchecked ? <p className="note machine-note">{t(lang, 'machineSync')}</p> : null}
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
                  playing={playing}
                  nowMs={nowMs}
                  active={playing && within(nowMs, p)}
                  onAnchored={(spans) => anchored(tr.recording, spans)}
                  onPlay={() => (playing ? player.seek((p.startMs ?? 0) / 1000) : player.play(tracks, index, (p.startMs ?? 0) / 1000))}
                />
              ))}
            </ol>
            {account && tr.paragraphs.some((p) => p.syncChecked === false) ? <ConfirmSync recording={tr.recording} lang={lang} /> : null}
          </div>
        );
      })}
      {hanachos.map((h) => {
        const index = tracks.findIndex((track) => track.id === h.recording);
        const playing = player.current?.id === h.recording;
        return (
          <details key={`h-${h.recording}`} className="hanacha-sync">
            <summary>
              {t(lang, 'hanachaSynced')}
              {hanachos.length > 1 ? ` · ${tracks[index]?.title ?? ''}` : ''}
            </summary>
            <ol className="transcript">
              {h.paragraphs.map((p) => (
                <li key={p.id} className={['transcript-para', playing && within(nowMs, p) ? 'active' : '', p.checked ? '' : 'sync-unchecked'].filter(Boolean).join(' ')}>
                  <button
                    type="button"
                    className="transcript-text"
                    dir="rtl"
                    disabled={p.startMs === null}
                    onClick={() => (playing ? player.seek((p.startMs ?? 0) / 1000) : player.play(tracks, index, (p.startMs ?? 0) / 1000))}
                  >
                    {p.content}
                  </button>
                </li>
              ))}
            </ol>
          </details>
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
