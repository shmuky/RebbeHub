/**
 * Readable paths: `/likkutei-sichos/12/bereishis/3`, `/events/5742-05-10`,
 * `/teshuros/5784-cohen-levi`. A path is a name for people and search
 * engines; it can change (the old one then redirects), so nothing stores
 * a path where it could store an id.
 */

export type EntityPath = string;

const PATH_PATTERN = /^(\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

export function isEntityPath(value: unknown): value is EntityPath {
  return typeof value === 'string' && value.length <= 300 && PATH_PATTERN.test(value);
}

/** One path segment from a title in Latin letters: `Likkutei Sichos, vol. 12` → `likkutei-sichos-vol-12`. */
export function slugify(text: string): string {
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

/** A path from its segments, each slugified: `joinPath('events', '5741-06B-14')` → `/events/5741-06b-14`. */
export function joinPath(...segments: Array<string | number>): EntityPath {
  const parts = segments.map((s) => slugify(String(s))).filter((s) => s.length > 0);
  if (parts.length === 0) throw new RangeError('a path needs at least one segment');
  return `/${parts.join('/')}`;
}
