import { dateKeyFromGregorian } from '@rebbehub/hebrew';
import { isPageText, type EntityId, type PageInline, type PageSegment, type PageText } from '@rebbehub/model';
import type { Catalog, EntityView } from './catalog.js';
import { dayOfLabel, monthOfLabel } from './hayomYom.js';
import { TANYA_YOMI } from './tanyaYomi.js';

/**
 * The daily learning (Chitas' Tanya, and Hayom Yom) for a civil day, from
 * the catalog's own Tanya and Hayom Yom:
 *
 * - Tanya: the day's portion by the yearly cycle that begins on 19 Kislev,
 *   as Sefaria's Tanya Yomi gives it (tanyaYomi.ts): each day starts at a
 *   segment of a chapter and runs up to where the next day starts, so a
 *   portion is the one or two chapters it touches, cut to that range.
 * - Hayom Yom: the day's entry, found by its date in the sefer. It was
 *   written for 5703, a leap year: in a plain year Adar has both Adars'
 *   entries, and a 30th it has none for (Cheshvan, Kislev, Adar II) reads
 *   the 29th's.
 *
 * The day is the civil day it is learned on (Tanya of 19 Kislev is learned
 * in the daytime of 19 Kislev), so a page asks by `YYYY-MM-DD`.
 */

export interface DailyTanyaPart extends EntityView {
  /** The first segment of the day's portion in this chapter, and the first after it (null to its end). */
  from: string;
  to: string | null;
}

export interface DailyLearning {
  date: string;
  /** The Hebrew day (a date key: `5787-01-19`). */
  hebrew: string;
  tanya: DailyTanyaPart[];
  hayomYom: EntityView[];
}

/** Where the catalog keeps them: their readable paths. */
export const DAILY_WORKS = { tanya: '/tanya', hayomYom: '/hayom-yom' } as const;

const dayAfter = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.toISOString().slice(0, 10);
};

/** Where a day's Tanya starts: the unit (by its Sefaria reference) and the segment. */
export function tanyaStart(key: string): { unit: string; segment: string } | null {
  const table = isLeap(Number(key.slice(0, 4))) ? TANYA_YOMI.leap : TANYA_YOMI.common;
  const start = table[key.slice(5)];
  return start ? { unit: `Tanya, ${start[0]}`, segment: start[1] } : null;
}

/** The Hebrew years with a second Adar: 3, 6, 8, 11, 14, 17 and 19 of each nineteen. */
const isLeap = (year: number) => (7 * year + 1) % 19 < 7;

const PART_OF: Record<string, string> = { 'Part I': '1', 'Part II': '2', 'Part III': '3', 'Part IV': '4', 'Part V': '5' };
/** The volume (top part) of Tanya a Sefaria reference is in: `Tanya, Part IV; Iggeret HaKodesh 22` is 4. */
const tanyaPart = (ref: string) => PART_OF[/^Tanya, (Part [IV]+);/.exec(ref)?.[1] ?? ''] ?? null;

const sourceIdOf = (unit: EntityView): string | undefined => ((unit.data as { editions?: Array<{ source?: string; sourceId?: string }> }).editions ?? []).find((e) => e.source === 'sefaria')?.sourceId;

/** The segments of a version from one segment up to (not with) another: Sefaria numbers them 1, 2, 3 in both languages. */
function cut(body: PageText, from: string | null, to: string | null): PageText {
  const position = (id: string) => (/^\d+$/.test(id) ? Number(id) : NaN);
  const lo = from === null ? -Infinity : position(from);
  const hi = to === null ? Infinity : position(to);
  return {
    ...body,
    versions: body.versions.map((v) => {
      const segments = v.segments.filter((s) => {
        const n = position(s.id);
        return Number.isNaN(n) || (n >= lo && n < hi);
      });
      const used = new Set<string>();
      const walk = (list: readonly PageSegment[]) => {
        for (const s of list) {
          for (const run of s.text ?? []) if ('note' in (run as PageInline)) used.add((run as { note: string }).note);
          walk(s.children ?? []);
        }
      };
      walk(segments);
      return { ...v, segments, ...(v.notes ? { notes: v.notes.filter((n) => used.has(n.id)) } : {}) };
    }),
  };
}

export async function dailyLearning(catalog: Catalog, date: string): Promise<DailyLearning | null> {
  const hebrew = dateKeyFromGregorian(date);
  if (!hebrew) return null;
  const [tanyaWork, hayomYomWork] = await Promise.all([catalog.resolvePath(DAILY_WORKS.tanya), catalog.resolvePath(DAILY_WORKS.hayomYom)]);

  // Tanya: the chapters from where today starts to where tomorrow does.
  const start = tanyaStart(hebrew);
  const next = tanyaStart(dateKeyFromGregorian(dayAfter(date))!);
  let tanyaRange: Array<{ unit: EntityView; from: string | null; to: string | null }> = [];
  if (tanyaWork && start) {
    const parts = [...new Set([tanyaPart(start.unit), next ? tanyaPart(next.unit) : null].filter((p): p is string => p !== null))];
    const units = (await Promise.all(parts.map((p) => catalog.workPart(tanyaWork.id, p)))).flat();
    const first = units.findIndex((u) => sourceIdOf(u) === start.unit);
    if (first >= 0) {
      const endAt = next ? units.findIndex((u, i) => i >= first && sourceIdOf(u) === next.unit) : -1;
      // Tomorrow starting at a chapter's first segment ends today with the chapter before; else in that chapter.
      const last = endAt < 0 ? first : next!.segment === '1' && endAt > first ? endAt - 1 : endAt;
      tanyaRange = units.slice(first, Math.max(first, last) + 1).slice(0, 4).map((unit, i, all) => ({
        unit,
        from: i === 0 ? start.segment : null,
        to: i === all.length - 1 && endAt === first + i ? next!.segment : null,
      }));
    }
  }

  // Hayom Yom: the day's entry (both Adars' in a plain year's Adar), or the 29th's on a 30th it has none for.
  const hayomYomIds: EntityId[] = [];
  if (hayomYomWork) {
    const month = hebrew.slice(5, hebrew.lastIndexOf('-'));
    const day = Number(hebrew.slice(hebrew.lastIndexOf('-') + 1));
    const months = month === '06' ? ['06A', '06B'] : [month];
    // Its sections are its months, Kislev twice (it starts on 19 Kislev and ends on 18 Kislev).
    const sections = (await catalog.workOutline(hayomYomWork.id)).map((p) => ({ part: p.value, month: monthOfLabel(p.label) })).filter((p) => p.month && months.includes(p.month));
    const units = await Promise.all(sections.map((s) => catalog.workPart(hayomYomWork.id, s.part)));
    for (const m of months) {
      const inMonth = units.filter((_, i) => sections[i]!.month === m).flat();
      const found = inMonth.find((u) => dayOfLabel(u.data) === day) ?? (day === 30 ? inMonth.find((u) => dayOfLabel(u.data) === 29) : undefined);
      if (found) hayomYomIds.push(found.id);
    }
  }

  // Their words, all in one read.
  const whole = new Map((await catalog.getMany([...tanyaRange.map((r) => r.unit.id), ...hayomYomIds])).map((v) => [v.id, v]));
  const tanya: DailyTanyaPart[] = [];
  for (const r of tanyaRange) {
    const unit = whole.get(r.unit.id);
    if (!unit) continue;
    const body = (unit.data as { body?: unknown }).body;
    const data = isPageText(body) ? { ...(unit.data as object), body: cut(body, r.from, r.to) } : unit.data;
    tanya.push({ ...unit, data: data as EntityView['data'], from: r.from ?? '1', to: r.to });
  }
  return { date, hebrew, tanya, hayomYom: hayomYomIds.map((id) => whole.get(id)).filter((v): v is EntityView => v !== undefined) };
}
