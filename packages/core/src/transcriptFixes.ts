import type { EntityId } from "@rebbehub/model";
import type { Catalog } from "./catalog.js";
import type { Json } from "./merge.js";

/**
 * Every transcript fix waiting for approval, in one list, so a keeper can
 * go through them together (Keep some, Remove others) instead of opening
 * each Suggestion. A fix is an open Suggestion that changes only a
 * transcript's paragraphs and their sync: its words as sent beside the
 * words on the site, where the paragraph is heard, and who sent it.
 * Three reads, however many fixes there are.
 */

export interface TranscriptFixChange {
  segment: EntityId;
  /**
   * words: the paragraph's words change; check: marked checked as it is;
   * timing: where the paragraph starts changes (the editor's old timing
   * tool, which moved the sync and was removed); new: a paragraph added.
   */
  kind: "words" | "check" | "timing" | "new";
  /** The paragraph on the site now, and as the fix would make it. */
  before: string | null;
  after: string | null;
  /** Where the paragraph is heard now, for listening to it. */
  startMs: number | null;
  endMs: number | null;
  /** For timing: where it would start. */
  newStartMs?: number;
  order: string;
}

export interface TranscriptFix {
  id: number;
  number: number | null;
  author: string;
  authorName: string | null;
  bot: boolean;
  at: string;
  recording: EntityId;
  recordingTitle: Json | null;
  event: EntityId | null;
  eventPath: string | null;
  eventTitle: Json | null;
  date: string | null;
  language: string | null;
  changes: TranscriptFixChange[];
}

/** At most this many Suggestions at a time; the oldest first, so the list is worked through from the top. */
export const TRANSCRIPT_FIXES_MAX = 200;

export async function openTranscriptFixes(
  catalog: Catalog,
  options: { limit?: number } = {},
): Promise<TranscriptFix[]> {
  const limit = Math.min(
    Math.max(options.limit ?? TRANSCRIPT_FIXES_MAX, 1),
    TRANSCRIPT_FIXES_MAX,
  );
  // Open Suggestions of paragraphs and sync only, and what each sends for each item (its last revision of it).
  const { rows } = await catalog.db.query<{
    id: number;
    number: number | string | null;
    author: string;
    author_name: string | null;
    is_bot: boolean | null;
    at: string | Date;
    entity_id: EntityId;
    entity_type: string;
    data: Record<string, unknown> | null;
  }>(
    `WITH cs AS (
       SELECT c.id, c.number, c.author, coalesce(c.submitted_at, c.created_at) AS at FROM changeset c
       WHERE c.status = 'open' AND c.kind = 'suggestion'
         AND EXISTS (SELECT 1 FROM revision r WHERE r.changeset_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM revision r WHERE r.changeset_id = c.id AND r.entity_type NOT IN ('segment', 'alignment-span'))
       ORDER BY at, c.id LIMIT $1
     )
     SELECT DISTINCT ON (cs.id, r.entity_id) cs.id, cs.number, cs.author, a.display_name AS author_name, a.is_bot, cs.at, r.entity_id, r.entity_type, r.data
     FROM cs JOIN revision r ON r.changeset_id = cs.id LEFT JOIN account a ON a.id = cs.author
     ORDER BY cs.id, r.entity_id, r.id DESC`,
    [limit],
  );
  if (!rows.length) return [];

  // The paragraphs as they are on the site, and where each is heard.
  const segmentIds = [
    ...new Set(
      rows
        .map((r) =>
          r.entity_type === "segment"
            ? r.entity_id
            : String(r.data?.segment ?? ""),
        )
        .filter(Boolean),
    ),
  ];
  const { rows: now } = await catalog.db.query<{
    id: EntityId;
    content: string | null;
    order: string | null;
    text: string | null;
    start_ms: string | null;
    end_ms: string | null;
  }>(
    `SELECT s.id, sr.data->>'content' AS content, sr.data->>'order' AS "order", sr.data->>'text' AS text,
            sp.data->>'startMs' AS start_ms, sp.data->>'endMs' AS end_ms
     FROM entity s JOIN revision sr ON sr.id = s.main_rev
     LEFT JOIN LATERAL (
       SELECT spr.data FROM entity_ref y JOIN entity e ON e.id = y.from_id AND e.type = 'alignment-span' AND NOT e.deleted
       JOIN revision spr ON spr.id = e.main_rev WHERE y.to_id = s.id AND y.field = 'segment' ORDER BY e.id LIMIT 1
     ) sp ON TRUE
     WHERE s.id = ANY($1) AND NOT s.deleted`,
    [segmentIds],
  );
  const onSite = new Map(now.map((s) => [s.id, s]));

  // Which recording and farbrengen each transcript is of; a text that is no transcript leaves its Suggestion out.
  const textIds = [
    ...new Set(
      [
        ...now.map((s) => s.text),
        ...rows.map((r) =>
          r.entity_type === "segment"
            ? (r.data?.text as string | undefined)
            : undefined,
        ),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
  const { rows: texts } = await catalog.db.query<{
    id: EntityId;
    language: string | null;
    recording: EntityId;
    recording_title: Json | null;
    event: EntityId | null;
    path: string | null;
    event_title: Json | null;
    date: string | null;
  }>(
    `SELECT t.id, tr.data->>'language' AS language, rec.id AS recording, rr.data->'title' AS recording_title,
            ev.id AS event, ev.path, er.data->'title' AS event_title, er.data->>'date' AS date
     FROM entity t JOIN revision tr ON tr.id = t.main_rev AND tr.data->>'kind' = 'transcript'
     JOIN entity rec ON rec.id = tr.data->>'recording' AND NOT rec.deleted JOIN revision rr ON rr.id = rec.main_rev
     LEFT JOIN entity ev ON ev.id = rr.data->>'event' AND NOT ev.deleted LEFT JOIN revision er ON er.id = ev.main_rev
     WHERE t.id = ANY($1) AND NOT t.deleted`,
    [textIds],
  );
  const transcript = new Map(texts.map((t) => [t.id, t]));

  const fixes = new Map<number, TranscriptFix>();
  const ms = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : Number(v);
  for (const r of rows) {
    const d = r.data ?? {};
    const segment = (
      r.entity_type === "segment" ? r.entity_id : String(d.segment ?? "")
    ) as EntityId;
    const site = onSite.get(segment);
    const text = transcript.get((site?.text ?? d.text) as EntityId);
    if (!text) continue;
    let change: TranscriptFixChange | null = null;
    const heard = { startMs: ms(site?.start_ms), endMs: ms(site?.end_ms) };
    if (r.entity_type === "segment") {
      if (r.data === null) continue;
      const after = typeof d.content === "string" ? d.content : null;
      const before = site?.content ?? null;
      change = {
        segment,
        kind: !site ? "new" : after === before ? "check" : "words",
        before,
        after,
        ...heard,
        order: String(d.order ?? site?.order ?? ""),
      };
    } else if (
      typeof d.startMs === "number" &&
      site &&
      d.startMs !== heard.startMs
    ) {
      change = {
        segment,
        kind: "timing",
        before: site.content,
        after: site.content,
        ...heard,
        newStartMs: d.startMs,
        order: site.order ?? "",
      };
    }
    if (!change) continue;
    let fix = fixes.get(Number(r.id));
    if (!fix) {
      fix = {
        id: Number(r.id),
        number: r.number !== null ? Number(r.number) : null,
        author: r.author,
        authorName: r.author_name,
        bot: Boolean(r.is_bot),
        at: new Date(r.at).toISOString(),
        recording: text.recording,
        recordingTitle: text.recording_title,
        event: text.event,
        eventPath: text.path,
        eventTitle: text.event_title,
        date: text.date,
        language: text.language,
        changes: [],
      };
      fixes.set(fix.id, fix);
    }
    // A paragraph whose words change and whose sync lets go of its word timings is one change: its words.
    if (
      change.kind === "timing" ||
      !fix.changes.some((c) => c.segment === segment)
    )
      fix.changes.push(change);
  }
  const list = [...fixes.values()].filter((f) => f.changes.length);
  for (const f of list)
    f.changes.sort((a, b) =>
      a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
    );
  // A farbrengen's fixes together, in the order they are heard.
  const first = (f: TranscriptFix) =>
    f.changes[0]?.startMs ?? Number.MAX_SAFE_INTEGER;
  return list.sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.recording.localeCompare(b.recording) ||
      first(a) - first(b) ||
      a.id - b.id,
  );
}
