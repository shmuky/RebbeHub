import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { UPLOAD_LIMITS, adviseSuggestions, createPerson, getFile, registerFile, uploadAllowance, type Account, type Advisor, type EmailMessage } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { workersAiAdvisor } from '../src/mail.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * Trust and safety over the API (the plan, sections 7 and 11): live line
 * fixes reviewed after, new-account holds and rate limits on uploads, the
 * public takedown form with a steward's one-click takedown, and the
 * reviewer's machine-written advice.
 */

let app: Hono;
let fresh: Awaited<ReturnType<typeof freshCatalog>>;
let outbox: EmailMessage[];
let buckets: { public: Map<string, number>; preservation: Map<string, number> };

beforeEach(async () => {
  fresh = await freshCatalog();
  outbox = [];
  buckets = { public: new Map(), preservation: new Map() };
  const writer = (bucket: Map<string, number>) => ({ put: async (key: string, bytes: ArrayBuffer) => void bucket.set(key, bytes.byteLength) });
  app = createApp({
    catalog: fresh.catalog,
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    mailer: { send: async (m) => void outbox.push(m) },
    uploads: { public: writer(buckets.public), preservation: writer(buckets.preservation), maxBytes: 1000 },
  });
});

const call = async (method: string, path: string, options: { body?: unknown; as?: string; ip?: string } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  if (options.ip) headers['CF-Connecting-IP'] = options.ip;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

/** A text in an open set, and its first paragraph, for line fixes. */
async function openText() {
  const { catalog } = fresh;
  const open = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'לקוטי שיחות' }, slug: 'ls', policy: 'open', keepers: ['keeper'] });
  const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'לקוטי שיחות' }, slug: 'likkutei-sichos', authors: [], genre: 'sichos', levels: ['volume', 'sicha'], sets: [open] });
  const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '1' }], order: 'V', label: { he: 'חלק א, שיחה א' } });
  const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit, language: 'he' });
  const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'V', kind: 'paragraph', content: 'בראשית ברא', proofread: 0 });
  return { text, segment };
}

describe('trusted line fixes', () => {
  it('go live at once in open sets, and a keeper keeps or undoes them after', async () => {
    const { catalog } = fresh;
    const { text, segment } = await openText();
    await catalog.db.query("UPDATE account SET trust = 'trusted', approved_count = 20 WHERE id = 'chaim'");
    const fix = async (content: string) => {
      const cs = await catalog.createChangeset('chaim', { title: 'Fix a line' });
      await catalog.putRevision(cs.id, 'chaim', { id: segment, type: 'segment', data: { text, order: 'V', kind: 'paragraph', content, proofread: 1 } });
      return catalog.submit(cs.id, 'chaim');
    };
    const first = await fix('בראשית ברא אלקים');
    expect(first).toMatchObject({ status: 'merged', post_review: 'pending' });

    const listed = await call('GET', '/v1/suggestions?postReview=true');
    expect(listed.body.suggestions.map((s: { id: number }) => s.id)).toEqual([first.id]);
    expect((await call('GET', `/v1/suggestions/${first.id}`, { as: 'keeper' })).body.mayApprove).toBe(true);
    expect((await call('GET', `/v1/suggestions/${first.id}`, { as: 'mendy' })).body.mayApprove).toBe(false);
    expect((await call('POST', `/v1/suggestions/${first.id}/review-live`, { as: 'mendy', body: { verdict: 'approve' } })).status).toBe(403);
    expect((await call('POST', `/v1/suggestions/${first.id}/review-live`, { as: 'keeper', body: { verdict: 'approve' } })).status).toBe(200);
    expect((await call('GET', '/v1/suggestions?postReview=true')).body.suggestions).toEqual([]);

    const second = await fix('בראשית ברא xxx');
    const undone = await call('POST', `/v1/suggestions/${second.id}/review-live`, { as: 'keeper', body: { verdict: 'revert', note: 'not what the page says' } });
    expect(undone.status).toBe(200);
    expect(undone.body.revertChangeset).toBeGreaterThan(0);
    expect((await catalog.get(segment))!.data).toMatchObject({ content: 'בראשית ברא אלקים' });
  });
});

describe('uploads', () => {
  const upload = async (as: string, bytes = new Uint8Array([1, 2, 3])) => {
    const response = await app.request(`/v1/uploads?what=recording&for=${event}&rights=mine`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg', 'X-Test-Account': as }, body: bytes });
    return { status: response.status, body: (await response.json()) as any };
  };
  let event: EntityId;

  it('hold new accounts for a day, unless a suggestion of theirs was approved', async () => {
    const { catalog, set } = fresh;
    event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const person = await createPerson(catalog.db, 'New here');
    await catalog.createAccount({ id: person.id, displayName: 'New here' });
    const held = await upload(person.id);
    expect(held.status).toBe(403);
    expect(held.body.message).toMatch(/new accounts add files 24 hours after signing up/);
    await catalog.db.query("UPDATE auth.person SET created_at = now() - interval '2 days' WHERE id = $1", [person.id]);
    expect((await upload(person.id)).status).toBe(201);
  });

  it('are limited a day per person', async () => {
    const { catalog, set } = fresh;
    event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    for (let i = 0; i < UPLOAD_LIMITS.contributor.files; i++) {
      await registerFile(catalog.db, { sha256: i.toString(16).padStart(64, '0'), bytes: 10, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true, uploadedBy: 'chaim' });
    }
    const limited = await upload('chaim');
    expect(limited).toMatchObject({ status: 429, body: { message: expect.stringMatching(/at most 20 files a day/) } });
    expect((await upload('shmuly')).status).toBe(201);
  });

  it('follow the plan: stewards and bots are never held, bytes count too', () => {
    const base: Account = { id: 'x', display_name: 'X', trust: 'contributor', is_steward: false, is_bot: false, approved_count: 0, reverted_count: 0, suspended_at: null };
    const seen = { accountAgeHours: 1, filesToday: 0, bytesToday: 0, adding: 10 };
    expect(uploadAllowance(base, seen)).toMatchObject({ ok: false, reason: 'hold' });
    expect(uploadAllowance({ ...base, approved_count: 1 }, seen)).toEqual({ ok: true });
    expect(uploadAllowance({ ...base, is_steward: true }, seen)).toEqual({ ok: true });
    expect(uploadAllowance(base, { ...seen, accountAgeHours: null })).toEqual({ ok: true });
    expect(uploadAllowance(base, { ...seen, accountAgeHours: 48, bytesToday: UPLOAD_LIMITS.contributor.bytes })).toMatchObject({ ok: false, reason: 'bytes' });
    expect(uploadAllowance({ ...base, trust: 'trusted' }, { ...seen, accountAgeHours: 48, filesToday: 50 })).toEqual({ ok: true });
    expect(uploadAllowance({ ...base, suspended_at: '2026-01-01' }, seen)).toMatchObject({ ok: false, reason: 'suspended' });
  });
});

describe('takedowns', () => {
  it('are asked for with no account, read by stewards alone, and a file is taken down in one click, logged', async () => {
    const { catalog, set } = fresh;
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
    const sha256 = 'e'.repeat(64);
    await registerFile(catalog.db, { sha256, bytes: 5, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true, uploadedBy: 'mendy' });
    await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, file: sha256, sets: [set] });

    const bad = await call('POST', '/v1/takedowns', { body: { target: '/events/5742-05-10', name: 'A', email: 'nope', relation: 'family', statement: 'This is our family recording.' } });
    expect(bad.status).toBe(422);
    const asked = await call('POST', '/v1/takedowns', {
      ip: '203.0.113.9',
      body: { target: 'https://rebbehub.org/events/5742-05-10', name: 'Rivka Cohen', email: 'rivka@example.org', relation: 'family', statement: 'This is our family recording; please take it down.' },
    });
    expect(asked).toMatchObject({ status: 201, body: { answerWithinDays: 3 } });
    // A receipt with when to expect an answer.
    expect(outbox[0]).toMatchObject({ to: 'rivka@example.org', subject: `RebbeHub: takedown request ${asked.body.id} received` });
    expect(outbox[0]!.text).toContain('within 3 days');

    // It is a Report on the item (reason rights) in the set's inbox; who asked is kept for stewards.
    const inbox = await call('GET', `/v1/reports?set=${set}`, { as: 'keeper' });
    expect(inbox.body.reports[0]).toMatchObject({ entity_id: event, reason: 'rights' });
    expect(JSON.stringify(inbox.body)).not.toContain('rivka@example.org');
    expect((await call('GET', '/v1/admin/takedowns', { as: 'keeper' })).status).toBe(403);
    const list = await call('GET', '/v1/admin/takedowns', { as: 'shmuly' });
    expect(list.body.takedowns).toEqual([
      expect.objectContaining({ report: asked.body.id, name: 'Rivka Cohen', email: 'rivka@example.org', relation: 'family', entityId: event, files: [expect.objectContaining({ sha256, rights: 'open' })] }),
    ]);

    expect((await call('POST', `/v1/admin/files/${sha256}/takedown`, { as: 'keeper', body: { report: asked.body.id } })).status).toBe(403);
    expect((await call('POST', `/v1/admin/files/${sha256}/takedown`, { as: 'shmuly', body: { report: asked.body.id } })).status).toBe(200);
    expect(await getFile(catalog.db, sha256)).toMatchObject({ rights_state: 'preserved' });
    expect(await catalog.auditLog({ kind: 'file', id: sha256 })).toEqual([expect.objectContaining({ actor: 'shmuly', action: 'file.rights', detail: { from: 'open', to: 'preserved', note: `takedown request ${asked.body.id}` } })]);
    expect((await call('GET', `/v1/files/${sha256}`)).body.url).toBeNull();

    // Done: the request is closed like any report.
    expect((await call('POST', `/v1/reports/${asked.body.id}/close`, { as: 'shmuly', body: { outcome: 'resolved' } })).status).toBe(200);
    expect((await call('GET', '/v1/admin/takedowns', { as: 'shmuly' })).body.takedowns).toEqual([]);
  });

  it('keeps a request for a file named by its address, and one it cannot place', async () => {
    const { catalog } = fresh;
    const sha256 = 'f'.repeat(64);
    await registerFile(catalog.db, { sha256, bytes: 5, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    const byFile = await call('POST', '/v1/takedowns', { body: { target: `https://api.rebbehub.org/objects/${sha256}`, name: 'Kehot', email: 'rights@example.org', relation: 'rights-holder', statement: 'We hold the rights to this printing.' } });
    const unknown = await call('POST', '/v1/takedowns', { body: { target: '/nothing/here', name: 'Someone', email: 'a@example.org', relation: 'other', statement: 'Something of ours is on the site.' } });
    expect([byFile.status, unknown.status]).toEqual([201, 201]);
    const list = (await call('GET', '/v1/admin/takedowns', { as: 'shmuly' })).body.takedowns;
    expect(list.map((t: { files: unknown[] }) => t.files.length)).toEqual([1, 0]);
  });
});

describe("the reviewer's advice", () => {
  it('is written by a machine for suggestions waiting for review, shown as advice, and never sees withheld words', async () => {
    const { catalog, set } = fresh;
    const event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set));
    const cs = await catalog.createChangeset('chaim', { title: 'Fix the date', description: 'The hanacha says 11 Shvat' });
    await catalog.putRevision(cs.id, 'chaim', { id: event, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } });
    await catalog.submit(cs.id, 'chaim');

    const prompts: string[] = [];
    const advisor: Advisor = { model: 'test-model', complete: async (_system, user) => (prompts.push(user), 'It moves the farbrengen from 10 to 11 Shvat. Check the hanacha.') };
    expect((await call('GET', `/v1/suggestions/${cs.id}`)).body.advice).toBeNull();
    expect(await adviseSuggestions(catalog, advisor)).toBe(1);
    expect(prompts[0]).toContain('Fix the date');
    expect(prompts[0]).toContain('/date: 5742-05-10 -> 5742-05-11');
    const shown = (await call('GET', `/v1/suggestions/${cs.id}`)).body.advice;
    expect(shown).toMatchObject({ summary: 'It moves the farbrengen from 10 to 11 Shvat. Check the hanacha.', model: 'test-model', machine: true });
    // Written once for how it was sent; the suggestion itself is untouched.
    expect(await adviseSuggestions(catalog, advisor)).toBe(0);
    expect((await catalog.changeset(cs.id)).status).toBe('open');

    // Sent back and sent again: written again.
    await catalog.sendBack(cs.id, 'keeper', 'Which hanacha?');
    await catalog.submit(cs.id, 'chaim');
    expect((await call('GET', `/v1/suggestions/${cs.id}`)).body.advice).toBeNull();
    expect(await adviseSuggestions(catalog, advisor)).toBe(1);

    // A failing model is tried again a few times, then left alone.
    const other = await catalog.createChangeset('mendy', { title: 'Another' });
    await catalog.putRevision(other.id, 'mendy', { id: event, type: 'event', data: { ...yudShvat(set), title: { he: 'יו״ד שבט' } } });
    await catalog.submit(other.id, 'mendy');
    const broken: Advisor = { model: 'test-model', complete: async () => Promise.reject(new Error('down')) };
    for (let i = 0; i < 4; i++) expect(await adviseSuggestions(catalog, broken)).toBe(0);
    const { rows } = await catalog.db.query<{ attempts: number; error: string }>('SELECT attempts, error FROM changeset_advice WHERE changeset_id = $1', [other.id]);
    expect(rows[0]).toEqual({ attempts: 3, error: 'down' });

    // Words whose rights keep them home are not sent.
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה' } });
    const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit, language: 'he', licence: 'site-terms' });
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text, order: 'V', kind: 'paragraph', content: 'מילים סגורות', proofread: 0 });
    const closed = await catalog.createChangeset('chaim', { title: 'Fix closed words' });
    await catalog.putRevision(closed.id, 'chaim', { id: segment, type: 'segment', data: { text, order: 'V', kind: 'paragraph', content: 'מילים סגורות מתוקנות', proofread: 1 } });
    await catalog.submit(closed.id, 'chaim');
    prompts.length = 0;
    await adviseSuggestions(catalog, advisor);
    const closedPrompt = prompts.find((p) => p.includes('Fix closed words'))!;
    expect(closedPrompt).toContain('withheld');
    expect(closedPrompt).not.toContain('מילים סגורות');
  });

  it('asks Workers AI with the secret', async () => {
    const seen: Array<{ url: string; body: any }> = [];
    const advisor = workersAiAdvisor({
      accountId: 'acc',
      token: 'tok',
      fetch: (async (url: string, init: RequestInit) => (seen.push({ url, body: JSON.parse(String(init.body)) }), Response.json({ success: true, result: { response: ' A summary. ' } }))) as typeof fetch,
    });
    expect(await advisor.complete('system', 'user')).toBe(' A summary. ');
    expect(seen[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(seen[0]!.body.messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user' },
    ]);
  });
});
