import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SefariaCrawl } from '@rebbehub/importers';
import { keepSefariaTexts } from '../src/commands.js';
import type { ObjectStore } from '../src/readingCopies.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rebbehub-sefaria-keep-'));
  mkdirSync(join(dir, 'texts'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const memory = (): ObjectStore & { objects: Map<string, Uint8Array> } => {
  const objects = new Map<string, Uint8Array>();
  return { objects, get: async (k) => objects.get(k) ?? null, has: async (k) => objects.has(k), put: async (k, b) => void objects.set(k, b) };
};

describe("Sefaria's texts on RebbeHub's own storage", () => {
  it('stores each kept text once by its sha256, checked, and never one whose licence does not allow it', async () => {
    const html = '<article><p>synthetic</p></article>\n';
    const sha256 = createHash('sha256').update(html).digest('hex');
    writeFileSync(join(dir, 'texts', `${sha256}.html`), html);
    const crawl: SefariaCrawl = {
      books: [
        {
          title: 'A Book',
          heTitle: 'ספר',
          categories: [],
          authors: [],
          units: [
            { id: '1', ref: 'A Book 1', label: { he: 'א', en: '1' }, position: [{ level: 'chapter', value: '1' }], texts: [{ language: 'he', version: 'V', licence: 'cc-by-nc', sha256, bytes: html.length }, { language: 'en', version: 'W', licence: 'unknown' }] },
            { id: '2', ref: 'A Book 2', label: { he: 'ב', en: '2' }, position: [{ level: 'chapter', value: '2' }], texts: [{ language: 'he', version: 'V', licence: 'cc-by-nc', sha256, bytes: html.length }] },
          ],
        },
      ],
    };
    const store = memory();
    expect(await keepSefariaTexts(crawl, dir, store)).toEqual({ stored: 1, already: 0 });
    expect([...store.objects.keys()]).toEqual([`texts/${sha256}`]);
    expect(crawl.books[0]!.units.flatMap((u) => u.texts.map((t) => t.kept ?? false))).toEqual([true, false, true]);
    expect(await keepSefariaTexts(crawl, dir, store)).toEqual({ stored: 0, already: 1 });

    writeFileSync(join(dir, 'texts', `${sha256}.html`), '<article>changed</article>');
    await expect(keepSefariaTexts(crawl, dir, memory())).rejects.toThrow(/does not match its hash/);
  });
});
