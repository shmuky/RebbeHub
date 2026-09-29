import type { ReactNode } from 'react';
import { Avatar, cx } from './primitives.js';
import { Icon, type IconName } from './Icon.js';

/**
 * A conversation and what happened in it, in order, down one line, as a
 * pull request's page is: comments in cards beside the writer's initials,
 * events (linked, approved, synced) as a line with a dot, and blocks (a
 * diff, the checks, the review box) set in from the line.
 */

export function Timeline({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ol className={cx('timeline', className)} aria-label={label}>
      {children}
    </ol>
  );
}

export function TimelineComment({ author, authorId, bot, header, role, children, footer, mine, id }: { author: string; authorId?: string; bot?: boolean; header: ReactNode; role?: ReactNode; children: ReactNode; footer?: ReactNode; mine?: boolean; id?: string }) {
  return (
    <li className="tl-comment" id={id}>
      <Avatar name={author} id={authorId} size="lg" bot={bot} />
      <article className={cx('tl-card', mine && 'mine')}>
        <header className="tl-card-h">
          {header}
          {role ? <span className="role">{role}</span> : null}
        </header>
        <div className="tl-card-b">{children}</div>
        {footer ? <footer className="tl-card-f">{footer}</footer> : null}
      </article>
    </li>
  );
}

export function TimelineEvent({ icon, tone, children, id }: { icon: IconName; tone?: 'open' | 'approved' | 'closed' | 'machine'; children: ReactNode; id?: string }) {
  return (
    <li className="tl-event" id={id}>
      <span className={cx('dot', tone)}>
        <Icon name={icon} size={14} />
      </span>
      <span>{children}</span>
    </li>
  );
}

export function TimelineBlock({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <li className={cx('tl-block', className)} id={id}>
      {children}
    </li>
  );
}
