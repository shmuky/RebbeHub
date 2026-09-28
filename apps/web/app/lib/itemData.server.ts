import type { Backlink, Entity, FileInfo, RebbeHubApi } from './api.js';

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
  /** A text's paragraphs, by text id. */
  segments: Record<string, Entity[]>;
  /** The cursor for the next page of a long list (a work's units). */
  next: string | null;
  backlinks: Backlink[];
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' ? [value] : []);

async function entitiesOf(api: RebbeHubApi, links: Backlink[]): Promise<Entity[]> {
  const found = await api.entities(links.map((l) => l.from));
  return links.map((l) => found.get(l.from)).filter((e): e is Entity => e !== undefined);
}

export async function loadItemView(api: RebbeHubApi, entity: Entity, url: URL): Promise<ItemView> {
  const d = entity.data as Record<string, unknown>;
  const view: ItemView = { refs: {}, lists: {}, files: {}, segments: {}, next: null, backlinks: [] };
  const wanted = new Set<string>([...ids(d.sets), ...ids(d.topics)]);

  switch (entity.type) {
    case 'set': {
      const members = await api.list({ set: entity.id, limit: 500 });
      view.lists.members = members.items;
      break;
    }
    case 'work': {
      ids(d.authors).forEach((id) => wanted.add(id));
      const page = await api.children(entity.id, 'work', 'unit', { after: url.searchParams.get('after') ?? undefined, limit: 200 });
      view.lists.units = page.items;
      view.next = page.items.length === 200 ? page.next : null;
      view.lists.publications = await entitiesOf(api, await api.backlinks(entity.id, { field: 'work', type: 'publication' }));
      break;
    }
    case 'unit': {
      [...ids(d.work), ...ids(d.events)].forEach((id) => wanted.add(id));
      const texts = await entitiesOf(api, await api.backlinks(entity.id, { field: 'unit', type: 'text' }));
      view.lists.texts = texts;
      for (const text of texts) view.segments[text.id] = (await api.children(text.id, 'text', 'segment', { limit: 1000 })).items;
      const maps = await entitiesOf(api, await api.backlinks(entity.id, { field: 'unit', type: 'contents-map' }));
      view.lists.printedIn = maps;
      maps.forEach((m) => ids((m.data as { publication?: string }).publication).forEach((id) => wanted.add(id)));
      break;
    }
    case 'event': {
      ids(d.place).forEach((id) => wanted.add(id));
      view.lists.units = await entitiesOf(api, await api.backlinks(entity.id, { field: 'events', type: 'unit' }));
      const recordings = await entitiesOf(api, await api.backlinks(entity.id, { field: 'event', type: 'recording' }));
      view.lists.recordings = recordings;
      for (const r of recordings) {
        const file = (r.data as { file?: string }).file;
        view.files[r.id] = file ? await api.file(file) : null;
      }
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
      const scans = await entitiesOf(api, await api.backlinks(entity.id, { field: 'publication', type: 'scan' }));
      scans.sort((a, b) => Number(Boolean((b.data as { preferred?: boolean }).preferred)) - Number(Boolean((a.data as { preferred?: boolean }).preferred)));
      view.lists.scans = scans;
      for (const s of scans) view.files[s.id] = await api.file((s.data as { file: string }).file);
      const maps = await entitiesOf(api, await api.backlinks(entity.id, { field: 'publication', type: 'contents-map' }));
      maps.sort((a, b) => (a.data as { pages: { from: number } }).pages.from - (b.data as { pages: { from: number } }).pages.from);
      view.lists.contents = maps;
      maps.forEach((m) => ids((m.data as { unit?: string }).unit).forEach((id) => wanted.add(id)));
      break;
    }
    case 'scan': {
      ids(d.publication).forEach((id) => wanted.add(id));
      view.files[entity.id] = await api.file(d.file as string);
      break;
    }
    case 'recording': {
      ids(d.event).forEach((id) => wanted.add(id));
      view.files[entity.id] = typeof d.file === 'string' ? await api.file(d.file) : null;
      break;
    }
    case 'author': {
      view.lists.works = await entitiesOf(api, await api.backlinks(entity.id, { field: 'authors', type: 'work' }));
      break;
    }
    case 'text': {
      [...ids(d.unit), ...ids(d.publication), ...ids(d.recording)].forEach((id) => wanted.add(id));
      view.segments[entity.id] = (await api.children(entity.id, 'text', 'segment', { limit: 1000 })).items;
      break;
    }
    default: {
      for (const value of Object.values(d)) ids(value).forEach((id) => wanted.add(id));
    }
  }
  view.backlinks = await api.backlinks(entity.id);
  const refs = await api.entities([...wanted]);
  view.refs = Object.fromEntries(refs);
  return view;
}
