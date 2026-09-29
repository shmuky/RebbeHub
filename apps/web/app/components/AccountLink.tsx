import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { Avatar } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * A corner of a bar: "sign in", or the signed-in person's inbox and name,
 * filled in by the browser. Drawn with the header's own parts (an icon
 * link with its count, the person's initials), so it sits in any bar.
 */
export function AccountLink({ lang }: { lang: Lang }) {
  const account = useAccount();
  const { pathname, search } = useLocation();
  if (account === undefined) return <span className="account-link" aria-hidden="true" />;
  if (!account)
    return (
      <Link className="sign-in-link" to={href('/signin', lang, { return: pathname === '/signin' ? undefined : `${pathname}${search}` })}>
        {t(lang, 'signIn')}
      </Link>
    );
  return (
    <span className="account-link">
      <InboxLink lang={lang} first={account.unread} />
      <Link className="account-link-me" to={href('/account', lang)}>
        <Avatar name={account.person.displayName} id={account.person.id} size="sm" />
        <span>{account.person.displayName}</span>
      </Link>
    </span>
  );
}

/** The inbox, with how many lines wait unread; asked again when a page reads some (the `rebbehub:inbox` event) and on each new page. */
function InboxLink({ lang, first }: { lang: Lang; first: number }) {
  const [unread, setUnread] = useState(first);
  const { pathname } = useLocation();
  const seen = useRef(false);
  useEffect(() => {
    let live = true;
    const ask = () =>
      void fetch('/_/threads/inbox/count', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<{ unread: number }>) : null))
        .then((body) => live && body && setUnread(body.unread))
        .catch(() => undefined);
    window.addEventListener('rebbehub:inbox', ask);
    // The first count came with who is signed in; later pages ask again.
    if (seen.current) ask();
    seen.current = true;
    return () => {
      live = false;
      window.removeEventListener('rebbehub:inbox', ask);
    };
  }, [pathname]);
  const label = unread ? `${tt(lang, 'inboxTitle')} (${unread} ${tt(lang, 'unread')})` : tt(lang, 'inboxTitle');
  return (
    <Link className="icon-link" to={href('/inbox', lang)} aria-label={label} title={label}>
      <Icon name="bell" />
      {unread ? <span className="dot-count">{unread > 99 ? '99+' : unread}</span> : null}
    </Link>
  );
}
