import { describe, expect, it } from 'vitest';
import { SchemaRegistry } from '@rebbehub/model';
import { legacyProfile, readLegacyBody, withStructuredBody } from '@rebbehub/core';

/** Page bodies as the importers wrote them before words had structure, read into it. */
describe('bodies kept as wiki markup before words had structure', () => {
  const registry = SchemaRegistry.builtin();

  it('reads a Mafteiach outline as an outline: sections of numbered items', () => {
    const page = readLegacyBody("== תוכן ענינים ==\n\n1. הפיכת העינוי\n\n2. פרטי עניני צום גדלי'\n\n== הוספות ==\n\nמכתב", legacyProfile({ source: 'mafteiach', via: 'mafteiach-index' }));
    expect(page).toEqual({
      profile: 'outline',
      versions: [
        {
          id: 'he',
          language: 'he',
          segments: [
            { id: 's1', kind: 'section', text: [{ text: 'תוכן ענינים' }], children: [
              { id: 's1.1', kind: 'item', n: 1, text: [{ text: 'הפיכת העינוי' }] },
              { id: 's1.2', kind: 'item', n: 2, text: [{ text: "פרטי עניני צום גדלי'" }] },
            ] },
            { id: 's2', kind: 'section', text: [{ text: 'הוספות' }], children: [{ id: 's2.1', kind: 'item', text: [{ text: 'מכתב' }] }] },
          ],
        },
      ],
    });
  });

  it("reads a Sefaria chapter as numbered segments, and the English that stood under its own heading as a version of its own", () => {
    const page = readLegacyBody("== פרק א ==\n\nאות '''א'''\n\nאות ב\n\n== Lessons in Tanya ==\n\n== Chapter 1 ==\n\nFirst", 'sefaria');
    expect(page.profile).toBe('sefaria');
    expect(page.versions.map((v) => [v.id, v.language, v.title])).toEqual([
      ['he', 'he', undefined],
      ['en', 'en', 'Lessons in Tanya'],
    ]);
    expect(page.versions[0]!.segments).toEqual([
      { id: '1', kind: 'section', n: 1, text: [{ text: 'פרק א' }], children: [
        { id: '1.1', kind: 'verse', n: 1, text: [{ text: 'אות ' }, { text: 'א', marks: ['b'] }] },
        { id: '1.2', kind: 'verse', n: 2, text: [{ text: 'אות ב' }] },
      ] },
    ]);
    // The same place has the same id in both, so they stand side by side.
    expect(page.versions[1]!.segments[0]!.children![0]!.id).toBe('1.1');
  });

  it('keeps links, marks, notes and line breaks, and never keeps markup', () => {
    const page = readLegacyBody("* [[rh-00000005|שם]] and [https://example.org here] <u>u</u><br />x<ref>note</ref> <script>&lt;", 'plain');
    expect(page.versions[0]!.segments).toEqual([
      { id: 'p1', kind: 'item', text: [{ text: 'שם', href: 'rh-00000005' }, { text: ' and ' }, { text: 'here', href: 'https://example.org' }, { text: ' ' }, { text: 'u', marks: ['u'] }, { br: true }, { text: 'x' }, { note: 'n1' }, { text: ' <script><' }] },
    ]);
    expect(page.versions[0]!.notes).toEqual([{ id: 'n1', kind: 'note', n: 1, text: [{ text: 'note' }] }]);
  });

  it('gives every item with an old body valid data, and leaves any other as it was', () => {
    const event = { kind: 'farbrengen', title: { he: 'א' }, body: "== תוכן ==\n\nשיחה", bodySource: { source: 'mafteiach', via: 'mafteiach-index' } };
    const read = withStructuredBody(event);
    expect(registry.validate('event', read)).toEqual({ ok: true });
    expect(withStructuredBody(read)).toBe(read);
    expect(withStructuredBody({ ...event, body: '  ' })).not.toHaveProperty('body');
  });
});
