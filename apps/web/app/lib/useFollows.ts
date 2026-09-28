import { useEffect, useState } from 'react';
import type { Entity } from './api.js';

/**
 * What the signed-in person follows, asked by the browser (/_/follows)
 * like who is signed in: pages stay the same for everyone. `null` when
 * nobody is signed in.
 */

export interface Follows {
  follows: Array<{ kind: 'entity' | 'set' | 'project' | 'changeset'; id: string; since: string }>;
  items: Entity[];
  feed: Array<{ seq: number; at: string; message: string; authorName: string; authorIsBot: boolean; entityId: string; changes: number }>;
}

let asked: Promise<Follows | null> | null = null;
const listeners = new Set<(value: Follows | null) => void>();

function ask(): Promise<Follows | null> {
  asked ??= fetch('/_/follows', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<Follows>) : null))
    .catch(() => null);
  return asked;
}

/** Follows or stops following an item, then tells every page that shows it. */
export async function setFollow(entity: Pick<Entity, 'id' | 'type'>, on: boolean): Promise<void> {
  const response = await fetch('/_/follows', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ kind: entity.type === 'set' ? 'set' : 'entity', id: entity.id, on }),
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? response.statusText);
  asked = null;
  const value = await ask();
  listeners.forEach((l) => l(value));
}

export function useFollows(enabled = true): Follows | null | undefined {
  const [follows, setFollows] = useState<Follows | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const listen = (value: Follows | null) => live && setFollows(value);
    listeners.add(listen);
    void ask().then(listen);
    return () => {
      live = false;
      listeners.delete(listen);
    };
  }, [enabled]);
  return follows;
}
