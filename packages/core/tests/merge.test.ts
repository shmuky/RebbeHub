import { describe, expect, it } from 'vitest';
import { diffData, resolveConflicts, threeWayMerge, UnresolvedConflictError } from '@rebbehub/core';

describe('threeWayMerge', () => {
  const base = { title: { he: 'יו״ד שבט', en: 'Yud Shvat' }, date: '5742-05-10', sets: ['rh-00000001'] };

  it('takes whichever side changed', () => {
    expect(threeWayMerge(base, base, { ...base, date: '5742-05-11' }).merged).toEqual({ ...base, date: '5742-05-11' });
    expect(threeWayMerge(base, { ...base, date: '5742-05-11' }, base).merged).toEqual({ ...base, date: '5742-05-11' });
  });

  it('merges different fields, and different keys of one field, silently', () => {
    const ours = { ...base, date: '5742-05-11' };
    const theirs = { ...base, title: { ...base.title, en: 'Yud Shevat' } };
    expect(threeWayMerge(base, ours, theirs)).toEqual({ merged: { ...base, date: '5742-05-11', title: { he: 'יו״ד שבט', en: 'Yud Shevat' } }, conflicts: [] });
  });

  it('returns a real clash as a choice', () => {
    const result = threeWayMerge(base, { ...base, date: '5742-05-11' }, { ...base, date: '5742-05-12' });
    expect(result.conflicts).toEqual([{ path: '/date', base: '5742-05-10', ours: '5742-05-11', theirs: '5742-05-12' }]);
    expect(resolveConflicts(result, { '/date': { take: 'theirs' } })).toEqual({ ...base, date: '5742-05-12' });
    expect(resolveConflicts(result, { '/date': { value: '5742-05-13' } })).toEqual({ ...base, date: '5742-05-13' });
    expect(() => resolveConflicts(result, {})).toThrow(UnresolvedConflictError);
  });

  it('merges lists of ids as sets', () => {
    const ours = { ...base, sets: ['rh-00000001', 'rh-00000002'] };
    const theirs = { ...base, sets: ['rh-00000003'] };
    expect(threeWayMerge(base, ours, theirs).merged).toEqual({ ...base, sets: ['rh-00000002', 'rh-00000003'] });
  });

  it('merges a page line by line', () => {
    const page = { layer: 'rh-00000001', page: 1, proofread: 0, lines: [{ id: 'a', text: 'שורה א' }, { id: 'b', text: 'שורה ב' }, { id: 'c', text: 'שורה ג' }] };
    const ours = { ...page, lines: [{ id: 'a', text: 'שורה א!' }, page.lines[1]!, page.lines[2]!] };
    const theirs = { ...page, lines: [page.lines[0]!, page.lines[1]!, { id: 'c', text: 'שורה ג!' }, { id: 'd', text: 'שורה ד' }] };
    const result = threeWayMerge(page, ours, theirs);
    expect(result.conflicts).toEqual([]);
    expect((result.merged as typeof page).lines.map((l) => l.text)).toEqual(['שורה א!', 'שורה ב', 'שורה ג!', 'שורה ד']);
    const clash = threeWayMerge(page, ours, { ...page, lines: [{ id: 'a', text: 'שורה אא' }, page.lines[1]!, page.lines[2]!] });
    expect(clash.conflicts.map((c) => c.path)).toEqual(['/lines/a/text']);
    expect((resolveConflicts(clash, { '/lines/a/text': { take: 'theirs' } }) as typeof page).lines[0]!.text).toBe('שורה אא');
  });

  it('sends delete-against-edit to the reviewer', () => {
    const result = threeWayMerge(base, { ...base, date: '5742-05-11' }, null);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.path).toBe('');
    expect(resolveConflicts(result, { '': { take: 'theirs' } })).toBeNull();
  });
});

describe('diffData', () => {
  it('lists field changes for the before/after view', () => {
    expect(diffData({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 })).toEqual([
      { path: '/b/c', before: 2, after: 3 },
      { path: '/d', before: undefined, after: 4 },
    ]);
    expect(diffData(null, { a: 1 })).toEqual([{ path: '', before: undefined, after: { a: 1 } }]);
  });
});
