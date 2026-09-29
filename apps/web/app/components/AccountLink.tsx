import { Bell, CircleUserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import '../threads.css';

/** The top bar's corner: "sign in", or the signed-in person's inbox and name, filled in by the browser. */
export function AccountLink({ lang }: { lang: Lang }) {
  const account = useAccount();
  const { pathname, search } = useLocation();
  if (account === undefined) return <span className="account-link" aria-hidden="true" />;
  if (!account)
    return (
      <Link className="account-link" to={href('/signin', lang, { return: pathname === '/signin' ? undefined : `${pathname}${search}` })}>
        {t(lang, 'signIn')}
      </Link>
    );
  return (
    <>
      <InboxLink lang={lang} first={account.unread} />
      <Link className="account-link signed-in" to={href('/account', lang)}>
        <CircleUserRound size={16} aria-hidden="true" />
        {account.person.displayName}
      </Link>
    </>
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
    <Link className="th-inbox-link" to={href('/inbox', lang)} aria-label={label} title={label}>
      <Bell size={18} aria-hidden="true" />
      {unread ? <span className="th-unread-dot">{unread > 99 ? '99+' : unread}</span> : null}
    </Link>
  );
}
