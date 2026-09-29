import { tokenize } from '@rebbehub/model';
import { Link } from 'react-router';
import type { Lang } from '../../lib/i18n.js';
import { href } from '../../lib/links.js';
import { personPath } from '../../lib/threads.js';

/**
 * What people write, as they meant it: paragraphs and line breaks kept,
 * `@handle` linked to the person, `#12` to the suggestion or issue (an
 * issue's page sends a suggestion's number on), an item's id (`rh-…`) to
 * the item, addresses as links that pass on no ranking. Nothing else is
 * markup: no HTML ever comes through.
 */
export function RichText({ text, lang }: { text: string; lang: Lang }) {
  const paragraphs = text.trim().split(/\n{2,}/);
  return (
    <div className="th-rich" dir="auto">
      {paragraphs.map((paragraph, p) => (
        <p key={p}>
          {tokenize(paragraph).map((token, i) => {
            switch (token.kind) {
              case 'mention':
                return (
                  <Link key={i} className="th-mention" to={href(personPath(token.username), lang)}>
                    {token.text}
                  </Link>
                );
              case 'ref':
                return (
                  <Link key={i} className="th-ref" to={href(`/issues/${token.number}`, lang)}>
                    {token.text}
                  </Link>
                );
              case 'item':
                return (
                  <Link key={i} className="th-ref" to={href(`/${token.id}`, lang)}>
                    {token.text}
                  </Link>
                );
              case 'url':
                return (
                  <a key={i} href={token.url} rel="nofollow ugc noopener" target="_blank">
                    {token.text}
                  </a>
                );
              case 'code':
                return <code key={i}>{token.text}</code>;
              default:
                return <span key={i}>{token.text}</span>;
            }
          })}
        </p>
      ))}
    </div>
  );
}
