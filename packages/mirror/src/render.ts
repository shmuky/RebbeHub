import type { EntityView, Json } from '@rebbehub/core';
import type { AlignmentSpanData, EntityId, SegmentData, TextData } from '@rebbehub/model';

/** JSON with keys sorted and two-space indents: the same item always writes the same bytes, so git diffs show only real changes. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function renderEntity(view: EntityView): string {
  return stableJson({ id: view.id, type: view.type, path: view.path, rev: view.rev, data: view.data });
}

const yamlValue = (v: string | number | boolean): string => (typeof v === 'string' ? JSON.stringify(v) : String(v));

/**
 * A text as Markdown: front matter with the text's fields, then each
 * segment under a comment that carries its permanent id and state, so a
 * citation can link to `#rh-…` and the file parses back exactly. Machine
 * text is labelled on every segment until a person has checked it.
 */
export function renderText(text: EntityView, segments: EntityView[], options: { withheld?: string } = {}): string {
  const data = text.data as unknown as TextData;
  const front: Array<[string, string | number | boolean]> = [
    ['id', text.id],
    ['type', 'text'],
    ['rev', text.rev],
  ];
  for (const [k, v] of Object.entries(data)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') front.push([k, v]);
  if (text.path) front.push(['path', text.path]);
  if (options.withheld) front.push(['withheld', options.withheld]);
  const lines = ['---', ...front.map(([k, v]) => `${k}: ${yamlValue(v)}`), '---', ''];
  if (options.withheld) {
    lines.push(`<!-- The words of this text are not exported: ${options.withheld}. -->`, '');
    return lines.join('\n');
  }
  for (const segment of segments) {
    const s = segment.data as unknown as SegmentData;
    const attrs = [`order=${s.order}`, `kind=${s.kind}`, `proofread=${s.proofread}`, `rev=${segment.rev}`];
    if (s.origin) attrs.push(`machine=${JSON.stringify(s.origin.by)}`, `checked=${s.origin.checked === true}`);
    lines.push(`<a id="${segment.id}"></a>`, `<!-- segment ${segment.id} ${attrs.join(' ')} -->`);
    lines.push(s.kind === 'heading' ? `## ${s.content}` : s.content.replace(/\n{2,}/g, '\n'), '');
  }
  return lines.join('\n');
}

export interface ParsedSegment {
  id: EntityId;
  order: string;
  kind: SegmentData['kind'];
  proofread: number;
  content: string;
}

/** Reads the segments back from a text's Markdown (for tools that work on a clone of the mirror). */
export function parseTextSegments(markdown: string): ParsedSegment[] {
  const out: ParsedSegment[] = [];
  const pattern = /<!-- segment (rh-[0-9a-z]+) order=(\S+) kind=(\S+) proofread=(\d)[^>]*-->\n([\s\S]*?)(?=\n<a id=|\n?$)/g;
  for (const match of markdown.matchAll(pattern)) {
    const kind = match[3] as SegmentData['kind'];
    let content = match[5]!.replace(/\n+$/, '');
    if (kind === 'heading') content = content.replace(/^## /, '');
    out.push({ id: match[1] as EntityId, order: match[2]!, kind, proofread: Number(match[4]), content });
  }
  return out;
}

function timestamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

/**
 * An alignment as WebVTT: one cue per span, identified by its segment's
 * id, holding the segment's words; word-level sync as WebVTT's own
 * in-cue timestamps, so an ordinary player highlights word by word.
 */
export function renderAlignment(alignment: EntityView, spans: EntityView[], segments: ReadonlyMap<string, EntityView>): string {
  const a = alignment.data as { recording: string; text: string; granularity: string };
  const lines = ['WEBVTT', '', `NOTE rebbehub alignment=${alignment.id} rev=${alignment.rev} recording=${a.recording} text=${a.text} granularity=${a.granularity}`, ''];
  for (const span of spans) {
    const s = span.data as unknown as AlignmentSpanData;
    const content = ((segments.get(s.segment)?.data as unknown as SegmentData | undefined)?.content ?? '').replace(/-->/g, '→').replace(/\n+/g, ' ');
    let payload = content;
    if (s.words && s.words.length > 0) {
      payload = '';
      let at = 0;
      for (const w of [...s.words].sort((x, y) => x.from - y.from)) {
        payload += content.slice(at, w.from);
        payload += `<${timestamp(w.startMs)}>${content.slice(w.from, w.to)}`;
        at = w.to;
      }
      payload += content.slice(at);
    }
    const notes = [s.locked ? 'locked' : null, s.origin ? `machine=${s.origin.by}` : null].filter(Boolean);
    if (notes.length > 0) lines.push(`NOTE ${s.segment} ${notes.join(' ')}`, '');
    lines.push(s.segment, `${timestamp(s.startMs)} --> ${timestamp(s.endMs)}`, payload || '…', '');
  }
  return lines.join('\n');
}

export type { Json };
