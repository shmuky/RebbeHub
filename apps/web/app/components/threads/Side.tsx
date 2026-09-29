import { Bell, BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Lang } from '../../lib/i18n.js';
import { threads } from '../../lib/threads.js';
import { tt } from '../../lib/threadStrings.js';

/**
 * Following a conversation from its side column: every comment and change
 * comes to the inbox. Writing in it, being mentioned, asked to review or
 * assigned follows it already.
 */
export function SubscribeBox({ lang, kind, id, subscribed, signedIn }: { lang: Lang; kind: 'changeset' | 'report'; id: number; subscribed: boolean; signedIn: boolean }) {
  const [on, setOn] = useState(subscribed);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(subscribed), [subscribed]);
  if (!signedIn) return null;
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch('/_/follows', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ kind, id: String(id), on: !on }),
      });
      if (response.ok) setOn(!on);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>{tt(lang, on ? 'unsubscribe' : 'subscribe')}</h2>
      <button type="button" className="btn" onClick={() => void toggle()} disabled={busy} style={{ inlineSize: '100%' }}>
        {on ? <BellOff size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />} {tt(lang, on ? 'unsubscribe' : 'subscribe')}
      </button>
      <p className="th-hint">{tt(lang, on ? 'subscribedNote' : 'notSubscribedNote')}</p>
    </section>
  );
}

/** Opening a conversation reads its inbox lines: they need no second visit. */
export function useReadOnOpen(kind: 'changeset' | 'report', id: number | null, signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || id === null) return;
    void threads('inbox/read', { body: { subject: { kind, id: String(id) } } })
      .then(() => window.dispatchEvent(new Event('rebbehub:inbox')))
      .catch(() => undefined);
  }, [kind, id, signedIn]);
}

/** People to pick (assignees, reviewers): handles that start with what is typed, this conversation's people first. */
export async function loadPeople(q: string, thread?: string) {
  const params = new URLSearchParams({ q, limit: '10' });
  if (thread) params.set('thread', thread);
  const { people } = await threads<{ people: Array<{ username: string; displayName: string }> }>(`people?${params}`);
  return people.map((p) => ({ value: p.username, label: p.username, hint: p.displayName }));
}
