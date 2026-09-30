import { recordingTranscript, type Catalog, type Json } from '@rebbehub/core';
import { carryWordTimes, type EntityId, type WordTime } from '@rebbehub/model';
import { ALIGN_BOT } from './transcribe.js';

/**
 * Word timings back for paragraphs fixed before fixes kept them. Until
 * then a fix let go of all of a paragraph's word timings, and the next
 * alignment run was to time the words again from the audio; for a
 * recording only linked (JEM's), that run never came, so the lyrics lit
 * such a paragraph only as a whole. Each such span's last word timings, in
 * its history, are carried to the paragraph's words as they now stand
 * (model/timing.ts): the words left as they were keep their times, the
 * words changed are timed between them. One suggestion per recording by
 * the alignment bot, approved by `approveAs`, marked `edited` so the
 * next alignment run still times them all from the audio.
 */
export async function restoreWordTimes(
  catalog: Catalog,
  input: { approveAs: string; recording?: EntityId; limit?: number; dryRun?: boolean; log?: (line: string) => void },
): Promise<Array<{ recording: EntityId; paragraphs: number }>> {
  const log = input.log ?? (() => {});
  const params: unknown[] = [];
  const only = input.recording ? `AND ar.data->>'recording' = $${params.push(input.recording)}` : '';
  // Spans with no word timings, not set by hand, whose history had some.
  const { rows: recordings } = await catalog.db.query<{ recording: EntityId }>(
    `SELECT DISTINCT ar.data->>'recording' AS recording
     FROM entity sp JOIN revision spr ON spr.id = sp.main_rev
     JOIN entity a ON a.id = spr.data->>'alignment' AND a.type = 'alignment' AND NOT a.deleted JOIN revision ar ON ar.id = a.main_rev
     WHERE sp.type = 'alignment-span' AND NOT sp.deleted AND NOT (spr.data ? 'words')
       AND NOT coalesce((spr.data->>'locked')::boolean, FALSE) AND ar.data->>'granularity' = 'word' ${only}
       AND EXISTS (SELECT 1 FROM revision h WHERE h.entity_id = sp.id AND h.data ? 'words')
     ORDER BY 1 LIMIT ${Math.min(input.limit ?? 50, 5000)}`,
    params,
  );
  if (!input.dryRun) await catalog.createAccount({ id: ALIGN_BOT, displayName: 'Machine sync', isBot: true });
  const done: Array<{ recording: EntityId; paragraphs: number }> = [];
  for (const { recording } of recordings) {
    const view = await recordingTranscript(catalog, recording);
    if (!view) continue;
    const revisions: Array<{ id: EntityId; data: Json }> = [];
    for (const p of view.paragraphs) {
      if (p.words || p.locked || !p.span) continue;
      const carried = await carriedFor(catalog, p.span, p.id, p.content);
      if (carried) revisions.push({ id: p.span, data: carried });
    }
    if (!revisions.length) continue;
    done.push({ recording, paragraphs: revisions.length });
    if (input.dryRun) {
      log(`${recording}: would give back word timings to ${revisions.length} paragraphs`);
      continue;
    }
    const suggestion = await catalog.createChangeset(ALIGN_BOT, { title: `Word timings kept through fixes, ${recording}` });
    for (const r of revisions) await catalog.putRevision(suggestion.id, ALIGN_BOT, { id: r.id, type: 'alignment-span', data: r.data });
    await catalog.submit(suggestion.id, ALIGN_BOT);
    await catalog.merge(suggestion.id, input.approveAs, {}, 'Machine sync, labelled as such until checked');
    log(`${recording}: word timings back for ${revisions.length} paragraphs`);
  }
  return done;
}

type SpanData = Record<string, unknown> & { words?: WordTime[]; origin?: Record<string, unknown> };

/** A span's data with its last word timings carried to the paragraph as it now stands; null when its history has none to go by. */
async function carriedFor(catalog: Catalog, span: EntityId, segment: EntityId, content: string): Promise<Json | null> {
  const { rows } = await catalog.db.query<{ id: string; parent_rev: string | null; changeset_id: string; data: SpanData | null }>(
    'SELECT id, parent_rev, changeset_id, data FROM revision WHERE entity_id = $1 ORDER BY id DESC',
    [span],
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const main = await catalog.db.query<{ main_rev: string }>('SELECT main_rev FROM entity WHERE id = $1', [span]);
  // Back from the span as it stands to the last revision with word timings; the one after it let them go.
  let at = byId.get(String(main.rows[0]?.main_rev));
  const current = at?.data;
  if (!current) return null;
  let dropped: (typeof rows)[number] | undefined;
  while (at && !at.data?.words?.length) {
    dropped = at;
    at = at.parent_rev ? byId.get(String(at.parent_rev)) : undefined;
  }
  if (!at?.data?.words || !dropped) return null;
  // The paragraph's words as they were then: before the fix that let the timings go.
  const fix = await catalog.db.query<{ parent: SpanData | null }>(
    `SELECT p.data AS parent FROM revision s JOIN revision p ON p.id = s.parent_rev
     WHERE s.entity_id = $1 AND s.changeset_id = $2 ORDER BY s.id LIMIT 1`,
    [segment, dropped.changeset_id],
  );
  const before = fix.rows[0]?.parent?.content;
  if (typeof before !== 'string') return null;
  const words = carryWordTimes(before, at.data.words, content);
  if (!words) return null;
  return { ...current, words, ...(current.origin ? { origin: { ...current.origin, edited: true } } : {}) } as unknown as Json;
}
