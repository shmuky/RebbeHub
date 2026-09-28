import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * One player for the whole site, as in Sichos-Kodesh's app: a single
 * <audio> above the pages, so a farbrengen keeps playing while you browse.
 * The queue is one event's parts. Where you are is kept in this browser
 * (localStorage), so a reload or a return visit picks up where you left
 * off, paused.
 */

export interface Track {
  id: string;
  /** The part: `שיחה א׳`. */
  title: string;
  /** The event and its date: `י״ט כסלו · תשי״ד`. */
  subtitle: string;
  url: string;
  durationMs?: number;
  /** The event's page, so the bar can link back to it. */
  href: string;
}

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  error: boolean;
}

interface PlayerApi extends PlayerState {
  current: Track | null;
  /** Plays a queue from one of its parts (the first by default), from `startAt` seconds into it (a transcript's line). */
  play: (queue: Track[], index?: number, startAt?: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

const STORE = 'rebbehub.player';

interface Saved {
  queue: Track[];
  index: number;
  time: number;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && Array.isArray(saved.queue) && saved.queue[saved.index] ? saved : null;
  } catch {
    return null;
  }
}

function save(saved: Saved | null) {
  try {
    if (saved) localStorage.setItem(STORE, JSON.stringify(saved));
    else localStorage.removeItem(STORE);
  } catch {
    // Private windows and full storage: playing still works, it is only not remembered.
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const autoplay = useRef(false);
  const lastSaved = useRef(0);
  const [state, setState] = useState<PlayerState>({ queue: [], index: 0, playing: false, loading: false, time: 0, duration: 0, error: false });
  const current = state.queue[state.index] ?? null;

  // Restore the last queue, paused, once the page is in the browser.
  useEffect(() => {
    const saved = load();
    if (!saved) return;
    pendingSeek.current = saved.time;
    setState((s) => ({ ...s, queue: saved.queue, index: saved.index, time: saved.time }));
  }, []);

  const persist = useCallback((queue: Track[], index: number, time: number) => {
    lastSaved.current = Date.now();
    save(queue.length ? { queue, index, time } : null);
  }, []);

  const play = useCallback(
    (queue: Track[], index = 0, startAt?: number) => {
      autoplay.current = true;
      pendingSeek.current = startAt ?? null;
      setState((s) => ({ ...s, queue, index, time: startAt ?? 0, duration: 0, playing: false, loading: true, error: false }));
      persist(queue, index, startAt ?? 0);
    },
    [persist],
  );

  const goTo = useCallback(
    (index: number) => {
      setState((s) => {
        if (index < 0 || index >= s.queue.length) return s;
        autoplay.current = true;
        pendingSeek.current = null;
        persist(s.queue, index, 0);
        return { ...s, index, time: 0, duration: 0, loading: true, error: false };
      });
    },
    [persist],
  );

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !current) return;
    if (el.paused) void el.play().catch(() => setState((s) => ({ ...s, error: true })));
    else el.pause();
  }, [current]);

  const seek = useCallback((seconds: number) => {
    const el = audio.current;
    if (el && Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
  }, []);

  const close = useCallback(() => {
    audio.current?.pause();
    setState((s) => ({ ...s, queue: [], index: 0, playing: false, time: 0, duration: 0 }));
    save(null);
  }, []);

  const next = useCallback(() => goTo(state.index + 1), [goTo, state.index]);
  const prev = useCallback(() => {
    // As players do: back to the start of the part, unless it has only just begun.
    if ((audio.current?.currentTime ?? 0) > 5 || state.index === 0) seek(0);
    else goTo(state.index - 1);
  }, [goTo, seek, state.index]);

  // A new part: load it, and play if asked to.
  useEffect(() => {
    const el = audio.current;
    if (!el || !current) return;
    if (el.src !== current.url) {
      el.src = current.url;
      el.load();
    }
    if (autoplay.current) {
      autoplay.current = false;
      void el.play().catch(() => setState((s) => ({ ...s, loading: false })));
    }
  }, [current]);

  // The phone's lock screen and headphone buttons.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.subtitle, album: 'RebbeHub' });
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['play', () => void audio.current?.play()],
      ['pause', () => audio.current?.pause()],
      ['previoustrack', state.index > 0 ? () => prev() : null],
      ['nexttrack', state.index < state.queue.length - 1 ? () => next() : null],
      ['seekto', (d) => seek(d.seekTime ?? 0)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // An action this browser does not know.
      }
    }
  }, [current, next, prev, seek, state.index, state.queue.length]);

  const api = useMemo<PlayerApi>(() => ({ ...state, current, play, toggle, next, prev, seek, close }), [state, current, play, toggle, next, prev, seek, close]);

  return (
    <PlayerContext.Provider value={api}>
      {children}
      <audio
        ref={audio}
        preload="none"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (pendingSeek.current !== null) {
            el.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
          setState((s) => ({ ...s, duration: el.duration || 0 }));
        }}
        onPlaying={() => setState((s) => ({ ...s, playing: true, loading: false, error: false }))}
        onPause={() => {
          setState((s) => ({ ...s, playing: false }));
          const el = audio.current;
          if (el) persist(state.queue, state.index, el.currentTime);
        }}
        onWaiting={() => setState((s) => ({ ...s, loading: true }))}
        onTimeUpdate={(e) => {
          const time = e.currentTarget.currentTime;
          setState((s) => ({ ...s, time }));
          if (Date.now() - lastSaved.current > 3000) persist(state.queue, state.index, time);
        }}
        onEnded={() => {
          if (state.index < state.queue.length - 1) goTo(state.index + 1);
          else setState((s) => ({ ...s, playing: false }));
        }}
        onError={() => setState((s) => ({ ...s, loading: false, playing: false, error: true }))}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const api = useContext(PlayerContext);
  if (!api) throw new Error('usePlayer is used outside PlayerProvider');
  return api;
}

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
