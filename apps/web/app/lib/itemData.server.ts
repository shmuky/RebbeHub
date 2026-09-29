import { threadsAbout, type AboutThread } from './about.server.js';
import { workToc, type WorkToc } from './workView.server.js';
import { eventView, type EventView } from './eventView.server.js';
import type { Backlink, Cover, Entity, FileInfo, LinkGroup, RebbeHubApi, RelationLink, ScanPages, WorkCover } from './api.js';

/**
 * What an item's page needs beyond the item itself, by type: a work's
 * units, an event's recordings and sicho, a publication's scans and
 * contents, a text's paragraphs - plus every item they name, fetched in
 * one batch so names can be shown.
 */
export interface ItemView {
  /** Items named on the page, by id. */
  refs: Record<string, Entity>;
  /** Named lists of related items. */
  lists: Record<string, Entity[]>;
  /** Files, by the id of the item that holds them. */
  files: Record<string, FileInfo | null>;
  /** The API's address, where a recording on Google Drive is played from (lib/drive.ts). */
  apiBase?: string;
  /** A text's paragraphs, by text id. */
  segments: Record<string, Entity[]>;
  /** The cursor for the next page of a long list (a work's units). */
  next: string | null;
  backlinks: Backlink[];
  /** Its links both ways: what it cites, where it was printed, the farbrengen it is based on, what cites it. */
  relations: RelationLink[];
  /** A work's volumes, with how many units each holds. */
  outline?: Array<{ value: string; label: { he: string; en?: string } | null; units: number }>;
  /** How many units each work holds, for covers on a shelf or a Rebbe's page. */
  counts?: Record<string, number>;
  /** A served scan's page images, by scan id, where the jobs have made them. */
  pages: Record<string, ScanPages>;
  /** How many scans each printing has, for a sefer's list of printings. */
  scanCounts?: Record<string, number>;
  /** Everything that points at the item, by type and field, counted: no list on the page ends without its total. */
  linked: LinkGroup[];
  /** Sefarim's covers from their title pages, by work id, where the jobs have drawn them. */
  covers: Record<string, Cover>;
  /** A sefer's own cover, and the PDFs a keeper may choose its title page from. */
  workCover?: WorkCover | null;
  /** A sefer's (or a volume's) contents with their marks and page numbers, and its numbers. */
  toc?: WorkToc;
  /** Suggestions and issues about it (and what is in it), newest first. */
  about: AboutThread[];
  /** Who keeps its set: they approve suggestions to it. */
  keepers: Array<{ id: string; username: string | null; displayName: string }>;
  /** How many comments its talk page has. */
  talk: number;
  /** A farbrengen's: what was said there, and its words synced to its recordings. */
  event?: EventView;
}

/** A text's paragraphs, all of them, a page at a time (a hanacha may have up to 2,000; a sefer's text more). */
const MAX_SEGMENT_PAGES = 20;
async function allSegments(api: RebbeHubApi, text: string): Promise<Entity[]> {
  const out: Entity[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_SEGMENT_PAGES; i++) {
    const page = await api.children(text, 'text', 'segment', { after, limit: 1000 });
    out.push(...page.items);
    if (!page.next || page.items.length < 1000) break;
    after = page.next;
  }
  return out;
}

/** An API from before covers and counts were served has none to give. */
const orNone = <T>(promise: Promise<T>, none: T): Promise<T> => promise.catch(() => none);

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' ? [value] : []);

/** What points at an item through one field, the items themselves in their own order, in one request (`/linked`), up to a page of them. */
async function linkedItems(api: RebbeHubApi, id: string, field: string, type: string): Promise<Entity[]> {
  return (await api.linked(id, { field, type, limit: 500 })).items;
}

/** A year to sort a printing by: its Hebrew year, else its civil year made Hebrew; undated ones last. */
const yearOf = (p: Entity): number => {
  const d = p.data as { date?: string; gregorianYear?: number };
  return d.date ? Number(d.date.slice(0, 4)) : d.gregorianYear ? d.gregorianYear + 3760 : 99999;
};

/** Printings in the order they came out (then by printing number). */
export function sortPrintings(publications: Entity[]): Entity[] {
  return [...publications].sort((a, b) => yearOf(a) - yearOf(b) || ((a.data as { printing?: number }).printing ?? 0) - ((b.data as { printing?: number }).printing ?? 0));
}

export async function loadItemView(api: RebbeHubApi, entity: Entity, url: URL): Promise<ItemView> {
  const d = entity.data as Record<string, unknown>;
  const view: ItemView = { refs: {}, lists: {}, files: {}, apiBase: api.baseUrl, segments: {}, next: null, backlinks: [], relations: [], pages: {}, linked: [], covers: {}, about: [], keepers: [], talk: 0 };
  // What the conversations about it are matched by: the item, and what is in it.
  const aboutIds = new Set<string>([entity.id]);
  /** The page images of the first few served scans that have them. */
  const loadPages = async (scans: Entity[]) => {
    for (const scan of scans.slice(0, 3)) {
      if (!view.files[scan.id]?.pageImages) continue;
      const pages = await api.scanPages(scan.id);
      if (pages?.pages.length) view.pages[scan.id] = pages;
    }
  };
  const wanted = new Set<string>([...ids(d.sets), ...ids(d.topics)]);

  switch (entity.type) {
    case 'set': {
      // Its sefarim, all of them (a shelf), with how many sichos each holds; of whatever else is in it, the first sixty of
      // each kind and how many there are (a set of three thousand farbrengens listed five hundred, 700 kB no one scrolled).
      const [groups, works, units] = await Promise.all([orNone(api.linkedCounts(entity.id), []), api.list({ set: entity.id, type: 'work', limit: 500 }), api.refCounts('work', 'unit')]);
      const otherTypes = [...new Set(groups.filter((g) => g.field === 'sets' && g.type !== 'work').map((g) => g.type))];
      const others = await Promise.all(otherTypes.map((type) => api.list({ set: entity.id, type, limit: 60 })));
      view.lists.members = [...works.items, ...others.flatMap((o) => o.items)];
      view.linked = groups;
      view.counts = units;
      view.covers = await orNone(api.covers(works.items.map((m) => m.id)), {});
      break;
    }
    case 'work': {
      ids(d.authors).forEach((id) => wanted.add(id));
      // Its volumes first; one volume's units when one is opened (?part=), else the units of a work of one level.
      const [outline, publications, cover] = await Promise.all([
        api.workOutline(entity.id),
        linkedItems(api, entity.id, 'work', 'publication'),
        orNone(api.workCover(entity.id), null),
      ]);
      view.outline = outline;
      view.workCover = cover;
      // Its printings in the order they came out, each with how many scans it has.
      view.lists.publications = sortPrintings(publications);
      if (publications.length) view.scanCounts = await api.refCounts('publication', 'scan');
      const part = url.searchParams.get('part');
      if (part) view.lists.units = await api.workPart(entity.id, part);
      else if (outline.length && (outline.length === 1 || outline.every((p) => p.units === 1))) {
        const page = await api.children(entity.id, 'work', 'unit', { after: url.searchParams.get('after') ?? undefined, limit: 200 });
        view.lists.units = page.items;
        view.next = page.items.length === 200 ? page.next : null;
      }
      if (view.lists.units?.length) {
        view.toc = await workToc(api, view.lists.units, view.lists.publications, view.scanCounts ?? {}, { part: part ?? (outline.length === 1 ? outline[0]!.value : null), printing: url.searchParams.get('printing'), lang: url.searchParams.get('lang') === 'en' ? 'en' : 'he' });
        view.lists.units.forEach((u) => aboutIds.add(u.id));
      }
      break;
    }
    case 'unit': {
      [...ids(d.work), ...ids(d.events)].forEach((id) => wanted.add(id));
      const texts = await linkedItems(api, entity.id, 'unit', 'text');
      view.lists.texts = texts;
      const segments = await Promise.all(texts.map((text) => allSegments(api, text.id)));
      texts.forEach((text, i) => (view.segments[text.id] = segments[i]!));
      const maps = await linkedItems(api, entity.id, 'unit', 'contents-map');
      view.lists.printedIn = maps;
      maps.forEach((m) => ids((m.data as { publication?: string }).publication).forEach((id) => wanted.add(id)));
      break;
    }
    case 'event': {
      ids(d.place).forEach((id) => wanted.add(id));
      view.lists.units = await linkedItems(api, entity.id, 'events', 'unit');
      const recordings = await linkedItems(api, entity.id, 'event', 'recording');
      view.lists.recordings = recordings;
      // Each part's file, all in one request (a farbrengen may have forty parts).
      const files = await api.files(recordings.map((r) => String((r.data as { file?: string }).file ?? '')).filter(Boolean));
      recordings.forEach((r) => (view.files[r.id] = files.get(String((r.data as { file?: string }).file ?? '')) ?? null));
      view.event = await orNone(eventView(api, view.lists.units, recordings, url.searchParams.get('lang') === 'en' ? 'en' : 'he'), { said: [], texts: [] });
      const date = typeof d.date === 'string' ? d.date : '';
      const day = /^\d{4}-(\w{2,3}-\d{2})$/.exec(date)?.[1];
      const [otherYears, sameYear] = await Promise.all([day ? api.events({ day, limit: 50 }) : [], date ? api.events({ within: date.slice(0, 4), limit: 2000 }) : []]);
      view.lists.otherYears = otherYears.filter((e) => e.id !== entity.id);
      // The farbrengens before and after it, in date order within its year.
      const at = sameYear.findIndex((e) => e.id === entity.id);
      if (at > 0) view.lists.previous = [sameYear[at - 1]!];
      if (at >= 0 && at < sameYear.length - 1) view.lists.following = [sameYear[at + 1]!];
      break;
    }
    case 'publication': {
      [...ids(d.work), ...ids(d.reprintOf)].forEach((id) => wanted.add(id));
      const scans = await linkedItems(api, entity.id, 'publication', 'scan');
      scans.sort((a, b) => Number(Boolean((b.data as { preferred?: boolean }).preferred)) - Number(Boolean((a.data as { preferred?: boolean }).preferred)));
      view.lists.scans = scans;
      const files = await api.files(scans.map((s) => (s.data as { file: string }).file));
      scans.forEach((s) => (view.files[s.id] = files.get((s.data as { file: string }).file) ?? null));
      await loadPages(scans);
      // The sefer's other printings, and what this one reprints.
      if (typeof d.work === 'string') view.lists.otherPrintings = sortPrintings((await linkedItems(api, d.work, 'work', 'publication')).filter((p) => p.id !== entity.id));
      const maps = await linkedItems(api, entity.id, 'publication', 'contents-map');
      maps.sort((a, b) => (a.data as { pages: { from: number } }).pages.from - (b.data as { pages: { from: number } }).pages.from);
      view.lists.contents = maps;
      maps.forEach((m) => ids((m.data as { unit?: string }).unit).forEach((id) => wanted.add(id)));
      break;
    }
    case 'scan': {
      ids(d.publication).forEach((id) => wanted.add(id));
      view.files[entity.id] = await api.file(d.file as string);
      await loadPages([entity]);
      break;
    }
    case 'recording': {
      ids(d.event).forEach((id) => wanted.add(id));
      view.files[entity.id] = typeof d.file === 'string' ? await api.file(d.file) : null;
      // The farbrengen's other parts, and the texts of this one (transcripts, a hanacha synced to it).
      const [parts, texts] = await Promise.all([
        typeof d.event === 'string' ? linkedItems(api, d.event, 'event', 'recording') : [],
        linkedItems(api, entity.id, 'recording', 'text'),
      ]);
      view.lists.parts = parts.sort((a, b) => ((a.data as { part?: number }).part ?? 0) - ((b.data as { part?: number }).part ?? 0));
      view.lists.texts = texts;
      break;
    }
    case 'author': {
      const [works, units] = await Promise.all([linkedItems(api, entity.id, 'authors', 'work'), api.refCounts('work', 'unit')]);
      view.lists.works = works;
      view.counts = units;
      view.covers = await orNone(api.covers(works.map((w) => w.id)), {});
      break;
    }
    case 'text': {
      [...ids(d.unit), ...ids(d.publication), ...ids(d.recording)].forEach((id) => wanted.add(id));
      view.segments[entity.id] = await allSegments(api, entity.id);
      break;
    }
    default: {
      for (const value of Object.values(d)) ids(value).forEach((id) => wanted.add(id));
    }
  }
  if (['work', 'unit', 'event', 'publication', 'set'].includes(entity.type)) {
    if (entity.type === 'unit') (view.lists.texts ?? []).forEach((x) => aboutIds.add(x.id));
    if (entity.type === 'event') (view.lists.units ?? []).forEach((x) => aboutIds.add(x.id));
    const [about, talk] = await Promise.all([orNone(threadsAbout(api, aboutIds, url.searchParams.get('lang') === 'en' ? 'en' : 'he', { set: entity.type === 'set' ? entity.id : null }), []), orNone(api.talk(entity.id), { talk: [] })]);
    view.about = about;
    view.talk = talk.talk.length;
  }
  // Asked for together: each is its own round trip to the API.
  [view.backlinks, view.linked, view.relations] = await Promise.all([
    api.backlinks(entity.id),
    view.linked.length ? Promise.resolve(view.linked) : orNone(api.linkedCounts(entity.id), []),
    // An API from before links were served has none to give.
    api.relations(entity.id).catch(() => []),
  ]);
  view.relations.forEach((r) => wanted.add(r.other));
  const refs = await api.entities([...wanted]);
  view.refs = { ...view.refs, ...Object.fromEntries(refs) };
  // Keepers of its set, by name.
  const workOf = typeof d.work === 'string' ? view.refs[d.work] : undefined;
  const setWanted = entity.type === 'set' ? entity.id : (ids(d.sets)[0] ?? ids((workOf?.data as Record<string, unknown> | undefined)?.sets)[0]);
  const setOf = entity.type === 'set' ? entity : setWanted ? (view.refs[setWanted] ?? (await orNone(api.entity(setWanted), null)) ?? undefined) : undefined;
  if (setOf && !view.refs[setOf.id]) view.refs[setOf.id] = setOf;
  const keepers = ((setOf?.data as { keepers?: string[] } | undefined)?.keepers ?? []).slice(0, 12);
  // A sicha's or a printing's sefer's cover: the picture its page shows when it is shared.
  if ((entity.type === 'unit' || entity.type === 'publication') && typeof d.work === 'string') view.covers = await orNone(api.covers([d.work]), {});
  if (keepers.length) view.keepers = (await api.peopleByIds(keepers)).map((p) => ({ id: p.id, username: p.username, displayName: p.displayName }));
  // A sefer's sichos are on its page as its contents (`toc`), a farbrengen's as what was said there (`event`): the
  // items themselves stay out of what the page carries to the browser (a volume's hundred and fifty, a kilobyte each).
  delete view.lists.units;
  return view;
}
