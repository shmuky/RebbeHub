import { Link } from 'react-router';
import type { ReviewPerson, ReviewRow } from './ReviewCard.js';
import type { Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { stateOf, stateWord } from '../lib/suggestions.js';
import { Icon } from '../ui/Icon.js';
import { Avatar, MachineLabel, RelativeTime, StateIcon, StatusBadge } from '../ui/primitives.js';

const W = {
  suggested: { he: 'הוצעה', en: 'suggested' },
  by: { he: 'על ידי', en: 'by' },
  bot: { he: 'בוט', en: 'bot' },
  item: { he: 'פריט אחד', en: '1 item' },
  items: { he: 'פריטים', en: 'items' },
  wentLive: { he: 'עלה מיד · נבדק אחרי', en: 'Went live · reviewed after' },
  open: { he: 'פתוחה', en: 'Open' },
} as const;

/**
 * One Suggestion in the review queue (routes/review.tsx), as one line,
 * as GitHub lists a pull request: its title to its own page (or, with no
 * #number, to its card in the queue), then who sent it, when, and how
 * many items it changes. None of its changes: those are on its page.
 * A bot's work is marked a machine's until a person approves it.
 */
export function QueueRow({ row, person, lang }: { row: ReviewRow; person?: ReviewPerson; lang: Lang }) {
  const bot = person?.bot ?? row.author.startsWith('bot:');
  const author = person?.name ?? row.author;
  const live = row.post_review === 'pending';
  const state = live ? 'open' : stateOf(row.status);
  const to = row.number ? href(`/suggestions/${row.number}`, lang) : href('/review', lang, { s: String(row.id) });
  const total = row.items ?? 0;
  return (
    <li className="row issue-row" id={`s${row.id}`}>
      <StateIcon kind="suggestion" state={row.status === 'merged' && !live ? 'approved' : state === 'closed' ? 'closed' : 'open'} label={live ? W.wentLive[lang] : row.status === 'open' ? W.open[lang] : stateWord(row.status, lang)} />
      <div className="grow">
        <div className="row-line">
          <Link className="row-title" to={to} dir="auto">
            {row.title}
          </Link>
          {live ? (
            <span className="machine-label rq-live">
              <Icon name="pulse" size={12} />
              {W.wentLive[lang]}
            </span>
          ) : row.status !== 'open' ? (
            <StatusBadge state={state === 'approved' ? 'approved' : state === 'draft' ? 'draft' : 'closed'} size="sm">
              {stateWord(row.status, lang)}
            </StatusBadge>
          ) : null}
          {bot && row.status !== 'merged' ? <MachineLabel lang={lang} size="sm" /> : null}
        </div>
        <div className="row-sub">
          {row.number ? (
            <>
              <span className="num">#{row.number}</span>
              {' · '}
            </>
          ) : null}
          {W.suggested[lang]} <RelativeTime at={row.submitted_at ?? row.created_at} lang={lang} /> {W.by[lang]} {bot ? <Icon name="bot" size={12} /> : <Avatar name={author} id={row.author} size="xs" />} <span>{author}</span>
          {bot ? <span className="bot-tag">{W.bot[lang]}</span> : null}
          {total ? <span className="num"> · {total === 1 ? W.item[lang] : `${num(total, lang)} ${W.items[lang]}`}</span> : null}
        </div>
      </div>
    </li>
  );
}
