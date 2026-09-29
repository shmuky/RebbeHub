import type { PageSegment, PageText } from '@rebbehub/model';

/**
 * The scan page a machine's segments were read from, found by the source
 * markers in the words: a marker whose words end in a number (`סריקה 12`)
 * says the segments after it were read from that page of the version's
 * scan (its `url`), until the next marker. Segments before any marker are
 * on the first page.
 */
export function scanPages(page: PageText, versionId: string): Map<string, number> {
  const out = new Map<string, number>();
  const version = page.versions.find((v) => v.id === versionId);
  if (!version) return out;
  let current = 1;
  const walk = (list: readonly PageSegment[]) => {
    for (const segment of list) {
      const marker = segment.text?.find((run) => 'marker' in run) as { marker: string } | undefined;
      const n = marker ? Number(/(\d+)\s*$/.exec(marker.marker)?.[1]) : NaN;
      if (n > 0) current = n;
      out.set(segment.id, current);
      if (segment.children) walk(segment.children);
    }
  };
  walk(version.segments);
  return out;
}

/** The version of a page a scan checker opens beside: one with its scan's address, read by a machine in part or whole. */
export function scannedVersion(page: PageText): { id: string; url: string } | null {
  for (const v of page.versions) {
    if (!v.url) continue;
    const machine = (list: readonly PageSegment[]): boolean => list.some((s) => (s.origin && !s.origin.checked) || machine(s.children ?? []));
    if (machine(v.segments)) return { id: v.id, url: v.url };
  }
  return null;
}
