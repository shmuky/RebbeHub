import { beforeAll, describe, expect, it } from 'vitest';
import { reviewSuggestion, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { freshCatalog, yudShvat } from './helpers.js';

/**
 * Undo, both ways: a withdrawn Suggestion reopens and goes back for
 * review (its keepers asked again), and a merged one is undone by a
 * revert that puts its items back as they were.
 */

let catalog: Catalog;
let set: EntityId;

beforeAll(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
});

async function suggestion(by: string) {
  const cs = await catalog.createChangeset(by, { title: 'A farbrengen' });
  await catalog.putRevision(cs.id, by, { type: 'event', data: yudShvat(set) });
  await catalog.submit(cs.id, by);
  return cs.id;
}

describe('reopening a withdrawn suggestion', () => {
  it('puts it back for review, where it can be approved', async () => {
    const id = await suggestion('mendy');
    await catalog.withdraw(id, 'mendy');
    expect((await catalog.changeset(id)).status).toBe('withdrawn');
    const reopened = await catalog.reopen(id, 'mendy');
    expect(reopened.status).toBe('open');
    expect(reopened.closed_at).toBeNull();
    const { rows } = await catalog.db.query<{ reviewer: string }>('SELECT reviewer FROM review_request WHERE changeset_id = $1', [id]);
    expect(rows.map((r) => r.reviewer)).toContain('keeper');
    const { rows: events } = await catalog.db.query<{ kind: string }>("SELECT kind FROM thread_event WHERE thread_kind = 'changeset' AND thread_id = $1 ORDER BY id", [id]);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['withdrawn', 'reopened']));
    await catalog.merge(id, 'keeper');
    expect((await catalog.changeset(id)).status).toBe('merged');
  });

  it('is for its author or a steward only, and only when withdrawn', async () => {
    const id = await suggestion('mendy');
    await expect(catalog.reopen(id, 'mendy')).rejects.toThrow(/open/);
    await catalog.withdraw(id, 'mendy');
    await expect(catalog.reopen(id, 'keeper')).rejects.toThrow(/author/);
    expect((await catalog.reopen(id, 'shmuly')).status).toBe('open');
  });
});

describe('approving your own suggestion', () => {
  it('is for a steward only: others ask someone else to approve it', async () => {
    const mine = await suggestion('shmuly');
    expect((await reviewSuggestion(catalog, 'shmuly', mine, { verdict: 'approve' })).status).toBe('merged');
    const theirs = await suggestion('mendy');
    await expect(reviewSuggestion(catalog, 'mendy', theirs, { verdict: 'approve' })).rejects.toThrow(/other than its author/);
  });
});

describe('undoing a merged suggestion', () => {
  it('puts the item back as it was', async () => {
    const id = await suggestion('mendy');
    await catalog.merge(id, 'keeper');
    const [entity] = (await catalog.proposals(id)).map((p) => p.entityId);
    const { commit } = await catalog.revert(id, 'shmuly');
    expect(commit).not.toBeNull();
    const { rows } = await catalog.db.query<{ deleted: boolean }>('SELECT deleted FROM entity WHERE id = $1', [entity]);
    expect(rows[0]!.deleted).toBe(true);
  });
});
