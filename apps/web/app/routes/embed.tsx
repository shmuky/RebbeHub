import { data } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import type { Route } from './+types/embed';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, nameOf, t } from '../lib/i18n.js';
import { loadItemView } from '../lib/itemData.server.js';
import { describe, labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { tracksOf } from '../lib/tracks.js';
import { Icon } from '../ui/Icon.js';
import { Logo } from '../ui/Logo.js';
import '../styles/pages/info.css';

/**
 * An item as other sites embed it (the plan, section 12, phase 6:
 * "embeds"): its name, what it is, a farbrengen's recordings to play in
 * place, and a link to it on RebbeHub. No menus, no sign-in; the only page
 * other sites may frame.
 *
 *   <iframe src="https://rebbehub.org/embed/rh-…" width="100%" height="320"></iframe>
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const entity = await api.entity(params.id);
  if (!entity) throw data('not found', { status: 404 });
  const view = await loadItemView(api, entity, new URL(request.url));
  return { lang, siteUrl, entity, view };
}

export function headers() {
  // Framed by any site; cached like every page.
  return { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600', 'Content-Security-Policy': 'frame-ancestors *' };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return [{ title: `${labelOf(loaderData.entity, loaderData.lang)} · RebbeHub` }, { name: 'robots', content: 'noindex' }];
}

export default function Embed({ loaderData }: Route.ComponentProps) {
  const { lang, siteUrl, entity, view } = loaderData;
  const d = entity.data as { date?: string; title?: LocalName };
  const recordings = view.lists.recordings ?? [];
  const tracks = entity.type === 'event' ? tracksOf(entity, recordings, lang, Object.fromEntries(recordings.map((r) => [r.id, view.files[r.id]?.url ?? null])), view.apiBase) : [];
  const link = `${siteUrl.replace(/\/$/, '')}${href(itemPath(entity), lang)}`;
  return (
    <article className="embed-card">
      <p className="embed-kind subtle small">{describe(entity, lang)}</p>
      <h1>{d.title ? nameOf(d.title, lang) : labelOf(entity, lang)}</h1>
      {d.date ? (
        <p className="embed-date muted">
          <Icon name="cal" size={14} className="subtle" />
          {dateLabel(d.date, lang)}
        </p>
      ) : null}
      {tracks.length ? (
        <ol className="embed-tracks">
          {tracks.map((track) => (
            <li key={track.id}>
              <span className="embed-track">
                <Icon name="audio" size={14} className="subtle" />
                {track.title}
              </span>
              <audio controls preload="none" src={track.url} />
            </li>
          ))}
        </ol>
      ) : null}
      <p className="embed-foot">
        <Logo size={16} name={false} />
        <a href={link} target="_blank" rel="noreferrer">
          {t(lang, 'onRebbeHub')}
        </a>
      </p>
    </article>
  );
}
