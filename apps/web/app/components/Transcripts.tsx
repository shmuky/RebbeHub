import { Maximize2, Minimize2, Pause, PenLine, Play, SkipBack, SkipForward, Undo2, LocateFixed, Loader2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { unclearRanges } from '@rebbehub/model';
import { t, type Lang } from '../lib/i18n.js';
import { clockOf, tn } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { get, pendingRanges, timedWords, within, type Transcript, type Word } from '../lib/transcript.js';
import { useAccount } from '../lib/useAccount.js';
import { clock, usePlayer, type Track } from '../player/PlayerProvider.js';
import { MachineLabel } from '../ui/primitives.js';
import { AskMachine } from './AskMachine.js';
import { DiscussUnclear } from './TimingTools.js';
import { TranscriptEditor } from './TranscriptEditor.js';

/**
 * A farbrengen's transcripts, part by part, synced to its recordings (the
 * plan: "the player highlights the words as they are spoken"). The
 * paragraph being heard is marked and kept in view, and within it the word
 * being said; tapping a paragraph plays from there. The sync is the
 * model's and listeners do not move it here: Shmuly had the "Timing"
 * button taken out, as it is already synced well. Paragraphs and sync the
 * machine made and nobody checked are marked as such; a signed-in listener
 * fixes a paragraph's words as they hear them. (A hanacha synced to the
 * recording is the farbrengen page's own text, EventPage's Words.)
 * A search hit opens here at its paragraph (`?at=`), lit up, with a
 * button to play from the moment it is heard. A tap on words marked
 * unclear opens a conversation about
 * them on the recording's talk page.
 *
 * Listening comes first: the words are shown as a music app shows lyrics,
 * large and calm, the word being said lit and kept in view as the
 * recording plays. The words to read and check have a tab of their own
 * on the page (`?tab=text`, and `?review=1` as older links say): one
 * view, the same for everyone, with the tools to fix and check for those
 * signed in (Shmuly: one editor, not two modes; editing on its own tab).
 * Edit on the player goes there, so a listener is not asked to judge
 * every line.
 */

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
/** A paragraph's words with the ones a listener marked unclear (`[words?]`) shown as such. */
function Plain({ content, lang, pending = [] }: { content: string; lang: Lang; pending?: Array<{ from: number; to: number }> }) {
  const marks = unclearRanges(content);
  if (!marks.length && !pending.length) return <>{content}</>;
  // Word by word, so a word a waiting fix changes is marked as well as an unclear one.
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const m of content.matchAll(/\S+/g)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (from > at) out.push(content.slice(at, from));
    const u = marks.findIndex((x) => from < x.to && to > x.from);
    out.push(<Marked key={from} text={m[0]} unclear={u >= 0} u={u} waiting={pending.some((x) => from < x.to && to > x.from)} lang={lang} />);
    at = to;
  }
  if (at < content.length) out.push(content.slice(at));
  return <>{out}</>;
}

/** A word as a reader sees it, marked when a listener was unsure of it, or a fix of it waits for approval. */
function Marked({ text, unclear, waiting, lang, className, ms, u }: { text: string; unclear: boolean; waiting: boolean; lang: Lang; className?: string; ms?: number; u?: number }) {
  const classes = [className, unclear ? 'w-unclear' : '', waiting ? 'w-pending' : ''].filter(Boolean).join(' ');
  if (!classes) return <>{text}</>;
  return (
    <span className={classes} data-ms={ms} data-u={unclear && u !== undefined && u >= 0 ? u : undefined} title={[unclear ? t(lang, 'unclearWords') : '', waiting ? t(lang, 'pendingFix') : ''].filter(Boolean).join(' · ') || undefined}>
      {text}
    </span>
  );
}

function Spoken({ content, words, nowMs, lang, pending = [] }: { content: string; words: Word[]; nowMs: number; lang: Lang; pending?: Array<{ from: number; to: number }> }) {
  const out: React.ReactNode[] = [];
  const marks = unclearRanges(content);
  let at = 0;
  for (const [i, w] of words.entries()) {
    if (w.from > at) out.push(content.slice(at, w.from));
    // Not `said`: that is the farbrengen page's "what was said" list, whose phone rule pulls it out to the screen's edges.
    const state = nowMs >= w.startMs && nowMs < Math.max(w.endMs, w.startMs + 1) ? 'w-now' : nowMs >= w.endMs ? 'w-past' : '';
    const hits = (list: Array<{ from: number; to: number }>) => list.some((m) => w.from < m.to && w.to > m.from);
    const u = marks.findIndex((m) => w.from < m.to && w.to > m.from);
    out.push(<Marked key={i} text={content.slice(w.from, w.to)} className={['word', state].filter(Boolean).join(' ')} ms={w.startMs} unclear={u >= 0} u={u} waiting={hits(pending)} lang={lang} />);
    at = w.to;
  }
  if (at < content.length) out.push(content.slice(at));
  return <>{out}</>;
}

export function Transcripts({ tracks, lang, onLoaded, only, view = 'listen' }: { tracks: Track[]; lang: Lang; onLoaded?: (transcripts: number) => void; only?: string; view?: 'listen' | 'text' }) {
  // `tracks` is what plays, one part after the other; `only` narrows what is read here to one of them (a recording's own page).
  const heard = only ? tracks.filter((tr) => tr.id === only) : tracks;
  const player = usePlayer();
  const account = useAccount();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const found = params.get('at');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loaded, setLoaded] = useState(false);
  const section = useRef<HTMLElement>(null);
  const ids = heard.map((tr) => tr.id).join(',');
  const playingHere = heard.some((tr) => tr.id === player.current?.id);
  const nowMs = useNowMs(playingHere);

  useEffect(() => {
    let live = true;
    // Most recordings have no transcript yet; those answer "not found" and are left out.
    void Promise.all(heard.map((tr) => get<Transcript>(`recordings/${tr.id}/transcript`).catch(() => null))).then((all) => {
      if (!live) return;
      const found = all.filter((x): x is Transcript => x !== null);
      setTranscripts(found);
      setLoaded(true);
      onLoaded?.(found.length);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // An approved fix, shown at once: its words, and whether the paragraph is now checked or only fixed in part.
  function fixed(recording: string, segment: string, content: string, complete: boolean) {
    setTranscripts((all) =>
      all.map((tr) =>
        tr.recording !== recording
          ? tr
          : { ...tr, paragraphs: tr.paragraphs.map((p) => (p.id !== segment ? p : { ...p, content, words: content === p.content ? p.words : null, checked: p.checked || complete, edited: !(p.checked || complete) })) },
      ),
    );
  }

  // Edit goes to the page's Text tab, where the words are read and checked.
  function toText() {
    const next = new URLSearchParams(params);
    next.set('tab', 'text');
    next.delete('review');
    navigate({ search: `?${next}` });
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  // Parts with no transcript yet: anyone signed in may ask the machine for one.
  const missing = loaded ? heard.filter((tr) => !transcripts.some((x) => x.recording === tr.id)) : [];
  const ask = missing.length ? (
    <details className="ask-transcripts">
      <summary>
        {t(lang, 'transcript')} · {missing.length === heard.length ? tn(lang, 'noTranscriptYet') : `${missing.length} ${tn(lang, 'partsWithoutTranscript')}`}
      </summary>
      <ul className="stack">
        {missing.map((tr) => (
          <li key={tr.id}>
            {heard.length > 1 ? <b>{tr.title}</b> : null}
            <AskMachine kind="transcript" item={tr.id} lang={lang} />
          </li>
        ))}
      </ul>
    </details>
  ) : null;
  if (!transcripts.length) return ask ? <section id="transcript" className="transcripts">{ask}</section> : null;
  const unchecked = transcripts.some((tr) => tr.paragraphs.some((p) => !p.checked));
  const syncUnchecked = transcripts.some((tr) => tr.paragraphs.some((p) => p.syncChecked === false));

  if (view === 'listen')
    return (
      <section id="transcript" ref={section} className="transcripts">
        <Lyrics transcripts={transcripts} tracks={tracks} lang={lang} nowMs={nowMs} found={found} machine={unchecked || syncUnchecked} signedIn={Boolean(account)} onEdit={toText} />
        {unchecked || syncUnchecked ? <p className="lyrics-foot row-sub">{t(lang, 'lyricsMachineHint')}</p> : null}
        {ask}
      </section>
    );

  return (
    <section id="transcript" ref={section} className="transcripts reviewing">
      <TranscriptEditor
        transcripts={transcripts}
        tracks={tracks}
        lang={lang}
        nowMs={nowMs}
        found={found}
        account={account}
        onFixed={fixed}
      />
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
 * Without `onEdit` it is for listening alone (a showcase's guest,
 * routes/show.tsx): no Edit, and words marked unclear open no conversation.
 */
export function Lyrics({
  transcripts,
  tracks,
  lang,
  nowMs,
  found,
  machine,
  signedIn,
  onEdit,
}: {
  transcripts: Transcript[];
  tracks: Track[];
  lang: Lang;
  nowMs: number;
  found: string | null;
  machine: boolean;
  signedIn: boolean;
  onEdit?: () => void;
}) {
  const player = usePlayer();
  const [discuss, setDiscuss] = useState<{ words: string; atMs: number | null } | null>(null);
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
        {/* Editing is one step away, never in the way of listening: the tools open on their own screen. */}
        {onEdit ? (
          <button
            type="button"
            className="lyrics-edit"
            onClick={() => {
              setFull(false);
              onEdit();
            }}
            title={t(lang, machine ? 'reviewMachineText' : 'reviewTranscript')}
          >
            <PenLine size={16} aria-hidden />
            {t(lang, 'editTranscript')}
          </button>
        ) : null}
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
          const waiting = (shown.pending ?? []).filter((x) => x.segment === p.id).flatMap((x) => pendingRanges(p.content, x.content));
          return (
            <button
              key={p.id}
              id={`p-${p.id}`}
              type="button"
              data-p={p.id}
              className={classes}
              dir="auto"
              onClick={(e) => {
                const target = e.target as HTMLElement;
                const at = target.closest<HTMLElement>('[data-ms]')?.dataset.ms;
                const u = target.closest<HTMLElement>('[data-u]')?.dataset.u;
                const mark = u !== undefined ? unclearRanges(p.content)[Number(u)] : undefined;
                if (mark && onEdit) setDiscuss({ words: p.content.slice(mark.from, mark.to), atMs: at ? Number(at) : p.startMs });
                playFrom(at ? Number(at) : (p.startMs ?? 0));
              }}
            >
              {now && timedWords(p) ? <Spoken content={p.content} words={timedWords(p)!} nowMs={nowMs} lang={lang} pending={waiting} /> : <Plain content={p.content} lang={lang} pending={waiting} />}
            </button>
          );
        })}
      </div>
      {discuss ? <DiscussUnclear recording={shown.recording} words={discuss.words} atMs={discuss.atMs} lang={lang} signedIn={signedIn} onClose={() => setDiscuss(null)} /> : null}
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
