import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../../lib/i18n.js';
import { tt } from '../../lib/threadStrings.js';
import '../../threads.css';

/**
 * Choosing a handle (`@mendy`): suggested from the name while it has not
 * been touched, checked as it is typed (free, taken, reserved, or not the
 * right shape), with a free one offered in its place. The API checks it
 * again when it is used; this only spares a wasted try.
 */

interface Check {
  name: string | null;
  available: boolean;
  message: string | null;
  suggestion: string;
}

async function ask(params: Record<string, string>): Promise<Check | null> {
  const response = await fetch(`/_/auth/username?${new URLSearchParams(params)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  return response.ok ? ((await response.json()) as Check) : null;
}

export function UsernameField({
  lang,
  value,
  onChange,
  from,
  id = 'username',
  onValid,
}: {
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
  /** The name being typed beside it, to suggest a handle from while this one is untouched. */
  from?: string;
  id?: string;
  /** Whether the handle can be had, as it is known. */
  onValid?: (valid: boolean) => void;
}) {
  const touched = useRef(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);

  // An untouched field follows the name.
  useEffect(() => {
    if (touched.current || from === undefined || !from.trim()) return;
    const timer = window.setTimeout(() => {
      void ask({ from: from.trim() }).then((answer) => {
        if (answer && !touched.current) onChange(answer.suggestion);
      });
    }, 300);
    return () => window.clearTimeout(timer);
    // `onChange` is the parent's setter; the question is the name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  useEffect(() => {
    const name = value.trim().replace(/^@/, '');
    if (!name) {
      // Left empty, one is made from the name.
      setCheck(null);
      onValid?.(true);
      return;
    }
    setChecking(true);
    let live = true;
    const timer = window.setTimeout(() => {
      void ask({ name, ...(from?.trim() ? { from: from.trim() } : {}) })
        .then((answer) => {
          if (!live) return;
          setCheck(answer);
          onValid?.(answer?.available ?? true);
        })
        .finally(() => live && setChecking(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="th-username">
      <label htmlFor={id}>{tt(lang, 'username')}</label>
      <div className="th-username-field" dir="ltr">
        <span>@</span>
        <input
          id={id}
          value={value}
          onChange={(e) => {
            touched.current = true;
            onChange(e.target.value.replace(/\s+/g, '-'));
          }}
          maxLength={39}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          pattern="[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}"
          aria-describedby={`${id}-state`}
        />
      </div>
      <div id={`${id}-state`} aria-live="polite">
        {checking ? (
          <span className="th-hint">{tt(lang, 'usernameChecking')}</span>
        ) : check?.name && check.available ? (
          <span className="th-ok">✓ {tt(lang, 'usernameFree')}</span>
        ) : check?.name && !check.available ? (
          <span className="th-bad">
            {check.message}
            {check.suggestion && check.suggestion !== check.name ? (
              <>
                {' · '}
                {tt(lang, 'usernameTry')}{' '}
                <button type="button" className="link-button" onClick={() => onChange(check.suggestion)}>
                  @{check.suggestion}
                </button>
                ?
              </>
            ) : null}
          </span>
        ) : (
          <span className="th-hint">{tt(lang, 'usernameHelp')}</span>
        )}
      </div>
    </div>
  );
}
