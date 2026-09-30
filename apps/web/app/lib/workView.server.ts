import type { LocalName } from '@rebbehub/model';
import type { Entity, RebbeHubApi } from './api.js';
import { dateLabel } from './dates.js';
import { nameOf, type Lang } from './i18n.js';
import { labelOf } from './labels.js';
import { itemPath } from './links.js';
import { ofVolume, type Part } from './volumes.js';

/**
 * A sefer's contents as its page shows them (the plan's "every sicha, its
 * page in each printing, its recording and its translation"): each sicha
 * with the Shabbos it was said, how many sections its text has, the page
 * it starts on in the chosen printing, and whether there is a scan of it,
 * a recording of the farbrengen, and an English translation; grouped by
 * the level above it (a chumash), with the pages each group spans. And the
 * numbers for the head of the page: pages, printings, sichos with a
 * recording, and how much of the text a person has checked.
 */

export interface TocRow {
  id: string;
  path: string;
  title: string;
  /** "שבת פרשת נח תשט״ז" */
  sub: string | null;
  page: number | null;
  sections: number | null;
  scan: boolean;
  audio: boolean;
  translation: boolean;
}

export interface TocGroup {
  label: string | null;
  from: number | null;
  to: number | null;
  rows: TocRow[];
}

export interface WorkToc {
  groups: TocGroup[];
  /** The printing whose page numbers are shown, and the others that have them. */
  printing: { id: string; label: string } | null;
  printings: Array<{ id: string; label: string }>;
  stats: { pages: number | null; printings: number; withAudio: number; checked: number | null; sichos: number };
  /** Where "Read" goes: a served scan of the printing, else the first sicha with words. */
  read: { scanFile: string | null; scanUrl: string | null; unit: string | null };
}

/** Marks are worked out for a volume's sichos, not a whole shelf at once. */
const MAX_ROWS = 150;

type D = Record<string, unknown>;

const printingLabel = (p: Entity, lang: Lang) => {
  const d = p.data as { publisher?: string; date?: string; gregorianYear?: number; printing?: number };
  return [d.publisher, d.date ? dateLabel(d.date, lang, { civil: false }) : d.gregorianYear ? String(d.gregorianYear) : null].filter(Boolean).join(', ');
};

export async function workToc(api: RebbeHubApi, units: Entity[], publications: Entity[], scanCounts: Record<string, number>, options: { part: Part | null; printing: string | null; lang: Lang }): Promise<WorkToc> {
  const { lang, part } = options;
  const rowsOf = units.slice(0, MAX_ROWS);
  // This volume's printings (all of them for a sefer of one volume).
  const ofPart = publications.filter((p) => ofVolume((p.data as D).volume, part));

  // Where each sicha is in each printing: the printings' contents maps, all in one request.
  const mapsOf = await api.linkedOfEach(ofPart.map((p) => p.id), { field: 'publication', type: 'contents-map', limit: 500 }).catch(() => new Map<string, Entity[]>());
  const maps = ofPart.map((p) => ({ printing: p, maps: mapsOf.get(p.id) ?? [] }));
  const withMaps = maps.filter((m) => m.maps.length);
  const chosen = withMaps.find((m) => m.printing.id === options.printing) ?? withMaps[0] ?? null;
  const pageOf = new Map<string, { from: number; to: number }>();
  for (const m of chosen?.maps ?? []) {
    const d = m.data as { unit?: string; pages?: { from: number; to: number } };
    if (d.unit && d.pages) pageOf.set(d.unit, d.pages);
  }
  const scanned = new Set<string>();
  for (const m of maps) if (scanCounts[m.printing.id]) for (const x of m.maps) scanned.add(String((x.data as D).unit ?? ''));

  // Each sicha's texts (its words and its translations), all the rows' in one request; then how far each edition is
  // checked, in one more. A volume of a hundred and fifty sichos used to ask once per sicha, and once more per edition.
  const textsOf = await api.linkedOfEach(rowsOf.map((u) => u.id), { field: 'unit', type: 'text', limit: 20 }).catch(() => new Map<string, Entity[]>());
  const editionOf = new Map<string, Entity>();
  const translated = new Set<string>();
  for (const u of rowsOf) {
    for (const t of textsOf.get(u.id) ?? []) {
      const kind = (t.data as D).kind;
      if (kind === 'translation') translated.add(u.id);
      else if (kind === 'edition' && !editionOf.has(u.id)) editionOf.set(u.id, t);
    }
  }
  const progress = await api.textsProgress([...editionOf.values()].map((t) => t.id)).catch(() => new Map<string, { paragraphs: number; checked: number }>());
  const progressOf = (u: Entity) => (editionOf.has(u.id) ? progress.get(editionOf.get(u.id)!.id) : undefined);
  let total = 0;
  let checked = 0;
  for (const u of rowsOf) {
    const p = progressOf(u);
    total += p?.paragraphs ?? 0;
    checked += p?.checked ?? 0;
  }

  // The farbrengen each was said at, and whether it has a recording.
  const eventIds = [...new Set(rowsOf.flatMap((u) => ((u.data as D).events as string[] | undefined) ?? []))];
  const events = await api.entities(eventIds).catch(() => new Map<string, Entity>());
  const dates = [...new Set([...events.values()].map((e) => String((e.data as D).date ?? '')).filter(Boolean))];
  const recorded = new Map<string, number>();
  for (let i = 0; i < dates.length; i += 100) {
    const found = await api.events({ dates: dates.slice(i, i + 100), limit: 2000, brief: true }).catch(() => []);
    for (const e of found) recorded.set(e.id, e.recordings);
  }

  const rows: Array<TocRow & { group: string | null }> = rowsOf.map((u) => {
    const d = u.data as { events?: string[]; date?: string; position?: Array<{ level: string; value: string; label?: LocalName }>; editions?: Array<{ kind: string }> };
    const event = d.events?.map((id) => events.get(id)).find(Boolean);
    const steps = d.position ?? [];
    const middle = steps.length >= 3 ? steps[steps.length - 2] : steps.length === 2 && !part ? steps[0] : undefined;
    return {
      id: u.id,
      path: itemPath(u),
      title: labelOf(u, lang),
      sub: event ? nameOf((event.data as { title?: LocalName }).title, lang) : d.date ? dateLabel(d.date, lang, { civil: false }) : null,
      page: pageOf.get(u.id)?.from ?? null,
      sections: progressOf(u)?.paragraphs || null,
      scan: scanned.has(u.id) || Boolean(d.editions?.some((e) => e.kind === 'scan' || e.kind === 'pdf')),
      audio: Boolean(d.events?.some((id) => (recorded.get(id) ?? 0) > 0)),
      translation: translated.has(u.id),
      group: middle ? nameOf(middle.label, lang) || middle.value : null,
    };
  });

  const groups: TocGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const { group, ...rest } = row;
    if (last && last.label === group) last.rows.push(rest);
    else groups.push({ label: group, from: null, to: null, rows: [rest] });
  }
  for (const g of groups) {
    const pages = g.rows.map((r) => pageOf.get(r.id)).filter((p): p is { from: number; to: number } => Boolean(p));
    if (pages.length) {
      g.from = Math.min(...pages.map((p) => p.from));
      g.to = Math.max(...pages.map((p) => p.to));
    }
  }

  const scanFile = chosen && scanCounts[chosen.printing.id] ? await firstScanFile(api, chosen.printing.id) : null;
  const scanUrl = scanFile ? ((await api.file(scanFile).catch(() => null))?.url ?? null) : null;
  const pageCount = chosen ? Number((chosen.printing.data as D).pageCount ?? 0) || null : ofPart.map((p) => Number((p.data as D).pageCount ?? 0)).find(Boolean) ?? null;
  return {
    groups,
    printing: chosen ? { id: chosen.printing.id, label: printingLabel(chosen.printing, lang) } : null,
    printings: withMaps.map((m) => ({ id: m.printing.id, label: printingLabel(m.printing, lang) })),
    stats: { pages: pageCount, printings: ofPart.length, withAudio: rows.filter((r) => r.audio).length, checked: total ? Math.round((checked / total) * 100) : null, sichos: units.length },
    read: { scanFile, scanUrl, unit: rows.find((r) => r.sections)?.path ?? rows[0]?.path ?? null },
  };
}

async function firstScanFile(api: RebbeHubApi, printing: string): Promise<string | null> {
  const links = await api.backlinks(printing, { field: 'publication', type: 'scan' }).catch(() => []);
  const scans = await api.entities(links.map((l) => l.from)).catch(() => new Map<string, Entity>());
  const scan = [...scans.values()].sort((a, b) => Number(Boolean((b.data as D).preferred)) - Number(Boolean((a.data as D).preferred)))[0];
  return scan ? String((scan.data as D).file ?? '') || null : null;
}
