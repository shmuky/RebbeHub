import { HDate } from '@hebcal/core';
import { DAILY_WORKS, TANYA_YOMI, chitasChumash, dailyTehillim, dateKeyFromGregorian, dayOfLabel, monthOfLabel } from '@rebbehub/hebrew';
import { isPageText, slugify, type EntityId, type PageInline, type PageSegment, type PageText } from '@rebbehub/model';
import type { Catalog, EntityView } from './catalog.js';
import { dailyRambam, type DailyRambam } from './rambam.js';

/**
 * The daily learning for a civil day: Chitas (Chumash with Rashi, Tehillim
 * and Tanya), Hayom Yom, and the Rambam's three tracks. Tanya and Hayom
 * Yom come with their words, from the catalog's own:
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
 * Chumash (the week's parsha, an aliyah a day), Tehillim (the monthly
 * cycle) and the Rambam come as what to learn, named in Hebrew and by
 * Sefaria's references (chitas.ts, rambam.ts).
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
  /** The day's Chumash with Rashi: `בא, ראשון עם פירש״י` and `Exodus 10:1-11`; where it starts on RebbeHub, and its Rashi, once the catalog has them. */
  chumash: { label: string; ref: string; path: string | null; rashi: string | null } | null;
  /** The day's Tehillim, each range with its reference, and its first chapter on RebbeHub once the catalog has it. */
  tehillim: Array<{ text: string; ref: string | null; path: string | null }>;
  /** The Rambam's three tracks; each chapter's page on RebbeHub (`paths`, in order) once the catalog has it. */
  rambam: { three: DailyShiur; one: DailyShiur; mitzvos: DailyShiur | null };
}

export type DailyShiur = DailyRambam['three'] & { paths: Array<string | null> };

/**
 * Where a Sefaria reference is on RebbeHub, by the paths the Sefaria
 * importer gives Chitas and the Rambam (importers' sefaria.ts, the daily
 * books): `Exodus 10:1-11` is `/chumash/exodus/10#s-1`, `Psalms 119:97-176`
 * `/tehillim/119#s-97`, `Mishneh Torah, Divorce 9` `/rambam/divorce/9`.
 * The work's path and the page's; null for one it does not place.
 */
export function dailyPathOf(ref: string, options: { rashi?: boolean } = {}): { work: string; page: string } | null {
  const m = /^(.*) (\d+)(?::(\d+))?(?:-[\d:]+)?$/.exec(ref);
  if (!m) return null;
  const [, book, chapter, verse] = m;
  const at = verse && verse !== '1' ? `#s-${verse}` : '';
  const TORAH = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];
  let work: string | null = null;
  if (TORAH.includes(book!)) work = `/chumash/${options.rashi ? 'rashi-' : ''}${slugify(book!)}`;
  else if (book === 'Psalms') work = '/tehillim';
  else if (book!.startsWith('Mishneh Torah, ')) work = `/rambam/${slugify(book!.slice('Mishneh Torah, '.length))}`;
  // Rashi's comments are a section for each verse: go to the verse's.
  const anchor = options.rashi && verse ? `#s-${verse}` : at;
  return work ? { work, page: `${work}/${chapter}${anchor}` } : null;
}

export { DAILY_WORKS };

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
  // Chumash and Tehillim by the Hebrew day; the Rambam by its own cycles.
  const [y, m, d] = date.split('-').map(Number);
  const day = new HDate(new Date(y!, m! - 1, d!));
  const chumash = chitasChumash(day);
  const tehillim = dailyTehillim(hebrew.slice(5, hebrew.lastIndexOf('-')), day.getDate(), HDate.daysInMonth(day.getMonth(), day.getFullYear()));
  const rambam = dailyRambam(date);
  // Their pages on RebbeHub, the ones the catalog has (one read for all).
  const places = (ref: string | null, rashi = false) => (ref ? dailyPathOf(ref, { rashi }) : null);
  const bare = (page: string) => page.replace(/#.*$/, '');
  const wanted = [places(chumash?.ref ?? null), places(chumash?.ref ?? null, true), ...tehillim.map((t) => places(t.ref)), ...[...rambam.three.refs, ...rambam.one.refs].map((r) => places(r))];
  const have = await catalog.livePaths(wanted.filter((p) => p !== null).map((p) => bare(p.page)));
  const page = (ref: string | null, rashi = false) => {
    const found = places(ref, rashi);
    return found && have.has(bare(found.page)) ? found.page : null;
  };
  const tracks = (s: DailyRambam['three']): DailyShiur => ({ ...s, paths: s.refs.map((r) => page(r)) });
  return {
    date,
    hebrew,
    tanya,
    hayomYom: hayomYomIds.map((id) => whole.get(id)).filter((v): v is EntityView => v !== undefined),
    chumash: chumash ? { label: chumash.label, ref: chumash.ref, path: page(chumash.ref), rashi: page(chumash.ref, true) } : null,
    tehillim: tehillim.map((t) => ({ ...t, path: page(t.ref) })),
    rambam: { three: tracks(rambam.three), one: tracks(rambam.one), mitzvos: rambam.mitzvos ? { ...rambam.mitzvos, paths: rambam.mitzvos.refs.map(() => null) } : null },
  };
}

// ---------------------------------------------------------------- the shiurim's words

/** A stretch of one page: its verses (or paragraphs) `from` to `to`, both learned; null for the page's start or end. */
export interface ShiurSpan {
  page: string;
  from: number | null;
  to: number | null;
  /** Rashi's comments on those verses, not the verses. */
  rashi?: boolean;
}

/** Sefer HaMitzvot's parts on RebbeHub, by how the Sefaria importer numbers them. */
const MITZVOS: Record<string, string> = { Shorashim: '/sefer-hamitzvos/2', 'Positive Commandments': '/sefer-hamitzvos/4', 'Negative Commandments': '/sefer-hamitzvos/6' };

/**
 * The pages and verses a Sefaria reference learns on RebbeHub: `Genesis
 * 1:1-2:3` is chapter 1 from its first verse and chapter 2 up to verse 3,
 * `Psalms 104-105` two whole chapters, `Mishneh Torah, Divorce 11` a whole
 * chapter, `Sefer HaMitzvot, Positive Commandments 109` one mitzvah. With
 * `rashi`, the Chumash's Rashi on the same verses. Empty for a reference it
 * does not place.
 */
export function spansOf(ref: string, options: { rashi?: boolean } = {}): ShiurSpan[] {
  const m = /^(.*) (\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(ref.trim());
  if (!m) return [];
  const [, book, c1s, v1s, xs, v2s] = m;
  const mitzvos = /^Sefer HaMitzvot, (.*)$/.exec(book!);
  if (mitzvos) {
    const part = MITZVOS[mitzvos[1]!];
    if (!part || v1s) return [];
    const [a, b] = [Number(c1s), Number(xs ?? c1s)];
    return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => ({ page: `${part}/${a + i}`, from: null, to: null }));
  }
  const work = dailyPathOf(`${book} 1`, options)?.work;
  if (!work) return [];
  const c1 = Number(c1s);
  const rashi = options.rashi ? { rashi: true } : {};
  const span = (chapter: number, from: number | null, to: number | null): ShiurSpan => ({ page: `${work}/${chapter}`, from, to, ...rashi });
  // `1:1-2:3`: across chapters; `1:3-9` or `1:3` within one; `104-105` or `11`: whole chapters.
  if (v1s && v2s) {
    const c2 = Number(xs);
    return Array.from({ length: Math.max(0, c2 - c1 + 1) }, (_, i) => span(c1 + i, i === 0 ? Number(v1s) : null, c1 + i === c2 ? Number(v2s) : null));
  }
  if (v1s) return [span(c1, Number(v1s), Number(xs ?? v1s))];
  const c2 = Number(xs ?? c1s);
  return Array.from({ length: Math.max(0, c2 - c1 + 1) }, (_, i) => span(c1 + i, null, null));
}

/** A piece of a shiur: a page cut to the stretch learned (`from`, and `to` the first segment after it, null to its end), in its Hebrew only. */
export type ShiurPart = EntityView & { from: string; to: string | null; rashi?: boolean };

export interface ShiurSection {
  /** `chumash`, `tehillim`, `tanya`, `three`, `one`, `mitzvos`; `passage` for one asked by reference. */
  key: string;
  /** What it is, as the day's list names it: `וזאת הברכה, ששי עם פירש״י`. */
  label: string;
  parts: ShiurPart[];
}

/** A page's Hebrew alone, when it has Hebrew: the shiurim are learned in it, and the whole page has the rest. */
const hebrewOnly = (body: PageText): PageText => {
  const he = body.versions.filter((v) => v.language === 'he');
  return he.length ? { ...body, versions: he } : body;
};

/**
 * The words of shiurim given by their Sefaria references, each page cut
 * to the stretch learned, all the pages in one read: the Chumash by
 * aliyah (with Rashi on the same verses), Tehillim, the Rambam and Sefer
 * HaMitzvos. A reference the catalog has no page for is left out.
 */
export async function shiurimWords(catalog: Catalog, wanted: Array<{ key: string; label: string; refs: string[]; rashi?: boolean }>): Promise<ShiurSection[]> {
  const plans = wanted.map((w) => ({ ...w, spans: [...w.refs.flatMap((r) => spansOf(r)), ...(w.rashi ? w.refs.flatMap((r) => spansOf(r, { rashi: true })) : [])] }));
  const pages = await catalog.getByPaths(plans.flatMap((p) => p.spans.map((s) => s.page)));
  const byPath = new Map(pages.map((v) => [v.path?.toLowerCase(), v]));
  return plans.map((plan) => ({
    key: plan.key,
    label: plan.label,
    parts: plan.spans.flatMap((s): ShiurPart[] => {
      const unit = byPath.get(s.page.toLowerCase());
      if (!unit) return [];
      const body = (unit.data as { body?: unknown }).body;
      const from = s.from === null ? null : String(s.from);
      const to = s.to === null ? null : String(s.to + 1);
      const data = isPageText(body) ? { ...(unit.data as object), body: hebrewOnly(cut(body, from, to)) } : unit.data;
      return [{ ...unit, data: data as EntityView['data'], from: from ?? '1', to, ...(s.rashi ? { rashi: true } : {}) }];
    }),
  }));
}

/**
 * The day's shiurim with their words, for the shiurim page: Chumash with
 * Rashi (the day's aliyah), Tehillim, Tanya (the day's portion), and the
 * Rambam's three tracks, in that order; each section's pieces cut to what
 * is learned. Hayom Yom is on the daily page.
 */
export async function dailyShiurim(catalog: Catalog, date: string): Promise<{ date: string; hebrew: string; sections: ShiurSection[] } | null> {
  const day = await dailyLearning(catalog, date);
  if (!day) return null;
  const wanted: Array<{ key: string; label: string; refs: string[]; rashi?: boolean }> = [];
  if (day.chumash) wanted.push({ key: 'chumash', label: day.chumash.label, refs: [day.chumash.ref], rashi: true });
  if (day.tehillim.length) wanted.push({ key: 'tehillim', label: day.tehillim.map((t) => t.text.replace(/\.$/, '')).join(' '), refs: day.tehillim.map((t) => t.ref).filter((r): r is string => r !== null) });
  const rambam = (['three', 'one', 'mitzvos'] as const).flatMap((key) => {
    const s = day.rambam[key];
    return s ? [{ key, label: s.label, refs: s.refs }] : [];
  });
  const words = await shiurimWords(catalog, [...wanted, ...rambam]);
  const tanya: ShiurSection = {
    key: 'tanya',
    label: day.tanya.map((p) => (p.data as { label?: { he?: string } }).label?.he ?? '').filter(Boolean).join(' – '),
    parts: day.tanya.map((p) => {
      const body = (p.data as { body?: unknown }).body;
      return isPageText(body) ? { ...p, data: { ...(p.data as object), body: hebrewOnly(body) } as unknown as EntityView['data'] } : p;
    }),
  };
  const sections = [...words.filter((s) => s.key === 'chumash' || s.key === 'tehillim'), ...(day.tanya.length ? [tanya] : []), ...words.filter((s) => s.key !== 'chumash' && s.key !== 'tehillim')];
  return { date: day.date, hebrew: day.hebrew, sections };
}
