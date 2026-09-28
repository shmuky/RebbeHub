import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { familyRequest, familyRequests, filePages, getFile, proposeUpload, recordAudioFingerprint, recordDerivation, recordPdfPages, registerFile, similarFiles, similarScans, suggestContents, yearsInText, type Catalog } from '@rebbehub/core';
import { AUDIO_FINGERPRINT_ENCODER, PAGE_HASH_ENCODER, type EntityId } from '@rebbehub/model';
import { add, freshCatalog } from './helpers.js';

/**
 * Phase 3's print side: pages and fingerprints of held files, finding the
 * same scan in other bytes, guessing what an upload is, mapping a
 * teshura's pages, and a family's request.
 */

let catalog: Catalog;
let set: EntityId;

beforeEach(async () => {
  ({ catalog, set } = await freshCatalog());
});

const sha = (c: string) => c.repeat(64);
/** A made-up page hash: 64 hex digits from a seed, and one with a few bits flipped. */
const hash = (seed: number) => createHash('sha256').update(`page ${seed}`).digest('hex');
const near = (h: string) => (parseInt(h[0]!, 16) ^ 1).toString(16) + h.slice(1, 10) + (parseInt(h[10]!, 16) ^ 2).toString(16) + h.slice(11);
const pdf = async (s: string) => registerFile(catalog.db, { sha256: s, bytes: 100, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
const pages = (hashes: Array<string | null>) => hashes.map((h, i) => ({ page: i + 1, widthPt: 420, heightPt: 595, hash: h }));

describe('pages and fingerprints of held files', () => {
  it('keeps a PDF\'s pages, and a page image made later with them', async () => {
    await pdf(sha('a'));
    await recordPdfPages(catalog.db, { sha256: sha('a'), encoder: PAGE_HASH_ENCODER, pageCount: 2, pages: pages([hash(1), null]) });
    await recordDerivation(catalog.db, { src: sha('a'), profile: 'page-image/1', sha256: sha('c'), bytes: 10, mime: 'image/jpeg', encoder: 'page-images@1' });
    await recordPdfPages(catalog.db, { sha256: sha('a'), encoder: PAGE_HASH_ENCODER, pageCount: 2, pages: [{ ...pages([hash(1)])[0]!, image: { sha256: sha('c'), width: 1200, height: 1700 } }] });
    // Measured again without images: the image stays.
    await recordPdfPages(catalog.db, { sha256: sha('a'), encoder: PAGE_HASH_ENCODER, pageCount: 2, pages: pages([hash(1), null]) });
    const rows = await filePages(catalog.db, sha('a'));
    expect(rows.map((r) => [r.page, r.hash, r.image_sha256])).toEqual([
      [1, hash(1), sha('c')],
      [2, null, null],
    ]);
    // The page image is a file with its PDF's rights.
    expect((await getFile(catalog.db, sha('c')))?.rights_state).toBe('open');
  });

  it('finds the same scan in other bytes, and a scan that shares pages', async () => {
    const book = [1, 2, 3, 4, 5].map(hash);
    await pdf(sha('a'));
    await recordPdfPages(catalog.db, { sha256: sha('a'), encoder: PAGE_HASH_ENCODER, pageCount: 5, pages: pages(book) });
    await pdf(sha('b'));
    await recordPdfPages(catalog.db, { sha256: sha('b'), encoder: PAGE_HASH_ENCODER, pageCount: 3, pages: pages([hash(9), hash(10), hash(11)]) });

    const again = await similarScans(catalog.db, book.map(near));
    expect(again).toEqual([{ sha256: sha('a'), kind: 'same', matched: 5, of: 5 }]);
    const part = await similarScans(catalog.db, [near(book[0]!), near(book[1]!), hash(20), hash(21), hash(22)]);
    expect(part).toEqual([{ sha256: sha('a'), kind: 'shares', matched: 2, of: 5 }]);
    expect(await similarScans(catalog.db, [hash(30), hash(31)])).toEqual([]);

    // A held file's own measurements, against the rest.
    await pdf(sha('d'));
    await recordPdfPages(catalog.db, { sha256: sha('d'), encoder: PAGE_HASH_ENCODER, pageCount: 5, pages: pages(book.map(near)) });
    expect(await similarFiles(catalog.db, sha('d'))).toEqual([{ sha256: sha('a'), kind: 'same', matched: 5, of: 5 }]);
  });

  it('finds the same recording by its fingerprint', async () => {
    const fp = Array.from({ length: 400 }, (_, i) => (i * 2654435761) | 0);
    for (const s of ['e', 'f']) await registerFile(catalog.db, { sha256: sha(s), bytes: 100, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    await recordAudioFingerprint(catalog.db, { sha256: sha('e'), encoder: AUDIO_FINGERPRINT_ENCODER, durationMs: 37_000, fingerprint: fp });
    await recordAudioFingerprint(catalog.db, { sha256: sha('f'), encoder: AUDIO_FINGERPRINT_ENCODER, durationMs: 37_500, fingerprint: fp.map((x, i) => (i % 5 === 0 ? x ^ 0b101 : x)) });
    const found = await similarFiles(catalog.db, sha('f'));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sha256: sha('e'), kind: 'same', offsetMs: 0 });
  });
});

describe('what an upload is', () => {
  const view = (type: string, data: Record<string, unknown>, id = 'rh-0000001') => ({ id: id as EntityId, type: type as 'work', path: null, rev: 1, data: data as never });

  it('reads the years a title names', () => {
    expect(yearsInText('לקוטי שיחות חלק ד, תשמ"ב')).toEqual([5742]);
    expect(yearsInText('Kehot 1982')).toEqual([5742, 5743]);
    expect(yearsInText('דפוס 5720')).toEqual([5720]);
  });

  it('says we have it, or guesses a scan of a printing, a teshura, or a new printing', () => {
    const work = view('work', { title: { he: 'ספר' } });
    const printing = view('publication', { kind: 'book-volume', title: { he: 'ספר' }, date: '5742' }, 'rh-0000002');
    expect(proposeUpload({ target: work, usedBy: [{ id: 'rh-0000003', type: 'scan', path: null }] })).toMatchObject({ as: 'existing' });
    expect(proposeUpload({ target: work, similar: [{ sha256: sha('a'), kind: 'same', matched: 9, of: 10, scans: [{ id: 'rh-0000003' as EntityId, publication: printing.id }] }] })).toMatchObject({
      as: 'duplicate',
      scan: 'rh-0000003',
    });
    expect(proposeUpload({ target: work, similar: [{ sha256: sha('a'), kind: 'shares', matched: 3, of: 10, scans: [{ id: 'rh-0000003' as EntityId, publication: printing.id }] }] })).toEqual({
      as: 'scan-of',
      reason: 'shares-pages',
      publication: printing.id,
    });
    expect(proposeUpload({ target: printing })).toMatchObject({ as: 'scan-of', reason: 'on-publication' });
    expect(proposeUpload({ target: view('set', {}), teshurosSet: true })).toMatchObject({ as: 'teshura' });
    expect(proposeUpload({ target: work, title: 'תשורה משמחת הנישואין' })).toMatchObject({ as: 'teshura', reason: 'title' });
    expect(proposeUpload({ target: work, title: 'ספר, דפוס תשמ"ב', publications: [printing] })).toEqual({ as: 'scan-of', reason: 'same-year', publication: printing.id });
    expect(proposeUpload({ target: work, title: 'ספר, דפוס תשנ"ב', publications: [printing] })).toEqual({ as: 'printing', reason: 'new' });
  });
});

describe('contents maps and teshuros', () => {
  let work: EntityId;
  let teshura: EntityId;
  let letter: EntityId;

  beforeEach(async () => {
    work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'אגרות קודש' }, slug: 'igros-kodesh', authors: [], genre: 'igros', levels: ['volume', 'letter'], sets: [set] });
    letter = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'volume', value: '1' }, { level: 'letter', value: '1' }], order: 'V', label: { he: 'מכתב א' }, date: '5718-01-05' });
    teshura = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'teshura', title: { he: 'תשורה' }, simcha: { kind: 'wedding', families: ['כהן', 'לוי'] }, sets: [set] });
  });

  it('links pages to a unit the catalog has, through a suggestion', async () => {
    const sent = await suggestContents(catalog, 'chaim', { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' }, unit: letter });
    const review = await catalog.review(sent.suggestion);
    expect(review.changeset.status).toBe('open');
    expect(review.entries).toEqual([expect.objectContaining({ type: 'contents-map', after: { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' }, unit: letter } })]);
    await catalog.merge(sent.suggestion, 'keeper');
    expect((await catalog.backlinks(letter, { type: 'contents-map' })).map((b) => b.from)).toEqual([sent.map]);
  });

  it('makes a unit printed here for the first time, at the end of its sefer', async () => {
    const sent = await suggestContents(catalog, 'chaim', { publication: teshura, pages: { from: 9, to: 9, scheme: 'pdf' }, newUnit: { work, label: { he: 'מכתב שלא נדפס' }, date: '5720-07-01' } });
    await catalog.merge(sent.suggestion, 'keeper');
    const unit = await catalog.get(sent.unit!);
    expect(unit?.data).toMatchObject({ work, label: { he: 'מכתב שלא נדפס' }, position: [{ level: 'letter', value: 'מכתב שלא נדפס' }], date: '5720-07-01' });
    expect(((unit!.data as { order: string }).order > 'V')).toBe(true);
  });

  it('refuses a map that says nothing, or two things', async () => {
    await expect(suggestContents(catalog, 'chaim', { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' } })).rejects.toThrow(/one of them/);
    await expect(suggestContents(catalog, 'chaim', { publication: teshura, pages: { from: 8, to: 3, scheme: 'printed' }, unit: letter })).rejects.toThrow(/range/);
    await expect(suggestContents(catalog, 'chaim', { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' }, unit: letter, label: { he: 'x' } })).rejects.toThrow(/one of them/);
  });

  it("takes a family's request: a Report for the stewards, and the scans stop being served at once", async () => {
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 100, mime: 'application/pdf', source: 'contribution', licence: 'unknown', fileClass: 'teshura-scan', held: true });
    await recordDerivation(catalog.db, { src: sha('a'), profile: 'page-image/1', sha256: sha('c'), bytes: 10, mime: 'image/jpeg', encoder: 'page-images@1' });
    await add(catalog, 'mendy', 'keeper', 'scan', { publication: teshura, file: sha('a'), completeness: 'complete' });
    expect((await getFile(catalog.db, sha('a')))?.rights_state).toBe('credit');

    const done = await familyRequest(catalog, { publication: teshura, relation: 'אבי החתן', note: 'נא להסיר', contact: 'phone' });
    expect(done.paused).toEqual([sha('a')]);
    expect(await getFile(catalog.db, sha('a'))).toMatchObject({ rights_state: 'preserved', storage_tier: 'preservation' });
    expect(await getFile(catalog.db, sha('c'))).toMatchObject({ rights_state: 'preserved' });
    const [report] = (await catalog.reports()) as Array<{ id: number; reason: string; note: string; entity_id: string }>;
    expect(report).toMatchObject({ id: done.report, reason: 'rights', entity_id: teshura });
    expect(report!.note).toContain('אבי החתן');
    expect(report!.note).not.toContain('phone');
    expect(await familyRequests(catalog, teshura)).toEqual([expect.objectContaining({ report_id: done.report, contact: 'phone', paused: [sha('a')] })]);
    expect(await catalog.auditLog({ kind: 'file', id: sha('a') })).toEqual([expect.objectContaining({ actor: 'system', action: 'file.rights' })]);
  });

  it('takes family requests only on teshuros', async () => {
    await expect(familyRequest(catalog, { publication: work })).rejects.toThrow(/teshura/);
  });
});
