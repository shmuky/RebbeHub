/**
 * The library's shelves as its main page shows them: a shelf for each Rebbe
 * (and the others: history, halacha, journals...) in the order the catalog
 * keeps them, each with its sets inside it and every sefer in its place.
 * The sources the sefarim came from (HebrewBooks, Otzros, Sefaria) are not
 * shelves: a sefer is shelved by what it is, not by where it was found.
 */

export interface ShelfItem {
  id: string;
  path?: string | null;
  data: unknown;
}

export interface Shelf<T extends ShelfItem> {
  set: T;
  /** The sefarim on this shelf itself, in their order. */
  works: T[];
  /** The sets inside it, in their order, each with its own. */
  sets: Shelf<T>[];
  /** Every sefer on it and in the sets inside it, each once. */
  total: number;
}

/** The sets that are sources, not shelves, by their address. */
export const SOURCE_SETS: ReadonlySet<string> = new Set(['/sets/hebrewbooks', '/sets/otzros', '/sets/sefaria']);

const parentOf = (x: ShelfItem) => (x.data as { parent?: string | null }).parent ?? null;
const setsOf = (x: ShelfItem) => (x.data as { sets?: string[] }).sets ?? [];
const orderOf = (x: ShelfItem) => {
  const o = (x.data as { order?: unknown }).order;
  return typeof o === 'string' ? o : null;
};

/** Items in their kept order; those never put in order after them, by name. */
export function byOrder<T extends ShelfItem>(items: readonly T[], name: (x: T) => string): T[] {
  return [...items].sort((a, b) => {
    const oa = orderOf(a);
    const ob = orderOf(b);
    if (oa !== null && ob !== null && oa !== ob) return oa < ob ? -1 : 1;
    if ((oa === null) !== (ob === null)) return oa === null ? 1 : -1;
    return name(a).localeCompare(name(b));
  });
}

/**
 * The top shelves with what they hold, leaving out the sources and any
 * shelf with no sefer in it (unless `keep` says to show it anyway, as the
 * farbrengens are shown, which are not sefarim).
 */
export function shelvesOf<T extends ShelfItem>(sets: readonly T[], works: readonly T[], name: (x: T) => string, keep: (set: T) => boolean = () => false): Shelf<T>[] {
  const children = new Map<string | null, T[]>();
  for (const s of sets) children.set(parentOf(s), [...(children.get(parentOf(s)) ?? []), s]);
  const onShelf = new Map<string, T[]>();
  for (const w of works) for (const id of setsOf(w)) onShelf.set(id, [...(onShelf.get(id) ?? []), w]);
  const build = (set: T, seen: Set<string>): Shelf<T> => {
    seen.add(set.id);
    const inner = byOrder(children.get(set.id) ?? [], name)
      .filter((s) => !seen.has(s.id))
      .map((s) => build(s, seen))
      .filter((s) => s.total);
    const own = byOrder(onShelf.get(set.id) ?? [], name);
    const all = new Set([...own.map((w) => w.id), ...inner.flatMap((s) => everyWork(s).map((w) => w.id))]);
    return { set, works: own, sets: inner, total: all.size };
  };
  return byOrder(children.get(null) ?? [], name)
    .filter((s) => !SOURCE_SETS.has(s.path ?? ''))
    .map((s) => build(s, new Set()))
    .filter((s) => s.total || keep(s.set));
}

/** Every sefer on a shelf and inside it, in the shelf's order, each once. */
export function everyWork<T extends ShelfItem>(shelf: Shelf<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const w of [...shelf.works, ...shelf.sets.flatMap(everyWork)]) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
  }
  return out;
}
