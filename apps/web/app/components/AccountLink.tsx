import { CircleUserRound } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';

/** The top bar's corner: "sign in", or the signed-in person's name, filled in by the browser. */
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
    <Link className="account-link signed-in" to={href('/account', lang)}>
      <CircleUserRound size={16} aria-hidden="true" />
      {account.person.displayName}
    </Link>
  );
}
