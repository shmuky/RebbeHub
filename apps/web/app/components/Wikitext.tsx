import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';

/**
 * A page's wikitext, drawn as the page (the plan's wiki model: every item
 * is a page people read and edit). The subset a catalog page needs:
 *
 *   == heading ==            '''bold'''  ''italic''  <u> <sup> <sub> <small> <br />
 *   * list  # numbered  : indented       [[/path|label]]  [[rh-id|label]]  [https://… label]
 *   <ref>a note</ref>  (numbered, listed at the foot)   ----   <nowiki/>
 *
 * Everything is built as React elements, never as raw HTML, so whatever
 * anyone writes on a page cannot run on it.
 */

interface Note {
  n: number;
  content: ReactNode;
}

const INLINE = /('''|''|\[\[[^\]\n]+\]\]|\[https?:\/\/[^\s\]]+(?: [^\]\n]+)?\]|<ref>[\s\S]*?<\/ref>|<br\s*\/?>|<nowiki\s*\/>|<\/?(?:u|sup|sub|small)>|&(?:lt|gt|amp|quot|nbsp);)/;

function internalHref(target: string, lang: Lang): string {
  const t = target.trim();
  if (/^rh-[0-9a-z]+$/i.test(t)) return href(`/${t.toLowerCase()}`, lang);
  if (t.startsWith('/')) return href(t, lang);
  return href('/search', lang, { q: t });
}

/** One line's inline markup as elements; `notes` gathers its <ref>s. */
function inline(text: string, lang: Lang, notes: Note[], key = 'i'): ReactNode[] {
  const parts = text.split(INLINE);
  // Open styles, as a stack of [kind, children-so-far].
  const stack: Array<{ kind: string; children: ReactNode[] }> = [{ kind: 'root', children: [] }];
  const top = () => stack[stack.length - 1]!;
  const close = (kind: string) => {
    const at = stack.map((s) => s.kind).lastIndexOf(kind);
    if (at <= 0) return false;
    while (stack.length > at) {
      const done = stack.pop()!;
      const k = `${key}-${stack.length}-${top().children.length}`;
      const el =
        done.kind === "'''" ? <b key={k}>{done.children}</b> : done.kind === "''" ? <i key={k}>{done.children}</i> : done.kind === 'u' ? <u key={k}>{done.children}</u> : done.kind === 'sup' ? <sup key={k}>{done.children}</sup> : done.kind === 'sub' ? <sub key={k}>{done.children}</sub> : <small key={k}>{done.children}</small>;
      top().children.push(el);
    }
    return true;
  };
  parts.forEach((part, i) => {
    if (!part) return;
    const k = `${key}-${i}`;
    if (part === "'''" || part === "''") {
      if (!close(part)) stack.push({ kind: part, children: [] });
    } else if (/^<(u|sup|sub|small)>$/.test(part)) {
      stack.push({ kind: part.slice(1, -1), children: [] });
    } else if (/^<\/(u|sup|sub|small)>$/.test(part)) {
      close(part.slice(2, -1));
    } else if (/^<br/.test(part)) {
      top().children.push(<br key={k} />);
    } else if (/^<nowiki/.test(part)) {
      // nothing: it only keeps markup around it from being read as markup
    } else if (part.startsWith('[[')) {
      const [target, label] = part.slice(2, -2).split('|');
      top().children.push(
        <Link key={k} to={internalHref(target!, lang)}>
          {label ?? target}
        </Link>,
      );
    } else if (part.startsWith('[http')) {
      const inner = part.slice(1, -1);
      const space = inner.indexOf(' ');
      const url = space === -1 ? inner : inner.slice(0, space);
      top().children.push(
        <a key={k} href={url} target="_blank" rel="noopener nofollow">
          {space === -1 ? url : inner.slice(space + 1)}
        </a>,
      );
    } else if (part.startsWith('<ref>')) {
      const n = notes.length + 1;
      notes.push({ n, content: inline(part.slice(5, -6), lang, notes, `${k}-ref`) });
      top().children.push(
        <sup key={k} className="ref" id={`ref-${n}`}>
          <a href={`#note-${n}`}>[{n}]</a>
        </sup>,
      );
    } else if (part.startsWith('&')) {
      top().children.push({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&nbsp;': ' ' }[part] ?? part);
    } else {
      top().children.push(part);
    }
  });
  // Styles left open close at the end of the line, as on a wiki.
  while (stack.length > 1) close(top().kind);
  return stack[0]!.children;
}

export function Wikitext({ text, lang, className }: { text: string; lang: Lang; className?: string }) {
  const notes: Note[] = [];
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { kind: 'ul' | 'ol' | 'dl'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p${blocks.length}`}>{inline(paragraph.join(' '), lang, notes, `p${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const items = list.items.map((item, i) => (list!.kind === 'dl' ? <dd key={i}>{inline(item, lang, notes, `${k}-${i}`)}</dd> : <li key={i}>{inline(item, lang, notes, `${k}-${i}`)}</li>));
    blocks.push(list.kind === 'ul' ? <ul key={k}>{items}</ul> : list.kind === 'ol' ? <ol key={k}>{items}</ol> : <dl key={k}>{items}</dl>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(={2,5})\s*(.+?)\s*\1$/.exec(line);
    const item = /^([*#:])\s*(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const k = `h${blocks.length}`;
      const content = inline(heading[2]!, lang, notes, k);
      blocks.push(level === 2 ? <h2 key={k}>{content}</h2> : level === 3 ? <h3 key={k}>{content}</h3> : <h4 key={k}>{content}</h4>);
    } else if (/^-{4,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`r${blocks.length}`} />);
    } else if (item) {
      flushParagraph();
      const kind = item[1] === '*' ? 'ul' : item[1] === '#' ? 'ol' : 'dl';
      if (list && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(item[2]!);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return (
    <div className={['wikitext', className].filter(Boolean).join(' ')} dir="auto">
      {blocks}
      {notes.length ? (
        <ol className="wikitext-notes">
          {notes.map((note) => (
            <li key={note.n} id={`note-${note.n}`}>
              <Fragment>{note.content}</Fragment> <a href={`#ref-${note.n}`}>↩</a>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

