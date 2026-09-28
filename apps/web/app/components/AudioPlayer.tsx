import type { Entity } from '../lib/api.js';
import { nameOf, t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';

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
 * The recordings of an event, part by part: the browser's own player for
 * audio RebbeHub may serve (`src` resolved from the file's rights), and a
 * plain link for audio and video kept elsewhere.
 */
export function AudioPlayer({ recordings, sources }: { recordings: Entity[]; sources: Record<string, string | null> }) {
  const lang = useLang();
  const sorted = [...recordings].sort((a, b) => ((a.data as unknown as RecordingData).part ?? 0) - ((b.data as unknown as RecordingData).part ?? 0));
  return (
    <div>
      {sorted.map((recording) => {
        const data = recording.data as unknown as RecordingData;
        const src = sources[recording.id] ?? data.url ?? null;
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
            {src ? <audio controls preload="none" src={src} aria-label={`${t(lang, 'play')}: ${nameOf(data.title, lang)}`} /> : null}
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
