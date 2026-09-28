import type { EntityView } from '@rebbehub/core';
import { datePrecision, parseDateKey } from '@rebbehub/hebrew';
import {
  SOURCE_IDS,
  type Author,
  type AuthorData,
  type ContentsEntry,
  type ContentsNode,
  type Edition,
  type EntityId,
  type EventData,
  type ImportedWork,
  type LocalName,
  type Names,
  type SourceId,
  type Unit,
  type UnitData,
  type Work,
  type WorkData,
  type WorkSource,
} from '@rebbehub/model';

/**
 * A catalog edition in the shape Sichos-Kodesh builds its library from:
 * the inputs of its `buildCatalogWorks` (packages/works) - authors, works,
 * and each work's contents and units as an importer would give them. Once
 * Sichos-Kodesh reads this instead of its own registry, it stops curating
 * a catalog of its own (docs/plans/rebbehub.md, section 2).
 *
 * Ids go back to the ones Sichos-Kodesh already uses (work and author
 * slugs, the phone's unit ids from `externalIds`), so downloads, progress
 * and packs made so far keep working. Only the sources Sichos-Kodesh knows
 * are carried; RebbeHub's other sources are left out rather than widening
 * its types.
 */
export interface SichosKodeshRelease {
  format: 'rebbehub-sichos-kodesh-works';
  formatVersion: 1;
  tag: string;
  commit: number;
  authors: Author[];
  works: Work[];
  imported: ImportedWork[];
}

const KNOWN_SOURCES = new Set<string>(SOURCE_IDS);
const names = (n: LocalName): Names => ({ he: n.he, en: n.en ?? n.he });

export function toSichosKodeshRelease(entities: Iterable<EntityView>, meta: { tag: string; commit: number }): SichosKodeshRelease {
  const authors = new Map<EntityId, { author: Author }>();
  const works = new Map<EntityId, WorkData>();
  const units: Array<{ id: EntityId; data: UnitData }> = [];
  const events = new Map<EntityId, EventData>();
  for (const e of entities) {
    if (e.type === 'author') {
      const a = e.data as unknown as AuthorData;
      const author: Author = { id: a.slug ?? e.id, name: names(a.name) };
      if (a.rebbe) author.rebbe = a.rebbe;
      authors.set(e.id, { author });
    } else if (e.type === 'work') works.set(e.id, e.data as unknown as WorkData);
    else if (e.type === 'unit') units.push({ id: e.id, data: e.data as unknown as UnitData });
    else if (e.type === 'event') events.set(e.id, e.data as unknown as EventData);
  }

  const outWorks: Work[] = [];
  for (const w of works.values()) {
    const sources: WorkSource[] = (w.sourceCopies ?? [])
      .filter((s) => KNOWN_SOURCES.has(s.source))
      .map((s) => {
        const out: WorkSource = { source: s.source as SourceId, sourceId: s.sourceId, kind: s.kind, licence: s.licence };
        if (s.language === 'he' || s.language === 'en' || s.language === 'yi') out.language = s.language;
        if (s.credit) out.credit = s.credit;
        if (s.version) out.version = s.version;
        return out;
      });
    const work: Work = {
      id: w.slug,
      title: names(w.title),
      authors: w.authors.map((id) => authors.get(id)?.author.id).filter((id): id is string => id !== undefined),
      genre: w.genre,
      levels: w.levels,
      sources,
    };
    const collection = w.externalIds?.['sichos-kodesh-collection'];
    if (collection) work.collection = collection;
    outWorks.push(work);
  }

  const byWork = new Map<EntityId, Array<{ id: EntityId; data: UnitData }>>();
  for (const u of units) byWork.set(u.data.work, [...(byWork.get(u.data.work) ?? []), u]);
  const imported: ImportedWork[] = [];
  for (const [workId, list] of byWork) {
    const work = works.get(workId);
    if (!work) continue;
    list.sort((a, b) => (a.data.order < b.data.order ? -1 : a.data.order > b.data.order ? 1 : 0));
    const outUnits: Unit[] = list.map(({ id, data }) => {
      const unit: Unit = { id: data.externalIds?.['sichos-kodesh-unit'] ?? id, workId: work.slug, label: data.label.he, editions: [] };
      if (data.label.en) unit.labelEn = data.label.en;
      if (data.date) {
        unit.hebrewYear = parseDateKey(data.date)?.year;
        if (datePrecision(data.date) === 'day') unit.hebrewDate = data.date;
      }
      const occasions = (data.events ?? []).map((e) => Number(events.get(e)?.externalIds?.['mafteiach-occasion'])).filter((n) => Number.isInteger(n));
      if (occasions.length > 0) unit.occasionIds = occasions;
      unit.editions = (data.editions ?? [])
        .filter((ed) => KNOWN_SOURCES.has(ed.source))
        .map((ed) => {
          const edition: Edition = { source: ed.source as SourceId, sourceId: ed.sourceId, kind: ed.kind, licence: ed.licence };
          if (ed.role) edition.role = ed.role;
          if (ed.label) edition.label = ed.label;
          if (ed.language === 'he' || ed.language === 'en' || ed.language === 'yi') edition.language = ed.language;
          if (ed.version) edition.version = ed.version;
          if (ed.credit) edition.credit = ed.credit;
          return edition;
        });
      return unit;
    });
    const source = (work.sourceCopies?.find((s) => KNOWN_SOURCES.has(s.source))?.source ?? 'mafteiach') as SourceId;
    imported.push({ workId: work.slug, source, contents: contentsOf(list), units: outUnits });
  }
  return { format: 'rebbehub-sichos-kodesh-works', formatVersion: 1, tag: meta.tag, commit: meta.commit, authors: [...authors.values()].map((a) => a.author), works: outWorks, imported };
}

/** A work's table of contents from its units' positions: every level but the last is a node. */
function contentsOf(units: Array<{ id: EntityId; data: UnitData }>): ContentsEntry[] {
  const root: ContentsNode = { title: { he: '', en: '' }, entries: [] };
  for (const { id, data } of units) {
    let node = root;
    for (const step of data.position.slice(0, -1)) {
      const title = names(step.label ?? { he: step.value });
      let child = node.entries.find((e): e is ContentsNode => 'entries' in e && e.title.he === title.he);
      if (!child) {
        child = { title, entries: [] };
        node.entries.push(child);
      }
      node = child;
    }
    node.entries.push({ unitId: data.externalIds?.['sichos-kodesh-unit'] ?? id });
  }
  return root.entries;
}
