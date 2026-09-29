import { useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../../lib/i18n.js';
import { href } from '../../lib/links.js';
import { personPath } from '../../lib/threads.js';
import { tt } from '../../lib/threadStrings.js';
import { refreshAccount } from '../../lib/useAccount.js';
import { Icon } from '../../ui/Icon.js';
import { UsernameField } from './UsernameField.js';

/**
 * A signed-in person's handle, as one row of their account page's
 * profile: their page's address (/u/…), and changing it in place. The
 * old handle keeps leading to them, in addresses and in @mentions
 * already written.
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
    <div className="set-row" id="handle">
      <div className="set-k">
        <b>{tt(lang, 'username')}</b>
        <span className="hint">{tt(lang, 'usernameHelp')}</span>
      </div>
      {editing ? (
        <form onSubmit={save} className="set-edit form">
          <UsernameField lang={lang} id="handle-input" value={value} onChange={setValue} onValid={setOk} />
          <p className="hint">{tt(lang, 'usernameChangeNote')}</p>
          {error ? (
            <div className="alert negative" role="alert">
              <Icon name="warn" />
              <div>{error}</div>
            </div>
          ) : null}
          <div className="btn-row">
            <button type="submit" className="btn primary sm" disabled={busy || !ok || !value.trim() || value.trim() === username}>
              {tt(lang, 'save')}
            </button>
            <button type="button" className="btn sm" onClick={() => setEditing(false)}>
              {tt(lang, 'cancel')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="set-v">
            {username ? (
              <Link to={href(personPath(username), lang)} dir="ltr">
                @{username}
              </Link>
            ) : null}
            {saved ? (
              <span className="handle-ok" role="status">
                <Icon name="check" size={14} />
                {tt(lang, 'usernameSaved')}
              </span>
            ) : null}
          </div>
          <button type="button" className="btn sm" onClick={() => (setValue(username ?? ''), setEditing(true), setSaved(false))}>
            {tt(lang, 'usernameChange')}
          </button>
        </>
      )}
    </div>
  );
}
