import type { EntityType, SetPolicy } from '@rebbehub/model';

/**
 * Who may do what (docs/plans/rebbehub.md, section 7, "Trust levels").
 *
 *   Visitor      read, download, report            (no account)
 *   Contributor  suggest, upload, fix lines         (signed in)
 *   Trusted      line fixes go live in open sets    (earned: TRUST_THRESHOLD approved, no reverts)
 *   Keeper       approve in their sets; run projects (named in the set's `keepers`)
 *   Steward      everything: roles, set policies, schema, takedowns
 *
 * Bots are contributors that are labelled as such and never merge their
 * own work. Nobody but a steward approves their own suggestion.
 */

export interface Account {
  id: string;
  display_name: string;
  trust: 'contributor' | 'trusted';
  is_steward: boolean;
  is_bot: boolean;
  approved_count: number;
  reverted_count: number;
  suspended_at: string | null;
}

/** Approved suggestions, with none reverted, that make a contributor trusted. */
export const TRUST_THRESHOLD = 20;

/** Types only stewards change: what kinds of item exist, the sets and their keepers, the source registry. */
export const STEWARD_TYPES: ReadonlySet<EntityType> = new Set(['schema', 'set', 'source']);

/** Types whose changes are "line fixes": the text and sync people correct in place, which may go live in open sets. */
export const LIVE_TYPES: ReadonlySet<EntityType> = new Set(['text-page', 'segment', 'alignment-span']);

export interface SetInfo {
  id: string;
  policy: SetPolicy;
  keepers: string[];
}

export function earnedTrust(account: Pick<Account, 'approved_count' | 'reverted_count'>): Account['trust'] {
  return account.approved_count >= TRUST_THRESHOLD && account.reverted_count === 0 ? 'trusted' : 'contributor';
}

export function canSuggest(account: Account | null): boolean {
  return account !== null && account.suspended_at === null;
}

/**
 * Whether `reviewer` may approve a change touching these types in these
 * sets: stewards always; keepers when they keep every set it touches, none
 * of which is locked, and it touches no steward-only type. A change that
 * touches no set at all is for stewards.
 */
export function canApprove(reviewer: Account, change: { author: string; types: ReadonlySet<string>; sets: SetInfo[]; projectKeepers?: string[] }): { ok: true } | { ok: false; reason: string } {
  if (reviewer.suspended_at !== null) return { ok: false, reason: 'this account is suspended' };
  if (reviewer.is_bot) return { ok: false, reason: 'bots never approve or merge' };
  if (reviewer.id === change.author && !reviewer.is_steward) return { ok: false, reason: 'a suggestion is approved by someone other than its author' };
  if (reviewer.is_steward) return { ok: true };
  if (change.projectKeepers?.includes(reviewer.id)) return { ok: true };
  for (const type of change.types) if (STEWARD_TYPES.has(type as EntityType)) return { ok: false, reason: `changes to ${type} are approved by stewards` };
  if (change.sets.length === 0) return { ok: false, reason: 'this change belongs to no set, so a steward approves it' };
  for (const set of change.sets) {
    if (set.policy === 'locked') return { ok: false, reason: `set ${set.id} is locked; only stewards change it` };
    if (!set.keepers.includes(reviewer.id)) return { ok: false, reason: `you are not a keeper of set ${set.id}` };
  }
  return { ok: true };
}

/** Whether a change may go live before review: a trusted person's line fixes, in sets that are all open. */
export function mayGoLive(author: Account, change: { types: ReadonlySet<string>; sets: SetInfo[] }): boolean {
  if (author.is_bot || author.suspended_at !== null) return false;
  if (author.trust !== 'trusted' && !author.is_steward) return false;
  if (change.sets.length === 0) return false;
  for (const type of change.types) if (!LIVE_TYPES.has(type as EntityType)) return false;
  return change.sets.every((s) => s.policy === 'open');
}
