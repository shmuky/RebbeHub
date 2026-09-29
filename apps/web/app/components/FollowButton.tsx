import { useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';
import { setFollow, useFollows } from '../lib/useFollows.js';
import { Icon } from '../ui/Icon.js';
import '../styles/pages/people.css';

/**
 * "Follow" (the plan's Watch): what changes in this item, and in what
 * belongs to it (a sefer's sichos, a set's items), shows on the person's
 * account page. Signed out, it leads to signing in and back. Drawn as the
 * site's plain button, the bell filled in while following.
 */
export function FollowButton({ entity, lang }: { entity: Pick<Entity, 'id' | 'type' | 'path'>; lang: Lang }) {
  const account = useAccount();
  const follows = useFollows(Boolean(account));
  const [busy, setBusy] = useState(false);
  const on = Boolean(follows?.follows.some((f) => f.id === entity.id));

  if (account === null)
    return (
      <Link className="btn follow" to={href('/signin', lang, { return: entity.path ?? `/${entity.id}` })}>
        <Icon name="bell" />
        {t(lang, 'follow')}
      </Link>
    );
  return (
    <button
      type="button"
      className={on ? 'btn follow is-on' : 'btn follow'}
      aria-pressed={on}
      disabled={busy || follows === undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await setFollow(entity, !on);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name={on ? 'bellon' : 'bell'} />
      {t(lang, on ? 'following' : 'follow')}
    </button>
  );
}
