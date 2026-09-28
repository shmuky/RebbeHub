/**
 * The HTML texts Sichos-Kodesh publishes (one `<article>` per chapter or
 * letter: paragraphs, bold, italic, underline, line breaks, the day marks
 * of the Tanya's study cycle, and a source footer) as wikitext, the form
 * every RebbeHub page is written and edited in. Only what those texts use
 * is kept; any other tag is dropped and its words kept. The footer is not
 * part of the text: `sourceFooter` reads it for the page's source record.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Wikitext's own markup, taken literally where it appears in a text. */
function escapeWiki(text: string): string {
  return text.replace(/</g, '&lt;').replace(/''/g, "'<nowiki/>'").replace(/\[\[/g, '[<nowiki/>[').replace(/\{\{/g, '{<nowiki/>{');
}

export interface SourceFooter {
  version?: string;
  licence?: string;
  url?: string;
}

/** What the text's footer says of where it is from: its version, licence and page. */
export function sourceFooter(html: string): SourceFooter {
  const footer = /<footer[^>]*>([\s\S]*?)<\/footer>/i.exec(html)?.[1];
  if (!footer) return {};
  const out: SourceFooter = {};
  for (const m of footer.matchAll(/<span class="([^"]*)">([\s\S]*?)<\/span>/g)) {
    if (m[1] === 'version') out.version = decode(m[2]!.trim());
    if (m[1] === 'licence') out.licence = decode(m[2]!.trim());
  }
  const href = /<a [^>]*href="([^"]+)"/i.exec(footer)?.[1];
  if (href) out.url = decode(href);
  return out;
}

/** The article's words as wikitext: paragraphs apart, '''bold''', ''italic'', <u>underline</u>, <br /> within a paragraph. */
export function htmlToWikitext(html: string): string {
  const body = html
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '') // the title is the page's own name
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const out: string[] = [];
  let line = '';
  const flush = () => {
    const text = line.replace(/[ \t]+/g, ' ').replace(/ *<br \/> */g, '<br />').trim();
    if (text) out.push(text);
    line = '';
  };
  for (const token of body.split(/(<[^>]+>)/)) {
    if (!token) continue;
    if (token[0] !== '<') {
      line += escapeWiki(decode(token).replace(/\s+/g, ' '));
      continue;
    }
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    if (!tag) continue;
    const [, close, rawName] = tag;
    const name = rawName!.toLowerCase();
    if (name === 'p' || name === 'div' || name === 'li' || name === 'blockquote' || name === 'article' || name === 'section') {
      flush();
    } else if (/^h[2-6]$/.test(name)) {
      if (!close) flush();
      else {
        const level = Number(name[1]);
        const text = line.trim();
        line = '';
        if (text) out.push(`${'='.repeat(level)} ${text} ${'='.repeat(level)}`);
      }
    } else if (name === 'br') {
      line += '<br />';
    } else if (name === 'b' || name === 'strong') {
      line += "'''";
    } else if (name === 'i' || name === 'em') {
      line += "''";
    } else if (name === 'u' || name === 'sup' || name === 'sub' || name === 'small') {
      line += `<${close}${name}>`;
    }
  }
  flush();
  // A bold mark with nothing inside it is dropped.
  return out
    .map((p) => p.replace(/(?<!')'''\s*'''(?!')/g, '').trim())
    .filter(Boolean)
    .join('\n\n');
}
