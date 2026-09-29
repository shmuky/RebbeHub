import type { LocalName } from '@rebbehub/model';
import type { Entity, HanachaSync, RebbeHubApi } from './api.js';
import { nameOf, type Lang } from './i18n.js';
import { labelOf } from './labels.js';
import { itemPath } from './links.js';

/**
 * A farbrengen's page as it is heard and read: what was said there (each
 * sicha and maamar, where it is printed and on what page, whether it is
 * mugah, and the moment it is heard in the recording), and its words,
 * the original and its English translation paragraph by paragraph, with
 * where each paragraph is heard when a sync has placed it. A sync the
 * machine made is marked so until a person checks it.
 */

export interface SaidRow {
  id: string;
  path: string;
  label: string;
  /** "ספר המאמרים באתי לגני ח״א" */
  source: string | null;
  page: number | null;
  /** From its text: an edition is mugah, a hanacha is not. */
  status: 'mugah' | 'bilti-mugah' | null;
  /** Where it starts in the farbrengen's recordings, when a sync says. */
  at: { recording: string; startMs: number } | null;
}

export interface EventParagraph {
  id: string;
  content: string;
  checked: boolean;
  /** Where it is heard, when synced. */
  startMs: number | null;
  endMs: number | null;
}

export interface EventText {
  unit: string;
  label: string;
  source: string | null;
  page: number | null;
  kind: string;
  original: EventParagraph[];
  /** The English translation, paragraph for paragraph where it has them. */
  english: Array<{ id: string; content: string }> | null;
  /** The recording its paragraphs are synced to, and whether a person has checked the sync. */
  sync: { recording: string; checked: boolean } | null;
}

export interface EventView {
  said: SaidRow[];
  texts: EventText[];
}

type D = Record<string, unknown>;

/** Paragraphs shown on the farbrengen's page; the unit's own page has them all. */
const MAX_PARAGRAPHS = 200;

export async function eventView(api: RebbeHubApi, units: Entity[], recordings: Entity[], lang: Lang): Promise<EventView> {
  const list = units.slice(0, 12);
  // Each unit's work (and volume), where it is printed, and its texts.
  const works = await api.entities([...new Set(list.map((u) => String((u.data as D).work ?? '')).filter(Boolean))]).catch(() => new Map<string, Entity>());
  // Where each sicha is printed and its texts, one request each for all of them; and all the parts' synced
  // hanachos in one (a farbrengen may have forty parts, and a dozen sichos).
  const ids = list.map((u) => u.id);
  const [mapsOf, textsOf, syncOfRecording] = await Promise.all([
    api.linkedOfEach(ids, { field: 'unit', type: 'contents-map', limit: 20 }).catch(() => new Map<string, Entity[]>()),
    api.linkedOfEach(ids, { field: 'unit', type: 'text', limit: 20 }).catch(() => new Map<string, Entity[]>()),
    api.hanachaSyncs(recordings.map((r) => r.id)).catch(() => new Map<string, HanachaSync>()),
  ]);
  const syncs = recordings.map((r) => syncOfRecording.get(r.id) ?? null);

  // Where each synced paragraph is heard, by segment id.
  const heard = new Map<string, { recording: string; startMs: number | null; endMs: number | null; checked: boolean }>();
  const syncOf = new Map<string, { recording: string; checked: boolean }>();
  syncs.forEach((s, i) => {
    if (!s) return;
    const recording = recordings[i]!.id;
    syncOf.set(s.text, { recording, checked: s.paragraphs.every((p) => p.checked || p.startMs === null) });
    for (const p of s.paragraphs) heard.set(p.id, { recording, startMs: p.startMs, endMs: p.endMs, checked: p.checked });
  });

  // Each sicha's words to show (its edition, else its hanacha or transcript) and their English, chosen first so
  // that every text's paragraphs come in one request.
  const chosen = list.map((u) => {
    const own = textsOf.get(u.id) ?? [];
    const original = own.find((t) => (t.data as D).kind === 'edition') ?? own.find((t) => (t.data as D).kind === 'hanacha') ?? own.find((t) => (t.data as D).kind === 'transcript');
    const translation = original ? own.find((t) => (t.data as D).kind === 'translation' && (t.data as D).language === 'en' && ((t.data as D).translationOf === original.id || !(t.data as D).translationOf)) : undefined;
    return { original, translation };
  });
  const paragraphsOf = await api.linkedOfEach(chosen.flatMap((c) => [c.original?.id, c.translation?.id].filter((id): id is string => Boolean(id))), { field: 'text', type: 'segment', limit: MAX_PARAGRAPHS }).catch(() => new Map<string, Entity[]>());

  const said: SaidRow[] = [];
  const texts: EventText[] = [];
  const shown = new Set<string>();
  for (const [i, u] of list.entries()) {
    const d = u.data as { work?: string; position?: Array<{ level: string; value: string; label?: LocalName }> };
    const work = d.work ? works.get(d.work) : undefined;
    const volume = d.position && d.position.length > 1 ? d.position[0] : undefined;
    const source = work ? [labelOf(work, lang), volume ? nameOf(volume.label, lang) || volume.value : null].filter(Boolean).join(' ') : null;
    const map = (mapsOf.get(u.id) ?? [])[0];
    const page = (map?.data as { pages?: { from: number } } | undefined)?.pages?.from ?? null;
    const { original, translation } = chosen[i]!;
    const kind = original ? String((original.data as D).kind) : null;

    let first: SaidRow['at'] = null;
    if (original) {
      const segments = paragraphsOf.get(original.id) ?? [];
      const english = translation ? (paragraphsOf.get(translation.id) ?? []) : null;
      const paragraphs = segments
        .filter((s) => (s.data as D).kind !== 'heading')
        .map((s) => {
          const h = heard.get(s.id);
          return { id: s.id, content: String((s.data as D).content ?? ''), checked: Number((s.data as D).proofread ?? 0) >= 1, startMs: h?.startMs ?? null, endMs: h?.endMs ?? null };
        });
      const sync = syncOf.get(original.id) ?? null;
      const start = paragraphs.find((p) => p.startMs !== null);
      if (sync && start) first = { recording: sync.recording, startMs: start.startMs! };
      if (paragraphs.length) shown.add(original.id);
      if (paragraphs.length)
        texts.push({
          unit: u.id,
          label: labelOf(u, lang),
          source,
          page,
          kind: kind!,
          original: paragraphs,
          english: english?.length ? english.filter((s) => (s.data as D).kind !== 'heading').map((s) => ({ id: s.id, content: String((s.data as D).content ?? '') })) : null,
          sync,
        });
    }
    said.push({ id: u.id, path: itemPath(u), label: labelOf(u, lang), source, page, status: kind === 'edition' ? 'mugah' : kind === 'hanacha' || kind === 'transcript' ? 'bilti-mugah' : null, at: first });
  }
  // A hanacha synced to a recording but kept for the farbrengen as a whole, not for one sicha.
  syncs.forEach((sync, i) => {
    if (!sync || shown.has(sync.text)) return;
    texts.push({
      unit: '',
      label: lang === 'he' ? 'הנחה' : 'Hanacha',
      source: null,
      page: null,
      kind: 'hanacha',
      original: sync.paragraphs.map((p) => ({ id: p.id, content: p.content, checked: true, startMs: p.startMs, endMs: p.endMs })),
      english: null,
      sync: syncOf.get(sync.text) ?? { recording: recordings[i]!.id, checked: false },
    });
  });
  return { said, texts };
}

