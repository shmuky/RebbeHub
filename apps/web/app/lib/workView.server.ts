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
  /** Some of its words a machine made and nobody checked yet: the list's quiet dot. */
  machine: boolean;
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
  /** Every printing of this volume, for "how to read it" (the volume's sheet). */
  editions: Array<{ id: string; path: string; title: string; label: string }>;
  stats: { pages: number | null; printings: number; withAudio: number; checked: number | null; sichos: number };
  /** Where "Read" goes: a served scan of the printing, else the first sicha with words. */
  read: { scanFile: string | null; scanUrl: string | null; unit: string | null };
}

/** A printing told apart from the others of its volume: who printed it and when, where, how many pages, and where it came from. */
const editionLabel = (p: Entity, lang: Lang) => {
  const d = p.data as { placePrinted?: string; pageCount?: number; sources?: Array<{ source: string; sourceId?: string; note?: string }> };
  const from = d.sources?.[0];
  const source = !from ? null : from.source === 'hebrewbooks' ? `HebrewBooks ${from.sourceId ?? ''}`.trim() : from.source === 'other' ? (from.note ?? null) : from.source;
  return [printingLabel(p, lang) || d.placePrinted, d.pageCount ? `${d.pageCount} ${lang === 'he' ? 'עמ׳' : 'pp.'}` : null, source].filter(Boolean).join(' · ');
};

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
  const progress = await api.textsProgress([...editionOf.values()].map((t) => t.id)).catch(() => new Map<string, { paragraphs: number; checked: number; machine?: number }>());
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
      machine: (progressOf(u)?.machine ?? 0) > 0,
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
    editions: ofPart.map((p) => ({ id: p.id, path: itemPath(p), title: nameOf((p.data as { title?: LocalName }).title, lang), label: editionLabel(p, lang) })),
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

/** One line of the column beside a sicha: a sicha in its volume, under its parsha's name where the volume has them. */
export interface VolumeLine {
  group: string | null;
  label: string;
  path: string;
  current: boolean;
}

/**
 * The column beside a sicha on a wide screen (design/ 3l): the rest of its
 * volume, under the names of the levels between (a parsha, Tanya's הסכמות).
 * Where a sicha is kept in pieces numbered 1, 2, 3 (Likkutei Sichos 30 keeps
 * each section as its own page) the column lists the sichos, each going to
 * its first piece. A name that repeats its volume's (חלק ראשון; ליקוטי
 * אמרים, פרק א׳) is shortened to its own last part (פרק א׳).
 */
export function volumeLines(units: readonly Entity[], me: Entity, lang: Lang): VolumeLine[] {
  type Step = { value: string; label?: LocalName };
  const stepsOf = (u: Entity) => ((u.data as { position?: Step[] }).position ?? []) as Step[];
  const name = (s: Step | undefined) => (s ? nameOf(s.label, lang) || s.value : '');
  const pieces = (u: Entity, steps: Step[]) => steps.length >= 3 && /^\d+$/.test(labelOf(u, lang));
  const keyOf = (steps: Step[]) => steps.slice(1, -1).map((s) => s.value).join('/');
  const mine = stepsOf(me);
  const myKey = pieces(me, mine) ? keyOf(mine) : null;
  const seen = new Set<string>();
  const out: VolumeLine[] = [];
  for (const u of units) {
    const steps = stepsOf(u);
    if (pieces(u, steps)) {
      const key = keyOf(steps);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ group: steps.length > 3 ? name(steps[1]) : null, label: name(steps[steps.length - 2]), path: itemPath(u), current: key === myKey });
      continue;
    }
    const label = labelOf(u, lang);
    const volume = name(steps[0]);
    const short = volume && label.startsWith(volume) && label.includes(', ') ? label.slice(label.lastIndexOf(', ') + 2) : label;
    out.push({ group: steps.length > 2 ? name(steps[steps.length - 2]) : null, label: short, path: itemPath(u), current: u.id === me.id });
  }
  return out;
}
