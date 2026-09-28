import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { getDerivations, getFile, getPageFix, setRights } from '@rebbehub/core';
import { catalogIsRebuildable } from '../src/commands.js';
import { collectManifest, makeReadingCopies, registerReadingCopies, sichosKodeshScans, type ObjectStore } from '../src/readingCopies.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';
import { drawPage } from '../../../packages/pdf-fix/tests/page.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async has(key: string) {
    return this.objects.has(key);
  }
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }
}

/** A typewritten page, tilted and off to one side, as the scanner left it. */
async function scannedPdf(tilt: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(drawPage({ width: 600, height: 800, tilt, shift: -40, edge: true }).png);
  doc.addPage([300, 400]).drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
  return doc.save();
}

async function checkout(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sk-checkout-'));
  await mkdir(join(dir, 'apps', 'web', 'src', 'catalog', 'data'), { recursive: true });
  await writeFile(
    join(dir, 'apps', 'web', 'src', 'catalog', 'data', '5736.json'),
    JSON.stringify([
      { occasionId: 11114312, pdfs: [{ driveFileId: 'drive-sk-1', label: 'שיחו"ק' }, { driveFileId: 'drive-tm-1', label: 'תו"מ התוועדויות' }] },
      { occasionId: 11114313, pdfs: [{ driveFileId: 'drive-sk-2', label: 'שיחות קודש' }, { driveFileId: 'drive-sk-1', label: 'שיחו"ק' }] },
      // Later printings: publisher scans, not the old typewritten set.
      { occasionId: 11114314, pdfs: [{ driveFileId: 'drive-new-1', label: 'הנחה מוגה/ שיחו"ק - הוצאת תשנ"ח' }, { driveFileId: 'drive-new-2', label: 'הנחה פרטית (נדפס בשיחו"ק, ברוקלין תשע"ו)' }] },
      { occasionId: 11114315, pdfs: [{ driveFileId: 'drive-memoir', label: 'זכרונות רב"צ פרידמן - שיחות קודש קודם הנשיאות ע\' 192' }, { driveFileId: 'drive-sk-3', label: 'בהוס\' לשיחו"ק (ח"ב)' }] },
    ]),
  );
  return dir;
}

describe('the Sichos Kodesh reading copies', () => {
  it('lists each old Sichos Kodesh hanacha of the catalog once, and no later printing', async () => {
    expect(await sichosKodeshScans(await checkout())).toEqual([
      { driveFileId: 'drive-sk-1', label: 'שיחו"ק', where: '5736/11114312' },
      { driveFileId: 'drive-sk-2', label: 'שיחות קודש', where: '5736/11114313' },
      { driveFileId: 'drive-sk-3', label: 'בהוס\' לשיחו"ק (ח"ב)', where: '5736/11114315' },
    ]);
  });

  it('copies each scan from the archive, puts its reading copy next to it, and records both in the catalog', async () => {
    const from = await checkout();
    const scans = await sichosKodeshScans(from);
    const original = await scannedPdf(1.4);
    const source = new MemoryStore();
    source.objects.set(`objects/${sha256(original)}`, original);
    const target = new MemoryStore();
    const work = await mkdtemp(join(tmpdir(), 'reading-copies-'));
    const archive = new Map([['drive-sk-1', { sha256: sha256(original), bytes: original.length }]]);

    const result = await makeReadingCopies({ scans, archive, source, target, work });
    expect(result).toEqual({ done: 3, copies: 1, failed: 2, skipped: 0 });
    // Run again: nothing is done twice.
    expect(await makeReadingCopies({ scans, archive, source, target, work })).toMatchObject({ done: 0, skipped: 3 });

    const manifest = await collectManifest(work, scans, new Date('2026-09-28T12:00:00Z'));
    const [done, missing] = manifest.files;
    expect(manifest.files).toHaveLength(3);
    expect(missing).toMatchObject({ driveFileId: 'drive-sk-2', error: 'not in the archive' });
    expect(done).toMatchObject({ driveFileId: 'drive-sk-1', sha256: sha256(original), pages: 1, readingCopy: { encoder: 'pdf-fix@1' } });
    const copy = target.objects.get(`objects/${done!.readingCopy!.sha256}`)!;
    expect(sha256(copy)).toBe(done!.readingCopy!.sha256);
    expect(target.objects.get(`objects/${sha256(original)}`)).toEqual(original);
    const [page] = done!.readingCopy!.pages;
    expect(page).toMatchObject({ page: 1, angle: expect.closeTo(1.4, 0), transform: expect.any(Array) });

    const { catalog } = await freshCatalog();
    await registerReadingCopies(catalog.db, manifest);
    await registerReadingCopies(catalog.db, manifest);
    expect(await getFile(catalog.db, sha256(original))).toMatchObject({ rights_state: 'open', storage_tier: 'public', mime: 'application/pdf' });
    expect(await getFile(catalog.db, done!.readingCopy!.sha256)).toMatchObject({ rights_state: 'open', storage_tier: 'public' });
    const [derivation] = await getDerivations(catalog.db, sha256(original));
    expect(derivation).toMatchObject({ profile: 'reading-copy', sha256: done!.readingCopy!.sha256, encoder: 'pdf-fix@1' });
    expect(await getPageFix(catalog.db, sha256(original))).toMatchObject({ verdict: 'fixed', encoder: 'pdf-fix@1', pages: [expect.objectContaining({ page: 1, transform: expect.any(Array) })] });
    const { rows } = await catalog.db.query<{ n: number }>('SELECT count(*)::int AS n FROM file_source');
    expect(rows[0]!.n).toBe(1);

    // A takedown of the scan takes its reading copy down with it.
    await setRights(catalog.db, 'shmuly', sha256(original), 'preserved', 'takedown');
    expect(await getFile(catalog.db, done!.readingCopy!.sha256)).toMatchObject({ rights_state: 'preserved', storage_tier: 'preservation' });
  });

  it('keeps a catalog rebuildable when only the import registered its files', async () => {
    const { db, catalog } = await freshCatalog();
    await db.exec('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await catalog.init();
    const original = await scannedPdf(0.8);
    await registerReadingCopies(db, { format: 'rebbehub-reading-copies', formatVersion: 1, encoder: 'pdf-fix@1', madeAt: '', files: [{ driveFileId: 'd', label: 'שיחו"ק', where: '5736/1', sha256: sha256(original), bytes: original.length }] });
    expect(await catalogIsRebuildable(db)).toBe(true);
    await catalog.createAccount({ id: 'shmuly', displayName: 'Shmuly' });
    await db.query("UPDATE account SET is_steward = TRUE WHERE id = 'shmuly'");
    await setRights(db, 'shmuly', sha256(original), 'preserved', 'takedown');
    expect(await catalogIsRebuildable(db)).toBe(false);
  });
});
