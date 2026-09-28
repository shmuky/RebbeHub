import { useEffect, useState } from 'react';

/**
 * Who is signed in, asked by the browser after the page has loaded
 * (/_/auth/me). Pages are the same for everyone and cached as such; only
 * this answer is personal, and it is never cached. `undefined` while it is
 * being asked, `null` when nobody is signed in.
 */

export interface SignedIn {
  person: { id: string; displayName: string };
  passkeys: Array<{ credentialId: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null }>;
}

let asked: Promise<SignedIn | null> | null = null;
const listeners = new Set<(value: SignedIn | null) => void>();

function ask(): Promise<SignedIn | null> {
  asked ??= fetch('/_/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<{ person: SignedIn['person'] | null; passkeys?: SignedIn['passkeys'] }>) : { person: null }))
    .then((body) => (body.person ? { person: body.person, passkeys: body.passkeys ?? [] } : null))
    .catch(() => null);
  return asked;
}

/** Forgets the answer (after signing in or out) and tells every page that uses it. */
export function refreshAccount(): void {
  asked = null;
  void ask().then((value) => listeners.forEach((l) => l(value)));
}

export function useAccount(): SignedIn | null | undefined {
  const [account, setAccount] = useState<SignedIn | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const listen = (value: SignedIn | null) => live && setAccount(value);
    listeners.add(listen);
    void ask().then(listen);
    return () => {
      live = false;
      listeners.delete(listen);
    };
  }, []);
  return account;
}
