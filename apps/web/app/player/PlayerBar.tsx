import { ChevronDown, ChevronUp, Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '../lib/i18n.js';
import { useLang } from '../lib/useLang.js';
import { clock, usePlayer } from './PlayerProvider.js';

/** The speeds offered while checking a transcript: slower to catch every word, a little faster to go over what is right. */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

/**
 * The bar at the foot of every page once something has played: the part
 * and its farbrengen, play and the parts before and after, the scrubber,
 * and the list of parts. It stays while you move between pages. While a
 * transcript is being checked it also plays the last seconds again and
 * slows down or speeds up; only there, as Shmuly asked.
 */
export function PlayerBar() {
  const lang = useLang();
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const { current, queue, index } = player;
  if (!current) return null;
  const duration = player.duration || (current.durationMs ?? 0) / 1000;
  const percent = duration ? Math.min(100, (player.time / duration) * 100) : 0;
  const several = queue.length > 1;
  return (
    <div className={player.speedOffered ? 'player-bar checking' : 'player-bar'} role="region" aria-label={t(lang, 'player')}>
      {open && several ? (
        <ol className="player-parts">
          {queue.map((track, i) => (
            <li key={track.id}>
              <button type="button" className={i === index ? 'active' : ''} onClick={() => player.play(queue, i)}>
                <span className="player-part-no">{i + 1}</span>
                <span className="player-part-title">{track.title}</span>
                {track.durationMs ? <span className="player-part-time">{clock(track.durationMs / 1000)}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="player-row">
        <div className="player-transport">
          {several ? (
            <button type="button" className="icon-button" onClick={player.prev} aria-label={t(lang, 'previousPart')}>
              <SkipBack size={20} />
            </button>
          ) : null}
          <button type="button" className="play-button" onClick={player.toggle} aria-label={player.playing ? t(lang, 'pause') : t(lang, 'play')}>
            {player.loading && !player.playing ? <Loader2 size={22} className="spin" /> : player.playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          {several ? (
            <button type="button" className="icon-button" onClick={player.next} disabled={index >= queue.length - 1} aria-label={t(lang, 'nextPart')}>
              <SkipForward size={20} />
            </button>
          ) : null}
        </div>
        <div className="player-info">
          <div className="player-titles">
            <Link to={current.href} className="player-title">
              {current.title}
            </Link>
            <span className="player-sub">
              {current.subtitle}
              {several ? ` · ${index + 1}/${queue.length}` : ''}
              {player.error ? ` · ${t(lang, 'playError')}` : ''}
            </span>
          </div>
          <div className="player-scrub">
            <span className="player-time">{clock(player.time)}</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={1}
              value={Math.min(player.time, duration || 1)}
              onChange={(e) => player.seek(Number(e.target.value))}
              style={{ ['--played' as string]: `${percent}%` }}
              aria-label={t(lang, 'position')}
            />
            <span className="player-time">{duration ? clock(duration) : '–:––'}</span>
          </div>
        </div>
        <div className="player-end">
          {player.speedOffered ? (
            <>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  player.seek(Math.max(0, player.now() - 5));
                  if (!player.playing) player.toggle();
                }}
                aria-label={t(lang, 'hearAgain')}
                title={t(lang, 'hearAgain')}
              >
                <RotateCcw size={18} />
              </button>
              <label className="player-speed" title={t(lang, 'speed')}>
                <select dir="ltr" aria-label={t(lang, 'speed')} value={player.rate} onChange={(e) => player.setRate(Number(e.target.value))}>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s.toLocaleString(lang)}×
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {several ? (
            <button type="button" className="icon-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t(lang, 'parts')}>
              {open ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
            </button>
          ) : null}
          <button type="button" className="icon-button" onClick={player.close} aria-label={t(lang, 'closePlayer')}>
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
