import { useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../../lib/i18n.js';
import { href } from '../../lib/links.js';
import { personPath } from '../../lib/threads.js';
import { tt } from '../../lib/threadStrings.js';
import { refreshAccount } from '../../lib/useAccount.js';
import { UsernameField } from './UsernameField.js';

/**
 * A signed-in person's handle on their account page: their page's
 * address (/u/…), and changing it. The old handle keeps leading to them,
 * in addresses and in @mentions already written.
 */
export function HandleSettings({ lang, username }: { lang: Lang; username: string | undefined }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(username ?? '');
  const [ok, setOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/_/auth/username', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ username: value.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? response.statusText);
      setEditing(false);
      setSaved(true);
      refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="section-header">{tt(lang, 'username')}</h2>
      {editing ? (
        <form onSubmit={save} className="signin-form">
          <UsernameField lang={lang} id="handle" value={value} onChange={setValue} onValid={setOk} />
          <p className="row-sub">{tt(lang, 'usernameChangeNote')}</p>
          {error ? (
            <p className="th-error" role="alert">
              {error}
            </p>
          ) : null}
          <p>
            <button type="submit" disabled={busy || !ok || !value.trim() || value.trim() === username}>
              {tt(lang, 'save')}
            </button>{' '}
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {tt(lang, 'cancel')}
            </button>
          </p>
        </form>
      ) : (
        <p>
          {username ? (
            <Link to={href(personPath(username), lang)} dir="ltr">
              @{username}
            </Link>
          ) : null}{' '}
          <button type="button" className="link-button" onClick={() => (setValue(username ?? ''), setEditing(true), setSaved(false))}>
            {tt(lang, 'usernameChange')}
          </button>
          {saved ? <span className="th-ok"> {tt(lang, 'usernameSaved')}</span> : null}
        </p>
      )}
    </section>
  );
}
