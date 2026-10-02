import { tidyInline, type PageInline, type PageMark } from '@rebbehub/model';

/**
 * The in-place editor's content (components/SegmentEditor.tsx) and a
 * segment's words, both ways: runs drawn as editable DOM, and the DOM
 * read back as runs. Plain TypeScript, so it is tested without a browser.
 */

const TAGS: Record<PageMark, string> = { b: 'b', i: 'i', u: 'u', small: 'small', sup: 'sup', sub: 'sub', ois: 'span' };
const MARK_OF: Record<string, PageMark> = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', small: 'small', sup: 'sup', sub: 'sub' };
// The ois letter is a span carrying data-mark="ois" (no HTML tag means it).
const DATA_MARK = 'ois';

/** A segment's words as the editor's content: text in its marks, links, breaks; footnote marks and source markers as pieces that cannot be typed into; printed line ends as empty pieces. */
export function fill(el: HTMLElement, runs: readonly PageInline[], labelOf: (note: string) => string) {
  el.textContent = '';
  for (const run of runs) {
    if ('text' in run) {
      let node: Node = document.createTextNode(run.text);
      for (const mark of [...(run.marks ?? [])].reverse()) {
        const wrap = document.createElement(TAGS[mark]);
        if (mark === 'ois') {
          wrap.dataset.mark = DATA_MARK;
          wrap.className = 'words-ois';
        }
        wrap.appendChild(node);
        node = wrap;
      }
      if (run.href) {
        const a = document.createElement('a');
        a.dataset.href = run.href;
        a.appendChild(node);
        node = a;
      }
      el.appendChild(node);
    } else if ('br' in run) {
      el.appendChild(document.createElement('br'));
    } else if ('eol' in run) {
      // A printed line's end: nothing to see or type, but kept, so fixing a word never loses the print's lines.
      const end = document.createElement('span');
      end.contentEditable = 'false';
      end.className = 'words-eol';
      end.dataset.run = JSON.stringify(run);
      el.appendChild(end);
    } else {
      const atom = document.createElement('span');
      atom.contentEditable = 'false';
      atom.className = 'words-atom';
      atom.dataset.run = JSON.stringify(run);
      atom.textContent = 'note' in run ? labelOf(run.note) : run.marker;
      el.appendChild(atom);
    }
  }
}

/** The editor's content read back as runs: only the fixed marks, links and pieces it was given; any other element's words, as words. */
export function readRuns(root: Node): PageInline[] {
  const out: PageInline[] = [];
  const walk = (node: Node, marks: PageMark[], link: string | undefined) => {
    if (node.nodeType === 3) {
      out.push({ text: node.textContent ?? '', ...(marks.length ? { marks: [...marks] } : {}), ...(link ? { href: link } : {}) });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    if (el.dataset?.run) {
      try {
        out.push(JSON.parse(el.dataset.run) as PageInline);
      } catch {
        // not one of ours: dropped
      }
      return;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      out.push({ br: true });
      return;
    }
    // A new line the browser made as a block of its own.
    if ((tag === 'div' || tag === 'p') && out.length) out.push({ br: true });
    const mark = el.dataset?.mark === DATA_MARK ? 'ois' : MARK_OF[tag];
    const inner = mark && !marks.includes(mark) ? [...marks, mark] : marks;
    const innerLink = tag === 'a' && el.dataset.href ? el.dataset.href : link;
    el.childNodes.forEach((child) => walk(child, inner, innerLink));
  };
  root.childNodes.forEach((child) => walk(child, [], undefined));
  return tidyInline(out);
}
