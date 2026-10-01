/** One version in an item's history, as much of it as comparing two needs. */
export interface VersionStep {
  rev: number;
  created: boolean;
  deleted: boolean;
  changes: Array<{ path: string; before?: unknown; after?: unknown }>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What changed from one version to another, read from the history already
 * on the page, so comparing any two (4f) costs no request: each field as
 * the older version left it and as the newer one has it. A field changed
 * and changed back drops out. Null when the history between them cannot
 * say it field by field: the item was made or deleted in between, or one
 * change replaced a whole part another changed inside.
 */
export function between(history: readonly VersionStep[], older: number, newer: number): Array<{ path: string; before?: unknown; after?: unknown }> | null {
  const from = history.findIndex((h) => h.rev === newer);
  const to = history.findIndex((h) => h.rev === older);
  if (from < 0 || to < 0 || from >= to) return null;
  // Newest first: the versions after the older one, up to and including the newer.
  const steps = history.slice(from, to);
  if (steps.some((h) => h.created || h.deleted)) return null;
  const fields = new Map<string, { before?: unknown; after?: unknown }>();
  for (const step of [...steps].reverse())
    for (const c of step.changes) {
      const was = fields.get(c.path);
      fields.set(c.path, was ? { before: was.before, after: c.after } : { before: c.before, after: c.after });
    }
  const paths = [...fields.keys()];
  if (paths.some((p) => paths.some((q) => q !== p && q.startsWith(`${p}/`)))) return null;
  return paths.filter((p) => !same(fields.get(p)!.before, fields.get(p)!.after)).map((path) => ({ path, ...fields.get(path)! }));
}
