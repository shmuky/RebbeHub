import { Maximize2, Minimize2, Pause, Play, ScanText, SkipBack, SkipForward, Undo2, LocateFixed, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { spellingHints } from '@rebbehub/model';
import { t, type Lang } from '../lib/i18n.js';
import { clockOf, tn } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import { useAccount } from '../lib/useAccount.js';
import { clock, usePlayer, type Track } from '../player/PlayerProvider.js';
import { MachineLabel } from '../ui/primitives.js';
import { AskMachine } from './AskMachine.js';

/**
 * A farbrengen's transcripts, part by part, synced to its recordings (the
 * plan: "the player highlights the words as they are spoken"). The
 * paragraph being heard is marked and kept in view, and within it the word
 * being said; tapping a paragraph plays from there. When the sync drifts,
 * a listener taps "Said now" on the paragraph the Rebbe is saying: it is
 * set to this moment and locked, and what follows moves with it (the
 * plan's "fix a drifting line in two taps"). Paragraphs and sync the
 * machine made and nobody checked are marked as such; a signed-in listener
 * fixes a paragraph's words as they hear them. (A hanacha synced to the
 * recording is the farbrengen page's own text, EventPage's Words.)
 * A search hit opens here at its paragraph (`?at=`), lit up, with a
 * button to play from the moment it is heard.
 *
 * Listening comes first: the words are shown as a music app shows lyrics,
 * large and calm, the word being said lit and kept in view as the
 * recording plays. The tools for checking the machine's words open only
 * on "Review machine text" (or `?review=1`, as /check links), so a
 * listener is not asked to judge every line.
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


async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

interface Goal {
  model: string;
  hours: { done: number; target: number };
  farbrengens: { done: number; target: number };
  next: Array<{ event: string; path: string | null; title: { he: string; en?: string } | null; date: string | null; paragraphs: number; checked: number; mostWanted: boolean }>;
}

/**
 * What checking teaches: the next transcription model is trained once
 * people have checked enough farbrengens (core/trainingClips.ts), so the
 * goal is shown where they check, with the farbrengens most wanted next.
 */
function TrainingGoalBar({ lang }: { lang: Lang }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => {
    let live = true;
    void get<{ goal: Goal }>('machine/training')
      .then((r) => live && setGoal(r.goal))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!goal) return null;
  const hours = (n: number) => (Math.round(n * 10) / 10).toLocaleString(lang);
  return (
    <div className="training-goal">
      <p className="row-sub">
        {t(lang, 'trainingGoal')
          .replace('{model}', goal.model)
          .replace('{done}', goal.farbrengens.done.toLocaleString(lang))
          .replace('{target}', goal.farbrengens.target.toLocaleString(lang))
          .replace('{hours}', hours(goal.hours.done))
          .replace('{targetHours}', hours(goal.hours.target))}
      </p>
      <progress max={goal.hours.target} value={Math.min(goal.hours.done, goal.hours.target)} />
      {goal.next.length ? (
        <details>
          <summary>{t(lang, 'trainingNext')}</summary>
          <ul>
            {goal.next.map((f) => (
              <li key={f.event}>
                {f.path ? <Link to={`${href(f.path, lang, { review: '1' })}#transcript`}>{f.title?.[lang === 'en' ? 'en' : 'he'] ?? f.title?.he ?? f.event}</Link> : (f.title?.he ?? f.event)}{' '}
                <span className="row-sub">
                  {f.checked.toLocaleString(lang)}/{f.paragraphs.toLocaleString(lang)}
                  {f.mostWanted ? ` · ${t(lang, 'mostWanted')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
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

/** A paragraph's words, the one being said marked, the ones already said set apart; each knows when it is said, so a tap can play from it. */
function Spoken({ content, words, nowMs }: { content: string; words: Word[]; nowMs: number }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [i, w] of words.entries()) {
    if (w.from > at) out.push(content.slice(at, w.from));
    // Not `said`: that is the farbrengen page's "what was said" list, whose phone rule pulls it out to the screen's edges.
    const state = nowMs >= w.startMs && nowMs < Math.max(w.endMs, w.startMs + 1) ? 'w-now' : nowMs >= w.endMs ? 'w-past' : '';
    out.push(
      <span key={i} className={state ? `word ${state}` : 'word'} data-ms={w.startMs}>
        {content.slice(w.from, w.to)}
      </span>,
    );
    at = w.to;
  }
  if (at < content.length) out.push(content.slice(at));
  return <>{out}</>;
}

/** The house spelling (the booklets'), where the words being written differ from it: a hint, never a change. */
function SpellingHints({ text, lang }: { text: string; lang: Lang }) {
  const hints = spellingHints(text);
  return (
    <p className="note spelling-hints">
      {t(lang, 'houseSpelling')}
      {hints.length ? (
        <>
          {' '}
          {hints.map((h, i) => (
            <span key={h.written} dir="rtl">
              {i ? ', ' : ''}
              {h.written} ← <strong>{h.house}</strong>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

function Para({
  recording,
  paragraph,
  active,
  found,
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
  found: boolean;
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
  useEffect(() => {
    if (found) ref.current?.scrollIntoView({ block: 'center' });
  }, [found]);

  if (editing !== null)
    return (
      <li ref={ref} className="transcript-para editing">
        <textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={4} dir="auto" autoFocus />
        <SpellingHints text={editing} lang={lang} />
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
          <button type="button" className="btn" onClick={() => setEditing(null)}>
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

  // "Heard right": the words checked as they are, keeping their word timings, so the paragraph is a training clip at once.
  async function heardRight() {
    setError(null);
    try {
      await postJson(`recordings/${recording}/transcript/fix`, { segment: paragraph.id, content: paragraph.content });
      setSent('text');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const classes = ['transcript-para', active ? 'active' : '', found ? 'found' : '', paragraph.checked ? '' : 'unchecked', paragraph.syncChecked === false ? 'sync-unchecked' : ''].filter(Boolean).join(' ');
  return (
    <li ref={ref} id={`p-${paragraph.id}`} className={classes}>
      <button type="button" className="transcript-text" onClick={onPlay} dir="auto">
        {active && paragraph.words?.length ? <Spoken content={paragraph.content} words={paragraph.words} nowMs={nowMs} /> : paragraph.content}
      </button>
      <span className="transcript-actions">
        {found ? (
          <button type="button" className="link-button" onClick={onPlay}>
            {tn(lang, 'playFromHere')}
            {paragraph.startMs !== null ? ` (${clockOf(paragraph.startMs)})` : ''}
          </button>
        ) : null}
        {sent ? <span className="row-sub">{t(lang, sent === 'sync' ? 'syncFixed' : 'lineSent')}</span> : null}
        {canFix && playing && paragraph.startMs !== null && sent !== 'sync' ? (
          <button type="button" className="link-button said-now" onClick={saidNow} title={t(lang, 'saidNowHint')}>
            {t(lang, 'saidNow')}
          </button>
        ) : null}
        {canFix && !sent && !paragraph.checked ? (
          <button type="button" className="link-button" onClick={heardRight} title={t(lang, 'heardRightHint')}>
            {t(lang, 'heardRight')}
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
        className="btn"
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
  const [params] = useSearchParams();
  const found = params.get('at');
  const [reviewing, setReviewing] = useState(params.get('review') === '1');
  useEffect(() => {
    if (params.get('review') === '1') setReviewing(true);
  }, [params]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loaded, setLoaded] = useState(false);
  const section = useRef<HTMLElement>(null);
  const ids = tracks.map((tr) => tr.id).join(',');
  const playingHere = tracks.some((tr) => tr.id === player.current?.id);
  const nowMs = useNowMs(playingHere);

  useEffect(() => {
    let live = true;
    // Most recordings have no transcript yet; those answer "not found" and are left out.
    void Promise.all(tracks.map((tr) => get<Transcript>(`recordings/${tr.id}/transcript`).catch(() => null))).then((all) => {
      if (!live) return;
      setTranscripts(all.filter((x): x is Transcript => x !== null));
      setLoaded(true);
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

  function review(on: boolean) {
    setReviewing(on);
    requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  // Parts with no transcript yet: anyone signed in may ask the machine for one.
  const missing = loaded ? tracks.filter((tr) => !transcripts.some((x) => x.recording === tr.id)) : [];
  const ask = missing.length ? (
    <details className="ask-transcripts">
      <summary>
        {t(lang, 'transcript')} · {missing.length === tracks.length ? tn(lang, 'noTranscriptYet') : `${missing.length} ${tn(lang, 'partsWithoutTranscript')}`}
      </summary>
      <ul className="stack">
        {missing.map((tr) => (
          <li key={tr.id}>
            {tracks.length > 1 ? <b>{tr.title}</b> : null}
            <AskMachine kind="transcript" item={tr.id} lang={lang} />
          </li>
        ))}
      </ul>
    </details>
  ) : null;
  if (!transcripts.length) return ask ? <section id="transcript" className="transcripts">{ask}</section> : null;
  const unchecked = transcripts.some((tr) => tr.paragraphs.some((p) => !p.checked));
  const syncUnchecked = transcripts.some((tr) => tr.paragraphs.some((p) => p.syncChecked === false));

  if (!reviewing)
    return (
      <section id="transcript" ref={section} className="transcripts">
        <Lyrics transcripts={transcripts} tracks={tracks} lang={lang} nowMs={nowMs} found={found} machine={unchecked || syncUnchecked} />
        <div className="lyrics-foot">
          {unchecked || syncUnchecked ? <p className="row-sub">{t(lang, 'lyricsMachineHint')}</p> : null}
          <button type="button" className="btn" onClick={() => review(true)}>
            <ScanText size={16} aria-hidden />
            {t(lang, unchecked || syncUnchecked ? 'reviewMachineText' : 'reviewTranscript')}
          </button>
        </div>
        {ask}
      </section>
    );

  return (
    <section id="transcript" ref={section} className="transcripts reviewing">
      <div className="review-head">
        <h2 className="section-header">{t(lang, 'reviewMachineText')}</h2>
        <button type="button" className="btn" onClick={() => review(false)}>
          <Undo2 size={16} aria-hidden />
          {t(lang, 'backToLyrics')}
        </button>
      </div>
      {unchecked ? <p className="note machine-note">{t(lang, 'machineTranscript')}</p> : null}
      {syncUnchecked ? <p className="note machine-note">{t(lang, 'machineSync')}</p> : null}
      {unchecked && account ? <TrainingGoalBar lang={lang} /> : null}
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
      {account === null ? (
        <p className="row-sub">
          {t(lang, 'fixTranscriptSignIn')} <Link to={href('/signin', lang)}>{t(lang, 'signIn')}</Link>
        </p>
      ) : null}
      {ask}
    </section>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The words as a music app shows lyrics: one part at a time, large, the
 * paragraph being heard lit word by word and held a little above the
 * middle, what was said dimmed, what is still to come quieter. Tapping a
 * word or paragraph plays from there. Scrolling by hand lets go of the
 * recording until "Back to now"; full screen hides the page around it.
 */
function Lyrics({ transcripts, tracks, lang, nowMs, found, machine }: { transcripts: Transcript[]; tracks: Track[]; lang: Lang; nowMs: number; found: string | null; machine: boolean }) {
  const player = usePlayer();
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [full, setFull] = useState(false);
  const foundIn = found ? transcripts.find((tr) => tr.paragraphs.some((p) => p.id === found))?.recording : undefined;
  const [chosen, setChosen] = useState<string>(foundIn ?? transcripts[0]!.recording);
  const playingId = player.current?.id;

  // The part being played is the part shown.
  useEffect(() => {
    if (playingId && transcripts.some((tr) => tr.recording === playingId)) setChosen(playingId);
  }, [playingId, transcripts]);

  const shown = transcripts.find((tr) => tr.recording === chosen) ?? transcripts[0]!;
  const index = tracks.findIndex((track) => track.id === shown.recording);
  const track = tracks[index];
  const playing = playingId === shown.recording;
  const active = playing ? shown.paragraphs.find((p) => within(nowMs, p)) : undefined;

  // A search hit is shown in the middle, and the recording is not followed until it plays.
  useEffect(() => {
    if (!found) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-p="${CSS.escape(found)}"]`);
    if (!el || !box.current) return;
    box.current.scrollTop = el.offsetTop - box.current.clientHeight / 3;
    if (!playing) setFollow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, shown.recording]);

  // Keep the word being said a little above the middle; move only when it reaches a new line, as lyrics do.
  const lastTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !follow || !playing || !active) return;
    const line = el.querySelector<HTMLElement>(`[data-p="${CSS.escape(active.id)}"]`);
    if (!line) return;
    const said = line.querySelectorAll<HTMLElement>('.w-past');
    const word = line.querySelector<HTMLElement>('.w-now') ?? said[said.length - 1] ?? null;
    let top: number;
    if (word) top = word.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    else {
      // Without word timings, move through the paragraph as its time passes.
      const span = (active.endMs ?? 0) - (active.startMs ?? 0);
      const part = span > 0 ? Math.min(1, Math.max(0, (nowMs - (active.startMs ?? 0)) / span)) : 0;
      top = line.offsetTop + part * line.offsetHeight;
    }
    const target = Math.max(0, top - el.clientHeight * 0.36);
    if (lastTop.current !== null && Math.abs(target - lastTop.current) < 8) return;
    lastTop.current = target;
    el.scrollTo({ top: target, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [nowMs, active, follow, playing, full]);

  // Full screen: the page behind stays still, and Escape leaves.
  useEffect(() => {
    if (!full) return;
    document.documentElement.classList.add('lyrics-full');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('lyrics-full');
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

  function letGo() {
    if (follow) setFollow(false);
  }

  // Scrolling by keyboard lets go too; moving between lines with Tab does not.
  function keys(e: React.KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key) && e.target === box.current) letGo();
  }

  function backToNow() {
    lastTop.current = null;
    setFollow(true);
  }

  function playFrom(ms: number) {
    lastTop.current = null;
    setFollow(true);
    if (playing) {
      player.seek(ms / 1000);
      if (!player.playing) player.toggle();
    } else player.play(tracks, index, ms / 1000);
  }

  const duration = playing ? player.duration || (track?.durationMs ?? 0) / 1000 : (track?.durationMs ?? 0) / 1000;
  const time = playing ? player.time : 0;
  const percent = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className={full ? 'lyrics full' : 'lyrics'} role={full ? 'dialog' : undefined} aria-modal={full || undefined} aria-label={t(lang, 'transcript')}>
      <div className="lyrics-head">
        <div className="lyrics-titles">
          <span className="lyrics-kicker">{t(lang, 'transcript')}</span>
          {track && (full || tracks.length > 1) ? <span className="lyrics-title">{track.title}</span> : null}
        </div>
        {machine ? <MachineLabel lang={lang} size="sm" /> : null}
        <button type="button" className="lyrics-ib" onClick={() => setFull((f) => !f)} aria-label={t(lang, full ? 'exitFullScreen' : 'fullScreen')} title={t(lang, full ? 'exitFullScreen' : 'fullScreen')}>
          {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      {transcripts.length > 1 ? (
        <div className="lyrics-parts" role="tablist">
          {transcripts.map((tr) => {
            const n = tracks.findIndex((x) => x.id === tr.recording);
            return (
              <button
                key={tr.recording}
                type="button"
                role="tab"
                aria-selected={tr.recording === shown.recording}
                className={tr.recording === shown.recording ? 'on' : ''}
                onClick={() => {
                  setChosen(tr.recording);
                  lastTop.current = null;
                  box.current?.scrollTo({ top: 0 });
                }}
                title={tracks[n]?.title}
              >
                {n + 1}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="lyrics-scroll" ref={box} onWheel={letGo} onTouchMove={letGo} onKeyDown={keys} tabIndex={0}>
        {shown.paragraphs.map((p) => {
          const now = active?.id === p.id;
          const past = playing && !now && p.endMs !== null && nowMs >= p.endMs;
          const classes = ['lyrics-line', now ? 'now' : past ? 'past' : '', p.id === found ? 'found' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={p.id}
              id={`p-${p.id}`}
              type="button"
              data-p={p.id}
              className={classes}
              dir="auto"
              onClick={(e) => {
                const at = (e.target as HTMLElement).closest<HTMLElement>('[data-ms]')?.dataset.ms;
                playFrom(at ? Number(at) : (p.startMs ?? 0));
              }}
            >
              {now && p.words?.length ? <Spoken content={p.content} words={p.words} nowMs={nowMs} /> : p.content}
            </button>
          );
        })}
      </div>
      {!follow && playing ? (
        <button type="button" className="lyrics-now" onClick={backToNow}>
          <LocateFixed size={16} aria-hidden />
          {t(lang, 'backToNow')}
        </button>
      ) : null}
      <div className="lyrics-controls">
        <div className="lyrics-transport">
          {tracks.length > 1 ? (
            <button type="button" className="lyrics-ib" onClick={() => (playing ? player.prev() : index > 0 && player.play(tracks, index - 1))} disabled={index <= 0} aria-label={t(lang, 'previousPart')}>
              <SkipBack size={20} />
            </button>
          ) : null}
          <button
            type="button"
            className="lyrics-play"
            onClick={() => {
              if (playing) return player.toggle();
              const hit = found ? shown.paragraphs.find((p) => p.id === found) : undefined;
              if (hit) return playFrom(hit.startMs ?? 0);
              // From the start, or where this listener stopped last time.
              backToNow();
              player.play(tracks, index);
            }}
            aria-label={playing && player.playing ? t(lang, 'pause') : t(lang, 'play')}
          >
            {playing && player.loading && !player.playing ? <Loader2 size={24} className="spin" /> : playing && player.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          {tracks.length > 1 ? (
            <button type="button" className="lyrics-ib" onClick={() => (playing ? player.next() : player.play(tracks, index + 1))} disabled={index >= tracks.length - 1} aria-label={t(lang, 'nextPart')}>
              <SkipForward size={20} />
            </button>
          ) : null}
        </div>
        <div className="lyrics-scrub">
          <span>{clock(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={Math.min(time, duration || 1)}
            onChange={(e) => (playing ? player.seek(Number(e.target.value)) : player.play(tracks, index, Number(e.target.value)))}
            style={{ ['--played' as string]: `${percent}%` }}
            aria-label={t(lang, 'position')}
          />
          <span>{duration ? clock(duration) : '–:––'}</span>
        </div>
      </div>
    </div>
  );
}
