import { describe, expect, it } from 'vitest';
import { everyWork, shelvesOf, type ShelfItem } from '../app/lib/shelves.js';

const set = (id: string, name: string, extra: Record<string, unknown> = {}, path = `/sets/${id}`): ShelfItem => ({ id, path, data: { name, ...extra } });
const work = (id: string, sets: string[], order?: string): ShelfItem => ({ id, path: `/${id}`, data: { title: id, sets, order } });
const name = (x: ShelfItem) => String((x.data as { name?: string; title?: string }).name ?? (x.data as { title?: string }).title);

describe('the library shelves', () => {
  const sets = [
    set('rebbe', 'The Rebbe', { order: 'b' }),
    set('ls', 'Likkutei Sichos', { parent: 'rebbe', order: 'a' }),
    set('igros', 'Igros', { parent: 'rebbe', order: 'b' }),
    set('bst', 'Baal Shem Tov', { order: 'a' }),
    set('journals', 'Journals'),
    set('empty', 'Empty', { order: 'c' }),
    set('hebrewbooks', 'HebrewBooks', {}, '/sets/hebrewbooks'),
    set('farbrengens', 'Farbrengens', {}, '/sets/farbrengens'),
  ];
  const works = [work('otzar', ['ls'], 'b'), work('lsw', ['ls'], 'a'), work('letters', ['igros']), work('tzavaah', ['bst']), work('hb', ['hebrewbooks']), work('kovetz', ['journals'])];

  it('keeps the shelves in their order, those never ordered after, and leaves out sources and empty shelves', () => {
    const shelves = shelvesOf(sets, works, name, (s) => s.path === '/sets/farbrengens');
    expect(shelves.map((s) => s.set.id)).toEqual(['bst', 'rebbe', 'farbrengens', 'journals']);
  });

  it('puts the sets inside a shelf in their order, with their sefarim in theirs, and counts them all', () => {
    const rebbe = shelvesOf(sets, works, name).find((s) => s.set.id === 'rebbe')!;
    expect(rebbe.sets.map((s) => s.set.id)).toEqual(['ls', 'igros']);
    expect(rebbe.sets[0]!.works.map((w) => w.id)).toEqual(['lsw', 'otzar']);
    expect(rebbe.total).toBe(3);
    expect(everyWork(rebbe).map((w) => w.id)).toEqual(['lsw', 'otzar', 'letters']);
  });
});
