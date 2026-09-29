import type { RebbeHubApi, SuggestionDetail } from './api.js';
import type { Lang } from './i18n.js';
import { detailLabels, REPORT_LABEL } from './suggestions.js';
import { describeTargets } from './targets.server.js';

/**
 * The conversations about an item: suggestions that change it (or what is
 * in it: a sefer's sichos, their paragraphs) and issues people opened
 * about it. For a page's "Suggestions" tab, its side's recent activity and
 * its tab counts. The API finds the newest suggestions about the item in
 * one query (`about`), and only those are opened, for their labels and
 * where in the item they are; enough for a page, and the full list is a
 * search away (/suggestions).
 */

export interface AboutThread {
  kind: 'suggestion' | 'issue';
  number: number;
  title: string;
  /** open, approved (merged), closed (sent back, withdrawn, or an issue closed) */
  state: 'open' | 'approved' | 'closed';
  at: string;
  who: string;
  whoId: string | null;
  /** Label keys (lib/suggestions.ts LABELS) or an issue's own labels. */
  labels: Array<{ name: string; color?: string }>;
  /** Where in the item: "נח · ליקוטי שיחות, חלק א". */
  where: string | null;
  comments: number;
}

const SUGGESTIONS_READ = 15;
const ITEMS_READ = 25;

export async function threadsAbout(api: RebbeHubApi, ids: ReadonlySet<string>, lang: Lang, options: { set?: string | null } = {}): Promise<AboutThread[]> {
  const [list, issues] = await Promise.all([
    ids.size ? api.conversations({ state: 'all', about: [...ids].slice(0, 500), limit: SUGGESTIONS_READ }).catch(() => null) : null,
    api.issues({ state: 'all', limit: 50, ...(options.set ? { set: options.set } : {}) }).catch(() => null),
  ]);
  const out: AboutThread[] = [];
  if (list) {
    // A page of each one's items is enough for its labels and its first item's place; a big one is read no further.
    const details = await Promise.all(list.suggestions.map((s) => api.suggestion(s.id, { limit: ITEMS_READ }).catch(() => null)));
    const present = details.filter((d): d is SuggestionDetail => d !== null);
    const targets = await describeTargets(api, present.flatMap((d) => d.entries), lang).catch(() => new Map());
    list.suggestions.forEach((s, i) => {
      const d = details[i];
      if (!d) return;
      const first = d.entries[0] ? targets.get(d.entries[0].entityId) : undefined;
      out.push({
        kind: 'suggestion',
        number: s.number,
        title: s.title,
        state: s.status === 'open' || s.status === 'draft' ? 'open' : s.status === 'merged' ? 'approved' : 'closed',
        at: s.submittedAt ?? s.createdAt,
        who: list.people[s.author]?.name ?? s.author,
        whoId: s.author,
        labels: detailLabels(d).map((name) => ({ name })),
        where: first ? first.label : null,
        comments: s.comments,
      });
    });
  }
  for (const issue of issues?.items ?? []) {
    if (!issue.entity || !ids.has(issue.entity.id)) continue;
    out.push({
      kind: 'issue',
      number: issue.number,
      title: issue.title ?? issue.typeTitle[lang],
      state: issue.state === 'open' ? 'open' : 'closed',
      at: issue.createdAt,
      who: issue.author ? (issues!.people[issue.author]?.name ?? issue.author) : lang === 'he' ? 'אורח' : 'A guest',
      whoId: issue.author,
      labels: issue.labels.length ? issue.labels.map((l) => ({ name: l.name, color: l.color })) : [{ name: REPORT_LABEL[issue.type] ?? 'meta' }],
      where: typeof (issue.entity.name as { he?: string } | null)?.he === 'string' ? ((issue.entity.name as { he: string; en?: string })[lang] ?? (issue.entity.name as { he: string }).he) : null,
      comments: issue.comments,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
