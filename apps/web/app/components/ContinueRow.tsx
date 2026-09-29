import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { accountPlaces, forgetPlace, localPlaces, mergePlaces, placeKey, type Place } from '../lib/places.js';
import { useAccount } from '../lib/useAccount.js';
import { clock, usePlayer, type Track } from '../player/PlayerProvider.js';
import { Icon } from '../ui/Icon.js';

const WORDS = {
  heading: { he: 'להמשיך מאיפה שהפסקתם', en: 'Continue where you stopped' },
  page: { he: 'עמוד', en: 'page' },
  of: { he: 'מתוך', en: 'of' },
  part: { he: 'חלק', en: 'part' },
  play: { he: 'להמשיך לשמוע', en: 'Continue listening' },
  pause: { he: 'השהיה', en: 'Pause' },
  remove: { he: 'להסיר מהרשימה', en: 'Remove from this list' },
} as const;

const SHOWN = 4;

/** `עמוד 14 מתוך 60`, `part 2 · 12:40`. */
function whereIn(place: Place, lang: Lang): string {
  const p = place.place;
  if (place.kind === 'read') return `${WORDS.page[lang]} ${Number(p.page) || 1}${Number(p.pages) ? ` ${WORDS.of[lang]} ${Number(p.pages)}` : ''}`;
  const queue = (p.queue as Track[] | undefined) ?? [];
  const index = Number(p.index) || 0;
  return [queue.length > 1 ? `${WORDS.part[lang]} ${index + 1}/${queue.length}` : '', clock(Number(p.time) || 0)].filter(Boolean).join(' · ');
}

/**
 * "Continue": what you were reading and hearing lately, newest first, from
 * this browser and, when signed in, from your account (so what you left on
 * your phone is here on your computer). Reading reopens at its page; a
 * farbrengen plays on from its moment, here, without leaving the page.
 * Personal, so it is drawn only in the browser: the home page itself is
 * the same for everyone and cached as such.
 */
export function ContinueRow({ lang }: { lang: Lang }) {
  const account = useAccount();
  const player = usePlayer();
  const [places, setPlaces] = useState<Place[]>([]);

  useEffect(() => {
    let live = true;
    setPlaces(localPlaces());
    if (account) void accountPlaces({ limit: 20 }).then((remote) => live && setPlaces(mergePlaces(localPlaces(), remote)));
    return () => {
      live = false;
    };
  }, [account]);

  if (!places.length) return null;
  return (
    <section className="continue" aria-labelledby="continue-h">
      <h2 className="h-sec" id="continue-h">
        {WORDS.heading[lang]}
      </h2>
      <ul className="box rows">
        {places.slice(0, SHOWN).map((place) => {
          const queue = (place.place.queue as Track[] | undefined) ?? [];
          const index = Number(place.place.index) || 0;
          const mine = place.kind === 'listen' && player.current !== null && placeKey(player.current) === place.key;
          return (
            <li key={`${place.kind} ${place.key}`} className="row">
              <Icon name={place.kind === 'read' ? 'book' : 'audio'} className="subtle" />
              <Link className="row-main" to={place.href}>
                <span className="row-title">{place.title}</span>
                <span className="row-sub">{[place.sub, whereIn(place, lang)].filter(Boolean).join(' · ')}</span>
              </Link>
              {place.kind === 'listen' && queue[index] ? (
                <button
                  type="button"
                  className="pp sm"
                  aria-label={`${mine && player.playing ? WORDS.pause[lang] : WORDS.play[lang]}: ${place.title}`}
                  title={mine && player.playing ? WORDS.pause[lang] : WORDS.play[lang]}
                  onClick={() => (mine ? player.toggle() : player.play(queue, index, Number(place.place.time) || 0))}
                >
                  <Icon name={mine && player.playing ? 'pause' : 'play'} />
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost icon sm"
                aria-label={`${WORDS.remove[lang]}: ${place.title}`}
                title={WORDS.remove[lang]}
                onClick={() => {
                  forgetPlace(place.kind, place.key, Boolean(account));
                  setPlaces((all) => all.filter((p) => p !== place));
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
