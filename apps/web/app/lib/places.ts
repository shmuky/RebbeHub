/**
 * Where you stopped: the page of a PDF in the reader, the part and moment
 * of a farbrengen in the player. Kept in this browser for everyone, and
 * for a signed-in person also on their account (/_/places, the API's
 * /v1/places), so another device opens there too and the home page offers
 * "continue". Writes to the account are spaced out (every few seconds at
 * most, and once more as the page is left); the browser's copy is written
 * each time.
 */

export type PlaceKind = 'read' | 'listen';

export interface Place {
  kind: PlaceKind;
  /** A PDF's address for reading, an event's page for listening. */
  key: string;
  title: string;
  sub?: string | null;
  /** The site's own address that reopens it. */
  href: string;
  /** `{ page, pages }` for reading; `{ queue, index, time, duration }` for listening. */
  place: Record<string, unknown>;
  updatedAt: string;
}

/** A part of a farbrengen, as the player queues it (the fields a place needs). */
interface QueuedPart {
  id: string;
  href: string;
}

/** A farbrengen's place is kept by its page (without `?lang=`), so both languages share it. */
export const placeKey = (track: QueuedPart) => track.href.split('?')[0]!;

/** Where to start a queue: where it was stopped, when that is a part of this same queue not yet heard to its end. */
export function resumeFrom(queue: QueuedPart[], saved: { place: Record<string, unknown> } | null): { index: number; time: number } | null {
  const index = Number(saved?.place.index);
  const time = Number(saved?.place.time);
  const duration = Number(saved?.place.duration) || 0;
  const was = (saved?.place.queue as QueuedPart[] | undefined)?.[index];
  if (!saved || !Number.isInteger(index) || !queue[index] || !was || was.id !== queue[index]!.id || !(time > 10)) return null;
  if (duration > 0 && time > duration - 20) return index + 1 < queue.length ? { index: index + 1, time: 0 } : null;
  return { index, time };
}

const STORE = 'rebbehub.places';
const MAX = 60;
const SYNC_EVERY_MS = 15_000;

const id = (kind: PlaceKind, key: string) => `${kind} ${key}`;

function readLocal(): Place[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((p): p is Place => Boolean(p && typeof p === 'object' && (p as Place).key && (p as Place).href && (p as Place).place)) : [];
  } catch {
    return [];
  }
}

function writeLocal(places: Place[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(places.slice(0, MAX)));
  } catch {
    // Private windows and full storage: reading goes on, it is only not remembered.
  }
}

/** Newest first, one per thing: the later of two places for the same thing wins. */
export function mergePlaces(...lists: Place[][]): Place[] {
  const best = new Map<string, Place>();
  for (const place of lists.flat()) {
    const known = best.get(id(place.kind, place.key));
    if (!known || known.updatedAt < place.updatedAt) best.set(id(place.kind, place.key), place);
  }
  return [...best.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Where this browser stopped in one thing. */
export function localPlace(kind: PlaceKind, key: string): Place | null {
  return readLocal().find((p) => p.kind === kind && p.key === key) ?? null;
}

export function localPlaces(): Place[] {
  return mergePlaces(readLocal());
}

const pending = new Map<string, Place>();
const lastSent = new Map<string, number>();

function send(place: Place): void {
  lastSent.set(id(place.kind, place.key), Date.now());
  pending.delete(id(place.kind, place.key));
  const { updatedAt: _at, ...body } = place;
  // keepalive: the last place is still sent as the page closes.
  void fetch('/_/places', { method: 'PUT', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
}

/** Sends what is waiting to the account now (as a page is left or hidden). */
export function flushPlaces(): void {
  for (const place of [...pending.values()]) send(place);
}

/**
 * Keeps a place: in this browser at once, and on the account (`sync`, when
 * signed in) no more often than every few seconds, or now with `flush`.
 */
export function recordPlace(input: Omit<Place, 'updatedAt'>, options: { sync: boolean; flush?: boolean }): void {
  const place: Place = { ...input, updatedAt: new Date().toISOString() };
  writeLocal([place, ...readLocal().filter((p) => !(p.kind === place.kind && p.key === place.key))]);
  if (!options.sync) return;
  pending.set(id(place.kind, place.key), place);
  if (options.flush || Date.now() - (lastSent.get(id(place.kind, place.key)) ?? 0) >= SYNC_EVERY_MS) send(place);
}

/** Forgets a place here and, when signed in, on the account (a farbrengen heard to its end, "remove"). */
export function forgetPlace(kind: PlaceKind, key: string, sync: boolean): void {
  writeLocal(readLocal().filter((p) => !(p.kind === kind && p.key === key)));
  pending.delete(id(kind, key));
  if (sync) void fetch(`/_/places?${new URLSearchParams({ kind, key })}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
}

/** The account's places (all, or one thing's), newest first; none when not signed in or offline. */
export async function accountPlaces(filter: { kind?: PlaceKind; key?: string; limit?: number } = {}): Promise<Place[]> {
  const query = new URLSearchParams();
  if (filter.kind) query.set('kind', filter.kind);
  if (filter.key) query.set('key', filter.key);
  query.set('limit', String(filter.limit ?? 20));
  try {
    const response = await fetch(`/_/places?${query}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    return ((await response.json()) as { places?: Place[] }).places ?? [];
  } catch {
    return [];
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPlaces);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPlaces();
  });
}
