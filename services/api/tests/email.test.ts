import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { linkGoogle, createPerson, sendNotifications, type EmailMessage, type Mailer } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { resendMailer } from '../src/mail.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * Signing in by email link, and notifications by email, over the API. The
 * mail goes to a list instead of Resend; everything else runs as in
 * production.
 */

const SITE = 'https://rebbehub.test';
let app: Hono;
let outbox: EmailMessage[];
let fresh: Awaited<ReturnType<typeof freshCatalog>>;

const mailer: Mailer = { send: async (message) => void outbox.push(message) };

beforeEach(async () => {
  fresh = await freshCatalog();
  outbox = [];
  app = createApp({ catalog: fresh.catalog, mailer, auth: { rpId: 'rebbehub.test', rpName: 'RebbeHub', origins: [SITE] } });
});

const call = async (method: string, path: string, options: { body?: unknown; cookie?: string } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: SITE };
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await app.request(`${SITE}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
};

/** The token in the last email's link. */
const lastToken = () => new URL(/https:\/\/\S+/.exec(outbox.at(-1)!.text)![0]).searchParams.get('email-token')!;

async function signUp(email: string, name: string) {
  await call('POST', '/v1/auth/email/start', { body: { email } });
  return call('POST', '/v1/auth/email/verify', { body: { token: lastToken(), name } });
}

describe('signing in by email link', () => {
  it('is hidden while the site cannot send email', async () => {
    const off = createApp({ catalog: fresh.catalog, auth: { rpId: 'rebbehub.test', rpName: 'RebbeHub', origins: [SITE] } });
    const me = await off.request(`${SITE}/v1/auth/me`);
    expect(await me.json()).toMatchObject({ person: null, email: false });
    const start = await off.request(`${SITE}/v1/auth/email/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE }, body: JSON.stringify({ email: 'a@b.org' }) });
    expect(start.status).toBe(400);
    expect((await call('GET', '/v1/auth/me')).body.email).toBe(true);
  });

  it('sends a link, asks a new person their name, then makes the account and signs it in, once', async () => {
    const sent = await call('POST', '/v1/auth/email/start', { body: { email: '  Mendy@Example.ORG ', return: '/review', lang: 'en' } });
    expect(sent).toMatchObject({ status: 200, body: { sent: true } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: 'mendy@example.org', subject: 'RebbeHub: your sign-in link' });
    expect(outbox[0]!.text).toContain(`${SITE}/signin?email-token=`);
    expect(outbox[0]!.text).toContain('return=%2Freview');
    const token = lastToken();

    expect(await call('POST', '/v1/auth/email/check', { body: { token } })).toMatchObject({ status: 200, body: { email: 'mendy@example.org', known: false, adding: null, suggestedName: 'mendy' } });
    // No name: refused, and the link still works.
    expect((await call('POST', '/v1/auth/email/verify', { body: { token } })).status).toBe(400);
    const made = await call('POST', '/v1/auth/email/verify', { body: { token, name: 'Mendy' } });
    expect(made).toMatchObject({ status: 201, body: { created: true, person: { displayName: 'Mendy' } } });
    expect(made.cookie).toMatch(/^__Host-rh_session=/);
    const me = await call('GET', '/v1/auth/me', { cookie: made.cookie });
    expect(me.body.emails).toEqual([expect.objectContaining({ email: 'mendy@example.org', google: false })]);
    expect(me.body).toMatchObject({ trust: 'contributor', notifications: { mode: 'off' } });

    // Used once only.
    expect((await call('POST', '/v1/auth/email/verify', { body: { token, name: 'Mendy' } })).status).toBe(400);
    expect((await call('POST', '/v1/auth/email/check', { body: { token } })).status).toBe(400);
  });

  it('signs a known address into its own account, never a second one', async () => {
    const first = await signUp('mendy@example.org', 'Mendy');
    await call('POST', '/v1/auth/email/start', { body: { email: 'MENDY@example.org' } });
    expect((await call('POST', '/v1/auth/email/check', { body: { token: lastToken() } })).body.known).toBe(true);
    const again = await call('POST', '/v1/auth/email/verify', { body: { token: lastToken() } });
    expect(again).toMatchObject({ status: 200, body: { created: false, person: { id: first.body.person.id } } });
  });

  it('signs the email of a linked Google account into that account', async () => {
    const person = await createPerson(fresh.catalog.db, 'Chaim');
    await linkGoogle(fresh.catalog.db, 'google-sub-1', person.id, 'Chaim@Gmail.com');
    await call('POST', '/v1/auth/email/start', { body: { email: 'chaim@gmail.com' } });
    const signedIn = await call('POST', '/v1/auth/email/verify', { body: { token: lastToken() } });
    expect(signedIn.body.person.id).toBe(person.id);
  });

  it('adds an address to the signed-in account from the account page, never one that is someone else\'s', async () => {
    const mendy = await signUp('mendy@example.org', 'Mendy');
    await signUp('chaim@example.org', 'Chaim');
    expect(await call('POST', '/v1/auth/email/start', { body: { email: 'chaim@example.org' }, cookie: mendy.cookie })).toMatchObject({ status: 400 });

    await call('POST', '/v1/auth/email/start', { body: { email: 'mendy@work.example' }, cookie: mendy.cookie });
    expect(outbox.at(-1)!.subject).toBe('RebbeHub: אישור כתובת המייל');
    expect((await call('POST', '/v1/auth/email/check', { body: { token: lastToken() } })).body.adding).toEqual({ displayName: 'Mendy' });
    // Opened in another browser, it adds the address without signing that browser in.
    const added = await call('POST', '/v1/auth/email/verify', { body: { token: lastToken() } });
    expect(added).toMatchObject({ status: 200, body: { added: 'mendy@work.example' } });
    expect(added.cookie).toBeUndefined();
    const me = await call('GET', '/v1/auth/me', { cookie: mendy.cookie });
    expect(me.body.emails.map((e: { email: string }) => e.email)).toEqual(['mendy@example.org', 'mendy@work.example']);
  });

  it('sends one address only so many links an hour, and says the same whether or not it has an account', async () => {
    for (let i = 0; i < 5; i++) expect((await call('POST', '/v1/auth/email/start', { body: { email: 'x@example.org' } })).status).toBe(200);
    expect((await call('POST', '/v1/auth/email/start', { body: { email: 'x@example.org' } })).status).toBe(429);
    expect((await call('POST', '/v1/auth/email/start', { body: { email: 'not an address' } })).status).toBe(400);
  });

  it('sends through Resend with the key', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const resend = resendMailer({ apiKey: 're_test', fetch: (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response('{"id":"1"}'))) as typeof fetch });
    await resend.send({ to: 'a@b.org', subject: 'S', text: 'T', html: '<p>T</p>' });
    expect(seen[0]!.url).toBe('https://api.resend.com/emails');
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(seen[0]!.init.body))).toMatchObject({ from: 'RebbeHub <no-reply@rebbehub.org>', to: ['a@b.org'], subject: 'S' });
  });
});

describe('notifications by email', () => {
  it('writes what changed in what a person follows, at once or as a daily digest, and stops in one click', async () => {
    const { catalog, set } = fresh;
    const chaim = await signUp('chaim@example.org', 'Chaim');
    const chaimId = chaim.body.person.id as string;
    await catalog.createAccount({ id: chaimId, displayName: 'Chaim' });
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await catalog.follow(chaimId, { kind: 'entity', id: event });

    expect((await call('POST', '/v1/auth/notifications', { body: { mode: 'immediate', email: 'other@example.org' }, cookie: chaim.cookie })).status).toBe(400);
    const on = await call('POST', '/v1/auth/notifications', { body: { mode: 'immediate', lang: 'en' }, cookie: chaim.cookie });
    expect(on.body.notifications).toEqual({ mode: 'immediate', email: null, lang: 'en' });

    // Nothing new since switching on: nothing is sent.
    outbox = [];
    expect(await sendNotifications(catalog, mailer, { siteUrl: SITE })).toEqual({ sent: 0, looked: 0 });

    const fix = await catalog.createChangeset('mendy', { title: 'Fix the date' });
    await catalog.putRevision(fix.id, 'mendy', { id: event, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } });
    await catalog.submit(fix.id, 'mendy');
    await catalog.merge(fix.id, 'keeper');
    expect(await sendNotifications(catalog, mailer, { siteUrl: SITE })).toEqual({ sent: 1, looked: 1 });
    expect(outbox[0]).toMatchObject({ to: 'chaim@example.org', subject: 'RebbeHub: one change in what you follow' });
    expect(outbox[0]!.text).toContain('Fix the date');
    expect(outbox[0]!.text).toContain(`${SITE}/${event}?lang=en`);
    expect(outbox[0]!.headers!['List-Unsubscribe']).toMatch(/\/_\/auth\/email\/unsubscribe\?token=/);
    // Told once.
    expect((await sendNotifications(catalog, mailer, { siteUrl: SITE })).sent).toBe(0);

    // A daily digest: sent, then not again within the day.
    await call('POST', '/v1/auth/notifications', { body: { mode: 'daily' }, cookie: chaim.cookie });
    await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'הקדמה' }, sets: [set] });
    // The last email was minutes ago: the digest waits for the day to pass.
    expect((await sendNotifications(catalog, mailer, { siteUrl: SITE })).sent).toBe(0);
    await catalog.db.query("UPDATE auth.notification_setting SET last_sent_at = now() - interval '25 hours'");
    await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, sets: [set] });
    expect((await sendNotifications(catalog, mailer, { siteUrl: SITE })).sent).toBe(1);
    expect(outbox.at(-1)!.subject).toBe('RebbeHub: 2 שינויים במה שאתם עוקבים אחריו');
    await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק ב' }, sets: [set] });
    expect((await sendNotifications(catalog, mailer, { siteUrl: SITE })).sent).toBe(0);

    // "Stop these emails", with no sign-in.
    const token = new URL(/<(.+)>/.exec(outbox.at(-1)!.headers!['List-Unsubscribe']!)![1]!).searchParams.get('token');
    expect((await call('POST', '/v1/auth/email/unsubscribe', { body: { token } })).body).toEqual({ stopped: true });
    expect((await call('GET', '/v1/auth/me', { cookie: chaim.cookie })).body.notifications.mode).toBe('off');
  });

  it("leaves out a person's own changes", async () => {
    const { catalog, set } = fresh;
    const mendy = await signUp('mendy@example.org', 'Mendy');
    const id = mendy.body.person.id as string;
    await catalog.createAccount({ id, displayName: 'Mendy' });
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    await catalog.follow(id, { kind: 'entity', id: event });
    await call('POST', '/v1/auth/notifications', { body: { mode: 'immediate' }, cookie: mendy.cookie });
    await add(catalog, id, 'keeper', 'recording', { event, title: { he: 'חלק א' }, sets: [set] });
    // Their inbox (the keeper reviewed their suggestion) is another matter, and already read here.
    await catalog.db.query('UPDATE auth.notification SET read_at = now()');
    outbox = [];
    expect(await sendNotifications(catalog, mailer, { siteUrl: SITE })).toEqual({ sent: 0, looked: 1 });
  });
});
