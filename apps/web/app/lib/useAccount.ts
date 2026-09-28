import { useEffect, useState } from 'react';

/**
 * Who is signed in, asked by the browser after the page has loaded
 * (/_/auth/me). Pages are the same for everyone and cached as such; only
 * this answer is personal, and it is never cached. `undefined` while it is
 * being asked, `null` when nobody is signed in.
 */

export interface SignedIn {
  person: { id: string; displayName: string; steward?: boolean };
  passkeys: Array<{ credentialId: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null }>;
  googleAccounts: Array<{ email: string | null; createdAt: string }>;
}

interface Answer {
  account: SignedIn | null;
  /** Whether the site can sign in with Google yet. */
  google: boolean;
}

let asked: Promise<Answer> | null = null;
const listeners = new Set<(value: Answer) => void>();

function ask(): Promise<Answer> {
  asked ??= fetch('/_/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<{ person: SignedIn['person'] | null; passkeys?: SignedIn['passkeys']; googleAccounts?: SignedIn['googleAccounts']; google?: boolean }>) : { person: null }))
    .then((body) => ({
      account: body.person ? { person: body.person, passkeys: body.passkeys ?? [], googleAccounts: body.googleAccounts ?? [] } : null,
      google: body.google ?? false,
    }))
    .catch(() => ({ account: null, google: false }));
  return asked;
}

/** Forgets the answer (after signing in or out) and tells every page that uses it. */
export function refreshAccount(): void {
  asked = null;
  void ask().then((value) => listeners.forEach((l) => l(value)));
}

function useAnswer(): Answer | undefined {
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const listen = (value: Answer) => live && setAnswer(value);
    listeners.add(listen);
    void ask().then(listen);
    return () => {
      live = false;
      listeners.delete(listen);
    };
  }, []);
  return answer;
}

export function useAccount(): SignedIn | null | undefined {
  const answer = useAnswer();
  return answer === undefined ? undefined : answer.account;
}

/** Whether Google sign-in is switched on; false until it is known. */
export function useGoogleSignIn(): boolean {
  return useAnswer()?.google ?? false;
}
