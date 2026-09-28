import { data, redirect } from 'react-router';
import type { Route } from './+types/item';
import { FollowButton } from '../components/FollowButton.js';
import { ReportForm, type ReportResult } from '../components/ReportForm.js';
import { SuggestFix, canSuggestFix } from '../components/SuggestFix.js';
import { UploadForm } from '../components/UploadForm.js';
import { ItemPage } from '../views/ItemPage.js';
import { ApiError } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateKeyToGregorian } from '@rebbehub/hebrew';
import { langFrom } from '../lib/i18n.js';
import { loadItemView } from '../lib/itemData.server.js';
import { describe, labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * Every item's page. A readable path (`/likkutei-sichos/12/3`) is resolved
 * through the API; an old path, or a permanent id (`/rh-7k2m9q4d`), is
 * sent on to the item's current path with a permanent redirect, so links
 * never break.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const path = `/${params['*'] ?? ''}`.replace(/\/+$/, '') || '/';
  const keep = (target: string) => href(target, lang, { after: url.searchParams.get('after') ?? undefined });

  const idMatch = /^\/(rh-?[0-9a-z-]+)$/i.exec(path);
  let entity = null;
  if (idMatch) {
    entity = await api.entity(idMatch[1]!);
    if (entity?.path) throw redirect(keep(entity.path), 301);
  } else {
    const resolved = await api.resolve(path);
    if (!resolved) throw data('not found', { status: 404 });
    if (resolved.path && resolved.path !== path) throw redirect(keep(resolved.path), 301);
    entity = await api.entity(resolved.id);
  }
  if (!entity) throw data('not found', { status: 404 });
  const view = await loadItemView(api, entity, url);
  return { entity, view, lang, siteUrl };
}

export async function action({ request, context }: Route.ActionArgs): Promise<ReportResult> {
  const { api } = siteOf(context);
  const form = await request.formData();
  if (form.get('intent') !== 'report') throw data('unknown action', { status: 400 });
  const forwardedFor = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? undefined;
  try {
    await api.report(
      {
        entityId: String(form.get('entityId') ?? '') || undefined,
        reason: String(form.get('reason') ?? ''),
        note: String(form.get('note') ?? '').trim() || undefined,
      },
      forwardedFor,
    );
    return { reported: true };
  } catch (error) {
    return { reported: false, error: error instanceof ApiError ? error.message : 'the server did not answer' };
  }
}

/** schema.org data, so search engines know a sefer from a farbrengen. */
function jsonLd(loaderData: Route.ComponentProps['loaderData'], url: string): Record<string, unknown> {
  const { entity, view, lang } = loaderData;
  const d = entity.data as Record<string, unknown>;
  const name = labelOf(entity, lang);
  const authors = ((d.authors as string[] | undefined) ?? []).map((id) => view.refs[id]).filter(Boolean).map((a) => ({ '@type': 'Person', name: labelOf(a!, lang) }));
  const civil = typeof d.date === 'string' ? dateKeyToGregorian(d.date) : null;
  switch (entity.type) {
    case 'work':
      return { '@type': 'Book', name, url, author: authors, inLanguage: 'he' };
    case 'publication':
      return { '@type': 'Book', name, url, publisher: d.publisher, ...(d.gregorianYear ? { datePublished: String(d.gregorianYear) } : {}), inLanguage: 'he' };
    case 'event':
      return { '@type': 'Event', name, url, ...(civil ? { startDate: civil } : {}), eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode' };
    case 'recording':
      return { '@type': 'AudioObject', name, url };
    case 'author':
    case 'person':
      return { '@type': 'Person', name, url };
    default:
      return { '@type': 'CreativeWork', name, url, ...(civil ? { dateCreated: civil } : {}) };
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'RebbeHub' }];
  const { entity, lang, siteUrl } = loaderData;
  const path = itemPath(entity);
  return pageMeta({
    title: labelOf(entity, lang),
    description: describe(entity, lang),
    path,
    lang,
    siteUrl,
    jsonLd: jsonLd(loaderData, `${siteUrl.replace(/\/$/, '')}${path}`),
    noindex: entity.type === 'schema',
  });
}

/** What people follow: sets, sefarim and their sichos, farbrengens, the Rebbeim and other people, printings. */
const FOLLOWABLE = new Set(['set', 'work', 'unit', 'event', 'person', 'publication']);

export default function Item({ loaderData }: Route.ComponentProps) {
  return (
    <>
      {FOLLOWABLE.has(loaderData.entity.type) ? (
        <div className="item-actions">
          <FollowButton entity={loaderData.entity} lang={loaderData.lang} />
        </div>
      ) : null}
      <ItemPage entity={loaderData.entity} view={loaderData.view} />
      {canSuggestFix(loaderData.entity) ? <SuggestFix entity={loaderData.entity} lang={loaderData.lang} /> : null}
      {loaderData.entity.type === 'event' || loaderData.entity.type === 'work' ? <UploadForm entity={loaderData.entity} lang={loaderData.lang} /> : null}
      <ReportForm entityId={loaderData.entity.id} />
    </>
  );
}
