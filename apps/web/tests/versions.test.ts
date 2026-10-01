import { describe, expect, it } from 'vitest';
import { between, type VersionStep } from '../app/lib/versions.js';

/** Comparing any two versions of an item (4f) from the history already loaded. */
describe('the changes between two versions', () => {
  const v = (rev: number, changes: VersionStep['changes'], created = false): VersionStep => ({ rev, created, deleted: false, changes });
  // Newest first, as the API gives it.
  const history = [
    v(5, [{ path: '/body/s2/text', before: 'ה׳', after: 'ה׳ חלוקות' }]),
    v(4, [{ path: '/body/s1/text', before: 'B', after: 'A' }]),
    v(3, [{ path: '/body/s2/text', before: 'חמש', after: 'ה׳' }, { path: '/body/s1/text', before: 'A', after: 'B' }]),
    v(2, [{ path: '/label', before: 'x', after: 'y' }]),
    v(1, [], true),
  ];

  it('takes each field as the older version left it and as the newer has it, and drops one changed back', () => {
    expect(between(history, 2, 5)).toEqual([{ path: '/body/s2/text', before: 'חמש', after: 'ה׳ חלוקות' }]);
    expect(between(history, 3, 4)).toEqual([{ path: '/body/s1/text', before: 'B', after: 'A' }]);
  });

  it('cannot say it when the item was made in between, or the order is wrong', () => {
    expect(between(history, 1, 5)).toEqual(expect.any(Array));
    expect(between([v(3, [{ path: '/a', after: 1 }]), v(2, [], true), v(1, [])], 1, 3)).toBeNull();
    expect(between(history, 5, 2)).toBeNull();
  });

  it('cannot say it when one change replaced a whole part another changed inside', () => {
    expect(between([v(3, [{ path: '/body', before: {}, after: { s: 1 } }]), v(2, [{ path: '/body/s', before: 0, after: 2 }]), v(1, [])], 1, 3)).toBeNull();
  });
});
