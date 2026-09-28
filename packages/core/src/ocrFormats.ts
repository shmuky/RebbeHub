import type { TextLine } from '@rebbehub/model';

/**
 * OCR people bring (the plan, section 7: "anyone can also upload their own
 * OCR for it"), read from the formats OCR programs write: hOCR (Tesseract,
 * OCRopus, Kraken), ALTO XML (ABBYY, Transkribus, eScriptorium, the
 * libraries), or plain text, with pages parted by form feeds as `pdftotext`
 * and most programs write them. Each becomes pages of lines, with where a
 * line stands when the format says. Read with plain code, no XML library,
 * so it runs the same on Workers and in Node.
 */

export type OcrFormat = 'hocr' | 'alto' | 'text';

export interface OcrPage {
  lines: TextLine[];
}

const MAX_LINE = 2000;

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const clean = (text: string) => decode(text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);
const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

function boxOf(x0: number, y0: number, x1: number, y1: number, width: number, height: number): TextLine['box'] {
  if (!(width > 0 && height > 0) || ![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return undefined;
  return [round(x0 / width), round(y0 / height), round((x1 - x0) / width), round((y1 - y0) / height)];
}

function numbered(lines: Array<{ text: string; box?: TextLine['box'] }>): TextLine[] {
  return lines.filter((l) => l.text).map((l, i) => ({ id: `l${i + 1}`, text: l.text, ...(l.box ? { box: l.box } : {}) }));
}

/** An attribute of one tag, whatever order they come in. */
function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);
}

function bboxOf(tag: string): [number, number, number, number] | null {
  const m = /bbox\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(attr(tag, 'title') ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

/** hOCR: `ocr_page` elements, their `ocr_line`s (and headers, captions, floating text), each line's words. */
export function parseHocr(html: string): OcrPage[] {
  const pageTags = [...html.matchAll(/<\w+\b[^>]*\bclass\s*=\s*["'][^"']*\bocr_page\b[^"']*["'][^>]*>/gi)];
  return pageTags.map((p, k) => {
    const end = pageTags[k + 1]?.index ?? html.length;
    const chunk = html.slice(p.index!, end);
    const page = bboxOf(p[0]);
    const [width, height] = page ? [page[2] - page[0], page[3] - page[1]] : [0, 0];
    const lineTags = [...chunk.matchAll(/<\w+\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:ocr_line|ocrx_line|ocr_textfloat|ocr_header|ocr_caption)\b[^"']*["'][^>]*>/gi)];
    const lines = lineTags.map((l, i) => {
      const body = chunk.slice(l.index! + l[0].length, lineTags[i + 1]?.index ?? chunk.length);
      const wordTexts = [...body.matchAll(/<\w+\b[^>]*\bclass\s*=\s*["'][^"']*\bocrx_word\b[^"']*["'][^>]*>([\s\S]*?)<\/\w+>/gi)].map((w) => clean(w[1]!.replace(/<[^>]*>/g, '')));
      const text = wordTexts.length ? clean(wordTexts.filter(Boolean).join(' ')) : clean(body.replace(/<[^>]*>/g, ' '));
      const b = bboxOf(l[0]);
      return { text, box: b && page ? boxOf(b[0] - page[0], b[1] - page[1], b[2] - page[0], b[3] - page[1], width, height) : undefined };
    });
    return { lines: numbered(lines) };
  });
}

/** ALTO: `Page`s, their `TextLine`s, each line's `String CONTENT`s; positions in the page's own units. */
export function parseAlto(xml: string): OcrPage[] {
  const pageTags = [...xml.matchAll(/<(?:\w+:)?Page\b[^>]*>/g)];
  return pageTags.map((p, k) => {
    const chunk = xml.slice(p.index!, pageTags[k + 1]?.index ?? xml.length);
    const width = Number(attr(p[0], 'WIDTH') ?? 0);
    const height = Number(attr(p[0], 'HEIGHT') ?? 0);
    const lines = [...chunk.matchAll(/<(?:\w+:)?TextLine\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?TextLine>/g)].map((l) => {
      const tag = `<TextLine ${l[1]}>`;
      const text = clean([...l[2]!.matchAll(/<(?:\w+:)?String\b[^>]*>/g)].map((s) => attr(s[0], 'CONTENT') ?? '').filter(Boolean).join(' '));
      const [x, y, w, h] = ['HPOS', 'VPOS', 'WIDTH', 'HEIGHT'].map((n) => Number(attr(tag, n)));
      return { text, box: boxOf(x!, y!, x! + w!, y! + h!, width, height) };
    });
    return { lines: numbered(lines) };
  });
}

/** Plain text: pages parted by form feeds, a line per line; no positions. */
export function parsePlainText(text: string): OcrPage[] {
  const pages = text.replace(/\r\n?/g, '\n').split('\f');
  if (pages.length > 1 && !pages.at(-1)!.trim()) pages.pop();
  return pages.map((page) => ({ lines: numbered(page.split('\n').map((l) => ({ text: clean(l) }))) }));
}

export function parseOcr(format: OcrFormat, content: string): OcrPage[] {
  if (format === 'hocr') return parseHocr(content);
  if (format === 'alto') return parseAlto(content);
  return parsePlainText(content);
}

/** Which format a file is, by what it holds: ALTO and hOCR say so near the top. */
export function sniffOcrFormat(content: string): OcrFormat {
  const head = content.slice(0, 4000);
  if (/<(?:\w+:)?alto\b/i.test(head)) return 'alto';
  if (/ocr_page|ocr-system|ocr-capabilities/i.test(content.slice(0, 20000))) return 'hocr';
  return 'text';
}
