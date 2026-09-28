import { one, type Db } from '@rebbehub/db';

/**
 * People and their sign-in (the `auth` schema, migration 0003): a person,
 * their passkeys, their signed-in sessions, and the one-time challenges of
 * the passkey ceremonies. The ceremonies themselves (WebAuthn) run in the
 * API; this keeps what they need, and nothing that is not needed: a
 * session is kept by its token's hash, a passkey by its public key.
 */

export interface Person {
  id: string;
  displayName: string;
}

export interface StoredPasskey {
  credentialId: string;
  personId: string;
  /** COSE public key, base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
}

/** How long a sign-in lasts without being used, and how long a challenge may be answered. */
export const SESSION_DAYS = 60;
export const CHALLENGE_MINUTES = 5;

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new person's id: `u-` and ten letters and digits, never reused. */
export function newPersonId(): string {
  return `u-${[...randomBytes(10)].map((b) => CROCKFORD[b % 32]).join('')}`;
}

/** A session token (what the cookie holds) and the hash kept of it. */
export async function newSessionToken(): Promise<{ token: string; hash: string }> {
  const token = base64url(randomBytes(32));
  return { token, hash: await hashToken(token) };
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A name as people will see it: trimmed, spaces collapsed, 1 to 60 characters. */
export function cleanDisplayName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length >= 1 && clean.length <= 60 ? clean : null;
}

export async function createPerson(db: Db, displayName: string): Promise<Person> {
  const id = newPersonId();
  await db.query('INSERT INTO auth.person (id, display_name) VALUES ($1, $2)', [id, displayName]);
  return { id, displayName };
}

export async function getPerson(db: Db, id: string): Promise<Person | null> {
  const row = await one<{ id: string; display_name: string }>(db, 'SELECT id, display_name FROM auth.person WHERE id = $1', [id]);
  return row ? { id: row.id, displayName: row.display_name } : null;
}

/** Keeps a challenge for one ceremony; it is answered once, within a few minutes. */
export async function saveChallenge(db: Db, challenge: string, purpose: 'register' | 'sign-in'): Promise<string> {
  const id = base64url(randomBytes(16));
  await db.query(`INSERT INTO auth.challenge (id, challenge, purpose, expires_at) VALUES ($1, $2, $3, now() + interval '${CHALLENGE_MINUTES} minutes')`, [id, challenge, purpose]);
  // Old ones go as new ones come.
  await db.query('DELETE FROM auth.challenge WHERE expires_at < now()');
  return id;
}

/** Takes a challenge back, once: it is deleted whether or not it is still valid. */
export async function takeChallenge(db: Db, id: string, purpose: 'register' | 'sign-in'): Promise<string | null> {
  const row = await one<{ challenge: string; fresh: boolean }>(db, 'DELETE FROM auth.challenge WHERE id = $1 AND purpose = $2 RETURNING challenge, expires_at > now() AS fresh', [id, purpose]);
  return row?.fresh ? row.challenge : null;
}

export async function addPasskey(db: Db, passkey: StoredPasskey & { deviceType?: string; backedUp?: boolean }): Promise<void> {
  await db.query(
    `INSERT INTO auth.passkey (credential_id, person_id, public_key, counter, transports, device_type, backed_up)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [passkey.credentialId, passkey.personId, passkey.publicKey, passkey.counter, passkey.transports, passkey.deviceType ?? null, passkey.backedUp ?? false],
  );
}

export async function findPasskey(db: Db, credentialId: string): Promise<StoredPasskey | null> {
  const row = await one<{ credential_id: string; person_id: string; public_key: string; counter: string | number; transports: string[] }>(
    db,
    'SELECT credential_id, person_id, public_key, counter, transports FROM auth.passkey WHERE credential_id = $1',
    [credentialId],
  );
  return row ? { credentialId: row.credential_id, personId: row.person_id, publicKey: row.public_key, counter: Number(row.counter), transports: row.transports ?? [] } : null;
}

export async function passkeyUsed(db: Db, credentialId: string, counter: number): Promise<void> {
  await db.query('UPDATE auth.passkey SET counter = $2, last_used_at = now() WHERE credential_id = $1', [credentialId, counter]);
}

export async function passkeysOf(db: Db, personId: string): Promise<Array<{ credentialId: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null }>> {
  const { rows } = await db.query<{ credential_id: string; device_type: string | null; backed_up: boolean; created_at: Date | string; last_used_at: Date | string | null }>(
    'SELECT credential_id, device_type, backed_up, created_at, last_used_at FROM auth.passkey WHERE person_id = $1 ORDER BY created_at',
    [personId],
  );
  return rows.map((r) => ({
    credentialId: r.credential_id,
    deviceType: r.device_type,
    backedUp: r.backed_up,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

/** Signs a person in: a new session, whose token the caller hands to the browser. */
export async function startSession(db: Db, personId: string, userAgent?: string): Promise<string> {
  const { token, hash } = await newSessionToken();
  await db.query(`INSERT INTO auth.session (token_hash, person_id, expires_at, user_agent) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days', $3)`, [hash, personId, userAgent?.slice(0, 300) ?? null]);
  return token;
}

/** The person a session token signs in, while it lasts; each use extends it. */
export async function sessionPerson(db: Db, token: string): Promise<Person | null> {
  const hash = await hashToken(token);
  const row = await one<{ id: string; display_name: string }>(
    db,
    `UPDATE auth.session s SET last_seen_at = now(), expires_at = now() + interval '${SESSION_DAYS} days'
     FROM auth.person p WHERE s.token_hash = $1 AND s.expires_at > now() AND p.id = s.person_id
     RETURNING p.id, p.display_name`,
    [hash],
  );
  return row ? { id: row.id, displayName: row.display_name } : null;
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM auth.session WHERE token_hash = $1', [await hashToken(token)]);
}
