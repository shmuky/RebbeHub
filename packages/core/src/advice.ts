import { one, type Db } from '@rebbehub/db';
import type { EntityType } from '@rebbehub/model';
import type { Catalog, ChangeEntry, ChangesetRow } from './catalog.js';
import { ExportGate } from './gate.js';
import type { Json } from './merge.js';

/**
 * The reviewer's assist (the plan, section 9: "an AI summary of each
 * suggestion - advice, never a merge"). A scheduled job asks a language
 * model to say, in a few sentences, what a suggestion waiting for review
 * changes and what a reviewer might check; the review page shows it
 * marked as written by a machine. It decides nothing: only a person
 * approves or sends back. Words whose rights keep them home are never
 * sent to the model; it is told only that they are withheld.
 */

/** A language model that answers one question (Workers AI on the API; a stand-in in tests). */
export interface Advisor {
  model: string;
  complete(system: string, user: string): Promise<string>;
}

export interface Advice {
  summary: string;
  model: string;
  at: string;
}

/** Tries before a suggestion is left without advice. */
const MAX_ATTEMPTS = 3;
const MAX_VALUE = 400;
const MAX_PROMPT = 12_000;

const SYSTEM = [
  'You help volunteer reviewers of RebbeHub, an open catalog of Chabad Torah and media (sichos, farbrengens, seforim, recordings, scans).',
  'A contributor sent a Suggestion: a change to the catalog. A reviewer will Approve it or Send it back; you never decide.',
  'In three to five short plain sentences, in English: say what the suggestion changes, in words a reviewer understands at a glance;',
  'then anything worth checking before approving (a date that does not fit, a spelling, a name, a removed field, a source, the size of the change, a failed check).',
  'Do not invent facts about the Rebbe, dates or sources. Do not say whether to approve. No lists, no headings.',
].join(' ');

function short(value: Json | undefined): string {
  if (value === undefined) return '(none)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function nameOf(data: Json | null): string {
  const d = (data ?? {}) as { title?: { he?: string; en?: string }; name?: { he?: string; en?: string }; label?: { he?: string; en?: string }; date?: string; page?: number };
  const name = d.title ?? d.name ?? d.label;
  return [name?.he, name?.en, d.date, d.page !== undefined ? `page ${d.page}` : undefined].filter(Boolean).join(' / ');
}

/** What the model is asked: the suggestion as a reviewer sees it, withheld words left out. */
export function advicePrompt(input: {
  changeset: ChangesetRow;
  entries: Array<ChangeEntry & { withheld?: string }>;
  author: { name: string; trust: string; approved: number; isBot: boolean };
}): string {
  const cs = input.changeset;
  const lines: string[] = [
    `Title: ${cs.title}`,
    cs.description ? `The contributor's note: ${cs.description}` : 'The contributor left no note.',
    `Contributor: ${input.author.name}${input.author.isBot ? ' (a bot)' : ''}, ${input.author.trust}, ${input.author.approved} suggestions approved before.`,
  ];
  if (cs.kind === 'live') lines.push('It went live at once (a trusted contributor fixing text in an open set) and is reviewed after.');
  if (cs.kind === 'revert') lines.push('It undoes an earlier change.');
  const flagged = cs.checks.filter((c) => c.status !== 'pass');
  lines.push(`Automatic checks: ${cs.checks.length - flagged.length} passed${flagged.map((c) => `; ${c.check} ${c.status}: ${c.message}`).join('')}.`, '');
  for (const entry of input.entries) {
    const what = `${entry.type as EntityType} ${entry.entityId}${nameOf(entry.after ?? entry.before) ? ` "${nameOf(entry.after ?? entry.before)}"` : ''}`;
    if (entry.withheld) {
      lines.push(`- ${what}: its words are withheld for rights; say only that the reviewer should read it on the site.`);
    } else if (entry.before === null) {
      lines.push(`- New ${what}: ${short(entry.after)}`);
    } else if (entry.after === null) {
      lines.push(`- Deletes ${what}.`);
    } else {
      lines.push(`- Changes ${what}:`);
      for (const change of entry.changes.slice(0, 40)) lines.push(`  ${change.path || '/'}: ${short(change.before)} -> ${short(change.after)}`);
      if (entry.changes.length > 40) lines.push(`  …and ${entry.changes.length - 40} more fields.`);
    }
    if (entry.conflicts.length > 0) lines.push('  (Main has changed the same fields since it was written.)');
  }
  const prompt = lines.join('\n');
  return prompt.length > MAX_PROMPT ? `${prompt.slice(0, MAX_PROMPT)}\n…(cut short)` : prompt;
}

/** A suggestion's advice, when it was written for the suggestion as it was last sent for review. */
export async function adviceFor(db: Db, changesetId: number): Promise<Advice | null> {
  const row = await one<{ summary: string; model: string; created_at: Date | string }>(
    db,
    `SELECT a.summary, a.model, a.created_at FROM changeset_advice a JOIN changeset c ON c.id = a.changeset_id
     WHERE a.changeset_id = $1 AND a.summary IS NOT NULL AND a.submitted_at IS NOT DISTINCT FROM c.submitted_at`,
    [changesetId],
  );
  return row ? { summary: row.summary, model: row.model, at: new Date(row.created_at).toISOString() } : null;
}

/**
 * Writes advice for the suggestions waiting for review that have none yet
 * for how they were last sent (and for live changes waiting to be reviewed
 * after): oldest first, a few each run. Importers' suggestions are left
 * out. Returns how many were written.
 */
export async function adviseSuggestions(catalog: Catalog, advisor: Advisor, options: { limit?: number } = {}): Promise<number> {
  const { rows } = await catalog.db.query<{ id: string | number }>(
    `SELECT c.id FROM changeset c JOIN account u ON u.id = c.author LEFT JOIN changeset_advice a ON a.changeset_id = c.id
     WHERE ((c.status = 'open' AND c.kind <> 'import') OR c.post_review = 'pending') AND NOT u.is_bot
       AND (a.changeset_id IS NULL OR a.submitted_at IS DISTINCT FROM c.submitted_at OR (a.summary IS NULL AND a.attempts < ${MAX_ATTEMPTS}))
     ORDER BY c.submitted_at NULLS LAST, c.id LIMIT ${Math.min(options.limit ?? 5, 50)}`,
  );
  let written = 0;
  const gate = new ExportGate(catalog);
  for (const { id } of rows) {
    const view = await catalog.review(Number(id));
    const entries = await Promise.all(
      view.entries.map(async (entry) => {
        for (const data of [entry.after, entry.before]) {
          if (data === null) continue;
          const shown = await gate.redact({ id: entry.entityId, type: entry.type, path: null, rev: 0, data });
          if (shown.withheld) return { ...entry, withheld: shown.withheld };
        }
        return entry;
      }),
    );
    const author = await catalog.account(view.changeset.author);
    const prompt = advicePrompt({
      changeset: view.changeset,
      entries,
      author: { name: author?.display_name ?? view.changeset.author, trust: author?.trust ?? 'contributor', approved: author?.approved_count ?? 0, isBot: author?.is_bot ?? false },
    });
    let summary: string | null = null;
    let error: string | null = null;
    try {
      summary = (await advisor.complete(SYSTEM, prompt)).trim().slice(0, 2000) || null;
      if (!summary) error = 'the model gave no answer';
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    }
    await catalog.db.query(
      `INSERT INTO changeset_advice (changeset_id, summary, model, submitted_at, error) VALUES ($1, $2, $3, (SELECT submitted_at FROM changeset WHERE id = $1), $4)
       ON CONFLICT (changeset_id) DO UPDATE SET summary = EXCLUDED.summary, model = EXCLUDED.model, error = EXCLUDED.error, created_at = now(),
         attempts = CASE WHEN changeset_advice.submitted_at IS NOT DISTINCT FROM EXCLUDED.submitted_at THEN changeset_advice.attempts + 1 ELSE 1 END,
         submitted_at = EXCLUDED.submitted_at`,
      // The time is copied in the database: read into JavaScript it loses its microseconds, and would never match again.
      [view.changeset.id, summary, advisor.model, error],
    );
    if (summary) written++;
  }
  return written;
}
