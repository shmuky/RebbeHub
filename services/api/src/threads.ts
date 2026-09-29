import type { Context, Hono } from 'hono';
import {
  CatalogError,
  ISSUE_TYPES,
  commentOnIssue,
  commentOnSuggestion,
  createLabel,
  editComment,
  editIssue,
  editSuggestion,
  getIssue,
  idsOfUsernames,
  inbox,
  isSubscribed,
  listIssues,
  listLabels,
  markRead,
  openIssue,
  peopleOf,
  profile,
  removeReviewRequest,
  requestReview,
  resolveComment,
  reviewSuggestion,
  searchPeople,
  searchThreads,
  setIssueAssignees,
  setIssueLabels,
  setIssuePrivate,
  setIssueState,
  suggestionLinks,
  suggestionTimeline,
  threadByNumber,
  unreadCount,
  type Catalog,
  type InboxFilter,
  type ReportReason,
  type Resolution,
  type ReviewVerdict,
  type SubjectKind,
} from '@rebbehub/core';
import { readId } from '@rebbehub/model';
import { HttpError } from './app.js';
import { cursor, nextLink } from './platform.js';

/**
 * People and conversations (packages/core: usernames, threads,
 * conversation, issues, inbox, profiles): the GitHub-like side of the
 * catalog. Reading needs no account (private issues aside); writing needs
 * a signed-in session, from the site's own pages.
 *
 *   GET    /v1/people?q=&thread=changeset:12      people to @mention, those in the conversation first
 *   GET    /v1/people/<handle>                    a person's page: who they are and what they did
 *   GET    /v1/threads?q=                         suggestions and issues to #mention, by number or words
 *   GET    /v1/threads/<number>                   which of the two #12 is
 *   GET    /v1/suggestions/<id>/conversation      a suggestion's timeline, reviewers asked, reports it fixes
 *   POST   /v1/suggestions/<id>/comments          { body, parent?, anchor?: { entity, field } }
 *   POST   /v1/suggestions/<id>/reviews           { verdict: approve | request_changes | comment, body?, comments?: [{ entity, field, body }] }
 *   POST   /v1/suggestions/<id>/review-requests   { reviewers: [handle] }  (asking again re-requests)
 *   DELETE /v1/suggestions/<id>/review-requests/<handle>
 *   PATCH  /v1/suggestions/<id>                   { title?, description? }
 *   GET    /v1/issues?state=&label=&type=&set=&assignee=&author=&q=&before=
 *   GET    /v1/issues/templates                   the kinds of issue and the words each starts with
 *   POST   /v1/issues                             { title, body?, type, entityId?, labels?, private? }
 *   GET    /v1/issues/<number>                    an issue and its timeline
 *   PATCH  /v1/issues/<number>                    { title?, body? }
 *   POST   /v1/issues/<number>/state              { state: open | completed | not_planned, note? }
 *   PUT    /v1/issues/<number>/labels             { labels: [name] }
 *   PUT    /v1/issues/<number>/assignees          { assignees: [handle] }
 *   POST   /v1/issues/<number>/visibility         { private }
 *   POST   /v1/issues/<number>/comments           { body, parent? }
 *   GET    /v1/labels, POST /v1/labels            { name, description?, color? }  (stewards make them)
 *   PATCH  /v1/comments/<id>                      { body }   (its writer)
 *   POST   /v1/comments/<id>/resolve              { resolved }
 *   GET    /v1/inbox?filter=unread|all|<reason>&before=
 *   POST   /v1/inbox/read                         { ids? | subject? | all?, unread? }
 */
export function threadRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, authenticate: ((c: Context) => Promise<string | null> | string | null) | undefined): void {
  const db = catalog.db;
  const viewerOf = async (c: Context) => (await authenticate?.(c)) ?? null;
  const json = async <T>(c: Context): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      throw new HttpError(400, 'the request body must be JSON');
    }
  };
  const num = (value: string | undefined, name: string): number => {
    if (!value || !/^\d{1,15}$/.test(value)) throw new HttpError(400, `${name} must be a whole number`);
    return Number(value);
  };
  const optionalNum = (value: string | undefined, name: string) => (value ? num(value, name) : undefined);
  /** A handle given in a filter, as the account it names (an unknown one matches nothing). */
  const accountOf = async (handle: string | undefined): Promise<string | undefined> => {
    if (!handle) return undefined;
    if (handle === 'none') return 'none';
    const ids = await idsOfUsernames(db, [handle.replace(/^@/, '')]);
    return [...ids.values()][0] ?? `unknown:${handle}`;
  };
  const noStore = (c: Context) => c.header('Cache-Control', 'no-store');
  /**
   * Lists by number, newest first, page by cursor (platform.ts) like every
   * list of the API; `before` (a number) is still read as it was.
   */
  const beforeNumber = (c: Context): number | undefined => {
    const raw = c.req.query('cursor');
    if (raw) {
      const [n] = cursor.decode(raw) ?? [];
      if (typeof n !== 'number') throw new HttpError(400, 'that cursor is not one this list gave');
      return n;
    }
    return optionalNum(c.req.query('before'), 'before');
  };

  // ------------------------------------------------------------ people

  app.get('/v1/people', async (c) => {
    // By account id (a set's keepers, a list's authors): who they are, as a conversation shows them.
    const ids = c.req.query('ids');
    if (ids !== undefined) {
      const list = ids.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 100);
      const tags = await peopleOf(db, list);
      // Only ids someone has: a made-up id is not a person.
      const { rows } = await db.query<{ id: string }>('SELECT id FROM account WHERE id = ANY($1::text[]) UNION SELECT id FROM auth.person WHERE id = ANY($1::text[])', [list]);
      const known = new Set(rows.map((r) => r.id));
      return c.json({ people: list.filter((id) => tags[id] && known.has(id)).map((id) => ({ id, username: tags[id]!.username, displayName: tags[id]!.name, bot: tags[id]!.bot })) });
    }
    const thread = /^(changeset|report):(\d+)$/.exec(c.req.query('thread') ?? '');
    let participants: string[] = [];
    if (thread) {
      const kind = thread[1] as 'changeset' | 'report';
      const id = thread[2]!;
      const { rows } = await db.query<{ id: string }>(
        `SELECT author AS id FROM comment WHERE target_kind = $1 AND target_id = $2
         UNION SELECT reviewer FROM review WHERE $1 = 'changeset' AND changeset_id::text = $2
         UNION SELECT reviewer FROM review_request WHERE $1 = 'changeset' AND changeset_id::text = $2
         UNION SELECT author FROM changeset WHERE $1 = 'changeset' AND id::text = $2
         UNION SELECT reporter FROM report WHERE $1 = 'report' AND id::text = $2 AND reporter IS NOT NULL
         UNION SELECT account_id FROM report_assignee WHERE $1 = 'report' AND report_id::text = $2`,
        [kind, id],
      );
      participants = rows.map((r) => r.id);
    }
    const limit = optionalNum(c.req.query('limit'), 'limit');
    return c.json({ people: await searchPeople(db, c.req.query('q') ?? '', { participants, limit }) });
  });

  app.get('/v1/people/:username', async (c) => {
    const found = await profile(db, c.req.param('username'), { limit: optionalNum(c.req.query('limit'), 'limit') });
    if (!found) throw new CatalogError('not-found', 'nobody here has that username');
    return c.json(found);
  });

  // ------------------------------------------------------------ threads by number

  app.get('/v1/threads', async (c) => c.json({ threads: await searchThreads(catalog, c.req.query('q') ?? '', await viewerOf(c), optionalNum(c.req.query('limit'), 'limit')) }));

  app.get('/v1/threads/:number{[0-9]+}', async (c) => {
    const number = num(c.req.param('number'), 'number');
    const thread = await threadByNumber(db, number);
    // A private report is not there for those who may not read it.
    if (!thread || (thread.kind === 'report' && thread.private && !(await getIssue(catalog, number, await viewerOf(c)).then(() => true, () => false)))) {
      throw new CatalogError('not-found', `#${number} not found`);
    }
    return c.json({ kind: thread.kind === 'changeset' ? 'suggestion' : 'issue', number, id: thread.id });
  });

  // ------------------------------------------------------------ suggestions as conversations

  app.get('/v1/suggestions/:id/conversation', async (c) => {
    const id = num(c.req.param('id'), 'id');
    const cs = await catalog.changeset(id);
    if (cs.number === null) throw new CatalogError('not-found', 'an import has no conversation');
    const viewer = await viewerOf(c);
    const [timeline, links] = await Promise.all([suggestionTimeline(catalog, id), suggestionLinks(catalog, id)]);
    if (viewer) noStore(c);
    return c.json({
      number: cs.number,
      timeline: timeline.items,
      people: timeline.people,
      reviewRequests: links.reviewRequests,
      fixes: links.fixes,
      subscribed: await isSubscribed(db, viewer, { kind: 'changeset', id }),
    });
  });

  app.post('/v1/suggestions/:id/comments', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ body?: unknown; parent?: number; anchor?: unknown }>(c);
    return c.json({ id: await commentOnSuggestion(catalog, by, num(c.req.param('id'), 'id'), { body: input.body, parent: typeof input.parent === 'number' ? input.parent : undefined, anchor: input.anchor }) }, 201);
  });

  app.post('/v1/suggestions/:id/reviews', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ verdict?: ReviewVerdict; body?: unknown; comments?: Array<{ entity?: unknown; field?: unknown; body?: unknown }>; resolutions?: Record<string, Record<string, Resolution>> }>(c);
    if (input.verdict !== 'approve' && input.verdict !== 'request_changes' && input.verdict !== 'comment') throw new HttpError(400, 'verdict is approve, request_changes or comment');
    if (input.comments !== undefined && !Array.isArray(input.comments)) throw new HttpError(400, 'comments is a list of { entity, field, body }');
    return c.json(await reviewSuggestion(catalog, by, num(c.req.param('id'), 'id'), { verdict: input.verdict, body: input.body, comments: input.comments, resolutions: input.resolutions }), 201);
  });

  app.post('/v1/suggestions/:id/review-requests', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ reviewers?: unknown }>(c);
    if (!Array.isArray(input.reviewers) || input.reviewers.length === 0 || !input.reviewers.every((r) => typeof r === 'string')) throw new HttpError(400, 'give reviewers: a list of usernames');
    return c.json({ requested: await requestReview(catalog, by, num(c.req.param('id'), 'id'), input.reviewers as string[]) }, 201);
  });

  app.delete('/v1/suggestions/:id/review-requests/:username', async (c) => {
    const by = await signedIn(c);
    await removeReviewRequest(catalog, by, num(c.req.param('id'), 'id'), c.req.param('username'));
    return c.json({ ok: true });
  });

  app.patch('/v1/suggestions/:id', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ title?: unknown; description?: unknown }>(c);
    return c.json(await editSuggestion(catalog, by, num(c.req.param('id'), 'id'), input));
  });

  // ------------------------------------------------------------ issues

  app.get('/v1/issues/templates', (c) => c.json({ templates: ISSUE_TYPES }));

  app.get('/v1/issues', async (c) => {
    const viewer = await viewerOf(c);
    const state = c.req.query('state');
    if (state && !['open', 'closed', 'all'].includes(state)) throw new HttpError(400, 'state is open, closed or all');
    const type = c.req.query('type');
    if (type && !ISSUE_TYPES.some((t) => t.type === type)) throw new HttpError(400, `type is one of ${ISSUE_TYPES.map((t) => t.type).join(', ')}`);
    const set = c.req.query('set');
    const entity = c.req.query('entity');
    const limit = Math.min(Math.max(optionalNum(c.req.query('limit'), 'limit') ?? 30, 1), 100);
    const result = await listIssues(
      catalog,
      {
        state: state as 'open' | undefined,
        labels: (c.req.query('label') ?? '').split(',').map((l) => l.trim()).filter(Boolean),
        type: type as ReportReason | undefined,
        set: set ? (readId(set) ?? set) : undefined,
        entity: entity ? (readId(entity) ?? entity) : undefined,
        assignee: await accountOf(c.req.query('assignee')),
        author: await accountOf(c.req.query('author')),
        q: c.req.query('q'),
        before: beforeNumber(c),
        limit,
      },
      viewer,
    );
    if (viewer) noStore(c);
    const last = result.items[result.items.length - 1];
    const next = last && result.items.length === limit ? cursor.encode([last.number]) : null;
    nextLink(c, next);
    return c.json({ ...result, next });
  });

  app.post('/v1/issues', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ title?: unknown; body?: unknown; type?: unknown; entityId?: string; labels?: unknown; private?: boolean }>(c);
    const entityId = input.entityId ? readId(input.entityId) : null;
    if (input.entityId && !entityId) throw new HttpError(400, `"${input.entityId}" is not an id (rh-…)`);
    const labels = Array.isArray(input.labels) ? input.labels.filter((l): l is string => typeof l === 'string') : undefined;
    return c.json(await openIssue(catalog, by, { title: input.title, body: input.body, type: input.type, entityId, labels, private: input.private === true }), 201);
  });

  app.get('/v1/issues/:number{[0-9]+}', async (c) => {
    const viewer = await viewerOf(c);
    const found = await getIssue(catalog, num(c.req.param('number'), 'number'), viewer);
    if (viewer || found.issue.private) noStore(c);
    return c.json(found);
  });

  app.patch('/v1/issues/:number{[0-9]+}', async (c) => {
    const by = await signedIn(c);
    return c.json(await editIssue(catalog, by, num(c.req.param('number'), 'number'), await json<{ title?: unknown; body?: unknown }>(c)));
  });

  app.post('/v1/issues/:number{[0-9]+}/state', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ state?: string; note?: string }>(c);
    if (input.state !== 'open' && input.state !== 'completed' && input.state !== 'not_planned') throw new HttpError(400, 'state is open, completed or not_planned');
    return c.json(await setIssueState(catalog, by, num(c.req.param('number'), 'number'), input.state, typeof input.note === 'string' ? input.note.trim().slice(0, 2000) || undefined : undefined));
  });

  app.put('/v1/issues/:number{[0-9]+}/labels', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ labels?: unknown }>(c);
    if (!Array.isArray(input.labels) || !input.labels.every((l) => typeof l === 'string')) throw new HttpError(400, 'give labels: a list of label names');
    return c.json(await setIssueLabels(catalog, by, num(c.req.param('number'), 'number'), input.labels as string[]));
  });

  app.put('/v1/issues/:number{[0-9]+}/assignees', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ assignees?: unknown }>(c);
    if (!Array.isArray(input.assignees) || !input.assignees.every((l) => typeof l === 'string')) throw new HttpError(400, 'give assignees: a list of usernames');
    return c.json(await setIssueAssignees(catalog, by, num(c.req.param('number'), 'number'), input.assignees as string[]));
  });

  app.post('/v1/issues/:number{[0-9]+}/visibility', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ private?: unknown }>(c);
    if (typeof input.private !== 'boolean') throw new HttpError(400, 'private is true or false');
    return c.json(await setIssuePrivate(catalog, by, num(c.req.param('number'), 'number'), input.private));
  });

  app.post('/v1/issues/:number{[0-9]+}/comments', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ body?: unknown; parent?: number }>(c);
    return c.json({ id: await commentOnIssue(catalog, by, num(c.req.param('number'), 'number'), { body: input.body, parent: typeof input.parent === 'number' ? input.parent : undefined }) }, 201);
  });

  app.get('/v1/labels', async (c) => c.json({ labels: await listLabels(db) }));

  app.post('/v1/labels', async (c) => {
    const by = await signedIn(c);
    return c.json(await createLabel(catalog, by, await json<{ name?: unknown; description?: unknown; color?: unknown }>(c)), 201);
  });

  // ------------------------------------------------------------ comments

  app.patch('/v1/comments/:id{[0-9]+}', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ body?: unknown }>(c);
    await editComment(catalog, by, num(c.req.param('id'), 'id'), input.body);
    return c.json({ ok: true });
  });

  app.post('/v1/comments/:id{[0-9]+}/resolve', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ resolved?: unknown }>(c);
    await resolveComment(catalog, by, num(c.req.param('id'), 'id'), input.resolved !== false);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ the inbox

  const FILTERS = new Set(['unread', 'all', 'mention', 'review_requested', 'assigned', 'author', 'comment', 'review', 'state', 'followed']);

  app.get('/v1/inbox', async (c) => {
    const by = await signedIn(c);
    noStore(c);
    const filter = c.req.query('filter') ?? 'all';
    if (!FILTERS.has(filter)) throw new HttpError(400, `filter is one of ${[...FILTERS].join(', ')}`);
    const limit = Math.min(Math.max(optionalNum(c.req.query('limit'), 'limit') ?? 50, 1), 100);
    let before = c.req.query('before');
    let beforeId: number | undefined;
    const raw = c.req.query('cursor');
    if (raw) {
      const [at, id] = cursor.decode(raw) ?? [];
      if (typeof at !== 'string' || typeof id !== 'number') throw new HttpError(400, 'that cursor is not one this list gave');
      [before, beforeId] = [at, id];
    }
    if (before && Number.isNaN(Date.parse(before))) throw new HttpError(400, 'before is a time');
    const items = await inbox(db, by, { filter: filter as InboxFilter, before, beforeId, limit });
    const last = items[items.length - 1];
    const next = last && items.length === limit ? cursor.encode([last.at, last.id]) : null;
    nextLink(c, next);
    return c.json({ items, unread: await unreadCount(db, by), next });
  });

  app.get('/v1/inbox/count', async (c) => {
    const by = await signedIn(c);
    noStore(c);
    return c.json({ unread: await unreadCount(db, by) });
  });

  app.post('/v1/inbox/read', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ ids?: unknown; subject?: { kind?: string; id?: string }; all?: boolean; unread?: boolean }>(c);
    const ids = Array.isArray(input.ids) ? input.ids.filter((i): i is number => typeof i === 'number') : undefined;
    const subject =
      input.subject && typeof input.subject.id === 'string' && ['changeset', 'report', 'entity', 'project'].includes(input.subject.kind ?? '') ? { kind: input.subject.kind as SubjectKind, id: input.subject.id } : undefined;
    if (!ids && !subject && input.all !== true) throw new HttpError(400, 'say which: ids, subject, or all');
    const changed = await markRead(db, by, { ids, subject, all: input.all === true, unread: input.unread === true });
    return c.json({ changed, unread: await unreadCount(db, by) });
  });
}
