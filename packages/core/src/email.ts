import { one, type Db } from '@rebbehub/db';
import { base64url, hashToken, type Person } from './auth.js';
import type { EmailMessage } from './notify.js';

/**
 * Signing in by email link (the plan, section 7: a Contributor signs in
 * with a passkey, an email link or Google), in the `auth` schema
 * (migration 0011). A person asks for a link; the email holds a one-time
 * token, of which only the hash is kept, good for a few minutes. One
 * person, one account: an address belongs to one person, and an address
 * already known - as an email address, or as the email of a linked Google
 * account - signs into the account it belongs to, never a new one.
 */

/** How long a link in an email may be used, and how many one address may be sent in an hour. */
export const EMAIL_LINK_MINUTES = 20;
export const EMAIL_LINKS_PER_HOUR = 5;
/** Links sent from the whole site in an hour: a ceiling on what someone could make it send to strangers. */
export const EMAIL_LINKS_PER_HOUR_ALL = 300;

/** An address as it is kept: trimmed, lower-case, something@somewhere.tld; null when it is not one. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

/** The person an address signs into: their own address, else the email of a Google account they linked. */
export async function personByEmail(db: Db, email: string): Promise<Person | null> {
  const row = await one<{ id: string; display_name: string }>(
    db,
    `SELECT p.id, p.display_name FROM auth.email_address e JOIN auth.person p ON p.id = e.person_id WHERE e.email = $1
     UNION ALL
     SELECT p.id, p.display_name FROM auth.google_account g JOIN auth.person p ON p.id = g.person_id WHERE lower(g.email) = $1
     LIMIT 1`,
    [email],
  );
  return row ? { id: row.id, displayName: row.display_name } : null;
}

/** Adds an address to a person (once theirs, it stays theirs); notes when it was last used to sign in. */
export async function addEmail(db: Db, personId: string, email: string): Promise<void> {
  await db.query('INSERT INTO auth.email_address (email, person_id, last_used_at) VALUES ($1, $2, now()) ON CONFLICT (email) DO UPDATE SET last_used_at = now() WHERE auth.email_address.person_id = $2', [email, personId]);
}

/** A person's addresses, for their account page: their own, and their Google accounts' (which they may be written at too). */
export async function emailsOf(db: Db, personId: string): Promise<Array<{ email: string; createdAt: string; google: boolean }>> {
  const { rows } = await db.query<{ email: string; created_at: Date | string; google: boolean }>(
    `SELECT email, created_at, FALSE AS google FROM auth.email_address WHERE person_id = $1
     UNION ALL
     SELECT lower(email), created_at, TRUE FROM auth.google_account WHERE person_id = $1 AND email IS NOT NULL
       AND lower(email) NOT IN (SELECT email FROM auth.email_address WHERE person_id = $1)
     ORDER BY created_at`,
    [personId],
  );
  return rows.map((r) => ({ email: r.email, createdAt: new Date(r.created_at).toISOString(), google: r.google }));
}

export type EmailLinkRefusal = 'too-many' | 'taken';

/**
 * A new link for an address: to sign in with it, or (with `personId`) to
 * add it to that signed-in person's account. Refused when the address has
 * been sent enough links this hour, or the site has; and, for adding,
 * when the address is already another person's.
 */
export async function startEmailLink(db: Db, input: { email: string; personId?: string }): Promise<{ token: string } | { refused: EmailLinkRefusal }> {
  if (input.personId) {
    const owner = await personByEmail(db, input.email);
    if (owner && owner.id !== input.personId) return { refused: 'taken' };
  }
  const counts = await one<{ mine: number; all: number }>(
    db,
    `SELECT count(*) FILTER (WHERE email = $1)::int AS mine, count(*)::int AS "all" FROM auth.email_link WHERE created_at > now() - interval '1 hour'`,
    [input.email],
  );
  if ((counts?.mine ?? 0) >= EMAIL_LINKS_PER_HOUR || (counts?.all ?? 0) >= EMAIL_LINKS_PER_HOUR_ALL) return { refused: 'too-many' };
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64url(bytes);
  await db.query(`INSERT INTO auth.email_link (token_hash, email, person_id, expires_at) VALUES ($1, $2, $3, now() + interval '${EMAIL_LINK_MINUTES} minutes')`, [
    await hashToken(token),
    input.email,
    input.personId ?? null,
  ]);
  // Kept a day, for the hourly counts; older ones go as new ones come.
  await db.query("DELETE FROM auth.email_link WHERE created_at < now() - interval '1 day'");
  return { token };
}

export interface EmailLinkView {
  email: string;
  /** Set when the link adds the address to this person's account. */
  personId: string | null;
  /** The account the address already signs into, if any. */
  known: Person | null;
}

/** What a link is for, without using it up (the page asks a new person's name before it is used). Null once used or expired. */
export async function peekEmailLink(db: Db, token: string): Promise<EmailLinkView | null> {
  const row = await one<{ email: string; person_id: string | null }>(db, 'SELECT email, person_id FROM auth.email_link WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [await hashToken(token)]);
  return row ? { email: row.email, personId: row.person_id, known: await personByEmail(db, row.email) } : null;
}

/** Uses a link up, once: what it was for, or null when it was used already or has expired. */
export async function takeEmailLink(db: Db, token: string): Promise<EmailLinkView | null> {
  const row = await one<{ email: string; person_id: string | null }>(
    db,
    'UPDATE auth.email_link SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING email, person_id',
    [await hashToken(token)],
  );
  return row ? { email: row.email, personId: row.person_id, known: await personByEmail(db, row.email) } : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The email with the link: to the site's sign-in page, which asks once
 * more before using it, so a mail program that opens links to check them
 * does not use it up.
 */
export function signInMessage(input: { to: string; siteUrl: string; token: string; lang: 'he' | 'en'; adding?: boolean; returnTo?: string }): EmailMessage {
  const params = new URLSearchParams({ 'email-token': input.token });
  if (input.returnTo) params.set('return', input.returnTo);
  if (input.lang === 'en') params.set('lang', 'en');
  const link = `${input.siteUrl}/signin?${params.toString()}`;
  const he = input.lang === 'he';
  const subject = input.adding ? (he ? 'RebbeHub: אישור כתובת המייל' : 'RebbeHub: confirm your email address') : he ? 'RebbeHub: קישור כניסה' : 'RebbeHub: your sign-in link';
  const action = input.adding ? (he ? 'להוספת הכתובת לחשבון שלכם' : 'To add this address to your account') : he ? 'לכניסה ל-RebbeHub' : 'To sign in to RebbeHub';
  const button = input.adding ? (he ? 'אישור הכתובת' : 'Confirm the address') : he ? 'כניסה' : 'Sign in';
  const small = he
    ? `הקישור טוב ל-${EMAIL_LINK_MINUTES} דקות ולפעם אחת. לא ביקשתם אותו? אפשר להתעלם מהמייל הזה.`
    : `The link works once, for ${EMAIL_LINK_MINUTES} minutes. Did not ask for it? You can ignore this email.`;
  const dir = he ? 'rtl' : 'ltr';
  return {
    to: input.to,
    subject,
    text: `${action}:\n${link}\n\n${small}`,
    html: `<!doctype html><html lang="${input.lang}" dir="${dir}"><body style="font-family: Georgia, 'Frank Ruehl CLM', 'David', serif; font-size: 16px; line-height: 1.5; color: #1d1b16; max-width: 36em; margin: 0 auto; padding: 1em;">
<p>${escapeHtml(action)}:</p>
<p><a href="${escapeHtml(link)}" style="display: inline-block; padding: 0.5em 1.2em; border: 1px solid #1d1b16; color: #1d1b16; text-decoration: none;">${escapeHtml(button)}</a></p>
<p style="font-size: 14px; color: #6b6557;">${escapeHtml(small)}</p>
</body></html>`,
  };
}
