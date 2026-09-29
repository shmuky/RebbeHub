import { useEffect, useState } from 'react';

/**
 * Who is signed in, asked by the browser after the page has loaded
 * (/_/auth/me). Pages are the same for everyone and cached as such; only
 * this answer is personal, and it is never cached. `undefined` while it is
 * being asked, `null` when nobody is signed in.
 */

export interface SignedIn {
  person: { id: string; displayName: string; username?: string; steward?: boolean; admin?: boolean };
  /** Inbox lines not read yet (mentions, review requests, what they follow). */
  unread: number;
  passkeys: Array<{ credentialId: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null }>;
  googleAccounts: Array<{ email: string | null; createdAt: string }>;
  /** Addresses that sign this person in by email link (their Google accounts' too). */
  emails: Array<{ email: string; createdAt: string; google: boolean }>;
  /** Email updates of what they follow. */
  notifications: { mode: 'off' | 'daily' | 'immediate'; email: string | null; lang: 'he' | 'en' };
  /** Earned by approved suggestions: trusted people's line fixes in open sets go live at once. */
  trust: 'contributor' | 'trusted';
}

interface Answer {
  account: SignedIn | null;
  /** Whether the site can sign in with Google yet. */
  google: boolean;
  /** Whether the site can send email yet (sign-in links, updates). */
  email: boolean;
}

type MeBody = Partial<Omit<SignedIn, 'person'>> & { person: SignedIn['person'] | null; google?: boolean; email?: boolean };

let asked: Promise<Answer> | null = null;
const listeners = new Set<(value: Answer) => void>();

function ask(): Promise<Answer> {
  asked ??= fetch('/_/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<MeBody>) : ({ person: null } as MeBody)))
    .then((body) => ({
      account: body.person
        ? {
            person: body.person,
            passkeys: body.passkeys ?? [],
            googleAccounts: body.googleAccounts ?? [],
            emails: body.emails ?? [],
            notifications: body.notifications ?? { mode: 'off' as const, email: null, lang: 'he' as const },
            trust: body.trust ?? 'contributor',
            unread: body.unread ?? 0,
          }
        : null,
      google: body.google ?? false,
      email: body.email ?? false,
    }))
    .catch(() => ({ account: null, google: false, email: false }));
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

/** Whether the site sends email (sign-in links, updates); false until it is known. */
export function useEmailSignIn(): boolean {
  return useAnswer()?.email ?? false;
}

/** Whether Google sign-in is switched on; false until it is known. */
export function useGoogleSignIn(): boolean {
  return useAnswer()?.google ?? false;
}
