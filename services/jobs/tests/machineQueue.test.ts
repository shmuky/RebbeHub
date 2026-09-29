import { describe, expect, it } from 'vitest';
import { machineRequests, registerFile, requestMachineWork } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { readScans, type OcrEngine } from '../src/ocr.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

/** The machine jobs take what people asked for first, settle each request, and go on to what is new only when sweeping. */

const engine = (fail?: string): OcrEngine => ({
  name: 'fake',
  version: async () => '1.0',
  pages: async (pdf) => {
    if (fail && pdf.includes(fail)) throw new Error('cannot render');
    return ['p1.png'];
  },
  lines: async () => [{ id: 'l1', text: 'שורה', box: [0, 0, 1, 0.1] }],
});

async function scans(n: number) {
  const { catalog, set } = await freshCatalog();
  const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, sets: [set] });
  const ids: EntityId[] = [];
  for (let i = 0; i < n; i++) {
    const sha = String.fromCharCode(97 + i).repeat(64);
    await registerFile(catalog.db, { sha256: sha, bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    ids.push(await add(catalog, 'mendy', 'keeper', 'scan', { publication, file: sha, completeness: 'complete', sets: [set] }));
  }
  return { catalog, ids };
}

describe('the machine queue in the jobs', () => {
  it('reads what was asked for, and only that when told to', async () => {
    const { catalog, ids } = await scans(3);
    await requestMachineWork(catalog, 'chaim', { kind: 'ocr', item: ids[1]! });
    const done = await readScans(catalog, { approveAs: 'shmuly', engine: engine(), requestedOnly: true, fetchFile: async () => new Uint8Array([1]) });
    expect(done.map((d) => d.scan)).toEqual([ids[1]]);
    expect((await machineRequests(catalog, { item: ids[1]! }))[0]).toMatchObject({ status: 'done' });

    // Nothing asked: the nightly run goes on to the newest scans not read yet.
    const nightly = await readScans(catalog, { approveAs: 'shmuly', engine: engine(), limit: 5, fetchFile: async () => new Uint8Array([1]) });
    expect(nightly.map((d) => d.scan).sort()).toEqual([ids[0], ids[2]].sort());
  });

  it('marks a request failed with why, reads the rest, then says the run failed', async () => {
    const { catalog, ids } = await scans(2);
    await requestMachineWork(catalog, 'chaim', { kind: 'ocr', item: ids[0]! });
    let calls = 0;
    const flaky: OcrEngine = { ...engine(), pages: async () => (calls++ === 0 ? Promise.reject(new Error('cannot render')) : ['p1.png']) };
    await expect(readScans(catalog, { approveAs: 'shmuly', engine: flaky, limit: 5, fetchFile: async () => new Uint8Array([1]) })).rejects.toThrow(/1 failed: .*cannot render/);
    expect((await machineRequests(catalog, { item: ids[0]! }))[0]).toMatchObject({ status: 'failed', note: 'cannot render' });
    const text = await catalog.list({ type: 'text-layer' });
    expect(text.some((l) => (l.data as { scan: string }).scan === ids[1])).toBe(true);
  });
});
