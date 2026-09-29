import { Pause, Play } from 'lucide-react';
import type { Entity } from '../lib/api.js';
import { nameOf, t } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { useLang } from '../lib/useLang.js';
import { usePlayer, type Track } from '../player/PlayerProvider.js';

interface RecordingData {
  title: { he: string; en?: string };
  url?: string;
  durationMs?: number;
  part?: number;
  videos?: Array<{ provider: string; url: string; startMs?: number }>;
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** A video link that opens at the event's moment, where the provider allows it. */
function videoAt(url: string, startMs?: number): string {
  if (!startMs) return url;
  const seconds = Math.floor(startMs / 1000);
  if (/youtube\.com|youtu\.be/.test(url)) return `${url}${url.includes('?') ? '&' : '?'}t=${seconds}`;
  return `${url}#t=${seconds}`;
}

/**
 * Recordings, part by part, played in the site's own player (it keeps
 * playing from page to page): audio RebbeHub may serve (`src` resolved
 * from the file's rights) or heard where it is kept, and video links.
 */
/** `queue`, when given, is what plays on after these recordings (a recording's page plays its whole farbrengen). */
export function AudioPlayer({ recordings, sources, queue }: { recordings: Entity[]; sources: Record<string, string | null>; queue?: Track[] }) {
  const lang = useLang();
  const player = usePlayer();
  const sorted = [...recordings].sort((a, b) => ((a.data as unknown as RecordingData).part ?? 0) - ((b.data as unknown as RecordingData).part ?? 0));
  return (
    <div>
      {sorted.map((recording) => {
        const data = recording.data as unknown as RecordingData;
        const src = sources[recording.id] ?? data.url ?? null;
        const tracks: Track[] = queue ?? sorted.flatMap((r) => {
          const d = r.data as unknown as RecordingData;
          const url = sources[r.id] ?? d.url;
          return url ? [{ id: r.id, title: nameOf(d.title, lang), subtitle: '', url, durationMs: d.durationMs, href: href(itemPath(r), lang) }] : [];
        });
        const active = player.current?.id === recording.id;
        return (
          <div className="player" key={recording.id}>
            <strong>{nameOf(data.title, lang)}</strong>
            {data.part ? (
              <span className="card-meta">
                {' '}
                · {t(lang, 'part')} {data.part}
              </span>
            ) : null}
            {data.durationMs ? <span className="card-meta"> · {clock(data.durationMs)}</span> : null}
            {src ? (
              <p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => (active ? player.toggle() : player.play(tracks, tracks.findIndex((tr) => tr.id === recording.id)))}
                  aria-label={`${t(lang, 'play')}: ${nameOf(data.title, lang)}`}
                >
                  {active && player.playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} {active && player.playing ? t(lang, 'pause') : t(lang, 'play')}
                </button>
              </p>
            ) : null}
            {data.videos?.length ? (
              <p>
                {data.videos.map((v, i) => (
                  <a key={i} href={videoAt(v.url, v.startMs)} rel="noopener" target="_blank" style={{ marginInlineEnd: 16 }}>
                    {t(lang, 'video')} ({v.provider}){v.startMs ? ` ${clock(v.startMs)}` : ''}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
