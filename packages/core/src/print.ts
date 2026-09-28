import { one } from '@rebbehub/db';
import { isValidDateKey, parseHebrewYear } from '@rebbehub/hebrew';
import { idFromSeed, isEntityId, mayServe, orderBetween, type EntityId, type LocalName, type RightsState } from '@rebbehub/model';
import type { Catalog, EntityView } from './catalog.js';
import { invalid, notFound } from './errors.js';
import type { Json } from './merge.js';
import type { SimilarFile } from './scans.js';

/**
 * The print side, as people add to it (the plan, sections 4 and 7):
 * what an upload is (a new scan of a publication RebbeHub has, a new
 * printing, or a new teshura), the contents map of a publication ("pp.
 * 3–8 are a letter from 5718"), and the Teshuros set with its families'
 * requests.
 */

/** The Teshuros set: the thousands of booklets printed for weddings and simchos. Made by the `rebbehub-sets` importer. */
export const TESHUROS_SET = {
  key: 'rebbehub-set:teshuros',
  path: '/teshuros',
  name: { he: 'תשורות', en: 'Teshuros' },
  description: {
    he: 'חוברות שנדפסו לחתונות ולשמחות, ובהן מכתבים, רשימות וסיפורים. נסרקות ומוגשות עם קרדיט למשפחות; משפחה יכולה לבקש להסיר תשורה.',
    en: 'Booklets printed for weddings and simchos, with letters, notes and stories. Served with credit to the families; a family can ask for a teshura to be taken down.',
  },
} as const;

/** The Teshuros set's permanent id (the same as the importer's, from its key). */
export const teshurosSetId = (): Promise<EntityId> => idFromSeed('rebbehub-set', 'teshuros');

/**
 * The rights a teshura's scan starts in: `credit`, crediting the families
 * as printed, unless its uploader gave it freely or said it is anyone's
 * (docs/rights.md). The families can ask for it to be taken down.
 */
export const TESHURA_RIGHTS: RightsState = 'credit';

/** The credit shown with a teshura's scan: its families, as printed on it. */
export function teshuraCredit(families: readonly string[]): string {
  return `משפחות ${families.join(' – ')}`;
}

// ---------------------------------------------------------------- what an upload is

/** What an uploaded scan is taken to be, and why: the upload form preselects it, and the person confirms or changes it. */
export type UploadProposal =
  | { as: 'existing'; reason: 'same-file'; usedBy: Array<{ id: string; type: string; path: string | null }> }
  | { as: 'duplicate'; reason: 'same-pages'; scan: EntityId; publication: EntityId | null; matched: number; of: number }
  | { as: 'scan-of'; reason: 'shares-pages' | 'on-publication' | 'same-year'; publication: EntityId }
  | { as: 'teshura'; reason: 'teshuros-set' | 'title' }
  | { as: 'printing'; reason: 'new' };

export interface ProposalInput {
  /** The page the upload was started from: a sefer, a publication, or the Teshuros set. */
  target: EntityView;
  title?: string;
  /** Whether the target is the Teshuros set. */
  teshurosSet?: boolean;
  /** Items using the very same file, when its sha256 is known. */
  usedBy?: Array<{ id: string; type: string; path: string | null }>;
  /** Held scans with pages like the upload's, with the scan items using each. */
  similar?: Array<SimilarFile & { scans: Array<{ id: EntityId; publication: EntityId | null }> }>;
  /** The sefer's publications, when the target is a sefer. */
  publications?: EntityView[];
}

/** The Hebrew years a title names: `תשמ"ב`, `5742`, or a civil year (either Hebrew year it falls in). */
export function yearsInText(text: string): number[] {
  const years = new Set<number>();
  for (const token of text.split(/[\s,.;:()[\]\-–]+/)) {
    if (/^5[5-8]\d\d$/.test(token)) years.add(Number(token));
    else if (/^(1[89]|20)\d\d$/.test(token)) {
      years.add(Number(token) + 3760);
      years.add(Number(token) + 3761);
    } else if (/^(ה['׳])?ת[א-ת]*["״][א-ת]$/.test(token)) {
      const year = parseHebrewYear(token);
      if (year) years.add(year);
    }
  }
  return [...years];
}

/**
 * Guesses what an uploaded scan is (the plan: "uploads guess first and
 * ask second"): the very same file, or the same pages, is something we
 * already have; pages shared with a scan of a publication make it another
 * scan of that publication; on a teshura, or the Teshuros set, or named a
 * teshura, it is a new teshura; a year in its name that one of the
 * sefer's printings has makes it a scan of that printing; else a new
 * printing.
 */
export function proposeUpload(input: ProposalInput): UploadProposal {
  if (input.usedBy?.length) return { as: 'existing', reason: 'same-file', usedBy: input.usedBy };
  const same = input.similar?.find((s) => s.kind === 'same' && s.scans.length > 0);
  if (same) return { as: 'duplicate', reason: 'same-pages', scan: same.scans[0]!.id, publication: same.scans[0]!.publication, matched: same.matched ?? 0, of: same.of ?? 0 };
  const shared = input.similar?.flatMap((s) => s.scans).find((s) => s.publication);
  if (shared?.publication) return { as: 'scan-of', reason: 'shares-pages', publication: shared.publication };
  const target = input.target;
  if (target.type === 'publication') return { as: 'scan-of', reason: 'on-publication', publication: target.id };
  if (input.teshurosSet) return { as: 'teshura', reason: 'teshuros-set' };
  const title = input.title ?? '';
  if (/תשורה|teshura|tshura/i.test(title)) return { as: 'teshura', reason: 'title' };
  const years = yearsInText(title);
  if (years.length) {
    const printing = input.publications?.find((p) => {
      const d = p.data as { date?: string; gregorianYear?: number };
      const year = d.date ? Number(d.date.slice(0, 4)) : d.gregorianYear ? d.gregorianYear + 3760 : null;
      return year !== null && (years.includes(year) || (d.gregorianYear !== undefined && years.includes(d.gregorianYear + 3761)));
    });
    if (printing) return { as: 'scan-of', reason: 'same-year', publication: printing.id };
  }
  return { as: 'printing', reason: 'new' };
}

// ---------------------------------------------------------------- contents maps

export interface ContentsInput {
  publication: EntityId;
  pages: { from: number; to: number; scheme: 'printed' | 'pdf' };
  /** The unit these pages hold, when it is in the catalog already. */
  unit?: EntityId;
  /** Or a unit to make: a letter, sicha or story never printed before, in a sefer of the catalog. */
  newUnit?: { work: EntityId; label: LocalName; date?: string };
  /** Or only what is there, in words, until someone makes it a unit. */
  label?: LocalName;
}

/**
 * "Map a teshura" (the plan, section 7): pages of a publication linked to
 * the unit they hold - one already in the catalog, or a new one (a letter
 * printed here for the first time becomes a unit of its sefer) - sent as
 * one suggestion for the set's keepers.
 */
export async function suggestContents(catalog: Catalog, by: string, input: ContentsInput): Promise<{ suggestion: number; map: EntityId; unit: EntityId | null }> {
  const { from, to, scheme } = input.pages ?? ({} as ContentsInput['pages']);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 5000) throw invalid('pages are a range of whole numbers from 1 (from ≤ to)');
  if (scheme !== 'printed' && scheme !== 'pdf') throw invalid('say whether the page numbers are as printed or of the PDF');
  const publication = await catalog.get(input.publication);
  if (!publication || publication.type !== 'publication') throw notFound(`publication ${input.publication}`);
  const choices = [input.unit, input.newUnit, input.label].filter((x) => x !== undefined).length;
  if (choices !== 1) throw invalid('link a unit, make a new one, or say in words what is there - one of them');
  const pubTitle = ((publication.data as { title?: LocalName }).title?.he ?? '').slice(0, 80);

  let unit: EntityId | null = null;
  let newUnitData: Json | null = null;
  if (input.unit) {
    if (!isEntityId(input.unit)) throw invalid(`"${input.unit}" is not an id`);
    const found = await catalog.get(input.unit);
    if (!found || found.type !== 'unit') throw notFound(`unit ${input.unit}`);
    unit = found.id;
  } else if (input.newUnit) {
    const { work: workId, label, date } = input.newUnit;
    const work = isEntityId(workId) ? await catalog.get(workId) : null;
    if (!work || work.type !== 'work') throw notFound(`sefer ${workId}`);
    if (!label?.he?.trim()) throw invalid('a new unit needs its name in Hebrew');
    if (date !== undefined && !isValidDateKey(date)) throw invalid(`${date} is not a date`);
    const levels = (work.data as { levels?: string[] }).levels ?? [];
    // After the sefer's last unit: a new letter is added at the end, and moved to its place by a fix.
    const last = await one<{ order: string | null }>(
      catalog.db,
      `SELECT max(r.data->>'order' COLLATE "C") AS order FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'unit' AND NOT e.deleted
       JOIN revision r ON r.id = e.main_rev WHERE x.to_id = $1 AND x.field = 'work'`,
      [work.id],
    );
    newUnitData = {
      work: work.id,
      position: [{ level: levels.at(-1) ?? 'unit', value: label.he.trim().slice(0, 100) }],
      order: orderBetween(last?.order ?? null, null),
      label: { he: label.he.trim().slice(0, 300), ...(label.en?.trim() ? { en: label.en.trim().slice(0, 300) } : {}) },
      ...(date ? { date } : {}),
    };
  } else if (!input.label?.he?.trim()) {
    throw invalid('say in Hebrew what is on these pages');
  }

  const suggestion = await catalog.createChangeset(by, { title: `מפתח תוכן: ${pubTitle}, עמ׳ ${from}–${to}` });
  if (newUnitData) unit = await catalog.putRevision(suggestion.id, by, { type: 'unit', data: newUnitData });
  const map = await catalog.putRevision(suggestion.id, by, {
    type: 'contents-map',
    data: {
      publication: publication.id,
      pages: { from, to, scheme },
      ...(unit ? { unit } : { label: { he: input.label!.he.trim().slice(0, 300), ...(input.label!.en?.trim() ? { en: input.label!.en.trim().slice(0, 300) } : {}) } }),
    } as Json,
  });
  const sent = await catalog.submit(suggestion.id, by);
  return { suggestion: sent.id, map, unit };
}

// ---------------------------------------------------------------- family requests

export interface FamilyRequestInput {
  publication: EntityId;
  /** How the person asking is related, in their words. */
  relation?: string;
  note?: string;
  /** How to reach them; kept for stewards, never shown. */
  contact?: string;
  reporter?: string;
  reporterHash?: string;
}

/**
 * A family asks that a teshura not be shown (the plan, section 8: "a fast
 * family-request path"). It lands as a Report in the stewards' inbox, and
 * its scans stop being served at once - moved to `preserved`, as a
 * takedown does, logged, the copy kept and never deleted - so a family
 * never waits on a review to be heard. A steward who finds the request
 * mistaken restores the files' rights (`setRights`) and closes the Report.
 */
export async function familyRequest(catalog: Catalog, input: FamilyRequestInput): Promise<{ report: number; paused: string[] }> {
  const publication = await catalog.get(input.publication);
  if (!publication || publication.type !== 'publication' || (publication.data as { kind?: string }).kind !== 'teshura') throw notFound('a family request is made on a teshura');
  const relation = input.relation?.trim().slice(0, 300) || undefined;
  const contact = input.contact?.trim().slice(0, 300) || undefined;
  const note = [`בקשת משפחה / Family request${relation ? ` (${relation})` : ''}`, input.note?.trim()].filter(Boolean).join(': ').slice(0, 2000);
  const report = await catalog.report({ entityId: publication.id, reason: 'rights', note, reporter: input.reporter, reporterHash: input.reporterHash });
  return catalog.db.transaction(async (tx) => {
    // The teshura's scans' files, and what was made from them (their reading copies and page images).
    const { rows } = await tx.query<{ sha256: string; rights_state: RightsState }>(
      `SELECT f.sha256, f.rights_state FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'scan' AND NOT e.deleted
       JOIN revision r ON r.id = e.main_rev JOIN file f ON f.sha256 = r.data->>'file'
       WHERE x.to_id = $1 AND x.field = 'publication'`,
      [publication.id],
    );
    const paused = rows.filter((r) => mayServe(r.rights_state)).map((r) => r.sha256);
    for (const sha256 of paused) {
      const from = rows.find((r) => r.sha256 === sha256)!.rights_state;
      await tx.query(
        `UPDATE file SET rights_state = 'preserved', storage_tier = CASE WHEN storage_tier = 'none' THEN 'none' ELSE 'preservation' END, rights_changed_at = now(), rights_changed_by = 'system'
         WHERE sha256 = $1 OR sha256 IN (SELECT sha256 FROM derivation WHERE src_sha256 = $1)`,
        [sha256],
      );
      await tx.query("INSERT INTO audit_log (actor, action, target_kind, target_id, detail) VALUES ('system', 'file.rights', 'file', $1, $2)", [
        sha256,
        JSON.stringify({ from, to: 'preserved', note: `family request, report ${report}` }),
      ]);
    }
    await tx.query('INSERT INTO family_request (report_id, publication_id, relation, contact, paused) VALUES ($1, $2, $3, $4, $5)', [report, publication.id, relation ?? null, contact ?? null, paused]);
    return { report, paused };
  });
}

/** The family requests made on a teshura (stewards read them with its Reports). */
export async function familyRequests(catalog: Catalog, publication: EntityId): Promise<Array<{ report_id: number; relation: string | null; contact: string | null; paused: string[]; created_at: string }>> {
  const { rows } = await catalog.db.query<{ report_id: number; relation: string | null; contact: string | null; paused: string[]; created_at: string }>(
    'SELECT report_id, relation, contact, paused, created_at FROM family_request WHERE publication_id = $1 ORDER BY created_at',
    [publication],
  );
  return rows;
}
