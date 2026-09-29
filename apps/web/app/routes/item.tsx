import { data, Link, redirect } from 'react-router';
import type { Route } from './+types/item';
import { ContentsForm } from '../components/ContentsForm.js';
import { EmbedCode } from '../components/EmbedCode.js';
import { FamilyRequestForm, type FamilyRequestResult } from '../components/FamilyRequestForm.js';
import { FollowButton } from '../components/FollowButton.js';
import { ReportForm, type ReportResult } from '../components/ReportForm.js';
import { SuggestFix, canSuggestFix } from '../components/SuggestFix.js';
import { UploadForm } from '../components/UploadForm.js';
import { ItemBelowStart, ItemPage, ItemSideEnd } from '../views/ItemPage.js';
import { ItemSlots } from '../ui/ItemShell.js';
import { Icon } from '../ui/Icon.js';
import { ApiError, type Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateKeyToGregorian } from '@rebbehub/hebrew';
import type { LocalName } from '@rebbehub/model';
import { langFrom, nameOf, t } from '../lib/i18n.js';
import { loadItemView } from '../lib/itemData.server.js';
import { describe, labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { breadcrumbs, pageMeta, type PageMeta } from '../lib/seo.js';
import { ITEM_PAGE } from '../../server/cachePolicy.js';

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

/** Kept at the edge longer than other pages: an item changes only when a Suggestion about it is approved (cachePolicy.ts). */
export function headers({ parentHeaders }: Route.HeadersArgs) {
  const out = new Headers(parentHeaders);
  out.set('Cache-Control', ITEM_PAGE);
  return out;
}

export async function action({ request, context }: Route.ActionArgs): Promise<ReportResult | FamilyRequestResult> {
  const { api } = siteOf(context);
  const form = await request.formData();
  const forwardedFor = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? undefined;
  if (form.get('intent') === 'family-request') {
    try {
      await api.familyRequest(
        String(form.get('teshura') ?? ''),
        { relation: String(form.get('relation') ?? '').trim() || undefined, note: String(form.get('note') ?? '').trim() || undefined, contact: String(form.get('contact') ?? '').trim() || undefined },
        forwardedFor,
      );
      return { familyRequested: true };
    } catch (error) {
      return { familyRequested: false, error: error instanceof ApiError ? error.message : 'the server did not answer' };
    }
  }
  if (form.get('intent') !== 'report') throw data('unknown action', { status: 400 });
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

type ItemData = Route.ComponentProps['loaderData'];

/** A recording's length as schema.org writes it (ISO 8601: PT1H2M3S). */
const isoDuration = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  return `PT${h ? `${h}H` : ''}${Math.floor((ms % 3_600_000) / 60_000)}M${Math.round((ms % 60_000) / 1000)}S`;
};

/** The picture a page shows when shared: its sefer's shaar, drawn from the title page, where there is one. */
function coverOf({ entity, view }: ItemData): { url: string; width: number; height: number } | null {
  const d = entity.data as { work?: string };
  if (entity.type === 'work') return view.workCover?.cover?.image ?? null;
  if ((entity.type === 'unit' || entity.type === 'publication') && typeof d.work === 'string') return view.covers[d.work]?.image ?? null;
  return null;
}

/** The way to an item, as its page's crumbs show it: the library and its shelf and the sefer, or the farbrengens and the year. */
function trail(loaderData: ItemData): Array<{ name: string; path: string }> {
  const { entity, view, lang } = loaderData;
  const d = entity.data as { work?: string; sets?: string[]; event?: string; date?: string };
  const ref = (id: unknown) => (typeof id === 'string' ? view.refs[id] : undefined);
  const step = (e: Entity | undefined) => (e ? [{ name: labelOf(e, lang), path: itemPath(e) }] : []);
  const library = { name: t(lang, 'tabLibrary'), path: '/sets' };
  const farbrengens = { name: t(lang, 'tabFarbrengens'), path: '/calendar' };
  const year = (date: unknown) => (typeof date === 'string' && /^[0-9]{4}/.test(date) ? [{ name: date.slice(0, 4), path: `/calendar/${date.slice(0, 4)}` }] : []);
  const self = step(entity as Entity);
  switch (entity.type) {
    case 'unit':
    case 'publication': {
      const work = ref(d.work);
      return [library, ...step(ref((work?.data as { sets?: string[] } | undefined)?.sets?.[0])), ...step(work), ...self];
    }
    case 'event':
      return [farbrengens, ...year(d.date), ...self];
    case 'recording': {
      const event = ref(d.event);
      return [farbrengens, ...year((event?.data as { date?: string } | undefined)?.date), ...step(event), ...self];
    }
    default:
      return [library, ...step(ref(d.sets?.[0])), ...self];
  }
}

/** schema.org data, so search engines know a sefer from a farbrengen, and the way to each. */
function jsonLd(loaderData: ItemData, siteUrl: string): Array<Record<string, unknown>> {
  const { entity, view, lang } = loaderData;
  const base = siteUrl.replace(/\/$/, '');
  const at = (e: { id: string; path: string | null }) => `${base}${itemPath(e)}`;
  const url = at(entity);
  const d = entity.data as Record<string, unknown>;
  const name = labelOf(entity, lang);
  const description = nameOf(d.description as LocalName | undefined, lang) || undefined;
  const inLanguage = typeof d.language === 'string' ? d.language : 'he';
  const authors = ((d.authors as string[] | undefined) ?? []).map((id) => view.refs[id] as Entity | undefined).filter((a): a is Entity => Boolean(a)).map((a) => ({ '@type': 'Person', name: labelOf(a, lang), url: at(a) }));
  const civil = typeof d.date === 'string' ? dateKeyToGregorian(d.date) : null;
  const cover = coverOf(loaderData);
  const image = cover ? { image: cover.url } : {};
  const work = typeof d.work === 'string' ? view.refs[d.work] : undefined;
  const partOf = work ? { isPartOf: { '@type': 'Book', name: labelOf(work, lang), url: at(work) } } : {};
  const audio = (r: Entity) => {
    const file = view.files[r.id];
    const durationMs = (r.data as { durationMs?: number }).durationMs;
    return {
      '@type': 'AudioObject',
      name: labelOf(r, lang),
      url: at(r),
      ...(file?.url ? { contentUrl: file.url, encodingFormat: file.mime } : {}),
      ...(durationMs ? { duration: isoDuration(durationMs) } : {}),
    };
  };
  let thing: Record<string, unknown>;
  switch (entity.type) {
    case 'work':
      thing = { '@type': 'Book', name, url, author: authors, inLanguage, ...image, ...(description ? { description } : {}) };
      break;
    case 'unit':
      thing = { '@type': 'CreativeWork', name, url, inLanguage, ...partOf, ...image, ...(civil ? { dateCreated: civil } : {}) };
      break;
    case 'publication':
      thing = {
        '@type': 'Book',
        name,
        url,
        ...(typeof d.publisher === 'string' ? { publisher: { '@type': 'Organization', name: d.publisher } } : {}),
        ...(d.gregorianYear ? { datePublished: String(d.gregorianYear) } : {}),
        inLanguage,
        ...partOf,
        ...image,
      };
      break;
    case 'event': {
      const recordings = view.lists.recordings ?? [];
      const place = typeof d.place === 'string' ? view.refs[d.place] : undefined;
      thing = {
        '@type': 'Event',
        name,
        url,
        ...(civil ? { startDate: civil } : {}),
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        ...(place ? { location: { '@type': 'Place', name: labelOf(place, lang) } } : {}),
        ...(recordings.length ? { recordedIn: recordings.map(audio) } : {}),
      };
      break;
    }
    case 'recording': {
      const event = typeof d.event === 'string' ? view.refs[d.event] : undefined;
      thing = { ...audio(entity as Entity), ...(event ? { isPartOf: { '@type': 'Event', name: labelOf(event, lang), url: at(event) } } : {}) };
      break;
    }
    case 'author':
    case 'person':
      thing = { '@type': 'Person', name, url, ...(description ? { description } : {}) };
      break;
    case 'set':
      thing = { '@type': 'Collection', name, url, ...(description ? { description } : {}) };
      break;
    default:
      thing = { '@type': 'CreativeWork', name, url, ...(civil ? { dateCreated: civil } : {}) };
  }
  return [thing, breadcrumbs(base, trail(loaderData))];
}

/** What kind of page it is, for link previews. */
const OG_TYPE: Record<string, PageMeta['type']> = { work: 'book', publication: 'book', unit: 'article', recording: 'music.song', author: 'profile', person: 'profile' };

/** The catalog's own schemas, and the parts of a page (a paragraph, a page of OCR, a sync span), are found through the page they belong to. */
const NOT_INDEXED = new Set(['schema', 'segment', 'text-page', 'text-layer', 'alignment', 'alignment-span', 'contents-map', 'relation']);

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'RebbeHub' }];
  const { entity, lang, siteUrl } = loaderData;
  const cover = coverOf(loaderData);
  return pageMeta({
    title: labelOf(entity, lang),
    description: describe(entity, lang),
    path: itemPath(entity),
    lang,
    siteUrl,
    type: OG_TYPE[entity.type] ?? 'website',
    image: cover ? { ...cover, alt: labelOf(entity, lang) } : null,
    jsonLd: jsonLd(loaderData, siteUrl),
    noindex: NOT_INDEXED.has(entity.type),
  });
}

/** What other sites may embed: sets, sefarim and their sichos, farbrengens, the Rebbeim and other people, printings. */
const FOLLOWABLE = new Set(['set', 'work', 'unit', 'event', 'person', 'publication']);

/** Every item has a page, and anyone may follow it, except the parts of one (a paragraph, a page of OCR, a sync span) and the catalog's own schemas. */
const NOT_FOLLOWED = new Set(['segment', 'text-page', 'alignment-span', 'schema']);

export default function Item({ loaderData }: Route.ComponentProps) {
  const { entity, view, lang, siteUrl } = loaderData;
  const d = entity.data as { kind?: string; slug?: string };
  // The Teshuros set takes new teshuros; a teshura takes a family's request.
  const teshuros = entity.type === 'set' && d.slug === 'teshuros';
  const teshura = entity.type === 'publication' && d.kind === 'teshura';
  const slots = {
    lang,
    actions: (
      <>
        {!NOT_FOLLOWED.has(entity.type) ? <FollowButton entity={entity} lang={lang} /> : null}
        {/* A set's and a sefer's page have their own Edit, with organizing in it (components/EditSheet). */}
        {entity.type === 'set' || entity.type === 'work' ? null : (
          <Link className="btn icon" to={href(`/edit/${entity.id}`, lang)} aria-label={lang === 'he' ? 'עריכה' : 'Edit'} title={lang === 'he' ? 'עריכה' : 'Edit'}>
            <Icon name="pencil" />
          </Link>
        )}
      </>
    ),
    below: (
      <>
        <ItemBelowStart entity={entity} view={view} lang={lang} />
        <div className="panels">
          {canSuggestFix(entity) ? <SuggestFix entity={entity} lang={lang} /> : null}
          {entity.type === 'event' || entity.type === 'work' || entity.type === 'publication' || teshuros ? <UploadForm entity={entity} lang={lang} teshuros={teshuros} /> : null}
          {entity.type === 'publication' ? <ContentsForm publication={entity} lang={lang} /> : null}
          <ReportForm entityId={entity.id} />
          {teshura ? <FamilyRequestForm teshura={entity.id} /> : null}
          {FOLLOWABLE.has(entity.type) ? <EmbedCode entity={entity} lang={lang} siteUrl={siteUrl} /> : null}
        </div>
      </>
    ),
    side: <ItemSideEnd entity={entity} view={view} lang={lang} />,
  };
  return (
    <ItemSlots.Provider value={slots}>
      <ItemPage entity={entity} view={view} />
    </ItemSlots.Provider>
  );
}
