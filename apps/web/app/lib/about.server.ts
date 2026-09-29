import type { Entity, RebbeHubApi } from './api.js';
import type { Lang } from './i18n.js';
import { REPORT_LABEL, typeLabels } from './suggestions.js';
import { describeTargets } from './targets.server.js';

/**
 * The conversations about an item: suggestions that change it (or what is
 * in it: a sefer's sichos, their paragraphs) and issues people opened
 * about it. For a page's "Suggestions" tab, its side's recent activity and
 * its tab counts. The API finds the newest suggestions about the item in
 * one query (`about`) and says what kinds of items each changes and which
 * comes first, which labels and places it without opening any (an item's
 * page once opened every open one, a request each, on every view).
 * Enough for a page, and the full list is a search away (/suggestions).
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

export async function threadsAbout(api: RebbeHubApi, ids: ReadonlySet<string>, lang: Lang, options: { set?: string | null } = {}): Promise<AboutThread[]> {
  const [list, issues] = await Promise.all([
    ids.size ? api.conversations({ state: 'all', about: [...ids].slice(0, 500), limit: SUGGESTIONS_READ }).catch(() => null) : null,
    api.issues({ state: 'all', limit: 50, ...(options.set ? { set: options.set } : {}) }).catch(() => null),
  ]);
  const out: AboutThread[] = [];
  if (list) {
    // Each one's first item, all at once, to say where in the item it is (a paragraph's sicha, a printing's sefer).
    const firsts = await api.entities(list.suggestions.map((s) => s.first ?? '').filter(Boolean)).catch(() => new Map<string, Entity>());
    const targets = await describeTargets(api, [...firsts.values()].map((e) => ({ entityId: e.id, type: e.type, before: null, after: e.data as Record<string, unknown> })), lang).catch(() => new Map());
    for (const s of list.suggestions) {
      const first = s.first ? targets.get(s.first) : undefined;
      out.push({
        kind: 'suggestion',
        number: s.number,
        title: s.title,
        state: s.status === 'open' || s.status === 'draft' ? 'open' : s.status === 'merged' ? 'approved' : 'closed',
        at: s.submittedAt ?? s.createdAt,
        who: list.people[s.author]?.name ?? s.author,
        whoId: s.author,
        labels: typeLabels(s.types ?? []).map((name) => ({ name })),
        where: first ? first.label : null,
        comments: s.comments,
      });
    }
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
