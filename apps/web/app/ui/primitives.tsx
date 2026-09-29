import { Children, Fragment, isValidElement, useId, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { initials, tintOf } from '../lib/initials.js';
import { LABEL_TONES, type LabelTone } from '../lib/suggestions.js';
import { Icon, type IconName } from './Icon.js';

/**
 * The small parts every page is built of. Each one is markup and a class
 * from styles/components.css, nothing more, so that pages written by other
 * hands (entity pages, the inbox, uploads) come out looking the same.
 */

export { initials, LABEL_TONES, tintOf, type LabelTone };

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/* ------------------------------------------------------------ avatar */


export function Avatar({ name, id, size, bot, className }: { name: string; id?: string; size?: 'xs' | 'sm' | 'lg' | 'xl'; bot?: boolean; className?: string }) {
  return (
    <span className={cx('avatar', size, bot && 'bot', className)} data-tint={bot ? undefined : tintOf(id ?? name)} aria-hidden="true" title={name}>
      {bot ? <Icon name="bot" size={size === 'lg' ? 18 : 13} /> : initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------ labels and status */


/** A quiet squared label with a coloured swatch: "טקסט", "סריקה". */
export function Label({ children, tone, color, to, size, className }: { children: ReactNode; tone?: LabelTone; color?: string; to?: string; size?: 'sm'; className?: string }) {
  const swatch = tone || color ? <i className="sw" style={{ background: color ?? `var(--l-${tone})` }} /> : null;
  if (to)
    return (
      <Link to={to} className={cx('label', size, className)}>
        {swatch}
        {children}
      </Link>
    );
  return (
    <span className={cx('label', size, className)}>
      {swatch}
      {children}
    </span>
  );
}

/** Machine output nobody has checked yet, said in words and in amber. */
export function MachineLabel({ children, lang, size }: { children?: ReactNode; lang: Lang; size?: 'sm' }) {
  return (
    <span className={cx('machine', size)}>
      <Icon name="bot" size={12} />
      {children ?? tu(lang, 'machineUnchecked')}
    </span>
  );
}

/** What an agent sent for a person: which of their API tokens, or which app they connected (the API's `via`). */
export interface AgentVia {
  kind: 'token' | 'oauth';
  name: string;
}

const AGENT_WORDS = {
  he: { for: 'בשביל', token: 'נשלח על ידי סוכן, בטוקן ה-API של', oauth: 'נשלח על ידי אפליקציה מחוברת (סוכן) בשם', agent: 'סוכן' },
  en: { for: 'for', token: 'Sent by an agent, with the API token of', oauth: 'Sent by a connected app (an agent) for', agent: 'agent' },
} as const;

/**
 * Work an agent sent for a person, shown as the agent's, never as the
 * person typing: "Claude · for @shmuly", with the agent mark, in the
 * machine's amber (like machine output, it reads as the agent's until a
 * person reviews it). `children` is the person. Without `via`, the person
 * alone.
 */
export function AgentBy({ via, lang, children, who }: { via: AgentVia | null | undefined; lang: Lang; children: ReactNode; who?: string }) {
  if (!via) return <>{children}</>;
  const w = AGENT_WORDS[lang];
  return (
    <span className="agent-by" title={`${via.kind === 'oauth' ? w.oauth : w.token} ${who ?? ''}`.trim()}>
      <span className="machine sm agent-mark">
        <Icon name="bot" size={12} />
        <bdi>{via.name}</bdi>
      </span>
      <span className="muted"> · {w.for} </span>
      {children}
    </span>
  );
}

export function MachineNote({ children }: { children: ReactNode }) {
  return (
    <div className="machine-note" role="note">
      <Icon name="bot" />
      <div>{children}</div>
    </div>
  );
}

export type State = 'open' | 'approved' | 'closed' | 'draft' | 'neutral';

const STATE_ICON: Record<State, IconName> = { open: 'suggest', approved: 'suggest', closed: 'x', draft: 'pencil', neutral: 'dot' };

/** A suggestion's or report's state, as GitHub shows a pull request's. */
export function StatusBadge({ state, children, size, icon }: { state: State; children: ReactNode; size?: 'sm'; icon?: IconName }) {
  return (
    <span className={cx('state', state, size)}>
      <Icon name={icon ?? STATE_ICON[state]} size={size === 'sm' ? 12 : 16} />
      {children}
    </span>
  );
}

/** The state as an icon only, at the start of a list row. */
export function StateIcon({ kind, state, label }: { kind: 'suggestion' | 'report'; state: 'open' | 'approved' | 'closed' | 'neutral' | 'machine'; label?: string }) {
  const name: IconName = kind === 'report' ? (state === 'open' ? 'report' : state === 'closed' ? 'reportclosed' : 'reportdone') : state === 'closed' ? 'x' : 'suggest';
  return (
    <span className={cx('state-icon', state)}>
      <Icon name={name} label={label} />
    </span>
  );
}

/* ------------------------------------------------------------ boxes and rows */

export function Box({ children, className, header, footer, as: As = 'div', ...rest }: { children?: ReactNode; className?: string; header?: ReactNode; footer?: ReactNode; as?: 'div' | 'section' | 'ul' | 'ol' | 'nav'; 'aria-label'?: string; id?: string }) {
  return (
    <As className={cx('box', className)} {...rest}>
      {header ? <div className="box-h">{header}</div> : null}
      {children}
      {footer ? <div className="box-f">{footer}</div> : null}
    </As>
  );
}

/* ------------------------------------------------------------ tabs */

export interface TabItem {
  key: string;
  label: ReactNode;
  to?: string;
  icon?: IconName;
  count?: number | string | null;
}

/**
 * Tabs as links, so each view has its own address and works without
 * script. `quiet` underlines in ink rather than the accent (a feed's views).
 */
export function Tabs({ items, current, label, quiet, className, replace }: { items: TabItem[]; current: string; label: string; quiet?: boolean; className?: string; replace?: boolean }) {
  return (
    <nav className={cx('tabs', quiet && 'quiet', className)} aria-label={label}>
      {items.map((tab) => (
        <Link key={tab.key} to={tab.to ?? `#${tab.key}`} aria-current={current === tab.key ? 'page' : undefined} preventScrollReset replace={replace}>
          {tab.icon ? <Icon name={tab.icon} /> : null}
          {tab.label}
          {tab.count !== undefined && tab.count !== null && tab.count !== '' ? <span className="count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** A two- or three-way switch drawn as one control: המקור · English · זה מול זה. */
export function Segmented({ items, current, label, className }: { items: Array<{ key: string; label: ReactNode; to: string }>; current: string; label: string; className?: string }) {
  return (
    <nav className={cx('segmented', className)} aria-label={label}>
      {items.map((it) => (
        <Link key={it.key} to={it.to} aria-current={current === it.key ? 'true' : undefined} preventScrollReset replace>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------ breadcrumbs */

export function Breadcrumbs({ items, lang, className }: { items: Array<{ label: ReactNode; to?: string }>; lang: Lang; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={tu(lang, 'crumbs')} className={className}>
      <ol className="crumbs">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {i > 0 ? <Icon name="chev" className="flip-ltr" size={14} /> : null}
              {last ? <b aria-current="page">{it.label}</b> : it.to ? <Link to={it.to}>{it.label}</Link> : <span>{it.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------ empty and loading */

export function EmptyState({ icon = 'info', title, children, actions, compact }: { icon?: IconName; title: ReactNode; children?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('empty', compact && 'compact')}>
      <Icon name={icon} size={compact ? 20 : 24} />
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  );
}

/** Grey lines where a list will be, while the browser asks for it. */
export function Skeleton({ rows = 3, lang }: { rows?: number; lang: Lang }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{tu(lang, 'loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i} aria-hidden="true">
          <span className="skeleton title" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
          <span className="skeleton line" style={{ width: `${30 + ((i * 23) % 30)}%` }} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ pagination */

/**
 * Numbered pages, as links: 1 … 4 5 6 … 20. `page` counts from 1;
 * `hrefOf(n)` gives page n's address.
 */
export function Pagination({ page, pages, hrefOf, lang }: { page: number; pages: number; hrefOf: (n: number) => string; lang: Lang }) {
  if (pages <= 1) return null;
  const shown = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const list = [...shown].sort((a, b) => a - b);
  return (
    <nav className="pager" aria-label={tu(lang, 'pages')}>
      {page > 1 ? (
        <Link className="edge" to={hrefOf(page - 1)} rel="prev">
          <Icon name="chevr" className="flip-ltr" size={14} />
          {tu(lang, 'prev')}
        </Link>
      ) : (
        <span className="edge disabled">
          <Icon name="chevr" className="flip-ltr" size={14} />
          {tu(lang, 'prev')}
        </span>
      )}
      {list.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && n - list[i - 1]! > 1 ? <span aria-hidden="true">…</span> : null}
          <Link to={hrefOf(n)} aria-current={n === page ? 'page' : undefined} className="num">
            {n}
          </Link>
        </Fragment>
      ))}
      {page < pages ? (
        <Link className="edge" to={hrefOf(page + 1)} rel="next">
          {tu(lang, 'next')}
          <Icon name="chev" className="flip-ltr" size={14} />
        </Link>
      ) : (
        <span className="edge disabled">
          {tu(lang, 'next')}
          <Icon name="chev" className="flip-ltr" size={14} />
        </span>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------ tooltip */

/** A short explanation on hover and on keyboard focus, for icon-only controls. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  const only = Children.only(children);
  return (
    <span className="tip">
      {isValidElement(only) ? <span aria-describedby={id}>{only}</span> : only}
      <span className="tip-text" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ panels and choices */

/**
 * An action that opens in place (report a problem, suggest a fix): a
 * disclosure, so it works without script, and opens by itself when the
 * address ends in its id (#report).
 */
export function Panel({ id, icon, title, hint, children, open, className }: { id?: string; icon?: IconName; title: ReactNode; hint?: ReactNode; children: ReactNode; open?: boolean; className?: string }) {
  return (
    <details className={cx('panel', className)} id={id} open={open}>
      <summary>
        {icon ? <Icon name={icon} /> : null}
        <span>{title}</span>
        {hint ? <span className="hint">{hint}</span> : null}
        <Icon name="chevd" className="chev" size={14} />
      </summary>
      <div className="panel-b">{children}</div>
    </details>
  );
}

/** A choice among a few, as rows to pick: never a drop-down. */
export function ChoiceList({ name, options, value, defaultValue, onChange, inline, required, legend }: { name: string; options: Array<{ value: string; label: ReactNode; hint?: ReactNode }>; value?: string; defaultValue?: string; onChange?: (value: string) => void; inline?: boolean; required?: boolean; legend?: ReactNode }) {
  return (
    <fieldset className={cx('choices', inline && 'inline')}>
      {legend ? <legend className="visually-hidden">{legend}</legend> : null}
      {options.map((o) => (
        <label className="choice" key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            required={required}
            {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value, onChange: onChange ? () => onChange(o.value) : undefined })}
          />
          <span>
            <b>{o.label}</b>
            {o.hint ? <span className="hint">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/* ------------------------------------------------------------ time */

const UNITS: Array<[number, { he: [string, string]; en: string }]> = [
  [60, { he: ['שנ׳', 'שנ׳'], en: 's' }],
  [60, { he: ['דק׳', 'דק׳'], en: 'min' }],
  [24, { he: ['שעה', 'שעות'], en: 'h' }],
  [7, { he: ['יום', 'ימים'], en: 'd' }],
  [4.345, { he: ['שבוע', 'שבועות'], en: 'w' }],
  [12, { he: ['חודש', 'חודשים'], en: 'mo' }],
  [Infinity, { he: ['שנה', 'שנים'], en: 'y' }],
];

/** "לפני 22 דק׳", "3 days ago": how long ago, in words people use. */
export function ago(when: string | number | Date, lang: Lang, now: number = Date.now()): string {
  let n = Math.max(0, (now - new Date(when).getTime()) / 1000);
  if (n < 45) return lang === 'he' ? 'עכשיו' : 'just now';
  for (const [size, names] of UNITS) {
    if (n < size) {
      const v = Math.round(n);
      if (lang === 'en') {
        const words: Record<string, string> = { s: 'second', min: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' };
        return `${v} ${words[names.en]}${v === 1 ? '' : 's'} ago`;
      }
      if (names.he[0] === 'שעה' && v === 1) return 'לפני שעה';
      if (names.he[0] === 'יום' && v === 1) return 'אתמול';
      if (names.he[0] === 'יום' && v === 2) return 'שלשום';
      if (names.he[0] === 'שבוע' && v === 1) return 'לפני שבוע';
      if (names.he[0] === 'שבוע' && v === 2) return 'לפני שבועיים';
      if (names.he[0] === 'חודש' && v === 1) return 'לפני חודש';
      if (names.he[0] === 'שנה' && v === 1) return 'לפני שנה';
      return `לפני ${v} ${v === 1 ? names.he[0] : names.he[1]}`;
    }
    n /= size;
  }
  return '';
}

/**
 * A time as "how long ago", with the exact time on hover. The server's
 * words and the browser's may differ by a minute; React is told so.
 */
export function RelativeTime({ at, lang, className }: { at: string | number | Date; lang: Lang; className?: string }) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const exact = d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <time className={className} dateTime={d.toISOString()} title={exact} suppressHydrationWarning>
      {ago(d, lang)}
    </time>
  );
}

/* ------------------------------------------------------------ bits */

export function Count({ n, className }: { n: number | string; className?: string }) {
  return <span className={cx('count', className)}>{n}</span>;
}

/** A thin bar of how far something has come. */
export function Bar({ value, max = 100, tone, label }: { value: number; max?: number; tone?: 'open'; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cx('bar', tone)} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <i style={{ width: `${pct}%` } as CSSProperties} />
    </div>
  );
}

export { cx };
