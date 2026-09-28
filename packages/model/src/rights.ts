import type { SetPolicy } from './entities.js';
import type { CatalogSourceId } from './entities.js';
import type { Licence, RightsDecision } from './works.js';

/**
 * The rights gate on every file (docs/plans/rebbehub.md, section 8). Each
 * file RebbeHub stores has one rights state:
 *
 *   open       served
 *   credit     served, with its credit shown
 *   link       not served: RebbeHub points at the source only
 *   preserved  a private copy is kept and never served until cleared
 *
 * A file's state is decided when it arrives (the defaults below) and
 * changed afterwards only by a steward (a takedown moves it to
 * `preserved` in one click, logged). This follows Sichos-Kodesh's
 * per-edition gate (packages/works/src/rights.ts): the same licences give
 * the same answers, and its four `RightsDecision`s map one to one.
 */
export type RightsState = 'open' | 'credit' | 'link' | 'preserved';

export const RIGHTS_STATES: readonly RightsState[] = ['open', 'credit', 'link', 'preserved'];

const ORDER: RightsState[] = ['open', 'credit', 'link', 'preserved'];

/** The stricter of two states. */
export function stricterRights(a: RightsState, b: RightsState): RightsState {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** Whether RebbeHub may serve the bytes of a file in this state. */
export function mayServe(state: RightsState): boolean {
  return state === 'open' || state === 'credit';
}

/** Whether a file in this state goes into public dumps and the git mirror. */
export function mayExport(state: RightsState): boolean {
  return mayServe(state);
}

const DECISION_TO_STATE: Record<RightsDecision, RightsState> = {
  ship: 'open',
  'ship-with-credit': 'credit',
  'link-only': 'link',
  'local-only': 'preserved',
};

const STATE_TO_DECISION: Record<RightsState, RightsDecision> = {
  open: 'ship',
  credit: 'ship-with-credit',
  link: 'link-only',
  preserved: 'local-only',
};

/** Sichos-Kodesh's decision for a copy, as a rights state. */
export function rightsStateFromDecision(decision: RightsDecision): RightsState {
  return DECISION_TO_STATE[decision];
}

/** A rights state as Sichos-Kodesh's decision, for its releases. */
export function decisionFromRightsState(state: RightsState): RightsDecision {
  return STATE_TO_DECISION[state];
}

/** What a licence alone allows: Sichos-Kodesh's `BY_LICENCE`, as states. */
export const RIGHTS_BY_LICENCE: Record<Licence, RightsState> = {
  'facts-and-links': 'open',
  'public-domain': 'open',
  cc0: 'open',
  'cc-by': 'credit',
  'cc-by-nc': 'credit',
  'free-to-read': 'link',
  'site-terms': 'link',
  commercial: 'preserved',
  unknown: 'link',
};

/**
 * Decisions per source, over what its licence alone allows (each one a
 * steward's decision; flipping one is that decision and nothing else):
 * - HebrewBooks stays link-only per its terms;
 * - chabadlibrary.org: read and link until the library agrees;
 * - the Igros app's files are kept, never served, until their rights are
 *   decided per collection (Sichos-Kodesh decides for its own apps).
 */
export const RIGHTS_BY_SOURCE: Partial<Record<CatalogSourceId, RightsState>> = {
  hebrewbooks: 'link',
  chabadlibrary: 'link',
  'igros-app': 'preserved',
};

/** The kind of file, where the plan sets a default of its own. */
export type FileClass = 'teshura-scan' | 'hanacha' | 'publisher-scan' | 'recording' | 'other';

/**
 * Defaults by kind of file: hanachos and publisher scans are linked, and a
 * copy preserved; teshuros, usually printed for free distribution, are
 * served with credit (with a fast family-request path to take one down).
 */
export const RIGHTS_BY_CLASS: Partial<Record<FileClass, RightsState>> = {
  'teshura-scan': 'credit',
  hanacha: 'link',
  'publisher-scan': 'link',
};

export interface RightsInput {
  source: CatalogSourceId;
  licence: Licence;
  fileClass?: FileClass;
  /** The policy of the set it belongs to; a locked set serves nothing. */
  setPolicy?: SetPolicy;
}

/**
 * The state a newly arrived file starts in: the stricter of its licence
 * and its source's decision, or its class default when the licence says
 * nothing. A locked set keeps everything preserved.
 */
export function defaultRightsState(input: RightsInput): RightsState {
  let state = input.licence === 'unknown' && input.fileClass && RIGHTS_BY_CLASS[input.fileClass] ? RIGHTS_BY_CLASS[input.fileClass]! : RIGHTS_BY_LICENCE[input.licence];
  const bySource = RIGHTS_BY_SOURCE[input.source];
  if (bySource) state = stricterRights(state, bySource);
  if (input.fileClass === 'hanacha' || input.fileClass === 'publisher-scan') state = stricterRights(state, 'link');
  if (input.setPolicy === 'locked') state = 'preserved';
  return state;
}

/** When a file in `link` state still has a private copy: always, when one was uploaded (`link` + preserve, per the plan). */
export function keepsPreservationCopy(state: RightsState): boolean {
  return state === 'link' || state === 'preserved';
}
