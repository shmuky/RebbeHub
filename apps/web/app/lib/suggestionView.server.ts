import type { LocalName } from '@rebbehub/model';
import { foldChanges, foldedName, infoChanges, moreChanges, onlyInfo, valueText } from '../components/ChangeTable.js';
import type { Entity, RebbeHubApi, SuggestionDetail } from './api.js';
import { nameOf, typeName, type Lang } from './i18n.js';
import { labelOf } from './labels.js';
import { itemPath } from './links.js';
import { detailLabels } from './suggestions.js';
import { describeTargets, sectionLetter } from './targets.server.js';

/**
 * A suggestion as its page shows it before anyone signs in (the plan's
 * "a Suggestion is a pull request"): where it is (the sefer, the volume,
 * the sicha), each change as a reader reads it (a paragraph's words
 * marked word by word between the paragraphs around it; a field's value
 * before and after), each changed paragraph against the printed page it
 * was read from (the printing, the page, the scan's line when the scan
 * was read by a machine, and whether the new words are what the scan
 * shows), and the checks: what the API checked, whether the scan agrees,
 * and whether a keeper has approved it yet. The conversation itself is
 * the browser's to load, since who may approve is personal.
 */

export interface ScanContext {
  /** "ליקוטי שיחות, חלק א · קה״ת תשכ״ב" */
  printing: string;
  page: number | null;
  pages: { from: number; to: number } | null;
  /** The scan's own page, to open it. */
  scanPath: string | null;
  /** The page's picture, where the jobs have drawn one. */
  image: string | null;
  /** The page's lines as the machine read them (OCR), when it has. */
  lines: string[] | null;
  /** The words the suggestion puts in, each found in the scan's lines or not. */
  words: Array<{ word: string; found: boolean }>;
  verdict: 'matches' | 'differs' | 'unread';
}

export interface EntryView {
  entityId: string;
  type: string;
  typeLabel: string;
  label: string;
  path: string;
  within: string | null;
  isNew: boolean;
  removed: boolean;
  /** A paragraph's words, with the paragraphs before and after it. */
  segment: { n: string; before: string; after: string; prev: { n: string; content: string } | null; next: { n: string; content: string } | null } | null;
  /** Its fields that changed, alike ones folded into one row (`count` of them), so a bot's thousands are a few rows. */
  fields: Array<{ path: string; name: string; before: string; after: string; count: number }>;
  scan: ScanContext | null;
  withheld: string | null;
}

export interface CheckLine {
  status: 'pass' | 'warn' | 'fail' | 'wait';
  message: string;
  machine?: boolean;
  note?: string;
}

export interface SuggestionView {
  id: number;
  number: number;
  title: string;
  description: string | null;
  author: string;
  /** Sent by an agent for its author (a token, a connected app). */
  via: SuggestionDetail['changeset']['via'] | null;
  status: SuggestionDetail['changeset']['status'];
  createdAt: string;
  submittedAt: string | null;
  crumbs: Array<{ label: string; to?: string }>;
  where: { label: string; path: string; within: string | null } | null;
  entries: EntryView[];
  checks: CheckLine[];
  approvals: number;
  /** What kind of change it is (text, source, date), from what it changes. */
  labels: string[];
  project: { slug: string; name: string; done: number; total: number } | null;
}

type D = Record<string, unknown>;

const W = {
  schemaOk: { he: 'השדות תקינים', en: 'Fields are well formed' },
  scanMatches: { he: 'הטקסט תואם לסריקה', en: 'The text matches the scan' },
  scanDiffers: { he: 'חלק מהמילים החדשות אינן בסריקה', en: 'Some of the new words are not in the scan' },
  scanUnread: { he: 'אין עדיין קריאת מכונה של הסריקה להשוואה', en: 'No machine reading of the scan to compare with yet' },
  keeper: { he: 'ממתינה לאישור של אחראי אוסף', en: 'Waiting for a keeper to approve' },
  keeperDone: { he: 'אושרה על ידי אחראי אוסף', en: 'Approved by a keeper' },
  inPrinting: { he: 'בדפוס', en: 'in the printing' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

/** Words as they are compared: letters only, no vowels, marks or punctuation. */
const bare = (s: string) => s.replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function newWords(before: string, after: string): string[] {
  const had = new Set(bare(before).split(' '));
  return [...new Set(bare(after).split(' ').filter((x) => x && !had.has(x)))];
}

const printingLabel = (p: Entity | undefined, lang: Lang) => {
  if (!p) return '';
  const d = p.data as { title?: LocalName; publisher?: string; date?: string; gregorianYear?: number };
  return [nameOf(d.title, lang) || labelOf(p, lang), [d.publisher, d.date ?? (d.gregorianYear ? String(d.gregorianYear) : null)].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
};

async function scanOf(api: RebbeHubApi, segment: D, before: string, after: string, lang: Lang): Promise<ScanContext | null> {
  const words = newWords(before, after);
  const at = segment.page as { scan?: string; page?: number; lines?: string[] } | undefined;
  if (at?.scan) {
    const scan = await api.entity(at.scan).catch(() => null);
    const publication = scan && typeof (scan.data as D).publication === 'string' ? await api.entity((scan.data as D).publication as string).catch(() => null) : null;
    const pages = scan ? await api.scanPages(scan.id).catch(() => null) : null;
    const lines = at.lines?.length ? at.lines : null;
    const read = lines ? bare(lines.join(' ')) : null;
    const found = words.map((word) => ({ word, found: read ? ` ${read} `.includes(` ${word} `) : false }));
    return {
      printing: printingLabel(publication ?? undefined, lang),
      page: at.page ?? null,
      pages: null,
      scanPath: scan ? `${itemPath(scan)}${at.page ? `?page=${at.page}` : ''}` : null,
      image: pages?.pages.find((p) => p.page === at.page)?.image ?? null,
      lines,
      words: found,
      verdict: !read ? 'unread' : found.every((f) => f.found) ? 'matches' : 'differs',
    };
  }
  // Else where its sicha is in a printing that has a scan: the pages it spans.
  const text = typeof segment.text === 'string' ? await api.entity(segment.text).catch(() => null) : null;
  const unit = text && typeof (text.data as D).unit === 'string' ? ((text.data as D).unit as string) : null;
  if (!unit) return null;
  const maps = await api.backlinks(unit, { field: 'unit', type: 'contents-map' }).catch(() => []);
  const mapItems = [...(await api.entities(maps.map((m) => m.from)).catch(() => new Map<string, Entity>())).values()];
  for (const m of mapItems) {
    const md = m.data as { publication?: string; pages?: { from: number; to: number } };
    if (!md.publication) continue;
    const scans = await api.backlinks(md.publication, { field: 'publication', type: 'scan' }).catch(() => []);
    if (!scans.length) continue;
    const publication = await api.entity(md.publication).catch(() => null);
    return {
      printing: printingLabel(publication ?? undefined, lang),
      page: null,
      pages: md.pages ?? null,
      scanPath: `/${scans[0]!.from}${md.pages ? `?page=${md.pages.from}` : ''}`,
      image: null,
      lines: null,
      words: words.map((word) => ({ word, found: false })),
      verdict: 'unread',
    };
  }
  return null;
}

export async function suggestionView(api: RebbeHubApi, detail: SuggestionDetail, lang: Lang): Promise<SuggestionView> {
  const cs = detail.changeset;
  const entries = detail.entries.slice(0, 40);
  const targets = await describeTargets(api, entries, lang).catch(() => new Map());

  const views: EntryView[] = [];
  // Items whose only change is their details are left out, unless that is all the suggestion is (a sync run).
  const anyReal = entries.some((e) => e.before === null || e.after === null || e.withheld || !onlyInfo(e.changes));
  for (const e of entries) {
    const target = targets.get(e.entityId);
    const data = (e.after ?? e.before ?? {}) as D;
    let segment: EntryView['segment'] = null;
    let scan: ScanContext | null = null;
    if (e.type === 'segment' && !e.withheld) {
      const before = String((e.before as D | null)?.content ?? '');
      const after = String((e.after as D | null)?.content ?? '');
      // The paragraphs around it, and its number in its text.
      let n = '';
      let prev: { n: string; content: string } | null = null;
      let next: { n: string; content: string } | null = null;
      if (typeof data.text === 'string') {
        const all = (await api.children(data.text, 'text', 'segment', { limit: 1000 }).catch(() => ({ items: [] as Entity[] }))).items.filter((s) => (s.data as D).kind !== 'heading');
        const i = all.findIndex((s) => s.id === e.entityId);
        if (i >= 0) {
          n = sectionLetter(i, lang);
          if (i > 0) prev = { n: sectionLetter(i - 1, lang), content: String((all[i - 1]!.data as D).content ?? '') };
          if (i < all.length - 1) next = { n: sectionLetter(i + 1, lang), content: String((all[i + 1]!.data as D).content ?? '') };
        }
      }
      segment = { n, before, after, prev, next };
      if (before !== after) scan = await scanOf(api, data, before, after, lang).catch(() => null);
    }
    // An item whose only change is its details (a paragraph re-timed because its words were fixed) is not a change to show.
    if (anyReal && e.before !== null && e.after !== null && !e.withheld && !(segment && segment.before !== segment.after) && onlyInfo(e.changes.filter((c) => !(segment && (c.path === '/content' || c.path === 'content'))))) continue;
    const folded = foldChanges(e.changes.filter((c) => !(segment && (c.path === '/content' || c.path === 'content'))));
    const fields = folded.rows.map((c) => ({ path: c.path, name: foldedName(c, lang), before: valueText(c.path, c.before, lang), after: valueText(c.path, c.after, lang), count: c.count }));
    if (folded.hidden) fields.push({ path: '/…', name: moreChanges(folded.hidden, lang), before: '', after: '', count: folded.hidden });
    // Timings and machine details are counted, not shown, and are not changes to count on the tab.
    if (folded.info) fields.push({ path: '/…info', name: infoChanges(folded.info, lang), before: '', after: '', count: 0 });
    views.push({
      entityId: e.entityId,
      type: e.type,
      typeLabel: typeName(e.type, lang),
      label: target?.label ?? detail.names[e.entityId] ?? e.entityId,
      path: target?.path ?? `/${e.entityId}`,
      within: target?.within ?? null,
      isNew: e.before === null,
      removed: e.after === null,
      segment,
      fields,
      scan,
      withheld: e.withheld ?? null,
    });
  }

  // Where it is: the sefer, the volume and the sicha of its first change.
  const first = entries[0];
  const crumbs: SuggestionView['crumbs'] = [];
  if (first) {
    const t = targets.get(first.entityId);
    const d = (first.after ?? first.before ?? {}) as D;
    const text = typeof d.text === 'string' ? await api.entity(d.text).catch(() => null) : null;
    const unitId = first.type === 'unit' ? first.entityId : text ? ((text.data as D).unit as string | undefined) : (d.unit as string | undefined);
    const unit = unitId ? await api.entity(unitId).catch(() => null) : null;
    const workId = unit ? ((unit.data as D).work as string | undefined) : (d.work as string | undefined);
    const work = workId ? await api.entity(workId).catch(() => null) : null;
    if (work) crumbs.push({ label: labelOf(work, lang), to: itemPath(work) });
    const volume = (unit?.data as { position?: Array<{ level: string; value: string; label?: LocalName }> } | undefined)?.position?.find((p) => p.level === 'volume');
    if (work && volume) crumbs.push({ label: nameOf(volume.label, lang) || volume.value, to: `${itemPath(work)}?part=${encodeURIComponent(volume.value)}` });
    if (unit) crumbs.push({ label: labelOf(unit, lang), to: itemPath(unit) });
    else if (t) crumbs.push({ label: t.label, to: t.path });
  }

  // The checks: the API's own, the scan's word, and the keepers'.
  const checks: CheckLine[] = [];
  // The API lists the checks that did not pass, of this page's items, and counts them all (an import of five hundred
  // items passes five hundred): how many passed, then each of this page's problems, then how many more the other pages have.
  const counts = cs.checkCounts ?? { pass: 0, warn: 0, fail: 0 };
  if (counts.pass) checks.push({ status: 'pass', message: lang === 'he' ? (counts.pass === 1 ? 'בדיקה אחת עברה' : `${counts.pass} בדיקות עברו`) : `${counts.pass} check${counts.pass === 1 ? '' : 's'} passed` });
  for (const c of cs.checks ?? [])
    checks.push({ status: c.status, message: c.check === 'schema' && c.status === 'pass' ? w(lang, 'schemaOk') : c.message });
  const elsewhere = counts.warn + counts.fail - (cs.checks ?? []).filter((c) => c.status !== 'pass').length;
  if (elsewhere > 0) checks.push({ status: counts.fail > (cs.checks ?? []).filter((c) => c.status === 'fail').length ? 'fail' : 'warn', message: lang === 'he' ? `ועוד ${elsewhere} בפריטים שבעמודים אחרים` : `and ${elsewhere} more on other pages of its items` });
  for (const v of views) {
    if (!v.scan) continue;
    const where = [v.scan.printing, v.scan.page ? `${lang === 'he' ? 'עמ׳' : 'p.'} ${v.scan.page}` : null].filter(Boolean).join(', ');
    checks.push({
      status: v.scan.verdict === 'matches' ? 'pass' : v.scan.verdict === 'differs' ? 'warn' : 'wait',
      message: `${w(lang, v.scan.verdict === 'matches' ? 'scanMatches' : v.scan.verdict === 'differs' ? 'scanDiffers' : 'scanUnread')}${where ? ` · ${where}` : ''}`,
      machine: v.scan.verdict !== 'unread',
    });
  }
  const approvals = detail.reviews.filter((r) => r.verdict === 'approve').length;
  if (cs.status === 'open' || cs.status === 'sent_back') checks.push({ status: approvals ? 'pass' : 'wait', message: w(lang, approvals ? 'keeperDone' : 'keeper'), note: `${approvals}/1` });

  const projectId = cs.project_id ?? null;
  const project = projectId ? (await api.projects().catch(() => ({ projects: [] }))).projects.find((p) => p.id === projectId) ?? null : null;

  const where = views[0] ? { label: views[0].label, path: views[0].path, within: views[0].within } : null;
  return {
    id: cs.id,
    number: cs.number ?? 0,
    title: cs.title,
    description: cs.description,
    author: cs.author,
    via: cs.via ?? null,
    status: cs.status,
    createdAt: cs.created_at,
    submittedAt: cs.submitted_at,
    crumbs,
    where,
    entries: views,
    checks,
    approvals,
    labels: detailLabels(detail),
    project: project ? { slug: project.slug, name: project.name, done: project.done, total: project.total } : null,
  };
}
