/**
 * What a link opens, for its tooltip: the `title` a /read link carries (a
 * subject index's page number names its sicha that way, `ח"א ע' 119 (וארא)`).
 */
export function linkTitle(target: string): string | undefined {
  const query = target.indexOf('?');
  if (query < 0) return undefined;
  return new URLSearchParams(target.slice(query + 1)).get('title')?.trim() || undefined;
}
