import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { fileFromDrive, getFile, getPageFix } from '@rebbehub/core';
import type { DriveFolder } from '@rebbehub/importers';
import { catalogIsRebuildable } from '../src/commands.js';
import { collectPageFixes, makePageFixes, otzrosPdfs, registerPageFixes, type LinkedPdf } from '../src/pageFixes.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';
import { drawPage } from '../../../packages/pdf-fix/tests/page.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function scannedBook(tilts: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const tilt of tilts) {
    const image = await doc.embedPng(drawPage({ width: 600, height: 800, tilt }).png);
    doc.addPage([300, 400]).drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
  }
  return doc.save();
}

async function typesetBook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([300, 400]);
  for (let line = 0; line < 20; line++) page.drawText(`A line set in type, number ${line + 1}.`, { x: 30, y: 360 - line * 16, size: 11, font });
  return doc.save();
}

const tree: DriveFolder = {
  id: 'root',
  title: 'ספרי ליובאוויטש',
  files: [],
  folders: [
    {
      id: 'f1',
      title: '1. תורת כ"ק אד"ש',
      files: [{ id: 'notes-txt-file', title: 'notes.txt' }],
      folders: [
        {
          id: 'f2',
          title: 'א. לקוטי שיחות',
          folders: [],
          files: [
            { id: 'drive-typeset-1', title: 'typeset.pdf' },
            { id: 'drive-level-11', title: 'level.pdf' },
            { id: 'drive-leaning-1', title: 'leaning.PDF', resourceKey: '0-key' },
            { id: 'drive-refused-1', title: 'refused.pdf' },
            { id: 'drive-broken-11', title: 'broken.pdf' },
          ],
        },
      ],
    },
  ],
};

describe('page fixes for the PDFs RebbeHub links to', () => {
  it("lists the Otzros library's PDFs once each, with the folders they sit in", () => {
    const pdfs = otzrosPdfs(tree);
    expect(pdfs.map((pdf) => pdf.driveFileId)).toEqual(['drive-typeset-1', 'drive-level-11', 'drive-leaning-1', 'drive-refused-1', 'drive-broken-11']);
    expect(pdfs[2]).toEqual({ driveFileId: 'drive-leaning-1', resourceKey: '0-key', label: 'leaning.PDF', where: '1. תורת כ"ק אד"ש / א. לקוטי שיחות' });
  });

  it('passes over type and level scans, turns only leaning pages, tries a refused download again, and records it all', async () => {
    const pdfs = otzrosPdfs(tree);
    const files = new Map<string, Uint8Array>([
      ['drive-typeset-1', await typesetBook()],
      ['drive-level-11', await scannedBook([0, 0.1])],
      ['drive-leaning-1', await scannedBook([0, 1.4, 0])],
      ['drive-broken-11', new TextEncoder().encode('%PDF-1.4 not really a PDF')],
    ]);
    let refuse = true;
    const fetchPdf = async (pdf: LinkedPdf) => {
      if (pdf.driveFileId === 'drive-refused-1') {
        if (refuse) throw new Error('Drive did not give the file');
        return files.get('drive-level-11')!;
      }
      return files.get(pdf.driveFileId)!;
    };
    const work = await mkdtemp(join(tmpdir(), 'page-fixes-'));
    expect(await makePageFixes({ pdfs, work, fetchPdf })).toEqual({ done: 4, fixed: 1, asIs: 2, failed: 1, unread: 1, skipped: 0 });
    // The next run reads only the one Drive would not give.
    refuse = false;
    expect(await makePageFixes({ pdfs, work, fetchPdf })).toEqual({ done: 1, fixed: 0, asIs: 1, failed: 0, unread: 0, skipped: 4 });

    const manifest = await collectPageFixes(work, 'otzros', pdfs, new Date('2026-09-28T12:00:00Z'));
    const byId = Object.fromEntries(manifest.files.map((entry) => [entry.driveFileId, entry]));
    expect(byId['drive-typeset-1']).toMatchObject({ verdict: 'as-is', reason: 'born-digital', pages: 1 });
    expect(byId['drive-level-11']).toMatchObject({ verdict: 'as-is', reason: 'level', pages: 2 });
    expect(byId['drive-broken-11']).toMatchObject({ verdict: 'failed' });
    const leaning = byId['drive-leaning-1']!;
    expect(leaning).toMatchObject({ verdict: 'fixed', pages: 3, sha256: sha256(files.get('drive-leaning-1')!) });
    expect(leaning.turns).toEqual([{ page: 2, angle: expect.closeTo(1.4, 0), transform: expect.any(Array) }]);

    // A catalog only the importers filled, as the import builds it.
    const { db, catalog } = await freshCatalog();
    await db.exec('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await catalog.init();
    await registerPageFixes(db, manifest);
    await registerPageFixes(db, manifest);
    // Known, never held: a publisher's scan is a link.
    expect(await getFile(db, leaning.sha256!)).toMatchObject({ rights_state: 'link', storage_tier: 'none', credit: 'אוצרות הרבי' });
    expect(await fileFromDrive(db, 'drive-leaning-1')).toBe(leaning.sha256);
    expect(await getPageFix(db, leaning.sha256!)).toMatchObject({ encoder: 'pdf-level@1', verdict: 'fixed', pages: [expect.objectContaining({ page: 2 })] });
    expect(await getPageFix(db, byId['drive-typeset-1']!.sha256!)).toMatchObject({ verdict: 'as-is', reason: 'born-digital', pages: [] });
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM page_fix');
    // The refused file was read on the second run, and has the same bytes as the level one: one file, two sources.
    expect(rows[0]!.n).toBe(4);
    expect(await catalogIsRebuildable(db)).toBe(true);
  });
});
