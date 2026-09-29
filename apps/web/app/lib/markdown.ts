/**
 * The repository's own Markdown (docs/*.md) as HTML, for the developer
 * docs at /developers. Only what the docs use: headings with anchors,
 * paragraphs, lists (nested by indent), fenced code, tables, quotes, rules,
 * and inline code, bold, italics and links. Everything is escaped first,
 * so a page can hold nothing but what these rules make.
 *
 * `link` rewrites each link's address: a doc that is one of the site's
 * pages opens there, any other file in the repository on GitHub.
 */

export interface MarkdownOptions {
  link?: (href: string) => string;
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A heading's anchor: lower case, words joined by hyphens, as GitHub makes them. */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function inline(text: string, options: MarkdownOptions): string {
  // Code first, kept aside so nothing inside it is read as Markdown.
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => `\u0000${codes.push(`<code>${escape(code)}</code>`) - 1}\u0000`);
  out = escape(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const given = options.link ? options.link(href.replace(/&amp;/g, '&')) : href.replace(/&amp;/g, '&');
    // Only web addresses, mail and places on the site: never a script.
    const target = /^[a-z][a-z0-9+.-]*:/i.test(given) && !/^(https?|mailto):/i.test(given) ? '#' : given;
    const external = /^https?:\/\//.test(target);
    return `<a href="${escape(target)}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, n: string) => codes[Number(n)]!);
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

/** Renders Markdown to HTML, and lists its headings (for a page's contents). */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): { html: string; headings: Heading[]; title: string | null } {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  let title: string | null = null;
  let i = 0;

  const isBlockStart = (line: string) => /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s|---+\s*$|\|)/.test(line);

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = /^```\s*([\w-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      const lang = fence[1] ? ` class="language-${escape(fence[1])}"` : '';
      out.push(`<pre dir="ltr"><code${lang}>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      const text = heading[2]!.trim();
      if (depth === 1 && title === null) title = text.replace(/`/g, '');
      let id = slugOf(text);
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      headings.push({ depth, text: text.replace(/`/g, ''), id });
      out.push(`<h${depth} id="${escape(id)}">${inline(text, options)}</h${depth}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) body.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), options).html}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!)) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      out.push(
        `<div class="table-scroll"><table><thead><tr>${head.map((h) => `<th>${inline(h, options)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, n) => `<td>${inline(r[n] ?? '', options)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]!);
      const indent = item[1]!.length;
      const items: string[] = [];
      while (i < lines.length) {
        const current = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!current || current[1]!.length !== indent) break;
        const body = [current[3]!];
        i++;
        // The item's own continued lines, and anything indented under it (a nested list, code).
        while (i < lines.length && lines[i]!.trim() !== '' && !/^(\s*)([-*+]|\d+\.)\s/.test(lines[i]!) && !isBlockStart(lines[i]!.trimStart()) ) body.push(lines[i++]!.trim());
        const nested: string[] = [];
        while (i < lines.length && (lines[i]!.trim() === '' ? /^\s{2,}\S/.test(lines[i + 1] ?? '') : lines[i]!.length - lines[i]!.trimStart().length > indent)) nested.push(lines[i++]!.slice(indent + 2));
        items.push(`<li>${inline(body.join(' '), options)}${nested.length ? renderMarkdown(nested.join('\n'), options).html : ''}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !(para.length && isBlockStart(lines[i]!))) para.push(lines[i++]!.trim());
    out.push(`<p>${inline(para.join(' '), options)}</p>`);
  }
  return { html: out.join('\n'), headings, title };
}
