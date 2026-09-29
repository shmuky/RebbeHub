import type { LocalName } from '@rebbehub/model';
import type { Lang } from './i18n.js';

/**
 * The organizing view's own logic, kept apart from its drawing so it can be
 * tested: rows picked with a click or a shift-click, a list put in a new
 * order by dragging or by the keyboard, and the plan of operations it all
 * becomes (core/organize.ts reads the same plan). Nothing here talks to the
 * API; routes/organize.tsx does.
 */

/** One row of the tree, as GET /v1/tree gives it. */
export interface TreeNode {
  id: string;
  type: string;
  path: string | null;
  name: LocalName | null;
  order: string | null;
  counts: { sets?: number; items?: number; units?: number };
  children?: TreeNode[];
  more?: number;
}

/** One step of a plan (POST /v1/organize). */
export type Operation =
  | { op: 'move'; items: string[]; to: string | null; from?: string; mode?: 'add' | 'only' }
  | { op: 'move-up'; items: string[]; from?: string }
  | { op: 'rename'; item: string; name?: { he?: string; en?: string }; slug?: string }
  | { op: 'reorder'; items: string[]; parent?: string | null }
  | { op: 'create-set'; key: string; name: { he: string; en?: string }; slug: string; parent?: string | null; items?: string[] }
  | { op: 'delete-set'; item: string }
  | { op: 'merge'; from: string; into: string };

/** The rows of one kind under the root, which are ordered among themselves. */
export interface Group {
  key: 'sets' | 'works' | 'units' | 'others';
  /** Whose children they are, for a reorder (null: the top sets). */
  parent: string | null;
  orderable: boolean;
  nodes: TreeNode[];
}

/** The root's children in their groups: sets under it, then its sefarim, then anything else; a sefer's units. */
export function groupsOf(root: TreeNode | null, children: TreeNode[]): Group[] {
  if (root === null) return [{ key: 'sets', parent: null, orderable: true, nodes: children.filter((c) => c.type === 'set') }];
  if (root.type === 'work') return [{ key: 'units', parent: root.id, orderable: true, nodes: children }];
  const groups: Group[] = [
    { key: 'sets', parent: root.id, orderable: true, nodes: children.filter((c) => c.type === 'set') },
    { key: 'works', parent: root.id, orderable: true, nodes: children.filter((c) => c.type === 'work') },
    { key: 'others', parent: root.id, orderable: false, nodes: children.filter((c) => c.type !== 'set' && c.type !== 'work') },
  ];
  return groups.filter((g) => g.nodes.length > 0);
}

/**
 * A click on a row's box: it alone is turned on or off; with shift, every
 * row from the last one clicked to this one takes this one's new state,
 * as in a mail client's list.
 */
export function toggleSelect(order: readonly string[], selected: ReadonlySet<string>, id: string, shift: boolean, anchor: string | null): { selected: Set<string>; anchor: string } {
  const next = new Set(selected);
  const on = !selected.has(id);
  if (shift && anchor !== null && order.includes(anchor) && order.includes(id)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
    for (const row of order.slice(a!, b! + 1)) {
      if (on) next.add(row);
      else next.delete(row);
    }
  } else if (on) next.add(id);
  else next.delete(id);
  return { selected: next, anchor: id };
}

/** Moves the chosen rows one place up or down together, keeping their own order (the keyboard's way to reorder). */
export function moveBy(list: readonly string[], ids: readonly string[], delta: -1 | 1): string[] {
  const chosen = new Set(ids);
  const out = [...list];
  const indexes = out.map((id, i) => (chosen.has(id) ? i : -1)).filter((i) => i >= 0);
  if (indexes.length === 0) return out;
  if (delta < 0 ? indexes[0] === 0 : indexes[indexes.length - 1] === out.length - 1) return out;
  for (const i of delta < 0 ? indexes : [...indexes].reverse()) {
    const j = i + delta;
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Puts the dragged rows just before `target` (or at the end, for null), keeping their own order. */
export function dropBefore(list: readonly string[], dragged: readonly string[], target: string | null): string[] {
  const moving = new Set(dragged);
  if (target !== null && moving.has(target)) return [...list];
  const kept = list.filter((id) => !moving.has(id));
  const block = list.filter((id) => moving.has(id));
  const at = target === null ? kept.length : kept.indexOf(target);
  return [...kept.slice(0, at < 0 ? kept.length : at), ...block, ...kept.slice(at < 0 ? kept.length : at)];
}

export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Items an operation takes away from where they are (so a later reorder of that list leaves them out). */
export function removedBy(op: Operation): string[] {
  if (op.op === 'move' || op.op === 'move-up') return op.op === 'move' && op.mode === undefined && op.from === undefined && op.to !== null ? [] : op.items;
  if (op.op === 'merge') return [op.from];
  if (op.op === 'delete-set') return [op.item];
  if (op.op === 'create-set') return op.items ?? [];
  return [];
}

/**
 * The whole plan: the operations chosen, then each group whose order was
 * changed as one reorder of what is still there.
 */
export function planOf(operations: readonly Operation[], groups: readonly Group[], orders: Readonly<Record<string, readonly string[]>>): Operation[] {
  const gone = new Set(operations.flatMap(removedBy));
  const out = [...operations];
  for (const group of groups) {
    const now = orders[group.key];
    if (!group.orderable || !now) continue;
    const before = group.nodes.map((n) => n.id);
    if (sameOrder(before, now)) continue;
    const items = now.filter((id) => !gone.has(id));
    if (items.length > 1) out.push({ op: 'reorder', items, parent: group.parent });
  }
  return out;
}

/** A slug from a name in Latin letters, as core's paths make them. */
export function slugFrom(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export const OW = {
  title: { he: 'סידור הקטלוג', en: 'Organize the catalog' },
  titleOf: { he: 'סידור:', en: 'Organize:' },
  library: { he: 'הספרייה', en: 'The library' },
  lede: {
    he: 'בחרו שורות, והזיזו, שנו שם, סדרו מחדש, צרו סט או מזגו כפולים. כל השינויים יחד נשלחים כהצעה אחת, ונבדקים לפני שהם נכנסים. כתובות ישנות ממשיכות להוביל למקום החדש.',
    en: 'Pick rows, then move, rename, reorder, make a set or merge duplicates. All the changes go together as one suggestion, reviewed before they land. Old addresses keep leading to the new place.',
  },
  organize: { he: 'סידור', en: 'Organize' },
  sets: { he: 'סטים', en: 'Sets' },
  works: { he: 'ספרים', en: 'Sefarim' },
  units: { he: 'שיחות ופרקים', en: 'Sichos and chapters' },
  others: { he: 'עוד בסט', en: 'More in this set' },
  selected: { he: 'נבחרו', en: 'selected' },
  selectAll: { he: 'בחירת הכל', en: 'Select all' },
  clear: { he: 'ניקוי הבחירה', en: 'Clear selection' },
  moveTo: { he: 'העברה אל…', en: 'Move to…' },
  moveUp: { he: 'העלאה רמה', en: 'Move up a level' },
  takeOut: { he: 'הוצאה מהסט', en: 'Take out of this set' },
  rename: { he: 'שינוי שם', en: 'Rename' },
  mergeInto: { he: 'מיזוג אל…', en: 'Merge into…' },
  newSet: { he: 'סט חדש', en: 'New set' },
  deleteSet: { he: 'מחיקת הסט הריק', en: 'Remove the empty set' },
  up: { he: 'למעלה ברשימה', en: 'Up the list' },
  down: { he: 'למטה ברשימה', en: 'Down the list' },
  drag: { he: 'גררו לשינוי הסדר, או בחרו והשתמשו בחיצים עם Alt', en: 'Drag to reorder, or focus and use Alt with the arrows' },
  open: { he: 'פתיחה', en: 'Open' },
  inside: { he: 'פתיחת הסידור בתוכו', en: 'Organize inside it' },
  nameHe: { he: 'שם בעברית', en: 'Name in Hebrew' },
  nameEn: { he: 'שם באנגלית', en: 'Name in English' },
  slug: { he: 'כתובת (אותיות לטיניות)', en: 'Address (Latin letters)' },
  slugHint: { he: 'הכתובת הישנה תפנה לחדשה.', en: 'The old address will lead to the new one.' },
  add: { he: 'הוספה לשינויים', en: 'Add to the changes' },
  cancel: { he: 'ביטול', en: 'Cancel' },
  pickPlace: { he: 'לאן?', en: 'Where to?' },
  pickDuplicate: { he: 'מזגו אל הפריט שנשאר', en: 'Merge into the item that stays' },
  searchSets: { he: 'חיפוש סט בשם', en: 'Find a set by name' },
  searchWorks: { he: 'חיפוש ספר בשם', en: 'Find a sefer by name' },
  searchSame: { he: 'חיפוש לפי שם', en: 'Find by name' },
  top: { he: 'לראש הספרייה (בלי סט מעל)', en: 'To the top of the library (no set above)' },
  here: { he: 'כאן', en: 'Here' },
  keepHere: { he: 'להשאיר גם בסט הזה', en: 'Keep it in this set as well' },
  nothingFound: { he: 'לא נמצא דבר.', en: 'Nothing found.' },
  changes: { he: 'השינויים', en: 'Changes' },
  noChanges: { he: 'עוד לא נבחר שינוי. בחרו שורות ופעולה, או גררו לשינוי הסדר.', en: 'No change yet. Pick rows and an action, or drag to reorder.' },
  reorderOf: { he: 'סדר חדש', en: 'New order' },
  remove: { he: 'הסרה', en: 'Remove' },
  preview: { he: 'תצוגה מקדימה', en: 'Preview' },
  send: { he: 'שליחה לבדיקה', en: 'Send for review' },
  applyNow: { he: 'אישור והחלה עכשיו', en: 'Approve and apply now' },
  sent: { he: 'ההצעה נשלחה לבדיקה.', en: 'The suggestion was sent for review.' },
  applied: { he: 'השינויים נכנסו לקטלוג.', en: 'The changes are in the catalog.' },
  seeSuggestion: { he: 'להצעה', en: 'See the suggestion' },
  willChange: { he: 'פריטים ישתנו', en: 'items will change' },
  redirects: { he: 'כתובות ישנות שיפנו', en: 'old addresses that will redirect' },
  notes: { he: 'הערות', en: 'Notes' },
  newItem: { he: 'חדש', en: 'New' },
  deleted: { he: 'יימחק', en: 'Deleted' },
  signIn: { he: 'כדי לסדר את הקטלוג צריך להתחבר.', en: 'Sign in to organize the catalog.' },
  signInLink: { he: 'התחברות', en: 'Sign in' },
  noScript: { he: 'הסידור פועל עם JavaScript.', en: 'Organizing needs JavaScript.' },
  more: { he: 'ועוד', en: 'and more:' },
  empty: { he: 'אין כאן עדיין דבר לסדר.', en: 'Nothing here to organize yet.' },
  holds: { he: 'מכיל', en: 'holds' },
  unitsCount: { he: 'יחידות', en: 'units' },
  itemsCount: { he: 'פריטים', en: 'items' },
  setsCount: { he: 'סטים', en: 'sets' },
  reviewNote: { he: 'שינויים בסטים עצמם נבדקים בידי אחראי הקטלוג; שינויים בספרים ובשיחות בידי שומרי הסט.', en: 'Changes to sets themselves are reviewed by stewards; changes to sefarim and sichos by the set’s keepers.' },
  whyTitle: { he: 'כותרת ההצעה (לא חובה)', en: 'Title of the suggestion (optional)' },
  why: { he: 'למה? (לבודקים)', en: 'Why? (for the reviewers)' },
} as const;

export const ow = (lang: Lang, key: keyof typeof OW) => OW[key][lang];

/** One pending operation in plain words, for the list of changes. */
export function describeOperation(op: Operation, name: (id: string) => string, lang: Lang): string {
  const he = lang === 'he';
  const list = (ids: readonly string[]) => (ids.length === 1 ? name(ids[0]!) : he ? `${ids.length} פריטים` : `${ids.length} items`);
  switch (op.op) {
    case 'move':
      if (op.to === null) return op.from ? (he ? `הוצאת ${list(op.items)} מ${name(op.from)}` : `Take ${list(op.items)} out of ${name(op.from)}`) : he ? `העברת ${list(op.items)} לראש הספרייה` : `Move ${list(op.items)} to the top`;
      return he ? `העברת ${list(op.items)} אל ${name(op.to)}${op.from ? '' : ' (גם)'}` : `Move ${list(op.items)} into ${name(op.to)}${op.from ? '' : ' (as well)'}`;
    case 'move-up':
      return he ? `העלאת ${list(op.items)} רמה אחת` : `Move ${list(op.items)} up a level`;
    case 'rename': {
      const to = [op.name?.he, op.name?.en].filter(Boolean).join(' / ');
      return he ? `שינוי שם ${name(op.item)}${to ? ` ל${to}` : ''}${op.slug ? ` (${op.slug})` : ''}` : `Rename ${name(op.item)}${to ? ` to ${to}` : ''}${op.slug ? ` (${op.slug})` : ''}`;
    }
    case 'reorder':
      return he ? `סדר חדש ל${list(op.items)}` : `New order for ${list(op.items)}`;
    case 'create-set':
      return he ? `סט חדש ${op.name.he}${op.items?.length ? ` עם ${list(op.items)}` : ''}` : `New set ${op.name.en || op.name.he}${op.items?.length ? ` with ${list(op.items)}` : ''}`;
    case 'delete-set':
      return he ? `מחיקת הסט הריק ${name(op.item)}` : `Remove the empty set ${name(op.item)}`;
    case 'merge':
      return he ? `מיזוג ${name(op.from)} אל ${name(op.into)}` : `Merge ${name(op.from)} into ${name(op.into)}`;
  }
}
