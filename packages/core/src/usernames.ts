import { one, type Db } from '@rebbehub/db';
import { badState, invalid } from './errors.js';

/**
 * Handles (`@mendy`): the name a person is written to and linked by, in
 * comments, reviews and on their page at /u/<handle> (migration 0016).
 *
 * A handle is two to 39 Latin letters, digits and single hyphens, so it
 * reads the same in any address; it is unique whatever its case (`Mendy`
 * and `mendy` are the same person), and a person keeps the case they
 * chose. It is chosen when signing up, suggested from their name; a
 * handle they leave behind still leads to them, and nobody else may take
 * it, so an old link or @mention never lands on someone else. The words
 * the site uses for its own pages are never handles.
 */

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 39;

/** How long after choosing a handle a person waits to choose another, so the old ones do not pile up. */
export const USERNAME_CHANGE_HOURS = 24;

const SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){1,38}$/;

/** Words that are pages or roles on the site, never a person's handle (the same list as migration 0016's). */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'about', 'account', 'admin', 'api', 'auth', 'bot', 'calendar', 'compare', 'edit', 'embed', 'health', 'help', 'history',
  'inbox', 'issues', 'keeper', 'keepers', 'mirrors', 'missing', 'new', 'notifications', 'people', 'projects', 'read',
  'rebbehub', 'review', 'search', 'sets', 'settings', 'signin', 'signout', 'steward', 'stewards', 'suggestions', 'system',
  'takedown', 'talk', 'text', 'u', 'user', 'users',
  // and the ones people would take to look official
  'moderator', 'moderators', 'support', 'staff', 'team', 'official', 'root', 'null', 'undefined', 'anonymous', 'ghost',
]);

export type UsernameRefusal = 'invalid' | 'reserved' | 'taken';

/** Whether a handle is well formed and not a reserved word (not whether someone has it). */
export function usernameShape(name: string): UsernameRefusal | null {
  if (!SHAPE.test(name)) return 'invalid';
  const lower = name.toLowerCase();
  if (RESERVED_USERNAMES.has(lower) || lower.startsWith('reader-') || /^u-[0-9a-z]{10}$/.test(lower) || /^rh-/.test(lower)) return 'reserved';
  return null;
}

/** Why a handle cannot be had, in words for the sign-up form and the account page. */
export function usernameMessage(refusal: UsernameRefusal): string {
  if (refusal === 'invalid') return `a username is ${USERNAME_MIN} to ${USERNAME_MAX} Latin letters, digits and single hyphens, not starting or ending with a hyphen`;
  if (refusal === 'reserved') return 'that word is kept for the site itself; choose another';
  return 'someone already has that username; choose another';
}

/**
 * Common names as people write them in Hebrew, and as they spell them in
 * Latin letters: a handle suggested from "מנחם מענדל" reads `menachem-mendel`,
 * not the consonants alone.
 */
const HEBREW_NAMES: Record<string, string> = {
  מנחם: 'menachem', מענדל: 'mendel', מענדי: 'mendy', שמואל: 'shmuel', שמולי: 'shmuly', יוסף: 'yosef', יוסי: 'yossi',
  ישראל: 'yisroel', משה: 'moshe', לוי: 'levi', יצחק: 'yitzchak', אברהם: 'avraham', חיים: 'chaim', דוד: 'dovid', שלום: 'sholom',
  שניאור: 'schneur', זלמן: 'zalman', מרדכי: 'mordechai', אליהו: 'eliyahu', יהודה: 'yehuda', אהרן: 'aharon', אהרון: 'aharon',
  בנימין: 'binyomin', נחום: 'nochum', בערל: 'berel', יעקב: 'yaakov', צבי: 'tzvi', הירש: 'hirsh', דוב: 'dov', בער: 'ber',
  לייב: 'leib', מאיר: 'meir', נתן: 'nosson', פנחס: 'pinchas', שמעון: 'shimon', ראובן: 'reuven', גבריאל: 'gavriel',
  מיכאל: 'michoel', ברוך: 'boruch', זאב: 'zev', יחיאל: 'yechiel', יהושע: 'yehoshua', שלמה: 'shlomo', נחמן: 'nachman',
  אלחנן: 'elchonon', עזריאל: 'azriel', דובער: 'dovber', שניאורסון: 'schneerson', כהן: 'cohen', לוין: 'levin',
  חנה: 'chana', שרה: 'sara', רבקה: 'rivka', לאה: 'leah', רחל: 'rochel', מושקא: 'mushka', חיה: 'chaya', דבורה: 'devorah',
  אסתר: 'esther', מרים: 'miriam', שיינא: 'shaina', נחמה: 'nechama', בתיה: 'basya', פריידא: 'fraida', רייזל: 'raizel',
};

/** Hebrew letters as Latin ones, for names the list above does not know (the same letters as migration 0016's). */
const LETTERS: Record<string, string> = {
  א: 'a', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'o', ז: 'z', ח: 'ch', ט: 't', י: 'y', כ: 'k', ך: 'ch', ל: 'l', מ: 'm', ם: 'm',
  נ: 'n', ן: 'n', ס: 's', ע: 'a', פ: 'p', ף: 'f', צ: 'tz', ץ: 'tz', ק: 'k', ר: 'r', ש: 'sh', ת: 't',
};

/** A name in Latin letters: known Hebrew names as people spell them, other Hebrew letter by letter, accents dropped. */
export function transliterate(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[֑-ׇ̀-ͯ]/g, '') // niqqud, cantillation, accents
    .replace(/[״׳"']/g, '')
    .split(/(\s+|-)/)
    .map((word) => HEBREW_NAMES[word] ?? [...word].map((ch) => LETTERS[ch] ?? ch).join(''))
    .join('');
}

/** A name as a handle's shape: lower-case Latin letters and digits, words joined by hyphens; '' when nothing is left. */
export function slugForUsername(name: string): string {
  return transliterate(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

/** Whether nobody has this handle, or had it (the person asking may take back their own). */
async function available(db: Db, name: string, personId?: string): Promise<boolean> {
  const row = await one<{ taken: boolean }>(
    db,
    `SELECT EXISTS (SELECT 1 FROM auth.person WHERE lower(username) = lower($1) AND id IS DISTINCT FROM $2)
         OR EXISTS (SELECT 1 FROM auth.username_redirect WHERE old_username = lower($1) AND person_id IS DISTINCT FROM $2) AS taken`,
    [name, personId ?? null],
  );
  return !row!.taken;
}

/** Whether `name` may be this person's handle (or a new person's, with no id): null when it may, else why not. */
export async function checkUsername(db: Db, name: string, personId?: string): Promise<UsernameRefusal | null> {
  const shape = usernameShape(name);
  if (shape) return shape;
  return (await available(db, name, personId)) ? null : 'taken';
}

/**
 * A free handle for someone called `displayName`: their name in Latin
 * letters (`reader` when nothing is left of it); when that is taken or
 * reserved, the same with the first free number after it.
 */
export async function suggestUsername(db: Db, displayName: string, personId?: string): Promise<string> {
  const slug = slugForUsername(displayName);
  const base = slug.length >= USERNAME_MIN ? slug : 'reader';
  const joiner = base === 'reader' ? '' : '-';
  const candidates = [base, ...Array.from({ length: 48 }, (_, i) => `${base.slice(0, 34)}${joiner}${i + 2}`)].filter((c) => !usernameShape(c));
  const { rows } = await db.query<{ name: string }>(
    `SELECT lower(username) AS name FROM auth.person WHERE lower(username) = ANY($1::text[]) AND id IS DISTINCT FROM $2
     UNION SELECT old_username FROM auth.username_redirect WHERE old_username = ANY($1::text[]) AND person_id IS DISTINCT FROM $2`,
    [candidates, personId ?? null],
  );
  const taken = new Set(rows.map((r) => r.name));
  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;
  // Fifty people with the same name: a random tail settles it.
  const tail = new Uint8Array(3);
  crypto.getRandomValues(tail);
  return `${base.slice(0, 30)}-${[...tail].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A person's handle. Their old one keeps leading to them. After choosing
 * one themselves, they wait USERNAME_CHANGE_HOURS before choosing again.
 * Returns the handle as kept.
 */
export async function setUsername(db: Db, personId: string, name: string): Promise<string> {
  const wanted = name.trim();
  return db.transaction(async (tx) => {
    const person = await one<{ username: string; recent: boolean }>(
      tx,
      `SELECT username, coalesce(username_changed_at > now() - interval '${USERNAME_CHANGE_HOURS} hours', FALSE) AS recent FROM auth.person WHERE id = $1 FOR UPDATE`,
      [personId],
    );
    if (!person) throw invalid('no such person');
    if (person.username === wanted) return wanted;
    const refusal = await checkUsername(tx, wanted, personId);
    if (refusal) throw invalid(usernameMessage(refusal));
    // Only its case changes: nothing to redirect, and no wait.
    const caseOnly = person.username.toLowerCase() === wanted.toLowerCase();
    if (person.recent && !caseOnly) throw badState(`you changed your username in the last ${USERNAME_CHANGE_HOURS} hours; try again later`);
    if (!caseOnly) {
      await tx.query('INSERT INTO auth.username_redirect (old_username, person_id) VALUES (lower($1), $2) ON CONFLICT (old_username) DO NOTHING', [person.username, personId]);
      // Taking back an old handle: it is theirs again, no longer a redirect.
      await tx.query('DELETE FROM auth.username_redirect WHERE old_username = lower($1) AND person_id = $2', [wanted, personId]);
    }
    await tx.query(`UPDATE auth.person SET username = $2${caseOnly ? '' : ', username_changed_at = now()'} WHERE id = $1`, [personId, wanted]);
    return wanted;
  });
}

export interface PersonByName {
  id: string;
  username: string;
  displayName: string;
  /** Set when `name` is a handle the person used to have: pages send the reader on to the current one. */
  movedFrom?: string;
}

/** The person a handle names, now or before (case does not matter). */
export async function personByUsername(db: Db, name: string): Promise<PersonByName | null> {
  if (!SHAPE.test(name)) return null;
  const row = await one<{ id: string; username: string; display_name: string; moved: boolean }>(
    db,
    `SELECT id, username, display_name, FALSE AS moved FROM auth.person WHERE lower(username) = lower($1)
     UNION ALL
     SELECT p.id, p.username, p.display_name, TRUE FROM auth.username_redirect r JOIN auth.person p ON p.id = r.person_id WHERE r.old_username = lower($1)
     LIMIT 1`,
    [name],
  );
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name, ...(row.moved ? { movedFrom: name } : {}) };
}

/** Handles and names of these people (ids without a person, such as bots, are left out). */
export async function usernamesOf(db: Db, ids: readonly string[]): Promise<Map<string, { username: string; displayName: string }>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; username: string; display_name: string }>('SELECT id, username, display_name FROM auth.person WHERE id = ANY($1::text[])', [[...new Set(ids)]]);
  return new Map(rows.map((r) => [r.id, { username: r.username, displayName: r.display_name }]));
}

/** The people these handles name now (lower-cased handle to id); handles nobody has are left out. Old handles count. */
export async function idsOfUsernames(db: Db, names: readonly string[]): Promise<Map<string, string>> {
  const lower = [...new Set(names.map((n) => n.toLowerCase()))];
  if (lower.length === 0) return new Map();
  const { rows } = await db.query<{ name: string; id: string }>(
    `SELECT lower(username) AS name, id FROM auth.person WHERE lower(username) = ANY($1::text[])
     UNION
     SELECT old_username, person_id FROM auth.username_redirect WHERE old_username = ANY($1::text[])`,
    [lower],
  );
  return new Map(rows.map((r) => [r.name, r.id]));
}

export interface PersonHit {
  id: string;
  username: string;
  displayName: string;
  /** Whether they take part in the conversation being written in (they come first). */
  participant: boolean;
}

/**
 * People whose handle or name starts with what is being typed after `@`,
 * for the suggestions under a comment box: people in this conversation
 * first, then handles that start with it, then names that contain it.
 * Suspended accounts are left out.
 */
export async function searchPeople(db: Db, q: string, options: { limit?: number; participants?: readonly string[] } = {}): Promise<PersonHit[]> {
  const text = q.trim().replace(/^@/, '').slice(0, 60);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);
  const participants = [...(options.participants ?? [])];
  const like = `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await db.query<{ id: string; username: string; display_name: string; participant: boolean }>(
    `SELECT p.id, p.username, p.display_name, p.id = ANY($3::text[]) AS participant
     FROM auth.person p LEFT JOIN account a ON a.id = p.id
     WHERE a.suspended_at IS NULL
       AND ($1 = '' OR lower(p.username) LIKE lower($2) OR p.display_name ILIKE $2 OR p.display_name ILIKE '% ' || $2)
     ORDER BY (p.id = ANY($3::text[])) DESC, (lower(p.username) LIKE lower($2)) DESC, length(p.username), p.username
     LIMIT ${limit}`,
    [text, like, participants],
  );
  return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, participant: r.participant }));
}
