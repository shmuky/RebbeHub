import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { tokenize } from '@rebbehub/model';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { personPath } from '../lib/threads.js';

/**
 * `@handle` as a link to the person and `#12` to the suggestion or issue
 * (an issue's page sends a suggestion's number on), read as the API reads
 * them (@rebbehub/model's mentions.ts); the rest stays words as written.
 */
function withMentions(text: string, lang: Lang, key: string): ReactNode[] {
  return tokenize(text).map((token, i) =>
    token.kind === 'mention' ? (
      <Link key={`${key}-m${i}`} className="th-mention" to={href(personPath(token.username), lang)}>
        {token.text}
      </Link>
    ) : token.kind === 'ref' ? (
      <Link key={`${key}-m${i}`} className="th-ref" to={href(`/issues/${token.number}`, lang)}>
        {token.text}
      </Link>
    ) : token.kind === 'code' ? (
      `\`${token.text}\``
    ) : (
      token.text
    ),
  );
}

/** A web address, an item's id (`rh-…`) or a path on the site (`/likkutei-sichos/12`), where they stand in plain words. */
const LINKABLE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'׳״]|\brh-[0-9a-hjkmnp-tv-z]{6,16}\b|(?<![\w/])\/[a-z0-9][a-z0-9/-]*[a-z0-9])/gi;

function linked(line: string, lang: Lang, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(LINKABLE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...withMentions(line.slice(last, at), lang, `${key}-${last}`));
    const target = m[0];
    out.push(
      /^https?:/i.test(target) ? (
        <a key={`${key}-${at}`} href={target} target="_blank" rel="noopener nofollow ugc">
          {target}
        </a>
      ) : (
        <Link key={`${key}-${at}`} to={href(target.startsWith('/') ? target : `/${target.toLowerCase()}`, lang)}>
          {target}
        </Link>
      ),
    );
    last = at + target.length;
  }
  if (last < line.length) out.push(...withMentions(line.slice(last), lang, `${key}-${last}`));
  return out;
}

/**
 * Words people write to each other (a talk page's comments), as they
 * wrote them: paragraphs, line breaks, and web addresses, item ids, site
 * paths, @mentions and #12 as links. Nothing in them is read as markup.
 */
export function PlainWords({ text, lang, className }: { text: string; lang: Lang; className?: string }) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={['plain-words', className].filter(Boolean).join(' ')} dir="auto">
      {paragraphs.map((p, i) => (
        <p key={i} dir="auto">
          {p.split('\n').flatMap((line, j) => (j === 0 ? linked(line, lang, `${i}-${j}`) : [<br key={`br-${i}-${j}`} />, ...linked(line, lang, `${i}-${j}`)]))}
        </p>
      ))}
    </div>
  );
}
