import { mayServe, type EntityId, type LocalName } from '@rebbehub/model';
import { getFile } from './files.js';
import type { Catalog } from './catalog.js';
import { invalid, notFound } from './errors.js';
import { ExportGate } from './gate.js';
import { scanText } from './text.js';
import { matchWords, words as wordsOf } from './words.js';

/**
 * Compare printings (the plan, section 9: "diff the texts of two
 * publishers' editions of the same unit"). Two texts of one unit, word by
 * word, compared the Hebrew way, so a difference in niqqud, a geresh or a
 * final letter typed plain is no difference, and what is left is what one
 * printing has that the other does not.
 *
 * A printing's text is either a text of the unit (an edition, a hanacha)
 * or, where a contents map says which pages of a publication hold the
 * unit, the community text of those pages of its scan.
 */

/** One run of the comparison: words both have, words only the first has, words only the second has. */
export interface DiffRun {
  op: 'same' | 'removed' | 'added';
  text: string;
}

/** Word-level differences between two texts: runs in reading order, a removed run before the added run that replaces it. */
export function diffWords(a: string, b: string): DiffRun[] {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  const matches = matchWords(
    wa.map((w) => w.key),
    wb.map((w) => w.key),
  );
  const runs: DiffRun[] = [];
  const push = (op: DiffRun['op'], text: string) => {
    const last = runs.at(-1);
    if (last?.op === op) last.text += ` ${text}`;
    else runs.push({ op, text });
  };
  let i = 0;
  let j = 0;
  for (const [mi, mj] of [...matches, [wa.length, wb.length] as [number, number]]) {
    while (i < mi) push('removed', wa[i++]!.text);
    while (j < mj) push('added', wb[j++]!.text);
    if (mi < wa.length) {
      // The same word; as the second printing spells it, which shows its niqqud or geresh.
      push('same', wb[mj]!.text);
      i++;
      j++;
    }
  }
  return runs;
}

/** Whether a scan's text may be shown: it follows the scan's file. */
async function scanServable(catalog: Catalog, scan: EntityId): Promise<boolean> {
  const entity = await catalog.get(scan);
  const file = entity?.type === 'scan' ? await getFile(catalog.db, String((entity.data as { file?: string }).file ?? '')) : null;
  return Boolean(file && mayServe(file.rights_state));
}

/** A printing of a unit whose text the catalog has. */
export interface Printing {
  /** `text:<id>`, or `scan:<id>:<from>-<to>` for pages of a scan. */
  key: string;
  label: LocalName;
  publication: EntityId | null;
  kind: 'text' | 'scan';
  /** Whether a person has checked all of it; machine text is labelled until then. */
  checked: boolean;
}

async function titleOf(catalog: Catalog, id: EntityId | undefined): Promise<LocalName | null> {
  if (!id) return null;
  const e = await catalog.get(id);
  const d = e?.data as { title?: LocalName; name?: LocalName; volume?: string; publisher?: string } | undefined;
  if (!d) return null;
  const base = d.title ?? d.name ?? { he: id };
  const more = [d.volume, d.publisher].filter(Boolean).join(', ');
  return more ? Object.fromEntries(Object.entries(base).map(([k, v]) => [k, `${v} (${more})`])) as unknown as LocalName : base;
}

/** The printings of a unit that can be compared: its texts, and the scanned pages contents maps give it. */
export async function printingsOf(catalog: Catalog, unit: EntityId): Promise<Printing[]> {
  const out: Printing[] = [];
  const gate = new ExportGate(catalog);
  for (const ref of await catalog.backlinks(unit, { field: 'unit', type: 'text' })) {
    const text = await catalog.get(ref.from);
    if (!text) continue;
    if (await gate.textWithheld(text.id)) continue;
    const d = text.data as { kind: string; publication?: EntityId };
    if (d.kind === 'transcript' || d.kind === 'translation') continue;
    const segments = await catalog.children(text.id, 'text', 'segment', { limit: 5000 });
    out.push({
      key: `text:${text.id}`,
      label: (await titleOf(catalog, d.publication)) ?? { he: d.kind === 'hanacha' ? 'הנחה' : 'מהדורה', en: d.kind === 'hanacha' ? 'Hanacha' : 'Edition' },
      publication: d.publication ?? null,
      kind: 'text',
      checked: segments.every((s) => (s.data as { proofread?: number }).proofread! > 0 || !(s.data as { origin?: unknown }).origin),
    });
  }
  for (const ref of await catalog.backlinks(unit, { field: 'unit', type: 'contents-map' })) {
    const map = await catalog.get(ref.from);
    const d = map?.data as { publication: EntityId; pages: { from: number; to: number; scheme: 'printed' | 'pdf' } } | undefined;
    if (!d || d.pages.scheme !== 'pdf') continue;
    for (const s of await catalog.backlinks(d.publication, { field: 'publication', type: 'scan' })) {
      if (!(await scanServable(catalog, s.from))) continue;
      const first = await scanText(catalog, s.from, d.pages.from).catch(() => null);
      if (!first) continue;
      out.push({ key: `scan:${s.from}:${d.pages.from}-${d.pages.to}`, label: (await titleOf(catalog, d.publication)) ?? { he: s.from }, publication: d.publication, kind: 'scan', checked: false });
    }
  }
  return out;
}

/** The words of one printing, by its key, and whether all of it is checked. */
export async function printingText(catalog: Catalog, key: string): Promise<{ text: string; checked: boolean }> {
  const t = /^text:(rh-[0-9a-z]+)$/.exec(key);
  if (t) {
    const text = await catalog.get(t[1] as EntityId);
    if (!text || text.type !== 'text') throw notFound(`text ${t[1]}`);
    if (await new ExportGate(catalog).textWithheld(text.id)) throw notFound(`text ${t[1]}, withheld for its rights`);
    const segments = await catalog.children(text.id, 'text', 'segment', { limit: 5000 });
    const sorted = segments.map((s) => s.data as { order: string; content: string; proofread: number; origin?: unknown }).sort((a, b) => (a.order < b.order ? -1 : 1));
    return { text: sorted.map((s) => s.content).join('\n'), checked: sorted.every((s) => s.proofread > 0 || !s.origin) };
  }
  const s = /^scan:(rh-[0-9a-z]+):(\d+)-(\d+)$/.exec(key);
  if (s) {
    const [from, to] = [Number(s[2]), Number(s[3])];
    if (to < from || to - from > 200) throw invalid('up to 200 pages of a scan at a time');
    if (!(await scanServable(catalog, s[1] as EntityId))) throw notFound(`the text of scan ${s[1]}, withheld for its rights`);
    const parts: string[] = [];
    let checked = true;
    for (let page = from; page <= to; page++) {
      const view = await scanText(catalog, s[1] as EntityId, page);
      if (!view) throw notFound(`a text of scan ${s[1]}`);
      parts.push(view.lines.map((l) => l.text).join('\n'));
      checked &&= view.level > 0;
    }
    return { text: parts.join('\n'), checked };
  }
  throw invalid('a printing is text:<id> or scan:<id>:<from>-<to>');
}

/** Compares two printings word by word. */
export async function comparePrintings(catalog: Catalog, a: string, b: string): Promise<{ a: { key: string; checked: boolean }; b: { key: string; checked: boolean }; runs: DiffRun[]; same: number; removed: number; added: number }> {
  const [ta, tb] = await Promise.all([printingText(catalog, a), printingText(catalog, b)]);
  const runs = diffWords(ta.text, tb.text);
  const count = (op: DiffRun['op']) => runs.filter((r) => r.op === op).reduce((n, r) => n + r.text.split(' ').length, 0);
  return { a: { key: a, checked: ta.checked }, b: { key: b, checked: tb.checked }, runs, same: count('same'), removed: count('removed'), added: count('added') };
}
