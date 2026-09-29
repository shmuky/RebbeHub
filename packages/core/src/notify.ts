import { one, type Db } from '@rebbehub/db';
import { base64url } from './auth.js';
import type { Catalog } from './catalog.js';
import { emailsOf } from './email.js';
import { invalid } from './errors.js';
import { markMailed, unmailed, type InboxLine } from './inbox.js';

/**
 * Notifications by email (the plan, section 3: Follow is "notified when an
 * item, set or project changes"). Each person chooses on their account
 * page: off (the default), a daily digest, or at once. A scheduled job
 * (the API's cron) looks for what changed in what they follow since the
 * last commit they were told of, leaves out their own changes, and writes
 * to them; every email says how to stop them, in one click. The same
 * changes are listed on the account page whatever they choose.
 *
 * The same email carries what waits unread in their inbox (inbox.ts):
 * who named them, asked them to review, gave them an issue, or answered
 * in a conversation they follow; each such line is sent once.
 */

export type NotificationMode = 'off' | 'daily' | 'immediate';
export const NOTIFICATION_MODES: readonly NotificationMode[] = ['off', 'daily', 'immediate'];

/** One email. `headers` carries List-Unsubscribe, so mail programs can offer a button. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

/** Sends email (Resend on the API's Workers; a list in tests). */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export interface NotificationSetting {
  mode: NotificationMode;
  /** Where to write; null: the account's first address. */
  email: string | null;
  lang: 'he' | 'en';
}

export async function notificationSetting(db: Db, personId: string): Promise<NotificationSetting> {
  const row = await one<{ mode: NotificationMode; email: string | null; lang: 'he' | 'en' }>(db, 'SELECT mode, email, lang FROM auth.notification_setting WHERE person_id = $1', [personId]);
  return row ?? { mode: 'off', email: null, lang: 'he' };
}

/**
 * Sets how a person is told. Switched on, they are told of what changes
 * from now on, not of everything before; the address must be one of
 * theirs.
 */
export async function setNotifications(catalog: Catalog, personId: string, input: { mode: NotificationMode; email?: string | null; lang?: 'he' | 'en' }): Promise<NotificationSetting> {
  if (!NOTIFICATION_MODES.includes(input.mode)) throw invalid('mode is off, daily or immediate');
  const addresses = await emailsOf(catalog.db, personId);
  const email = input.email ?? null;
  if (email !== null && !addresses.some((a) => a.email === email)) throw invalid('that address is not one of yours; add it first');
  if (input.mode !== 'off' && addresses.length === 0) throw invalid('add an email address first');
  const head = await catalog.head();
  const token = new Uint8Array(24);
  crypto.getRandomValues(token);
  await catalog.db.query(
    `INSERT INTO auth.notification_setting (person_id, mode, email, lang, last_seq, unsubscribe_token) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (person_id) DO UPDATE SET mode = EXCLUDED.mode, email = EXCLUDED.email, lang = EXCLUDED.lang, updated_at = now(),
       last_seq = CASE WHEN auth.notification_setting.mode = 'off' THEN EXCLUDED.last_seq ELSE auth.notification_setting.last_seq END`,
    [personId, input.mode, email, input.lang ?? 'he', head, base64url(token)],
  );
  return notificationSetting(catalog.db, personId);
}

/** "Stop these emails", from the link in one: needs no sign-in. True when it turned something off. */
export async function unsubscribe(db: Db, token: string): Promise<boolean> {
  if (!token) return false;
  const row = await one<{ person_id: string }>(db, "UPDATE auth.notification_setting SET mode = 'off', updated_at = now() WHERE unsubscribe_token = $1 AND mode <> 'off' RETURNING person_id", [token]);
  return row !== null;
}

export type FeedLine = Awaited<ReturnType<Catalog['followFeed']>>[number];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const WORDS = {
  he: {
    subject: (n: number) => (n === 1 ? 'RebbeHub: שינוי אחד במה שאתם עוקבים אחריו' : `RebbeHub: ${n} שינויים במה שאתם עוקבים אחריו`),
    inboxSubject: (n: number) => (n === 1 ? 'RebbeHub: הודעה אחת חדשה' : `RebbeHub: ${n} הודעות חדשות`),
    inboxIntro: 'מה שמחכה לכם בתיבת ההודעות:',
    inbox: 'לתיבת ההודעות',
    reasons: {
      mention: 'הזכיר/ה אתכם',
      review_requested: 'ביקש/ה שתעברו על',
      assigned: 'הטיל/ה עליכם את',
      author: 'עדכון ב',
      comment: 'הגיב/ה ב',
      review: 'עבר/ה על',
      state: 'עדכון ב',
      followed: 'חדש במה שאתם עוקבים אחריו:',
    } as Record<string, string>,
    intro: 'אלה השינויים האחרונים בספרים, בהתוועדויות ובסטים שאתם עוקבים אחריהם:',
    by: 'מאת',
    changes: 'פריטים',
    settings: 'לשינוי ההגדרות',
    stop: 'להפסקת המיילים האלה',
  },
  en: {
    subject: (n: number) => (n === 1 ? 'RebbeHub: one change in what you follow' : `RebbeHub: ${n} changes in what you follow`),
    inboxSubject: (n: number) => (n === 1 ? 'RebbeHub: one new notification' : `RebbeHub: ${n} new notifications`),
    inboxIntro: 'Waiting in your inbox:',
    inbox: 'Open your inbox',
    reasons: {
      mention: 'mentioned you in',
      review_requested: 'asked you to review',
      assigned: 'assigned you',
      author: 'updated',
      comment: 'commented on',
      review: 'reviewed',
      state: 'updated',
      followed: 'new in what you follow:',
    } as Record<string, string>,
    intro: 'The latest changes in the sefarim, farbrengens and sets you follow:',
    by: 'by',
    changes: 'items',
    settings: 'Change these settings',
    stop: 'Stop these emails',
  },
};

/** Where an inbox line leads on the site: a suggestion or issue by its number, an item's talk page, a project. */
export function inboxHref(line: Pick<InboxLine, 'subject'>): string {
  const { kind, id, number, path } = line.subject;
  if (kind === 'changeset') return number === null ? '/review' : `/suggestions/${number}`;
  if (kind === 'report') return number === null ? '/issues' : `/issues/${number}`;
  if (kind === 'entity') return `/talk/${id}`;
  return path ?? '/projects';
}

/** An inbox line in words: who, what they did, and to which conversation. */
export function inboxText(line: InboxLine, lang: 'he' | 'en'): string {
  const w = WORDS[lang];
  const who = line.actorUsername ? `@${line.actorUsername}` : (line.actorName ?? 'RebbeHub');
  const what = line.subject.number !== null ? `#${line.subject.number}${line.subject.title ? ` ${line.subject.title}` : ''}` : (line.subject.title ?? line.subject.path ?? line.subject.id);
  const times = line.count > 1 ? ` (×${line.count})` : '';
  return line.reason === 'followed' ? `${w.reasons.followed} ${what}${times}` : `${who} ${w.reasons[line.reason] ?? w.reasons.state} ${what}${times}`;
}

/** The email for a list of changes (and, before them, what waits in the inbox): plain text and a printed-looking HTML, each line linked to its page. */
export function digestMessage(input: { to: string; lines: FeedLine[]; inbox?: InboxLine[]; lang: 'he' | 'en'; siteUrl: string; unsubscribeToken: string }): EmailMessage {
  const w = WORDS[input.lang];
  const q = input.lang === 'en' ? '?lang=en' : '';
  const inboxLines = input.inbox ?? [];
  const toInbox = `${input.siteUrl}/inbox${q}`;
  const inboxLink = (l: InboxLine) => `${input.siteUrl}${inboxHref(l)}${q}`;
  const page = (id: string) => `${input.siteUrl}/${id}${q}`;
  const settings = `${input.siteUrl}/account${q}`;
  const stop = `${input.siteUrl}/account?unsubscribe=${encodeURIComponent(input.unsubscribeToken)}${input.lang === 'en' ? '&lang=en' : ''}`;
  const date = (iso: string) => new Intl.DateTimeFormat(input.lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));
  const detail = (l: FeedLine) => `${w.by} ${l.authorName} · ${date(l.at)}${l.changes > 1 ? ` · ${l.changes} ${w.changes}` : ''}`;
  const inboxText_ = inboxLines.length ? [w.inboxIntro, '', ...inboxLines.flatMap((l) => [`- ${inboxText(l, input.lang)}`, `  ${inboxLink(l)}`]), '', `${w.inbox}: ${toInbox}`, ''] : [];
  const feedText = input.lines.length ? [w.intro, '', ...input.lines.flatMap((l) => [`- ${l.message} (${detail(l)})`, `  ${page(l.entityId)}`]), ''] : [];
  const text = [...inboxText_, ...feedText, `${w.settings}: ${settings}`, `${w.stop}: ${stop}`].join('\n');
  const dir = input.lang === 'he' ? 'rtl' : 'ltr';
  const html = `<!doctype html><html lang="${input.lang}" dir="${dir}"><body style="font-family: Georgia, 'Frank Ruehl CLM', 'David', serif; font-size: 16px; line-height: 1.5; color: #1d1b16; max-width: 36em; margin: 0 auto; padding: 1em;">
${
    inboxLines.length
      ? `<p>${escapeHtml(w.inboxIntro)}</p>
<ul style="padding-inline-start: 1.2em;">${inboxLines.map((l) => `<li style="margin-bottom: 0.6em;"><a href="${escapeHtml(inboxLink(l))}" style="color: #1d1b16;">${escapeHtml(inboxText(l, input.lang))}</a></li>`).join('')}</ul>
<p><a href="${escapeHtml(toInbox)}" style="color: #1d1b16;">${escapeHtml(w.inbox)}</a></p>`
      : ''
  }${
    input.lines.length
      ? `<p>${escapeHtml(w.intro)}</p>
<ul style="padding-inline-start: 1.2em;">${input.lines
          .map((l) => `<li style="margin-bottom: 0.6em;"><a href="${escapeHtml(page(l.entityId))}" style="color: #1d1b16;">${escapeHtml(l.message)}</a><br><span style="color: #6b6557; font-size: 14px;">${escapeHtml(detail(l))}</span></li>`)
          .join('')}</ul>`
      : ''
  }
<hr style="border: 0; border-top: 1px solid #d8d2c4;">
<p style="font-size: 14px; color: #6b6557;"><a href="${escapeHtml(settings)}" style="color: #6b6557;">${escapeHtml(w.settings)}</a> · <a href="${escapeHtml(stop)}" style="color: #6b6557;">${escapeHtml(w.stop)}</a></p>
</body></html>`;
  return {
    to: input.to,
    subject: input.lines.length ? w.subject(input.lines.length) : w.inboxSubject(inboxLines.length),
    text,
    html,
    headers: { 'List-Unsubscribe': `<${input.siteUrl}/_/auth/email/unsubscribe?token=${encodeURIComponent(input.unsubscribeToken)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

/**
 * The scheduled job: writes to everyone due. At once: whenever main has
 * moved past what they were last told. Daily: the same, at most once a
 * day. A person with nothing new in what they follow is only moved on to
 * the head of main. Returns how many were written to.
 */
export async function sendNotifications(catalog: Catalog, mailer: Mailer, options: { siteUrl: string; limit?: number }): Promise<{ sent: number; looked: number }> {
  const head = await catalog.head();
  const { rows } = await catalog.db.query<{ person_id: string; mode: NotificationMode; email: string | null; lang: 'he' | 'en'; last_seq: string | number; unsubscribe_token: string }>(
    `SELECT n.person_id, n.mode, n.email, n.lang, n.last_seq, n.unsubscribe_token
     FROM auth.notification_setting n LEFT JOIN account a ON a.id = n.person_id
     WHERE (n.last_seq < $1 OR EXISTS (SELECT 1 FROM auth.notification x WHERE x.person_id = n.person_id AND x.read_at IS NULL AND x.emailed_at IS NULL))
       AND a.suspended_at IS NULL
       AND (n.mode = 'immediate' OR (n.mode = 'daily' AND (n.last_sent_at IS NULL OR n.last_sent_at <= now() - interval '1 day')))
     ORDER BY n.last_run_at NULLS FIRST LIMIT ${Math.min(options.limit ?? 50, 500)}`,
    [head],
  );
  let sent = 0;
  for (const row of rows) {
    const lines = Number(row.last_seq) < head ? await catalog.followFeed(row.person_id, 30, { afterSeq: Number(row.last_seq), notOwn: true }) : [];
    const waiting = await unmailed(catalog.db, row.person_id);
    let wrote = false;
    if (lines.length > 0 || waiting.length > 0) {
      const addresses = await emailsOf(catalog.db, row.person_id);
      const to = addresses.find((a) => a.email === row.email)?.email ?? addresses[0]?.email;
      if (to) {
        try {
          await mailer.send(digestMessage({ to, lines, inbox: waiting, lang: row.lang, siteUrl: options.siteUrl, unsubscribeToken: row.unsubscribe_token }));
          await markMailed(catalog.db, waiting.map((l) => l.id));
          wrote = true;
          sent++;
        } catch (error) {
          // Tried again on the next run: nothing is marked told.
          console.error('notification', row.person_id, error);
          continue;
        }
      }
    }
    await catalog.db.query(`UPDATE auth.notification_setting SET last_seq = $2, last_run_at = now()${wrote ? ', last_sent_at = now()' : ''} WHERE person_id = $1`, [row.person_id, head]);
  }
  return { sent, looked: rows.length };
}
