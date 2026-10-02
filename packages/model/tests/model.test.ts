import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SCHEMAS,
  ENTITY_TYPES,
  changeSegment,
  findSegment,
  inlineText,
  newSegmentId,
  pageTextPlain,
  plainPage,
  tidyInline,
  SchemaRegistry,
  canonicalJson,
  contentHash,
  defaultRightsState,
  idFromSeed,
  isAddition,
  isEntityId,
  isEntityPath,
  joinPath,
  newId,
  orderBetween,
  orderKeys,
  readId,
  referencesOf,
  rightsStateFromDecision,
  slugify,
} from '@rebbehub/model';
import { EXAMPLES } from './fixtures.js';

describe('schemas', () => {
  const registry = SchemaRegistry.builtin();

  it('has a schema for every entity type', () => {
    expect(Object.keys(BUILTIN_SCHEMAS).sort()).toEqual([...ENTITY_TYPES].sort());
  });

  it.each(ENTITY_TYPES)('accepts the %s example', (type) => {
    expect(registry.validate(type, EXAMPLES[type])).toEqual({ ok: true });
  });

  it('names what is wrong, where', () => {
    const result = registry.validate('event', { kind: 'farbrengen', title: { en: 'no Hebrew' }, date: '5742-13-40', colour: 'red' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('/title');
    expect(paths).toContain('/date');
    expect(paths.some((p) => p === '' || p === '/colour')).toBe(true);
  });

  it("takes a sefer's `addition` (what kind, and the official sefer it belongs under) and refuses anything else there", () => {
    expect(registry.validate('work', { ...EXAMPLES.work, addition: { kind: 'commentary', to: 'rh-00000009' } })).toEqual({ ok: true });
    expect(registry.validate('work', { ...EXAMPLES.work, addition: { kind: 'index' } })).toEqual({ ok: true });
    expect(registry.validate('work', { ...EXAMPLES.work, addition: { to: 'rh-00000009' } }).ok).toBe(false);
    expect(registry.validate('work', { ...EXAMPLES.work, addition: { kind: 'translation' } }).ok).toBe(false);
    expect(registry.validate('work', { ...EXAMPLES.work, addition: { kind: 'about', to: 'tanya' } }).ok).toBe(false);
    expect(registry.validate('work', { ...EXAMPLES.work, addition: { kind: 'about', note: 'x' } }).ok).toBe(false);
    expect(isAddition({ ...EXAMPLES.work, addition: { kind: 'other' } })).toBe(true);
    expect(isAddition(EXAMPLES.work)).toBe(false);
  });

  it('refuses an unknown type, and takes stored schemas over built-in ones', () => {
    expect(registry.validate('maaneh', {}).ok).toBe(false);
    const withMaaneh = SchemaRegistry.withOverrides([['maaneh', { type: 'object', required: ['text'] }]]);
    expect(withMaaneh.validate('maaneh', { text: 'כן' }).ok).toBe(true);
    expect(withMaaneh.validate('maaneh', {}).ok).toBe(false);
  });
});

describe('ids', () => {
  it('makes well-formed random ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isEntityId(id)).toBe(true);
  });

  it('makes the same id for the same seed', async () => {
    const a = await idFromSeed('mafteiach-occasion', '1234');
    expect(await idFromSeed('mafteiach-occasion', '1234')).toBe(a);
    expect(await idFromSeed('mafteiach-occasion', '1235')).not.toBe(a);
    expect(await idFromSeed('jem-event', '1234')).not.toBe(a);
    expect(isEntityId(a)).toBe(true);
  });

  it('reads ids the forgiving Crockford way', () => {
    expect(readId('RH-7K2M-9Q4D')).toBe('rh-7k2m9q4d');
    expect(readId('rh-OIL12345')).toBe('rh-01112345');
    expect(readId('rh-u1234567')).toBeNull();
    expect(readId('hello')).toBeNull();
  });
});

describe('paths', () => {
  it('builds readable paths', () => {
    expect(joinPath('Likkutei Sichos', 12, 'Bereishis', 3)).toBe('/likkutei-sichos/12/bereishis/3');
    expect(joinPath('events', '5741-06B-14')).toBe('/events/5741-06b-14');
    expect(slugify("Igros Kodesh (Admor ha'Zaken)")).toBe('igros-kodesh-admor-hazaken');
    expect(isEntityPath('/likkutei-sichos/12')).toBe(true);
    expect(isEntityPath('likkutei-sichos')).toBe(false);
    expect(isEntityPath('/Likkutei')).toBe(false);
  });
});

describe('order keys', () => {
  it('always finds a key between two others', () => {
    let keys = ['V'];
    for (let i = 0; i < 200; i++) {
      const at = i % (keys.length + 1);
      const key = orderBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys = [...keys.slice(0, at), key, ...keys.slice(at)];
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spaces a bulk import evenly, leaving room between', () => {
    const keys = orderKeys(10_000);
    expect(keys).toHaveLength(10_000);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(10_000);
    expect(orderBetween(keys[0]!, keys[1]!) > keys[0]!).toBe(true);
  });
});

describe('canonical JSON and hashes', () => {
  it('ignores key order', async () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(await contentHash({ a: 1, b: 2 })).toBe(await contentHash({ b: 2, a: 1 }));
  });
});

describe('rights', () => {
  it('follows the Sichos-Kodesh gate and the plan defaults', () => {
    expect(defaultRightsState({ source: 'hebrewbooks', licence: 'public-domain' })).toBe('link');
    expect(defaultRightsState({ source: 'sefaria', licence: 'cc-by-nc' })).toBe('credit');
    expect(defaultRightsState({ source: 'contribution', licence: 'unknown', fileClass: 'teshura-scan' })).toBe('credit');
    expect(defaultRightsState({ source: 'contribution', licence: 'unknown', fileClass: 'hanacha' })).toBe('link');
    expect(defaultRightsState({ source: 'mafteiach', licence: 'unknown', fileClass: 'sichos-kodesh-hanacha' })).toBe('open');
    expect(defaultRightsState({ source: 'mafteiach', licence: 'unknown', fileClass: 'sichos-kodesh-hanacha', setPolicy: 'locked' })).toBe('preserved');
    expect(defaultRightsState({ source: 'contribution', licence: 'cc0', fileClass: 'publisher-scan' })).toBe('link');
    expect(defaultRightsState({ source: 'contribution', licence: 'cc0', setPolicy: 'locked' })).toBe('preserved');
    expect(defaultRightsState({ source: 'igros-app', licence: 'commercial' })).toBe('preserved');
    expect(rightsStateFromDecision('ship-with-credit')).toBe('credit');
  });
});

describe('references', () => {
  it('finds every link an item makes, with the types it may point at', () => {
    const refs = referencesOf('unit', EXAMPLES.unit);
    expect(refs).toEqual([
      { field: 'work', id: 'rh-00000002', expected: ['work'] },
      { field: 'events', id: 'rh-00000003', expected: ['event'] },
      { field: 'body.href', id: 'rh-00000005', expected: [] },
    ]);
    expect(referencesOf('work', { ...EXAMPLES.work, authors: [], sets: [], addition: { kind: 'commentary', to: 'rh-00000009' } })).toEqual([{ field: 'addition.to', id: 'rh-00000009', expected: ['work'] }]);
    expect(referencesOf('segment', { ...EXAMPLES.segment, page: { scan: 'rh-00000006', page: 1 } }).map((r) => r.expected)).toEqual([['text'], ['scan']]);
  });
});

describe('page words', () => {
  const registry = SchemaRegistry.builtin();
  const page = (runs: unknown[]) => ({ ...EXAMPLES.unit, body: { profile: 'plain', versions: [{ id: 'he', language: 'he', segments: [{ id: 'p1', kind: 'paragraph', text: runs }] }] } });

  it('takes structured words and nothing else: no markup, no unknown marks, no unsafe links', () => {
    expect(registry.validate('unit', page([{ text: 'שלום', marks: ['b', 'i'] }])).ok).toBe(true);
    expect(registry.validate('unit', { ...EXAMPLES.unit, body: "'''wikitext'''" }).ok).toBe(false);
    expect(registry.validate('unit', page([{ text: 'x', marks: ['script'] }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ text: 'x', href: 'javascript:alert(1)' }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ text: 'x', note: 'n1' }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ html: '<b>x</b>' }])).ok).toBe(false);
  });

  it('tidies words into their one kept form, and reads them as plain text', () => {
    expect(
      tidyInline([{ text: '  a' }, { text: 'b', marks: [] }, { text: 'c', marks: ['i', 'b', 'b'] }, { text: '' }, { text: 'd', marks: ['b', 'i'] }, { br: true }, { text: 'e', href: 'javascript:x' }, { br: true }]),
    ).toEqual([{ text: 'ab' }, { text: 'cd', marks: ['b', 'i'] }, { br: true }, { text: 'e' }]);
    expect(pageTextPlain(EXAMPLES.unit.body)).toBe('פרק א\nבראשית ברא\nעיין\nהערה');
    expect(pageTextPlain('old words')).toBe('old words');
    expect(plainPage('א\nב\n\nג').versions[0]!.segments).toEqual([
      { id: 'p1', kind: 'paragraph', text: [{ text: 'א' }, { br: true }, { text: 'ב' }] },
      { id: 'p2', kind: 'paragraph', text: [{ text: 'ג' }] },
    ]);
  });

  it("keeps the print's line ends: valid in the schema, kept by tidying, and no words to any reader", () => {
    const runs = [
      { text: 'והנה ' },
      { text: 'בפרשתנו', marks: ['b'] },
      { eol: 'line', page: 3, box: [0.1, 0.2, 0.8, 0.03] },
      { text: ' מבואר שהמש' },
      { eol: 'column', split: true },
      { text: 'כן' },
      { eol: 'line' },
      { eol: 'page', page: 3 },
    ] as const;
    expect(registry.validate('unit', page([...runs]))).toEqual({ ok: true });
    expect(registry.validate('unit', page([{ eol: 'paragraph' }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ eol: 'line', split: false }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ eol: 'line', page: 0 }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ eol: 'line', box: [0, 0, 1.5, 0] }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ eol: 'line', box: [0, 0, 1] }])).ok).toBe(false);
    expect(registry.validate('unit', page([{ eol: 'line', text: 'x' }])).ok).toBe(false);

    // A line's end is never joined, dropped or moved, and the words on its two sides stay apart.
    const tidy = tidyInline([...runs] as never);
    expect(tidy).toEqual(runs);
    expect(tidyInline(tidy)).toEqual(tidy);
    expect(JSON.parse(JSON.stringify(tidy))).toEqual(tidy);
    // The last words are trimmed even with line ends after them; a broken line end loses only what is broken.
    expect(tidyInline([{ text: 'סוף  ' }, { eol: 'page', page: 2.5, box: [0, 0] } as never])).toEqual([{ text: 'סוף' }, { eol: 'page' }]);

    // It carries no words: the split word reads whole.
    expect(inlineText(tidy)).toBe('והנה בפרשתנו מבואר שהמשכן');
    expect(pageTextPlain(page([...runs]).body)).toBe('והנה בפרשתנו מבואר שהמשכן');
  });

  it('changes one segment and leaves the rest as they were', () => {
    const body = EXAMPLES.unit.body!;
    const fixed = changeSegment(body, 'he', '1.1', { text: [{ text: 'בראשית ברא' }] });
    expect(findSegment(fixed.versions[0]!, '1.1')?.segment.text).toEqual([{ text: 'בראשית ברא' }]);
    expect(findSegment(body.versions[0]!, '1.1')?.segment.text).toHaveLength(6); // the original is untouched
    const added = changeSegment(body, 'he', '1.1', { after: { id: newSegmentId(body.versions[0]!), kind: 'verse', text: [{ text: 'חדש' }] } });
    expect(added.versions[0]!.segments[0]!.children!.map((s) => s.id)).toEqual(['1.1', 'p4']);
    expect(changeSegment(added, 'he', 'p4', { remove: true })).toEqual(body);
    expect(() => changeSegment(body, 'he', 'nope', { remove: true })).toThrow(RangeError);
  });
});
