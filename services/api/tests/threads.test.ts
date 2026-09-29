import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, personByUsername, sendNotifications, setUsername, slugForUsername, suggestUsername, type EmailMessage } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * People and conversations over the API: handles, @mentions and the
 * inbox, suggestions reviewed like pull requests, and reports kept like
 * issues (packages/core: usernames, threads, conversation, issues).
 */

let app: Hono;
let fresh: Awaited<ReturnType<typeof freshCatalog>>;
let event: EntityId;

beforeEach(async () => {
  fresh = await freshCatalog();
  const { catalog } = fresh;
  // The helper's accounts, as people with handles (the keeper's own word is kept for the site).
  for (const [id, name, handle] of [
    ['shmuly', 'Shmuly', 'shmuly'],
    ['keeper', 'Set keeper', 'setkeeper'],
    ['mendy', 'Mendy', 'Mendy'],
    ['chaim', 'Chaim', 'chaim'],
  ]) {
    await catalog.db.query('INSERT INTO auth.person (id, display_name, username) VALUES ($1, $2, $3)', [id, name, handle]);
  }
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(fresh.set), '/events/5742-05-10');
  await catalog.db.query('DELETE FROM auth.notification');
  app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null });
});

const call = async (method: string, path: string, options: { as?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

const inboxOf = async (who: string) => (await call('GET', '/v1/inbox', { as: who })).body;

describe('handles', () => {
  it('are suggested from a name, Hebrew ones spelled as people spell them, and unique whatever the case', async () => {
    const { db } = fresh.catalog;
    expect(slugForUsername('מנחם מענדל כהן')).toBe('menachem-mendel-cohen');
    expect(slugForUsername('Chaya  Mushka!')).toBe('chaya-mushka');
    expect(await suggestUsername(db, 'Mendy')).toBe('mendy-2'); // Mendy is taken, in any case
    expect(await suggestUsername(db, '???')).toBe('reader');
    expect(await suggestUsername(db, 'Admin')).toBe('admin-2'); // a word the site keeps
    const person = await createPerson(db, 'שמואל');
    expect(person.username).toBe('shmuel');
    await expect(createPerson(db, 'Someone', 'MENDY')).rejects.toThrow(/already has that username/);
    await expect(createPerson(db, 'Someone', 'inbox')).rejects.toThrow(/kept for the site/);
    await expect(createPerson(db, 'Someone', '-bad-')).rejects.toThrow(/Latin letters/);
  });

  it('change, and the old one still leads to its person and is kept from anyone else', async () => {
    const { db } = fresh.catalog;
    const person = await createPerson(db, 'Levi');
    expect(await setUsername(db, person.id, 'levi-y')).toBe('levi-y');
    expect(await personByUsername(db, 'LEVI')).toMatchObject({ id: person.id, username: 'levi-y', movedFrom: 'LEVI' });
    await expect(createPerson(db, 'Another Levi', 'levi')).rejects.toThrow(/already has/);
    // Once a day, but the case of one's own handle may change at any time.
    await expect(setUsername(db, person.id, 'levi-z')).rejects.toThrow(/last 24 hours/);
    expect(await setUsername(db, person.id, 'Levi-Y')).toBe('Levi-Y');
    const page = await call('GET', '/v1/people/levi');
    expect(page.body).toMatchObject({ person: { id: person.id, username: 'Levi-Y', displayName: 'Levi' }, movedFrom: 'levi' });
  });

  it('are offered after @, people in the conversation first', async () => {
    const found = await call('GET', '/v1/people?q=ch');
    expect(found.body.people.map((p: { username: string }) => p.username)).toEqual(['chaim']);
    const all = await call('GET', `/v1/people?q=&thread=report:1`);
    expect(all.body.people.length).toBe(4);
  });
});

describe('suggestions as pull requests', () => {
  it('ask the keepers to review, gather comments on fields, request changes, re-request, approve and close what they fix', async () => {
    // Chaim opens an issue; Mendy's suggestion says it fixes it.
    const issue = await call('POST', '/v1/issues', { as: 'chaim', body: { title: 'The date is a day off', body: 'It was on the 11th', type: 'wrong-fact', entityId: event } });
    expect(issue.status).toBe(201);
    expect(issue.body).toMatchObject({ title: 'The date is a day off', state: 'open', type: 'wrong-fact', author: 'chaim', private: false });
    // The keeper of the set hears of a new issue in it.
    expect((await inboxOf('keeper')).items[0]).toMatchObject({ reason: 'followed', subject: { kind: 'report', number: issue.body.number } });

    const made = await call('POST', '/v1/suggestions/quick', {
      as: 'mendy',
      body: { entityId: event, data: { ...yudShvat(fresh.set), date: '5742-05-11' }, title: 'Fix the date', note: `Fixes #${issue.body.number}. @chaim, can you check?` },
    });
    expect(made.status).toBe(201);
    const id = made.body.id as number;
    const number = made.body.number as number;
    expect(number).toBeGreaterThan(issue.body.number);
    expect((await call('GET', `/v1/threads/${number}`)).body).toEqual({ kind: 'suggestion', number, id });

    // Chaim was named; the keeper is asked to review (as a code owner would be).
    expect((await inboxOf('chaim')).items.map((l: { reason: string }) => l.reason)).toContain('mention');
    const keeperInbox = await inboxOf('keeper');
    expect(keeperInbox.items[0]).toMatchObject({ reason: 'review_requested', subject: { kind: 'changeset', number, title: 'Fix the date', state: 'open' } });
    let conversation = (await call('GET', `/v1/suggestions/${id}/conversation`)).body;
    expect(conversation.reviewRequests.map((r: { reviewer: string }) => r.reviewer)).toEqual(['keeper']);
    expect(conversation.fixes).toEqual([{ number: issue.body.number, title: 'The date is a day off', state: 'open', private: false }]);
    // The issue says which suggestion mentioned it.
    const referenced = (await call('GET', `/v1/issues/${issue.body.number}`)).body.timeline.find((i: { kind?: string }) => i.kind === 'referenced');
    expect(referenced).toMatchObject({ actor: 'mendy', detail: { from: { kind: 'changeset', number }, closes: true } });

    // Nobody but a keeper asks for changes; anyone comments, on the whole or on one field.
    expect((await call('POST', `/v1/suggestions/${id}/reviews`, { as: 'chaim', body: { verdict: 'request_changes', body: 'no' } })).status).toBe(403);
    const field = await call('POST', `/v1/suggestions/${id}/comments`, { as: 'chaim', body: { body: 'The printed calendar agrees', anchor: { entity: event, field: '/date' } } });
    expect(field.status).toBe(201);
    expect((await call('POST', `/v1/suggestions/${id}/comments`, { as: 'chaim', body: { body: 'x', anchor: { entity: 'rh-zzzzzzzz', field: '/date' } } })).status).toBe(422);

    const review = await call('POST', `/v1/suggestions/${id}/reviews`, {
      as: 'keeper',
      body: { verdict: 'request_changes', body: 'Please cite the source, @Mendy', comments: [{ entity: event, field: '/date', body: 'Which calendar?' }] },
    });
    expect(review.status).toBe(201);
    expect(review.body.status).toBe('sent_back');
    expect((await inboxOf('mendy')).items.map((l: { reason: string }) => l.reason)).toEqual(expect.arrayContaining(['mention']));
    conversation = (await call('GET', `/v1/suggestions/${id}/conversation`)).body;
    expect(conversation.reviewRequests).toEqual([]);
    const reviewItem = conversation.timeline.find((i: { type: string; verdict?: string }) => i.type === 'review' && i.verdict === 'send_back');
    expect(conversation.timeline.find((i: { type: string; review?: number }) => i.type === 'comment' && i.review === reviewItem.id)).toMatchObject({ body: 'Which calendar?', anchor: { entity: event, field: '/date' } });
    expect(conversation.people.keeper).toEqual({ name: 'Set keeper', username: 'setkeeper', bot: false });

    // Resolving a conversation on a field; editing the description.
    expect((await call('POST', `/v1/comments/${field.body.id}/resolve`, { as: 'mendy', body: { resolved: true } })).status).toBe(200);
    const edited = await call('PATCH', `/v1/suggestions/${id}`, { as: 'mendy', body: { title: 'Fix the date (source: Hayom Yom)', description: `Fixes #${issue.body.number}. Source in the comments.` } });
    expect(edited.body.title).toBe('Fix the date (source: Hayom Yom)');
    expect((await call('PATCH', `/v1/suggestions/${id}`, { as: 'chaim', body: { title: 'mine' } })).status).toBe(403);

    // Sent again: whoever asked for changes is asked again.
    await fresh.catalog.submit(id, 'mendy');
    conversation = (await call('GET', `/v1/suggestions/${id}/conversation`)).body;
    expect(conversation.reviewRequests.map((r: { reviewer: string }) => r.reviewer)).toEqual(['keeper']);
    // The author asks someone else too, then takes it back.
    expect((await call('POST', `/v1/suggestions/${id}/review-requests`, { as: 'mendy', body: { reviewers: ['@chaim'] } })).body.requested).toEqual(['chaim']);
    expect((await call('POST', `/v1/suggestions/${id}/review-requests`, { as: 'mendy', body: { reviewers: ['nobody-here'] } })).status).toBe(422);
    expect((await call('DELETE', `/v1/suggestions/${id}/review-requests/chaim`, { as: 'mendy' })).status).toBe(200);

    // Approve: it merges, and the issue it fixes closes, done, by it.
    const approved = await call('POST', `/v1/suggestions/${id}/reviews`, { as: 'keeper', body: { verdict: 'approve', body: 'Thank you' } });
    expect(approved.body).toMatchObject({ status: 'merged' });
    expect(approved.body.commit).toBeGreaterThan(0);
    const closed = (await call('GET', `/v1/issues/${issue.body.number}`)).body;
    expect(closed.issue).toMatchObject({ state: 'closed', stateReason: 'completed', closedBy: 'keeper', closedBySuggestion: number });
    expect(closed.fixedBy).toEqual([{ number, title: 'Fix the date (source: Hayom Yom)', status: 'merged' }]);
    expect((await inboxOf('chaim')).items.some((l: { reason: string; subject: { kind: string } }) => l.reason === 'state' && l.subject.kind === 'report')).toBe(true);

    const kinds = (await call('GET', `/v1/suggestions/${id}/conversation`)).body.timeline.map((i: { type: string; kind?: string; verdict?: string }) => i.kind ?? i.verdict ?? i.type);
    expect(kinds).toEqual(['opened', 'submitted', 'review_requested', 'comment', 'send_back', 'comment', 'renamed', 'submitted', 'review_requested', 'review_requested', 'review_request_removed', 'approve', 'merged']);

    // Listed as a closed conversation, by number.
    const list = (await call('GET', '/v1/suggestions?state=closed&author=mendy')).body;
    expect(list.suggestions[0]).toMatchObject({ number, status: 'merged', fixes: [issue.body.number], approvals: 1 });
    expect(list.people.mendy.username).toBe('Mendy');
    // The old list still answers as it did.
    expect((await call('GET', '/v1/suggestions?status=merged')).body.suggestions[0]).toHaveProperty('base_commit');
  });
});

describe('reports as issues', () => {
  it('are opened from a template, labelled, taken on, listed by filters, closed and opened again', async () => {
    const templates = (await call('GET', '/v1/issues/templates')).body.templates;
    expect(templates.find((t: { type: string }) => t.type === 'wrong-text').template.en).toMatch(/Where/);

    const opened = await call('POST', '/v1/issues', { as: 'mendy', body: { title: 'Page 12 is blurred', type: 'bad-scan', entityId: event, labels: ['help wanted'] } });
    const n = opened.body.number as number;
    expect(opened.body.labels).toEqual([]); // a contributor cannot label

    expect((await call('PUT', `/v1/issues/${n}/labels`, { as: 'mendy', body: { labels: ['help wanted'] } })).status).toBe(403);
    expect((await call('PUT', `/v1/issues/${n}/labels`, { as: 'keeper', body: { labels: ['help wanted', 'machine'] } })).body.labels.map((l: { name: string }) => l.name)).toEqual(['help wanted', 'machine']);
    expect((await call('PUT', `/v1/issues/${n}/labels`, { as: 'keeper', body: { labels: ['no such'] } })).status).toBe(422);

    // Taking it on oneself; only a keeper gives it to someone else.
    expect((await call('PUT', `/v1/issues/${n}/assignees`, { as: 'chaim', body: { assignees: ['mendy'] } })).status).toBe(403);
    expect((await call('PUT', `/v1/issues/${n}/assignees`, { as: 'chaim', body: { assignees: ['chaim'] } })).body.assignees).toEqual(['chaim']);
    expect((await call('PUT', `/v1/issues/${n}/assignees`, { as: 'keeper', body: { assignees: ['chaim', 'mendy'] } })).body.assignees).toEqual(['chaim', 'mendy']);
    expect((await inboxOf('mendy')).items.some((l: { reason: string }) => l.reason === 'assigned')).toBe(true);

    // An anonymous reader's report is an issue too, without a sender.
    const anonymous = await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-text', note: 'A typo' } });
    expect(anonymous.body.number).toBeGreaterThan(n);

    const byLabel = (await call('GET', '/v1/issues?label=machine')).body;
    expect(byLabel.items.map((i: { number: number }) => i.number)).toEqual([n]);
    expect((await call('GET', '/v1/issues?assignee=chaim')).body.items.map((i: { number: number }) => i.number)).toEqual([n]);
    expect((await call('GET', '/v1/issues?assignee=none')).body.items.map((i: { number: number }) => i.number)).toEqual([anonymous.body.number]);
    expect((await call('GET', '/v1/issues?type=wrong-text')).body.items[0]).toMatchObject({ author: null, title: null, typeTitle: { en: 'Wrong text' } });
    expect((await call('GET', '/v1/issues?q=blurred')).body.counts).toEqual({ open: 1, closed: 0 });

    // A comment naming someone, and a #reference to the other issue.
    await call('POST', `/v1/issues/${n}/comments`, { as: 'chaim', body: { body: `Same scanner as #${anonymous.body.number}, @shmuly` } });
    expect((await inboxOf('shmuly')).items[0]).toMatchObject({ reason: 'mention', actorUsername: 'chaim', subject: { number: n } });
    expect((await inboxOf('mendy')).items.some((l: { reason: string }) => l.reason === 'comment')).toBe(true);
    const other = (await call('GET', `/v1/issues/${anonymous.body.number}`)).body;
    expect(other.timeline.some((i: { kind?: string; detail?: { from?: { number: number } } }) => i.kind === 'referenced' && i.detail?.from?.number === n)).toBe(true);

    // Closed as not planned by one who took it on, opened again by its sender.
    expect((await call('POST', `/v1/issues/${n}/state`, { as: 'chaim', body: { state: 'not_planned', note: 'The only copy' } })).body).toMatchObject({ state: 'closed', stateReason: 'not_planned' });
    expect((await call('POST', `/v1/issues/${n}/state`, { as: 'mendy', body: { state: 'open' } })).body).toMatchObject({ state: 'open', closedBy: null });
    const kinds = (await call('GET', `/v1/issues/${n}`)).body.timeline.map((i: { kind?: string; type: string }) => i.kind ?? i.type);
    expect(kinds).toEqual(['opened', 'labeled', 'assigned', 'assigned', 'comment', 'closed', 'reopened']);
  });

  it('keep private ones from everyone but stewards, keepers, their sender and whoever took them on', async () => {
    const takedown = await call('POST', '/v1/issues', { as: 'mendy', body: { title: 'Our recording', type: 'rights', entityId: event } });
    expect(takedown.body.private).toBe(true);
    const n = takedown.body.number;
    expect((await call('GET', `/v1/issues/${n}`)).status).toBe(404);
    expect((await call('GET', `/v1/issues/${n}`, { as: 'chaim' })).status).toBe(404);
    expect((await call('GET', `/v1/threads/${n}`)).status).toBe(404);
    expect((await call('GET', `/v1/issues/${n}`, { as: 'mendy' })).status).toBe(200);
    expect((await call('GET', `/v1/issues/${n}`, { as: 'keeper' })).status).toBe(200);
    expect((await call('GET', '/v1/issues')).body.items).toEqual([]);
    expect((await call('GET', '/v1/issues', { as: 'shmuly' })).body.items).toHaveLength(1);
    // Named in it, a reader who may not read it is not told.
    await call('POST', `/v1/issues/${n}/comments`, { as: 'keeper', body: { body: '@chaim do you know?' } });
    expect((await inboxOf('chaim')).items).toEqual([]);
    // A rights claim stays private; another may be made public by a keeper.
    expect((await call('POST', `/v1/issues/${n}/visibility`, { as: 'keeper', body: { private: false } })).status).toBe(409);
    const other = await call('POST', '/v1/issues', { as: 'mendy', body: { title: 'Wrong year', type: 'wrong-fact', private: true } });
    expect((await call('POST', `/v1/issues/${other.body.number}/visibility`, { as: 'shmuly', body: { private: false } })).body.private).toBe(false);
    // What people wrote before reports were public stays private (migration 0016); a steward still closes it the old way.
    const old = await fresh.catalog.report({ entityId: event, reason: 'other', note: 'old', private: true });
    await call('POST', `/v1/reports/${old}/close`, { as: 'keeper', body: { outcome: 'resolved', note: 'done' } });
    const oldNumber = (await fresh.catalog.db.query<{ number: string }>('SELECT number FROM report WHERE id = $1', [old])).rows[0]!.number;
    expect((await call('GET', `/v1/issues/${oldNumber}`, { as: 'shmuly' })).body.issue).toMatchObject({ state: 'closed', stateReason: 'completed', closedBy: 'keeper' });
  });
});

describe('the inbox', () => {
  it('counts unread lines, groups repeats, marks them read, and goes out by email once', async () => {
    const opened = await call('POST', '/v1/issues', { as: 'mendy', body: { title: 'Missing page 4', type: 'missing-page', entityId: event } });
    const n = opened.body.number;
    await call('POST', `/v1/issues/${n}/comments`, { as: 'chaim', body: { body: 'I have it' } });
    await call('POST', `/v1/issues/${n}/comments`, { as: 'chaim', body: { body: 'Uploading now' } });
    const mine = await inboxOf('mendy');
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ reason: 'comment', count: 2, actor: 'chaim', read: false, subject: { kind: 'report', number: n, title: 'Missing page 4' } });

    // By email, when email updates are on: once.
    await fresh.catalog.db.query("INSERT INTO auth.email_address (email, person_id) VALUES ('mendy@example.org', 'mendy')");
    await fresh.catalog.db.query("INSERT INTO auth.notification_setting (person_id, mode, lang, last_seq, unsubscribe_token) VALUES ('mendy', 'immediate', 'en', (SELECT max(seq) FROM commit), 't')");
    const outbox: EmailMessage[] = [];
    const mailer = { send: async (m: EmailMessage) => void outbox.push(m) };
    expect((await sendNotifications(fresh.catalog, mailer, { siteUrl: 'https://rebbehub.test' })).sent).toBe(1);
    expect(outbox[0]!.subject).toBe('RebbeHub: one new notification');
    expect(outbox[0]!.text).toContain(`@chaim commented on #${n} Missing page 4 (×2)`);
    expect(outbox[0]!.text).toContain(`https://rebbehub.test/issues/${n}?lang=en`);
    expect((await sendNotifications(fresh.catalog, mailer, { siteUrl: 'https://rebbehub.test' })).sent).toBe(0);

    expect((await call('POST', '/v1/inbox/read', { as: 'mendy', body: { all: true } })).body).toEqual({ changed: 1, unread: 0 });
    expect((await call('GET', '/v1/inbox?filter=unread', { as: 'mendy' })).body.items).toEqual([]);
    expect((await call('GET', '/v1/inbox', { as: 'mendy' })).body.items).toHaveLength(1);
    expect((await call('GET', '/v1/inbox')).status).toBe(401);

    // Unsubscribing from the issue: no more lines about it.
    await call('POST', '/v1/follows', { as: 'mendy', body: { kind: 'report', id: String(opened.body.id), on: false } });
    await call('POST', `/v1/issues/${n}/comments`, { as: 'chaim', body: { body: 'Done' } });
    expect((await inboxOf('mendy')).unread).toBe(0);
  });

  it('shows a person’s page with what they did, and nothing private', async () => {
    await call('POST', '/v1/issues', { as: 'chaim', body: { title: 'Public one', type: 'other' } });
    await call('POST', '/v1/issues', { as: 'chaim', body: { title: 'Private one', type: 'offensive' } });
    const page = (await call('GET', '/v1/people/chaim')).body;
    expect(page.counts).toMatchObject({ issues: 1 });
    expect(page.activity.map((a: { thread: { title: string } }) => a.thread.title)).toEqual(['Public one']);
    const mendy = (await call('GET', '/v1/people/mendy')).body;
    expect(mendy.counts).toMatchObject({ suggestions: 1, merged: 1 });
    expect((await call('GET', '/v1/people/nobody-at-all')).status).toBe(404);
  });

  it('offers suggestions and issues after #', async () => {
    const opened = await call('POST', '/v1/issues', { as: 'chaim', body: { title: 'Wrong spelling of the parsha', type: 'wrong-fact' } });
    const found = (await call('GET', '/v1/threads?q=spelling')).body.threads;
    expect(found).toEqual([{ kind: 'report', number: opened.body.number, title: 'Wrong spelling of the parsha', state: 'open' }]);
    expect((await call('GET', `/v1/threads?q=${opened.body.number}`)).body.threads[0].number).toBe(opened.body.number);
  });
});
