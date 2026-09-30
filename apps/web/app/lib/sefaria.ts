/**
 * A Sefaria reference as a link to it on Sefaria, in Hebrew: `Exodus
 * 10:1-11` is `Exodus.10.1-11`, `Mishneh Torah, Divorce 9` is
 * `Mishneh_Torah,_Divorce.9`. For the shiurim whose words RebbeHub does not
 * have yet; with Rashi beside the verses when asked.
 */
export function sefariaUrl(ref: string, options: { rashi?: boolean } = {}): string {
  const m = /^(.*?) (\d[\d:-]*)$/.exec(ref);
  const path = m ? `${m[1]!.replace(/ /g, '_')}.${m[2]!.replace(/:/g, '.')}` : ref.replace(/ /g, '_');
  return `https://www.sefaria.org/${encodeURI(path)}?lang=he${options.rashi ? '&with=Rashi' : ''}`;
}

/** Several references in one book as one: the Rambam's three chapters, `Mishneh Torah, Immersion Pools 5-7`. */
export function joinRefs(refs: readonly string[]): string | null {
  const parts = refs.map((r) => /^(.*) (\d+)$/.exec(r));
  if (!parts.length || parts.some((p) => !p)) return refs[0] ?? null;
  const book = parts[0]![1];
  if (parts.some((p) => p![1] !== book)) return refs[0]!;
  return parts.length === 1 ? refs[0]! : `${book} ${parts[0]![2]}-${parts.at(-1)![2]}`;
}
